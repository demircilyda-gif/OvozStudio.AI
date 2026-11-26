import crypto from "crypto";
import fs from "fs";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import { DUBBING_MODELS_CONFIG } from "../../config/dubbingModels.ts";
import {
  splitTurnsIntoMacroBlocks as sharedSplitTurnsIntoMacroBlocks,
  planDialogueSubBlocks,
  type MacroBlockSplitOptions,
  type SubBlockSplitOptions,
} from "../../../src/utils/dialogueMacroBlocks.ts";
import {
  extractRawPcm24k,
  buildWav24k,
  alignBatchAudioViaTranscribe,
  applyTailFadeOut,
  applyMicroEdgeFades,
  trimSilenceEdgesPcm,
  isFakeDubbingTtsEnabled,
  generateSyntheticTurnPcm,
  generateSyntheticBlockPcm,
  PCM_BYTES_PER_SEC,
  type SlicedTurnClip,
  type FakeTurnAlignmentOverride,
} from "./batchAudioSlicer.ts";
import { normalizeUzbekSpeech } from "../../../src/utils/uzbekNormalizer.ts";
import {
  applyMildAtempoPcm,
  countSyllables,
  type TurnSyncStatus,
} from "../verbatimStoryboardService.ts";
import {
  synthesizeDialogueBlockViaKieAi,
  type KieDialogueTurnInput,
} from "../tts/kieTtsAdapter.ts";
import {
  recordGoogleTtsCalls,
  markGoogleTtsQuotaExhaustedToday,
  getTtsQuotaStatus,
} from "../tts/ttsQuotaTracker.ts";

const BLOCK_CACHE_DIR = path.resolve(process.cwd(), "data", "dubbing-block-cache");
export const DUBBING_CACHE_VERSION = "v3";
export const DUBBING_PROMPT_VERSION = "v3";

function ensureBlockCacheDir() {
  if (!fs.existsSync(BLOCK_CACHE_DIR)) {
    fs.mkdirSync(BLOCK_CACHE_DIR, { recursive: true });
  }
}

export type TurnQaStatus = "ok" | "retried" | "failed";

export interface ResolvedBatchSpeaker {
  speakerId: string;
  speakerName: string;
  baseVoice: string;
  voiceId?: string;
  gender?: "male" | "female";
  isCloned: boolean;
  replicatedVoiceConfig?: any;
  baseSpeechStyle: string;
}

export interface BatchInputTurn {
  id: string;
  index: number;
  speakerId: string;
  speakerName: string;
  text: string;
  cleanSpeechText: string;
  style: string;
  startSec?: number;
  endSec?: number;
  gapAfterSec?: number;
  emotion?: string;
  intonationRu?: string;
  originalTextRu?: string;
  speakerGender?: "female" | "male";
  sceneTitle?: string;
  inlineTags?: string[];
  forceFastPace?: boolean;
  plannedSubBlockIndex?: number;
  rawTurn: any;
}

export interface BatchSynthesizedTurnResult {
  index: number;
  id: string;
  speakerId: string;
  speakerName: string;
  text: string;
  pcm: Buffer;
  wavBase64: string;
  durationSec: number;
  originalDurationSec: number;
  dubbedDurationSec: number;
  atempoApplied: number;
  rephraseAttempts: number;
  fitStepApplied: string;
  syncStatus: TurnSyncStatus;
  slicingMethod: string;
  qa: TurnQaStatus;
  qaReason?: string;
  needsShorten: boolean;
  subBlockIndex: number;
}

export interface SubBlockQaEvaluation {
  passed: boolean;
  reasons: string[];
  blockDurationRatio: number;
  transcriptWordRatio?: number;
  transcriptText?: string;
  englishLeakTokens?: string[];
  badClipIndices: number[];
  badMethods: string[];
}

export interface FailedSubBlockSummary {
  subBlockIndex: number;
  startTimecode: string;
  endTimecode: string;
  turnIds: string[];
  reasons: string[];
}

export interface BatchDialogueExecutionResult {
  turns: BatchSynthesizedTurnResult[];
  ttsCallsUsed: number;
  transcribeCallsUsed: number;
  extraTtsCallsUsed: number;
  extraTtsBudget: number;
  provider: "google" | "kie.ai" | "cache" | "fake" | "mixed";
  modeUsed: "mode_a_multispeaker" | "mode_b_per_speaker" | "cache" | "fake";
  blocksTotal: number;
  blocksCompleted: number;
  subBlocksTotal: number;
  subBlocksCompleted: number;
  retriesUsed: number;
  failedSubBlocks: FailedSubBlockSummary[];
  quotaPaused: boolean;
  quotaPauseMessageRu?: string;
  stats: {
    ok: number;
    adjusted: number;
    overflow: number;
    qaOk: number;
    qaRetried: number;
    qaFailed: number;
    needsShorten: number;
  };
  quotaRemaining: number;
  quotaLimit: number;
}

// =========================================================================
// TEST HOOKS (used only in automated tests with DUBBING_FAKE_TTS=1)
// =========================================================================
let simulateDubbingGoogle429 = false;
export function setSimulateDubbingGoogle429ForTesting(val: boolean) {
  simulateDubbingGoogle429 = val;
}

export interface FakeAttemptFault {
  overrideTranscript?: string;
  fakeTurnOverrides?: Array<FakeTurnAlignmentOverride | null | undefined>;
  durationMultiplier?: number;
  perTurnDurationMultipliers?: number[];
  forceMethod?: string;
  omitLastTurnInAudio?: boolean;
  noInterTurnSilence?: boolean;
}

type FakeFaultInjector = (ctx: {
  attempt: number;
  stage: "primary" | "retry" | "split_half" | "mode_b";
  turns: BatchInputTurn[];
  mode: "A" | "B";
}) => FakeAttemptFault | null;

let fakeFaultInjector: FakeFaultInjector | null = null;
export function setFakeDubbingFaultInjectorForTesting(fn: FakeFaultInjector | null) {
  fakeFaultInjector = fn;
}

let ttsPayloadObserver:
  | ((payload: {
      channel: "google_mode_a" | "kie_mode_a" | "google_mode_b" | "kie_mode_b" | "single_recovery";
      parts: Array<{ text: string; style: string; speaker?: string }>;
    }) => void)
  | null = null;
export function setTtsPayloadObserverForTesting(
  fn:
    | ((payload: {
        channel: "google_mode_a" | "kie_mode_a" | "google_mode_b" | "kie_mode_b" | "single_recovery";
        parts: Array<{ text: string; style: string; speaker?: string }>;
      }) => void)
    | null
) {
  ttsPayloadObserver = fn;
}

function isQuota429Error(err: any): boolean {
  const status = err?.status || err?.statusCode || err?.code;
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    status === 429 ||
    status === 402 ||
    msg.includes("429") ||
    msg.includes("resource_exhausted") ||
    msg.includes("quota exceeded") ||
    msg.includes("rate limit")
  );
}

// =========================================================================
// STAGE 1: PROMPT SANITIZATION & DENSITY-BASED PACE DIRECTIVES
// =========================================================================

