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
  Sliders,
  ChevronDown,
  ChevronUp,
  FileText,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { authFetch, getCurrentIdToken } from '../utils/authFetch';
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
  TtsMode,
  TtsLanguage,
  TtsPreset,
  TtsProcessingStage,
  TtsAgentProposal,
  TtsSynthesisResult,
  TtsAgentOutputMode,
  TtsAgentWorkflowMode,
  TtsPauseCadence,
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

const MAX_STUDIO_CHARS = 65000; // ~10 000 слов

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

const AGENT_TEMPLATES: Array<{
  id: string;
  labelUz: string;
  labelRu: string;
  promptUz: string;
  promptRu: string;
  duration: number; // 0 = Авто / Без ограничений
  outputMode: TtsAgentOutputMode;
  workflowMode: TtsAgentWorkflowMode;
  pauseCadence: TtsPauseCadence;
}> = [
  {
    id: 'monologue_story',
    labelUz: 'Katta monolog / Hikoya (1-2-3s pauza)',
    labelRu: 'Большой монолог / Рассказ (с паузами 1–2–3с)',
    promptUz:
      "Inson qalbi, muvaffaqiyat va sabr haqida ta'sirli, chuqur badiiy monolog-hikoya yozing. Har bir tugallangan fikr va xatboshi orasiga [pauza 1s], [pauza 2s], [pauza 3s] pauzalarini qo'ying.",
    promptRu:
      'Напиши глубокий, живой авторский монолог-рассказ о пути к цели, внутреннем спокойствии и силе решений. Между непрерывными фразами и абзацами расставь студийные паузы [pauza 1s], [pauza 2s], [pauza 3s].',
    duration: 180,
    outputMode: 'single_monologue',
    workflowMode: 'expand_monologue',
    pauseCadence: '1_2_3s',
  },
  {
    id: 'full_procedure',
    labelUz: 'Jarayon / Reglament (10 000 so‘zgacha)',
    labelRu: 'Вся процедура / Регламент (с паузами 1–3с)',
    promptUz:
      "Mijozlarga xizmat ko'rsatish va buyurtmani qabul qilish bo'yicha to'liq bosqichma-bosqich jarayon (procedura). Har bir qadamdan keyin [pauza 2s] va bo'limlar orasida [pauza 3s] qo'ying.",
    promptRu:
      'Полная пошаговая процедура проведения рабочего процесса и инструктажа от начала до конца. Между шагами ставь точные паузы [pauza 1s], [pauza 2s], [pauza 3s], чтобы слушатель успевал воспринимать каждый этап.',
    duration: 0,
    outputMode: 'single_monologue',
    workflowMode: 'format_procedure',
    pauseCadence: '1_2_3s',
  },
  {
    id: 'ad',
    labelUz: 'Reklama',
    labelRu: 'Реклама',
    promptUz:
      "Toshkentdagi yangi qahvaxona uchun 20% chegirma haqida qisqa va jalb qiluvchi audio reklama.",
    promptRu:
      'Яркий рекламный ролик для новой кофейни в Ташкенте: скидка 20% на всё меню утреннего кофе, живой разговорный заход.',
    duration: 30,
    outputMode: 'three_variants',
    workflowMode: 'create',
    pauseCadence: 'auto',
  },
  {
    id: 'announcement',
    labelUz: "E'lon",
    labelRu: 'Объявление',
    promptUz:
      "Savdo markazi mijozlari uchun rasmiy e'lon: do'konimiz har kuni soat 09:00 dan 22:00 gacha ishlaydi.",
    promptRu:
      'Информационное голосовое объявление для посетителей торгового центра о графике работы с 09:00 до 22:00 и акциях на 2-м этаже.',
    duration: 30,
    outputMode: 'single_monologue',
    workflowMode: 'create',
    pauseCadence: '1s',
  },
  {
    id: 'greeting',
    labelUz: 'Tabrik',
    labelRu: 'Поздравление',
    promptUz:
      'Hamkorlar va mijozlarni bayram bilan samimiy va iliq ohangda tabriklash nutqi.',
    promptRu:
      'Тёплое душевное поздравление с днём рождения или праздником для близкого человека или коллектива компании.',
    duration: 60,
    outputMode: 'single_monologue',
    workflowMode: 'create',
    pauseCadence: '1_2_3s',
  },
  {
    id: 'instruction',
    labelUz: "Yo'riqnoma",
    labelRu: 'Инструкция',
    promptUz:
      "Mobil ilovada ro'yxatdan o'tish va buyurtma berish bo'yicha tushunarli ovozli yo'riqnoma, har bir qadam orasida [pauza 2s] bo'lsin.",
    promptRu:
      'Пошаговая голосовая инструкция: как оформить заказ в приложении, с паузами [pauza 2s] между шагами.',
    duration: 60,
    outputMode: 'single_monologue',
    workflowMode: 'create',
    pauseCadence: '1_2_3s',
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

  // Agent Mode State
  const [agentTask, setAgentTask] = useState<string>('');
  const agentTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  // 0 = Авто (Без ограничения в 60 секунд / до 10 000 слов)
  const [agentDurationSec, setAgentDurationSec] = useState<number>(0);
  const [agentOutputMode, setAgentOutputMode] = useState<TtsAgentOutputMode>('single_monologue');
  const [agentWorkflowMode, setAgentWorkflowMode] = useState<TtsAgentWorkflowMode>('create');
  const [agentPauseCadence, setAgentPauseCadence] = useState<TtsPauseCadence>('1_2_3s');
  const [customSystemRules, setCustomSystemRules] = useState<string>('');
  const [isPromptStudioOpen, setIsPromptStudioOpen] = useState<boolean>(false);

  const [isProposing, setIsProposing] = useState<boolean>(false);
  const [clarifyingQuestion, setClarifyingQuestion] = useState<string | null>(null);
  const [clarificationAnswer, setClarificationAnswer] = useState<string>('');
  const [proposals, setProposals] = useState<TtsAgentProposal[]>([]);
  const [openRefineId, setOpenRefineId] = useState<string | null>(null);
  const [refineInstructionById, setRefineInstructionById] = useState<Record<string, string>>({});
  const [refiningProposalId, setRefiningProposalId] = useState<string | null>(null);
  const [editingProposalId, setEditingProposalId] = useState<string | null>(null);

  // Processing & Synthesis Result State
  const [stage, setStage] = useState<TtsProcessingStage>('idle');
  const [activeSynthesisText, setActiveSynthesisText] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [placeholderWarning, setPlaceholderWarning] = useState<string[] | null>(null);
  const [result, setResult] = useState<TtsSynthesisResult | null>(null);
  const [savedToCmsSuccess, setSavedToCmsSuccess] = useState<boolean>(false);

  // Audio Player State
  const [isPlayingResult, setIsPlayingResult] = useState<boolean>(false);
  const [currentTimeSec, setCurrentTimeSec] = useState<number>(0);
  const [authenticatedAudioUrl, setAuthenticatedAudioUrl] = useState<string>('');
  const [authenticatedMp3Url, setAuthenticatedMp3Url] = useState<string>('');
  const resultAudioRef = useRef<HTMLAudioElement | null>(null);

  const activeVoice = useMemo(
    () => voices.find((v) => v.id === selectedVoiceId) || voices[0],
    [voices, selectedVoiceId]
  );

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
    if (agentDurationSec >= 180 || agentTaskStats.words > 250) return 14;
    if (agentDurationSec === 0) return 11;
    return 8;
  }, [agentDurationSec, agentTaskStats.words]);
  const agentScriptCountdown = useGenerationCountdown(
    isAgentWorking,
    estimatedAgentGenSeconds,
    lang,
    'script_solo'
  );

  // Attach token to audio URLs when result changes
  useEffect(() => {
    let active = true;
    if (!result) {
      setAuthenticatedAudioUrl('');
      setAuthenticatedMp3Url('');
      return;
    }
    getCurrentIdToken().then((token: string | null) => {
      if (!active) return;
      const tParam = token ? `&token=${encodeURIComponent(token)}` : '';
      setAuthenticatedAudioUrl(`${result.audioUrl}${tParam}`);
      setAuthenticatedMp3Url(`${result.mp3Url}${tParam}`);
    });
    return () => {
      active = false;
    };
  }, [result]);

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

  // Insert pause or vocal tag into Agent Task Textarea
  const insertTagIntoAgentTask = (tag: string) => {
    const el = agentTextareaRef.current;
    if (!el) {
      setAgentTask((prev) => `${prev.trim()} ${tag} `.slice(0, MAX_STUDIO_CHARS));
      return;
    }
    const start = el.selectionStart ?? agentTask.length;
    const end = el.selectionEnd ?? agentTask.length;
    const before = agentTask.slice(0, start);
    const after = agentTask.slice(end);
    const needLeadingSpace = before.length > 0 && !/\s$/.test(before);
    const needTrailingSpace = after.length === 0 || !/^\s/.test(after);
    const insertion = `${needLeadingSpace ? ' ' : ''}${tag}${needTrailingSpace ? ' ' : ''}`;
    const updated = `${before}${insertion}${after}`.slice(0, MAX_STUDIO_CHARS);
    setAgentTask(updated);
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
              wordCount: metrics.words,
              pauseTotalSeconds: metrics.pauseSeconds,
              estimatedSeconds: metrics.estSeconds,
              placeholders,
            }
          : item
      )
    );
  };

  const handleToggleVoicePreview = (voice: VoiceProfile) => {
    if (playingPreviewVoiceId === voice.id) {
      previewAudioRef.current?.pause();
      setPlayingPreviewVoiceId(null);
      return;
    }
    const url =
      voice.sampleAudioUrl ||
      getVoicePreviewUrl(voice.id) ||
      `/audio/previews/${voice.id}.wav`;

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
      .then(() => setPlayingPreviewVoiceId(voice.id))
      .catch(() => setPlayingPreviewVoiceId(null));
  };

  const executeSynthesize = async (params: {
    textToSpeak: string;
    voiceIdToUse: string;
    presetToUse: TtsPreset;
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
      setStage(params.presetToUse === 'auto' ? 'analyzing_intonation' : 'synthesizing');

      const chosenVoice = voices.find((v) => v.id === params.voiceIdToUse);
      const replicatedVoiceConfig = chosenVoice?.isReplicatedVoice
        ? {
            voiceSampleAudio: chosenVoice.sampleAudioUrl,
            consentAudio: (chosenVoice as any).consentAudio,
            voiceConsentSignature: (chosenVoice as any).voiceConsentSignature,
          }
        : undefined;

      const stageTimer =
        params.presetToUse === 'auto'
          ? setTimeout(() => setStage('synthesizing'), 1400)
          : null;

      const res = await authFetch('/api/tts/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: params.textToSpeak,
          voiceId: params.voiceIdToUse,
          language: targetLang,
          preset: params.presetToUse,
          speed,
          replicatedVoiceConfig,
        }),
      });

      if (stageTimer) clearTimeout(stageTimer);

      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data?.message_ru || data?.message || data?.error || 'Ошибка синтеза речи'
        );
      }

      setResult(data);
      setStage('done');
      if (typeof data.creditsRemaining === 'number') {
        syncCredits(data.creditsRemaining);
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
      presetToUse: preset,
    });
  };

  // Agent Mode: Generate Script (1 Full Monologue/Procedure or 3 Variants)
  const handleProposeVariants = async (overrideTask?: string) => {
    if (!requireAuth(() => {}, 'TTS AI Agent')) return;
    const taskToUse = (overrideTask ?? agentTask).trim();
    if (!taskToUse) return;

    setIsProposing(true);
    setErrorMessage(null);
    setPlaceholderWarning(null);
    setClarifyingQuestion(null);

    try {
      const res = await authFetch('/api/tts/agent-propose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: taskToUse,
          durationSec: agentDurationSec,
          language: targetLang,
          voiceId: userExplicitlyPickedVoice ? selectedVoiceId : undefined,
          outputMode: agentOutputMode,
          workflowMode: agentWorkflowMode,
          pauseCadence: agentPauseCadence,
          customSystemRules: customSystemRules.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Ошибка генерации сценария');
      }

      if (data.needsClarification && data.clarifyingQuestion) {
        setClarifyingQuestion(data.clarifyingQuestion);
        setProposals([]);
      } else {
        setClarifyingQuestion(null);
        setProposals(Array.isArray(data.proposals) ? data.proposals : []);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Не удалось получить сценарий от агента');
    } finally {
      setIsProposing(false);
    }
  };

  // Agent Mode: Refine a specific proposal (via custom command or quick AI Director chip)
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
          instruction,
          language: targetLang,
          customSystemRules: customSystemRules.trim() || undefined,
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

  // Agent Mode: Speak a proposal card immediately
  const handleSpeakProposal = async (proposal: TtsAgentProposal) => {
    if (!requireAuth(() => {}, 'TTS Ovozlash')) return;
    const unfilled = findUnfilledPlaceholders(proposal.text);
    if (unfilled.length > 0) {
      setPlaceholderWarning(unfilled);
      return;
    }

    const candidateVoiceId = userExplicitlyPickedVoice
      ? selectedVoiceId
      : voices.some((v) => v.id === proposal.recommendedVoiceId)
        ? proposal.recommendedVoiceId
        : selectedVoiceId;

    const presetToUse = preset !== 'auto' ? preset : proposal.recommendedPreset || 'conversational';

    await executeSynthesize({
      textToSpeak: proposal.text,
      voiceIdToUse: candidateVoiceId,
      presetToUse,
    });
  };

  // Agent Mode: Open proposal in Standard Editor
  const handleOpenProposalInEditor = (proposal: TtsAgentProposal) => {
    setText(proposal.text);
    setLastTranslatedSnapshot(proposal.text);
    setTranslationBannerText(null);
    setPlaceholderWarning(null);
    if (!userExplicitlyPickedVoice && voices.some((v) => v.id === proposal.recommendedVoiceId)) {
      onSelectVoiceId(proposal.recommendedVoiceId);
    }
    setPreset(proposal.recommendedPreset || 'conversational');
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
        voiceName: activeVoice?.name || selectedVoiceId,
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
                ? `${activeVoice?.name || 'OvozStudio'} bilan nutq sintez qilinmoqda`
                : `Студийный синтез речи (${activeVoice?.name || 'OvozStudio'})`
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

              {/* Footer Bar: Character/Word/Pause Counter, Duration & Credit Estimate, and «Ozvuchit'» CTA */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums text-[#5D594E]">
                  <span>
                    {textStats.words.toLocaleString()} / 10 000 {lang === 'uz' ? "so'z" : 'слов'}
                  </span>
                  <span>·</span>
                  <span>
                    {textStats.charCount.toLocaleString()} {lang === 'uz' ? 'belgi' : 'зн.'}
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
                  <span>·</span>
                  <span className="text-[#0A5A62] font-semibold">
                    {textStats.estCredits} {lang === 'uz' ? 'kredit' : 'кред.'}
                  </span>
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
          {/* MODE 2: AI AGENT (DIRECTOR & PROMPT ENGINEERING STUDIO)   */}
          {/* ========================================================= */}
          {mode === 'agent' && (
            <div className="space-y-4">
              {/* Quick Template Buttons */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-mono text-[#5D594E] block">
                  {lang === 'uz' ? 'Tezkor shablonlar va formatlar:' : 'Быстрые сценарии и форматы:'}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {AGENT_TEMPLATES.map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => {
                        setAgentTask(lang === 'uz' ? tpl.promptUz : tpl.promptRu);
                        setAgentDurationSec(tpl.duration);
                        setAgentOutputMode(tpl.outputMode);
                        setAgentWorkflowMode(tpl.workflowMode);
                        setAgentPauseCadence(tpl.pauseCadence);
                      }}
                      className="px-3 py-1.5 rounded-lg border border-[rgba(22,21,17,0.14)] bg-[#F4F1EA] hover:bg-[#ECE7DB] text-xs font-medium text-[#161511] transition-colors cursor-pointer whitespace-nowrap"
                    >
                      {lang === 'uz' ? tpl.labelUz : tpl.labelRu}
                    </button>
                  ))}
                </div>
              </div>

              {/* Agent Controls Row: Workflow Mode, Output Format (1 Full Monologue vs 3 Variants), and Pause Cadence */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 bg-[#F4F1EA] p-3 rounded-2xl border border-[rgba(22,21,17,0.12)]">
                {/* 1. Режим задачи */}
                <div className="space-y-1">
                  <label className="block text-[11px] font-mono text-[#5D594E]">
                    {lang === 'uz' ? '1. Agent vazifasi:' : '1. Режим работы агента:'}
                  </label>
                  <select
                    value={agentWorkflowMode}
                    onChange={(e) => {
                      const val = e.target.value as TtsAgentWorkflowMode;
                      setAgentWorkflowMode(val);
                      if (val === 'format_procedure' || val === 'expand_monologue') {
                        setAgentOutputMode('single_monologue');
                      }
                    }}
                    className="w-full rounded-xl border border-[rgba(22,21,17,0.16)] bg-white px-2.5 py-1.5 text-xs font-medium text-[#161511] focus:outline-none focus:border-[#0E7C86]"
                  >
                    <option value="create">
                      {lang === 'uz'
                        ? 'Mavzu bo‘yicha yangi ssenariy'
                        : 'Создать сценарий по заданию'}
                    </option>
                    <option value="expand_monologue">
                      {lang === 'uz'
                        ? 'Katta monolog / Hikoya (Storitelling)'
                        : 'Большой монолог / Рассказ (Сторителлинг)'}
                    </option>
                    <option value="format_procedure">
                      {lang === 'uz'
                        ? 'Mening jarayonim / matnimni jonlantirish (pauzalar bilan)'
                        : 'Оживить всю мою процедуру / текст (без сокращений)'}
                    </option>
                  </select>
                </div>

                {/* 2. Формат результата: 1 Полный сценарий vs 3 Варианта */}
                <div className="space-y-1">
                  <label className="block text-[11px] font-mono text-[#5D594E]">
                    {lang === 'uz' ? '2. Natija formati:' : '2. Формат результата:'}
                  </label>
                  <select
                    value={agentOutputMode}
                    onChange={(e) => setAgentOutputMode(e.target.value as TtsAgentOutputMode)}
                    className="w-full rounded-xl border border-[rgba(22,21,17,0.16)] bg-white px-2.5 py-1.5 text-xs font-medium text-[#161511] focus:outline-none focus:border-[#0E7C86]"
                  >
                    <option value="single_monologue">
                      {lang === 'uz'
                        ? '1 ta to‘liq ssenariy / monolog (tavsiya etiladi)'
                        : '1 Полный сценарий / Монолог (без дробления)'}
                    </option>
                    <option value="three_variants">
                      {lang === 'uz'
                        ? '3 xil ohang varianti (qisqa reklama uchun)'
                        : '3 Варианта подачи (для коротких роликов)'}
                    </option>
                  </select>
                </div>

                {/* 3. Партитура пауз */}
                <div className="space-y-1">
                  <label className="block text-[11px] font-mono text-[#5D594E]">
                    {lang === 'uz' ? '3. Nutq ichidagi pauzalar:' : '3. Паузы внутри речи:'}
                  </label>
                  <select
                    value={agentPauseCadence}
                    onChange={(e) => setAgentPauseCadence(e.target.value as TtsPauseCadence)}
                    className="w-full rounded-xl border border-[rgba(22,21,17,0.16)] bg-white px-2.5 py-1.5 text-xs font-medium text-[#161511] focus:outline-none focus:border-[#0E7C86]"
                  >
                    <option value="1_2_3s">
                      {lang === 'uz'
                        ? 'Aniq pauzalar: 1s, 2s, 3s (monolog va jarayon uchun)'
                        : 'Чередование пауз 1с, 2с, 3с (для монологов и процедур)'}
                    </option>
                    <option value="1s">
                      {lang === 'uz' ? 'Qisqa pauzalar [pauza 1s]' : 'Короткие паузы по 1 сек'}
                    </option>
                    <option value="auto">
                      {lang === 'uz' ? 'Avto (mazmunga qarab)' : 'Авто (по смыслу текста)'}
                    </option>
                    <option value="none">
                      {lang === 'uz' ? 'Qo‘shimcha pauzasiz' : 'Без тегов пауз'}
                    </option>
                  </select>
                </div>
              </div>

              {/* Task / Procedure Input up to 65 000 characters (~10 000 words) */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="block text-xs font-semibold text-[#161511]">
                    {lang === 'uz'
                      ? 'Vazifa, monolog mavzusi yoki butun jarayon matnini kiriting (10 000 so‘zgacha):'
                      : 'Опишите задачу или вставьте всю процедуру / рассказ (до 10 000 слов):'}
                  </label>

                  {/* Quick pause insertion buttons for Agent Task */}
                  <div className="flex flex-wrap items-center gap-1">
                    {(
                      [
                        { label: '+ [pauza 1s]', tag: '[pauza 1s]' },
                        { label: '+ [pauza 2s]', tag: '[pauza 2s]' },
                        { label: '+ [pauza 3s]', tag: '[pauza 3s]' },
                      ] as const
                    ).map((b) => (
                      <button
                        key={b.tag}
                        type="button"
                        onClick={() => insertTagIntoAgentTask(b.tag)}
                        className="px-2 py-0.5 rounded-md bg-[#F4F1EA] border border-[rgba(22,21,17,0.14)] hover:border-[#0E7C86] text-[10px] font-mono font-semibold text-[#0A5A62] cursor-pointer"
                      >
                        {b.label}
                      </button>
                    ))}
                  </div>
                </div>

                <textarea
                  ref={agentTextareaRef}
                  value={agentTask}
                  onChange={(e) => setAgentTask(e.target.value.slice(0, MAX_STUDIO_CHARS))}
                  rows={6}
                  maxLength={MAX_STUDIO_CHARS}
                  placeholder={
                    lang === 'uz'
                      ? "Masalan: Menga bitta katta hikoya-monolog kerak, har bir fikrdan keyin 1, 2, 3 soniya pauza bo'lsin. Yoki butun jarayon matnini shu yerga tashlang..."
                      : 'Например: Нужен один большой монолог-рассказ, внутри которого между каждой мыслью стоят паузы 1, 2, 3 секунды. Либо вставьте сюда всю процедуру целиком (до 10 000 слов)...'
                  }
                  className="w-full rounded-2xl border border-[rgba(22,21,17,0.16)] bg-[#FAF8F4] p-3.5 text-sm text-[#161511] leading-relaxed focus:outline-none focus:border-[#0E7C86] transition-colors resize-y"
                />
              </div>

              {/* Prompt Engineering Studio Drawer (Custom Rules & Architecture Inspector) */}
              <div className="rounded-2xl border border-[rgba(22,21,17,0.12)] bg-[#FAF8F4] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setIsPromptStudioOpen((prev) => !prev)}
                  className="w-full px-4 py-2.5 flex items-center justify-between text-left text-xs font-semibold text-[#161511] hover:bg-[#ECE7DB]/50 transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <Sliders className="w-3.5 h-3.5 text-[#0E7C86]" />
                    <span>
                      {lang === 'uz'
                        ? 'Prompt-injiniring va AI-Rejissyor qoidalari (ElevenLabs / Hume / Descript darajasi)'
                        : 'Промпт-инжиниринг и правила AI-Режиссёра (уровень ElevenLabs / Hume Octave / Descript)'}
                    </span>
                  </div>
                  {isPromptStudioOpen ? (
                    <ChevronUp className="w-4 h-4 text-[#5D594E]" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-[#5D594E]" />
                  )}
                </button>

                {isPromptStudioOpen && (
                  <div className="p-4 pt-2 border-t border-[rgba(22,21,17,0.08)] space-y-3 text-xs text-[#5D594E]">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[11px]">
                      <div className="p-2.5 rounded-xl bg-white border border-[rgba(22,21,17,0.08)]">
                        <b className="text-[#161511] block mb-1">
                          1. Voice-First Синтагматика (Письмо для уха)
                        </b>
                        Фразы по 7–15 слов на одно дыхание, живые разговорные связки, чистая узбекская латиница без канцелярита.
                      </div>
                      <div className="p-2.5 rounded-xl bg-white border border-[rgba(22,21,17,0.08)]">
                        <b className="text-[#161511] block mb-1">
                          2. Точная хореография пауз (1с / 2с / 3с)
                        </b>
                        Агент расставляет <code className="font-mono text-[#0A5A62]">[pauza 1s]</code>,{' '}
                        <code className="font-mono text-[#0A5A62]">[pauza 2s]</code>,{' '}
                        <code className="font-mono text-[#0A5A62]">[pauza 3s]</code>, которые синтезируются в точную студийную тишину.
                      </div>
                      <div className="p-2.5 rounded-xl bg-white border border-[rgba(22,21,17,0.08)]">
                        <b className="text-[#161511] block mb-1">
                          3. Без потолка в 60 секунд (до 10 000 слов)
                        </b>
                        Полная сохранность длинных процедур, регламентов и рассказов без принудительного обрезания текста.
                      </div>
                      <div className="p-2.5 rounded-xl bg-white border border-[rgba(22,21,17,0.08)]">
                        <b className="text-[#161511] block mb-1">
                          4. Запрет на навязанные «три телефона»
                        </b>
                        Агент никогда не вставляет <code className="font-mono">[telefon]</code> в монологи, рассказы, инструкции и процедуры.
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs font-semibold text-[#161511]">
                        {lang === 'uz'
                          ? 'Qo‘shimcha mualliflik prompt-qoidalaringiz (ixtiyoriy):'
                          : 'Ваши дополнительные инструкции для промпта AI-агента (необязательно):'}
                      </label>
                      <textarea
                        value={customSystemRules}
                        onChange={(e) => setCustomSystemRules(e.target.value)}
                        rows={2}
                        placeholder={
                          lang === 'uz'
                            ? "Masalan: Har bir qadamdan keyin [pauza 2s] qo'y, rasmiy so'zlarni ishlatma, xuddi yaqin do'stdek gapir..."
                            : 'Например: После каждого абзаца обязательно ставь [pauza 2s], обращайся к слушателю на «вы», используй спокойный доверительный тон рассказчика...'
                        }
                        className="w-full rounded-xl border border-[rgba(22,21,17,0.16)] bg-white p-2.5 text-xs text-[#161511] focus:outline-none focus:border-[#0E7C86]"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Flexible Duration Selector (Auto Unlimited / 15s / 30s / 1m / 3m / 5m / 10m) + Generate Button */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-[#5D594E] font-mono">
                    {lang === 'uz' ? 'Davomiyligi:' : 'Длительность:'}
                  </span>
                  <div className="flex flex-wrap gap-1 p-1 rounded-xl bg-[#ECE7DB] border border-[rgba(22,21,17,0.12)] font-mono text-xs tabular-nums">
                    {(
                      [
                        {
                          sec: 0,
                          labelUz: 'Avto (Cheklovsiz / 10 000 so‘z)',
                          labelRu: 'Авто (Без лимита / до 10 000 слов)',
                        },
                        { sec: 15, labelUz: '15 s', labelRu: '15 с' },
                        { sec: 30, labelUz: '30 s', labelRu: '30 с' },
                        { sec: 60, labelUz: '1 daq', labelRu: '1 мин' },
                        { sec: 180, labelUz: '3 daq', labelRu: '3 мин' },
                        { sec: 300, labelUz: '5 daq', labelRu: '5 мин' },
                        { sec: 600, labelUz: '10 daq', labelRu: '10 мин' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.sec}
                        type="button"
                        onClick={() => {
                          setAgentDurationSec(opt.sec);
                          if (opt.sec === 0 || opt.sec > 60) {
                            setAgentOutputMode('single_monologue');
                          }
                        }}
                        className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                          agentDurationSec === opt.sec
                            ? 'bg-white text-[#161511] font-semibold shadow-xs'
                            : 'text-[#5D594E] hover:text-[#161511]'
                        }`}
                      >
                        {lang === 'uz' ? opt.labelUz : opt.labelRu}
                      </button>
                    ))}
                  </div>
                  <span className="text-[11px] font-mono tabular-nums text-[#5D594E]">
                    ({agentTaskStats.words.toLocaleString()} {lang === 'uz' ? "so'z" : 'слов'} ·{' '}
                    {agentTaskStats.charCount.toLocaleString()} / 65 000)
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => handleProposeVariants()}
                  disabled={!agentTask.trim() || isProposing}
                  className="btn-pill btn-solid px-5 py-2.5 text-xs sm:text-sm font-semibold flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  <Wand2 className="w-4 h-4" />
                  <span>
                    {isProposing
                      ? `${lang === 'uz' ? 'Tayyorlanmoqda' : 'Генерация'} ${agentScriptCountdown.progressPercent}%`
                      : agentOutputMode === 'single_monologue'
                        ? lang === 'uz'
                          ? 'To‘liq ssenariy yaratish'
                          : 'Создать полный сценарий'
                        : lang === 'uz'
                          ? '3 ta variant taklif qilish'
                          : 'Предложить 3 варианта'}
                  </span>
                </button>
              </div>

              {/* Single Clarifying Question Box (when task has no subject/essence) */}
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

              {/* Agent Proposal Cards (1 Full Monologue or 3 Variants) with Inline Editing & Pause Toolbar */}
              {proposals.length > 0 && (
                <div className="grid grid-cols-1 gap-4 pt-2">
                  {proposals.map((prop) => {
                    const isRefineOpen = openRefineId === prop.id;
                    const isRefiningThis = refiningProposalId === prop.id;
                    const isEditingThis = editingProposalId === prop.id;
                    const liveMetrics = computeClientScriptMetrics(prop.text, speed);

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
                              <span>·</span>
                              <span>
                                {lang === 'uz' ? 'Uslub:' : 'Подача:'} {prop.recommendedPreset}
                              </span>
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
                                  ? 'Matn va pauzani tahrirlash'
                                  : 'Редактировать текст / паузы'}
                            </span>
                          </button>
                        </div>

                        {/* Quick Pause & AI Director Toolbar directly inside the card */}
                        <div className="flex flex-wrap items-center gap-1.5 bg-white/80 border border-[rgba(22,21,17,0.08)] rounded-xl px-3 py-2">
                          <span className="text-[10px] font-mono text-[#5D594E] mr-1">
                            {lang === 'uz' ? 'Pauza va rejissura:' : 'Паузы и режиссура:'}
                          </span>
                          {(
                            [
                              { label: '+ [pauza 1s]', tag: '[pauza 1s]' },
                              { label: '+ [pauza 2s]', tag: '[pauza 2s]' },
                              { label: '+ [pauza 3s]', tag: '[pauza 3s]' },
                            ] as const
                          ).map((btn) => (
                            <button
                              key={btn.tag}
                              type="button"
                              onClick={() => {
                                handleUpdateProposalTextInPlace(
                                  prop.id,
                                  `${prop.text.trim()} ${btn.tag} `
                                );
                                setEditingProposalId(prop.id);
                              }}
                              className="px-2 py-0.5 rounded-md bg-[#F4F1EA] border border-[rgba(22,21,17,0.14)] hover:border-[#0E7C86] text-[10px] font-mono font-semibold text-[#0A5A62] cursor-pointer"
                            >
                              {btn.label}
                            </button>
                          ))}

                          <button
                            type="button"
                            onClick={() =>
                              handleUpdateProposalTextInPlace(
                                prop.id,
                                autoInsertCadencePausesInText(prop.text)
                              )
                            }
                            className="px-2.5 py-0.5 rounded-md bg-[rgba(14,124,134,0.12)] border border-[#0E7C86]/30 hover:bg-[#0E7C86] hover:text-white text-[10px] font-mono font-semibold text-[#0A5A62] transition-colors cursor-pointer"
                          >
                            {lang === 'uz'
                              ? 'Avto-pauza 1–2–3s qo‘yish'
                              : 'Расставить паузы 1–2–3с'}
                          </button>

                          <button
                            type="button"
                            disabled={isRefiningThis}
                            onClick={() =>
                              handleRefineProposal(
                                prop,
                                'Расширь этот монолог в 2 раза, добавь глубокие примеры, живые переходы и расставь точные паузы [pauza 1s], [pauza 2s], [pauza 3s] между смысловыми частями'
                              )
                            }
                            className="px-2.5 py-0.5 rounded-md bg-[#F4F1EA] border border-[rgba(22,21,17,0.14)] hover:border-[#0E7C86] text-[10px] font-mono text-[#161511] cursor-pointer disabled:opacity-50"
                          >
                            {lang === 'uz' ? '+ Kengaytirish (2x)' : '+ Развернуть подробнее (2x)'}
                          </button>
                        </div>

                        {/* Script Text: Editable Textarea OR Highlighted Preview */}
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
                                  ? "Komanda: «har bir gapdan keyin 2 soniya pauza qo'y», «yanada jonliroq qil», «davomini yoz»..."
                                  : 'Команда: «поставь паузы 1, 2, 3 секунды между абзацами», «сделай длиннее на 3 минуты», «живее»...'
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

                        {/* Card Actions: «Ozvuchit'», «Открыть в редакторе», «Доработать с AI» */}
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
                              <span>{lang === 'uz' ? 'AI bilan ishlov berish' : 'Доработать с AI'}</span>
                            </button>
                          </div>

                          <span className="text-[11px] font-mono tabular-nums text-[#5D594E]">
                            {liveMetrics.estCredits} {lang === 'uz' ? 'kredit' : 'кред.'}
                          </span>
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
            voiceName={activeVoice?.name || 'OvozStudio'}
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
                  <span>{activeVoice?.name}</span>
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
                </div>
              </div>

              {/* Export & Save Buttons */}
              <div className="flex flex-wrap items-center gap-2">
                {authenticatedMp3Url && (
                  <a
                    href={`${authenticatedMp3Url}&download=1`}
                    download={`ovozstudio_${result.id}.mp3`}
                    className="btn-pill btn-ghost text-xs px-3.5 py-1.5 flex items-center gap-1.5 no-underline text-[#161511] whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5 text-[#0E7C86]" />
                    <span>{lang === 'uz' ? 'MP3 yuklab olish' : 'Скачать MP3'}</span>
                  </a>
                )}

                {authenticatedAudioUrl && (
                  <a
                    href={`${authenticatedAudioUrl}&download=1`}
                    download={`ovozstudio_${result.id}.wav`}
                    className="btn-pill btn-ghost text-xs px-3.5 py-1.5 flex items-center gap-1.5 no-underline text-[#161511] whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5 text-[#0E7C86]" />
                    <span>{lang === 'uz' ? 'WAV yuklab olish' : 'Скачать WAV'}</span>
                  </a>
                )}

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

            {/* Play/Pause + Waveform Visualizer */}
            <div className="flex items-center gap-4 bg-[#FAF8F4] rounded-2xl p-3.5 border border-[rgba(22,21,17,0.1)]">
              <button
                type="button"
                onClick={() => {
                  if (!resultAudioRef.current) return;
                  if (isPlayingResult) {
                    resultAudioRef.current.pause();
                    setIsPlayingResult(false);
                  } else {
                    resultAudioRef.current
                      .play()
                      .then(() => setIsPlayingResult(true))
                      .catch(() => setIsPlayingResult(false));
                  }
                }}
                className="w-11 h-11 rounded-full bg-[#0E7C86] text-white flex items-center justify-center shrink-0 hover:bg-[#0A5A62] transition-colors cursor-pointer"
                aria-label={isPlayingResult ? 'Pause' : 'Play'}
              >
                {isPlayingResult ? (
                  <Pause className="w-4 h-4 fill-current" />
                ) : (
                  <Play className="w-4 h-4 fill-current ml-0.5" />
                )}
              </button>

              {/* Waveform Bars */}
              <div className="flex-1 flex items-center gap-[3px] h-10">
                {Array.from({ length: 48 }).map((_, i) => {
                  const progressRatio =
                    result.durationSeconds > 0
                      ? currentTimeSec / result.durationSeconds
                      : 0;
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
                {currentTimeSec.toFixed(1)}s / {result.durationSeconds.toFixed(1)}s
              </span>

              {authenticatedAudioUrl && (
                <audio
                  ref={resultAudioRef}
                  src={authenticatedAudioUrl}
                  onTimeUpdate={(e) =>
                    setCurrentTimeSec((e.target as HTMLAudioElement).currentTime)
                  }
                  onEnded={() => {
                    setIsPlayingResult(false);
                    setCurrentTimeSec(0);
                  }}
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

          {/* 1. Голос: встроенные и клонированные, кнопка ▶ для прослушивания */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-[#161511]">
              1. {lang === 'uz' ? 'Ovoz' : 'Голос'}
            </label>
            <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
              {voices.map((v) => {
                const isSelected = v.id === selectedVoiceId;
                const isPreviewing = playingPreviewVoiceId === v.id;
                const isCloned = Boolean(v.isReplicatedVoice || v.isUserCustomVoice);

                return (
                  <div
                    key={v.id}
                    onClick={() => {
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
        </div>
      </aside>
    </div>
  );
};
