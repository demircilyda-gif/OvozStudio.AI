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
import { authFetch } from './utils/authFetch';

// Initialize Firebase
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId as string);
export const googleProvider = new GoogleAuthProvider();

// System Owner & Admin Email list from environment or default
export const ADMIN_EMAILS: string[] = (
  (import.meta.env.VITE_ADMIN_EMAILS as string) ||
  'demircilyda@gmail.com'
)
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export const ADMIN_EMAIL = ADMIN_EMAILS[0] || 'demircilyda@gmail.com';

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

// Check if user is admin strictly by verified email (never from document role)
export function isUserAdmin(email?: string | null): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.trim().toLowerCase());
}

// Get or initialize user profile (saves to Firestore directly and syncs to server)
export async function getOrCreateUserProfile(user: User): Promise<AppUserProfile> {
  const userRef = doc(db, 'users', user.uid);
  const isAdmin = isUserAdmin(user.email);

  try {
    const snap = await getDoc(userRef);
    let profile: AppUserProfile;

    if (snap.exists()) {
      const data = snap.data() as AppUserProfile;
      profile = {
        ...data,
        email: user.email || data.email || '',
        displayName: user.displayName || data.displayName || user.email?.split('@')[0] || 'Foydalanuvchi',
        photoURL: user.photoURL || data.photoURL || '',
        role: isAdmin ? 'admin' : (data.role || 'user'),
        tier: isAdmin ? 'unlimited' : (data.tier || 'free'),
        creditsRemaining: isAdmin ? 999999 : (typeof data.creditsRemaining === 'number' ? data.creditsRemaining : 5),
        updatedAt: new Date().toISOString(),
      };
      // Keep doc updated in Firestore
      await setDoc(userRef, profile, { merge: true }).catch(() => {});
    } else {
      // Create new profile directly in Firestore
      profile = {
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
      try {
        await setDoc(userRef, profile, { merge: true });
      } catch (fErr) {
        console.warn('Direct Firestore write notice:', fErr);
      }
    }

    // Always sync with server so localStore also has this user
    try {
      const idToken = await user.getIdToken();
      await fetch('/api/user/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify(profile),
      });
    } catch {
      // Server sync optional fallback
    }

    return profile;
  } catch (err) {
    console.warn('Error fetching or creating user profile:', err);
    const fallbackProfile: AppUserProfile = {
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
    try {
      const idToken = await user.getIdToken();
      fetch('/api/user/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify(fallbackProfile),
      }).catch(() => {});
    } catch {}
    return fallbackProfile;
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

// Deduct credit upon creation (bypassed for Admin)
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
    const res = await authFetch('/api/user/consume-credit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cost }),
    });
    if (res.ok) {
      const data = await res.json();
      return typeof data.remaining === 'number' ? data.remaining : newCredits;
    }
  } catch (e) {
    console.warn('Server credit deduction notice:', e);
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
    const res = await authFetch('/api/billing/admin/grant-credits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetEmail: userEmail,
        creditsAmount: amount,
        tier: newTier || 'pro',
      }),
    });
    if (res.ok) {
      const data = await res.json();
      return typeof data.newCredits === 'number' ? data.newCredits : newCredits;
    }
  } catch (e) {
    console.warn('Server credit grant notice:', e);
  }
  return newCredits;
}

// Log generation into Firestore via server endpoint (Admin SDK)
export async function logUserGeneration(
  uid: string,
  userEmail: string,
  type: 'podcast' | 'voiceover' | 'tts' | 'dubbing' | 'agent_call',
  title: string,
  creditsCost: number = 1,
  status: 'completed' | 'failed' = 'completed'
): Promise<void> {
  try {
    await authFetch('/api/user/log-generation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        title: title.slice(0, 150),
        creditsCost,
        status,
      }),
    });
  } catch (e) {
    console.warn('Could not log generation record via server:', e);
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
  uid?: string;
  userEmail: string;
  userName?: string;
  planId: 'starter' | 'pro' | 'unlimited';
  planName: string;
  price: string;
  credits: number;
  tier?: string;
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
  const res = await authFetch('/api/billing/payment-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      planId: data.planId,
      paymentMethod: data.paymentMethod,
      receiptInfo: data.receiptInfo,
      notes: data.notes,
    }),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'To\'lov so\'rovini yuborishda xatolik');
  }
  const result = await res.json();
  return result.requestId;
}

