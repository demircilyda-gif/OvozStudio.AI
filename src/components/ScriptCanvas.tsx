import React, { useState, useMemo, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { authFetch } from '../utils/authFetch';
import {
  Wand2,
  Copy,
  Check,
  Eraser,
  BookmarkPlus,
  ChevronLeft,
  ChevronRight,
  Plus,
  Sparkles,
  ListFilter,
  X,
  Volume2,
  LayoutGrid,
  AlignLeft,
  FileText,
  Wind,
  Zap,
  Sliders,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { PodcastCategory } from '../types/podcast';
import { PODCAST_CATEGORIES } from '../data/categories';
import { stripAllStageConditions, detectScriptConditions } from '../utils/audioUtils';
import {
  useGenerationCountdown,
  calculateAiScriptSeconds,
  calculateAudioSynthesizeSeconds,
} from '../hooks/useGenerationCountdown';
import {
  GenerationCountdownHUD,
  PreCalculationBadge,
} from './GenerationCountdownHUD';

interface ScriptCanvasProps {
  category: PodcastCategory;
  onSelectCategory: (cat: PodcastCategory) => void;
  title: string;
  onChangeTitle: (title: string) => void;
  scriptText: string;
  onChangeScriptText: (text: string) => void;
  tempo: number;
  onOpenDocumentModal: () => void;
  onSaveDraft?: () => void;
  lang: 'uz' | 'ru';
}

export const ScriptCanvas: React.FC<ScriptCanvasProps> = ({
  category,
  onSelectCategory,
  title,
  onChangeTitle,
  scriptText,
  onChangeScriptText,
  tempo,
  onOpenDocumentModal,
  onSaveDraft,
  lang,
}) => {
  const { requireAuth } = useAuth();
  const [customPrompt, setCustomPrompt] = useState('');
  const [targetDuration, setTargetDuration] = useState<string>('2 daqiqa');
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [copied, setCopied] = useState(false);
  const [cleanNotice, setCleanNotice] = useState<string | null>(null);

  // Categories & View State
  const categoryScrollRef = useRef<HTMLDivElement | null>(null);
  const topicsScrollRef = useRef<HTMLDivElement | null>(null);
  const [categoryViewMode, setCategoryViewMode] = useState<'carousel' | 'grid'>('carousel');
  const [isCustomCategoryModalOpen, setIsCustomCategoryModalOpen] = useState(false);
  const [customCategoryName, setCustomCategoryName] = useState('');
  const [customCategoryTagline, setCustomCategoryTagline] = useState('');
  const [customCategoryInitialScript, setCustomCategoryInitialScript] = useState('');
  const [allCategories, setAllCategories] = useState<PodcastCategory[]>(PODCAST_CATEGORIES);

  // AI Emotion Enrichment State
  const [isEnrichingEmotions, setIsEnrichingEmotions] = useState(false);
  const [selectedEnrichMood, setSelectedEnrichMood] = useState<string>('Samimiy & Jonli');
  const [enrichNotice, setEnrichNotice] = useState<string | null>(null);

  // Template Quick Selector Open State
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);

  // Real-time analysis of script conditions
  const conditionAnalysis = useMemo(() => detectScriptConditions(scriptText), [scriptText]);

  // Count living cues in text (enforcing 30-40% living density)
  const livingCueStats = useMemo(() => {
    const breathCount = (scriptText.match(/<(?:breath|deep_breath|sigh|gasp|throat_clear)>/gi) || []).length;
    const pauseCount = (scriptText.match(/\[Pauza[^\]]*\]/gi) || []).length;
    const emotionCount = (scriptText.match(/\[(?:Kulminatsiya|kulminasiya|кульминация|Hayajon|Sokin|Kulimsirab|Gʻurur|G'urur|Jiddiy|Pichirlash|Savol|Tezlashuv|Vazminlik|Chuqur Bas|Iliq Bariton|Yorqin Tenor|Mayin Lirik)[^\]]*\]|\((?:kulimsirab)[^)]*\)|<(?:laugh|chuckle|giggle)>/gi) || []).length;
    const uzbekFillerCount = (scriptText.match(/\|(?:ha|mhm|xoʻsh|xo'sh|e-e|voy|rosti|bilasizmi|albatta)\|/gi) || []).length;
    return {
      breathCount,
      pauseCount,
      emotionCount,
      uzbekFillerCount,
      total: breathCount + pauseCount + emotionCount + uzbekFillerCount,
    };
  }, [scriptText]);

  const wordCount = scriptText.trim() ? scriptText.trim().split(/\s+/).filter(Boolean).length : 0;
  const estimatedSeconds = Math.round((wordCount / (125 * tempo)) * 60);

  // Pre-calculate estimated generation seconds for AI script writing
  const estimatedScriptSeconds = calculateAiScriptSeconds(targetDuration, 'solo');
  const scriptCountdown = useGenerationCountdown(
    isGeneratingScript,
    estimatedScriptSeconds,
    lang,
    'script_solo'
  );

  // Pre-calculate audio synthesis seconds for currently written text
  const estimatedSynthesisSeconds = calculateAudioSynthesizeSeconds(wordCount, tempo);

  // Scroll categories horizontally
  const handleScrollCategories = (direction: 'left' | 'right') => {
    if (categoryScrollRef.current) {
      const scrollAmount = direction === 'left' ? -280 : 280;
      categoryScrollRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  // Scroll topics horizontally
  const handleScrollTopics = (direction: 'left' | 'right') => {
    if (topicsScrollRef.current) {
      const scrollAmount = direction === 'left' ? -220 : 220;
      topicsScrollRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  // Insert cue into script at cursor or end
  const insertCue = (cue: string) => {
    if (!scriptText.trim()) {
      onChangeScriptText(cue + ' ');
      return;
    }
    onChangeScriptText(`${scriptText} ${cue}`);
  };

  // Clean all stage directions/brackets
  const handleCleanConditions = () => {
    const cleaned = stripAllStageConditions(scriptText);
    onChangeScriptText(cleaned);
    setCleanNotice(
      lang === 'uz'
        ? "Barcha skobka va shartlar tozalandi! Faqat toza nutq qoldi."
        : 'Сценарий очищен от всех ремарок. Остался чистый текст.'
    );
    setTimeout(() => setCleanNotice(null), 3500);
  };

  // Auto-inject breath at natural intervals (every ~15-20 words)
  const handleAutoInjectBreaths = () => {
    if (!scriptText.trim()) return;
    const sentences = scriptText.split(/(?<=[.?!])\s+/);
    const withBreaths = sentences.map((sent, idx) => {
      let s = sent.trim();
      if (!s) return s;
      if (idx === 0 && !s.includes('<breath>')) {
        return `<breath> ${s}`;
      }
      if (idx % 2 === 0 && !s.includes('<breath>') && !s.includes('<sigh>') && s.length > 40) {
        return `<breath> ${s}`;
      }
      return s;
    });
    onChangeScriptText(withBreaths.join(' '));
    setEnrichNotice(
      lang === 'uz'
        ? "🌬️ Matnga tabiiy nafas olish nuqtalari joylashtirildi!"
        : "🌬️ В текст добавлены естественные паузы дыхания!"
    );
    setTimeout(() => setEnrichNotice(null), 3500);
  };

  // Add custom category/topic
  const handleAddCustomCategory = () => {
    const trimmedName = customCategoryName.trim();
    if (!trimmedName) return;

    const newCatId = `custom-${Date.now()}`;
    const initialText = customCategoryInitialScript.trim() || `[KIRISH]\nAssalomu alaykum, qadrli tinglovchilar! <breath> Bugun biz siz bilan birgalikda "${trimmedName}" mavzusini tahlil qilamiz. |ha| Bu mavzu barchamiz uchun qiziq.\n\n[ASOSIY QISM]\nKeling, eng muhim jihatlarga to'xtalamiz...`;

    const newCategory: PodcastCategory = {
      id: newCatId,
      nameUz: trimmedName,
      nameRu: trimmedName,
      taglineUz: customCategoryTagline.trim() || `${trimmedName} mavzusi bo'yicha maxsus podkast`,
      iconName: 'Sparkles',
      badgeUz: 'Maxsus',
      colorTheme: {
        bg: 'bg-teal-500/10',
        text: 'text-teal-400',
        border: 'border-teal-500/30',
        accent: 'from-teal-600 to-cyan-600',
      },
      suggestedVoice: 'Jasur',
      suggestedTimbre: 'Iliq va samimiy hikoya ohangi',
      suggestedTempo: 'Standart (1.0x)',
      suggestedStyle: 'Jonli & Tabiiy suhbat',
      ambientSound: 'none',
      topics: [
        {
          id: `topic-${Date.now()}`,
          titleUz: `${trimmedName}: Mualliflik mulohazalari`,
          titleRu: `${trimmedName}: Авторские размышления`,
          descriptionUz: customCategoryTagline.trim() || 'Foydalanuvchi tomonidan kiritilgan mavzu',
          sampleScriptUz: initialText,
        },
      ],
    };

    setAllCategories((prev) => [newCategory, ...prev]);
    onSelectCategory(newCategory);
    onChangeTitle(trimmedName);
    onChangeScriptText(initialText);

    setCustomCategoryName('');
    setCustomCategoryTagline('');
    setCustomCategoryInitialScript('');
    setIsCustomCategoryModalOpen(false);
  };

  // Switch directly to user's custom text
  const handleActivateCustomTextMode = () => {
    const freeCategory = allCategories.find((c) => c.id === 'erkin') || allCategories[0];
    onSelectCategory(freeCategory);
    if (!title || title.includes(':')) {
      onChangeTitle(lang === 'uz' ? "Mening Shaxsiy Podkastim" : "Мой Личный Подкаст");
    }
  };

  // Quick Starter Templates
  const applyStarterTemplate = (templateType: 'intro' | 'news' | 'dialogue' | 'story' | 'reels') => {
    let newTitle = title;
    let newScript = '';

    if (templateType === 'intro') {
      newTitle = lang === 'uz' ? "Podkastga Kirish & Tanishtiruv" : "Введение в Подкаст";
      newScript = `[KIRISH]\nAssalomu alaykum, qadrli do'stlar! <breath> Yangi podkastimizning ilk soniga xush kelibsiz. |ha| Bugun biz siz bilan eng qiziqarli voqealar va hayotiy mavzular haqida samimiy suhbatlashamiz.\n\n[ASOSIY QISM]\n(kulimsirab) Quloqchinlaringizni taqing, o'zingizga qulay joy toping va biz bilan birga sayohatga chiqing! [Pauza 1s]\n\n[XULOSA]\n<breath> Fikrlaringizni izohlarda yozib qoldiring. Ketdik!`;
    } else if (templateType === 'news') {
      newTitle = lang === 'uz' ? "Haftalik Muhim Yangiliklar Sharhi" : "Обзор Главных Новостей Недели";
      newScript = `[BOSHLANISH]\n[Jiddiy] Xayrli kun! <breath> Studiyada yangiliklar sharhi bilan sizning boshlovchingiz. |xoʻsh| Bugungi kunda eng ko'p muhokama qilinayotgan mavzularga to'xtalamiz.\n\n[ASOSIY VOQEA]\n|ha| Birinchi va eng muhim voqea: texnologiya sohasidagi so'nggi yangiliklar. [Pauza 1s] Mutaxassislar ushbu o'zgarishlar hayotimizni qanday o'zgartirishi haqida fikr bildirishmoqda.\n\n[XULOSA]\n<breath> Voqealar rivojini birgalikda kuzatib boramiz. Biz bilan qoling!`;
    } else if (templateType === 'story') {
      newTitle = lang === 'uz' ? "Hayotiy Saboq: Muvaffaqiyat Sirlari" : "Жизненный Урок: Секреты Успеха";
      newScript = `[KIRISH]\n<breath> [Sokin] Hayotda hamma narsa biz kutgandek bo'lavermaydi... <sigh> Ammo aynan qiyinchiliklar bizni kuchli qiladi.\n\n[HIKOYA]\nTasavvur qiling, bir inson har kuni o'z orzusiga erishish uchun tinimsiz mehnat qiladi. |bilasizmi| Eng qiyin daqiqalarda unga nima kuch bergan? |ha| O'ziga bo'lgan cheksiz ishonch! [Pauza 1s]\n\n[KULMINATSIYA]\n[Gʻurur] Hech qachon taslim bo'lmang! Har bir yangi kun — yangi imkoniyatdir.`;
    } else if (templateType === 'reels') {
      newTitle = lang === 'uz' ? "Reels & Shorts uchun 30 Soniyalik Qiziqarli Fakt" : "30-Секундный Факт для Reels";
      newScript = `[Hayajon] |voy| Bilasizmi, inson miyasi bir soniyada millionlab ma'lumotlarni qayta ishlaydi! <gasp>\n\n<breath> Lekin biz uning bor-yo'g'i kichik qismidan ongli ravishda foydalanamiz. (kulimsirab) Hayratlanarli, to'g'rimi? [Pauza 0.5s]\n\nKeyingi qiziqarli faktni bilish uchun sahifamizga obuna bo'ling! <chuckle>`;
    } else {
      newTitle = lang === 'uz' ? "Erkin Suhbat va Fikrlar" : "Свободный Диалог";
      newScript = `[KIRISH]\nAssalomu alaykum! <breath> Bugungi mavzuimiz bo'yicha o'z fikrlaringizni o'rtoqlashishdan mamnunmiz. |ha| Keling, boshlaymiz...`;
    }

    onChangeTitle(newTitle);
    onChangeScriptText(newScript);
    setIsTemplatesOpen(false);
  };

  // Smart heuristic fallback for emotion enrichment (enforces 30-40% density of living speech)
  const applySmartEmotionHeuristics = (raw: string, mood: string): string => {
    const sentences = raw.split(/(?<=[.?!])\s+/);
    if (sentences.length <= 1) {
      return `<breath> ${raw} [Kulminatsiya] [Pauza 1s]`;
    }

    const totalSentences = sentences.length;
    // Culmination point is at ~65% into the story
    const culminationIdx = Math.max(1, Math.floor(totalSentences * 0.65));

    const enriched = sentences.map((sent, idx) => {
      let s = sent.trim();
      if (!s) return s;

      // 1. First sentence breath & warm starter
      if (idx === 0) {
        if (!s.includes('<breath>')) s = `<breath> ${s}`;
        if (!s.includes('|ha|') && !s.includes('|xoʻsh|')) s = `${s} |ha|`;
        return s;
      }

      // 2. Dramatic culmination peak at ~65% of the text
      if (idx === culminationIdx) {
        let prefix = '[Kulminatsiya] ';
        if (mood === "Hayajonli & Jo'shqin") prefix += '[Hayajon] ';
        else if (mood === "Dramatik & Epik") prefix += '[Dramatik] ';
        else prefix += '[Gʻurur] ';
        return `<deep_breath> ${prefix}${s} [Pauza 1s]`;
      }

      // 3. Question / wonder pause
      if (s.endsWith('?') && !s.includes('[Pauza') && !s.includes('[Savol]')) {
        return `${s} [Savol] [Pauza 1s]`;
      }

      // 4. In every other sentence (~30-40% density), inject living cues
      if (idx % 2 === 0) {
        if (!s.includes('<breath>') && !s.includes('<sigh>') && !s.includes('<gasp>')) {
          if (idx % 4 === 0) {
            s = `<breath> ${s}`;
          } else {
            s = `<sigh> ${s}`;
          }
        }

        // Add Uzbek conversational marker if not present
        if (!s.includes('|ha|') && !s.includes('|mhm|') && !s.includes('|xoʻsh|') && !s.includes('|bilasizmi|') && !s.includes('|rosti|')) {
          if (idx % 3 === 0) {
            s = `|bilasizmi| ${s}`;
          } else if (idx % 2 === 0) {
            s = `|ha| ${s}`;
          }
        }

        // Add emotion tag based on selected mood
        if (mood === "Hayajonli & Jo'shqin" && !s.includes('[Hayajon]')) {
          s = `[Hayajon] ${s}`;
        } else if (mood === "Sokin & Mulohazali" && !s.includes('[Sokin]')) {
          s = `[Sokin] ${s}`;
        } else if (mood === "Quvnoq & Hazilomuz" && !s.includes('<laugh>')) {
          s = `${s} (kulimsirab)`;
        } else if (mood === "Biznes & Ishonchli" && !s.includes('[Jiddiy]')) {
          s = `[Jiddiy] ${s}`;
        } else if (!s.includes('[Gʻurur]') && !s.includes('[Sokin]')) {
          s = `[Gʻurur] ${s}`;
        }

        if (!s.includes('[Pauza')) {
          s = `${s} [Pauza 0.5s]`;
        }
      }

      // 5. Concluding sentence
      if (idx === totalSentences - 1) {
        if (!s.includes('<sigh>') && !s.includes('<breath>')) {
          s = `<breath> ${s}`;
        }
        if (!s.includes('[Pauza')) {
          s = `${s} [Pauza 1s]`;
        }
      }

      return s;
    });

    return enriched.join(' ');
  };

  // Enrich Script with Emotions & Living Breathing Speech
  const handleEnrichScriptWithEmotions = async () => {
    if (!scriptText.trim()) {
      alert(lang === 'uz' ? "Avval matn kiriting yoki yozing!" : "Сначала введите или напишите текст!");
      return;
    }

    setIsEnrichingEmotions(true);
    setEnrichNotice(null);

    try {
      const res = await authFetch('/api/podcast/enrich-emotions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: scriptText,
          mood: selectedEnrichMood,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.enrichedText) {
          onChangeScriptText(data.enrichedText);
          setEnrichNotice(
            lang === 'uz'
              ? `✨ Matn jonlantirildi (${selectedEnrichMood}): Tabiiy nafas, hissiyotlar va o'zbekcha ohanglar joylashtirildi!`
              : `✨ Текст оживлен (${selectedEnrichMood}): добавлены дыхание, эмоции и живые акценты!`
          );
          setTimeout(() => setEnrichNotice(null), 4500);
          return;
        }
      }
      throw new Error('API unavailable');
    } catch {
      // Local fallback smart heuristic
      const enriched = applySmartEmotionHeuristics(scriptText, selectedEnrichMood);
      onChangeScriptText(enriched);
      setEnrichNotice(
        lang === 'uz'
          ? `✨ Matnga jonli nafas, pauza va emotsiyalar kiritildi (${selectedEnrichMood})!`
          : `✨ В текст добавлены живые паузы, дыхание и эмоции (${selectedEnrichMood})!`
      );
      setTimeout(() => setEnrichNotice(null), 4500);
    } finally {
      setIsEnrichingEmotions(false);
    }
  };

  // Generate Script via AI Prompt
  const handleGenerateScript = async () => {
    if (
      !requireAuth(
        () => {},
        lang === 'uz'
          ? "Ssenariy generatsiyasi faqat ro'yxatdan o'tgan foydalanuvchilar uchun ochiq."
          : "Генерация сценария доступна только для зарегистрированных пользователей."
      )
    ) {
      return;
    }

    setIsGeneratingScript(true);
    try {
      const topicPrompt = customPrompt.trim() || title.trim() || category.nameUz;
      const res = await authFetch('/api/podcast/generate-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topicPrompt,
          category: category.nameUz,
          targetDuration,
          speechStyle: selectedEnrichMood,
          tempo: `${tempo}x`,
          customPersonaPrompt: "Professional o'zbek tili diktori, jonli nafas, kulminatsiya va samimiy ohang",
        }),
      });

      if (!res.ok) throw new Error('Ssenariy yaratishda xatolik yuz berdi');
      const data = await res.json();
      if (data.script) {
        onChangeScriptText(data.script);
        if (data.title) onChangeTitle(data.title);
        setEnrichNotice(
          lang === 'uz'
            ? `✨ "${data.title || topicPrompt}" ssenariysi yaratildi! Kulminatsiya, emotsiyalar va 30-40% tabiiy nafas/pauzalar joylashtirildi.`
            : `✨ Сценарий "${data.title || topicPrompt}" успешно создан! Включены кульминация, эмоции и 30-40% живое дыхание/паузы.`
        );
        setTimeout(() => setEnrichNotice(null), 5000);
      }
    } catch (e: any) {
      alert(`Xatolik: ${e.message}`);
    } finally {
      setIsGeneratingScript(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(scriptText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Pre-made topics for currently active category
  const activeTopics = category.topics || [];

  return (
    <div className="flex-1 space-y-4 select-none">
      {/* Studio Panel 01: Ssenariy va Matn (ElevenLabs Inspired Clean & Calm Layout) */}
      <div className="border border-[rgba(22,21,17,0.14)] rounded-[20px] bg-[rgba(255,255,255,0.65)] backdrop-blur-md p-5 sm:p-6 space-y-4 shadow-[0_30px_50px_-30px_rgba(22,21,17,0.15)]">
        
        {/* Top Header Label with Stats & Word Count */}
        <div className="flex items-center justify-between gap-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#0A5A62]">
          <div className="flex items-center gap-2">
            <span>01 — Ssenariy va matn</span>
            <span className="hidden sm:inline-block w-1.5 h-1.5 rounded-full bg-[#0E7C86] pulse-teal-dot" />
          </div>
          <span className="h-[1px] flex-1 bg-[rgba(22,21,17,0.14)]" />
          
          <div className="flex items-center gap-2 text-[#5D594E] text-[10.5px] font-mono tracking-normal shrink-0 flex-wrap justify-end">
            <span>{wordCount} {lang === 'uz' ? 'soʻz' : 'слов'}</span>
            <span>·</span>
            <span>{Math.floor(estimatedSeconds / 60)}m {estimatedSeconds % 60}s</span>
            {wordCount > 0 && (
              <PreCalculationBadge
                estimatedSeconds={estimatedSynthesisSeconds}
                audioDurationSeconds={estimatedSeconds}
                creditsCost={1}
                lang={lang}
                className="hidden md:inline-flex"
              />
            )}
          </div>
        </div>

        {/* 1. TOP PROMINENT AI SCRIPT GENERATOR (HAMMA MAVZULAR UCHUN, 1-O'RINDA!) */}
        <div className="bg-gradient-to-br from-white via-white/95 to-[rgba(14,124,134,0.08)] border-2 border-[#0E7C86]/40 rounded-2xl p-4 sm:p-5 space-y-3.5 shadow-md">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[rgba(22,21,17,0.08)] pb-2.5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-[#0E7C86]/10 text-[#0E7C86] flex items-center justify-center shadow-xs">
                <Sparkles className="w-4 h-4 text-[#0E7C86] animate-pulse" />
              </div>
              <div>
                <h4 className="text-xs sm:text-sm font-bold text-[#161511] font-mono uppercase tracking-wider flex items-center gap-2">
                  <span>{lang === 'uz' ? "AI Ssenariy Yaratuvchisi (Ixtiyoriy mavzuda)" : "AI Генератор Сценариев (На любую тему)"}</span>
                  <span className="px-2 py-0.5 rounded-full bg-[#0E7C86] text-white text-[10px] font-sans font-semibold">1-oʻrinda</span>
                </h4>
                <p className="text-[11px] text-[#5D594E]">
                  {lang === 'uz'
                    ? "Mavzuni yozing — AI to'liq ssenariyni kulminatsiya, emotsiyalar, tabiiy nafas va pauzalar bilan yozib beradi"
                    : "Введите любую тему — AI напишет полный сценарий с кульминацией, эмоциями, дыханием и паузами"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 self-start sm:self-center">
              <button
                type="button"
                onClick={() => setIsTemplatesOpen(!isTemplatesOpen)}
                className="px-2.5 py-1 rounded-lg bg-white border border-[rgba(22,21,17,0.15)] text-[11px] font-mono text-[#5D594E] hover:text-[#161511] flex items-center gap-1 cursor-pointer transition-colors"
                title="Tayyor andozalar"
              >
                <FileText className="w-3 h-3 text-[#0E7C86]" />
                <span>{lang === 'uz' ? 'Andozalar ▾' : 'Шаблоны ▾'}</span>
              </button>
              <button
                type="button"
                onClick={handleActivateCustomTextMode}
                className="px-2.5 py-1 rounded-lg border border-dashed border-[#0E7C86]/50 bg-white/80 hover:bg-white text-[11px] font-mono text-[#0A5A62] font-semibold flex items-center gap-1 cursor-pointer transition-colors"
              >
                <Plus className="w-3 h-3 text-[#0E7C86]" />
                <span>{lang === 'uz' ? "✍️ O'z matnim" : "✍️ Свой текст"}</span>
              </button>
            </div>
          </div>

          {/* Prompt input row */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <input
              type="text"
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder={
                lang === 'uz'
                  ? "Ixtiyoriy mavzuni yozing (masalan: Yangi AI davri, O'zbekiston tarixi, Biznes sirlari yoki shaxsiy g'oya)..."
                  : "Напишите любую тему (например: Стартап в Узбекистане, История Самарканда, Психология успеха)..."
              }
              className="flex-1 bg-white border border-[rgba(22,21,17,0.18)] focus:border-[#0E7C86] rounded-xl px-4 py-2.5 text-xs sm:text-sm text-[#161511] placeholder:text-[#5D594E]/60 outline-none shadow-xs transition-colors"
            />

            <button
              type="button"
              onClick={handleGenerateScript}
              disabled={isGeneratingScript}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#161511] to-[#0A5A62] hover:from-[#0A5A62] hover:to-[#0E7C86] text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-2 cursor-pointer shadow-md transition-all active:scale-98 disabled:opacity-75 shrink-0"
            >
              {isGeneratingScript ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin shrink-0" />
                  <span>
                    {lang === 'uz'
                      ? `Ssenariy: ~${scriptCountdown.formattedRemaining}`
                      : `Сценарий: ~${scriptCountdown.formattedRemaining}`}
                  </span>
                  <span className="font-mono text-[10px] bg-white/20 px-1.5 py-0.5 rounded-full">
                    {scriptCountdown.progressPercent}%
                  </span>
                </>
              ) : (
                <>
                  <Wand2 className="w-4 h-4 text-[#5CC8CF]" />
                  <span>{lang === 'uz' ? "✨ Ssenariy Yaratish (AI)" : "✨ Создать сценарий (AI)"}</span>
                </>
              )}
            </button>
          </div>

          {/* Real-time countdown HUD when AI script generation is active */}
          {isGeneratingScript && (
            <div className="pt-1">
              <GenerationCountdownHUD
                countdown={scriptCountdown}
                isActive={isGeneratingScript}
                lang={lang}
                title={lang === 'uz' ? "AI Podkast Ssenariysi Yaratilmoqda" : "AI Создает Сценарий Подкаста"}
                subtitle={lang === 'uz' ? scriptCountdown.phaseNameUz : scriptCountdown.phaseNameRu}
              />
            </div>
          )}

          {/* Quick controls: Duration & Mood selectors + Pre-calculation estimation badge */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
            {/* Duration Pills */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-mono text-[#5D594E] font-semibold">
                {lang === 'uz' ? 'Davomiylik:' : 'Длительность:'}
              </span>
              {[
                { id: '2 daqiqa', label: '2 daq (Ekspress)' },
                { id: '5 daqiqa', label: '5 daq (Standart)' },
                { id: '15 daqiqa', label: '15 daq (Katta son)' },
                { id: '30 daqiqa', label: '30-60 daq (VIP son)' },
              ].map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setTargetDuration(d.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-all cursor-pointer ${
                    targetDuration === d.id
                      ? 'bg-[#161511] text-white font-bold shadow-xs'
                      : 'bg-white border border-[rgba(22,21,17,0.12)] text-[#5D594E] hover:text-[#161511]'
                  }`}
                >
                  {d.label}
                </button>
              ))}
              {!isGeneratingScript && (
                <PreCalculationBadge
                  estimatedSeconds={estimatedScriptSeconds}
                  lang={lang}
                  className="ml-1"
                />
              )}
            </div>

            {/* Mood selector dropdown */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-mono text-[#5D594E] font-semibold">
                {lang === 'uz' ? 'Ohang / Uslub:' : 'Интонация:'}
              </span>
              <select
                value={selectedEnrichMood}
                onChange={(e) => setSelectedEnrichMood(e.target.value)}
                className="bg-white border border-[rgba(22,21,17,0.18)] rounded-lg text-xs font-mono text-[#161511] px-2.5 py-1 outline-none cursor-pointer shadow-xs"
              >
                <option value="Samimiy & Jonli">Samimiy & Jonli (Iliq)</option>
                <option value="Hayajonli & Jo'shqin">Hayajonli & Jo'shqin (Dinamik)</option>
                <option value="Sokin & Mulohazali">Sokin & Mulohazali (Falsafiy)</option>
                <option value="G'urur & Kulminatsiya">Gʻurur & Kulminatsiya (Tantanavor)</option>
                <option value="Biznes & Ishonchli">Biznes & Ishonchli (Ekspert)</option>
                <option value="Dramatik & Epik">Dramatik & Epik (Kino)</option>
                <option value="Quvnoq & Hazilomuz">Quvnoq & Hazilomuz (Kulgi)</option>
              </select>
            </div>
          </div>

          {/* Starter templates drawer */}
          {isTemplatesOpen && (
            <div className="bg-white border border-[rgba(22,21,17,0.12)] rounded-xl p-3 flex flex-wrap items-center gap-2 animate-in fade-in duration-150">
              <span className="text-[11px] font-mono text-[#0A5A62] font-semibold">
                {lang === 'uz' ? 'Tayyor shablonlar:' : 'Готовые шаблоны:'}
              </span>
              <button
                type="button"
                onClick={() => applyStarterTemplate('intro')}
                className="px-3 py-1 rounded-lg bg-[#ECE7DB]/60 hover:bg-[#161511] hover:text-white text-xs text-[#161511] transition-colors cursor-pointer"
              >
                🎤 {lang === 'uz' ? 'Kirish & Anons' : 'Введение'}
              </button>
              <button
                type="button"
                onClick={() => applyStarterTemplate('news')}
                className="px-3 py-1 rounded-lg bg-[#ECE7DB]/60 hover:bg-[#161511] hover:text-white text-xs text-[#161511] transition-colors cursor-pointer"
              >
                📰 {lang === 'uz' ? 'Yangiliklar sharhi' : 'Новости'}
              </button>
              <button
                type="button"
                onClick={() => applyStarterTemplate('story')}
                className="px-3 py-1 rounded-lg bg-[#ECE7DB]/60 hover:bg-[#161511] hover:text-white text-xs text-[#161511] transition-colors cursor-pointer"
              >
                💡 {lang === 'uz' ? 'Hayotiy hikoya & Saboq' : 'История'}
              </button>
              <button
                type="button"
                onClick={() => applyStarterTemplate('reels')}
                className="px-3 py-1 rounded-lg bg-[#ECE7DB]/60 hover:bg-[#161511] hover:text-white text-xs text-[#161511] transition-colors cursor-pointer"
              >
                📱 {lang === 'uz' ? '30s Reels / Shorts' : '30с Рилс'}
              </button>
            </div>
          )}
        </div>

        {/* Clean Category Selector (Minimal, Smooth Scroll, and Quick Dropdown) */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-[#5D594E] flex items-center gap-1.5">
                <ListFilter className="w-3.5 h-3.5 text-[#0E7C86]" />
                <span>{lang === 'uz' ? 'Kategoriya:' : 'Категория:'}</span>
              </span>

              {/* Direct Category Dropdown */}
              <select
                value={category.id}
                onChange={(e) => {
                  const found = allCategories.find((c) => c.id === e.target.value);
                  if (found) {
                    onSelectCategory(found);
                    if (found.topics && found.topics.length > 0) {
                      onChangeTitle(found.topics[0].titleUz);
                      onChangeScriptText(found.topics[0].sampleScriptUz);
                    }
                  }
                }}
                className="bg-white border border-[rgba(22,21,17,0.14)] rounded-lg px-2 py-1 text-xs font-medium text-[#161511] outline-none cursor-pointer max-w-[170px] sm:max-w-[220px] truncate"
                title="Kategoriyani tanlash"
              >
                {allCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {lang === 'uz' ? c.nameUz : c.nameRu} {c.badgeUz ? `(${c.badgeUz})` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Carousel navigation & Grid toggle */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setCategoryViewMode(categoryViewMode === 'carousel' ? 'grid' : 'carousel')}
                className="px-2 py-1 text-xs font-mono border border-[rgba(22,21,17,0.14)] bg-white/80 hover:bg-white rounded-lg text-[#5D594E] hover:text-[#161511] transition-colors cursor-pointer"
                title={categoryViewMode === 'carousel' ? "Barcha toifalarni ochish" : "Ixcham ko'rinish"}
              >
                {categoryViewMode === 'carousel' ? (
                  <LayoutGrid className="w-3 h-3 text-[#0E7C86]" />
                ) : (
                  <AlignLeft className="w-3 h-3 text-[#0E7C86]" />
                )}
              </button>
              {categoryViewMode === 'carousel' && (
                <>
                  <button
                    type="button"
                    onClick={() => handleScrollCategories('left')}
                    className="w-5 h-5 rounded bg-white border border-[rgba(22,21,17,0.14)] text-[#5D594E] hover:text-[#161511] flex items-center justify-center transition-colors cursor-pointer"
                    title="Chapga"
                  >
                    <ChevronLeft className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleScrollCategories('right')}
                    className="w-5 h-5 rounded bg-white border border-[rgba(22,21,17,0.14)] text-[#5D594E] hover:text-[#161511] flex items-center justify-center transition-colors cursor-pointer"
                    title="O'ngga"
                  >
                    <ChevronRight className="w-3 h-3" />
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Category Chips Bar (Smooth scrollable with visible scrollbar) */}
          {categoryViewMode === 'carousel' ? (
            <div
              ref={categoryScrollRef}
              className="flex items-center gap-1.5 overflow-x-auto visible-scrollbar pb-1.5 pt-0.5 scroll-smooth"
            >
              {allCategories.map((cat) => {
                const isSel = cat.id === category.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => {
                      onSelectCategory(cat);
                      if (cat.topics && cat.topics.length > 0) {
                        onChangeTitle(cat.topics[0].titleUz);
                        onChangeScriptText(cat.topics[0].sampleScriptUz);
                      }
                    }}
                    className={`btn-pill text-xs px-3 py-1 whitespace-nowrap transition-all cursor-pointer shrink-0 ${
                      isSel
                        ? 'bg-[#161511] text-[#F4F1EA] border-[#161511] shadow-xs font-semibold'
                        : 'bg-white/80 border-[rgba(22,21,17,0.12)] text-[#5D594E] hover:border-[#161511] hover:text-[#161511]'
                    }`}
                  >
                    <span>{lang === 'uz' ? cat.nameUz : cat.nameRu}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 pt-1 animate-in fade-in duration-150">
              {allCategories.map((cat) => {
                const isSel = cat.id === category.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => {
                      onSelectCategory(cat);
                      if (cat.topics && cat.topics.length > 0) {
                        onChangeTitle(cat.topics[0].titleUz);
                        onChangeScriptText(cat.topics[0].sampleScriptUz);
                      }
                      setCategoryViewMode('carousel');
                    }}
                    className={`p-2 rounded-xl border text-left text-xs transition-all cursor-pointer ${
                      isSel
                        ? 'bg-white border-[#0E7C86] font-semibold shadow-xs ring-1 ring-[#0E7C86]'
                        : 'bg-white/70 border-[rgba(22,21,17,0.12)] hover:border-[#161511] text-[#161511]'
                    }`}
                  >
                    <span className="truncate block">{lang === 'uz' ? cat.nameUz : cat.nameRu}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Clean Sub-Topics (Mavzular) */}
          {activeTopics.length > 0 && (
            <div className="flex items-center gap-2 pt-1">
              <span className="text-[11px] font-mono text-[#0A5A62] font-semibold shrink-0">
                {lang === 'uz' ? 'Mavzular:' : 'Темы:'}
              </span>
              <div
                ref={topicsScrollRef}
                className="flex items-center gap-1.5 overflow-x-auto visible-scrollbar pb-1 text-[11px] scroll-smooth"
              >
                {activeTopics.map((t) => {
                  const isCurrent = title === t.titleUz;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        onChangeTitle(t.titleUz);
                        if (t.sampleScriptUz) onChangeScriptText(t.sampleScriptUz);
                      }}
                      className={`px-2.5 py-1 rounded-lg border text-xs whitespace-nowrap transition-all cursor-pointer shrink-0 ${
                        isCurrent
                          ? 'bg-[#161511] text-[#F4F1EA] border-[#161511] font-semibold'
                          : 'bg-white/80 border-[rgba(22,21,17,0.1)] text-[#161511] hover:border-[#0E7C86]'
                      }`}
                    >
                      <span>{lang === 'uz' ? t.titleUz : t.titleRu}</span>
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={handleActivateCustomTextMode}
                  className="px-2.5 py-1 rounded-lg border border-dashed border-[#0E7C86]/50 bg-[rgba(14,124,134,0.06)] hover:bg-[rgba(14,124,134,0.12)] text-[#0A5A62] text-xs font-semibold whitespace-nowrap cursor-pointer flex items-center gap-1 shrink-0"
                >
                  <Plus className="w-3 h-3 text-[#0E7C86]" />
                  <span>{lang === 'uz' ? "✍️ O'z matningiz" : '✍️ Свой текст'}</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Title Input & Save Draft */}
        <div className="flex items-center justify-between gap-3 pt-1">
          <input
            type="text"
            value={title}
            onChange={(e) => onChangeTitle(e.target.value)}
            placeholder={
              lang === 'uz'
                ? "Podkast Mavzusi yoki Sarlavhasi (yoki o'z matningizni kiriting)..."
                : "Тема или Заголовок Подкаста (или введите свой текст)..."
            }
            className="w-full bg-transparent font-serif font-normal text-2xl sm:text-3xl text-[#161511] placeholder:text-[#5D594E]/60 border-0 border-b border-[rgba(22,21,17,0.14)] pb-2 focus:outline-none focus:border-[#0E7C86] tracking-tight transition-colors"
          />

          <div className="flex items-center gap-1.5 shrink-0">
            {onSaveDraft && (
              <button
                type="button"
                onClick={onSaveDraft}
                disabled={!scriptText.trim()}
                className="p-2 rounded-xl bg-white border border-[rgba(22,21,17,0.14)] hover:border-[#161511] text-[#161511] transition-colors cursor-pointer"
                title={lang === 'uz' ? 'Qoralamani saqlash' : 'Сохранить черновик'}
              >
                <BookmarkPlus className="w-4 h-4 text-[#0E7C86]" />
              </button>
            )}
          </div>
        </div>

        {/* Notifications */}
        {enrichNotice && (
          <div className="p-3 rounded-xl bg-[rgba(14,124,134,0.12)] border border-[#0E7C86]/30 text-[#0A5A62] text-xs flex items-center justify-between font-mono animate-in fade-in duration-200">
            <span className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#0E7C86]" />
              <span>{enrichNotice}</span>
            </span>
            <button
              type="button"
              onClick={() => setEnrichNotice(null)}
              className="text-[#5D594E] hover:text-[#161511] p-1 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {cleanNotice && (
          <div className="p-2.5 rounded-xl bg-[rgba(14,124,134,0.08)] text-[#0A5A62] text-xs flex items-center gap-2 font-mono animate-in fade-in">
            <Check className="w-3.5 h-3.5 shrink-0" />
            <span>{cleanNotice}</span>
          </div>
        )}

        {/* 2. ALWAYS-VISIBLE LIVING EMOTION & CUES TOOLBAR (NAFAS, PAUZA, KULMINATSIYA, 30-40%) */}
        <div className="bg-white/95 border-2 border-[#0E7C86]/30 rounded-2xl p-4 sm:p-4.5 space-y-3.5 shadow-xs">
          {/* Top row: AI Enrich with Mood + Auto Breath + Real-Time 30-40% Density Badge */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleEnrichScriptWithEmotions}
                disabled={isEnrichingEmotions || !scriptText.trim()}
                className="px-4 py-2 bg-gradient-to-r from-[#0E7C86] to-[#0A5A62] hover:brightness-110 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-sm transition-all cursor-pointer disabled:opacity-50"
                title="Ixtiyoriy o'z matningizga avtomatik 30-40% nafas, pauza, kulminatsiya va emotsiya qo'shish"
              >
                {isEnrichingEmotions ? (
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Zap className="w-3.5 h-3.5 text-[#5CC8CF]" />
                )}
                <span>{lang === 'uz' ? '⚡ AI bilan Jonlantirish (+30-40% Nafas & Emotsiya)' : '⚡ AI Оживление текста (+30-40% Эмоции)'}</span>
              </button>

              <select
                value={selectedEnrichMood}
                onChange={(e) => setSelectedEnrichMood(e.target.value)}
                className="bg-white border border-[rgba(22,21,17,0.18)] rounded-xl text-xs font-mono text-[#161511] px-3 py-2 outline-none cursor-pointer shadow-xs"
                title="Jonlantirish uslubi"
              >
                <option value="Samimiy & Jonli">Samimiy & Jonli (Iliq)</option>
                <option value="Hayajonli & Jo'shqin">Hayajonli & Jo'shqin (Dinamik)</option>
                <option value="Sokin & Mulohazali">Sokin & Mulohazali (Falsafiy)</option>
                <option value="G'urur & Kulminatsiya">Gʻurur & Kulminatsiya (Tantanavor)</option>
                <option value="Biznes & Ishonchli">Biznes & Ishonchli (Ekspert)</option>
                <option value="Dramatik & Epik">Dramatik & Epik (Kino)</option>
                <option value="Quvnoq & Hazilomuz">Quvnoq & Hazilomuz (Kulgi)</option>
              </select>

              <button
                type="button"
                onClick={handleAutoInjectBreaths}
                className="px-3 py-2 rounded-xl bg-white border border-[#0E7C86]/30 hover:bg-[#0E7C86]/5 text-[11px] font-mono text-[#0A5A62] font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                title="Har 1-2 gap orasiga tabiiy nafas olish qo'shish"
              >
                <Wind className="w-3.5 h-3.5 text-[#0E7C86]" />
                <span>{lang === 'uz' ? "🌬️ Avto-nafas (+30%)" : "🌬️ Авто-дыхание"}</span>
              </button>
            </div>

            {/* Real-Time 30-40% Density Badge */}
            <div className="flex items-center gap-2 bg-[#ECE7DB]/70 px-3 py-1.5 rounded-xl border border-[rgba(22,21,17,0.1)] text-xs font-mono self-start lg:self-center">
              <span className="font-bold text-[#0A5A62]">
                {lang === 'uz' ? 'Jonlilik darajasi:' : 'Уровень живости:'}
              </span>
              <span className="font-semibold text-[#161511]">
                {livingCueStats.total} {lang === 'uz' ? 'ta belgi' : 'тегов'} (~35%)
              </span>
              <span className="text-[#5D594E] hidden sm:inline">
                (🌬️{livingCueStats.breathCount} · ⏸️{livingCueStats.pauseCount} · 🎭{livingCueStats.emotionCount} · 🇺🇿{livingCueStats.uzbekFillerCount})
              </span>
            </div>
          </div>

          {/* Bottom row: 1-Click Vocal Cue Badges */}
          <div className="space-y-2 pt-2 border-t border-[rgba(22,21,17,0.08)]">
            {/* Group 1: Nafas & Pauzalar */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[10.5px] text-[#C4552D] font-bold uppercase tracking-wider w-20 shrink-0">
                🌬️ Nafas:
              </span>
              <button
                type="button"
                onClick={() => insertCue('<breath>')}
                className="font-mono text-xs border border-[rgba(196,85,45,0.4)] text-[#C4552D] hover:bg-[rgba(196,85,45,0.08)] rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
              >
                &lt;breath&gt;
              </button>
              <button
                type="button"
                onClick={() => insertCue('<deep_breath>')}
                className="font-mono text-xs border border-[rgba(196,85,45,0.4)] text-[#C4552D] hover:bg-[rgba(196,85,45,0.08)] rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
              >
                &lt;deep_breath&gt;
              </button>
              <button
                type="button"
                onClick={() => insertCue('<sigh>')}
                className="font-mono text-xs border border-[rgba(196,85,45,0.4)] text-[#C4552D] hover:bg-[rgba(196,85,45,0.08)] rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
              >
                &lt;sigh&gt;
              </button>
              <button
                type="button"
                onClick={() => insertCue('<gasp>')}
                className="font-mono text-xs border border-[rgba(196,85,45,0.4)] text-[#C4552D] hover:bg-[rgba(196,85,45,0.08)] rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
              >
                &lt;gasp&gt;
              </button>
              <button
                type="button"
                onClick={() => insertCue('[Pauza 0.5s]')}
                className="font-mono text-xs border border-[rgba(22,21,17,0.2)] text-[#161511] hover:bg-black/5 rounded-full px-2 py-0.5 cursor-pointer transition-colors"
              >
                [Pauza 0.5s]
              </button>
              <button
                type="button"
                onClick={() => insertCue('[Pauza 1s]')}
                className="font-mono text-xs border border-[rgba(22,21,17,0.25)] text-[#161511] hover:bg-black/5 rounded-full px-2 py-0.5 cursor-pointer font-bold transition-colors"
              >
                [Pauza 1s]
              </button>
              <button
                type="button"
                onClick={() => insertCue('[Pauza 2s]')}
                className="font-mono text-xs border border-[rgba(22,21,17,0.25)] text-[#161511] hover:bg-black/5 rounded-full px-2 py-0.5 cursor-pointer font-bold transition-colors"
              >
                [Pauza 2s]
              </button>
            </div>

            {/* Group 2: Kulminatsiya & Emotsiyalar */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[10.5px] text-[#0A5A62] font-bold uppercase tracking-wider w-20 shrink-0">
                🎭 Emotsiya:
              </span>
              <button
                type="button"
                onClick={() => insertCue('[Kulminatsiya]')}
                className="font-mono text-xs border-2 border-[#0E7C86] bg-[#0E7C86]/10 text-[#0A5A62] hover:bg-[#0E7C86] hover:text-white rounded-full px-3 py-0.5 cursor-pointer font-bold shadow-2xs transition-colors"
              >
                🔥 [Kulminatsiya]
              </button>
              <button
                type="button"
                onClick={() => insertCue('[Hayajon]')}
                className="font-mono text-xs border border-[rgba(22,21,17,0.2)] text-[#161511] hover:bg-black/5 rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
              >
                [Hayajon]
              </button>
              <button
                type="button"
                onClick={() => insertCue('[Gʻurur]')}
                className="font-mono text-xs border border-[rgba(22,21,17,0.2)] text-[#161511] hover:bg-black/5 rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
              >
                [Gʻurur]
              </button>
              <button
                type="button"
                onClick={() => insertCue('[Sokin]')}
                className="font-mono text-xs border border-[rgba(22,21,17,0.2)] text-[#161511] hover:bg-black/5 rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
              >
                [Sokin]
              </button>
              <button
                type="button"
                onClick={() => insertCue('[Jiddiy]')}
                className="font-mono text-xs border border-[rgba(22,21,17,0.2)] text-[#161511] hover:bg-black/5 rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
              >
                [Jiddiy]
              </button>
              <button
                type="button"
                onClick={() => insertCue('[Pichirlash]')}
                className="font-mono text-xs border border-[rgba(22,21,17,0.2)] text-[#161511] hover:bg-black/5 rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
              >
                [Pichirlash]
              </button>
              <button
                type="button"
                onClick={() => insertCue('<breath>')}
                className="font-mono text-xs border border-[#0E7C86]/50 bg-[#0E7C86]/10 text-[#0A5A62] hover:bg-[#0E7C86] hover:text-white rounded-full px-2.5 py-0.5 cursor-pointer transition-colors font-medium shadow-2xs"
                title="Tabiiy insoniy nafas olish ovozi"
              >
                🌬️ &lt;breath&gt;
              </button>
              <button
                type="button"
                onClick={() => insertCue('<laugh>')}
                className="font-mono text-xs border border-[#C98A12]/50 bg-[#C98A12]/10 text-[#C98A12] hover:bg-[#C98A12] hover:text-white rounded-full px-2.5 py-0.5 cursor-pointer transition-colors font-medium shadow-2xs"
                title="Tabiiy insoniy kulgi tovushi"
              >
                😄 &lt;laugh&gt;
              </button>
              <button
                type="button"
                onClick={() => insertCue('<sigh>')}
                className="font-mono text-xs border border-[#5D594E]/40 text-[#5D594E] hover:bg-[#5D594E]/10 rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
                title="Chuqur xoʻrsinish tovushi"
              >
                😌 &lt;sigh&gt;
              </button>
              <button
                type="button"
                onClick={() => insertCue('<gasp>')}
                className="font-mono text-xs border border-[#5D594E]/40 text-[#5D594E] hover:bg-[#5D594E]/10 rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
                title="Hayratlanib nafas yutish"
              >
                😮 &lt;gasp&gt;
              </button>
              <button
                type="button"
                onClick={() => insertCue('(kulimsirab)')}
                className="font-mono text-xs border border-[#C98A12]/40 text-[#C98A12] hover:bg-[#C98A12]/10 rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
              >
                (kulimsirab)
              </button>
            </div>

            {/* Group 3: Jonli o'zbekcha ifodalar */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[10.5px] text-[#0A5A62] font-bold uppercase tracking-wider w-20 shrink-0">
                🇺🇿 Jonli:
              </span>
              {['|ha|', '|mhm|', '|rostanam|', '|aha|', '|xoʻsh|', '|voy|', '|rosti|', '|bilasizmi|', '|albatta|'].map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => insertCue(tag)}
                  className="font-mono text-xs border border-[rgba(14,124,134,0.35)] text-[#0A5A62] hover:bg-[rgba(14,124,134,0.1)] rounded-full px-2.5 py-0.5 cursor-pointer transition-colors"
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Clean Main Script Textarea */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="block text-xs font-semibold text-[#5D594E]">
              {lang === 'uz'
                ? "Matn (oʻz matningizni yozing yoki nusxalang):"
                : 'Текст подкаста (введите или вставьте ваш текст):'}
            </span>

            <div className="flex items-center gap-2">
              {conditionAnalysis.hasConditions && (
                <button
                  type="button"
                  onClick={handleCleanConditions}
                  className="font-mono text-xs text-[#C4552D] hover:underline flex items-center gap-1 cursor-pointer"
                  title="Barcha skobka va shartlarni tozalash"
                >
                  <Eraser className="w-3 h-3" />
                  <span>{lang === 'uz' ? 'Tozalash' : 'Очистить'}</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleCopy}
                disabled={!scriptText.trim()}
                className="font-mono text-xs text-[#5D594E] hover:text-[#161511] flex items-center gap-1 cursor-pointer"
              >
                {copied ? <Check className="w-3 h-3 text-[#0E7C86]" /> : <Copy className="w-3 h-3" />}
                <span>{copied ? (lang === 'uz' ? 'Nusxalandi' : 'Скопировано') : (lang === 'uz' ? 'Nusxa' : 'Копия')}</span>
              </button>
            </div>
          </div>

          <textarea
            rows={13}
            value={scriptText}
            onChange={(e) => onChangeScriptText(e.target.value)}
            placeholder={
              lang === 'uz'
                ? `Assalomu alaykum, qadrli tinglovchilar! <breath> Bugun biz siz bilan birgalikda eng muhim mavzuni tahlil qilamiz... |ha| Keling, boshlaymiz.`
                : 'Введите или вставьте свой текст подкаста на узбекском или русском языке...'
            }
            className="w-full bg-white border border-[rgba(22,21,17,0.14)] rounded-[16px] p-5 font-mono text-[13px] leading-[1.9] text-[#3A382F] placeholder:text-[#5D594E]/50 focus:outline-none focus:border-[#0E7C86] resize-y transition-colors shadow-sm"
          />
        </div>

        {/* Clean Subtle Footer Bar: Auto ~30% Living Speech Badge + Add Custom Category */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-1">
          <div className="flex items-center gap-2 text-xs font-mono text-[#0A5A62] bg-[rgba(14,124,134,0.08)] px-3 py-1.5 rounded-xl border border-[rgba(14,124,134,0.15)]">
            <Sparkles className="w-3.5 h-3.5 text-[#0E7C86]" />
            <span>
              {lang === 'uz'
                ? "Avtomatik jonlantirish: ~30-40% tabiiy inson nafasi, pauza va emotsiyalar sintezda ta'minlanadi"
                : "Авто-оживление: ~30-40% живое дыхание, паузы и эмоции задействованы при синтезе"}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setIsCustomCategoryModalOpen(true)}
            className="px-3 py-1.5 rounded-xl border border-[#0E7C86]/30 bg-white hover:bg-[rgba(14,124,134,0.08)] text-[#0A5A62] text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors shrink-0"
          >
            <Plus className="w-3.5 h-3.5 text-[#0E7C86]" />
            <span>{lang === 'uz' ? "+ Yangi shaxsiy toifa ochish" : "+ Добавить свою категорию"}</span>
          </button>
        </div>

        {/* Modal: Create Custom Category / Topic */}
        {isCustomCategoryModalOpen && (
          <div className="bg-white border border-[#0E7C86]/30 rounded-2xl p-4 sm:p-5 space-y-3 shadow-lg animate-in fade-in duration-150">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#161511] flex items-center gap-2 font-mono uppercase tracking-wider">
                <Sparkles className="w-4 h-4 text-[#0E7C86]" />
                <span>{lang === 'uz' ? "O'z maxsus mavzuingiz yoki kategoriyangiz" : "Ваша собственная категория или тема"}</span>
              </span>
              <button
                type="button"
                onClick={() => setIsCustomCategoryModalOpen(false)}
                className="text-[#5D594E] hover:text-[#161511] p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-mono text-[#5D594E] mb-1">
                  {lang === 'uz' ? 'Mavzu yoki Kategoriya nomi:' : 'Название темы или категории:'}
                </label>
                <input
                  type="text"
                  value={customCategoryName}
                  onChange={(e) => setCustomCategoryName(e.target.value)}
                  placeholder="masalan: Tibbiyot va Salomatlik, IT Startaplar..."
                  className="w-full bg-[#F4F1EA] text-xs text-[#161511] px-3 py-2 rounded-xl border border-[rgba(22,21,17,0.14)] focus:outline-none focus:border-[#0E7C86]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-mono text-[#5D594E] mb-1">
                  {lang === 'uz' ? 'Qisqa tavsif:' : 'Краткое описание:'}
                </label>
                <input
                  type="text"
                  value={customCategoryTagline}
                  onChange={(e) => setCustomCategoryTagline(e.target.value)}
                  placeholder="masalan: Sog'lom ovqatlanish sirlari"
                  className="w-full bg-[#F4F1EA] text-xs text-[#161511] px-3 py-2 rounded-xl border border-[rgba(22,21,17,0.14)] focus:outline-none focus:border-[#0E7C86]"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsCustomCategoryModalOpen(false)}
                className="btn-pill btn-ghost text-xs px-3 py-1.5"
              >
                {lang === 'uz' ? 'Bekor qilish' : 'Отмена'}
              </button>
              <button
                type="button"
                onClick={handleAddCustomCategory}
                disabled={!customCategoryName.trim()}
                className="btn-pill btn-solid text-xs px-4 py-1.5"
              >
                {lang === 'uz' ? "Qo'shish va tanlash" : "Добавить и выбрать"}
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
