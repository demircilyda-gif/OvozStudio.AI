import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  signInWithGoogle,
  signInWithEmail,
  registerWithEmail,
  ADMIN_EMAIL,
} from '../firebase';
import {
  Lock,
  X,
  Mail,
  KeyRound,
  LogIn,
  UserPlus,
  ShieldCheck,
  AlertCircle,
  Sparkles,
} from 'lucide-react';

interface AuthModalProps {
  lang: 'uz' | 'ru';
}

export const AuthModal: React.FC<AuthModalProps> = ({ lang }) => {
  const {
    isAuthModalOpen,
    authModalReason,
    closeAuthModal,
  } = useAuth();

  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!isAuthModalOpen) return null;

  const handleGoogleSignIn = async () => {
    setErrorMsg(null);
    setLoading(true);
    try {
      await signInWithGoogle();
      closeAuthModal();
    } catch (err: any) {
      setErrorMsg(
        err.message ||
          (lang === 'uz' ? 'Google orqali kirishda xatolik yuz berdi' : 'Ошибка входа через Google')
      );
    } finally {
      setLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!email || !password) return;

    if (password.length < 6) {
      setErrorMsg(
        lang === 'uz'
          ? "Parol kamida 6 ta belgidan iborat bo'lishi shart"
          : 'Пароль должен содержать минимум 6 символов'
      );
      return;
    }

    setLoading(true);
    try {
      if (tab === 'login') {
        await signInWithEmail(email, password);
      } else {
        await registerWithEmail(email, password);
      }
      closeAuthModal();
    } catch (err: any) {
      let msg = err.message;
      if (
        err.code === 'auth/user-not-found' ||
        err.code === 'auth/wrong-password' ||
        err.code === 'auth/invalid-credential'
      ) {
        msg = lang === 'uz' ? "Email yoki parol noto'g'ri" : 'Неверный email или пароль';
      } else if (err.code === 'auth/email-already-in-use') {
        msg =
          lang === 'uz'
            ? "Ushbu email allaqachon ro'yxatdan o'tgan"
            : 'Этот email уже зарегистрирован';
      }
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] isolate flex items-center justify-center p-4 bg-[#161511]/75 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-[#F4F1EA] text-[#161511] border border-[rgba(22,21,17,0.14)] rounded-[24px] p-6 sm:p-8 shadow-[0_30px_60px_-20px_rgba(22,21,17,0.35)] overflow-hidden space-y-6">
        {/* Soft Ambient Glow (Teal) */}
        <div className="absolute top-0 right-0 w-48 h-48 bg-[#0E7C86]/10 blur-3xl pointer-events-none" />

        {/* Header */}
        <div className="flex items-start justify-between relative z-10">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#ECE7DB] text-[#0A5A62] text-[11px] font-mono uppercase tracking-wider">
              <Lock className="w-3 h-3 text-[#0E7C86]" />
              <span>{lang === 'uz' ? 'OvozStudio Xavfsiz Kirish' : 'Защита API & Авторизация'}</span>
            </div>
            <h3 className="font-serif text-2xl sm:text-3xl text-[#161511] tracking-tight pt-1">
              {tab === 'login'
                ? lang === 'uz'
                  ? 'Hisobingizga kiring'
                  : 'Вход в аккаунт'
                : lang === 'uz'
                ? "Ro'yxatdan o'tish"
                : 'Регистрация'}
            </h3>
          </div>

          <button
            onClick={closeAuthModal}
            className="p-2 rounded-full text-[#5D594E] hover:text-[#161511] hover:bg-black/5 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Reason Alert Banner */}
        <div className="relative z-10 bg-white/70 border border-[rgba(22,21,17,0.12)] rounded-2xl p-4 text-xs text-[#5D594E] space-y-2">
          <div className="flex items-start gap-2.5 text-[#161511]">
            <ShieldCheck className="w-4 h-4 text-[#0E7C86] shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              {authModalReason ||
                (lang === 'uz'
                  ? "Podkast yaratish va ovoz sintezi faqat ro'yxatdan o'tgan ijodkorlar uchun ochiq."
                  : 'Генерация доступна авторизованным пользователям для сохранения истории и доступа к голосам.')}
            </p>
          </div>
          <div className="pt-2 flex items-center justify-between text-[11px] font-mono text-[#7D7A70] border-t border-[rgba(22,21,17,0.08)]">
            <span className="flex items-center gap-1 text-[#0A5A62] font-semibold">
              <Sparkles className="w-3.5 h-3.5 text-[#0E7C86]" />
              {lang === 'uz' ? 'Yangi hisobga: 5 ta bepul kredit' : 'Новым пользователям: 5 бесплатных кредитов'}
            </span>
            <span className="text-[10px] text-[#7D7A70]">
              Admin: {ADMIN_EMAIL.split('@')[0]}
            </span>
          </div>
        </div>

        {/* Error Message */}
        {errorMsg && (
          <div className="relative z-10 bg-rose-50 border border-rose-200 rounded-xl p-3 text-xs text-rose-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* 1-Click Google Sign-In Button */}
        <div className="relative z-10 space-y-3">
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full py-3 px-4 bg-white hover:bg-[#ECE7DB]/60 border border-[rgba(22,21,17,0.14)] text-[#161511] font-medium rounded-full text-xs sm:text-sm flex items-center justify-center gap-3 shadow-xs transition-all cursor-pointer disabled:opacity-50"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            <span>
              {loading
                ? lang === 'uz'
                  ? 'Kirilmoqda...'
                  : 'Вход...'
                : lang === 'uz'
                ? 'Google orqali 1 marta bosishda kirish'
                : 'Войти через Google в 1 клик'}
            </span>
          </button>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-[rgba(22,21,17,0.14)]" />
            <span className="font-mono text-[10px] uppercase tracking-wider text-[#7D7A70]">
              {lang === 'uz' ? 'Yoki email orqali' : 'Или через email'}
            </span>
            <div className="h-px flex-1 bg-[rgba(22,21,17,0.14)]" />
          </div>
        </div>

        {/* Tab Switcher: Login vs Register */}
        <div className="relative z-10 flex bg-[#ECE7DB] p-1 rounded-full text-xs">
          <button
            type="button"
            onClick={() => {
              setTab('login');
              setErrorMsg(null);
            }}
            className={`flex-1 py-1.5 rounded-full font-medium transition-all cursor-pointer ${
              tab === 'login' ? 'bg-[#161511] text-[#F4F1EA] shadow-xs' : 'text-[#5D594E] hover:text-[#161511]'
            }`}
          >
            {lang === 'uz' ? 'Kirish' : 'Вход'}
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('register');
              setErrorMsg(null);
            }}
            className={`flex-1 py-1.5 rounded-full font-medium transition-all cursor-pointer ${
              tab === 'register' ? 'bg-[#161511] text-[#F4F1EA] shadow-xs' : 'text-[#5D594E] hover:text-[#161511]'
            }`}
          >
            {lang === 'uz' ? "Ro'yxatdan o'tish" : 'Регистрация'}
          </button>
        </div>

        {/* Email & Password Form */}
        <form onSubmit={handleEmailAuth} className="relative z-10 space-y-3.5">
          <div>
            <label className="font-mono text-[11px] uppercase tracking-wider text-[#5D594E] block mb-1.5 flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5 text-[#0E7C86]" />
              <span>Email:</span>
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ismingiz@example.com"
              required
              className="w-full bg-white border border-[rgba(22,21,17,0.14)] rounded-full px-4 py-2.5 text-xs text-[#161511] placeholder-[#7D7A70] focus:outline-none focus:border-[#0E7C86] transition-colors"
            />
          </div>

          <div>
            <label className="font-mono text-[11px] uppercase tracking-wider text-[#5D594E] block mb-1.5 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-[#0E7C86]" />
              <span>{lang === 'uz' ? 'Parol (kamida 6 belgi):' : 'Пароль (мин. 6 символов):'}</span>
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="w-full bg-white border border-[rgba(22,21,17,0.14)] rounded-full px-4 py-2.5 text-xs text-[#161511] placeholder-[#7D7A70] focus:outline-none focus:border-[#0E7C86] transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-[#161511] hover:bg-[#0A5A62] text-[#F4F1EA] font-medium rounded-full text-xs sm:text-sm flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer disabled:opacity-50 mt-1"
          >
            {tab === 'login' ? <LogIn className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
            <span>
              {loading
                ? lang === 'uz'
                  ? 'Bajarilmoqda...'
                  : 'Выполняется...'
                : tab === 'login'
                ? lang === 'uz'
                  ? 'Tizimga Kirish'
                  : 'Войти в систему'
                : lang === 'uz'
                ? "Ro'yxatdan O'tish & 5 Kredit Olish"
                : 'Зарегистрироваться & Получить 5 кредитов'}
            </span>
          </button>
        </form>

        {/* Footer Note */}
        <p className="font-mono text-[10px] uppercase tracking-wider text-[#7D7A70] text-center relative z-10 leading-normal">
          {lang === 'uz'
            ? "Ro'yxatdan o'tish orqali siz xavfsiz va qonuniy foydalanish shartlariga rozilik bildirasiz."
            : 'Авторизуясь, вы получаете персональный доступ к ресурсам генерации.'}
        </p>
      </div>
    </div>
  );
};
