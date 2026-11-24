import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { GoogleGenAI } from "@google/genai";
// @ts-ignore - lamejs lacks complete TS types
import { Mp3Encoder } from "@breezystack/lamejs";
import { resolveFfmpegPath, resolvePitchShiftFfmpeg } from "../../utils/ffmpegBinary.ts";
import { TTS_MODELS_CONFIG, describeSpeedForStyle } from "../../config/ttsModels.ts";
import {
  getCharacterVoiceById,
  clampPitchSemitones,
  sanitizeStyleForGooglePolicy,
  isGoogleSafetyOrPolicyError,
} from "../../config/characterVoices.ts";
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
import type { TtsDirectorSegment, TtsLanguage, TtsPreset } from "../../../src/types/tts.ts";

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
    leda: "Leda",
    achird: "Achird",
    sadachbia: "Sadachbia",
  };
  if (canonical[v]) return canonical[v];

  if (/leda/i.test(v)) return "Leda";
  if (/achird/i.test(v)) return "Achird";
  if (/sadachbia/i.test(v)) return "Sadachbia";
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

/**
 * Однопроходная постобработка PCM 24kHz (pitch shift + speed) через ffmpeg.
 * Строгий порядок аудио-конвейера:
 *   VAD [pauza Ns] stretch -> single-pass pitch shift + atempo speed -> WAV/MP3.
 *
 * - Если доступен фильтр `rubberband`:
 *     `rubberband=pitch=R` (или `rubberband=pitch=R:tempo=speed` при speed != 1)
 * - Иначе (fallback):
 *     `asetrate=24000*R,aresample=24000,atempo=speed/R`
 *   где R = 2^(n/12), n в [0..4]. Один проход atempo без двойной деградации звука!
 */
