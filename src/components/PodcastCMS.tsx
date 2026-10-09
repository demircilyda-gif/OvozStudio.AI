import React, { useState, useRef, useEffect } from 'react';
import {
  FolderKanban,
  Search,
  Plus,
  Tag,
  Filter,
  Trash2,
  Edit3,
  Play,
  Pause,
  Download,
  Calendar,
  Clock,
  Sparkles,
  Layers,
  FileAudio,
  CheckCircle2,
  FileText,
  Volume2,
  VolumeX,
  X,
  Radio,
  Sliders,
  RotateCcw,
} from 'lucide-react';
import { GeneratedPodcast } from '../types/podcast';
import { PODCAST_CATEGORIES } from '../data/categories';
import { exportAudioWithQuality, base64ToArrayBuffer, getAudioContext } from '../utils/audioUtils';

export interface CMSPodcastItem extends GeneratedPodcast {
  description: string;
  tags: string[];
  status: 'published' | 'draft';
  episodeNumber?: number;
}

interface PodcastCMSProps {
  podcasts: CMSPodcastItem[];
  onUpdatePodcast: (podcast: CMSPodcastItem) => void;
  onDeletePodcast: (id: string) => void;
  onOpenInStudio: (podcast: CMSPodcastItem) => void;
  onCreateNew: () => void;
  lang: 'uz' | 'ru';
}

