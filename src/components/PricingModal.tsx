import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  Zap,
  Check,
  X,
  CreditCard,
  Sparkles,
  ShieldCheck,
  User,
  ArrowRight,
  Copy,
  ExternalLink,
  MessageSquare,
  Clock,
  Send,
  Lock,
  AlertCircle,
  HelpCircle,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import {
  createPaymentRequest,
  getPendingPaymentRequests,
  approvePaymentRequest,
  rejectPaymentRequest,
  adminManualGrantCredits,
  PaymentRequest,
} from '../firebase';

interface PricingModalProps {
  lang: 'uz' | 'ru';
}

export const PricingModal: React.FC<PricingModalProps> = ({ lang }) => {
  const {
    isPricingModalOpen,
    closePricingModal,
    credits,
    isAdmin,
    user,
    openAuthModal,
    refreshProfile,
  } = useAuth();

  // Active Mode: 'plans' or 'admin'
  const [activeTab, setActiveTab] = useState<'plans' | 'admin'>('plans');

  // Selected Plan & Method
  const [selectedPlan, setSelectedPlan] = useState<'starter' | 'pro' | 'unlimited'>('pro');
  const [selectedPayment, setSelectedPayment] = useState<'stripe' | 'uzum' | 'payme' | 'click' | 'card'>('stripe');

  // Gateway status from server
  const [gatewayConfig, setGatewayConfig] = useState<{
    stripeConfigured: boolean;
    telegramHandle: string;
    phoneNumber: string;
    cardDetails: { cardNumber: string; cardHolder: string; bank: string };
  }>({
    stripeConfigured: false,
    telegramHandle: 'ovozstudio_admin',
    phoneNumber: '+998 90 123 45 67',
    cardDetails: {
      cardNumber: '9860 3501 4500 1755',
      cardHolder: 'HUMO',
      bank: 'Humo',
    },
  });

  // State
  const [copiedCard, setCopiedCard] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [stripeNoticeModal, setStripeNoticeModal] = useState<boolean>(false);

  // Manual payment submission form
  const [transferDetails, setTransferDetails] = useState('');
  const [requestSubmitted, setRequestSubmitted] = useState(false);

  // Admin Panel states
  const [pendingRequests, setPendingRequests] = useState<PaymentRequest[]>([]);
  const [isLoadingRequests, setIsLoadingRequests] = useState(false);
  const [adminTargetEmail, setAdminTargetEmail] = useState('');
  const [adminTargetCredits, setAdminTargetCredits] = useState<number>(100);
  const [adminTargetTier, setAdminTargetTier] = useState<'free' | 'pro' | 'unlimited'>('pro');
  const [adminActionMsg, setAdminActionMsg] = useState<string | null>(null);

  // Fetch gateway configuration on open
  useEffect(() => {
    if (isPricingModalOpen) {
      fetch('/api/billing/config')
        .then((res) => res.json())
        .then((data) => {
          if (data) setGatewayConfig(data);
        })
        .catch(() => {});
    }
  }, [isPricingModalOpen]);

  // Load pending requests if Admin
  useEffect(() => {
    if (isPricingModalOpen && isAdmin && activeTab === 'admin') {
      loadPendingRequests();
    }
  }, [isPricingModalOpen, isAdmin, activeTab]);

  const loadPendingRequests = async () => {
    setIsLoadingRequests(true);
    try {
      const requests = await getPendingPaymentRequests();
      setPendingRequests(requests);
    } catch (e) {
      console.warn(e);
    } finally {
      setIsLoadingRequests(false);
    }
  };

  if (!isPricingModalOpen) return null;

  const plans = [
    {
      id: 'starter' as const,
      nameUz: 'Start Paketi',
      nameRu: 'Стартовый',
      badgeUz: 'Yangi boshlovchilar',
      badgeRu: 'Для новичков',
      priceUz: "49,000 so'm",
      priceRu: '49 000 сум',
      usdPrice: '$4',
      credits: 25,
      featuresUz: [
        '25 ta to\'liq podkast yaratish',
        "O'zbek tilidagi barcha 18 ta ovoz",
        'MP3 va WAV 320kbps formatda yuklab olish',
        "Avtomatik skobka va remarkalarni tozalash",
      ],
      featuresRu: [
        '25 генераций подкастов (по 3-5 мин)',
        'Все 18 узбекских голосов',
        'Экспорт в MP3 и WAV 320kbps',
        'Авто-очистка ремарок и скобок',
      ],
      popular: false,
    },
    {
      id: 'pro' as const,
      nameUz: 'Ijodkor Pro',
      nameRu: 'Креатор Pro',
      badgeUz: 'Eng mashhur',
      badgeRu: 'Популярный',
      priceUz: "129,000 so'm",
      priceRu: '129 000 сум',
      usdPrice: '$10',
      credits: 100,
      featuresUz: [
        '100 ta professional podkast sintezi',
        "O'z ovozingizni klonlash laboratoriyasi (Voice Replication)",
        '2 Ovozli Intervyu (Multi-speaker dialog)',
        'Video Dublyaj va taymlayn sinxroni',
        'Prioritet sintez tezligi (24kHz HD)',
      ],
      featuresRu: [
        '100 полных генераций подкастов',
        'Клонирование собственного голоса (Replication)',
        'Диалог с 2 дикторами (Интервью)',
        'Дубляж видео с таймлайном',
        'Приоритетная скорость 24kHz HD',
      ],
      popular: true,
    },
    {
      id: 'unlimited' as const,
      nameUz: 'Media Studiya VIP',
      nameRu: 'Медиа Студия VIP',
      badgeUz: 'Professional',
      badgeRu: 'Безлимит',
      priceUz: "299,000 so'm",
      priceRu: '299 000 сум',
      usdPrice: '$24',
      credits: 350,
      featuresUz: [
        '350 ta podkast yoki 20+ soat audio',
        'Cheksiz ovoz klonlash profillari',
        'AI Qo\'ng\'iroq Agenti va CRM integratsiya',
        'VIP audio rejissyor (fon saundtrek miks)',
        '24/7 shaxsiy texnik yordam',
      ],
      featuresRu: [
        '350 генераций или 20+ часов аудио',
        'Неограниченное клонирование голосов',
        'AI Телефонный Агент и CRM интеграция',
        'VIP саундтрек микширование',
        'Приоритетная поддержка 24/7',
      ],
      popular: false,
    },
  ];

  const currentPlan = plans.find((p) => p.id === selectedPlan)!;

  const copyCardNumber = () => {
    navigator.clipboard.writeText(gatewayConfig.cardDetails.cardNumber.replace(/\s+/g, ''));
    setCopiedCard(true);
    setTimeout(() => setCopiedCard(false), 2000);
  };

  // Generate Telegram Direct Link
  const getTelegramUrl = () => {
    const text = encodeURIComponent(
      `Assalomu alaykum! Men OvozStudio AI platformasida "${currentPlan.nameUz}" (${currentPlan.priceUz}) tarifini xarid qilmoqchiman.\n\nMening hisobim (Email): ${user?.email || 'Noma\'lum'}\nTanlangan to'lov: ${selectedPayment.toUpperCase()}\nKarta: ${gatewayConfig.cardDetails.cardNumber} (${gatewayConfig.cardDetails.bank})\n\nTo'lov chekini ilova qilmoqdaman. Iltimos, hisobimga kreditlarni faollashtirib bering.`
    );
    return `https://t.me/${gatewayConfig.telegramHandle.replace(/^@/, '')}?text=${text}`;
  };

  // Handle Stripe Checkout
  const handleStripeCheckout = async () => {
    if (!user) {
      closePricingModal();
      openAuthModal(lang === 'uz' ? 'To\'lov uchun tizimga kiring' : 'Войдите в аккаунт для оплаты');
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/billing/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: selectedPlan,
          userId: user.uid,
          userEmail: user.email,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.url) {
        // Stripe is not yet configured with live keys
        setStripeNoticeModal(true);
        setIsProcessing(false);
        return;
      }

      // Redirect directly to Stripe Checkout
      window.location.href = data.url;
    } catch (err: any) {
      setStripeNoticeModal(true);
      setIsProcessing(false);
    }
  };

  // Submit Payment Request for Admin Verification
  const handleSubmitPaymentRequest = async () => {
    if (!user) {
      closePricingModal();
      openAuthModal(lang === 'uz' ? 'Iltimos, tizimga kiring' : 'Пожалуйста, войдите в аккаунт');
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);

    try {
      await createPaymentRequest({
        userId: user.uid,
        userEmail: user.email || 'no-email',
        userName: user.displayName || undefined,
        planId: selectedPlan,
        planName: currentPlan.nameUz,
        price: currentPlan.priceUz,
        credits: currentPlan.credits,
        paymentMethod: selectedPayment,
        receiptInfo: transferDetails.trim() || 'Chek Telegram orqali yuborildi',
      });

      setRequestSubmitted(true);
      setIsProcessing(false);
      setSuccessMsg(
        lang === 'uz'
          ? "To'lov so'rovingiz qabul qilindi! Admin chekni tekshirib, 5-10 daqiqada kreditlarni faollashtiradi."
          : 'Запрос на оплату принят! Администратор проверит чек и активирует тариф в течение 5-10 минут.'
      );
    } catch (err: any) {
      setErrorMessage(err.message || 'Xatolik yuz berdi');
      setIsProcessing(false);
    }
  };

  // Admin: Approve Request
  const handleApproveRequest = async (req: PaymentRequest) => {
    try {
      await approvePaymentRequest(req, user?.email || 'admin');
      setPendingRequests((prev) => prev.filter((r) => r.id !== req.id));
      setAdminActionMsg(`So'rov tasdiqlandi: ${req.userEmail} (+${req.credits} kredit)`);
      setTimeout(() => setAdminActionMsg(null), 3000);
      await refreshProfile();
    } catch (e: any) {
      setAdminActionMsg(`Xato: ${e.message}`);
    }
  };

  // Admin: Reject Request
  const handleRejectRequest = async (reqId: string) => {
    try {
      await rejectPaymentRequest(reqId, 'Bekor qilindi');
      setPendingRequests((prev) => prev.filter((r) => r.id !== reqId));
      setAdminActionMsg(`So'rov rad etildi`);
      setTimeout(() => setAdminActionMsg(null), 3000);
    } catch (e: any) {
      setAdminActionMsg(`Xato: ${e.message}`);
    }
  };

  // Admin: Manual Grant Credits
  const handleAdminManualGrant = async () => {
    if (!adminTargetEmail.trim()) {
      setAdminActionMsg('Foydalanuvchi emailini kiriting');
      return;
    }
    const result = await adminManualGrantCredits(adminTargetEmail, adminTargetCredits, adminTargetTier);
    setAdminActionMsg(result.message);
    if (result.success) {
      setAdminTargetEmail('');
      await refreshProfile();
    }
    setTimeout(() => setAdminActionMsg(null), 4000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#161511]/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-[#F4F1EA] text-[#161511] border border-[rgba(22,21,17,0.18)] rounded-[24px] p-5 sm:p-7 shadow-[0_50px_90px_-40px_rgba(22,21,17,0.55)] overflow-hidden space-y-5 max-h-[92vh] overflow-y-auto no-scrollbar">
        {/* Soft Ambient Glow (Teal) */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-[#0E7C86]/10 blur-3xl pointer-events-none" />

        {/* Header & Tabs */}
        <div className="flex items-start justify-between relative z-10">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[rgba(14,124,134,0.1)] text-[#0E7C86] border border-[#0E7C86]/30 text-xs font-mono font-bold uppercase tracking-wider">
                <Zap className="w-3.5 h-3.5 fill-current" />
                <span>{lang === 'uz' ? 'OvozStudio AI Balans' : 'Баланс OvozStudio AI'}</span>
              </span>

              {isAdmin && (
                <div className="flex items-center bg-[#ECE7DB] rounded-full p-0.5 text-xs font-semibold border border-[rgba(22,21,17,0.1)]">
                  <button
                    type="button"
                    onClick={() => setActiveTab('plans')}
                    className={`px-3 py-1 rounded-full transition-all cursor-pointer ${
                      activeTab === 'plans' ? 'bg-[#161511] text-[#F4F1EA] shadow-2xs' : 'text-[#5D594E] hover:text-[#161511]'
                    }`}
                  >
                    {lang === 'uz' ? 'Tariflar' : 'Тарифы'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('admin')}
                    className={`px-3 py-1 rounded-full transition-all cursor-pointer flex items-center gap-1 ${
                      activeTab === 'admin' ? 'bg-[#0E7C86] text-white shadow-2xs' : 'text-[#0A5A62] hover:text-[#0E7C86]'
                    }`}
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Admin Panel</span>
                    {pendingRequests.length > 0 && (
                      <span className="w-4 h-4 rounded-full bg-[#C4552D] text-white text-[10px] flex items-center justify-center font-bold">
                        {pendingRequests.length}
                      </span>
                    )}
                  </button>
                </div>
              )}
            </div>

            <h3 className="text-xl sm:text-2xl font-serif text-[#161511] tracking-tight">
              {activeTab === 'admin'
                ? (lang === 'uz' ? <>To'lovlarni Boshqarish & <em className="italic text-[#0E7C86]">Faollashtirish</em></> : <>Управление Оплатами и <em className="italic text-[#0E7C86]">Активацией</em></>)
                : (lang === 'uz' ? <>Kreditlar va <em className="italic text-[#0E7C86]">Obunalar</em></> : <>Кредиты и <em className="italic text-[#0E7C86]">Подписка</em></>)}
            </h3>
          </div>

          <div className="flex items-center gap-2">
            <div className="bg-white border border-[rgba(22,21,17,0.12)] px-3 py-1.5 rounded-full flex items-center gap-2 text-xs shadow-2xs">
              <span className="text-[#5D594E] font-medium">{lang === 'uz' ? 'Balans:' : 'Баланс:'}</span>
              <span className="font-mono font-bold text-[#0E7C86]">
                {isAdmin ? 'VIP Admin' : `${credits} kredit`}
              </span>
            </div>

            <button
              type="button"
              onClick={closePricingModal}
              className="w-8 h-8 rounded-full bg-white hover:bg-[#ECE7DB] border border-[rgba(22,21,17,0.14)] text-[#161511] flex items-center justify-center transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* TAB 1: REGULAR USER PLANS & PAYMENT */}
        {activeTab === 'plans' && (
          <>
            {/* Step 1: Pricing Cards */}
            <div className="relative z-10 grid grid-cols-1 md:grid-cols-3 gap-3">
              {plans.map((plan) => {
                const isSelected = selectedPlan === plan.id;
                return (
                  <div
                    key={plan.id}
                    onClick={() => {
                      setSelectedPlan(plan.id);
                      setRequestSubmitted(false);
                      setSuccessMsg(null);
                    }}
                    className={`relative rounded-2xl p-4 flex flex-col justify-between transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-white border-2 border-[#0E7C86] shadow-sm text-[#161511]'
                        : 'bg-white/80 border border-[rgba(22,21,17,0.12)] text-[#5D594E] hover:border-[#161511]'
                    }`}
                  >
                    {plan.popular && (
                      <div className="absolute -top-2.5 right-4 px-2.5 py-0.5 rounded-full bg-[#0E7C86] text-white text-[10px] font-mono font-bold uppercase tracking-wider shadow-sm">
                        {lang === 'uz' ? 'Tavsiya' : 'Хит'}
                      </div>
                    )}

                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-[#161511]">
                          {lang === 'uz' ? plan.nameUz : plan.nameRu}
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#ECE7DB] text-[#5D594E] font-semibold">
                          {plan.usdPrice}
                        </span>
                      </div>

                      <div>
                        <div className="text-lg sm:text-xl font-bold font-serif text-[#161511]">
                          {lang === 'uz' ? plan.priceUz : plan.priceRu}
                        </div>
                        <div className="text-[11px] text-[#0E7C86] font-mono mt-0.5 font-bold">
                          +{plan.credits} {lang === 'uz' ? 'ta sintez' : 'синтезов'}
                        </div>
                      </div>

                      <ul className="space-y-1 pt-1 text-[11px] text-[#5D594E]">
                        {(lang === 'uz' ? plan.featuresUz : plan.featuresRu).map((f, i) => (
                          <li key={i} className="flex items-start gap-1.5">
                            <Check className="w-3.5 h-3.5 text-[#0E7C86] shrink-0 mt-0.5" />
                            <span className="leading-tight">{f}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="pt-3">
                      <div
                        className={`w-full py-1.5 rounded-full text-xs font-semibold text-center transition-all ${
                          isSelected
                            ? 'bg-[#161511] text-[#F4F1EA] font-bold shadow-2xs'
                            : 'bg-[#ECE7DB] text-[#5D594E]'
                        }`}
                      >
                        {isSelected ? '✓ Tanlandi' : 'Tanlash'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Step 2: Payment Method Choice */}
            <div className="relative z-10 space-y-2.5">
              <label className="text-xs font-mono uppercase tracking-wider text-[#5D594E] font-bold block">
                {lang === 'uz' ? "To'lov usulini tanlang:" : 'Выберите способ оплаты:'}
              </label>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                {[
                  { id: 'card' as const, label: 'Uzcard / Humo', badge: '9860 3501...' },
                  { id: 'payme' as const, label: 'Payme', badge: 'O\'zbekiston' },
                  { id: 'click' as const, label: 'Click Up', badge: '1-click' },
                  { id: 'uzum' as const, label: 'Uzum Bank', badge: '0% komissiya' },
                  { id: 'stripe' as const, label: 'Stripe (Karta)', badge: 'Visa/Mastercard' },
                ].map((pm) => (
                  <button
                    key={pm.id}
                    type="button"
                    onClick={() => {
                      setSelectedPayment(pm.id);
                      setRequestSubmitted(false);
                      setSuccessMsg(null);
                    }}
                    className={`p-2.5 rounded-xl text-left transition-all cursor-pointer ${
                      selectedPayment === pm.id
                        ? 'bg-white border-2 border-[#0E7C86] text-[#161511] shadow-2xs'
                        : 'bg-white/70 border border-[rgba(22,21,17,0.12)] text-[#5D594E] hover:border-[#161511]'
                    }`}
                  >
                    <div className="font-bold flex items-center justify-between text-[11px]">
                      <span>{pm.label}</span>
                      {selectedPayment === pm.id && <Check className="w-3 h-3 text-[#0E7C86]" />}
                    </div>
                    <div className="text-[10px] text-[#5D594E] mt-0.5 truncate font-mono">{pm.badge}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Dynamic Payment Details Section */}
            <div className="relative z-10 bg-white border border-[rgba(22,21,17,0.14)] rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm">
              {/* Option A: Stripe Checkout */}
              {selectedPayment === 'stripe' ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CreditCard className="w-5 h-5 text-[#0E7C86]" />
                      <span className="font-semibold text-sm text-[#161511]">
                        {lang === 'uz' ? 'Stripe Xalqaro To\'lov Tizimi' : 'Международный эквайринг Stripe'}
                      </span>
                    </div>
                    <span className="text-xs font-mono text-[#0E7C86] font-bold">
                      {currentPlan.usdPrice} ({currentPlan.priceUz})
                    </span>
                  </div>

                  <p className="text-xs text-[#5D594E] leading-relaxed">
                    {lang === 'uz'
                      ? "Visa, Mastercard, Apple Pay yoki Google Pay orqali xavfsiz to'lov. To'lov tasdiqlangach, kreditlar hisobingizga avtomatik tarzda qo'shiladi."
                      : 'Безопасная оплата через Visa, Mastercard, Apple Pay, Google Pay. Кредиты зачисляются сразу после успешной оплаты.'}
                  </p>

                  <div className="pt-1 flex flex-col sm:flex-row gap-2">
                    <button
                      type="button"
                      onClick={handleStripeCheckout}
                      disabled={isProcessing}
                      className="flex-1 btn-pill btn-solid text-xs sm:text-sm py-3 px-5 flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {isProcessing ? (
                        <>
                          <div className="w-4 h-4 border-2 border-[#F4F1EA] border-t-transparent rounded-full animate-spin" />
                          <span>{lang === 'uz' ? 'Stripe ulanmoqda...' : 'Подключение к Stripe...'}</span>
                        </>
                      ) : (
                        <>
                          <Lock className="w-4 h-4 text-[#5CC8CF]" />
                          <span>
                            {lang === 'uz'
                              ? `Stripe orqali to'lash (${currentPlan.usdPrice})`
                              : `Оплатить через Stripe (${currentPlan.usdPrice})`}
                          </span>
                        </>
                      )}
                    </button>

                    <a
                      href={getTelegramUrl()}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-pill btn-ghost text-xs py-3 px-4 flex items-center justify-center gap-1.5"
                    >
                      <MessageSquare className="w-3.5 h-3.5 text-[#0E7C86]" />
                      <span>{lang === 'uz' ? 'Telegram Admin' : 'Связаться в Telegram'}</span>
                      <ExternalLink className="w-3 h-3 text-[#5D594E]" />
                    </a>
                  </div>
                </div>
              ) : (
                /* Option B: Local Uzbek Payment (Uzcard/Humo, Payme, Click, Uzum) */
                <div className="space-y-3.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[11px] font-mono uppercase tracking-wider text-[#5D594E] block">
                        {lang === 'uz' ? "O'tkazma uchun rasmiy Humo / Uzcard karta raqami:" : 'Официальная карта для перевода:'}
                      </span>
                      <span className="text-xs font-bold text-[#161511]">
                        {gatewayConfig.cardDetails.bank} ({gatewayConfig.cardDetails.cardHolder})
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-[#5D594E] block font-mono">{lang === 'uz' ? 'To\'lov summasi:' : 'Сумма к оплате:'}</span>
                      <span className="text-sm font-mono font-bold text-[#0E7C86]">{currentPlan.priceUz}</span>
                    </div>
                  </div>

                  {/* Card Number & 1-Click Copy */}
                  <div className="flex items-center justify-between bg-[#ECE7DB] border border-[rgba(22,21,17,0.12)] px-4 py-3 rounded-2xl shadow-2xs">
                    <div className="flex items-center gap-2.5">
                      <CreditCard className="w-5 h-5 text-[#0E7C86]" />
                      <span className="font-mono text-base sm:text-lg font-bold tracking-wider text-[#161511]">
                        {gatewayConfig.cardDetails.cardNumber}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={copyCardNumber}
                      className="btn-pill btn-solid text-xs py-1.5 px-3 flex items-center gap-1.5 cursor-pointer"
                    >
                      {copiedCard ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span>{lang === 'uz' ? 'Nusxalandi!' : 'Скопировано!'}</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 text-[#5CC8CF]" />
                          <span>{lang === 'uz' ? 'Nusxa olish' : 'Копировать'}</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Instruction text */}
                  <div className="text-[11px] text-[#5D594E] space-y-1">
                    <p>
                      {lang === 'uz'
                        ? `1. ${gatewayConfig.cardDetails.cardNumber} (${gatewayConfig.cardDetails.bank}) kartasiga ${currentPlan.priceUz} o'tkazing.`
                        : `1. Переведите ${currentPlan.priceRu} на карту ${gatewayConfig.cardDetails.cardNumber} (${gatewayConfig.cardDetails.bank}).`}
                    </p>
                    <p>
                      {lang === 'uz'
                        ? '2. To\'lov chekini Telegram orqali yuboring yoki quyida chek raqamini kiritib so\'rov qoldiring.'
                        : '2. Отправьте чек в Telegram или оставьте номер транзакции ниже.'}
                    </p>
                  </div>

                  {/* Manual Request Form */}
                  <div className="pt-2 border-t border-[rgba(22,21,17,0.08)] space-y-2.5">
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        value={transferDetails}
                        onChange={(e) => setTransferDetails(e.target.value)}
                        placeholder={
                          lang === 'uz'
                            ? "Chek raqami yoki kartangiz oxirgi 4 raqami (ixtiyoriy)"
                            : 'Номер транзакции или последние 4 цифры карты'
                        }
                        className="flex-1 bg-[#F4F1EA] text-xs text-[#161511] px-3.5 py-2.5 rounded-xl border border-[rgba(22,21,17,0.14)] outline-none focus:border-[#0E7C86] placeholder-[#5D594E]/60"
                      />

                      <button
                        type="button"
                        onClick={handleSubmitPaymentRequest}
                        disabled={isProcessing || requestSubmitted}
                        className="btn-pill btn-solid text-xs py-2.5 px-4 flex items-center justify-center gap-1.5 disabled:opacity-60 shrink-0"
                      >
                        {isProcessing ? (
                          <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <Send className="w-3.5 h-3.5 text-[#5CC8CF]" />
                        )}
                        <span>
                          {requestSubmitted
                            ? (lang === 'uz' ? 'So\'rov yuborildi' : 'Отправлено')
                            : (lang === 'uz' ? 'So\'rov qoldirish' : 'Отправить запрос')}
                        </span>
                      </button>
                    </div>

                    {/* Direct Telegram Link Button */}
                    <a
                      href={getTelegramUrl()}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full btn-pill btn-teal text-xs py-2.5 px-4 flex items-center justify-center gap-2"
                    >
                      <MessageSquare className="w-4 h-4" />
                      <span>
                        {lang === 'uz'
                          ? `Chekni Telegram orqali yuborish (@${gatewayConfig.telegramHandle})`
                          : `Отправить чек в Telegram (@${gatewayConfig.telegramHandle})`}
                      </span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>

                    {gatewayConfig.phoneNumber && (
                      <div className="flex items-center justify-between text-[11px] text-[#5D594E] pt-1 px-1">
                        <span>{lang === 'uz' ? 'Aloqa / Yordam:' : 'Справка / Телефон:'}</span>
                        <a
                          href={`tel:${gatewayConfig.phoneNumber}`}
                          className="text-[#161511] font-mono hover:text-[#0E7C86] transition-colors"
                        >
                          {gatewayConfig.phoneNumber}
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Success message */}
            {successMsg && (
              <div className="relative z-10 bg-[rgba(14,124,134,0.1)] border border-[#0E7C86]/30 rounded-2xl p-3.5 text-xs text-[#0A5A62] font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#0E7C86] shrink-0" />
                <span>{successMsg}</span>
              </div>
            )}

            {/* Error message */}
            {errorMessage && (
              <div className="relative z-10 bg-[rgba(196,85,45,0.1)] border border-[#C4552D]/30 text-[#C4552D] rounded-2xl p-3 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-[#C4552D] shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}
          </>
        )}

        {/* TAB 2: ADMIN ACTIVATION & MANAGEMENT PANEL (Only for Admin) */}
        {activeTab === 'admin' && isAdmin && (
          <div className="relative z-10 space-y-4">
            {/* Quick Refresh & Admin Feedback */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#161511] flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-[#0E7C86]" />
                <span>Kutilayotgan To'lov So'rovlari ({pendingRequests.length})</span>
              </span>

              <button
                type="button"
                onClick={loadPendingRequests}
                disabled={isLoadingRequests}
                className="text-xs text-[#0E7C86] hover:underline flex items-center gap-1 cursor-pointer font-semibold"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingRequests ? 'animate-spin' : ''}`} />
                <span>Yangilash</span>
              </button>
            </div>

            {adminActionMsg && (
              <div className="bg-[rgba(14,124,134,0.1)] text-[#0A5A62] border border-[#0E7C86]/30 p-2.5 rounded-xl text-xs font-semibold flex items-center gap-2">
                <Check className="w-3.5 h-3.5" />
                <span>{adminActionMsg}</span>
              </div>
            )}

            {/* Pending Requests List */}
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1 no-scrollbar">
              {pendingRequests.length === 0 ? (
                <div className="bg-white border border-[rgba(22,21,17,0.1)] rounded-2xl p-6 text-center text-xs text-[#5D594E] space-y-1">
                  <CheckCircle2 className="w-6 h-6 text-[#0E7C86] mx-auto opacity-70" />
                  <p>Hozirda kutilayotgan yangi to'lov so'rovlari yo'q.</p>
                </div>
              ) : (
                pendingRequests.map((req) => (
                  <div
                    key={req.id}
                    className="bg-white border border-[rgba(22,21,17,0.12)] rounded-2xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs shadow-2xs"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-[#161511] truncate">{req.userEmail}</span>
                        <span className="px-2 py-0.5 rounded-md bg-[rgba(14,124,134,0.1)] text-[#0E7C86] font-semibold text-[10px]">
                          {req.planName} (+{req.credits})
                        </span>
                      </div>
                      <div className="text-[11px] text-[#5D594E] flex items-center gap-2">
                        <span className="font-mono text-[#161511] font-bold">{req.price}</span>
                        <span>•</span>
                        <span className="uppercase text-[10px] text-[#5D594E] font-bold font-mono">{req.paymentMethod}</span>
                        {req.receiptInfo && (
                          <>
                            <span>•</span>
                            <span className="text-[#161511] truncate max-w-[150px]">{req.receiptInfo}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleApproveRequest(req)}
                        className="btn-pill btn-teal text-xs py-1.5 px-3 flex items-center gap-1 cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Tasdiqlash & Qo'shish</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleRejectRequest(req.id)}
                        className="p-1.5 rounded-full border border-[rgba(22,21,17,0.14)] text-[#5D594E] hover:text-[#C4552D] hover:border-[#C4552D]/50 transition-colors cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Manual Grant Section for Admin */}
            <div className="bg-white border border-[rgba(22,21,17,0.12)] rounded-2xl p-4 space-y-3 shadow-2xs">
              <span className="text-xs font-semibold text-[#161511] block">
                Foydalanuvchiga to'g'ridan-to'g'ri kredit qo'shish (Qo'lda faollashtirish):
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  type="email"
                  value={adminTargetEmail}
                  onChange={(e) => setAdminTargetEmail(e.target.value)}
                  placeholder="Foydalanuvchi emaili"
                  className="bg-[#F4F1EA] text-xs text-[#161511] px-3 py-2 rounded-xl border border-[rgba(22,21,17,0.14)] outline-none focus:border-[#0E7C86]"
                />

                <select
                  value={adminTargetCredits}
                  onChange={(e) => setAdminTargetCredits(Number(e.target.value))}
                  className="bg-[#F4F1EA] text-xs text-[#161511] px-3 py-2 rounded-xl border border-[rgba(22,21,17,0.14)] outline-none"
                >
                  <option value={25}>+25 kredit (Start)</option>
                  <option value={100}>+100 kredit (Pro)</option>
                  <option value={350}>+350 kredit (VIP)</option>
                  <option value={1000}>+1000 kredit (Maxsus)</option>
                </select>

                <button
                  type="button"
                  onClick={handleAdminManualGrant}
                  className="btn-pill btn-solid text-xs py-2 px-3 flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-[#5CC8CF]" />
                  <span>Kredit berish</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Stripe Configuration Notice Modal (Popup when Stripe key is not configured) */}
        {stripeNoticeModal && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-[#161511]/60 backdrop-blur-sm">
            <div className="bg-[#F4F1EA] border border-[rgba(22,21,17,0.2)] rounded-[22px] p-6 max-w-md w-full space-y-4 shadow-2xl relative">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[#0E7C86]">
                  <CreditCard className="w-5 h-5" />
                  <h4 className="font-bold text-sm text-[#161511]">Stripe To'lov Tizimi</h4>
                </div>
                <button
                  type="button"
                  onClick={() => setStripeNoticeModal(false)}
                  className="w-7 h-7 rounded-full bg-white border border-[rgba(22,21,17,0.14)] text-[#161511] flex items-center justify-center"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="text-xs text-[#5D594E] space-y-2 leading-relaxed">
                <p>
                  <strong className="text-[#161511]">Stripe'ni ulash juda oson:</strong>
                </p>
                <div className="bg-[#141414] p-3 rounded-xl font-mono text-[11px] text-[#EDEAE2] border border-[#2B2B27]">
                  STRIPE_SECRET_KEY=sk_live_...
                </div>
                <p className="text-[#5D594E]">
                  Stripe Dashboard (stripe.com) orqali olingan kalitni kiritishingiz bilan Visa/Mastercard to'lovlari to'liq avtomatik ishlaydi.
                </p>
                <p className="text-[#0E7C86] font-semibold pt-1">
                  Hozir to'lovni amalga oshirish uchun Telegram orqali admin bilan bog'lanishingiz yoki Uzum/Payme/Uzcard/Humo orqali o'tkazishingiz mumkin.
                </p>
              </div>

              <div className="pt-2 flex gap-2">
                <a
                  href={getTelegramUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setStripeNoticeModal(false)}
                  className="flex-1 btn-pill btn-solid text-xs py-2.5 px-3 flex items-center justify-center gap-1.5"
                >
                  <MessageSquare className="w-3.5 h-3.5 text-[#5CC8CF]" />
                  <span>Telegram orqali to'lash</span>
                </a>
                <button
                  type="button"
                  onClick={() => {
                    setStripeNoticeModal(false);
                    setSelectedPayment('card');
                  }}
                  className="btn-pill btn-ghost text-xs py-2.5 px-3"
                >
                  Karta orqali
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
