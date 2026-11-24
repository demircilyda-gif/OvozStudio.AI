import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Play,
  Pause,
  Square,
  Download,
  BookmarkPlus,
  Sparkles,
  Check,
  AlertTriangle,
  Wand2,
  Edit3,
  RotateCcw,
  Volume2,
  Languages,
  Clock,
  FileText,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { authFetch } from '../utils/authFetch';
import { getVoicePreviewUrl } from '../data/voicePreviews';
import { canonicalizeTimedPauseTags } from '../utils/uzbekNormalizer';
import { GenerationCountdownHUD, PreCalculationBadge } from './GenerationCountdownHUD';
import { LiveWritingWaveform } from './LiveWritingWaveform';
import {
  useGenerationCountdown,
  calculateAudioSynthesizeSeconds,
  formatDurationHuman,
} from '../hooks/useGenerationCountdown';
import type { VoiceProfile } from '../types/podcast';
import type {
  CharacterVoice,
  TtsMode,
  TtsLanguage,
  TtsPreset,
  TtsProcessingStage,
  TtsAgentProposal,
  TtsAgentDecision,
  TtsDirectorSegment,
  TtsSynthesisResult,
  TtsQuotaStatus,
} from '../types/tts';

interface TtsStudioProps {
  voices: VoiceProfile[];
  selectedVoiceId: string;
  onSelectVoiceId: (id: string) => void;
  onSaveToCMS: (item: {
    id: string;
    title: string;
    script: string;
    voiceName: string;
    durationSeconds: number;
    rawAudioWavBase64: string;
    preset: string;
    speed: string;
  }) => void;
  lang: 'uz' | 'ru';
}

type DetectedClientLang = 'uz_latn' | 'uz_cyrl' | 'ru' | 'en' | 'mixed';

const MAX_STUDIO_CHARS = 30000;
const MAX_AGENT_WORDS = 3000;

function estimateTtsCallsForText(rawText: string): number {
  const clean = canonicalizeTimedPauseTags(rawText || '')
    .replace(/\[pauza\s+\d+(?:\.\d+)?s\]/gi, '<short pause>')
    .trim();
  if (!clean) return 0;
  return Math.max(1, Math.ceil(clean.length / 3000));
}