export function stripLegacyPauseArtifacts(text: string): string {
  return String(text || "")
    .replace(/<\s*short\s+pause\s*>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripLegacyStylePauseDirective(style: string): string {
  return String(style || "")
    .replace(/\.?\s*End\s+(?:the\s+sentence\s+)?cleanly\s+with\s+a\s+distinct\s+pause\.?/gi, "")
    .replace(/\.?\s*Say\s+the\s+line\s+exactly\s+once[^.]*\.?/gi, "")
    .replace(/Natural\s+(?:male|female)\s+Uzbek\s+speaker[^.]*\.?/gi, "")
    .replace(/100%\s*authentic[^.]*\.?/gi, "")
    .replace(/\b(?:baritone|feminine|masculine|male|female)\b/gi, "")
    .replace(/\s+/g, " ")
    .replace(/^[.,;\s]+|[.,;\s]+$/g, "")
    .trim();
}

export function computeTurnSyllableDensity(
  cleanSpeechText: string,
  startSec?: number,
  endSec?: number
): number {
  const clean = stripLegacyPauseArtifacts(cleanSpeechText);
  const syllables = Math.max(1, countSyllables(clean));
  if (
    typeof startSec === "number" &&
    Number.isFinite(startSec) &&
    typeof endSec === "number" &&
    Number.isFinite(endSec) &&
    endSec > startSec
  ) {
    const windowSec = Math.max(0.5, endSec - startSec);
    return Math.round((syllables / windowSec) * 100) / 100;
  }
  return 4.8;
}

/**
 * Стиль темпа по документации Gemini 3.8 TTS (слоги / (endSec - startSec)):
 * - >= 5.5 (или forceFastPace) -> "speaking rapidly"
 * - 4.5–5.5 -> "natural conversational pace"
 * - < 4.5 -> "relaxed pace"
 */
export function buildTurnPaceDirective(
  turn: { cleanSpeechText: string; startSec?: number; endSec?: number; forceFastPace?: boolean },
  forceFastPace?: boolean
): string {
  const density = computeTurnSyllableDensity(turn.cleanSpeechText, turn.startSec, turn.endSec);
  if (forceFastPace || turn.forceFastPace || density >= 5.5) {
    return "speaking rapidly";
  }
  if (density >= 4.5) {
    return "natural conversational pace";
  }
  return "relaxed pace";
}

/**
 * Короткая подача (строго 2–4 слова на английском) без имени, пола, baritone и длинных инструкций.
 */
export function buildShortEnglishDelivery(turn: {
  intonationRu?: string;
  emotion?: string;
  style?: string;
}): string {
  const hint = `${turn.intonationRu || ""} ${turn.emotion || ""} ${turn.style || ""}`.toLowerCase();

  if (/восторг|восхищ|удивл|вау|пораж|amazed|excited|surprised|wow/i.test(hint)) {
    return "excited, amazed";
  }
  if (/радост|весел|бодр|энергич|улыб|сме[её]|шутл|живо|cheerful|lively|energetic|bright|smiling/i.test(hint)) {
    return "cheerful, lively";
  }
  if (/любопыт|интерес|вопрос|спраш|заинтерес|curious|engaging|inquisitive/i.test(hint)) {
    return "curious, engaging";
  }
  if (/ирон|скепт|сомн|подкол|подшуч|playful|skeptical|teasing/i.test(hint)) {
    return "playful, skeptical";
  }
  if (/тревож|обеспок|взволн|эмоц|драмат|concerned|emotional|urgent/i.test(hint)) {
    return "expressive, concerned";
  }
  if (/уверен|эксперт|делов|ч[её]тк|информат|по делу|confident|clear|assertive|authoritative/i.test(hint)) {
    return "confident, clear";
  }
  if (/серь[её]з|сдержан|задумч|вдумч|calm|thoughtful|serious|measured/i.test(hint)) {
    return "calm, thoughtful";
  }
  if (/спокойн|мягк|тепл|дружел|приветл|warm|friendly|gentle/i.test(hint)) {
    return "warm, friendly";
  }
  return "warm, natural";
}

/**
 * Gemini 3.8 TTS style: короткая подача (2–4 слова на английском) + темп.
 * Без имени, пола, baritone, "100% authentic" и "Say the line exactly once".
 * Голос задаётся исключительно в voiceConfig.
 */
export function buildCleanTurnStyleForTts(
  turn: Pick<BatchInputTurn, "cleanSpeechText" | "startSec" | "endSec" | "forceFastPace" | "intonationRu" | "emotion" | "style">,
  _extraContext?: string,
  forceFastPace?: boolean
): string {
  const delivery = buildShortEnglishDelivery(turn);
  const pace = buildTurnPaceDirective(turn, forceFastPace);
  return `${delivery}, ${pace}`;
}

/**
 * Группирует реплики в макро-блоки (общая логика из src/utils/dialogueMacroBlocks.ts).
 */
export function splitTurnsIntoMacroBlocks(
  turns: BatchInputTurn[],
  options: MacroBlockSplitOptions = {}
): BatchInputTurn[][] {
  return sharedSplitTurnsIntoMacroBlocks(turns, {
    targetSize: options.targetSize ?? 22,
    minSize: options.minSize ?? 12,
    maxSize: options.maxSize ?? 25,
    minPauseSec: options.minPauseSec ?? 0.5,
    maxInputTokens: options.maxInputTokens ?? 5800,
  });
}

/**
 * Этап 1: Нарезка на подблоки внутри блоков сцен (<= 8 реплик И <= 40 с суммарной длины окон).
 */
export function splitTurnsIntoDubbingSubBlocks(
  turns: BatchInputTurn[],
  options: SubBlockSplitOptions = {}
): BatchInputTurn[][] {
  return planDialogueSubBlocks(turns, {
    maxTurns: options.maxTurns ?? 8,
    maxWindowSec: options.maxWindowSec ?? 40,
    macroBlockOptions: options.macroBlockOptions ?? {
      targetSize: 22,
      minSize: 12,
      maxSize: 25,
      minPauseSec: 0.5,
      maxInputTokens: 5800,
    },
  }).map((sb) => sb.turns);
}

/**
 * Прогноз числа вызовов TTS и транскрипции с учётом подблоков и запаса +20% на повторы (Этап 5).
 */
export function estimateDubbingTtsCalls(
  turnCount: number,
  usesClonedVoice: boolean,
  uniqueSpeakersCount: number,
  turns?: Array<{
    startSec?: number;
    endSec?: number;
    sceneTitle?: string;
    speakerId?: string;
    speakerName?: string;
    text?: string;
  }>
): {
  estimatedCalls: number;
  baseTtsCalls: number;
  transcribeCalls: number;
  retryBufferCalls: number;
  blocksCount: number;
  subBlocksCount: number;
  modeLabel: string;
} {
  if (turnCount <= 0) {
    return {
      estimatedCalls: 0,
      baseTtsCalls: 0,
      transcribeCalls: 0,
      retryBufferCalls: 0,
      blocksCount: 0,
      subBlocksCount: 0,
      modeLabel: "mode_a",
    };
  }
  const subBlocksCount =
    Array.isArray(turns) && turns.length > 0
      ? planDialogueSubBlocks(turns).length
      : Math.max(1, Math.ceil(turnCount / 7));
  const isModeA = !usesClonedVoice && uniqueSpeakersCount <= 2;
  const baseTtsCalls = isModeA
    ? subBlocksCount
    : subBlocksCount * Math.max(1, uniqueSpeakersCount);
  const transcribeCalls = subBlocksCount;
  const retryBufferCalls = Math.max(1, Math.ceil(baseTtsCalls * 0.2));
  const estimatedCalls = baseTtsCalls + retryBufferCalls;

  return {
    estimatedCalls,
    baseTtsCalls,
    transcribeCalls,
    retryBufferCalls,
    blocksCount: subBlocksCount,
    subBlocksCount,
    modeLabel: isModeA ? "Mode A (Multi-Speaker)" : "Mode B (Per-Speaker)",
  };
}

// =========================================================================
// CACHE v3 (SUB-BLOCK ONLY: VERSION v3 + BOTH SPEAKERS' VOICES + TEXTS + STYLES)
// =========================================================================

const DISALLOWED_CACHE_METHODS = new Set([
  "vad_dp_soft",
  "proportional_energy_cut",
  "failed",
  "missing_turn",
]);

function inferSpeakerGender(
  sp?: ResolvedBatchSpeaker,
  turn?: BatchInputTurn
): "male" | "female" | undefined {
  if (sp?.gender === "male" || sp?.gender === "female") return sp.gender;
  if (turn?.speakerGender === "male" || turn?.speakerGender === "female") return turn.speakerGender;
  const bv = String(sp?.baseVoice || "").toLowerCase();
  if (bv === "kore" || bv === "aoede" || bv === "zephyr" || bv === "leda") return "female";
  if (bv === "charon" || bv === "fenrir" || bv === "puck" || bv === "achird" || bv === "sadachbia") return "male";
  return undefined;
}

export function computeSubBlockCacheHash(
  subBlockTurns: BatchInputTurn[],
  speakerMap: Map<string, ResolvedBatchSpeaker>,
  mode: "A" | "B"
): string {
  const participatingSpeakerIds = Array.from(
    new Set(subBlockTurns.map((t) => String(t.speakerId || "HOST_1")))
  ).sort();

  const speakersPayload = participatingSpeakerIds.map((spId) => {
    const sp = speakerMap.get(spId);
    return {
      speakerId: spId,
      voice: sp?.isCloned ? sp.voiceId || "cloned" : sp?.baseVoice || "Charon",
      gender: inferSpeakerGender(sp) || "unknown",
    };
  });

  const payload = {
    v: 3,
    cacheVersion: DUBBING_CACHE_VERSION,
    promptVersion: DUBBING_PROMPT_VERSION,
    mode,
    speakers: speakersPayload,
    turns: subBlockTurns.map((t) => {
      const sp = speakerMap.get(t.speakerId);
      return {
        id: t.id,
        speakerId: t.speakerId,
        text: stripLegacyPauseArtifacts(t.cleanSpeechText),
        voice: sp?.isCloned ? sp.voiceId || "cloned" : sp?.baseVoice || "Charon",
        style: buildCleanTurnStyleForTts(t),
      };
    }),
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 24);
}

interface CachedBlockEntryV3 {
  v: 3;
  cacheVersion: string;
  promptVersion: string;
  qa: TurnQaStatus;
  methods: string[];
  savedAt: string;
  clips: string[];
}

function loadCachedBlockPcmsV3(
  hash: string,
  expectedCount: number
): { pcms: Buffer[]; methods: string[]; qa: TurnQaStatus } | null {
  try {
    const metaPath = path.join(BLOCK_CACHE_DIR, `${hash}.json`);
    if (!fs.existsSync(metaPath)) return null;
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as Partial<CachedBlockEntryV3>;
    // Строго только кэш v3 с пройденной QA и чистой нарезкой
    if (
      meta?.v !== 3 ||
      meta?.cacheVersion !== DUBBING_CACHE_VERSION ||
      meta?.promptVersion !== DUBBING_PROMPT_VERSION
    ) {
      return null;
    }
    if (meta.qa !== "ok" && meta.qa !== "retried") return null;
    if (!Array.isArray(meta.clips) || meta.clips.length !== expectedCount) return null;
    const methods =
      Array.isArray(meta.methods) && meta.methods.length === expectedCount
        ? meta.methods
        : new Array(expectedCount).fill("cache");
    if (methods.some((m) => DISALLOWED_CACHE_METHODS.has(m))) return null;
    return {
      pcms: meta.clips.map((b64) => Buffer.from(b64, "base64")),
      methods: methods.map((m) => (m === "cache" ? "cache" : `cache:${m}`)),
      qa: meta.qa,
    };
  } catch {
    return null;
  }
}

export function canSaveSubBlockToCache(qa: TurnQaStatus, methods: string[]): boolean {
  if (qa !== "ok" && qa !== "retried") return false;
  if (!methods || methods.length === 0) return false;
  return !methods.some((m) => DISALLOWED_CACHE_METHODS.has(m));
}

function saveCachedBlockPcmsV3(
  hash: string,
  pcms: Buffer[],
  methods: string[],
  qa: TurnQaStatus
): boolean {
  if (!canSaveSubBlockToCache(qa, methods)) return false;
  try {
    ensureBlockCacheDir();
    const metaPath = path.join(BLOCK_CACHE_DIR, `${hash}.json`);
    const entry: CachedBlockEntryV3 = {
      v: 3,
      cacheVersion: DUBBING_CACHE_VERSION,
      promptVersion: DUBBING_PROMPT_VERSION,
      qa,
      methods,
      savedAt: new Date().toISOString(),
      clips: pcms.map((p) => p.toString("base64")),
    };
    fs.writeFileSync(metaPath, JSON.stringify(entry), "utf8");
    return true;
  } catch {
    return false;
  }
}

// =========================================================================
// STAGE 2: SUB-BLOCK QUALITY ASSURANCE (FREE CHECKS + TRANSCRIBE CHECK)
// =========================================================================

const OBVIOUS_ENGLISH_LEAK_WORDS = new Set([
  "short",
  "pause",
  "pauses",
  "sentence",
  "cleanly",
  "distinct",
  "brisk",
  "dubbing",
  "pace",
  "natural",
  "conversational",
  "relaxed",
  "exactly",
  "once",
  "word",
  "words",
  "line",
  "lines",
  "speak",
  "speaker",
  "style",
  "delivery",
  "voice",
  "fast",
  "slow",
  "inside",
  "after",
  "responding",
  "naturally",
  "opening",
  "dialogue",
  "please",
  "thank",
  "thanks",
  "hello",
  "sorry",
  "because",
  "really",
  "actually",
  "whisper",
  "whispering",
  "silence",
  "break",
  "the",
  "and",
  "with",
  "without",
  "from",
  "that",
  "this",
  "they",
  "their",
  "would",
  "should",
  "could",
]);

export function unifyApostrophes(text: string): string {
  return String(text || "").replace(/[ʻʼ‘’`´′ʹ']/g, "'");
}

/**
 * Нормализация текста перед QA-сравнением:
 * 1. Все варианты апострофов (ʻ ʼ ‘ ’ ` ') -> один (')
 * 2. Цифры -> узбекские слова (normalizeUzbekSpeech)
 * 3. Повторная унификация апострофов и разбиение на токены
 */
export function tokenizeForQa(text: string): string[] {
  const withoutTags = unifyApostrophes(String(text || "").replace(/<[^>]+>/g, " "));
  let normalized = withoutTags;
  try {
    normalized = normalizeUzbekSpeech(withoutTags, {
      decimalStyle: DUBBING_MODELS_CONFIG.decimalPronunciationStyle || "butun",
    });
  } catch {}

  const cleaned = unifyApostrophes(normalized)
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/[^a-z0-9а-яёўқғҳ'-]+/gi, " ")
    .trim();
  if (!cleaned) return [];
  return cleaned
    .split(/\s+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, ""))
    .filter(Boolean);
}

/**
 * Полная проверка подблока (нарезка + порепликовая верификация из одного запроса транскрипции):
 * 1. Граница реплики должна быть привязана к паузе-кандидату (>= 120 мс) в пределах ±0.6 с; нет — брак.
 * 2. Проверка длительности:
 *    - реплики до 4 слогов (<= 4): клип строго в [0.3, 1.6] с вместо отношения длительностей;
 *    - остальные реплики: клип / (syllables/4.8) в [0.6, 1.6];
 *    - блок целиком: [0.7, 1.35].
 * 3. Проверка каждой реплики по SPOKEN_TEXT и VOICE:
 *    - совпадение слов SPOKEN_TEXT с ожидаемым текстом >= 75% (после унификации апострофов и normalizeUzbekSpeech);
 *    - последнее слово реплики присутствует в её клипе;
 *    - VOICE (male/female) совпадает с полом спикера (если пол у пары разный).
 * 4. Отсутствие перекрытий, ненадёжных методов, "short pause" и английских утечек.
 */
export function evaluateSubBlockQa(params: {
  expectedTurns: BatchInputTurn[];
  slicedClips: Array<{
    pcm: Buffer;
    startMs: number;
    endMs: number;
    durationSec: number;
    method: string;
    spokenText?: string;
    detectedVoice?: "male" | "female" | "unknown";
    boundarySnapped?: boolean;
    boundaryIssue?: string;
  }>;
  transcriptText?: string;
  speakerMap?: Map<string, ResolvedBatchSpeaker>;
}): SubBlockQaEvaluation {
  const { expectedTurns, slicedClips, transcriptText, speakerMap } = params;
  const reasons: string[] = [];
  const badClipIndices: number[] = [];
  const badMethods: string[] = [];

  if (slicedClips.length !== expectedTurns.length) {
    reasons.push(`clip_count_mismatch (${slicedClips.length}/${expectedTurns.length})`);
    return {
      passed: false,
      reasons,
      blockDurationRatio: 0,
      badClipIndices,
      badMethods,
    };
  }

  // Определяем, различается ли пол спикеров в диалоге/подблоке (для проверки VOICE)
  const knownGenders = new Set<"male" | "female">();
  if (speakerMap) {
    for (const sp of speakerMap.values()) {
      const g = inferSpeakerGender(sp);
      if (g) knownGenders.add(g);
    }
  }
  for (const t of expectedTurns) {
    const g = inferSpeakerGender(speakerMap?.get(t.speakerId), t);
    if (g) knownGenders.add(g);
  }
  const hasMixedGenders = knownGenders.has("male") && knownGenders.has("female");

  // 1. Проверка методов нарезки и привязки границ к паузе >= 120 мс в пределах ±0.6 с
  for (let i = 0; i < slicedClips.length; i++) {
    const clip = slicedClips[i];
    const m = clip.method;
    if (DISALLOWED_CACHE_METHODS.has(m)) {
      if (!badMethods.includes(m)) badMethods.push(m);
      if (!badClipIndices.includes(i)) badClipIndices.push(i);
    }
    if (clip.boundarySnapped === false) {
      reasons.push(
        clip.boundaryIssue || `no_silence_boundary_near_cut (turn ${i})`
      );
      if (!badClipIndices.includes(i)) badClipIndices.push(i);
    }
  }
  if (badMethods.length > 0) {
    reasons.push(`unreliable_slicing (${badMethods.join(", ")})`);
  }

  // 2. Проверка строгого порядка и отсутствия перекрытий
  for (let i = 0; i < slicedClips.length; i++) {
    const clip = slicedClips[i];
    if (clip.endMs <= clip.startMs) {
      reasons.push(`invalid_clip_bounds (turn ${i}: ${clip.startMs}..${clip.endMs}ms)`);
      if (!badClipIndices.includes(i)) badClipIndices.push(i);
    }
    if (i > 0 && clip.startMs < slicedClips[i - 1].endMs - 2) {
      reasons.push(
        `clip_overlap_or_order (turn ${i - 1} ends ${slicedClips[i - 1].endMs}ms > turn ${i} starts ${clip.startMs}ms)`
      );
      if (!badClipIndices.includes(i)) badClipIndices.push(i);
    }
  }

  // 3. Проверка длительности подблока и каждой реплики
  // Для реплик <= 4 слогов: допустимый клип 0.3–1.6 с вместо отношения длительностей
  let expectedBlockSec = 0;
  let actualBlockSpeechSec = 0;
  let nonShortTurnCount = 0;

  for (let i = 0; i < expectedTurns.length; i++) {
    const cleanText = stripLegacyPauseArtifacts(expectedTurns[i].cleanSpeechText);
    const syl = Math.max(1, countSyllables(cleanText));
    const expectedTurnSec = Math.max(0.35, syl / 4.8);
    const actualTurnSec = Math.max(0, slicedClips[i].pcm.length / PCM_BYTES_PER_SEC);

    if (syl <= 4) {
      if (actualTurnSec < 0.3 || actualTurnSec > 1.6) {
        reasons.push(
          `short_turn_duration (turn ${i}: ${actualTurnSec.toFixed(2)}s outside 0.3–1.6s, syl=${syl})`
        );
        if (!badClipIndices.includes(i)) badClipIndices.push(i);
      }
      // В общий баланс блока для коротких реплик подставляем фактическую длину (если в пределах 0.3–1.6 с),
      // чтобы короткие возгласы ("Yo'q!", "Ha!") не ломали blockDurationRatio
      expectedBlockSec += actualTurnSec >= 0.3 && actualTurnSec <= 1.6 ? actualTurnSec : expectedTurnSec;
      actualBlockSpeechSec += actualTurnSec;
    } else {
      nonShortTurnCount += 1;
      expectedBlockSec += expectedTurnSec;
      actualBlockSpeechSec += actualTurnSec;

      const turnRatio = actualTurnSec / expectedTurnSec;
      if (turnRatio < 0.6 || turnRatio > 1.6) {
        reasons.push(
          `clip_duration_ratio (turn ${i}: ${actualTurnSec.toFixed(2)}s vs exp ${expectedTurnSec.toFixed(2)}s, ratio=${turnRatio.toFixed(2)})`
        );
        if (!badClipIndices.includes(i)) badClipIndices.push(i);
      }
    }
  }

  const blockDurationRatio =
    Math.round((actualBlockSpeechSec / Math.max(0.35, expectedBlockSec)) * 100) / 100;
  if (nonShortTurnCount > 0 && (blockDurationRatio < 0.7 || blockDurationRatio > 1.35)) {
    reasons.push(
      `block_duration_ratio (${actualBlockSpeechSec.toFixed(2)}s vs exp ${expectedBlockSec.toFixed(2)}s, ratio=${blockDurationRatio.toFixed(2)})`
    );
  }

  // 4. Порепликовая проверка SPOKEN_TEXT (>= 75% слов + последнее слово в клипе) и VOICE (пол)
  const perTurnSpokenParts: string[] = [];
  for (let i = 0; i < expectedTurns.length; i++) {
    const clip = slicedClips[i];
    const turn = expectedTurns[i];

    // 4a. Проверка пола голоса (если пол у пары разный)
    if (hasMixedGenders) {
      const expectedGender = inferSpeakerGender(speakerMap?.get(turn.speakerId), turn);
      if (
        expectedGender &&
        (clip.detectedVoice === "male" || clip.detectedVoice === "female") &&
        clip.detectedVoice !== expectedGender
      ) {
        reasons.push(
          `turn_voice_gender_mismatch (turn ${i}: expected ${expectedGender}, heard ${clip.detectedVoice})`
        );
        if (!badClipIndices.includes(i)) badClipIndices.push(i);
      }
    }

    // 4b. Порепликовое совпадение текста >= 75% и наличие последнего слова реплики в клипе
    if (typeof clip.spokenText === "string") {
      perTurnSpokenParts.push(clip.spokenText);
      const expTokens = tokenizeForQa(stripLegacyPauseArtifacts(turn.cleanSpeechText));
      const actTokens = tokenizeForQa(clip.spokenText);

      if (expTokens.length > 0) {
        if (actTokens.length === 0) {
          reasons.push(`turn_text_mismatch (turn ${i}: empty spoken text)`);
          if (!badClipIndices.includes(i)) badClipIndices.push(i);
        } else {
          const expFreq = new Map<string, number>();
          const actFreq = new Map<string, number>();
          for (const w of expTokens) expFreq.set(w, (expFreq.get(w) || 0) + 1);
          for (const w of actTokens) actFreq.set(w, (actFreq.get(w) || 0) + 1);

          let matched = 0;
          for (const [w, cnt] of expFreq.entries()) {
            matched += Math.min(cnt, actFreq.get(w) || 0);
          }

          const recall = matched / expTokens.length;
          const symmetricOverlap = matched / Math.max(expTokens.length, actTokens.length);
          const overlapScore = Math.min(recall, symmetricOverlap);

          if (overlapScore < 0.75) {
            reasons.push(
              `turn_text_mismatch (turn ${i}: overlap=${Math.round(overlapScore * 100)}% < 75%)`
            );
            if (!badClipIndices.includes(i)) badClipIndices.push(i);
          }

          // Последнее слово реплики должно присутствовать в её клипе (в хвостовом окне, чтобы ловить обрез/сдвиг хвоста)
          const lastExpectedWord = expTokens[expTokens.length - 1];
          const tailWindow = actTokens.slice(Math.max(0, actTokens.length - 3));
          const hasLastWordInClip =
            expTokens.length <= 3
              ? actTokens.includes(lastExpectedWord)
              : tailWindow.includes(lastExpectedWord);

          if (!hasLastWordInClip) {
            reasons.push(
              `turn_text_mismatch (turn ${i}: missing last word "${lastExpectedWord}")`
            );
            if (!badClipIndices.includes(i)) badClipIndices.push(i);
          }
        }
      }
    }
  }

  // 5. Общая проверка транскрипции (слова, повторы, пропуски, "short pause" / английский мусор)
  const effectiveTranscript =
    typeof transcriptText === "string"
      ? transcriptText
      : perTurnSpokenParts.length === expectedTurns.length
        ? perTurnSpokenParts.join(" ")
        : undefined;

  let transcriptWordRatio: number | undefined;
  let englishLeakTokens: string[] | undefined;

  if (typeof effectiveTranscript === "string") {
    const expectedJoined = expectedTurns
      .map((t) => stripLegacyPauseArtifacts(t.cleanSpeechText))
      .join(" ");
    const expectedTokens = tokenizeForQa(expectedJoined);
    const actualTokens = tokenizeForQa(effectiveTranscript);

    const expectedTokenSet = new Set(expectedTokens);

    if (expectedTokens.length > 0) {
      if (actualTokens.length === 0) {
        transcriptWordRatio = 0;
        reasons.push("empty_transcript");
      } else {
        transcriptWordRatio = Math.round((actualTokens.length / expectedTokens.length) * 100) / 100;
        if (transcriptWordRatio > 1.2) {
          const expFreq = new Map<string, number>();
          const actFreq = new Map<string, number>();
          for (const w of expectedTokens) expFreq.set(w, (expFreq.get(w) || 0) + 1);
          for (const w of actualTokens) actFreq.set(w, (actFreq.get(w) || 0) + 1);
          let extraWords = 0;
          for (const [w, cnt] of actFreq.entries()) {
            const expCnt = expFreq.get(w) || 0;
            if (cnt > expCnt) extraWords += cnt - expCnt;
          }
          if (extraWords > 0) {
            reasons.push(
              `repetition_detected (words ${actualTokens.length}/${expectedTokens.length}, ratio=${transcriptWordRatio.toFixed(2)})`
            );
          }
        } else if (transcriptWordRatio < 0.8) {
          reasons.push(
            `omission_detected (words ${actualTokens.length}/${expectedTokens.length}, ratio=${transcriptWordRatio.toFixed(2)})`
          );
        }
      }
    }

    // Проверка на "short", "pause" и посторонние английские слова, которых нет в ожидаемом тексте
    const leaked = new Set<string>();
    for (const tok of actualTokens) {
      if (expectedTokenSet.has(tok)) continue;
      if (tok === "short" || tok === "pause" || tok === "pauses") {
        leaked.add(tok);
      } else if (OBVIOUS_ENGLISH_LEAK_WORDS.has(tok)) {
        leaked.add(tok);
      }
    }
    if (leaked.size > 0) {
      englishLeakTokens = Array.from(leaked);
      if (leaked.has("short") || leaked.has("pause") || leaked.has("pauses")) {
        reasons.push(`short_pause_spoken (${englishLeakTokens.join(", ")})`);
      } else {
        reasons.push(`english_leak (${englishLeakTokens.join(", ")})`);
      }
    }
  }

  return {
    passed: reasons.length === 0,
    reasons,
    blockDurationRatio,
    transcriptWordRatio,
    transcriptText: effectiveTranscript,
    englishLeakTokens,
    badClipIndices,
    badMethods,
  };
}

// =========================================================================
// VOICE CONFIG & SINGLE-TURN RECOVERY
// =========================================================================

function buildSingleSpeakerVoiceConfig(sp: ResolvedBatchSpeaker): any {
  if (sp.isCloned) {
    if (
      sp.replicatedVoiceConfig?.voiceSampleAudio &&
      (sp.replicatedVoiceConfig?.consentAudio || sp.replicatedVoiceConfig?.voiceConsentSignature)
    ) {
      const sampleData =
        typeof sp.replicatedVoiceConfig.voiceSampleAudio === "string"
          ? sp.replicatedVoiceConfig.voiceSampleAudio
          : sp.replicatedVoiceConfig.voiceSampleAudio?.data;
      return {
        replicatedVoiceConfig: {
          mimeType: "audio/wav",
          voiceSampleAudio: sampleData,
          ...(sp.replicatedVoiceConfig.consentAudio
            ? { consentAudio: sp.replicatedVoiceConfig.consentAudio }
            : {}),
          ...(sp.replicatedVoiceConfig.voiceConsentSignature
            ? { voiceConsentSignature: sp.replicatedVoiceConfig.voiceConsentSignature }
            : {}),
        },
      };
    }
    return {
      voice:
        sp.voiceId && sp.voiceId.startsWith("voice_") ? sp.voiceId : "voice_17raj9ewke3g",
    };
  }
  return {
    prebuiltVoiceConfig: { voiceName: sp.baseVoice || "Charon" },
  };
}

async function synthesizeMissingSingleTurnPcm(
  ai: GoogleGenAI,
  turn: BatchInputTurn,
  speaker: ResolvedBatchSpeaker
): Promise<{ pcm: Buffer; provider: "google" | "kie.ai" | "fake" }> {
  const cleanText = stripLegacyPauseArtifacts(turn.cleanSpeechText);
  const cleanStyle = buildCleanTurnStyleForTts(turn);

  if (ttsPayloadObserver) {
    ttsPayloadObserver({
      channel: "single_recovery",
      parts: [{ text: cleanText, style: cleanStyle, speaker: speaker.baseVoice || "Charon" }],
    });
  }

  if (isFakeDubbingTtsEnabled()) {
    const syl = Math.max(1, countSyllables(cleanText));
    return {
      pcm: generateSyntheticTurnPcm(Math.max(0.35, syl / 4.8), 360),
      provider: "fake",
    };
  }

  const voiceConfig = buildSingleSpeakerVoiceConfig(speaker);

  try {
    if (simulateDubbingGoogle429) {
      const err: any = new Error("429 RESOURCE_EXHAUSTED");
      err.status = 429;
      throw err;
    }

    const resp = await ai.models.generateContent({
      model: DUBBING_MODELS_CONFIG.ttsDubbingModel, // СТРОГО gemini-3.8-flash-tts
      contents: [
        {
          role: "user",
          parts: [
            {
              text: cleanText,
              speechMetadata: {
                ...(speaker.isCloned ? {} : { speaker: speaker.baseVoice || "Charon" }),
                style: cleanStyle,
              },
            } as any,
          ],
        },
      ],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig },
      },
    });
    recordGoogleTtsCalls(1);

    const b64 = resp.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!b64) throw new Error("Empty audio from single-turn recovery");
    return {
      pcm: applyMicroEdgeFades(
        trimSilenceEdgesPcm(extractRawPcm24k(Buffer.from(b64, "base64")), 25),
        6
      ),
      provider: "google",
    };
  } catch (err: any) {
    if (isQuota429Error(err) && !speaker.isCloned) {
      markGoogleTtsQuotaExhaustedToday();
      const kieRes = await synthesizeDialogueBlockViaKieAi([
        {
          speaker: speaker.speakerName,
          voice: speaker.baseVoice || "Charon",
          text: cleanText,
          style: cleanStyle,
        },
      ]);
      return {
        pcm: applyMicroEdgeFades(trimSilenceEdgesPcm(kieRes.pcm, 25), 6),
        provider: "kie.ai",
      };
    }
    throw err;
  }
}

interface AlignedTurnClipWithQa {
  pcm: Buffer;
  startMs: number;
  endMs: number;
  durationSec: number;
  method: string;
  spokenText?: string;
  detectedVoice?: "male" | "female" | "unknown";
  boundarySnapped?: boolean;
  boundaryIssue?: string;
}

/**
 * Нарезка и порепликовая верификация (START, END, SPOKEN_TEXT, VOICE) в ОДНОМ запросе
 * к `gemini-4-hydrogen` (JSON responseSchema) на подблок.
 */
async function sliceBlockAudioIntoTurns(
  ai: GoogleGenAI,
  blockPcm: Buffer,
  turns: BatchInputTurn[],
  speakerMap: Map<string, ResolvedBatchSpeaker>,
  fakeOptions?: {
    fakeTurnOverrides?: Array<FakeTurnAlignmentOverride | null | undefined>;
    fakeWholeTranscriptOverride?: string;
  }
): Promise<{
  clips: AlignedTurnClipWithQa[];
  transcribeCalls: number;
  recoveryTtsCalls: number;
  heardTranscript?: string;
}> {
  const aligned = await alignBatchAudioViaTranscribe(
    ai,
    blockPcm,
    turns.map((t, i) => ({
      index: i,
      speaker: t.speakerName,
      text: stripLegacyPauseArtifacts(t.cleanSpeechText),
      gender: inferSpeakerGender(speakerMap.get(t.speakerId), t),
    })),
    DUBBING_MODELS_CONFIG.audioAlignmentModel,
    {
      silenceMinMs: 120,
      snapToleranceSec: 0.6,
      fakeTurnOverrides: fakeOptions?.fakeTurnOverrides,
      fakeWholeTranscriptOverride: fakeOptions?.fakeWholeTranscriptOverride,
    }
  );

  const transcribeCalls = aligned.usedApiCall ? 1 : 0;
  const clips: AlignedTurnClipWithQa[] = [];
  let cursorMs = 0;

  for (let i = 0; i < turns.length; i++) {
    const clip: SlicedTurnClip | null = aligned.clips[i] || null;
    const alignInfo = aligned.turnAlignments[i];
    if (clip) {
      const sMs = Math.max(cursorMs, clip.startMs);
      const eMs = Math.max(sMs + 100, clip.endMs);
      clips.push({
        pcm: clip.pcm,
        startMs: sMs,
        endMs: eMs,
        durationSec: clip.durationSec,
        method: clip.method,
        spokenText: clip.spokenText,
        detectedVoice: clip.detectedVoice,
        boundarySnapped: clip.boundarySnapped,
        boundaryIssue: clip.boundaryIssue,
      });
      cursorMs = eMs;
    } else {
      // Отсутствующая / не привязанная к паузе реплика — помечаем как брак (missing_turn),
      // чтобы QA отклонил подблок и запустил каскад восстановления без лишнего скрытого single_recovery!
      const fallbackPcm = Buffer.alloc(Math.round(0.35 * PCM_BYTES_PER_SEC), 0);
      const sMs = cursorMs;
      const eMs = sMs + 350;
      const issueDetail =
        i === 0 && aligned.error
          ? `${aligned.error}; ${alignInfo?.boundaryIssue || `missing_turn (${i})`}`
          : alignInfo?.boundaryIssue || `no_silence_boundary_near_cut (turn ${i})`;
      clips.push({
        pcm: fallbackPcm,
        startMs: sMs,
        endMs: eMs,
        durationSec: 0.35,
        method: "missing_turn",
        spokenText: alignInfo?.spokenText ?? "",
        detectedVoice: alignInfo?.voice ?? "unknown",
        boundarySnapped: false,
        boundaryIssue: issueDetail,
      });
      cursorMs = eMs;
    }
  }

  return {
    clips,
    transcribeCalls,
    recoveryTtsCalls: 0,
    heardTranscript: aligned.heardTranscript,
  };
}

// =========================================================================
// STAGE 4 (PART 1): SINGLE-TURN TIMECODE FIT (1.10x -> 1.15x -> needsShorten)
// =========================================================================

/**
 * Этап 4: Укладка одной реплики в таймкод БЕЗ ОБРЫВА СЛОВ и БЕЗ правки текста:
 * 1. Обычный ffmpeg atempo до 1.10x;
 * 2. Если реплика всё ещё не влезает — точечный atempo до 1.15x ТОЛЬКО для этой реплики;
 * 3. Если и при 1.15x не влезает — ставим needsShorten = true (в UI «нужно сократить») без правки текста;
 * 4. При overflow добавляем плавный fade-out 120 мс.
 */
export async function fitSlicedTurnToTimecode(
  rawPcm: Buffer,
  turn: BatchInputTurn,
  strictTimeWindow: boolean,
  incomingShiftSec: number = 0
): Promise<{
  pcm: Buffer;
  originalDurationSec: number;
  dubbedDurationSec: number;
  atempoApplied: number;
  fitStepApplied: string;
  syncStatus: TurnSyncStatus;
  needsShorten: boolean;
}> {
  const normalMaxAtempo = DUBBING_MODELS_CONFIG.maxAtempoSpeedRatio || 1.1;
  const singleTurnBoostMaxAtempo = 1.15;
  const fadeOutMs = DUBBING_MODELS_CONFIG.overflowFadeOutMs || 120;

  const hasValidWindow =
    strictTimeWindow &&
    typeof turn.startSec === "number" &&
    typeof turn.endSec === "number" &&
    turn.endSec > turn.startSec;

  const windowSec = hasValidWindow
    ? Math.round(Math.max(0.5, turn.endSec! - turn.startSec!) * 100) / 100
    : Math.round((rawPcm.length / PCM_BYTES_PER_SEC) * 100) / 100;
  const gapAfterSec =
    typeof turn.gapAfterSec === "number" && turn.gapAfterSec >= 0 ? turn.gapAfterSec : 0;

  const rawDurationSec = rawPcm.length / PCM_BYTES_PER_SEC;
  if (!hasValidWindow) {
    return {
      pcm: rawPcm,
      originalDurationSec: Math.round(rawDurationSec * 100) / 100,
      dubbedDurationSec: Math.round(rawDurationSec * 100) / 100,
      atempoApplied: 1.0,
      fitStepApplied: "batch_original",
      syncStatus: "ok",
      needsShorten: false,
    };
  }

  // Свободное окно с учётом паузы после реплики, 80 мс чистого зазора и уже накопленного сдвига
  const safeIncomingShift = Math.max(0, Number.isFinite(incomingShiftSec) ? incomingShiftSec : 0);
  const slotAvailableWithGap = Math.max(0.4, windowSec + gapAfterSec - 0.08);
  const effectiveAvailableWithGap = Math.max(0.4, slotAvailableWithGap - safeIncomingShift);

  let pcm = rawPcm;
  let atempoApplied = 1.0;
  let fitStepApplied = "batch_original";
  let syncStatus: TurnSyncStatus = "ok";
  let needsShorten = false;

  if (rawDurationSec <= effectiveAvailableWithGap && safeIncomingShift <= 0.02) {
    if (rawDurationSec <= windowSec + 0.05) {
      return {
        pcm,
        originalDurationSec: windowSec,
        dubbedDurationSec: Math.round(rawDurationSec * 100) / 100,
        atempoApplied: 1.0,
        fitStepApplied: "batch_original",
        syncStatus: "ok",
        needsShorten: false,
      };
    }
    return {
      pcm,
      originalDurationSec: windowSec,
      dubbedDurationSec: Math.round(rawDurationSec * 100) / 100,
      atempoApplied: 1.0,
      fitStepApplied: "used_gap_after",
      syncStatus: "ok",
      needsShorten: false,
    };
  }

  if (rawDurationSec <= effectiveAvailableWithGap) {
    return {
      pcm,
      originalDurationSec: windowSec,
      dubbedDurationSec: Math.round(rawDurationSec * 100) / 100,
      atempoApplied: 1.0,
      fitStepApplied: "drained_shift_in_gap",
      syncStatus: "adjusted",
      needsShorten: false,
    };
  }

  // Шаг 1: Обычное ускорение atempo до 1.10x
  const rawNeeded = rawDurationSec / effectiveAvailableWithGap;
  if (rawNeeded <= normalMaxAtempo) {
    const ratio = Math.min(normalMaxAtempo, rawNeeded);
    if (ratio > 1.008) {
      pcm = await applyMildAtempoPcm(rawPcm, ratio, 24000, normalMaxAtempo);
      atempoApplied = Math.round(ratio * 100) / 100;
      fitStepApplied = `atempo_${atempoApplied}x`;
      syncStatus = "adjusted";
    }
  } else {
    // Шаг 2: Точечное ускорение до 1.15x ТОЛЬКО для этой реплики
    const boostRatio = Math.min(singleTurnBoostMaxAtempo, rawNeeded);
    pcm = await applyMildAtempoPcm(rawPcm, boostRatio, 24000, singleTurnBoostMaxAtempo);
    atempoApplied = Math.round(boostRatio * 100) / 100;
    fitStepApplied = `atempo_boost_${atempoApplied}x`;
    syncStatus = "adjusted";
  }

  const finalDurSec = Math.round((pcm.length / PCM_BYTES_PER_SEC) * 100) / 100;

  // Шаг 3: Если даже после 1.15x реплика не влезает в собственное окно+паузу — помечаем «нужно сократить» (текст НЕ меняем!)
  if (finalDurSec > slotAvailableWithGap + 0.05) {
    needsShorten = true;
    fitStepApplied = `${fitStepApplied}+needs_shorten`;
    if (finalDurSec > effectiveAvailableWithGap + 1.2) {
      pcm = applyTailFadeOut(pcm, fadeOutMs);
      fitStepApplied = `${fitStepApplied}+overflow_fade120ms`;
      syncStatus = "overflow";
    } else {
      syncStatus = "adjusted";
    }
  }

  return {
    pcm,
    originalDurationSec: windowSec,
    dubbedDurationSec: finalDurSec,
    atempoApplied,
    fitStepApplied,
    syncStatus,
    needsShorten,
  };
}

// =========================================================================
// SUB-BLOCK SYNTHESIS & QA ESCALATION ENGINE (STAGE 2)
// =========================================================================

interface SubBlockSynthesisAttemptResult {
  clips: Array<{
    pcm: Buffer;
    startMs: number;
    endMs: number;
    durationSec: number;
    method: string;
  }>;
  qaEval: SubBlockQaEvaluation;
  ttsCalls: number;
  transcribeCalls: number;
  providers: Array<"google" | "kie.ai" | "fake">;
  quotaPaused?: boolean;
  quotaPauseMessageRu?: string;
}

async function runSingleSubBlockAttempt(
  ai: GoogleGenAI,
  params: {
    subTurns: BatchInputTurn[];
    speakerMap: Map<string, ResolvedBatchSpeaker>;
    uniqueSpeakers: ResolvedBatchSpeaker[];
    forceMode: "A" | "B";
    attemptNumber: number;
    stage: "primary" | "retry" | "split_half" | "mode_b";
    startingCompletedBlocks: number;
    blocksCompletedSoFar: number;
    totalProjectBlocks: number;
  }
): Promise<SubBlockSynthesisAttemptResult> {
  const {
    subTurns,
    speakerMap,
    uniqueSpeakers,
    forceMode,
    attemptNumber,
    stage,
    startingCompletedBlocks,
    blocksCompletedSoFar,
    totalProjectBlocks,
  } = params;

  const providers: Array<"google" | "kie.ai" | "fake"> = [];
  let ttsCalls = 0;
  let transcribeCalls = 0;

  const injectedFault: FakeAttemptFault | null =
    isFakeDubbingTtsEnabled() && fakeFaultInjector
      ? fakeFaultInjector({ attempt: attemptNumber, stage, turns: subTurns, mode: forceMode })
      : null;

  if (forceMode === "A") {
    const spList = uniqueSpeakers.slice(0, 2);
    const sp1 = spList[0];
    const sp2 =
      spList[1] || {
        ...sp1,
        speakerId: "__ALT__",
        speakerName: "CoHost",
        baseVoice: sp1.baseVoice === "Charon" ? "Kore" : "Charon",
      };
    const tag1 = "SpeakerOne";
    const tag2 = "SpeakerTwo";

    const parts = subTurns.map((t) => {
      const isFirst = t.speakerId === sp1.speakerId;
      const speakerTag = isFirst ? tag1 : tag2;
      const cleanText = stripLegacyPauseArtifacts(t.cleanSpeechText);
      const cleanStyle = buildCleanTurnStyleForTts(t);
      return {
        text: cleanText,
        speechMetadata: {
          speaker: speakerTag,
          style: cleanStyle,
        },
      };
    });

    if (ttsPayloadObserver) {
      ttsPayloadObserver({
        channel: "google_mode_a",
        parts: parts.map((p) => ({
          text: p.text,
          style: p.speechMetadata.style,
          speaker: p.speechMetadata.speaker,
        })),
      });
    }

    let blockPcm: Buffer;
    if (isFakeDubbingTtsEnabled()) {
      const fakeTurns = (injectedFault?.omitLastTurnInAudio && subTurns.length > 1
        ? subTurns.slice(0, subTurns.length - 1)
        : subTurns
      ).map((t, idx) => {
        const syl = Math.max(1, countSyllables(stripLegacyPauseArtifacts(t.cleanSpeechText)));
        const mult =
          injectedFault?.perTurnDurationMultipliers?.[idx] ??
          injectedFault?.durationMultiplier ??
          1.0;
        return {
          syllables: syl,
          speakerKey: t.speakerId,
          overrideDurationSec: Math.max(0.25, (syl / 4.8) * mult),
        };
      });
      blockPcm = generateSyntheticBlockPcm(
        fakeTurns,
        injectedFault?.noInterTurnSilence ? 0 : 0.45
      ).pcm;
      providers.push("fake");
    } else {
      try {
        if (simulateDubbingGoogle429) {
          const err: any = new Error("429 RESOURCE_EXHAUSTED");
          err.status = 429;
          throw err;
        }
        const resp = await ai.models.generateContent({
          model: DUBBING_MODELS_CONFIG.ttsDubbingModel, // СТРОГО gemini-3.8-flash-tts
          contents: [{ role: "user", parts: parts as any }],
          config: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              multiSpeakerVoiceConfig: {
                speakerVoiceConfigs: [
                  {
                    speaker: tag1,
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: sp1.baseVoice || "Charon" } },
                  },
                  {
                    speaker: tag2,
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: sp2.baseVoice || "Kore" } },
                  },
                ],
              },
            },
          },
        });
        ttsCalls += 1;
        recordGoogleTtsCalls(1);
        providers.push("google");

        const resParts = resp.candidates?.[0]?.content?.parts || [];
        const audioParts = resParts.filter((p: any) => typeof p?.inlineData?.data === "string");
        if (audioParts.length === 0) {
          throw new Error("Multi-speaker Gemini TTS returned empty audio");
        }
        blockPcm = Buffer.concat(
          audioParts.map((ap: any) => extractRawPcm24k(Buffer.from(ap.inlineData.data, "base64")))
        );
      } catch (err: any) {
        if (isQuota429Error(err)) {
          markGoogleTtsQuotaExhaustedToday();
          const kieTurns: KieDialogueTurnInput[] = subTurns.map((t) => {
            const isFirst = t.speakerId === sp1.speakerId;
            return {
              speaker: isFirst ? tag1 : tag2,
              voice: isFirst ? sp1.baseVoice || "Charon" : sp2.baseVoice || "Kore",
              text: stripLegacyPauseArtifacts(t.cleanSpeechText),
              style: buildCleanTurnStyleForTts(t),
            };
          });
          if (ttsPayloadObserver) {
            ttsPayloadObserver({
              channel: "kie_mode_a",
              parts: kieTurns.map((k) => ({
                text: k.text,
                style: k.style || "",
                speaker: k.speaker,
              })),
            });
          }
          const kieRes = await synthesizeDialogueBlockViaKieAi(kieTurns);
          ttsCalls += 1;
          providers.push("kie.ai");
          blockPcm = kieRes.pcm;
        } else {
          throw err;
        }
      }
    }

    // Ровно ОДИН запрос транскрипции на подблок: одновременно нарезка (по паузам >= 120 мс в ±0.6 с)
    // и порепликовая верификация (SPOKEN_TEXT + VOICE)
    const sliced = await sliceBlockAudioIntoTurns(ai, blockPcm, subTurns, speakerMap, {
      fakeTurnOverrides: injectedFault?.fakeTurnOverrides,
      fakeWholeTranscriptOverride: injectedFault?.overrideTranscript,
    });
    transcribeCalls += sliced.transcribeCalls;
    ttsCalls += sliced.recoveryTtsCalls;

    const clips = sliced.clips.map((c) =>
      injectedFault?.forceMethod ? { ...c, method: injectedFault.forceMethod } : c
    );

    const qaEval = evaluateSubBlockQa({
      expectedTurns: subTurns,
      slicedClips: clips,
      transcriptText:
        injectedFault?.overrideTranscript !== undefined
          ? injectedFault.overrideTranscript
          : sliced.heardTranscript,
      speakerMap,
    });

    return { clips, qaEval, ttsCalls, transcribeCalls, providers };
  }

  // =========================================================================
  // MODE B: 1 вызов TTS на каждого спикера в подблоке + 1 общий запрос транскрипции на подблок
  // =========================================================================
  const perSpeakerIndices = new Map<string, number[]>();
  subTurns.forEach((t, localIdx) => {
    const list = perSpeakerIndices.get(t.speakerId) || [];
    list.push(localIdx);
    perSpeakerIndices.set(t.speakerId, list);
  });

  const qaPcmParts: Buffer[] = [];
  const qaExpectedOrder: BatchInputTurn[] = [];
  const qaOrigIndices: number[] = [];
  const silenceGap400ms = Buffer.alloc(Math.round(0.4 * PCM_BYTES_PER_SEC), 0);

  for (const [spId, localIndices] of perSpeakerIndices.entries()) {
    const sp = speakerMap.get(spId)!;
    const spTurns = localIndices.map((idx) => subTurns[idx]);

    const parts = spTurns.map((t) => ({
      text: stripLegacyPauseArtifacts(t.cleanSpeechText),
      speechMetadata: {
        ...(sp.isCloned ? {} : { speaker: sp.baseVoice || "Charon" }),
        style: buildCleanTurnStyleForTts(t),
      },
    }));

    if (ttsPayloadObserver) {
      ttsPayloadObserver({
        channel: "google_mode_b",
        parts: parts.map((p) => ({
          text: p.text,
          style: p.speechMetadata.style,
          speaker: sp.speakerName,
        })),
      });
    }

    let spBlockPcm: Buffer;
    if (isFakeDubbingTtsEnabled()) {
      const fakeTurns = spTurns.map((t, j) => {
        const origLocalIdx = localIndices[j];
        const syl = Math.max(1, countSyllables(stripLegacyPauseArtifacts(t.cleanSpeechText)));
        const mult =
          injectedFault?.perTurnDurationMultipliers?.[origLocalIdx] ??
          injectedFault?.durationMultiplier ??
          1.0;
        return {
          syllables: syl,
          speakerKey: t.speakerId,
          overrideDurationSec: Math.max(0.25, (syl / 4.8) * mult),
        };
      });
      spBlockPcm = generateSyntheticBlockPcm(
        fakeTurns,
        injectedFault?.noInterTurnSilence ? 0 : 0.45
      ).pcm;
      providers.push("fake");
    } else {
      try {
        if (simulateDubbingGoogle429) {
          const err: any = new Error("429 RESOURCE_EXHAUSTED");
          err.status = 429;
          throw err;
        }
        const resp = await ai.models.generateContent({
          model: DUBBING_MODELS_CONFIG.ttsDubbingModel, // СТРОГО gemini-3.8-flash-tts
          contents: [{ role: "user", parts: parts as any }],
          config: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: buildSingleSpeakerVoiceConfig(sp),
            },
          },
        });
        ttsCalls += 1;
        recordGoogleTtsCalls(1);
        providers.push("google");

        const resParts = resp.candidates?.[0]?.content?.parts || [];
        const audioParts = resParts.filter((p: any) => typeof p?.inlineData?.data === "string");
        if (audioParts.length === 0) {
          throw new Error(`Per-speaker Gemini TTS returned empty audio for ${sp.speakerName}`);
        }
        spBlockPcm = Buffer.concat(
          audioParts.map((ap: any) => extractRawPcm24k(Buffer.from(ap.inlineData.data, "base64")))
        );
      } catch (err: any) {
        if (isQuota429Error(err)) {
          markGoogleTtsQuotaExhaustedToday();
          if (sp.isCloned) {
            const doneTotal = startingCompletedBlocks + blocksCompletedSoFar;
            return {
              clips: [],
              qaEval: {
                passed: false,
                reasons: ["quota_paused_clone"],
                blockDurationRatio: 0,
                badClipIndices: [],
                badMethods: [],
              },
              ttsCalls,
              transcribeCalls,
              providers,
              quotaPaused: true,
              quotaPauseMessageRu: `Дневной лимит исчерпан. Готово ${doneTotal} из ${totalProjectBlocks} подблоков, продолжим после 13:00 по Ташкенту`,
            };
          }
          const kieTurns: KieDialogueTurnInput[] = spTurns.map((t) => ({
            speaker: sp.speakerName,
            voice: sp.baseVoice || "Charon",
            text: stripLegacyPauseArtifacts(t.cleanSpeechText),
            style: buildCleanTurnStyleForTts(t),
          }));
          if (ttsPayloadObserver) {
            ttsPayloadObserver({
              channel: "kie_mode_b",
              parts: kieTurns.map((k) => ({
                text: k.text,
                style: k.style || "",
                speaker: k.speaker,
              })),
            });
          }
          const kieRes = await synthesizeDialogueBlockViaKieAi(kieTurns);
          ttsCalls += 1;
          providers.push("kie.ai");
          spBlockPcm = kieRes.pcm;
        } else {
          throw err;
        }
      }
    }

    if (qaPcmParts.length > 0) qaPcmParts.push(silenceGap400ms);
    qaPcmParts.push(spBlockPcm);
    qaExpectedOrder.push(...spTurns);
    qaOrigIndices.push(...localIndices);
  }

  // Один общий запрос выравнивания и QA-транскрипции на весь подблок Mode B
  const reorderedFakeOverrides = injectedFault?.fakeTurnOverrides
    ? qaOrigIndices.map((origIdx) => injectedFault.fakeTurnOverrides?.[origIdx])
    : undefined;

  const combinedAligned = await sliceBlockAudioIntoTurns(
    ai,
    Buffer.concat(qaPcmParts),
    qaExpectedOrder,
    speakerMap,
    {
      fakeTurnOverrides: reorderedFakeOverrides,
      fakeWholeTranscriptOverride: injectedFault?.overrideTranscript,
    }
  );
  transcribeCalls += combinedAligned.transcribeCalls;
  ttsCalls += combinedAligned.recoveryTtsCalls;

  const assembledClips = new Array<AlignedTurnClipWithQa>(subTurns.length);
  qaOrigIndices.forEach((origLocalIdx, k) => {
    const c = combinedAligned.clips[k];
    assembledClips[origLocalIdx] = injectedFault?.forceMethod
      ? { ...c, method: injectedFault.forceMethod }
      : c;
  });

  // Нормализуем монотонные startMs/endMs в порядке сценария
  let runningMs = 0;
  const orderedClips = assembledClips.map((c) => {
    const durMs = Math.max(100, Math.round((c.pcm.length / PCM_BYTES_PER_SEC) * 1000));
    const out = {
      ...c,
      startMs: runningMs,
      endMs: runningMs + durMs,
    };
    runningMs += durMs + 50;
    return out;
  });

  const qaEval = evaluateSubBlockQa({
    expectedTurns: subTurns,
    slicedClips: orderedClips,
    transcriptText:
      injectedFault?.overrideTranscript !== undefined
        ? injectedFault.overrideTranscript
        : combinedAligned.heardTranscript,
    speakerMap,
  });

  return { clips: orderedClips, qaEval, ttsCalls, transcribeCalls, providers };
}