export async function applyPitchAndSpeedPcm24k(
  pcm: Buffer,
  pitchSemitones: number = 0,
  speed: number = 1.0
): Promise<{ pcm: Buffer; filterUsed: string; hasRubberband: boolean }> {
  const clampedPitch = clampPitchSemitones(pitchSemitones);
  const clampedSpeed = Math.max(
    TTS_MODELS_CONFIG.minSpeed,
    Math.min(TTS_MODELS_CONFIG.maxSpeed, Number(speed) || 1.0)
  );
  const needPitch = clampedPitch > 0.01;
  const needSpeed = Math.abs(clampedSpeed - 1.0) >= 0.015;

  if (!needPitch && !needSpeed) {
    return { pcm, filterUsed: "none", hasRubberband: false };
  }

  const { binPath: ffmpegBin, hasRubberband } = resolvePitchShiftFfmpeg();
  if (!ffmpegBin) {
    console.warn("[TTS audio-fx] ffmpeg binary unavailable, returning unprocessed PCM");
    return { pcm, filterUsed: "none", hasRubberband: false };
  }

  let audioFilter = "";
  if (needPitch) {
    const ratio = Math.pow(2, clampedPitch / 12);
    if (hasRubberband) {
      audioFilter = needSpeed
        ? `rubberband=pitch=${ratio.toFixed(6)}:tempo=${clampedSpeed.toFixed(4)}`
        : `rubberband=pitch=${ratio.toFixed(6)}`;
    } else {
      // Single combined atempo factor = speed / R (for pitch 0..4 and speed 0.85..1.25 -> 0.67..1.25, strictly inside [0.5, 2.0])
      const combinedAtempo = Math.max(0.5, Math.min(2.0, clampedSpeed / ratio));
      const shiftedRate = Math.round(24000 * ratio);
      audioFilter = `asetrate=${shiftedRate},aresample=24000,atempo=${combinedAtempo.toFixed(6)}`;
    }
  } else {
    audioFilter = `atempo=${clampedSpeed.toFixed(4)}`;
  }

  const tmpBase = path.join(
    os.tmpdir(),
    `tts_fx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  );
  const inWav = `${tmpBase}_in.wav`;
  const outPcm = `${tmpBase}_out.pcm`;

  try {
    fs.writeFileSync(inWav, buildWavFromPcm24k(pcm));
    await execFileAsync(ffmpegBin, [
      "-y",
      "-i",
      inWav,
      "-filter:a",
      audioFilter,
      "-ac",
      "1",
      "-ar",
      "24000",
      "-f",
      "s16le",
      outPcm,
    ]);
    if (fs.existsSync(outPcm)) {
      const processed = fs.readFileSync(outPcm);
      if (processed.length > 0) {
        return { pcm: processed, filterUsed: audioFilter, hasRubberband };
      }
    }
  } catch (e) {
    console.warn(`[TTS audio-fx] Filter "${audioFilter}" failed, falling back:`, e);
    // If rubberband failed unexpectedly at runtime, retry once with asetrate+atempo fallback
    if (needPitch && hasRubberband) {
      try {
        const ratio = Math.pow(2, clampedPitch / 12);
        const combinedAtempo = Math.max(0.5, Math.min(2.0, clampedSpeed / ratio));
        const fallbackFilter = `asetrate=${Math.round(24000 * ratio)},aresample=24000,atempo=${combinedAtempo.toFixed(6)}`;
        await execFileAsync(ffmpegBin, [
          "-y",
          "-i",
          inWav,
          "-filter:a",
          fallbackFilter,
          "-ac",
          "1",
          "-ar",
          "24000",
          "-f",
          "s16le",
          outPcm,
        ]);
        if (fs.existsSync(outPcm)) {
          const processed = fs.readFileSync(outPcm);
          if (processed.length > 0) {
            return { pcm: processed, filterUsed: fallbackFilter, hasRubberband: false };
          }
        }
      } catch (fallbackErr) {
        console.warn("[TTS audio-fx] asetrate fallback failed:", fallbackErr);
      }
    }
  } finally {
    try {
      if (fs.existsSync(inWav)) fs.unlinkSync(inWav);
      if (fs.existsSync(outPcm)) fs.unlinkSync(outPcm);
    } catch {}
  }
  return { pcm, filterUsed: "none", hasRubberband };
}

/**
 * Pure-JS fallback MP3 encoder (24kHz mono 16-bit PCM -> MP3 128kbps) via @breezystack/lamejs.
 * Guarantees MP3 export works even if native ffmpeg is unavailable in a minimal container.
 */
function encodePcm24kToMp3PureJs(pcm: Buffer): Buffer {
  const encoder = new Mp3Encoder(1, 24000, 128);
  const sampleCount = Math.floor(pcm.length / 2);
  const samples = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = pcm.readInt16LE(i * 2);
  }
  const chunks: Buffer[] = [];
  const blockSize = 1152;
  for (let i = 0; i < samples.length; i += blockSize) {
    const slice = samples.subarray(i, i + blockSize);
    const mp3buf = encoder.encodeBuffer(slice);
    if (mp3buf && mp3buf.length > 0) {
      chunks.push(Buffer.from(mp3buf));
    }
  }
  const flushed = encoder.flush();
  if (flushed && flushed.length > 0) {
    chunks.push(Buffer.from(flushed));
  }
  return Buffer.concat(chunks);
}

async function convertWavToMp3File(
  wavPath: string,
  mp3Path: string,
  pcmFallback?: Buffer
): Promise<void> {
  const ffmpegBin = resolveFfmpegPath();
  if (ffmpegBin) {
    try {
      await execFileAsync(ffmpegBin, [
        "-y",
        "-i",
        wavPath,
        "-codec:a",
        "libmp3lame",
        "-b:a",
        "192k",
        mp3Path,
      ]);
      if (fs.existsSync(mp3Path) && fs.statSync(mp3Path).size > 0) {
        return;
      }
    } catch (err: any) {
      console.warn(
        "[TTS MP3] ffmpeg encoding failed, switching to pure-JS lamejs encoder:",
        err?.message || err
      );
    }
  }

  // Pure-JS MP3 fallback (zero external binary dependency!)
  const pcmData = pcmFallback || extractAndTrimPcm(fs.readFileSync(wavPath));
  const mp3Buffer = encodePcm24kToMp3PureJs(pcmData);
  fs.writeFileSync(mp3Path, mp3Buffer);
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

type GeminiStyleObserver = (info: {
  voiceName: string;
  styles: string[];
  characterVoiceId?: string;
}) => void;

let geminiStyleObserver: GeminiStyleObserver | null = null;
export function setGeminiStyleObserver(observer: GeminiStyleObserver | null) {
  geminiStyleObserver = observer;
}

function composeCharacterAndStyle(
  characterBaseStyle: string | undefined,
  secondaryStyle: string
): string {
  const base = String(characterBaseStyle || "").trim();
  const sec = String(secondaryStyle || "").trim();
  if (!base) return sanitizeStyleForGooglePolicy(sec);
  if (!sec) return sanitizeStyleForGooglePolicy(base);
  // Строго: baseStyle персонажа ВСЕГДА идёт первым, затем стиль агента/пресета
  return sanitizeStyleForGooglePolicy(`${base}. ${sec}`);
}

function enrichHumanStyleDirection(
  rawStyle: string,
  speed: number,
  language: TtsLanguage,
  characterBaseStyle?: string
): string {
  const speedPhrase = describeSpeedForStyle(speed);
  const langLabel =
    language === "uz"
      ? "Native authentic Uzbek pronunciation (zero foreign accent)"
      : language === "ru"
        ? "Native authentic Russian pronunciation"
        : "Native natural English pronunciation";
  const humanAnchor = characterBaseStyle
    ? "Expressive animated cartoon voice acting performed by a voice actor with lively natural rhythm and clear articulation"
    : "Natural living human voice with organic breathing, genuine emotional micro-intonation and effortless conversational flow — never robotic or flat announcer reading";

  const trimmed = (rawStyle || "").trim();
  const combinedBase = composeCharacterAndStyle(characterBaseStyle, trimmed);
  if (!combinedBase) {
    return sanitizeStyleForGooglePolicy(`${humanAnchor}, ${speedPhrase}. ${langLabel}`);
  }
  const hasHumanCue = /human|robotic|breath|organic|conversational|living|cartoon|narrator|character/i.test(
    combinedBase
  );
  return sanitizeStyleForGooglePolicy(
    `${combinedBase}${hasHumanCue ? "" : `. ${humanAnchor}`}, ${speedPhrase}. ${langLabel}`
  );
}

interface StyledPartInput {
  text: string;
  style: string;
}

/**
 * Подготавливает массив стилизованных сегментов (битов режиссуры) к ЕДИНОМУ вызову Gemini 3.8 TTS:
 * каждый сегмент сохраняет собственный speechMetadata.style, а все [pauza Ns] заменяются на <short pause>
 * с точными глобальными относительными позициями (0..1) для VAD-растягивания без доп. вызовов TTS.
 */
function prepareStyledSegmentsForSingleCall(
  segments: StyledPartInput[]
): {
  parts: StyledPartInput[];
  markers: TimedPauseMarker[];
  leadingSilenceSec: number;
  trailingSilenceSec: number;
} {
  const preparedList = segments
    .map((seg) => ({
      style: seg.style,
      prep: prepareChunkWithInlinePauseMarkers(seg.text),
    }))
    .filter((item) => item.prep.ttsText.length > 0);

  if (preparedList.length === 0) {
    return { parts: [], markers: [], leadingSilenceSec: 0, trailingSilenceSec: 0 };
  }

  const spokenLen = (s: string) =>
    s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;

  const lengths = preparedList.map((item) => Math.max(1, spokenLen(item.prep.ttsText)));
  const totalLen = Math.max(
    1,
    lengths.reduce((a, b) => a + b, 0)
  );

  const leadingSilenceSec = preparedList[0].prep.leadingSilenceSec;
  const trailingSilenceSec = preparedList[preparedList.length - 1].prep.trailingSilenceSec;

  const markers: TimedPauseMarker[] = [];
  const parts: StyledPartInput[] = [];
  let offsetChars = 0;

  for (let i = 0; i < preparedList.length; i++) {
    const item = preparedList[i];
    const segLen = lengths[i];

    // Пауза в начале непервого сегмента (или в конце предыдущего)
    if (i > 0) {
      const boundaryPause =
        (preparedList[i - 1].prep.trailingSilenceSec || 0) +
        (item.prep.leadingSilenceSec || 0);
      if (boundaryPause > 0) {
        markers.push({
          relativePos: Math.max(0.02, Math.min(0.98, offsetChars / totalLen)),
          targetDurationSec: Math.min(4, boundaryPause),
        });
      }
    }

    for (const m of item.prep.markers) {
      const globalPos = (offsetChars + m.relativePos * segLen) / totalLen;
      markers.push({
        relativePos: Math.max(0.02, Math.min(0.98, globalPos)),
        targetDurationSec: m.targetDurationSec,
      });
    }

    // Если между сегментами была явная пауза, добавим <short pause> в конец предыдущей части для чистой VAD-точки
    let partText = item.prep.ttsText;
    if (
      i < preparedList.length - 1 &&
      ((item.prep.trailingSilenceSec || 0) > 0 ||
        (preparedList[i + 1].prep.leadingSilenceSec || 0) > 0) &&
      !partText.endsWith("<short pause>")
    ) {
      partText = `${partText} <short pause>`;
    }

    parts.push({
      text: partText,
      style: item.style,
    });
    offsetChars += segLen;
  }

  return { parts, markers, leadingSilenceSec, trailingSilenceSec };
}

async function synthesizeChunkPcm(
  ai: GoogleGenAI,
  params: {
    chunkText: string;
    style: string;
    styledParts?: StyledPartInput[];
    voiceId: string;
    characterVoiceId?: string;
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

  // Санитайзер политики Google прогоняет ТОЛЬКО поля стиля (speechMetadata.style), текст не трогает!
  const safeOverallStyle = sanitizeStyleForGooglePolicy(params.style);
  const requestParts =
    params.styledParts && params.styledParts.length > 0
      ? params.styledParts.map((sp) => ({
          text: sp.text,
          speechMetadata: {
            speaker: prebuiltVoiceName,
            style: sanitizeStyleForGooglePolicy(sp.style),
          },
        }))
      : [
          {
            text: params.chunkText,
            speechMetadata: {
              speaker: prebuiltVoiceName,
              style: safeOverallStyle,
            },
          },
        ];

  const stylesSent = requestParts.map((p) => p.speechMetadata.style);
  console.log(
    `[TTS Gemini] model=${TTS_MODELS_CONFIG.ttsModel} voice=${prebuiltVoiceName}${
      params.characterVoiceId ? ` character=${params.characterVoiceId}` : ""
    } style="${stylesSent[0]?.slice(0, 180)}"`
  );
  if (geminiStyleObserver) {
    geminiStyleObserver({
      voiceName: prebuiltVoiceName,
      styles: stylesSent,
      characterVoiceId: params.characterVoiceId,
    });
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
          parts: requestParts as any,
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

    // Если Google отклонил запрос по политике/безопасности — сразу показываем понятную ошибку, НЕ пытаемся обойти фильтр!
    const finishReason = String(response.candidates?.[0]?.finishReason || "").toUpperCase();
    const blockReason = String((response as any)?.promptFeedback?.blockReason || "").toUpperCase();
    if (
      finishReason === "SAFETY" ||
      finishReason === "PROHIBITED_CONTENT" ||
      finishReason === "BLOCKLIST" ||
      finishReason === "SPII" ||
      blockReason === "SAFETY" ||
      blockReason === "PROHIBITED_CONTENT"
    ) {
      const policyErr: any = new Error(
        "Запрос отклонён политикой безопасности Google Gemini. Проверьте текст или выберите другую формулировку."
      );
      policyErr.code = "GOOGLE_POLICY_REFUSAL";
      policyErr.status = 400;
      throw policyErr;
    }

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
    if (err?.code === "GOOGLE_POLICY_REFUSAL" || isGoogleSafetyOrPolicyError(err)) {
      const policyErr: any = new Error(
        "Запрос отклонён политикой безопасности Google Gemini. Измените текст или описание задачи."
      );
      policyErr.code = "GOOGLE_POLICY_REFUSAL";
      policyErr.status = 400;
      throw policyErr;
    }

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

      const fallbackText =
        params.styledParts && params.styledParts.length > 0
          ? params.styledParts.map((sp) => sp.text).join(" ")
          : params.chunkText;
      const kieRes = await synthesizeViaKieAi({
        text: fallbackText,
        voiceName: prebuiltVoiceName,
        style: safeOverallStyle,
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
  characterVoiceId?: string;
  language: TtsLanguage;
  preset: TtsPreset;
  speed: number;
  directorStyle?: string;
  segments?: TtsDirectorSegment[];
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

  const charVoice = getCharacterVoiceById(params.characterVoiceId || params.voiceId);
  const effectiveVoiceId = charVoice
    ? charVoice.voiceId || charVoice.baseVoice || "Leda"
    : params.voiceId || "charon-history";
  const effectivePitch = charVoice ? clampPitchSemitones(charVoice.pitchSemitones) : 0;

  const cacheKey = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        v: 4,
        text: normalizedText,
        voiceId: effectiveVoiceId,
        characterVoiceId: charVoice?.id || "",
        pitchSemitones: effectivePitch,
        language: params.language || "uz",
        preset: params.preset || "auto",
        speed: clampedSpeed.toFixed(2),
        directorStyle: sanitizeStyleForGooglePolicy((params.directorStyle || "").trim()),
        segments: Array.isArray(params.segments)
          ? params.segments.map((s) => ({
              style: sanitizeStyleForGooglePolicy(s.style || ""),
              text: s.text,
            }))
          : [],
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
 * - Поддерживает персонажные голоса мультфильмов (characterVoiceId): baseStyle первым в speechMetadata.style,
 *   однопроходный сдвиг высоты + скорости (pitchSemitones + atempo) без лишних вызовов Gemini.
 * - Поддерживает прямую режиссёрскую установку (directorStyle) и посегментную смену эмоций/таймингов (segments)
 *   в ОДНОМ вызове gemini-3.8-flash-tts (0 доп. вызовов квоты!).
 * - Режет текст ТОЛЬКО по лимиту ~3 000 знаков (паузы [pauza 1s/2s/3s] НЕ тратят доп. вызовы TTS!).
 * - Порядок аудио-конвейера: VAD [pauza Ns] stretch -> однопроходный pitch shift + atempo speed -> WAV/MP3.
 */
export async function synthesizeTtsOvozlash(
  ai: GoogleGenAI,
  params: {
    text: string;
    voiceId: string;
    characterVoiceId?: string;
    language: TtsLanguage;
    preset: TtsPreset;
    speed: number;
    ownerUid: string;
    replicatedVoiceConfig?: any;
    directorStyle?: string;
    segments?: TtsDirectorSegment[];
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
  characterVoiceId?: string;
  pitchSemitones: number;
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

  // Резолвим мультяшного персонажа из каталога (поддерживаем как явный characterVoiceId, так и выбор в списке голосов)
  const charVoice = getCharacterVoiceById(params.characterVoiceId || params.voiceId);
  const resolvedVoiceId = charVoice
    ? charVoice.voiceId || charVoice.baseVoice || "Leda"
    : params.voiceId;
  const effectivePitchSemitones = charVoice ? clampPitchSemitones(charVoice.pitchSemitones) : 0;
  const effectiveReplicatedConfig = charVoice ? undefined : params.replicatedVoiceConfig;

  const normalizedText =
    params.language === "uz"
      ? normalizeUzbekSpeech(rawInput, { decimalStyle: "butun" })
      : canonicalizeTimedPauseTags(normalizeUzbekApostrophes(rawInput));

  const cleanDirectorStyle = sanitizeStyleForGooglePolicy(
    String(params.directorStyle || "").trim()
  );
  const cleanSegments: TtsDirectorSegment[] = Array.isArray(params.segments)
    ? params.segments
        .map((s) => ({
          timecode: s?.timecode ? String(s.timecode).trim() : undefined,
          style: sanitizeStyleForGooglePolicy(String(s?.style || cleanDirectorStyle || "").trim()),
          text:
            params.language === "uz"
              ? normalizeUzbekSpeech(String(s?.text || "").trim(), { decimalStyle: "butun" })
              : canonicalizeTimedPauseTags(normalizeUzbekApostrophes(String(s?.text || "").trim())),
        }))
        .filter((s) => s.text.length > 0)
    : [];

  const cacheKey = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        v: 4,
        text: normalizedText,
        voiceId: resolvedVoiceId,
        characterVoiceId: charVoice?.id || "",
        pitchSemitones: effectivePitchSemitones,
        language: params.language,
        preset: params.preset,
        speed: clampedSpeed.toFixed(2),
        directorStyle: cleanDirectorStyle,
        segments: cleanSegments.map((s) => ({ style: s.style, text: s.text })),
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
      ...(charVoice ? { characterVoiceId: charVoice.id } : {}),
      pitchSemitones: effectivePitchSemitones,
      ttsCallsUsed: 0,
      quotaRemaining: quota.remaining,
      quotaLimit: quota.limit,
      creditsCost: 0,
      synthesisWallTimeMs: Date.now() - t0,
    };
  }

  let textForSynthesis = normalizedText;
  let overallStyle = "";

  // Если передан явный режиссёрский стиль (из AI-Агента) — ставим baseStyle персонажа первым, затем режиссуру!
  if (cleanDirectorStyle) {
    overallStyle = enrichHumanStyleDirection(
      cleanDirectorStyle,
      clampedSpeed,
      params.language,
      charVoice?.baseStyle
    );
  } else {
    const styleResult = await buildTtsStyleAndAnnotatedText(ai, {
      text: normalizedText,
      preset: params.preset,
      speed: clampedSpeed,
      language: params.language,
    });
    textForSynthesis = styleResult.combinedTaggedText || normalizedText;
    overallStyle = charVoice
      ? composeCharacterAndStyle(charVoice.baseStyle, styleResult.overallStyle)
      : sanitizeStyleForGooglePolicy(styleResult.overallStyle);
  }

  const pcmParts: Buffer[] = [];
  let activeProvider: "google-gemini-tts" | "kie-gemini-tts" = "google-gemini-tts";
  let ttsCallsUsed = 0;
  const interChunkSilenceSamples = Math.round(
    24000 * (TTS_MODELS_CONFIG.interChunkSilenceMs / 1000) * clampedSpeed
  );

  // Режим А: Посегментная режиссура (если агент задал биты/таймкоды с меняющейся подачей) — группируем по ~3000 зн.
  if (cleanSegments.length > 1) {
    const segmentGroups: StyledPartInput[][] = [];
    let currentGroup: StyledPartInput[] = [];
    let currentLen = 0;

    for (const seg of cleanSegments) {
      const segPart: StyledPartInput = {
        text: seg.text,
        style: enrichHumanStyleDirection(
          seg.style || cleanDirectorStyle,
          clampedSpeed,
          params.language,
          charVoice?.baseStyle
        ),
      };
      if (
        currentGroup.length > 0 &&
        currentLen + seg.text.length > TTS_MODELS_CONFIG.chunkSplitThresholdChars
      ) {
        segmentGroups.push(currentGroup);
        currentGroup = [segPart];
        currentLen = seg.text.length;
      } else {
        currentGroup.push(segPart);
        currentLen += seg.text.length;
      }
    }
    if (currentGroup.length > 0) {
      segmentGroups.push(currentGroup);
    }

    for (let g = 0; g < segmentGroups.length; g++) {
      const preparedGroup = prepareStyledSegmentsForSingleCall(segmentGroups[g]);
      if (preparedGroup.parts.length === 0) continue;

      if (preparedGroup.leadingSilenceSec > 0) {
        pcmParts.push(
          Buffer.alloc(Math.round(24000 * preparedGroup.leadingSilenceSec * clampedSpeed) * 2, 0)
        );
      }

      const chunkRes = await synthesizeChunkPcm(ai, {
        chunkText: preparedGroup.parts.map((p) => p.text).join(" "),
        style: overallStyle,
        styledParts: preparedGroup.parts,
        voiceId: resolvedVoiceId,
        characterVoiceId: charVoice?.id,
        replicatedVoiceConfig: effectiveReplicatedConfig,
      });
      ttsCallsUsed += 1;
      if (chunkRes.provider === "kie-gemini-tts") {
        activeProvider = "kie-gemini-tts";
      }

      const stretched =
        preparedGroup.markers.length > 0
          ? stretchTimedPausesInPcm(chunkRes.pcm, preparedGroup.markers, clampedSpeed)
          : { pcm: chunkRes.pcm, matchedCount: 0, missedCount: 0, details: [] };

      pcmParts.push(stretched.pcm);

      if (preparedGroup.trailingSilenceSec > 0) {
        pcmParts.push(
          Buffer.alloc(Math.round(24000 * preparedGroup.trailingSilenceSec * clampedSpeed) * 2, 0)
        );
      } else if (g < segmentGroups.length - 1) {
        pcmParts.push(Buffer.alloc(interChunkSilenceSamples * 2, 0));
      }
    }
  } else {
    // Режим Б: Обычный синтез с нарезкой ТОЛЬКО по ~3 000 знаков по границам абзацев и предложений
    const rawChunks = splitTextIntoTtsChunks(
      textForSynthesis,
      TTS_MODELS_CONFIG.chunkSplitThresholdChars
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
        voiceId: resolvedVoiceId,
        characterVoiceId: charVoice?.id,
        replicatedVoiceConfig: effectiveReplicatedConfig,
      });
      ttsCallsUsed += 1;

      if (chunkRes.provider === "kie-gemini-tts") {
        activeProvider = "kie-gemini-tts";
      }

      // Растягиваем найденные VAD-паузы ровно до [pauza Ns] секунд вставкой нулевого PCM (0 доп. вызовов!)
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
  }

  const stitchedPcm =
    pcmParts.length > 0 ? Buffer.concat(pcmParts) : Buffer.alloc(24000 * 2, 0);

  // Однопроходный FFmpeg: pitch shift (0..4 пт) + speed (atempo) после VAD-пауз!
  const fxResult = await applyPitchAndSpeedPcm24k(
    stitchedPcm,
    effectivePitchSemitones,
    clampedSpeed
  );
  const finalPcm = fxResult.pcm;
  const durationSeconds = Math.max(1, Math.round((finalPcm.length / 48000) * 10) / 10);

  ensureStorageDir();
  const id = `tts_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const wavPath = path.join(TTS_STORAGE_DIR, `${id}.wav`);
  const mp3Path = path.join(TTS_STORAGE_DIR, `${id}.mp3`);

  const wavBuffer = buildWavFromPcm24k(finalPcm);
  fs.writeFileSync(wavPath, wavBuffer);
  await convertWavToMp3File(wavPath, mp3Path, finalPcm);

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
    ...(charVoice ? { characterVoiceId: charVoice.id } : {}),
    pitchSemitones: effectivePitchSemitones,
    ttsCallsUsed,
    quotaRemaining: quota.remaining,
    quotaLimit: quota.limit,
    creditsCost,
    synthesisWallTimeMs: Date.now() - t0,
  };
}
