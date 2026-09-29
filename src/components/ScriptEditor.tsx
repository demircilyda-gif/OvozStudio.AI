import React, { useState, useMemo } from 'react';
import {
  FileText,
  Sparkles,
  Wand2,
  Clock,
  Play,
  RotateCcw,
  Tag,
  Smile,
  Wind,
  HelpCircle,
  Copy,
  Check,
  Upload,
  BookmarkPlus,
  Save,
  BookOpen,
  ChevronRight,
  Layers,
  Flame,
  ShieldCheck,
  Eraser,
  Eye,
} from 'lucide-react';
import { PodcastCategory, PodcastTopic } from '../types/podcast';
import { PODCAST_CATEGORIES } from '../data/categories';
import {
  stripAllStageConditions,
  detectScriptConditions,
} from '../utils/audioUtils';

interface ScriptEditorProps {
  category: PodcastCategory;
  onSelectCategory?: (category: PodcastCategory) => void;
  title: string;
  onChangeTitle: (title: string) => void;
  description: string;
  onChangeDescription: (desc: string) => void;
  tags: string[];
  onChangeTags: (tags: string[]) => void;
  scriptText: string;
  onChangeScriptText: (text: string) => void;
  tempo: number;
  onSynthesize: () => void;
  isSynthesizing: boolean;
  onSaveDraft?: () => void;
  onOpenDocumentModal?: () => void;
  lang: 'uz' | 'ru';
}

export interface ScriptChapter {
  id: string;
  timestamp: string;
  title: string;
  content: string;
}

