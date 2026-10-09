import React, { useState, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { authFetch } from '../utils/authFetch';
import { VoiceProfile, ExclusiveEpisode } from '../types/podcast';
import {
  Crown,
  Sparkles,
  Download,
  Image as ImageIcon,
  Palette,
  Play,
  Pause,
  Layers,
  FileCode,
  Share2,
  Lock,
  CheckCircle2,
  Tv,
  Wand2,
  Zap,
  Wind,
  Plus,
  FileText,
  Volume2,
  Copy,
  Check,
  X,
  Trash2,
} from 'lucide-react';

interface ExclusiveProductionHubProps {
  voices: VoiceProfile[];
  userClonedVoiceId: string;
  lang: 'uz' | 'ru';
}

export const ExclusiveProductionHub: React.FC<ExclusiveProductionHubProps> = ({
  voices,
  userClonedVoiceId,
  lang,
}) => {
  const { isAuthenticated, isAdmin, requireAuth } = useAuth();

  // VIP Custom Script Studio State
  const [vipTopic, setVipTopic] = useState("O'zbekistonda Texnologik Inqilob: 2030-yilgi Startaplar");
  const [vipDuration, setVipDuration] = useState("15 daqiqa");
  const [vipMood, setVipMood] = useState("G'urur & Kulminatsiya");
  const [vipScriptText, setVipScriptText] = useState(
    "[KIRISH]\nAssalomu alaykum, aziz tinglovchilar! <breath> Bugungi VIP maxsus sonimizda biz kelajak haqida suhbatlashamiz. |ha| Tasavvur qiling, 2030-yil...\n\n[ASOSIY QISM]\n<breath> Sun'iy intellekt va yoshlarimizning salohiyati aqlbovar qilmas darajaga yetdi. [Pauza 1s] |bilasizmi| Har bir katta muvaffaqiyat ortida mustahkam iroda turadi.\n\n[KULMINATSIYA]\n[Kulminatsiya] [Gʻurur] <deep_breath> Bizning eng katta boyligimiz — bu bilim va orzularga bo'lgan cheksiz ishonchdir! [Pauza 1s]\n\n[XULOSA]\n<sigh> O'zingizga ishoning va yangi marralarni zabt eting. Rahmat!"
  );
  const [isGeneratingVipScript, setIsGeneratingVipScript] = useState(false);
  const [isEnrichingVip, setIsEnrichingVip] = useState(false);
  const [vipNotice, setVipNotice] = useState<string | null>(null);
  const [isSynthesizingVip, setIsSynthesizingVip] = useState(false);
  const [vipAudioBase64, setVipAudioBase64] = useState<string | null>(null);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>(userClonedVoiceId || voices[0]?.id || 'Charon');

  // Cover Art Generator State
  const [coverTitle, setCoverTitle] = useState('O\'zbekiston 2030: Texnologik Inqilob');
  const [coverCategory, setCoverCategory] = useState('EKSKLYUZIV VIP');
  const [coverTags, setCoverTags] = useState('AI, Texnologiya, Kelajak, Toshkent');
  const [isGeneratingCover, setIsGeneratingCover] = useState(false);
  const [generatedSvg, setGeneratedSvg] = useState<string | null>(null);

  // Default Exclusive Episodes List (Full 30-min to 60-min longform master episodes)
  const [exclusiveEpisodes, setExclusiveEpisodes] = useState<ExclusiveEpisode[]>([
    {
      id: 'ex-1',
      title: 'Buyuk Ipak Yo\'li: Yo\'qolgan Karvonlar va Maxfiy Xazinalar',
      tier: 'vip',
      description: 'Samarqand va Buxoro o\'rtasidagi sirli karvonsaroylar arxeologiyasi haqida 30 daqiqalik 3D audio-ekskursiya.',
      tags: ['Tarix', 'Sirli', 'VIP', 'Arxeologiya', '30Daqiqa'],
      durationSeconds: 1800,
      createdAt: 'Bugun',
    },
    {
      id: 'ex-2',
      title: 'O\'zbekistonda AI Startaplar: 0 dan 100,000$ gacha bo\'lgan yo\'l',
      tier: 'masterclass',
      description: 'Mahalliy muhandislar tomonidan yaratilgan muvaffaqiyatli loyihalar va amaliy audio-keyslar (45 daqiqalik to\'liq son).',
      tags: ['Biznes', 'Masterclass', 'AI', 'Startap', '45Daqiqa'],
      durationSeconds: 2700,
      createdAt: 'Kecha',
    },
    {
      id: 'ex-3',
      title: 'Miyaning Yashirin Zaxiralari: Daho Allomalar Qanday Fikrlagan?',
      tier: 'vip',
      description: 'Ibn Sino va Beruniyning xotirani charxlash va diqqatni jamlash bo\'yicha 1 soatlik fundamental podkast tahlili.',
      tags: ['Ilm-fan', 'Psixologiya', 'IbnSino', 'VIP', '1Soat'],
      durationSeconds: 3600,
      createdAt: '2 kun oldin',
    },
  ]);

  const [activePlayingId, setActivePlayingId] = useState<string | null>(null);

  // Generate SVG Cover Art
  const handleGenerateCover = async () => {
    if (
      !requireAuth(
        () => {},
        lang === 'uz'
          ? "Eksklyuziv muqova generatsiyasi faqat ro'yxatdan o'tgan foydalanuvchilar uchun ochiq. Avval kiring!"
          : "Создание эксклюзивных обложек доступно только для зарегистрированных пользователей."
      )
    )
      return;

    setIsGeneratingCover(true);
    try {
      const res = await authFetch('/api/podcast/generate-cover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: coverTitle,
          category: coverCategory,
          tags: coverTags.split(',').map((t) => t.trim()),
        }),
      });

      if (!res.ok) throw new Error('Muqova yaratishda xatolik');
      const data = await res.json();
      if (data.svg) {
        setGeneratedSvg(data.svg);
      }
    } catch (e: any) {
      alert(`Xatolik: ${e.message}`);
    } finally {
      setIsGeneratingCover(false);
    }
  };

  const downloadSvg = () => {
    if (!generatedSvg) return;
    const blob = new Blob([generatedSvg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `podcast-cover-${Date.now()}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Generate VIP Script via AI on any topic
  const handleGenerateVipScript = async () => {
    if (
      !requireAuth(
        () => {},
        lang === 'uz'
          ? "VIP Ssenariy yaratish faqat ro'yxatdan o'tgan foydalanuvchilar uchun ochiq."
          : "Генерация VIP сценариев доступна только для зарегистрированных пользователей."
      )
    )
      return;

    setIsGeneratingVipScript(true);
    try {
      const res = await authFetch('/api/podcast/generate-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: vipTopic,
          category: 'Eksklyuziv VIP Masterclass',
          targetDuration: vipDuration,
          speechStyle: vipMood,
          customInstructions:
            "VIP Masterclass darajasidagi chuqur tahlil, kulminatsiya, emotsiyalar va 30-40% tabiiy inson nafasi va pauzalari bilan yozilsin.",
        }),
      });
      if (!res.ok) throw new Error('VIP Ssenariy yaratishda xato');
      const data = await res.json();
      if (data.script) {
        setVipScriptText(data.script);
        if (data.title) setCoverTitle(data.title);
        setVipNotice(
          lang === 'uz'
            ? '✨ VIP Ssenariy muvaffaqiyatli yaratildi (Kulminatsiya va 30-40% jonli teglar bilan)!'
            : '✨ VIP Сценарий успешно создан (с кульминацией и эмоциями)!'
        );
        setTimeout(() => setVipNotice(null), 5000);
      }
    } catch (e: any) {
      alert(`Xatolik: ${e.message}`);
    } finally {
      setIsGeneratingVipScript(false);
    }
  };

  // Enrich VIP Script with Emotions & Living Speech
  const handleEnrichVipScript = async () => {
    if (!vipScriptText.trim()) return;
    setIsEnrichingVip(true);
    try {
      const res = await authFetch('/api/podcast/enrich-emotions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: vipScriptText,
          mood: vipMood,
        }),
      });
      if (!res.ok) throw new Error('Jonlantirishda xato');
      const data = await res.json();
      if (data.enrichedText) {
        setVipScriptText(data.enrichedText);
        setVipNotice(
          lang === 'uz'
            ? "✨ Matn jonlantirildi: 30-40% nafas, pauza, kulminatsiya va emotsiyalar qo'shildi!"
            : '✨ Текст оживлен: добавлены дыхание, паузы и кульминация!'
        );
        setTimeout(() => setVipNotice(null), 5000);
      }
    } catch (e: any) {
      alert(`Xatolik: ${e.message}`);
    } finally {
      setIsEnrichingVip(false);
    }
  };

  // Insert cue into VIP script
  const insertVipCue = (cue: string) => {
    setVipScriptText((prev) => (prev ? `${prev} ${cue}` : cue));
  };

  // Real-time Living Cue Statistics (30-40% Target)
  const livingCueStats = useMemo(() => {
    const breathCount = (vipScriptText.match(/<(?:breath|deep_breath|sigh|gasp)>/gi) || []).length;
    const pauseCount = (vipScriptText.match(/\[(?:pauza|pause|пауза|jimlik)[^\]]*\]/gi) || []).length;
    const emotionCount = (vipScriptText.match(/\[(?:kulminatsiya|kulminasiya|hayajon|g'urur|gʻurur|sokin|jiddiy|pichirlash|shivir)[^\]]*\]|<laugh>|\([^\)]*(?:kulimsirab|tabassum)[^\)]*\)/gi) || []).length;
    const uzbekFillerCount = (vipScriptText.match(/\|(?:ha|mhm|xoʻsh|xosh|voy|rosti|bilasizmi|albatta)\|/gi) || []).length;
    const total = breathCount + pauseCount + emotionCount + uzbekFillerCount;
    return {
      breathCount,
      pauseCount,
      emotionCount,
      uzbekFillerCount,
      total,
    };
  }, [vipScriptText]);

  // Auto-inject Breaths for custom user text (30% natural breathing)
  const handleAutoInjectBreaths = () => {
    if (!vipScriptText.trim()) return;
    const sentences = vipScriptText.split(/(?<=[.?!])\s+/);
    if (sentences.length <= 1) {
      setVipScriptText(`<breath> ${vipScriptText.trim()}`);
      return;
    }
    const withBreaths = sentences
      .map((s, idx) => {
        const clean = s.trim();
        if (!clean) return '';
        if (clean.includes('<breath>') || clean.includes('<deep_breath>')) return clean;
        if (idx === 0) return `<breath> ${clean}`;
        if (idx % 2 === 0) return `<breath> ${clean}`;
        return clean;
      })
      .filter(Boolean)
      .join(' ');
    setVipScriptText(withBreaths);
    setVipNotice(
      lang === 'uz'
        ? "🌬️ Matnga har 1-2 gap orasiga tabiiy nafas belgilari (<breath>) qo'shildi!"
        : "🌬️ В текст добавлено естественное дыхание (<breath>)!"
    );
    setTimeout(() => setVipNotice(null), 4000);
  };

  const handleClearVipText = () => {
    setVipScriptText('');
    setVipTopic('');
  };

  // Synthesize VIP Audio
  const handleSynthesizeVip = async () => {
    if (
      !requireAuth(
        () => {},
        lang === 'uz'
          ? "Ovoz berish faqat ro'yxatdan o'tgan foydalanuvchilar uchun ochiq."
          : "Синтез речи доступен только авторизованным пользователям."
      )
    )
      return;

    if (!vipScriptText.trim()) return;
    setIsSynthesizingVip(true);
    try {
      const activeVoice = voices.find((v) => v.id === selectedVoiceId) || voices[0];
      const res = await authFetch('/api/podcast/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: vipScriptText,
          voiceProfile: activeVoice,
          speechStyle: vipMood,
        }),
      });
      if (!res.ok) throw new Error('Ovoz sintezida xato');
      const data = await res.json();
      if (data.audioBase64) {
        setVipAudioBase64(data.audioBase64);
        setVipNotice(
          lang === 'uz'
            ? `🎙️ VIP Ovoz muvaffaqiyatli sintezlandi (${data.durationSeconds}s, 24kHz HD)!`
            : `🎙️ VIP Аудио готово (${data.durationSeconds}с, 24kHz HD)!`
        );
        setTimeout(() => setVipNotice(null), 5000);
      }
    } catch (e: any) {
      alert(`Xatolik: ${e.message}`);
    } finally {
      setIsSynthesizingVip(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="border border-[rgba(22,21,17,0.14)] rounded-[22px] bg-[rgba(255,255,255,0.65)] backdrop-blur-md p-6 sm:p-7 shadow-[0_20px_40px_-20px_rgba(22,21,17,0.18)]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-3 py-1 rounded-full bg-[#C98A12]/10 text-[#C98A12] text-xs font-semibold border border-[#C98A12]/30 flex items-center gap-1.5">
                <Crown className="w-3.5 h-3.5" />
                {lang === 'uz' ? 'Eksklyuziv Podkastlar & Production Hub' : 'Эксклюзивные Выпуски & Production Hub'}
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-[#0E7C86]/10 text-[#0A5A62] text-xs font-mono border border-[#0E7C86]/30">
                VIP / Masterclass · Cover Art Studio
              </span>
            </div>
            <h1 className="font-serif text-2xl sm:text-3xl text-[#161511] tracking-tight">
              {lang === 'uz' ? 'Eksklyuziv Kontent & ' : 'Эксклюзивный Контент и '}
              <em className="text-[#0E7C86] italic">{lang === 'uz' ? 'Studiya Muqovalari' : 'Обложки'}</em>
            </h1>
            <p className="text-[#5D594E] text-sm mt-1 max-w-2xl">
              {lang === 'uz'
                ? 'Premium darajadagi maxsus sonlar, sun\'iy intellekt yordamida professional 800x800 muqova dizayni va universal eksport vositalari.'
                : 'Премиум-эпизоды, генерация студийных обложек 800x800 через AI Studio и полный экспорт для подкаст-платформ.'}
            </p>
          </div>
        </div>
      </div>

      {/* Notifications */}
      {vipNotice && (
        <div className="p-3.5 rounded-xl bg-[rgba(14,124,134,0.12)] border border-[#0E7C86]/30 text-[#0A5A62] text-xs flex items-center justify-between font-mono animate-in fade-in duration-200">
          <span className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#0E7C86]" />
            <span>{vipNotice}</span>
          </span>
          <button
            type="button"
            onClick={() => setVipNotice(null)}
            className="text-[#5D594E] hover:text-[#161511] p-1 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* VIP Custom Script Studio (AI Ssenariy, O'z Matni, Kulminatsiya & 30-40% Nafas/Pauza) */}
      <div className="bg-white border-2 border-[#C98A12]/40 rounded-[22px] p-5 sm:p-6 space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[rgba(22,21,17,0.1)] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#C98A12]/15 text-[#C98A12] flex items-center justify-center">
              <Crown className="w-4 h-4 text-[#C98A12]" />
            </div>
            <div>
              <h3 className="text-xs sm:text-sm font-bold text-[#161511] font-mono uppercase tracking-wider flex items-center gap-2">
                <span>{lang === 'uz' ? "VIP Ssenariy & O'z Matningizni Kiritish" : "VIP Сценарий и Свой Текст"}</span>
                <span className="px-2 py-0.5 rounded-full bg-[#C98A12] text-white text-[10px] font-sans font-semibold">VIP Studio</span>
              </h3>
              <p className="text-[11px] text-[#5D594E]">
                {lang === 'uz'
                  ? "Ixtiyoriy mavzuni yozing yoki o'z matningizni qo'ying — AI to'liq ssenariyni kulminatsiya, emotsiyalar, 30-40% nafas va pauzalar bilan tayyorlaydi"
                  : "Напишите любую тему или вставьте свой текст — AI подготовит сценарий с кульминацией, дыханием и паузами"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClearVipText}
              className="px-2.5 py-1.5 rounded-xl border border-[rgba(22,21,17,0.15)] bg-white hover:bg-[#ECE7DB] text-xs font-mono text-[#5D594E] hover:text-[#161511] flex items-center gap-1 cursor-pointer transition-colors"
              title="Tozalash va yangi yozish"
            >
              <Trash2 className="w-3.5 h-3.5 text-[#C4552D]" />
              <span>{lang === 'uz' ? "Tozalash" : "Очистить"}</span>
            </button>
            <select
              value={selectedVoiceId}
              onChange={(e) => setSelectedVoiceId(e.target.value)}
              className="bg-[#F4F1EA] border border-[rgba(22,21,17,0.14)] rounded-xl px-3 py-1.5 text-xs font-mono text-[#161511] outline-none cursor-pointer"
              title="Ovozni tanlash"
            >
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  🎙️ {v.name} ({v.timbre?.split(' ')[0] || 'HD'})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Topic Input row */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <input
            type="text"
            value={vipTopic}
            onChange={(e) => setVipTopic(e.target.value)}
            placeholder={
              lang === 'uz'
                ? "VIP mavzu yoki ssenariy g'oyasini yozing (masalan: Ibn Sino sirlari, 2030-yil startaplari)..."
                : "Тема для VIP сценария..."
            }
            className="flex-1 bg-[#F4F1EA] border border-[rgba(22,21,17,0.16)] focus:border-[#0E7C86] focus:bg-white rounded-xl px-4 py-2.5 text-xs sm:text-sm text-[#161511] outline-none transition-colors"
          />

          <button
            type="button"
            onClick={handleGenerateVipScript}
            disabled={isGeneratingVipScript}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#161511] to-[#0A5A62] hover:from-[#0A5A62] hover:to-[#0E7C86] text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-2 cursor-pointer shadow-md transition-all active:scale-98 disabled:opacity-50 shrink-0"
          >
            {isGeneratingVipScript ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>{lang === 'uz' ? "Yozilmoqda..." : "Генерация..."}</span>
              </>
            ) : (
              <>
                <Wand2 className="w-4 h-4 text-[#5CC8CF]" />
                <span>{lang === 'uz' ? "✨ VIP Ssenariy Yaratish (AI)" : "✨ Создать VIP Сценарий (AI)"}</span>
              </>
            )}
          </button>
        </div>

        {/* Quick Parameters & Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-mono text-[#5D594E] font-semibold">
              {lang === 'uz' ? 'Xronometraj:' : 'Хронометраж:'}
            </span>
            {['5 daqiqa', '15 daqiqa', '30 daqiqa', '60 daqiqa'].map((dur) => (
              <button
                key={dur}
                type="button"
                onClick={() => setVipDuration(dur)}
                className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-all cursor-pointer ${
                  vipDuration === dur
                    ? 'bg-[#161511] text-white font-bold'
                    : 'bg-[#F4F1EA] border border-[rgba(22,21,17,0.12)] text-[#5D594E] hover:text-[#161511]'
                }`}
              >
                {dur}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-[#5D594E] font-semibold">
              {lang === 'uz' ? 'Ohang / Uslub:' : 'Интонация:'}
            </span>
            <select
              value={vipMood}
              onChange={(e) => setVipMood(e.target.value)}
              className="bg-[#F4F1EA] border border-[rgba(22,21,17,0.14)] rounded-lg text-xs font-mono text-[#161511] px-2.5 py-1 outline-none cursor-pointer"
            >
              <option value="G'urur & Kulminatsiya">Gʻurur & Kulminatsiya (Tantanavor)</option>
              <option value="Samimiy & Jonli">Samimiy & Jonli (Iliq)</option>
              <option value="Hayajonli & Jo'shqin">Hayajonli & Jo'shqin (Dinamik)</option>
              <option value="Sokin & Mulohazali">Sokin & Mulohazali (Falsafiy)</option>
              <option value="Dramatik & Epik">Dramatik & Epik (Kino)</option>
              <option value="Biznes & Ishonchli">Biznes & Ishonchli (Ekspert)</option>
            </select>
          </div>
        </div>

        {/* 1-Click Vocal Cue Toolbar & Live Density */}
        <div className="p-3.5 bg-[#F4F1EA]/90 rounded-2xl space-y-3 border border-[rgba(22,21,17,0.12)] shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleEnrichVipScript}
                disabled={isEnrichingVip || !vipScriptText.trim()}
                className="px-3.5 py-2 bg-[#0E7C86] hover:bg-[#0A5A62] text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer disabled:opacity-50"
              >
                {isEnrichingVip ? (
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Zap className="w-3.5 h-3.5 text-[#5CC8CF]" />
                )}
                <span>{lang === 'uz' ? '⚡ AI bilan Jonlantirish (+30-40% Nafas, Pauza, Kulminatsiya)' : '⚡ AI Оживление (+30-40% Эмоции)'}</span>
              </button>

              <button
                type="button"
                onClick={handleAutoInjectBreaths}
                className="px-3 py-2 rounded-xl bg-white border border-[#0E7C86]/30 hover:bg-[#0E7C86]/5 text-[11px] font-mono text-[#0A5A62] font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                title="Har 1-2 gap orasiga tabiiy nafas qo'shish"
              >
                <Wind className="w-3.5 h-3.5 text-[#0E7C86]" />
                <span>{lang === 'uz' ? "🌬️ Avto-nafas (+30%)" : "🌬️ Авто-дыхание"}</span>
              </button>
            </div>

            {/* Real-time density badge */}
            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-[rgba(22,21,17,0.1)] text-xs font-mono self-start sm:self-center shadow-2xs">
              <span className="font-bold text-[#0A5A62]">
                {lang === 'uz' ? 'Jonlilik:' : 'Живость:'}
              </span>
              <span className="font-semibold text-[#161511]">
                {livingCueStats.total} {lang === 'uz' ? 'ta belgi' : 'тегов'} (~35%)
              </span>
              <span className="text-[#5D594E] hidden md:inline">
                (🌬️{livingCueStats.breathCount} · ⏸️{livingCueStats.pauseCount} · 🎭{livingCueStats.emotionCount} · 🇺🇿{livingCueStats.uzbekFillerCount})
              </span>
            </div>
          </div>

          <div className="space-y-1.5 pt-2 border-t border-[rgba(22,21,17,0.08)]">
            {/* Group 1: Nafas & Pauzalar */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[10px] text-[#C4552D] font-bold uppercase tracking-wider w-18 shrink-0">
                🌬️ Nafas:
              </span>
              <button
                type="button"
                onClick={() => insertVipCue('<breath>')}
                className="font-mono text-xs border border-[rgba(196,85,45,0.4)] text-[#C4552D] hover:bg-[rgba(196,85,45,0.08)] rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
              >
                &lt;breath&gt;
              </button>
              <button
                type="button"
                onClick={() => insertVipCue('<deep_breath>')}
                className="font-mono text-xs border border-[rgba(196,85,45,0.4)] text-[#C4552D] hover:bg-[rgba(196,85,45,0.08)] rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
              >
                &lt;deep_breath&gt;
              </button>
              <button
                type="button"
                onClick={() => insertVipCue('<sigh>')}
                className="font-mono text-xs border border-[rgba(196,85,45,0.4)] text-[#C4552D] hover:bg-[rgba(196,85,45,0.08)] rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
              >
                &lt;sigh&gt;
              </button>
              <button
                type="button"
                onClick={() => insertVipCue('<gasp>')}
                className="font-mono text-xs border border-[rgba(196,85,45,0.4)] text-[#C4552D] hover:bg-[rgba(196,85,45,0.08)] rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
              >
                &lt;gasp&gt;
              </button>
              <button
                type="button"
                onClick={() => insertVipCue('[Pauza 0.5s]')}
                className="font-mono text-xs border border-[rgba(22,21,17,0.2)] text-[#161511] hover:bg-black/5 rounded-full px-2 py-0.5 cursor-pointer transition-colors"
              >
                [Pauza 0.5s]
              </button>
              <button
                type="button"
                onClick={() => insertVipCue('[Pauza 1s]')}
                className="font-mono text-xs border border-[rgba(22,21,17,0.25)] text-[#161511] hover:bg-black/5 rounded-full px-2 py-0.5 cursor-pointer font-bold transition-colors"
              >
                [Pauza 1s]
              </button>
              <button
                type="button"
                onClick={() => insertVipCue('[Pauza 2s]')}
                className="font-mono text-xs border border-[rgba(22,21,17,0.25)] text-[#161511] hover:bg-black/5 rounded-full px-2 py-0.5 cursor-pointer font-bold transition-colors"
              >
                [Pauza 2s]
              </button>
            </div>

            {/* Group 2: Kulminatsiya & Emotsiyalar */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[10px] text-[#0A5A62] font-bold uppercase tracking-wider w-18 shrink-0">
                🎭 Emotsiya:
              </span>
              <button
                type="button"
                onClick={() => insertVipCue('[Kulminatsiya]')}
                className="font-mono text-xs border-2 border-[#0E7C86] bg-[#0E7C86]/10 text-[#0A5A62] hover:bg-[#0E7C86] hover:text-white rounded-full px-3 py-0.5 cursor-pointer font-bold transition-colors shadow-2xs"
              >
                🔥 [Kulminatsiya]
              </button>
              <button
                type="button"
                onClick={() => insertVipCue('[Hayajon]')}
                className="font-mono text-xs border border-[rgba(22,21,17,0.2)] text-[#161511] hover:bg-black/5 rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
              >
                [Hayajon]
              </button>
              <button
                type="button"
                onClick={() => insertVipCue('[Gʻurur]')}
                className="font-mono text-xs border border-[rgba(22,21,17,0.2)] text-[#161511] hover:bg-black/5 rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
              >
                [Gʻurur]
              </button>
              <button
                type="button"
                onClick={() => insertVipCue('[Sokin]')}
                className="font-mono text-xs border border-[rgba(22,21,17,0.2)] text-[#161511] hover:bg-black/5 rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
              >
                [Sokin]
              </button>
              <button
                type="button"
                onClick={() => insertVipCue('[Jiddiy]')}
                className="font-mono text-xs border border-[rgba(22,21,17,0.2)] text-[#161511] hover:bg-black/5 rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
              >
                [Jiddiy]
              </button>
              <button
                type="button"
                onClick={() => insertVipCue('[Pichirlash]')}
                className="font-mono text-xs border border-[rgba(22,21,17,0.2)] text-[#161511] hover:bg-black/5 rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
              >
                [Pichirlash]
              </button>
              <button
                type="button"
                onClick={() => insertVipCue('<laugh>')}
                className="font-mono text-xs border border-[#C98A12]/40 text-[#C98A12] hover:bg-[#C98A12]/10 rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
              >
                😄 &lt;laugh&gt;
              </button>
              <button
                type="button"
                onClick={() => insertVipCue('(kulimsirab)')}
                className="font-mono text-xs border border-[#C98A12]/40 text-[#C98A12] hover:bg-[#C98A12]/10 rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
              >
                (kulimsirab)
              </button>
            </div>

            {/* Group 3: Jonli o'zbekcha ifodalar */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[10px] text-[#0A5A62] font-bold uppercase tracking-wider w-18 shrink-0">
                🇺🇿 Jonli:
              </span>
              {['|ha|', '|mhm|', '|xoʻsh|', '|voy|', '|rosti|', '|bilasizmi|', '|albatta|'].map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => insertVipCue(tag)}
                  className="font-mono text-xs border border-[rgba(14,124,134,0.35)] text-[#0A5A62] hover:bg-[rgba(14,124,134,0.1)] rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* VIP Textarea */}
        <textarea
          rows={7}
          value={vipScriptText}
          onChange={(e) => setVipScriptText(e.target.value)}
          placeholder={
            lang === 'uz'
              ? "VIP ssenariy matnini shu yerga yozing yoki o'z matningizni joylashtiring..."
              : "Текст VIP сценария..."
          }
          className="w-full bg-[#F4F1EA] border border-[rgba(22,21,17,0.14)] focus:border-[#0E7C86] focus:bg-white rounded-2xl p-4 font-mono text-xs sm:text-sm text-[#161511] leading-relaxed outline-none transition-colors"
        />

        {/* Synthesize Button & Audio Result */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
          <button
            type="button"
            onClick={handleSynthesizeVip}
            disabled={isSynthesizingVip || !vipScriptText.trim()}
            className="w-full sm:w-auto px-6 py-3 rounded-full bg-[#161511] hover:bg-[#0A5A62] text-[#F4F1EA] text-xs sm:text-sm font-bold flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer disabled:opacity-50"
          >
            {isSynthesizingVip ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>{lang === 'uz' ? "Ovoz berilmoqda (24kHz HD)..." : "Синтез аудио..."}</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 text-[#5CC8CF] fill-current" />
                <span>{lang === 'uz' ? "🎙️ 24kHz HD Studiyada Ovoz Berish (VIP)" : "🎙️ Озвучить в 24kHz HD (VIP)"}</span>
              </>
            )}
          </button>

          {vipAudioBase64 && (
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <audio
                controls
                src={`data:audio/wav;base64,${vipAudioBase64}`}
                className="h-9 w-full sm:w-64 rounded-full"
              />
              <a
                href={`data:audio/wav;base64,${vipAudioBase64}`}
                download={`vip-masterclass-${Date.now()}.wav`}
                className="p-2 rounded-full bg-white border border-[rgba(22,21,17,0.15)] hover:border-[#161511] text-[#0A5A62] transition-colors"
                title="WAV yuklab olish"
              >
                <Download className="w-4 h-4" />
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: AI Cover Art Generator (6 cols) */}
        <div className="lg:col-span-6 space-y-6">
          <div className="bg-white border border-[rgba(22,21,17,0.14)] rounded-[22px] p-5 sm:p-6 space-y-4 shadow-xs">
            <h3 className="text-xs font-mono uppercase tracking-[0.14em] text-[#0A5A62] font-semibold flex items-center gap-2 border-b border-[rgba(22,21,17,0.1)] pb-3">
              <Palette className="w-4 h-4 text-[#C98A12]" />
              {lang === 'uz' ? '01 — AI Podkast Muqovasi (Cover Art Designer)' : '01 — Дизайнер Обложек Подкаста'}
            </h3>

            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-mono uppercase tracking-wider text-[#5D594E] block mb-1">
                  {lang === 'uz' ? 'Podkast sarlavhasi (Muqovada ko\'rinadi):' : 'Заголовок на обложке:'}
                </label>
                <input
                  type="text"
                  value={coverTitle}
                  onChange={(e) => setCoverTitle(e.target.value)}
                  className="w-full bg-[#F4F1EA] border border-[rgba(22,21,17,0.14)] rounded-xl px-3.5 py-2 text-xs sm:text-sm text-[#161511] focus:outline-none focus:border-[#0E7C86] focus:bg-white transition-colors"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-mono uppercase tracking-wider text-[#5D594E] block mb-1">
                    {lang === 'uz' ? 'Kategoriya belgisi:' : 'Бейдж категории:'}
                  </label>
                  <input
                    type="text"
                    value={coverCategory}
                    onChange={(e) => setCoverCategory(e.target.value)}
                    className="w-full bg-[#F4F1EA] border border-[rgba(22,21,17,0.14)] rounded-xl px-3 py-2 text-xs text-[#161511] focus:outline-none focus:border-[#0E7C86] focus:bg-white transition-colors"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-mono uppercase tracking-wider text-[#5D594E] block mb-1">
                    {lang === 'uz' ? 'Teglar / Mavzular:' : 'Теги:'}
                  </label>
                  <input
                    type="text"
                    value={coverTags}
                    onChange={(e) => setCoverTags(e.target.value)}
                    className="w-full bg-[#F4F1EA] border border-[rgba(22,21,17,0.14)] rounded-xl px-3 py-2 text-xs text-[#161511] focus:outline-none focus:border-[#0E7C86] focus:bg-white transition-colors"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={handleGenerateCover}
                disabled={isGeneratingCover || !coverTitle.trim()}
                className="w-full btn-pill btn-solid py-2.5 text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
              >
                <Sparkles className={`w-4 h-4 text-[#5CC8CF] ${isGeneratingCover ? 'animate-spin' : ''}`} />
                {isGeneratingCover
                  ? (lang === 'uz' ? 'Muqova chizilmoqda...' : 'Генерация обложки...')
                  : (lang === 'uz' ? 'Professional Muqovani Yaratish (AI SVG)' : 'Создать Обложку (AI SVG)')}
              </button>
            </div>

            {/* Generated Cover Preview */}
            <div className="pt-2">
              <p className="text-[11px] font-mono uppercase tracking-wider text-[#5D594E] mb-2">
                {lang === 'uz' ? 'Muqova ko\'rinishi (800x800 HD):' : 'Предпросмотр обложки:'}
              </p>

              {generatedSvg ? (
                <div className="space-y-3">
                  <div
                    className="w-full aspect-square max-w-[320px] mx-auto rounded-2xl overflow-hidden border border-[rgba(22,21,17,0.18)] shadow-md flex items-center justify-center bg-[#141414]"
                    dangerouslySetInnerHTML={{ __html: generatedSvg }}
                  />
                  <button
                    type="button"
                    onClick={downloadSvg}
                    className="w-full btn-pill btn-ghost text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5 text-[#0E7C86]" />
                    {lang === 'uz' ? 'SVG Muqovani Yuklab Olish' : 'Скачать обложку SVG'}
                  </button>
                </div>
              ) : (
                <div className="w-full aspect-square max-w-[320px] mx-auto rounded-2xl border border-dashed border-[rgba(22,21,17,0.18)] bg-[#F4F1EA] flex flex-col items-center justify-center text-center p-6 space-y-2">
                  <ImageIcon className="w-10 h-10 text-[#5D594E]/40" />
                  <p className="text-xs text-[#161511] font-medium">
                    {lang === 'uz' ? 'Muqova hali yaratilmadi' : 'Обложка еще не сгенерирована'}
                  </p>
                  <p className="text-[11px] text-[#5D594E]">
                    {lang === 'uz'
                      ? 'Tugmani bosing va sun\'iy intellekt sizning podkastingiz uchun maxsus zamonaviy studiya dizaynini yaratadi.'
                      : 'Нажмите кнопку для создания обложки в векторе.'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: Exclusive VIP Episodes & Production Suite (6 cols) */}
        <div className="lg:col-span-6 space-y-6">
          {/* VIP Episodes */}
          <div className="bg-white border border-[rgba(22,21,17,0.14)] rounded-[22px] p-5 sm:p-6 space-y-4 shadow-xs">
            <h3 className="text-xs font-mono uppercase tracking-[0.14em] text-[#0A5A62] font-semibold flex items-center gap-2 border-b border-[rgba(22,21,17,0.1)] pb-3">
              <Crown className="w-4 h-4 text-[#C98A12]" />
              {lang === 'uz' ? '02 — Eksklyuziv Podkastlar Ro\'yxati' : '02 — Список Эксклюзивных Выпусков'}
            </h3>

            <div className="space-y-3">
              {exclusiveEpisodes.map((ep) => {
                const isPlaying = activePlayingId === ep.id;
                const isMasterclass = ep.tier === 'masterclass';

                return (
                  <div
                    key={ep.id}
                    className="p-4 rounded-xl bg-[#F4F1EA] border border-[rgba(22,21,17,0.14)] hover:border-[#0E7C86] transition-all flex flex-col gap-2.5 shadow-2xs"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5 mb-1">
                          <span
                            className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                              isMasterclass
                                ? 'bg-[#0E7C86]/10 text-[#0A5A62] border-[#0E7C86]/30'
                                : 'bg-[#C98A12]/10 text-[#C98A12] border-[#C98A12]/30'
                            }`}
                          >
                            {isMasterclass ? 'MASTERCLASS' : 'VIP EKSKLYUZIV'}
                          </span>
                          <span className="text-[10px] text-[#5D594E] font-mono bg-white px-2 py-0.5 rounded-full border border-[rgba(22,21,17,0.14)]">
                            {ep.durationSeconds ? `${Math.floor(ep.durationSeconds / 60)} daqiqa` : '30 daqiqa'}
                          </span>
                        </div>
                        <h4 className="text-xs sm:text-sm font-semibold text-[#161511] leading-snug">
                          {ep.title}
                        </h4>
                      </div>

                      <button
                        type="button"
                        onClick={() => setActivePlayingId(isPlaying ? null : ep.id)}
                        className="w-8 h-8 rounded-full bg-[#161511] text-[#F4F1EA] hover:bg-[#0A5A62] flex items-center justify-center shrink-0 transition-transform active:scale-95 cursor-pointer shadow-xs"
                      >
                        {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
                      </button>
                    </div>

                    <p className="text-[12px] text-[#5D594E] leading-relaxed">{ep.description}</p>

                    <div className="flex items-center gap-1.5 pt-1">
                      {ep.tags.map((tag) => (
                        <span key={tag} className="text-[9.5px] px-2 py-0.5 rounded-full bg-white text-[#5D594E] font-mono border border-[rgba(22,21,17,0.1)]">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Production Export Suite */}
          <div className="bg-white border border-[rgba(22,21,17,0.14)] rounded-[22px] p-5 sm:p-6 space-y-3.5 shadow-xs">
            <h3 className="text-xs font-mono uppercase tracking-[0.14em] text-[#0A5A62] font-semibold flex items-center gap-2 border-b border-[rgba(22,21,17,0.1)] pb-3">
              <Layers className="w-4 h-4 text-[#0E7C86]" />
              {lang === 'uz' ? '03 — Universal Eksport Paketi' : '03 — Пакет Экспорта'}
            </h3>
            <p className="text-xs text-[#5D594E]">
              {lang === 'uz'
                ? 'Spotify, Apple Podcasts, YouTube va ijtimoiy tarmoqlar uchun to\'liq tayyor materiallar to\'plami:'
                : 'Готовые материалы для платформ Spotify, Apple Podcasts, YouTube и соцсетей:'}
            </p>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-3 rounded-xl bg-[#F4F1EA] border border-[rgba(22,21,17,0.14)] flex items-center gap-2 text-[#161511]">
                <CheckCircle2 className="w-4 h-4 text-[#0E7C86] shrink-0" />
                <span className="font-mono text-[11px]">WAV 24kHz Audio</span>
              </div>
              <div className="p-3 rounded-xl bg-[#F4F1EA] border border-[rgba(22,21,17,0.14)] flex items-center gap-2 text-[#161511]">
                <CheckCircle2 className="w-4 h-4 text-[#0E7C86] shrink-0" />
                <span className="font-mono text-[11px]">SRT / VTT Subtitr</span>
              </div>
              <div className="p-3 rounded-xl bg-[#F4F1EA] border border-[rgba(22,21,17,0.14)] flex items-center gap-2 text-[#161511]">
                <CheckCircle2 className="w-4 h-4 text-[#0E7C86] shrink-0" />
                <span className="font-mono text-[11px]">SVG HD Muqova</span>
              </div>
              <div className="p-3 rounded-xl bg-[#F4F1EA] border border-[rgba(22,21,17,0.14)] flex items-center gap-2 text-[#161511]">
                <CheckCircle2 className="w-4 h-4 text-[#0E7C86] shrink-0" />
                <span className="font-mono text-[11px]">RSS & JSON Meta</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
