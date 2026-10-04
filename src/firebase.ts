import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  getDocFromServer,
  serverTimestamp,
  collection,
  query,
  where,
  orderBy,
  getDocs,
  limit,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId as string);
export const googleProvider = new GoogleAuthProvider();

// System Owner & Admin Email
export const ADMIN_EMAIL = 'demircilyda@gmail.com';

// User Profile Interface
export interface AppUserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  role: 'admin' | 'user';
  tier: 'free' | 'pro' | 'unlimited';
  creditsRemaining: number;
  createdAt: any;
  updatedAt: any;
}

// Test Connection as required by Firebase skill
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firebase connection notice: client appears offline.');
    }
  }
}
testConnection();

// Check if user is admin
export function isUserAdmin(email?: string | null): boolean {
  if (!email) return false;
  return email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
}

// Get or initialize user profile in Firestore
export async function getOrCreateUserProfile(user: User): Promise<AppUserProfile> {
  const userRef = doc(db, 'users', user.uid);
  const isAdmin = isUserAdmin(user.email);

  try {
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const data = snap.data() as AppUserProfile;
      // Auto-elevate admin if email matches
      if (isAdmin && (data.role !== 'admin' || data.tier !== 'unlimited')) {
        await updateDoc(userRef, {
          role: 'admin',
          tier: 'unlimited',
          creditsRemaining: 999999,
          updatedAt: serverTimestamp(),
        });
        return {
          ...data,
          role: 'admin',
          tier: 'unlimited',
          creditsRemaining: 999999,
        };
      }
      return data;
    }

    // New user initial profile
    const newProfile: AppUserProfile = {
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || user.email?.split('@')[0] || 'Foydalanuvchi',
      photoURL: user.photoURL || '',
      role: isAdmin ? 'admin' : 'user',
      tier: isAdmin ? 'unlimited' : 'free',
      creditsRemaining: isAdmin ? 999999 : 5, // 5 free trial credits for new registered users
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await setDoc(userRef, newProfile);
    return newProfile;
  } catch (err) {
    console.warn('Error fetching or creating user profile:', err);
    // Graceful in-memory fallback
    return {
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || user.email?.split('@')[0] || 'Foydalanuvchi',
      photoURL: user.photoURL || '',
      role: isAdmin ? 'admin' : 'user',
      tier: isAdmin ? 'unlimited' : 'free',
      creditsRemaining: isAdmin ? 999999 : 5,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
}

// Firestore Error Handling matching Skill Specification
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Deduct 1 credit upon creation (bypassed for Admin)
export async function consumeUserCredit(
  uid: string,
  userEmail: string,
  currentCredits: number,
  cost: number = 1
): Promise<number> {
  if (isUserAdmin(userEmail)) {
    return 999999; // Admin has infinite quota
  }

  const newCredits = Math.max(0, currentCredits - cost);
  try {
    const userRef = doc(db, 'users', uid);
    await updateDoc(userRef, {
      creditsRemaining: newCredits,
      updatedAt: serverTimestamp(),
    });
  } catch (e) {
    console.warn('Could not update credits in Firestore:', e);
  }
  return newCredits;
}

// Add or Top-up credits (e.g. after purchase)
export async function addCreditsToUser(
  uid: string,
  userEmail: string,
  currentCredits: number,
  amount: number,
  newTier?: 'free' | 'pro' | 'unlimited'
): Promise<number> {
  if (isUserAdmin(userEmail)) return 999999;

  const newCredits = (currentCredits || 0) + amount;
  try {
    const userRef = doc(db, 'users', uid);
    const updates: any = {
      creditsRemaining: newCredits,
      updatedAt: serverTimestamp(),
    };
    if (newTier) updates.tier = newTier;
    await updateDoc(userRef, updates);
  } catch (e) {
    console.warn('Could not top-up credits in Firestore:', e);
  }
  return newCredits;
}

// Log generation into Firestore subcollection /users/{uid}/generations/{genId}
export async function logUserGeneration(
  uid: string,
  userEmail: string,
  type: 'podcast' | 'voiceover' | 'tts' | 'dubbing' | 'agent_call',
  title: string,
  creditsCost: number = 1,
  status: 'completed' | 'failed' = 'completed'
): Promise<void> {
  try {
    const genId = `gen-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const genRef = doc(db, 'users', uid, 'generations', genId);
    await setDoc(genRef, {
      userId: uid,
      userEmail,
      type,
      title: title.slice(0, 150),
      creditsCost,
      status,
      createdAt: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('Could not log generation record in Firestore:', e);
  }
}

// Auth Helper Functions
export async function signInWithGoogle(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function signInWithEmail(email: string, pass: string): Promise<User> {
  const result = await signInWithEmailAndPassword(auth, email, pass);
  return result.user;
}

export async function registerWithEmail(email: string, pass: string): Promise<User> {
  const result = await createUserWithEmailAndPassword(auth, email, pass);
  return result.user;
}

export async function logoutUser(): Promise<void> {
  await signOut(auth);
}

// ----------------------------------------------------
// Payment Requests & Subscription Management
// ----------------------------------------------------
export interface PaymentRequest {
  id: string;
  userId: string;
  userEmail: string;
  userName?: string;
  planId: 'starter' | 'pro' | 'unlimited';
  planName: string;
  price: string;
  credits: number;
  paymentMethod: 'uzum' | 'payme' | 'click' | 'card' | 'stripe';
  receiptInfo?: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  approvedAt?: string;
  approvedBy?: string;
  notes?: string;
}

export async function createPaymentRequest(
  data: Omit<PaymentRequest, 'id' | 'status' | 'createdAt'>
): Promise<string> {
  const reqId = `pay_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const reqRef = doc(db, 'paymentRequests', reqId);
  await setDoc(reqRef, {
    ...data,
    id: reqId,
    status: 'pending',
    createdAt: new Date().toISOString(),
  });
  return reqId;
}

export async function getPendingPaymentRequests(): Promise<PaymentRequest[]> {
  try {
    const q = query(
      collection(db, 'paymentRequests'),
      orderBy('createdAt', 'desc'),
      limit(50)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as PaymentRequest);
  } catch (e) {
    console.warn('Could not fetch payment requests:', e);
    return [];
  }
}

export async function approvePaymentRequest(
  request: PaymentRequest,
  adminEmail: string
): Promise<void> {
  const reqRef = doc(db, 'paymentRequests', request.id);
  await updateDoc(reqRef, {
    status: 'approved',
    approvedAt: new Date().toISOString(),
    approvedBy: adminEmail,
  });

  // Credit user's account in Firestore
  const userRef = doc(db, 'users', request.userId);
  const userSnap = await getDoc(userRef);
  const currentCredits = userSnap.exists() ? userSnap.data()?.creditsRemaining || 0 : 0;
  const newCredits = currentCredits + request.credits;
  const updates: any = {
    creditsRemaining: newCredits,
    updatedAt: serverTimestamp(),
  };
  if (request.planId === 'pro' || request.planId === 'unlimited') {
    updates.tier = request.planId;
  }
  await updateDoc(userRef, updates);
}

export async function rejectPaymentRequest(
  requestId: string,
  reason: string
): Promise<void> {
  const reqRef = doc(db, 'paymentRequests', requestId);
  await updateDoc(reqRef, {
    status: 'rejected',
    notes: reason,
    updatedAt: serverTimestamp(),
  });
}

export async function adminManualGrantCredits(
  targetEmail: string,
  creditsAmount: number,
  tier: 'free' | 'pro' | 'unlimited' = 'pro'
): Promise<{ success: boolean; message: string }> {
  try {
    const q = query(collection(db, 'users'), where('email', '==', targetEmail.trim().toLowerCase()), limit(1));
    const snap = await getDocs(q);
    if (snap.empty) {
      return { success: false, message: `Foydalanuvchi topilmadi: ${targetEmail}` };
    }
    const userDoc = snap.docs[0];
    const userData = userDoc.data();
    const currentCredits = userData.creditsRemaining || 0;
    const newCredits = currentCredits + creditsAmount;

    await updateDoc(doc(db, 'users', userDoc.id), {
      creditsRemaining: newCredits,
      tier,
      updatedAt: serverTimestamp(),
    });

    return {
      success: true,
      message: `${targetEmail} hisobiga +${creditsAmount} kredit qo'shildi! Jami balans: ${newCredits}`,
    };
  } catch (err: any) {
    return { success: false, message: err.message || 'Xatolik yuz berdi' };
  }
}