export async function adminFetchAllUsers(): Promise<AppUserProfile[]> {
  const usersMap = new Map<string, AppUserProfile>();

  // 1. Fetch directly from Firestore (Admin permissions allow reading all /users)
  try {
    const snap = await getDocs(collection(db, 'users'));
    snap.forEach((docSnap) => {
      const d = docSnap.data() as Partial<AppUserProfile>;
      const cleanEmail = (d.email || '').trim().toLowerCase();
      const isAdm = isUserAdmin(cleanEmail);
      usersMap.set(docSnap.id, {
        uid: docSnap.id,
        email: cleanEmail || d.email || '',
        displayName: d.displayName || (cleanEmail ? cleanEmail.split('@')[0] : 'Foydalanuvchi'),
        photoURL: d.photoURL || '',
        role: isAdm ? 'admin' : (d.role || 'user'),
        tier: isAdm ? 'unlimited' : (d.tier || 'free'),
        creditsRemaining: isAdm ? 999999 : (typeof d.creditsRemaining === 'number' ? d.creditsRemaining : 5),
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      });
    });
  } catch (err) {
    console.warn('Firestore direct users fetch notice:', err);
  }

  // 2. Fetch from Server endpoint and merge
  try {
    const res = await authFetch('/api/billing/admin/users');
    if (res.ok) {
      const data = await res.json();
      for (const u of (data.users || [])) {
        const cleanEmail = (u.email || '').trim().toLowerCase();
        const key = u.uid || cleanEmail;
        if (key && !usersMap.has(key)) {
          usersMap.set(key, {
            uid: u.uid || key,
            email: cleanEmail,
            displayName: u.displayName || (cleanEmail ? cleanEmail.split('@')[0] : 'Foydalanuvchi'),
            photoURL: u.photoURL || '',
            role: isUserAdmin(cleanEmail) ? 'admin' : (u.role || 'user'),
            tier: isUserAdmin(cleanEmail) ? 'unlimited' : (u.tier || 'free'),
            creditsRemaining: isUserAdmin(cleanEmail) ? 999999 : (typeof u.creditsRemaining === 'number' ? u.creditsRemaining : 5),
            createdAt: u.createdAt,
            updatedAt: u.updatedAt,
          });
        }
      }
    }
  } catch (err) {
    console.warn('Server users fetch notice:', err);
  }

  const result = Array.from(usersMap.values()).sort(
    (a, b) => (b.creditsRemaining || 0) - (a.creditsRemaining || 0)
  );

  // 3. Keep backend localStore in sync with all discovered users
  if (result.length > 0) {
    authFetch('/api/billing/admin/sync-users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ users: result }),
    }).catch(() => {});
  }

  return result;
}

