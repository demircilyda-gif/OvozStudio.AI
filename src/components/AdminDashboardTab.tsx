import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  RefreshCw,
  Search,
  Download,
  Check,
  X,
  Plus,
  Edit3,
  BarChart3,
  History,
  Users,
  CreditCard,
  ArrowUpRight,
  Filter,
  ShieldCheck,
} from 'lucide-react';
import {
  AppUserProfile,
  PaymentRequest,
  GenerationRecord,
  adminFetchAllUsers,
  adminFetchPaymentRequests,
  adminFetchAllGenerations,
  approvePaymentRequest,
  rejectPaymentRequest,
  adminManualGrantCredits,
  adminUpdateUserProfile,
} from '../firebase';
import { useAuth } from '../context/AuthContext';

interface AdminDashboardTabProps {
  lang: 'uz' | 'ru';
}

type AdminSection = 'analytics' | 'generations' | 'users' | 'payments';

export const AdminDashboardTab: React.FC<AdminDashboardTabProps> = ({ lang }) => {
  const { user, isAdmin } = useAuth();

  const [activeSection, setActiveSection] = useState<AdminSection>('analytics');
  const [users, setUsers] = useState<AppUserProfile[]>([]);
  const [generations, setGenerations] = useState<GenerationRecord[]>([]);
  const [paymentRequests, setPaymentRequests] = useState<PaymentRequest[]>([]);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [feedbackMsg, setFeedbackMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Filters for Generations History
  const [genSearchQuery, setGenSearchQuery] = useState<string>('');
  const [genTypeFilter, setGenTypeFilter] = useState<string>('all');
  const [genUserFilter, setGenUserFilter] = useState<string>('');

  // Filters & State for Users Management
  const [userSearchQuery, setUserSearchQuery] = useState<string>('');
  const [userTierFilter, setUserTierFilter] = useState<string>('all');
  const [grantingEmail, setGrantingEmail] = useState<string | null>(null);
  const [editingUserEmail, setEditingUserEmail] = useState<string | null>(null);
  const [editCreditsVal, setEditCreditsVal] = useState<number>(0);
  const [editTierVal, setEditTierVal] = useState<'free' | 'pro' | 'unlimited'>('pro');

  // Manual Grant Form
  const [manualEmail, setManualEmail] = useState<string>('');
  const [manualCredits, setManualCredits] = useState<number>(100);
  const [manualTier, setManualTier] = useState<'free' | 'pro' | 'unlimited'>('pro');

  // Filters for Payment Requests
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<string>('all');

  // Chart Metric Toggle (Generations Count vs Credits Spent)
  const [chartMetric, setChartMetric] = useState<'count' | 'credits'>('count');

  const showToast = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    setFeedbackMsg({ text, type });
    setTimeout(() => {
      setFeedbackMsg((prev) => (prev?.text === text ? null : prev));
    }, 4000);
  }, []);

  const loadAllAdminData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [fetchedUsers, fetchedPayments] = await Promise.all([
        adminFetchAllUsers(),
        adminFetchPaymentRequests('all'),
      ]);
      setUsers(fetchedUsers);
      setPaymentRequests(fetchedPayments);

      const fetchedGenerations = await adminFetchAllGenerations(fetchedUsers);
      setGenerations(fetchedGenerations);
    } catch (err) {
      console.warn('Error loading admin dashboard data:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) {
      loadAllAdminData();
    }
  }, [isAdmin, loadAllAdminData]);

  // Map per-user generation stats (count, total credits spent, last active timestamp)
  const userUsageMap = useMemo(() => {
    const map = new Map<
      string,
      { count: number; creditsSpent: number; lastActiveAt: string; types: Record<string, number> }
    >();

    for (const g of generations) {
      const key = (g.userEmail || g.userId || '').trim().toLowerCase();
      if (!key) continue;
      const cur = map.get(key) || { count: 0, creditsSpent: 0, lastActiveAt: '', types: {} };
      cur.count += 1;
      cur.creditsSpent += Number(g.creditsCost || 1);
      if (!cur.lastActiveAt || new Date(g.createdAt) > new Date(cur.lastActiveAt)) {
        cur.lastActiveAt = g.createdAt;
      }
      const t = g.type || 'tts';
      cur.types[t] = (cur.types[t] || 0) + 1;
      map.set(key, cur);
    }
    return map;
  }, [generations]);

  // Platform KPI & Feature Breakdown Analytics
  const analyticsSummary = useMemo(() => {
    const now = new Date();
    const todayIsoPrefix = now.toISOString().slice(0, 10);

    const totalUsers = users.length;
    const paidUsers = users.filter((u) => u.role !== 'admin' && (u.tier === 'pro' || u.tier === 'unlimited')).length;
    const freeUsers = users.filter((u) => u.role !== 'admin' && (!u.tier || u.tier === 'free')).length;

    const totalGenerations = generations.length;
    const generationsToday = generations.filter((g) => (g.createdAt || '').startsWith(todayIsoPrefix)).length;

    const totalCreditsSpent = generations.reduce((acc, g) => acc + Number(g.creditsCost || 1), 0);
    const creditsSpentToday = generations
      .filter((g) => (g.createdAt || '').startsWith(todayIsoPrefix))
      .reduce((acc, g) => acc + Number(g.creditsCost || 1), 0);

    const activeUserBalances = users
      .filter((u) => u.role !== 'admin')
      .reduce((acc, u) => acc + Number(u.creditsRemaining || 0), 0);

    const pendingPayments = paymentRequests.filter((r) => r.status === 'pending');
    const approvedPayments = paymentRequests.filter((r) => r.status === 'approved');
    const totalCreditsPurchased = approvedPayments.reduce((acc, r) => acc + Number(r.credits || 0), 0);

    // Feature breakdown
    const typeCategories: {
      key: string;
      labelUz: string;
      labelRu: string;
      match: (t: string) => boolean;
    }[] = [
      {
        key: 'podcast_tts',
        labelUz: 'Yakkaxon Podkast & TTS',
        labelRu: 'Подкаст и Озвучка (TTS)',
        match: (t) => t === 'podcast' || t === 'tts',
      },
      {
        key: 'agent_call',
        labelUz: 'AI Qoʻngʻiroq (Rieltor / SuperTaksi)',
        labelRu: 'AI Голосовые Звонки (Риелтор / Такси)',
        match: (t) => t === 'agent_call',
      },
      {
        key: 'dubbing_voiceover',
        labelUz: 'Video Dublyaj & Voiceover',
        labelRu: 'Видео Дубляж и Закадровый голос',
        match: (t) => t === 'dubbing' || t === 'voiceover',
      },
    ];

    const featureBreakdown = typeCategories.map((cat) => {
      const matched = generations.filter((g) => cat.match(g.type || 'tts'));
      const count = matched.length;
      const credits = matched.reduce((acc, g) => acc + Number(g.creditsCost || 1), 0);
      const sharePct = totalGenerations > 0 ? Math.round((count / totalGenerations) * 100) : 0;
      return {
        ...cat,
        count,
        credits,
        sharePct,
      };
    });

    // 14-day daily chart data
    const dailySeries: { dateKey: string; label: string; count: number; credits: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const dateKey = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'uz-UZ', {
        day: '2-digit',
        month: '2-digit',
      });
      const dayItems = generations.filter((g) => (g.createdAt || '').startsWith(dateKey));
      dailySeries.push({
        dateKey,
        label,
        count: dayItems.length,
        credits: dayItems.reduce((acc, g) => acc + Number(g.creditsCost || 1), 0),
      });
    }

    // Top Users Leaderboard sorted by credits spent then generations count
    const leaderboard = users
      .map((u) => {
        const emailKey = (u.email || '').trim().toLowerCase();
        const stats = userUsageMap.get(emailKey) ||
          userUsageMap.get(u.uid) || { count: 0, creditsSpent: 0, lastActiveAt: '', types: {} };
        return {
          ...u,
          generationsCount: stats.count,
          creditsSpent: stats.creditsSpent,
          lastActiveAt: stats.lastActiveAt || u.updatedAt || u.createdAt || '',
        };
      })
      .sort((a, b) => {
        if (b.creditsSpent !== a.creditsSpent) return b.creditsSpent - a.creditsSpent;
        if (b.generationsCount !== a.generationsCount) return b.generationsCount - a.generationsCount;
        return (b.creditsRemaining || 0) - (a.creditsRemaining || 0);
      });

    return {
      totalUsers,
      paidUsers,
      freeUsers,
      totalGenerations,
      generationsToday,
      totalCreditsSpent,
      creditsSpentToday,
      activeUserBalances,
      pendingPaymentsCount: pendingPayments.length,
      approvedPaymentsCount: approvedPayments.length,
      totalCreditsPurchased,
      featureBreakdown,
      dailySeries,
      leaderboard,
    };
  }, [users, generations, paymentRequests, userUsageMap, lang]);

  // Filtered Generations List
  const filteredGenerations = useMemo(() => {
    return generations.filter((g) => {
      if (genTypeFilter !== 'all') {
        if (genTypeFilter === 'podcast_tts' && g.type !== 'podcast' && g.type !== 'tts') return false;
        if (genTypeFilter === 'agent_call' && g.type !== 'agent_call') return false;
        if (genTypeFilter === 'dubbing_voiceover' && g.type !== 'dubbing' && g.type !== 'voiceover') return false;
      }
      if (genUserFilter) {
        const uClean = genUserFilter.trim().toLowerCase();
        if (
          (g.userEmail || '').toLowerCase() !== uClean &&
          (g.userId || '').toLowerCase() !== uClean
        ) {
          return false;
        }
      }
      if (genSearchQuery.trim()) {
        const q = genSearchQuery.trim().toLowerCase();
        const matchEmail = (g.userEmail || '').toLowerCase().includes(q);
        const matchTitle = (g.title || '').toLowerCase().includes(q);
        const matchType = (g.type || '').toLowerCase().includes(q);
        if (!matchEmail && !matchTitle && !matchType) return false;
      }
      return true;
    });
  }, [generations, genTypeFilter, genUserFilter, genSearchQuery]);

  // Filtered Users List
  const filteredUsers = useMemo(() => {
    return analyticsSummary.leaderboard.filter((u) => {
      if (userTierFilter !== 'all') {
        if (userTierFilter === 'admin' && u.role !== 'admin') return false;
        if (userTierFilter !== 'admin' && (u.role === 'admin' || (u.tier || 'free') !== userTierFilter)) {
          return false;
        }
      }
      if (userSearchQuery.trim()) {
        const q = userSearchQuery.trim().toLowerCase();
        const matchEmail = (u.email || '').toLowerCase().includes(q);
        const matchName = (u.displayName || '').toLowerCase().includes(q);
        if (!matchEmail && !matchName) return false;
      }
      return true;
    });
  }, [analyticsSummary.leaderboard, userTierFilter, userSearchQuery]);

  // Filtered Payment Requests
  const filteredPaymentRequests = useMemo(() => {
    if (paymentStatusFilter === 'all') return paymentRequests;
    return paymentRequests.filter((r) => r.status === paymentStatusFilter);
  }, [paymentRequests, paymentStatusFilter]);

  // Format generation type label
  const getGenerationTypeLabel = (type: string) => {
    switch (type) {
      case 'podcast':
        return lang === 'uz' ? 'Podkast (Studiya)' : 'Подкаст (Студия)';
      case 'tts':
        return lang === 'uz' ? 'Matndan Ovozga (TTS)' : 'Озвучка текста (TTS)';
      case 'voiceover':
        return lang === 'uz' ? 'Kadr orti ovoz' : 'Закадровый голос';
      case 'dubbing':
        return lang === 'uz' ? 'Video Dublyaj' : 'Видео Дубляж';
      case 'agent_call':
        return lang === 'uz' ? 'AI Qoʻngʻiroq Agenti' : 'AI Голосовой Звонок';
      default:
        return type.toUpperCase();
    }
  };

  // Export filtered generations to CSV
  const handleExportGenerationsCsv = () => {
    const headers = ['ID', 'Timestamp', 'User Email', 'Type', 'Title / Prompt', 'Credits Cost', 'Status'];
    const rows = filteredGenerations.map((g) => [
      g.id,
      g.createdAt,
      g.userEmail || g.userId,
      g.type,
      `"${String(g.title || '').replace(/"/g, '""')}"`,
      String(g.creditsCost ?? 1),
      g.status || 'completed',
    ]);
    const csvContent =
      '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ovozstudio-generations-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Handle Quick Credit Grant (+25, +100, +350)
  const handleQuickGrant = async (targetEmail: string, amount: number) => {
    if (!targetEmail) return;
    setGrantingEmail(targetEmail);
    try {
      const targetTier = amount >= 350 ? 'unlimited' : amount >= 100 ? 'pro' : 'free';
      const res = await adminManualGrantCredits(targetEmail, amount, targetTier);
      if (res.success) {
        showToast(res.message, 'success');
        await loadAllAdminData();
      } else {
        showToast(res.message || 'Xatolik yuz berdi', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Xatolik', 'error');
    } finally {
      setGrantingEmail(null);
    }
  };

  // Handle Manual Credit Grant Form
  const handleManualGrantSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualEmail.trim()) {
      showToast(
        lang === 'uz' ? 'Foydalanuvchi emailini kiriting' : 'Введите email пользователя',
        'error'
      );
      return;
    }
    setGrantingEmail(manualEmail.trim());
    try {
      const res = await adminManualGrantCredits(manualEmail.trim(), manualCredits, manualTier);
      if (res.success) {
        showToast(res.message, 'success');
        setManualEmail('');
        await loadAllAdminData();
      } else {
        showToast(res.message || 'Xatolik', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Xatolik', 'error');
    } finally {
      setGrantingEmail(null);
    }
  };

  // Handle Direct User Balance & Tier Save
  const handleSaveUserEdit = async (targetEmail: string) => {
    if (!targetEmail) return;
    setGrantingEmail(targetEmail);
    try {
      const res = await adminUpdateUserProfile(targetEmail, editCreditsVal, editTierVal);
      if (res.success) {
        showToast(res.message, 'success');
        setEditingUserEmail(null);
        await loadAllAdminData();
      } else {
        showToast(res.message, 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Xatolik', 'error');
    } finally {
      setGrantingEmail(null);
    }
  };

  // Handle Payment Request Approve / Reject
  const handleApprovePayment = async (req: PaymentRequest) => {
    try {
      await approvePaymentRequest(req, user?.email || undefined);
      showToast(
        lang === 'uz'
          ? `To'lov tasdiqlandi: ${req.userEmail} (+${req.credits} kredit)`
          : `Оплата подтверждена: ${req.userEmail} (+${req.credits} кредитов)`,
        'success'
      );
      await loadAllAdminData();
    } catch (err: any) {
      showToast(err.message || 'Xatolik', 'error');
    }
  };

  const handleRejectPayment = async (reqId: string) => {
    try {
      await rejectPaymentRequest(reqId, lang === 'uz' ? 'Rad etildi' : 'Отклонено администратором');
      showToast(
        lang === 'uz' ? "To'lov so'rovi rad etildi" : 'Заявка на оплату отклонена',
        'success'
      );
      await loadAllAdminData();
    } catch (err: any) {
      showToast(err.message || 'Xatolik', 'error');
    }
  };

  if (!isAdmin) {
    return (
      <div className="bg-white border border-[rgba(22,21,17,0.12)] rounded-2xl p-8 text-center max-w-xl mx-auto my-12 space-y-3">
        <ShieldCheck className="w-8 h-8 text-[#C4552D] mx-auto" />
        <h2 className="text-lg font-bold text-[#161511]">
          {lang === 'uz' ? 'Faqat administrator uchun' : 'Доступ только для администратора'}
        </h2>
        <p className="text-sm text-[#5D594E]">
          {lang === 'uz'
            ? "Ushbu bo'lim faqat tizim administratori (demircilyda@gmail.com) uchun ochiq."
            : 'Этот раздел доступен только администратору платформы (demircilyda@gmail.com).'}
        </p>
      </div>
    );
  }

  const maxChartVal = Math.max(
    1,
    ...analyticsSummary.dailySeries.map((d) => (chartMetric === 'count' ? d.count : d.credits))
  );

  return (
    <div className="space-y-6 pb-16">
      {/* Top Workspace Header & Navigation Controls */}
      <div className="bg-white border border-[rgba(22,21,17,0.12)] rounded-2xl p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-[#5D594E]">
            <span>OvozStudio Boshqaruv</span>
            <span aria-hidden="true">·</span>
            <span>{user?.email}</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-[#161511] tracking-tight">
            {lang === 'uz'
              ? 'Admin Boshqaruv Paneli va Analitika'
              : 'Админ-панель, история генераций и аналитика'}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Segmented Section Tabs */}
          <div className="flex items-center gap-1 p-1 bg-[#F4F1EA] rounded-xl border border-[rgba(22,21,17,0.1)]">
            <button
              type="button"
              onClick={() => setActiveSection('analytics')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
                activeSection === 'analytics'
                  ? 'bg-[#161511] text-[#F4F1EA]'
                  : 'text-[#5D594E] hover:text-[#161511]'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>{lang === 'uz' ? 'Analitika' : 'Аналитика'}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveSection('generations')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
                activeSection === 'generations'
                  ? 'bg-[#161511] text-[#F4F1EA]'
                  : 'text-[#5D594E] hover:text-[#161511]'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>
                {lang === 'uz'
                  ? `Generatsiyalar (${generations.length})`
                  : `История генераций (${generations.length})`}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveSection('users')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
                activeSection === 'users'
                  ? 'bg-[#161511] text-[#F4F1EA]'
                  : 'text-[#5D594E] hover:text-[#161511]'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>
                {lang === 'uz'
                  ? `Mijozlar (${users.length})`
                  : `Пользователи (${users.length})`}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveSection('payments')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
                activeSection === 'payments'
                  ? 'bg-[#161511] text-[#F4F1EA]'
                  : 'text-[#5D594E] hover:text-[#161511]'
              }`}
            >
              <CreditCard className="w-3.5 h-3.5" />
              <span>
                {lang === 'uz'
                  ? `To'lovlar (${analyticsSummary.pendingPaymentsCount})`
                  : `Оплаты (${analyticsSummary.pendingPaymentsCount})`}
              </span>
            </button>
          </div>

          <button
            type="button"
            onClick={loadAllAdminData}
            disabled={isLoading}
            className="px-3.5 py-2 rounded-xl bg-white hover:bg-[#F4F1EA] border border-[rgba(22,21,17,0.14)] text-xs font-semibold text-[#161511] flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#0E7C86] ${isLoading ? 'animate-spin' : ''}`} />
            <span>{lang === 'uz' ? 'Yangilash' : 'Обновить'}</span>
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedbackMsg && (
        <div
          className={`px-4 py-3 rounded-xl border text-xs font-semibold flex items-center justify-between ${
            feedbackMsg.type === 'success'
              ? 'bg-[rgba(14,124,134,0.08)] border-[#0E7C86]/30 text-[#0A5A62]'
              : 'bg-[rgba(196,85,45,0.08)] border-[#C4552D]/30 text-[#C4552D]'
          }`}
        >
          <span>{feedbackMsg.text}</span>
          <button
            type="button"
            onClick={() => setFeedbackMsg(null)}
            className="text-current opacity-70 hover:opacity-100 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 5-Column KPI Summary Strip (Always visible for instant executive context) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        <div className="bg-white border border-[rgba(22,21,17,0.12)] rounded-2xl p-4 space-y-1">
          <span className="text-xs text-[#5D594E] block">
            {lang === 'uz' ? 'Jami Foydalanuvchilar' : 'Всего пользователей'}
          </span>
          <div className="text-2xl font-bold text-[#161511] font-mono tabular-nums">
            {analyticsSummary.totalUsers}
          </div>
          <div className="text-[11px] text-[#5D594E] font-mono tabular-nums">
            {lang === 'uz'
              ? `${analyticsSummary.paidUsers} PRO/VIP · ${analyticsSummary.freeUsers} FREE`
              : `${analyticsSummary.paidUsers} PRO/VIP · ${analyticsSummary.freeUsers} FREE`}
          </div>
        </div>

        <div className="bg-white border border-[rgba(22,21,17,0.12)] rounded-2xl p-4 space-y-1">
          <span className="text-xs text-[#5D594E] block">
            {lang === 'uz' ? 'Jami Generatsiyalar' : 'Всего генераций'}
          </span>
          <div className="text-2xl font-bold text-[#0E7C86] font-mono tabular-nums">
            {analyticsSummary.totalGenerations}
          </div>
          <div className="text-[11px] text-[#5D594E] font-mono tabular-nums">
            {lang === 'uz'
              ? `Bugun: +${analyticsSummary.generationsToday} ta`
              : `Сегодня: +${analyticsSummary.generationsToday}`}
          </div>
        </div>

        <div className="bg-white border border-[rgba(22,21,17,0.12)] rounded-2xl p-4 space-y-1">
          <span className="text-xs text-[#5D594E] block">
            {lang === 'uz' ? 'Sarflangan Kreditlar' : 'Потрачено кредитов'}
          </span>
          <div className="text-2xl font-bold text-[#161511] font-mono tabular-nums">
            {analyticsSummary.totalCreditsSpent}
          </div>
          <div className="text-[11px] text-[#5D594E] font-mono tabular-nums">
            {lang === 'uz'
              ? `Bugun: ${analyticsSummary.creditsSpentToday} kr.`
              : `Сегодня: ${analyticsSummary.creditsSpentToday} кр.`}
          </div>
        </div>

        <div className="bg-white border border-[rgba(22,21,17,0.12)] rounded-2xl p-4 space-y-1">
          <span className="text-xs text-[#5D594E] block">
            {lang === 'uz' ? 'Mijozlardagi Aktiv Balans' : 'Остаток кредитов у клиентов'}
          </span>
          <div className="text-2xl font-bold text-[#161511] font-mono tabular-nums">
            {analyticsSummary.activeUserBalances}
          </div>
          <div className="text-[11px] text-[#5D594E] font-mono tabular-nums">
            {lang === 'uz' ? 'Admin balansidan tashqari' : 'Без учёта безлимита админа'}
          </div>
        </div>

        <div className="bg-white border border-[rgba(22,21,17,0.12)] rounded-2xl p-4 space-y-1">
          <span className="text-xs text-[#5D594E] block">
            {lang === 'uz' ? "Tasdiqlangan To'lovlar" : 'Одобренные оплаты'}
          </span>
          <div className="text-2xl font-bold text-[#161511] font-mono tabular-nums">
            {analyticsSummary.approvedPaymentsCount}
          </div>
          <div className="text-[11px] text-[#5D594E] font-mono tabular-nums">
            {lang === 'uz'
              ? `Kutilmoqda: ${analyticsSummary.pendingPaymentsCount} · +${analyticsSummary.totalCreditsPurchased} kr.`
              : `Ожидают: ${analyticsSummary.pendingPaymentsCount} · +${analyticsSummary.totalCreditsPurchased} кр.`}
          </div>
        </div>
      </div>

      {/* SECTION 1: ANALYTICS & OVERVIEW */}
      {activeSection === 'analytics' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            {/* Left 5 Cols: Feature Usage & Credit Spend Breakdown */}
            <div className="lg:col-span-5 bg-white border border-[rgba(22,21,17,0.12)] rounded-2xl p-5 flex flex-col justify-between space-y-4">
              <div className="space-y-1">
                <h2 className="text-base font-bold text-[#161511]">
                  {lang === 'uz'
                    ? "Yo'nalishlar bo'yicha kredit sarfi"
                    : 'Расход кредитов по инструментам'}
                </h2>
                <p className="text-xs text-[#5D594E]">
                  {lang === 'uz'
                    ? 'Foydalanuvchilar nima yaratayotgani va qaysi funksiyaga kredit sarflayotgani'
                    : 'Для чего пользователи тратят кредиты и что генерируют чаще всего'}
                </p>
              </div>

              <div className="space-y-4">
                {analyticsSummary.featureBreakdown.map((item) => (
                  <div key={item.key} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-[#161511]">
                        {lang === 'uz' ? item.labelUz : item.labelRu}
                      </span>
                      <span className="font-mono tabular-nums text-[#5D594E]">
                        {item.count} {lang === 'uz' ? 'ta' : 'ген.'} ·{' '}
                        <strong className="text-[#0E7C86]">{item.credits} kr.</strong> ({item.sharePct}%)
                      </span>
                    </div>
                    <div className="w-full h-2 bg-[#F4F1EA] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#0E7C86] rounded-full transition-all duration-300"
                        style={{ width: `${Math.max(item.count > 0 ? 6 : 0, item.sharePct)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-3 border-t border-[rgba(22,21,17,0.08)] flex items-center justify-between text-xs text-[#5D594E]">
                <span>
                  {lang === 'uz' ? 'Jami hisobga olingan operatsiyalar:' : 'Всего зафиксировано операций:'}
                </span>
                <button
                  type="button"
                  onClick={() => setActiveSection('generations')}
                  className="font-semibold text-[#0E7C86] hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <span>
                    {lang === 'uz' ? "To'liq ro'yxatni ko'rish" : 'Открыть полную историю'}
                  </span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Right 7 Cols: 14-Day Activity & Credit Spend Bar Chart */}
            <div className="lg:col-span-7 bg-white border border-[rgba(22,21,17,0.12)] rounded-2xl p-5 flex flex-col justify-between space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-bold text-[#161511]">
                    {lang === 'uz'
                      ? 'Soʻnggi 14 kunlik faollik dinamikasi'
                      : 'Динамика генераций и расхода кредитов (14 дней)'}
                  </h2>
                  <p className="text-xs text-[#5D594E]">
                    {lang === 'uz'
                      ? 'Kunlik yaratilgan materiallar soni va sarflangan kreditlar'
                      : 'Ежедневный объём генераций и списанных кредитов'}
                  </p>
                </div>

                <div className="flex items-center gap-1 p-1 bg-[#F4F1EA] rounded-lg border border-[rgba(22,21,17,0.08)] self-start">
                  <button
                    type="button"
                    onClick={() => setChartMetric('count')}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      chartMetric === 'count'
                        ? 'bg-white text-[#161511] shadow-2xs'
                        : 'text-[#5D594E] hover:text-[#161511]'
                    }`}
                  >
                    {lang === 'uz' ? 'Generatsiyalar soni' : 'По генерациям'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartMetric('credits')}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      chartMetric === 'credits'
                        ? 'bg-white text-[#161511] shadow-2xs'
                        : 'text-[#5D594E] hover:text-[#161511]'
                    }`}
                  >
                    {lang === 'uz' ? 'Sarflangan kreditlar' : 'По кредитам'}
                  </button>
                </div>
              </div>

              {/* Bar Chart Canvas */}
              <div className="h-44 flex items-end justify-between gap-1.5 pt-6 px-1 border-b border-[rgba(22,21,17,0.1)]">
                {analyticsSummary.dailySeries.map((day) => {
                  const val = chartMetric === 'count' ? day.count : day.credits;
                  const heightPct = val > 0 ? Math.max(12, Math.round((val / maxChartVal) * 100)) : 4;
                  return (
                    <div
                      key={day.dateKey}
                      className="flex-1 flex flex-col items-center justify-end h-full group"
                      title={`${day.dateKey}: ${day.count} gen. / ${day.credits} kr.`}
                    >
                      <span className="text-[10px] font-mono tabular-nums text-[#5D594E] mb-1 opacity-85">
                        {val > 0 ? val : ''}
                      </span>
                      <div
                        className={`w-full max-w-[26px] rounded-t-md transition-all ${
                          val > 0
                            ? 'bg-[#0E7C86] group-hover:bg-[#0A5A62]'
                            : 'bg-[#ECE7DB]'
                        }`}
                        style={{ height: `${heightPct}%` }}
                      />
                    </div>
                  );
                })}
              </div>

              {/* X-Axis Labels */}
              <div className="flex items-center justify-between gap-1 px-1">
                {analyticsSummary.dailySeries.map((day) => (
                  <div
                    key={day.dateKey}
                    className="flex-1 text-center text-[10px] font-mono tabular-nums text-[#5D594E] truncate"
                  >
                    {day.label}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Top Users by Credit Spend & Generations Table + Recent Generations Preview */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Top Users by Spend (7 cols) */}
            <div className="lg:col-span-7 bg-white border border-[rgba(22,21,17,0.12)] rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-[#161511]">
                    {lang === 'uz'
                      ? 'Foydalanuvchilar faolligi va kredit sarfi'
                      : 'Активность пользователей и расход кредитов'}
                  </h2>
                  <p className="text-xs text-[#5D594E]">
                    {lang === 'uz'
                      ? 'Kim qancha kredit ishlatgani, qancha qolgani va oxirgi faolligi'
                      : 'Кто сколько кредитов потратил, сколько осталось и когда генерировал'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveSection('users')}
                  className="text-xs font-semibold text-[#0E7C86] hover:underline cursor-pointer whitespace-nowrap"
                >
                  {lang === 'uz' ? 'Barcha mijozlar →' : 'Все пользователи →'}
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[rgba(22,21,17,0.1)] text-[#5D594E]">
                      <th className="py-2.5 pr-3 font-semibold">
                        {lang === 'uz' ? 'Foydalanuvchi' : 'Пользователь'}
                      </th>
                      <th className="py-2.5 px-3 font-semibold">
                        {lang === 'uz' ? 'Tarif' : 'Тариф'}
                      </th>
                      <th className="py-2.5 px-3 font-semibold text-right">
                        {lang === 'uz' ? 'Generatsiya' : 'Генераций'}
                      </th>
                      <th className="py-2.5 px-3 font-semibold text-right">
                        {lang === 'uz' ? 'Sarflandi' : 'Потрачено'}
                      </th>
                      <th className="py-2.5 px-3 font-semibold text-right">
                        {lang === 'uz' ? 'Qoldiq balans' : 'Остаток'}
                      </th>
                      <th className="py-2.5 pl-3 font-semibold text-right">
                        {lang === 'uz' ? 'Tarix' : 'История'}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[rgba(22,21,17,0.06)]">
                    {analyticsSummary.leaderboard.slice(0, 10).map((u) => (
                      <tr key={u.uid} className="hover:bg-[#F4F1EA]/60 transition-colors">
                        <td className="py-2.5 pr-3">
                          <div className="font-semibold text-[#161511] truncate max-w-[200px]">
                            {u.email}
                          </div>
                          <div className="text-[11px] text-[#5D594E] truncate">
                            {u.displayName}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-[#5D594E]">
                          {u.role === 'admin' ? 'ADMIN' : (u.tier || 'free').toUpperCase()}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-[#161511]">
                          {u.generationsCount}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-[#C4552D]">
                          {u.creditsSpent} kr.
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-[#0E7C86]">
                          {u.role === 'admin' ? '∞' : `${u.creditsRemaining} kr.`}
                        </td>
                        <td className="py-2.5 pl-3 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              setGenUserFilter(u.email);
                              setActiveSection('generations');
                            }}
                            className="text-xs font-semibold text-[#0E7C86] hover:underline cursor-pointer whitespace-nowrap"
                          >
                            {lang === 'uz' ? "Ko'rish" : 'Открыть'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Latest 8 Generations Live Feed (5 cols) */}
            <div className="lg:col-span-5 bg-white border border-[rgba(22,21,17,0.12)] rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-[#161511]">
                    {lang === 'uz' ? "So'nggi generatsiyalar oqimi" : 'Последние генерации пользователей'}
                  </h2>
                  <p className="text-xs text-[#5D594E]">
                    {lang === 'uz'
                      ? 'Real vaqtda kim nima yaratgani'
                      : 'Что именно генерировали пользователи в последнее время'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveSection('generations')}
                  className="text-xs font-semibold text-[#0E7C86] hover:underline cursor-pointer whitespace-nowrap"
                >
                  {lang === 'uz' ? 'Barchasi →' : 'Все записи →'}
                </button>
              </div>

              {generations.length === 0 ? (
                <div className="py-10 text-center text-xs text-[#5D594E] space-y-1">
                  <p>
                    {lang === 'uz'
                      ? "Hozircha generatsiyalar tarixi bo'sh."
                      : 'История генераций пока пуста.'}
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-[rgba(22,21,17,0.08)]">
                  {generations.slice(0, 8).map((g) => (
                    <div key={g.id} className="py-2.5 flex items-start justify-between gap-3 text-xs">
                      <div className="min-w-0 space-y-0.5">
                        <div className="font-semibold text-[#161511] truncate">
                          {g.title || getGenerationTypeLabel(g.type)}
                        </div>
                        <div className="text-[11px] text-[#5D594E] flex items-center gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() => {
                              setGenUserFilter(g.userEmail);
                              setActiveSection('generations');
                            }}
                            className="hover:underline text-[#0A5A62] font-medium cursor-pointer truncate max-w-[170px]"
                          >
                            {g.userEmail || g.userId}
                          </button>
                          <span aria-hidden="true">·</span>
                          <span>{getGenerationTypeLabel(g.type)}</span>
                        </div>
                      </div>

                      <div className="text-right shrink-0 font-mono tabular-nums">
                        <div className="font-bold text-[#C4552D]">-{g.creditsCost || 1} kr.</div>
                        <div className="text-[10px] text-[#7D7A70]">
                          {g.createdAt
                            ? new Date(g.createdAt).toLocaleString(lang === 'ru' ? 'ru-RU' : 'uz-UZ', {
                                day: '2-digit',
                                month: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : ''}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SECTION 2: FULL GENERATIONS HISTORY & CREDIT SPEND LOG */}
      {activeSection === 'generations' && (
        <div className="bg-white border border-[rgba(22,21,17,0.12)] rounded-2xl p-5 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-[#161511]">
                {lang === 'uz'
                  ? 'Barcha Foydalanuvchilar Generatsiyalari va Kredit Sarfi Tarixi'
                  : 'Полная история генераций и расхода кредитов пользователями'}
              </h2>
              <p className="text-xs text-[#5D594E]">
                {lang === 'uz'
                  ? `Topildi: ${filteredGenerations.length} ta operatsiya · Jami sarflangan: ${filteredGenerations.reduce((a, b) => a + Number(b.creditsCost || 1), 0)} kredit`
                  : `Найдено записей: ${filteredGenerations.length} · Суммарно потрачено по фильтру: ${filteredGenerations.reduce((a, b) => a + Number(b.creditsCost || 1), 0)} кредитов`}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Search by Email or Title */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-[#5D594E] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={genSearchQuery}
                  onChange={(e) => setGenSearchQuery(e.target.value)}
                  placeholder={
                    lang === 'uz'
                      ? 'Email yoki matn qidirish...'
                      : 'Поиск по email или тексту...'
                  }
                  className="bg-[#F4F1EA] text-xs text-[#161511] pl-8 pr-3 py-2 rounded-xl border border-[rgba(22,21,17,0.12)] outline-none focus:border-[#0E7C86] w-60"
                />
              </div>

              {/* Filter by Type */}
              <select
                value={genTypeFilter}
                onChange={(e) => setGenTypeFilter(e.target.value)}
                className="bg-[#F4F1EA] text-xs text-[#161511] px-3 py-2 rounded-xl border border-[rgba(22,21,17,0.12)] outline-none cursor-pointer"
              >
                <option value="all">
                  {lang === 'uz' ? 'Barcha turlar' : 'Все типы генераций'}
                </option>
                <option value="podcast_tts">
                  {lang === 'uz' ? 'Podkast & TTS' : 'Подкаст и TTS'}
                </option>
                <option value="agent_call">
                  {lang === 'uz' ? 'AI Qoʻngʻiroq (Taksi / Rieltor)' : 'AI Голосовой Звонок'}
                </option>
                <option value="dubbing_voiceover">
                  {lang === 'uz' ? 'Video Dublyaj & Voiceover' : 'Видео Дубляж и Закадровый'}
                </option>
              </select>

              {/* Filter by User Dropdown */}
              <select
                value={genUserFilter}
                onChange={(e) => setGenUserFilter(e.target.value)}
                className="bg-[#F4F1EA] text-xs text-[#161511] px-3 py-2 rounded-xl border border-[rgba(22,21,17,0.12)] outline-none max-w-[210px] truncate cursor-pointer"
              >
                <option value="">
                  {lang === 'uz' ? 'Barcha foydalanuvchilar' : 'Все пользователи'}
                </option>
                {users.map((u) => (
                  <option key={u.uid} value={u.email}>
                    {u.email}
                  </option>
                ))}
              </select>

              {(genUserFilter || genSearchQuery || genTypeFilter !== 'all') && (
                <button
                  type="button"
                  onClick={() => {
                    setGenUserFilter('');
                    setGenSearchQuery('');
                    setGenTypeFilter('all');
                  }}
                  className="px-3 py-2 rounded-xl border border-[rgba(22,21,17,0.14)] text-xs font-semibold text-[#C4552D] hover:bg-[#C4552D]/5 cursor-pointer whitespace-nowrap"
                >
                  {lang === 'uz' ? 'Filtrni tozalash' : 'Сбросить фильтр'}
                </button>
              )}

              <button
                type="button"
                onClick={handleExportGenerationsCsv}
                disabled={filteredGenerations.length === 0}
                className="px-3.5 py-2 rounded-xl bg-[#161511] text-[#F4F1EA] hover:bg-[#0A5A62] text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-40"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{lang === 'uz' ? 'CSV yuklab olish' : 'Скачать CSV'}</span>
              </button>
            </div>
          </div>

          {/* Generations High-Density Table */}
          {filteredGenerations.length === 0 ? (
            <div className="py-12 text-center text-xs text-[#5D594E] border border-dashed border-[rgba(22,21,17,0.14)] rounded-xl">
              {lang === 'uz'
                ? "Ushbu filtr bo'yicha generatsiyalar topilmadi."
                : 'По выбранным фильтрам записей генерации не найдено.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[rgba(22,21,17,0.12)] text-[#5D594E]">
                    <th className="py-3 pr-3 font-semibold">
                      {lang === 'uz' ? 'Sana va vaqt' : 'Дата и время'}
                    </th>
                    <th className="py-3 px-3 font-semibold">
                      {lang === 'uz' ? 'Foydalanuvchi (Email)' : 'Пользователь (Email)'}
                    </th>
                    <th className="py-3 px-3 font-semibold">
                      {lang === 'uz' ? "Yo'nalish / Tur" : 'Инструмент / Тип'}
                    </th>
                    <th className="py-3 px-3 font-semibold">
                      {lang === 'uz' ? 'Nima generatsiya qilindi (Mavzu / Matn)' : 'Что генерировали (Тема / Скрипт)'}
                    </th>
                    <th className="py-3 px-3 font-semibold text-right">
                      {lang === 'uz' ? 'Kredit sarfi' : 'Расход кредитов'}
                    </th>
                    <th className="py-3 pl-3 font-semibold text-right">
                      {lang === 'uz' ? 'Holat' : 'Статус'}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgba(22,21,17,0.06)]">
                  {filteredGenerations.map((g) => (
                    <tr key={g.id} className="hover:bg-[#F4F1EA]/60 transition-colors">
                      <td className="py-3 pr-3 font-mono tabular-nums text-[11px] text-[#5D594E] whitespace-nowrap">
                        {g.createdAt
                          ? new Date(g.createdAt).toLocaleString(lang === 'ru' ? 'ru-RU' : 'uz-UZ', {
                              year: 'numeric',
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })
                          : '—'}
                      </td>
                      <td className="py-3 px-3">
                        <button
                          type="button"
                          onClick={() => setGenUserFilter(g.userEmail)}
                          className="font-semibold text-[#0A5A62] hover:underline cursor-pointer truncate max-w-[220px] block"
                          title={lang === 'uz' ? 'Shu mijoz boʻyicha filtrlash' : 'Фильтровать по этому пользователю'}
                        >
                          {g.userEmail || g.userId}
                        </button>
                      </td>
                      <td className="py-3 px-3 text-[#161511] whitespace-nowrap">
                        {getGenerationTypeLabel(g.type)}
                      </td>
                      <td className="py-3 px-3 text-[#161511] max-w-md">
                        <div className="font-medium break-words">{g.title || '—'}</div>
                        {(g.voiceName || g.details) && (
                          <div className="text-[11px] text-[#5D594E] mt-0.5">
                            {[g.voiceName, g.details].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-[#C4552D] whitespace-nowrap">
                        -{g.creditsCost || 1} kr.
                      </td>
                      <td className="py-3 pl-3 text-right font-mono text-[11px] whitespace-nowrap">
                        <span
                          className={
                            g.status === 'failed' ? 'text-[#C4552D] font-semibold' : 'text-[#0E7C86] font-semibold'
                          }
                        >
                          {g.status === 'failed'
                            ? lang === 'uz'
                              ? 'Xatolik'
                              : 'Ошибка'
                            : lang === 'uz'
                            ? 'Bajarildi'
                            : 'Успешно'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* SECTION 3: USERS & CREDIT BALANCE MANAGEMENT */}
      {activeSection === 'users' && (
        <div className="space-y-6">
          {/* Manual Credit Grant Bar */}
          <form
            onSubmit={handleManualGrantSubmit}
            className="bg-white border border-[rgba(22,21,17,0.12)] rounded-2xl p-5 space-y-3"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-[#161511]">
                  {lang === 'uz'
                    ? "Foydalanuvchiga kredit qo'shish va tarifni faollashtirish"
                    : 'Начислить кредиты пользователю и активировать тариф'}
                </h2>
                <p className="text-xs text-[#5D594E]">
                  {lang === 'uz'
                    ? "Email orqali mavjud yoki yangi foydalanuvchiga darhol kredit qo'shish"
                    : 'Начисление работает мгновенно (даже если пользователь ещё не вошёл в аккаунт)'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
              <input
                type="email"
                value={manualEmail}
                onChange={(e) => setManualEmail(e.target.value)}
                placeholder={lang === 'uz' ? 'Foydalanuvchi emaili...' : 'Email пользователя...'}
                className="bg-[#F4F1EA] text-xs text-[#161511] px-3.5 py-2.5 rounded-xl border border-[rgba(22,21,17,0.14)] outline-none focus:border-[#0E7C86]"
              />

              <select
                value={manualCredits}
                onChange={(e) => setManualCredits(Number(e.target.value))}
                className="bg-[#F4F1EA] text-xs text-[#161511] px-3.5 py-2.5 rounded-xl border border-[rgba(22,21,17,0.14)] outline-none cursor-pointer"
              >
                <option value={10}>+10 {lang === 'uz' ? 'kredit (Test)' : 'кредитов (Тест)'}</option>
                <option value={25}>+25 {lang === 'uz' ? 'kredit (Start)' : 'кредитов (Start)'}</option>
                <option value={100}>+100 {lang === 'uz' ? 'kredit (Pro)' : 'кредитов (Pro)'}</option>
                <option value={350}>+350 {lang === 'uz' ? 'kredit (VIP)' : 'кредитов (VIP)'}</option>
                <option value={1000}>+1000 {lang === 'uz' ? 'kredit (Korporativ)' : 'кредитов (Корпоративный)'}</option>
              </select>

              <select
                value={manualTier}
                onChange={(e) => setManualTier(e.target.value as 'free' | 'pro' | 'unlimited')}
                className="bg-[#F4F1EA] text-xs text-[#161511] px-3.5 py-2.5 rounded-xl border border-[rgba(22,21,17,0.14)] outline-none cursor-pointer"
              >
                <option value="free">FREE</option>
                <option value="pro">PRO</option>
                <option value="unlimited">UNLIMITED (VIP)</option>
              </select>

              <button
                type="submit"
                disabled={Boolean(grantingEmail)}
                className="px-4 py-2.5 rounded-xl bg-[#0E7C86] hover:bg-[#0A5A62] text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                <span>{lang === 'uz' ? 'Kredit berish' : 'Начислить кредиты'}</span>
              </button>
            </div>
          </form>

          {/* Users Directory Table */}
          <div className="bg-white border border-[rgba(22,21,17,0.12)] rounded-2xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-[#161511]">
                  {lang === 'uz'
                    ? `Ro'yxatdan o'tgan foydalanuvchilar (${filteredUsers.length})`
                    : `Зарегистрированные пользователи (${filteredUsers.length})`}
                </h2>
                <p className="text-xs text-[#5D594E]">
                  {lang === 'uz'
                    ? 'Har bir mijozning kredit sarfi, qoldiq balansi va tezkor boshqaruv'
                    : 'Полная статистика по каждому аккаунту: сколько сгенерировал, сколько потратил и остаток кредитов'}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-[#5D594E] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={userSearchQuery}
                    onChange={(e) => setUserSearchQuery(e.target.value)}
                    placeholder={lang === 'uz' ? 'Email qidirish...' : 'Поиск по email или имени...'}
                    className="bg-[#F4F1EA] text-xs text-[#161511] pl-8 pr-3 py-2 rounded-xl border border-[rgba(22,21,17,0.12)] outline-none focus:border-[#0E7C86] w-56"
                  />
                </div>

                <select
                  value={userTierFilter}
                  onChange={(e) => setUserTierFilter(e.target.value)}
                  className="bg-[#F4F1EA] text-xs text-[#161511] px-3 py-2 rounded-xl border border-[rgba(22,21,17,0.12)] outline-none cursor-pointer"
                >
                  <option value="all">{lang === 'uz' ? 'Barcha tariflar' : 'Все тарифы'}</option>
                  <option value="free">FREE</option>
                  <option value="pro">PRO</option>
                  <option value="unlimited">UNLIMITED</option>
                  <option value="admin">ADMIN</option>
                </select>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[rgba(22,21,17,0.12)] text-[#5D594E]">
                    <th className="py-3 pr-3 font-semibold">
                      {lang === 'uz' ? 'Email / Ism' : 'Email / Имя'}
                    </th>
                    <th className="py-3 px-3 font-semibold">
                      {lang === 'uz' ? 'Tarif' : 'Тариф'}
                    </th>
                    <th className="py-3 px-3 font-semibold text-right">
                      {lang === 'uz' ? 'Generatsiyalar' : 'Генераций'}
                    </th>
                    <th className="py-3 px-3 font-semibold text-right">
                      {lang === 'uz' ? 'Sarflangan kredit' : 'Потрачено кредитов'}
                    </th>
                    <th className="py-3 px-3 font-semibold text-right">
                      {lang === 'uz' ? 'Joriy Balans' : 'Текущий баланс'}
                    </th>
                    <th className="py-3 px-3 font-semibold">
                      {lang === 'uz' ? 'Oxirgi faollik' : 'Активность'}
                    </th>
                    <th className="py-3 pl-3 font-semibold text-right">
                      {lang === 'uz' ? 'Amallar' : 'Управление'}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgba(22,21,17,0.06)]">
                  {filteredUsers.map((u) => {
                    const isEditing = editingUserEmail === u.email;
                    return (
                      <tr key={u.uid} className="hover:bg-[#F4F1EA]/60 transition-colors">
                        <td className="py-3 pr-3">
                          <div className="font-semibold text-[#161511]">{u.email}</div>
                          <div className="text-[11px] text-[#5D594E]">{u.displayName}</div>
                        </td>
                        <td className="py-3 px-3 font-mono text-[11px]">
                          {isEditing ? (
                            <select
                              value={editTierVal}
                              onChange={(e) =>
                                setEditTierVal(e.target.value as 'free' | 'pro' | 'unlimited')
                              }
                              className="bg-white border border-[rgba(22,21,17,0.2)] rounded-lg px-2 py-1 text-xs"
                            >
                              <option value="free">FREE</option>
                              <option value="pro">PRO</option>
                              <option value="unlimited">UNLIMITED</option>
                            </select>
                          ) : (
                            <span className="font-semibold text-[#161511]">
                              {u.role === 'admin' ? 'ADMIN (VIP)' : (u.tier || 'free').toUpperCase()}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-[#161511]">
                          {u.generationsCount}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-[#C4552D]">
                          {u.creditsSpent} kr.
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-[#0E7C86]">
                          {isEditing ? (
                            <input
                              type="number"
                              min={0}
                              value={editCreditsVal}
                              onChange={(e) => setEditCreditsVal(Number(e.target.value))}
                              className="w-24 bg-white border border-[rgba(22,21,17,0.2)] rounded-lg px-2 py-1 text-right text-xs font-mono"
                            />
                          ) : u.role === 'admin' ? (
                            '∞ Cheksiz'
                          ) : (
                            `${u.creditsRemaining} kr.`
                          )}
                        </td>
                        <td className="py-3 px-3 font-mono tabular-nums text-[11px] text-[#5D594E] whitespace-nowrap">
                          {u.lastActiveAt
                            ? new Date(u.lastActiveAt).toLocaleDateString(
                                lang === 'ru' ? 'ru-RU' : 'uz-UZ'
                              )
                            : '—'}
                        </td>
                        <td className="py-3 pl-3 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            {isEditing ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleSaveUserEdit(u.email)}
                                  className="px-2.5 py-1 rounded-lg bg-[#0E7C86] text-white text-[11px] font-semibold cursor-pointer"
                                >
                                  {lang === 'uz' ? 'Saqlash' : 'Сохранить'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingUserEmail(null)}
                                  className="px-2 py-1 rounded-lg border border-[rgba(22,21,17,0.14)] text-[11px] text-[#5D594E] cursor-pointer"
                                >
                                  {lang === 'uz' ? 'Bekor' : 'Отмена'}
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleQuickGrant(u.email, 25)}
                                  disabled={grantingEmail === u.email}
                                  className="px-2 py-1 rounded-lg bg-[#F4F1EA] hover:bg-[#0E7C86] hover:text-white border border-[rgba(22,21,17,0.12)] font-mono text-[11px] font-semibold transition-colors cursor-pointer"
                                >
                                  +25
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleQuickGrant(u.email, 100)}
                                  disabled={grantingEmail === u.email}
                                  className="px-2 py-1 rounded-lg bg-[#0E7C86]/10 hover:bg-[#0E7C86] text-[#0A5A62] hover:text-white border border-[#0E7C86]/30 font-mono text-[11px] font-bold transition-colors cursor-pointer"
                                >
                                  +100
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleQuickGrant(u.email, 350)}
                                  disabled={grantingEmail === u.email}
                                  className="px-2 py-1 rounded-lg bg-[#161511] hover:bg-[#0A5A62] text-[#F4F1EA] font-mono text-[11px] font-semibold transition-colors cursor-pointer"
                                >
                                  +350
                                </button>
                                {u.role !== 'admin' && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingUserEmail(u.email);
                                      setEditCreditsVal(u.creditsRemaining || 0);
                                      setEditTierVal(
                                        (u.tier as 'free' | 'pro' | 'unlimited') || 'free'
                                      );
                                    }}
                                    className="p-1.5 rounded-lg hover:bg-black/5 text-[#5D594E] cursor-pointer"
                                    title={
                                      lang === 'uz'
                                        ? 'Balans va tarifni tahrirlash'
                                        : 'Изменить точный баланс и тариф'
                                    }
                                  >
                                    <Edit3 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setGenUserFilter(u.email);
                                    setActiveSection('generations');
                                  }}
                                  className="px-2.5 py-1 rounded-lg border border-[rgba(22,21,17,0.14)] hover:border-[#0E7C86] text-[11px] font-semibold text-[#0E7C86] cursor-pointer"
                                >
                                  {lang === 'uz'
                                    ? `Tarix (${u.generationsCount})`
                                    : `История (${u.generationsCount})`}
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 4: PAYMENT REQUESTS & BILLING */}
      {activeSection === 'payments' && (
        <div className="bg-white border border-[rgba(22,21,17,0.12)] rounded-2xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-[#161511]">
                {lang === 'uz'
                  ? `To'lov So'rovlari va Kvitansiyalar (${filteredPaymentRequests.length})`
                  : `Заявки на оплату и пополнение кредитов (${filteredPaymentRequests.length})`}
              </h2>
              <p className="text-xs text-[#5D594E]">
                {lang === 'uz'
                  ? 'Mijozlardan kelib tushgan karta, Payme, Click va Uzum soʻrovlarini tasdiqlash'
                  : 'Проверка платежей и автоматическое зачисление пакета кредитов в 1 клик'}
              </p>
            </div>

            <div className="flex items-center gap-1 p-1 bg-[#F4F1EA] rounded-xl border border-[rgba(22,21,17,0.08)]">
              {[
                { id: 'all', labelUz: 'Barchasi', labelRu: 'Все' },
                { id: 'pending', labelUz: 'Kutilmoqda', labelRu: 'Ожидают' },
                { id: 'approved', labelUz: 'Tasdiqlangan', labelRu: 'Одобрены' },
                { id: 'rejected', labelUz: 'Rad etilgan', labelRu: 'Отклонены' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setPaymentStatusFilter(tab.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                    paymentStatusFilter === tab.id
                      ? 'bg-white text-[#161511] shadow-2xs'
                      : 'text-[#5D594E] hover:text-[#161511]'
                  }`}
                >
                  {lang === 'uz' ? tab.labelUz : tab.labelRu}
                </button>
              ))}
            </div>
          </div>

          {filteredPaymentRequests.length === 0 ? (
            <div className="py-12 text-center text-xs text-[#5D594E] border border-dashed border-[rgba(22,21,17,0.14)] rounded-xl">
              {lang === 'uz'
                ? "Ushbu holat bo'yicha to'lov so'rovlari yo'q."
                : 'Заявок на оплату в этой категории нет.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[rgba(22,21,17,0.12)] text-[#5D594E]">
                    <th className="py-3 pr-3 font-semibold">
                      {lang === 'uz' ? 'Sana' : 'Дата'}
                    </th>
                    <th className="py-3 px-3 font-semibold">
                      {lang === 'uz' ? 'Foydalanuvchi' : 'Пользователь'}
                    </th>
                    <th className="py-3 px-3 font-semibold">
                      {lang === 'uz' ? 'Paket / Kredit' : 'Пакет / Кредиты'}
                    </th>
                    <th className="py-3 px-3 font-semibold">
                      {lang === 'uz' ? 'Summa & Usul' : 'Сумма и метод'}
                    </th>
                    <th className="py-3 px-3 font-semibold">
                      {lang === 'uz' ? "Chek / Izoh ma'lumoti" : 'Чек / Комментарий'}
                    </th>
                    <th className="py-3 px-3 font-semibold">
                      {lang === 'uz' ? 'Holat' : 'Статус'}
                    </th>
                    <th className="py-3 pl-3 font-semibold text-right">
                      {lang === 'uz' ? 'Tasdiqlash' : 'Действие'}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgba(22,21,17,0.06)]">
                  {filteredPaymentRequests.map((req) => (
                    <tr key={req.id} className="hover:bg-[#F4F1EA]/60 transition-colors">
                      <td className="py-3 pr-3 font-mono tabular-nums text-[11px] text-[#5D594E] whitespace-nowrap">
                        {req.createdAt
                          ? new Date(req.createdAt).toLocaleString(lang === 'ru' ? 'ru-RU' : 'uz-UZ', {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : '—'}
                      </td>
                      <td className="py-3 px-3 font-semibold text-[#161511]">
                        {req.userEmail}
                      </td>
                      <td className="py-3 px-3 font-mono tabular-nums">
                        <span className="font-semibold text-[#161511]">{req.planName}</span>
                        <span className="text-[#0E7C86] font-bold ml-1.5">+{req.credits} kr.</span>
                      </td>
                      <td className="py-3 px-3 font-mono tabular-nums">
                        <span className="font-bold text-[#161511]">{req.price}</span>
                        <span className="text-[#5D594E] ml-1.5 uppercase">{req.paymentMethod}</span>
                      </td>
                      <td className="py-3 px-3 text-[#5D594E] max-w-xs truncate">
                        {req.receiptInfo || req.notes || '—'}
                      </td>
                      <td className="py-3 px-3 font-mono text-[11px] font-semibold">
                        {req.status === 'approved' ? (
                          <span className="text-[#0E7C86]">
                            {lang === 'uz' ? 'Tasdiqlangan' : 'Одобрено'}
                          </span>
                        ) : req.status === 'rejected' ? (
                          <span className="text-[#C4552D]">
                            {lang === 'uz' ? 'Rad etilgan' : 'Отклонено'}
                          </span>
                        ) : (
                          <span className="text-[#C98A12]">
                            {lang === 'uz' ? 'Kutilmoqda' : 'Ожидает'}
                          </span>
                        )}
                      </td>
                      <td className="py-3 pl-3 text-right whitespace-nowrap">
                        {req.status === 'pending' ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleApprovePayment(req)}
                              className="px-3 py-1.5 rounded-lg bg-[#0E7C86] hover:bg-[#0A5A62] text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>{lang === 'uz' ? 'Tasdiqlash' : 'Одобрить'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRejectPayment(req.id)}
                              className="p-1.5 rounded-lg border border-[rgba(22,21,17,0.14)] text-[#5D594E] hover:text-[#C4552D] hover:border-[#C4552D] cursor-pointer"
                              title={lang === 'uz' ? 'Rad etish' : 'Отклонить'}
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-[#7D7A70] font-mono">
                            {req.approvedBy || '—'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