function detectClientTextLanguage(text: string): DetectedClientLang {
  const clean = (text || '').trim();
  if (!clean) return 'uz_latn';

  const hasUzCyrlChars = /[ўқғҳЎҚҒҲ]/.test(clean);
  const cyrCount = (clean.match(/[а-яёўқғҳА-ЯЁЎҚҒҲ]/g) || []).length;
  const latCount = (clean.match(/[a-zA-Z]/g) || []).length;
  if (cyrCount + latCount === 0) return 'uz_latn';

  const uzCyrlWords =
    /\b(учун|билан|бўлади|чегирма|дўкон|хуш|келибсиз|сўм|фоиз|манзил|хизмат|бугун|фақат|бизнинг|сизга|янги|нарх|сотиб|олинг|мурожаат|қилинг|бепул|етказиб|бериш|акция|табриклаймиз|байрам)\b/i;
  const ruWords =
    /[ыщЫЩ]|\b(для|или|если|только|сегодня|скидка|магазин|доставка|поздравляем|инструкция|пожалуйста|здравствуйте|компания|наш|ваш|который|будет|можно|через|после|очень|просто)\b/i;
  const uzLatnWords =
    /\b(uchun|bilan|bo'ladi|chegirma|do'kon|xush|kelibsiz|so'm|foiz|manzil|xizmat|bugun|faqat|bizning|sizga|yangi|narx|sotib|oling|murojaat|qiling|bepul|yetkazib|berish|tabriklaymiz|assalomu|alaykum|va|ham|esa|shu|bu|kuni|soat)\b/i;
  const enWords =
    /\b(the|and|for|with|your|from|this|that|have|will|welcome|discount|today|please|order|delivery|service|available|contact|call)\b/i;

  if (cyrCount > 4 && latCount > 4 && (uzLatnWords.test(clean) || ruWords.test(clean))) {
    return 'mixed';
  }

  if (cyrCount > latCount) {
    if ((hasUzCyrlChars || uzCyrlWords.test(clean)) && !ruWords.test(clean)) {
      return 'uz_cyrl';
    }
    if ((hasUzCyrlChars || uzCyrlWords.test(clean)) && ruWords.test(clean)) {
      return 'mixed';
    }
    return 'ru';
  }

  const hasUzApostrophes = /[oOgG]['‘’`ʻʼ]/i.test(clean);
  if (enWords.test(clean) && !uzLatnWords.test(clean) && !hasUzApostrophes) {
    return 'en';
  }

  return 'uz_latn';
}

function isLanguageMismatch(detected: DetectedClientLang, targetLang: TtsLanguage): boolean {
  if (targetLang === 'uz') {
    return detected === 'ru' || detected === 'en' || detected === 'mixed';
  }
  if (targetLang === 'ru') {
    return detected !== 'ru';
  }
  if (targetLang === 'en') {
    return detected !== 'en';
  }
  return false;
}

const TIMED_PAUSE_TOKEN_REGEX = /^\[pauza\s+(\d+(?:\.\d+)?)s\]$/i;
const TIMED_PAUSE_GLOBAL_REGEX = /\[pauza\s+(\d+(?:\.\d+)?)s\]/gi;

function isPauseBracketToken(rawToken: string): boolean {
  const canonical = canonicalizeTimedPauseTags(rawToken || '').trim();
  return TIMED_PAUSE_TOKEN_REGEX.test(canonical);
}

/**
 * Находит только реальные незаполненные плейсхолдеры фактов ([telefon], [manzil] и т.д.),
 * НЕ считая студийные теги пауз ([pauza 1s], [pauza 2s], [pauza 3s], [пауза 2 сек]) пропусками!
 */
function findUnfilledPlaceholders(text: string): string[] {
  const canonical = canonicalizeTimedPauseTags(text || '');
  const matches = canonical.match(/\[[^\][]{1,40}\]/g) || [];
  return Array.from(
    new Set(
      matches
        .map((m) => m.trim())
        .filter((m) => !isPauseBracketToken(m))
    )
  );
}

/**
 * Вычисляет число произносимых слов, сумму пауз [pauza Ns], общую длительность (без потолка в 60 сек) и стоимость в кредитах.
 */
function computeClientScriptMetrics(rawText: string, speed: number = 1.0) {
  const canonical = canonicalizeTimedPauseTags(rawText || '').trim();
  const charCount = (rawText || '').trim().length;

  let pauseSeconds = 0;
  let m: RegExpExecArray | null;
  const rx = new RegExp(TIMED_PAUSE_GLOBAL_REGEX.source, 'gi');
  while ((m = rx.exec(canonical)) !== null) {
    const val = parseFloat(m[1]);
    if (!isNaN(val) && val > 0) {
      pauseSeconds += val;
    }
  }
  pauseSeconds = Math.round(pauseSeconds * 10) / 10;

  const spokenOnly = canonical
    .replace(TIMED_PAUSE_GLOBAL_REGEX, ' ')
    .replace(/<[^>]+>/g, ' ')
    .trim();

  const words = spokenOnly ? spokenOnly.split(/\s+/).filter(Boolean).length : 0;
  const speechSecs = words > 0 ? words / (2.2 * Math.max(0.8, speed)) : 0;
  const estSeconds =
    words === 0 && pauseSeconds === 0 ? 0 : Math.max(1, Math.round(speechSecs + pauseSeconds));
  const estCredits = estSeconds > 0 ? Math.max(1, Math.ceil(estSeconds / 60)) : 1;

  return { charCount, words, pauseSeconds, estSeconds, estCredits };
}

/**
 * Автоматически расставляет студийные паузы 1с, 2с, 3с между предложениями и абзацами текста.
 */
function autoInsertCadencePausesInText(rawText: string): string {
  const clean = canonicalizeTimedPauseTags(rawText || '').trim();
  if (!clean) return '';

  // Убираем старые автоматические паузы перед повторной расстановкой, чтобы не дублировать
  const withoutOld = clean.replace(/\s*\[pauza\s+\d+(?:\.\d+)?s\]\s*/gi, ' ').trim();
  const paragraphs = withoutOld
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const processedParagraphs = paragraphs.map((para) => {
    const sentences = para
      .split(/(?<=[.!?…])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (sentences.length <= 1) return para;

    return sentences
      .map((sent, sIdx) => {
        if (sIdx === sentences.length - 1) return sent;
        // После вопроса или восклицания — пауза 2с, между обычными фразами — чередование 1с и 2с
        if (/[?!]$/.test(sent)) return `${sent} [pauza 2s]`;
        return sIdx % 2 === 0 ? `${sent} [pauza 1s]` : `${sent} [pauza 2s]`;
      })
      .join(' ');
  });

  return processedParagraphs.join(' [pauza 3s]\n\n');
}

// Примеры-подсказки над полем ввода: нажатие ТОЛЬКО подставляет текст, не переключая никаких настроек
const AGENT_EXAMPLES: Array<{
  id: string;
  labelUz: string;
  labelRu: string;
  textUz: string;
  textRu: string;
}> = [
  {
    id: 'ad_coffee',
    labelUz: 'Reklama',
    labelRu: 'Реклама',
    textUz:
      "Toshkentdagi yangi qahvaxona uchun 20% ertalabki chegirma haqida 30 soniyalik jonli audio reklama yozing.",
    textRu:
      'Сделай 30-секундный рекламный ролик для новой кофейни в Ташкенте: скидка 20% на утренний кофе до 11:00.',
  },
  {
    id: 'announcement',
    labelUz: "E'lon",
    labelRu: 'Объявление',
    textUz:
      "Savdo markazi mijozlari uchun e'lon: do'konimiz har kuni 09:00 dan 22:00 gacha ishlaydi, 2-qavatda yangi kolleksiya.",
    textRu:
      'Голосовое объявление для торгового центра: график работы с 09:00 до 22:00 и новая коллекция на втором этаже.',
  },
  {
    id: 'greeting',
    labelUz: 'Tabrik',
    labelRu: 'Поздравление',
    textUz:
      'Jamoamiz va mijozlarimizni bayram bilan samimiy, iliq ohangda tabriklovchi qisqa nutq.',
    textRu:
      'Тёплое искреннее поздравление с днём рождения для коллеги или клиента на 45 секунд.',
  },
  {
    id: 'instruction',
    labelUz: "Yo'riqnoma",
    labelRu: 'Инструкция',
    textUz:
      "Mobil ilovada ro'yxatdan o'tish va buyurtma berish bo'yicha qadam-baqadam yo'riqnoma, qadamlar orasida 2 soniyali pauza bo'lsin.",
    textRu:
      'Пошаговая голосовая инструкция: как оформить заказ в приложении, с паузами 2 секунды между шагами.',
  },
  {
    id: 'story_monologue',
    labelUz: 'Monolog / Hikoya',
    labelRu: 'Монолог-рассказ',
    textUz:
      "Sabr va maqsad sari intilish haqida ta'sirli monolog-hikoya, har bir fikr orasida 1, 2 va 3 soniyali pauzalar bilan.",
    textRu:
      'Напиши один большой авторский монолог-рассказ о пути к цели с паузами 1, 2 и 3 секунды между мыслями.',
  },
];

export const TtsStudio: React.FC<TtsStudioProps> = ({
  voices,
  selectedVoiceId,
  onSelectVoiceId,
  onSaveToCMS,
  lang,
}) => {
  const { requireAuth, syncCredits } = useAuth();

  // Mode toggle: [ Обычный TTS | AI Агент ] — console settings persist across switches
  const [mode, setMode] = useState<TtsMode>('standard');

  // Right Console — Strictly 5 settings (NO Timbre slider!)
  const [targetLang, setTargetLang] = useState<TtsLanguage>('uz');
  const [preset, setPreset] = useState<TtsPreset>('auto');
  const [speed, setSpeed] = useState<number>(1.0);
  const [doNotTranslate, setDoNotTranslate] = useState<boolean>(false);
  const [userExplicitlyPickedVoice, setUserExplicitlyPickedVoice] = useState<boolean>(false);

  // Cartoon character voices loaded from public server config (single source of truth)
  const [characterVoices, setCharacterVoices] = useState<CharacterVoice[]>([]);
  const [selectedCharacterVoiceId, setSelectedCharacterVoiceId] = useState<string | null>(null);

  // Voice preview state
  const [playingPreviewVoiceId, setPlayingPreviewVoiceId] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  // Standard TTS Mode State
  const [text, setText] = useState<string>(
    "Assalomu alaykum! Bugun do'konimizda barcha yangi kolleksiyalarga 25% chegirma e'lon qilindi. [pauza 1s] Batafsil ma'lumot uchun bizga murojaat qiling."
  );
  const standardTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [originalPreTranslatedText, setOriginalPreTranslatedText] = useState<string | null>(null);
  const [translationBannerText, setTranslationBannerText] = useState<string | null>(null);
  const [transliterationNotice, setTransliterationNotice] = useState<string | null>(null);
  const [lastTranslatedSnapshot, setLastTranslatedSnapshot] = useState<string | null>(null);

  // Agent Mode State (полностью автономный агент — одно поле ввода)
  const [agentTask, setAgentTask] = useState<string>('');
  const agentTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [agentDecision, setAgentDecision] = useState<TtsAgentDecision | null>(null);

  const [isProposing, setIsProposing] = useState<boolean>(false);
  const [clarifyingQuestion, setClarifyingQuestion] = useState<string | null>(null);
  const [clarificationAnswer, setClarificationAnswer] = useState<string>('');
  const [proposals, setProposals] = useState<TtsAgentProposal[]>([]);
  const [openRefineId, setOpenRefineId] = useState<string | null>(null);
  const [refineInstructionById, setRefineInstructionById] = useState<Record<string, string>>({});
  const [refiningProposalId, setRefiningProposalId] = useState<string | null>(null);
  const [editingProposalId, setEditingProposalId] = useState<string | null>(null);
  const [voiceOverrideByProposalId, setVoiceOverrideByProposalId] = useState<Record<string, string>>({});

  // Google TTS 100 RPD quota status
  const [quotaStatus, setQuotaStatus] = useState<TtsQuotaStatus | null>(null);

  // Processing & Synthesis Result State
  const [stage, setStage] = useState<TtsProcessingStage>('idle');
  const [activeSynthesisText, setActiveSynthesisText] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [placeholderWarning, setPlaceholderWarning] = useState<string[] | null>(null);
  const [result, setResult] = useState<TtsSynthesisResult | null>(null);
  const [lastSynthesizedVoiceName, setLastSynthesizedVoiceName] = useState<string>('');
  const [savedToCmsSuccess, setSavedToCmsSuccess] = useState<boolean>(false);

  // Audio Player & Download State (Blob-backed via authFetch — 100% reliable in iframes)
  const [isPlayingResult, setIsPlayingResult] = useState<boolean>(false);
  const [currentTimeSec, setCurrentTimeSec] = useState<number>(0);
  const [audioBlobUrl, setAudioBlobUrl] = useState<string>('');
  const [isLoadingAudioBlob, setIsLoadingAudioBlob] = useState<boolean>(false);
  const [downloadingFormat, setDownloadingFormat] = useState<'mp3' | 'wav' | null>(null);
  const resultAudioRef = useRef<HTMLAudioElement | null>(null);

  const activeVoice = useMemo(
    () => voices.find((v) => v.id === selectedVoiceId) || voices[0],
    [voices, selectedVoiceId]
  );

  const activeCharacterVoice = useMemo(
    () =>
      selectedCharacterVoiceId
        ? characterVoices.find((c) => c.id === selectedCharacterVoiceId) || null
        : null,
    [characterVoices, selectedCharacterVoiceId]
  );

  const activeDisplayVoiceName = useMemo(() => {
    if (activeCharacterVoice) {
      return lang === 'uz' ? activeCharacterVoice.nameUz : activeCharacterVoice.nameRu;
    }
    return activeVoice?.name || 'OvozStudio';
  }, [activeCharacterVoice, activeVoice, lang]);

  const formatCharacterRoleLabel = (role: CharacterVoice['role']) => {
    if (lang === 'uz') {
      if (role === 'girl') return 'Qizcha';
      if (role === 'boy') return 'Bola';
      if (role === 'creature') return 'Qahramon';
      return 'Hikoyachi';
    }
    if (role === 'girl') return 'Девочка';
    if (role === 'boy') return 'Мальчик';
    if (role === 'creature') return 'Зверёк';
    return 'Сказочник';
  };

  // Detect input text language for «Не переводить» checkbox visibility
  const detectedLang = useMemo(() => detectClientTextLanguage(text), [text]);
  const showDoNotTranslateCheckbox = useMemo(
    () => isLanguageMismatch(detectedLang, targetLang),
    [detectedLang, targetLang]
  );

  // Estimate word count, pause seconds, total duration, and credit cost (no 60s cap)
  const textStats = useMemo(() => computeClientScriptMetrics(text, speed), [text, speed]);
  const agentTaskStats = useMemo(
    () => computeClientScriptMetrics(agentTask, speed),
    [agentTask, speed]
  );

  // Real-time Studio Countdown HUD & Waveform hooks (just like Solo Podcast & 2 Ovozli Intervyu)
  const isSynthesizingAudio =
    stage === 'translating' || stage === 'analyzing_intonation' || stage === 'synthesizing';
  const activeSynthMetrics = useMemo(
    () => computeClientScriptMetrics(activeSynthesisText || text, speed),
    [activeSynthesisText, text, speed]
  );
  const estimatedSynthGenSeconds = useMemo(
    () =>
      Math.max(
        5,
        calculateAudioSynthesizeSeconds(activeSynthMetrics.words, speed) +
          (preset === 'auto' ? 3 : 0)
      ),
    [activeSynthMetrics.words, speed, preset]
  );
  const audioSynthesisCountdown = useGenerationCountdown(
    isSynthesizingAudio,
    estimatedSynthGenSeconds,
    lang,
    'audio_solo'
  );

  const isAgentWorking = isProposing || Boolean(refiningProposalId);
  const estimatedAgentGenSeconds = useMemo(() => {
    if (agentTaskStats.words > 300) return 14;
    return 8;
  }, [agentTaskStats.words]);
  const agentScriptCountdown = useGenerationCountdown(
    isAgentWorking,
    estimatedAgentGenSeconds,
    lang,
    'script_solo'
  );

  // Fetch daily Gemini TTS quota status on mount
  const refreshQuotaStatus = async () => {
    try {
      const res = await authFetch('/api/tts/quota');
      if (res.ok) {
        const data = await res.json();
        if (typeof data?.remaining === 'number') {
          setQuotaStatus(data);
        }
      }
    } catch {}
  };

  useEffect(() => {
    refreshQuotaStatus();
    fetch('/api/tts/character-voices')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (Array.isArray(data?.voices)) {
          setCharacterVoices(data.voices);
        }
      })
      .catch(() => {});
  }, []);

  const standardEstCalls = useMemo(() => estimateTtsCallsForText(text), [text]);
  const isAgentTaskTooLong = agentTaskStats.words > MAX_AGENT_WORDS;

  // Load synthesized audio into an authenticated local Blob URL so Play & Seek always work
  useEffect(() => {
    let active = true;
    let createdUrl = '';

    setIsPlayingResult(false);
    setCurrentTimeSec(0);
    if (resultAudioRef.current) {
      resultAudioRef.current.pause();
    }

    if (!result?.audioUrl) {
      setAudioBlobUrl('');
      setIsLoadingAudioBlob(false);
      return;
    }

    setIsLoadingAudioBlob(true);
    authFetch(result.audioUrl)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Audio load failed (${res.status})`);
        }
        const blob = await res.blob();
        if (!active) return;
        createdUrl = URL.createObjectURL(blob);
        setAudioBlobUrl(createdUrl);
      })
      .catch((err) => {
        if (!active) return;
        console.error('[TtsStudio] Failed to load audio blob:', err);
        setAudioBlobUrl('');
        setErrorMessage(
          lang === 'uz'
            ? "Tayyor audioni yuklab bo'lmadi. Qayta urinib ko'ring."
            : 'Не удалось загрузить готовое аудио для воспроизведения. Попробуйте ещё раз.'
        );
      })
      .finally(() => {
        if (active) setIsLoadingAudioBlob(false);
      });

    return () => {
      active = false;
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [result?.id, result?.audioUrl]);

  // Authenticated Blob download (works reliably in iframes and all browsers)
  const handleDownloadResultAudio = async (format: 'mp3' | 'wav') => {
    if (!result || downloadingFormat) return;
    setDownloadingFormat(format);
    setErrorMessage(null);
    try {
      const targetUrl = format === 'mp3' ? result.mp3Url : result.audioUrl;
      const res = await authFetch(targetUrl);
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(errText || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `ovozstudio_${result.id}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 2500);
    } catch (err: any) {
      setErrorMessage(
        lang === 'uz'
          ? `Faylni yuklab olib bo'lmadi (${format.toUpperCase()}): ${err?.message || ''}`
          : `Не удалось скачать ${format.toUpperCase()}: ${err?.message || 'ошибка сети'}`
      );
    } finally {
      setDownloadingFormat(null);
    }
  };

  // Insert pause or vocal tag into Standard Textarea at cursor position
  const insertTagIntoStandardEditor = (tag: string) => {
    const el = standardTextareaRef.current;
    if (!el) {
      setText((prev) => `${prev.trim()} ${tag} `.slice(0, MAX_STUDIO_CHARS));
      return;
    }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const before = text.slice(0, start);
    const after = text.slice(end);
    const needLeadingSpace = before.length > 0 && !/\s$/.test(before);
    const needTrailingSpace = after.length === 0 || !/^\s/.test(after);
    const insertion = `${needLeadingSpace ? ' ' : ''}${tag}${needTrailingSpace ? ' ' : ''}`;
    const updated = `${before}${insertion}${after}`.slice(0, MAX_STUDIO_CHARS);
    setText(updated);
    setTimeout(() => {
      el.focus();
      const nextPos = Math.min(updated.length, start + insertion.length);
      el.setSelectionRange(nextPos, nextPos);
    }, 10);
  };

  // Update a proposal's text directly in-place and recalculate words, pauses, and duration immediately
  const handleUpdateProposalTextInPlace = (proposalId: string, newText: string) => {
    const metrics = computeClientScriptMetrics(newText, speed);
    const placeholders = findUnfilledPlaceholders(newText);
    setProposals((prev) =>
      prev.map((item) =>
        item.id === proposalId
          ? {
              ...item,
              text: newText,
              segments: undefined, // ручная правка текста имеет приоритет над исходными сегментами
              wordCount: metrics.words,
              pauseTotalSeconds: metrics.pauseSeconds,
              estimatedSeconds: metrics.estSeconds,
              placeholders,
            }
          : item
      )
    );
  };

  const handleTogglePreviewUrl = (previewKey: string, url: string) => {
    if (playingPreviewVoiceId === previewKey) {
      previewAudioRef.current?.pause();
      setPlayingPreviewVoiceId(null);
      return;
    }

    if (!previewAudioRef.current) {
      previewAudioRef.current = new Audio(url);
      previewAudioRef.current.onended = () => setPlayingPreviewVoiceId(null);
    } else {
      previewAudioRef.current.pause();
      previewAudioRef.current.src = url;
    }
    previewAudioRef.current.currentTime = 0;
    previewAudioRef.current
      .play()
      .then(() => setPlayingPreviewVoiceId(previewKey))
      .catch(() => setPlayingPreviewVoiceId(null));
  };

  const handleToggleVoicePreview = (voice: VoiceProfile) => {
    const url =
      voice.sampleAudioUrl ||
      getVoicePreviewUrl(voice.id) ||
      `/audio/previews/${voice.id}.wav`;
    handleTogglePreviewUrl(voice.id, url);
  };

  const handleToggleCharacterPreview = (charVoice: CharacterVoice) => {
    const url =
      charVoice.previewUrl ||
      getVoicePreviewUrl(charVoice.id) ||
      `/audio/previews/characters/${charVoice.id}.wav`;
    handleTogglePreviewUrl(charVoice.id, url);
  };

  const executeSynthesize = async (params: {
    textToSpeak: string;
    voiceIdToUse: string;
    characterVoiceIdToUse?: string;
    presetToUse: TtsPreset;
    directorStyle?: string;
    segments?: TtsDirectorSegment[];
  }) => {
    setErrorMessage(null);
    setPlaceholderWarning(null);
    setSavedToCmsSuccess(false);

    // Check for unfilled fact placeholders [...] (excluding [pauza Ns]) before synthesis
    const unfilled = findUnfilledPlaceholders(params.textToSpeak);
    if (unfilled.length > 0) {
      setPlaceholderWarning(unfilled);
      return;
    }

    try {
      setActiveSynthesisText(params.textToSpeak);
      setStage(params.presetToUse === 'auto' && !params.directorStyle ? 'analyzing_intonation' : 'synthesizing');

      const chosenCharacter = params.characterVoiceIdToUse
        ? characterVoices.find((c) => c.id === params.characterVoiceIdToUse)
        : undefined;
      const chosenVoice = chosenCharacter
        ? undefined
        : voices.find((v) => v.id === params.voiceIdToUse) || activeVoice;
      const replicatedVoiceConfig =
        !chosenCharacter && chosenVoice?.isReplicatedVoice
          ? {
              voiceSampleAudio: chosenVoice.sampleAudioUrl,
              consentAudio: (chosenVoice as any).consentAudio,
              voiceConsentSignature: (chosenVoice as any).voiceConsentSignature,
            }
          : undefined;

      const stageTimer =
        params.presetToUse === 'auto' && !params.directorStyle
          ? setTimeout(() => setStage('synthesizing'), 1400)
          : null;

      const res = await authFetch('/api/tts/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: params.textToSpeak,
          voiceId: chosenCharacter ? chosenCharacter.baseVoice || 'Leda' : params.voiceIdToUse,
          characterVoiceId: chosenCharacter ? chosenCharacter.id : undefined,
          language: targetLang,
          preset: params.presetToUse,
          speed,
          replicatedVoiceConfig,
          directorStyle: params.directorStyle || undefined,
          segments: params.segments && params.segments.length > 1 ? params.segments : undefined,
        }),
      });

      if (stageTimer) clearTimeout(stageTimer);

      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data?.message_ru || data?.message || data?.error || 'Ошибка синтеза речи'
        );
      }

      setLastSynthesizedVoiceName(
        chosenCharacter
          ? lang === 'uz'
            ? chosenCharacter.nameUz
            : chosenCharacter.nameRu
          : chosenVoice?.name || params.voiceIdToUse
      );
      setResult(data);
      setStage('done');
      if (typeof data.creditsRemaining === 'number') {
        syncCredits(data.creditsRemaining);
      }
      if (typeof data.quotaRemaining === 'number' && typeof data.quotaLimit === 'number') {
        setQuotaStatus((prev) => ({
          dayKey: prev?.dayKey || '',
          used: Math.max(0, data.quotaLimit - data.quotaRemaining),
          limit: data.quotaLimit,
          remaining: data.quotaRemaining,
          resetLabelRu: prev?.resetLabelRu || 'после 13:00 по Ташкенту',
          resetLabelUz: prev?.resetLabelUz || 'Toshkent vaqti bilan 13:00 dan keyin',
        }));
      } else {
        refreshQuotaStatus();
      }
    } catch (err: any) {
      setStage('idle');
      setErrorMessage(err?.message || 'Не удалось выполнить синтез речи');
    }
  };

  /**
   * Standard Mode "Ozvuchit'" button handler
   */
  const handleStandardSpeakClick = async () => {
    if (!requireAuth(() => {}, 'TTS Ovozlash')) return;
    const clean = text.trim();
    if (!clean) return;

    setErrorMessage(null);
    setPlaceholderWarning(null);
    setTransliterationNotice(null);

    const unfilled = findUnfilledPlaceholders(clean);
    if (unfilled.length > 0) {
      setPlaceholderWarning(unfilled);
      return;
    }

    const currentDetected = detectClientTextLanguage(clean);

    // Case 1: Uzbek Cyrillic when target language is Uzbek -> transliterate in-place and synthesize immediately
    if (targetLang === 'uz' && currentDetected === 'uz_cyrl') {
      try {
        setActiveSynthesisText(clean);
        setStage('translating');
        const trRes = await authFetch('/api/tts/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: clean, targetLanguage: 'uz' }),
        });
        const trData = await trRes.json();
        if (trRes.ok && trData?.translatedText) {
          setText(trData.translatedText);
          setLastTranslatedSnapshot(trData.translatedText);
          setTransliterationNotice(
            lang === 'uz'
              ? "Kirill yozuvidagi matn lotin alifbosiga o'girildi (tarjimasiz)."
              : 'Узбекская кириллица транслитерирована в латиницу (без перевода).'
          );
          await executeSynthesize({
            textToSpeak: trData.translatedText,
            voiceIdToUse: selectedVoiceId,
            characterVoiceIdToUse: selectedCharacterVoiceId || undefined,
            presetToUse: preset,
          });
          return;
        }
      } catch (e: any) {
        setStage('idle');
        setErrorMessage(e?.message || 'Ошибка транслитерации текста');
        return;
      }
    }

    // Case 2: Language differs from targetLang and «Не переводить» is unchecked, and this text hasn't been translated yet
    const mismatch = isLanguageMismatch(currentDetected, targetLang);
    if (mismatch && !doNotTranslate && lastTranslatedSnapshot !== clean) {
      try {
        setActiveSynthesisText(clean);
        setStage('translating');
        const trRes = await authFetch('/api/tts/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: clean, targetLanguage: targetLang }),
        });
        const trData = await trRes.json();
        if (!trRes.ok) {
          throw new Error(trData?.error || 'Ошибка перевода текста');
        }

        if (trData.wasTranslated && trData.translatedText) {
          setOriginalPreTranslatedText(clean);
          setText(trData.translatedText);
          setLastTranslatedSnapshot(trData.translatedText);
          const bannerLabel =
            targetLang === 'uz'
              ? "Matn o'zbekchaga tarjima qilindi — tekshirib, «Ozvuchit'» tugmasini bosing"
              : targetLang === 'ru'
                ? "Текст переведён на русский язык — проверьте и нажмите «Ozvuchit'»"
                : "Text translated to English — review and click «Ozvuchit'»";
          setTranslationBannerText(bannerLabel);
          setStage('idle');
          return;
        }
      } catch (err: any) {
        setStage('idle');
        setErrorMessage(err?.message || 'Ошибка при переводе текста');
        return;
      }
    }

    // Case 3: Language matches (or already reviewed translation, or «Не переводить» is checked) -> synthesize
    await executeSynthesize({
      textToSpeak: clean,
      voiceIdToUse: selectedVoiceId,
      characterVoiceIdToUse: selectedCharacterVoiceId || undefined,
      presetToUse: preset,
    });
  };

  // Agent Mode: Autonomous AI Director (решает сам: жанр, число вариантов, длительность, паузы)
  const handleProposeVariants = async (overrideTask?: string) => {
    if (!requireAuth(() => {}, 'TTS AI Agent')) return;
    const taskToUse = (overrideTask ?? agentTask).trim();
    if (!taskToUse) return;
    const wc = taskToUse.split(/\s+/).filter(Boolean).length;
    if (wc > MAX_AGENT_WORDS) {
      setErrorMessage(
        lang === 'uz'
          ? `Matnni qismlarga bo'ling (maksimum ${MAX_AGENT_WORDS} so'z).`
          : `Разбейте текст на части (максимум ${MAX_AGENT_WORDS} слов, сейчас ${wc}).`
      );
      return;
    }

    setIsProposing(true);
    setErrorMessage(null);
    setPlaceholderWarning(null);
    setClarifyingQuestion(null);
    setAgentDecision(null);
    setVoiceOverrideByProposalId({});
    setEditingProposalId(null);

    try {
      const res = await authFetch('/api/tts/agent-propose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: taskToUse,
          language: targetLang,
          voiceId: userExplicitlyPickedVoice
            ? selectedCharacterVoiceId || selectedVoiceId
            : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message_ru || data?.error || 'Ошибка генерации сценария');
      }

      if (data.decision) {
        setAgentDecision(data.decision);
      }

      if (data.needsClarification && data.clarifyingQuestion) {
        setClarifyingQuestion(data.clarifyingQuestion);
        setProposals([]);
      } else {
        setClarifyingQuestion(null);
        const nextProposals: TtsAgentProposal[] = Array.isArray(data.proposals)
          ? data.proposals
          : [];
        setProposals(nextProposals);

        // Если пользователь НЕ выбирал голос вручную в правой консоли и агент определил kids_cartoon —
        // автоматически выставляем рекомендованного персонажа на каждой карточке!
        if (!userExplicitlyPickedVoice && data.decision?.audience === 'kids_cartoon') {
          const autoOverrides: Record<string, string> = {};
          for (const p of nextProposals) {
            if (p.characterVoiceId) {
              autoOverrides[p.id] = p.characterVoiceId;
            }
          }
          setVoiceOverrideByProposalId(autoOverrides);
        }
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Не удалось получить сценарий от агента');
    } finally {
      setIsProposing(false);
    }
  };

  // Agent Mode: Refine a specific proposal
  const handleRefineProposal = async (proposal: TtsAgentProposal, overrideInstruction?: string) => {
    const instruction = (overrideInstruction ?? refineInstructionById[proposal.id] ?? '').trim();
    if (!instruction) return;

    setRefiningProposalId(proposal.id);
    setErrorMessage(null);
    try {
      const res = await authFetch('/api/tts/agent-refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalText: proposal.text,
          directorStyle: proposal.deliveryStyle || proposal.directorStyle || '',
          instruction,
          language: targetLang,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message_ru || data?.error || 'Ошибка доработки сценария');
      }

      const updatedMetrics = computeClientScriptMetrics(data.refinedText, speed);
      setProposals((prev) =>
        prev.map((item) =>
          item.id === proposal.id
            ? {
                ...item,
                text: data.refinedText,
                directorStyle: data.directorStyle || item.directorStyle,
                deliveryStyle: data.directorStyle || item.deliveryStyle,
                segments: undefined,
                wordCount: updatedMetrics.words,
                pauseTotalSeconds: updatedMetrics.pauseSeconds,
                estimatedSeconds: updatedMetrics.estSeconds,
                placeholders: findUnfilledPlaceholders(data.refinedText),
              }
            : item
        )
      );
      setRefineInstructionById((prev) => ({ ...prev, [proposal.id]: '' }));
      setOpenRefineId(null);

      if (typeof data.creditsRemaining === 'number') {
        syncCredits(data.creditsRemaining);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Ошибка при доработке текста');
    } finally {
      setRefiningProposalId(null);
    }
  };

  // Resolves effective voice/character for an Agent proposal card (manual choice always wins)
  const resolveEffectiveCardSelection = (proposal: TtsAgentProposal): string => {
    if (voiceOverrideByProposalId[proposal.id]) {
      return voiceOverrideByProposalId[proposal.id];
    }
    if (userExplicitlyPickedVoice) {
      return selectedCharacterVoiceId || selectedVoiceId || voices[0]?.id || 'ulugbek-history';
    }
    if (proposal.characterVoiceId && characterVoices.some((c) => c.id === proposal.characterVoiceId)) {
      return proposal.characterVoiceId;
    }
    return selectedCharacterVoiceId || selectedVoiceId || voices[0]?.id || 'ulugbek-history';
  };

  // Agent Mode: Speak a proposal card immediately using the chosen voice/character & deliveryStyle
  const handleSpeakProposal = async (proposal: TtsAgentProposal) => {
    if (!requireAuth(() => {}, 'TTS Ovozlash')) return;
    const unfilled = findUnfilledPlaceholders(proposal.text);
    if (unfilled.length > 0) {
      setPlaceholderWarning(unfilled);
      return;
    }

    const effectiveSelectionId = resolveEffectiveCardSelection(proposal);
    const selectedChar = characterVoices.find((c) => c.id === effectiveSelectionId);

    // Если подача в режиме "Авто", передаём режиссуру агента (deliveryStyle/directorStyle + segments) напрямую в Gemini 3.8 TTS!
    const useAgentDirection = preset === 'auto';
    const presetToUse: TtsPreset = useAgentDirection ? 'auto' : preset;
    const activeDirectionStyle = proposal.deliveryStyle || proposal.directorStyle;

    await executeSynthesize({
      textToSpeak: proposal.text,
      voiceIdToUse: selectedChar ? selectedChar.baseVoice || 'Leda' : effectiveSelectionId,
      characterVoiceIdToUse: selectedChar ? selectedChar.id : undefined,
      presetToUse,
      directorStyle: useAgentDirection ? activeDirectionStyle : undefined,
      segments: useAgentDirection ? proposal.segments : undefined,
    });
  };

  // Agent Mode: Open proposal in Standard Editor
  const handleOpenProposalInEditor = (proposal: TtsAgentProposal) => {
    setText(proposal.text);
    setLastTranslatedSnapshot(proposal.text);
    setTranslationBannerText(null);
    setPlaceholderWarning(null);
    const effectiveSelectionId = resolveEffectiveCardSelection(proposal);
    const matchedChar = characterVoices.find((c) => c.id === effectiveSelectionId);
    if (matchedChar) {
      setSelectedCharacterVoiceId(matchedChar.id);
    } else if (voices.some((v) => v.id === effectiveSelectionId)) {
      setSelectedCharacterVoiceId(null);
      onSelectVoiceId(effectiveSelectionId);
    }
    setPreset('auto');
    setMode('standard');
  };

  // Save synthesized audio to Media Library (Kutubxona)
  const handleSaveToMediaLibrary = async () => {
    if (!result || savedToCmsSuccess) return;
    try {
      const res = await authFetch(`/api/tts/keep/${result.id}`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Ошибка сохранения в Медиатеку');
      }

      onSaveToCMS({
        id: result.id,
        title: `TTS: ${result.finalSpokenText.slice(0, 48)}`,
        script: result.finalSpokenText,
        voiceName: lastSynthesizedVoiceName || activeVoice?.name || selectedVoiceId,
        durationSeconds: result.durationSeconds,
        rawAudioWavBase64: data.rawAudioWavBase64 || '',
        preset,
        speed: `${speed}x`,
      });
      setSavedToCmsSuccess(true);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Не удалось сохранить в Медиатеку');
    }
  };

  // Render text with studio pause badges [pauza Ns] in teal and unfilled fact placeholders [...] in amber
  const renderHighlightedPlaceholders = (raw: string) => {
    const canonical = canonicalizeTimedPauseTags(raw || '');
    const parts = canonical.split(/(\[[^\][]{1,40}\]|<short pause>|<breath>|<sigh>|<laugh>)/gi);
    return parts.map((part, idx) => {
      if (isPauseBracketToken(part) || /^<(?:short pause|breath|sigh|laugh)>$/i.test(part)) {
        return (
          <span
            key={idx}
            className="inline-flex items-center gap-1 bg-[rgba(14,124,134,0.14)] text-[#0A5A62] border border-[#0E7C86]/30 font-mono text-[11px] px-1.5 py-0.5 rounded-md font-semibold mx-0.5"
          >
            <Clock className="w-2.5 h-2.5 text-[#0E7C86]" />
            {part}
          </span>
        );
      }
      if (/^\[[^\][]{1,40}\]$/.test(part)) {
        return (
          <mark
            key={idx}
            className="bg-amber-200/90 text-amber-950 font-mono px-1.5 py-0.5 rounded font-semibold"
          >
            {part}
          </mark>
        );
      }
      return <React.Fragment key={idx}>{part}</React.Fragment>;
    });
  };

  return (
    <div className="flex flex-col lg:flex-row gap-6 items-start">
      {/* LEFT WORKSPACE (~70%) */}
      <div className="w-full lg:w-[70%] space-y-5 min-w-0">
        {/* Real-time Studio Countdown HUD during Audio Synthesis or AI Agent Generation */}
        {isSynthesizingAudio && (
          <GenerationCountdownHUD
            countdown={audioSynthesisCountdown}
            isActive={isSynthesizingAudio}
            lang={lang}
            title={
              lang === 'uz'
                ? `${activeDisplayVoiceName} bilan nutq sintez qilinmoqda`
                : `Студийный синтез речи (${activeDisplayVoiceName})`
            }
            subtitle={
              stage === 'translating'
                ? lang === 'uz'
                  ? 'Matn tarjima qilinmoqda va normalizatsiya qilinmoqda...'
                  : 'Перевод и фонетическая нормализация текста...'
                : stage === 'analyzing_intonation'
                  ? lang === 'uz'
                    ? 'Intonatsiya, nafas va pauzalar ([pauza 1-3s]) tahlil qilinmoqda...'
                    : 'Режиссура интонации, дыхания и студийных пауз ([pauza 1–3с])...'
                  : lang === 'uz'
                    ? audioSynthesisCountdown.phaseNameUz
                    : audioSynthesisCountdown.phaseNameRu
            }
            mode="inline"
          />
        )}

        {isAgentWorking && !isSynthesizingAudio && (
          <GenerationCountdownHUD
            countdown={agentScriptCountdown}
            isActive={isAgentWorking}
            lang={lang}
            title={
              lang === 'uz'
                ? 'AI Rejissyor ssenariy va pauzalarni tayyorlamoqda'
                : 'AI-Режиссёр создаёт сценарий и партитуру пауз'
            }
            subtitle={
              lang === 'uz'
                ? agentScriptCountdown.phaseNameUz
                : agentScriptCountdown.phaseNameRu
            }
            mode="inline"
          />
        )}

        {/* Top Mode Switcher: [ Обычный TTS | AI Агент ] */}
        <div className="border border-[rgba(22,21,17,0.14)] rounded-[20px] bg-white/80 backdrop-blur-md p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-lg sm:text-xl font-bold text-[#161511] tracking-tight">
                {lang === 'uz' ? 'TTS Ovozlash Studiyasi' : 'TTS Озвучка и AI-Режиссёр'}
              </h1>
              <p className="text-xs text-[#5D594E] mt-0.5">
                {lang === 'uz'
                  ? "Qisqa roliklardan tortib 10 000 so'zlik katta monolog, hikoya va jarayonlargacha — aniq 1, 2, 3 soniyali pauzalar bilan"
                  : 'От коротких роликов до больших монологов, рассказов и процедур (до 10 000 слов) с точными паузами 1, 2, 3 сек'}
              </p>
            </div>

            {/* Segmented Mode Toggle */}
            <div className="inline-flex p-1 rounded-xl bg-[#ECE7DB] border border-[rgba(22,21,17,0.14)]">
              <button
                type="button"
                onClick={() => {
                  setMode('standard');
                  setPlaceholderWarning(null);
                }}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                  mode === 'standard'
                    ? 'bg-[#161511] text-[#F4F1EA] shadow-xs'
                    : 'text-[#5D594E] hover:text-[#161511]'
                }`}
              >
                {lang === 'uz' ? 'Oddiy TTS' : 'Обычный TTS'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('agent');
                  setPlaceholderWarning(null);
                }}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                  mode === 'agent'
                    ? 'bg-[#0E7C86] text-white shadow-xs'
                    : 'text-[#5D594E] hover:text-[#161511]'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{lang === 'uz' ? 'AI Agent (Rejissyor)' : 'AI Агент (Режиссёр)'}</span>
              </button>
            </div>
          </div>

          {/* Unfilled Placeholders Warning Banner */}
          {placeholderWarning && placeholderWarning.length > 0 && (
            <div className="rounded-xl bg-amber-50 border border-amber-300 px-4 py-3 text-xs text-amber-950 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <b className="font-semibold block">
                  {lang === 'uz'
                    ? "Ovozlashtirishdan oldin bo'sh joylarni to'ldiring:"
                    : 'Заполните пропуски перед озвучкой:'}
                </b>
                <p className="font-mono text-[11px]">
                  {placeholderWarning.join(', ')}
                </p>
              </div>
            </div>
          )}

          {/* Error Banner */}
          {errorMessage && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-xs text-rose-900 flex items-center justify-between gap-3">
              <span>{errorMessage}</span>
              <button
                type="button"
                onClick={() => setErrorMessage(null)}
                className="text-rose-700 hover:underline font-mono text-[11px] cursor-pointer"
              >
                OK
              </button>
            </div>
          )}

          {/* ========================================================= */}
          {/* MODE 1: STANDARD TTS MODE                                 */}
          {/* ========================================================= */}
          {mode === 'standard' && (
            <div className="space-y-3">
              {/* Pre-synthesis Translation Banner («Matn o'zbekchaga tarjima qilindi») */}
              {translationBannerText && (
                <div className="rounded-xl bg-[rgba(14,124,134,0.1)] border border-[#0E7C86]/30 px-4 py-2.5 text-xs text-[#0A5A62] flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-medium">
                    <Languages className="w-4 h-4 text-[#0E7C86] shrink-0" />
                    <span>Matn o&apos;zbekchaga tarjima qilindi ({translationBannerText})</span>
                  </div>
                  {originalPreTranslatedText && (
                    <button
                      type="button"
                      onClick={() => {
                        setText(originalPreTranslatedText);
                        setOriginalPreTranslatedText(null);
                        setTranslationBannerText(null);
                        setLastTranslatedSnapshot(null);
                      }}
                      className="text-[11px] font-mono text-[#0A5A62] hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>{lang === 'uz' ? 'Asl matnni qaytarish' : 'Вернуть исходный текст'}</span>
                    </button>
                  )}
                </div>
              )}

              {/* Transliteration Notice */}
              {transliterationNotice && (
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2 text-xs text-emerald-900">
                  {transliterationNotice}
                </div>
              )}

              {/* 1-Click Studio Pause & Vocalization Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-2 bg-[#F4F1EA] border border-[rgba(22,21,17,0.12)] rounded-xl px-3 py-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-mono text-[#5D594E] mr-1">
                    {lang === 'uz' ? 'Aniq pauza qo‘shish:' : 'Вставить точную паузу:'}
                  </span>
                  {(
                    [
                      { label: '+ 0.5s', tag: '[pauza 0.5s]' },
                      { label: '+ 1 сек', tag: '[pauza 1s]' },
                      { label: '+ 2 сек', tag: '[pauza 2s]' },
                      { label: '+ 3 сек', tag: '[pauza 3s]' },
                      { label: lang === 'uz' ? '+ Nafas' : '+ Вдох', tag: '<breath>' },
                      { label: lang === 'uz' ? '+ Xo‘rsinish' : '+ Вздох', tag: '<sigh>' },
                      { label: lang === 'uz' ? '+ Tabassum' : '+ Смех/улыбка', tag: '<laugh>' },
                    ] as const
                  ).map((btn) => (
                    <button
                      key={btn.tag}
                      type="button"
                      onClick={() => insertTagIntoStandardEditor(btn.tag)}
                      className="px-2.5 py-1 rounded-lg bg-white border border-[rgba(22,21,17,0.14)] hover:border-[#0E7C86] hover:text-[#0A5A62] text-[11px] font-mono font-semibold text-[#161511] transition-colors cursor-pointer whitespace-nowrap"
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => setText((prev) => autoInsertCadencePausesInText(prev))}
                  className="px-2.5 py-1 rounded-lg bg-[rgba(14,124,134,0.12)] border border-[#0E7C86]/30 hover:bg-[#0E7C86] hover:text-white text-[11px] font-mono font-semibold text-[#0A5A62] transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1"
                  title={
                    lang === 'uz'
                      ? 'Gaplar va xatboshilar orasiga avtomatik 1s, 2s, 3s pauzalarni joylashtirish'
                      : 'Автоматически расставить паузы 1с, 2с, 3с между предложениями и абзацами'
                  }
                >
                  <Clock className="w-3 h-3" />
                  <span>
                    {lang === 'uz' ? 'Avto-pauza (1–2–3s)' : 'Авто-паузы (1–2–3с)'}
                  </span>
                </button>
              </div>

              {/* Textarea up to 65 000 characters (~10 000 words) */}
              <div className="relative">
                <textarea
                  ref={standardTextareaRef}
                  value={text}
                  onChange={(e) => {
                    const nextVal = e.target.value.slice(0, MAX_STUDIO_CHARS);
                    setText(nextVal);
                    setPlaceholderWarning(null);
                  }}
                  rows={10}
                  maxLength={MAX_STUDIO_CHARS}
                  placeholder={
                    lang === 'uz'
                      ? "Ovozlashtirish uchun matn, monolog yoki to'liq jarayonni kiriting (10 000 so'zgacha). Pauza uchun [pauza 1s], [pauza 2s], [pauza 3s] ishlating..."
                      : 'Введите или вставьте текст, большой монолог, рассказ или всю процедуру (до 10 000 слов). Для точных пауз используйте кнопки +1 сек, +2 сек, +3 сек...'
                  }
                  className="w-full rounded-2xl border border-[rgba(22,21,17,0.16)] bg-[#FAF8F4] p-4 text-sm sm:text-base text-[#161511] leading-relaxed focus:outline-none focus:border-[#0E7C86] transition-colors resize-y"
                />
              </div>

              {/* Footer Bar: Counter, Quota Forecast (1.6), and «Ozvuchit'» CTA */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums text-[#5D594E]">
                  <span>
                    {textStats.words.toLocaleString()} {lang === 'uz' ? "so'z" : 'слов'}
                  </span>
                  <span>·</span>
                  <span>
                    {textStats.charCount.toLocaleString()} / {MAX_STUDIO_CHARS.toLocaleString()} {lang === 'uz' ? 'belgi' : 'зн.'}
                  </span>
                  {textStats.pauseSeconds > 0 && (
                    <>
                      <span>·</span>
                      <span className="text-[#0E7C86] font-semibold">
                        +{textStats.pauseSeconds}s {lang === 'uz' ? 'pauza' : 'пауз'}
                      </span>
                    </>
                  )}
                  <span>·</span>
                  <span className="text-[#161511] font-semibold">
                    ≈ {formatDurationHuman(textStats.estSeconds, lang)} ({textStats.estSeconds}s)
                  </span>
                  {quotaStatus && standardEstCalls > 0 && (
                    <>
                      <span>·</span>
                      <span
                        className={`font-semibold ${
                          standardEstCalls > quotaStatus.remaining
                            ? 'text-amber-700'
                            : 'text-[#0A5A62]'
                        }`}
                      >
                        {standardEstCalls > quotaStatus.remaining
                          ? `⚠ Займёт ~${standardEstCalls} выз., сегодня осталось ${quotaStatus.remaining}`
                          : `Займёт ~${standardEstCalls} выз., сегодня осталось ${quotaStatus.remaining}`}
                      </span>
                    </>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <PreCalculationBadge
                    estimatedSeconds={estimatedSynthGenSeconds}
                    wordCount={textStats.words}
                    audioDurationSeconds={textStats.estSeconds}
                    creditsCost={textStats.estCredits}
                    lang={lang}
                  />

                  {showDoNotTranslateCheckbox && !doNotTranslate && lastTranslatedSnapshot !== text.trim() && (
                    <button
                      type="button"
                      onClick={handleStandardSpeakClick}
                      disabled={!text.trim() || isSynthesizingAudio}
                      className="btn-pill btn-ghost text-xs px-3.5 py-2 flex items-center gap-1.5 cursor-pointer"
                    >
                      <Languages className="w-3.5 h-3.5 text-[#0E7C86]" />
                      <span>{lang === 'uz' ? "Tarjima qilish va ko'rish" : 'Перевести перед озвучкой'}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleStandardSpeakClick}
                    disabled={!text.trim() || isSynthesizingAudio}
                    className="btn-pill btn-solid px-5 py-2.5 text-xs sm:text-sm font-semibold flex items-center gap-2 shadow-sm cursor-pointer disabled:opacity-50"
                  >
                    <Volume2 className="w-4 h-4" />
                    <span>
                      {stage === 'translating'
                        ? lang === 'uz'
                          ? 'Tarjima qilinmoqda…'
                          : 'Перевод…'
                        : isSynthesizingAudio
                          ? `${lang === 'uz' ? 'Sintez' : 'Синтез'} ${audioSynthesisCountdown.progressPercent}%`
                          : "Ozvuchit'"}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* MODE 2: AUTONOMOUS AI AGENT (SINGLE INPUT, ZERO DROPDOWNS) */}
          {/* ========================================================= */}
          {mode === 'agent' && (
            <div className="space-y-4">
              {/* 5 примеров-подсказок (нажатие ТОЛЬКО подставляет текст, без переключения настроек) */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-mono text-[#5D594E] mr-1">
                  {lang === 'uz' ? 'Misollar:' : 'Примеры:'}
                </span>
                {AGENT_EXAMPLES.map((ex) => (
                  <button
                    key={ex.id}
                    type="button"
                    onClick={() => setAgentTask(lang === 'uz' ? ex.textUz : ex.textRu)}
                    className="px-3 py-1 rounded-lg border border-[rgba(22,21,17,0.14)] bg-[#F4F1EA] hover:bg-[#ECE7DB] text-xs font-medium text-[#161511] transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {lang === 'uz' ? ex.labelUz : ex.labelRu}
                  </button>
                ))}
              </div>

              {/* Единственное поле ввода без лишних настроек (лимит 3 000 слов) */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-[#161511]">
                  {lang === 'uz'
                    ? 'Vazifani yozing yoki tayyor matnni joylang'
                    : 'Опишите задачу или вставьте текст'}
                </label>

                <textarea
                  ref={agentTextareaRef}
                  value={agentTask}
                  onChange={(e) => setAgentTask(e.target.value)}
                  rows={6}
                  placeholder={
                    lang === 'uz'
                      ? "Masalan: 30 soniyalik qahvaxona reklamasi, yoki tayyor matn / yo'riqnomani joylang — agent janr, variantlar soni va pauzalarni o'zi belgilaydi..."
                      : 'Опишите задачу своими словами (например, реклама, монолог с паузами 1–3с) или вставьте готовый текст / процедуру — агент сам выберет формат, число вариантов и паузы...'
                  }
                  className="w-full rounded-2xl border border-[rgba(22,21,17,0.16)] bg-[#FAF8F4] p-3.5 text-sm text-[#161511] leading-relaxed focus:outline-none focus:border-[#0E7C86] transition-colors resize-y"
                />

                {isAgentTaskTooLong && (
                  <div className="rounded-xl bg-amber-50 border border-amber-300 px-3.5 py-2 text-xs text-amber-950 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                    <span>
                      {lang === 'uz'
                        ? `Matnni qismlarga bo'ling (maksimum ${MAX_AGENT_WORDS.toLocaleString()} so'z, hozir ${agentTaskStats.words.toLocaleString()}).`
                        : `Разбейте текст на части (максимум ${MAX_AGENT_WORDS.toLocaleString()} слов, сейчас ${agentTaskStats.words.toLocaleString()}).`}
                    </span>
                  </div>
                )}
              </div>

              {/* Footer: счетчик слов и единственная кнопка «Предложить варианты» */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span
                  className={`text-xs font-mono tabular-nums ${
                    isAgentTaskTooLong ? 'text-amber-700 font-semibold' : 'text-[#5D594E]'
                  }`}
                >
                  {agentTaskStats.words.toLocaleString()} / {MAX_AGENT_WORDS.toLocaleString()}{' '}
                  {lang === 'uz' ? "so'z" : 'слов'}
                </span>

                <button
                  type="button"
                  onClick={() => handleProposeVariants()}
                  disabled={!agentTask.trim() || isProposing || isAgentTaskTooLong}
                  className="btn-pill btn-solid px-5 py-2.5 text-xs sm:text-sm font-semibold flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <Wand2 className="w-4 h-4" />
                  <span>
                    {isProposing
                      ? `${lang === 'uz' ? 'Tayyorlanmoqda' : 'Думаю…'} ${agentScriptCountdown.progressPercent}%`
                      : lang === 'uz'
                        ? 'Variantlarni taklif qilish'
                        : 'Предложить варианты'}
                  </span>
                </button>
              </div>

              {/* Единственный уточняющий вопрос (если в задаче нет сути) */}
              {clarifyingQuestion && (
                <div className="rounded-2xl border border-[#0E7C86]/40 bg-[rgba(14,124,134,0.06)] p-4 space-y-3">
                  <div className="text-xs font-semibold text-[#0A5A62]">
                    {clarifyingQuestion}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={clarificationAnswer}
                      onChange={(e) => setClarificationAnswer(e.target.value)}
                      placeholder={
                        lang === 'uz' ? 'Javobingizni yozing...' : 'Напишите уточнение...'
                      }
                      className="flex-1 rounded-xl border border-[rgba(22,21,17,0.16)] bg-white px-3 py-2 text-xs text-[#161511] focus:outline-none focus:border-[#0E7C86]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!clarificationAnswer.trim()) return;
                        const combined = `${agentTask.trim()}. ${clarificationAnswer.trim()}`;
                        setAgentTask(combined);
                        setClarificationAnswer('');
                        handleProposeVariants(combined);
                      }}
                      className="btn-pill btn-solid text-xs px-4 py-2 cursor-pointer whitespace-nowrap"
                    >
                      {lang === 'uz' ? 'Davom etish' : 'Отправить'}
                    </button>
                  </div>
                </div>
              )}

              {/* Решение агента (reasonShort) над карточками — Раздел 1.4 */}
              {proposals.length > 0 && agentDecision?.reasonShort && (
                <div className="rounded-xl bg-[rgba(14,124,134,0.08)] border border-[#0E7C86]/25 px-4 py-2.5 text-xs text-[#0A5A62] flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-[#0E7C86] shrink-0" />
                  <span className="font-medium">{agentDecision.reasonShort}</span>
                </div>
              )}

              {/* Карточки вариантов (режиссёр предлагает выбор «так, так или так») */}
              {proposals.length > 0 && (
                <div className="grid grid-cols-1 gap-4 pt-1">
                  {proposals.map((prop) => {
                    const isRefineOpen = openRefineId === prop.id;
                    const isRefiningThis = refiningProposalId === prop.id;
                    const isEditingThis = editingProposalId === prop.id;
                    const liveMetrics = computeClientScriptMetrics(prop.text, speed);
                    const estCalls = estimateTtsCallsForText(prop.text);
                    const cardSelectionId = resolveEffectiveCardSelection(prop);
                    const cardCharacter = characterVoices.find((c) => c.id === cardSelectionId);
                    const cardVoice = cardCharacter
                      ? undefined
                      : voices.find((v) => v.id === cardSelectionId) || activeVoice;
                    const recommendedCharacter = prop.characterVoiceId
                      ? characterVoices.find((c) => c.id === prop.characterVoiceId)
                      : undefined;
                    const recommendedVoice = !recommendedCharacter
                      ? voices.find((v) => v.id === prop.recommendedVoiceId)
                      : undefined;
                    const showRecCharacterSuggestion =
                      Boolean(recommendedCharacter) &&
                      recommendedCharacter!.id !== cardSelectionId;
                    const showRecAdultSuggestion =
                      !recommendedCharacter &&
                      Boolean(recommendedVoice) &&
                      recommendedVoice!.id !== cardSelectionId;

                    return (
                      <div
                        key={prop.id}
                        className="rounded-2xl border border-[rgba(22,21,17,0.14)] bg-[#FAF8F4] p-4 sm:p-5 space-y-3.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <h3 className="text-sm sm:text-base font-bold text-[#161511]">
                              {prop.title}
                            </h3>
                            <div className="text-[11px] text-[#5D594E] font-mono tabular-nums mt-0.5 flex flex-wrap items-center gap-1.5">
                              <span>{prop.badge}</span>
                              {cardCharacter && (
                                <>
                                  <span>·</span>
                                  <span className="font-semibold text-[#0E7C86]">
                                    {lang === 'uz' ? cardCharacter.nameUz : cardCharacter.nameRu} (
                                    {formatCharacterRoleLabel(cardCharacter.role)})
                                  </span>
                                </>
                              )}
                              <span>·</span>
                              <span className="font-semibold text-[#161511]">
                                {liveMetrics.words.toLocaleString()} {lang === 'uz' ? "so'z" : 'слов'}
                              </span>
                              {liveMetrics.pauseSeconds > 0 && (
                                <>
                                  <span>·</span>
                                  <span className="text-[#0E7C86] font-semibold">
                                    +{liveMetrics.pauseSeconds}s {lang === 'uz' ? 'pauza' : 'пауз'}
                                  </span>
                                </>
                              )}
                              <span>·</span>
                              <span className="font-semibold text-[#0A5A62]">
                                ≈ {formatDurationHuman(liveMetrics.estSeconds, lang)} ({liveMetrics.estSeconds}s)
                              </span>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              setEditingProposalId(isEditingThis ? null : prop.id)
                            }
                            className="px-3 py-1 rounded-lg border border-[rgba(22,21,17,0.14)] bg-white hover:border-[#0E7C86] text-xs font-medium text-[#161511] flex items-center gap-1.5 cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5 text-[#0E7C86]" />
                            <span>
                              {isEditingThis
                                ? lang === 'uz'
                                  ? 'Tayyor'
                                  : 'Готово'
                                : lang === 'uz'
                                  ? 'Tahrirlash'
                                  : 'Править'}
                            </span>
                          </button>
                        </div>

                        {/* Timed / Multi-Beat Directorial Timeline (never spoken aloud — guides acting only) */}
                        {prop.segments && prop.segments.length > 1 && (
                          <div className="rounded-xl bg-[rgba(14,124,134,0.06)] border border-[#0E7C86]/20 px-3 py-2 space-y-1">
                            <div className="text-[10px] font-mono uppercase tracking-wider text-[#0A5A62] font-semibold">
                              {lang === 'uz'
                                ? 'Rejissura bo‘yicha bosqichlar (ovozda o‘qilmaydi, faqat intonatsiyani boshqaradi)'
                                : 'Режиссура подачи по этапам (вслух не читается — управляет только живой интонацией)'}
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {prop.segments.map((seg, sIdx) => (
                                <span
                                  key={sIdx}
                                  className="inline-flex items-center gap-1 text-[11px] bg-white/90 border border-[#0E7C86]/20 rounded-lg px-2 py-0.5 text-[#161511]"
                                  title={seg.style}
                                >
                                  {seg.timecode && (
                                    <span className="font-mono font-semibold text-[#0E7C86]">
                                      {seg.timecode}
                                    </span>
                                  )}
                                  <span className="truncate max-w-[220px] text-[#5D594E]">
                                    {seg.style}
                                  </span>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Pure Spoken Script Text: Editable Textarea OR Highlighted Preview */}
                        {isEditingThis ? (
                          <textarea
                            value={prop.text}
                            onChange={(e) =>
                              handleUpdateProposalTextInPlace(prop.id, e.target.value)
                            }
                            rows={8}
                            className="w-full rounded-xl border border-[#0E7C86] bg-white p-3.5 text-sm text-[#161511] leading-relaxed focus:outline-none resize-y"
                          />
                        ) : (
                          <div className="text-sm text-[#161511] leading-relaxed whitespace-pre-wrap bg-white rounded-xl p-3.5 border border-[rgba(22,21,17,0.08)] max-h-[420px] overflow-y-auto">
                            {renderHighlightedPlaceholders(prop.text)}
                          </div>
                        )}

                        {prop.reason && (
                          <p className="text-[11px] text-[#5D594E]">
                            {prop.reason}
                          </p>
                        )}

                        {/* Inline Voice / Character Picker + Preview directly on every Agent card */}
                        <div className="flex flex-wrap items-center gap-2 bg-white/85 border border-[rgba(22,21,17,0.1)] rounded-xl px-3 py-2">
                          <span className="text-[11px] font-semibold text-[#5D594E] whitespace-nowrap">
                            {cardCharacter
                              ? lang === 'uz'
                                ? 'Qahramon:'
                                : 'Персонаж:'
                              : lang === 'uz'
                                ? 'Ovoz:'
                                : 'Голос:'}
                          </span>
                          <select
                            value={cardSelectionId}
                            onChange={(e) => {
                              const nextId = e.target.value;
                              const nextChar = characterVoices.find((c) => c.id === nextId);
                              setVoiceOverrideByProposalId((prev) => ({
                                ...prev,
                                [prop.id]: nextId,
                              }));
                              if (nextChar) {
                                setSelectedCharacterVoiceId(nextChar.id);
                              } else {
                                setSelectedCharacterVoiceId(null);
                                onSelectVoiceId(nextId);
                              }
                              setUserExplicitlyPickedVoice(true);
                            }}
                            className="flex-1 min-w-[190px] max-w-xs rounded-lg border border-[rgba(22,21,17,0.14)] bg-[#FAF8F4] px-2.5 py-1 text-xs font-medium text-[#161511] focus:outline-none focus:border-[#0E7C86] cursor-pointer"
                          >
                            {characterVoices.length > 0 && (
                              <optgroup
                                label={
                                  lang === 'uz'
                                    ? 'Multfilm qahramonlari'
                                    : 'Персонажи мультфильмов'
                                }
                              >
                                {characterVoices.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {lang === 'uz' ? c.nameUz : c.nameRu} · {c.temperament}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            <optgroup
                              label={lang === 'uz' ? 'Asosiy ovozlar' : 'Стандартные голоса'}
                            >
                              {voices.map((v) => {
                                const isCloned = Boolean(
                                  v.isReplicatedVoice || v.isUserCustomVoice
                                );
                                return (
                                  <option key={v.id} value={v.id}>
                                    {v.name}{' '}
                                    {isCloned
                                      ? lang === 'uz'
                                        ? '(Klon)'
                                        : '(Клон)'
                                      : `(${v.baseVoice})`}
                                  </option>
                                );
                              })}
                            </optgroup>
                          </select>

                          {cardCharacter ? (
                            <button
                              type="button"
                              onClick={() => handleToggleCharacterPreview(cardCharacter)}
                              className="w-7 h-7 rounded-lg bg-[#FAF8F4] border border-[rgba(22,21,17,0.14)] flex items-center justify-center text-[#0E7C86] hover:bg-[#0E7C86] hover:text-white transition-colors shrink-0 cursor-pointer"
                              title={
                                lang === 'uz'
                                  ? 'Qahramon ovozini tinglash'
                                  : 'Прослушать персонажа'
                              }
                            >
                              {playingPreviewVoiceId === cardCharacter.id ? (
                                <Square className="w-3 h-3 fill-current" />
                              ) : (
                                <Play className="w-3 h-3 fill-current" />
                              )}
                            </button>
                          ) : cardVoice ? (
                            <button
                              type="button"
                              onClick={() => handleToggleVoicePreview(cardVoice)}
                              className="w-7 h-7 rounded-lg bg-[#FAF8F4] border border-[rgba(22,21,17,0.14)] flex items-center justify-center text-[#0E7C86] hover:bg-[#0E7C86] hover:text-white transition-colors shrink-0 cursor-pointer"
                              title={
                                lang === 'uz' ? 'Ovozni tinglash' : 'Прослушать выбранный голос'
                              }
                            >
                              {playingPreviewVoiceId === cardVoice.id ? (
                                <Square className="w-3 h-3 fill-current" />
                              ) : (
                                <Play className="w-3 h-3 fill-current" />
                              )}
                            </button>
                          ) : null}

                          {showRecCharacterSuggestion && recommendedCharacter && (
                            <button
                              type="button"
                              onClick={() => {
                                setVoiceOverrideByProposalId((prev) => ({
                                  ...prev,
                                  [prop.id]: recommendedCharacter.id,
                                }));
                                setSelectedCharacterVoiceId(recommendedCharacter.id);
                                setUserExplicitlyPickedVoice(true);
                              }}
                              className="text-[11px] px-2 py-1 rounded-lg bg-[rgba(14,124,134,0.1)] text-[#0A5A62] hover:bg-[#0E7C86] hover:text-white transition-colors cursor-pointer whitespace-nowrap"
                            >
                              {lang === 'uz' ? 'AI tavsiyasi:' : 'AI советует:'}{' '}
                              {lang === 'uz'
                                ? recommendedCharacter.nameUz
                                : recommendedCharacter.nameRu}
                            </button>
                          )}

                          {showRecAdultSuggestion && recommendedVoice && (
                            <button
                              type="button"
                              onClick={() => {
                                setVoiceOverrideByProposalId((prev) => ({
                                  ...prev,
                                  [prop.id]: recommendedVoice.id,
                                }));
                                setSelectedCharacterVoiceId(null);
                                onSelectVoiceId(recommendedVoice.id);
                                setUserExplicitlyPickedVoice(true);
                              }}
                              className="text-[11px] px-2 py-1 rounded-lg bg-[rgba(14,124,134,0.1)] text-[#0A5A62] hover:bg-[#0E7C86] hover:text-white transition-colors cursor-pointer whitespace-nowrap"
                            >
                              {lang === 'uz' ? 'AI tavsiyasi:' : 'AI советует:'}{' '}
                              {recommendedVoice.name.split('·')[0].trim()}
                            </button>
                          )}
                        </div>

                        {/* Refine Input Drawer */}
                        {isRefineOpen && (
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <input
                              type="text"
                              value={refineInstructionById[prop.id] || ''}
                              onChange={(e) =>
                                setRefineInstructionById((prev) => ({
                                  ...prev,
                                  [prop.id]: e.target.value,
                                }))
                              }
                              placeholder={
                                lang === 'uz'
                                  ? "Masalan: «har bir gapdan keyin 2 soniya pauza qo'y», «jonliroq qil»..."
                                  : 'Например: «поставь паузы 2 секунды», «сделай живее и теплее», «короче»...'
                              }
                              className="flex-1 min-w-[220px] rounded-xl border border-[rgba(22,21,17,0.16)] bg-white px-3 py-1.5 text-xs text-[#161511] focus:outline-none focus:border-[#0E7C86]"
                            />
                            <button
                              type="button"
                              onClick={() => handleRefineProposal(prop)}
                              disabled={
                                isRefiningThis || !(refineInstructionById[prop.id] || '').trim()
                              }
                              className="btn-pill btn-solid text-xs px-3.5 py-1.5 cursor-pointer disabled:opacity-50 whitespace-nowrap"
                            >
                              {isRefiningThis
                                ? lang === 'uz'
                                  ? 'Yangilanmoqda…'
                                  : 'Доработка…'
                                : lang === 'uz'
                                  ? "Qo'llash"
                                  : 'Применить'}
                            </button>
                          </div>
                        )}

                        {/* Card Actions + Quota Forecast (1.6) */}
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleSpeakProposal(prop)}
                              disabled={isSynthesizingAudio}
                              className="btn-pill btn-solid text-xs px-4 py-2 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                            >
                              <Volume2 className="w-3.5 h-3.5" />
                              <span>
                                {isSynthesizingAudio
                                  ? `${lang === 'uz' ? 'Sintez' : 'Синтез'} ${audioSynthesisCountdown.progressPercent}%`
                                  : "Ozvuchit'"}
                              </span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleOpenProposalInEditor(prop)}
                              className="btn-pill btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                            >
                              <FileText className="w-3.5 h-3.5 text-[#0E7C86]" />
                              <span>
                                {lang === 'uz' ? 'Muharrirda ochish' : 'Открыть в редакторе'}
                              </span>
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                setOpenRefineId(isRefineOpen ? null : prop.id)
                              }
                              className="btn-pill btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                            >
                              <Wand2 className="w-3.5 h-3.5 text-[#0E7C86]" />
                              <span>{lang === 'uz' ? 'Takomillashtirish' : 'Доработать'}</span>
                            </button>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono tabular-nums text-[#5D594E]">
                            {quotaStatus && (
                              <span
                                className={
                                  estCalls > quotaStatus.remaining
                                    ? 'text-amber-700 font-semibold'
                                    : 'text-[#0A5A62]'
                                }
                              >
                                {estCalls > quotaStatus.remaining
                                  ? `⚠ ~${estCalls} выз. (осталось ${quotaStatus.remaining})`
                                  : `Займёт ~${estCalls} выз., осталось ${quotaStatus.remaining}`}
                              </span>
                            )}
                            <span>·</span>
                            <span>
                              {liveMetrics.estCredits} {lang === 'uz' ? 'kredit' : 'кред.'}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Live Writing Studio Waveform during Synthesis (Just like Solo Podcast & 2 Ovozli Intervyu) */}
        {isSynthesizingAudio && (
          <LiveWritingWaveform
            voiceName={activeDisplayVoiceName}
            lang={lang}
            wordCount={activeSynthMetrics.words}
            estimatedAudioSeconds={activeSynthMetrics.estSeconds}
            isSynthesizing={isSynthesizingAudio}
            countdownState={audioSynthesisCountdown}
          />
        )}

        {/* ========================================================= */}
        {/* BOTTOM AUDIO PLAYER WITH WAVEFORM & DOWNLOAD ACTIONS      */}
        {/* ========================================================= */}
        {result && !isSynthesizingAudio && (
          <div className="border border-[rgba(22,21,17,0.14)] rounded-[20px] bg-white p-5 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-[#161511]">
                  {lang === 'uz' ? 'Tayyor audio yozuv' : 'Готовая озвучка'}
                </h3>
                <div className="text-xs font-mono tabular-nums text-[#5D594E] mt-0.5">
                  <span>{lastSynthesizedVoiceName || activeVoice?.name}</span>
                  <span> · </span>
                  <span>
                    {formatDurationHuman(result.durationSeconds, lang)} ({result.durationSeconds} s)
                  </span>
                  <span> · </span>
                  <span>
                    {result.cached
                      ? lang === 'uz'
                        ? 'Keshdan (0 kredit)'
                        : 'Из кэша (0 кредитов)'
                      : `${result.creditsUsed} ${lang === 'uz' ? 'kredit' : 'кред.'}`}
                  </span>
                  {typeof result.ttsCallsUsed === 'number' && (
                    <>
                      <span> · </span>
                      <span>
                        {result.ttsCallsUsed === 0
                          ? '0 вызовов (кэш)'
                          : `${result.ttsCallsUsed} выз. TTS (${result.provider})`}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Export & Save Buttons (Authenticated Blob Downloads — 100% reliable) */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleDownloadResultAudio('mp3')}
                  disabled={downloadingFormat !== null}
                  className="btn-pill btn-ghost text-xs px-3.5 py-1.5 flex items-center gap-1.5 text-[#161511] cursor-pointer disabled:opacity-50 whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5 text-[#0E7C86]" />
                  <span>
                    {downloadingFormat === 'mp3'
                      ? lang === 'uz'
                        ? 'Yuklanmoqda…'
                        : 'Скачивание…'
                      : lang === 'uz'
                        ? 'MP3 yuklab olish'
                        : 'Скачать MP3'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => handleDownloadResultAudio('wav')}
                  disabled={downloadingFormat !== null}
                  className="btn-pill btn-ghost text-xs px-3.5 py-1.5 flex items-center gap-1.5 text-[#161511] cursor-pointer disabled:opacity-50 whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5 text-[#0E7C86]" />
                  <span>
                    {downloadingFormat === 'wav'
                      ? lang === 'uz'
                        ? 'Yuklanmoqda…'
                        : 'Скачивание…'
                      : lang === 'uz'
                        ? 'WAV yuklab olish'
                        : 'Скачать WAV'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleSaveToMediaLibrary}
                  disabled={savedToCmsSuccess}
                  className="btn-pill btn-solid text-xs px-3.5 py-1.5 flex items-center gap-1.5 cursor-pointer disabled:opacity-60 whitespace-nowrap"
                >
                  {savedToCmsSuccess ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>{lang === 'uz' ? 'Saqlandi' : 'В Медиатеке'}</span>
                    </>
                  ) : (
                    <>
                      <BookmarkPlus className="w-3.5 h-3.5" />
                      <span>{lang === 'uz' ? 'Kutubxonaga' : 'В Медиатеку'}</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Play/Pause + Clickable Seekable Waveform Visualizer */}
            <div className="flex items-center gap-4 bg-[#FAF8F4] rounded-2xl p-3.5 border border-[rgba(22,21,17,0.1)]">
              <button
                type="button"
                disabled={!audioBlobUrl || isLoadingAudioBlob}
                onClick={() => {
                  if (!resultAudioRef.current || !audioBlobUrl) return;
                  if (isPlayingResult) {
                    resultAudioRef.current.pause();
                    setIsPlayingResult(false);
                  } else {
                    resultAudioRef.current
                      .play()
                      .then(() => setIsPlayingResult(true))
                      .catch((err) => {
                        setIsPlayingResult(false);
                        setErrorMessage(
                          lang === 'uz'
                            ? `Audioni ijro etib bo'lmadi: ${err?.message || ''}`
                            : `Не удалось воспроизвести аудио: ${err?.message || 'проверьте звук браузера'}`
                        );
                      });
                  }
                }}
                className="w-11 h-11 rounded-full bg-[#0E7C86] text-white flex items-center justify-center shrink-0 hover:bg-[#0A5A62] transition-colors cursor-pointer disabled:opacity-50"
                aria-label={isPlayingResult ? 'Pause' : 'Play'}
              >
                {isPlayingResult ? (
                  <Pause className="w-4 h-4 fill-current" />
                ) : (
                  <Play className="w-4 h-4 fill-current ml-0.5" />
                )}
              </button>

              {/* Clickable Seekable Waveform Bars */}
              <div
                className="flex-1 flex items-center gap-[3px] h-10 cursor-pointer"
                onClick={(e) => {
                  if (!resultAudioRef.current || !audioBlobUrl) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                  const dur =
                    resultAudioRef.current.duration && isFinite(resultAudioRef.current.duration)
                      ? resultAudioRef.current.duration
                      : result.durationSeconds;
                  if (dur > 0) {
                    resultAudioRef.current.currentTime = ratio * dur;
                    setCurrentTimeSec(ratio * dur);
                  }
                }}
              >
                {Array.from({ length: 48 }).map((_, i) => {
                  const audioDur =
                    resultAudioRef.current?.duration && isFinite(resultAudioRef.current.duration)
                      ? resultAudioRef.current.duration
                      : result.durationSeconds;
                  const progressRatio = audioDur > 0 ? currentTimeSec / audioDur : 0;
                  const barRatio = i / 48;
                  const h =
                    22 +
                    68 *
                      Math.abs(
                        Math.sin(i * 0.65) + 0.35 * Math.cos(i * 0.27 + 1.4)
                      );
                  return (
                    <span
                      key={i}
                      className={`flex-1 rounded-sm transition-colors duration-150 ${
                        barRatio <= progressRatio
                          ? 'bg-[#0E7C86]'
                          : 'bg-[rgba(14,124,134,0.25)]'
                      }`}
                      style={{ height: `${Math.min(100, Math.round(h))}%` }}
                    />
                  );
                })}
              </div>

              <span className="text-xs font-mono tabular-nums text-[#161511] shrink-0">
                {isLoadingAudioBlob
                  ? lang === 'uz'
                    ? 'Yuklanmoqda…'
                    : 'Загрузка…'
                  : `${currentTimeSec.toFixed(1)}s / ${result.durationSeconds.toFixed(1)}s`}
              </span>

              {audioBlobUrl && (
                <audio
                  ref={resultAudioRef}
                  src={audioBlobUrl}
                  preload="auto"
                  onTimeUpdate={(e) =>
                    setCurrentTimeSec((e.target as HTMLAudioElement).currentTime)
                  }
                  onEnded={() => {
                    setIsPlayingResult(false);
                    setCurrentTimeSec(0);
                  }}
                  onPause={() => setIsPlayingResult(false)}
                  onPlay={() => setIsPlayingResult(true)}
                  className="hidden"
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* ========================================================= */}
      {/* RIGHT CONSOLE (~30%) — STRICTLY 5 SETTINGS (NO TIMBRE)    */}
      {/* ========================================================= */}
      <aside className="w-full lg:w-[30%] shrink-0 space-y-4">
        <div className="border border-[rgba(22,21,17,0.14)] rounded-[20px] bg-white/85 backdrop-blur-md p-5 space-y-5 shadow-xs">
          <div className="text-xs font-mono uppercase tracking-wider text-[#0A5A62] border-b border-[rgba(22,21,17,0.1)] pb-2.5">
            {lang === 'uz' ? 'Ovoz va Uslub Sozlamalari' : 'Настройки озвучки'}
          </div>

          {/* 1. Голос: стандартные дикторы + группа «Multfilm qahramonlari / Персонажи мультфильмов» */}
          <div className="space-y-3">
            <label className="block text-xs font-semibold text-[#161511]">
              1. {lang === 'uz' ? 'Ovoz' : 'Голос'}
            </label>
            <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
              {voices.map((v) => {
                const isSelected = !selectedCharacterVoiceId && v.id === selectedVoiceId;
                const isPreviewing = playingPreviewVoiceId === v.id;
                const isCloned = Boolean(v.isReplicatedVoice || v.isUserCustomVoice);

                return (
                  <div
                    key={v.id}
                    onClick={() => {
                      setSelectedCharacterVoiceId(null);
                      onSelectVoiceId(v.id);
                      setUserExplicitlyPickedVoice(true);
                    }}
                    className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-xs transition-all cursor-pointer ${
                      isSelected
                        ? 'border-[#0E7C86] bg-[rgba(14,124,134,0.1)] text-[#161511] font-semibold'
                        : 'border-[rgba(22,21,17,0.1)] bg-[#FAF8F4] text-[#5D594E] hover:text-[#161511]'
                    }`}
                  >
                    <div className="truncate flex-1 min-w-0">
                      <span className="block truncate text-[#161511]">{v.name}</span>
                      <span className="text-[10px] font-mono text-[#5D594E]">
                        {isCloned
                          ? lang === 'uz'
                            ? 'Shaxsiy klon ovoz'
                            : 'Клонированный голос'
                          : v.baseVoice}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleVoicePreview(v);
                      }}
                      className="w-7 h-7 rounded-lg bg-white border border-[rgba(22,21,17,0.14)] flex items-center justify-center text-[#0E7C86] hover:bg-[#0E7C86] hover:text-white transition-colors shrink-0 cursor-pointer"
                      title={lang === 'uz' ? 'Tinglash' : 'Прослушать голос'}
                    >
                      {isPreviewing ? (
                        <Square className="w-3 h-3 fill-current" />
                      ) : (
                        <Play className="w-3 h-3 fill-current" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Группа «Multfilm qahramonlari / Персонажи мультфильмов» со статическими превью (0 токенов) */}
            {characterVoices.length > 0 && (
              <div className="pt-2.5 border-t border-[rgba(22,21,17,0.1)] space-y-2">
                <div className="text-[11px] font-mono uppercase tracking-wider text-[#0A5A62] font-semibold">
                  {lang === 'uz' ? 'Multfilm qahramonlari' : 'Персонажи мультфильмов'}
                </div>
                <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
                  {characterVoices.map((charVoice) => {
                    const isSelected = selectedCharacterVoiceId === charVoice.id;
                    const isPreviewing = playingPreviewVoiceId === charVoice.id;
                    return (
                      <div
                        key={charVoice.id}
                        onClick={() => {
                          setSelectedCharacterVoiceId(charVoice.id);
                          setUserExplicitlyPickedVoice(true);
                        }}
                        className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-xs transition-all cursor-pointer ${
                          isSelected
                            ? 'border-[#0E7C86] bg-[rgba(14,124,134,0.1)] text-[#161511] font-semibold'
                            : 'border-[rgba(22,21,17,0.1)] bg-[#FAF8F4] text-[#5D594E] hover:text-[#161511]'
                        }`}
                      >
                        <div className="truncate flex-1 min-w-0">
                          <span className="block truncate text-[#161511]">
                            {lang === 'uz' ? charVoice.nameUz : charVoice.nameRu}
                          </span>
                          <span className="text-[10px] font-mono text-[#5D594E]">
                            {formatCharacterRoleLabel(charVoice.role)} · {charVoice.temperament}
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleCharacterPreview(charVoice);
                          }}
                          className="w-7 h-7 rounded-lg bg-white border border-[rgba(22,21,17,0.14)] flex items-center justify-center text-[#0E7C86] hover:bg-[#0E7C86] hover:text-white transition-colors shrink-0 cursor-pointer"
                          title={lang === 'uz' ? 'Prevyuni tinglash' : 'Прослушать превью'}
                        >
                          {isPreviewing ? (
                            <Square className="w-3 h-3 fill-current" />
                          ) : (
                            <Play className="w-3 h-3 fill-current" />
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* 2. Язык озвучки: O'zbek (по умолчанию) / Русский / English */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-[#161511]">
              2. {lang === 'uz' ? 'Ovozlashtirish tili' : 'Язык озвучки'}
            </label>
            <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-[#ECE7DB] border border-[rgba(22,21,17,0.12)]">
              {(
                [
                  { code: 'uz', label: "O'zbek" },
                  { code: 'ru', label: 'Русский' },
                  { code: 'en', label: 'English' },
                ] as const
              ).map((item) => (
                <button
                  key={item.code}
                  type="button"
                  onClick={() => {
                    setTargetLang(item.code);
                    setTranslationBannerText(null);
                    setLastTranslatedSnapshot(null);
                  }}
                  className={`py-1.5 px-2 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    targetLang === item.code
                      ? 'bg-white text-[#161511] font-semibold shadow-xs'
                      : 'text-[#5D594E] hover:text-[#161511]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* 3. Подача: Авто (по умолчанию) / Разговорная / Уверенная / Энергичная / Тёплая */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-[#161511]">
              3. {lang === 'uz' ? 'Ovoz uzatish uslubi (Подача)' : 'Подача'}
            </label>
            <div className="grid grid-cols-1 gap-1.5">
              {(
                [
                  {
                    id: 'auto',
                    labelUz: 'Avto (AI o‘zi aniqlaydi)',
                    labelRu: 'Авто (по умолчанию)',
                  },
                  {
                    id: 'conversational',
                    labelUz: 'Suhbatdosh (Разговорная)',
                    labelRu: 'Разговорная',
                  },
                  {
                    id: 'confident',
                    labelUz: 'Ishonchli (Уверенная)',
                    labelRu: 'Уверенная',
                  },
                  {
                    id: 'energetic',
                    labelUz: "Jo'shqin (Энергичная)",
                    labelRu: 'Энергичная',
                  },
                  {
                    id: 'warm',
                    labelUz: 'Iliq va samimiy (Тёплая)',
                    labelRu: 'Тёплая',
                  },
                ] as const
              ).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPreset(p.id)}
                  className={`text-left px-3 py-2 rounded-xl border text-xs transition-all cursor-pointer ${
                    preset === p.id
                      ? 'border-[#0E7C86] bg-[rgba(14,124,134,0.1)] text-[#161511] font-semibold'
                      : 'border-[rgba(22,21,17,0.1)] bg-[#FAF8F4] text-[#5D594E] hover:text-[#161511]'
                  }`}
                >
                  {lang === 'uz' ? p.labelUz : p.labelRu}
                </button>
              ))}
            </div>
          </div>

          {/* 4. Темп: ползунок 0,9x – 1,15x, по умолчанию 1,0x */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <label className="font-semibold text-[#161511]">
                4. {lang === 'uz' ? 'Nutq sur’ati (Темп)' : 'Темп речи'}
              </label>
              <span className="font-mono tabular-nums font-semibold text-[#0A5A62]">
                {speed.toFixed(2).replace('.', ',')}x
              </span>
            </div>
            <input
              type="range"
              min={0.9}
              max={1.15}
              step={0.05}
              value={speed}
              onChange={(e) => setSpeed(parseFloat(e.target.value))}
              className="w-full accent-[#0E7C86] cursor-pointer"
            />
            <div className="flex justify-between text-[10px] font-mono tabular-nums text-[#5D594E]">
              <span>0,9x</span>
              <span>1,0x</span>
              <span>1,15x</span>
            </div>
          </div>

          {/* 5. «Не переводить»: галочка, появляется ТОЛЬКО когда язык текста не совпадает с языком озвучки */}
          {showDoNotTranslateCheckbox && (
            <div className="pt-2 border-t border-[rgba(22,21,17,0.1)]">
              <label className="flex items-center gap-2.5 text-xs text-[#161511] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={doNotTranslate}
                  onChange={(e) => setDoNotTranslate(e.target.checked)}
                  className="w-4 h-4 rounded accent-[#0E7C86] cursor-pointer"
                />
                <span>
                  {lang === 'uz'
                    ? 'Tarjima qilinmasin (asl tilda o‘qish)'
                    : 'Не переводить'}
                </span>
              </label>
            </div>
          )}
          {/* 18+ Adult Creator Studio Notice (Google API Terms compliance) */}
          <div className="pt-2.5 border-t border-[rgba(22,21,17,0.08)] text-[10px] leading-relaxed text-[#5D594E]">
            {lang === 'uz'
              ? '18+ · Kattalar (animatorlar, kontent mualliflari va dublyaj studiyalari) uchun ovozlashtirish vositasi.'
              : '18+ · Инструмент озвучки для взрослых создателей контента, аниматоров и студий дубляжа.'}
          </div>
        </div>
      </aside>
    </div>
  );
};
