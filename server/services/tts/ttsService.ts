import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { GoogleGenAI } from "@google/genai";
import { TTS_MODELS_CONFIG } from "../../config/ttsModels.ts";
import {
  normalizeUzbekSpeech,
  normalizeUzbekApostrophes,
  canonicalizeTimedPauseTags,
} from "../../../src/utils/uzbekNormalizer.ts";
import { buildTtsStyleAndAnnotatedText } from "./ttsAutoStyle.ts";
import { synthesizeViaKieAi } from "./kieTtsAdapter.ts";
import {
  stretchTimedPausesInPcm,
  type TimedPauseMarker,
} from "../dubbing/batchAudioSlicer.ts";
import {
  getTtsQuotaStatus,
  recordGoogleTtsCalls,
  markGoogleTtsQuotaExhaustedToday,
} from "./ttsQuotaTracker.ts";
import type { TtsLanguage, TtsPreset } from "../../../src/types/tts.ts";

const execFileAsync = promisify(execFile);

const TTS_STORAGE_DIR = path.resolve(process.cwd(), "uploads", "tts-audio");
const TTS_INDEX_FILE = path.join(TTS_STORAGE_DIR, "index.json");

function ensureStorageDir() {
  if (!fs.existsSync(TTS_STORAGE_DIR)) {
    fs.mkdirSync(TTS_STORAGE_DIR, { recursive: true });
  }
}

export interface StoredTtsRecord {
  id: string;
  cacheKey: string;
  ownerUid: string;
  wavPath: string;
  mp3Path: string;
  durationSeconds: number;
  finalSpokenText: string;
  styleSummary: string;
  provider: "google-gemini-tts" | "kie-gemini-tts";
  createdAt: string;
  savedToMediaLibrary: boolean;
}

function loadTtsIndex(): Record<string, StoredTtsRecord> {
  try {
    if (fs.existsSync(TTS_INDEX_FILE)) {
      return JSON.parse(fs.readFileSync(TTS_INDEX_FILE, "utf8"));
    }
  } catch {}
  return {};
}

function saveTtsIndex(index: Record<string, StoredTtsRecord>) {
  try {
    ensureStorageDir();
    fs.writeFileSync(TTS_INDEX_FILE, JSON.stringify(index, null, 2), "utf8");
  } catch (e) {
    console.warn("[TTS Storage] Failed to save index:", e);
  }
}

export function cleanupExpiredTtsFiles() {
  try {
    const index = loadTtsIndex();
    const now = Date.now();
    const maxAgeMs = TTS_MODELS_CONFIG.fileRetentionDays * 24 * 60 * 60 * 1000;
    let changed = false;

    for (const [id, rec] of Object.entries(index)) {
      if (rec.savedToMediaLibrary) continue;
      const createdMs = new Date(rec.createdAt).getTime();
      if (now - createdMs > maxAgeMs) {
        try {
          if (fs.existsSync(rec.wavPath)) fs.unlinkSync(rec.wavPath);
          if (fs.existsSync(rec.mp3Path)) fs.unlinkSync(rec.mp3Path);
        } catch {}
        delete index[id];
        changed = true;
      }
    }

    if (changed) {
      saveTtsIndex(index);
    }
  } catch {}
}

export function getStoredTtsRecord(id: string): StoredTtsRecord | null {
  const index = loadTtsIndex();
  const rec = index[id];
  if (!rec) return null;
  if (!fs.existsSync(rec.wavPath)) return null;
  return rec;
}

export function markTtsRecordSavedToMediaLibrary(id: string): StoredTtsRecord | null {
  const index = loadTtsIndex();
  const rec = index[id];
  if (!rec) return null;
  rec.savedToMediaLibrary = true;
  saveTtsIndex(index);
  return rec;
}

