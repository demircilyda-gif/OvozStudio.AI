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
import type { TtsLanguage, TtsPreset } from "../../../src/types/tts.ts";

const execFileAsync = promisify(execFile);

const TTS_STORAGE_DIR = path.resolve(process.cwd(), "uploads", "tts-audio");
const TTS_INDEX_FILE = path.join(TTS_STORAGE_DIR, "index.json");

if (!fs.existsSync(TTS_STORAGE_DIR)) {
  fs.mkdirSync(TTS_STORAGE_DIR, { recursive: true });
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
    fs.writeFileSync(TTS_INDEX_FILE, JSON.stringify(index, null, 2), "utf8");
  } catch (e) {
    console.warn("[TTS Storage] Failed to save index:", e);
  }
}

/**
 * Удаляет файлы старше 7 дней, если они не были сохранены в Медиатеку.
 */
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

/**
 * Определяет, является ли выбранный голос клонированным голосом пользователя.
 * Клонированный голос (voice_...) работает ТОЛЬКО через прямой Gemini и никогда молча не подменяется.
 */
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

/**
 * Сопоставляет ID голоса из каталога OvozStudio с одним из 6 базовых голосов Gemini TTS.
 */
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
 * Нарезка длинного текста (> 3 000 знаков) по абзацам и предложениям без разрыва фраз.
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
          // Если одно предложение без точек длиннее лимита, режем по запятым/пробелам
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

export type TtsSynthesisSegment =
  | { type: "speech"; text: string }
  | { type: "pause"; durationSec: number };

/**
 * Разбивает текст на последовательность речевых кусков и точных пауз ([pauza 1s], [pauza 2s], [pauza 3s]).
 * Между частями длинного речевого блока (> maxChars) автоматически вставляется 250 мс пауза.
 */
export function parseSpeechAndPauseSegments(
  text: string,
  maxChars: number = TTS_MODELS_CONFIG.chunkSplitThresholdChars
): TtsSynthesisSegment[] {
  const canonical = canonicalizeTimedPauseTags(text || "").trim();
  if (!canonical) return [];

  const rawParts = canonical.split(/(\[pauza\s+\d+(?:\.\d+)?s\])/gi);
  const segments: TtsSynthesisSegment[] = [];
  const defaultInterChunkSec = TTS_MODELS_CONFIG.interChunkSilenceMs / 1000;

  for (const part of rawParts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const pauseMatch = trimmed.match(/^\[pauza\s+(\d+(?:\.\d+)?)s\]$/i);
    if (pauseMatch) {
      const sec = Math.max(0.2, Math.min(15, parseFloat(pauseMatch[1])));
      // Склеиваем подряд идущие паузы, если они встретились рядом
      const prev = segments[segments.length - 1];
      if (prev && prev.type === "pause") {
        prev.durationSec = Math.min(20, prev.durationSec + sec);
      } else {
        segments.push({ type: "pause", durationSec: sec });
      }
      continue;
    }

    const subChunks = splitTextIntoTtsChunks(trimmed, maxChars);
    for (let i = 0; i < subChunks.length; i++) {
      if (subChunks[i].trim()) {
        segments.push({ type: "speech", text: subChunks[i].trim() });
        if (i < subChunks.length - 1) {
          segments.push({ type: "pause", durationSec: defaultInterChunkSec });
        }
      }
    }
  }

  return segments;
}

/**
 * Извлекает чистый 16-bit mono PCM из ответа Gemini TTS (WAV или raw PCM) и подрезает краевую тишину.
 */
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

  const padSamples = Math.floor(24000 * 0.025); // 25ms natural margin
  const startSample = Math.max(0, firstActive - padSamples);
  const endSample = Math.min(totalSamples, lastActive + padSamples + 1);
  return Buffer.from(pcm.subarray(startSample * 2, endSample * 2));
}

/**
 * Строит корректный WAV-буфер (24 kHz, 16-bit, mono) из PCM.
 */
