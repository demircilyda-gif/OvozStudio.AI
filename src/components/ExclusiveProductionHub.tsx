import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
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
      const res = await fetch('/api/podcast/generate-cover', {
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
                : 'Премиум-эпизоды, генерация студийных обложек 800x800 через Gemini AI и полный экспорт для подкаст-платформ.'}
            </p>
          </div>
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
                      ? 'Tugmani bosing va Gemini 3.8 sizning podkastingiz uchun maxsus zamonaviy studiya dizaynini yaratadi.'
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
