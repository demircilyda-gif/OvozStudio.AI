import React, { useState, useRef, useEffect, useMemo } from 'react';
import { VoiceProfile, DialogueTurn, AmbientSoundscape, SoundCueType, AudioSegmentCue } from '../types/podcast';
import { authFetch } from '../utils/authFetch';
import { getVoicePreviewUrl } from '../data/voicePreviews';
import { AMBIENT_SOUNDSCAPES } from '../data/ambientSoundscapes';
import {
  useGenerationCountdown,
  calculateInterviewDialogueSeconds,
  calculateAiScriptSeconds,
} from '../hooks/useGenerationCountdown';
import {
  GenerationCountdownHUD,
  PreCalculationBadge,
} from './GenerationCountdownHUD';
import {
  generateAmbientAudioBuffer,
  audioBufferToWav,
  getAudioContext,
  mixAudioTracks,
  base64ToArrayBuffer,
  autoPlanPodcastCues,
  stripAllStageConditions,
  detectScriptConditions,
} from '../utils/audioUtils';
import {
  Users2,
  Sparkles,
  Play,
  Pause,
  Download,
  Plus,
  Trash2,
  CheckCircle2,
  Volume2,
  Clock,
  Bot,
  User,
  Upload,
  Save,
  Check,
  Music,
  ShieldCheck,
  Eraser,
  Youtube,
  Video,
  StopCircle,
  RefreshCw,
  AlertCircle,
  FileText,
  Wand2,
  ArrowLeftRight,
  Film,
  Subtitles,
  DollarSign,
  EyeOff,
  FileUp,
  FileDown,
  X,
  Zap,
  Layers,
} from 'lucide-react';
import {
  parseReadyScript,
  exportTurnsToJson,
  exportTurnsToCsv,
  shouldRunVideoAutoAnalysis,
  pickBuiltInVoiceForGender,
  checkSynthesisVoiceWarnings,
  ReadyScriptValidationError,
  ParsedSpeakerInfo,
} from '../utils/readyScriptParser';
import { planDialogueMacroBlocks, planDialogueSubBlocks } from '../utils/dialogueMacroBlocks';
import { stitchDialogueTurnsClient, decodeBase64ToBytes } from '../utils/clientMasterStitcher';
import {
  computeTurnAudioHash,
  buildTurnAudioCacheKey,
  saveDialogueTurnAudioBatch,
  getDialogueTurnAudioByKeys,
  type CachedDialogueTurnAudio,
} from '../utils/db';
import { useAuth } from '../context/AuthContext';
import { YUGAY_BURKHANOV_TURNS, YUGAY_BURKHANOV_METADATA } from '../data/yugayBurkhanovPreset';

const CAR_REVIEW_STORYBOARD_RU = `Спикер 1 (Ж) — Девушка: сидит на переднем пассажирском кресле в белом лонгсливе и солнечных очках (на 02:30 пересаживается на второй ряд). Голос живой, эмоциональный, любопытный.

Спикер 2 (М) — Мужчина: водитель в красной клетчатой рубашке и очках. Голос спокойный, уверенный, экспертный, местами с легкой улыбкой.

Сцена 1. Габариты, комфорт и динамика разгона (00:00 – 00:45)
Фоном играет бодрая фоновая музыка. Камера внутри салона, машина едет по трассе.

00:00 – 00:02 | Девушка (Ж):
Видеоряд: Крупный план сбоку, девушка поворачивается к водителю и жестикулирует левой рукой.
Интонация: С интересом, вопросительно.
Текст: «Ну как она на ходу? Машина-то крупная».

00:02 – 00:09 | Мужчина (М):
Видеоряд: Камера на водителя (00:02–00:05), затем вид с заднего ряда на обоих и экран мультимедиа (00:05–00:07), снова на водителя (00:08).
Интонация: Спокойно, уверенно, небольшая пауза перед словом «понятно».
Текст: «К габаритам привыкаешь за несколько поворотов. Сидишь высоко, дорогу видно хорошо, и управляется... понятно».

00:10 – 00:11 | Мужчина (М):
Видеоряд: Поворачивает голову к девушке, слегка улыбается.
Интонация: Дружелюбно.
Текст: «Лучше скажи, как тебе на пассажирском?»

00:12 – 00:18 | Девушка (Ж):
Видеоряд: Камера на девушку, она опирается рукой на центральный подлокотник, активно жестикулирует, в конце фразы улыбается.
Интонация: Довольно, расслабленно, с легким смешком в конце.
Текст: «Слушай, мне очень свободно. Места с запасом, сиденье мягкое. Сижу, отдыхаю (хе-хе)».

00:19 – 00:26 | Мужчина (М):
Видеоряд: Камера на водителя (00:19–00:21), затем крупный план девушки, которая слушает и кивает (00:22–00:24), снова водитель (00:25).
Интонация: Уверенно, с интригой в конце.
Текст: «Это мы ещё спокойно едем. Сейчас выйдем на свободный участок — покажу, как она ускоряется».

00:26 – 00:27 | Девушка (Ж):
Видеоряд: Быстро поворачивается к водителю с азартом.
Интонация: Коротко, с вызовом и предвкушением.
Текст: «Давай!»

00:27 – 00:31 | Девушка (Ж):
Видеоряд: Машина резко ускоряется, девушку вдавливает в спинку кресла, она эмоционально вскидывает руку и смеется.
Интонация: Восторженно, удивленно, протяжно.
Текст: «Ого-о! Вот это вдавило! Вообще не ожидала такой прыти!»

00:32 – 00:44 | Мужчина (М):
Видеоряд: Водитель спокойно рулит, объясняя техническую часть (00:32–00:37), на экране всплывает плашка «5,4 секунды (0–100 км/ч)» (00:37–00:39), девушка внимательно слушает (00:42).
Интонация: Экспертно, весомо, с акцентом на цифрах.
Текст: «Пять и четыре до сотни. Тут два электромотора, полный привод и почти пятьсот лошадиных сил. При этом тяга ровная, без рывков — просто нажал и поехал».

00:45 – 00:52 | Музыка и графика (Без слов):
Видеоряд: Динамичные кадры проезда серебристого кроссовера Li L7 по залитой солнцем дороге с разных ракурсов. На экране 3D-графика поверх авто: «449 л.с. (330 кВт) | 620 Н·м».

Сцена 2. Подвеска и плавность хода (00:53 – 01:36)
00:53 – 00:57 | Девушка (Ж):
Видеоряд: Внутри салона, девушка разводит руками, показывая на дорогу.
Интонация: Удивленно, задумчиво.
Текст: «Слушай, ну разгон понятно, впечатляет. Но почему в салоне так тихо и вообще не трясёт?»

00:58 – 01:07 | Музыка и графика (Без слов):
Видеоряд: Красивый проезд автомобиля по мосту, вид с дрона сверху и сбоку. Над крышей авто 3D-надпись: «Пневмоподвеска Magic Carpet».`;

const CAR_REVIEW_VERBATIM_TURNS_UZ: DialogueTurn[] = [
  {
    id: 'turn-1',
    speakerId: 'HOST_1',
    speakerName: 'Девушка (Ж)',
    speakerGender: 'female',
    timecode: '00:00 - 00:02',
    startSec: 0,
    endSec: 2,
    durationSec: 2,
    sceneTitle: 'Сцена 1. Габариты, комфорт и динамика разгона (00:00 – 00:45)',
    visualContext: 'Крупный план сбоку, девушка поворачивается к водителю и жестикулирует левой рукой.',
    intonationRu: 'С интересом, вопросительно.',
    originalTextRu: 'Ну как она на ходу? Машина-то крупная.',
    originalText: 'Ну как она на ходу? Машина-то крупная.',
    text: "Xo'sh, yurishi qanaqa ekan? Mashina katta-ku.",
    emotion: 'curious',
    speechStyle: 'Curious, lively, questioning tone. Visual context: turning to driver and gesturing.',
    pace: 'normal',
  },
  {
    id: 'turn-2',
    speakerId: 'HOST_2',
    speakerName: 'Мужчина (М)',
    speakerGender: 'male',
    timecode: '00:02 - 00:09',
    startSec: 2,
    endSec: 9,
    durationSec: 7,
    sceneTitle: 'Сцена 1. Габариты, комфорт и динамика разгона (00:00 – 00:45)',
    visualContext: 'Камера на водителя (00:02–00:05), затем вид с заднего ряда на обоих и экран мультимедиа.',
    intonationRu: 'Спокойно, уверенно, небольшая пауза перед словом «понятно».',
    originalTextRu: 'К габаритам привыкаешь за несколько поворотов. Сидишь высоко, дорогу видно хорошо, и управляется... понятно.',
    originalText: 'К габаритам привыкаешь за несколько поворотов. Сидишь высоко, дорогу видно хорошо, и управляется... понятно.',
    text: "O'lchamlariga bir nechta burilishda o'rganasan. Baland o'tirasan, yo'l yaxshi ko'rinadi va boshqaruvi <short pause> tushunarli.",
    emotion: 'calm',
    speechStyle: 'Calm, confident, expert tone with a brief pause before the last word.',
    pace: 'normal',
  },
  {
    id: 'turn-3',
    speakerId: 'HOST_2',
    speakerName: 'Мужчина (М)',
    speakerGender: 'male',
    timecode: '00:10 - 00:11',
    startSec: 10,
    endSec: 11,
    durationSec: 1,
    sceneTitle: 'Сцена 1. Габариты, комфорт и динамика разгона (00:00 – 00:45)',
    visualContext: 'Поворачивает голову к девушке, слегка улыбается.',
    intonationRu: 'Дружелюбно.',
    originalTextRu: 'Лучше скажи, как тебе на пассажирском?',
    originalText: 'Лучше скажи, как тебе на пассажирском?',
    text: "Yaxshisi ayt-chi, yo'lovchi o'rindig'i qalay?",
    emotion: 'friendly',
    speechStyle: 'Warm, friendly, smiling slightly.',
    pace: 'fast',
  },
  {
    id: 'turn-4',
    speakerId: 'HOST_1',
    speakerName: 'Девушка (Ж)',
    speakerGender: 'female',
    timecode: '00:12 - 00:18',
    startSec: 12,
    endSec: 18,
    durationSec: 6,
    sceneTitle: 'Сцена 1. Габариты, комфорт и динамика разгона (00:00 – 00:45)',
    visualContext: 'Камера на девушку, она опирается рукой на центральный подлокотник, в конце фразы улыбается.',
    intonationRu: 'Довольно, расслабленно, с легким смешком в конце.',
    originalTextRu: 'Слушай, мне очень свободно. Места с запасом, сиденье мягкое. Сижу, отдыхаю (хе-хе).',
    originalText: 'Слушай, мне очень свободно. Места с запасом, сиденье мягкое. Сижу, отдыхаю (хе-хе).',
    text: "Bilasanmi, menga juda keng. Joy bemalol, o'rindiq yumshoq. O'tirib, dam olyapman <laugh>",
    emotion: 'joyful',
    speechStyle: 'Pleased, relaxed, comfortable, ending with a light short chuckle.',
    pace: 'normal',
  },
  {
    id: 'turn-5',
    speakerId: 'HOST_2',
    speakerName: 'Мужчина (М)',
    speakerGender: 'male',
    timecode: '00:19 - 00:26',
    startSec: 19,
    endSec: 26,
    durationSec: 7,
    sceneTitle: 'Сцена 1. Габариты, комфорт и динамика разгона (00:00 – 00:45)',
    visualContext: 'Камера на водителя, затем крупный план девушки, которая слушает и кивает.',
    intonationRu: 'Уверенно, с интригой в конце.',
    originalTextRu: 'Это мы ещё спокойно едем. Сейчас выйдем на свободный участок — покажу, как она ускоряется.',
    originalText: 'Это мы ещё спокойно едем. Сейчас выйдем на свободный участок — покажу, как она ускоряется.',
    text: "Hali tinch ketyapmiz. Hozir ochiq yo'lga chiqaylik — qanday tezlanishini ko'rsataman.",
    emotion: 'confident',
    speechStyle: 'Confident, building intrigue at the end.',
    pace: 'normal',
  },
  {
    id: 'turn-6',
    speakerId: 'HOST_1',
    speakerName: 'Девушка (Ж)',
    speakerGender: 'female',
    timecode: '00:26 - 00:27',
    startSec: 26,
    endSec: 27,
    durationSec: 1,
    sceneTitle: 'Сцена 1. Габариты, комфорт и динамика разгона (00:00 – 00:45)',
    visualContext: 'Быстро поворачивается к водителю с азартом.',
    intonationRu: 'Коротко, с вызовом и предвкушением.',
    originalTextRu: 'Давай!',
    originalText: 'Давай!',
    text: 'Ketdik!',
    emotion: 'excited',
    speechStyle: 'Short, eager, excited anticipation.',
    pace: 'fast',
  },
  {
    id: 'turn-7',
    speakerId: 'HOST_1',
    speakerName: 'Девушка (Ж)',
    speakerGender: 'female',
    timecode: '00:27 - 00:31',
    startSec: 27,
    endSec: 31,
    durationSec: 4,
    sceneTitle: 'Сцена 1. Габариты, комфорт и динамика разгона (00:00 – 00:45)',
    visualContext: 'Машина резко ускоряется, девушку вдавливает в спинку кресла, она эмоционально вскидывает руку и смеется.',
    intonationRu: 'Восторженно, удивленно, протяжно.',
    originalTextRu: 'Ого-о! Вот это вдавило! Вообще не ожидала такой прыти!',
    originalText: 'Ого-о! Вот это вдавило! Вообще не ожидала такой прыти!',
    text: "O'ho'-o'! Zo'r tortdi-yu! Bunday chaqqonlikni umuman kutmagandim!",
    emotion: 'surprised',
    speechStyle: 'Thrilled, amazed, drawn-out exclamation as the car accelerates.',
    pace: 'normal',
  },
  {
    id: 'turn-8',
    speakerId: 'HOST_2',
    speakerName: 'Мужчина (М)',
    speakerGender: 'male',
    timecode: '00:32 - 00:44',
    startSec: 32,
    endSec: 44,
    durationSec: 12,
    sceneTitle: 'Сцена 1. Габариты, комфорт и динамика разгона (00:00 – 00:45)',
    visualContext: 'Водитель спокойно рулит, на экране всплывает плашка «5,4 секунды (0–100 км/ч)».',
    intonationRu: 'Экспертно, весомо, с акцентом на цифрах.',
    originalTextRu: 'Пять и четыре до сотни. Тут два электромотора, полный привод и почти пятьсот лошадиных сил. При этом тяга ровная, без рывков — просто нажал и поехал.',
    originalText: 'Пять и четыре до сотни. Тут два электромотора, полный привод и почти пятьсот лошадиных сил. При этом тяга ровная, без рывков — просто нажал и поехал.',
    text: "Yuzgacha besh butun to'rt soniya. Bu yerda ikkita elektromotor, to'liq uzatma va deyarli besh yuz ot kuchi bor. Tortishi esa tekis, silkinishlarsiz — shunchaki bosding va ketding.",
    emotion: 'authoritative',
    speechStyle: 'Expert, authoritative, emphasizing the numbers clearly.',
    pace: 'normal',
  },
  {
    id: 'turn-9',
    speakerId: 'HOST_1',
    speakerName: 'Девушка (Ж)',
    speakerGender: 'female',
    timecode: '00:53 - 00:57',
    startSec: 53,
    endSec: 57,
    durationSec: 4,
    sceneTitle: 'Сцена 2. Подвеска и плавность хода (00:53 – 01:36)',
    visualContext: 'Внутри салона, девушка разводит руками, показывая на дорогу.',
    intonationRu: 'Удивленно, задумчиво.',
    originalTextRu: 'Слушай, ну разгон понятно, впечатляет. Но почему в салоне так тихо и вообще не трясёт?',
    originalText: 'Слушай, ну разгон понятно, впечатляет. Но почему в салоне так тихо и вообще не трясёт?',
    text: "Qara, tezlanishi tushunarli, qoyil. Lekin nega salonda bunchalik tinch va umuman silkitmayapti?",
    emotion: 'surprised',
    speechStyle: 'Surprised, thoughtful, gesturing at the smooth road.',
    pace: 'normal',
  },
];

const CAR_REVIEW_NO_SPEECH_INTERVALS = [
  {
    timecode: '00:45 - 00:52',
    startSec: 45,
    endSec: 52,
    durationSec: 7,
    description: 'Динамичные кадры проезда Li L7 по дороге. 3D-графика: «449 л.с. (330 кВт) | 620 Н·м».',
  },
  {
    timecode: '00:58 - 01:07',
    startSec: 58,
    endSec: 67,
    durationSec: 9,
    description: 'Проезд автомобиля по мосту, вид с дрона. Надпись: «Пневмоподвеска Magic Carpet».',
  },
];

interface DialogueStudioProps {
  voices: VoiceProfile[];
  userClonedVoiceId: string;
  initialTurns?: DialogueTurn[];
  initialTopic?: string;
  onSaveToCMS?: (item: any) => void;
  onOpenDocumentModal?: () => void;
  lang: 'uz' | 'ru';
}

interface SavedDialogueHistoryItem {
  id: string;
  ownerUid: string;
  ownerEmail: string;
  title: string;
  storyboardTextRu: string;
  turns: DialogueTurn[];
  noSpeechIntervals: Array<{
    timecode: string;
    startSec: number;
    endSec: number;
    durationSec: number;
    description: string;
  }>;
  speaker1Name: string;
  speaker1VoiceId: string;
  speaker2Name: string;
  speaker2VoiceId: string;
  masterAudioMode: 'continuous' | 'time_aligned';
  totalVideoDurationSec: number;
  estimatedCostUsd: number;
  updatedAt: string;
}

const getDialogueDraftKey = (uid?: string | null) =>
  uid ? `ovozstudio_dialogue_draft_v2_${uid}` : null;

const getDialogueHistoryKey = (uid?: string | null) =>
  uid ? `ovozstudio_dialogue_history_v2_${uid}` : null;