export function isClonedVoiceIdentifier(voiceId?: string, replicatedVoiceConfig?: any): boolean {
  if (replicatedVoiceConfig) return true;
  const v = String(voiceId || "").trim().toLowerCase();
  if (!v) return false;
  return (
    v.startsWith("voice_") ||
    v.startsWith("custom-") ||
    v === "user-replicated" ||
    v === "shohrux" ||
    v === "shokhrukh"
  );
}

export function resolvePrebuiltVoiceName(voiceId?: string): string {
  const v = String(voiceId || "").trim().toLowerCase();
  const canonical: Record<string, string> = {
    charon: "Charon",
    fenrir: "Fenrir",
    kore: "Kore",
    puck: "Puck",
    aoede: "Aoede",
    zephyr: "Zephyr",
  };
  if (canonical[v]) return canonical[v];

  if (/kore|aziza|madina|malika|female|ayol/i.test(v)) return "Kore";
  if (/aoede|dilnoza|sevara|gulzoda|nodira/i.test(v)) return "Aoede";
  if (/zephyr|zarina|rayhon|shahnoza|umida|nigora|feruza/i.test(v)) return "Zephyr";
  if (/fenrir|bobur|sherzod|alisher|narrator|hikoya/i.test(v)) return "Fenrir";
  if (/puck|otabek|javohir|eldor|yosh/i.test(v)) return "Puck";
  return "Charon";
}

/**
 * Раздел 1.5: Нарезка текста ТОЛЬКО по лимиту (~3 000 знаков) по границам абзацев и предложений.
 * Теги [pauza Ns] НЕ являются границей вызова TTS!
 */