export const PodcastCMS: React.FC<PodcastCMSProps> = ({
  podcasts,
  onUpdatePodcast,
  onDeletePodcast,
  onOpenInStudio,
  onCreateNew,
  lang,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  
  // Metadata edit modal
  const [editingItem, setEditingItem] = useState<CMSPodcastItem | null>(null);

  // Quick export state
  const [exportModalItem, setExportModalItem] = useState<CMSPodcastItem | null>(null);
  const [exportFormat, setExportFormat] = useState<'wav' | 'mp3'>('wav');
  const [exportQuality, setExportQuality] = useState<'lossless' | '320k' | '192k' | '128k'>('lossless');
  const [isExporting, setIsExporting] = useState(false);

  // In-library audio playback state
  const [activePodcast, setActivePodcast] = useState<CMSPodcastItem | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [volume, setVolume] = useState<number>(1);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [audioUrl, setAudioUrl] = useState<string>('');
  const [playbackNotice, setPlaybackNotice] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioBlobUrlRef = useRef<string | null>(null);

  const formatSeconds = (sec: number) => {
    if (isNaN(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (audioBlobUrlRef.current) {
      URL.revokeObjectURL(audioBlobUrlRef.current);
      audioBlobUrlRef.current = null;
    }
    setAudioUrl('');
    setIsPlaying(false);
    setCurrentTime(0);
  };

  useEffect(() => {
    return () => {
      stopAudio();
    };
  }, []);

  const handleTogglePlay = async (podcast: CMSPodcastItem) => {
    if (!podcast.rawAudioWavBase64) {
      setPlaybackNotice(
        lang === 'uz'
          ? "Ushbu podkastda audio ma'lumot topilmadi"
          : 'Аудиоданные не найдены'
      );
      setTimeout(() => setPlaybackNotice(null), 3500);
      return;
    }

    // Toggle same podcast
    if (activePodcast?.id === podcast.id && audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        try {
          const ctx = getAudioContext();
          if (ctx.state === 'suspended') {
            await ctx.resume().catch(() => {});
          }
        } catch {}
        audioRef.current
          .play()
          .then(() => setIsPlaying(true))
          .catch((err) => {
            console.warn('Playback resume error:', err);
            setIsPlaying(false);
          });
      }
      return;
    }

    // New podcast selected
    stopAudio();
    setActivePodcast(podcast);
    setDuration(podcast.durationSeconds || 0);
    setCurrentTime(0);

    try {
      const buffer = base64ToArrayBuffer(podcast.rawAudioWavBase64);
      const blob = new Blob([buffer], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      audioBlobUrlRef.current = url;
      setAudioUrl(url);

      try {
        const ctx = getAudioContext();
        if (ctx.state === 'suspended') {
          await ctx.resume().catch(() => {});
        }
      } catch {}

      // Play as soon as element receives the src
      setTimeout(() => {
        if (audioRef.current) {
          audioRef.current.volume = isMuted ? 0 : volume;
          audioRef.current.playbackRate = playbackRate;
          audioRef.current
            .play()
            .then(() => setIsPlaying(true))
            .catch((err) => {
              console.warn('Initial play error:', err);
              setIsPlaying(false);
            });
        }
      }, 50);
    } catch (err: any) {
      console.error('Audio initialization failed:', err);
      setPlaybackNotice(
        lang === 'uz' ? "Audioni tinglashda xatolik yuz berdi" : 'Ошибка при воспроизведении аудио'
      );
      setTimeout(() => setPlaybackNotice(null), 3500);
    }
  };

  const handleSeek = (newTime: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  const handleVolumeChange = (newVol: number) => {
    setVolume(newVol);
    setIsMuted(newVol === 0);
    if (audioRef.current) {
      audioRef.current.volume = newVol;
    }
  };

  const handleToggleMute = () => {
    if (isMuted) {
      setIsMuted(false);
      if (audioRef.current) audioRef.current.volume = volume || 0.8;
    } else {
      setIsMuted(true);
      if (audioRef.current) audioRef.current.volume = 0;
    }
  };

  const handleCycleSpeed = () => {
    const speeds = [1.0, 1.25, 1.5, 2.0];
    const nextIdx = (speeds.indexOf(playbackRate) + 1) % speeds.length;
    const nextSpeed = speeds[nextIdx];
    setPlaybackRate(nextSpeed);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextSpeed;
    }
  };

  // Filtered Podcasts
  const filteredPodcasts = podcasts.filter((p) => {
    const matchesSearch =
      p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesCategory =
      selectedCategory === 'all' || p.category.toLowerCase().includes(selectedCategory.toLowerCase());

    const matchesStatus = selectedStatus === 'all' || p.status === selectedStatus;

    return matchesSearch && matchesCategory && matchesStatus;
  });

  // Handle Export download
  const handleDownload = async () => {
    if (!exportModalItem) return;
    setIsExporting(true);

    try {
      const buffer = base64ToArrayBuffer(exportModalItem.rawAudioWavBase64);
      const blob = new Blob([buffer], { type: 'audio/wav' });

      await exportAudioWithQuality(
        blob,
        exportFormat,
        exportQuality,
        `${exportModalItem.title}_${exportModalItem.voiceName}`
      );
      setExportModalItem(null);
    } catch (err) {
      console.error('Download error:', err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Hidden DOM Audio Element for Native Reliable Playback */}
      <audio
        ref={audioRef}
        src={audioUrl || undefined}
        preload="auto"
        onTimeUpdate={() => {
          if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
        }}
        onLoadedMetadata={() => {
          if (audioRef.current) {
            const d = audioRef.current.duration;
            if (d && !isNaN(d) && d !== Infinity) {
              setDuration(d);
            } else if (activePodcast) {
              setDuration(activePodcast.durationSeconds || 0);
            }
          }
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          setIsPlaying(false);
          setCurrentTime(0);
        }}
        onError={(e) => {
          console.warn('Audio playback error:', e);
          setIsPlaying(false);
        }}
      />

      {/* Playback Toast Notice (replaces window.alert) */}
      {playbackNotice && (
        <div className="p-3 bg-[#C4552D]/10 border border-[#C4552D]/30 rounded-xl text-xs text-[#C4552D] font-mono flex items-center justify-between animate-fadeIn">
          <span>{playbackNotice}</span>
          <button
            type="button"
            onClick={() => setPlaybackNotice(null)}
            className="text-[#C4552D] hover:underline cursor-pointer ml-3 font-sans"
          >
            ✕
          </button>
        </div>
      )}

      {/* Top Banner / Actions */}
      <div className="border border-[rgba(22,21,17,0.14)] rounded-[22px] bg-[rgba(255,255,255,0.65)] backdrop-blur-md p-6 sm:p-7 shadow-[0_20px_40px_-20px_rgba(22,21,17,0.18)]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-[#0E7C86]/10 text-[#0A5A62] border border-[#0E7C86]/30 flex items-center gap-1.5">
                <FolderKanban className="w-3.5 h-3.5 text-[#0E7C86]" />
                {lang === 'uz' ? 'Podkastlar CMS Boshqaruvi' : 'CMS Управление Подкастами'}
              </span>
              <span className="text-xs text-[#5D594E]/40">•</span>
              <span className="text-xs font-mono text-[#5D594E]">{podcasts.length} {lang === 'uz' ? 'ta podkast' : 'подкастов'}</span>
            </div>
            <h2 className="font-serif text-2xl sm:text-3xl text-[#161511] font-normal tracking-tight mt-1">
              {lang === 'uz' ? 'Podkastlar Kutubxonasi va ' : 'Библиотека и '}
              <em className="text-[#0E7C86] italic">{lang === 'uz' ? 'Boshqaruvi' : 'Управление Подкастами'}</em>
            </h2>
            <p className="text-xs sm:text-sm text-[#5D594E] mt-1 max-w-2xl">
              {lang === 'uz'
                ? 'Tarixiy, komedik va boshqa toifadagi podkastlaringizni tashkillashtiring, tavsiflar va teglarni boshqaring hamda MP3/WAV formatida eksport qiling.'
                : 'Организуйте свои исторические, комедийные и другие подкасты, управляйте тегами и экспортируйте в MP3/WAV.'}
            </p>
          </div>

          <button
            type="button"
            onClick={onCreateNew}
            className="btn-pill btn-solid text-xs sm:text-sm font-semibold flex items-center gap-2 self-start md:self-center shadow-xs cursor-pointer"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>{lang === 'uz' ? 'Yangi Podkast Yaratish' : 'Создать Подкаст'}</span>
          </button>
        </div>

        {/* Search & Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mt-6 pt-5 border-t border-[rgba(22,21,17,0.1)]">
          {/* Search Box */}
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#5D594E]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={lang === 'uz' ? 'Podkast nomi, tavsif yoki #teg bo\'yicha qidirish...' : 'Поиск по названию, описанию или #тегу...'}
              className="w-full bg-[#F4F1EA] border border-[rgba(22,21,17,0.14)] rounded-xl pl-10 pr-4 py-2 text-xs sm:text-sm text-[#161511] placeholder-[#5D594E]/60 focus:outline-none focus:border-[#0E7C86] focus:bg-white transition-colors"
            />
          </div>

          {/* Category Filter */}
          <div className="flex items-center gap-2">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="bg-[#F4F1EA] border border-[rgba(22,21,17,0.14)] text-xs sm:text-sm text-[#161511] rounded-xl px-3 py-2 focus:outline-none focus:border-[#0E7C86] focus:bg-white transition-colors"
            >
              <option value="all">{lang === 'uz' ? 'Barcha Kategoriyalar' : 'Все категории'}</option>
              {PODCAST_CATEGORIES.map((c) => (
                <option key={c.id} value={c.nameUz}>
                  {lang === 'uz' ? c.nameUz : c.nameRu}
                </option>
              ))}
            </select>

            {/* Status Filter */}
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="bg-[#F4F1EA] border border-[rgba(22,21,17,0.14)] text-xs sm:text-sm text-[#161511] rounded-xl px-3 py-2 focus:outline-none focus:border-[#0E7C86] focus:bg-white transition-colors"
            >
              <option value="all">{lang === 'uz' ? 'Barcha holatlar' : 'Все статусы'}</option>
              <option value="published">{lang === 'uz' ? 'Tayyor / Nashr' : 'Готово'}</option>
              <option value="draft">{lang === 'uz' ? 'Qoralama' : 'Черновик'}</option>
            </select>
          </div>
        </div>
      </div>

      {/* Podcast List Grid */}
      {filteredPodcasts.length === 0 ? (
        <div className="bg-white border border-[rgba(22,21,17,0.14)] rounded-[22px] p-12 text-center space-y-4 shadow-xs">
          <div className="w-16 h-16 rounded-2xl bg-[#F4F1EA] flex items-center justify-center mx-auto text-[#0E7C86]">
            <FolderKanban className="w-8 h-8" />
          </div>
          <div>
            <h3 className="font-serif text-lg text-[#161511]">
              {lang === 'uz' ? 'Hech qanday podkast topilmadi' : 'Подкасты не найдены'}
            </h3>
            <p className="text-xs text-[#5D594E] mt-1 max-w-md mx-auto">
              {lang === 'uz'
                ? 'Qidiruv parametrlarini o\'zgartiring yoki "Yangi Podkast Yaratish" tugmasini bosib birinchi o\'zbekcha podkastingizni yarating.'
                : 'Измените параметры поиска или создайте свой первый подкаст.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onCreateNew}
            className="btn-pill btn-solid text-xs font-semibold inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>{lang === 'uz' ? 'Podkast yaratish' : 'Создать подкаст'}</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {filteredPodcasts.map((podcast) => (
            <div
              key={podcast.id}
              className="bg-white border border-[rgba(22,21,17,0.14)] hover:border-[#0E7C86] rounded-[20px] p-5 flex flex-col justify-between transition-all hover:shadow-md group shadow-xs"
            >
              <div className="space-y-3">
                {/* Header Badge & Episode */}
                <div className="flex items-center justify-between gap-2">
                  <span className="px-2.5 py-0.5 rounded-full text-[10.5px] font-mono font-semibold bg-[#F4F1EA] text-[#0A5A62] border border-[rgba(22,21,17,0.1)]">
                    {podcast.category}
                  </span>
                  <div className="flex items-center gap-1.5 text-xs text-[#5D594E]">
                    {podcast.status === 'published' ? (
                      <span className="flex items-center gap-1 text-[#0E7C86] text-[10.5px] font-mono font-medium bg-[#0E7C86]/10 px-2 py-0.5 rounded-full border border-[#0E7C86]/30">
                        <CheckCircle2 className="w-3 h-3" />
                        {lang === 'uz' ? 'Tayyor' : 'Готово'}
                      </span>
                    ) : (
                      <span className="text-[10.5px] font-mono text-[#C98A12] bg-[#C98A12]/10 px-2 py-0.5 rounded-full border border-[#C98A12]/30">
                        {lang === 'uz' ? 'Qoralama' : 'Черновик'}
                      </span>
                    )}
                  </div>
                </div>

                {/* Title */}
                <h3 className="font-semibold text-[#161511] text-base leading-snug line-clamp-2 group-hover:text-[#0E7C86] transition-colors">
                  {podcast.title}
                </h3>

                {/* Description */}
                <p className="text-xs text-[#5D594E] line-clamp-3 leading-relaxed">
                  {podcast.description || (lang === 'uz' ? 'Tavsif kiritilmagan' : 'Нет описания')}
                </p>

                {/* Tags */}
                {podcast.tags && podcast.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {podcast.tags.map((tag, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-[#F4F1EA] text-[#5D594E] border border-[rgba(22,21,17,0.1)] flex items-center gap-1"
                      >
                        <Tag className="w-2.5 h-2.5 text-[#0E7C86]" />
                        {tag.startsWith('#') ? tag : `#${tag}`}
                      </span>
                    ))}
                  </div>
                )}

                {/* Voice & Duration Specs */}
                <div className="pt-2 border-t border-[rgba(22,21,17,0.1)] flex items-center justify-between text-[11px] text-[#5D594E] font-mono">
                  <span className="flex items-center gap-1">
                    <Volume2 className="w-3 h-3 text-[#0E7C86]" />
                    {podcast.voiceName}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3 text-[#5D594E]/60" />
                    {Math.round(podcast.durationSeconds)}s
                  </span>
                </div>

                {/* Inline Progress Bar when playing this podcast */}
                {activePodcast?.id === podcast.id && (
                  <div className="pt-2">
                    <div className="flex items-center justify-between text-[10px] font-mono text-[#0E7C86] mb-1">
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-[#0E7C86] animate-pulse" />
                        {isPlaying ? (lang === 'uz' ? 'Tinglanmoqda' : 'Играет') : (lang === 'uz' ? 'Pauza' : 'Пауза')}
                      </span>
                      <span>{formatSeconds(currentTime)} / {formatSeconds(duration || podcast.durationSeconds)}</span>
                    </div>
                    <div className="w-full bg-[#E5E0D5] rounded-full h-1.5 overflow-hidden">
                      <div
                        className="bg-[#0E7C86] h-full transition-all duration-150"
                        style={{
                          width: `${Math.min(100, Math.max(0, (currentTime / (duration || podcast.durationSeconds || 1)) * 100))}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Bottom Card Actions */}
              <div className="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-[rgba(22,21,17,0.1)]">
                <div className="flex items-center gap-1.5">
                  {/* Direct Play/Pause Audio in Library */}
                  <button
                    type="button"
                    onClick={() => handleTogglePlay(podcast)}
                    className={`p-2 rounded-full transition-all cursor-pointer shadow-xs ${
                      activePodcast?.id === podcast.id && isPlaying
                        ? 'bg-[#0E7C86] text-white ring-2 ring-[#0E7C86]/30'
                        : 'bg-[#161511] text-[#F4F1EA] hover:bg-[#0A5A62]'
                    }`}
                    title={
                      activePodcast?.id === podcast.id && isPlaying
                        ? (lang === 'uz' ? "Pauza" : 'Пауза')
                        : (lang === 'uz' ? "Kutubxonada tinglash" : 'Слушать в библиотеке')
                    }
                  >
                    {activePodcast?.id === podcast.id && isPlaying ? (
                      <Pause className="w-3.5 h-3.5 fill-current" />
                    ) : (
                      <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                    )}
                  </button>

                  {/* Open in Studio */}
                  <button
                    type="button"
                    onClick={() => onOpenInStudio(podcast)}
                    className="p-2 rounded-full bg-[#F4F1EA] hover:bg-[#ECE7DB] text-[#161511] border border-[rgba(22,21,17,0.14)] transition-colors cursor-pointer"
                    title={lang === 'uz' ? 'Studiyada ochish' : 'Открыть в студии'}
                  >
                    <Layers className="w-3.5 h-3.5" />
                  </button>

                  {/* Export / Download */}
                  <button
                    type="button"
                    onClick={() => setExportModalItem(podcast)}
                    className="p-2 rounded-full bg-[#F4F1EA] hover:bg-[#ECE7DB] text-[#161511] border border-[rgba(22,21,17,0.14)] transition-colors cursor-pointer"
                    title={lang === 'uz' ? 'Eksport / Yuklab olish (MP3/WAV)' : 'Экспорт (MP3/WAV)'}
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>

                  {/* Edit Metadata */}
                  <button
                    type="button"
                    onClick={() => setEditingItem(podcast)}
                    className="p-2 rounded-full bg-[#F4F1EA] hover:bg-[#ECE7DB] text-[#161511] border border-[rgba(22,21,17,0.14)] transition-colors cursor-pointer"
                    title={lang === 'uz' ? 'Tahrirlash' : 'Редактировать'}
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (confirm(lang === 'uz' ? 'Ushbu podkastni o\'chirishni xohlaysizmi?' : 'Удалить этот подкаст?')) {
                      if (activePodcast?.id === podcast.id) {
                        stopAudio();
                        setActivePodcast(null);
                      }
                      onDeletePodcast(podcast.id);
                    }
                  }}
                  className="p-2 rounded-full text-[#5D594E] hover:text-[#C4552D] hover:bg-[#C4552D]/10 transition-colors cursor-pointer"
                  title={lang === 'uz' ? 'O\'chirish' : 'Удалить'}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit Podcast Metadata Modal */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#161511]/60 backdrop-blur-sm overflow-y-auto">
          <div className="relative w-full max-w-lg bg-[#F4F1EA] text-[#161511] border border-[rgba(22,21,17,0.14)] rounded-[24px] p-6 sm:p-7 shadow-[0_30px_50px_-30px_rgba(22,21,17,0.35)] space-y-4">
            <h3 className="font-serif text-xl text-[#161511]">
              {lang === 'uz' ? 'Podkast ma\'lumotlarini tahrirlash' : 'Редактирование подкаста'}
            </h3>

            {/* Title */}
            <div>
              <label className="block text-[11px] font-mono uppercase tracking-wider text-[#5D594E] mb-1">
                {lang === 'uz' ? 'Sarlavha' : 'Название'}
              </label>
              <input
                type="text"
                value={editingItem.title}
                onChange={(e) => setEditingItem({ ...editingItem, title: e.target.value })}
                className="w-full bg-white border border-[rgba(22,21,17,0.14)] rounded-xl px-3.5 py-2 text-sm text-[#161511] focus:outline-none focus:border-[#0E7C86]"
              />
            </div>

            {/* Category */}
            <div>
              <label className="block text-[11px] font-mono uppercase tracking-wider text-[#5D594E] mb-1">
                {lang === 'uz' ? 'Kategoriya' : 'Категория'}
              </label>
              <select
                value={editingItem.category}
                onChange={(e) => setEditingItem({ ...editingItem, category: e.target.value })}
                className="w-full bg-white border border-[rgba(22,21,17,0.14)] rounded-xl px-3 py-2 text-xs text-[#161511] focus:outline-none focus:border-[#0E7C86]"
              >
                {PODCAST_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.nameUz}>
                    {lang === 'uz' ? c.nameUz : c.nameRu}
                  </option>
                ))}
              </select>
            </div>

            {/* Description */}
            <div>
              <label className="block text-[11px] font-mono uppercase tracking-wider text-[#5D594E] mb-1">
                {lang === 'uz' ? 'Tavsif (Description)' : 'Описание'}
              </label>
              <textarea
                rows={3}
                value={editingItem.description}
                onChange={(e) => setEditingItem({ ...editingItem, description: e.target.value })}
                className="w-full bg-white border border-[rgba(22,21,17,0.14)] rounded-xl p-3 text-xs text-[#161511] focus:outline-none focus:border-[#0E7C86] resize-none"
              />
            </div>

            {/* Tags (comma separated) */}
            <div>
              <label className="block text-[11px] font-mono uppercase tracking-wider text-[#5D594E] mb-1">
                {lang === 'uz' ? 'Teglar (Vergul bilan ajrating)' : 'Теги (через запятую)'}
              </label>
              <input
                type="text"
                value={editingItem.tags.join(', ')}
                onChange={(e) =>
                  setEditingItem({
                    ...editingItem,
                    tags: e.target.value
                      .split(',')
                      .map((t) => t.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="Tarix, Amir Temur, Samarqand, O'zbekiston"
                className="w-full bg-white border border-[rgba(22,21,17,0.14)] rounded-xl px-3 py-2 text-xs text-[#161511] focus:outline-none focus:border-[#0E7C86]"
              />
            </div>

            {/* Status */}
            <div>
              <label className="block text-[11px] font-mono uppercase tracking-wider text-[#5D594E] mb-1">
                {lang === 'uz' ? 'Holat' : 'Статус'}
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditingItem({ ...editingItem, status: 'published' })}
                  className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                    editingItem.status === 'published'
                      ? 'bg-[#161511] text-[#F4F1EA] border-[#161511]'
                      : 'bg-white text-[#5D594E] border-[rgba(22,21,17,0.14)]'
                  }`}
                >
                  {lang === 'uz' ? 'Tayyor / Nashr' : 'Готово'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingItem({ ...editingItem, status: 'draft' })}
                  className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                    editingItem.status === 'draft'
                      ? 'bg-[#161511] text-[#F4F1EA] border-[#161511]'
                      : 'bg-white text-[#5D594E] border-[rgba(22,21,17,0.14)]'
                  }`}
                >
                  {lang === 'uz' ? 'Qoralama' : 'Черновик'}
                </button>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-3 border-t border-[rgba(22,21,17,0.14)]">
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="btn-pill btn-ghost text-xs"
              >
                {lang === 'uz' ? 'Bekor qilish' : 'Отмена'}
              </button>
              <button
                type="button"
                onClick={() => {
                  onUpdatePodcast(editingItem);
                  setEditingItem(null);
                }}
                className="btn-pill btn-solid text-xs"
              >
                {lang === 'uz' ? 'Saqlash' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Audio Modal (Requested: popular audio formats MP3, WAV with quality selection) */}
      {exportModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#161511]/60 backdrop-blur-sm">
          <div className="w-full max-w-md bg-[#F4F1EA] text-[#161511] border border-[rgba(22,21,17,0.14)] rounded-[24px] p-6 shadow-[0_30px_50px_-30px_rgba(22,21,17,0.35)] space-y-4">
            <h3 className="font-serif text-lg text-[#161511] flex items-center gap-2">
              <Download className="w-4 h-4 text-[#0E7C86]" />
              <span>{lang === 'uz' ? 'Audio formatini tanlang va yuklab oling' : 'Выберите формат и качество'}</span>
            </h3>

            <p className="text-xs text-[#5D594E]">
              <strong>{exportModalItem.title}</strong>
            </p>

            {/* Format */}
            <div>
              <label className="block text-[11px] font-mono uppercase tracking-wider text-[#5D594E] mb-1">
                {lang === 'uz' ? 'Format' : 'Формат'}
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setExportFormat('wav')}
                  className={`py-2.5 rounded-xl text-xs font-mono font-bold border transition-all cursor-pointer ${
                    exportFormat === 'wav'
                      ? 'bg-[#161511] text-[#F4F1EA] border-[#161511]'
                      : 'bg-white text-[#5D594E] border-[rgba(22,21,17,0.14)]'
                  }`}
                >
                  WAV (Studio Master)
                </button>
                <button
                  type="button"
                  onClick={() => setExportFormat('mp3')}
                  className={`py-2.5 rounded-xl text-xs font-mono font-bold border transition-all cursor-pointer ${
                    exportFormat === 'mp3'
                      ? 'bg-[#161511] text-[#F4F1EA] border-[#161511]'
                      : 'bg-white text-[#5D594E] border-[rgba(22,21,17,0.14)]'
                  }`}
                >
                  MP3
                </button>
              </div>
            </div>

            {/* Quality */}
            <div>
              <label className="block text-[11px] font-mono uppercase tracking-wider text-[#5D594E] mb-1">
                {lang === 'uz' ? 'Sifat (Bitrate / Sampling)' : 'Качество (Битрейт)'}
              </label>
              <select
                value={exportQuality}
                onChange={(e: any) => setExportQuality(e.target.value)}
                className="w-full bg-white border border-[rgba(22,21,17,0.14)] rounded-xl px-3 py-2 text-xs text-[#161511] focus:outline-none focus:border-[#0E7C86]"
              >
                <option value="lossless">Lossless (24kHz Studio Master 16-bit)</option>
                <option value="320k">320 kbps (Maksimal sifat / Maximum HQ)</option>
                <option value="192k">192 kbps (Standard Podkast)</option>
                <option value="128k">128 kbps (Ixcham hajm / Compact)</option>
              </select>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-3 border-t border-[rgba(22,21,17,0.14)]">
              <button
                type="button"
                onClick={() => setExportModalItem(null)}
                className="btn-pill btn-ghost text-xs"
              >
                {lang === 'uz' ? 'Yopish' : 'Закрыть'}
              </button>
              <button
                type="button"
                onClick={handleDownload}
                disabled={isExporting}
                className="btn-pill btn-solid text-xs font-semibold flex items-center gap-2 cursor-pointer"
              >
                {isExporting ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>{lang === 'uz' ? 'Yuklanmoqda...' : 'Скачивание...'}</span>
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5" />
                    <span>{lang === 'uz' ? 'Yuklab olish' : 'Скачать'}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Sticky Audio Player for Library Playback */}
      {activePodcast && (
        <div className="fixed bottom-4 left-4 right-4 sm:left-6 sm:right-6 md:left-24 md:right-8 z-40 bg-[#161511]/95 text-[#F4F1EA] backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-3 sm:p-4 animate-in slide-in-from-bottom-4 duration-200">
          <div className="flex flex-col gap-2.5">
            {/* Top row: Track Info & Controls */}
            <div className="flex items-center justify-between gap-3">
              {/* Left Track Info */}
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-10 h-10 rounded-xl bg-[#0E7C86]/20 border border-[#0E7C86]/40 flex items-center justify-center shrink-0">
                  <Radio className={`w-5 h-5 text-[#5CC8CF] ${isPlaying ? 'animate-pulse' : ''}`} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-white/10 text-[#5CC8CF]">
                      {activePodcast.category}
                    </span>
                    <span className="text-[11px] font-mono text-[#EDEAE2]/60 hidden sm:inline">
                      {activePodcast.voiceName}
                    </span>
                  </div>
                  <h4 className="text-xs sm:text-sm font-semibold truncate text-[#F4F1EA] mt-0.5">
                    {activePodcast.title}
                  </h4>
                </div>
              </div>

              {/* Center Controls */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleCycleSpeed}
                  className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-[11px] font-mono font-bold text-[#5CC8CF] transition-colors cursor-pointer"
                  title={lang === 'uz' ? 'Tezlik' : 'Скорость'}
                >
                  {playbackRate}x
                </button>

                <button
                  type="button"
                  onClick={() => handleTogglePlay(activePodcast)}
                  className="w-10 h-10 rounded-full bg-[#0E7C86] hover:bg-[#119CA8] text-white flex items-center justify-center transition-all cursor-pointer shadow-md"
                >
                  {isPlaying ? (
                    <Pause className="w-4 h-4 fill-current" />
                  ) : (
                    <Play className="w-4 h-4 fill-current ml-0.5" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => onOpenInStudio(activePodcast)}
                  className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-[#EDEAE2] transition-colors cursor-pointer hidden sm:flex items-center gap-1.5 text-xs font-semibold"
                  title={lang === 'uz' ? 'Studiyada ochish' : 'Открыть в студии'}
                >
                  <Layers className="w-3.5 h-3.5 text-[#5CC8CF]" />
                  <span>{lang === 'uz' ? 'Studiya' : 'Студия'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setExportModalItem(activePodcast)}
                  className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-[#EDEAE2] transition-colors cursor-pointer hidden sm:flex items-center gap-1.5 text-xs"
                  title={lang === 'uz' ? 'Yuklab olish' : 'Скачать'}
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Right: Volume & Dismiss */}
              <div className="flex items-center gap-2 shrink-0">
                <div className="hidden md:flex items-center gap-2 mr-2">
                  <button
                    type="button"
                    onClick={handleToggleMute}
                    className="p-1.5 text-[#EDEAE2]/80 hover:text-white cursor-pointer"
                  >
                    {isMuted || volume === 0 ? (
                      <VolumeX className="w-4 h-4 text-[#C4552D]" />
                    ) : (
                      <Volume2 className="w-4 h-4 text-[#5CC8CF]" />
                    )}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={isMuted ? 0 : volume}
                    onChange={(e) => handleVolumeChange(Number(e.target.value))}
                    className="w-16 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-[#0E7C86]"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => {
                    stopAudio();
                    setActivePodcast(null);
                  }}
                  className="p-1.5 rounded-full hover:bg-white/10 text-[#EDEAE2]/60 hover:text-white transition-colors cursor-pointer"
                  title={lang === 'uz' ? 'Yopish' : 'Закрыть'}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Bottom Scrubber */}
            <div className="flex items-center gap-3">
              <span className="text-[10.5px] font-mono text-[#EDEAE2]/60 w-10 text-right shrink-0">
                {formatSeconds(currentTime)}
              </span>
              <div className="relative flex-1 flex items-center">
                <input
                  type="range"
                  min={0}
                  max={duration || activePodcast.durationSeconds || 1}
                  step={0.1}
                  value={currentTime}
                  onChange={(e) => handleSeek(Number(e.target.value))}
                  className="w-full h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-[#5CC8CF]"
                />
              </div>
              <span className="text-[10.5px] font-mono text-[#EDEAE2]/60 w-10 shrink-0">
                {formatSeconds(duration || activePodcast.durationSeconds)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
