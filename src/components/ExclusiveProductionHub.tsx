import React, { useState } from 'react';
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
  // Cover Art Generator State
  const [coverTitle, setCoverTitle] = useState('O\'zbekiston 2030: Texnologik Inqilob');
  const [coverCategory, setCoverCategory] = useState('EKSKLYUZIV VIP');
  const [coverTags, setCoverTags] = useState('AI, Texnologiya, Kelajak, Toshkent');
  const [isGeneratingCover, setIsGeneratingCover] = useState(false);
  const [generatedSvg, setGeneratedSvg] = useState<string | null>(null);

  // Default Exclusive Episodes List
  const [exclusiveEpisodes, setExclusiveEpisodes] = useState<ExclusiveEpisode[]>([
    {
      id: 'ex-1',
      title: 'Buyuk Ipak Yo\'li: Yo\'qolgan Karvonlar va Maxfiy Xazinalar',
      tier: 'vip',
      description: 'Samarqand va Buxoro o\'rtasidagi sirli karvonsaroylar arxeologiyasi haqida 3D audio-ekskursiya.',
      tags: ['Tarix', 'Sirli', 'VIP', 'Arxeologiya'],
      durationSeconds: 180,
      createdAt: 'Bugun',
    },
    {
      id: 'ex-2',
      title: 'O\'zbekistonda AI Startaplar: 0 dan 100,000$ gacha bo\'lgan yo\'l',
      tier: 'masterclass',
      description: 'Mahalliy muhandislar tomonidan yaratilgan muvaffaqiyatli loyihalar va amaliy audio-keyslar.',
      tags: ['Biznes', 'Masterclass', 'AI', 'Startap'],
      durationSeconds: 240,
      createdAt: 'Kecha',
    },
    {
      id: 'ex-3',
      title: 'Miyaning Yashirin Zaxiralari: Daho Allomalar Qanday Fikrlagan?',
      tier: 'vip',
      description: 'Ibn Sino va Beruniyning xotirani charxlash va diqqatni jamlash bo\'yicha qadimiy tavsiyalari.',
      tags: ['Ilm-fan', 'Psixologiya', 'IbnSino', 'VIP'],
      durationSeconds: 150,
      createdAt: '2 kun oldin',
    },
  ]);

  const [activePlayingId, setActivePlayingId] = useState<string | null>(null);

  // Generate SVG Cover Art
  const handleGenerateCover = async () => {
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
      <div className="rounded-2xl bg-gradient-to-r from-amber-950/60 via-zinc-900 to-yellow-950/60 border border-amber-500/30 p-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 text-xs font-semibold border border-amber-500/40 flex items-center gap-1.5">
                <Crown className="w-3.5 h-3.5" />
                {lang === 'uz' ? 'Eksklyuziv Podkastlar & Production Hub' : 'Эксклюзивные Выпуски & Production Hub'}
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400 text-xs font-mono border border-yellow-500/30">
                VIP / Masterclass • Cover Art Studio
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
              {lang === 'uz' ? 'Eksklyuziv Kontent & Studiya Muqovalari' : 'Эксклюзивный Контент и Обложки'}
            </h1>
            <p className="text-zinc-400 text-sm mt-1 max-w-2xl">
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
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
              <Palette className="w-4 h-4 text-amber-400" />
              {lang === 'uz' ? '1. AI Podkast Muqovasi (Cover Art Designer)' : '1. Дизайнер Обложек Подкаста'}
            </h3>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-zinc-400 block mb-1">
                  {lang === 'uz' ? 'Podkast sarlavhasi (Muqovada ko\'rinadi):' : 'Заголовок на обложке:'}
                </label>
                <input
                  type="text"
                  value={coverTitle}
                  onChange={(e) => setCoverTitle(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2 text-xs sm:text-sm text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-zinc-400 block mb-1">
                    {lang === 'uz' ? 'Kategoriya belgisi:' : 'Бейдж категории:'}
                  </label>
                  <input
                    type="text"
                    value={coverCategory}
                    onChange={(e) => setCoverCategory(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-400 block mb-1">
                    {lang === 'uz' ? 'Teglar / Mavzular:' : 'Теги:'}
                  </label>
                  <input
                    type="text"
                    value={coverTags}
                    onChange={(e) => setCoverTags(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <button
                onClick={handleGenerateCover}
                disabled={isGeneratingCover || !coverTitle.trim()}
                className="w-full py-2.5 bg-gradient-to-r from-amber-600 to-yellow-600 hover:from-amber-500 hover:to-yellow-500 disabled:opacity-50 text-white rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-md shadow-amber-600/20 cursor-pointer"
              >
                <Sparkles className={`w-4 h-4 ${isGeneratingCover ? 'animate-spin' : ''}`} />
                {isGeneratingCover
                  ? (lang === 'uz' ? 'Muqova chizilmoqda...' : 'Генерация обложки...')
                  : (lang === 'uz' ? 'Professional Muqovani Yaratish (AI SVG)' : 'Создать Обложку (AI SVG)')}
              </button>
            </div>

            {/* Generated Cover Preview */}
            <div className="pt-2">
              <p className="text-xs font-semibold text-zinc-400 mb-2">
                {lang === 'uz' ? 'Muqova ko\'rinishi (800x800 HD):' : 'Предпросмотр обложки:'}
              </p>

              {generatedSvg ? (
                <div className="space-y-3">
                  <div
                    className="w-full aspect-square max-w-[320px] mx-auto rounded-2xl overflow-hidden border border-amber-500/40 shadow-xl shadow-amber-500/10 flex items-center justify-center bg-black"
                    dangerouslySetInnerHTML={{ __html: generatedSvg }}
                  />
                  <button
                    onClick={downloadSvg}
                    className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors border border-zinc-700"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {lang === 'uz' ? 'SVG Muqovani Yuklab Olish' : 'Скачать обложку SVG'}
                  </button>
                </div>
              ) : (
                <div className="w-full aspect-square max-w-[320px] mx-auto rounded-2xl border border-dashed border-zinc-800 bg-zinc-950 flex flex-col items-center justify-center text-center p-6 space-y-2">
                  <ImageIcon className="w-10 h-10 text-zinc-700" />
                  <p className="text-xs text-zinc-400 font-medium">
                    {lang === 'uz' ? 'Muqova hali yaratilmadi' : 'Обложка еще не сгенерирована'}
                  </p>
                  <p className="text-[11px] text-zinc-600">
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
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
              <Crown className="w-4 h-4 text-amber-400" />
              {lang === 'uz' ? '2. Eksklyuziv Podkastlar Ro\'yxati' : '2. Список Эксклюзивных Выпусков'}
            </h3>

            <div className="space-y-3">
              {exclusiveEpisodes.map((ep) => {
                const isPlaying = activePlayingId === ep.id;
                const isMasterclass = ep.tier === 'masterclass';

                return (
                  <div
                    key={ep.id}
                    className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 hover:border-amber-500/40 transition-all flex flex-col gap-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5 mb-1">
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                              isMasterclass
                                ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                                : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                            }`}
                          >
                            {isMasterclass ? 'MASTERCLASS' : 'VIP EKSKLYUZIV'}
                          </span>
                          <span className="text-[10px] text-zinc-500">{ep.durationSeconds}s</span>
                        </div>
                        <h4 className="text-xs sm:text-sm font-bold text-white leading-snug">
                          {ep.title}
                        </h4>
                      </div>

                      <button
                        onClick={() => setActivePlayingId(isPlaying ? null : ep.id)}
                        className="w-8 h-8 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 flex items-center justify-center shrink-0 transition-transform active:scale-95 cursor-pointer"
                      >
                        {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                      </button>
                    </div>

                    <p className="text-[11px] text-zinc-400 leading-relaxed">{ep.description}</p>

                    <div className="flex items-center gap-1.5 pt-1">
                      {ep.tags.map((tag) => (
                        <span key={tag} className="text-[9px] px-2 py-0.5 rounded bg-zinc-900 text-zinc-400 font-mono">
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
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
              <Layers className="w-4 h-4 text-amber-400" />
              {lang === 'uz' ? '3. Universal Eksport Paketi' : '3. Пакет Экспорта'}
            </h3>
            <p className="text-xs text-zinc-400">
              {lang === 'uz'
                ? 'Spotify, Apple Podcasts, YouTube va ijtimoiy tarmoqlar uchun to\'liq tayyor materiallar to\'plami:'
                : 'Готовые материалы для платформ Spotify, Apple Podcasts, YouTube и соцсетей:'}
            </p>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center gap-2 text-zinc-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>WAV 24kHz Audio</span>
              </div>
              <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center gap-2 text-zinc-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>SRT / VTT Subtitr</span>
              </div>
              <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center gap-2 text-zinc-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>SVG HD Muqova</span>
              </div>
              <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center gap-2 text-zinc-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>RSS & JSON Meta</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