export function splitTextIntoTtsChunks(
  text: string,
  maxChars: number = TTS_MODELS_CONFIG.chunkSplitThresholdChars
): string[] {
  const clean = (text || "").trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const paragraphs = clean.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  const pushSentenceSplit = (longParagraph: string) => {
    const sentences = longParagraph
      .split(/(?<=[.!?…])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const sent of sentences) {
      if (!current) {
        if (sent.length <= maxChars) {
          current = sent;
        } else {
          const clauses = sent.split(/(?<=[,;:])\s+/);
          for (const cl of clauses) {
            if ((current ? `${current} ${cl}` : cl).length <= maxChars) {
              current = current ? `${current} ${cl}` : cl;
            } else {
              if (current) chunks.push(current);
              current = cl.slice(0, maxChars);
            }
          }
        }
      } else if (`${current} ${sent}`.length <= maxChars) {
        current = `${current} ${sent}`;
      } else {
        chunks.push(current);
        current = sent;
      }
    }
  };

  for (const para of paragraphs) {
    if (!current) {
      if (para.length <= maxChars) {
        current = para;
      } else {
        pushSentenceSplit(para);
      }
    } else if (`${current}\n\n${para}`.length <= maxChars) {
      current = `${current}\n\n${para}`;
    } else {
      chunks.push(current);
      current = "";
      if (para.length <= maxChars) {
        current = para;
      } else {
        pushSentenceSplit(para);
      }
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

/**
 * Прогноз числа вызовов TTS для заданного текста (раздел 1.6).
 */
export function estimateTtsCallsForText(text: string): number {
  const clean = (text || "").trim();
  if (!clean) return 0;
  return Math.max(1, splitTextIntoTtsChunks(clean, TTS_MODELS_CONFIG.chunkSplitThresholdChars).length);
}

/**
 * Раздел 1.5: Подготавливает один чанк (~3000 знаков) к ЕДИНОМУ вызову TTS:
 * - Каждая пауза `[pauza Ns]` внутри чанка заменяется на `<short pause>`,
 *   а её относительная позиция в тексте (0..1) запоминается в `markers`.
 * - Ведущая или завершающая пауза чанка возвращается отдельно (leadingSilenceSec / trailingSilenceSec).
 */
export function prepareChunkWithInlinePauseMarkers(rawChunk: string): {
  ttsText: string;
  markers: TimedPauseMarker[];
  leadingSilenceSec: number;
  trailingSilenceSec: number;
} {
  const canonical = canonicalizeTimedPauseTags(rawChunk || "").trim();
  const tokenRegex = /\[pauza\s+(\d+(?:\.\d+)?)s\]/gi;

  const tokens: Array<{ type: "text"; value: string } | { type: "pause"; sec: number }> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(canonical)) !== null) {
    if (match.index > lastIndex) {
      const seg = canonical.slice(lastIndex, match.index);
      if (seg.trim()) {
        tokens.push({ type: "text", value: seg });
      }
    }
    const sec = Math.max(0.5, Math.min(3.5, parseFloat(match[1]) || 1));
    const prev = tokens[tokens.length - 1];
    if (prev && prev.type === "pause") {
      prev.sec = Math.min(5, prev.sec + sec);
    } else {
      tokens.push({ type: "pause", sec });
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < canonical.length) {
    const tail = canonical.slice(lastIndex);
    if (tail.trim()) {
      tokens.push({ type: "text", value: tail });
    }
  }

  let leadingSilenceSec = 0;
  let trailingSilenceSec = 0;

  while (tokens.length > 0 && tokens[0].type === "pause") {
    leadingSilenceSec += (tokens.shift() as { type: "pause"; sec: number }).sec;
  }
  while (tokens.length > 0 && tokens[tokens.length - 1].type === "pause") {
    trailingSilenceSec += (tokens.pop() as { type: "pause"; sec: number }).sec;
  }

  const spokenLengthOf = (s: string) =>
    s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;

  const totalSpokenChars = Math.max(
    1,
    tokens.reduce((sum, tk) => (tk.type === "text" ? sum + spokenLengthOf(tk.value) : sum), 0)
  );

  const ttsParts: string[] = [];
  const markers: TimedPauseMarker[] = [];
  let spokenSoFar = 0;

  for (const tk of tokens) {
    if (tk.type === "text") {
      ttsParts.push(tk.value.trim());
      spokenSoFar += spokenLengthOf(tk.value);
    } else {
      // Заменяем [pauza Ns] на <short pause>, чтобы модель сделала чистую акустическую паузу,
      // которую VAD затем растянет ровно до N секунд без повторного вызова TTS!
      ttsParts.push("<short pause>");
      const relPos = Math.max(0.02, Math.min(0.98, spokenSoFar / totalSpokenChars));
      markers.push({
        relativePos: relPos,
        targetDurationSec: tk.sec,
      });
    }
  }

  return {
    ttsText: ttsParts.join(" ").replace(/\s{2,}/g, " ").trim(),
    markers,
    leadingSilenceSec,
    trailingSilenceSec,
  };
}

function extractAndTrimPcm(rawBuf: Buffer): Buffer {
  let pcm = rawBuf;
  if (
    rawBuf.length > 44 &&
    rawBuf.toString("ascii", 0, 4) === "RIFF" &&
    rawBuf.toString("ascii", 8, 12) === "WAVE"
  ) {
    let offset = 12;
    while (offset + 8 <= rawBuf.length) {
      const chunkId = rawBuf.toString("ascii", offset, offset + 4);
      const chunkSize = rawBuf.readUInt32LE(offset + 4);
      if (chunkId === "data") {
        pcm = rawBuf.subarray(offset + 8, Math.min(rawBuf.length, offset + 8 + chunkSize));
        break;
      }
      offset += 8 + chunkSize;
    }
  }

  const totalSamples = Math.floor(pcm.length / 2);
  if (totalSamples < 480) return pcm;

  const threshold = 90;
  let firstActive = 0;
  let lastActive = totalSamples - 1;

  while (firstActive < totalSamples && Math.abs(pcm.readInt16LE(firstActive * 2)) < threshold) {
    firstActive++;
  }
  while (lastActive > firstActive && Math.abs(pcm.readInt16LE(lastActive * 2)) < threshold) {
    lastActive--;
  }

  const padSamples = Math.floor(24000 * 0.025);
  const startSample = Math.max(0, firstActive - padSamples);
  const endSample = Math.min(totalSamples, lastActive + padSamples + 1);
  return Buffer.from(pcm.subarray(startSample * 2, endSample * 2));
}

export function buildWavFromPcm24k(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  const dataLen = pcm.length;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLen, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24);
  header.writeUInt32LE(48000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataLen, 40);
  return Buffer.concat([header, pcm]);
}

async function applySpeedAtempoPcm24k(pcm: Buffer, speed: number): Promise<Buffer> {
  const clamped = Math.max(
    TTS_MODELS_CONFIG.minSpeed,
    Math.min(TTS_MODELS_CONFIG.maxSpeed, Number(speed) || 1.0)
  );
  if (Math.abs(clamped - 1.0) < 0.015) {
    return pcm;
  }

  const tmpBase = path.join(
    os.tmpdir(),
    `tts_atempo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  );
  const inWav = `${tmpBase}_in.wav`;
  const outPcm = `${tmpBase}_out.pcm`;

  try {
    fs.writeFileSync(inWav, buildWavFromPcm24k(pcm));
    await execFileAsync("/usr/bin/ffmpeg", [
      "-y",
      "-i",
      inWav,
      "-filter:a",
      `atempo=${clamped.toFixed(3)}`,
      "-ac",
      "1",
      "-ar",
      "24000",
      "-f",
      "s16le",
      outPcm,
    ]);
    if (fs.existsSync(outPcm)) {
      return fs.readFileSync(outPcm);
    }
  } catch (e) {
    console.warn("[TTS atempo] Fallback to unscaled PCM:", e);
  } finally {
    try {
      if (fs.existsSync(inWav)) fs.unlinkSync(inWav);
      if (fs.existsSync(outPcm)) fs.unlinkSync(outPcm);
    } catch {}
  }
  return pcm;
}

async function convertWavToMp3File(wavPath: string, mp3Path: string): Promise<void> {
  await execFileAsync("/usr/bin/ffmpeg", [
    "-y",
    "-i",
    wavPath,
    "-codec:a",
    "libmp3lame",
    "-b:a",
    "192k",
    mp3Path,
  ]);
}

function isGoogleQuotaOrPaymentError(err: any): boolean {
  const status = err?.status || err?.statusCode || err?.code;
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    status === 429 ||
    status === 402 ||
    msg.includes("429") ||
    msg.includes("402") ||
    msg.includes("resource_exhausted") ||
    msg.includes("quota exceeded") ||
    msg.includes("rate limit")
  );
}

let simulateGoogle429ForTesting = false;
export function setSimulateGoogle429ForTesting(val: boolean) {
  simulateGoogle429ForTesting = val;
}

async function synthesizeChunkPcm(
  ai: GoogleGenAI,
  params: {
    chunkText: string;
    style: string;
    voiceId: string;
    replicatedVoiceConfig?: any;
  }
): Promise<{ pcm: Buffer; provider: "google-gemini-tts" | "kie-gemini-tts" }> {
  const isCloned = isClonedVoiceIdentifier(params.voiceId, params.replicatedVoiceConfig);
  const prebuiltVoiceName = resolvePrebuiltVoiceName(params.voiceId);

  let voiceConfig: any = {
    prebuiltVoiceConfig: { voiceName: prebuiltVoiceName },
  };

  if (isCloned) {
    if (
      params.replicatedVoiceConfig?.voiceSampleAudio &&
      (params.replicatedVoiceConfig?.consentAudio ||
        params.replicatedVoiceConfig?.voiceConsentSignature)
    ) {
      const sampleData =
        typeof params.replicatedVoiceConfig.voiceSampleAudio === "string"
          ? params.replicatedVoiceConfig.voiceSampleAudio
          : params.replicatedVoiceConfig.voiceSampleAudio?.data;
      voiceConfig = {
        replicatedVoiceConfig: {
          mimeType: "audio/wav",
          voiceSampleAudio: sampleData,
          ...(params.replicatedVoiceConfig.consentAudio
            ? { consentAudio: params.replicatedVoiceConfig.consentAudio }
            : {}),
          ...(params.replicatedVoiceConfig.voiceConsentSignature
            ? { voiceConsentSignature: params.replicatedVoiceConfig.voiceConsentSignature }
            : {}),
        },
      };
    } else {
      voiceConfig = {
        voice: params.voiceId.startsWith("voice_") ? params.voiceId : "voice_17raj9ewke3g",
      };
    }
  }

  try {
    if (simulateGoogle429ForTesting) {
      const simulatedErr: any = new Error("429 RESOURCE_EXHAUSTED: Quota exceeded");
      simulatedErr.status = 429;
      throw simulatedErr;
    }

    // СТРОГО gemini-3.8-flash-tts (Lite не использовать нигде)
    const response = await ai.models.generateContent({
      model: TTS_MODELS_CONFIG.ttsModel,
      contents: [
        {
          role: "user",
          parts: [
            {
              text: params.chunkText,
              speechMetadata: {
                speaker: prebuiltVoiceName,
                style: params.style,
              },
            } as any,
          ],
        },
      ],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig,
        },
      },
    });

    recordGoogleTtsCalls(1);

    const b64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!b64) {
      throw new Error("Google Gemini TTS returned empty audio data");
    }

    const rawBuf = Buffer.from(b64, "base64");
    const pcm = extractAndTrimPcm(rawBuf);
    if (!pcm || pcm.length === 0) {
      throw new Error("Extracted PCM is empty");
    }

    return { pcm, provider: "google-gemini-tts" };
  } catch (err: any) {
    if (isGoogleQuotaOrPaymentError(err)) {
      markGoogleTtsQuotaExhaustedToday();
      if (isCloned) {
        const cloneErr: any = new Error(
          "Дневной лимит исчерпан. Клонированный голос доступен после 13:00 по Ташкенту, либо выберите встроенный голос."
        );
        cloneErr.code = "CLONED_VOICE_QUOTA_EXCEEDED";
        cloneErr.status = 429;
        throw cloneErr;
      }

      const kieRes = await synthesizeViaKieAi({
        text: params.chunkText,
        voiceName: prebuiltVoiceName,
        style: params.style,
      });
      return {
        pcm: extractAndTrimPcm(kieRes.pcm),
        provider: "kie-gemini-tts",
      };
    }
    throw err;
  }
}

export function calculateTtsCreditsForDuration(durationSeconds: number): number {
  return Math.max(1, Math.ceil(Math.max(1, durationSeconds) / 60));
}

export function isTtsRequestCached(params: {
  text: string;
  voiceId: string;
  language: TtsLanguage;
  preset: TtsPreset;
  speed: number;
}): boolean {
  const rawInput = (params.text || "").trim().slice(0, TTS_MODELS_CONFIG.maxTextChars);
  if (!rawInput) return false;
  const clampedSpeed = Math.max(
    TTS_MODELS_CONFIG.minSpeed,
    Math.min(TTS_MODELS_CONFIG.maxSpeed, Number(params.speed) || TTS_MODELS_CONFIG.defaultSpeed)
  );
  const normalizedText =
    params.language === "uz"
      ? normalizeUzbekSpeech(rawInput, { decimalStyle: "butun" })
      : canonicalizeTimedPauseTags(normalizeUzbekApostrophes(rawInput));

  const cacheKey = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        v: 2,
        text: normalizedText,
        voiceId: params.voiceId || "charon-history",
        language: params.language || "uz",
        preset: params.preset || "auto",
        speed: clampedSpeed.toFixed(2),
      })
    )
    .digest("hex");

  const index = loadTtsIndex();
  return Object.values(index).some(
    (rec) => rec.cacheKey === cacheKey && fs.existsSync(rec.wavPath) && fs.existsSync(rec.mp3Path)
  );
}

/**
 * Главная функция синтеза вкладки «TTS Ovozlash» (раздел 1.5):
 * - Режет текст ТОЛЬКО по лимиту ~3 000 знаков (паузы [pauza 1s/2s/3s] НЕ тратят доп. вызовы TTS!).
 * - Внутри чанка заменяет [pauza Ns] на <short pause>, после синтеза VAD находит паузу
 *   и растягивает её ровно до N секунд вставкой нулевого PCM.
 * - Возвращает ttsCallsUsed и актуальный остаток дневной квоты.
 */
export async function synthesizeTtsOvozlash(
  ai: GoogleGenAI,
  params: {
    text: string;
    voiceId: string;
    language: TtsLanguage;
    preset: TtsPreset;
    speed: number;
    ownerUid: string;
    replicatedVoiceConfig?: any;
  }
): Promise<{
  id: string;
  audioUrl: string;
  mp3Url: string;
  durationSeconds: number;
  finalSpokenText: string;
  styleSummary: string;
  provider: "google-gemini-tts" | "kie-gemini-tts" | "cache";
  cached: boolean;
  ttsCallsUsed: number;
  quotaRemaining: number;
  quotaLimit: number;
  creditsCost: number;
  synthesisWallTimeMs: number;
}> {
  const t0 = Date.now();
  cleanupExpiredTtsFiles();

  const rawInput = (params.text || "").trim().slice(0, TTS_MODELS_CONFIG.maxTextChars);
  if (!rawInput) {
    throw new Error("Текст для озвучки не может быть пустым");
  }

  const clampedSpeed = Math.max(
    TTS_MODELS_CONFIG.minSpeed,
    Math.min(TTS_MODELS_CONFIG.maxSpeed, Number(params.speed) || TTS_MODELS_CONFIG.defaultSpeed)
  );

  const normalizedText =
    params.language === "uz"
      ? normalizeUzbekSpeech(rawInput, { decimalStyle: "butun" })
      : canonicalizeTimedPauseTags(normalizeUzbekApostrophes(rawInput));

  const cacheKey = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        v: 2,
        text: normalizedText,
        voiceId: params.voiceId,
        language: params.language,
        preset: params.preset,
        speed: clampedSpeed.toFixed(2),
      })
    )
    .digest("hex");

  const index = loadTtsIndex();
  const cachedRecord = Object.values(index).find(
    (rec) => rec.cacheKey === cacheKey && fs.existsSync(rec.wavPath) && fs.existsSync(rec.mp3Path)
  );

  if (cachedRecord) {
    const quota = getTtsQuotaStatus();
    return {
      id: cachedRecord.id,
      audioUrl: `/api/tts/audio/${cachedRecord.id}?format=wav`,
      mp3Url: `/api/tts/audio/${cachedRecord.id}?format=mp3`,
      durationSeconds: cachedRecord.durationSeconds,
      finalSpokenText: cachedRecord.finalSpokenText,
      styleSummary: cachedRecord.styleSummary,
      provider: "cache",
      cached: true,
      ttsCallsUsed: 0,
      quotaRemaining: quota.remaining,
      quotaLimit: quota.limit,
      creditsCost: 0,
      synthesisWallTimeMs: Date.now() - t0,
    };
  }

  const styleResult = await buildTtsStyleAndAnnotatedText(ai, {
    text: normalizedText,
    preset: params.preset,
    speed: clampedSpeed,
    language: params.language,
  });

  const textForSynthesis = styleResult.combinedTaggedText || normalizedText;
  const overallStyle = styleResult.overallStyle;

  // Раздел 1.5: Нарезка ТОЛЬКО по ~3 000 знаков по границам абзацев и предложений
  const rawChunks = splitTextIntoTtsChunks(
    textForSynthesis,
    TTS_MODELS_CONFIG.chunkSplitThresholdChars
  );

  const pcmParts: Buffer[] = [];
  let activeProvider: "google-gemini-tts" | "kie-gemini-tts" = "google-gemini-tts";
  let ttsCallsUsed = 0;
  const interChunkSilenceSamples = Math.round(
    24000 * (TTS_MODELS_CONFIG.interChunkSilenceMs / 1000) * clampedSpeed
  );

  for (let i = 0; i < rawChunks.length; i++) {
    const prepared = prepareChunkWithInlinePauseMarkers(rawChunks[i]);
    if (!prepared.ttsText) continue;

    if (prepared.leadingSilenceSec > 0) {
      pcmParts.push(
        Buffer.alloc(Math.round(24000 * prepared.leadingSilenceSec * clampedSpeed) * 2, 0)
      );
    }

    const chunkRes = await synthesizeChunkPcm(ai, {
      chunkText: prepared.ttsText,
      style: overallStyle,
      voiceId: params.voiceId,
      replicatedVoiceConfig: params.replicatedVoiceConfig,
    });
    ttsCallsUsed += 1;

    if (chunkRes.provider === "kie-gemini-tts") {
      activeProvider = "kie-gemini-tts";
    }

    // Раздел 1.5: Растягиваем найденные VAD-паузы ровно до [pauza Ns] секунд вставкой нулевого PCM (0 доп. вызовов!)
    const stretched =
      prepared.markers.length > 0
        ? stretchTimedPausesInPcm(chunkRes.pcm, prepared.markers, clampedSpeed)
        : { pcm: chunkRes.pcm, matchedCount: 0, missedCount: 0, details: [] };

    pcmParts.push(stretched.pcm);

    if (prepared.trailingSilenceSec > 0) {
      pcmParts.push(
        Buffer.alloc(Math.round(24000 * prepared.trailingSilenceSec * clampedSpeed) * 2, 0)
      );
    } else if (i < rawChunks.length - 1) {
      pcmParts.push(Buffer.alloc(interChunkSilenceSamples * 2, 0));
    }
  }

  const stitchedPcm =
    pcmParts.length > 0 ? Buffer.concat(pcmParts) : Buffer.alloc(24000 * 2, 0);

  const finalPcm = await applySpeedAtempoPcm24k(stitchedPcm, clampedSpeed);
  const durationSeconds = Math.max(1, Math.round((finalPcm.length / 48000) * 10) / 10);

  ensureStorageDir();
  const id = `tts_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const wavPath = path.join(TTS_STORAGE_DIR, `${id}.wav`);
  const mp3Path = path.join(TTS_STORAGE_DIR, `${id}.mp3`);

  const wavBuffer = buildWavFromPcm24k(finalPcm);
  fs.writeFileSync(wavPath, wavBuffer);
  await convertWavToMp3File(wavPath, mp3Path);

  const record: StoredTtsRecord = {
    id,
    cacheKey,
    ownerUid: params.ownerUid,
    wavPath,
    mp3Path,
    durationSeconds,
    finalSpokenText: normalizedText,
    styleSummary: overallStyle,
    provider: activeProvider,
    createdAt: new Date().toISOString(),
    savedToMediaLibrary: false,
  };

  const freshIndex = loadTtsIndex();
  freshIndex[id] = record;
  saveTtsIndex(freshIndex);

  const creditsCost = calculateTtsCreditsForDuration(durationSeconds);
  const quota = getTtsQuotaStatus();

  return {
    id,
    audioUrl: `/api/tts/audio/${id}?format=wav`,
    mp3Url: `/api/tts/audio/${id}?format=mp3`,
    durationSeconds,
    finalSpokenText: normalizedText,
    styleSummary: overallStyle,
    provider: activeProvider,
    cached: false,
    ttsCallsUsed,
    quotaRemaining: quota.remaining,
    quotaLimit: quota.limit,
    creditsCost,
    synthesisWallTimeMs: Date.now() - t0,
  };
}
