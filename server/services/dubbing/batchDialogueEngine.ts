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
  sliceBatchPcmByVad,
  alignBatchAudioViaTranscribe,
  transcribePlainTextForQa,
  applyTailFadeOut,
  applyMicroEdgeFades,
  trimSilenceEdgesPcm,
  isFakeDubbingTtsEnabled,
  generateSyntheticTurnPcm,
  generateSyntheticBlockPcm,
  PCM_BYTES_PER_SEC,
  type SlicedTurnClip,
} from "./batchAudioSlicer.ts";
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
export const DUBBING_PROMPT_VERSION = "v2_no_short_pause_pace_qa";

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

export interface BatchDialogueExecutionResult {
  turns: BatchSynthesizedTurnResult[];
  ttsCallsUsed: number;
  transcribeCallsUsed: number;
  provider: "google" | "kie.ai" | "cache" | "fake" | "mixed";
  modeUsed: "mode_a_multispeaker" | "mode_b_per_speaker" | "cache" | "fake";
  blocksTotal: number;
  blocksCompleted: number;
  subBlocksTotal: number;
  subBlocksCompleted: number;
  retriesUsed: number;
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
  durationMultiplier?: number;
  perTurnDurationMultipliers?: number[];
  forceMethod?: string;
  omitLastTurnInAudio?: boolean;
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
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
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
 * Этап 1: Подсказка темпа по плотности окна (слоги / (endSec - startSec)):
 * - >= 5.5 (или forceFastPace) -> "fast, brisk dubbing pace, no pauses inside or after the sentence"
 * - 4.5–5.5 -> "lively natural conversational pace"
 * - < 4.5 -> "relaxed natural pace"
 * Всегда добавляет: "Say the line exactly once, word for word."
 */
export function buildTurnPaceDirective(
  turn: { cleanSpeechText: string; startSec?: number; endSec?: number; forceFastPace?: boolean },
  forceFastPace?: boolean
): string {
  const density = computeTurnSyllableDensity(turn.cleanSpeechText, turn.startSec, turn.endSec);
  const paceHint =
    forceFastPace || turn.forceFastPace || density >= 5.5
      ? "fast, brisk dubbing pace, no pauses inside or after the sentence"
      : density >= 4.5
        ? "lively natural conversational pace"
        : "relaxed natural pace";
  return `${paceHint}. Say the line exactly once, word for word.`;
}

export function buildCleanTurnStyleForTts(
  turn: BatchInputTurn,
  extraContext?: string,
  forceFastPace?: boolean
): string {
  const baseStyle = stripLegacyStylePauseDirective(turn.style || "");
  const pace = buildTurnPaceDirective(turn, forceFastPace);
  return [baseStyle, extraContext ? stripLegacyStylePauseDirective(extraContext) : "", pace]
    .filter(Boolean)
    .join(". ");
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
// STAGE 3: CACHE v2 (KEYED BY TEXT, VOICE, STYLE, COMPOSITION, PROMPT VERSION)
// =========================================================================

const DISALLOWED_CACHE_METHODS = new Set([
  "vad_dp_soft",
  "proportional_energy_cut",
  "failed",
]);

export function computeSubBlockCacheHash(
  subBlockTurns: BatchInputTurn[],
  speakerMap: Map<string, ResolvedBatchSpeaker>,
  mode: "A" | "B"
): string {
  const payload = {
    v: 2,
    promptVersion: DUBBING_PROMPT_VERSION,
    mode,
    turns: subBlockTurns.map((t) => {
      const sp = speakerMap.get(t.speakerId);
      return {
        id: t.id,
        text: stripLegacyPauseArtifacts(t.cleanSpeechText),
        voice: sp?.isCloned ? sp.voiceId || "cloned" : sp?.baseVoice || "Charon",
        style: buildCleanTurnStyleForTts(t),
      };
    }),
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 24);
}

interface CachedBlockEntryV2 {
  v: 2;
  promptVersion: string;
  qa: TurnQaStatus;
  methods: string[];
  savedAt: string;
  clips: string[];
}

function loadCachedBlockPcmsV2(
  hash: string,
  expectedCount: number
): { pcms: Buffer[]; methods: string[]; qa: TurnQaStatus } | null {
  try {
    const metaPath = path.join(BLOCK_CACHE_DIR, `${hash}.json`);
    if (!fs.existsSync(metaPath)) return null;
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as Partial<CachedBlockEntryV2>;
    // Строго только кэш v2 с пройденной QA и чистой нарезкой
    if (meta?.v !== 2 || meta?.promptVersion !== DUBBING_PROMPT_VERSION) return null;
    if (meta.qa !== "ok" && meta.qa !== "retried") return null;
    if (!Array.isArray(meta.clips) || meta.clips.length !== expectedCount) return null;
    const methods = Array.isArray(meta.methods) && meta.methods.length === expectedCount
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

function saveCachedBlockPcmsV2(
  hash: string,
  pcms: Buffer[],
  methods: string[],
  qa: TurnQaStatus
): boolean {
  if (!canSaveSubBlockToCache(qa, methods)) return false;
  try {
    ensureBlockCacheDir();
    const metaPath = path.join(BLOCK_CACHE_DIR, `${hash}.json`);
    const entry: CachedBlockEntryV2 = {
      v: 2,
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

export function tokenizeForQa(text: string): string[] {
  const cleaned = String(text || "")
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/[‘’`´']/g, "'")
    .replace(/[^a-z0-9а-яёўқғҳ'-]+/gi, " ")
    .trim();
  if (!cleaned) return [];
  return cleaned
    .split(/\s+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, ""))
    .filter(Boolean);
}

/**
 * Этап 2: Полная проверка подблока перед кэшированием и возвратом клиенту:
 * 1. Бесплатные проверки длительности и порядка:
 *    - суммарная длина речи подблока / (sum(syllables)/4.8) в [0.7, 1.35]
 *    - каждая нарезанная реплика / (syllables/4.8) в [0.6, 1.6]
 *    - клипы идут строго по порядку и без перекрытий (startMs >= prevEndMs)
 *    - отсутствие ненадёжных методов нарезки (vad_dp_soft, proportional_energy_cut)
 * 2. Проверка по тексту транскрипции (1 вызов gemini-3.5-transcribe):
 *    - отношение числа слов к ожидаемому в [0.8, 1.2] (>1.2 повтор, <0.8 пропуск)
 *    - повторы, которые реально есть в сценарии подблока, браком не считаются
 *    - присутствие "short", "pause" или посторонних английских слов, которых нет в тексте -> брак
 */
export function evaluateSubBlockQa(params: {
  expectedTurns: BatchInputTurn[];
  slicedClips: Array<{
    pcm: Buffer;
    startMs: number;
    endMs: number;
    durationSec: number;
    method: string;
  }>;
  transcriptText?: string;
}): SubBlockQaEvaluation {
  const { expectedTurns, slicedClips, transcriptText } = params;
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

  // 1. Проверка методов нарезки
  for (let i = 0; i < slicedClips.length; i++) {
    const m = slicedClips[i].method;
    if (DISALLOWED_CACHE_METHODS.has(m)) {
      if (!badMethods.includes(m)) badMethods.push(m);
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
  let expectedBlockSec = 0;
  let actualBlockSpeechSec = 0;

  for (let i = 0; i < expectedTurns.length; i++) {
    const cleanText = stripLegacyPauseArtifacts(expectedTurns[i].cleanSpeechText);
    const syl = Math.max(1, countSyllables(cleanText));
    const expectedTurnSec = Math.max(0.35, syl / 4.8);
    const actualTurnSec = Math.max(0, slicedClips[i].pcm.length / PCM_BYTES_PER_SEC);
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

  const blockDurationRatio =
    Math.round((actualBlockSpeechSec / Math.max(0.35, expectedBlockSec)) * 100) / 100;
  if (blockDurationRatio < 0.7 || blockDurationRatio > 1.35) {
    reasons.push(
      `block_duration_ratio (${actualBlockSpeechSec.toFixed(2)}s vs exp ${expectedBlockSec.toFixed(2)}s, ratio=${blockDurationRatio.toFixed(2)})`
    );
  }

  // 4. Проверка транскрипции (слова, повторы, пропуски, "short pause" / английский мусор)
  let transcriptWordRatio: number | undefined;
  let englishLeakTokens: string[] | undefined;

  if (typeof transcriptText === "string") {
    const expectedJoined = expectedTurns
      .map((t) => stripLegacyPauseArtifacts(t.cleanSpeechText))
      .join(" ");
    const expectedTokens = tokenizeForQa(expectedJoined);
    const actualTokens = tokenizeForQa(transcriptText);

    const expectedTokenSet = new Set(expectedTokens);

    if (expectedTokens.length > 0) {
      if (actualTokens.length === 0) {
        transcriptWordRatio = 0;
        reasons.push("empty_transcript");
      } else {
        transcriptWordRatio = Math.round((actualTokens.length / expectedTokens.length) * 100) / 100;
        if (transcriptWordRatio > 1.2) {
          // Убеждаемся, что избыточные слова действительно превышают ожидаемые частоты сценария
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
    transcriptText,
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

async function sliceBlockAudioIntoTurns(
  ai: GoogleGenAI,
  blockPcm: Buffer,
  turns: BatchInputTurn[],
  speakerMap: Map<string, ResolvedBatchSpeaker>
): Promise<{
  clips: Array<{
    pcm: Buffer;
    startMs: number;
    endMs: number;
    durationSec: number;
    method: string;
  }>;
  transcribeCalls: number;
  recoveryTtsCalls: number;
  heardTranscript?: string;
}> {
  if (turns.length === 1) {
    const clean = applyMicroEdgeFades(trimSilenceEdgesPcm(blockPcm, 25), 6);
    const durSec = Math.round((clean.length / PCM_BYTES_PER_SEC) * 100) / 100;
    return {
      clips: [
        {
          pcm: clean,
          startMs: 0,
          endMs: Math.max(100, Math.round(durSec * 1000)),
          durationSec: durSec,
          method: "single_in_block",
        },
      ],
      transcribeCalls: 0,
      recoveryTtsCalls: 0,
    };
  }

  // 1. Детектор тишины (VAD)
  const vad = sliceBatchPcmByVad(
    blockPcm,
    turns.map((t) => stripLegacyPauseArtifacts(t.cleanSpeechText)),
    { minSilenceMs: 280 }
  );

  if (vad.reliable && vad.clips.length === turns.length) {
    return {
      clips: vad.clips.map((c) => ({
        pcm: c.pcm,
        startMs: c.startMs,
        endMs: c.endMs,
        durationSec: c.durationSec,
        method: c.method,
      })),
      transcribeCalls: 0,
      recoveryTtsCalls: 0,
    };
  }

  // 2. Fallback на gemini-3.5-transcribe (0 вызовов TTS!)
  const aligned = await alignBatchAudioViaTranscribe(
    ai,
    blockPcm,
    turns.map((t, i) => ({
      index: i,
      speaker: t.speakerName,
      text: stripLegacyPauseArtifacts(t.cleanSpeechText),
    })),
    DUBBING_MODELS_CONFIG.transcribeModel
  );

  const transcribeCalls = isFakeDubbingTtsEnabled() ? 0 : 1;
  let recoveryTtsCalls = 0;

  if (aligned.clips.length === turns.length && aligned.missingIndices.length <= 3) {
    const clips: Array<{
      pcm: Buffer;
      startMs: number;
      endMs: number;
      durationSec: number;
      method: string;
    }> = [];
    let cursorMs = 0;
    for (let i = 0; i < turns.length; i++) {
      const clip: SlicedTurnClip | null = aligned.clips[i];
      if (clip) {
        const sMs = Math.max(cursorMs, clip.startMs);
        const eMs = Math.max(sMs + 100, clip.endMs);
        clips.push({
          pcm: clip.pcm,
          startMs: sMs,
          endMs: eMs,
          durationSec: clip.durationSec,
          method: clip.method,
        });
        cursorMs = eMs;
      } else {
        const sp = speakerMap.get(turns[i].speakerId)!;
        const singleRes = await synthesizeMissingSingleTurnPcm(ai, turns[i], sp);
        if (!isFakeDubbingTtsEnabled()) recoveryTtsCalls += 1;
        const durSec = Math.round((singleRes.pcm.length / PCM_BYTES_PER_SEC) * 100) / 100;
        const sMs = cursorMs;
        const eMs = sMs + Math.max(100, Math.round(durSec * 1000));
        clips.push({
          pcm: singleRes.pcm,
          startMs: sMs,
          endMs: eMs,
          durationSec: durSec,
          method: "single_recovery",
        });
        cursorMs = eMs;
      }
    }
    return { clips, transcribeCalls, recoveryTtsCalls, heardTranscript: aligned.heardTranscript };
  }

  if (vad.clips.length === turns.length) {
    return {
      clips: vad.clips.map((c) => ({
        pcm: c.pcm,
        startMs: c.startMs,
        endMs: c.endMs,
        durationSec: c.durationSec,
        method: "vad_dp_soft",
      })),
      transcribeCalls,
      recoveryTtsCalls,
      heardTranscript: aligned.heardTranscript,
    };
  }

  const weights = turns.map((t) => Math.max(4, stripLegacyPauseArtifacts(t.cleanSpeechText).length));
  const totalW = weights.reduce((a, b) => a + b, 0);
  const totalSamples = Math.floor(blockPcm.length / 2);
  const clips: Array<{
    pcm: Buffer;
    startMs: number;
    endMs: number;
    durationSec: number;
    method: string;
  }> = [];
  let accW = 0;
  let prevSample = 0;
  for (let i = 0; i < turns.length; i++) {
    accW += weights[i];
    const endSample =
      i === turns.length - 1
        ? totalSamples
        : Math.min(totalSamples, Math.round((accW / totalW) * totalSamples));
    const safeEndSample = Math.max(prevSample + 480, endSample);
    const rawSlice = blockPcm.subarray(prevSample * 2, Math.min(totalSamples, safeEndSample) * 2);
    const clean = applyMicroEdgeFades(trimSilenceEdgesPcm(rawSlice, 20), 6);
    clips.push({
      pcm: clean,
      startMs: Math.round((prevSample / 24000) * 1000),
      endMs: Math.round((Math.min(totalSamples, safeEndSample) / 24000) * 1000),
      durationSec: Math.round((clean.length / PCM_BYTES_PER_SEC) * 100) / 100,
      method: "proportional_energy_cut",
    });
    prevSample = endSample;
  }

  return { clips, transcribeCalls, recoveryTtsCalls };
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
      blockPcm = generateSyntheticBlockPcm(fakeTurns, 0.45).pcm;
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

    const sliced = await sliceBlockAudioIntoTurns(ai, blockPcm, subTurns, speakerMap);
    transcribeCalls += sliced.transcribeCalls;
    ttsCalls += sliced.recoveryTtsCalls;

    const clips = sliced.clips.map((c) =>
      injectedFault?.forceMethod ? { ...c, method: injectedFault.forceMethod } : c
    );

    // Строго не больше 1 вызова gemini-3.5-transcribe на подблок:
    // если transcribe-выравнивание уже вернуло распознанный текст, переиспользуем его без 2-го вызова!
    let transcriptText: string;
    if (injectedFault?.overrideTranscript !== undefined) {
      transcriptText = injectedFault.overrideTranscript;
    } else if (sliced.heardTranscript && sliced.heardTranscript.trim().length > 0) {
      transcriptText = sliced.heardTranscript;
    } else {
      const qaTx = await transcribePlainTextForQa(
        ai,
        blockPcm,
        subTurns.map((t, i) => ({
          index: i,
          speaker: t.speakerName,
          text: stripLegacyPauseArtifacts(t.cleanSpeechText),
        })),
        DUBBING_MODELS_CONFIG.transcribeModel
      );
      if (qaTx.usedApiCall) transcribeCalls += 1;
      transcriptText = qaTx.text;
    }

    const qaEval = evaluateSubBlockQa({
      expectedTurns: subTurns,
      slicedClips: clips,
      transcriptText,
    });

    return { clips, qaEval, ttsCalls, transcribeCalls, providers };
  }

  // =========================================================================
  // MODE B: 1 вызов на каждого спикера в подблоке
  // =========================================================================
  const perSpeakerIndices = new Map<string, number[]>();
  subTurns.forEach((t, localIdx) => {
    const list = perSpeakerIndices.get(t.speakerId) || [];
    list.push(localIdx);
    perSpeakerIndices.set(t.speakerId, list);
  });

  const assembledClips = new Array<{
    pcm: Buffer;
    startMs: number;
    endMs: number;
    durationSec: number;
    method: string;
  }>(subTurns.length);

  const qaPcmParts: Buffer[] = [];
  const qaExpectedOrder: BatchInputTurn[] = [];
  const silenceGap200ms = Buffer.alloc(Math.round(0.2 * PCM_BYTES_PER_SEC), 0);

  for (const [spId, localIndices] of perSpeakerIndices.entries()) {
    const sp = speakerMap.get(spId)!;
    const spTurns = localIndices.map((idx) => subTurns[idx]);

    const parts = spTurns.map((t, j) => {
      const prevGlobalIdx = localIndices[j] - 1;
      const prevTurn = prevGlobalIdx >= 0 ? subTurns[prevGlobalIdx] : null;
      const contextHint = prevTurn
        ? `Responding naturally to ${prevTurn.speakerName}`
        : `Opening line of dialogue`;
      return {
        text: stripLegacyPauseArtifacts(t.cleanSpeechText),
        speechMetadata: {
          ...(sp.isCloned ? {} : { speaker: sp.baseVoice || "Charon" }),
          style: buildCleanTurnStyleForTts(t, contextHint),
        },
      };
    });

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
      spBlockPcm = generateSyntheticBlockPcm(fakeTurns, 0.45).pcm;
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

    qaPcmParts.push(spBlockPcm, silenceGap200ms);
    qaExpectedOrder.push(...spTurns);

    const sliced = await sliceBlockAudioIntoTurns(ai, spBlockPcm, spTurns, speakerMap);
    transcribeCalls += sliced.transcribeCalls;
    ttsCalls += sliced.recoveryTtsCalls;

    localIndices.forEach((origLocalIdx, k) => {
      const c = sliced.clips[k];
      assembledClips[origLocalIdx] = injectedFault?.forceMethod
        ? { ...c, method: injectedFault.forceMethod }
        : c;
    });
  }

  // Нормализуем монотонные startMs/endMs в порядке сценария (каждый спикер нарезался из своего PCM)
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

  // 1 вызов gemini-3.5-transcribe для QA всего подблока (сырой звук по спикерам в том же порядке)
  let transcriptText: string;
  if (injectedFault?.overrideTranscript !== undefined) {
    transcriptText = injectedFault.overrideTranscript;
  } else {
    const qaTx = await transcribePlainTextForQa(
      ai,
      Buffer.concat(qaPcmParts),
      qaExpectedOrder.map((t, i) => ({
        index: i,
        speaker: t.speakerName,
        text: stripLegacyPauseArtifacts(t.cleanSpeechText),
      })),
      DUBBING_MODELS_CONFIG.transcribeModel
    );
    if (qaTx.usedApiCall) transcribeCalls += 1;
    transcriptText = qaTx.text;
  }

  // Оцениваем длительности/методы по orderedClips + транскрипцию по qaExpectedOrder (тот же мультисет слов!)
  const qaEval = evaluateSubBlockQa({
    expectedTurns: subTurns,
    slicedClips: orderedClips,
    transcriptText,
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

/**
 * Этап 2 + Этап 3: Синтез одного подблока с кэшем v2, QA и каскадом восстановления:
 * 1. Кэш v2 (если !bypassCache);
 * 2. Попытка 1 (Mode A или Mode B);
 * 3. При провале QA -> Попытка 2 (перегенерация подблока 1 раз);
 * 4. При провале -> Попытка 3 (разбить подблок пополам и проверить каждую половину);
 * 5. При провале -> Попытка 4 (Mode B: по 1 спикеру на запрос);
 * 6. При провале -> вернуть с qa="failed" и явной причиной qaReason, в кэш НЕ писать!
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
  } = params;

  const primaryMode: "A" | "B" = canUseModeA ? "A" : "B";
  const cacheHash = computeSubBlockCacheHash(subTurns, speakerMap, primaryMode);

  if (!bypassCache) {
    const cached = loadCachedBlockPcmsV2(cacheHash, subTurns.length);
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

  // --- ПОПЫТКА 1: Основная ---
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
    saveCachedBlockPcmsV2(cacheHash, pcms, methods, "ok");
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

  // --- ПОПЫТКА 2: Перегенерировать подблок 1 раз ---
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
    saveCachedBlockPcmsV2(cacheHash, pcms, methods, "retried");
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

  // --- ПОПЫТКА 3: Разбить подблок пополам (если >= 2 реплик) ---
  if (subTurns.length >= 2) {
    retriesUsed += 1;
    const splitIdx = chooseSmartHalfSplitIndex(subTurns);
    const halves = [subTurns.slice(0, splitIdx), subTurns.slice(splitIdx)];
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
        const halfHash = computeSubBlockCacheHash(halfTurns, speakerMap, primaryMode);
        saveCachedBlockPcmsV2(halfHash, hp, hm, "retried");
        halfPcms.push(...hp);
        halfMethods.push(...hm);
        halfQas.push(...halfTurns.map(() => "retried" as TurnQaStatus));
        halfReasons.push(
          ...halfTurns.map(() => `Исправлено делением пополам (${firstFailureSummary})`)
        );
      } else {
        // --- ПОПЫТКА 4 (для провалившейся половины): Mode B (по 1 голосу на запрос) ---
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
          const halfHashB = computeSubBlockCacheHash(halfTurns, speakerMap, "B");
          saveCachedBlockPcmsV2(halfHashB, mp, mm, "retried");
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
      // Весь подблок прошёл QA после деления / Mode B — можно кэшировать чистый результат подблока
      saveCachedBlockPcmsV2(cacheHash, halfPcms, halfMethods, "retried");
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

  // Одиночная реплика в подблоке: пробуем Mode B как последний шаг
  if (primaryMode === "A") {
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
      saveCachedBlockPcmsV2(cacheHash, mp, mm, "retried");
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
  }

  // Провал всех шагов: НИКОГДА не молчим и НИКОГДА не кэшируем!
  const finalFailReason = bestFallbackAttempt.qaEval.reasons.join("; ") || firstFailureSummary;
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
    bypassCache?: boolean;
  }
): Promise<BatchDialogueExecutionResult> {
  const { turns, speakerMap, strictTimeWindow, bypassCache = false } = params;
  const uniqueSpeakers = Array.from(speakerMap.values());
  const usesClonedVoice = uniqueSpeakers.some((s) => s.isCloned);
  const canUseModeA = !usesClonedVoice && uniqueSpeakers.length <= 2 && uniqueSpeakers.length >= 1;

  // Этап 1: Нарезаем внутри блоков сцен на подблоки <= 8 реплик И <= 40 с суммарной длины окон
  const plannedSubBlocks = planDialogueSubBlocks(turns, {
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

  const totalProjectBlocks = Math.max(
    plannedSubBlocks.length,
    params.totalProjectBlocks || plannedSubBlocks.length
  );
  const startingCompleted = params.startingCompletedBlocks || 0;

  const finalResults: BatchSynthesizedTurnResult[] = [];
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
    const subTurns = plannedSubBlocks[sbIdx].turns;

    const subRes = await executeSubBlockWithQaAndEscalation(ai, {
      subTurns,
      speakerMap,
      uniqueSpeakers,
      canUseModeA,
      bypassCache,
      startingCompletedBlocks: startingCompleted,
      blocksCompletedSoFar: subBlocksCompleted,
      totalProjectBlocks,
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
        subBlockIndex: sbIdx,
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
