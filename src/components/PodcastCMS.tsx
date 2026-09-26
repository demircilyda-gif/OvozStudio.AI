import React, { useState } from 'react';
import {
  FolderKanban,
  Search,
  Plus,
  Tag,
  Filter,
  Trash2,
  Edit3,
  Play,
  Download,
  Calendar,
  Clock,
  Sparkles,
  Layers,
  FileAudio,
  CheckCircle2,
  FileText,
  Volume2
} from 'lucide-react';
import { GeneratedPodcast } from '../types/podcast';
import { PODCAST_CATEGORIES } from '../data/categories';
import { exportAudioWithQuality, base64ToArrayBuffer } from '../utils/audioUtils';

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
      {/* Top Banner / Actions */}
      <div className="bg-gradient-to-r from-zinc-900 via-zinc-900/90 to-zinc-950 border border-zinc-800 rounded-3xl p-5 sm:p-7 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 flex items-center gap-1.5">
                <FolderKanban className="w-3.5 h-3.5 text-cyan-400" />
                {lang === 'uz' ? 'Podkastlar CMS Boshqaruvi' : 'CMS Управление Подкастами'}
              </span>
              <span className="text-xs text-zinc-500">•</span>
              <span className="text-xs text-zinc-400">{podcasts.length} {lang === 'uz' ? 'ta podkast' : 'подкастов'}</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-white mt-1">
              {lang === 'uz' ? 'Podkastlar Kutubxonasi va Boshqaruvi' : 'Библиотека и Управление Подкастами'}
            </h2>
            <p className="text-xs sm:text-sm text-zinc-400 mt-1 max-w-2xl">
              {lang === 'uz'
                ? 'Tarixiy, komedik va boshqa toifadagi podkastlaringizni tashkillashtiring, tavsiflar va teglarni boshqaring hamda MP3/WAV formatida eksport qiling.'
                : 'Организуйте свои исторические, комедийные и другие подкасты, управляйте тегами и экспортируйте в MP3/WAV.'}
            </p>
          </div>

          <button
            onClick={onCreateNew}
            className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-zinc-950 font-bold text-sm shadow-lg shadow-cyan-500/20 transition-all hover:scale-105 active:scale-95 self-start md:self-center"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>{lang === 'uz' ? 'Yangi Podkast Yaratish' : 'Создать Подкаст'}</span>
          </button>
        </div>

        {/* Search & Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mt-6 pt-5 border-t border-zinc-800/80">
          {/* Search Box */}
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={lang === 'uz' ? 'Podkast nomi, tavsif yoki #teg bo\'yicha qidirish...' : 'Поиск по названию, описанию или #тегу...'}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-10 pr-4 py-2 text-xs sm:text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500"
            />
          </div>

          {/* Category Filter */}
          <div className="flex items-center gap-2">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 text-xs sm:text-sm text-zinc-300 rounded-xl px-3 py-2 focus:outline-none focus:border-cyan-500"
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
              className="bg-zinc-950 border border-zinc-800 text-xs sm:text-sm text-zinc-300 rounded-xl px-3 py-2 focus:outline-none focus:border-cyan-500"
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
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-3xl p-12 text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-zinc-800 flex items-center justify-center mx-auto text-zinc-500">
            <FolderKanban className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">
              {lang === 'uz' ? 'Hech qanday podkast topilmadi' : 'Подкасты не найдены'}
            </h3>
            <p className="text-xs text-zinc-400 mt-1 max-w-md mx-auto">
              {lang === 'uz'
                ? 'Qidiruv parametrlarini o\'zgartiring yoki "Yangi Podkast Yaratish" tugmasini bosib birinchi o\'zbekcha podkastingizni yarating.'
                : 'Измените параметры поиска или создайте свой первый подкаст.'}
            </p>
          </div>
          <button
            onClick={onCreateNew}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-zinc-950 font-bold text-xs"
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
              className="bg-zinc-900/80 border border-zinc-800 hover:border-zinc-700/80 rounded-2xl p-5 flex flex-col justify-between transition-all hover:shadow-xl group"
            >
              <div className="space-y-3">
                {/* Header Badge & Episode */}
                <div className="flex items-center justify-between gap-2">
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-zinc-800 text-cyan-300 border border-zinc-700/80">
                    {podcast.category}
                  </span>
                  <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                    {podcast.status === 'published' ? (
                      <span className="flex items-center gap-1 text-emerald-400 text-[11px] font-medium bg-emerald-950/40 px-2 py-0.5 rounded-full border border-emerald-800/40">
                        <CheckCircle2 className="w-3 h-3" />
                        {lang === 'uz' ? 'Tayyor' : 'Готово'}
                      </span>
                    ) : (
                      <span className="text-[11px] text-amber-400 bg-amber-950/40 px-2 py-0.5 rounded-full border border-amber-800/40">
                        {lang === 'uz' ? 'Qoralama' : 'Черновик'}
                      </span>
                    )}
                  </div>
                </div>

                {/* Title */}
                <h3 className="font-bold text-white text-base leading-snug line-clamp-2 group-hover:text-cyan-400 transition-colors">
                  {podcast.title}
                </h3>

                {/* Description */}
                <p className="text-xs text-zinc-400 line-clamp-3 leading-relaxed">
                  {podcast.description || (lang === 'uz' ? 'Tavsif kiritilmagan' : 'Нет описания')}
                </p>

                {/* Tags */}
                {podcast.tags && podcast.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {podcast.tags.map((tag, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-zinc-950 text-zinc-300 border border-zinc-800 flex items-center gap-1"
                      >
                        <Tag className="w-2.5 h-2.5 text-cyan-400" />
                        {tag.startsWith('#') ? tag : `#${tag}`}
                      </span>
                    ))}
                  </div>
                )}

                {/* Voice & Duration Specs */}
                <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between text-[11px] text-zinc-400 font-mono">
                  <span className="flex items-center gap-1">
                    <Volume2 className="w-3 h-3 text-cyan-400" />
                    {podcast.voiceName}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3 text-zinc-500" />
                    {Math.round(podcast.durationSeconds)}s
                  </span>
                </div>
              </div>

              {/* Bottom Card Actions */}
              <div className="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-zinc-800/60">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onOpenInStudio(podcast)}
                    className="p-2 rounded-xl bg-zinc-800 hover:bg-cyan-500/20 text-zinc-300 hover:text-cyan-300 border border-zinc-700/60 transition-colors"
                    title={lang === 'uz' ? 'Studiyada ochish / Tinglash' : 'Открыть в студии'}
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                  </button>

                  <button
                    onClick={() => setExportModalItem(podcast)}
                    className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-zinc-700/60 transition-colors"
                    title={lang === 'uz' ? 'Eksport / Yuklab olish (MP3/WAV)' : 'Экспорт (MP3/WAV)'}
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={() => setEditingItem(podcast)}
                    className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-zinc-700/60 transition-colors"
                    title={lang === 'uz' ? 'Tahrirlash' : 'Редактировать'}
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <button
                  onClick={() => {
                    if (confirm(lang === 'uz' ? 'Ushbu podkastni o\'chirishni xohlaysizmi?' : 'Удалить этот подкаст?')) {
                      onDeletePodcast(podcast.id);
                    }
                  }}
                  className="p-2 rounded-xl text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-zinc-950/80 backdrop-blur-md overflow-y-auto">
          <div className="relative w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-3xl p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-white">
              {lang === 'uz' ? 'Podkast ma\'lumotlarini tahrirlash' : 'Редактирование подкаста'}
            </h3>

            {/* Title */}
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1">
                {lang === 'uz' ? 'Sarlavha' : 'Название'}
              </label>
              <input
                type="text"
                value={editingItem.title}
                onChange={(e) => setEditingItem({ ...editingItem, title: e.target.value })}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
              />
            </div>

            {/* Category */}
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1">
                {lang === 'uz' ? 'Kategoriya' : 'Категория'}
              </label>
              <select
                value={editingItem.category}
                onChange={(e) => setEditingItem({ ...editingItem, category: e.target.value })}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
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
              <label className="block text-xs font-semibold text-zinc-300 mb-1">
                {lang === 'uz' ? 'Tavsif (Description)' : 'Описание'}
              </label>
              <textarea
                rows={3}
                value={editingItem.description}
                onChange={(e) => setEditingItem({ ...editingItem, description: e.target.value })}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-xs text-zinc-200 focus:outline-none focus:border-cyan-500 resize-none"
              />
            </div>

            {/* Tags (comma separated) */}
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1">
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
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
              />
            </div>

            {/* Status */}
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1">
                {lang === 'uz' ? 'Holat' : 'Статус'}
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditingItem({ ...editingItem, status: 'published' })}
                  className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all ${
                    editingItem.status === 'published'
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                      : 'bg-zinc-950 text-zinc-400 border-zinc-800'
                  }`}
                >
                  {lang === 'uz' ? 'Tayyor / Nashr' : 'Готово'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingItem({ ...editingItem, status: 'draft' })}
                  className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all ${
                    editingItem.status === 'draft'
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                      : 'bg-zinc-950 text-zinc-400 border-zinc-800'
                  }`}
                >
                  {lang === 'uz' ? 'Qoralama' : 'Черновик'}
                </button>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
              <button
                onClick={() => setEditingItem(null)}
                className="px-4 py-2 rounded-xl text-xs text-zinc-400 hover:text-white"
              >
                {lang === 'uz' ? 'Bekor qilish' : 'Отмена'}
              </button>
              <button
                onClick={() => {
                  onUpdatePodcast(editingItem);
                  setEditingItem(null);
                }}
                className="px-5 py-2 rounded-xl bg-cyan-500 text-zinc-950 font-bold text-xs hover:bg-cyan-400"
              >
                {lang === 'uz' ? 'Saqlash' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Audio Modal (Requested: popular audio formats MP3, WAV with quality selection) */}
      {exportModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-zinc-950/80 backdrop-blur-md">
          <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Download className="w-4 h-4 text-cyan-400" />
              <span>{lang === 'uz' ? 'Audio formatini tanlang va yuklab oling' : 'Выберите формат и качество'}</span>
            </h3>

            <p className="text-xs text-zinc-400">
              <strong>{exportModalItem.title}</strong>
            </p>

            {/* Format */}
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1">
                {lang === 'uz' ? 'Format' : 'Формат'}
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setExportFormat('wav')}
                  className={`py-2.5 rounded-xl text-xs font-bold border transition-all ${
                    exportFormat === 'wav'
                      ? 'bg-cyan-500 text-zinc-950 border-cyan-400 shadow-md'
                      : 'bg-zinc-950 text-zinc-400 border-zinc-800'
                  }`}
                >
                  WAV (Studio Master)
                </button>
                <button
                  onClick={() => setExportFormat('mp3')}
                  className={`py-2.5 rounded-xl text-xs font-bold border transition-all ${
                    exportFormat === 'mp3'
                      ? 'bg-cyan-500 text-zinc-950 border-cyan-400 shadow-md'
                      : 'bg-zinc-950 text-zinc-400 border-zinc-800'
                  }`}
                >
                  MP3
                </button>
              </div>
            </div>

            {/* Quality */}
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1">
                {lang === 'uz' ? 'Sifat (Bitrate / Sampling)' : 'Качество (Битрейт)'}
              </label>
              <select
                value={exportQuality}
                onChange={(e: any) => setExportQuality(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-cyan-500"
              >
                <option value="lossless">Lossless (24kHz Studio Master 16-bit)</option>
                <option value="320k">320 kbps (Maksimal sifat / Maximum HQ)</option>
                <option value="192k">192 kbps (Standard Podkast)</option>
                <option value="128k">128 kbps (Ixcham hajm / Compact)</option>
              </select>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
              <button
                onClick={() => setExportModalItem(null)}
                className="px-4 py-2 rounded-xl text-xs text-zinc-400 hover:text-white"
              >
                {lang === 'uz' ? 'Yopish' : 'Закрыть'}
              </button>
              <button
                onClick={handleDownload}
                disabled={isExporting}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-zinc-950 font-bold text-xs hover:from-cyan-400 hover:to-blue-500"
              >
                {isExporting ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin" />
                    <span>{lang === 'uz' ? 'Yuklanmoqda...' : 'Скачивание...'}</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>{lang === 'uz' ? 'Yuklab olish' : 'Скачать'}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
