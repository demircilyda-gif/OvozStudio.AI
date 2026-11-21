import crypto from "crypto";
import fs from "fs";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import { DUBBING_MODELS_CONFIG } from "../../config/dubbingModels.ts";
import { normalizeUzbekSpeech } from "../../../src/utils/uzbekNormalizer.ts";
import {
  extractRawPcm24k,
  buildWav24k,
  sliceBatchPcmByVad,
  alignBatchAudioViaTranscribe,
  applyTailFadeOut,
  applyMicroEdgeFades,
  trimSilenceEdgesPcm,
  PCM_BYTES_PER_SEC,
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

function ensureBlockCacheDir() {
  if (!fs.existsSync(BLOCK_CACHE_DIR)) {
    fs.mkdirSync(BLOCK_CACHE_DIR, { recursive: true });
  }
}

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
  inlineTags?: string[];
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
}

export interface BatchDialogueExecutionResult {
  turns: BatchSynthesizedTurnResult[];
  ttsCallsUsed: number;
  transcribeCallsUsed: number;
  provider: "google" | "kie.ai" | "cache" | "mixed";
  modeUsed: "mode_a_multispeaker" | "mode_b_per_speaker" | "cache";
  blocksTotal: number;
  blocksCompleted: number;
  quotaPaused: boolean;
  quotaPauseMessageRu?: string;
  stats: {
    ok: number;
    adjusted: number;
    overflow: number;
  };
  quotaRemaining: number;
  quotaLimit: number;
}

let simulateDubbingGoogle429 = false;
export function setSimulateDubbingGoogle429ForTesting(val: boolean) {
  simulateDubbingGoogle429 = val;
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

/**
 * Раздел 2.2: Группирует реплики в макро-блоки по 20–25 реплик (~2–2.5 мин речи).
 * Граница ставится на длинных паузах и в местах «без слов», а не посреди быстрого обмена репликами.
 * Гарантирует <= ~6 000 входных токенов на блок.
 */
export function splitTurnsIntoMacroBlocks(
  turns: BatchInputTurn[],
  options: { targetSize?: number; minSize?: number; maxSize?: number; maxInputTokens?: number } = {}
): BatchInputTurn[][] {
  if (turns.length === 0) return [];
  const targetSize = options.targetSize ?? 22;
  const minSize = options.minSize ?? 16;
  const maxSize = options.maxSize ?? 25;
  const maxInputTokens = options.maxInputTokens ?? 5800;

  const estimateTurnTokens = (t: BatchInputTurn): number => {
    const chars = (t.cleanSpeechText || t.text || "").length + (t.style || "").length + 45;
    return Math.ceil(chars / 3.0);
  };

  const blocks: BatchInputTurn[][] = [];
  let cursor = 0;

  while (cursor < turns.length) {
    const remaining = turns.length - cursor;
    // Если осталось <= maxSize и вписывается по токенам — берём целиком
    if (remaining <= maxSize) {
      let tokSum = 0;
      let end = cursor;
      while (end < turns.length) {
        const tTok = estimateTurnTokens(turns[end]);
        if (end > cursor && tokSum + tTok > maxInputTokens) break;
        tokSum += tTok;
        end++;
      }
      blocks.push(turns.slice(cursor, end));
      cursor = end;
      continue;
    }

    // Сначала определяем максимально допустимый индекс по токен-бюджету и maxSize
    let maxEnd = cursor;
    let tokSum = 0;
    while (maxEnd < turns.length && maxEnd - cursor < maxSize) {
      const tTok = estimateTurnTokens(turns[maxEnd]);
      if (maxEnd > cursor && tokSum + tTok > maxInputTokens) break;
      tokSum += tTok;
      maxEnd++;
    }

    // Если хвост после разреза окажется слишком коротким (1..5 реплик), балансируем границу раньше
    const preferredMin = Math.min(maxEnd, cursor + minSize);
    let bestCut = Math.min(maxEnd, cursor + targetSize);
    let bestPauseScore = -1;

    // Ищем самую длинную паузу (gapAfterSec) в окне [preferredMin .. maxEnd]
    for (let idx = preferredMin; idx <= maxEnd; idx++) {
      const lastInBlock = turns[idx - 1];
      const nextTurn = turns[idx];
      let gap = typeof lastInBlock.gapAfterSec === "number" ? lastInBlock.gapAfterSec : 0;
      if (
        gap <= 0 &&
        typeof lastInBlock.endSec === "number" &&
        typeof nextTurn?.startSec === "number"
      ) {
        gap = Math.max(0, nextTurn.startSec - lastInBlock.endSec);
      }

      // Небольшой приоритет точкам ближе к targetSize при равных паузах
      const distFromTarget = Math.abs(idx - (cursor + targetSize));
      const score = gap * 10 - distFromTarget * 0.15;
      if (score > bestPauseScore) {
        bestPauseScore = score;
        bestCut = idx;
      }
    }

    if (bestCut <= cursor) {
      bestCut = Math.min(turns.length, cursor + Math.max(1, targetSize));
    }

    blocks.push(turns.slice(cursor, bestCut));
    cursor = bestCut;
  }

  return blocks;
}

/**
 * Прогноз числа вызовов TTS для данного набора реплик и состава голосов (раздел 2.8).
 */
export function estimateDubbingTtsCalls(
  turnCount: number,
  usesClonedVoice: boolean,
  uniqueSpeakersCount: number
): { estimatedCalls: number; blocksCount: number; modeLabel: string } {
  if (turnCount <= 0) return { estimatedCalls: 0, blocksCount: 0, modeLabel: "mode_a" };
  const blocksCount = Math.max(1, Math.ceil(turnCount / 22));
  const isModeA = !usesClonedVoice && uniqueSpeakersCount <= 2;
  const estimatedCalls = isModeA ? blocksCount : blocksCount * Math.max(1, uniqueSpeakersCount);
  return {
    estimatedCalls,
    blocksCount,
    modeLabel: isModeA ? "Mode A (Multi-Speaker)" : "Mode B (Per-Speaker)",
  };
}

function computeBlockCacheHash(payload: any): string {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 24);
}

