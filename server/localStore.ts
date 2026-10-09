import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');
const STORAGE_FILE = path.join(DATA_DIR, 'app_storage.json');

export interface StoredUser {
  uid: string;
  email: string;
  displayName: string;
  creditsRemaining: number;
  tier: string;
  role: string;
  createdAt?: string;
  updatedAt?: string;
  photoURL?: string;
}

export interface StoredPaymentRequest {
  id: string;
  uid: string;
  userId: string;
  userEmail: string;
  planId: string;
  planName: string;
  price: string;
  credits: number;
  tier: string;
  paymentMethod: string;
  receiptInfo: string;
  notes: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  updatedAt?: string;
  approvedAt?: string;
  approvedBy?: string;
}

export interface StoredPendingGrant {
  email: string;
  credits: number;
  tier?: string;
  grantedBy?: string;
  updatedAt?: string;
}

export interface StoredProcessedSession {
  sessionId: string;
  userId: string;
  userEmail: string;
  credits: number;
  processedAt: string;
}

interface StorageData {
  users: Record<string, StoredUser>;
  paymentRequests: Record<string, StoredPaymentRequest>;
  pendingCreditGrants: Record<string, StoredPendingGrant>;
  generations: Record<string, any[]>;
  processedSessions: Record<string, StoredProcessedSession>;
}

class LocalStore {
  private data: StorageData = {
    users: {},
    paymentRequests: {},
    pendingCreditGrants: {},
    generations: {},
    processedSessions: {},
  };

  constructor() {
    this.init();
  }

  private init() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      if (fs.existsSync(STORAGE_FILE)) {
        const raw = fs.readFileSync(STORAGE_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        this.data = {
          users: parsed.users || {},
          paymentRequests: parsed.paymentRequests || {},
          pendingCreditGrants: parsed.pendingCreditGrants || {},
          generations: parsed.generations || {},
          processedSessions: parsed.processedSessions || {},
        };
      } else {
        this.save();
      }

      // Ensure admin user exists with unlimited quota
      const adminEmail = 'demircilyda@gmail.com';
      let adminExists = false;
      for (const u of Object.values(this.data.users)) {
        if (u.email && u.email.trim().toLowerCase() === adminEmail) {
          adminExists = true;
          u.creditsRemaining = 999999;
          u.role = 'admin';
          u.tier = 'unlimited';
          break;
        }
      }
      if (!adminExists) {
        this.data.users['admin-demircilyda'] = {
          uid: 'admin-demircilyda',
          email: adminEmail,
          displayName: 'Demircilyda (Admin)',
          creditsRemaining: 999999,
          tier: 'unlimited',
          role: 'admin',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        this.save();
      }
    } catch (e) {
      console.warn('LocalStore init warning:', e);
    }
  }