export const ScriptEditor: React.FC<ScriptEditorProps> = ({
  category,
  onSelectCategory,
  title,
  onChangeTitle,
  description,
  onChangeDescription,
  tags,
  onChangeTags,
  scriptText,
  onChangeScriptText,
  tempo,
  onSynthesize,
  isSynthesizing,
  onSaveDraft,
  onOpenDocumentModal,
  lang,
}) => {
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [isGeneratingHourScript, setIsGeneratingHourScript] = useState(false);
  const [targetDuration, setTargetDuration] = useState<string>('30 daqiqa');
  const [customPrompt, setCustomPrompt] = useState('');
  const [copied, setCopied] = useState(false);
  const [chapters, setChapters] = useState<ScriptChapter[]>([]);
  const [activeChapterIndex, setActiveChapterIndex] = useState<number>(0);
  const [isExpandingChapter, setIsExpandingChapter] = useState(false);
  const [scriptViewMode, setScriptViewMode] = useState<'full' | 'pure'>('full');
  const [cleanNotice, setCleanNotice] = useState<string | null>(null);

  // Real-time analysis of script conditions
  const conditionAnalysis = useMemo(() => detectScriptConditions(scriptText), [scriptText]);

  const handleCleanConditions = () => {
    const cleaned = stripAllStageConditions(scriptText);
    onChangeScriptText(cleaned);
    setCleanNotice(
      lang === 'uz'
        ? "✅ Ssenariydagi barcha skobka va shartlar tozalandi! Faqat toza nutq qoldi."
        : '✅ Сценарий очищен от всех ремарок и таймкодов! Остался чистый текст речи.'
    );
    setTimeout(() => setCleanNotice(null), 4000);
  };

  // Word count & Duration calculation
  const currentTextToEstimate = scriptViewMode === 'pure' ? conditionAnalysis.cleanText : scriptText;
  const wordCount = currentTextToEstimate.trim() ? currentTextToEstimate.trim().split(/\s+/).filter(Boolean).length : 0;
  // Standard speech in Uzbek is roughly 125-130 words per minute at 1.0x
  const estimatedSeconds = Math.round((wordCount / (125 * tempo)) * 60);
  const estHours = Math.floor(estimatedSeconds / 3600);
  const estMins = Math.floor((estimatedSeconds % 3600) / 60);
  const estSecs = estimatedSeconds % 60;

  // Insert vocal cues or stage directions
  const insertCue = (cue: string) => {
    onChangeScriptText(scriptText ? `${scriptText} ${cue}` : cue);
  };

  const [isPolishing, setIsPolishing] = useState(false);

  // Polish user's draft and calibrate timing
  const handlePolishAndTiming = async () => {
    if (!scriptText.trim()) {
      alert(lang === 'uz' ? 'Iltimos, avval matn maydoniga qoralama yoki ssenariy matnini kiriting' : 'Сначала введите текст для анализа в поле ввода');
      return;
    }

    setIsPolishing(true);
    try {
      const res = await fetch('/api/podcast/analyze-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceText: scriptText,
          targetFormat: 'podcast',
          category: category.nameUz,
          userInstructions:
            'Ushbu qoralama yoki mavjud ssenariyni (rus, ingliz yoki o\'zbek tilidagi) chuqur tahlil qiling. Vaqt va temp me\'yorlariga moslang, nutq oqimini yaxshilang, tabiiy nafas va podkast belgilari (<breath>, <laugh>, |ha|, [Pauza 1s]) qo\'shing.',
        }),
      });

      if (!res.ok) throw new Error('Matnni tahlil qilishda xatolik yuz berdi');
      const data = await res.json();

      if (data.title && !title) onChangeTitle(data.title);
      if (data.description && !description) onChangeDescription(data.description);
      if (data.script) onChangeScriptText(data.script);
    } catch (err: any) {
      alert(`Xatolik: ${err.message}`);
    } finally {
      setIsPolishing(false);
    }
  };

  // Generate Script using Gemini 3.8 Flash
  const handleAIGenerate = async () => {
    setIsGeneratingScript(true);
    try {
      const res = await fetch('/api/podcast/generate-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: category.nameUz,
          topic: title || category.topics[0]?.titleUz || 'O\'zbekiston tarixi',
          style: category.suggestedStyle,
          targetDuration,
          customInstructions: customPrompt,
        }),
      });

      if (!res.ok) throw new Error('AI ssenariy yaratishda xato');
      const data = await res.json();

      if (data.title) onChangeTitle(data.title);
      if (data.description) onChangeDescription(data.description);
      if (data.script) onChangeScriptText(data.script);

      // Auto add tags
      const autoTags = [
        category.badgeUz,
        category.nameUz.split(' ')[0],
        'Podkast',
        'Gemini38'
      ];
      onChangeTags(autoTags);
    } catch (err: any) {
      alert(`Xatolik: ${err.message}`);
    } finally {
      setIsGeneratingScript(false);
    }
  };

  // Generate Full 1-Hour or 30-Min Multi-Chapter Longform Podcast
  const handleGenerateLongformPodcast = async () => {
    setIsGeneratingHourScript(true);
    try {
      const chosenTopic = title || category.topics[0]?.titleUz || 'O\'zbekiston va Jahon Tarixi';
      const res = await fetch('/api/podcast/generate-longform-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: category.nameUz,
          topic: chosenTopic,
          style: category.suggestedStyle,
          targetDuration,
          customInstructions: customPrompt,
        }),
      });

      if (!res.ok) throw new Error('Katta podkast ssenariysini yaratishda xato');
      const data = await res.json();

      if (data.title) onChangeTitle(data.title);
      if (data.description) onChangeDescription(data.description);
      if (data.fullScript) onChangeScriptText(data.fullScript);
      if (Array.isArray(data.chapters)) {
        setChapters(data.chapters);
      }

      const autoTags = [
        category.badgeUz,
        'KattaPodkast',
        targetDuration.includes('60') ? '1Soatlik' : '30Daqiqa',
        'Gemini38',
      ];
      onChangeTags(autoTags);
    } catch (err: any) {
      alert(`Xatolik: ${err.message}`);
    } finally {
      setIsGeneratingHourScript(false);
    }
  };

  // Expand active chapter
  const handleExpandChapter = async (chap: ScriptChapter) => {
    setIsExpandingChapter(true);
    try {
      const res = await fetch('/api/podcast/expand-chapter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: title,
          chapterTitle: chap.title,
          currentContent: chap.content,
        }),
      });

      if (!res.ok) throw new Error('Bobni kengaytirishda xato');
      const data = await res.json();
      if (data.expandedText) {
        const addition = `\n\n[QO'SHIMCHA TAHLIL - ${chap.title}]:\n${data.expandedText}`;
        onChangeScriptText(scriptText + addition);
      }
    } catch (e: any) {
      alert(`Xatolik: ${e.message}`);
    } finally {
      setIsExpandingChapter(false);
    }
  };

  // Select Topic from Category
  const handleSelectTopic = (topic: PodcastTopic) => {
    onChangeTitle(topic.titleUz);
    onChangeDescription(topic.descriptionUz);
    onChangeScriptText(topic.sampleScriptUz);
    onChangeTags([category.badgeUz, 'PodkastUz', topic.titleUz.split(' ')[0]]);
  };

  return (
    <div className="bg-zinc-900/80 border border-zinc-800 rounded-3xl p-5 sm:p-7 shadow-xl space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-zinc-800">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-white text-base sm:text-lg flex items-center gap-2">
              <FileText className="w-5 h-5 text-cyan-400" />
              <span>{lang === 'uz' ? 'Podkast Ssenariysi & Matni' : 'Сценарий и Текст подкаста'}</span>
            </h3>
            {onSelectCategory && (
              <select
                value={category.id}
                onChange={(e) => {
                  const found = PODCAST_CATEGORIES.find((c) => c.id === e.target.value);
                  if (found) onSelectCategory(found);
                }}
                className="bg-zinc-950 border border-cyan-500/30 rounded-xl px-2.5 py-1 text-xs text-cyan-300 font-semibold focus:outline-none focus:border-cyan-500 cursor-pointer"
              >
                {PODCAST_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.badgeUz} {lang === 'uz' ? c.nameUz : c.nameRu}
                  </option>
                ))}
              </select>
            )}
          </div>
          <p className="text-xs text-zinc-400 mt-0.5">
            {lang === 'uz'
              ? 'Mavzu bo\'yicha to\'liq ssenariy yarating, PDF yuklang yoki o\'z matningizni tahrirlang'
              : 'Создайте сценарий по теме, загрузите документ или редактируйте текст'}
          </p>
        </div>

        {/* Word count & Estimated duration */}
        <div className="flex items-center gap-3 bg-zinc-950 px-3.5 py-1.5 rounded-xl border border-zinc-800 text-xs font-mono text-zinc-300 self-start sm:self-center">
          <span className="text-zinc-400 font-semibold">{wordCount.toLocaleString()} {lang === 'uz' ? 'so\'z' : 'слов'}</span>
          <span className="text-zinc-600">•</span>
          <span className="text-cyan-400 flex items-center gap-1 font-bold">
            <Clock className="w-3.5 h-3.5 text-cyan-400" />
            {estHours > 0 ? `${estHours} soat ` : ''}{estMins}m {estSecs}s
          </span>
        </div>
      </div>

      {/* Target Duration Selector */}
      <div className="bg-zinc-950/70 border border-zinc-800/80 rounded-2xl p-3.5 space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-zinc-200 flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-cyan-400" />
            {lang === 'uz' ? 'Mo\'ljallangan Davomiylik (Xronometraj):' : 'Целевой хронометраж:'}
          </label>
          <span className="text-[11px] text-zinc-400">
            {lang === 'uz' ? 'To\'liq podkast standarti: kamida 30-60 daqiqa' : 'Стандарт: от 30 до 60 минут'}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {[
            { id: '5 daqiqa', label: '5 daq', sub: 'Qisqa intro/xuk' },
            { id: '15 daqiqa', label: '15 daq', sub: 'Ekspress son' },
            { id: '30 daqiqa', label: '30 daqiqa', sub: 'Standart podkast' },
            { id: '45 daqiqa', label: '45 daqiqa', sub: 'Katta son' },
            { id: '60 daqiqa (1 soat)', label: '60 daqiqa (1 soat)', sub: 'To\'liq 1 soatlik son' },
          ].map((item) => {
            const isSelected = targetDuration === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTargetDuration(item.id)}
                className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-cyan-500/20 border-cyan-400 text-white shadow-md shadow-cyan-500/10'
                    : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                }`}
              >
                <div className="text-xs font-bold flex items-center justify-between">
                  <span>{item.label}</span>
                  {isSelected && <Check className="w-3.5 h-3.5 text-cyan-400" />}
                </div>
                <div className="text-[10px] text-zinc-500 mt-0.5">{item.sub}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Suggested Topics from selected category */}
      {category.topics && category.topics.length > 0 && (
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            {lang === 'uz' ? 'Toifadagi Tayyor Mavzular:' : 'Готовые темы категории:'}
          </label>
          <div className="flex flex-wrap gap-2">
            {category.topics.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => handleSelectTopic(t)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium border text-left transition-all ${
                  title === t.titleUz
                    ? 'bg-cyan-500/15 border-cyan-500 text-cyan-300 font-bold'
                    : 'bg-zinc-950 border-zinc-800 text-zinc-300 hover:border-zinc-700 hover:text-white'
                }`}
              >
                {t.titleUz}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Title & Description Inputs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-zinc-300 mb-1">
            {lang === 'uz' ? 'Podkast Sarlavhasi' : 'Название подкаста'}
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => onChangeTitle(e.target.value)}
            placeholder="Masalan: Amir Temurning Samarqanddagi merosi"
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2 text-xs sm:text-sm text-white focus:outline-none focus:border-cyan-500"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-zinc-300 mb-1">
            {lang === 'uz' ? 'Qisqa Tavsif (Description)' : 'Краткое описание'}
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => onChangeDescription(e.target.value)}
            placeholder="Tinglovchilar uchun 1-2 jumlalik tushuntirish..."
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2 text-xs sm:text-sm text-white focus:outline-none focus:border-cyan-500"
          />
        </div>
      </div>

      {/* AI Generate Script Tool Bar */}
      <div className="p-4 bg-gradient-to-r from-cyan-950/40 via-indigo-950/30 to-purple-950/30 border border-cyan-500/30 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2.5 rounded-xl bg-cyan-500/20 text-cyan-400">
            <Sparkles className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h4 className="text-xs sm:text-sm font-bold text-white flex items-center gap-2">
              <span>{lang === 'uz' ? 'Gemini 3.8 AI Ssenariy Dvigateli' : 'Движок Сценариев Gemini 3.8'}</span>
              <span className="px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 text-[10px] font-mono border border-cyan-500/30">
                1 Soatlik Podkast
              </span>
            </h4>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              {lang === 'uz'
                ? `Tanlangan ${targetDuration} uchun 4-6 bobli to'liq matn yozish yoki PDF/maqolani tahlil qilish`
                : `Генерация полного сценария на ${targetDuration} по 4-6 главам или анализ документов`}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {onOpenDocumentModal && (
            <button
              type="button"
              onClick={onOpenDocumentModal}
              className="flex-1 md:flex-initial px-3.5 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-cyan-300 border border-cyan-500/40 font-semibold text-xs flex items-center justify-center gap-1.5 transition-all hover:scale-105 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{lang === 'uz' ? 'PDF / Maqola' : 'PDF / Статья'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={handlePolishAndTiming}
            disabled={isPolishing || !scriptText.trim()}
            className="flex-1 md:flex-initial px-3.5 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 text-emerald-300 border border-emerald-500/40 font-semibold text-xs flex items-center justify-center gap-1.5 transition-all hover:scale-105 cursor-pointer"
            title={lang === 'uz' ? 'Mavjud matnni tahlil qilish, temp va vaqtini to\'g\'rilash' : 'Анализ черновика, подгонка по времени и темпу'}
          >
            <Clock className={`w-3.5 h-3.5 ${isPolishing ? 'animate-spin' : ''}`} />
            <span>{isPolishing ? (lang === 'uz' ? 'Moslanmoqda...' : 'Подгонка...') : (lang === 'uz' ? 'Vaqtni To\'g\'rilash' : 'Подгонка по времени')}</span>
          </button>

          {/* Full 1-Hour Multi-Chapter Generator Button */}
          <button
            type="button"
            onClick={handleGenerateLongformPodcast}
            disabled={isGeneratingHourScript || isGeneratingScript}
            className="flex-1 md:flex-initial px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 hover:from-amber-400 hover:to-orange-400 text-zinc-950 font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20 transition-all hover:scale-105 active:scale-95 cursor-pointer"
            title="1 soatlik yoki 30 daqiqalik to'liq bobli podkast matnini yaratish"
          >
            {isGeneratingHourScript ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin" />
                <span>{lang === 'uz' ? 'Katta son yozilmoqda...' : 'Пишется выпуск...'}</span>
              </>
            ) : (
              <>
                <Flame className="w-4 h-4 fill-current text-zinc-950" />
                <span>{lang === 'uz' ? `1 Soatlik Podkast (Boblar bilan)` : 'Полный 1-Часовой Сценарий'}</span>
              </>
            )}
          </button>

          {/* Quick AI Generate Script Button */}
          <button
            type="button"
            onClick={handleAIGenerate}
            disabled={isGeneratingScript || isGeneratingHourScript}
            className="flex-1 md:flex-initial px-4 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-zinc-950 font-bold text-xs flex items-center justify-center gap-2 shadow-md shadow-cyan-500/20 transition-all hover:scale-105 active:scale-95 cursor-pointer"
          >
            {isGeneratingScript ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin" />
                <span>{lang === 'uz' ? 'Yozilmoqda...' : 'Генерация...'}</span>
              </>
            ) : (
              <>
                <Wand2 className="w-4 h-4" />
                <span>{lang === 'uz' ? 'Tezkor Ssenariy' : 'Быстрый сценарий'}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Chapters Navigation & Expansion Drawer if chapters generated */}
      {chapters.length > 0 && (
        <div className="p-3.5 bg-zinc-950 border border-amber-500/30 rounded-2xl space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-amber-400" />
              {lang === 'uz' ? 'Podkast Boblari (Taym-kodlar):' : 'Главы подкаста (Тайм-коды):'}
            </span>
            <span className="text-[10px] text-zinc-400">
              {chapters.length} {lang === 'uz' ? 'ta to\'liq bob' : 'глав'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {chapters.map((chap, idx) => (
              <div
                key={chap.id || idx}
                className="p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-amber-500/40 transition-colors flex flex-col justify-between gap-1.5"
              >
                <div>
                  <div className="text-[10px] font-mono text-cyan-400 font-semibold">{chap.timestamp}</div>
                  <div className="text-xs font-bold text-white line-clamp-1">{chap.title}</div>
                </div>
                <button
                  type="button"
                  onClick={() => handleExpandChapter(chap)}
                  disabled={isExpandingChapter}
                  className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-amber-300 text-[10px] font-semibold rounded-lg flex items-center justify-center gap-1 transition-colors"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>{lang === 'uz' ? 'Bobni Kengaytirish (+10 daq)' : 'Расширить главу (+10 мин)'}</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Vocal burst & podcast cue helpers + Mode Selector */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-zinc-400 mr-1 flex items-center gap-1">
            <Wind className="w-3 h-3 text-cyan-400" />
            {lang === 'uz' ? 'Ovoz effektlari:' : 'Эффекты:'}
          </span>
          {[
            { cue: '<breath>', label: '<breath>', icon: '💨' },
            { cue: '<laugh>', label: '<laugh>', icon: '😄' },
            { cue: '|ha|', label: '|ha|', icon: '🗣️' },
            { cue: '|mhm|', label: '|mhm|', icon: '✨' },
            { cue: '[Pauza 1s]', label: '[Pauza]', icon: '⏸️' },
            { cue: '[Hayajonli]', label: '[Hayajon]', icon: '🔥' },
          ].map((btn) => (
            <button
              key={btn.cue}
              type="button"
              onClick={() => insertCue(btn.cue)}
              className="px-2 py-0.5 rounded-lg text-[11px] bg-zinc-950 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 hover:border-zinc-700 transition-colors cursor-pointer"
            >
              <span>{btn.icon} {btn.label}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1 bg-zinc-950 p-0.5 rounded-lg border border-zinc-800">
            <button
              type="button"
              onClick={() => setScriptViewMode('full')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all flex items-center gap-1 cursor-pointer ${
                scriptViewMode === 'full'
                  ? 'bg-cyan-950 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <FileText className="w-3 h-3" />
              <span>{lang === 'uz' ? 'To\'liq Ssenariy' : 'Сценарий'}</span>
            </button>

            <button
              type="button"
              onClick={() => setScriptViewMode('pure')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all flex items-center gap-1 cursor-pointer ${
                scriptViewMode === 'pure'
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Eye className="w-3 h-3" />
              <span>{lang === 'uz' ? 'Toza Nutq' : 'Чистая речь'}</span>
            </button>
          </div>

          {conditionAnalysis.hasConditions && (
            <button
              type="button"
              onClick={handleCleanConditions}
              className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-amber-300 border border-amber-500/30 text-xs font-semibold rounded-lg flex items-center gap-1 transition-all hover:scale-105 cursor-pointer"
              title="Ssenariydan barcha skobka va shartlarni tozalash"
            >
              <Eraser className="w-3.5 h-3.5 text-amber-400" />
              <span>{lang === 'uz' ? 'Tozalash' : 'Очистить'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Clean Notification Banner */}
      {cleanNotice && (
        <div className="p-3 bg-emerald-950/60 border border-emerald-500/40 rounded-xl text-xs text-emerald-200 flex items-center gap-2 animate-in fade-in">
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{cleanNotice}</span>
        </div>
      )}

      {/* Condition Protection Banner */}
      {conditionAnalysis.hasConditions && (
        <div className="p-2.5 bg-indigo-950/40 border border-indigo-500/30 rounded-xl text-xs text-indigo-200 space-y-1">
          <div className="flex items-center gap-2 font-semibold text-indigo-300">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              {lang === 'uz'
                ? `Ovoz berish filtri: ${conditionAnalysis.conditions.length} ta ko'rsatma aniqlandi (${conditionAnalysis.conditions.slice(0, 4).join(', ')})`
                : `Фильтрация: обнаружено ${conditionAnalysis.conditions.length} условий (${conditionAnalysis.conditions.slice(0, 4).join(', ')})`}
            </span>
          </div>
          <p className="text-[11px] text-zinc-400 leading-normal">
            {lang === 'uz'
              ? '🛡️ Ushbu shartlar avtomatik tarzda ovoz tembri/ohangiga yo\'naltiriladi va Gemini TTS tomonidan OVOZDA O\'QILMAYDI!'
              : '🛡️ Эти условия автоматически формируют тембр и интонацию, и НЕ озвучиваются голосом вслух!'}
          </p>
        </div>
      )}

      {/* Script Textarea */}
      <div className="space-y-1">
        {scriptViewMode === 'full' ? (
          <textarea
            rows={13}
            value={scriptText}
            onChange={(e) => onChangeScriptText(e.target.value)}
            placeholder={
              lang === 'uz'
                ? `Podkastingiz matnini shu yerga yozing yoki "1 Soatlik Podkast" tugmasini bosing...
Misol:
[00:00 - 05:00] KIRISH & ANONS
Assalomu alaykum qadrli tinglovchilar! <breath> Bugungi katta sonimizda siz bilan birga qiziqarli voqealarni o'rganamiz...`
                : 'Введите текст подкаста на узбекском языке...'
            }
            className="w-full bg-zinc-950 border border-zinc-800 focus:border-cyan-500 rounded-2xl p-4 text-xs sm:text-sm text-zinc-200 leading-relaxed font-sans focus:outline-none resize-y transition-colors"
          />
        ) : (
          <div className="space-y-2">
            <textarea
              rows={13}
              value={conditionAnalysis.cleanText}
              onChange={(e) => onChangeScriptText(e.target.value)}
              className="w-full bg-zinc-950 border border-emerald-500/30 focus:border-emerald-500 rounded-2xl p-4 text-xs sm:text-sm text-emerald-100 leading-relaxed font-sans focus:outline-none resize-y transition-colors"
              placeholder="Faqat toza nutq..."
            />
            <p className="text-[11px] text-emerald-400/80 flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5" />
              {lang === 'uz'
                ? 'Toza nutq ko\'rinishi: faqat diktor aytadigan so\'zlar (skobka va ko\'rsatmalarsiz).'
                : 'Режим чистой речи: отображается только текст, который произнесет диктор.'}
            </p>
          </div>
        )}
      </div>

      {/* Action Buttons: Synthesize Voice & Save to CMS */}
      <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
        <button
          onClick={onSynthesize}
          disabled={isSynthesizing || !scriptText.trim()}
          className={`flex-1 py-4 px-6 rounded-2xl font-bold text-sm sm:text-base flex items-center justify-center gap-3 shadow-xl transition-all cursor-pointer ${
            isSynthesizing || !scriptText.trim()
              ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
              : 'bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-zinc-950 shadow-cyan-500/25 hover:scale-[1.01] active:scale-[0.99]'
          }`}
        >
          {isSynthesizing ? (
            <>
              <div className="w-5 h-5 border-3 border-zinc-950 border-t-transparent rounded-full animate-spin" />
              <span>
                {lang === 'uz'
                  ? 'Gemini 3.8 TTS Live Ovoz Bermoqda (Sintez)...'
                  : 'Gemini 3.8 TTS Live Озвучивает (Синтез)...'}
              </span>
            </>
          ) : (
            <>
              <Play className="w-5 h-5 fill-current" />
              <span>
                {lang === 'uz'
                  ? `Mening Ovoz bilan Podkastni Yaratish (Gemini 3.8 TTS) • ~${estHours > 0 ? `${estHours}h ` : ''}${estMins}m`
                  : `Озвучить моим голосом (Gemini 3.8 TTS) • ~${estHours > 0 ? `${estHours}ч ` : ''}${estMins}м`}
              </span>
            </>
          )}
        </button>

        {onSaveDraft && (
          <button
            type="button"
            onClick={onSaveDraft}
            disabled={!scriptText.trim()}
            className="w-full sm:w-auto py-4 px-6 rounded-2xl bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white font-bold text-sm flex items-center justify-center gap-2 border border-zinc-700 transition-all hover:scale-105 active:scale-95 cursor-pointer shadow-lg"
            title={lang === 'uz' ? 'Podkastni CMS kutubxonasiga saqlash' : 'Сохранить в CMS библиотеку'}
          >
            <Save className="w-5 h-5 text-cyan-400" />
            <span>{lang === 'uz' ? 'CMS\'ga Saqlash' : 'Сохранить в CMS'}</span>
          </button>
        )}
      </div>
    </div>
  );
};