function loadCachedBlockPcms(hash: string, expectedCount: number): Buffer[] | null {
  try {
    const metaPath = path.join(BLOCK_CACHE_DIR, `${hash}.json`);
    if (!fs.existsSync(metaPath)) return null;
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    if (!Array.isArray(meta?.clips) || meta.clips.length !== expectedCount) return null;
    return meta.clips.map((b64: string) => Buffer.from(b64, "base64"));
  } catch {
    return null;
  }
}

function saveCachedBlockPcms(hash: string, pcms: Buffer[]): void {
  try {
    ensureBlockCacheDir();
    const metaPath = path.join(BLOCK_CACHE_DIR, `${hash}.json`);
    fs.writeFileSync(
      metaPath,
      JSON.stringify({
        savedAt: new Date().toISOString(),
        clips: pcms.map((p) => p.toString("base64")),
      }),
      "utf8"
    );
  } catch {}
}

/**
 * Построение voiceConfig для одиночного спикера (клон или встроенный).
 */
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

/**
 * Точечный досинтез 1–3 невыделенных реплик (раздел 2.5, п.3 — весь блок заново НЕ озвучивается).
 */
async function synthesizeMissingSingleTurnPcm(
  ai: GoogleGenAI,
  turn: BatchInputTurn,
  speaker: ResolvedBatchSpeaker
): Promise<{ pcm: Buffer; provider: "google" | "kie.ai" }> {
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
              text: turn.cleanSpeechText,
              speechMetadata: {
                speaker: speaker.baseVoice || "Charon",
                style: turn.style,
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
      pcm: applyMicroEdgeFades(trimSilenceEdgesPcm(extractRawPcm24k(Buffer.from(b64, "base64")), 25), 6),
      provider: "google",
    };
  } catch (err: any) {
    if (isQuota429Error(err) && !speaker.isCloned) {
      markGoogleTtsQuotaExhaustedToday();
      const kieRes = await synthesizeDialogueBlockViaKieAi([
        {
          speaker: speaker.speakerName,
          voice: speaker.baseVoice || "Charon",
          text: turn.cleanSpeechText,
          style: turn.style,
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

/**
 * Раздел 2.5: Нарезает единый блочный PCM на N реплик (0 вызовов TTS на VAD и gemini-3.5-transcribe).
 * Если 1–3 реплики не удалось выделить, точечно доозвучивает ТОЛЬКО их.
 */
async function sliceBlockAudioIntoTurns(
  ai: GoogleGenAI,
  blockPcm: Buffer,
  turns: BatchInputTurn[],
  speakerMap: Map<string, ResolvedBatchSpeaker>
): Promise<{
  pcms: Buffer[];
  methods: string[];
  transcribeCalls: number;
  recoveryTtsCalls: number;
}> {
  if (turns.length === 1) {
    return {
      pcms: [applyMicroEdgeFades(trimSilenceEdgesPcm(blockPcm, 25), 6)],
      methods: ["single_in_block"],
      transcribeCalls: 0,
      recoveryTtsCalls: 0,
    };
  }

  // 1. Детектор тишины (VAD)
  const vad = sliceBatchPcmByVad(
    blockPcm,
    turns.map((t) => t.cleanSpeechText),
    { minSilenceMs: 320 }
  );

  if (vad.reliable && vad.clips.length === turns.length) {
    return {
      pcms: vad.clips.map((c) => c.pcm),
      methods: vad.clips.map((c) => c.method),
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
      text: t.cleanSpeechText,
    })),
    DUBBING_MODELS_CONFIG.transcribeModel
  );

  let transcribeCalls = 1;
  let recoveryTtsCalls = 0;

  if (aligned.clips.length === turns.length && aligned.missingIndices.length <= 3) {
    const pcms: Buffer[] = [];
    const methods: string[] = [];
    for (let i = 0; i < turns.length; i++) {
      const clip = aligned.clips[i];
      if (clip) {
        pcms.push(clip.pcm);
        methods.push(clip.method);
      } else {
        // 3. Точечный досинтез ТОЛЬКО пропущенной реплики (1–3 шт.)
        const sp = speakerMap.get(turns[i].speakerId)!;
        const singleRes = await synthesizeMissingSingleTurnPcm(ai, turns[i], sp);
        recoveryTtsCalls += 1;
        pcms.push(singleRes.pcm);
        methods.push("single_recovery");
      }
    }
    return { pcms, methods, transcribeCalls, recoveryTtsCalls };
  }

  // Если VAD вернул клипы нужного числа (даже с мягкой оценкой уверенности) — используем их вместо повторного синтеза всего блока
  if (vad.clips.length === turns.length) {
    return {
      pcms: vad.clips.map((c) => c.pcm),
      methods: vad.clips.map(() => "vad_dp_soft"),
      transcribeCalls,
      recoveryTtsCalls,
    };
  }

  // Пропорциональная резервная нарезка по локальным минимумам энергии (никогда не откатывается на 1-вызов-на-реплику!)
  const weights = turns.map((t) => Math.max(4, t.cleanSpeechText.length));
  const totalW = weights.reduce((a, b) => a + b, 0);
  const totalSamples = Math.floor(blockPcm.length / 2);
  const pcms: Buffer[] = [];
  const methods: string[] = [];
  let accW = 0;
  let prevSample = 0;
  for (let i = 0; i < turns.length; i++) {
    accW += weights[i];
    const endSample =
      i === turns.length - 1
        ? totalSamples
        : Math.min(totalSamples, Math.round((accW / totalW) * totalSamples));
    const rawSlice = blockPcm.subarray(prevSample * 2, Math.max(prevSample + 480, endSample) * 2);
    pcms.push(applyMicroEdgeFades(trimSilenceEdgesPcm(rawSlice, 20), 6));
    methods.push("proportional_energy_cut");
    prevSample = endSample;
  }

  return { pcms, methods, transcribeCalls, recoveryTtsCalls };
}

/**
 * Раздел 2.6: Укладка одной реплики в таймкод БЕЗ ОБРЫВА СЛОВ и БЕЗ авто-перефразирования:
 * 1. ffmpeg atempo до 1.10x (единая константа в dubbingModels.ts);
 * 2. Занять паузу после реплики (gapAfterSec);
 * 3. Допустить сдвиг следующей реплики <= 0.3 с (обрабатывается на мастер-таймлайне);
 * 4. Положить целиком + fade-out 120 мс + syncStatus = "overflow".
 */
async function fitSlicedTurnToTimecode(
  rawPcm: Buffer,
  turn: BatchInputTurn,
  strictTimeWindow: boolean
): Promise<{
  pcm: Buffer;
  originalDurationSec: number;
  dubbedDurationSec: number;
  atempoApplied: number;
  fitStepApplied: string;
  syncStatus: TurnSyncStatus;
}> {
  const maxAtempo = DUBBING_MODELS_CONFIG.maxAtempoSpeedRatio || 1.1; // единое 1.10x
  const maxShiftSec = DUBBING_MODELS_CONFIG.maxNextTurnShiftSec || 0.3;
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
    };
  }

  // Доступное окно с учётом паузы после реплики (шаг 2)
  const availableWithGap = Math.max(0.4, windowSec + gapAfterSec - 0.04);
  const availableWithShift = availableWithGap + maxShiftSec;

  let pcm = rawPcm;
  let atempoApplied = 1.0;
  let fitStepApplied = "batch_original";
  let syncStatus: TurnSyncStatus = "ok";

  if (rawDurationSec <= windowSec + 0.05) {
    // Поместилось прямо в собственное окно
    return {
      pcm,
      originalDurationSec: windowSec,
      dubbedDurationSec: Math.round(rawDurationSec * 100) / 100,
      atempoApplied: 1.0,
      fitStepApplied: "batch_original",
      syncStatus: "ok",
    };
  }

  // Шаг 1: Мягкое ускорение ffmpeg atempo до 1.10x
  if (rawDurationSec > availableWithGap) {
    const neededRatio = Math.min(maxAtempo, rawDurationSec / Math.max(0.4, availableWithGap));
    if (neededRatio > 1.008) {
      pcm = await applyMildAtempoPcm(rawPcm, neededRatio, 24000, maxAtempo);
      atempoApplied = Math.round(neededRatio * 100) / 100;
      fitStepApplied = `atempo_${atempoApplied}x`;
      syncStatus = "adjusted";
    }
  } else {
    // Помещается за счёт паузы после реплики (шаг 2)
    fitStepApplied = "used_gap_after";
    syncStatus = "ok";
  }

  const finalDurSec = Math.round((pcm.length / PCM_BYTES_PER_SEC) * 100) / 100;

  if (finalDurSec > availableWithShift) {
    // Шаг 4: Реплика НЕ обрезается посреди слова! Кладём целиком + fade-out 120 мс + syncStatus = "overflow"
    pcm = applyTailFadeOut(pcm, fadeOutMs);
    fitStepApplied = `${fitStepApplied}+overflow_fade120ms`;
    syncStatus = "overflow";
  } else if (finalDurSec > availableWithGap) {
    // Шаг 3: Влезает за счёт сдвига следующей реплики <= 0.3 с
    fitStepApplied = `${fitStepApplied}+shift_next`;
    syncStatus = "adjusted";
  }

  return {
    pcm,
    originalDurationSec: windowSec,
    dubbedDurationSec: finalDurSec,
    atempoApplied,
    fitStepApplied,
    syncStatus,
  };
}

/**
 * Главная функция пакетной озвучки дубляжа (Режим A и Режим B) — разделы 2.2–2.8.
 * - Режим A (2 встроенных голоса): 1 мультиспикерный вызов на блок (20–25 реплик).
 * - Режим B (клонированный голос или 3+ спикеров): 1 вызов на каждого спикера в блоке,
 *   с отдельным стилем на каждую реплику (подтверждено тестом №3 из 2.5!).
 * - Нарезка VAD + gemini-3.5-transcribe (0 вызовов TTS).
 * - Кэш блоков, защита 100 RPD (kie.ai для встроенных / пауза с сохранением блоков для клона).
 */
export async function synthesizeDialogueInMacroBlocks(
  ai: GoogleGenAI,
  params: {
    turns: BatchInputTurn[];
    speakerMap: Map<string, ResolvedBatchSpeaker>;
    strictTimeWindow: boolean;
    startingCompletedBlocks?: number;
    totalProjectBlocks?: number;
  }
): Promise<BatchDialogueExecutionResult> {
  const { turns, speakerMap, strictTimeWindow } = params;
  const uniqueSpeakers = Array.from(speakerMap.values());
  const usesClonedVoice = uniqueSpeakers.some((s) => s.isCloned);
  const canUseModeA = !usesClonedVoice && uniqueSpeakers.length <= 2 && uniqueSpeakers.length >= 1;

  const blocks = splitTurnsIntoMacroBlocks(turns, {
    targetSize: 22,
    minSize: 16,
    maxSize: 25,
    maxInputTokens: 5800,
  });

  const totalProjectBlocks = Math.max(blocks.length, params.totalProjectBlocks || blocks.length);
  const startingCompleted = params.startingCompletedBlocks || 0;

  const finalResults: BatchSynthesizedTurnResult[] = [];
  let totalTtsCalls = 0;
  let totalTranscribeCalls = 0;
  const providersUsed = new Set<"google" | "kie.ai" | "cache">();
  let blocksCompleted = 0;
  let quotaPaused = false;
  let quotaPauseMessageRu: string | undefined;

  for (let bIdx = 0; bIdx < blocks.length; bIdx++) {
    const blockTurns = blocks[bIdx];

    // Ключ кэша блока (текст + голоса + стили + режим)
    const blockHash = computeBlockCacheHash({
      v: 1,
      mode: canUseModeA ? "A" : "B",
      turns: blockTurns.map((t) => {
        const sp = speakerMap.get(t.speakerId);
        return {
          text: t.cleanSpeechText,
          style: t.style,
          voice: sp?.isCloned ? sp.voiceId : sp?.baseVoice,
        };
      }),
    });

    let blockTurnPcms: Buffer[] | null = loadCachedBlockPcms(blockHash, blockTurns.length);
    let blockSliceMethods: string[] = blockTurns.map(() => "cache");

    if (blockTurnPcms) {
      providersUsed.add("cache");
    } else if (canUseModeA) {
      // =====================================================================
      // РЕЖИМ A: 2 встроенных голоса -> 1 мультиспикерный вызов на блок
      // =====================================================================
      const spList = uniqueSpeakers.slice(0, 2);
      // multiSpeakerVoiceConfig требует ровно 2 speakerVoiceConfigs
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

      const parts = blockTurns.map((t) => {
        const isFirst = t.speakerId === sp1.speakerId;
        const speakerTag = isFirst ? tag1 : tag2;
        return {
          text: `${t.cleanSpeechText} <short pause> <short pause>`,
          speechMetadata: {
            speaker: speakerTag,
            style: `${t.style}. End the sentence cleanly with a distinct pause.`,
          },
        };
      });

      let blockPcm: Buffer | null = null;
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
        totalTtsCalls += 1;
        recordGoogleTtsCalls(1);
        providersUsed.add("google");

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
          // Раздел 2.8: при 429 со встроенными голосами тот же блок идёт через kie.ai (dialogue_turns со style)
          const kieTurns: KieDialogueTurnInput[] = blockTurns.map((t) => {
            const isFirst = t.speakerId === sp1.speakerId;
            return {
              speaker: isFirst ? tag1 : tag2,
              voice: isFirst ? sp1.baseVoice || "Charon" : sp2.baseVoice || "Kore",
              text: `${t.cleanSpeechText} <short pause> <short pause>`,
              style: `${t.style}. End the sentence cleanly with a distinct pause.`,
            };
          });
          const kieRes = await synthesizeDialogueBlockViaKieAi(kieTurns);
          totalTtsCalls += 1;
          providersUsed.add("kie.ai");
          blockPcm = kieRes.pcm;
        } else {
          throw err;
        }
      }

      const sliced = await sliceBlockAudioIntoTurns(ai, blockPcm, blockTurns, speakerMap);
      totalTranscribeCalls += sliced.transcribeCalls;
      totalTtsCalls += sliced.recoveryTtsCalls;
      blockTurnPcms = sliced.pcms;
      blockSliceMethods = sliced.methods;
      saveCachedBlockPcms(blockHash, blockTurnPcms);
    } else {
      // =====================================================================
      // РЕЖИМ B: Клонированный голос или 3+ спикеров -> 1 вызов на спикера в блоке
      // Подтверждено тестом №3: клон принимает multi-part с разными speechMetadata.style!
      // =====================================================================
      const perSpeakerIndices = new Map<string, number[]>();
      blockTurns.forEach((t, localIdx) => {
        const list = perSpeakerIndices.get(t.speakerId) || [];
        list.push(localIdx);
        perSpeakerIndices.set(t.speakerId, list);
      });

      const assembledPcms = new Array<Buffer>(blockTurns.length);
      const assembledMethods = new Array<string>(blockTurns.length);
      let blockAbortedByCloneQuota = false;

      for (const [spId, localIndices] of perSpeakerIndices.entries()) {
        const sp = speakerMap.get(spId)!;
        const spTurns = localIndices.map((idx) => blockTurns[idx]);

        const parts = spTurns.map((t, j) => {
          const prevGlobalIdx = localIndices[j] - 1;
          const prevTurn = prevGlobalIdx >= 0 ? blockTurns[prevGlobalIdx] : null;
          const contextHint = prevTurn
            ? `Responding naturally to ${prevTurn.speakerName}`
            : `Opening line of dialogue`;
          return {
            text: `${t.cleanSpeechText} <short pause> <short pause>`,
            speechMetadata: {
              ...(sp.isCloned ? {} : { speaker: sp.baseVoice || "Charon" }),
              style: `${t.style}. ${contextHint}. End the sentence cleanly with a distinct pause.`,
            },
          };
        });

        let spBlockPcm: Buffer | null = null;
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
          totalTtsCalls += 1;
          recordGoogleTtsCalls(1);
          providersUsed.add("google");

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
              // Раздел 2.8: при 429 с клонированным голосом голос НЕ меняется — ставим на паузу с сохранением готовых блоков!
              blockAbortedByCloneQuota = true;
              quotaPaused = true;
              const doneTotal = startingCompleted + blocksCompleted;
              quotaPauseMessageRu = `Дневной лимит исчерпан. Готово ${doneTotal} из ${totalProjectBlocks} блоков, продолжим после 13:00 по Ташкенту`;
              break;
            }
            // Встроенный спикер в Режиме B -> на kie.ai (тот же голос, не меняется!)
            const kieTurns: KieDialogueTurnInput[] = spTurns.map((t) => ({
              speaker: sp.speakerName,
              voice: sp.baseVoice || "Charon",
              text: `${t.cleanSpeechText} <short pause> <short pause>`,
              style: `${t.style}. End cleanly with a distinct pause.`,
            }));
            const kieRes = await synthesizeDialogueBlockViaKieAi(kieTurns);
            totalTtsCalls += 1;
            providersUsed.add("kie.ai");
            spBlockPcm = kieRes.pcm;
          } else {
            throw err;
          }
        }

        const sliced = await sliceBlockAudioIntoTurns(ai, spBlockPcm, spTurns, speakerMap);
        totalTranscribeCalls += sliced.transcribeCalls;
        totalTtsCalls += sliced.recoveryTtsCalls;

        localIndices.forEach((origLocalIdx, k) => {
          assembledPcms[origLocalIdx] = sliced.pcms[k];
          assembledMethods[origLocalIdx] = sliced.methods[k];
        });
      }

      if (blockAbortedByCloneQuota) {
        break;
      }

      blockTurnPcms = assembledPcms;
      blockSliceMethods = assembledMethods;
      saveCachedBlockPcms(blockHash, blockTurnPcms);
    }

    // Укладка каждой нарезанной реплики блока по правилам раздела 2.6 (без обрыва слов!)
    for (let i = 0; i < blockTurns.length; i++) {
      const turn = blockTurns[i];
      const rawPcm = blockTurnPcms[i] || Buffer.alloc(24000, 0);
      const fitted = await fitSlicedTurnToTimecode(rawPcm, turn, strictTimeWindow);
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
        slicingMethod: blockSliceMethods[i] || "batch",
      });
    }

    blocksCompleted += 1;
  }

  let okCount = 0;
  let adjustedCount = 0;
  let overflowCount = 0;
  for (const r of finalResults) {
    if (r.syncStatus === "overflow") overflowCount++;
    else if (r.syncStatus === "adjusted") adjustedCount++;
    else okCount++;
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
        : canUseModeA
          ? "mode_a_multispeaker"
          : "mode_b_per_speaker",
    blocksTotal: blocks.length,
    blocksCompleted,
    quotaPaused,
    quotaPauseMessageRu,
    stats: {
      ok: okCount,
      adjusted: adjustedCount,
      overflow: overflowCount,
    },
    quotaRemaining: quota.remaining,
    quotaLimit: quota.limit,
  };
}