export async function adminFetchPaymentRequests(status: string = 'pending'): Promise<PaymentRequest[]> {
  const reqMap = new Map<string, PaymentRequest>();

  // 1. Fetch from Firestore directly
  try {
    let q;
    if (status && status !== 'all') {
      q = query(collection(db, 'paymentRequests'), where('status', '==', status));
    } else {
      q = collection(db, 'paymentRequests');
    }
    const snap = await getDocs(q);
    snap.forEach((docSnap) => {
      reqMap.set(docSnap.id, { id: docSnap.id, ...(docSnap.data() as any) });
    });
  } catch (err) {
    console.warn('Firestore payment requests fetch notice:', err);
  }

  // 2. Fetch from server endpoint and merge
  try {
    const res = await authFetch(`/api/billing/admin/payment-requests?status=${status}`);
    if (res.ok) {
      const data = await res.json();
      for (const r of (data.requests || [])) {
        if (!reqMap.has(r.id)) {
          reqMap.set(r.id, r);
        }
      }
    }
  } catch (err) {
    console.warn('Server payment requests fetch notice:', err);
  }

  return Array.from(reqMap.values()).sort(
    (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  );
}

export async function getPendingPaymentRequests(): Promise<PaymentRequest[]> {
  return adminFetchPaymentRequests('pending');
}

export async function approvePaymentRequest(
  request: PaymentRequest,
  _adminEmail?: string
): Promise<void> {
  const approver = _adminEmail || auth.currentUser?.email || 'admin';

  // 1. Update in Firestore directly
  try {
    const reqRef = doc(db, 'paymentRequests', request.id);
    await updateDoc(reqRef, {
      status: 'approved',
      approvedAt: new Date().toISOString(),
      approvedBy: approver,
      updatedAt: new Date().toISOString(),
    });

    const targetUid = request.userId || request.uid;
    if (targetUid) {
      const userRef = doc(db, 'users', targetUid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        const curCredits = userSnap.data()?.creditsRemaining || 0;
        await updateDoc(userRef, {
          creditsRemaining: curCredits + request.credits,
          tier: request.tier || 'pro',
          updatedAt: new Date().toISOString(),
        });
      }
    }
  } catch (fErr) {
    console.warn('Direct Firestore approve notice:', fErr);
  }

  // 2. Also notify server
  try {
    const res = await authFetch('/api/billing/admin/approve-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: request.id }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      console.warn('Server approve notification notice:', errData.error);
    }
  } catch (sErr) {
    console.warn('Server approve request notice:', sErr);
  }
}

export async function rejectPaymentRequest(
  requestId: string,
  reason: string
): Promise<void> {
  // 1. Direct in Firestore
  try {
    const reqRef = doc(db, 'paymentRequests', requestId);
    await updateDoc(reqRef, {
      status: 'rejected',
      notes: reason,
      updatedAt: new Date().toISOString(),
    });
  } catch (fErr) {
    console.warn('Direct Firestore reject notice:', fErr);
  }

  // 2. Server notification
  try {
    await authFetch('/api/billing/admin/reject-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, reason }),
    });
  } catch (sErr) {
    console.warn('Server reject notice:', sErr);
  }
}

export async function adminManualGrantCredits(
  targetEmail: string,
  creditsAmount: number,
  tier: 'free' | 'pro' | 'unlimited' = 'pro'
): Promise<{ success: boolean; message: string }> {
  const cleanEmail = targetEmail.trim().toLowerCase();

  // 1. Direct in Firestore if user exists
  let directUpdated = false;
  try {
    const q = query(collection(db, 'users'), where('email', '==', cleanEmail));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const userDoc = snap.docs[0];
      const cur = userDoc.data()?.creditsRemaining || 0;
      await updateDoc(userDoc.ref, {
        creditsRemaining: cur + creditsAmount,
        tier: tier || 'pro',
        updatedAt: new Date().toISOString(),
      });
      directUpdated = true;
    } else {
      // Store pending grant in Firestore
      await setDoc(doc(db, 'pendingCreditGrants', cleanEmail), {
        email: cleanEmail,
        credits: creditsAmount,
        tier,
        grantedBy: auth.currentUser?.email || 'admin',
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    }
  } catch (fErr) {
    console.warn('Direct Firestore grant notice:', fErr);
  }

  // 2. Call server endpoint
  try {
    const res = await authFetch('/api/billing/admin/grant-credits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetEmail: cleanEmail,
        creditsAmount,
        tier,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok || directUpdated) {
      return {
        success: true,
        message: data.message || `${cleanEmail} hisobiga +${creditsAmount} kredit qo'shildi!`,
      };
    }
    return { success: false, message: data.error || 'Xatolik yuz berdi' };
  } catch (err: any) {
    if (directUpdated) {
      return {
        success: true,
        message: `${cleanEmail} hisobiga +${creditsAmount} kredit qo'shildi!`,
      };
    }
    return { success: false, message: err.message || 'Xatolik yuz berdi' };
  }
}