export function buildWavFromPcm24k(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  const dataLen = pcm.length;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLen, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // Mono
  header.writeUInt32LE(24000, 24); // 24 kHz
  header.writeUInt32LE(48000, 28); // Byte rate
  header.writeUInt16LE(2, 32); // Block align
  header.writeUInt16LE(16, 34); // Bits per sample
  header.write("data", 36);
  header.writeUInt32LE(dataLen, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * Применяет плавную коррекцию скорости через ffmpeg atempo в пределах 0.9–1.15.
 */
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

/**
 * Конвертирует WAV-файл в MP3 (192 kbps) через ffmpeg.
 */
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

/**
 * Проверяет, является ли ошибка ответом 429 (лимит квоты) или 402 от Google.
 */
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

/**
 * Позволяет симулировать ответ 429 от Google в автотестах для проверки ветвления (kie.ai vs клонированный голос).
 */
let simulateGoogle429ForTesting = false;
export function setSimulateGoogle429ForTesting(val: boolean) {
  simulateGoogle429ForTesting = val;
}

/**
 * Синтезирует один кусок текста через gemini-3.8-flash-tts (или kie.ai при 429/402 для встроенных голосов).
 */
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

    // СТРОГО gemini-3.8-flash-tts (Lite не использовать)
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
      // Если выбран клонированный голос, а Google вернул 429 — голос молча НЕ подменяется!
      if (isCloned) {
        const cloneErr: any = new Error(
          "Лимит исчерпан, попробуйте позже или выберите другой голос"
        );
        cloneErr.code = "CLONED_VOICE_QUOTA_EXCEEDED";
        cloneErr.status = 429;
        throw cloneErr;
      }

      // Для встроенного голоса при 429/402 переключаемся на запасной канал kie.ai (google/gemini-3-8-flash-tts)
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

/**
 * Вычисляет стоимость озвучки в кредитах: 1 кредит за каждую начатую минуту аудио.
 */
export function calculateTtsCreditsForDuration(durationSeconds: number): number {
  return Math.max(1, Math.ceil(Math.max(1, durationSeconds) / 60));
}

/**
 * Проверяет, есть ли уже готовый результат в кэше для данных параметров (для бесплатной отдачи из кэша).
 */
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
      : normalizeUzbekApostrophes(rawInput);

  const cacheKey = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        text: normalizedText,
        voiceId: params.voiceId || "charon-news",
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
 * Главная функция синтеза вкладки «TTS Ovozlash»:
 * 1. Проверка кэша по хешу (текст + голос + язык + стиль + темп) -> 0 запросов к Google и 0 кредитов.
 * 2. Нормализация (цифры, даты, суммы, проценты и дроби словами через uzbekNormalizer, единый апостроф ').
 * 3. Автоэмоция (если подача «Авто») с проверкой неизменности всех слов.
 * 4. Нарезка текста > 3000 знаков по абзацам и предложениям + склейка с паузой 250 мс.
 * 5. Доводка темпа (0.9x – 1.15x) через ffmpeg atempo.
 * 6. Сохранение WAV и MP3 на сервере и возврат ссылки /api/tts/audio/:id.
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

  // 1. Нормализация: для узбекского языка — цифры, даты, суммы, проценты и дроби словами + единый апостроф + канонические паузы [pauza Ns]
  const normalizedText =
    params.language === "uz"
      ? normalizeUzbekSpeech(rawInput, { decimalStyle: "butun" })
      : canonicalizeTimedPauseTags(normalizeUzbekApostrophes(rawInput));

  // 2. Ключ кэша = хеш(нормализованный текст + голос + язык + стиль/пресет + темп)
  const cacheKey = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
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
    return {
      id: cachedRecord.id,
      audioUrl: `/api/tts/audio/${cachedRecord.id}?format=wav`,
      mp3Url: `/api/tts/audio/${cachedRecord.id}?format=mp3`,
      durationSeconds: cachedRecord.durationSeconds,
      finalSpokenText: cachedRecord.finalSpokenText,
      styleSummary: cachedRecord.styleSummary,
      provider: "cache",
      cached: true,
      creditsCost: 0,
      synthesisWallTimeMs: Date.now() - t0,
    };
  }

  // 3. Автоэмоция (только при preset === 'auto') с проверкой, что слова не изменились
  const styleResult = await buildTtsStyleAndAnnotatedText(ai, {
    text: normalizedText,
    preset: params.preset,
    speed: clampedSpeed,
    language: params.language,
  });

  const textForSynthesis = styleResult.combinedTaggedText || normalizedText;
  const overallStyle = styleResult.overallStyle;

  // 4. Разбивка на речевые сегменты и точные студийные паузы ([pauza 1s], [pauza 2s], [pauza 3s] + 250 мс между кусками > 2800 знаков)
  const segments = parseSpeechAndPauseSegments(
    textForSynthesis,
    TTS_MODELS_CONFIG.chunkSplitThresholdChars
  );

  const pcmParts: Buffer[] = [];
  let activeProvider: "google-gemini-tts" | "kie-gemini-tts" = "google-gemini-tts";

  for (const seg of segments) {
    if (seg.type === "pause") {
      // Умножаем на clampedSpeed, чтобы после ffmpeg atempo итоговая пауза равнялась ровно seg.durationSec секунд!
      const pauseSamples = Math.max(480, Math.round(24000 * seg.durationSec * clampedSpeed));
      pcmParts.push(Buffer.alloc(pauseSamples * 2, 0));
      continue;
    }

    const chunkRes = await synthesizeChunkPcm(ai, {
      chunkText: seg.text,
      style: overallStyle,
      voiceId: params.voiceId,
      replicatedVoiceConfig: params.replicatedVoiceConfig,
    });
    if (chunkRes.provider === "kie-gemini-tts") {
      activeProvider = "kie-gemini-tts";
    }
    pcmParts.push(chunkRes.pcm);
  }

  const stitchedPcm =
    pcmParts.length > 0 ? Buffer.concat(pcmParts) : Buffer.alloc(24000 * 2, 0);

  // 5. Доводка темпа через ffmpeg atempo в пределах 0.9–1.15
  const finalPcm = await applySpeedAtempoPcm24k(stitchedPcm, clampedSpeed);
  const durationSeconds = Math.max(1, Math.round((finalPcm.length / 48000) * 10) / 10);

  // 6. Сохранение WAV и MP3 на сервере
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

  return {
    id,
    audioUrl: `/api/tts/audio/${id}?format=wav`,
    mp3Url: `/api/tts/audio/${id}?format=mp3`,
    durationSeconds,
    finalSpokenText: normalizedText,
    styleSummary: overallStyle,
    provider: activeProvider,
    cached: false,
    creditsCost,
    synthesisWallTimeMs: Date.now() - t0,
  };
}
