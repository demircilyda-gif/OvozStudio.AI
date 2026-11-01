import React, { useState, useEffect } from 'react';
import { Key, CheckCircle2, AlertTriangle, ShieldCheck, RefreshCw, X, Eye, EyeOff, ExternalLink } from 'lucide-react';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang: 'uz' | 'ru';
  onKeyUpdated?: () => void;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({
  isOpen,
  onClose,
  lang,
  onKeyUpdated,
}) => {
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [keyStatus, setKeyStatus] = useState<{
    configured: boolean;
    valid: boolean;
    isExpired?: boolean;
    keyPrefix?: string;
    message?: string;
  } | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const checkStatus = async () => {
    setIsChecking(true);
    try {
      const res = await fetch('/api/gemini/status');
      if (res.ok) {
        const data = await res.json();
        setKeyStatus(data);
      }
    } catch {
      // ignore
    } finally {
      setIsChecking(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      checkStatus();
      setFeedback(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKeyInput.trim()) return;

    setIsLoading(true);
    setFeedback(null);

    try {
      const res = await fetch('/api/gemini/update-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKeyInput.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || (lang === 'uz' ? "Kalitni saqlashda xatolik" : "Ошибка сохранения ключа"));
      }

      setFeedback({
        type: 'success',
        message: lang === 'uz'
          ? "Gemini API kaliti muvaffaqiyatli saqlandi va faollashtirildi!"
          : "Ключ Gemini API успешно сохранён и активирован!",
      });
      setApiKeyInput('');
      await checkStatus();

      // Notify parent and window listeners
      if (onKeyUpdated) onKeyUpdated();
      window.dispatchEvent(new CustomEvent('gemini-key-updated'));

      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || (lang === 'uz' ? "Kalit noto'g'ri yoki tekshirishdan o'tmadi" : "Неверный ключ или ошибка проверки"),
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-lg bg-[#F7F4EC] border border-[rgba(22,21,17,0.18)] rounded-2xl shadow-2xl p-6 sm:p-7 text-[#161511] overflow-hidden">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-[#5D594E] hover:text-[#161511] rounded-lg hover:bg-black/5 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-[#0E7C86]/10 flex items-center justify-center text-[#0E7C86] shrink-0">
            <Key className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-[#161511] tracking-tight">
              {lang === 'uz' ? "Gemini API Kalitini Sozlash" : "Настройка Gemini API Ключа"}
            </h3>
            <p className="text-xs text-[#5D594E]">
              {lang === 'uz'
                ? "AI qo'ng'iroq, ovozli sintez va dialoglar uchun rasmiy Google kaliti"
                : "Официальный ключ Google для AI-звонков, синтеза и диалогов"}
            </p>
          </div>
        </div>

        {/* Current Key Status Badge */}
        <div className="mb-5 p-3.5 rounded-xl border bg-white/70 shadow-xs flex items-center justify-between gap-3 border-[rgba(22,21,17,0.12)]">
          <div className="flex items-center gap-2.5">
            {isChecking ? (
              <RefreshCw className="w-4 h-4 animate-spin text-[#0E7C86]" />
            ) : keyStatus?.valid ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : keyStatus?.isExpired ? (
              <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
            ) : (
              <Key className="w-4 h-4 text-amber-500 shrink-0" />
            )}

            <div className="text-xs">
              <span className="font-semibold block text-[#161511]">
                {keyStatus?.valid
                  ? (lang === 'uz' ? "Faol (Ishlamoqda)" : "Активен (Работает)")
                  : keyStatus?.isExpired
                  ? (lang === 'uz' ? "Muddati tugagan (Expired)" : "Срок действия истёк")
                  : (lang === 'uz' ? "Tekshirilmagan / O'rnatilmagan" : "Не настроен")}
              </span>
              <span className="text-[#5D594E] font-mono text-[11px]">
                {keyStatus?.keyPrefix ? `Prefiks: ${keyStatus.keyPrefix}` : "Kalit topilmadi"}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={checkStatus}
            disabled={isChecking}
            className="text-xs px-2.5 py-1 rounded-lg border border-[rgba(22,21,17,0.15)] text-[#5D594E] hover:text-[#161511] hover:bg-black/5 flex items-center gap-1 transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3 h-3 ${isChecking ? 'animate-spin' : ''}`} />
            <span>{lang === 'uz' ? "Tekshirish" : "Проверить"}</span>
          </button>
        </div>

        {/* Notice for Expired Key */}
        {keyStatus?.isExpired && (
          <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
            <div>
              <b className="font-semibold block">
                {lang === 'uz' ? "Oldingi API kalit muddati tugagan" : "Срок текущего API-ключа истёк"}
              </b>
              <p className="mt-0.5 text-rose-700">
                {lang === 'uz'
                  ? "Google Generative Language API avvalgi vaqtinchalik kalitni to'xtatgan. Quyida yangi kalitingizni kiriting."
                  : "Старый ключ Google API больше не действителен. Введите новый ключ ниже для возобновления звонков и генерации."}
              </p>
            </div>
          </div>
        )}

        {/* Input Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#161511] mb-1.5">
              {lang === 'uz' ? "Yangi Gemini API kaliti (Google AI Studio Key):" : "Новый Gemini API ключ:"}
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full px-3.5 py-2.5 pr-10 text-sm font-mono bg-white border border-[rgba(22,21,17,0.18)] rounded-xl text-[#161511] placeholder:text-stone-400 focus:outline-none focus:border-[#0E7C86] focus:ring-2 focus:ring-[#0E7C86]/20 transition-all shadow-inner"
                autoComplete="off"
                spellCheck="false"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#5D594E] hover:text-[#161511] cursor-pointer p-0.5"
                title={showKey ? "Hide" : "Show"}
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Feedback messages */}
          {feedback && (
            <div
              className={`p-3 rounded-xl text-xs flex items-start gap-2 ${
                feedback.type === 'success'
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border border-rose-200 text-rose-800'
              }`}
            >
              {feedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
              )}
              <span className="font-medium">{feedback.message}</span>
            </div>
          )}

          {/* Submit button */}
          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-xs font-semibold text-[#5D594E] hover:text-[#161511] hover:bg-black/5 transition-colors cursor-pointer"
            >
              {lang === 'uz' ? "Bekor qilish" : "Отмена"}
            </button>
            <button
              type="submit"
              disabled={isLoading || !apiKeyInput.trim()}
              className="btn-pill btn-solid text-xs py-2.5 px-5 flex items-center gap-2 cursor-pointer shadow-md disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>{lang === 'uz' ? "Tekshirilmoqda..." : "Проверка..."}</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>{lang === 'uz' ? "Saqlash va faollashtirish" : "Сохранить и активировать"}</span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* Helpful links */}
        <div className="mt-5 pt-4 border-t border-[rgba(22,21,17,0.1)] text-[11.5px] text-[#5D594E] flex items-center justify-between">
          <span>
            {lang === 'uz' ? "Kalitingiz yo'qmi?" : "Нет ключа?"}
          </span>
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#0E7C86] font-medium hover:underline inline-flex items-center gap-1"
          >
            <span>Google AI Studio Get Key</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </div>
  );
};