  private save() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(STORAGE_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.warn('LocalStore save warning:', err);
    }
  }

  // --- Users ---
  public getUser(uid: string): StoredUser | null {
    return this.data.users[uid] || null;
  }

  public getUserByEmail(email: string): StoredUser | null {
    if (!email) return null;
    const clean = email.trim().toLowerCase();
    for (const u of Object.values(this.data.users)) {
      if (u.email && u.email.trim().toLowerCase() === clean) {
        return u;
      }
    }
    return null;
  }

  public saveUser(user: Partial<StoredUser> & { uid: string }): StoredUser {
    const existing = this.data.users[user.uid] || {};
    const updated: StoredUser = {
      uid: user.uid,
      email: (user.email ?? existing.email ?? '').trim().toLowerCase(),
      displayName: user.displayName ?? existing.displayName ?? 'Foydalanuvchi',
      creditsRemaining: typeof user.creditsRemaining === 'number' ? user.creditsRemaining : (existing.creditsRemaining ?? 5),
      tier: user.tier ?? existing.tier ?? 'free',
      role: user.role ?? existing.role ?? 'user',
      createdAt: user.createdAt ?? existing.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      photoURL: user.photoURL ?? existing.photoURL,
    };
    this.data.users[user.uid] = updated;
    this.save();
    return updated;
  }

  public getAllUsers(): StoredUser[] {
    return Object.values(this.data.users);
  }

  // --- Payment Requests ---
  public createPaymentRequest(req: StoredPaymentRequest): void {
    this.data.paymentRequests[req.id] = req;
    this.save();
  }

  public getPaymentRequests(statusFilter?: string): StoredPaymentRequest[] {
    const all = Object.values(this.data.paymentRequests).sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );
    if (!statusFilter || statusFilter === 'all') return all;
    return all.filter((r) => r.status === statusFilter);
  }

  public getPaymentRequest(id: string): StoredPaymentRequest | null {
    return this.data.paymentRequests[id] || null;
  }

  public updatePaymentRequest(id: string, updates: Partial<StoredPaymentRequest>): StoredPaymentRequest | null {
    const req = this.data.paymentRequests[id];
    if (!req) return null;
    const updated: StoredPaymentRequest = {
      ...req,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this.data.paymentRequests[id] = updated;
    this.save();
    return updated;
  }

  // --- Pending Credit Grants ---
  public getPendingGrant(email: string): StoredPendingGrant | null {
    const clean = (email || '').trim().toLowerCase();
    return this.data.pendingCreditGrants[clean] || null;
  }

  public setPendingGrant(email: string, grant: StoredPendingGrant): void {
    const clean = (email || '').trim().toLowerCase();
    this.data.pendingCreditGrants[clean] = {
      ...grant,
      email: clean,
      updatedAt: new Date().toISOString(),
    };
    this.save();
  }

  public deletePendingGrant(email: string): void {
    const clean = (email || '').trim().toLowerCase();
    delete this.data.pendingCreditGrants[clean];
    this.save();
  }

  // --- Generations ---
  public logGeneration(uid: string, record: any): void {
    if (!this.data.generations[uid]) {
      this.data.generations[uid] = [];
    }
    this.data.generations[uid].unshift(record);
    if (this.data.generations[uid].length > 50) {
      this.data.generations[uid] = this.data.generations[uid].slice(0, 50);
    }
    this.save();
  }

  // --- Processed Sessions (Stripe Idempotency) ---
  public isSessionProcessed(sessionId: string): boolean {
    if (!sessionId) return false;
    return Boolean(this.data.processedSessions?.[sessionId]);
  }

  public markSessionProcessed(
    sessionId: string,
    record: { userId: string; userEmail: string; credits: number }
  ): void {
    if (!sessionId) return;
    if (!this.data.processedSessions) {
      this.data.processedSessions = {};
    }
    this.data.processedSessions[sessionId] = {
      sessionId,
      userId: record.userId || '',
      userEmail: (record.userEmail || '').trim().toLowerCase(),
      credits: record.credits || 0,
      processedAt: new Date().toISOString(),
    };
    this.save();
  }

  // --- Atomic Credits Management ---
  public deductCredits(
    uid: string,
    cost: number
  ): { success: boolean; remaining: number } {
    const user = this.getUser(uid);
    if (!user) {
      return { success: false, remaining: 0 };
    }
    if (user.role === 'admin' || (user.email && user.email.toLowerCase() === 'demircilyda@gmail.com')) {
      return { success: true, remaining: 999999 };
    }
    if (user.creditsRemaining < cost) {
      return { success: false, remaining: user.creditsRemaining };
    }
    user.creditsRemaining = Math.max(0, user.creditsRemaining - cost);
    user.updatedAt = new Date().toISOString();
    this.save();
    return { success: true, remaining: user.creditsRemaining };
  }

  public addCredits(
    uid: string,
    amount: number,
    tier?: string
  ): { success: boolean; remaining: number } {
    let user = this.getUser(uid);
    if (!user) {
      user = this.saveUser({ uid, creditsRemaining: amount, tier: tier || 'pro' });
      return { success: true, remaining: user.creditsRemaining };
    }
    user.creditsRemaining = (user.creditsRemaining || 0) + amount;
    if (tier) {
      user.tier = tier;
    }
    user.updatedAt = new Date().toISOString();
    this.save();
    return { success: true, remaining: user.creditsRemaining };
  }
}

export const localStore = new LocalStore();