export const DialogueStudio: React.FC<DialogueStudioProps> = ({
  voices,
  userClonedVoiceId,
  initialTurns,
  initialTopic,
  onSaveToCMS,
  onOpenDocumentModal,
  lang,
}) => {
  const { user, requireAuth, useCredit, syncCredits, logGeneration } = useAuth();

  // Master Audio Mode: 'time_aligned' (strict timecodes for 1:1 video dubbing) vs 'continuous' (0.35s pause for podcasts)
  const [masterAudioMode, setMasterAudioMode] = useState<'continuous' | 'time_aligned'>('time_aligned');
  const [isDiarizing, setIsDiarizing] = useState<boolean>(false);
  const [dialogueNotice, setDialogueNotice] = useState<string | null>(null);

  // Speaker 1 (Default: Female speaker)
  const [speaker1VoiceId, setSpeaker1VoiceId] = useState<string>(() => {
    const femaleVoice = voices.find((v) => v.id === 'aziza' || v.baseVoice === 'Kore' || v.gender === 'female');
    return femaleVoice?.id || userClonedVoiceId || 'aziza';
  });
  const [speaker1Name, setSpeaker1Name] = useState<string>('Спикер 1 (Ж)');
  const [speaker1Gender, setSpeaker1Gender] = useState<'female' | 'male'>('female');
  const [speaker1Role, setSpeaker1Role] = useState<string>('Ведущая · Эмоциональный голос');
  const [speaker1Tempo, setSpeaker1Tempo] = useState<string>('1.0x');

  // Speaker 2 (Default: Cloned Male Voice or male expert voice)
  const [speaker2GenderFilter, setSpeaker2GenderFilter] = useState<'all' | 'female' | 'male'>('all');
  const [speaker2VoiceId, setSpeaker2VoiceId] = useState<string>(() => {
    return userClonedVoiceId || 'voice_17raj9ewke3g';
  });
  const [speaker2Name, setSpeaker2Name] = useState<string>('Спикер 2 (М)');
  const [speaker2Role, setSpeaker2Role] = useState<string>('Эксперт · Собеседник');
  const [speaker2Gender, setSpeaker2Gender] = useState<'female' | 'male'>('male');
  const [speaker2Tempo, setSpeaker2Tempo] = useState<string>('1.0x');
  const [speaker2Timbre, setSpeaker2Timbre] = useState<string>('Salobatli & Ishbilarmon');

  // Extra speakers (HOST_3, HOST_4...) when storyboard has >2 speakers
  const [extraSpeakers, setExtraSpeakers] = useState<
    Array<{
      speakerId: string;
      name: string;
      gender: 'female' | 'male';
      voiceId: string;
      baseVoice: string;
      description?: string;
    }>
  >([]);

  // Unified 3-Mode Source Switcher:
  // 'verbatim' = 🎯 Точный дубляж 1:1 (Раскадровка + Видео до 15 мин)
  // 'prompt'   = ✨ ИИ-Диалог по теме / PDF (до 10 мин)
  // 'youtube'  = 📝 Импорт субтитров (.SRT / .VTT / Текст)
  const [studioSourceMode, setStudioSourceMode] = useState<'verbatim' | 'prompt' | 'youtube'>('verbatim');

  // Verbatim 1:1 Storyboard & Video Dubbing State — Starts EMPTY by default, scoped strictly per user.uid!
  const [storyboardTextRu, setStoryboardTextRu] = useState<string>('');
  const [isParsingStoryboard, setIsParsingStoryboard] = useState<boolean>(false);
  const [noSpeechIntervals, setNoSpeechIntervals] = useState<
    Array<{ timecode: string; startSec: number; endSec: number; durationSec: number; description: string }>
  >([]);
  const [estimatedCostUsd, setEstimatedCostUsd] = useState<number>(0);
  const [totalVideoDurationSec, setTotalVideoDurationSec] = useState<number>(0);
  const [srtSubtitles, setSrtSubtitles] = useState<string>('');
  const [resynthesizingTurnId, setResynthesizingTurnId] = useState<string | null>(null);
  const [fastPacingTurnId, setFastPacingTurnId] = useState<string | null>(null);
  const [resynthesizingSubBlockIndex, setResynthesizingSubBlockIndex] = useState<number | null>(null);
  const [shorteningTurnId, setShorteningTurnId] = useState<string | null>(null);
  const [editingTurnId, setEditingTurnId] = useState<string | null>(null);

  // Per-User Saved Dubbing Projects History (strictly isolated by user.uid)
  const [userHistory, setUserHistory] = useState<SavedDialogueHistoryItem[]>([]);

  // Uploaded Video File State (up to 30 MB on client)
  const [uploadedVideoFileId, setUploadedVideoFileId] = useState<string | null>(null);
  const [uploadedVideoFileName, setUploadedVideoFileName] = useState<string | null>(null);
  const [uploadedVideoSizeMb, setUploadedVideoSizeMb] = useState<number | null>(null);
  const [uploadedVideoPreviewUrl, setUploadedVideoPreviewUrl] = useState<string | null>(null);
  const [isUploadingVideo, setIsUploadingVideo] = useState<boolean>(false);
  // Point 1: Video analysis is enabled by default (true)
  const [autoExtractFromVideo, setAutoExtractFromVideo] = useState<boolean>(true);
  const [videoJobStatus, setVideoJobStatus] = useState<{
    jobId: string;
    stage:
      | 'uploading_to_gemini'
      | 'gemini_processing'
      | 'storyboard'
      | 'translating'
      | 'done'
      | 'failed';
    progress: number;
    error?: string | null;
    turnsCount?: number;
    speakersCount?: number;
    elapsedSeconds?: number;
    creditsDeducted?: number;
  } | null>(null);
  const videoJobPollTimerRef = useRef<number | null>(null);
  const [duckingMode, setDuckingMode] = useState<'smart_ducking' | 'mute_speech_keep_music' | 'voice_only'>('smart_ducking');
  const [isMuxingVideo, setIsMuxingVideo] = useState<boolean>(false);
  const [muxedVideoDownloadUrl, setMuxedVideoDownloadUrl] = useState<string | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const dubVideoRef = useRef<HTMLVideoElement | null>(null);

  // Ready Script Import / Export & Imported Table Video Protection State
  const [isImportedScript, setIsImportedScript] = useState<boolean>(false);
  const [showImportModal, setShowImportModal] = useState<boolean>(false);
  const [importRawText, setImportRawText] = useState<string>('');
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<ReadyScriptValidationError[]>([]);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const [showReplaceTableModal, setShowReplaceTableModal] = useState<boolean>(false);
  const [showVoiceWarningModal, setShowVoiceWarningModal] = useState<boolean>(false);
  const [pendingSynthResumeFlag, setPendingSynthResumeFlag] = useState<boolean>(false);

  // Subtitles / YouTube Import State
  const [youtubeImportUrl, setYoutubeImportUrl] = useState<string>('');
  const [youtubeTargetLang, setYoutubeTargetLang] = useState<'uz' | 'ru'>('uz');
  const [isImportingYoutube, setIsImportingYoutube] = useState<boolean>(false);
  const [youtubeImportNotice, setYoutubeImportNotice] = useState<string | null>(null);
  const [youtubeImportError, setYoutubeImportError] = useState<string | null>(null);
  const [manualTranscriptText, setManualTranscriptText] = useState<string>('');
  const [showManualTranscriptInput, setShowManualTranscriptInput] = useState<boolean>(true);
  const [youtubeVideoId, setYoutubeVideoId] = useState<string | null>(null);
  const [youtubeEmbedUrl, setYoutubeEmbedUrl] = useState<string | null>(null);
  const [youtubeVideoTitle, setYoutubeVideoTitle] = useState<string | null>(null);
  const [youtubeAuthorName, setYoutubeAuthorName] = useState<string | null>(null);
  const [showOriginalTranscript, setShowOriginalTranscript] = useState<boolean>(true);

  // Progressive Batch Synthesis State
  const [batchProgress, setBatchProgress] = useState<{
    currentBatch: number;
    totalBatches: number;
    completedTurns: number;
    totalTurns: number;
    percent: number;
    statusText: string;
  } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Preview testing for speakers
  const [previewingSpeaker, setPreviewingSpeaker] = useState<'host1' | 'host2' | null>(null);
  const speakerPreviewAudioRef = useRef<HTMLAudioElement | null>(null);

  const speaker1Profile = voices.find((v) => v.id === speaker1VoiceId) || voices[0];
  const speaker2Profile =
    voices.find((v) => v.id === speaker2VoiceId) ||
    voices.find((v) => v.isReplicatedVoice || v.id.includes('17raj9')) ||
    voices[1] ||
    voices[0];

  const [topic, setTopic] = useState<string>(initialTopic || '');
  const [tone, setTone] = useState<string>('Jonli va intellektual bahs');

  // Duration selector for AI Topic Podcast (strictly up to 10 minutes)
  const [targetDuration, setTargetDuration] = useState<string>('5 daqiqa');
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [isExpandingDialogue, setIsExpandingDialogue] = useState(false);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  // Turns — Starts EMPTY by default (or from initialTurns if passed from DocumentModal)
  const [turns, setTurns] = useState<DialogueTurn[]>(() => {
    if (initialTurns && initialTurns.length > 0) return initialTurns;
    return [];
  });

  const estimatedDialogueSeconds = calculateInterviewDialogueSeconds(turns.length);
  const dialogueCountdown = useGenerationCountdown(isSynthesizing, estimatedDialogueSeconds, lang, 'audio_dialogue');

  const estimatedInterviewScriptSeconds = calculateAiScriptSeconds(targetDuration, 'interview');
  const interviewScriptCountdown = useGenerationCountdown(
    isGeneratingScript || isExpandingDialogue,
    isExpandingDialogue ? 16 : estimatedInterviewScriptSeconds,
    lang,
    'script_interview'
  );

  const [dynamicDuckingEnabled, setDynamicDuckingEnabled] = useState(true);

  // Synthesis results
  const [masterAudioBase64, setMasterAudioBase64] = useState<string | null>(null);
  const [masterAudioBlobUrl, setMasterAudioBlobUrl] = useState<string | null>(null);
  const [totalDuration, setTotalDuration] = useState<number>(0);
  const [synthesizedTurns, setSynthesizedTurns] = useState<DialogueTurn[]>([]);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [activeTurnIndex, setActiveTurnIndex] = useState<number>(-1);
  const [projectCacheId, setProjectCacheId] = useState<string>(
    () => `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  );
  const [cachedTurnsInDbCount, setCachedTurnsInDbCount] = useState<number>(0);
  const [isRestitchingFromCache, setIsRestitchingFromCache] = useState<boolean>(false);

  // Convert masterAudioBase64 to an Object URL so 10-15 min (>25 MB) WAV files play smoothly without data: URI limits
  useEffect(() => {
    if (!masterAudioBase64) {
      setMasterAudioBlobUrl(null);
      return;
    }
    let url: string | null = null;
    try {
      const bytes = decodeBase64ToBytes(masterAudioBase64);
      const blob = new Blob([bytes], { type: 'audio/wav' });
      url = URL.createObjectURL(blob);
      setMasterAudioBlobUrl(url);
    } catch {
      setMasterAudioBlobUrl(`data:audio/wav;base64,${masterAudioBase64}`);
    }
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [masterAudioBase64]);

  // Daily Gemini TTS quota (100 RPD) & pause/resume state for cloned voice 429
  const [ttsQuota, setTtsQuota] = useState<{
    used: number;
    limit: number;
    remaining: number;
    resetHintRu?: string;
  } | null>(null);
  const [quotaPausedInfo, setQuotaPausedInfo] = useState<{
    messageRu: string;
    blocksCompleted: number;
    blocksTotal: number;
    remainingTurnsCount: number;
  } | null>(null);

  const refreshTtsQuota = async () => {
    try {
      const res = await authFetch('/api/tts/quota');
      if (res.ok) {
        const data = await res.json();
        if (typeof data?.remaining === 'number') {
          setTtsQuota(data);
        }
      }
    } catch {}
  };

  useEffect(() => {
    refreshTtsQuota();
  }, [user?.uid]);

  const plannedMacroBlocks = useMemo(() => {
    return planDialogueMacroBlocks(turns, { maxSize: 25, minPauseSec: 0.5 });
  }, [turns]);

  const synthesisVoiceWarnings = useMemo(() => {
    if (turns.length === 0) return [];
    return checkSynthesisVoiceWarnings(
      [
        {
          speakerId: 'HOST_1',
          name: speaker1Name,
          gender: speaker1Gender,
          voice: speaker1Profile,
        },
        {
          speakerId: 'HOST_2',
          name: speaker2Name,
          gender: speaker2Gender,
          voice: speaker2Profile,
        },
      ],
      turns
    );
  }, [turns, speaker1Name, speaker1Gender, speaker1Profile, speaker2Name, speaker2Gender, speaker2Profile]);

  const plannedSubBlocks = useMemo(() => {
    if (turns.length === 0) return [];
    const subBlocks: Array<{
      globalSubBlockIndex: number;
      macroBlockIndex: number;
      startTurnIndex: number;
      endTurnIndex: number;
      startTimecode: string;
      endTimecode: string;
      turns: DialogueTurn[];
    }> = [];
    let globalIdx = 0;
    for (const mb of plannedMacroBlocks) {
      const subs = planDialogueSubBlocks(mb.turns, { maxTurns: 8, maxWindowSec: 40 });
      for (const sb of subs) {
        subBlocks.push({
          globalSubBlockIndex: globalIdx++,
          macroBlockIndex: mb.blockIndex,
          startTurnIndex: mb.startTurnIndex + sb.startTurnIndex,
          endTurnIndex: mb.startTurnIndex + sb.endTurnIndex,
          startTimecode: sb.startTimecode,
          endTimecode: sb.endTimecode,
          turns: sb.turns,
        });
      }
    }
    return subBlocks;
  }, [turns, plannedMacroBlocks]);

  const dubbingCallsForecast = useMemo(() => {
    if (!turns.length) {
      return {
        blocks: 0,
        subBlocks: 0,
        baseTtsCalls: 0,
        transcribeCalls: 0,
        retryBufferCalls: 0,
        estimatedCalls: 0,
        modeLabel: 'A' as 'A' | 'B',
      };
    }
    const uniqueSpeakers = new Set(turns.map((t) => t.speakerId || 'HOST_1'));
    const hasCloned = [speaker1Profile, speaker2Profile].some((p: any) => {
      if (!p) return false;
      const id = String(p.voiceId || p.id || '').toLowerCase();
      return (
        Boolean(p.isReplicatedVoice || p.isUserCustomVoice) ||
        id === 'voice_17raj9ewke3g' ||
        id === 'user-replicated' ||
        id === 'shohrux' ||
        id === 'shokhrukh'
      );
    });
    const blocks = Math.max(1, plannedMacroBlocks.length);
    const subBlocks = Math.max(1, plannedSubBlocks.length);
    const useModeB = hasCloned || uniqueSpeakers.size > 2;
    let baseTtsCalls = 0;
    for (const sb of plannedSubBlocks) {
      const sbSpeakers = new Set(sb.turns.map((t) => t.speakerId || 'HOST_1'));
      const sbTts = useModeB ? Math.max(1, sbSpeakers.size) : 1;
      baseTtsCalls += sbTts;
    }
    if (baseTtsCalls === 0) baseTtsCalls = subBlocks;
    const baseTranscribeCalls = subBlocks;
    const retryBufferCalls = Math.ceil(baseTtsCalls * 0.2);
    const transcribeCalls = baseTranscribeCalls + Math.ceil(baseTranscribeCalls * 0.2);
    const estimatedCalls = baseTtsCalls + retryBufferCalls;
    return {
      blocks,
      subBlocks,
      baseTtsCalls,
      transcribeCalls,
      retryBufferCalls,
      estimatedCalls,
      modeLabel: (useModeB ? 'B' : 'A') as 'A' | 'B',
    };
  }, [turns, plannedMacroBlocks, plannedSubBlocks, speaker1Profile, speaker2Profile]);

  // Ref to avoid overwriting user storage while hydrating on user switch
  const isHydratingUserRef = useRef<boolean>(false);

  // Load current user's draft & history when user?.uid changes (or reset to empty for another/new account!)
  useEffect(() => {
    isHydratingUserRef.current = true;
    try {
      // Stop any active playback from previous user session
      audioRef.current?.pause();
      singleAudioRef.current?.pause();
      dubVideoRef.current?.pause();
      setIsPlaying(false);
      setActiveTurnIndex(-1);
      setMasterAudioBase64(null);
      setSynthesizedTurns([]);
      setTotalDuration(0);
      setSrtSubtitles('');
      setDialogueNotice(null);
      if (videoJobPollTimerRef.current) {
        window.clearTimeout(videoJobPollTimerRef.current);
        videoJobPollTimerRef.current = null;
      }
      setVideoJobStatus(null);
      setUploadedVideoFileId(null);
      setUploadedVideoFileName(null);
      setUploadedVideoSizeMb(null);
      setUploadedVideoPreviewUrl(null);
      setMuxedVideoDownloadUrl(null);

      if (!user?.uid) {
        // Logged out / guest -> completely empty workspace and history
        setStoryboardTextRu('');
        setTurns(initialTurns && initialTurns.length > 0 ? initialTurns : []);
        setNoSpeechIntervals([]);
        setTopic(initialTopic || '');
        setEstimatedCostUsd(0);
        setTotalVideoDurationSec(0);
        setUserHistory([]);
        return;
      }

      // 1. Load per-user saved history
      const histKey = getDialogueHistoryKey(user.uid);
      let loadedHistory: SavedDialogueHistoryItem[] = [];
      if (histKey) {
        try {
          const rawHist = localStorage.getItem(histKey);
          if (rawHist) {
            const parsedHist = JSON.parse(rawHist);
            if (Array.isArray(parsedHist)) {
              loadedHistory = parsedHist.filter((item) => item && item.ownerUid === user.uid);
            }
          }
        } catch (err) {
          console.warn('Could not read user dialogue history:', err);
        }
      }
      setUserHistory(loadedHistory);

      // 2. Load per-user active draft
      const draftKey = getDialogueDraftKey(user.uid);
      let loadedDraft: any = null;
      if (draftKey) {
        try {
          const rawDraft = localStorage.getItem(draftKey);
          if (rawDraft) {
            const parsedDraft = JSON.parse(rawDraft);
            if (parsedDraft && parsedDraft.ownerUid === user.uid) {
              loadedDraft = parsedDraft;
            }
          }
        } catch (err) {
          console.warn('Could not read user dialogue draft:', err);
        }
      }

      if (loadedDraft) {
        setStoryboardTextRu(typeof loadedDraft.storyboardTextRu === 'string' ? loadedDraft.storyboardTextRu : '');
        setTurns(
          initialTurns && initialTurns.length > 0
            ? initialTurns
            : Array.isArray(loadedDraft.turns)
            ? loadedDraft.turns
            : []
        );
        setNoSpeechIntervals(Array.isArray(loadedDraft.noSpeechIntervals) ? loadedDraft.noSpeechIntervals : []);
        setTopic(initialTopic || loadedDraft.topic || '');
        setEstimatedCostUsd(Number(loadedDraft.estimatedCostUsd) || 0);
        setTotalVideoDurationSec(Number(loadedDraft.totalVideoDurationSec) || 0);
        if (loadedDraft.speaker1Name) setSpeaker1Name(loadedDraft.speaker1Name);
        if (loadedDraft.speaker1VoiceId) setSpeaker1VoiceId(loadedDraft.speaker1VoiceId);
        if (loadedDraft.speaker2Name) setSpeaker2Name(loadedDraft.speaker2Name);
        if (loadedDraft.speaker2VoiceId) setSpeaker2VoiceId(loadedDraft.speaker2VoiceId);
        setProjectCacheId(
          typeof loadedDraft.projectCacheId === 'string' && loadedDraft.projectCacheId.trim()
            ? loadedDraft.projectCacheId
            : `draft_${user.uid}`
        );
        // Item 1.5: Always use time_aligned for dubbing; never overwrite with stale 'continuous' from draft
        setMasterAudioMode('time_aligned');
      } else {
        // New or different account that hasn't entered anything -> completely EMPTY!
        setStoryboardTextRu('');
        setTurns(initialTurns && initialTurns.length > 0 ? initialTurns : []);
        setNoSpeechIntervals([]);
        setTopic(initialTopic || '');
        setEstimatedCostUsd(0);
        setTotalVideoDurationSec(0);
        setSpeaker1Name('Спикер 1 (Ж)');
        setSpeaker2Name('Спикер 2 (М)');
        setProjectCacheId(`draft_${user.uid}`);
        setMasterAudioMode('time_aligned');
      }
    } finally {
      setTimeout(() => {
        isHydratingUserRef.current = false;
      }, 0);
    }
  }, [user?.uid]);

  // Persist current user's active draft strictly under their own user.uid
  useEffect(() => {
    if (isHydratingUserRef.current || !user?.uid) return;
    const draftKey = getDialogueDraftKey(user.uid);
    if (!draftKey) return;
    try {
      const strippedTurns = turns.map(({ audioBase64, ...rest }) => rest);
      const payload = {
        ownerUid: user.uid,
        ownerEmail: user.email || '',
        projectCacheId,
        storyboardTextRu,
        turns: strippedTurns,
        noSpeechIntervals,
        topic,
        estimatedCostUsd,
        totalVideoDurationSec,
        speaker1Name,
        speaker1VoiceId,
        speaker2Name,
        speaker2VoiceId,
        masterAudioMode,
        updatedAt: new Date().toISOString(),
      };
      localStorage.setItem(draftKey, JSON.stringify(payload));
    } catch (err) {
      console.warn('Could not save user dialogue draft:', err);
    }
  }, [
    user?.uid,
    user?.email,
    projectCacheId,
    storyboardTextRu,
    turns,
    noSpeechIntervals,
    topic,
    estimatedCostUsd,
    totalVideoDurationSec,
    speaker1Name,
    speaker1VoiceId,
    speaker2Name,
    speaker2VoiceId,
    masterAudioMode,
  ]);

  // Stable project key for IndexedDB per-turn audio cache
  const projectCacheKey = useMemo(
    () => `${user?.uid || 'guest'}::${projectCacheId}`,
    [user?.uid, projectCacheId]
  );

  // Build deterministic cache key: project + turnId + hash(text, voice, style)
  const getTurnCacheDescriptor = (turn: DialogueTurn, overrideText?: string) => {
    let voiceKey = '';
    let roleKey = '';
    if (turn.speakerId === 'HOST_1') {
      voiceKey = [
        speaker1Profile?.voiceId || speaker1Profile?.id || speaker1VoiceId,
        speaker1Profile?.baseVoice || '',
        speaker1Gender,
        speaker1Tempo,
        speaker1Profile?.timbre || '',
        speaker1Profile?.isReplicatedVoice ? 'clone' : 'builtin',
      ].join('|');
      roleKey = speaker1Role || '';
    } else if (turn.speakerId === 'HOST_2') {
      voiceKey = [
        speaker2Profile?.voiceId || speaker2Profile?.id || speaker2VoiceId,
        speaker2Profile?.baseVoice || '',
        speaker2Gender,
        speaker2Tempo,
        speaker2Timbre || speaker2Profile?.timbre || '',
        speaker2Profile?.isReplicatedVoice ? 'clone' : 'builtin',
      ].join('|');
      roleKey = speaker2Role || '';
    } else {
      const extra = extraSpeakers.find(
        (s) => s.speakerId === turn.speakerId || s.name === turn.speakerName
      );
      voiceKey = [
        extra?.voiceId || turn.voiceId || turn.speakerId || '',
        extra?.baseVoice || turn.baseVoice || '',
        extra?.gender || turn.speakerGender || '',
      ].join('|');
      roleKey = extra?.description || '';
    }

    const styleKey = [
      turn.speechStyle || '',
      turn.intonationRu || '',
      turn.emotion || '',
      turn.pace || '',
      roleKey,
    ].join('|');

    const textForHash = (overrideText ?? turn.text ?? '').trim();
    const contentHash = computeTurnAudioHash({
      text: textForHash,
      voiceKey,
      styleKey,
    });
    const cacheKey = buildTurnAudioCacheKey(projectCacheKey, turn.id, contentHash);
    return { cacheKey, contentHash, voiceKey, styleKey };
  };

  const persistTurnsAudioToIndexedDb = async (
    items: DialogueTurn[],
    sourceTurnsById?: Map<string, DialogueTurn>
  ) => {
    const entries: CachedDialogueTurnAudio[] = [];
    const now = Date.now();
    for (const item of items) {
      if (!item?.id || !item.audioBase64) continue;
      const primary = getTurnCacheDescriptor(item);
      entries.push({
        cacheKey: primary.cacheKey,
        projectKey: projectCacheKey,
        turnId: item.id,
        contentHash: primary.contentHash,
        audioBase64: item.audioBase64,
        durationSeconds: item.durationSeconds,
        originalDurationSec: item.originalDurationSec,
        dubbedDurationSec: item.dubbedDurationSec,
        atempoApplied: item.atempoApplied,
        rephraseAttempts: item.rephraseAttempts,
        fitStepApplied: item.fitStepApplied,
        syncStatus: item.syncStatus,
        qa: item.qa,
        qaReason: item.qaReason,
        slicingMethod: item.slicingMethod,
        shiftedStartBySec: item.shiftedStartBySec,
        needsShorten: item.needsShorten,
        subBlockIndex: item.subBlockIndex,
        startTime: item.startTime,
        endTime: item.endTime,
        savedAt: now,
      });

      // Also index under pre-rephrase text if server shortened text during fitting
      const sourceTurn = sourceTurnsById?.get(item.id);
      if (sourceTurn && sourceTurn.text.trim() !== item.text.trim()) {
        const secondary = getTurnCacheDescriptor(sourceTurn);
        if (secondary.cacheKey !== primary.cacheKey) {
          entries.push({
            cacheKey: secondary.cacheKey,
            projectKey: projectCacheKey,
            turnId: item.id,
            contentHash: secondary.contentHash,
            audioBase64: item.audioBase64,
            durationSeconds: item.durationSeconds,
            originalDurationSec: item.originalDurationSec,
            dubbedDurationSec: item.dubbedDurationSec,
            atempoApplied: item.atempoApplied,
            rephraseAttempts: item.rephraseAttempts,
            fitStepApplied: item.fitStepApplied,
            syncStatus: item.syncStatus,
            qa: item.qa,
            qaReason: item.qaReason,
            slicingMethod: item.slicingMethod,
            shiftedStartBySec: item.shiftedStartBySec,
            needsShorten: item.needsShorten,
            subBlockIndex: item.subBlockIndex,
            startTime: item.startTime,
            endTime: item.endTime,
            savedAt: now,
          });
        }
      }
    }
    if (entries.length > 0) {
      await saveDialogueTurnAudioBatch(entries);
    }
  };

  // Auto-hydrate ready turn audio from IndexedDB after reload or voice/style/script updates
  useEffect(() => {
    if (isHydratingUserRef.current || turns.length === 0) {
      setCachedTurnsInDbCount(0);
      return;
    }
    let cancelled = false;
    const descriptors = turns.map((t) => ({ turn: t, desc: getTurnCacheDescriptor(t) }));
    const keys = descriptors.map((d) => d.desc.cacheKey);

    getDialogueTurnAudioByKeys(keys).then((foundMap) => {
      if (cancelled) return;
      setCachedTurnsInDbCount(foundMap.size);
      if (foundMap.size === 0) return;

      setSynthesizedTurns((prev) => {
        const prevById = new Map<string, DialogueTurn>();
        for (const p of prev) {
          if (p.id && p.audioBase64) prevById.set(p.id, p);
        }
        let changed = false;
        const merged: DialogueTurn[] = [];
        for (const { turn, desc } of descriptors) {
          const cached = foundMap.get(desc.cacheKey);
          const existing = prevById.get(turn.id);
          if (cached) {
            if (!existing || existing.audioBase64 !== cached.audioBase64) {
              changed = true;
            }
            merged.push({
              ...turn,
              audioBase64: cached.audioBase64,
              durationSeconds: cached.durationSeconds ?? turn.durationSeconds,
              originalDurationSec: cached.originalDurationSec ?? turn.originalDurationSec,
              dubbedDurationSec: cached.dubbedDurationSec ?? turn.dubbedDurationSec,
              atempoApplied: cached.atempoApplied ?? turn.atempoApplied,
              rephraseAttempts: cached.rephraseAttempts ?? turn.rephraseAttempts,
              fitStepApplied: cached.fitStepApplied ?? turn.fitStepApplied,
              syncStatus: cached.syncStatus ?? turn.syncStatus,
              qa: cached.qa ?? turn.qa,
              qaReason: cached.qaReason ?? turn.qaReason,
              slicingMethod: cached.slicingMethod ?? turn.slicingMethod,
              shiftedStartBySec: cached.shiftedStartBySec ?? turn.shiftedStartBySec,
              needsShorten: cached.needsShorten ?? turn.needsShorten,
              subBlockIndex: cached.subBlockIndex ?? turn.subBlockIndex,
              startTime: cached.startTime ?? turn.startTime,
              endTime: cached.endTime ?? turn.endTime,
            });
          } else if (existing) {
            merged.push(existing);
          }
        }
        return changed || prev.length !== merged.length ? merged : prev;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [
    turns,
    projectCacheKey,
    speaker1VoiceId,
    speaker2VoiceId,
    speaker1Profile?.voiceId,
    speaker1Profile?.baseVoice,
    speaker1Profile?.isReplicatedVoice,
    speaker2Profile?.voiceId,
    speaker2Profile?.baseVoice,
    speaker2Profile?.isReplicatedVoice,
    speaker1Gender,
    speaker2Gender,
    speaker1Tempo,
    speaker2Tempo,
    speaker1Profile?.timbre,
    speaker2Profile?.timbre,
    speaker2Timbre,
    speaker1Role,
    speaker2Role,
    extraSpeakers,
  ]);

  // Helper to extract HTTP status + plain text when server/proxy returns non-JSON (e.g. 413 HTML)
  const readHttpErrorMessage = async (res: Response, fallback: string): Promise<string> => {
    const rawText = await res.text().catch(() => '');
    const trimmed = rawText.trim();
    if (trimmed) {
      try {
        const parsed = JSON.parse(trimmed);
        const msg = parsed?.error || parsed?.message_ru || parsed?.message;
        if (msg) return String(msg);
      } catch {
        const plain = trimmed
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 180);
        return `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}${plain ? `: ${plain}` : ''}`;
      }
    }
    return `HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}: ${fallback}`;
  };

  // Re-stitch master WAV locally from IndexedDB / memory cache without any TTS requests
  const handleRestitchFromCache = async () => {
    if (turns.length === 0) return;
    setIsRestitchingFromCache(true);
    try {
      const descriptors = turns.map((t) => ({ turn: t, desc: getTurnCacheDescriptor(t) }));
      const foundMap = await getDialogueTurnAudioByKeys(descriptors.map((d) => d.desc.cacheKey));
      const inMemoryById = new Map<string, DialogueTurn>();
      for (const st of synthesizedTurns) {
        if (st.id && st.audioBase64) inMemoryById.set(st.id, st);
      }

      const readyTurns: DialogueTurn[] = [];
      for (const { turn, desc } of descriptors) {
        const cached = foundMap.get(desc.cacheKey);
        if (cached) {
          readyTurns.push({
            ...turn,
            audioBase64: cached.audioBase64,
            durationSeconds: cached.durationSeconds ?? turn.durationSeconds,
            originalDurationSec: cached.originalDurationSec ?? turn.originalDurationSec,
            dubbedDurationSec: cached.dubbedDurationSec ?? turn.dubbedDurationSec,
            atempoApplied: cached.atempoApplied ?? turn.atempoApplied,
            rephraseAttempts: cached.rephraseAttempts ?? turn.rephraseAttempts,
            fitStepApplied: cached.fitStepApplied ?? turn.fitStepApplied,
            syncStatus: cached.syncStatus ?? turn.syncStatus,
            qa: cached.qa ?? turn.qa,
            qaReason: cached.qaReason ?? turn.qaReason,
            slicingMethod: cached.slicingMethod ?? turn.slicingMethod,
            shiftedStartBySec: cached.shiftedStartBySec ?? turn.shiftedStartBySec,
            needsShorten: cached.needsShorten ?? turn.needsShorten,
            subBlockIndex: cached.subBlockIndex ?? turn.subBlockIndex,
            startTime: cached.startTime ?? turn.startTime,
            endTime: cached.endTime ?? turn.endTime,
          });
        } else if (inMemoryById.has(turn.id)) {
          readyTurns.push({ ...turn, ...inMemoryById.get(turn.id)! });
        }
      }

      if (readyTurns.length === 0) {
        setDialogueNotice('В кэше IndexedDB нет готовых реплик для текущих голосов и текста.');
        return;
      }

      const effectiveVideoDurationSec = Math.max(
        Number(totalVideoDurationSec) || 0,
        ...turns.map((t: any) => Number(t.endSec) || 0),
        ...noSpeechIntervals.map((n: any) => Number(n.endSec) || 0)
      );
      const effectiveMode =
        studioSourceMode === 'verbatim' || turns.some((t) => typeof t.startSec === 'number')
          ? 'time_aligned'
          : masterAudioMode;

      await new Promise((r) => setTimeout(r, 0));
      const stitchData = stitchDialogueTurnsClient({
        turns: readyTurns,
        masterAudioMode: effectiveMode,
        totalVideoDurationSec: effectiveVideoDurationSec,
      });

      setMasterAudioBase64(stitchData.masterAudioBase64);
      setTotalDuration(stitchData.totalDurationSeconds || 0);
      setSynthesizedTurns(stitchData.turns);
      setTurns((prev) =>
        prev.map((pt) => {
          const matched = stitchData.turns.find((ft) => ft.id === pt.id);
          return matched
            ? {
                ...pt,
                originalDurationSec: matched.originalDurationSec,
                dubbedDurationSec: matched.dubbedDurationSec,
                syncStatus: matched.syncStatus,
                qa: matched.qa ?? pt.qa,
                qaReason: matched.qaReason ?? pt.qaReason,
                slicingMethod: matched.slicingMethod ?? pt.slicingMethod,
                shiftedStartBySec: matched.shiftedStartBySec ?? pt.shiftedStartBySec,
                needsShorten: matched.needsShorten ?? pt.needsShorten,
              }
            : pt;
        })
      );
      if (stitchData.srtSubtitles) setSrtSubtitles(stitchData.srtSubtitles);
      setIsPlaying(false);
      setActiveTurnIndex(-1);
      setCachedTurnsInDbCount(foundMap.size);

      const missingCount = Math.max(0, turns.length - readyTurns.length);
      setDialogueNotice(
        missingCount === 0
          ? `✅ Мастер-трек собран заново локально из кэша (${readyTurns.length}/${turns.length} реплик · 0 запросов к TTS).`
          : `✅ Мастер-трек собран из кэша (${readyTurns.length}/${turns.length} реплик · 0 запросов к TTS; без кэша: ${missingCount}).`
      );
    } catch (err: any) {
      setDialogueNotice(`Ошибка локальной пересборки: ${err?.message || 'неизвестная ошибка'}`);
    } finally {
      setIsRestitchingFromCache(false);
    }
  };

  // Save a named project snapshot into the current user's personal history
  const saveProjectToUserHistory = (params: {
    title?: string;
    storyboardTextRu?: string;
    turns?: DialogueTurn[];
    noSpeechIntervals?: Array<{ timecode: string; startSec: number; endSec: number; durationSec: number; description: string }>;
    totalVideoDurationSec?: number;
    estimatedCostUsd?: number;
  }) => {
    if (!user?.uid) return;
    const histKey = getDialogueHistoryKey(user.uid);
    if (!histKey) return;

    const projectTurns = (params.turns ?? turns).map(({ audioBase64, ...rest }) => rest);
    if (projectTurns.length === 0 && !(params.storyboardTextRu ?? storyboardTextRu).trim()) return;

    const projectTitle =
      (params.title || topic || 'Дубляж по раскадровке').trim() ||
      `Дубляж (${projectTurns.length} реплик)`;

    const newItem: SavedDialogueHistoryItem = {
      id: `dub-${Date.now()}`,
      ownerUid: user.uid,
      ownerEmail: user.email || '',
      title: projectTitle,
      storyboardTextRu: params.storyboardTextRu ?? storyboardTextRu,
      turns: projectTurns,
      noSpeechIntervals: params.noSpeechIntervals ?? noSpeechIntervals,
      speaker1Name,
      speaker1VoiceId,
      speaker2Name,
      speaker2VoiceId,
      masterAudioMode,
      totalVideoDurationSec: params.totalVideoDurationSec ?? totalVideoDurationSec,
      estimatedCostUsd: params.estimatedCostUsd ?? estimatedCostUsd,
      updatedAt: new Date().toISOString(),
    };

    setUserHistory((prev) => {
      // Replace existing item with same title or prepend
      const filtered = prev.filter(
        (item) => item.ownerUid === user.uid && item.title.toLowerCase() !== projectTitle.toLowerCase()
      );
      const updated = [newItem, ...filtered].slice(0, 12);
      try {
        localStorage.setItem(histKey, JSON.stringify(updated));
      } catch (e) {
        console.warn('Failed to persist user dialogue history:', e);
      }
      return updated;
    });
  };

  const handleLoadHistoryItem = (item: SavedDialogueHistoryItem) => {
    if (!user?.uid || item.ownerUid !== user.uid) return;
    setStoryboardTextRu(item.storyboardTextRu || '');
    setTurns(item.turns || []);
    setNoSpeechIntervals(item.noSpeechIntervals || []);
    setTopic(item.title || '');
    setSpeaker1Name(item.speaker1Name || 'Спикер 1 (Ж)');
    if (item.speaker1VoiceId) setSpeaker1VoiceId(item.speaker1VoiceId);
    setSpeaker2Name(item.speaker2Name || 'Спикер 2 (М)');
    if (item.speaker2VoiceId) setSpeaker2VoiceId(item.speaker2VoiceId);
    setMasterAudioMode('time_aligned');
    setTotalVideoDurationSec(Number(item.totalVideoDurationSec) || 0);
    setEstimatedCostUsd(Number(item.estimatedCostUsd) || 0);
    setMasterAudioBase64(null);
    setSynthesizedTurns([]);
    setDialogueNotice(`📂 Загружен ваш проект «${item.title}» (${item.turns.length} реплик).`);
  };

  const handleDeleteHistoryItem = (id: string) => {
    if (!user?.uid) return;
    const histKey = getDialogueHistoryKey(user.uid);
    setUserHistory((prev) => {
      const updated = prev.filter((item) => item.id !== id && item.ownerUid === user.uid);
      if (histKey) {
        try {
          localStorage.setItem(histKey, JSON.stringify(updated));
        } catch {}
      }
      return updated;
    });
  };

  const handleClearWorkspace = () => {
    setStoryboardTextRu('');
    setTurns([]);
    setNoSpeechIntervals([]);
    setTopic('');
    setEstimatedCostUsd(0);
    setTotalVideoDurationSec(0);
    setMasterAudioBase64(null);
    setSynthesizedTurns([]);
    setSrtSubtitles('');
    setIsImportedScript(false);
    if (user?.uid) {
      const draftKey = getDialogueDraftKey(user.uid);
      if (draftKey) localStorage.removeItem(draftKey);
    }
    setDialogueNotice('🧹 Рабочая область очищена. Вы можете вставить новую раскадровку или загрузить видео.');
  };

  useEffect(() => {
    if (initialTurns && initialTurns.length > 0) {
      setTurns(initialTurns);
    }
  }, [initialTurns]);

  useEffect(() => {
    if (initialTopic) {
      setTopic(initialTopic);
    }
  }, [initialTopic]);

  // Ambient Soundscape
  const [ambientSound, setAmbientSound] = useState<AmbientSoundscape>('none');
  const [ambientEnabled, setAmbientEnabled] = useState<boolean>(false);
  const [ambientVolume, setAmbientVolume] = useState<number>(14);
  const ambientAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (ambientSound === 'none') {
      if (ambientAudioRef.current) {
        ambientAudioRef.current.pause();
        ambientAudioRef.current.src = '';
      }
      return;
    }

    try {
      const ctx = getAudioContext();
      const buf = generateAmbientAudioBuffer(ctx, 16.0, ambientSound);
      const blob = audioBufferToWav(buf, ctx.sampleRate);
      const url = URL.createObjectURL(blob);

      if (!ambientAudioRef.current) {
        ambientAudioRef.current = new Audio(url);
      } else {
        ambientAudioRef.current.src = url;
      }
      ambientAudioRef.current.loop = true;
      ambientAudioRef.current.volume = Math.max(0, Math.min(1, (ambientVolume / 100) * 0.65));

      if (isPlaying && ambientEnabled) {
        ambientAudioRef.current.play().catch(() => {});
      }

      return () => {
        URL.revokeObjectURL(url);
      };
    } catch (e) {
      console.error('Failed to create dialogue ambient audio loop:', e);
    }
  }, [ambientSound]);

  useEffect(() => {
    if (ambientAudioRef.current) {
      ambientAudioRef.current.volume = Math.max(0, Math.min(1, (ambientVolume / 100) * 0.65));
    }
  }, [ambientVolume]);

  const [playingTurnId, setPlayingTurnId] = useState<string | null>(null);
  const singleAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handleSelectSpeaker1Voice = (vId: string) => {
    setSpeaker1VoiceId(vId);
    const chosen = voices.find((v) => v.id === vId);
    if (chosen) {
      const isFemale =
        chosen.gender === 'female' ||
        chosen.baseVoice === 'Kore' ||
        chosen.baseVoice === 'Aoede' ||
        chosen.baseVoice === 'Zephyr';
      if (isImportedScript) {
        setTurns((prev) =>
          prev.map((t) => (t.speakerId === 'HOST_1' ? { ...t, voiceId: vId, baseVoice: chosen.baseVoice } : t))
        );
        return;
      }
      setSpeaker1Gender(isFemale ? 'female' : 'male');
      const rawName = chosen.name || chosen.id;
      const nameMatch = rawName.match(/^([^(]+)/);
      const newName = (nameMatch?.[1] || rawName).trim();
      if (newName) {
        setSpeaker1Name(newName);
        setTurns((prev) =>
          prev.map((t) => (t.speakerId === 'HOST_1' ? { ...t, speakerName: newName, voiceId: vId, baseVoice: chosen.baseVoice } : t))
        );
      }
    }
  };

  const handleSelectSpeaker2Voice = (vId: string) => {
    const chosen = voices.find((v) => v.id === vId);
    if (!chosen) return;

    setSpeaker2VoiceId(vId);
    const isFemale =
      chosen.gender === 'female' ||
      chosen.baseVoice === 'Kore' ||
      chosen.baseVoice === 'Aoede' ||
      chosen.baseVoice === 'Zephyr' ||
      /aziza|madina|dilnoza|zarina|nodira|malika|zephyr|kore|aoede|sevara|shahnoza|rayhon|gulzoda|umida|nigora|feruza|ayol/i.test(
        chosen.name || chosen.id
      );
    if (chosen.tempo) setSpeaker2Tempo(chosen.tempo.match(/[\d.]+x/)?.[0] || '1.0x');
    if (chosen.timbre) setSpeaker2Timbre(chosen.timbre);

    if (isImportedScript) {
      setTurns((prev) =>
        prev.map((t) => (t.speakerId === 'HOST_2' ? { ...t, voiceId: vId, baseVoice: chosen.baseVoice } : t))
      );
      return;
    }

    setSpeaker2Gender(isFemale ? 'female' : 'male');
    const rawName = chosen.name || chosen.id;
    const nameMatch = rawName.match(/^([^(]+)(?:\((.*?)\))?/);
    const extractedName = (nameMatch?.[1] || rawName).trim();
    const extractedRole = (nameMatch?.[2] || chosen.style || (isFemale ? 'AI & Fan Eksperti' : 'Mutaxassis')).trim();

    setSpeaker2Name(extractedName);
    setSpeaker2Role(extractedRole);

    setTurns((prev) =>
      prev.map((t) => (t.speakerId === 'HOST_2' ? { ...t, speakerName: extractedName, voiceId: vId, baseVoice: chosen.baseVoice } : t))
    );
  };

  const handleSetSpeaker2GenderFilter = (gender: 'all' | 'female' | 'male') => {
    setSpeaker2GenderFilter(gender);
    if (gender === 'male' && speaker2Gender === 'female') {
      const firstMale = voices.find(
        (v) => v.gender === 'male' || ['Charon', 'Puck', 'Fenrir'].includes(v.baseVoice)
      );
      if (firstMale) {
        handleSelectSpeaker2Voice(firstMale.id);
      }
    } else if (gender === 'female' && speaker2Gender === 'male') {
      const firstFemale = voices.find(
        (v) => v.gender === 'female' || ['Kore', 'Aoede', 'Zephyr'].includes(v.baseVoice)
      );
      if (firstFemale) {
        handleSelectSpeaker2Voice(firstFemale.id);
      }
    }
  };

  const handleTestSpeakerVoice = async (speaker: 'host1' | 'host2') => {
    if (previewingSpeaker === speaker) {
      if (speakerPreviewAudioRef.current) {
        speakerPreviewAudioRef.current.pause();
      }
      setPreviewingSpeaker(null);
      return;
    }

    try {
      setPreviewingSpeaker(speaker);
      const isH1 = speaker === 'host1';
      const prof = isH1 ? speaker1Profile : speaker2Profile;
      const previewUrl =
        prof?.sampleAudioUrl ||
        (prof?.id ? getVoicePreviewUrl(prof.id) : undefined) ||
        (prof?.id ? `/api/voices/preview/${prof.id}` : undefined);

      if (previewUrl) {
        const audio = new Audio(previewUrl);
        speakerPreviewAudioRef.current = audio;
        audio.onended = () => setPreviewingSpeaker(null);
        audio.onerror = () => setPreviewingSpeaker(null);
        await audio.play();
        return;
      }

      const spkName = prof?.name || (isH1 ? speaker1Name : speaker2Name);
      const isFemaleSpeaker =
        prof?.gender === 'female' ||
        prof?.baseVoice === 'Kore' ||
        prof?.baseVoice === 'Aoede' ||
        prof?.baseVoice === 'Zephyr';

      const sampleText = `Assalomu alaykum! Men ${spkName}man. Bugungi videodublyaj va intervyuda ishtirok etyapman.`;

      const res = await authFetch('/api/podcast/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: sampleText,
          voiceProfile: {
            voiceName: spkName,
            voiceId: prof?.voiceId || prof?.id,
            baseVoice: prof?.baseVoice || (isFemaleSpeaker ? 'Kore' : 'Charon'),
            timbre: isH1 ? prof?.timbre : speaker2Timbre || prof?.timbre,
            tempo: isH1 ? speaker1Tempo : speaker2Tempo,
          },
        }),
      });

      if (!res.ok) throw new Error('Ovoz sintezida xato');
      const data = await res.json();
      if (data.audioBase64) {
        const audio = new Audio(`data:audio/wav;base64,${data.audioBase64}`);
        speakerPreviewAudioRef.current = audio;
        audio.onended = () => setPreviewingSpeaker(null);
        audio.play().catch(console.warn);
      } else {
        setPreviewingSpeaker(null);
      }
    } catch (err) {
      console.warn('Speaker voice test error:', err);
      setPreviewingSpeaker(null);
    }
  };

  // Load the Car Review 1:1 Verbatim Storyboard Preset (saves ONLY to the current user's account)
  const handleLoadCarReviewPreset = () => {
    const presetTitle = 'Тест-драйв Li L7: Габариты, разгон 5,4с и пневмоподвеска (Дубляж 1:1)';
    setStoryboardTextRu(CAR_REVIEW_STORYBOARD_RU);
    setTurns(CAR_REVIEW_VERBATIM_TURNS_UZ);
    setNoSpeechIntervals(CAR_REVIEW_NO_SPEECH_INTERVALS);
    setEstimatedCostUsd(0.029);
    setTotalVideoDurationSec(67);
    setMasterAudioMode('time_aligned');
    setTopic(presetTitle);

    // Set Speaker 1 = Female (Девушка (Ж)), Speaker 2 = Male Cloned Voice (Мужчина (М) — Shohrux)
    const fem = voices.find((v) => v.id === 'aziza' || v.baseVoice === 'Kore' || v.gender === 'female');
    if (fem) {
      setSpeaker1VoiceId(fem.id);
    }
    setSpeaker1Name('Девушка (Ж)');
    setSpeaker1Gender('female');
    setSpeaker1Role('Пассажир · Живой эмоциональный голос');

    const clonedOrMale =
      voices.find((v) => v.isReplicatedVoice || v.id.includes('17raj9')) ||
      voices.find((v) => v.gender === 'male');
    if (clonedOrMale) {
      setSpeaker2VoiceId(clonedOrMale.id);
      setSpeaker2Gender('male');
    }
    setSpeaker2Name('Мужчина (М) — Shohrux');
    setSpeaker2Role('Водитель · Спокойный уверенный эксперт');
    setIsImportedScript(false);

    saveProjectToUserHistory({
      title: presetTitle,
      storyboardTextRu: CAR_REVIEW_STORYBOARD_RU,
      turns: CAR_REVIEW_VERBATIM_TURNS_UZ,
      noSpeechIntervals: CAR_REVIEW_NO_SPEECH_INTERVALS,
      totalVideoDurationSec: 67,
      estimatedCostUsd: 0.029,
    });

    setDialogueNotice(
      '✅ Загружена раскадровка (9 реплик + 2 музыкальные вставки «Без слов») и сохранена в историю вашего текущего аккаунта.'
    );
  };

  // Pure client-side Ready Script Import (0 LLM, 0 credits, 0 network calls)
  const handleOpenImportModal = () => {
    setImportErrors([]);
    setShowImportModal(true);
  };

  const handleImportFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const content = await file.text();
      setImportRawText(content);
      setImportFileName(file.name);
      setImportErrors([]);
    } catch {
      setImportErrors([{ line: 1, message: 'Не удалось прочитать файл. Проверьте кодировку UTF-8.' }]);
    } finally {
      e.target.value = '';
    }
  };

  const handleApplyReadyScriptImport = () => {
    const result = parseReadyScript(importRawText);
    if (!result.ok) {
      setImportErrors(result.errors);
      return;
    }

    const sp1 = result.speakers.find((s) => s.speakerId === 'HOST_1') || result.speakers[0];
    const sp2 = result.speakers.find((s) => s.speakerId === 'HOST_2') || result.speakers[1];

    // Auto-assign built-in (non-cloned) voices matching each speaker's declared gender
    const pickedVoice1 = sp1 ? pickBuiltInVoiceForGender(voices, sp1.gender) : undefined;
    const pickedVoice2 = sp2
      ? pickBuiltInVoiceForGender(voices, sp2.gender, pickedVoice1 ? [pickedVoice1.id] : [])
      : undefined;

    if (sp1) {
      setSpeaker1Name(sp1.name);
      setSpeaker1Gender(sp1.gender);
      if (pickedVoice1) {
        setSpeaker1VoiceId(pickedVoice1.id);
      }
    }
    if (sp2) {
      setSpeaker2Name(sp2.name);
      setSpeaker2Gender(sp2.gender);
      setSpeaker2GenderFilter('all');
      if (pickedVoice2) {
        setSpeaker2VoiceId(pickedVoice2.id);
      }
    }

    const turnsWithBuiltInVoices = result.turns.map((t) => {
      if (t.speakerId === 'HOST_1' && pickedVoice1) {
        return { ...t, voiceId: pickedVoice1.id, baseVoice: pickedVoice1.baseVoice };
      }
      if (t.speakerId === 'HOST_2' && pickedVoice2) {
        return { ...t, voiceId: pickedVoice2.id, baseVoice: pickedVoice2.baseVoice };
      }
      return t;
    });

    setTurns(turnsWithBuiltInVoices);
    setNoSpeechIntervals(result.noSpeechIntervals);
    setTotalVideoDurationSec(result.totalDurationSec);
    setMasterAudioMode('time_aligned');
    setExtraSpeakers([]);
    setMasterAudioBase64(null);
    setSynthesizedTurns([]);
    setSrtSubtitles('');
    setQuotaPausedInfo(null);

    // Protect imported table from automatic Gemini video analysis
    setIsImportedScript(true);
    setAutoExtractFromVideo(false);

    if (importFileName && !topic.trim()) {
      setTopic(importFileName.replace(/\.[^.]+$/, ''));
    }

    const assignedSummary = [
      sp1 && pickedVoice1 ? `${sp1.name} → ${pickedVoice1.name}` : null,
      sp2 && pickedVoice2 ? `${sp2.name} → ${pickedVoice2.name}` : null,
    ]
      .filter(Boolean)
      .join(', ');

    setImportErrors([]);
    setShowImportModal(false);
    setDialogueNotice(
      `✅ Импортирован готовый сценарий (${result.turns.length} реплик${
        result.noSpeechIntervals.length > 0
          ? `, ${result.noSpeechIntervals.length} вставок «Без слов»`
          : ''
      }). Назначены встроенные голоса: ${assignedSummary || 'проверьте Шаг 02'}. Загрузка видео не перезапишет таблицу.`
    );
  };

  // Pure client-side Script Export (.json / .csv) including manual edits & syncStatus, strictly without audio
  const handleExportScript = (format: 'json' | 'csv') => {
    if (turns.length === 0) {
      setDialogueNotice('Таблица реплик пуста — нечего экспортировать.');
      return;
    }

    const speakersMeta: ParsedSpeakerInfo[] = [
      { speakerId: 'HOST_1', name: speaker1Name, gender: speaker1Gender },
      { speakerId: 'HOST_2', name: speaker2Name, gender: speaker2Gender },
    ];

    const content =
      format === 'json'
        ? exportTurnsToJson(turns, speakersMeta, noSpeechIntervals)
        : exportTurnsToCsv(turns, speakersMeta);

    const mime =
      format === 'json' ? 'application/json;charset=utf-8' : 'text/csv;charset=utf-8';
    const blob = new Blob([format === 'csv' ? `\uFEFF${content}` : content], { type: mime });
    const url = URL.createObjectURL(blob);
    const baseName = (topic || 'dubbing-script')
      .trim()
      .replace(/[^\p{L}\p{N}_-]+/gu, '_')
      .slice(0, 60) || 'dubbing-script';

    const a = document.createElement('a');
    a.href = url;
    a.download = `${baseName}.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Guard toggling auto-extract when an imported or populated table exists
  const handleToggleAutoExtractFromVideo = (nextChecked: boolean) => {
    if (nextChecked && (isImportedScript || turns.length > 0)) {
      setShowReplaceTableModal(true);
      return;
    }
    setAutoExtractFromVideo(nextChecked);
  };

  const handleConfirmReplaceTableForVideo = () => {
    setIsImportedScript(false);
    setAutoExtractFromVideo(true);
    setShowReplaceTableModal(false);
  };

  // Parse & Translate any custom Russian Storyboard 1:1 via /api/podcast/parse-verbatim-storyboard
  const handleParseVerbatimStoryboard = async () => {
    if (!storyboardTextRu.trim()) {
      setDialogueNotice('Вставьте текст раскадровки с таймкодами!');
      return;
    }
    if (
      !requireAuth(
        () => {},
        'Разбор и перевод раскадровки 1:1 доступен только для зарегистрированных пользователей.'
      )
    )
      return;

    setIsParsingStoryboard(true);
    setDialogueNotice(null);
    try {
      const res = await authFetch('/api/podcast/parse-verbatim-storyboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storyboardText: storyboardTextRu,
          userClonedVoiceId: userClonedVoiceId || 'voice_17raj9ewke3g',
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Ошибка при разборе раскадровки');
      }

      const data = await res.json();
      if (Array.isArray(data.turns) && data.turns.length > 0) {
        const parsedCost =
          typeof data.estimatedCostUsd === 'number'
            ? data.estimatedCostUsd
            : Number(data.estimatedCostUsd?.totalUsd ?? 0.03);
        const safeCost = Number.isFinite(parsedCost) ? parsedCost : 0.03;
        const safeDuration = Number(data.totalVideoDurationSec || data.totalDurationSec || 60);
        const newTitle = data.title || topic || 'Дубляж по раскадровке 1:1';

        setTurns(data.turns);
        setNoSpeechIntervals(data.noSpeechIntervals || []);
        setEstimatedCostUsd(safeCost);
        setTotalVideoDurationSec(safeDuration);
        setMasterAudioMode('time_aligned');
        setTopic(newTitle);

        // Save strictly to the current user's personal history
        saveProjectToUserHistory({
          title: newTitle,
          storyboardTextRu,
          turns: data.turns,
          noSpeechIntervals: data.noSpeechIntervals || [],
          totalVideoDurationSec: safeDuration,
          estimatedCostUsd: safeCost,
        });

        // Auto-assign speakers based on detected gender
        if (Array.isArray(data.speakers) && data.speakers.length > 0) {
          const sp1 = data.speakers.find((s: any) => s.speakerId === 'HOST_1') || data.speakers[0];
          const sp2 = data.speakers.find((s: any) => s.speakerId === 'HOST_2') || data.speakers[1];

          if (sp1) {
            setSpeaker1Name(sp1.name);
            setSpeaker1Gender(sp1.gender === 'male' ? 'male' : 'female');
            if (sp1.description) setSpeaker1Role(sp1.description.slice(0, 60));
            if (sp1.gender === 'female') {
              const femVoice = voices.find((v) => v.id === 'aziza' || v.baseVoice === 'Kore' || v.gender === 'female');
              if (femVoice) setSpeaker1VoiceId(femVoice.id);
            } else {
              const maleVoice = voices.find((v) => v.isReplicatedVoice || v.id.includes('17raj9')) || voices.find((v) => v.gender === 'male');
              if (maleVoice) setSpeaker1VoiceId(maleVoice.id);
            }
          }
          setIsImportedScript(false);

          if (sp2) {
            setSpeaker2Name(sp2.name);
            if (sp2.description) setSpeaker2Role(sp2.description.slice(0, 60));
            setSpeaker2Gender(sp2.gender === 'female' ? 'female' : 'male');
            if (sp2.gender === 'male') {
              const clonedVoice = voices.find((v) => v.isReplicatedVoice || v.id.includes('17raj9')) || voices.find((v) => v.gender === 'male');
              if (clonedVoice) setSpeaker2VoiceId(clonedVoice.id);
            } else {
              const femVoice = voices.find((v) => v.id === 'aziza' || v.baseVoice === 'Kore' || v.gender === 'female');
              if (femVoice) setSpeaker2VoiceId(femVoice.id);
            }
          }

          if (data.speakers.length > 2) {
            setExtraSpeakers(data.speakers.slice(2));
          } else {
            setExtraSpeakers([]);
          }
        }

        setDialogueNotice(
          `✅ Раскадровка разобрана и переведена 1:1 (${data.turns.length} реплик, ${(data.noSpeechIntervals || []).length} вставок «Без слов»). Сохранено только в вашем аккаунте.`
        );
      }
    } catch (e: any) {
      setDialogueNotice(`Ошибка: ${e.message}`);
    } finally {
      setIsParsingStoryboard(false);
    }
  };

  const getStageLabelRu = (
    stage:
      | 'uploading_to_gemini'
      | 'gemini_processing'
      | 'storyboard'
      | 'translating'
      | 'done'
      | 'failed'
  ): string => {
    switch (stage) {
      case 'uploading_to_gemini':
        return 'Загрузка видео в Gemini Files API';
      case 'gemini_processing':
        return 'Обработка видео в Gemini Files API (ожидание ACTIVE)';
      case 'storyboard':
        return 'Создание JSON-раскадровки по таймкодам (gemini-4-argon)';
      case 'translating':
        return 'Живая адаптация и самопроверка перевода на узбекский (gemini-4-argon)';
      case 'done':
        return 'Готово';
      case 'failed':
        return 'Ошибка разбора';
      default:
        return 'Обработка...';
    }
  };

  const readLocalVideoDurationSec = (file: File): Promise<number> => {
    return new Promise((resolve) => {
      try {
        const tempVideo = document.createElement('video');
        tempVideo.preload = 'metadata';
        const blobUrl = URL.createObjectURL(file);
        const timer = window.setTimeout(() => {
          URL.revokeObjectURL(blobUrl);
          resolve(60);
        }, 4000);
        tempVideo.onloadedmetadata = () => {
          window.clearTimeout(timer);
          const dur = Number(tempVideo.duration);
          URL.revokeObjectURL(blobUrl);
          resolve(Number.isFinite(dur) && dur > 0 ? Math.round(dur * 10) / 10 : 60);
        };
        tempVideo.onerror = () => {
          window.clearTimeout(timer);
          URL.revokeObjectURL(blobUrl);
          resolve(60);
        };
        tempVideo.src = blobUrl;
      } catch {
        resolve(60);
      }
    });
  };

  // Upload Video File (up to 30 MB on client) + Background Gemini Job Polling (Points 1–9)
  const handleVideoFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Point 2: Strict 30 MB limit on client
    if (file.size > 30 * 1024 * 1024) {
      const limitMsg = 'Видео больше 30 МБ. Сожмите до 720p и загрузите снова';
      setDialogueNotice(limitMsg);
      setVideoJobStatus({
        jobId: '',
        stage: 'failed',
        progress: 0,
        error: limitMsg,
      });
      e.target.value = '';
      return;
    }

    if (
      !requireAuth(
        () => {},
        'Загрузка и ИИ-разбор видео доступны только авторизованным пользователям.'
      )
    ) {
      e.target.value = '';
      return;
    }

    const sizeMb = Number((file.size / (1024 * 1024)).toFixed(1));

    if (videoJobPollTimerRef.current) {
      window.clearTimeout(videoJobPollTimerRef.current);
      videoJobPollTimerRef.current = null;
    }

    // Create local object URL for immediate synchronized preview in browser
    if (uploadedVideoPreviewUrl) {
      URL.revokeObjectURL(uploadedVideoPreviewUrl);
    }
    const localUrl = URL.createObjectURL(file);
    setUploadedVideoPreviewUrl(localUrl);
    setUploadedVideoFileName(file.name);
    setUploadedVideoSizeMb(sizeMb);
    setMuxedVideoDownloadUrl(null);

    // Protect imported script (or populated table with auto-extract off) from automatic Gemini analysis
    const isStoryboardFieldEmpty = !storyboardTextRu.trim();
    const shouldRunAnalysis = shouldRunVideoAutoAnalysis({
      autoExtractFromVideo,
      isImportedScript,
      storyboardTextRu,
      turnsCount: turns.length,
    });

    setIsUploadingVideo(true);
    setVideoJobStatus(
      shouldRunAnalysis
        ? {
            jobId: 'starting',
            stage: 'uploading_to_gemini',
            progress: 5,
            error: null,
          }
        : null
    );
    setDialogueNotice(
      shouldRunAnalysis
        ? `Этап: Загрузка видео в Gemini Files API (5%)...`
        : `Отправка видео "${file.name}" (${sizeMb} МБ) для сборки MP4 (таблица реплик сохранена)...`
    );

    try {
      const localDurationSec = await readLocalVideoDurationSec(file);
      const formData = new FormData();
      formData.append('video', file);
      formData.append('generateStoryboardViaGemini', shouldRunAnalysis ? 'true' : 'false');
      formData.append('storyboardIsEmpty', shouldRunAnalysis && isStoryboardFieldEmpty ? 'true' : 'false');
      formData.append('videoDurationSec', String(localDurationSec));
      formData.append('userClonedVoiceId', userClonedVoiceId || 'voice_17raj9ewke3g');

      const res = await authFetch('/api/podcast/upload-dubbing-video', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message_ru || err.error || err.message || 'Ошибка загрузки видео');
      }

      const data = await res.json();
      const resolvedFileId = data.fileId || data.videoSessionId;
      setUploadedVideoFileId(resolvedFileId);

      // If no background job was requested (only possible when storyboardTextRu was already filled and user unchecked box)
      if (!data.jobId) {
        setIsUploadingVideo(false);
        setDialogueNotice(
          `Видео "${file.name}" (${sizeMb} МБ) сохранено для сборки MP4.`
        );
        return;
      }

      const jobId = String(data.jobId);
      setVideoJobStatus({
        jobId,
        stage: 'uploading_to_gemini',
        progress: 10,
        error: null,
      });

      // Point 3: Poll GET /api/podcast/dubbing-job/:jobId every 2.5 seconds
      const pollJob = async () => {
        try {
          const jobRes = await authFetch(`/api/podcast/dubbing-job/${encodeURIComponent(jobId)}`);
          const jobData = await jobRes.json().catch(() => ({}));

          if (!jobRes.ok || jobData.stage === 'failed') {
            const reason =
              jobData.error || 'не удалось разобрать видео';
            setVideoJobStatus({
              jobId,
              stage: 'failed',
              progress: 0,
              error: reason,
            });
            setIsUploadingVideo(false);
            // Point 7: Honest error message
            setDialogueNotice(
              `Раскадровка не получена: ${reason}. Вставьте текст раскадровки вручную или загрузите видео снова.`
            );
            return;
          }

          if (jobData.stage === 'done') {
            const resPayload = jobData.result || {};
            const sb = resPayload.parsedStoryboard || resPayload.storyboardResult;
            const turnsList = Array.isArray(sb?.turns) ? sb.turns : [];

            if (turnsList.length === 0) {
              const emptyReason = 'в видео не обнаружено речевых реплик';
              setVideoJobStatus({
                jobId,
                stage: 'failed',
                progress: 0,
                error: emptyReason,
              });
              setIsUploadingVideo(false);
              setDialogueNotice(
                `Раскадровка не получена: ${emptyReason}. Вставьте текст раскадровки вручную или загрузите видео снова.`
              );
              return;
            }

            const parsedCost =
              typeof sb.estimatedCostUsd === 'number'
                ? sb.estimatedCostUsd
                : Number(sb.estimatedCostUsd?.totalUsd ?? 0.05);
            const safeCost = Number.isFinite(parsedCost) ? parsedCost : 0.05;
            const safeDuration = Number(
              sb.totalVideoDurationSec || sb.totalDurationSec || resPayload.videoDurationSec || localDurationSec
            );

            setTurns(turnsList);
            setNoSpeechIntervals(
              (sb.noSpeechIntervals || []).map((ns: any) => ({
                timecode: ns.timecode,
                startSec: ns.startSec,
                endSec: ns.endSec,
                durationSec: ns.durationSec,
                description: ns.visualDescription || ns.description || ns.label || 'Без слов',
              }))
            );
            setEstimatedCostUsd(safeCost);
            setTotalVideoDurationSec(safeDuration);
            setMasterAudioMode('time_aligned');

            const genText =
              resPayload.generatedStoryboardText || sb.generatedStoryboardText || '';
            if (genText) {
              setStoryboardTextRu(genText);
            }

            // Assign detected speakers (male/female) to Speaker 1 & Speaker 2
            const detectedSpeakers = Array.isArray(sb.speakers) ? sb.speakers : [];
            const speakersCount =
              detectedSpeakers.length > 0
                ? detectedSpeakers.length
                : new Set(turnsList.map((t: any) => t.speakerId)).size || 1;

            if (detectedSpeakers.length > 0) {
              const sp1 =
                detectedSpeakers.find((s: any) => s.id === 'HOST_1' || s.speakerId === 'HOST_1') ||
                detectedSpeakers[0];
              const sp2 =
                detectedSpeakers.find((s: any) => s.id === 'HOST_2' || s.speakerId === 'HOST_2') ||
                detectedSpeakers[1];

              if (sp1) {
                setSpeaker1Name(sp1.name || (sp1.gender === 'female' ? 'Девушка (Ж)' : 'Мужчина (М)'));
                if (sp1.description) setSpeaker1Role(sp1.description.slice(0, 60));
                if (sp1.gender === 'female') {
                  const femVoice = voices.find(
                    (v) => v.id === 'aziza' || v.baseVoice === 'Kore' || v.gender === 'female'
                  );
                  if (femVoice) setSpeaker1VoiceId(femVoice.id);
                } else {
                  const maleVoice =
                    voices.find((v) => v.isReplicatedVoice || v.id.includes('17raj9')) ||
                    voices.find((v) => v.gender === 'male');
                  if (maleVoice) setSpeaker1VoiceId(maleVoice.id);
                }
              }

              if (sp2) {
                setSpeaker2Name(sp2.name || (sp2.gender === 'female' ? 'Девушка (Ж)' : 'Мужчина (М)'));
                if (sp2.description) setSpeaker2Role(sp2.description.slice(0, 60));
                setSpeaker2Gender(sp2.gender === 'female' ? 'female' : 'male');
                if (sp2.gender === 'male') {
                  const clonedVoice =
                    voices.find((v) => v.isReplicatedVoice || v.id.includes('17raj9')) ||
                    voices.find((v) => v.gender === 'male');
                  if (clonedVoice) setSpeaker2VoiceId(clonedVoice.id);
                } else {
                  const femVoice = voices.find(
                    (v) => v.id === 'aziza' || v.baseVoice === 'Kore' || v.gender === 'female'
                  );
                  if (femVoice) setSpeaker2VoiceId(femVoice.id);
                }
              }

              if (detectedSpeakers.length > 2) {
                setExtraSpeakers(
                  detectedSpeakers.slice(2).map((s: any, idx: number) => ({
                    speakerId: s.id || `HOST_${idx + 3}`,
                    name: s.name || `Спикер ${idx + 3}`,
                    gender: s.gender === 'female' ? 'female' : 'male',
                    voiceId: s.recommendedVoiceId || 'Fenrir',
                    baseVoice: s.recommendedBaseVoice || 'Fenrir',
                    description: s.description,
                  }))
                );
              } else {
                setExtraSpeakers([]);
              }
            }

            if (typeof resPayload.creditsRemaining === 'number') {
              syncCredits(resPayload.creditsRemaining);
            }

            saveProjectToUserHistory({
              title: file.name || topic || 'Видео-дубляж 1:1',
              storyboardTextRu: genText,
              turns: turnsList,
              noSpeechIntervals: sb.noSpeechIntervals || [],
              totalVideoDurationSec: safeDuration,
              estimatedCostUsd: safeCost,
            });

            setVideoJobStatus({
              jobId,
              stage: 'done',
              progress: 100,
              error: null,
              turnsCount: turnsList.length,
              speakersCount,
              elapsedSeconds: resPayload.elapsedSeconds,
              creditsDeducted: resPayload.creditsDeducted,
            });
            setIsUploadingVideo(false);

            // Point 7: Exact honest message on completion
            setDialogueNotice(
              `Раскадровка: ${turnsList.length} реплик, ${speakersCount} спикеров. Проверьте таблицу и нажмите Озвучить.`
            );
            return;
          }

          // Still in progress: uploading_to_gemini | gemini_processing | storyboard | translating
          const currentStage = jobData.stage || 'gemini_processing';
          const currentPct = Number(jobData.progress || 20);
          setVideoJobStatus({
            jobId,
            stage: currentStage,
            progress: currentPct,
            error: null,
          });
          setDialogueNotice(
            `Этап: ${getStageLabelRu(currentStage)} (${currentPct}%)...`
          );

          videoJobPollTimerRef.current = window.setTimeout(pollJob, 2500);
        } catch (pollErr: any) {
          const reason = pollErr?.message || 'потеряна связь с сервером';
          setVideoJobStatus({
            jobId,
            stage: 'failed',
            progress: 0,
            error: reason,
          });
          setIsUploadingVideo(false);
          setDialogueNotice(
            `Раскадровка не получена: ${reason}. Вставьте текст раскадровки вручную или загрузите видео снова.`
          );
        }
      };

      videoJobPollTimerRef.current = window.setTimeout(pollJob, 2500);
    } catch (err: any) {
      const reason = err?.message || 'ошибка отправки видео';
      setVideoJobStatus({
        jobId: '',
        stage: 'failed',
        progress: 0,
        error: reason,
      });
      setIsUploadingVideo(false);
      // Point 7: Honest message when storyboard is not obtained
      setDialogueNotice(
        `Раскадровка не получена: ${reason}. Вставьте текст раскадровки вручную или загрузите видео снова.`
      );
    }
  };

  // Re-synthesize a SINGLE turn (normal, "Быстрее" fast-pace without rewriting text, or manual "Короче") and re-stitch master audio
  const handleResynthesizeSingleTurn = async (
    turn: DialogueTurn,
    options?: { forceRephraseShorter?: boolean; forceFastPace?: boolean }
  ) => {
    if (!turn.text.trim()) return;
    const isShortening = Boolean(options?.forceRephraseShorter);
    const isFastPacing = Boolean(options?.forceFastPace);
    if (isShortening) {
      setShorteningTurnId(turn.id);
    } else if (isFastPacing) {
      setFastPacingTurnId(turn.id);
    } else {
      setResynthesizingTurnId(turn.id);
    }
    try {
      const host1VoicePayload = {
        voiceId: speaker1Profile?.voiceId || speaker1Profile?.id || 'aziza',
        name: speaker1Name,
        speakerName: speaker1Name,
        baseVoice: speaker1Profile?.baseVoice || (speaker1Gender === 'male' ? 'Charon' : 'Kore'),
        gender: speaker1Gender,
        tempo: speaker1Tempo,
      };
      const host2VoicePayload = {
        voiceId: speaker2Profile?.voiceId || speaker2Profile?.id || 'voice_17raj9ewke3g',
        name: speaker2Name,
        speakerName: speaker2Name,
        baseVoice: speaker2Profile?.baseVoice || (speaker2Gender === 'female' ? 'Kore' : 'Charon'),
        gender: speaker2Gender,
        tempo: speaker2Tempo,
        timbre: speaker2Timbre || speaker2Profile?.timbre,
      };

      const effectiveVideoDurationSec = Math.max(
        Number(totalVideoDurationSec) || 0,
        ...turns.map((t: any) => Number(t.endSec) || 0),
        ...noSpeechIntervals.map((n: any) => Number(n.endSec) || 0)
      );
      const effectiveMode =
        studioSourceMode === 'verbatim' || turns.some((t) => typeof t.startSec === 'number')
          ? 'time_aligned'
          : masterAudioMode;

      const currentTurnList = synthesizedTurns.length > 0 ? synthesizedTurns : turns;
      // Avoid sending huge base64 arrays back to the server; re-stitch locally in browser!
      const res = await authFetch('/api/podcast/synthesize-single-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          turn,
          allTurns: [],
          forceRephraseShorter: isShortening,
          forceFastPace: isFastPacing,
          host1Voice: host1VoicePayload,
          host2Voice: host2VoicePayload,
          speakers: extraSpeakers,
          masterAudioMode: effectiveMode,
          totalVideoDurationSec: effectiveVideoDurationSec,
        }),
      });

      if (!res.ok) {
        const errMsg = await readHttpErrorMessage(res, 'Ошибка переозвучки реплики');
        throw new Error(errMsg);
      }

      const data = await res.json();
      if (data.turn) {
        const updatedSynthesized =
          currentTurnList.length > 0
            ? currentTurnList.map((st) => (st.id === turn.id ? { ...st, ...data.turn } : st))
            : turns.map((t) => (t.id === turn.id ? { ...t, ...data.turn } : t));

        // Re-stitch locally in browser if all turns (or existing synthesized turns) have audioBase64
        const readyForStitch = updatedSynthesized.filter((st) => Boolean(st.audioBase64));
        let finalMergedTurns = updatedSynthesized;
        if (readyForStitch.length === updatedSynthesized.length && readyForStitch.length > 0) {
          const stitchData = stitchDialogueTurnsClient({
            turns: updatedSynthesized,
            masterAudioMode: effectiveMode,
            totalVideoDurationSec: effectiveVideoDurationSec,
          });
          setMasterAudioBase64(stitchData.masterAudioBase64);
          setTotalDuration(stitchData.totalDurationSeconds || 0);
          finalMergedTurns = stitchData.turns;
          if (stitchData.srtSubtitles) setSrtSubtitles(stitchData.srtSubtitles);
        }

        const updatedMatched =
          finalMergedTurns.find((st) => st.id === turn.id) || { ...turn, ...data.turn };

        setSynthesizedTurns(finalMergedTurns);
        setTurns((prev) =>
          prev.map((t) => {
            const matched = finalMergedTurns.find((st) => st.id === t.id);
            if (!matched) return t;
            return {
              ...t,
              text: t.id === turn.id ? matched.text || t.text : t.text,
              fitStepApplied: matched.fitStepApplied ?? t.fitStepApplied,
              originalDurationSec: matched.originalDurationSec ?? t.originalDurationSec,
              dubbedDurationSec: matched.dubbedDurationSec ?? t.dubbedDurationSec,
              atempoApplied: matched.atempoApplied ?? t.atempoApplied,
              rephraseAttempts: matched.rephraseAttempts ?? t.rephraseAttempts,
              syncStatus: matched.syncStatus ?? t.syncStatus,
              qa: matched.qa ?? t.qa,
              qaReason: matched.qaReason,
              slicingMethod: matched.slicingMethod ?? t.slicingMethod,
              shiftedStartBySec: matched.shiftedStartBySec ?? t.shiftedStartBySec,
              needsShorten: matched.needsShorten ?? t.needsShorten,
            };
          })
        );

        // Persist updated single turn audio + diagnostics to IndexedDB cache
        await persistTurnsAudioToIndexedDb([updatedMatched], new Map([[turn.id, turn]]));

        // Play the newly synthesized turn immediately
        if (updatedMatched.audioBase64) {
          playSingleTurn(turn.id, updatedMatched.audioBase64);
        }

        setDialogueNotice(
          isFastPacing
            ? `⚡ Реплика переозвучена в быстром темпе (1 вызов TTS, текст сохранён).`
            : isShortening
            ? `✂️ Реплика сокращена и переозвучена (1 вызов TTS).`
            : `✅ Реплика перегенерирована (1 вызов TTS) и мастер-дорожка обновлена.`
        );
      }
    } catch (e: any) {
      setDialogueNotice(`Ошибка переозвучки: ${e.message}`);
    } finally {
      setResynthesizingTurnId(null);
      setFastPacingTurnId(null);
      setShorteningTurnId(null);
      refreshTtsQuota();
    }
  };

  // Re-synthesize an entire SUB-BLOCK with bypassCache: true (updates server cache, IndexedDB, and re-stitches locally)
  const handleResynthesizeSubBlock = async (turnIndex: number) => {
    const targetSub = plannedSubBlocks.find(
      (sb) => turnIndex >= sb.startTurnIndex && turnIndex <= sb.endTurnIndex
    );
    if (!targetSub || targetSub.turns.length === 0) return;

    setResynthesizingSubBlockIndex(targetSub.globalSubBlockIndex);
    try {
      const effectiveVideoDurationSec = Math.max(
        Number(totalVideoDurationSec) || 0,
        ...turns.map((t: any) => Number(t.endSec) || 0),
        ...noSpeechIntervals.map((n: any) => Number(n.endSec) || 0)
      );
      const effectiveMode =
        studioSourceMode === 'verbatim' || turns.some((t) => typeof t.startSec === 'number')
          ? 'time_aligned'
          : masterAudioMode;

      const host1VoicePayload = {
        voiceId: speaker1Profile?.voiceId || speaker1Profile?.id || 'aziza',
        name: speaker1Name,
        speakerName: speaker1Name,
        baseVoice: speaker1Profile?.baseVoice || (speaker1Gender === 'male' ? 'Charon' : 'Kore'),
        gender: speaker1Gender,
        tempo: speaker1Tempo,
        timbre: speaker1Profile?.timbre,
        customPersonaPrompt: speaker1Profile?.customPersonaPrompt,
        role: speaker1Role,
        ...(speaker1Profile?.isReplicatedVoice
          ? {
              replicatedVoiceConfig: {
                voiceSampleAudio: speaker1Profile.sampleAudioUrl,
                consentAudio: (speaker1Profile as any).consentAudio,
                voiceConsentSignature: (speaker1Profile as any).voiceConsentSignature,
              },
            }
          : {}),
      };
      const host2VoicePayload = {
        voiceId: speaker2Profile?.voiceId || speaker2Profile?.id || 'voice_17raj9ewke3g',
        name: speaker2Name,
        speakerName: speaker2Name,
        baseVoice: speaker2Profile?.baseVoice || (speaker2Gender === 'female' ? 'Kore' : 'Charon'),
        gender: speaker2Gender,
        tempo: speaker2Tempo,
        timbre: speaker2Timbre || speaker2Profile?.timbre,
        customPersonaPrompt: speaker2Profile?.customPersonaPrompt,
        role: speaker2Role,
        ...(speaker2Profile?.isReplicatedVoice
          ? {
              replicatedVoiceConfig: {
                voiceSampleAudio: speaker2Profile.sampleAudioUrl,
                consentAudio: (speaker2Profile as any).consentAudio,
                voiceConsentSignature: (speaker2Profile as any).voiceConsentSignature,
              },
            }
          : {}),
      };

      // Enrich sub-block turns with accurate gapAfterSec against the full script
      const subTurnsEnriched = targetSub.turns.map((t, localIdx) => {
        const globalIdx = targetSub.startTurnIndex + localIdx;
        const nextStartSec =
          globalIdx + 1 < turns.length && typeof turns[globalIdx + 1]?.startSec === 'number'
            ? turns[globalIdx + 1].startSec!
            : effectiveVideoDurationSec > (t.endSec || 0)
            ? effectiveVideoDurationSec
            : t.endSec || 0;
        const gapAfterSec = Math.max(
          0,
          Math.round((nextStartSec - (t.endSec || 0)) * 100) / 100
        );
        return {
          ...t,
          gapAfterSec,
          nextTurnStartSec: nextStartSec,
        };
      });

      const res = await authFetch('/api/podcast/synthesize-dialogue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          turns: subTurnsEnriched,
          skipMasterStitch: true,
          bypassCache: true,
          host1Voice: host1VoicePayload,
          host2Voice: host2VoicePayload,
          speakers: extraSpeakers,
          masterAudioMode: effectiveMode,
          totalVideoDurationSec: effectiveVideoDurationSec,
        }),
      });

      if (!res.ok) {
        const errMsg = await readHttpErrorMessage(res, 'Ошибка перегенерации подблока');
        throw new Error(errMsg);
      }

      const data = await res.json();
      const refreshedTurns: DialogueTurn[] = Array.isArray(data.turns) ? data.turns : [];
      if (refreshedTurns.length === 0) {
        throw new Error('Сервер не вернул озвученные реплики подблока');
      }

      const refreshedById = new Map<string, DialogueTurn>(
        refreshedTurns.map((rt) => [
          rt.id,
          { ...rt, subBlockIndex: targetSub.globalSubBlockIndex },
        ])
      );

      // Persist refreshed turns to IndexedDB
      await persistTurnsAudioToIndexedDb(
        Array.from(refreshedById.values()),
        new Map(subTurnsEnriched.map((t) => [t.id, t]))
      );

      // Merge into current synthesized turns
      const existingById = new Map<string, DialogueTurn>();
      for (const st of synthesizedTurns) {
        if (st.id) existingById.set(st.id, st);
      }
      for (const [id, rt] of refreshedById.entries()) {
        existingById.set(id, rt);
      }

      const orderedMerged = turns
        .map((t) => existingById.get(t.id) || t)
        .filter((t) => Boolean(t.audioBase64));

      let finalTurnsList: DialogueTurn[] = turns.map((t) => existingById.get(t.id) || t);

      if (orderedMerged.length > 0) {
        const stitchData = stitchDialogueTurnsClient({
          turns: orderedMerged,
          masterAudioMode: effectiveMode,
          totalVideoDurationSec: effectiveVideoDurationSec,
        });
        setMasterAudioBase64(stitchData.masterAudioBase64);
        setTotalDuration(stitchData.totalDurationSeconds || 0);
        if (stitchData.srtSubtitles) setSrtSubtitles(stitchData.srtSubtitles);

        const stitchedById = new Map<string, DialogueTurn>(
          stitchData.turns.map((st) => [st.id, st])
        );
        finalTurnsList = turns.map((t) => stitchedById.get(t.id) || existingById.get(t.id) || t);
        setSynthesizedTurns(stitchData.turns);
      } else {
        setSynthesizedTurns(Array.from(existingById.values()));
      }

      setTurns((prev) =>
        prev.map((pt) => {
          const matched = finalTurnsList.find((ft) => ft.id === pt.id);
          return matched
            ? {
                ...pt,
                fitStepApplied: matched.fitStepApplied ?? pt.fitStepApplied,
                originalDurationSec: matched.originalDurationSec ?? pt.originalDurationSec,
                dubbedDurationSec: matched.dubbedDurationSec ?? pt.dubbedDurationSec,
                atempoApplied: matched.atempoApplied ?? pt.atempoApplied,
                syncStatus: matched.syncStatus ?? pt.syncStatus,
                qa: matched.qa ?? pt.qa,
                qaReason: matched.qaReason,
                slicingMethod: matched.slicingMethod ?? pt.slicingMethod,
                shiftedStartBySec: matched.shiftedStartBySec ?? pt.shiftedStartBySec,
                needsShorten: matched.needsShorten ?? pt.needsShorten,
                subBlockIndex: matched.subBlockIndex ?? pt.subBlockIndex,
              }
            : pt;
        })
      );

      setDialogueNotice(
        `✅ Подблок #${targetSub.globalSubBlockIndex + 1} (${targetSub.startTimecode}–${targetSub.endTimecode}, ${refreshedTurns.length} репл.) перегенерирован без кэша (${data.ttsCallsUsed ?? 1} выз. TTS) и мастер-дорожка пересобрана локально.`
      );
    } catch (e: any) {
      setDialogueNotice(`Ошибка перегенерации подблока: ${e.message}`);
    } finally {
      setResynthesizingSubBlockIndex(null);
      refreshTtsQuota();
    }
  };

  // Mux Dubbed Master Audio with Uploaded Video into MP4 via FFmpeg (chunked 8 MB WAV upload)
  const handleMuxDubbedVideoMp4 = async () => {
    if (!uploadedVideoFileId || !masterAudioBase64) {
      setDialogueNotice('Сначала загрузите видеофайл в Шаге 01 и синтезируйте озвучку!');
      return;
    }

    setIsMuxingVideo(true);
    setDialogueNotice('Подготовка мастер-аудио к загрузке частями для сборки MP4...');
    try {
      const speechIntervals = (synthesizedTurns.length > 0 ? synthesizedTurns : turns)
        .filter((t) => typeof t.startSec === 'number' && typeof t.endSec === 'number')
        .map((t) => ({
          startSec: Number(t.startSec),
          endSec: Number(t.endSec),
        }));

      // Upload master WAV in 8 MB binary chunks so 20+ min (~55 MB) tracks stay well under Cloud Run's 32 MB limit
      const wavBytes = decodeBase64ToBytes(masterAudioBase64);
      const CHUNK_SIZE_BYTES = 8 * 1024 * 1024;
      const totalChunks = Math.max(1, Math.ceil(wavBytes.byteLength / CHUNK_SIZE_BYTES));
      const uploadId = `mux_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

      for (let index = 0; index < totalChunks; index++) {
        const start = index * CHUNK_SIZE_BYTES;
        const end = Math.min(wavBytes.byteLength, start + CHUNK_SIZE_BYTES);
        const chunkSlice = wavBytes.slice(start, end);

        setDialogueNotice(
          `Загрузка аудиодорожки для MP4: часть ${index + 1}/${totalChunks} (${(wavBytes.byteLength / (1024 * 1024)).toFixed(1)} МБ)...`
        );

        const chunkForm = new FormData();
        chunkForm.append('uploadId', uploadId);
        chunkForm.append('index', String(index));
        chunkForm.append('total', String(totalChunks));
        chunkForm.append(
          'chunk',
          new Blob([chunkSlice], { type: 'application/octet-stream' }),
          `chunk_${index}.part`
        );

        const chunkRes = await authFetch('/api/podcast/mux-audio-chunk', {
          method: 'POST',
          body: chunkForm,
        });

        if (!chunkRes.ok) {
          throw new Error(
            await readHttpErrorMessage(
              chunkRes,
              `Ошибка загрузки части аудио ${index + 1}/${totalChunks}`
            )
          );
        }
      }

      setDialogueNotice(
        'Сборка финального видео MP4 с узбекским дубляжом и приглушением фона (FFmpeg)...'
      );

      const res = await authFetch('/api/podcast/mux-dubbed-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId: uploadedVideoFileId,
          uploadId,
          duckingMode,
          speechIntervals,
        }),
      });

      if (!res.ok) {
        throw new Error(await readHttpErrorMessage(res, 'Ошибка сборки видео MP4'));
      }

      const data = await res.json();
      if (data.downloadUrl) {
        setMuxedVideoDownloadUrl(data.downloadUrl);
        const a = document.createElement('a');
        a.href = data.downloadUrl;
        a.download = `uzbek-dubbing-${Date.now()}.mp4`;
        a.click();
        setDialogueNotice('✅ Готовое видео MP4 с узбекским дубляжом успешно собрано и скачивается!');
      }
    } catch (e: any) {
      setDialogueNotice(`Ошибка сборки MP4: ${e.message}`);
    } finally {
      setIsMuxingVideo(false);
    }
  };

  // Download .SRT Subtitles (Point 8: Disabled when turns.length === 0)
  const handleDownloadSrt = () => {
    if (turns.length === 0) return;
    let srtContent = srtSubtitles;
    if (!srtContent) {
      const fmtSrt = (sec: number) => {
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = Math.floor(sec % 60);
        const ms = Math.round((sec - Math.floor(sec)) * 1000);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
      };
      srtContent = turns
        .map((t, i) => {
          const st = typeof t.startSec === 'number' ? t.startSec : i * 4;
          const et = typeof t.endSec === 'number' ? t.endSec : st + 3.5;
          const clean = t.text.replace(/<\/?[a-zA-Z_\s-]+>/g, '').trim();
          return `${i + 1}\n${fmtSrt(st)} --> ${fmtSrt(et)}\n[${t.speakerName}]: ${clean}\n`;
        })
        .join('\n');
    }

    if (!srtContent.trim()) return;
    const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `uzbek-dubbing-subtitles-${Date.now()}.srt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Generate AI dialogue script by topic (up to 10 min)
  const handleGenerateInterview = async () => {
    if (
      !requireAuth(
        () => {},
        lang === 'uz'
          ? "2 kishilik intervyu ssenariysini yaratish faqat ro'yxatdan o'tgan foydalanuvchilar uchun ochiq."
          : 'Генерация диалога доступна только для зарегистрированных пользователей.'
      )
    )
      return;

    setIsGeneratingScript(true);
    try {
      const res = await authFetch('/api/podcast/generate-interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          host1Name: speaker1Name,
          host1Role: speaker1Role || 'Boshlovchi',
          host2Name: speaker2Name,
          host2Role: speaker2Role || 'Mehmon',
          tone,
          targetDuration,
        }),
      });

      if (!res.ok) throw new Error('Intervyu yaratishda xatolik');
      const data = await res.json();
      if (Array.isArray(data.turns) && data.turns.length > 0) {
        setMasterAudioMode('continuous');
        setNoSpeechIntervals([]);
        const mappedTurns = data.turns.map((t: any, idx: number) => ({
          id: `turn-${idx + 1}-${Date.now()}`,
          speakerId: t.speakerId === 'HOST_2' ? 'HOST_2' : 'HOST_1',
          speakerName: t.speakerName || (t.speakerId === 'HOST_2' ? speaker2Name : speaker1Name),
          text: t.text,
          emotion: t.emotion || 'neutral',
        }));
        setTurns(mappedTurns);
        saveProjectToUserHistory({
          title: topic || 'ИИ-Интервью',
          storyboardTextRu: '',
          turns: mappedTurns,
          noSpeechIntervals: [],
        });
      }
    } catch (e: any) {
      setDialogueNotice(`Xatolik: ${e.message}`);
    } finally {
      setIsGeneratingScript(false);
    }
  };

  const handleExpandInterview = async () => {
    setIsExpandingDialogue(true);
    try {
      const res = await authFetch('/api/podcast/expand-interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          host1Name: speaker1Name,
          host2Name: speaker2Name,
          existingTurns: turns,
          subtopic: 'Keyingi chuqur savollar, bahsli faktlar va hayotiy misollar',
        }),
      });

      if (!res.ok) throw new Error('Intervyuni kengaytirishda xato');
      const data = await res.json();
      if (Array.isArray(data.newTurns) && data.newTurns.length > 0) {
        const added = data.newTurns.map((t: any, idx: number) => ({
          id: `turn-exp-${Date.now()}-${idx}`,
          speakerId: t.speakerId === 'HOST_2' ? 'HOST_2' : 'HOST_1',
          speakerName: t.speakerName || (t.speakerId === 'HOST_2' ? speaker2Name : speaker1Name),
          text: t.text,
          emotion: t.emotion || 'thoughtful',
        }));
        setTurns((prev) => [...prev, ...added]);
      }
    } catch (e: any) {
      setDialogueNotice(`Xatolik: ${e.message}`);
    } finally {
      setIsExpandingDialogue(false);
    }
  };

  const addTurn = () => {
    const lastTurn = turns[turns.length - 1];
    const nextSpeaker = lastTurn?.speakerId === 'HOST_1' ? 'HOST_2' : 'HOST_1';
    const nextName = nextSpeaker === 'HOST_1' ? speaker1Name : speaker2Name;
    const nextStart = typeof lastTurn?.endSec === 'number' ? lastTurn.endSec + 1 : undefined;
    const nextEnd = typeof nextStart === 'number' ? nextStart + 4 : undefined;

    setTurns([
      ...turns,
      {
        id: `turn-${Date.now()}`,
        speakerId: nextSpeaker,
        speakerName: nextName,
        text: '',
        emotion: 'neutral',
        startSec: nextStart,
        endSec: nextEnd,
        durationSec: nextStart !== undefined && nextEnd !== undefined ? nextEnd - nextStart : undefined,
      },
    ]);
  };

  const removeTurn = (id: string) => {
    if (turns.length <= 1) {
      setDialogueNotice('Должна остаться хотя бы 1 реплика!');
      return;
    }
    setTurns(turns.filter((t) => t.id !== id));
  };

  const updateTurnText = (id: string, text: string) => {
    setTurns(turns.map((t) => (t.id === id ? { ...t, text } : t)));
  };

  const toggleTurnSpeaker = (id: string) => {
    setTurns(
      turns.map((t) => {
        if (t.id !== id) return t;
        const newSpeakerId = t.speakerId === 'HOST_1' ? 'HOST_2' : 'HOST_1';
        return {
          ...t,
          speakerId: newSpeakerId,
          speakerName: newSpeakerId === 'HOST_1' ? speaker1Name : speaker2Name,
        };
      })
    );
  };

  const handleSmartDiarizeTurns = async () => {
    if (turns.length === 0) return;
    setIsDiarizing(true);
    try {
      const res = await authFetch('/api/podcast/smart-diarize-turns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          turns,
          host1Name: speaker1Name || 'Спикер 1',
          host2Name: speaker2Name || 'Спикер 2',
        }),
      });

      if (!res.ok) throw new Error('Diarizatsiyada xatolik yuz berdi');
      const data = await res.json();
      if (Array.isArray(data.turns)) {
        setTurns(data.turns);
        setDialogueNotice(
          `✅ Все ${data.turns.length} реплик успешно распределены между спикерами!`
        );
      }
    } catch (e: any) {
      setDialogueNotice(`Xatolik: ${e.message}`);
    } finally {
      setIsDiarizing(false);
    }
  };

  const handleInvertAllSpeakers = () => {
    setTurns((prev) =>
      prev.map((t) => {
        const isH1 = t.speakerId === 'HOST_1';
        return {
          ...t,
          speakerId: isH1 ? 'HOST_2' : 'HOST_1',
          speakerName: isH1 ? speaker2Name : speaker1Name,
        };
      })
    );
  };

  const handleLoadYugayBurkhanovPreset = () => {
    setTopic(YUGAY_BURKHANOV_METADATA.title);
    setSpeaker1Name(YUGAY_BURKHANOV_METADATA.host1Name);
    setSpeaker1Role(YUGAY_BURKHANOV_METADATA.host1Role);
    setSpeaker1VoiceId(YUGAY_BURKHANOV_METADATA.host1VoiceId);
    setSpeaker2Name(YUGAY_BURKHANOV_METADATA.host2Name);
    setSpeaker2Role(YUGAY_BURKHANOV_METADATA.host2Role);
    setSpeaker2VoiceId(YUGAY_BURKHANOV_METADATA.host2VoiceId);
    setSpeaker2Gender('male');
    setSpeaker2GenderFilter('all');
    setTurns(YUGAY_BURKHANOV_TURNS);
    setNoSpeechIntervals([]);
    setYoutubeVideoTitle(YUGAY_BURKHANOV_METADATA.title);
    setYoutubeAuthorName('Arthur Yugay');
    setYoutubeVideoId(YUGAY_BURKHANOV_METADATA.videoId);
    setYoutubeEmbedUrl(YUGAY_BURKHANOV_METADATA.embedUrl);
    setMasterAudioBase64(null);
    setSynthesizedTurns([]);
    setDialogueNotice(
      '✅ Загружено интервью «Артур Югай и Аюбхон Бурханов»: 73 реплики, 4 главы, точный перевод по хронометражу!'
    );
  };

  const handleCleanAllTurns = () => {
    setTurns((prev) =>
      prev.map((t) => ({
        ...t,
        text: stripAllStageConditions(t.text),
      }))
    );
  };

  const handleCleanSingleTurn = (turnId: string) => {
    setTurns((prev) =>
      prev.map((t) =>
        t.id === turnId ? { ...t, text: stripAllStageConditions(t.text) } : t
      )
    );
  };

  const handleInsertTagToTurn = (turnId: string, tag: string) => {
    setTurns((prev) =>
      prev.map((t) => {
        if (t.id !== turnId) return t;
        const current = t.text || '';
        const space = current && !current.endsWith(' ') ? ' ' : '';
        return { ...t, text: `${current}${space}${tag} ` };
      })
    );
  };

  const handleImportYouTubeInterview = async () => {
    const hasUrl = Boolean(youtubeImportUrl.trim());
    const hasManual = Boolean(manualTranscriptText.trim());

    if (!hasUrl && !hasManual) {
      setYoutubeImportError(
        'Пожалуйста, вставьте субтитры (.SRT / .VTT / текст) или ссылку ниже!'
      );
      return;
    }

    if (
      !requireAuth(
        () => {},
        'Импорт субтитров доступен только авторизованным пользователям.'
      )
    ) {
      return;
    }

    // If user pasted a Russian storyboard with Видеоряд:/Интонация:/Текст:, route directly to Verbatim 1:1 parser!
    if (
      hasManual &&
      /(?:Видеоряд:|Интонация:|Текст:|\d{1,2}:\d{2}\s*[–—-]\s*\d{1,2}:\d{2}\s*\|)/i.test(manualTranscriptText)
    ) {
      setStoryboardTextRu(manualTranscriptText);
      setStudioSourceMode('verbatim');
      await handleParseVerbatimStoryboard();
      return;
    }

    setIsImportingYoutube(true);
    setYoutubeImportError(null);
    setYoutubeImportNotice(
      'Обработка субтитров и перевод в двухголосый диалог...'
    );

    try {
      const res = await authFetch('/api/podcast/import-youtube-interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: youtubeImportUrl.trim(),
          manualTranscript: manualTranscriptText.trim(),
          targetLanguage: youtubeTargetLang,
          host1Name: speaker1Name || 'Boshlovchi',
          host2Name: speaker2Name || 'Mehmon',
          tone: 'Jonli va intellektual suhbat',
        }),
      });

      if (!res.ok) {
        let msg = 'Ошибка импорта субтитров';
        try {
          const errData = await res.json();
          msg = errData.message_ru || errData.error || errData.message || msg;
        } catch {}
        throw new Error(msg);
      }

      const data = await res.json();
      if (Array.isArray(data.turns) && data.turns.length > 0) {
        setTurns(
          data.turns.map((t: any, idx: number) => ({
            id: t.id || `yt-turn-${idx + 1}-${Date.now()}`,
            speakerId: t.speakerId === 'HOST_2' ? 'HOST_2' : 'HOST_1',
            speakerName: t.speakerName || (t.speakerId === 'HOST_2' ? speaker2Name : speaker1Name),
            text: t.text,
            originalText: t.originalText,
            timecode: t.timecode,
            startSec: t.startSec,
            endSec: t.endSec,
            durationSec: t.durationSec,
            chapter: t.chapter,
            emotion: t.emotion || 'thoughtful',
          }))
        );
        if (data.videoId) setYoutubeVideoId(data.videoId);
        if (data.embedUrl) setYoutubeEmbedUrl(data.embedUrl);
        if (data.videoTitle) setYoutubeVideoTitle(data.videoTitle);
        if (data.authorName) setYoutubeAuthorName(data.authorName);
        setTopic(data.title || data.videoTitle || 'Импорт субтитров');
        setYoutubeImportError(null);
        setYoutubeImportNotice(
          `✅ Успешно импортировано и переведено ${data.turns.length} реплик по таймкодам!`
        );
      } else {
        throw new Error('Не удалось извлечь реплики');
      }
    } catch (e: any) {
      setYoutubeImportNotice(null);
      setYoutubeImportError(e.message);
      setShowManualTranscriptInput(true);
    } finally {
      setIsImportingYoutube(false);
    }
  };

  const handleStopSynthesis = async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    if (synthesizedTurns.length > 0) {
      try {
        setBatchProgress((prev) =>
          prev
            ? {
                ...prev,
                statusText: 'Остановлено. Склейка уже готовых реплик по таймкодам...',
              }
            : null
        );
        const effectiveStopDurationSec = Math.max(
          Number(totalVideoDurationSec) || 0,
          ...turns.map((t: any) => Number(t.endSec) || 0),
          ...noSpeechIntervals.map((n: any) => Number(n.endSec) || 0)
        );
        const effectiveStopMode =
          studioSourceMode === 'verbatim' || turns.some((t) => typeof t.startSec === 'number')
            ? 'time_aligned'
            : masterAudioMode;
        const stitchData = stitchDialogueTurnsClient({
          turns: synthesizedTurns,
          masterAudioMode: effectiveStopMode,
          totalVideoDurationSec: effectiveStopDurationSec,
        });
        setMasterAudioBase64(stitchData.masterAudioBase64);
        setTotalDuration(stitchData.totalDurationSeconds || 0);
        if (stitchData.srtSubtitles) setSrtSubtitles(stitchData.srtSubtitles);
      } catch (err) {
        console.warn('Stitch on stop error:', err);
      }
    }
    setIsSynthesizing(false);
    setBatchProgress(null);
  };

  // Synthesize Full Dialogue (macro-blocks 20-25 turns, strict timecode sync, 429 pause/resume)
  const handleSynthesizeDialogue = async (resumeOnlyRemaining = false, bypassVoiceConfirm = false) => {
    if (
      !requireAuth(
        () => {},
        'Синтез диалога доступен только для зарегистрированных пользователей.'
      )
    )
      return;

    const invalidTurn = turns.find((t) => !t.text.trim());
    if (invalidTurn) {
      setDialogueNotice('Все реплики должны содержать текст!');
      return;
    }

    if (!bypassVoiceConfirm && synthesisVoiceWarnings.length > 0) {
      setPendingSynthResumeFlag(resumeOnlyRemaining);
      setShowVoiceWarningModal(true);
      return;
    }

    setIsSynthesizing(true);
    setQuotaPausedInfo(null);
    setMuxedVideoDownloadUrl(null);
    abortControllerRef.current = new AbortController();

    const effectiveVideoDurationSec = Math.max(
      Number(totalVideoDurationSec) || 0,
      ...turns.map((t: any) => Number(t.endSec) || 0),
      ...noSpeechIntervals.map((n: any) => Number(n.endSec) || 0)
    );
    const effectiveMode =
      studioSourceMode === 'verbatim' || turns.some((t) => typeof t.startSec === 'number')
        ? 'time_aligned'
        : masterAudioMode;
    if (effectiveMode === 'time_aligned' && masterAudioMode !== 'time_aligned') {
      setMasterAudioMode('time_aligned');
    }

    const host1VoicePayload = {
      voiceId: speaker1Profile?.voiceId || speaker1Profile?.id || 'aziza',
      name: speaker1Name,
      speakerName: speaker1Name,
      baseVoice: speaker1Profile?.baseVoice || (speaker1Gender === 'male' ? 'Charon' : 'Kore'),
      gender: speaker1Gender,
      tempo: speaker1Tempo,
      timbre: speaker1Profile?.timbre,
      customPersonaPrompt: speaker1Profile?.customPersonaPrompt,
      role: speaker1Role,
      ...(speaker1Profile?.isReplicatedVoice
        ? {
            replicatedVoiceConfig: {
              voiceSampleAudio: speaker1Profile.sampleAudioUrl,
              consentAudio: (speaker1Profile as any).consentAudio,
              voiceConsentSignature: (speaker1Profile as any).voiceConsentSignature,
            },
          }
        : {}),
    };
    const host2VoicePayload = {
      voiceId: speaker2Profile?.voiceId || speaker2Profile?.id || 'voice_17raj9ewke3g',
      name: speaker2Name,
      speakerName: speaker2Name,
      baseVoice: speaker2Profile?.baseVoice || (speaker2Gender === 'female' ? 'Kore' : 'Charon'),
      gender: speaker2Gender,
      tempo: speaker2Tempo,
      timbre: speaker2Timbre || speaker2Profile?.timbre,
      customPersonaPrompt: speaker2Profile?.customPersonaPrompt,
      role: speaker2Role,
      ...(speaker2Profile?.isReplicatedVoice
        ? {
            replicatedVoiceConfig: {
              voiceSampleAudio: speaker2Profile.sampleAudioUrl,
              consentAudio: (speaker2Profile as any).consentAudio,
              voiceConsentSignature: (speaker2Profile as any).voiceConsentSignature,
            },
          }
        : {}),
    };

    // Enrich turns with gapAfterSec & nextTurnStartSec across the full timeline before batching
    const enrichedTurns = turns.map((t, idx) => {
      const nextStartSec =
        idx + 1 < turns.length && typeof turns[idx + 1]?.startSec === 'number'
          ? turns[idx + 1].startSec!
          : effectiveVideoDurationSec > (t.endSec || 0)
          ? effectiveVideoDurationSec
          : t.endSec || 0;
      const gapAfterSec =
        typeof t.gapAfterSec === 'number' && t.gapAfterSec >= 0
          ? t.gapAfterSec
          : Math.max(0, Math.round((nextStartSec - (t.endSec || 0)) * 100) / 100);
      return {
        ...t,
        gapAfterSec,
        nextTurnStartSec: nextStartSec,
      };
    });

    // Hydrate already synthesized turns from IndexedDB (project + turnId + hash(text, voice, style))
    // and in-memory state when resuming, so unchanged turns never re-spend TTS quota
    const existingById = new Map<string, DialogueTurn>();
    const sourceTurnsById = new Map<string, DialogueTurn>(enrichedTurns.map((t) => [t.id, t]));
    const cacheDescriptors = enrichedTurns.map((t) => ({
      turn: t,
      desc: getTurnCacheDescriptor(t),
    }));
    const dbCachedMap = await getDialogueTurnAudioByKeys(
      cacheDescriptors.map((d) => d.desc.cacheKey)
    );
    for (const { turn, desc } of cacheDescriptors) {
      const cached = dbCachedMap.get(desc.cacheKey);
      if (cached) {
        existingById.set(turn.id, {
          ...turn,
          audioBase64: cached.audioBase64,
          durationSeconds: cached.durationSeconds ?? turn.durationSeconds,
          originalDurationSec: cached.originalDurationSec ?? turn.originalDurationSec,
          dubbedDurationSec: cached.dubbedDurationSec ?? turn.dubbedDurationSec,
          atempoApplied: cached.atempoApplied ?? turn.atempoApplied,
          rephraseAttempts: cached.rephraseAttempts ?? turn.rephraseAttempts,
          fitStepApplied: cached.fitStepApplied ?? turn.fitStepApplied,
          syncStatus: cached.syncStatus ?? turn.syncStatus,
          qa: cached.qa ?? turn.qa,
          qaReason: cached.qaReason ?? turn.qaReason,
          slicingMethod: cached.slicingMethod ?? turn.slicingMethod,
          shiftedStartBySec: cached.shiftedStartBySec ?? turn.shiftedStartBySec,
          needsShorten: cached.needsShorten ?? turn.needsShorten,
          subBlockIndex: cached.subBlockIndex ?? turn.subBlockIndex,
          startTime: cached.startTime ?? turn.startTime,
          endTime: cached.endTime ?? turn.endTime,
        });
      }
    }
    if (resumeOnlyRemaining && synthesizedTurns.length > 0) {
      for (const st of synthesizedTurns) {
        if (st.id && st.audioBase64 && !existingById.has(st.id)) {
          existingById.set(st.id, st);
        }
      }
    }

    const turnsToSynthesize = enrichedTurns.filter((t) => !existingById.has(t.id));

    // If every turn already exists in IndexedDB cache, stitch locally with 0 TTS requests
    if (turnsToSynthesize.length === 0 && existingById.size > 0) {
      try {
        const cachedOrdered = enrichedTurns
          .map((t) => existingById.get(t.id))
          .filter(Boolean) as DialogueTurn[];
        setBatchProgress({
          currentBatch: 1,
          totalBatches: 1,
          completedTurns: cachedOrdered.length,
          totalTurns: enrichedTurns.length,
          percent: 98,
          statusText: `Все ${cachedOrdered.length} реплик найдены в кэше IndexedDB. Локальная сборка...`,
        });
        await new Promise((r) => setTimeout(r, 0));
        const stitchData = stitchDialogueTurnsClient({
          turns: cachedOrdered,
          masterAudioMode: effectiveMode,
          totalVideoDurationSec: effectiveVideoDurationSec,
        });
        setMasterAudioBase64(stitchData.masterAudioBase64);
        setTotalDuration(stitchData.totalDurationSeconds || 0);
        setSynthesizedTurns(stitchData.turns);
        setTurns((prev) =>
          prev.map((pt, i) => {
            const matched = stitchData.turns.find((ft) => ft.id === pt.id) || stitchData.turns[i];
            return matched
              ? {
                  ...pt,
                  originalDurationSec: matched.originalDurationSec,
                  dubbedDurationSec: matched.dubbedDurationSec,
                  syncStatus: matched.syncStatus,
                  qa: matched.qa ?? pt.qa,
                  qaReason: matched.qaReason,
                  slicingMethod: matched.slicingMethod ?? pt.slicingMethod,
                  shiftedStartBySec: matched.shiftedStartBySec ?? pt.shiftedStartBySec,
                  needsShorten: matched.needsShorten ?? pt.needsShorten,
                  subBlockIndex: matched.subBlockIndex ?? pt.subBlockIndex,
                }
              : pt;
          })
        );
        if (stitchData.srtSubtitles) setSrtSubtitles(stitchData.srtSubtitles);
        setIsPlaying(false);
        setActiveTurnIndex(-1);
        setCachedTurnsInDbCount(cachedOrdered.length);
        setDialogueNotice(
          `✅ Озвучка собрана из кэша IndexedDB: 0 вызовов TTS (${cachedOrdered.length}/${enrichedTurns.length} реплик).`
        );
      } catch (e: any) {
        setDialogueNotice(`Ошибка локальной сборки из кэша: ${e.message}`);
      } finally {
        setIsSynthesizing(false);
        setBatchProgress(null);
      }
      return;
    }

    const updateQuotaFromPayload = (payload: any) => {
      if (typeof payload?.quotaRemaining === 'number' && typeof payload?.quotaLimit === 'number') {
        setTtsQuota({
          used: Math.max(0, payload.quotaLimit - payload.quotaRemaining),
          limit: payload.quotaLimit,
          remaining: payload.quotaRemaining,
          resetHintRu: 'после 13:00 по Ташкенту',
        });
      }
    };

    const plannedAllBlocks = planDialogueMacroBlocks(enrichedTurns, { maxSize: 25, minPauseSec: 0.5 });
    const plannedExecutionBlocks = planDialogueMacroBlocks(turnsToSynthesize, { maxSize: 25, minPauseSec: 0.5 });

    // Single request when everything fits cleanly into 1 macro-block (<= 25 turns, no partial cache merge needed)
    if (!resumeOnlyRemaining && existingById.size === 0 && plannedExecutionBlocks.length <= 1) {
      try {
        const res = await authFetch('/api/podcast/synthesize-dialogue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abortControllerRef.current.signal,
          body: JSON.stringify({
            turns: turnsToSynthesize,
            host1Voice: host1VoicePayload,
            host2Voice: host2VoicePayload,
            speakers: extraSpeakers,
            masterAudioMode: effectiveMode,
            totalVideoDurationSec: effectiveVideoDurationSec,
          }),
        });

        if (!res.ok) {
          let errMessage = 'Ошибка при синтезе диалога';
          try {
            const err = await res.json();
            if (err.code === 'API_KEY_EXPIRED' || err.isApiKeyExpired || (err.error && err.error.includes('API key expired'))) {
              window.dispatchEvent(new CustomEvent('open-api-key-modal'));
            }
            errMessage = err.message_ru || err.message || err.error || errMessage;
          } catch {}
          throw new Error(errMessage);
        }

        const data = await res.json();
        updateQuotaFromPayload(data);

        const resultTurns: DialogueTurn[] = data.turns || [];
        await persistTurnsAudioToIndexedDb(resultTurns, sourceTurnsById);
        if (resultTurns.length > 0) {
          setCachedTurnsInDbCount(resultTurns.filter((rt) => Boolean(rt.audioBase64)).length);
        }

        if (data.quotaPaused) {
          setSynthesizedTurns(resultTurns);
          setQuotaPausedInfo({
            messageRu:
              data.quotaPauseMessageRu ||
              `Дневной лимит исчерпан. Готово ${data.blocksCompleted || 0} из ${data.blocksTotal || 1} блоков, продолжим после 13:00 по Ташкенту`,
            blocksCompleted: data.blocksCompleted || 0,
            blocksTotal: data.blocksTotal || 1,
            remainingTurnsCount: Math.max(0, enrichedTurns.length - resultTurns.length),
          });
          setDialogueNotice(
            data.quotaPauseMessageRu ||
              'Дневной лимит исчерпан. Готовые блоки сохранены, можно продолжить после 13:00 по Ташкенту.'
          );
          return;
        }

        setMasterAudioBase64(data.masterAudioBase64);
        setTotalDuration(data.totalDurationSeconds || 0);
        setSynthesizedTurns(resultTurns);
        if (resultTurns.length > 0) {
          setTurns((prev) =>
            prev.map((pt, i) => {
              const matched = resultTurns.find((rt) => rt.id === pt.id) || resultTurns[i];
              return matched
                ? {
                    ...pt,
                    text: matched.text || pt.text,
                    fitStepApplied: matched.fitStepApplied,
                    originalDurationSec: matched.originalDurationSec,
                    dubbedDurationSec: matched.dubbedDurationSec,
                    atempoApplied: matched.atempoApplied,
                    rephraseAttempts: matched.rephraseAttempts,
                    syncStatus: matched.syncStatus,
                    qa: matched.qa,
                    qaReason: matched.qaReason,
                    slicingMethod: matched.slicingMethod,
                    shiftedStartBySec: matched.shiftedStartBySec,
                    needsShorten: matched.needsShorten,
                    subBlockIndex: matched.subBlockIndex,
                  }
                : pt;
            })
          );
        }
        if (data.srtSubtitles) setSrtSubtitles(data.srtSubtitles);
        setIsPlaying(false);
        setActiveTurnIndex(-1);

        if (typeof data.ttsCallsUsed === 'number') {
          const st = data.stats || { ok: 0, adjusted: 0, overflow: 0 };
          setDialogueNotice(
            `Озвучка готова: ${data.ttsCallsUsed} вызовов TTS (${data.provider || 'google'}) · ok: ${st.ok}, ускорено: ${st.adjusted}, overflow: ${st.overflow}`
          );
        }

        if (typeof data.creditsRemaining === 'number') {
          syncCredits(data.creditsRemaining);
        } else {
          await useCredit(1);
        }
        await logGeneration('podcast', topic || '2 Ovozli Dublyaj', 1);
      } catch (e: any) {
        if (e.name !== 'AbortError') {
          setDialogueNotice(`Ошибка: ${e.message}`);
        }
      } finally {
        setIsSynthesizing(false);
        setBatchProgress(null);
      }
      return;
    }

    // Scene-aware & pause-aware macro-block slicing (shared utility, max 25 turns/block, avoids <0.5s cuts)
    const totalBatches = Math.max(1, plannedExecutionBlocks.length);
    const totalProjectBlocks = Math.max(1, plannedAllBlocks.length);
    const initialCompletedBlocks = Math.max(0, totalProjectBlocks - totalBatches);
    const newlySynthesizedById = new Map<string, any>(existingById);
    let totalTtsCallsUsed = 0;
    const providersUsed = new Set<string>();
    let pausedByQuota = false;

    setBatchProgress({
      currentBatch: 1,
      totalBatches,
      completedTurns: newlySynthesizedById.size,
      totalTurns: enrichedTurns.length,
      percent: Math.round((newlySynthesizedById.size / Math.max(1, enrichedTurns.length)) * 100),
      statusText: `Запуск пакетной озвучки (блок 1/${totalBatches})...`,
    });

    try {
      for (let b = 0; b < totalBatches; b++) {
        if (abortControllerRef.current?.signal.aborted) break;

        const block = plannedExecutionBlocks[b];
        const batchTurns = block.turns;

        setBatchProgress({
          currentBatch: b + 1,
          totalBatches,
          completedTurns: newlySynthesizedById.size,
          totalTurns: enrichedTurns.length,
          percent: Math.round((newlySynthesizedById.size / Math.max(1, enrichedTurns.length)) * 100),
          statusText: `Озвучка блока ${b + 1}/${totalBatches} (${block.startTimecode}–${block.endTimecode}, ${batchTurns.length} репл.)...`,
        });

        let batchData: any = null;
        let lastErr: any = null;

        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const res = await authFetch('/api/podcast/synthesize-dialogue', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: abortControllerRef.current?.signal,
              body: JSON.stringify({
                turns: batchTurns,
                skipMasterStitch: true,
                startingCompletedBlocks: initialCompletedBlocks + b,
                totalProjectBlocks,
                host1Voice: host1VoicePayload,
                host2Voice: host2VoicePayload,
                speakers: extraSpeakers,
                masterAudioMode: effectiveMode,
                totalVideoDurationSec: effectiveVideoDurationSec,
              }),
            });

            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              throw new Error(err.message_ru || err.message || err.error || `HTTP ${res.status}`);
            }

            batchData = await res.json();
            break;
          } catch (err: any) {
            lastErr = err;
            if (abortControllerRef.current?.signal.aborted) break;
            if (attempt < 2) await new Promise((r) => setTimeout(r, 2000));
          }
        }

        if (!batchData) {
          throw new Error(`Ошибка в блоке ${b + 1}: ${lastErr?.message || 'сбой сети'}`);
        }

        updateQuotaFromPayload(batchData);
        if (typeof batchData.ttsCallsUsed === 'number') {
          totalTtsCallsUsed += batchData.ttsCallsUsed;
        }
        if (batchData.provider) {
          providersUsed.add(String(batchData.provider));
        }

        if (typeof batchData.creditsRemaining === 'number') {
          syncCredits(batchData.creditsRemaining);
        }

        if (Array.isArray(batchData.turns)) {
          await persistTurnsAudioToIndexedDb(batchData.turns, sourceTurnsById);
          for (const t of batchData.turns) {
            if (t?.id) newlySynthesizedById.set(t.id, t);
          }
          const orderedPartial = enrichedTurns
            .map((t) => newlySynthesizedById.get(t.id))
            .filter(Boolean);
          setSynthesizedTurns(orderedPartial);
          setCachedTurnsInDbCount(orderedPartial.filter((t) => Boolean(t.audioBase64)).length);
        }

        if (batchData.quotaPaused) {
          pausedByQuota = true;
          const remainingCount = Math.max(0, enrichedTurns.length - newlySynthesizedById.size);
          const msgRu =
            batchData.quotaPauseMessageRu ||
            `Дневной лимит исчерпан. Готово ${batchData.blocksCompleted || initialCompletedBlocks + b} из ${totalProjectBlocks} блоков, продолжим после 13:00 по Ташкенту`;
          setQuotaPausedInfo({
            messageRu: msgRu,
            blocksCompleted: batchData.blocksCompleted || initialCompletedBlocks + b,
            blocksTotal: totalProjectBlocks,
            remainingTurnsCount: remainingCount,
          });
          setDialogueNotice(msgRu);
          break;
        }
      }

      const accumulatedTurns = enrichedTurns
        .map((t) => newlySynthesizedById.get(t.id))
        .filter(Boolean);

      if (!pausedByQuota && accumulatedTurns.length > 0) {
        setBatchProgress({
          currentBatch: totalBatches,
          totalBatches,
          completedTurns: accumulatedTurns.length,
          totalTurns: enrichedTurns.length,
          percent: 98,
          statusText: `Сборка всех ${accumulatedTurns.length} реплик строго по таймкодам...`,
        });

        // Yield one frame so the 98% stitching indicator renders before synchronous local WAV assembly
        await new Promise((r) => setTimeout(r, 0));

        const stitchData = stitchDialogueTurnsClient({
          turns: accumulatedTurns,
          masterAudioMode: effectiveMode,
          totalVideoDurationSec: effectiveVideoDurationSec,
        });

        setMasterAudioBase64(stitchData.masterAudioBase64);
        setTotalDuration(stitchData.totalDurationSeconds || 0);
        const finalTurns: DialogueTurn[] = Array.isArray(stitchData.turns)
          ? stitchData.turns
          : accumulatedTurns;
        setSynthesizedTurns(finalTurns);
        setTurns((prev) =>
          prev.map((pt, i) => {
            const matched = finalTurns.find((ft) => ft.id === pt.id) || finalTurns[i];
            return matched
              ? {
                  ...pt,
                  text: matched.text || pt.text,
                  fitStepApplied: matched.fitStepApplied,
                  originalDurationSec: matched.originalDurationSec,
                  dubbedDurationSec: matched.dubbedDurationSec,
                  atempoApplied: matched.atempoApplied,
                  rephraseAttempts: matched.rephraseAttempts,
                  syncStatus: matched.syncStatus,
                  qa: matched.qa,
                  qaReason: matched.qaReason,
                  slicingMethod: matched.slicingMethod,
                  shiftedStartBySec: matched.shiftedStartBySec,
                  needsShorten: matched.needsShorten,
                  subBlockIndex: matched.subBlockIndex,
                }
              : pt;
          })
        );
        if (stitchData.srtSubtitles) setSrtSubtitles(stitchData.srtSubtitles);
        setIsPlaying(false);
        setActiveTurnIndex(-1);

        const okCount = finalTurns.filter((t) => t.syncStatus === 'ok').length;
        const adjCount = finalTurns.filter((t) => t.syncStatus === 'adjusted').length;
        const ovfCount = finalTurns.filter((t) => t.syncStatus === 'overflow').length;
        const provLabel = Array.from(providersUsed).join('+') || 'google';
        setDialogueNotice(
          `Озвучка готова: ${totalTtsCallsUsed} вызовов TTS (${provLabel}) · ok: ${okCount}, ускорено: ${adjCount}, overflow: ${ovfCount}`
        );

        await logGeneration('podcast', topic || '2 Ovozli Dublyaj', 1);
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setDialogueNotice(`Ошибка: ${e.message}`);
      }
    } finally {
      setIsSynthesizing(false);
      setBatchProgress(null);
      refreshTtsQuota();
    }
  };

  // Master audio playback & synchronized video preview
  const [masterCurrentTime, setMasterCurrentTime] = useState(0);

  const toggleMasterPlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      dubVideoRef.current?.pause();
      ambientAudioRef.current?.pause();
      setIsPlaying(false);
    } else {
      if (dubVideoRef.current) {
        dubVideoRef.current.currentTime = audioRef.current.currentTime;
        dubVideoRef.current.play().catch(() => {});
      }
      audioRef.current.play();
      if (ambientEnabled && ambientSound !== 'none') {
        ambientAudioRef.current?.play().catch(console.warn);
      }
      setIsPlaying(true);
    }
  };

  const playSingleTurn = (turnId: string, audioBase64?: string) => {
    if (!audioBase64) return;
    if (playingTurnId === turnId) {
      singleAudioRef.current?.pause();
      setPlayingTurnId(null);
      return;
    }

    if (singleAudioRef.current) {
      singleAudioRef.current.pause();
    }
    const audio = new Audio(`data:audio/wav;base64,${audioBase64}`);
    singleAudioRef.current = audio;
    setPlayingTurnId(turnId);

    // Seek video preview to this turn's startSec if uploaded
    const foundTurn = turns.find((t) => t.id === turnId);
    if (dubVideoRef.current && typeof foundTurn?.startSec === 'number') {
      dubVideoRef.current.currentTime = foundTurn.startSec;
    }

    audio.onended = () => {
      setPlayingTurnId(null);
    };
    audio.play().catch(console.warn);
  };

  const handleUpdateTurnCue = (turnId: string, cueType: SoundCueType, soundscape?: AmbientSoundscape) => {
    setTurns((prev) =>
      prev.map((t) => {
        if (t.id !== turnId) return t;
        const isSilence = cueType === 'silence';
        const snd = soundscape || (isSilence ? 'none' : t.musicCue?.soundscape || ambientSound);
        return {
          ...t,
          musicCue: {
            enabled: !isSilence,
            cueType,
            soundscape: snd,
            volumePercent: isSilence ? 0 : cueType === 'intro' || cueType === 'outro' ? 35 : cueType === 'stinger' ? 25 : 14,
            labelUz: isSilence ? 'Toza ovoz' : 'Fon Musiqasi',
            labelRu: isSilence ? 'Чистый голос' : 'Фоновая музыка',
            reasoning: isSilence ? 'Чистый голос без музыки.' : `${snd} выбрана.`,
          },
        };
      })
    );
  };

  // Sync turn highlight + live video volume ducking (100% during Без слов, 15%/0% during speech)
  const handleTimeUpdate = () => {
    if (!audioRef.current || synthesizedTurns.length === 0) return;
    const curr = audioRef.current.currentTime;
    setMasterCurrentTime(curr);
    const activeIdx = synthesizedTurns.findIndex(
      (t) => curr >= (t.startTime ?? t.startSec ?? 0) && curr <= (t.endTime ?? t.endSec ?? 0) + 0.25
    );
    setActiveTurnIndex(activeIdx);

    // Synchronize local video player time & apply smart ducking on original video track
    if (dubVideoRef.current) {
      if (Math.abs(dubVideoRef.current.currentTime - curr) > 0.35) {
        dubVideoRef.current.currentTime = curr;
      }
      if (duckingMode === 'voice_only') {
        dubVideoRef.current.volume = 0;
      } else if (activeIdx >= 0) {
        // Speech is currently playing -> duck original video audio
        dubVideoRef.current.volume = duckingMode === 'smart_ducking' ? 0.15 : 0.0;
      } else {
        // «Без слов» musical interval -> restore original video music to 100%!
        dubVideoRef.current.volume = 1.0;
      }
    }

    if (dynamicDuckingEnabled && ambientAudioRef.current && activeIdx >= 0) {
      const activeTurn = turns[activeIdx];
      const cue = activeTurn?.musicCue;
      if (cue) {
        if (!cue.enabled || cue.cueType === 'silence' || cue.soundscape === 'none' || cue.volumePercent <= 0) {
          ambientAudioRef.current.volume = 0;
        } else {
          const factor = (cue.volumePercent / 100) * 0.65;
          ambientAudioRef.current.volume = Math.max(0, Math.min(1, factor));
        }
      }
    }
  };

  const handleSaveToCMS = () => {
    if (!onSaveToCMS) return;
    const fullScript = turns.map((t) => `[${t.speakerName}]: ${t.text}`).join('\n\n');

    onSaveToCMS({
      title: `Dublyaj: ${topic.slice(0, 45)}`,
      category: 'Intervyu & Dublyaj',
      description: `${speaker1Name} va ${speaker2Name} ishtirokidagi 1:1 dublyaj / intervyu.`,
      tags: ['Dublyaj', 'MultiSpeaker', '1:1', 'NeuralStudio'],
      script: fullScript,
      voiceName: `${speaker1Name} & ${speaker2Name}`,
      durationSeconds: totalDuration || 60,
      rawAudioWavBase64: masterAudioBase64 || '',
      ambientSound,
      ambientVolume: ambientEnabled ? ambientVolume : 0,
    });

    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const downloadMasterAudio = async () => {
    if (!masterAudioBase64) return;
    try {
      const rawBuf = base64ToArrayBuffer(masterAudioBase64);
      let downloadBlob: Blob;
      if (ambientEnabled && ambientSound !== 'none') {
        const segmentCues: AudioSegmentCue[] = synthesizedTurns.map((st, i) => {
          const turn = turns[i] || turns.find((t) => t.id === st.id);
          const mc = turn?.musicCue;
          return {
            id: `cue-${st.id}`,
            turnIndex: i,
            startTime: st.startTime || 0,
            endTime: st.endTime || totalDuration,
            cueType: mc?.cueType || 'silence',
            soundscape: mc?.soundscape || 'none',
            volumePercent: mc?.volumePercent ?? 0,
            labelUz: mc?.labelUz || '',
            labelRu: mc?.labelRu || '',
          };
        });

        const { wavBlob } = await mixAudioTracks(rawBuf, ambientSound, ambientVolume, 100, segmentCues);
        downloadBlob = wavBlob;
      } else {
        downloadBlob = new Blob([rawBuf], { type: 'audio/wav' });
      }
      const url = URL.createObjectURL(downloadBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `uzbek-dubbing-audio-${Date.now()}.wav`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download error:', err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Clean Header Banner (without duplicated speaker controls) */}
      <div className="border border-[rgba(22,21,17,0.14)] rounded-[22px] bg-[rgba(255,255,255,0.52)] backdrop-blur-md p-6 sm:p-7 relative overflow-hidden shadow-[0_30px_50px_-30px_rgba(22,21,17,0.15)]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#0A5A62] border border-[rgba(14,124,134,0.35)] rounded-full px-3 py-1 bg-white/60 flex items-center gap-1.5">
                <Users2 className="w-3.5 h-3.5 text-[#0E7C86]" />
                {lang === 'uz' ? '2 Ovozli Intervyu & Dublyaj 1:1' : 'Студия Дубляжа 1:1 и Двухголосых Интервью'}
              </span>
              <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-[#C4552D] border border-[rgba(196,85,45,0.35)] rounded-full px-2.5 py-0.5 bg-[#C4552D]/5">
                Gemini 4 Hydrogen · Gemini 3.8 TTS
              </span>
            </div>
            <h1 className="font-serif text-2xl sm:text-3xl text-[#161511] font-normal tracking-tight leading-tight">
              {lang === 'uz' ? (
                <>Aniq Taymkodli <em>Video Dublyaj 1:1</em> va Intervyu</>
              ) : (
                <>Точный <em>Дубляж Видео 1:1</em> по Раскадровке и Интервью</>
              )}
            </h1>
            <p className="text-[#5D594E] text-xs sm:text-sm mt-1 max-w-3xl leading-relaxed">
              {lang === 'uz'
                ? "Ruscha taymkodli raskadrovka va videoni (15 daqiqagacha) yuklang: 'Видеоряд:' ovozdan yashiriladi, 'Интонация:' hissiyotni boshqaradi, 'Без слов' musiqasi saqlanadi va 'Текст:' 1:1 o'zbekchaga o'giriladi."
                : 'Загрузите видео до 15 мин и русскую раскадровку: «Видеоряд:» скрывается из речи, «Интонация:» настраивает эмоции голоса, вставки «Без слов» сохраняют музыку, а «Текст:» переводится 1:1 в секунды таймкода.'}
            </p>
          </div>
        </div>
      </div>

      {dialogueNotice && (
        <div className="px-4 py-3 rounded-xl bg-[rgba(14,124,134,0.08)] border border-[#0E7C86]/30 text-[#161511] text-xs font-medium flex items-center justify-between gap-3">
          <span>{dialogueNotice}</span>
          <button
            type="button"
            onClick={() => setDialogueNotice(null)}
            className="text-[#5D594E] hover:text-[#161511] font-mono text-xs cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Step 01, Step 02, Step 03 (8 cols) */}
        <div className="lg:col-span-8 space-y-6">
          {/* STEP 01: Unified 3-Mode Source & Video Upload */}
          <div className="border border-[rgba(22,21,17,0.14)] rounded-[20px] bg-[rgba(255,255,255,0.52)] backdrop-blur-sm p-6 space-y-4 shadow-[0_30px_50px_-30px_rgba(22,21,17,0.15)]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#0A5A62] flex-1">
                <span>01 — {lang === 'uz' ? 'Manba va Ish Rejimi' : 'Источник и Режим работы'}</span>
                <span className="h-[1px] flex-1 bg-[rgba(22,21,17,0.14)] mr-3" />
              </div>

              {onOpenDocumentModal && (
                <button
                  type="button"
                  onClick={onOpenDocumentModal}
                  className="btn-pill btn-ghost text-xs px-3.5 py-1.5 flex items-center gap-1.5 shrink-0"
                >
                  <Upload className="w-3.5 h-3.5 text-[#0E7C86]" />
                  <span>{lang === 'uz' ? 'PDF / Hujjatdan' : 'Импорт из PDF / Файла'}</span>
                </button>
              )}
            </div>

            {/* Clean 3-Mode Switcher */}
            <div className="flex flex-wrap items-center gap-2 border-b border-[rgba(22,21,17,0.1)] pb-3">
              <button
                type="button"
                onClick={() => setStudioSourceMode('verbatim')}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                  studioSourceMode === 'verbatim'
                    ? 'bg-[#0E7C86] text-white shadow-xs'
                    : 'text-[#5D594E] hover:text-[#0E7C86] hover:bg-[#0E7C86]/10'
                }`}
              >
                <Film className="w-3.5 h-3.5" />
                <span>
                  {lang === 'uz'
                    ? '🎯 Aniq Dublyaj 1:1 (Raskadrovka + Video 15 daq)'
                    : '🎯 Точный дубляж 1:1 (Раскадровка + Видео до 15 мин)'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setStudioSourceMode('prompt')}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                  studioSourceMode === 'prompt'
                    ? 'bg-[#161511] text-[#F4F1EA] shadow-xs'
                    : 'text-[#5D594E] hover:text-[#161511] hover:bg-black/5'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5 text-[#5CC8CF]" />
                <span>
                  {lang === 'uz'
                    ? '✨ AI-Dialog Mavzu bo‘yicha (10 daqiqagacha)'
                    : '✨ ИИ-Диалог по теме / PDF (до 10 мин)'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setStudioSourceMode('youtube')}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                  studioSourceMode === 'youtube'
                    ? 'bg-[#C4552D] text-white shadow-xs'
                    : 'text-[#5D594E] hover:text-[#C4552D] hover:bg-[#C4552D]/10'
                }`}
              >
                <Subtitles className="w-3.5 h-3.5" />
                <span>
                  {lang === 'uz'
                    ? '📝 Subtitrlar Importi (.SRT / .VTT / Matn)'
                    : '📝 Импорт субтитров (.SRT / .VTT / Текст)'}
                </span>
              </button>
            </div>

            {studioSourceMode === 'verbatim' ? (
              /* MODE 1: Verbatim 1:1 Storyboard + Video Upload up to 15 min */
              <div className="space-y-4">
                {/* Video Upload Card (up to 30 MB / 720p) */}
                <div className="p-4 rounded-2xl bg-white border border-[rgba(14,124,134,0.28)] space-y-3 shadow-2xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Video className="w-4 h-4 text-[#0E7C86]" />
                      <span className="text-xs font-bold text-[#161511]">
                        {lang === 'uz'
                          ? '1. Original Videoni Yuklash (MP4 / WebM / MOV, 30 MB gacha / 720p):'
                          : '1. Загрузить оригинальное видео (MP4 / WebM / MOV, до 30 МБ / 720p):'}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {isImportedScript && (
                        <span className="text-[10.5px] font-mono px-2 py-0.5 rounded-md bg-[#0E7C86]/10 text-[#0A5A62] border border-[#0E7C86]/25">
                          🛡 Сценарий защищён (только склейка MP4)
                        </span>
                      )}
                      <label className="flex items-center gap-1.5 text-[11px] text-[#5D594E] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={autoExtractFromVideo}
                          onChange={(e) => handleToggleAutoExtractFromVideo(e.target.checked)}
                          className="accent-[#0E7C86] rounded"
                        />
                        <span>
                          {lang === 'uz'
                            ? 'Videodan avtomatik raskadrovka olish (Gemini Files API)'
                            : 'Авто-создать раскадровку из видео'}
                        </span>
                      </label>
                    </div>
                  </div>

                  <input
                    type="file"
                    ref={videoInputRef}
                    onChange={handleVideoFileUpload}
                    accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
                    className="hidden"
                  />

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-[#FAF8F3] border border-dashed border-[rgba(22,21,17,0.2)]">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-[#0E7C86]/10 text-[#0E7C86] flex items-center justify-center shrink-0">
                        <Film className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-[#161511] truncate">
                          {uploadedVideoFileName
                            ? `${uploadedVideoFileName} (${uploadedVideoSizeMb} МБ)`
                            : lang === 'uz'
                            ? 'Video tanlanmagan (30 MB gacha / 720p)'
                            : 'Видео не выбрано (загрузите MP4 до 30 МБ для ИИ-разбора и склейки дубляжа)'}
                        </p>
                        <p className="text-[11px] text-[#5D594E]">
                          {videoJobStatus && videoJobStatus.stage !== 'done' && videoJobStatus.stage !== 'failed'
                            ? `Этап: ${getStageLabelRu(videoJobStatus.stage)} (${videoJobStatus.progress}%)`
                            : videoJobStatus?.stage === 'done'
                            ? `✓ Раскадровка: ${videoJobStatus.turnsCount ?? turns.length} реплик, ${videoJobStatus.speakersCount ?? 2} спикеров. Проверьте таблицу и нажмите Озвучить.`
                            : videoJobStatus?.stage === 'failed'
                            ? `Раскадровка не получена: ${videoJobStatus.error}. Вставьте текст раскадровки вручную или загрузите видео снова.`
                            : 'Лимит 30 МБ (720p) · 1 кредит за начатую минуту видео (списывается только после готовой раскадровки)'}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => videoInputRef.current?.click()}
                      disabled={isUploadingVideo}
                      className="btn-pill btn-solid text-xs py-2 px-4 flex items-center justify-center gap-1.5 shrink-0 bg-[#0E7C86] hover:bg-[#0A5A62] text-white border-none cursor-pointer disabled:opacity-60"
                    >
                      <Upload className={`w-3.5 h-3.5 ${isUploadingVideo ? 'animate-bounce' : ''}`} />
                      <span>
                        {isUploadingVideo
                          ? videoJobStatus && videoJobStatus.stage !== 'done' && videoJobStatus.stage !== 'failed'
                            ? `Разбор (${videoJobStatus.progress}%)...`
                            : 'Загрузка видео...'
                          : uploadedVideoFileName
                          ? 'Заменить видео'
                          : 'Загрузить оригинальное видео'}
                      </span>
                    </button>
                  </div>

                  {/* Background Job Stage & Progress Bar (Point 3: shown while running, no "✓" until stage === 'done') */}
                  {videoJobStatus && videoJobStatus.stage !== 'done' && videoJobStatus.stage !== 'failed' && (
                    <div className="p-3.5 rounded-xl bg-[#FAF8F3] border border-[#0E7C86]/35 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-[#0A5A62] flex items-center gap-1.5">
                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#0E7C86]" />
                          <span>{getStageLabelRu(videoJobStatus.stage)}</span>
                        </span>
                        <span className="font-mono text-xs font-bold text-[#0E7C86]">
                          {videoJobStatus.progress}%
                        </span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-[#ECE7DB] overflow-hidden">
                        <div
                          className="h-full bg-[#0E7C86] transition-all duration-300 rounded-full"
                          style={{ width: `${Math.max(5, Math.min(100, videoJobStatus.progress))}%` }}
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[10.5px] font-mono text-[#5D594E]">
                        <span className={videoJobStatus.stage === 'uploading_to_gemini' ? 'text-[#0E7C86] font-bold' : ''}>
                          1. Загрузка в Gemini
                        </span>
                        <span>→</span>
                        <span className={videoJobStatus.stage === 'gemini_processing' ? 'text-[#0E7C86] font-bold' : ''}>
                          2. Обработка видео (ACTIVE)
                        </span>
                        <span>→</span>
                        <span className={videoJobStatus.stage === 'storyboard' ? 'text-[#0E7C86] font-bold' : ''}>
                          3. Раскадровка JSON (gemini-3.8-flash)
                        </span>
                        <span>→</span>
                        <span className={videoJobStatus.stage === 'translating' ? 'text-[#0E7C86] font-bold' : ''}>
                          4. Перевод 1:1 (gemini-4-hydrogen)
                        </span>
                      </div>
                    </div>
                  )}

                  {videoJobStatus?.stage === 'failed' && (
                    <div className="p-3 rounded-xl bg-[#FEF2F2] border border-[#FCA5A5] text-xs text-[#991B1B] flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-[#DC2626] shrink-0" />
                      <span>
                        Раскадровка не получена: {videoJobStatus.error}. Вставьте текст раскадровки вручную или загрузите видео снова.
                      </span>
                    </div>
                  )}

                  {videoJobStatus?.stage === 'done' && (
                    <div className="p-3 rounded-xl bg-[rgba(14,124,134,0.08)] border border-[rgba(14,124,134,0.3)] text-xs text-[#0A5A62] flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-[#0E7C86] shrink-0" />
                        <span className="font-semibold">
                          ✓ Раскадровка: {videoJobStatus.turnsCount ?? turns.length} реплик, {videoJobStatus.speakersCount ?? 2} спикеров. Проверьте таблицу и нажмите Озвучить.
                        </span>
                      </div>
                      {typeof videoJobStatus.elapsedSeconds === 'number' && (
                        <span className="font-mono text-[10.5px] text-[#5D594E] shrink-0">
                          {videoJobStatus.elapsedSeconds}с · списано {videoJobStatus.creditsDeducted ?? 0} кред.
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Per-User Saved Dubbing Projects History (Visible ONLY to the user who created them) */}
                {userHistory.length > 0 && (
                  <div className="p-3.5 rounded-2xl bg-[#FAF8F3] border border-[rgba(14,124,134,0.25)] space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-mono uppercase tracking-wider text-[#0A5A62] font-bold">
                        📂 Ваша личная история дубляжа ({user?.email || 'ваш аккаунт'}):
                      </span>
                      <span className="text-[10.5px] text-[#5D594E]">
                        Видна только на вашем аккаунте
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {userHistory.map((item) => (
                        <div
                          key={item.id}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-[rgba(22,21,17,0.14)] text-xs shadow-2xs"
                        >
                          <button
                            type="button"
                            onClick={() => handleLoadHistoryItem(item)}
                            className="font-semibold text-[#161511] hover:text-[#0E7C86] truncate max-w-[240px] cursor-pointer text-left"
                            title={`Загрузить «${item.title}» (${item.turns.length} реплик)`}
                          >
                            {item.title} ({item.turns.length})
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteHistoryItem(item.id)}
                            className="text-[#5D594E] hover:text-[#C4552D] px-1 cursor-pointer"
                            title="Удалить из вашей истории"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Storyboard Textarea + 1:1 Parser Controls */}
                <div className="p-4 rounded-2xl bg-white border border-[rgba(22,21,17,0.14)] space-y-3 shadow-2xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="text-xs font-bold text-[#161511] block">
                        {lang === 'uz'
                          ? '2. Ruscha Taymkodli Raskadrovka (Видеоряд / Интонация / Текст):'
                          : '2. Русская раскадровка с таймкодами (Видеоряд / Интонация / Текст):'}
                      </span>
                      <span className="text-[11px] text-[#5D594E]">
                        Описания «Видеоряд:» не читаются вслух; «Интонация:» передаётся в эмоции голоса; «Без слов» оставляет паузу для музыки видео.
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleOpenImportModal}
                        className="text-[11px] px-3 py-1.5 rounded-full bg-[#161511] hover:bg-[#0A5A62] text-white font-semibold transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs"
                      >
                        <FileUp className="w-3.5 h-3.5 text-[#5CC8CF]" />
                        <span>Импорт сценария</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleExportScript('json')}
                        disabled={turns.length === 0}
                        className="text-[11px] px-2.5 py-1.5 rounded-full bg-white hover:bg-[#F4F1EA] text-[#161511] border border-[rgba(22,21,17,0.18)] font-semibold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                        title="Экспорт таблицы сценария в JSON (без аудио)"
                      >
                        <FileDown className="w-3 h-3 text-[#0E7C86]" />
                        <span>Экспорт .json</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleExportScript('csv')}
                        disabled={turns.length === 0}
                        className="text-[11px] px-2.5 py-1.5 rounded-full bg-white hover:bg-[#F4F1EA] text-[#161511] border border-[rgba(22,21,17,0.18)] font-semibold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                        title="Экспорт таблицы сценария в CSV (без аудио)"
                      >
                        <FileDown className="w-3 h-3 text-[#0E7C86]" />
                        <span>Экспорт .csv</span>
                      </button>
                      {(storyboardTextRu.trim().length > 0 || turns.length > 0) && (
                        <button
                          type="button"
                          onClick={handleClearWorkspace}
                          className="text-[11px] px-3 py-1.5 rounded-full bg-[#F4F1EA] hover:bg-[#C4552D]/10 text-[#5D594E] hover:text-[#C4552D] border border-[rgba(22,21,17,0.14)] font-semibold transition-all cursor-pointer flex items-center gap-1"
                        >
                          <Eraser className="w-3 h-3" />
                          <span>Очистить</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleLoadCarReviewPreset}
                        className="text-[11px] px-3 py-1.5 rounded-full bg-[#0E7C86]/10 hover:bg-[#0E7C86]/20 text-[#0A5A62] border border-[#0E7C86]/30 font-semibold transition-all cursor-pointer"
                      >
                        📋 Вставить пример раскадровки (Тест-драйв 00:00–01:07)
                      </button>
                    </div>
                  </div>

                  <textarea
                    rows={7}
                    value={storyboardTextRu}
                    onChange={(e) => setStoryboardTextRu(e.target.value)}
                    placeholder={`Спикер 1 (Ж) — Девушка...\nСпикер 2 (М) — Мужчина...\n\n00:00 – 00:02 | Девушка (Ж):\nВидеоряд: ...\nИнтонация: С интересом, вопросительно.\nТекст: «Ну как она на ходу? Машина-то крупная».`}
                    className="w-full bg-[#FAF8F3] border border-[rgba(22,21,17,0.14)] rounded-xl p-3.5 text-xs text-[#161511] font-mono leading-relaxed focus:outline-none focus:border-[#0E7C86] resize-y"
                  />

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    {/* Pre-launch Cost & Timeline Summary */}
                    <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-[#5D594E]">
                      <span className="px-2.5 py-1 rounded-lg bg-[#F4F1EA] border border-[rgba(22,21,17,0.1)] text-[#161511] font-semibold">
                        🗣️ {turns.length} реплик
                      </span>
                      <span className="px-2.5 py-1 rounded-lg bg-[#F4F1EA] border border-[rgba(22,21,17,0.1)] text-[#0A5A62] font-semibold">
                        🎵 {noSpeechIntervals.length} вставок «Без слов»
                      </span>
                      <span className="px-2.5 py-1 rounded-lg bg-[#0E7C86]/10 border border-[#0E7C86]/25 text-[#0A5A62] font-bold flex items-center gap-1">
                        <DollarSign className="w-3 h-3" /> ~${(Number(typeof estimatedCostUsd === 'object' ? (estimatedCostUsd as any)?.totalUsd : estimatedCostUsd) || 0.03).toFixed(3)} за весь ролик
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={handleParseVerbatimStoryboard}
                      disabled={isParsingStoryboard || !storyboardTextRu.trim()}
                      className="btn-pill btn-solid text-xs py-2.5 px-5 flex items-center gap-2 bg-[#161511] hover:bg-[#0A5A62] text-white cursor-pointer shadow-xs"
                    >
                      <Wand2 className={`w-3.5 h-3.5 text-[#5CC8CF] ${isParsingStoryboard ? 'animate-spin' : ''}`} />
                      <span>
                        {isParsingStoryboard
                          ? 'Разбор и точный перевод 1:1...'
                          : '🎯 Разобрать и перевести 1:1 (Без отсебятины)'}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            ) : studioSourceMode === 'youtube' ? (
              /* MODE 3: Subtitle Import (.SRT / .VTT / Text) */
              <div className="p-4 bg-white border border-[rgba(196,85,45,0.25)] rounded-xl space-y-3.5 shadow-2xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#161511] flex items-center gap-1.5">
                    <Subtitles className="w-4 h-4 text-[#C4552D]" />
                    {lang === 'uz'
                      ? 'Subtitrlar (.SRT / .VTT) yoki YouTube Transkript:'
                      : 'Импорт субтитров (.SRT / .VTT / Текст) или ссылки:'}
                  </span>
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-[10px] uppercase font-mono text-[#5D594E]">
                      {lang === 'uz' ? 'Tarjima tili:' : 'Язык перевода:'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setYoutubeTargetLang('uz')}
                      className={`px-2 py-0.5 rounded-full text-[11px] font-semibold transition-all ${
                        youtubeTargetLang === 'uz'
                          ? 'bg-[#0E7C86] text-white'
                          : 'bg-[#F4F1EA] text-[#5D594E] hover:text-[#161511]'
                      }`}
                    >
                      🇺🇿 Oʻzbekcha
                    </button>
                    <button
                      type="button"
                      onClick={() => setYoutubeTargetLang('ru')}
                      className={`px-2 py-0.5 rounded-full text-[11px] font-semibold transition-all ${
                        youtubeTargetLang === 'ru'
                          ? 'bg-[#0E7C86] text-white'
                          : 'bg-[#F4F1EA] text-[#5D594E] hover:text-[#161511]'
                      }`}
                    >
                      🇷🇺 Русский
                    </button>
                  </div>
                </div>

                <textarea
                  rows={4}
                  value={manualTranscriptText}
                  onChange={(e) => {
                    setManualTranscriptText(e.target.value);
                    if (youtubeImportError) setYoutubeImportError(null);
                  }}
                  placeholder="Вставьте сюда .SRT / .VTT субтитры или текст диалога с таймкодами..."
                  className="w-full bg-[#FAF8F3] border border-[rgba(22,21,17,0.14)] rounded-xl p-3 text-xs text-[#161511] placeholder:text-[#5D594E]/60 focus:outline-none focus:border-[#C4552D] leading-relaxed resize-y font-sans"
                />

                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="url"
                    value={youtubeImportUrl}
                    onChange={(e) => {
                      setYoutubeImportUrl(e.target.value);
                      if (youtubeImportError) setYoutubeImportError(null);
                    }}
                    placeholder="Необязательно: ссылка на видео (если открыты публичные субтитры)..."
                    className="flex-1 bg-[#FAF8F3] border border-[rgba(22,21,17,0.14)] rounded-xl px-4 py-2 text-xs text-[#161511] placeholder:text-[#5D594E]/60 focus:outline-none focus:border-[#C4552D]"
                  />
                  <button
                    onClick={handleImportYouTubeInterview}
                    disabled={isImportingYoutube || (!youtubeImportUrl.trim() && !manualTranscriptText.trim())}
                    className="btn-pill btn-solid text-xs py-2 px-4 flex items-center justify-center gap-1.5 shrink-0 bg-[#C4552D] hover:bg-[#A9431E] border-none text-white cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isImportingYoutube ? 'animate-spin' : ''}`} />
                    <span>
                      {isImportingYoutube ? 'Обработка...' : 'Импортировать и перевести'}
                    </span>
                  </button>
                </div>

                {youtubeImportError && (
                  <div className="p-3 bg-[#FEF2F2] border border-[#FCA5A5] rounded-xl text-xs text-[#991B1B] flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-[#DC2626] shrink-0" />
                    <span>{youtubeImportError}</span>
                  </div>
                )}

                {youtubeImportNotice && (
                  <div className="p-3 bg-[rgba(14,124,134,0.08)] border border-[rgba(14,124,134,0.25)] rounded-xl text-xs text-[#0A5A62] flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#0E7C86] shrink-0" />
                    <span>{youtubeImportNotice}</span>
                  </div>
                )}
              </div>
            ) : (
              /* MODE 2: AI Topic Dialogue Generator (strictly capped up to 10 minutes) */
              <div className="space-y-4">
                <div className="p-3.5 bg-white border border-[rgba(22,21,17,0.14)] rounded-xl space-y-2.5 shadow-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#161511] flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-[#0E7C86]" />
                      {lang === 'uz'
                        ? 'AI Intervyu Davomiyligi (10 daqiqagacha):'
                        : 'Длительность ИИ-интервью (до 10 минут):'}
                    </span>
                    <span className="text-[11px] font-mono text-[#5D594E]">
                      {turns.length} {lang === 'uz' ? 'replika' : 'реплик'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: '1 daqiqa', label: lang === 'uz' ? '1 daqiqa' : '1 минута' },
                      { id: '3 daqiqa', label: lang === 'uz' ? '3 daqiqa' : '3 минуты' },
                      { id: '5 daqiqa', label: lang === 'uz' ? '5 daqiqa' : '5 минут' },
                      { id: '10 daqiqa', label: lang === 'uz' ? '10 daqiqa' : '10 минут' },
                    ].map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => setTargetDuration(d.id)}
                        className={`btn-pill text-xs py-1.5 px-4 transition-all cursor-pointer ${
                          targetDuration === d.id
                            ? 'bg-[#161511] text-[#F4F1EA] font-semibold border-[#161511]'
                            : 'bg-transparent border-[rgba(22,21,17,0.14)] text-[#5D594E] hover:border-[#161511] hover:text-[#161511]'
                        }`}
                      >
                        {d.label}
                      </button>
                    ))}
                    {!isGeneratingScript && !isExpandingDialogue && (
                      <PreCalculationBadge
                        estimatedSeconds={estimatedInterviewScriptSeconds}
                        lang={lang}
                        className="ml-auto"
                      />
                    )}
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder={
                      lang === 'uz'
                        ? "Intervyu mavzusi (masalan: Sun'iy intellekt kelajagi va O'zbekiston)..."
                        : 'Тема интервью...'
                    }
                    className="flex-1 bg-white border border-[rgba(22,21,17,0.14)] rounded-xl px-4 py-2.5 text-xs sm:text-sm text-[#161511] placeholder:text-[#5D594E]/60 focus:outline-none focus:border-[#0E7C86]"
                  />
                  <button
                    onClick={handleGenerateInterview}
                    disabled={isGeneratingScript || !topic.trim()}
                    className="btn-pill btn-solid text-xs py-2.5 px-4 flex items-center justify-center gap-1.5 shrink-0"
                  >
                    <Sparkles className={`w-3.5 h-3.5 text-[#5CC8CF] ${isGeneratingScript ? 'animate-spin' : ''}`} />
                    {isGeneratingScript ? (
                      <span>{`Генерация: ~${interviewScriptCountdown.formattedRemaining}`}</span>
                    ) : (
                      `Создать ИИ-Диалог (${targetDuration})`
                    )}
                  </button>
                </div>
              </div>
            )}

            {(isGeneratingScript || isExpandingDialogue) && (
              <div className="pt-2">
                <GenerationCountdownHUD
                  countdown={interviewScriptCountdown}
                  isActive={isGeneratingScript || isExpandingDialogue}
                  lang={lang}
                  title="Создание сценария интервью"
                  subtitle={interviewScriptCountdown.phaseNameRu}
                />
              </div>
            )}
          </div>

          {/* STEP 02: Speakers Selector Card (Single Source of Truth, Cloned Voice allowed on ANY speaker) */}
          <div className="border border-[rgba(22,21,17,0.14)] rounded-[20px] bg-[rgba(255,255,255,0.52)] backdrop-blur-sm p-6 space-y-4 shadow-[0_30px_50px_-30px_rgba(22,21,17,0.15)]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#0A5A62] flex-1">
                <span>02 — {lang === 'uz' ? 'Ishtirokchilar va Ovozlar' : 'Участники и Голоса (Единая настройка)'}</span>
                <span className="h-[1px] flex-1 bg-[rgba(22,21,17,0.14)] mr-3" />
              </div>
              <span className="text-[11px] font-mono text-[#0E7C86]">
                {2 + extraSpeakers.length} {lang === 'uz' ? 'spiker' : 'спикера'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Speaker 1 */}
              <div className="p-4 rounded-2xl bg-white border border-[rgba(22,21,17,0.14)] space-y-3 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#0A5A62] flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5" /> Спикер 1 (HOST_1)
                  </span>
                  <span className="text-[10px] font-mono text-[#0E7C86] border border-[#0E7C86]/30 px-2 py-0.5 rounded-full bg-[#0E7C86]/5">
                    {speaker1Gender === 'female' ? '♀ Женский' : '♂ Мужской'}
                  </span>
                </div>

                <div>
                  <label className="text-[10px] uppercase font-mono text-[#5D594E] block mb-1">
                    Имя спикера в раскадровке:
                  </label>
                  <input
                    type="text"
                    value={speaker1Name}
                    onChange={(e) => {
                      const newName = e.target.value;
                      setSpeaker1Name(newName);
                      setTurns((prev) =>
                        prev.map((t) => (t.speakerId === 'HOST_1' ? { ...t, speakerName: newName } : t))
                      );
                    }}
                    className="w-full bg-[#F4F1EA]/50 border border-[rgba(22,21,17,0.14)] rounded-xl px-3 py-1.5 text-xs text-[#161511] focus:outline-none focus:border-[#0E7C86]"
                    placeholder="Девушка (Ж)"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] uppercase font-mono text-[#5D594E]">
                      Голос Спикера 1:
                    </label>
                    <button
                      type="button"
                      onClick={() => handleTestSpeakerVoice('host1')}
                      className="text-[11px] text-[#0E7C86] hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      {previewingSpeaker === 'host1' ? (
                        <>
                          <Pause className="w-3 h-3 animate-spin" />
                          <span>Стоп</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3 h-3 fill-current" />
                          <span>Прослушать</span>
                        </>
                      )}
                    </button>
                  </div>
                  <select
                    value={speaker1VoiceId}
                    onChange={(e) => handleSelectSpeaker1Voice(e.target.value)}
                    className="w-full bg-[#F4F1EA]/50 border border-[rgba(22,21,17,0.14)] rounded-xl px-3 py-1.5 text-xs text-[#161511] focus:outline-none focus:border-[#0E7C86] cursor-pointer"
                  >
                    {voices.map((v) => {
                      const isFem =
                        v.gender === 'female' ||
                        ['Kore', 'Aoede', 'Zephyr'].includes(v.baseVoice);
                      return (
                        <option key={v.id} value={v.id}>
                          {isFem ? '♀ ' : '♂ '}
                          {v.name} {v.isReplicatedVoice || v.id.includes('17raj9') ? '★ (Ваш Клон Голоса)' : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] uppercase font-mono text-[#5D594E] block mb-1">
                    Базовый темп:
                  </label>
                  <div className="grid grid-cols-4 gap-1">
                    {['0.85x', '1.0x', '1.1x', '1.15x'].map((tVal) => (
                      <button
                        key={tVal}
                        type="button"
                        onClick={() => setSpeaker1Tempo(tVal)}
                        className={`py-1 px-1.5 text-[11px] rounded-lg font-mono transition-all text-center cursor-pointer ${
                          speaker1Tempo === tVal
                            ? 'bg-[#161511] text-[#F4F1EA] font-bold'
                            : 'bg-[#F4F1EA]/60 text-[#5D594E] hover:text-[#161511] border border-[rgba(22,21,17,0.1)]'
                        }`}
                      >
                        {tVal}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Speaker 2 (Now supports selecting Shohrux's Cloned Voice!) */}
              <div className="p-4 rounded-2xl bg-white border border-[rgba(196,85,45,0.3)] space-y-3 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#C4552D] flex items-center gap-1.5">
                    <Bot className="w-3.5 h-3.5" /> Спикер 2 (HOST_2)
                  </span>
                  <div className="flex items-center gap-1 bg-[#F4F1EA] p-0.5 rounded-lg border border-[rgba(22,21,17,0.1)]">
                    <button
                      type="button"
                      onClick={() => handleSetSpeaker2GenderFilter('all')}
                      className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                        speaker2GenderFilter === 'all'
                          ? 'bg-[#161511] text-[#F4F1EA] font-bold'
                          : 'text-[#5D594E] hover:text-[#161511]'
                      }`}
                    >
                      Все
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSetSpeaker2GenderFilter('female')}
                      className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                        speaker2GenderFilter === 'female'
                          ? 'bg-[#C4552D] text-white font-bold'
                          : 'text-[#5D594E] hover:text-[#161511]'
                      }`}
                    >
                      Жен
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSetSpeaker2GenderFilter('male')}
                      className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                        speaker2GenderFilter === 'male'
                          ? 'bg-[#0E7C86] text-white font-bold'
                          : 'text-[#5D594E] hover:text-[#161511]'
                      }`}
                    >
                      Муж
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] uppercase font-mono text-[#5D594E] block mb-1">
                    Имя спикера в раскадровке:
                  </label>
                  <input
                    type="text"
                    value={speaker2Name}
                    onChange={(e) => {
                      const newName = e.target.value;
                      setSpeaker2Name(newName);
                      setTurns((prev) =>
                        prev.map((t) => (t.speakerId === 'HOST_2' ? { ...t, speakerName: newName } : t))
                      );
                    }}
                    className="w-full bg-[#F4F1EA]/50 border border-[rgba(22,21,17,0.14)] rounded-xl px-3 py-1.5 text-xs text-[#161511] focus:outline-none focus:border-[#C4552D]"
                    placeholder="Мужчина (М)"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] uppercase font-mono text-[#5D594E]">
                      Голос Спикера 2 (Доступен ваш Клон Голоса):
                    </label>
                    <button
                      type="button"
                      onClick={() => handleTestSpeakerVoice('host2')}
                      className="text-[11px] text-[#C4552D] hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      {previewingSpeaker === 'host2' ? (
                        <>
                          <Pause className="w-3 h-3 animate-spin" />
                          <span>Стоп</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3 h-3 fill-current" />
                          <span>Прослушать</span>
                        </>
                      )}
                    </button>
                  </div>
                  <select
                    value={speaker2VoiceId}
                    onChange={(e) => handleSelectSpeaker2Voice(e.target.value)}
                    className="w-full bg-[#F4F1EA]/50 border border-[rgba(22,21,17,0.14)] rounded-xl px-3 py-1.5 text-xs text-[#161511] focus:outline-none focus:border-[#C4552D] cursor-pointer"
                  >
                    {voices
                      .filter((v) => {
                        const isFemale =
                          v.gender === 'female' ||
                          ['Kore', 'Aoede', 'Zephyr'].includes(v.baseVoice);
                        const isMale = !isFemale;
                        if (speaker2GenderFilter === 'female') return isFemale;
                        if (speaker2GenderFilter === 'male') return isMale;
                        return true;
                      })
                      .map((v) => {
                        const isFemale =
                          v.gender === 'female' ||
                          ['Kore', 'Aoede', 'Zephyr'].includes(v.baseVoice);
                        return (
                          <option key={v.id} value={v.id}>
                            {isFemale ? '♀ ' : '♂ '}
                            {v.name} {v.isReplicatedVoice || v.id.includes('17raj9') ? '★ (Ваш Клон Голоса)' : ''}
                          </option>
                        );
                      })}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] uppercase font-mono text-[#5D594E] block mb-1">
                    Базовый темп:
                  </label>
                  <div className="grid grid-cols-4 gap-1">
                    {['0.85x', '1.0x', '1.1x', '1.15x'].map((tVal) => (
                      <button
                        key={tVal}
                        type="button"
                        onClick={() => setSpeaker2Tempo(tVal)}
                        className={`py-1 px-1.5 text-[11px] rounded-lg font-mono transition-all text-center cursor-pointer ${
                          speaker2Tempo === tVal
                            ? 'bg-[#161511] text-[#F4F1EA] font-bold'
                            : 'bg-[#F4F1EA]/60 text-[#5D594E] hover:text-[#161511] border border-[rgba(22,21,17,0.1)]'
                        }`}
                      >
                        {tVal}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Extra Speakers (HOST_3+) when detected in storyboard */}
            {extraSpeakers.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-[rgba(22,21,17,0.1)]">
                {extraSpeakers.map((sp, idx) => (
                  <div key={sp.speakerId} className="p-3 rounded-xl bg-white border border-[rgba(22,21,17,0.14)] flex items-center justify-between gap-2 text-xs">
                    <div>
                      <span className="font-mono text-[10px] text-[#0E7C86] uppercase block">{sp.speakerId}</span>
                      <span className="font-bold text-[#161511]">{sp.name}</span>
                    </div>
                    <select
                      value={sp.voiceId}
                      onChange={(e) => {
                        const chosen = voices.find((v) => v.id === e.target.value);
                        setExtraSpeakers((prev) =>
                          prev.map((item, i) =>
                            i === idx
                              ? { ...item, voiceId: e.target.value, baseVoice: chosen?.baseVoice || item.baseVoice }
                              : item
                          )
                        );
                      }}
                      className="bg-[#F4F1EA] border border-[rgba(22,21,17,0.14)] rounded-lg px-2.5 py-1 text-xs"
                    >
                      {voices.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* STEP 03: Synchronized Video Player & 1:1 Timecode Turn Table */}
          <div className="border border-[rgba(22,21,17,0.14)] rounded-[20px] bg-[rgba(255,255,255,0.52)] backdrop-blur-sm p-6 space-y-4 shadow-[0_30px_50px_-30px_rgba(22,21,17,0.15)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#0A5A62] flex-1 min-w-[240px]">
                <span>03 — {lang === 'uz' ? 'Taymkodlar Jadvali va Video Sinxronizatsiya' : 'Таблица реплик 1:1 по таймкодам и видеоплеер'}</span>
                <span className="h-[1px] flex-1 bg-[rgba(22,21,17,0.14)] mr-3" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleOpenImportModal}
                  className="text-[11px] px-2.5 py-1 rounded-lg bg-[#161511] hover:bg-[#0A5A62] text-white font-semibold cursor-pointer inline-flex items-center gap-1"
                >
                  <FileUp className="w-3 h-3 text-[#5CC8CF]" />
                  <span>Импорт сценария</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExportScript('json')}
                  disabled={turns.length === 0}
                  className="text-[11px] px-2.5 py-1 rounded-lg bg-white hover:bg-[#F4F1EA] text-[#161511] border border-[rgba(22,21,17,0.16)] font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
                >
                  <FileDown className="w-3 h-3 text-[#0E7C86]" />
                  <span>JSON</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExportScript('csv')}
                  disabled={turns.length === 0}
                  className="text-[11px] px-2.5 py-1 rounded-lg bg-white hover:bg-[#F4F1EA] text-[#161511] border border-[rgba(22,21,17,0.16)] font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
                >
                  <FileDown className="w-3 h-3 text-[#0E7C86]" />
                  <span>CSV</span>
                </button>
                <span className="text-xs font-mono text-[#5D594E]">
                  {turns.length} реплик · {noSpeechIntervals.length} вставок «Без слов»
                </span>
              </div>
            </div>

            {/* Uploaded Local Video Synchronized Player & Background Audio Ducking Selector */}
            {uploadedVideoPreviewUrl && (
              <div className="p-4 bg-white border border-[#0E7C86]/30 rounded-2xl space-y-3.5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-full bg-[#0E7C86] text-white font-mono text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                      <Film className="w-3 h-3" /> Синхронный Видео-Превью
                    </span>
                    <h4 className="text-xs font-bold text-[#161511] truncate max-w-md">
                      {uploadedVideoFileName}
                    </h4>
                  </div>

                  {/* Background Audio Ducking Selector */}
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-[10px] font-mono uppercase text-[#5D594E]">Фон видео:</span>
                    <select
                      value={duckingMode}
                      onChange={(e) => setDuckingMode(e.target.value as any)}
                      className="bg-[#FAF8F3] border border-[rgba(22,21,17,0.14)] rounded-lg px-2.5 py-1 text-[11px] font-medium text-[#161511] focus:outline-none focus:border-[#0E7C86]"
                    >
                      <option value="smart_ducking">🔉 Приглушать русскую речь до 15%, музыка «Без слов» 100%</option>
                      <option value="mute_speech_keep_music">🔇 Убрать русскую речь (0%), оставить музыку «Без слов» (100%)</option>
                      <option value="voice_only">🎙️ Только узбекские голоса (оригинал видео 0%)</option>
                    </select>
                  </div>
                </div>

                <div className="aspect-video w-full max-h-[340px] rounded-xl overflow-hidden border border-[rgba(22,21,17,0.15)] bg-black flex items-center justify-center">
                  <video
                    ref={dubVideoRef}
                    src={uploadedVideoPreviewUrl}
                    controls
                    className="w-full h-full object-contain"
                  />
                </div>
              </div>
            )}

            {/* Musical / Graphic Intervals («Без слов») Badge Strip */}
            {noSpeechIntervals.length > 0 && (
              <div className="p-3.5 rounded-2xl bg-[#FAF8F3] border border-[rgba(14,124,134,0.25)] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono uppercase tracking-wider text-[#0A5A62] font-bold flex items-center gap-1.5">
                    <Music className="w-3.5 h-3.5 text-[#0E7C86]" />
                    Музыкальные и графические паузы «Без слов» (Голос молчит, играет оригинал видео 100%):
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {noSpeechIntervals.map((interval, idx) => (
                    <div
                      key={idx}
                      className="px-3 py-1.5 rounded-xl bg-white border border-[rgba(22,21,17,0.12)] text-xs flex items-center gap-2 shadow-2xs"
                    >
                      <span className="font-mono text-[10.5px] font-bold px-2 py-0.5 rounded bg-[#0E7C86] text-white">
                        🎵 {interval.timecode} ({interval.durationSec}s)
                      </span>
                      <span className="text-[11px] text-[#5D594E] line-clamp-1 max-w-xs" title={interval.description}>
                        {interval.description}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Toolbar: Invert Speakers, Clean Conditions, Master Audio Mode */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-white border border-[rgba(22,21,17,0.14)] rounded-xl shadow-xs">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleInvertAllSpeakers}
                  className="btn-pill btn-ghost text-xs py-1.5 px-3 flex items-center gap-1.5 cursor-pointer border border-[rgba(22,21,17,0.14)]"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5 text-[#5D594E]" />
                  <span>Поменять спикеров местами (⇄)</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowOriginalTranscript(!showOriginalTranscript)}
                  className="btn-pill btn-ghost text-xs py-1.5 px-3 flex items-center gap-1.5 cursor-pointer border border-[rgba(22,21,17,0.14)]"
                >
                  <FileText className="w-3.5 h-3.5 text-[#0E7C86]" />
                  <span>{showOriginalTranscript ? 'Скрыть оригинал (RU) / Видеоряд' : 'Показать оригинал (RU) / Видеоряд'}</span>
                </button>
              </div>

              {/* Master Audio Mode Toggle */}
              <div className="flex items-center gap-1.5 bg-[#FAF8F3] p-1 rounded-xl border border-[rgba(22,21,17,0.1)] text-xs">
                <span className="text-[10px] uppercase font-mono text-[#5D594E] px-1 font-semibold">
                  Сборка:
                </span>
                <button
                  type="button"
                  onClick={() => setMasterAudioMode('time_aligned')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                    masterAudioMode === 'time_aligned'
                      ? 'bg-[#0E7C86] text-white shadow-xs'
                      : 'text-[#5D594E] hover:text-[#161511]'
                  }`}
                  title="Строго по секундам таймкодов раскадровки (с сохранением пауз Без слов)"
                >
                  ⏱️ Строго по таймкодам (1:1)
                </button>
                <button
                  type="button"
                  onClick={() => setMasterAudioMode('continuous')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                    masterAudioMode === 'continuous'
                      ? 'bg-[#161511] text-[#F4F1EA] shadow-xs'
                      : 'text-[#5D594E] hover:text-[#161511]'
                  }`}
                  title="Слитный подкаст с паузой 0.35с между репликами"
                >
                  🎙️ Слитный подкаст
                </button>
              </div>
            </div>

            {/* Turn by turn list */}
            {turns.length === 0 ? (
              <div className="p-8 rounded-2xl bg-white border border-dashed border-[rgba(22,21,17,0.2)] text-center space-y-3">
                <FileText className="w-8 h-8 text-[#0E7C86] mx-auto opacity-80" />
                <p className="text-xs sm:text-sm font-semibold text-[#161511]">
                  Таблица реплик пуста (новый или чистый проект)
                </p>
                <p className="text-xs text-[#5D594E] max-w-xl mx-auto leading-relaxed">
                  Вставьте свою русскую раскадровку с таймкодами в Шаге 01 и нажмите{' '}
                  <strong>«🎯 Разобрать и перевести 1:1»</strong>, либо добавьте реплику вручную. История и черновики сохраняются строго индивидуально для каждого аккаунта.
                </p>
              </div>
            ) : null}
            <div className="space-y-3 pt-1">
              {turns.map((turn, index) => {
                const isHost1 = turn.speakerId === 'HOST_1';
                const isCurrentlyActive = activeTurnIndex === index;
                const synthTurn = synthesizedTurns.find((st) => st.id === turn.id) || synthesizedTurns[index];
                const turnAudio = synthTurn?.audioBase64;
                const isTurnPlaying = playingTurnId === turn.id;
                const isResynthesizingThis = resynthesizingTurnId === turn.id;

                return (
                  <div
                    key={turn.id}
                    className={`p-4 rounded-2xl border transition-all ${
                      isCurrentlyActive
                        ? 'border-[#0E7C86] bg-[rgba(14,124,134,0.06)] shadow-sm'
                        : isHost1
                        ? 'bg-white border-[rgba(22,21,17,0.14)] border-l-4 border-l-[#0E7C86] shadow-xs'
                        : 'bg-[#FAF8F3] border-[rgba(22,21,17,0.14)] border-l-4 border-l-[#C4552D] shadow-xs'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => toggleTurnSpeaker(turn.id)}
                          className={`btn-pill text-xs py-1 px-3 flex items-center gap-1.5 cursor-pointer font-bold transition-all shadow-xs ${
                            isHost1
                              ? 'bg-[#0E7C86]/10 text-[#0A5A62] border border-[#0E7C86]/40 hover:bg-[#0E7C86] hover:text-white'
                              : 'bg-[#C4552D]/10 text-[#C4552D] border border-[#C4552D]/40 hover:bg-[#C4552D] hover:text-white'
                          }`}
                          title="Нажмите для смены спикера (Спикер 1 ⇄ Спикер 2)"
                        >
                          {isHost1 ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
                          <span>{turn.speakerName || (isHost1 ? speaker1Name : speaker2Name)}</span>
                          <span className="text-[10px] font-mono opacity-85">
                            ({(turn.speakerGender || (isHost1 ? speaker1Gender : speaker2Gender)) === 'female' ? 'Ж' : 'М'}) ⇄
                          </span>
                        </button>

                        {turn.timecode && (
                          <span className="font-mono text-[10.5px] font-bold px-2.5 py-0.5 rounded-lg bg-[#161511] text-[#FACC15] flex items-center gap-1 shadow-2xs">
                            ⏱ {turn.timecode} {turn.durationSec ? `(${turn.durationSec}s)` : ''}
                          </span>
                        )}

                        {(turn.intonationRu || turn.emotion) && (
                          <span
                            className="text-[10.5px] px-2.5 py-0.5 rounded-full bg-[#C4552D]/10 text-[#C4552D] border border-[#C4552D]/30 font-medium"
                            title="Эмоция / интонация из раскадровки (управляет стилем Gemini 3.8 TTS)"
                          >
                            🎭 {turn.intonationRu || turn.emotion}
                          </span>
                        )}

                        {Array.isArray(turn.nonSpeechEvents) && turn.nonSpeechEvents.length > 0 && (
                          <span
                            className="font-mono text-[10px] px-2.5 py-0.5 rounded-full bg-[#0E7C86]/12 text-[#0A5A62] border border-[#0E7C86]/35 font-semibold"
                            title="Неречевые реакции (вынесены отдельно из текста в non_speech_events)"
                          >
                            🔊 non_speech: {turn.nonSpeechEvents.join(', ')}
                          </span>
                        )}

                        {(() => {
                          const effSyncStatus = synthTurn?.syncStatus || turn.syncStatus;
                          const effQa = synthTurn?.qa || turn.qa;
                          const effQaReason = synthTurn?.qaReason || turn.qaReason;
                          const effSlicingMethod = synthTurn?.slicingMethod || turn.slicingMethod;
                          const effOrigDur =
                            synthTurn?.originalDurationSec ??
                            turn.originalDurationSec ??
                            turn.durationSec;
                          const effDubDur =
                            synthTurn?.dubbedDurationSec ??
                            turn.dubbedDurationSec ??
                            synthTurn?.durationSeconds;
                          const effAtempo =
                            synthTurn?.atempoApplied ?? turn.atempoApplied;
                          const effShift =
                            synthTurn?.shiftedStartBySec ?? turn.shiftedStartBySec;
                          const effNeedsShorten = Boolean(
                            synthTurn?.needsShorten ?? turn.needsShorten
                          );
                          const effRephrase =
                            synthTurn?.rephraseAttempts ?? turn.rephraseAttempts;

                          return (
                            <>
                              {effQa && (
                                <span
                                  className={`font-mono text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                    effQa === 'ok'
                                      ? 'bg-emerald-500/10 text-emerald-800 border-emerald-500/35'
                                      : effQa === 'retried'
                                      ? 'bg-amber-500/15 text-amber-900 border-amber-500/45'
                                      : 'bg-rose-500/15 text-rose-800 border-rose-500/45'
                                  }`}
                                  title={
                                    effQaReason
                                      ? `QA (${effQa}): ${effQaReason}`
                                      : `Проверка качества подблока: ${effQa}`
                                  }
                                >
                                  QA: {effQa}
                                </span>
                              )}

                              {effSlicingMethod && (
                                <span
                                  className="font-mono text-[10px] px-2 py-0.5 rounded-lg bg-[#161511]/5 text-[#5D594E] border border-[rgba(22,21,17,0.12)]"
                                  title="Метод нарезки подблока"
                                >
                                  {effSlicingMethod}
                                </span>
                              )}

                              {effSyncStatus && (
                                <span
                                  className={`font-mono text-[10.5px] font-bold px-2.5 py-0.5 rounded-full border flex items-center gap-1 ${
                                    effSyncStatus === 'ok'
                                      ? 'bg-emerald-500/12 text-emerald-800 border-emerald-500/40'
                                      : effSyncStatus === 'adjusted'
                                      ? 'bg-amber-500/15 text-amber-900 border-amber-500/45'
                                      : 'bg-rose-500/15 text-rose-800 border-rose-500/45'
                                  }`}
                                  title="Статус синхронизации реплики: ok | adjusted | overflow"
                                >
                                  <span>
                                    {effSyncStatus === 'ok'
                                      ? '○'
                                      : effSyncStatus === 'adjusted'
                                      ? '🟡'
                                      : '●'}
                                  </span>
                                  <span>{effSyncStatus}</span>
                                </span>
                              )}

                              {effNeedsShorten && (
                                <span
                                  className="font-mono text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-900 border border-rose-400"
                                  title="Даже при ускорении 1.15x реплика не умещается в окно. Текст не менялся — сократите вручную или нажмите «Быстрее»."
                                >
                                  нужно сократить
                                </span>
                              )}

                              {(typeof effOrigDur === 'number' || typeof effDubDur === 'number') && (
                                <span
                                  className="font-mono text-[10px] px-2 py-0.5 rounded-lg bg-[#FAF8F3] text-[#161511] border border-[rgba(22,21,17,0.14)]"
                                  title="Длительность клипа / окна (dubbedDurationSec / originalDurationSec)"
                                >
                                  Клип: {typeof effDubDur === 'number' ? `${effDubDur}s` : '—'} / Окно:{' '}
                                  {typeof effOrigDur === 'number' ? `${effOrigDur}s` : '—'}
                                </span>
                              )}

                              {typeof effShift === 'number' && effShift > 0.005 && (
                                <span
                                  className={`font-mono text-[10px] px-2 py-0.5 rounded-lg border ${
                                    effShift > 1.2
                                      ? 'bg-rose-50 text-rose-800 border-rose-300 font-bold'
                                      : 'bg-amber-50 text-amber-900 border-amber-300'
                                  }`}
                                  title="Сдвиг старта реплики относительно оригинала (shiftedStartBySec)"
                                >
                                  сдвиг +{effShift.toFixed(2)}s
                                </span>
                              )}

                              {typeof effAtempo === 'number' && effAtempo > 1.005 && (
                                <span
                                  className="font-mono text-[10px] px-2 py-0.5 rounded-lg bg-[#0E7C86]/10 text-[#0A5A62] border border-[#0E7C86]/30"
                                  title="Коэффициент ускорения atempo"
                                >
                                  atempo: {effAtempo}x
                                </span>
                              )}

                              {typeof effRephrase === 'number' && effRephrase > 0 && (
                                <span
                                  className="font-mono text-[10px] px-2 py-0.5 rounded-lg bg-[#C4552D]/10 text-[#C4552D] border border-[#C4552D]/30"
                                  title="Число ручных сокращений"
                                >
                                  перефраз: {effRephrase}
                                </span>
                              )}

                              {effQa === 'failed' && effQaReason && (
                                <span className="text-[10.5px] text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-lg">
                                  ⚠ {effQaReason}
                                </span>
                              )}
                            </>
                          );
                        })()}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {turnAudio && (
                          <button
                            type="button"
                            onClick={() => playSingleTurn(turn.id, turnAudio)}
                            className="btn-pill btn-ghost text-[10.5px] py-1 px-2.5 flex items-center gap-1 cursor-pointer border border-[rgba(22,21,17,0.14)]"
                          >
                            {isTurnPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                            <span>{isTurnPlaying ? 'Пауза' : 'Слушать'}</span>
                          </button>
                        )}

                        {/* Button: "Быстрее" (1 TTS call with fast pace hint, NO text rewrite) */}
                        <button
                          type="button"
                          onClick={() =>
                            handleResynthesizeSingleTurn(turn, { forceFastPace: true })
                          }
                          disabled={
                            fastPacingTurnId === turn.id ||
                            shorteningTurnId === turn.id ||
                            isResynthesizingThis ||
                            resynthesizingSubBlockIndex !== null ||
                            isSynthesizing
                          }
                          className="btn-pill btn-ghost text-[10.5px] py-1 px-2.5 flex items-center gap-1 cursor-pointer border border-amber-500/45 text-amber-900 hover:bg-amber-600 hover:text-white transition-all"
                          title="Перегенерировать эту реплику в ускоренном темпе (1 вызов TTS, текст не меняется)"
                        >
                          <Zap
                            className={`w-3 h-3 ${
                              fastPacingTurnId === turn.id ? 'animate-pulse' : ''
                            }`}
                          />
                          <span>{fastPacingTurnId === turn.id ? 'Быстрее...' : 'Быстрее'}</span>
                        </button>

                        {/* Button: "Перегенерировать реплику" (1 TTS call) */}
                        <button
                          type="button"
                          onClick={() => handleResynthesizeSingleTurn(turn)}
                          disabled={
                            isResynthesizingThis ||
                            fastPacingTurnId === turn.id ||
                            shorteningTurnId === turn.id ||
                            resynthesizingSubBlockIndex !== null ||
                            isSynthesizing
                          }
                          className="btn-pill btn-ghost text-[10.5px] py-1 px-2.5 flex items-center gap-1 cursor-pointer border border-[#0E7C86]/35 text-[#0A5A62] hover:bg-[#0E7C86] hover:text-white transition-all"
                          title="Перегенерировать только эту реплику (1 вызов TTS) и пересобрать мастер-дорожку"
                        >
                          <RefreshCw className={`w-3 h-3 ${isResynthesizingThis ? 'animate-spin' : ''}`} />
                          <span>{isResynthesizingThis ? 'Озвучка...' : 'Перегенерировать реплику'}</span>
                        </button>

                        {/* Button: "Перегенерировать подблок" (1 sub-block call with bypassCache: true) */}
                        {(() => {
                          const subBlockForTurn = plannedSubBlocks.find(
                            (sb) => index >= sb.startTurnIndex && index <= sb.endTurnIndex
                          );
                          if (!subBlockForTurn) return null;
                          const isSubBlockBusy =
                            resynthesizingSubBlockIndex === subBlockForTurn.globalSubBlockIndex;
                          return (
                            <button
                              type="button"
                              onClick={() => handleResynthesizeSubBlock(index)}
                              disabled={
                                isSubBlockBusy ||
                                resynthesizingSubBlockIndex !== null ||
                                isResynthesizingThis ||
                                fastPacingTurnId === turn.id ||
                                shorteningTurnId === turn.id ||
                                isSynthesizing
                              }
                              className="btn-pill btn-ghost text-[10.5px] py-1 px-2.5 flex items-center gap-1 cursor-pointer border border-[#C4552D]/40 text-[#C4552D] hover:bg-[#C4552D] hover:text-white transition-all"
                              title={`Перегенерировать подблок #${subBlockForTurn.globalSubBlockIndex + 1} (${subBlockForTurn.startTimecode}–${subBlockForTurn.endTimecode}, ${subBlockForTurn.turns.length} репл.) без кэша`}
                            >
                              <Layers className={`w-3 h-3 ${isSubBlockBusy ? 'animate-spin' : ''}`} />
                              <span>
                                {isSubBlockBusy
                                  ? 'Подблок...'
                                  : `Перегенерировать подблок #${subBlockForTurn.globalSubBlockIndex + 1}`}
                              </span>
                            </button>
                          );
                        })()}

                        {/* Button: "Изменить" (focus/toggle editing for this turn) */}
                        <button
                          type="button"
                          onClick={() => {
                            setEditingTurnId((prev) => (prev === turn.id ? null : turn.id));
                            const el = document.getElementById(`turn-textarea-${turn.id}`);
                            if (el) el.focus();
                          }}
                          className={`btn-pill btn-ghost text-[10.5px] py-1 px-2.5 flex items-center gap-1 cursor-pointer border transition-all ${
                            editingTurnId === turn.id
                              ? 'bg-[#161511] text-white border-[#161511]'
                              : 'border-[rgba(22,21,17,0.2)] text-[#161511] hover:bg-[#161511] hover:text-white'
                          }`}
                          title="Редактировать текст реплики вручную"
                        >
                          <span>{editingTurnId === turn.id ? 'Готово' : 'Изменить'}</span>
                        </button>

                        <button
                          onClick={() => removeTurn(turn.id)}
                          className="p-1.5 text-[#5D594E] hover:text-[#C4552D] rounded-full hover:bg-[rgba(196,85,45,0.08)] transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Visual Context (Видеоряд - hidden from TTS) & Original Russian Speech (Текст) */}
                    {showOriginalTranscript && (turn.originalTextRu || turn.originalText || turn.visualContext) && (
                      <div className="mb-2.5 p-2.5 rounded-xl bg-[#FAF8F3] border border-[rgba(22,21,17,0.08)] text-xs space-y-1">
                        {turn.visualContext && (
                          <div className="flex items-start gap-1.5 text-[11px] text-[#5D594E]">
                            <EyeOff className="w-3.5 h-3.5 text-[#0E7C86] shrink-0 mt-0.5" />
                            <span>
                              <strong className="font-mono uppercase text-[10px] text-[#0A5A62]">Видеоряд (не озвучивается):</strong>{' '}
                              {turn.visualContext}
                            </span>
                          </div>
                        )}
                        {(turn.originalTextRu || turn.originalText) && (
                          <div className="text-[12px] text-[#161511]">
                            <span className="font-mono uppercase text-[10px] text-[#C4552D] font-bold mr-1.5">
                              Текст (RU):
                            </span>
                            <span className="font-serif italic">«{turn.originalTextRu || turn.originalText}»</span>
                          </div>
                        )}
                      </div>
                    )}

                    <textarea
                      id={`turn-textarea-${turn.id}`}
                      rows={editingTurnId === turn.id ? 3 : 2}
                      value={turn.text}
                      onChange={(e) => updateTurnText(turn.id, e.target.value)}
                      className={`w-full bg-white border rounded-xl p-3 text-xs sm:text-sm text-[#161511] focus:outline-none resize-none font-sans leading-relaxed shadow-2xs transition-all ${
                        editingTurnId === turn.id
                          ? 'border-[#0E7C86] ring-2 ring-[#0E7C86]/20'
                          : 'border-[rgba(22,21,17,0.14)] focus:border-[#0E7C86]'
                      }`}
                      placeholder="Перевод реплики 1:1 на узбекском языке..."
                    />

                    {/* Strictly Documented Gemini 3.8 TTS Tags ONLY (<laugh>, <sigh>, <short pause>, <breath>, <cough>) */}
                    <div className="flex flex-wrap items-center gap-1.5 mt-2 pt-1 text-[11px]">
                      <span className="font-mono text-[10px] text-[#5D594E] uppercase tracking-wider">
                        Теги Gemini 3.8 TTS:
                      </span>
                      {[
                        { tag: '<laugh>', label: '😄 <laugh>', title: 'Смех / усмешка (документированный тег)' },
                        { tag: '<short pause>', label: '⏱️ <short pause>', title: 'Короткая пауза в речи' },
                        { tag: '<sigh>', label: '😮‍💨 <sigh>', title: 'Вздох облегчения или удивления' },
                        { tag: '<breath>', label: '🌬️ <breath>', title: 'Живой вдох перед фразой' },
                        { tag: '<cough>', label: '🤧 <cough>', title: 'Покашливание' },
                      ].map((item) => (
                        <button
                          key={item.tag}
                          type="button"
                          onClick={() => handleInsertTagToTurn(turn.id, item.tag)}
                          className="px-2.5 py-0.5 rounded-full border border-[#0E7C86]/35 bg-[#0E7C86]/5 text-[#0A5A62] hover:bg-[#0E7C86] hover:text-white transition-all text-[10.5px] font-mono cursor-pointer"
                          title={item.title}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Quota Pause / Resume Banner for Cloned Voice 429 (Раздел 2.8) */}
            {quotaPausedInfo && !isSynthesizing && (
              <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-950 flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="font-semibold">{quotaPausedInfo.messageRu}</div>
                  <div className="text-[11px] text-amber-800">
                    Сохранено реплик: {turns.length - quotaPausedInfo.remainingTurnsCount} из {turns.length} (без подмены клонированного голоса).
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleSynthesizeDialogue(true)}
                  className="btn-pill btn-solid text-xs px-4 py-2 cursor-pointer whitespace-nowrap"
                >
                  Продолжить оставшиеся блоки ({quotaPausedInfo.remainingTurnsCount} репл.)
                </button>
              </div>
            )}

            {/* Pre-Synthesis Macro-Blocks Plan Preview */}
            {!isSynthesizing && plannedMacroBlocks.length > 0 && (
              <div className="rounded-2xl border border-[rgba(22,21,17,0.12)] bg-[#FAF8F3] px-4 py-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
                  <span className="font-bold text-[#0A5A62] uppercase tracking-wider">
                    План нарезки на блоки ({plannedMacroBlocks.length} бл. · {turns.length} реплик)
                  </span>
                  <span className="text-[#5D594E]">
                    Единые голоса и базовый стиль спикеров во всех блоках
                  </span>
                </div>
                <div className="space-y-1.5">
                  {plannedMacroBlocks.map((blk) => {
                    const bnd = blk.boundaryAfter;
                    const boundaryTimeLabel = bnd
                      ? bnd.endOfBlockTimecode === bnd.startOfNextTimecode
                        ? bnd.endOfBlockTimecode
                        : `${bnd.endOfBlockTimecode} / ${bnd.startOfNextTimecode}`
                      : null;

                    return (
                      <div key={blk.blockIndex} className="space-y-1">
                        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-white border border-[rgba(22,21,17,0.1)] text-xs">
                          <div className="flex flex-wrap items-center gap-2 min-w-0">
                            <span className="font-mono text-[11px] font-bold text-[#0E7C86]">
                              Блок {blk.blockIndex + 1}
                            </span>
                            <span className="font-mono text-[11px] px-2 py-0.5 rounded-md bg-[#161511] text-[#FACC15]">
                              {blk.startTimecode}–{blk.endTimecode}
                            </span>
                            <span className="text-[11px] font-semibold text-[#161511]">
                              {blk.turns.length} реплик
                            </span>
                            {blk.sceneTitles.length > 0 && (
                              <span
                                className="text-[11px] text-[#5D594E] truncate max-w-[340px]"
                                title={blk.sceneTitles.join(' · ')}
                              >
                                {blk.sceneTitles.length === 1
                                  ? blk.sceneTitles[0]
                                  : `${blk.sceneTitles[0]} … ${blk.sceneTitles[blk.sceneTitles.length - 1]}`}
                              </span>
                            )}
                          </div>
                          <span className="font-mono text-[10.5px] text-[#5D594E]">
                            #{blk.startTurnIndex + 1}–{blk.endTurnIndex + 1}
                          </span>
                        </div>

                        {bnd && (
                          <div className="flex flex-wrap items-center gap-2 pl-4 text-[10.5px] font-mono">
                            <span className="text-[#5D594E]">
                              ↳ Граница {boundaryTimeLabel} (пауза {bnd.gapSec.toFixed(1)}с)
                            </span>
                            {bnd.isMidConversation ? (
                              <span
                                className={`px-2 py-0.5 rounded-md font-semibold ${
                                  bnd.reason === 'tight_pause_forced'
                                    ? 'bg-amber-100 text-amber-900 border border-amber-300'
                                    : 'bg-amber-50 text-amber-800 border border-amber-200'
                                }`}
                              >
                                {bnd.reason === 'tight_pause_forced'
                                  ? '⚠ Граница посреди разговора (пауза < 0.5с)'
                                  : '⚠ Граница посреди разговора (разрез длинной сцены)'}
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-md bg-[#0E7C86]/10 text-[#0A5A62] border border-[#0E7C86]/25">
                                ✓ Смена сцены
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Pre-Synthesis Voice Gender Mismatch / Cloned Voice Warning Strip */}
            {!isSynthesizing && synthesisVoiceWarnings.length > 0 && (
              <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-950 space-y-1">
                <div className="font-bold flex items-center gap-1.5 text-amber-900">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>Внимание по выбранным голосам (потребуется подтверждение перед запуском):</span>
                </div>
                <ul className="list-disc pl-5 space-y-0.5 text-[11.5px]">
                  {synthesisVoiceWarnings.map((w, idx) => (
                    <li key={idx}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Add turn button & Synthesize action + Quota Forecast (Раздел 2.8) */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 flex-wrap">
              <button
                onClick={addTurn}
                className="btn-pill btn-ghost text-xs px-4 py-2 flex items-center justify-center gap-1.5 w-full sm:w-auto"
              >
                <Plus className="w-4 h-4 text-[#0E7C86]" />
                {lang === 'uz' ? 'Yangi Replika Qoʻshish' : 'Добавить реплику'}
              </button>

              <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end flex-wrap">
                {!isSynthesizing && turns.length > 0 && (
                  <span
                    className={`text-[11px] font-mono tabular-nums px-2.5 py-1 rounded-lg border ${
                      ttsQuota && dubbingCallsForecast.estimatedCalls > ttsQuota.remaining
                        ? 'bg-amber-50 border-amber-300 text-amber-900 font-semibold'
                        : 'bg-[#FAF8F4] border-[rgba(22,21,17,0.12)] text-[#0A5A62]'
                    }`}
                    title={`Подблоков (<=8 реплик / <=40с): ${dubbingCallsForecast.subBlocks}. Базово TTS: ${dubbingCallsForecast.baseTtsCalls} + запас 20% (+${dubbingCallsForecast.retryBufferCalls}) = ~${dubbingCallsForecast.estimatedCalls} выз. TTS; транскрипция: ~${dubbingCallsForecast.transcribeCalls} выз.`}
                  >
                    {ttsQuota ? (
                      dubbingCallsForecast.estimatedCalls > ttsQuota.remaining
                        ? `⚠ ${dubbingCallsForecast.subBlocks} подбл. · ~${dubbingCallsForecast.baseTtsCalls} TTS (+20% = ${dubbingCallsForecast.estimatedCalls}) + ${dubbingCallsForecast.transcribeCalls} транскр. · квота ${ttsQuota.remaining}/${ttsQuota.limit}`
                        : `${dubbingCallsForecast.subBlocks} подбл. · ~${dubbingCallsForecast.baseTtsCalls} TTS (+20% = ${dubbingCallsForecast.estimatedCalls}) + ${dubbingCallsForecast.transcribeCalls} транскр. · квота ${ttsQuota.remaining}/${ttsQuota.limit}`
                    ) : (
                      `${dubbingCallsForecast.subBlocks} подбл. · ~${dubbingCallsForecast.baseTtsCalls} TTS (+20% = ${dubbingCallsForecast.estimatedCalls}) + ${dubbingCallsForecast.transcribeCalls} транскр.`
                    )}
                  </span>
                )}

                {!isSynthesizing && turns.length > 0 && (
                  <PreCalculationBadge
                    estimatedSeconds={estimatedDialogueSeconds}
                    creditsCost={Math.max(1, Math.ceil(turns.length / 3))}
                    lang={lang}
                  />
                )}

                {isSynthesizing && (
                  <button
                    type="button"
                    onClick={handleStopSynthesis}
                    className="btn-pill btn-ghost text-xs py-2.5 px-3.5 text-[#C4552D] border-[rgba(196,85,45,0.4)] hover:bg-[#C4552D]/10 flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <StopCircle className="w-4 h-4 text-[#C4552D]" />
                    <span>Стоп</span>
                  </button>
                )}

                <button
                  onClick={() => handleSynthesizeDialogue(false)}
                  disabled={isSynthesizing || turns.length === 0}
                  className="btn-pill btn-solid text-xs sm:text-sm py-2.5 px-6 flex items-center justify-center gap-2 w-full sm:w-auto shadow-sm"
                >
                  <Volume2 className={`w-4 h-4 text-[#5CC8CF] ${isSynthesizing ? 'animate-pulse' : ''}`} />
                  {isSynthesizing ? (
                    <>
                      <span>{`Синтез: ${dialogueCountdown.remainingDigits} (~${dialogueCountdown.formattedRemaining})`}</span>
                      <span className="font-mono text-[10px] bg-white/20 px-1.5 py-0.5 rounded-full">
                        {dialogueCountdown.progressPercent}%
                      </span>
                    </>
                  ) : (
                    '🎯 Озвучить Дубляж 1:1 по Таймкодам'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Step 04 — Master Audio & Export MP4 / WAV / SRT (4 cols) */}
        <div className="lg:col-span-4 space-y-6">
          <div className="border border-[rgba(22,21,17,0.14)] rounded-[20px] bg-[rgba(255,255,255,0.52)] backdrop-blur-sm p-5 space-y-4 shadow-[0_30px_50px_-30px_rgba(22,21,17,0.15)]">
            <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#0A5A62]">
              <span>04 — Мастер-аудио и Скачивание (MP4 / WAV / SRT)</span>
              <span className="h-[1px] flex-1 bg-[rgba(22,21,17,0.14)]" />
            </div>

            {masterAudioBase64 ? (
              <div className="space-y-4">
                <audio
                  ref={audioRef}
                  src={masterAudioBlobUrl || undefined}
                  onTimeUpdate={handleTimeUpdate}
                  onEnded={() => {
                    setIsPlaying(false);
                    setActiveTurnIndex(-1);
                    dubVideoRef.current?.pause();
                    ambientAudioRef.current?.pause();
                    if (ambientAudioRef.current) ambientAudioRef.current.currentTime = 0;
                  }}
                />

                {/* Dark Studio Master Console */}
                <div className="p-4 sm:p-5 rounded-2xl bg-[#141414] border border-[#2B2B27] text-[#EDEAE2] space-y-4 shadow-[0_30px_50px_-20px_rgba(20,20,20,0.45)]">
                  <div className="flex items-center gap-4">
                    <button
                      onClick={toggleMasterPlay}
                      className="w-12 h-12 rounded-full bg-[#0E7C86] hover:bg-[#0A5A62] text-white flex items-center justify-center transition-transform hover:scale-105 shadow-md shadow-[#0E7C86]/30 cursor-pointer shrink-0"
                    >
                      {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5 fill-current" />}
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between text-xs text-[#7D7A70]">
                        <span className="font-mono uppercase text-[10px] tracking-wider">Таймкод:</span>
                        <span className="font-mono text-[#5CC8CF] font-bold">
                          {(Number(masterCurrentTime) || 0).toFixed(1)}s / {totalDuration}s
                        </span>
                      </div>
                      <div className="flex items-center gap-1 mt-2 h-6">
                        {[30, 60, 90, 45, 80, 100, 70, 40, 85, 95, 60, 40, 75, 55, 90].map((h, i) => {
                          const barProgress = (i / 15) * totalDuration;
                          const isPassed = masterCurrentTime >= barProgress;
                          return (
                            <div
                              key={i}
                              className={`w-1 rounded-full transition-all ${
                                isPassed
                                  ? 'bg-[#5CC8CF]'
                                  : isPlaying
                                  ? 'bg-[#0E7C86]/30 animate-pulse'
                                  : 'bg-[#2B2B27]'
                              }`}
                              style={{ height: `${h}%` }}
                            />
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Seek Bar */}
                  <div
                    onClick={(e) => {
                      if (!audioRef.current || !totalDuration) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const clickPos = (e.clientX - rect.left) / rect.width;
                      const newTime = clickPos * totalDuration;
                      audioRef.current.currentTime = newTime;
                      setMasterCurrentTime(newTime);
                      if (dubVideoRef.current) {
                        dubVideoRef.current.currentTime = newTime;
                      }
                    }}
                    className="relative h-2 bg-[#2B2B27] rounded-full overflow-hidden cursor-pointer"
                  >
                    <div
                      className="absolute left-0 top-0 bottom-0 bg-[#0E7C86] rounded-full transition-all"
                      style={{ width: `${totalDuration > 0 ? (masterCurrentTime / totalDuration) * 100 : 0}%` }}
                    />
                  </div>
                </div>

                {/* Live Synced Transcript Feed */}
                <div className="space-y-2">
                  <p className="font-mono text-[10.5px] uppercase tracking-wider text-[#5D594E]">
                    Синхронный эфир по секундам:
                  </p>
                  <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                    {synthesizedTurns.map((turn, i) => {
                      const isActive = activeTurnIndex === i;
                      const isHost1 = turn.speakerId === 'HOST_1';
                      return (
                        <div
                          key={turn.id}
                          className={`p-3 rounded-xl text-xs transition-all ${
                            isActive
                              ? 'bg-[rgba(14,124,134,0.12)] border border-[#0E7C86] text-[#161511] font-medium'
                              : 'bg-white border border-[rgba(22,21,17,0.1)] text-[#5D594E]'
                          }`}
                        >
                          <div className="flex items-center justify-between text-[10px] mb-1">
                            <span className={isHost1 ? 'text-[#0A5A62] font-bold' : 'text-[#C4552D] font-bold'}>
                              {turn.speakerName}
                            </span>
                            <span className="font-mono text-[#5D594E]">
                              {(Number(turn.startTime ?? turn.startSec) || 0).toFixed(1)}s – {(Number(turn.endTime ?? turn.endSec) || 0).toFixed(1)}s
                            </span>
                          </div>
                          <p className="leading-snug">{turn.text}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 3 Export Buttons: MP4 Video Dubbing, WAV Master Track, SRT Subtitles */}
                <div className="space-y-2.5 pt-2 border-t border-[rgba(22,21,17,0.1)]">
                  {/* 1. Download MP4 Video with Uzbek Dubbing */}
                  <button
                    type="button"
                    onClick={handleMuxDubbedVideoMp4}
                    disabled={isMuxingVideo || !uploadedVideoFileId}
                    className={`btn-pill w-full py-3 flex items-center justify-center gap-2 text-xs font-bold transition-all cursor-pointer ${
                      uploadedVideoFileId
                        ? 'bg-[#0E7C86] hover:bg-[#0A5A62] text-white shadow-sm'
                        : 'bg-[#ECE7DB] text-[#7D7A70] cursor-not-allowed'
                    }`}
                    title={
                      uploadedVideoFileId
                        ? 'Склеить видео MP4 с узбекским дубляжом через FFmpeg'
                        : 'Загрузите видеофайл в Шаге 01, чтобы скачать готовый MP4'
                    }
                  >
                    <Film className={`w-4 h-4 ${isMuxingVideo ? 'animate-spin' : ''}`} />
                    <span>
                      {isMuxingVideo
                        ? 'Сборка видео MP4 (FFmpeg)...'
                        : uploadedVideoFileId
                        ? '🎬 Скачать Видео MP4 с Узбекским Дубляжом'
                        : '🎬 Скачать Видео MP4 (Сначала загрузите видео в 01)'}
                    </span>
                  </button>

                  {/* 2. Download WAV Audio Track */}
                  <button
                    type="button"
                    onClick={downloadMasterAudio}
                    className="btn-pill btn-solid w-full py-2.5 flex items-center justify-center gap-2 text-xs font-bold cursor-pointer"
                  >
                    <Download className="w-4 h-4 text-[#5CC8CF]" />
                    <span>🎵 Скачать Аудиодорожку WAV (По таймкодам)</span>
                  </button>

                  {/* 3. Download .SRT Subtitles (Point 8: disabled when turns.length === 0) */}
                  <button
                    type="button"
                    onClick={handleDownloadSrt}
                    disabled={turns.length === 0}
                    className="btn-pill btn-ghost w-full py-2.5 flex items-center justify-center gap-2 text-xs font-semibold border border-[rgba(22,21,17,0.16)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Subtitles className="w-4 h-4 text-[#0E7C86]" />
                    <span>📝 Скачать Субтитры .SRT</span>
                  </button>

                  {/* 4. Re-stitch master track locally from IndexedDB cache (0 TTS calls) */}
                  <button
                    type="button"
                    onClick={handleRestitchFromCache}
                    disabled={isRestitchingFromCache || (cachedTurnsInDbCount === 0 && synthesizedTurns.length === 0)}
                    className="btn-pill btn-ghost w-full py-2 flex items-center justify-center gap-2 text-xs font-semibold border border-[rgba(14,124,134,0.28)] text-[#0A5A62] hover:bg-[rgba(14,124,134,0.06)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Пересобрать мастер-WAV локально из кэша IndexedDB без запросов к TTS"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 text-[#0E7C86] ${isRestitchingFromCache ? 'animate-spin' : ''}`} />
                    <span>
                      {isRestitchingFromCache
                        ? 'Сборка из кэша...'
                        : `Собрать заново (0 TTS · кэш ${cachedTurnsInDbCount || synthesizedTurns.length}/${turns.length})`}
                    </span>
                  </button>

                  {onSaveToCMS && (
                    <button
                      onClick={handleSaveToCMS}
                      className="btn-pill btn-ghost w-full py-2 flex items-center justify-center gap-2 text-xs font-medium"
                    >
                      {isSaved ? <Check className="w-4 h-4 text-[#0E7C86]" /> : <Save className="w-4 h-4 text-[#0E7C86]" />}
                      <span>{isSaved ? 'Сохранено в библиотеку!' : 'Сохранить в библиотеку'}</span>
                    </button>
                  )}
                </div>
              </div>
            ) : isSynthesizing ? (
              <div className="space-y-4">
                {batchProgress && (
                  <div className="p-4 rounded-2xl bg-white border border-[rgba(14,124,134,0.3)] shadow-xs space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-[#0A5A62] flex items-center gap-1.5">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#0E7C86]" />
                        {`Пакет ${batchProgress.currentBatch} / ${batchProgress.totalBatches}`}
                      </span>
                      <span className="font-mono text-[11px] font-bold text-[#0E7C86]">
                        {batchProgress.completedTurns} / {batchProgress.totalTurns} реплик ({batchProgress.percent}%)
                      </span>
                    </div>

                    <div className="w-full bg-[#F4F1EA] h-2.5 rounded-full overflow-hidden border border-[rgba(22,21,17,0.1)]">
                      <div
                        className="bg-gradient-to-r from-[#0E7C86] to-[#5CC8CF] h-full transition-all duration-300 rounded-full"
                        style={{ width: `${Math.max(5, batchProgress.percent)}%` }}
                      />
                    </div>

                    <p className="text-[11px] text-[#5D594E] leading-snug">
                      {batchProgress.statusText}
                    </p>
                  </div>
                )}

                <GenerationCountdownHUD
                  countdown={dialogueCountdown}
                  isActive={isSynthesizing}
                  lang={lang}
                  title={`Синтез Дубляжа 1:1 (${turns.length} реплик)`}
                  subtitle={batchProgress?.statusText || dialogueCountdown.phaseNameRu}
                />
              </div>
            ) : (
              <div className="p-6 rounded-2xl bg-white border border-dashed border-[rgba(22,21,17,0.2)] text-center space-y-3">
                <Film className="w-8 h-8 text-[#0E7C86] mx-auto" />
                <p className="text-xs text-[#161511] font-semibold">
                  Готово к озвучке 1:1 по таймкодам
                </p>
                <p className="text-[11px] text-[#5D594E] leading-relaxed">
                  1) В Шаге 01 загрузите видео (до 15 мин) и проверьте раскадровку.<br />
                  2) В Шаге 02 выберите голоса (например, женский для Девушки и ваш клон голоса Shohrux для Мужчины).<br />
                  3) Нажмите <strong>«🎯 Озвучить Дубляж 1:1 по Таймкодам»</strong> или скачайте .SRT субтитры уже сейчас.
                </p>
                {cachedTurnsInDbCount > 0 && (
                  <div className="pt-1 space-y-2">
                    <p className="text-[11px] font-medium text-[#0A5A62] bg-[rgba(14,124,134,0.08)] border border-[rgba(14,124,134,0.24)] rounded-xl px-3 py-2">
                      В кэше браузера (IndexedDB) найдено готовых реплик: <strong>{cachedTurnsInDbCount} / {turns.length}</strong>. Можно собрать мастер-трек без запросов к TTS.
                    </p>
                    <button
                      type="button"
                      onClick={handleRestitchFromCache}
                      disabled={isRestitchingFromCache}
                      className="btn-pill w-full py-2.5 px-4 inline-flex items-center justify-center gap-2 text-xs font-bold bg-[#0E7C86] hover:bg-[#0A5A62] text-white cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isRestitchingFromCache ? 'animate-spin' : ''}`} />
                      <span>
                        {isRestitchingFromCache
                          ? 'Сборка из кэша...'
                          : `Собрать заново (${cachedTurnsInDbCount}/${turns.length} · 0 TTS)`}
                      </span>
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleDownloadSrt}
                  disabled={turns.length === 0}
                  className="btn-pill btn-ghost text-xs py-2 px-4 inline-flex items-center gap-1.5 border border-[rgba(22,21,17,0.14)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Subtitles className="w-3.5 h-3.5 text-[#0E7C86]" />
                  <span>Скачать .SRT субтитры перевода</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* In-app Ready Script Import Modal (0 LLM, 0 credits) */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-3xl rounded-2xl bg-[#FAF8F3] border border-[rgba(22,21,17,0.18)] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-5 py-4 bg-white border-b border-[rgba(22,21,17,0.12)]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#0E7C86]/10 text-[#0E7C86] flex items-center justify-center">
                  <FileUp className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#161511]">
                    Импорт готового сценария (без ИИ и списания кредитов)
                  </h3>
                  <p className="text-[11px] text-[#5D594E]">
                    Поддерживаются: таблица «ММ:СС–ММ:СС | Спикер | ритм | подача | узб. текст | рус. оригинал», JSON, CSV, SRT
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="p-1.5 rounded-lg text-[#5D594E] hover:text-[#161511] hover:bg-[#F4F1EA] cursor-pointer"
                aria-label="Закрыть"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3.5 overflow-y-auto flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <input
                    ref={importFileInputRef}
                    type="file"
                    accept=".txt,.csv,.json,.srt,text/plain,text/csv,application/json"
                    onChange={handleImportFileSelected}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => importFileInputRef.current?.click()}
                    className="text-xs px-3.5 py-2 rounded-xl bg-white hover:bg-[#F4F1EA] text-[#161511] border border-[rgba(22,21,17,0.2)] font-semibold cursor-pointer inline-flex items-center gap-1.5"
                  >
                    <Upload className="w-3.5 h-3.5 text-[#0E7C86]" />
                    <span>Выбрать файл (.txt / .csv / .json / .srt)</span>
                  </button>
                  {importFileName && (
                    <span className="text-[11px] font-mono text-[#0A5A62] bg-[#0E7C86]/10 px-2.5 py-1 rounded-lg">
                      {importFileName}
                    </span>
                  )}
                </div>
                {importRawText.trim().length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setImportRawText('');
                      setImportFileName(null);
                      setImportErrors([]);
                    }}
                    className="text-[11px] text-[#5D594E] hover:text-[#C4552D] cursor-pointer"
                  >
                    Очистить поле
                  </button>
                )}
              </div>

              <textarea
                rows={12}
                value={importRawText}
                onChange={(e) => {
                  setImportRawText(e.target.value);
                  if (importErrors.length > 0) setImportErrors([]);
                }}
                placeholder={`Спикеры: Азиз (М), Вероника (Ж)\n=== Вступление ===\n[00:00–00:03 музыка]\n00:03–00:08 (5s) | Азиз | средний | бодро, уверенно | Assalomu alaykum, do'stlar! | Всем привет, друзья!\n00:08–00:13 (5s) | Вероника | живой | с улыбкой | Bugun yangi krossoverni sinaymiz. | Сегодня тестируем новый кроссовер.`}
                className="w-full bg-white border border-[rgba(22,21,17,0.18)] rounded-xl p-3.5 text-xs text-[#161511] font-mono leading-relaxed focus:outline-none focus:border-[#0E7C86] resize-y"
              />

              {importErrors.length > 0 && (
                <div className="p-3.5 rounded-xl bg-[#FEF2F2] border border-[#FCA5A5] space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-bold text-[#991B1B]">
                    <AlertCircle className="w-4 h-4 text-[#DC2626] shrink-0" />
                    <span>Импорт отклонён — найдены ошибки ({importErrors.length}):</span>
                  </div>
                  <ul className="space-y-1 max-h-44 overflow-y-auto pl-6 list-disc text-[11.5px] font-mono text-[#7F1D1D]">
                    {importErrors.map((err, idx) => (
                      <li key={`${err.line}-${idx}`}>{err.message}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 px-5 py-3.5 bg-white border-t border-[rgba(22,21,17,0.12)]">
              <span className="text-[11px] text-[#5D594E]">
                Узбекский текст загружается дословно, без перевода и перефразирования.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  className="btn-pill btn-ghost text-xs px-4 py-2 cursor-pointer"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={handleApplyReadyScriptImport}
                  disabled={!importRawText.trim()}
                  className="btn-pill btn-solid text-xs px-5 py-2 bg-[#0E7C86] hover:bg-[#0A5A62] text-white border-none cursor-pointer disabled:opacity-50"
                >
                  Проверить и загрузить в таблицу
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Custom In-App Confirmation Modal before replacing imported/populated table via video analysis */}
      {showReplaceTableModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white border border-[rgba(22,21,17,0.18)] shadow-2xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-[#161511]">
                  Таблица будет заменена
                </h3>
                <p className="text-xs text-[#5D594E] leading-relaxed">
                  Включение авто-разбора видео через Gemini перезапишет текущую таблицу реплик ({turns.length} реплик) после загрузки видео. Если нужно только наложить озвучку на видео, оставьте флажок снятым.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowReplaceTableModal(false)}
                className="btn-pill btn-ghost text-xs px-4 py-2 cursor-pointer"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleConfirmReplaceTableForVideo}
                className="btn-pill btn-solid text-xs px-4 py-2 bg-[#C4552D] hover:bg-[#A6421E] text-white border-none cursor-pointer"
              >
                Да, заменить таблицу
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom In-App Confirmation Modal for Voice Gender Mismatch or Cloned Voice Before Synthesis */}
      {showVoiceWarningModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white border border-[rgba(22,21,17,0.18)] shadow-2xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div className="space-y-2">
                <h3 className="text-sm font-bold text-[#161511]">
                  Проверьте выбранные голоса перед озвучкой
                </h3>
                <ul className="list-disc pl-4 space-y-1 text-xs text-[#5D594E] leading-relaxed">
                  {synthesisVoiceWarnings.map((warn, idx) => (
                    <li key={idx} className="text-[#161511]">
                      {warn}
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-[#5D594E]">
                  Рекомендуем выбрать встроенные голоса, соответствующие полу каждого спикера в Шаге 02.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowVoiceWarningModal(false)}
                className="btn-pill btn-ghost text-xs px-4 py-2 cursor-pointer"
              >
                Отмена (изменить голоса)
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowVoiceWarningModal(false);
                  handleSynthesizeDialogue(pendingSynthResumeFlag, true);
                }}
                className="btn-pill btn-solid text-xs px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white border-none cursor-pointer"
              >
                Продолжить озвучку
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