function chooseSmartHalfSplitIndex(turns: BatchInputTurn[]): number {
  const n = turns.length;
  const mid = Math.ceil(n / 2);
  if (n <= 2) return 1;
  // Избегаем разреза сразу после вопроса ("?") если соседний индекс чище
  const candidates = [mid, mid - 1, mid + 1].filter((c) => c >= 1 && c < n);
  let best = mid;
  let bestScore = -Infinity;
  for (const c of candidates) {
    const prevText = String(turns[c - 1]?.text || turns[c - 1]?.cleanSpeechText || "").trim();
    const isQ = /\?[\s"'»”’)]*$/.test(prevText);
    const spChange = turns[c - 1]?.speakerId !== turns[c]?.speakerId;
    const score = (spChange ? 20 : 0) - (isQ ? 50 : 0) - Math.abs(c - mid) * 3;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

interface ResolvedSubBlockOutput {
  pcms: Buffer[];
  methods: string[];
  qas: TurnQaStatus[];
  qaReasons: Array<string | undefined>;
  ttsCalls: number;
  transcribeCalls: number;
  retriesUsed: number;
  providers: Array<"google" | "kie.ai" | "cache" | "fake">;
  quotaPaused?: boolean;
  quotaPauseMessageRu?: string;
}

interface RetryBudgetTracker {
  extraTtsUsed: number;
  extraTtsLimit: number;
}

function estimateAttemptTtsCost(turns: BatchInputTurn[], mode: "A" | "B"): number {
  if (mode === "A") return 1;
  const spCount = new Set(turns.map((t) => t.speakerId)).size;
  return Math.max(1, spCount);
}

/**
 * Синтез одного подблока с кэшем v3, порепликовым QA и каскадом восстановления
 * в рамках жёсткого лимита лишних вызовов TTS (<= 25% от числа подблоков):
 * 1. Кэш v3 (если !bypassCache);
 * 2. Попытка 1 (Mode A или Mode B);
 * 3. При провале QA -> если бюджет позволяет: Попытка 2 (повтор), Попытка 3 (деление пополам), Попытка 4 (Mode B);
 * 4. При исчерпании лимита переделок или провале -> сразу qa="failed" с явной причиной, в кэш НЕ писать!
 */
async function executeSubBlockWithQaAndEscalation(
  ai: GoogleGenAI,
  params: {
    subTurns: BatchInputTurn[];
    speakerMap: Map<string, ResolvedBatchSpeaker>;
    uniqueSpeakers: ResolvedBatchSpeaker[];
    canUseModeA: boolean;
    bypassCache: boolean;
    startingCompletedBlocks: number;
    blocksCompletedSoFar: number;
    totalProjectBlocks: number;
    retryBudget: RetryBudgetTracker;
  }
): Promise<ResolvedSubBlockOutput> {
  const {
    subTurns,
    speakerMap,
    uniqueSpeakers,
    canUseModeA,
    bypassCache,
    startingCompletedBlocks,
    blocksCompletedSoFar,
    totalProjectBlocks,
    retryBudget,
  } = params;

  const primaryMode: "A" | "B" = canUseModeA ? "A" : "B";
  const cacheHash = computeSubBlockCacheHash(subTurns, speakerMap, primaryMode);

  if (!bypassCache) {
    const cached = loadCachedBlockPcmsV3(cacheHash, subTurns.length);
    if (cached) {
      return {
        pcms: cached.pcms,
        methods: cached.methods,
        qas: subTurns.map(() => cached.qa),
        qaReasons: subTurns.map(() => undefined),
        ttsCalls: 0,
        transcribeCalls: 0,
        retriesUsed: 0,
        providers: ["cache"],
      };
    }
  }

  let totalTts = 0;
  let totalTranscribe = 0;
  let retriesUsed = 0;
  const providers: Array<"google" | "kie.ai" | "cache" | "fake"> = [];
  let attemptCounter = 0;

  const accumulate = (res: SubBlockSynthesisAttemptResult) => {
    totalTts += res.ttsCalls;
    totalTranscribe += res.transcribeCalls;
    providers.push(...res.providers);
  };

  const canSpendExtraTts = (neededCalls: number): boolean => {
    return retryBudget.extraTtsUsed + neededCalls <= retryBudget.extraTtsLimit;
  };
  const consumeExtraTts = (spentCalls: number) => {
    retryBudget.extraTtsUsed += spentCalls;
  };

  // --- ПОПЫТКА 1: Основная (не тратит лимит переделок) ---
  attemptCounter += 1;
  const attempt1 = await runSingleSubBlockAttempt(ai, {
    subTurns,
    speakerMap,
    uniqueSpeakers,
    forceMode: primaryMode,
    attemptNumber: attemptCounter,
    stage: "primary",
    startingCompletedBlocks,
    blocksCompletedSoFar,
    totalProjectBlocks,
  });
  accumulate(attempt1);
  if (attempt1.quotaPaused) {
    return {
      pcms: [],
      methods: [],
      qas: [],
      qaReasons: [],
      ttsCalls: totalTts,
      transcribeCalls: totalTranscribe,
      retriesUsed,
      providers,
      quotaPaused: true,
      quotaPauseMessageRu: attempt1.quotaPauseMessageRu,
    };
  }

  if (attempt1.qaEval.passed) {
    const pcms = attempt1.clips.map((c) => c.pcm);
    const methods = attempt1.clips.map((c) => c.method);
    saveCachedBlockPcmsV3(cacheHash, pcms, methods, "ok");
    return {
      pcms,
      methods,
      qas: subTurns.map(() => "ok"),
      qaReasons: subTurns.map(() => undefined),
      ttsCalls: totalTts,
      transcribeCalls: totalTranscribe,
      retriesUsed,
      providers,
    };
  }

  const firstFailureSummary = attempt1.qaEval.reasons.join("; ");
  let bestFallbackAttempt = attempt1;
  let budgetExhaustedNote = "";

  // --- ПОПЫТКА 2: Перегенерировать подблок 1 раз (в рамках 25% лимита) ---
  const retryCost = estimateAttemptTtsCost(subTurns, primaryMode);
  if (!canSpendExtraTts(retryCost)) {
    budgetExhaustedNote = `retry_budget_exhausted (${retryBudget.extraTtsUsed}/${retryBudget.extraTtsLimit})`;
  } else {
    consumeExtraTts(retryCost);
    retriesUsed += 1;
    attemptCounter += 1;
    const attempt2 = await runSingleSubBlockAttempt(ai, {
      subTurns,
      speakerMap,
      uniqueSpeakers,
      forceMode: primaryMode,
      attemptNumber: attemptCounter,
      stage: "retry",
      startingCompletedBlocks,
      blocksCompletedSoFar,
      totalProjectBlocks,
    });
    accumulate(attempt2);
    if (attempt2.quotaPaused) {
      return {
        pcms: [],
        methods: [],
        qas: [],
        qaReasons: [],
        ttsCalls: totalTts,
        transcribeCalls: totalTranscribe,
        retriesUsed,
        providers,
        quotaPaused: true,
        quotaPauseMessageRu: attempt2.quotaPauseMessageRu,
      };
    }

    if (attempt2.qaEval.passed) {
      const pcms = attempt2.clips.map((c) => c.pcm);
      const methods = attempt2.clips.map((c) => c.method);
      saveCachedBlockPcmsV3(cacheHash, pcms, methods, "retried");
      return {
        pcms,
        methods,
        qas: subTurns.map(() => "retried"),
        qaReasons: subTurns.map(() => `Исправлено при повторе (${firstFailureSummary})`),
        ttsCalls: totalTts,
        transcribeCalls: totalTranscribe,
        retriesUsed,
        providers,
      };
    }
    if (attempt2.qaEval.reasons.length <= bestFallbackAttempt.qaEval.reasons.length) {
      bestFallbackAttempt = attempt2;
    }
  }

  // --- ПОПЫТКА 3: Разбить подблок пополам (если >= 2 реплик и хватает лимита) ---
  if (!budgetExhaustedNote && subTurns.length >= 2) {
    const splitIdx = chooseSmartHalfSplitIndex(subTurns);
    const halves = [subTurns.slice(0, splitIdx), subTurns.slice(splitIdx)];
    const splitCost = halves.reduce((acc, h) => acc + estimateAttemptTtsCost(h, primaryMode), 0);

    if (!canSpendExtraTts(splitCost)) {
      budgetExhaustedNote = `retry_budget_exhausted (${retryBudget.extraTtsUsed}/${retryBudget.extraTtsLimit})`;
    } else {
      consumeExtraTts(splitCost);
      retriesUsed += 1;
      const halfPcms: Buffer[] = [];
      const halfMethods: string[] = [];
      const halfQas: TurnQaStatus[] = [];
      const halfReasons: Array<string | undefined> = [];
      let allHalvesPassed = true;

      for (const halfTurns of halves) {
        attemptCounter += 1;
        const halfAttempt = await runSingleSubBlockAttempt(ai, {
          subTurns: halfTurns,
          speakerMap,
          uniqueSpeakers,
          forceMode: primaryMode,
          attemptNumber: attemptCounter,
          stage: "split_half",
          startingCompletedBlocks,
          blocksCompletedSoFar,
          totalProjectBlocks,
        });
        accumulate(halfAttempt);
        if (halfAttempt.quotaPaused) {
          return {
            pcms: [],
            methods: [],
            qas: [],
            qaReasons: [],
            ttsCalls: totalTts,
            transcribeCalls: totalTranscribe,
            retriesUsed,
            providers,
            quotaPaused: true,
            quotaPauseMessageRu: halfAttempt.quotaPauseMessageRu,
          };
        }

        if (halfAttempt.qaEval.passed) {
          const hp = halfAttempt.clips.map((c) => c.pcm);
          const hm = halfAttempt.clips.map((c) => c.method);
          halfPcms.push(...hp);
          halfMethods.push(...hm);
          halfQas.push(...halfTurns.map(() => "retried" as TurnQaStatus));
          halfReasons.push(
            ...halfTurns.map(() => `Исправлено делением пополам (${firstFailureSummary})`)
          );
        } else {
          // --- ПОПЫТКА 4 (для провалившейся половины): Mode B (если хватает лимита) ---
          const modeBCost = estimateAttemptTtsCost(halfTurns, "B");
          if (!canSpendExtraTts(modeBCost)) {
            allHalvesPassed = false;
            const failReason = `${halfAttempt.qaEval.reasons.join("; ") || firstFailureSummary}; retry_budget_exhausted (${retryBudget.extraTtsUsed}/${retryBudget.extraTtsLimit})`;
            halfPcms.push(...halfAttempt.clips.map((c) => c.pcm));
            halfMethods.push(...halfAttempt.clips.map((c) => c.method));
            halfQas.push(...halfTurns.map(() => "failed" as TurnQaStatus));
            halfReasons.push(...halfTurns.map(() => failReason));
            continue;
          }

          consumeExtraTts(modeBCost);
          retriesUsed += 1;
          attemptCounter += 1;
          const modeBAttempt = await runSingleSubBlockAttempt(ai, {
            subTurns: halfTurns,
            speakerMap,
            uniqueSpeakers,
            forceMode: "B",
            attemptNumber: attemptCounter,
            stage: "mode_b",
            startingCompletedBlocks,
            blocksCompletedSoFar,
            totalProjectBlocks,
          });
          accumulate(modeBAttempt);
          if (modeBAttempt.quotaPaused) {
            return {
              pcms: [],
              methods: [],
              qas: [],
              qaReasons: [],
              ttsCalls: totalTts,
              transcribeCalls: totalTranscribe,
              retriesUsed,
              providers,
              quotaPaused: true,
              quotaPauseMessageRu: modeBAttempt.quotaPauseMessageRu,
            };
          }

          if (modeBAttempt.qaEval.passed) {
            const mp = modeBAttempt.clips.map((c) => c.pcm);
            const mm = modeBAttempt.clips.map((c) => c.method);
            halfPcms.push(...mp);
            halfMethods.push(...mm);
            halfQas.push(...halfTurns.map(() => "retried" as TurnQaStatus));
            halfReasons.push(
              ...halfTurns.map(() => `Исправлено в режиме 1 голос/запрос (${firstFailureSummary})`)
            );
          } else {
            allHalvesPassed = false;
            const chosen =
              modeBAttempt.qaEval.reasons.length <= halfAttempt.qaEval.reasons.length
                ? modeBAttempt
                : halfAttempt;
            const failReason = chosen.qaEval.reasons.join("; ") || firstFailureSummary;
            halfPcms.push(...chosen.clips.map((c) => c.pcm));
            halfMethods.push(...chosen.clips.map((c) => c.method));
            halfQas.push(...halfTurns.map(() => "failed" as TurnQaStatus));
            halfReasons.push(...halfTurns.map(() => failReason));
          }
        }
      }

      if (allHalvesPassed) {
        // Кэшируем ТОЛЬКО целый подблок, если обе половины прошли QA!
        saveCachedBlockPcmsV3(cacheHash, halfPcms, halfMethods, "retried");
      }

      return {
        pcms: halfPcms,
        methods: halfMethods,
        qas: halfQas,
        qaReasons: halfReasons,
        ttsCalls: totalTts,
        transcribeCalls: totalTranscribe,
        retriesUsed,
        providers,
      };
    }
  }

  // Одиночная реплика в подблоке: пробуем Mode B как последний шаг (если хватает лимита)
  if (!budgetExhaustedNote && primaryMode === "A") {
    const modeBCost = estimateAttemptTtsCost(subTurns, "B");
    if (canSpendExtraTts(modeBCost)) {
      consumeExtraTts(modeBCost);
      retriesUsed += 1;
      attemptCounter += 1;
      const modeBAttempt = await runSingleSubBlockAttempt(ai, {
        subTurns,
        speakerMap,
        uniqueSpeakers,
        forceMode: "B",
        attemptNumber: attemptCounter,
        stage: "mode_b",
        startingCompletedBlocks,
        blocksCompletedSoFar,
        totalProjectBlocks,
      });
      accumulate(modeBAttempt);
      if (modeBAttempt.qaEval.passed) {
        const mp = modeBAttempt.clips.map((c) => c.pcm);
        const mm = modeBAttempt.clips.map((c) => c.method);
        saveCachedBlockPcmsV3(cacheHash, mp, mm, "retried");
        return {
          pcms: mp,
          methods: mm,
          qas: subTurns.map(() => "retried"),
          qaReasons: subTurns.map(() => `Исправлено в режиме 1 голос/запрос (${firstFailureSummary})`),
          ttsCalls: totalTts,
          transcribeCalls: totalTranscribe,
          retriesUsed,
          providers,
        };
      }
      if (modeBAttempt.qaEval.reasons.length <= bestFallbackAttempt.qaEval.reasons.length) {
        bestFallbackAttempt = modeBAttempt;
      }
    } else {
      budgetExhaustedNote = `retry_budget_exhausted (${retryBudget.extraTtsUsed}/${retryBudget.extraTtsLimit})`;
    }
  }

  // Провал всех шагов или исчерпание лимита переделок: НИКОГДА не кэшируем!
  const baseFailReason = bestFallbackAttempt.qaEval.reasons.join("; ") || firstFailureSummary;
  const finalFailReason = budgetExhaustedNote
    ? `${baseFailReason}; ${budgetExhaustedNote}`
    : baseFailReason;
  return {
    pcms: bestFallbackAttempt.clips.map((c) => c.pcm),
    methods: bestFallbackAttempt.clips.map((c) => c.method),
    qas: subTurns.map(() => "failed"),
    qaReasons: subTurns.map(() => finalFailReason),
    ttsCalls: totalTts,
    transcribeCalls: totalTranscribe,
    retriesUsed,
    providers,
  };
}

// =========================================================================
// MAIN BATCH ENTRY POINT
// =========================================================================

export async function synthesizeDialogueInMacroBlocks(
  ai: GoogleGenAI,
  params: {
    turns: BatchInputTurn[];
    speakerMap: Map<string, ResolvedBatchSpeaker>;
    strictTimeWindow: boolean;
    startingCompletedBlocks?: number;
    totalProjectBlocks?: number;
    totalProjectSubBlocks?: number;
    maxExtraTtsCalls?: number;
    bypassCache?: boolean;
  }
): Promise<BatchDialogueExecutionResult> {
  const { turns, speakerMap, strictTimeWindow, bypassCache = false } = params;
  const uniqueSpeakers = Array.from(speakerMap.values());
  const usesClonedVoice = uniqueSpeakers.some((s) => s.isCloned);
  const canUseModeA = !usesClonedVoice && uniqueSpeakers.length <= 2 && uniqueSpeakers.length >= 1;

  // Если клиент уже разбил ПОЛНЫЙ сценарий через planDialogueSubBlocks и передал plannedSubBlockIndex,
  // сохраняем точные границы подблоков полного сценария (иначе планируем здесь же).
  const hasExplicitSubBlockPlan =
    turns.length > 0 &&
    turns.every(
      (t) => typeof t.plannedSubBlockIndex === "number" && Number.isFinite(t.plannedSubBlockIndex)
    );

  const plannedSubBlocks: Array<{
    globalSubBlockIndex: number;
    startTimecode: string;
    endTimecode: string;
    turns: BatchInputTurn[];
  }> = [];

  if (hasExplicitSubBlockPlan) {
    const formatTc = (sec?: number): string => {
      if (typeof sec !== "number" || !Number.isFinite(sec) || sec < 0) return "00:00";
      const total = Math.round(sec);
      const mins = Math.floor(total / 60);
      const secs = total % 60;
      return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    };
    let currentIdx: number | null = null;
    let currentTurns: BatchInputTurn[] = [];
    const flushExplicit = () => {
      if (currentTurns.length === 0 || currentIdx === null) return;
      plannedSubBlocks.push({
        globalSubBlockIndex: currentIdx,
        startTimecode: formatTc(currentTurns[0]?.startSec),
        endTimecode: formatTc(currentTurns[currentTurns.length - 1]?.endSec ?? currentTurns[currentTurns.length - 1]?.startSec),
        turns: currentTurns,
      });
      currentTurns = [];
    };
    for (const t of turns) {
      const idx = Number(t.plannedSubBlockIndex);
      if (currentIdx !== null && idx !== currentIdx) {
        flushExplicit();
      }
      currentIdx = idx;
      currentTurns.push(t);
    }
    flushExplicit();
  } else {
    const autoPlanned = planDialogueSubBlocks(turns, {
      maxTurns: 8,
      maxWindowSec: 40,
      macroBlockOptions: {
        targetSize: 22,
        minSize: 12,
        maxSize: 25,
        minPauseSec: 0.5,
        maxInputTokens: 5800,
      },
    });
    const startingBase = params.startingCompletedBlocks || 0;
    for (let i = 0; i < autoPlanned.length; i++) {
      plannedSubBlocks.push({
        globalSubBlockIndex: startingBase + i,
        startTimecode: autoPlanned[i].startTimecode,
        endTimecode: autoPlanned[i].endTimecode,
        turns: autoPlanned[i].turns,
      });
    }
  }

  const totalProjectBlocks = Math.max(
    plannedSubBlocks.length,
    params.totalProjectSubBlocks || params.totalProjectBlocks || plannedSubBlocks.length
  );
  const startingCompleted = params.startingCompletedBlocks || 0;

  // Лимит переделок: лишних вызовов TTS строго не больше 25% от числа подблоков
  const extraTtsLimit =
    typeof params.maxExtraTtsCalls === "number" && Number.isFinite(params.maxExtraTtsCalls)
      ? Math.max(0, Math.floor(params.maxExtraTtsCalls))
      : Math.floor(totalProjectBlocks * 0.25);

  const retryBudget: RetryBudgetTracker = {
    extraTtsUsed: 0,
    extraTtsLimit,
  };

  const finalResults: BatchSynthesizedTurnResult[] = [];
  const failedSubBlocks: FailedSubBlockSummary[] = [];
  let totalTtsCalls = 0;
  let totalTranscribeCalls = 0;
  let totalRetriesUsed = 0;
  const providersUsed = new Set<"google" | "kie.ai" | "cache" | "fake">();
  let subBlocksCompleted = 0;
  let quotaPaused = false;
  let quotaPauseMessageRu: string | undefined;
  let runningEffectiveEndSec = 0;
  let globalTurnCounter = 0;

  for (let sbIdx = 0; sbIdx < plannedSubBlocks.length; sbIdx++) {
    const plannedSb = plannedSubBlocks[sbIdx];
    const subTurns = plannedSb.turns;

    const subRes = await executeSubBlockWithQaAndEscalation(ai, {
      subTurns,
      speakerMap,
      uniqueSpeakers,
      canUseModeA,
      bypassCache,
      startingCompletedBlocks: startingCompleted,
      blocksCompletedSoFar: subBlocksCompleted,
      totalProjectBlocks,
      retryBudget,
    });

    totalTtsCalls += subRes.ttsCalls;
    totalTranscribeCalls += subRes.transcribeCalls;
    totalRetriesUsed += subRes.retriesUsed;
    for (const p of subRes.providers) providersUsed.add(p);

    if (subRes.quotaPaused) {
      quotaPaused = true;
      quotaPauseMessageRu = subRes.quotaPauseMessageRu;
      break;
    }

    if (subRes.qas.some((q) => q === "failed")) {
      const uniqReasons = Array.from(
        new Set(subRes.qaReasons.filter((r): r is string => Boolean(r && r.trim())))
      );
      failedSubBlocks.push({
        subBlockIndex: plannedSb.globalSubBlockIndex,
        startTimecode: plannedSb.startTimecode,
        endTimecode: plannedSb.endTimecode,
        turnIds: subTurns.map((t) => t.id),
        reasons: uniqReasons.length > 0 ? uniqReasons : ["qa_failed"],
      });
    }

    for (let i = 0; i < subTurns.length; i++) {
      const turn = subTurns[i];
      const rawPcm = subRes.pcms[i] || Buffer.alloc(24000, 0);
      const origStart = typeof turn.startSec === "number" ? turn.startSec : 0;
      const incomingShiftSec =
        strictTimeWindow && globalTurnCounter > 0
          ? Math.max(0, runningEffectiveEndSec + 0.08 - origStart)
          : 0;
      const fitted = await fitSlicedTurnToTimecode(
        rawPcm,
        turn,
        strictTimeWindow,
        incomingShiftSec
      );
      const effectiveStart =
        strictTimeWindow && globalTurnCounter > 0
          ? Math.max(origStart, runningEffectiveEndSec + 0.08)
          : origStart;
      runningEffectiveEndSec = effectiveStart + fitted.dubbedDurationSec;
      globalTurnCounter += 1;

      const wavBuf = buildWav24k(fitted.pcm);

      finalResults.push({
        index: turn.index,
        id: turn.id,
        speakerId: turn.speakerId,
        speakerName: turn.speakerName,
        text: turn.text,
        pcm: fitted.pcm,
        wavBase64: wavBuf.toString("base64"),
        durationSec: fitted.dubbedDurationSec,
        originalDurationSec: fitted.originalDurationSec,
        dubbedDurationSec: fitted.dubbedDurationSec,
        atempoApplied: fitted.atempoApplied,
        rephraseAttempts: 0,
        fitStepApplied: fitted.fitStepApplied,
        syncStatus: fitted.syncStatus,
        slicingMethod: subRes.methods[i] || "batch",
        qa: subRes.qas[i] || "ok",
        qaReason: subRes.qaReasons[i],
        needsShorten: fitted.needsShorten,
        subBlockIndex: plannedSb.globalSubBlockIndex,
      });
    }

    subBlocksCompleted += 1;
  }

  let okCount = 0;
  let adjustedCount = 0;
  let overflowCount = 0;
  let qaOk = 0;
  let qaRetried = 0;
  let qaFailed = 0;
  let needsShortenCount = 0;
  for (const r of finalResults) {
    if (r.syncStatus === "overflow") overflowCount++;
    else if (r.syncStatus === "adjusted") adjustedCount++;
    else okCount++;

    if (r.qa === "failed") qaFailed++;
    else if (r.qa === "retried") qaRetried++;
    else qaOk++;

    if (r.needsShorten) needsShortenCount++;
  }

  const providerSummary: BatchDialogueExecutionResult["provider"] =
    providersUsed.size === 0
      ? "cache"
      : providersUsed.size === 1
        ? Array.from(providersUsed)[0]
        : "mixed";

  const quota = getTtsQuotaStatus();

  return {
    turns: finalResults,
    ttsCallsUsed: totalTtsCalls,
    transcribeCallsUsed: totalTranscribeCalls,
    extraTtsCallsUsed: retryBudget.extraTtsUsed,
    extraTtsBudget: retryBudget.extraTtsLimit,
    provider: providerSummary,
    modeUsed:
      providerSummary === "cache"
        ? "cache"
        : providerSummary === "fake"
          ? "fake"
          : canUseModeA
            ? "mode_a_multispeaker"
            : "mode_b_per_speaker",
    blocksTotal: plannedSubBlocks.length,
    blocksCompleted: subBlocksCompleted,
    subBlocksTotal: plannedSubBlocks.length,
    subBlocksCompleted,
    retriesUsed: totalRetriesUsed,
    failedSubBlocks,
    quotaPaused,
    quotaPauseMessageRu,
    stats: {
      ok: okCount,
      adjusted: adjustedCount,
      overflow: overflowCount,
      qaOk,
      qaRetried,
      qaFailed,
      needsShorten: needsShortenCount,
    },
    quotaRemaining: quota.remaining,
    quotaLimit: quota.limit,
  };
}
