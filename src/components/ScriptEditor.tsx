import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
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
  Lock,
} from 'lucide-react';
import { PodcastCategory, PodcastTopic } from '../types/podcast';
import { PODCAST_CATEGORIES } from '../data/categories';
import {
  stripAllStageConditions,
  detectScriptConditions,
} from '../utils/audioUtils';
import {
  GenerationShowBanner,
  FormattedSimulationView,
  GENERATION_STATUS_MESSAGES,
  SIMULATION_SCRIPT_UZ_LONG,
  SIMULATION_SCRIPT_UZ_QUICK,
  SIMULATION_SCRIPT_RU_LONG,
  SIMULATION_SCRIPT_RU_QUICK,
} from './GenerationShowBanner';

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
  const { isAuthenticated, requireAuth, openAuthModal } = useAuth();
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

  // Generation Show state
  interface GenShowState {
    type: 'longform' | 'quick';
    startTime: number;
    simStartTime: number | null;
    showSimulation: boolean;
    progress: number;
    statusMessage: string;
    isCompleted: boolean;
    charsTyped: number;
  }

  const [genShowState, setGenShowState] = useState<GenShowState | null>(null);

  // Generation show timer loop: ~24 chars/sec simulated typing, smooth 0->100% progress, 2.5s status cycle
  useEffect(() => {
    if (!genShowState || genShowState.isCompleted) return;

    const timer = setInterval(() => {
      setGenShowState((prev) => {
        if (!prev || prev.isCompleted) return prev;

        const now = Date.now();
        const elapsedMs = now - prev.startTime;

        // 1.5s threshold check: if wait >= 1.5s, reveal simulation typing
        let showSim = prev.showSimulation;
        let simStart = prev.simStartTime;

        if (!showSim && elapsedMs >= 1500) {
          showSim = true;
          simStart = now;
        }

        // Typing calculation: ~24 chars/sec
        let chars = 0;
        if (showSim && simStart) {
          const simElapsedMs = now - simStart;
          chars = Math.floor(simElapsedMs * (24 / 1000));
        }

        // Smooth progress calculation across the wait (0 -> ~96%)
        const simulatedProgress = Math.min(
          96,
          Math.round(4 + (1 - Math.exp(-elapsedMs / 7000)) * 92)
        );

        // Status message cycling every ~2.5s (2500ms)
        const msgIndex =
          Math.floor(elapsedMs / 2500) % GENERATION_STATUS_MESSAGES.length;
        const statusMsg = GENERATION_STATUS_MESSAGES[msgIndex];

        return {
          ...prev,
          showSimulation: showSim,
          simStartTime: simStart,
          charsTyped: chars,
          progress: simulatedProgress,
          statusMessage: statusMsg,
        };
      });
    }, 41);

    return () => clearInterval(timer);
  }, [genShowState?.startTime, genShowState?.isCompleted]);

  // Current simulation full script text based on type & language
  const currentSimFullText = useMemo(() => {
    if (!genShowState) return '';
    if (genShowState.type === 'longform') {
      return lang === 'uz' ? SIMULATION_SCRIPT_UZ_LONG : SIMULATION_SCRIPT_RU_LONG;
    }
    return lang === 'uz' ? SIMULATION_SCRIPT_UZ_QUICK : SIMULATION_SCRIPT_RU_QUICK;
  }, [genShowState?.type, lang]);

  const visibleSimText = useMemo(() => {
    if (!genShowState || !genShowState.showSimulation) return '';
    return currentSimFullText.slice(0, genShowState.charsTyped);
  }, [genShowState?.showSimulation, genShowState?.charsTyped, currentSimFullText]);

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
    if (
      !requireAuth(
        () => {},
        lang === 'uz'
          ? "AI ssenariy yaratish faqat ro'yxatdan o'tgan foydalanuvchilar uchun ochiq. Begonalar bepul API limitlarini behuda sarflamasligi uchun avval kiring!"
          : "Генерация сценария доступна только для зарегистрированных пользователей."
      )
    )
      return;

    const startTime = Date.now();
    setIsGeneratingScript(true);
    setGenShowState({
      type: 'quick',
      startTime,
      simStartTime: null,
      showSimulation: false,
      progress: 3,
      statusMessage: GENERATION_STATUS_MESSAGES[0],
      isCompleted: false,
      charsTyped: 0,
    });

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

      const elapsedMs = Date.now() - startTime;
      if (elapsedMs < 1500) {
        // If response arrives in under 1.5s, skip simulation completely
        setGenShowState(null);
      } else {
        // Response arrived! The simulation is replaced by actual generated text instantly (no flicker)
        setGenShowState((curr) =>
          curr
            ? {
                ...curr,
                isCompleted: true,
                progress: 100,
                showSimulation: false,
              }
            : null
        );
        setTimeout(() => {
          setGenShowState((curr) => (curr?.isCompleted ? null : curr));
        }, 2200);
      }
    } catch (err: any) {
      // 4) If generation fails, show the error state as today — simulation just stops.
      setGenShowState(null);
      alert(`Xatolik: ${err.message}`);
    } finally {
      setIsGeneratingScript(false);
    }
  };

  // Generate Full 1-Hour or 30-Min Multi-Chapter Longform Podcast
  const handleGenerateLongformPodcast = async () => {
    if (
      !requireAuth(
        () => {},
        lang === 'uz'
          ? "1 Soatlik katta podkast yaratish faqat ro'yxatdan o'tgan foydalanuvchilar uchun ochiq. Avval tizimga kiring!"
          : "Генерация 1-часового подкаста доступна только для зарегистрированных пользователей."
      )
    )
      return;

    const startTime = Date.now();
    setIsGeneratingHourScript(true);
    setGenShowState({
      type: 'longform',
      startTime,
      simStartTime: null,
      showSimulation: false,
      progress: 3,
      statusMessage: GENERATION_STATUS_MESSAGES[0],
      isCompleted: false,
      charsTyped: 0,
    });

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

      const elapsedMs = Date.now() - startTime;
      if (elapsedMs < 1500) {
        // If response arrives in under 1.5s, skip simulation completely
        setGenShowState(null);
      } else {
        // Response arrived! The simulation is replaced by actual generated text instantly (no flicker)
        setGenShowState((curr) =>
          curr
            ? {
                ...curr,
                isCompleted: true,
                progress: 100,
                showSimulation: false,
              }
            : null
        );
        setTimeout(() => {
          setGenShowState((curr) => (curr?.isCompleted ? null : curr));
        }, 2200);
      }
    } catch (err: any) {
      // 4) If generation fails, show the error state as today — simulation just stops.
      setGenShowState(null);
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
    <div className="bg-white/80 border border-[rgba(22,21,17,0.14)] rounded-[24px] p-5 sm:p-7 shadow-[0_20px_40px_-20px_rgba(22,21,17,0.18)] backdrop-blur-md space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[rgba(22,21,17,0.1)]">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-serif text-xl sm:text-2xl text-[#161511] flex items-center gap-2">
              <FileText className="w-5 h-5 text-[#0E7C86]" />
              <span>{lang === 'uz' ? 'Podkast Ssenariysi & Matni' : 'Сценарий и Текст подкаста'}</span>
            </h3>
            {onSelectCategory && (
              <select
                value={category.id}
                onChange={(e) => {
                  const found = PODCAST_CATEGORIES.find((c) => c.id === e.target.value);
                  if (found) onSelectCategory(found);
                }}
                className="bg-white border border-[rgba(22,21,17,0.15)] rounded-full px-3 py-1 text-xs text-[#0A5A62] font-mono focus:outline-none focus:border-[#0E7C86] cursor-pointer shadow-xs"
              >
                {PODCAST_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.badgeUz} {lang === 'uz' ? c.nameUz : c.nameRu}
                  </option>
                ))}
              </select>
            )}
          </div>
          <p className="text-xs text-[#5D594E] mt-0.5">
            {lang === 'uz'
              ? 'Mavzu bo\'yicha to\'liq ssenariy yarating, PDF yuklang yoki o\'z matningizni tahrirlang'
              : 'Создайте сценарий по теме, загрузите документ или редактируйте текст'}
          </p>
        </div>

        {/* Word count & Estimated duration */}
        <div className="flex items-center gap-3 bg-[#ECE7DB]/60 px-3.5 py-1.5 rounded-full border border-[rgba(22,21,17,0.1)] text-xs font-mono text-[#161511] self-start sm:self-center">
          <span className="text-[#5D594E] font-semibold">{wordCount.toLocaleString()} {lang === 'uz' ? 'so\'z' : 'слов'}</span>
          <span className="text-[#7D7A70]">•</span>
          <span className="text-[#0E7C86] flex items-center gap-1 font-bold">
            <Clock className="w-3.5 h-3.5 text-[#0E7C86]" />
            {estHours > 0 ? `${estHours} soat ` : ''}{estMins}m {estSecs}s
          </span>
        </div>
      </div>

      {/* Target Duration Selector */}
      <div className="bg-white/70 border border-[rgba(22,21,17,0.12)] rounded-2xl p-3.5 space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-mono uppercase tracking-wider text-[#5D594E] flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-[#0E7C86]" />
            {lang === 'uz' ? 'Mo\'ljallangan Davomiylik (Xronometraj):' : 'Целевой хронометраж:'}
          </label>
          <span className="text-[11px] font-mono text-[#7D7A70]">
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
                    ? 'bg-[#161511] border-[#161511] text-[#F4F1EA] shadow-xs'
                    : 'bg-white border-[rgba(22,21,17,0.12)] text-[#5D594E] hover:border-[#161511] hover:text-[#161511]'
                }`}
              >
                <div className="text-xs font-semibold flex items-center justify-between">
                  <span>{item.label}</span>
                  {isSelected && <Check className="w-3.5 h-3.5 text-[#5CC8CF]" />}
                </div>
                <div className={`text-[10px] mt-0.5 ${isSelected ? 'text-[#EDEAE2]/70' : 'text-[#7D7A70]'}`}>{item.sub}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Suggested Topics from selected category */}
      {category.topics && category.topics.length > 0 && (
        <div className="space-y-1.5">
          <label className="font-mono text-[11px] uppercase tracking-wider text-[#5D594E]">
            {lang === 'uz' ? 'Toifadagi Tayyor Mavzular:' : 'Готовые темы категории:'}
          </label>
          <div className="flex flex-wrap gap-2">
            {category.topics.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => handleSelectTopic(t)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border text-left transition-all cursor-pointer ${
                  title === t.titleUz
                    ? 'bg-[#161511] border-[#161511] text-[#F4F1EA] shadow-xs'
                    : 'bg-white border-[rgba(22,21,17,0.12)] text-[#5D594E] hover:border-[#161511] hover:text-[#161511]'
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
          <label className="block font-mono text-xs uppercase tracking-wider text-[#5D594E] mb-1">
            {lang === 'uz' ? 'Podkast Sarlavhasi' : 'Название подкаста'}
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => onChangeTitle(e.target.value)}
            placeholder="Masalan: Amir Temurning Samarqanddagi merosi"
            className="w-full bg-white border border-[rgba(22,21,17,0.14)] rounded-full px-4 py-2.5 text-xs sm:text-sm text-[#161511] placeholder-[#7D7A70] focus:outline-none focus:border-[#0E7C86]"
          />
        </div>

        <div>
          <label className="block font-mono text-xs uppercase tracking-wider text-[#5D594E] mb-1">
            {lang === 'uz' ? 'Qisqa Tavsif (Description)' : 'Краткое описание'}
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => onChangeDescription(e.target.value)}
            placeholder="Tinglovchilar uchun 1-2 jumlalik tushuntirish..."
            className="w-full bg-white border border-[rgba(22,21,17,0.14)] rounded-full px-4 py-2.5 text-xs sm:text-sm text-[#161511] placeholder-[#7D7A70] focus:outline-none focus:border-[#0E7C86]"
          />
        </div>
      </div>

      {/* AI Generate Script Tool Bar */}
      <div className="p-4 bg-white/70 border border-[rgba(22,21,17,0.14)] rounded-2xl flex flex-col md:flex-row items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="p-2.5 rounded-full bg-[#0E7C86]/10 text-[#0E7C86]">
            <Sparkles className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h4 className="text-xs sm:text-sm font-semibold text-[#161511] flex items-center gap-2">
              <span>{lang === 'uz' ? 'Gemini 3.8 AI Ssenariy Dvigateli' : 'Движок Сценариев Gemini 3.8'}</span>
              <span className="px-2 py-0.5 rounded-full bg-[#0E7C86]/10 text-[#0E7C86] text-[10px] font-mono border border-[#0E7C86]/25">
                1 Soatlik Podkast
              </span>
            </h4>
            <p className="text-[11px] text-[#5D594E] mt-0.5">
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
              className="flex-1 md:flex-initial px-3.5 py-2.5 rounded-full bg-white hover:bg-[#ECE7DB] text-[#0A5A62] border border-[rgba(22,21,17,0.15)] font-medium text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-xs"
            >
              <Upload className="w-3.5 h-3.5 text-[#0E7C86]" />
              <span>{lang === 'uz' ? 'PDF / Maqola' : 'PDF / Статья'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={handlePolishAndTiming}
            disabled={isPolishing || !scriptText.trim()}
            className="flex-1 md:flex-initial px-3.5 py-2.5 rounded-full bg-white hover:bg-[#ECE7DB] disabled:opacity-50 text-[#0A5A62] border border-[rgba(22,21,17,0.15)] font-medium text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-xs"
            title={lang === 'uz' ? 'Mavjud matnni tahlil qilish, temp va vaqtini to\'g\'rilash' : 'Анализ черновика, подгонка по времени и темпу'}
          >
            <Clock className={`w-3.5 h-3.5 text-[#0E7C86] ${isPolishing ? 'animate-spin' : ''}`} />
            <span>{isPolishing ? (lang === 'uz' ? 'Moslanmoqda...' : 'Подгонка...') : (lang === 'uz' ? 'Vaqtni To\'g\'rilash' : 'Подгонка по времени')}</span>
          </button>

          {/* Full 1-Hour Multi-Chapter Generator Button */}
          <button
            type="button"
            onClick={handleGenerateLongformPodcast}
            disabled={isGeneratingHourScript || isGeneratingScript}
            className="flex-1 md:flex-initial px-4 py-2.5 rounded-full bg-[#161511] hover:bg-[#0A5A62] text-[#F4F1EA] font-medium text-xs flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer"
            title="1 soatlik yoki 30 daqiqalik to'liq bobli podkast matnini yaratish"
          >
            {isGeneratingHourScript ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>{lang === 'uz' ? 'Katta son yozilmoqda...' : 'Пишется выпуск...'}</span>
              </>
            ) : (
              <>
                <Flame className="w-4 h-4 text-[#C4552D]" />
                <span>{lang === 'uz' ? `1 Soatlik Podkast (Boblar bilan)` : 'Полный 1-Часовой Сценарий'}</span>
              </>
            )}
          </button>

          {/* Quick AI Generate Script Button */}
          <button
            type="button"
            onClick={handleAIGenerate}
            disabled={isGeneratingScript || isGeneratingHourScript}
            className="flex-1 md:flex-initial px-4 py-2.5 rounded-full bg-[#0E7C86] hover:bg-[#0A5A62] text-white font-medium text-xs flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer"
          >
            {isGeneratingScript ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
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
        <div className="p-3.5 bg-white border border-[rgba(22,21,17,0.12)] rounded-2xl space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono uppercase tracking-wider text-[#0E7C86] flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-[#0E7C86]" />
              {lang === 'uz' ? 'Podkast Boblari (Taym-kodlar):' : 'Главы подкаста (Тайм-коды):'}
            </span>
            <span className="font-mono text-[10px] text-[#7D7A70]">
              {chapters.length} {lang === 'uz' ? 'ta to\'liq bob' : 'глав'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {chapters.map((chap, idx) => (
              <div
                key={chap.id || idx}
                className="p-2.5 rounded-xl bg-[#ECE7DB]/50 border border-[rgba(22,21,17,0.08)] hover:border-[#0E7C86] transition-colors flex flex-col justify-between gap-1.5"
              >
                <div>
                  <div className="text-[10px] font-mono text-[#0A5A62] font-semibold">{chap.timestamp}</div>
                  <div className="text-xs font-semibold text-[#161511] line-clamp-1">{chap.title}</div>
                </div>
                <button
                  type="button"
                  onClick={() => handleExpandChapter(chap)}
                  disabled={isExpandingChapter}
                  className="px-2 py-1 bg-white hover:bg-[#161511] hover:text-[#F4F1EA] text-[#0A5A62] text-[10px] font-medium rounded-full border border-[rgba(22,21,17,0.1)] flex items-center justify-center gap-1 transition-colors cursor-pointer"
                >
                  <Sparkles className="w-3 h-3 text-[#0E7C86]" />
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
          <span className="font-mono text-[11px] uppercase tracking-wider text-[#5D594E] mr-1 flex items-center gap-1">
            <Wind className="w-3 h-3 text-[#0E7C86]" />
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
              className="px-2.5 py-1 rounded-full font-mono text-[11px] bg-white hover:bg-[#161511] hover:text-[#F4F1EA] text-[#0A5A62] border border-[rgba(22,21,17,0.14)] transition-colors cursor-pointer shadow-xs"
            >
              <span>{btn.icon} {btn.label}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1 bg-[#ECE7DB] p-0.5 rounded-full border border-[rgba(22,21,17,0.12)]">
            <button
              type="button"
              onClick={() => setScriptViewMode('full')}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-all flex items-center gap-1 cursor-pointer ${
                scriptViewMode === 'full'
                  ? 'bg-[#161511] text-[#F4F1EA] shadow-xs'
                  : 'text-[#5D594E] hover:text-[#161511]'
              }`}
            >
              <FileText className="w-3 h-3" />
              <span>{lang === 'uz' ? 'To\'liq Ssenariy' : 'Сценарий'}</span>
            </button>

            <button
              type="button"
              onClick={() => setScriptViewMode('pure')}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-all flex items-center gap-1 cursor-pointer ${
                scriptViewMode === 'pure'
                  ? 'bg-[#0E7C86] text-white shadow-xs'
                  : 'text-[#5D594E] hover:text-[#161511]'
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
              className="px-3 py-1 bg-white hover:bg-[#161511] hover:text-[#F4F1EA] text-[#C4552D] border border-[rgba(22,21,17,0.14)] text-xs font-mono uppercase tracking-wider rounded-full flex items-center gap-1 transition-all cursor-pointer shadow-xs"
              title="Ssenariydan barcha skobka va shartlarni tozalash"
            >
              <Eraser className="w-3.5 h-3.5 text-[#C4552D]" />
              <span>{lang === 'uz' ? 'Tozalash' : 'Очистить'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Clean Notification Banner */}
      {cleanNotice && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center gap-2 animate-in fade-in">
          <Check className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{cleanNotice}</span>
        </div>
      )}

      {/* Condition Protection Banner */}
      {conditionAnalysis.hasConditions && (
        <div className="p-3 bg-[#0E7C86]/5 border border-[#0E7C86]/20 rounded-2xl text-xs text-[#0A5A62] space-y-1">
          <div className="flex items-center gap-2 font-semibold text-[#161511]">
            <ShieldCheck className="w-4 h-4 text-[#0E7C86] shrink-0" />
            <span>
              {lang === 'uz'
                ? `Ovoz berish filtri: ${conditionAnalysis.conditions.length} ta ko'rsatma aniqlandi (${conditionAnalysis.conditions.slice(0, 4).join(', ')})`
                : `Фильтрация: обнаружено ${conditionAnalysis.conditions.length} условий (${conditionAnalysis.conditions.slice(0, 4).join(', ')})`}
            </span>
          </div>
          <p className="text-[11px] text-[#5D594E] leading-normal">
            {lang === 'uz'
              ? '🛡️ Ushbu shartlar avtomatik tarzda ovoz tembri/ohangiga yo\'naltiriladi va Gemini TTS tomonidan OVOZDA O\'QILMAYDI!'
              : '🛡️ Эти условия автоматически формируют тембр и интонацию, и НЕ озвучиваются голосом вслух!'}
          </p>
        </div>
      )}

      {/* Generation Show: Progress Bar, Status Line & 24-Bar Audio Level Strip */}
      {genShowState && (
        <GenerationShowBanner
          isGenerating={!genShowState.isCompleted}
          isCompleted={genShowState.isCompleted}
          progress={genShowState.progress}
          statusMessage={genShowState.statusMessage}
          lang={lang}
        />
      )}

      {/* Script Textarea or Simulated Typing View */}
      <div className="space-y-1">
        {genShowState?.showSimulation ? (
          <FormattedSimulationView text={visibleSimText} />
        ) : scriptViewMode === 'full' ? (
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
            className="w-full bg-white border border-[rgba(22,21,17,0.14)] focus:border-[#0E7C86] rounded-2xl p-4 text-xs sm:text-sm text-[#161511] leading-relaxed font-sans focus:outline-none resize-y transition-colors shadow-xs"
          />
        ) : (
          <div className="space-y-2">
            <textarea
              rows={13}
              value={conditionAnalysis.cleanText}
              onChange={(e) => onChangeScriptText(e.target.value)}
              className="w-full bg-white border border-[#0E7C86]/40 focus:border-[#0E7C86] rounded-2xl p-4 text-xs sm:text-sm text-[#161511] leading-relaxed font-sans focus:outline-none resize-y transition-colors shadow-xs"
              placeholder="Faqat toza nutq..."
            />
            <p className="text-[11px] font-mono text-[#0E7C86] flex items-center gap-1.5">
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
          className={`flex-1 py-4 px-6 rounded-full font-medium text-sm sm:text-base flex items-center justify-center gap-3 transition-all cursor-pointer ${
            isSynthesizing || !scriptText.trim()
              ? 'bg-[#ECE7DB] text-[#7D7A70] cursor-not-allowed'
              : !isAuthenticated
              ? 'bg-[#161511] hover:bg-[#0A5A62] text-[#F4F1EA] shadow-md'
              : 'bg-[#161511] hover:bg-[#0A5A62] text-[#F4F1EA] shadow-md'
          }`}
        >
          {isSynthesizing ? (
            <>
              <div className="w-5 h-5 border-3 border-white border-t-transparent rounded-full animate-spin" />
              <span>
                {lang === 'uz'
                  ? 'Audio sintez qilinmoqda (24kHz HD)...'
                  : 'Синтез речи (24kHz HD)...'}
              </span>
            </>
          ) : !isAuthenticated ? (
            <>
              <Lock className="w-5 h-5" />
              <span>
                {lang === 'uz'
                  ? 'Ro\'yxatdan o\'tish & Podkast yaratish'
                  : 'Войти & Создать подкаст'}
              </span>
            </>
          ) : (
            <>
              <Play className="w-5 h-5 fill-current text-[#5CC8CF]" />
              <span>
                {lang === 'uz'
                  ? `Sintez qilish va tinglash • ~${estHours > 0 ? `${estHours}h ` : ''}${estMins}m`
                  : `Синтезировать речь • ~${estHours > 0 ? `${estHours}ч ` : ''}${estMins}м`}
              </span>
            </>
          )}
        </button>

        {onSaveDraft && (
          <button
            type="button"
            onClick={onSaveDraft}
            disabled={!scriptText.trim()}
            className="w-full sm:w-auto py-4 px-6 rounded-full bg-white hover:bg-[#161511] hover:text-[#F4F1EA] disabled:opacity-50 text-[#161511] font-medium text-sm flex items-center justify-center gap-2 border border-[rgba(22,21,17,0.14)] transition-all cursor-pointer shadow-xs"
            title={lang === 'uz' ? 'Podkastni CMS kutubxonasiga saqlash' : 'Сохранить в CMS библиотеку'}
          >
            <Save className="w-5 h-5 text-[#0E7C86]" />
            <span>{lang === 'uz' ? 'CMS\'ga Saqlash' : 'Сохранить в CMS'}</span>
          </button>
        )}
      </div>
    </div>
  );
};
