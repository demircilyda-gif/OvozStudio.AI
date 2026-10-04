import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import {
  auth,
  AppUserProfile,
  getOrCreateUserProfile,
  consumeUserCredit,
  addCreditsToUser,
  logUserGeneration,
  isUserAdmin,
  logoutUser,
  ADMIN_EMAIL,
} from '../firebase';

interface AuthContextType {
  user: User | null;
  userProfile: AppUserProfile | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isLoading: boolean;
  credits: number;
  isAuthModalOpen: boolean;
  authModalReason: string;
  openAuthModal: (reason?: string) => void;
  closeAuthModal: () => void;
  isPricingModalOpen: boolean;
  openPricingModal: () => void;
  closePricingModal: () => void;
  requireAuth: (action: () => void, reason?: string) => boolean;
  useCredit: (cost?: number) => Promise<boolean>;
  addCredits: (amount: number, newTier?: 'free' | 'pro' | 'unlimited') => Promise<void>;
  logGeneration: (
    type: 'podcast' | 'voiceover' | 'tts' | 'dubbing' | 'agent_call',
    title: string,
    cost?: number
  ) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<AppUserProfile | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [authModalReason, setAuthModalReason] = useState<string>('');
  const [isPricingModalOpen, setIsPricingModalOpen] = useState<boolean>(false);

  const isAdmin = !!(user && (isUserAdmin(user.email) || userProfile?.role === 'admin'));
  const isAuthenticated = !!user;
  const credits = isAdmin ? 999999 : userProfile?.creditsRemaining ?? 0;

  const refreshProfile = async () => {
    if (auth.currentUser) {
      const profile = await getOrCreateUserProfile(auth.currentUser);
      setUserProfile(profile);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        try {
          const profile = await getOrCreateUserProfile(currentUser);
          setUserProfile(profile);
        } catch (e) {
          console.error('Error loading profile:', e);
        }
      } else {
        setUserProfile(null);
      }
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const openAuthModal = (reason?: string) => {
    setAuthModalReason(
      reason ||
        "Ushbu funksiyadan foydalanish uchun ro'yxatdan o'tishingiz yoki tizimga kirishingiz lozim. Bu API limitlarini himoya qilish uchun zarur."
    );
    setIsAuthModalOpen(true);
  };

  const closeAuthModal = () => {
    setIsAuthModalOpen(false);
    setAuthModalReason('');
  };

  const openPricingModal = () => {
    setIsPricingModalOpen(true);
  };

  const closePricingModal = () => {
    setIsPricingModalOpen(false);
  };

  // Require Auth guard for any creation trigger
  const requireAuth = (action: () => void, reason?: string): boolean => {
    if (!user) {
      openAuthModal(
        reason ||
          "Generatsiya qilish va ovoz yaratish faqat ro'yxatdan o'tgan foydalanuvchilar uchun ochiq. Begonalar API ni behuda sarflamasligi uchun avval hisobingizga kiring!"
      );
      return false;
    }

    if (!isAdmin && credits <= 0) {
      openPricingModal();
      return false;
    }

    action();
    return true;
  };

  const useCredit = async (cost: number = 1): Promise<boolean> => {
    if (!user) return false;
    if (isAdmin) return true; // Admin has infinite access

    if (credits < cost) {
      openPricingModal();
      return false;
    }

    const remaining = await consumeUserCredit(user.uid, user.email || '', credits, cost);
    setUserProfile((prev) => (prev ? { ...prev, creditsRemaining: remaining } : null));
    return true;
  };

  const addCredits = async (amount: number, newTier?: 'free' | 'pro' | 'unlimited') => {
    if (!user) return;
    const remaining = await addCreditsToUser(user.uid, user.email || '', credits, amount, newTier);
    setUserProfile((prev) => (prev ? { ...prev, creditsRemaining: remaining, tier: newTier || prev.tier } : null));
  };

  const logGeneration = async (
    type: 'podcast' | 'voiceover' | 'tts' | 'dubbing' | 'agent_call',
    title: string,
    cost: number = 1
  ) => {
    if (!user) return;
    await logUserGeneration(user.uid, user.email || '', type, title, cost, 'completed');
  };

  const logout = async () => {
    await logoutUser();
    setUser(null);
    setUserProfile(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        userProfile,
        isAuthenticated,
        isAdmin,
        isLoading,
        credits,
        isAuthModalOpen,
        authModalReason,
        openAuthModal,
        closeAuthModal,
        isPricingModalOpen,
        openPricingModal,
        closePricingModal,
        requireAuth,
        useCredit,
        addCredits,
        logGeneration,
        logout,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
