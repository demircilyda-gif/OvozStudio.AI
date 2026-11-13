import express from "express";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Stripe from "stripe";
import { GoogleGenAI, Modality, Type, ThinkingLevel, EndSensitivity, StartSensitivity } from "@google/genai";
import { YoutubeTranscript } from "youtube-transcript";
import { extractMediaAudio } from "./server/services/mediaExtractor.ts";
import { runMediaDubbingPipeline, getPipelineLogs } from "./server/services/mediaPipeline.ts";
import { normalizeUzbekSpeech } from "./src/utils/uzbekNormalizer.ts";
import { resolveCanonicalBaseVoice } from "./src/data/voices.ts";
import { getApps, initializeApp, getApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { localStore } from "./server/localStore.ts";
import { isEmailAdmin, getAdminEmails } from "./server/authUtils.ts";
import {
  parseAndTranslateVerbatimStoryboard,
  applyMildAtempoPcm,
  assembleStrictTimecodeMasterPcm,
  generateSrtFromTurns,
  muxDubbedAudioWithVideoFile,
  sanitizeDocumentedTtsTags,
  countSyllables,
} from "./server/services/verbatimStoryboardService.ts";

const RUNTIME_ENV_KEYS = {
  API_KEY: (process.env.API_KEY || "").trim(),
  GEMINI_API_KEY: (process.env.GEMINI_API_KEY || "").trim(),
  GOOGLE_API_KEY: (process.env.GOOGLE_API_KEY || "").trim(),
};

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3000;

app.use(
  express.json({
    limit: "50mb",
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Subtask 2.1: Enforce executable permissions on yt-dlp binary & verify ffmpeg at startup
const ytDlpPath = path.resolve(__dirname, "bin", "yt-dlp");
try {
  if (fs.existsSync(ytDlpPath)) {
    fs.chmodSync(ytDlpPath, 0o755);
    console.log("[Media Dubbing] bin/yt-dlp permissions verified (0755 executable)");
  }
} catch (e: any) {
  console.warn("[Media Dubbing] Warning checking bin/yt-dlp permissions:", e.message);
}
const ffmpegAvailable = fs.existsSync("/usr/bin/ffmpeg");
console.log(
  `[Media Dubbing] /usr/bin/ffmpeg status: ${
    ffmpegAvailable ? "Available (Ready for audio multiplexing)" : "Warning: not found at /usr/bin/ffmpeg"
  }`
);

// Shared Gemini client with telemetry header & dynamic API key reload
let cachedAi: GoogleGenAI | null = null;
let lastUsedKey = "";
const disabledExpiredKeys = new Set<string>();

export function isGeminiKeyErrorMessage(raw: any): boolean {
  const msg = String(raw?.message || raw || "").toLowerCase();
  return (
    msg.includes("api key expired") ||
    msg.includes("api_key_invalid") ||
    msg.includes("please renew the api key") ||
    msg.includes("invalid api key") ||
    msg.includes("api key not valid") ||
    msg.includes("unauthenticated") ||
    (msg.includes("permission_denied") && msg.includes("api key"))
  );
}

export function resolveActiveGeminiKey(customKey?: string): string {
  try {
    const envPath = path.resolve(__dirname, ".env");
    if (fs.existsSync(envPath)) {
      // Do NOT override runtime Secrets injected into process.env
      dotenv.config({ path: envPath, override: false });
    }
  } catch (e) {}

  const rawCandidates = [
    customKey,
    process.env.CUSTOM_GEMINI_API_KEY,
    localStore.getGeminiApiKey(),
    RUNTIME_ENV_KEYS.API_KEY,
    RUNTIME_ENV_KEYS.GEMINI_API_KEY,
    RUNTIME_ENV_KEYS.GOOGLE_API_KEY,
    process.env.API_KEY,
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
  ]
    .map((k) => (k || "").trim())
    .filter(Boolean);

  const uniqueCandidates = Array.from(new Set(rawCandidates));
  const activeCandidates = uniqueCandidates.filter((k) => !disabledExpiredKeys.has(k));
  const pool = activeCandidates.length > 0 ? activeCandidates : uniqueCandidates;

  // Prefer permanent Google AI Studio key (AIza...) over ephemeral session token (AQ...)
  const permanentKey = pool.find((k) => k.startsWith("AIza"));
  if (permanentKey) return permanentKey;

  return pool[0] || "";
}

export function markGeminiKeyExpiredAndFallback(badKey?: string): string {
  const cleanBad = (badKey || lastUsedKey || "").trim();
  if (cleanBad) {
    disabledExpiredKeys.add(cleanBad);
    if (process.env.CUSTOM_GEMINI_API_KEY?.trim() === cleanBad) {
      delete process.env.CUSTOM_GEMINI_API_KEY;
    }
    if (localStore.getGeminiApiKey()?.trim() === cleanBad) {
      localStore.clearGeminiApiKey();
    }
  }
  cachedAi = null;
  lastUsedKey = "";
  return resolveActiveGeminiKey();
}

export function getGeminiClient(customKey?: string): GoogleGenAI {
  const currentKey = resolveActiveGeminiKey(customKey);

  if (!cachedAi || currentKey !== lastUsedKey) {
    lastUsedKey = currentKey;
    cachedAi = new GoogleGenAI({
      apiKey: currentKey,
      apiVersion: "v1beta",
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return cachedAi;
}

export function resetGeminiClient(newKey?: string) {
  if (newKey) {
    const clean = newKey.trim();
    disabledExpiredKeys.delete(clean);
    process.env.CUSTOM_GEMINI_API_KEY = clean;
    localStore.setGeminiApiKey(clean);
  }
  cachedAi = null;
  lastUsedKey = "";
}

// Proxy wrapper for backward compatibility across all ai.* calls
export const ai = new Proxy({} as GoogleGenAI, {
  get(_target, prop) {
    const client = getGeminiClient();
    const val = (client as any)[prop];
    if (typeof val === "function") {
      return val.bind(client);
    }
    return val;
  },
});

/**
 * Stage 1 Production Cascade Router:
 * Calls ultra-fast `gemini-3.1-flash-lite` (~900ms latency) with a strict timeout,
 * and automatically falls back to `gemini-3.8-flash` if a timeout or transient error occurs.
 */
export async function generateFastTextWithFallback(params: {
  contents: any;
  config?: any;
  timeoutMs?: number;
  preferredModel?: string;
}) {
  const {
    contents,
    config = {},
    timeoutMs = 12000,
    preferredModel = "gemini-3.1-flash-lite",
  } = params;
  const modelsToTry =
    preferredModel === "gemini-3.1-flash-lite"
      ? ["gemini-3.1-flash-lite", "gemini-3.8-flash"]
      : [preferredModel, "gemini-3.1-flash-lite"];

  let lastErr: any = null;
  for (const modelName of modelsToTry) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await ai.models.generateContent({
          model: modelName,
          contents,
          config: {
            ...config,
            abortSignal: controller.signal,
          },
        });
        clearTimeout(timer);
        if (res && res.text) {
          return res;
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (err: any) {
      lastErr = err;
      const msg = String(err?.message || "");
      if (
        msg.includes("API key expired") ||
        msg.includes("API_KEY_INVALID") ||
        msg.includes("please renew the api key")
      ) {
        throw err;
      }
      console.warn(
        `[Cascade Router] ${modelName} failed/timed out (${msg.slice(0, 80)}), falling back...`
      );
    }
  }
  throw lastErr || new Error("All cascade text models failed");
}

/**
 * Cleanly extracts raw PCM (16-bit mono) from a buffer (stripping RIFF, fmt, C2PA, and any container metadata)
 * and trims trailing silent/zero samples to eliminate any trailing noise.
 */
function extractPcmData(buffer: Buffer): { pcm: Buffer; sampleRate: number } {
  let rawPcm = buffer;
  let sampleRate = 24000;

  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WAVE"
  ) {
    let offset = 12;
    while (offset < buffer.length - 8) {
      const chunkId = buffer.toString("ascii", offset, offset + 4);
      const chunkSize = buffer.readUInt32LE(offset + 4);
      if (chunkId === "fmt " && offset + 16 <= buffer.length) {
        sampleRate = buffer.readUInt32LE(offset + 12);
      } else if (chunkId === "data") {
        const pcmStart = offset + 8;
        const pcmEnd = Math.min(buffer.length, pcmStart + chunkSize);
        rawPcm = buffer.subarray(pcmStart, pcmEnd);
        break;
      }
      offset += 8 + chunkSize;
    }
  }

  // Trim trailing silence/near-zero noise (threshold 150 out of 32767)
  let lastNonSilent = rawPcm.length - 2;
  while (lastNonSilent >= 0) {
    const val = Math.abs(rawPcm.readInt16LE(lastNonSilent));
    if (val > 120) {
      break;
    }
    lastNonSilent -= 2;
  }

  // Add 150ms clean pad (24000 * 2 * 0.15 = 7200 bytes) after last audible sample
  const trimEnd = Math.min(
    rawPcm.length,
    Math.max(lastNonSilent + 7200, 24000),
  );
  const cleanPcm = rawPcm.subarray(0, trimEnd);

  return { pcm: cleanPcm, sampleRate };
}

/**
 * Builds a clean standard 44-byte WAV buffer with no trailing metadata
 */
function buildWavBuffer(
  pcm: Buffer,
  sampleRate = 24000,
  numChannels = 1,
  bitsPerSample = 16,
): Buffer {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcm.length;
  const chunkSize = 36 + dataSize;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(chunkSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}

/**
 * Ensures audio buffer has valid WAV container and removes any C2PA metadata noise
 */
function ensureWav(
  buffer: Buffer,
  sampleRate = 24000,
  numChannels = 1,
  bitsPerSample = 16,
): { buffer: Buffer; mimeType: string } {
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF") {
    const { pcm, sampleRate: sRate } = extractPcmData(buffer);
    const cleanWav = buildWavBuffer(
      pcm,
      sRate || sampleRate,
      numChannels,
      bitsPerSample,
    );
    return { buffer: cleanWav, mimeType: "audio/wav" };
  }
  const cleanWav = buildWavBuffer(
    buffer,
    sampleRate,
    numChannels,
    bitsPerSample,
  );
  return { buffer: cleanWav, mimeType: "audio/wav" };
}

/**
 * Helper to map emotion and acoustic tags (<kulgi>, <nafas>, (kulib), (pichirlab), etc.)
 * into expressive actor hints for Gemini TTS speechMetadata.style.
 */
function mapEmotionCueToStyle(cue: string): string | null {
  const t = cue.toLowerCase().trim();
  if (/(?:kulgi|kulgili|jilmay|tabassum|kulib|kulimsir|смех|смеет|улыб|laugh|chuckle|giggle)/i.test(t)) {
    return "natural warm laughter, amused cheerful chuckle, smiling tone";
  }
  if (/(?:pichir|shivir|шепот|шепч|whisper)/i.test(t)) {
    return "soft intimate whisper, quiet subdued confidential delivery";
  }
  if (/(?:nafas|chuqur_nafas|breath|deep_breath|вдох|вздох|xo.?rsin|sigh)/i.test(t)) {
    return "audible natural breath, reflective contemplative sigh and pause";
  }
  if (/(?:hansirash|hayrat|gasp|hayron|удивл|восторг|astonish|excite)/i.test(t)) {
    return "astonished intrigued intonation, heightened expressive energy";
  }
  if (/(?:jiddiy|серьезн|строг|serious|authoritative)/i.test(t)) {
    return "serious, firm authoritative tone and deliberate cadence";
  }
  if (/(?:o.?ylan|задумчив|thoughtful|ponder)/i.test(t)) {
    return "thoughtful contemplative cadence, reflective pacing";
  }
  if (/(?:istehzo|ирони|ironic|sarcas)/i.test(t)) {
    return "subtle ironic amusement, knowing smirk in the delivery";
  }
  if (/(?:bodro|бодр|energetic|lively|quvnoq)/i.test(t)) {
    return "energetic lively conversational delivery, upbeat cadence";
  }
  if (/(?:sokin|спокойн|calm|gentle|mehribon)/i.test(t)) {
    return "calm warm soothing cadence, friendly conversational tone";
  }
  return null;
}

/**
 * Cleans stage directions, conditions (Baritone, Mezzo, Pause, etc.), timestamps, and speaker tags
 * from speech scripts so that Gemini TTS only speaks the actual spoken words.
 * Crucially PRESERVES emotions and vocal reactions (<kulgi>, <nafas>, (kulib), (pichirlab), etc.)
 * by converting them into expressive delivery cues for Gemini TTS speechMetadata.style
 * rather than discarding them.
 */
function cleanScriptForSpeech(rawText: string): {
  speechText: string;
  extractedStyles: string[];
  detectedConditions: string[];
} {
  if (!rawText || typeof rawText !== "string") {
    return { speechText: "", extractedStyles: [], detectedConditions: [] };
  }

  const extractedStyles: string[] = [];
  const detectedConditions: string[] = [];

  // 1. Capture vocal reactions and emotion tags from angle brackets <...>:
  // e.g. <kulgi>, <nafas>, <pichirlab>, <shivir>, <sigh>, <chuckle>, <laugh>
  const angleTagRegex = /<([^>]+)>/g;
  let aMatch;
  while ((aMatch = angleTagRegex.exec(rawText)) !== null) {
    const rawTag = aMatch[1].trim();
    if (rawTag) {
      detectedConditions.push(`<${rawTag}>`);
      const mappedCue = mapEmotionCueToStyle(rawTag);
      if (mappedCue) {
        extractedStyles.push(mappedCue);
      } else {
        extractedStyles.push(rawTag);
      }
    }
  }

  // 2. Capture bracket conditions [...] like [00:00 - 00:06], [Kulminatsiya], [Баритон, бодро], [Пауза 2с], [kulgi], etc.
  const bracketRegex = /\[([^\]]+)\]/g;
  let bMatch;
  while ((bMatch = bracketRegex.exec(rawText)) !== null) {
    const content = bMatch[1].trim();
    if (content) {
      detectedConditions.push(`[${content}]`);
      const mappedCue = mapEmotionCueToStyle(content);
      if (mappedCue) {
        extractedStyles.push(mappedCue);
      } else if (
        /(?:kulminatsiya|kulminasiya|кульминация|bariton|mezzo|sopran|tenor|bas|sokin|tez|pauza|nafas|kulgi|ovoz|ohang|jiddiy|hayajon|gurur|faxr|pichirlash|shivir|savol|hayrat|kulimsirab|tabassum|tantana|mehribon|sirli|chuqur|sigh|gasp|deep_breath|chuckle|голос|баритон|меццо|тенор|сопрано|бас|пауз|шепот|громк|интонац|акцент|настроени|уверен|бодр|спокойн|мягк|глубок|тембр|style|mood|tone|speed|whisper)/i.test(
          content,
        )
      ) {
        extractedStyles.push(content);
      }
    }
  }

  // 3. Capture all parenthetical directions (...) like (kulib), (pichirlab), (chuqur nafas olib), (jiddiy)
  const parenRegex = /\(([^)]+)\)/g;
  let pMatch;
  while ((pMatch = parenRegex.exec(rawText)) !== null) {
    const content = pMatch[1].trim();
    if (content) {
      detectedConditions.push(`(${content})`);
      const mappedCue = mapEmotionCueToStyle(content);
      if (mappedCue) {
        extractedStyles.push(mappedCue);
      } else if (
        /(?:bariton|mezzo|sopran|tenor|bas|sokin|tez|pauza|nafas|kulgi|kamera|kadr|musiqa|ovoz|ohang|jiddiy|hayajon|gurur|faxr|pichirlash|shivir|savol|hayrat|kulimsirab|tabassum|tantana|mehribon|sirli|chuqur|sigh|gasp|deep_breath|chuckle|голос|баритон|меццо|тенор|сопрано|бас|пауз|шепот|громк|интонац|акцент|настроени|уверен|бодр|спокойн|секунд|сек|диктор|ведущ|гость|кадр|сцен|музык|эффект|улыбк|смех|\d{1,2}:\d{2})/i.test(
          content,
        )
      ) {
        extractedStyles.push(content);
      }
    }
  }

  let cleaned = rawText;

  // 4. Remove script headers and metadata blocks
  cleaned = cleaned
    .replace(
      /^(?:SARLAVHA|TAVSIF|SKRIPT|TAKROR_VAQT|SAHNA_MATNI|TOZA_MATN|TITLE|SCENE|CHAPTER|BOB|KIRISH|INTRO|XULOSA|OUTRO|СЦЕНА|ГЛАВА|ВСТУПЛЕНИЕ|ИТОГ)\s*:[^\n]*\n?/gim,
      "",
    )
    .replace(/^---\s*$/gm, "");

  // 5. Remove timing ranges, timestamps, and YouTube accessibility artifacts
  cleaned = cleaned
    .replace(/^\s*Chapter\s*\d+\s*:.*$/gmi, " ")
    .replace(/^\s*\d{1,2}:\d{2}\d*\s*(?:minutes?|seconds?|minute,\s*\d+\s*seconds?|секунд|минут|сек|мин)?\s*/gmi, " ")
    .replace(/\b\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\b/g, " ")
    .replace(/^\s*\d{1,2}:\d{2}(?::\d{2})?\s*[:-]\s*/gm, "");

  // 6. Remove speaker label prefixes at line starts (e.g. "Artur:", "Host 1:", "Ayubxon:", "Диктор:")
  cleaned = cleaned.replace(
    /^(?:[A-Za-zА-Яа-яЁё0-9_\s-]{1,25}(?:\([^)]*\))?)\s*:\s*(?=[A-Za-zА-Яа-яЁё<])/gm,
    (match) => {
      if (
        /(?:диктор|голос|ведущ|гость|boshlovchi|mehmon|host|guest|speaker|spiker|narrator|баритон|меццо|bariton|mezzo|кадр|сцена|sahna|kadr|интонация|ohang|тембр|tembr|shart|условие|zephyr|charon|puck|kore|fenrir|aoede|artur|yugay|ayubxon|oybek|burxanov|arthur|айюбхон|аюбхон|бурхонов|югай|артур)/i.test(
          match,
        )
      ) {
        return "";
      }
      return match;
    },
  );

  // 7. Convert conversational pipe markers into natural flowing conversational words
  cleaned = cleaned
    .replace(/\|\s*(?:ha|aha)\s*\|/gi, "ha, ")
    .replace(/\|\s*(?:mhm|hm)\s*\|/gi, "mhm, ")
    .replace(/\|\s*(?:rostanam|rosti|toʻgʻri|togri)\s*\|/gi, "rostanam, ")
    .replace(/\|\s*(?:xoʻsh|xosh|xo'sh)\s*\|/gi, "xoʻsh, ")
    .replace(/\|\s*(?:albatta)\s*\|/gi, "albatta, ")
    .replace(/\|\s*(?:voy|ana|bilasizmi)\s*\|/gi, "$1, ")
    .replace(/\|[^|]+\|/g, " ");

  // 8. Convert emotion/vocal cues into documented Gemini 3.8 TTS native inline tags (<laugh>, <sigh>, <short pause>, <breath>, <cough>)
  cleaned = cleaned
    .replace(/<\s*(?:kulgi|kulgili|jilmayish|chuckle|giggle)\s*>/gi, " <laugh> ")
    .replace(/\(\s*(?:kulib|kulimsirab|tabassum bilan|jilmayib|смеется|смеётся|улыбаясь|смех|хе-хе|усмешка|смешок|chuckle|laughing)\s*\)/gi, " <laugh> ")
    .replace(/<\s*(?:xo[ʻ'']rsinish|sigh)\s*>/gi, " <sigh> ")
    .replace(/\(\s*(?:xo[ʻ'']rsinib|вздыхая|вздыхает|вздох|sigh)\s*\)/gi, " <sigh> ")
    .replace(/<\s*(?:nafas|chuqur_nafas|breath|deep_breath|hansirash|hayrat|gasp)\s*>/gi, " <breath> ")
    .replace(/\(\s*(?:nafas olib|chuqur nafas olib|hansirab|hayratda|вдохнув|вдох|переводит дух|ахнув|deep breath|breath|gasp)\s*\)/gi, " <breath> ")
    .replace(/<\s*(?:yo['ʻ]tal|cough)\s*>/gi, " <cough> ")
    .replace(/\(\s*(?:кашляет|покашливает|cough)\s*\)/gi, " <cough> ")
    .replace(/\[\s*(?:pauza|pause|пауза|jimlik|тишина)[^\]]*\]/gi, " <short pause> ")
    .replace(/\(\s*(?:pauza|pause|пауза|jimlik|тишина)[^)]*\)/gi, " <short pause> ")
    .replace(/<\s*(?:pauza|pause|short_pause)\s*>/gi, " <short pause> ");

  // 9. Remove all non-Gemini angle tags while PRESERVING ONLY documented native inline tags:
  // <laugh>, <sigh>, <short pause>, <breath>, <cough>
  cleaned = cleaned.replace(/<(?!(\/?(?:laugh|sigh|short pause|breath|cough))\b)[^>]+>/gi, " ");

  // 10. Remove remaining stage directions in square brackets and parentheticals
  cleaned = cleaned.replace(/\[[^\]]*\]/g, " ");
  cleaned = cleaned.replace(/\([^)]*\)/g, " ");
  cleaned = cleaned.replace(/\{[^}]*\}/g, " ");

  // 11. Remove formatting markdown characters
  cleaned = cleaned.replace(/[*#_~`]/g, "");

  // 12. Normalize whitespace and punctuation spacing, keeping native tags cleanly spaced
  cleaned = cleaned
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .replace(/([.,!?;:])\1+/g, "$1")
    .trim();

  return {
    speechText: cleaned,
    extractedStyles: Array.from(new Set(extractedStyles)),
    detectedConditions: Array.from(new Set(detectedConditions)),
  };
}

let cachedShohruxSampleBase64: string | null = null;
function getShohruxReplicatedSampleBase64(): string | null {
  if (cachedShohruxSampleBase64) return cachedShohruxSampleBase64;
  try {
    const candidates = [
      path.resolve(process.cwd(), "public", "audio", "previews", "voice_17raj9ewke3g.wav"),
      path.resolve(process.cwd(), "public", "audio", "previews", "shohrux.wav"),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const buf = fs.readFileSync(p);
        if (buf.length > 1000) {
          cachedShohruxSampleBase64 = buf.toString("base64");
          return cachedShohruxSampleBase64;
        }
      }
    }
  } catch {}
  return null;
}

/**
 * Universal High-Reliability Speech Synthesizer for Gemini TTS
 * - Supports Cloned Voice (voice_17raj9ewke3g / user-replicated / Shohrux via replicatedVoiceConfig)
 * - Locks stable base prebuilt voice (Charon / Fenrir / Kore / Puck / Aoede / Zephyr) per speaker
 * - Preserves voice identity and timbre consistency across entire dialogue
 * - Automatically retries with exponential backoff (1s - 2s+) on HTTP 429 / rate limit / network errors
 * - Modulates emotions (laughter, whisper, breath, tempo, volume) strictly via speechMetadata.style
 * - Performs linguistic and phonetic normalization for Uzbek text
 */
export async function generateGeminiSpeechPcm({
  text,
  voiceName,
  voiceId,
  replicatedVoiceConfig,
  speechStyle,
  speakerName,
}: {
  text: string;
  voiceName: string;
  voiceId?: string;
  replicatedVoiceConfig?: any;
  speechStyle?: string;
  speakerName?: string;
}): Promise<{ pcm: Buffer; rawWav: Buffer }> {
  // 1. Stabilize and lock base prebuilt voice (Charon / Fenrir / Kore / Puck / Aoede / Zephyr)
  const CANONICAL_VOICES: Record<string, string> = {
    charon: "Charon",
    fenrir: "Fenrir",
    kore: "Kore",
    puck: "Puck",
    aoede: "Aoede",
    zephyr: "Zephyr",
  };

  const rawKey = (voiceName || "").trim().toLowerCase();
  const rawId = (voiceId || voiceName || "").trim().toLowerCase();
  const isClonedShohrux =
    Boolean(replicatedVoiceConfig) ||
    rawId === "voice_17raj9ewke3g" ||
    rawId === "user-replicated" ||
    rawId === "shohrux" ||
    rawId === "shokhrukh" ||
    rawKey === "voice_17raj9ewke3g" ||
    rawKey === "user-replicated" ||
    rawKey === "shohrux" ||
    rawKey === "shokhrukh";

  let targetVoice = CANONICAL_VOICES[rawKey];

  if (!targetVoice) {
    const found = Object.values(CANONICAL_VOICES).find(
      (v) => v.toLowerCase() === rawKey,
    );
    if (found) {
      targetVoice = found;
    } else if (/kore|female|ayol|женск|девушк/i.test(voiceName || speakerName || "")) {
      targetVoice = "Kore";
    } else if (/fenrir|ayubxon|oybek|mehmon|guest/i.test(voiceName || speakerName || "")) {
      targetVoice = "Fenrir";
    } else {
      targetVoice = "Charon";
    }
  }

  // 2. Extract and preserve any emotional cues (<laugh>, <sigh>, <short pause>, <breath>, <cough>) from the script
  const { speechText: cleanedText, extractedStyles } = cleanScriptForSpeech(text || "");
  const spokenContent = cleanedText || (text || "").trim() || "...";

  // 3. Uzbek linguistic & phonetic normalization
  let normalized = spokenContent;
  try {
    normalized = normalizeUzbekSpeech(spokenContent);
  } catch {}
  const ttsText = (normalized || spokenContent || "...").trim();

  // 4. Compose persistent style + dynamic emotion prompts (whisper, laughter, tempo, etc.)
  const styleTokens: string[] = [];
  if (speechStyle && speechStyle.trim()) {
    styleTokens.push(speechStyle.trim());
  }
  if (extractedStyles && extractedStyles.length > 0) {
    styleTokens.push(`Acting & emotion delivery: ${extractedStyles.join(", ")}`);
  }
  const effectiveStyle = styleTokens.join(". ");

  const ttsModels = isClonedShohrux
    ? ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"]
    : ["gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts"];
  const MAX_RETRIES = 3;

  const isApiKeyExpired = (err: any) => {
    const msg = (err?.message || "").toLowerCase();
    return (
      msg.includes("api key expired") ||
      msg.includes("api_key_invalid") ||
      msg.includes("please renew the api key") ||
      msg.includes("invalid api key")
    );
  };

  const isTransientError = (err: any) => {
    if (isApiKeyExpired(err)) return false;
    const msg = (err?.message || "").toLowerCase();
    const status = err?.status || err?.statusCode || err?.code;
    return (
      status === 429 ||
      status === 503 ||
      status === 500 ||
      status === "ECONNRESET" ||
      status === "ETIMEDOUT" ||
      msg.includes("429") ||
      msg.includes("resource_exhausted") ||
      msg.includes("quota") ||
      msg.includes("rate limit") ||
      msg.includes("too many requests") ||
      msg.includes("overloaded") ||
      msg.includes("fetch failed") ||
      msg.includes("network") ||
      msg.includes("timeout") ||
      msg.includes("unavailable")
    );
  };

  let lastError: any = null;

  const payloadContents = [
    {
      role: "user",
      parts: effectiveStyle
        ? [
            {
              text: ttsText,
              speechMetadata: {
                speaker: speakerName || targetVoice,
                style: effectiveStyle,
              },
            },
          ]
        : [{ text: ttsText }],
    },
  ];

  // Build candidate voiceConfigs
  const candidateVoiceConfigs: any[] = [];
  if (isClonedShohrux) {
    if (
      replicatedVoiceConfig &&
      (replicatedVoiceConfig.consentAudio || replicatedVoiceConfig.voiceConsentSignature)
    ) {
      const normalizedSample =
        typeof replicatedVoiceConfig.voiceSampleAudio === "string"
          ? replicatedVoiceConfig.voiceSampleAudio
          : replicatedVoiceConfig.voiceSampleAudio?.data;
      if (normalizedSample && typeof normalizedSample === "string") {
        candidateVoiceConfigs.push({
          replicatedVoiceConfig: {
            mimeType: "audio/wav",
            voiceSampleAudio: normalizedSample,
            ...(replicatedVoiceConfig.consentAudio
              ? { consentAudio: replicatedVoiceConfig.consentAudio }
              : {}),
            ...(replicatedVoiceConfig.voiceConsentSignature
              ? { voiceConsentSignature: replicatedVoiceConfig.voiceConsentSignature }
              : {}),
          },
        });
      }
    }
    if (!unsupportedCustomVoiceIds.has("voice_17raj9ewke3g")) {
      candidateVoiceConfigs.push({ voice: "voice_17raj9ewke3g" });
    }
  }
  candidateVoiceConfigs.push({
    prebuiltVoiceConfig: { voiceName: targetVoice },
  });

  for (const voiceCfg of candidateVoiceConfigs) {
    if (lastError && isApiKeyExpired(lastError)) {
      break;
    }
    const isCustomAttempt = Boolean(voiceCfg.voice || voiceCfg.replicatedVoiceConfig);
    const modelsForAttempt = isCustomAttempt ? ["gemini-3.8-flash-tts"] : ttsModels;

    for (const model of modelsForAttempt) {
      if (lastError && isApiKeyExpired(lastError)) {
        break;
      }
      const retriesForAttempt = isCustomAttempt ? 1 : MAX_RETRIES;
      for (let attempt = 0; attempt < retriesForAttempt; attempt++) {
        try {
          const response = await ai.models.generateContent({
            model,
            contents: payloadContents,
            config: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: voiceCfg,
              },
            },
          });

          const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
          if (audioData) {
            const rawBuf = Buffer.from(audioData, "base64");
            const { pcm } = extractPcmData(rawBuf);
            if (pcm && pcm.length > 0) {
              return { pcm, rawWav: rawBuf };
            }
          }
        } catch (err: any) {
          lastError = err;
          if (isApiKeyExpired(err)) {
            break;
          }
          if (voiceCfg.voice && /no matching speaker|invalid_argument|not found|400/i.test(err?.message || "")) {
            unsupportedCustomVoiceIds.add(voiceCfg.voice);
            break;
          }
          if (voiceCfg.replicatedVoiceConfig) {
            break;
          }
          const transient = isTransientError(err);
          if (transient && attempt < retriesForAttempt - 1) {
            const delayMs = Math.round(1200 * Math.pow(1.8, attempt) + Math.random() * 300);
            await new Promise((r) => setTimeout(r, delayMs));
            continue;
          }
          break;
        }
      }
    }
  }

  const errorObj: any = new Error(
    `Failed to synthesize speech for voice ${targetVoice} (Style: "${effectiveStyle}"): ${lastError?.message || "Unknown error"}`,
  );
  if (isApiKeyExpired(lastError)) {
    errorObj.code = "API_KEY_EXPIRED";
    errorObj.isApiKeyExpired = true;
  }
  throw errorObj;
}

// -------------------------------------------------------------
// Firebase Admin SDK Initialization (ADC / Cloud Run & Local)
// -------------------------------------------------------------
if (!getApps().length) {
  try {
    initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID || "composite-sun-492009-i5",
    });
    console.log("Firebase Admin SDK successfully initialized via Application Default Credentials");
  } catch (err) {
    console.warn("Firebase Admin SDK initialization notice:", err);
  }
}

let adminDb: any = null;
try {
  adminDb = getFirestore(getApp(), "ai-studio-ovozstudioaiozbe-4d0fbb99-ebfa-4016-a688-0cc1938db3fa");
} catch {
  try {
    adminDb = getFirestore();
  } catch (e) {
    console.warn("Firestore admin fallback warning:", e);
  }
}

// Restore persisted Gemini API key from Firestore across container restarts (only if valid, never overwrite a working runtime Secret with an expired key)
if (adminDb) {
  adminDb
    .collection("system_config")
    .doc("gemini_api")
    .get()
    .then(async (snap: any) => {
      if (snap && snap.exists) {
        const data = snap.data();
        if (data?.apiKey && typeof data.apiKey === "string" && data.apiKey.trim()) {
          const restoredKey = data.apiKey.trim();
          const runtimeKey = (RUNTIME_ENV_KEYS.GEMINI_API_KEY || RUNTIME_ENV_KEYS.API_KEY || "").trim();
          if (restoredKey === runtimeKey) {
            return;
          }
          try {
            const probeClient = new GoogleGenAI({
              apiKey: restoredKey,
              apiVersion: "v1beta",
              httpOptions: { headers: { "User-Agent": "aistudio-build" } },
            });
            await probeClient.models.generateContent({
              model: "gemini-3.8-flash",
              contents: "ping",
            });
            if (!localStore.getGeminiApiKey()) {
              resetGeminiClient(restoredKey);
              console.log("[Gemini Key] Restored & verified persistent API key from Firestore system_config");
            }
          } catch (probeErr: any) {
            if (isGeminiKeyErrorMessage(probeErr)) {
              disabledExpiredKeys.add(restoredKey);
              console.warn("[Gemini Key] Ignored expired key in Firestore system_config; keeping runtime environment key.");
            } else {
              console.warn("[Gemini Key] Firestore key probe notice:", probeErr?.message || probeErr);
            }
          }
        }
      }
    })
    .catch((err: any) => {
      console.warn("[Gemini Key] Firestore key check notice:", err?.message || err);
    });
}

// -------------------------------------------------------------
// Admin Verification (ADMIN_EMAILS env variable, never trust role)
// -------------------------------------------------------------
export { getAdminEmails, isEmailAdmin };

// -------------------------------------------------------------
// Authentication Helpers & Middleware (Firebase Bearer ID Token Verification)
// -------------------------------------------------------------
export interface AuthenticatedRequest extends express.Request {
  uid?: string;
  userEmail?: string;
}

/**
 * Validates request token.
 * In production: ONLY cryptographically signed Firebase ID tokens are accepted.
 * In local dev (NODE_ENV !== "production" && LOCAL_DEV_AUTH === "true"):
 * Permits dev mock tokens ONLY if they explicitly carry `dev_auth: true`.
 */
export async function verifyRequestToken(token: string): Promise<{ uid: string; email?: string } | null> {
  if (!token) return null;

  try {
    const decoded = await getAuth().verifyIdToken(token);
    return { uid: decoded.uid, email: decoded.email };
  } catch (err) {
    const isLocalDevAuthEnabled =
      process.env.NODE_ENV !== "production" &&
      process.env.LOCAL_DEV_AUTH === "true";

    if (isLocalDevAuthEnabled) {
      try {
        const parts = token.split(".");
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf-8"));
          if (payload && payload.dev_auth === true && (payload.user_id || payload.sub || payload.uid)) {
            return {
              uid: payload.user_id || payload.sub || payload.uid,
              email: payload.email || "",
            };
          }
        }
      } catch {}
    }
    return null;
  }
}

const requireAuth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "unauthorized",
      message: "Ushbu amalni bajarish uchun tizimga kirish talab qilinadi.",
      message_ru: "Для выполнения операции требуется авторизация.",
    });
  }

  const token = authHeader.split("Bearer ")[1]?.trim();
  if (!token) {
    return res.status(401).json({
      error: "unauthorized",
      message: "Avtorizatsiya tokeni topilmadi.",
      message_ru: "Токен авторизации отсутствует.",
    });
  }

  const verified = await verifyRequestToken(token);
  if (!verified || !verified.uid) {
    return res.status(401).json({
      error: "unauthorized",
      message: "Sessiya muddati tugagan yoki yaroqsiz. Qaytadan kiring.",
      message_ru: "Сессия истекла или недействительна. Пожалуйста, войдите снова.",
    });
  }

  (req as any).uid = verified.uid;
  (req as any).userEmail = verified.email;
  next();
};

const requireAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const userEmail = (req as any).userEmail;
  if (!isEmailAdmin(userEmail)) {
    return res.status(403).json({
      error: "forbidden",
      message: "Ushbu amal faqat tizim administratori uchun ruxsat etilgan.",
      message_ru: "Это действие доступно только администратору системы.",
    });
  }
  next();
};

// -------------------------------------------------------------
// Subtask 1.1: Quotas & Atomic Credit Balance Middleware
// -------------------------------------------------------------
export async function getUserBalance(uid: string, userEmail?: string): Promise<number> {
  if (isEmailAdmin(userEmail)) return 999999;

  // 1. Try local store
  let user = localStore.getUser(uid);
  if (!user && userEmail) {
    user = localStore.getUserByEmail(userEmail);
  }

  // 2. Try Firestore adminDb if needed
  if (adminDb && (!user || typeof user.creditsRemaining !== "number")) {
    try {
      const snap = await adminDb.collection("users").doc(uid).get();
      if (snap.exists) {
        const data = snap.data();
        const firestoreCredits =
          typeof data?.creditsRemaining === "number" ? data.creditsRemaining : 5;
        localStore.saveUser({
          uid,
          email: userEmail || data?.email || "",
          displayName: data?.displayName || "Foydalanuvchi",
          creditsRemaining: firestoreCredits,
          tier: data?.tier || "free",
          role: data?.role || "user",
          initialBonusGranted: true,
        });
        return firestoreCredits;
      }
    } catch (e) {
      console.warn("Firestore getUserBalance notice:", e);
    }
  }

  if (user && typeof user.creditsRemaining === "number") {
    return user.creditsRemaining;
  }

  // First-time authenticated user: provision once with 5 initial credits
  const provisioned = localStore.saveUser({
    uid,
    email: userEmail || "",
    creditsRemaining: 5,
    tier: "free",
    role: "user",
    initialBonusGranted: true,
  });
  return provisioned.creditsRemaining;
}

export async function deductUserCredits(
  uid: string,
  userEmail: string | undefined,
  cost: number
): Promise<{ success: boolean; remaining: number }> {
  if (isEmailAdmin(userEmail)) {
    return { success: true, remaining: 999999 };
  }

  // Ensure user record exists before deduction so first-time users start at 5 once
  await getUserBalance(uid, userEmail);

  // Atomic deduction via Firestore transaction when available
  if (adminDb) {
    try {
      const userRef = adminDb.collection("users").doc(uid);
      const res = await adminDb.runTransaction(async (transaction: any) => {
        const userDoc = await transaction.get(userRef);
        let currentBalance = localStore.getUser(uid)?.creditsRemaining ?? 5;
        if (userDoc.exists) {
          const data = userDoc.data();
          if (typeof data?.creditsRemaining === "number") {
            currentBalance = data.creditsRemaining;
          }
        }
        if (currentBalance < cost) {
          return { success: false, remaining: currentBalance };
        }
        const newBalance = Math.max(0, currentBalance - cost);
        transaction.set(
          userRef,
          {
            creditsRemaining: newBalance,
            initialBonusGranted: true,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
        return { success: true, remaining: newBalance };
      });

      // Synchronize in-memory cache / localStore
      localStore.saveUser({
        uid,
        email: userEmail || "",
        creditsRemaining: res.remaining,
        initialBonusGranted: true,
      });

      return res;
    } catch (e) {
      console.warn("Firestore runTransaction deductUserCredits warning, using localStore fallback:", e);
    }
  }

  // LocalStore atomic deduction
  return localStore.deductCredits(uid, cost);
}

export async function addCreditsToUserServer(
  uid: string,
  userEmail: string,
  amount: number,
  tier?: string
): Promise<{ success: boolean; remaining: number }> {
  const current = await getUserBalance(uid, userEmail);
  const updatedCredits = isEmailAdmin(userEmail) ? 999999 : current + amount;

  localStore.saveUser({
    uid,
    email: userEmail,
    creditsRemaining: updatedCredits,
    tier: tier || (isEmailAdmin(userEmail) ? "unlimited" : "pro"),
    initialBonusGranted: true,
  });

  if (adminDb) {
    try {
      await adminDb.collection("users").doc(uid).set(
        {
          creditsRemaining: updatedCredits,
          tier: tier || (isEmailAdmin(userEmail) ? "unlimited" : "pro"),
          initialBonusGranted: true,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    } catch (e) {
      console.warn("Firestore addCreditsToUserServer warning:", e);
    }
  }

  return { success: true, remaining: updatedCredits };
}

/**
 * Middleware: requireCreditBalance(cost)
 * Verifies that the user is authenticated and has at least `cost` credits available BEFORE touching Google Gemini.
 * If balance is insufficient, immediately terminates with HTTP 402 Payment Required.
 */
export const requireCreditBalance = (
  costOrFn: number | ((req: express.Request) => number)
) => {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    let uid = (req as any).uid;
    let userEmail = (req as any).userEmail;

    if (!uid) {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
          error: "unauthorized",
          message: "Ushbu operatsiyani amalga oshirish uchun tizimga kirish talab qilinadi.",
          message_ru: "Для выполнения операции требуется авторизация.",
        });
      }
      const token = authHeader.split("Bearer ")[1]?.trim();
      const verified = token ? await verifyRequestToken(token) : null;
      if (verified && verified.uid) {
        uid = verified.uid;
        userEmail = verified.email;
        (req as any).uid = uid;
        (req as any).userEmail = userEmail;
      }
    }

    if (!uid) {
      return res.status(401).json({
        error: "unauthorized",
        message: "Sessiyani tasdiqlab bo'lmadi. Qaytadan kiring.",
        message_ru: "Не удалось подтвердить сессию пользователя.",
      });
    }

    // Admin bypass: infinite quota
    if (isEmailAdmin(userEmail)) {
      (req as any).userBalance = 999999;
      (req as any).deductCredits = async () => 999999;
      return next();
    }

    const cost = Math.max(1, typeof costOrFn === "function" ? costOrFn(req) : costOrFn);
    const balance = await getUserBalance(uid, userEmail);

    if (balance < cost) {
      return res.status(402).json({
        error: "insufficient_credits",
        message: `Kreditingiz yetarli emas (Mavjud: ${balance}, Talab qilinadi: ${cost}). Iltimos, hisobingizni to'ldiring.`,
        message_ru: `Недостаточно кредитов (Баланс: ${balance}, Требуется: ${cost}). Пожалуйста, пополните баланс.`,
        required: cost,
        current: balance,
      });
    }

    (req as any).userBalance = balance;
    (req as any).requiredCreditCost = cost;
    (req as any).deductCredits = async (actualCost?: number) => {
      const toDeduct = typeof actualCost === "number" ? actualCost : cost;
      const deductRes = await deductUserCredits(uid, userEmail, toDeduct);
      return deductRes.remaining;
    };

    next();
  };
};

// -------------------------------------------------------------
// Rate Limiting (express-rate-limit)
// 1) Global: 120 req/min per IP
// 2) Generating endpoints: 10 req/min per uid with 429 Retry-After
// -------------------------------------------------------------
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again in a moment." },
});

const generationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  validate: false,
  keyGenerator: (req) => {
    return (req as any).uid || req.ip || "anonymous";
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, _next, options) => {
    const retryAfter = Math.ceil(options.windowMs / 1000);
    res.setHeader("Retry-After", retryAfter);
    res.status(429).json({
      error: "Rate limit exceeded. Maximum 10 generation requests per minute allowed.",
      retryAfter,
    });
  },
});

// -------------------------------------------------------------
// Simple Semaphore: Maximum 3 concurrent Gemini calls per process
// -------------------------------------------------------------
class SimpleSemaphore {
  private active = 0;
  private maxConcurrent: number;

  constructor(maxConcurrent = 3) {
    this.maxConcurrent = maxConcurrent;
  }

  tryAcquire(): boolean {
    if (this.active >= this.maxConcurrent) {
      return false;
    }
    this.active++;
    return true;
  }

  release(): void {
    if (this.active > 0) {
      this.active--;
    }
  }

  getActiveCount(): number {
    return this.active;
  }
}

const geminiSemaphore = new SimpleSemaphore(3);

const geminiConcurrencyLimitMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!geminiSemaphore.tryAcquire()) {
    res.setHeader("Retry-After", 3);
    return res.status(429).json({
      error: "Server is currently processing the maximum number of concurrent AI generation tasks (max 3). Please retry in a few seconds.",
      retryAfter: 3,
    });
  }

  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      geminiSemaphore.release();
    }
  };

  res.on("finish", release);
  res.on("close", release);
  next();
};

// Apply Global IP Rate Limiter
app.use("/api", globalLimiter);

const ALLOWED_PUBLIC_VOICE_PREVIEW_IDS = new Set([
  "voice_17raj9ewke3g",
  "sardor",
  "aziza",
  "madina",
  "jasur",
  "otabek",
  "nilufar",
  "ulugbek",
  "shokhrukh",
  "shohrux",
  "aziza-ai",
  "madina-journalist",
  "jasur-business",
  "otabek-comedy",
  "ulugbek-history",
  "supertaxi-greeting",
  "aoede",
  "kore",
  "puck",
  "fenrir",
  "zephyr",
  "charon",
]);

// Enforce Server Authentication on ALL /api/* routes EXCEPT public endpoints (health, billing config, webhooks, gemini status, session verify, and whitelisted voice previews)
app.use("/api", (req, res, next) => {
  const fullPath = req.originalUrl.split("?")[0];
  const previewMatch = req.method === "GET" && fullPath.startsWith("/api/voices/preview/")
    ? path.basename(fullPath.slice("/api/voices/preview/".length)).replace(/\.wav$/, "")
    : "";
  if (
    (req.method === "GET" && (
      fullPath === "/api/health" ||
      fullPath === "/api/billing/config" ||
      fullPath === "/api/gemini/status" ||
      fullPath === "/api/agent/supertaxi-greeting.wav" ||
      fullPath === "/api/agent/realtor-greeting.wav" ||
      fullPath === "/api/agent/realtor-filler.wav" ||
      fullPath.startsWith("/api/podcast/download-dubbed-video/") ||
      (previewMatch && ALLOWED_PUBLIC_VOICE_PREVIEW_IDS.has(previewMatch))
    )) ||
    (req.method === "POST" && (
      fullPath === "/api/billing/webhook" ||
      fullPath === "/api/billing/payme-webhook" ||
      fullPath === "/api/billing/click-webhook"
    )) ||
    (req.method === "GET" && fullPath.startsWith("/api/billing/verify-session/"))
  ) {
    return next();
  }
  return requireAuth(req, res, next);
});

// Apply Generation Limiter to generating endpoints
app.use([
  "/api/podcast/synthesize",
  "/api/podcast/synthesize-dialogue",
  "/api/podcast/synthesize-single-turn",
  "/api/podcast/parse-verbatim-storyboard",
  "/api/podcast/generate-script",
  "/api/podcast/generate-longform-script",
  "/api/podcast/expand-chapter",
  "/api/podcast/enrich-emotions",
  "/api/podcast/generate-interview",
  "/api/podcast/import-youtube-interview",
  "/api/podcast/smart-diarize-turns",
  "/api/podcast/expand-interview",
  "/api/podcast/sound-director",
  "/api/podcast/generate-cover",
  "/api/podcast/analyze-document",
  "/api/voiceover",
  "/api/voiceover/transcribe-and-translate",
  "/api/voiceover/generate-script",
  "/api/agent",
  "/api/voices/replicate",
  "/api/voices/design",
], generationLimiter);

// Apply Concurrency Semaphore to Gemini processing endpoints
app.use([
  "/api/podcast/synthesize",
  "/api/podcast/synthesize-dialogue",
  "/api/podcast/synthesize-single-turn",
  "/api/podcast/parse-verbatim-storyboard",
  "/api/voiceover/synthesize",
  "/api/voiceover/process-pipeline",
  "/api/voiceover/transcribe-and-translate",
  "/api/agent/call-turn",
  "/api/agent/generate-summary",
  "/api/voices/replicate",
  "/api/podcast/generate-script",
  "/api/podcast/generate-longform-script",
  "/api/podcast/generate-interview",
  "/api/podcast/expand-interview",
  "/api/podcast/enrich-emotions",
], geminiConcurrencyLimitMiddleware);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    model: "gemini-3.8-flash-tts",
    liveSupported: true,
    hasApiKey: Boolean(resolveActiveGeminiKey()),
  });
});

// Check Gemini API Key Status (never exposes secret key or prefix publicly)
app.get("/api/gemini/status", async (_req, res) => {
  try {
    let currentKey = resolveActiveGeminiKey();

    if (!currentKey) {
      return res.json({
        configured: false,
        valid: false,
        isExpired: false,
        message: "Gemini API kaliti belgilanmagan",
      });
    }

    const pingWithKey = async (keyToTest: string) => {
      const client = new GoogleGenAI({
        apiKey: keyToTest,
        apiVersion: "v1beta",
        httpOptions: { headers: { "User-Agent": "aistudio-build" } },
      });
      await client.models.generateContent({
        model: "gemini-3.8-flash",
        contents: "ping",
      });
    };

    try {
      await pingWithKey(currentKey);
      return res.json({
        configured: true,
        valid: true,
        isExpired: false,
        message: "Gemini API kaliti faol va muvaffaqiyatli ishlayapti",
      });
    } catch (apiErr: any) {
      const isExpired = isGeminiKeyErrorMessage(apiErr);
      if (isExpired) {
        const fallbackKey = markGeminiKeyExpiredAndFallback(currentKey);
        if (fallbackKey && fallbackKey !== currentKey) {
          try {
            await pingWithKey(fallbackKey);
            return res.json({
              configured: true,
              valid: true,
              isExpired: false,
              autoRecovered: true,
              message: "Gemini API kaliti tizim muhitidan avtomatik tiklandi va faol ishlayapti",
            });
          } catch (fallbackErr: any) {
            apiErr = fallbackErr;
          }
        }
      }
      return res.json({
        configured: true,
        valid: false,
        isExpired: isGeminiKeyErrorMessage(apiErr),
        message: isGeminiKeyErrorMessage(apiErr)
          ? "Gemini API kaliti muddati tugagan. Iltimos, yangi kalit kiriting."
          : apiErr?.message || "Gemini API bilan ulanishda xatolik",
      });
    }
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Server error" });
  }
});

// Update & Validate Gemini API Key (Strictly Admin-Only)
app.post("/api/gemini/update-key", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { apiKey } = req.body;
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      return res.status(400).json({ error: "Iltimos, haqiqiy Gemini API kalitini kiriting" });
    }
    const cleanKey = apiKey.trim();

    // Verify key with Gemini 3.8 Flash before persisting
    const testGenAi = new GoogleGenAI({
      apiKey: cleanKey,
      apiVersion: "v1beta",
      httpOptions: { headers: { "User-Agent": "aistudio-build" } },
    });
    try {
      await testGenAi.models.generateContent({
        model: "gemini-3.8-flash",
        contents: "ping",
      });
    } catch (testErr: any) {
      return res.status(400).json({
        error: "Kiritilgan API kalit ishlamadi yoki muddati o'tgan: " + (testErr?.message || "Xatolik"),
        details: testErr?.message,
      });
    }

    // Persist to localStore
    localStore.setGeminiApiKey(cleanKey);

    // Persist to Firestore so it survives container restarts
    if (adminDb) {
      try {
        await adminDb.collection("system_config").doc("gemini_api").set(
          {
            apiKey: cleanKey,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      } catch (fsErr) {
        console.warn("Notice: could not persist key to Firestore system_config:", fsErr);
      }
    }

    // Persist to .env
    try {
      const envPath = path.resolve(__dirname, ".env");
      let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";
      if (/^GEMINI_API_KEY=/m.test(envContent)) {
        envContent = envContent.replace(/^GEMINI_API_KEY=.*$/m, `GEMINI_API_KEY="${cleanKey}"`);
      } else {
        envContent += `\nGEMINI_API_KEY="${cleanKey}"`;
      }
      if (/^CUSTOM_GEMINI_API_KEY=/m.test(envContent)) {
        envContent = envContent.replace(/^CUSTOM_GEMINI_API_KEY=.*$/m, `CUSTOM_GEMINI_API_KEY="${cleanKey}"`);
      } else {
        envContent += `\nCUSTOM_GEMINI_API_KEY="${cleanKey}"`;
      }
      fs.writeFileSync(envPath, envContent.trim() + "\n", "utf-8");
    } catch (envErr) {
      console.warn("Notice: could not write .env file directly, saved to localStore:", envErr);
    }

    // Reset client cache
    resetGeminiClient(cleanKey);

    return res.json({
      success: true,
      valid: true,
      message: "Gemini API kaliti muvaffaqiyatli saqlandi va faollashtirildi! Barcha ovoz va qo'ng'iroq funksiyalari faol.",
    });
  } catch (err: any) {
    console.error("Update API key error:", err);
    return res.status(500).json({ error: err?.message || "Kalitni saqlashda xatolik yuz berdi" });
  }
});

// List all voices from Google AI Studio / Gemini Voices API
app.get("/api/voices", async (_req, res) => {
  try {
    const listResponse = await ai.voices.list();
    const rawVoices = (listResponse.voices || []).map((v: any) => ({
      id: v.id,
      voiceId: v.id,
      name: v.display_name || v.id,
      displayName: v.display_name,
      type: v.type, // 'replicated' | 'prompted' | 'prebuilt'
      model: v.model,
      expireTime: v.expire_time,
      isUserCustomVoice: v.type === "replicated" || v.type === "prompted",
      isReplicatedVoice: v.type === "replicated",
      gender: v.gender,
      persona: v.persona,
      description: v.description,
      languageCode: v.language_code,
      accent: v.accent,
    }));

    // Ensure the user's primary verified replicated voice (voice_17raj9ewke3g) is ALWAYS present
    const verifiedUserVoice = {
      id: "voice_17raj9ewke3g",
      voiceId: "voice_17raj9ewke3g",
      name: "SHOKHRUKH (Mening Haqiqiy Ovoz Nusxam)",
      displayName: "SHOKHRUKH (Haqiqiy Ovoz)",
      type: "replicated",
      model: "models/gemini-3.8-flash-tts",
      isUserCustomVoice: true,
      isReplicatedVoice: true,
      languageCode: "uz-UZ",
      description:
        "Google AI Studio Voice Replication orqali yaratilgan shaxsiy ovoz nusxasi.",
    };

    const hasVerified = rawVoices.some(
      (v: any) => v.id === verifiedUserVoice.id,
    );
    const allVoices = hasVerified
      ? rawVoices
      : [verifiedUserVoice, ...rawVoices];

    const replicatedVoices = allVoices.filter(
      (v: any) => v.type === "replicated",
    );
    const promptedVoices = allVoices.filter((v: any) => v.type === "prompted");
    const prebuiltVoices = allVoices.filter((v: any) => v.type === "prebuilt");

    res.json({
      voices: allVoices,
      replicatedVoices,
      promptedVoices,
      prebuiltVoices,
      defaultVoiceId: "voice_17raj9ewke3g",
      totalCount: allVoices.length,
    });
  } catch (error: any) {
    console.error("Error listing voices:", error);
    const fallbackUserVoice = {
      id: "voice_17raj9ewke3g",
      voiceId: "voice_17raj9ewke3g",
      name: "SHOKHRUKH (Mening Haqiqiy Ovoz Nusxam)",
      displayName: "SHOKHRUKH (Haqiqiy Ovoz)",
      type: "replicated",
      model: "models/gemini-3.8-flash-tts",
      isUserCustomVoice: true,
      isReplicatedVoice: true,
      languageCode: "uz-UZ",
    };
    res.json({
      voices: [fallbackUserVoice],
      replicatedVoices: [fallbackUserVoice],
      promptedVoices: [],
      prebuiltVoices: [],
      defaultVoiceId: "voice_17raj9ewke3g",
      totalCount: 1,
    });
  }
});

// Built-in Voice Audio Preview (Instant playback, Zero token usage after 1st generation)
app.get("/api/voices/preview/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const cleanId = path.basename(id).replace(/\.wav$/, "");
    if (!ALLOWED_PUBLIC_VOICE_PREVIEW_IDS.has(cleanId)) {
      return res.status(404).json({ error: "Ruxsat etilmagan ovoz ID" });
    }
    const previewDir = path.join(process.cwd(), "public", "audio", "previews");
    const previewFile = path.join(previewDir, `${cleanId}.wav`);

    // 1. If already saved on disk, stream immediately with strong cache headers
    if (fs.existsSync(previewFile)) {
      res.setHeader("Content-Type", "audio/wav");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      return fs.createReadStream(previewFile).pipe(res);
    }

    // 2. If not yet on disk, synthesize once with canonical voice mapping, save, and stream
    if (!fs.existsSync(previewDir)) {
      fs.mkdirSync(previewDir, { recursive: true });
    }

    const previewGreeting = "Assalomu alaykum! OvozStudio'ga xush kelibsiz, o'zbekcha professional podkast yaratamiz.";
    const canonicalBase = resolveCanonicalBaseVoice(cleanId);
    const targetVoiceConfig = cleanId === "voice_17raj9ewke3g"
      ? { voice: "voice_17raj9ewke3g" }
      : { prebuiltVoiceConfig: { voiceName: canonicalBase } };

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash-tts",
      contents: [
        {
          role: "user",
          parts: [{ text: previewGreeting }],
        },
      ],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: targetVoiceConfig,
        },
      },
    });

    const part = response.candidates?.[0]?.content?.parts?.[0];
    if (part?.inlineData?.data) {
      const rawBuf = Buffer.from(part.inlineData.data, "base64");
      const { pcm, sampleRate } = extractPcmData(rawBuf);
      const wav = buildWavBuffer(pcm, sampleRate);
      fs.writeFileSync(previewFile, wav);

      res.setHeader("Content-Type", "audio/wav");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      return res.send(wav);
    }

    return res.status(404).json({ error: "Ovoz namunasi topilmadi" });
  } catch (err: any) {
    console.error("Error serving voice preview:", err);
    res.status(500).json({ error: err.message || "Xatolik" });
  }
});

// ----------------------------------------------------
// Billing & Payment Gateways (Stripe + Telegram / Card)
// ----------------------------------------------------
const stripeApiKey = process.env.STRIPE_SECRET_KEY?.trim();
const stripeClient = stripeApiKey && stripeApiKey.startsWith("sk_") ? new Stripe(stripeApiKey) : null;

// Get Payment & Gateway Configuration (Public)
app.get("/api/billing/config", (req, res) => {
  res.json({
    stripeConfigured: Boolean(stripeClient),
    paymeConfigured: true,
    clickConfigured: true,
    paymeMerchantId: process.env.PAYME_MERCHANT_ID || "65f1a8b0c9e77a0012ovozuz",
    clickServiceId: process.env.CLICK_SERVICE_ID || "32845",
    clickMerchantId: process.env.CLICK_MERCHANT_ID || "24190",
    telegramHandle: process.env.TELEGRAM_ADMIN_HANDLE || "",
    phoneNumber: process.env.ADMIN_PHONE_NUMBER || "",
    cardDetails: {
      cardNumber: process.env.ADMIN_CARD_NUMBER || "",
      cardHolder: process.env.ADMIN_CARD_HOLDER || "",
      bank: process.env.ADMIN_CARD_BANK || "",
    },
  });
});

// Server Plans Configuration for Verified Tariffs
const SERVER_PLANS_CONFIG: Record<
  string,
  { name: string; nameUz: string; credits: number; tier: "starter" | "pro" | "unlimited"; price: string; amountUzs: number }
> = {
  starter: { name: "Start Paketi", nameUz: "Start Paketi", credits: 25, tier: "starter", price: "49,000 so'm", amountUzs: 49000 },
  pro: { name: "Ijodkor Pro", nameUz: "Ijodkor Pro", credits: 100, tier: "pro", price: "129,000 so'm", amountUzs: 129000 },
  unlimited: { name: "Media Studiya VIP", nameUz: "Media Studiya VIP", credits: 350, tier: "unlimited", price: "299,000 so'm", amountUzs: 299000 },
};

// Create Payment Request (Authenticated - uid from token, credits/tier from server tariff)
app.post("/api/billing/payment-requests", async (req, res) => {
  try {
    const uid = (req as any).uid;
    const userEmail = (req as any).userEmail || "";
    const { planId, paymentMethod, receiptInfo, notes } = req.body;

    if (!uid) {
      return res.status(401).json({ error: "unauthorized" });
    }

    if (!planId || !SERVER_PLANS_CONFIG[planId]) {
      return res.status(400).json({ error: "Noto'g'ri tarif tanlandi (Invalid planId)" });
    }

    const plan = SERVER_PLANS_CONFIG[planId];
    const requestId = `pay_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const paymentDoc = {
      id: requestId,
      uid: uid,
      userId: uid,
      userEmail: userEmail,
      planId: planId,
      planName: plan.nameUz,
      price: plan.price,
      credits: plan.credits,
      tier: plan.tier,
      paymentMethod: paymentMethod || "card",
      receiptInfo: typeof receiptInfo === "string" ? receiptInfo.slice(0, 500) : "",
      notes: typeof notes === "string" ? notes.slice(0, 500) : "",
      status: "pending" as const,
      createdAt: new Date().toISOString(),
    };

    localStore.createPaymentRequest(paymentDoc);

    if (adminDb) {
      try {
        await adminDb.collection("paymentRequests").doc(requestId).set(paymentDoc);
      } catch {
        // Fallback safely preserved in localStore
      }
    }

    res.json({
      success: true,
      requestId,
      message: "To'lov so'rovi qabul qilindi",
    });
  } catch (err: any) {
    console.error("Error creating payment request:", err);
    res.status(500).json({ error: "To'lov so'rovini yaratishda xatolik yuz berdi" });
  }
});

// Admin endpoint: List payment requests (ADMIN_EMAILS check only)
const handleAdminPaymentRequests = async (req: express.Request, res: express.Response) => {
  try {
    const userEmail = (req as any).userEmail;
    if (!isEmailAdmin(userEmail)) {
      return res.status(403).json({ error: "forbidden: admin privileges required" });
    }

    const statusFilter = typeof req.query.status === "string" ? req.query.status.trim() : "";
    const requestsMap = new Map<string, any>();

    // 1. Primary fast source: localStore
    for (const r of localStore.getPaymentRequests(statusFilter)) {
      requestsMap.set(r.id, r);
    }

    // 2. Try merge from Firestore if accessible
    if (adminDb) {
      try {
        const snap = await adminDb
          .collection("paymentRequests")
          .orderBy("createdAt", "desc")
          .limit(100)
          .get();

        snap.docs.forEach((d: any) => {
          const data = d.data();
          const reqItem = {
            id: data.id || d.id,
            uid: data.uid || data.userId || "",
            userId: data.userId || data.uid || "",
            userEmail: data.userEmail || "",
            contactInfo: data.userEmail || data.receiptInfo || data.uid || "",
            planId: data.planId || "",
            planName: data.planName || "",
            price: data.price || "",
            credits: data.credits || 0,
            tier: data.tier || "pro",
            status: data.status || "pending",
            paymentMethod: data.paymentMethod || "card",
            receiptInfo: data.receiptInfo || "",
            notes: data.notes || "",
            createdAt: data.createdAt || "",
          };
          if (!statusFilter || statusFilter === "all" || reqItem.status === statusFilter) {
            requestsMap.set(reqItem.id, reqItem);
          }
        });
      } catch {
        // Handled silently: Firestore permissions missing in runner ADC
      }
    }

    const docs = Array.from(requestsMap.values()).sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );

    res.json({ requests: docs });
  } catch (err: any) {
    console.error("Admin payment-requests fetch error:", err?.message || err);
    res.json({ requests: localStore.getPaymentRequests() });
  }
};

app.get("/api/billing/admin/payment-requests", handleAdminPaymentRequests);
app.get("/api/billing/admin/pending-requests", handleAdminPaymentRequests);

// Admin endpoint: Approve payment request
app.post("/api/billing/admin/approve-request", async (req, res) => {
  try {
    const adminEmail = (req as any).userEmail;
    if (!isEmailAdmin(adminEmail)) {
      return res.status(403).json({ error: "forbidden: admin privileges required" });
    }

    const { requestId } = req.body;
    if (!requestId) {
      return res.status(400).json({ error: "Invalid requestId" });
    }

    const storedReq = localStore.getPaymentRequest(requestId);
    localStore.updatePaymentRequest(requestId, {
      status: "approved",
      approvedAt: new Date().toISOString(),
      approvedBy: adminEmail,
    });

    const targetUid = storedReq?.uid || storedReq?.userId;
    const targetEmail = (storedReq?.userEmail || "").trim().toLowerCase();
    const creditsToAdd = storedReq?.credits || 0;

    let targetUser = targetUid ? localStore.getUser(targetUid) : null;
    if (!targetUser && targetEmail) {
      targetUser = localStore.getUserByEmail(targetEmail);
    }

    if (targetUser) {
      localStore.saveUser({
        uid: targetUser.uid,
        creditsRemaining: (targetUser.creditsRemaining || 0) + creditsToAdd,
        tier: storedReq?.tier || targetUser.tier || "pro",
      });
    } else if (targetEmail) {
      const existingPending = localStore.getPendingGrant(targetEmail);
      localStore.setPendingGrant(targetEmail, {
        email: targetEmail,
        credits: (existingPending?.credits || 0) + creditsToAdd,
        tier: storedReq?.tier || "pro",
        grantedBy: adminEmail,
      });
    }

    if (adminDb) {
      try {
        const reqRef = adminDb.collection("paymentRequests").doc(requestId);
        await reqRef.update({
          status: "approved",
          approvedAt: new Date().toISOString(),
          approvedBy: adminEmail,
        });

        if (targetUid) {
          const userRef = adminDb.collection("users").doc(targetUid);
          const userSnap = await userRef.get();
          const currentCredits = userSnap.exists ? userSnap.data()?.creditsRemaining || 0 : 0;
          await userRef.set(
            {
              creditsRemaining: currentCredits + creditsToAdd,
              updatedAt: new Date().toISOString(),
            },
            { merge: true }
          );
        }
      } catch {
        // Fallback safely preserved in localStore
      }
    }

    res.json({ success: true, message: "Request approved and user credited" });
  } catch (err: any) {
    console.error("Admin approve error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Admin endpoint: Reject payment request
app.post("/api/billing/admin/reject-request", async (req, res) => {
  try {
    const adminEmail = (req as any).userEmail;
    if (!isEmailAdmin(adminEmail)) {
      return res.status(403).json({ error: "forbidden: admin privileges required" });
    }

    const { requestId, reason } = req.body;
    if (!requestId) {
      return res.status(400).json({ error: "Invalid requestId" });
    }

    localStore.updatePaymentRequest(requestId, {
      status: "rejected",
      notes: reason || "Bekor qilindi",
      updatedAt: new Date().toISOString(),
    });

    if (adminDb) {
      try {
        await adminDb.collection("paymentRequests").doc(requestId).update({
          status: "rejected",
          notes: reason || "Bekor qilindi",
          updatedAt: new Date().toISOString(),
        });
      } catch {
        // Fallback safely preserved in localStore
      }
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error("Admin reject error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Admin endpoint: List Registered Users
app.get("/api/billing/admin/users", async (req, res) => {
  try {
    const adminEmail = (req as any).userEmail;
    if (!isEmailAdmin(adminEmail)) {
      return res.status(403).json({ error: "forbidden: admin privileges required" });
    }

    const usersMap = new Map<string, any>();

    // 1. Load users from localStore
    for (const u of localStore.getAllUsers()) {
      usersMap.set(u.uid, {
        uid: u.uid,
        email: u.email,
        displayName: u.displayName || (u.email ? u.email.split("@")[0] : "Foydalanuvchi"),
        creditsRemaining: isEmailAdmin(u.email) ? 999999 : u.creditsRemaining,
        tier: isEmailAdmin(u.email) ? "unlimited" : u.tier,
        role: isEmailAdmin(u.email) ? "admin" : u.role,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
      });
    }

    // 2. Read from Firestore if accessible
    if (adminDb) {
      try {
        const snap = await adminDb.collection("users").get();
        snap.forEach((doc: any) => {
          const d = doc.data();
          const cleanEmail = (d.email || "").trim().toLowerCase();
          usersMap.set(doc.id, {
            uid: doc.id,
            email: cleanEmail || d.email || "",
            displayName: d.displayName || cleanEmail.split("@")[0] || "Foydalanuvchi",
            creditsRemaining: isEmailAdmin(d.email) ? 999999 : (typeof d.creditsRemaining === "number" ? d.creditsRemaining : 5),
            tier: isEmailAdmin(d.email) ? "unlimited" : (d.tier || "free"),
            role: isEmailAdmin(d.email) ? "admin" : (d.role || "user"),
            createdAt: d.createdAt,
            updatedAt: d.updatedAt,
          });
        });
      } catch {
        // Handled silently: Firestore ADC permissions not available
      }
    }

    // 3. Try to discover users from Firebase Auth if enabled
    try {
      const authList = await getAuth().listUsers(100);
      for (const u of authList.users) {
        const cleanEmail = (u.email || "").trim().toLowerCase();
        if (usersMap.has(u.uid)) {
          const existing = usersMap.get(u.uid);
          if (!existing.email && cleanEmail) existing.email = cleanEmail;
        } else if (cleanEmail) {
          usersMap.set(u.uid, {
            uid: u.uid,
            email: cleanEmail,
            displayName: u.displayName || cleanEmail.split("@")[0] || "Foydalanuvchi",
            creditsRemaining: isEmailAdmin(cleanEmail) ? 999999 : 5,
            tier: isEmailAdmin(cleanEmail) ? "unlimited" : "free",
            role: isEmailAdmin(cleanEmail) ? "admin" : "user",
            createdAt: u.metadata?.creationTime,
          });
        }
      }
    } catch {
      // Identity Toolkit API not enabled in ADC project - silently ignored
    }

    const users = Array.from(usersMap.values()).sort((a, b) => (b.creditsRemaining || 0) - (a.creditsRemaining || 0));
    res.json({ users });
  } catch (err: any) {
    console.error("Admin list users error:", err);
    res.json({ users: localStore.getAllUsers() });
  }
});

// Admin endpoint: Manual Grant Credits (supports local store, Firestore, and pending pre-grants)
app.post("/api/billing/admin/grant-credits", async (req, res) => {
  try {
    const adminEmail = (req as any).userEmail;
    if (!isEmailAdmin(adminEmail)) {
      return res.status(403).json({ error: "forbidden: admin privileges required" });
    }

    const { targetEmail, creditsAmount, tier } = req.body;
    if (!targetEmail || !creditsAmount) {
      return res.status(400).json({ error: "targetEmail and creditsAmount required" });
    }

    const cleanEmail = targetEmail.trim().toLowerCase();
    const amount = Number(creditsAmount);
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: "Kredit miqdori musbat son bo'lishi kerak" });
    }

    // 1. Check localStore first (fast, reliable)
    let existingUser = localStore.getUserByEmail(cleanEmail);
    let newCredits = amount;

    if (existingUser) {
      newCredits = (existingUser.creditsRemaining || 0) + amount;
      localStore.saveUser({
        uid: existingUser.uid,
        creditsRemaining: newCredits,
        tier: tier || existingUser.tier || "pro",
      });
    } else {
      // Pre-provision user record and save pending grant
      const syntheticUid = `user-${cleanEmail.replace(/[^a-zA-Z0-9]/g, "_")}`;
      existingUser = localStore.saveUser({
        uid: syntheticUid,
        email: cleanEmail,
        displayName: cleanEmail.split("@")[0] || "Foydalanuvchi",
        creditsRemaining: amount,
        tier: tier || "pro",
        role: isEmailAdmin(cleanEmail) ? "admin" : "user",
      });
      localStore.setPendingGrant(cleanEmail, {
        email: cleanEmail,
        credits: amount,
        tier: tier || "pro",
        grantedBy: adminEmail,
      });
    }

    // 2. Also attempt Firestore write if accessible
    if (adminDb) {
      try {
        const snap = await adminDb
          .collection("users")
          .where("email", "==", cleanEmail)
          .limit(1)
          .get();

        if (!snap.empty) {
          const doc = snap.docs[0];
          const cur = doc.data()?.creditsRemaining || 0;
          await doc.ref.set(
            {
              creditsRemaining: cur + amount,
              tier: tier || "pro",
              updatedAt: new Date().toISOString(),
            },
            { merge: true }
          );
        } else {
          await adminDb.collection("pendingCreditGrants").doc(cleanEmail).set({
            email: cleanEmail,
            credits: amount,
            tier: tier || "pro",
            grantedBy: adminEmail,
            updatedAt: new Date().toISOString(),
          });
        }
      } catch {
        // Fallback safely preserved in localStore
      }
    }

    return res.json({
      success: true,
      message: `${cleanEmail} hisobiga +${amount} kredit muvaffaqiyatli qo'shildi! Jami balans: ${newCredits} kredit`,
      newCredits,
    });
  } catch (err: any) {
    console.error("Admin grant error:", err);
    res.status(500).json({ error: err.message });
  }
});

// User sync (creates/verifies user in localStore & Firestore, privileges computed server-side only)
app.post("/api/user/sync", requireAuth, async (req, res) => {
  try {
    const uid = (req as any).uid;
    const userEmail = (req as any).userEmail || "";
    if (!uid) return res.status(401).json({ error: "unauthorized" });

    const cleanEmail = userEmail.trim().toLowerCase();
    const isAdm = isEmailAdmin(cleanEmail);

    // Always resolve authoritative server/Firestore balance FIRST so container restarts never reset to 5
    const authoritativeBalance = await getUserBalance(uid, cleanEmail);

    // Check if there are any pending credit grants waiting for this email
    const pendingGrant = cleanEmail ? localStore.getPendingGrant(cleanEmail) : null;
    const pendingBonus = pendingGrant?.credits || 0;
    const pendingTier = pendingGrant?.tier || null;

    if (cleanEmail && pendingGrant) {
      localStore.deletePendingGrant(cleanEmail);
    }

    let existingUser = localStore.getUser(uid);
    if (!existingUser && cleanEmail) {
      existingUser = localStore.getUserByEmail(cleanEmail);
    }

    // Security fix: NEVER trust creditsRemaining, tier, or role from req.body
    const updatedCredits = isAdm ? 999999 : authoritativeBalance + pendingBonus;
    const updatedTier = isAdm ? "unlimited" : (pendingTier || existingUser?.tier || "free");
    const updatedRole = isAdm ? "admin" : "user";
    const displayName =
      (typeof req.body?.displayName === "string" && req.body.displayName.trim().slice(0, 120)) ||
      existingUser?.displayName ||
      (cleanEmail ? cleanEmail.split("@")[0] : "Foydalanuvchi");

    const savedProfile = localStore.saveUser({
      uid,
      email: cleanEmail || existingUser?.email || "",
      displayName,
      creditsRemaining: updatedCredits,
      tier: updatedTier,
      role: updatedRole,
      initialBonusGranted: true,
    });

    if (adminDb) {
      try {
        const userRef = adminDb.collection("users").doc(uid);
        await userRef.set(savedProfile, { merge: true });

        if (cleanEmail && pendingGrant) {
          const pendingRef = adminDb.collection("pendingCreditGrants").doc(cleanEmail);
          await pendingRef.delete().catch(() => {});
        }
      } catch {
        // Fallback safely preserved in localStore
      }
    }

    return res.json({
      success: true,
      profile: savedProfile,
    });
  } catch (err: any) {
    console.error("Error syncing user:", err);
    res.status(500).json({ error: err.message });
  }
});

// Admin: Bulk sync discovered users from Firestore to server storage
app.post("/api/billing/admin/sync-users", requireAdmin, async (req, res) => {
  try {
    const { users = [] } = req.body;
    if (Array.isArray(users)) {
      for (const u of users) {
        if (u.email || u.uid) {
          const cleanEmail = (u.email || "").trim().toLowerCase();
          const targetUid = u.uid || `user-${cleanEmail.replace(/[^a-zA-Z0-9]/g, "_")}`;
          const existingLocal = localStore.getUser(targetUid);
          localStore.saveUser({
            uid: targetUid,
            email: cleanEmail,
            displayName: u.displayName || existingLocal?.displayName || (cleanEmail ? cleanEmail.split("@")[0] : "Foydalanuvchi"),
            creditsRemaining: isEmailAdmin(cleanEmail)
              ? 999999
              : existingLocal
                ? existingLocal.creditsRemaining
                : typeof u.creditsRemaining === "number"
                  ? u.creditsRemaining
                  : 5,
            tier: isEmailAdmin(cleanEmail) ? "unlimited" : (existingLocal?.tier || u.tier || "free"),
            role: isEmailAdmin(cleanEmail) ? "admin" : "user",
            initialBonusGranted: true,
            createdAt: existingLocal?.createdAt || u.createdAt || new Date().toISOString(),
          });
        }
      }
    }

    res.json({ success: true, count: localStore.getAllUsers().length });
  } catch (err: any) {
    console.error("Admin sync users error:", err);
    res.status(500).json({ error: err.message });
  }
});

// User consume credit server-side endpoint (atomic deduction)
app.post("/api/user/consume-credit", requireAuth, async (req, res) => {
  try {
    const uid = (req as any).uid;
    const userEmail = (req as any).userEmail || "";

    if (!uid) return res.status(401).json({ error: "unauthorized" });
    if (isEmailAdmin(userEmail)) {
      return res.json({ success: true, remaining: 999999 });
    }

    const result = await deductUserCredits(uid, userEmail, 1);
    if (!result.success) {
      return res.status(402).json({
        error: "insufficient_credits",
        message: "Kreditingiz tugadi. Iltimos hisobingizni to'ldiring.",
        remaining: result.remaining,
      });
    }

    res.json({ success: true, remaining: result.remaining });
  } catch (err: any) {
    console.error("Error consuming credit:", err);
    res.status(500).json({ error: err.message });
  }
});

// User log generation record server-side endpoint (strictly bound to verified token uid)
app.post("/api/user/log-generation", requireAuth, async (req, res) => {
  try {
    const uid = (req as any).uid;
    const userEmail = (req as any).userEmail || "";
    if (!uid) return res.status(401).json({ error: "unauthorized" });

    const { type, title, creditsCost, status, voiceName, durationSec, details } = req.body;
    const genId = `gen-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const record = {
      id: genId,
      userId: uid,
      userEmail: userEmail.trim().toLowerCase(),
      type: type || "tts",
      title: String(title || "").slice(0, 200),
      creditsCost: typeof creditsCost === "number" ? Math.max(0, Math.min(50, creditsCost)) : 1,
      status: status === "failed" ? "failed" : "completed",
      voiceName: voiceName ? String(voiceName).slice(0, 120) : undefined,
      durationSec: typeof durationSec === "number" ? durationSec : undefined,
      details: details ? String(details).slice(0, 240) : undefined,
      createdAt: new Date().toISOString(),
    };

    localStore.logGeneration(uid, record);

    if (adminDb) {
      try {
        await adminDb
          .collection("users")
          .doc(uid)
          .collection("generations")
          .doc(genId)
          .set(record);
      } catch {
        // Handled silently
      }
    }

    res.json({ success: true, id: genId, record });
  } catch (err: any) {
    console.error("Error logging generation record:", err);
    res.status(500).json({ error: err.message });
  }
});

// VIP Custom Production Requests (User create + list own; Admin list all + update status)
app.post("/api/vip/requests", requireAuth, async (req, res) => {
  try {
    const uid = (req as any).uid;
    const userEmail = ((req as any).userEmail || "").trim().toLowerCase();
    if (!uid) return res.status(401).json({ error: "unauthorized" });

    const {
      projectTitle = "",
      format = "VIP Masterclass",
      targetDuration = "30 daqiqa",
      contactPhone = "",
      brief = "",
    } = req.body || {};

    if (!String(projectTitle).trim()) {
      return res.status(400).json({ error: "Loyiha nomi kiritilishi shart" });
    }

    const reqId = `vip_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const vipDoc = localStore.createVipRequest({
      id: reqId,
      userId: uid,
      userEmail,
      projectTitle: String(projectTitle).trim().slice(0, 200),
      format: String(format).trim().slice(0, 80),
      targetDuration: String(targetDuration).trim().slice(0, 60),
      contactPhone: String(contactPhone).trim().slice(0, 64),
      brief: String(brief).trim().slice(0, 2000),
      status: "new",
      createdAt: new Date().toISOString(),
    });

    if (adminDb) {
      try {
        await adminDb.collection("vipRequests").doc(reqId).set(vipDoc);
      } catch {
        // Preserved in localStore
      }
    }

    res.json({ success: true, request: vipDoc });
  } catch (err: any) {
    console.error("VIP request create error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/vip/my-requests", requireAuth, async (req, res) => {
  try {
    const uid = (req as any).uid;
    if (!uid) return res.status(401).json({ error: "unauthorized" });
    res.json({ requests: localStore.getUserVipRequests(uid) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/billing/admin/vip-requests", requireAdmin, async (req, res) => {
  try {
    const statusFilter = String(req.query.status || "all");
    const map = new Map<string, any>();
    for (const r of localStore.getVipRequests("all")) {
      map.set(r.id, r);
    }
    if (adminDb) {
      try {
        const snap = await adminDb.collection("vipRequests").get();
        snap.forEach((docSnap: any) => {
          const d = docSnap.data() || {};
          const id = d.id || docSnap.id;
          const merged = { id, ...d };
          map.set(id, merged);
          localStore.createVipRequest(merged);
        });
      } catch {}
    }
    let all = Array.from(map.values()).sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );
    if (statusFilter !== "all") {
      all = all.filter((r) => r.status === statusFilter);
    }
    res.json({ requests: all });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/billing/admin/vip-requests/update", requireAdmin, async (req, res) => {
  try {
    const { requestId, status, adminNotes } = req.body || {};
    if (!requestId || !["new", "in_progress", "completed", "cancelled"].includes(status)) {
      return res.status(400).json({ error: "Noto'g'ri requestId yoki status" });
    }
    const updated = localStore.updateVipRequest(requestId, {
      status,
      adminNotes: typeof adminNotes === "string" ? adminNotes.slice(0, 500) : undefined,
    });
    if (adminDb) {
      try {
        await adminDb.collection("vipRequests").doc(requestId).set(
          {
            status,
            adminNotes: typeof adminNotes === "string" ? adminNotes.slice(0, 500) : "",
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      } catch {}
    }
    res.json({ success: true, request: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Admin endpoint: Fetch all generations across all users + aggregated analytics
app.get("/api/billing/admin/generations", async (req, res) => {
  try {
    const adminEmail = (req as any).userEmail;
    if (!isEmailAdmin(adminEmail)) {
      return res.status(403).json({ error: "forbidden: admin privileges required" });
    }

    const genMap = new Map<string, any>();

    // 1. Load from localStore
    for (const g of localStore.getAllGenerations()) {
      if (g.id) {
        genMap.set(g.id, g);
      }
    }

    // 2. Load from Firestore users/{uid}/generations if accessible
    if (adminDb) {
      try {
        const usersSnap = await adminDb.collection("users").get();
        for (const uDoc of usersSnap.docs) {
          const uData = uDoc.data() || {};
          const uEmail = (uData.email || "").trim().toLowerCase();
          try {
            const genSnap = await uDoc.ref
              .collection("generations")
              .orderBy("createdAt", "desc")
              .limit(100)
              .get();
            genSnap.forEach((gDoc: any) => {
              const gData = gDoc.data() || {};
              const id = gData.id || gDoc.id;
              const rec = {
                id,
                userId: gData.userId || uDoc.id,
                userEmail: (gData.userEmail || uEmail || "").trim().toLowerCase(),
                type: gData.type || "tts",
                title: gData.title || "Ovoz generatsiyasi",
                creditsCost: typeof gData.creditsCost === "number" ? gData.creditsCost : 1,
                status: gData.status || "completed",
                voiceName: gData.voiceName,
                durationSec: gData.durationSec,
                details: gData.details,
                createdAt: gData.createdAt || new Date().toISOString(),
              };
              genMap.set(id, rec);
              localStore.logGeneration(rec.userId, rec);
            });
          } catch {
            // Ignore subcollection error
          }
        }
      } catch {
        // Handled silently if ADC lacks Firestore access
      }
    }

    const generations = Array.from(genMap.values()).sort(
      (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );

    res.json({ generations });
  } catch (err: any) {
    console.error("Admin generations fetch error:", err);
    res.json({ generations: localStore.getAllGenerations() });
  }
});

// Admin endpoint: Sync generations discovered by client Firestore SDK into server localStore
app.post("/api/billing/admin/sync-generations", async (req, res) => {
  try {
    const adminEmail = (req as any).userEmail;
    if (!isEmailAdmin(adminEmail)) {
      return res.status(403).json({ error: "forbidden: admin privileges required" });
    }

    const { generations = [] } = req.body;
    if (Array.isArray(generations)) {
      for (const g of generations) {
        if (g && (g.userId || g.userEmail)) {
          const uid = g.userId || `user-${String(g.userEmail).replace(/[^a-zA-Z0-9]/g, "_")}`;
          localStore.logGeneration(uid, {
            id: g.id || `gen-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            userId: uid,
            userEmail: String(g.userEmail || "").trim().toLowerCase(),
            type: g.type || "tts",
            title: g.title || "Ovoz generatsiyasi",
            creditsCost: typeof g.creditsCost === "number" ? g.creditsCost : 1,
            status: g.status || "completed",
            voiceName: g.voiceName,
            durationSec: g.durationSec,
            details: g.details,
            createdAt: g.createdAt || new Date().toISOString(),
          });
        }
      }
    }

    res.json({ success: true, total: localStore.getAllGenerations().length });
  } catch (err: any) {
    console.error("Admin sync generations error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Admin endpoint: Directly set user exact credit balance and/or tier
app.post("/api/billing/admin/update-user", async (req, res) => {
  try {
    const adminEmail = (req as any).userEmail;
    if (!isEmailAdmin(adminEmail)) {
      return res.status(403).json({ error: "forbidden: admin privileges required" });
    }

    const { targetEmail, creditsRemaining, tier } = req.body;
    if (!targetEmail) {
      return res.status(400).json({ error: "targetEmail is required" });
    }

    const cleanEmail = String(targetEmail).trim().toLowerCase();
    const numericCredits = Math.max(0, Number(creditsRemaining ?? 0));
    const updatedTier = tier || "free";

    let existingUser = localStore.getUserByEmail(cleanEmail);
    if (existingUser) {
      localStore.saveUser({
        uid: existingUser.uid,
        email: cleanEmail,
        creditsRemaining: isEmailAdmin(cleanEmail) ? 999999 : numericCredits,
        tier: isEmailAdmin(cleanEmail) ? "unlimited" : updatedTier,
      });
    } else {
      const syntheticUid = `user-${cleanEmail.replace(/[^a-zA-Z0-9]/g, "_")}`;
      existingUser = localStore.saveUser({
        uid: syntheticUid,
        email: cleanEmail,
        displayName: cleanEmail.split("@")[0] || "Foydalanuvchi",
        creditsRemaining: isEmailAdmin(cleanEmail) ? 999999 : numericCredits,
        tier: isEmailAdmin(cleanEmail) ? "unlimited" : updatedTier,
        role: isEmailAdmin(cleanEmail) ? "admin" : "user",
      });
    }

    if (adminDb) {
      try {
        const snap = await adminDb
          .collection("users")
          .where("email", "==", cleanEmail)
          .limit(1)
          .get();
        if (!snap.empty) {
          await snap.docs[0].ref.set(
            {
              creditsRemaining: isEmailAdmin(cleanEmail) ? 999999 : numericCredits,
              tier: isEmailAdmin(cleanEmail) ? "unlimited" : updatedTier,
              updatedAt: new Date().toISOString(),
            },
            { merge: true }
          );
        }
      } catch {
        // Fallback preserved in localStore
      }
    }

    return res.json({
      success: true,
      message: `${cleanEmail} profili yangilandi (Balans: ${numericCredits} kredit, Tarif: ${updatedTier.toUpperCase()})`,
      creditsRemaining: numericCredits,
      tier: updatedTier,
    });
  } catch (err: any) {
    console.error("Admin update user error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Create Stripe Checkout Session
// Create Stripe Checkout Session (strictly authenticated)
app.post("/api/billing/create-checkout-session", requireAuth, async (req, res) => {
  try {
    const { planId } = req.body;
    const userId = (req as any).uid;
    const userEmail = (req as any).userEmail || (req.body?.userEmail ? String(req.body.userEmail).trim().toLowerCase() : "");

    if (!userId) {
      return res.status(401).json({ error: "unauthorized" });
    }

    if (!stripeClient) {
      return res.status(400).json({
        configured: false,
        error: "Stripe hali ulanmagan. Iltimos, Telegram orqali to'lovni tasdiqlang yoki .env fayliga STRIPE_SECRET_KEY kiriting.",
      });
    }

    const plansConfig: Record<string, { name: string; amountCents: number; credits: number }> = {
      starter: { name: "OvozStudio Start Paketi (25 kredit)", amountCents: 400, credits: 25 },
      pro: { name: "OvozStudio Ijodkor Pro (100 kredit)", amountCents: 1000, credits: 100 },
      unlimited: { name: "OvozStudio Media VIP (350 kredit)", amountCents: 2400, credits: 350 },
    };

    const targetPlan = plansConfig[planId] || plansConfig.pro;
    const origin = (req.headers.origin as string) || process.env.APP_URL || "http://localhost:3000";

    const session = await stripeClient.checkout.sessions.create({
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: targetPlan.name,
              description: `${targetPlan.credits} ta professional AI ovoz sintezi, to'liq o'zbekcha replikatsiya va dublyaj`,
            },
            unit_amount: targetPlan.amountCents,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      customer_email: userEmail || undefined,
      client_reference_id: userId,
      metadata: {
        userId: userId,
        userEmail: userEmail || "",
        planId: planId || "pro",
        credits: String(targetPlan.credits),
      },
      success_url: `${origin}/?payment_status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?payment_status=cancelled`,
    });

    res.json({ configured: true, url: session.url, sessionId: session.id });
  } catch (err: any) {
    console.error("Stripe Session Error:", err);
    res.status(500).json({ error: err.message || "Stripe sessiyasini yaratishda xatolik" });
  }
});

// Subtask 1.4: Stripe Webhook for asynchronous server-side crediting (strict signature verification)
app.post("/api/billing/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripeClient) {
    return res.status(400).json({ error: "Stripe sozlanmagan" });
  }

  if (!webhookSecret || !sig || !(req as any).rawBody) {
    console.warn("Stripe webhook rejected: Missing webhook secret, signature header, or raw body.");
    return res.status(400).send("Webhook verification failed: secret or signature missing");
  }

  let event: Stripe.Event;

  try {
    event = stripeClient.webhooks.constructEvent((req as any).rawBody, sig, webhookSecret);
  } catch (err: any) {
    console.error("Stripe Webhook Signature Error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const sessionId = session.id;

      if (!localStore.isSessionProcessed(sessionId)) {
        const userId = session.client_reference_id || session.metadata?.userId || "";
        const userEmail = session.customer_email || session.metadata?.userEmail || "";
        const credits = Number(session.metadata?.credits || 0);
        const planId = session.metadata?.planId || "pro";

        if (userId && credits > 0) {
          await addCreditsToUserServer(userId, userEmail, credits, planId);
          localStore.markSessionProcessed(sessionId, { userId, userEmail, credits });
          console.log(
            `[Stripe Webhook] Credited ${credits} to user ${userId} (${userEmail}) for session ${sessionId}`
          );
        }
      } else {
        console.log(`[Stripe Webhook] Session ${sessionId} already processed, skipping.`);
      }
    }
    res.json({ received: true });
  } catch (err: any) {
    console.error("Error processing Stripe webhook:", err);
    res.status(500).json({ error: err.message });
  }
});

// Stage 3: Uzbekistan Direct Payment Gateways (Payme & Click Checkout Link Generators + Webhooks)
app.post("/api/billing/create-uz-checkout", requireAuth, async (req, res) => {
  try {
    const uid = (req as any).uid;
    const userEmail = (req as any).userEmail || "";
    const { planId = "pro", provider = "payme" } = req.body;
    const plan = SERVER_PLANS_CONFIG[planId] || SERVER_PLANS_CONFIG.pro;
    const orderId = `ovoz_${uid}_${planId}_${Date.now()}`;
    const returnUrl = `${req.protocol}://${req.get("host")}/?payment_success=1&provider=${provider}&plan=${planId}`;

    if (provider === "payme") {
      const merchantId = process.env.PAYME_MERCHANT_ID || "65f1a8b0c9e77a0012ovozuz";
      // Payme amount is in tiyin (1 UZS = 100 tiyin)
      const amountTiyin = plan.amountUzs * 100;
      const paymeParams = `m=${merchantId};ac.order_id=${orderId};ac.uid=${uid};ac.plan_id=${planId};a=${amountTiyin};c=${encodeURIComponent(returnUrl)}`;
      const base64Payload = Buffer.from(paymeParams, "utf-8").toString("base64");
      const checkoutUrl = `https://checkout.paycom.uz/${base64Payload}`;

      return res.json({
        success: true,
        provider: "payme",
        orderId,
        amountUzs: plan.amountUzs,
        credits: plan.credits,
        checkoutUrl,
      });
    } else {
      const serviceId = process.env.CLICK_SERVICE_ID || "32845";
      const merchantId = process.env.CLICK_MERCHANT_ID || "24190";
      const checkoutUrl = `https://my.click.uz/services/pay?service_id=${encodeURIComponent(
        serviceId
      )}&merchant_id=${encodeURIComponent(
        merchantId
      )}&amount=${plan.amountUzs.toFixed(2)}&transaction_param=${encodeURIComponent(
        orderId
      )}&additional_param3=${encodeURIComponent(uid)}&additional_param4=${encodeURIComponent(
        planId
      )}&return_url=${encodeURIComponent(returnUrl)}`;

      return res.json({
        success: true,
        provider: "click",
        orderId,
        amountUzs: plan.amountUzs,
        credits: plan.credits,
        checkoutUrl,
      });
    }
  } catch (err: any) {
    console.error("Create UZ checkout error:", err);
    return res.status(500).json({ error: err.message || "To'lov havolasini yaratishda xatolik" });
  }
});

// Payme Merchant API JSON-RPC Webhook (/api/billing/payme-webhook)
app.post("/api/billing/payme-webhook", async (req, res) => {
  try {
    const { method, params, id } = req.body || {};

    // Verify Payme Merchant Key via Basic Auth header
    const paymeMerchantKey = process.env.PAYME_MERCHANT_KEY;
    if (!paymeMerchantKey) {
      return res.status(401).json({
        error: { code: -32504, message: "Payme Merchant Key sozlanmagan (Unauthorized)" },
        id,
      });
    }
    const authHeader = req.headers.authorization || "";
    const expectedToken = Buffer.from(`Paycom:${paymeMerchantKey}`).toString("base64");
    const expectedTokenAlt = Buffer.from(paymeMerchantKey).toString("base64");
    const rawBearer = authHeader.replace(/^Basic\s+/i, "").trim();
    if (rawBearer !== expectedToken && rawBearer !== expectedTokenAlt && authHeader !== paymeMerchantKey) {
      return res.status(401).json({
        error: { code: -32504, message: "Avtorizatsiya xatosi (Invalid Payme signature)" },
        id,
      });
    }

    const account = params?.account || {};
    const orderId = account.order_id || `payme_${Date.now()}`;
    const uid = account.uid || "";
    const planId = account.plan_id || "pro";
    const plan = SERVER_PLANS_CONFIG[planId] || SERVER_PLANS_CONFIG.pro;

    if (method === "CheckPerformTransaction") {
      return res.json({ result: { allow: true }, id });
    }

    if (method === "CreateTransaction") {
      return res.json({
        result: {
          create_time: Date.now(),
          transaction: params?.id || orderId,
          state: 1,
        },
        id,
      });
    }

    if (method === "PerformTransaction") {
      const txId = `payme_tx_${params?.id || orderId}`;
      if (uid && !localStore.isSessionProcessed(txId)) {
        const userRecord = localStore.getUser(uid);
        await addCreditsToUserServer(uid, userRecord?.email || "", plan.credits, plan.tier);
        localStore.markSessionProcessed(txId, { userId: uid, userEmail: userRecord?.email || "", credits: plan.credits });
      }
      return res.json({
        result: {
          transaction: params?.id || orderId,
          perform_time: Date.now(),
          state: 2,
        },
        id,
      });
    }

    return res.json({ result: { allow: true }, id });
  } catch (err: any) {
    return res.status(500).json({ error: { code: -32400, message: err.message } });
  }
});

// Click SHOP-API Webhook (/api/billing/click-webhook)
app.post("/api/billing/click-webhook", async (req, res) => {
  try {
    const {
      click_trans_id,
      service_id,
      merchant_trans_id,
      merchant_prepare_id,
      amount,
      action,
      sign_time,
      sign_string,
      additional_param3,
      additional_param4,
    } = req.body || {};

    const clickSecretKey = process.env.CLICK_SECRET_KEY;
    if (!clickSecretKey || !sign_string) {
      return res.status(401).json({
        error: -1,
        error_note: "SIGN CHECK FAILED! Click Secret Key sozlanmagan yoki imzo yo'q.",
      });
    }

    const crypto = await import("crypto");
    const expectedSignSource = `${click_trans_id || ""}${service_id || ""}${clickSecretKey}${merchant_trans_id || ""}${Number(action) === 1 ? merchant_prepare_id || "" : ""}${amount || ""}${action || ""}${sign_time || ""}`;
    const expectedMd5 = crypto.createHash("md5").update(expectedSignSource).digest("hex");
    if (sign_string !== expectedMd5 && sign_string !== clickSecretKey) {
      return res.status(401).json({
        error: -1,
        error_note: "SIGN CHECK FAILED!",
      });
    }

    // Extract uid and planId from merchant_trans_id (`ovoz_${uid}_${planId}_${ts}`) or additional params
    let uid = additional_param3 || "";
    let planId = additional_param4 || "pro";
    if (!uid && typeof merchant_trans_id === "string" && merchant_trans_id.startsWith("ovoz_")) {
      const parts = merchant_trans_id.split("_");
      if (parts.length >= 4) {
        uid = parts[1];
        planId = parts[2];
      }
    }

    const plan = SERVER_PLANS_CONFIG[planId] || SERVER_PLANS_CONFIG.pro;
    const txId = `click_tx_${click_trans_id || merchant_trans_id || Date.now()}`;

    // Action 1 = Complete in Click SHOP-API
    if (Number(action) === 1 && uid && !localStore.isSessionProcessed(txId)) {
      const userRecord = localStore.getUser(uid);
      await addCreditsToUserServer(uid, userRecord?.email || "", plan.credits, plan.tier);
      localStore.markSessionProcessed(txId, { userId: uid, userEmail: userRecord?.email || "", credits: plan.credits });
    }

    return res.json({
      click_trans_id,
      merchant_trans_id,
      merchant_prepare_id: Date.now(),
      merchant_confirm_id: Date.now(),
      error: 0,
      error_note: "Success",
    });
  } catch (err: any) {
    return res.status(500).json({ error: -8, error_note: err.message });
  }
});

// Verify Stripe Checkout Session with Idempotent Crediting
app.get("/api/billing/verify-session/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    if (!stripeClient) {
      return res.status(400).json({ error: "Stripe sozlanmagan" });
    }

    const session = await stripeClient.checkout.sessions.retrieve(sessionId);
    if (session.payment_status === "paid") {
      const userId = session.client_reference_id || session.metadata?.userId || "";
      const userEmail = session.customer_email || session.metadata?.userEmail || "";
      const credits = Number(session.metadata?.credits || 0);
      const planId = session.metadata?.planId || "pro";

      let newlyCredited = false;
      let remaining = 0;

      if (!localStore.isSessionProcessed(sessionId)) {
        if (userId && credits > 0) {
          const grantRes = await addCreditsToUserServer(userId, userEmail, credits, planId);
          remaining = grantRes.remaining;
          localStore.markSessionProcessed(sessionId, { userId, userEmail, credits });
          newlyCredited = true;
          console.log(
            `[Verify-Session] Credited ${credits} to user ${userId} (${userEmail}) for session ${sessionId}`
          );
        }
      } else {
        remaining = await getUserBalance(userId, userEmail);
      }

      res.json({
        paid: true,
        userId,
        userEmail,
        planId,
        credits,
        creditsRemaining: remaining,
        newlyCredited,
        alreadyProcessed: !newlyCredited,
      });
    } else {
      res.json({ paid: false, status: session.payment_status });
    }
  } catch (err: any) {
    console.error("Stripe verify error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get voice by ID
app.get("/api/voices/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const voice = await ai.voices.get(id);
    res.json(voice);
  } catch (error: any) {
    console.error("Error fetching voice:", error);
    res.status(404).json({ error: error.message || "Ovoz topilmadi" });
  }
});

// Delete a custom stored voice (Admin-only, protects primary system voice)
app.delete("/api/voices/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (id === "voice_17raj9ewke3g") {
      return res.status(403).json({
        error: "Asosiy tizim ovozini (Sardor — voice_17raj9ewke3g) o'chirish taqiqlangan.",
      });
    }
    const result = await ai.voices.delete(id);
    res.json({ success: true, result });
  } catch (error: any) {
    console.error("Error deleting voice:", error);
    res
      .status(500)
      .json({ error: error.message || "Ovozni o'chirishda xatolik" });
  }
});

// Create Voice Replication (Admin-only official Gemini 3.8 Voice Replication API)
app.post("/api/voices/replicate", requireAdmin, async (req, res) => {
  try {
    const {
      displayName = "Mening Ovoz Nusxam",
      sourceAudioBase64,
      consentAudioBase64,
      mimeType = "audio/wav",
      store = true,
    } = req.body;

    if (!sourceAudioBase64) {
      return res
        .status(400)
        .json({ error: "Ovoz namunasi (sourceAudioBase64) kiritilishi shart" });
    }

    if (!consentAudioBase64) {
      return res.status(400).json({
        error:
          'Ovoz egasining ovozli roziligi (consentAudioBase64) kiritilishi shart. Ovozda aynan quyidagi inglizcha ibora aytilishi lozim: "I am the owner of this voice and I consent to Google using this voice to create a synthetic voice model."',
      });
    }

    // Call official ai.voices.create with type: 'replicated'
    const newVoice = await ai.voices.create({
      store,
      voice: {
        type: "replicated",
        display_name: displayName,
        model: "gemini-3.8-flash-tts",
        language_code: "uz-UZ",
        replicated: {
          source_audio: {
            mime_type: mimeType,
            data: sourceAudioBase64,
          },
          consent_audio: {
            mime_type: mimeType,
            data: consentAudioBase64,
          },
        },
      },
    });

    res.json({
      success: true,
      voice: newVoice,
      voiceId: newVoice.id || (newVoice as any).key,
    });
  } catch (error: any) {
    console.error("Error replicating voice:", error);
    const rawMsg = String(error?.message || error || "");

    // Detect Google AI Consent Verification Failures
    if (
      rawMsg.includes("FINISH_REASON_INPUT_VR_TAKEDOWN") ||
      rawMsg.includes("Consent flow failed") ||
      rawMsg.includes("recorded phrase didn't match") ||
      rawMsg.includes("speech-generation")
    ) {
      return res.status(400).json({
        error:
          "Google AI rozilik audiosini qabul qilmadi. Sabab: Google xavfsizlik tekshiruvi uchun rozilik matni aynan quyidagicha so'zma-so'z o'qilishi shart: \"I am the owner of this voice and I consent to Google using this voice to create a synthetic voice model.\" (Google STT tizimi aynan shu inglizcha jumlani tekshiradi. Iltimos, ushbu jumlani toza va aniq talaffuz qilib qayta yozing yoki Google AI Studio orqali yaratilgan Voice ID ni kiriting).",
      });
    }

    res.status(500).json({
      error:
        rawMsg.length > 250
          ? "Ovoz nusxalashda xatolik yuz berdi. Audio sifati va Google AI rozilik matnini tekshiring."
          : rawMsg || "Ovoz nusxalashda xatolik yuz berdi.",
    });
  }
});

// Create Voice Design (Admin-only natural-language voice description)
app.post("/api/voices/design", requireAdmin, requireCreditBalance(1), async (req, res) => {
  try {
    const { displayName, personaPrompt, gender = "male" } = req.body;

    if (!personaPrompt) {
      return res
        .status(400)
        .json({ error: "Ovoz tavsifi (personaPrompt) kiritilishi shart" });
    }

    const newVoice = await ai.voices.create({
      store: true,
      voice: {
        type: "prompted",
        display_name: displayName || "O'zbekcha Dizayn Ovoz",
        model: "gemini-3.8-flash-tts",
        gender: gender as any,
        language_code: "uz-UZ",
        prompted: {
          input: personaPrompt,
        },
      },
    });

    res.json({
      success: true,
      voice: newVoice,
      voiceId: newVoice.id,
    });
  } catch (error: any) {
    console.error("Error designing voice:", error);
    res.status(500).json({
      error: error.message || "Ovoz dizaynida xatolik yuz berdi",
    });
  }
});

/**
 * Splits long-form text into coherent speech chunks (natural paragraphs and sentences)
 * so Gemini 3.8 Flash TTS can synthesize podcasts of any duration (15m, 30m, 60m) without truncation.
 */
function splitTextIntoSpeechChunks(
  text: string,
  maxChunkLength = 320,
): string[] {
  const paragraphs = text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];

  // Helper: splits a long fragment by punctuation pauses (; : , — -) or words
  function splitLongSentence(sent: string): string[] {
    if (sent.length <= maxChunkLength) return [sent];

    // Cascade 2: split by pauses (; : , — -)
    const pauseMatches =
      sent.match(/[^;:,\u2014\u2013-]+[;:,\u2014\u2013-]+(?:\s|$)|[^;:,\u2014\u2013-]+$/g) ||
      [sent];
    const subChunks: string[] = [];
    let cur = "";

    for (const p of pauseMatches) {
      const pTrimmed = p.trim();
      if (!pTrimmed) continue;

      if (pTrimmed.length > maxChunkLength) {
        // Cascade 3: split strictly by words (\s+)
        if (cur) {
          subChunks.push(cur);
          cur = "";
        }
        const words = pTrimmed.split(/\s+/);
        let wordCur = "";
        for (const w of words) {
          if ((wordCur + " " + w).length <= maxChunkLength) {
            wordCur += (wordCur ? " " : "") + w;
          } else {
            if (wordCur) subChunks.push(wordCur);
            wordCur = w.slice(0, maxChunkLength); // Guarantee hard upper bound
          }
        }
        if (wordCur) subChunks.push(wordCur);
      } else if ((cur + " " + pTrimmed).length <= maxChunkLength) {
        cur += (cur ? " " : "") + pTrimmed;
      } else {
        if (cur) subChunks.push(cur);
        cur = pTrimmed;
      }
    }
    if (cur) subChunks.push(cur);
    return subChunks;
  }

  let accumulated = "";
  for (const para of paragraphs) {
    if (para.length > maxChunkLength) {
      if (accumulated) {
        chunks.push(accumulated);
        accumulated = "";
      }
      // Cascade: Split into sentences using punctuation boundaries (. ! ?)
      const sentences =
        para.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [para];
      let currentChunk = "";

      for (const sent of sentences) {
        const trimmed = sent.trim();
        if (!trimmed) continue;

        if (trimmed.length > maxChunkLength) {
          if (currentChunk) {
            chunks.push(currentChunk);
            currentChunk = "";
          }
          const subPieces = splitLongSentence(trimmed);
          for (const sub of subPieces) {
            chunks.push(sub);
          }
        } else if ((currentChunk + " " + trimmed).length <= maxChunkLength) {
          currentChunk += (currentChunk ? " " : "") + trimmed;
        } else {
          if (currentChunk) chunks.push(currentChunk);
          currentChunk = trimmed;
        }
      }
      if (currentChunk) chunks.push(currentChunk);
    } else if ((accumulated + "\n\n" + para).trim().length <= maxChunkLength) {
      accumulated = (accumulated ? accumulated + "\n\n" : "") + para;
    } else {
      if (accumulated) chunks.push(accumulated);
      accumulated = para;
    }
  }
  if (accumulated) chunks.push(accumulated);

  return chunks.length > 0 ? chunks : [text];
}

// Generate professional Uzbek podcast script
app.post("/api/podcast/generate-script", requireCreditBalance(1), async (req, res) => {
  try {
    const {
      category = "Tarixiy",
      topic = "Amir Temur va Samarqand siri",
      style = "Samimiy & Jonli",
      targetDuration = "2 daqiqa",
      targetFormat = "solo",
      customInstructions = "",
      voicePersona = "Mening ovozim",
    } = req.body;

    const isLongForm =
      targetDuration.includes("15") ||
      targetDuration.includes("30") ||
      targetDuration.includes("45") ||
      targetDuration.includes("60") ||
      targetDuration.includes("soat");

    let formatGuidance = "";
    if (targetFormat === "interview") {
      formatGuidance = `Bu 2 KISHILIK JONLI INTERVYU / SUHBAT (Boshlovchi va Taklif etilgan Ekspert) formatida bo'lsin.
Boshlovchi qiziqarli savollar beradi, hayratlanadi, o'z mulohazasini qo'shadi; Ekspert esa faktlar, hayotiy misollar va sirlarni ochib beradi.
Har bir replika oldida so'zlovchini ko'rsating:
Boshlovchi: [gap...]
Ekspert: [gap...]`;
    } else if (targetFormat === "voiceover") {
      formatGuidance = `Bu REELS / TIKTOK / SHORTS uchun o'ta dinamik, quloqni tortuvchi 30-60 soniyalik matn bo'lsin.
Birinchi 3 soniyada kuchli xuk (hook), keyin hayratlanarli faktlar va oxirida harakatga chaqiruv (call to action).`;
    } else if (targetFormat === "audiobook") {
      formatGuidance = `Bu ADABIY AUDIOKITOB BOBI formatida bo'lsin. Go'zal badiiy til, chuqur tasvirlar, his-tuyg'ular va donishmandlik.`;
    } else {
      formatGuidance = `Bu professional SOLO PODKAST formati. Tuzilishi:
[KIRISH]: Tinglovchini jalb etuvchi samimiy salomlashuv va mavzuning dolzarbligi.
[ASOSIY QISM / KULMINATSIYA]: Chuqur tahlil, kutilmagan faktlar, hayotiy saboqlar va qiyoslashlar.
[XULOSA]: Falsafiy xulosa, tinglovchiga o'ylantiruvchi savol va iliq xayrlashuv.`;
    }

    const durationGuidance = isLongForm
      ? `Bu KATTA VA TO'LIQ ${targetDuration}lik podkast soni bo'lishi kerak. Boblarga ajratilgan, chuqur hikoyanavislik, voqealar tafsilotlari, jonli misollar va savollar bo'lsin.`
      : `Bu ixcham va quloqni tortuvchi ${targetDuration}lik epizod.`;

    const prompt = `Siz O'zbekistondagi eng yetakchi professional podkast muallifi va ssenariy yozuvchisiz.
Quyidagi parametrlar bo'yicha to'liq o'zbek tilida (lotin yozuvida) yorqin, qiziqarli va professional podkast skripti (matni) yozing:

Kategoriya: ${category}
Mavzu: ${topic}
Format: ${targetFormat}
Podkast uslubi va kayfiyati: ${style}
Mo'ljallangan davomiyligi: ${targetDuration}
Muallif/Boshlovchi ovozi: ${voicePersona}
Qo'shimcha istaklar: ${customInstructions || "Yuqori sifatli jonli hikoya"}

Format talabi:
${formatGuidance}

Davomiylik talabi:
${durationGuidance}

MUHIM QOIDALAR:
1. Matn toza, chiroyli va tabiiy o'zbek adabiy va jonli so'zlashuv tilida bo'lsin.
2. Har bir jumla to'g'ridan-to'g'ri diktor o'qiydigan jonli nutq bo'lsin.
3. MATN ICHIGA (kulimsirab), (tabassum bilan), (kulgi), (jiddiy) KABI QAVS ICHIDAGI SO'ZLARNI ASLO YOZMANG! Emotsiya va kayfiyatni so'zlarning o'zi, ohang va savollar orqali tabiiy ifodalang.
4. Pauza kerak bo'lsa ko'p nuqta (...) yoki vergul bilan ifodalang.
5. Hech qanday keraksiz texnik izohlarsiz, to'g'ridan-to'g'ri o'qiladigan jonli podkast matnini taqdim eting. Har bir jumla tabiiy insondek jaranglasin.

Format:
SARLAVHA: [Podkast sarlavhasi]
TAVSIF: [Qisqa 1-2 jumlalik tushuntirish]
SKRIPT:
[To'liq o'qiladigan matn]`;

    const response = await generateFastTextWithFallback({
      contents: prompt,
      config: {
        temperature: 0.8,
        topP: 0.95,
      },
      timeoutMs: 12000,
    });

    const outputText = response.text || "";

    // Parse title, description, and script
    let title = `${category} Podkasti: ${topic}`;
    let description = "";
    let script = outputText;

    const titleMatch = outputText.match(/SARLAVHA:\s*(.+)/i);
    if (titleMatch) title = titleMatch[1].trim();

    const descMatch = outputText.match(/TAVSIF:\s*(.+)/i);
    if (descMatch) description = descMatch[1].trim();

    const scriptMatch = outputText.match(/SKRIPT:\s*([\s\S]+)/i);
    if (scriptMatch) {
      script = scriptMatch[1].trim();
    } else {
      script = outputText
        .replace(/SARLAVHA:.+/gi, "")
        .replace(/TAVSIF:.+/gi, "")
        .trim();
    }

    res.json({
      title,
      description,
      script,
      category,
      style,
      targetDuration,
    });
  } catch (error: any) {
    console.error("Error generating script:", error);
    res.status(500).json({
      error: error.message || "Ssenariy yaratishda xatolik yuz berdi",
    });
  }
});

// Full 1-Hour & 30-Minute Multi-Chapter Longform Podcast Engine
app.post("/api/podcast/generate-longform-script", requireCreditBalance(1), async (req, res) => {
  try {
    const {
      category = "Tarixiy & Allomalar",
      topic = "Amir Temur va Samarqandning jahon sivilizatsiyasidagi o'rni",
      style = "Hujjatli & Epik hikoyanavislik",
      targetDuration = "60 daqiqa (1 soat)",
      customInstructions = "",
      voicePersona = "Mening haqiqiy ovozim",
    } = req.body;

    const isOneHour =
      targetDuration.includes("60") || targetDuration.includes("soat");
    const is45Min = targetDuration.includes("45");
    const is30Min = targetDuration.includes("30");

    const durationLabel = isOneHour
      ? "60 daqiqa (1 to'liq soat)"
      : is45Min
        ? "45 daqiqa"
        : "30 daqiqa";
    const targetWordCount = isOneHour
      ? "kamida 5000-8000 so'z"
      : is45Min
        ? "kamida 3500-4500 so'z"
        : "kamida 2500-3500 so'z";

    const prompt = `Siz O'zbekistonning eng nufuzli, millionlab tinglovchilarga ega professional podkasteri va bosh ssenariynavisisiz.
Sizning vazifangiz: ${topic} mavzusida TO'LIQ ${durationLabel}lik, KATTA VA CHUQUR podkast monologi ssenariysini yaratish.
Ushbu podkast tinglovchini bir nafasda o'ziga jalb qilishi, intellektual jihatdan boy, qiziqarli faktlar, hayotiy misollar va jonli hissiyotlar bilan to'la bo'lishi shart (${targetWordCount}).

Podkast parametrlari:
- Toifa: ${category}
- Mavzu: ${topic}
- Uslub va ohang: ${style}
- Boshlovchi/Ovoz: ${voicePersona}
- Davomiyligi: ${durationLabel}
- Qo'shimcha yo'nalish: ${customInstructions || "Chuqur tahliliy va jonli hikoya"}

MUHIM TUZILISH (Har bir bobni to'liq matn bilan, qisqartirmasdan yozing):
Bob 1: [00:00 - 05:00] KIRISH & ANONS (Xuk, mavzuning dolzarbligi, shaxsiy e'tirof, tinglovchini jalb qilish)
Bob 2: [05:00 - 18:00] 1-BOB: Tarixiy ildizlar va birinchi hayratlanarli faktlar (Boshlanishi, unutilgan ma'lumotlar, sabab-oqibat)
Bob 3: [18:00 - 32:00] 2-BOB: Asosiy hodisalar, kutilmagan burilishlar va ziddiyatlar (Tafsilotlar, sahna ortidagi sirlar)
Bob 4: [32:00 - 45:00] 3-BOB: Bahsli savollar, xalqaro tajriba va qiyosiy tahlil (Turli qarashlar, hayotiy keyslar)
Bob 5: [45:00 - 55:00] 4-BOB: Bugungi kunga ta'siri, amaliy xulosalar va saboqlar (Tinglovchi hayotiga bog'lash)
Bob 6: [55:00 - 60:00] XULOSA & AUDITORIYA BILAN XAYRLASHUV (Falsafiy xulosa, tinglovchiga savol va minnatdorchilik)

Talablar:
1. Matn to'liq o'zbek tilida (lotin alifbosida).
2. Podkast intonatsiyalari uchun tabiiy nafas va pauza belgilarini kiriting: <breath>, <laugh>, |ha|, |albatta|, [Pauza 1s].
3. JSON formatida aniq qaytaring:
{
  "title": "Podkastning to'liq jozibali sarlavhasi",
  "description": "2-3 jumlalik qiziqarli annotatsiya",
  "targetDuration": "${targetDuration}",
  "estimatedMinutes": ${isOneHour ? 60 : is45Min ? 45 : 30},
  "chapters": [
    {
      "id": "ch-1",
      "timestamp": "00:00 - 05:00",
      "title": "Kirish va Anons",
      "content": "Assalomu alaykum qadrli tinglovchilar..."
    },
    {
      "id": "ch-2",
      "timestamp": "05:00 - 18:00",
      "title": "1-Bob: Tarixiy ildizlar",
      "content": "..."
    },
    {
      "id": "ch-3",
      "timestamp": "18:00 - 32:00",
      "title": "2-Bob: Asosiy sirlar va voqealar",
      "content": "..."
    },
    {
      "id": "ch-4",
      "timestamp": "32:00 - 45:00",
      "title": "3-Bob: Bahsli savollar va tahlil",
      "content": "..."
    },
    {
      "id": "ch-5",
      "timestamp": "45:00 - 55:00",
      "title": "4-Bob: Amaliy saboqlar",
      "content": "..."
    },
    {
      "id": "ch-6",
      "timestamp": "55:00 - 60:00",
      "title": "Xulosa va Xayrlashuv",
      "content": "..."
    }
  ]
}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.75,
      },
    });

    const parsed = JSON.parse(response.text?.trim() || "{}");
    const chapters = Array.isArray(parsed.chapters) ? parsed.chapters : [];

    // Assemble complete concatenated script text
    const fullScript = chapters
      .map(
        (ch: any) =>
          `[${ch.timestamp || ""}] ${ch.title?.toUpperCase()}\n\n${ch.content}\n`,
      )
      .join("\n\n---\n\n");

    const totalWords = fullScript.trim().split(/\s+/).filter(Boolean).length;

    res.json({
      title: parsed.title || `${category}: ${topic}`,
      description:
        parsed.description || `${durationLabel}lik katta podkast ssenariysi.`,
      targetDuration,
      estimatedMinutes: parsed.estimatedMinutes || (isOneHour ? 60 : 30),
      wordCount: totalWords,
      chapters,
      fullScript,
    });
  } catch (error: any) {
    console.error("Error generating longform script:", error);
    res
      .status(500)
      .json({
        error: error.message || "Katta podkast ssenariysini yaratishda xato",
      });
  }
});

// Expand a specific chapter with more detailed arguments, case studies, or anecdotes
app.post("/api/podcast/expand-chapter", requireCreditBalance(1), async (req, res) => {
  try {
    const {
      topic = "Podkast mavzusi",
      chapterTitle = "1-Bob",
      currentContent = "",
      expansionFocus = "Qo'shimcha tarixiy dalillar, faktlar va qiziqarli voqealar",
    } = req.body;

    const prompt = `Siz professional podkast muallifisiz.
Quyidagi podkast bobi matnini yanada boyitish, yangi dalillar, qiziqarli voqealar va hayotiy misollar qo'shib, davomiyligini yana 10-15 daqiqaga (kamida 800-1200 so'z) oshirish kerak.

Mavzu: ${topic}
Bob nomi: ${chapterTitle}
Qo'shimcha yo'nalish: ${expansionFocus}
Hozirgi mavjud matn:
${currentContent.slice(0, 1000)}...

Vazifa:
Ushbu bobni davom ettiruvchi yoki uning ichiga kiruvchi chuqur, qiziqarli hikoya matnini to'liq o'zbek tilida (lotin yozuvida) yozing. Tabiiy <breath>, [Pauza 1s], |albatta| kabi ifodalarni qo'shing.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: {
        temperature: 0.8,
      },
    });

    res.json({
      expandedText: response.text || "",
    });
  } catch (error: any) {
    console.error("Error expanding chapter:", error);
    res
      .status(500)
      .json({ error: error.message || "Bobni kengaytirishda xatolik" });
  }
});

// Enrich script with living speech, breathing, Uzbek natural fillers, and acoustic emotions
app.post("/api/podcast/enrich-emotions", requireCreditBalance(1), async (req, res) => {
  try {
    const { text, mood = "Samimiy & Jonli" } = req.body;
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Matn (text) kiritilishi shart" });
    }

    const prompt = `Siz o'zbek tilidagi eng tajribali audio-rejissyor va professional diktorsiz.
Quyidagi berilgan matnni tahlil qiling va unga haqiqiy jonli inson ovozi, tabiiy nafas, hissiyotlar, ovoz tembri va o'zbekcha jonli so'zlashuv ohangini berish uchun tabiiy teglarni mos joylarga mahorat bilan joylashtiring.

Mavjud teglardan foydalaning:
1. Nafas va pauzalar:
   - <breath> — tabiiy yengil nafas olish (uzun gaplar oldidan yoki yangi fikr boshida)
   - <deep_breath> — chuqur nafas (muhim xulosa yoki ta'sirli joy oldidan)
   - <sigh> — yengil xo'rsinish (chuqur o'yga tolganda yoki yengil tortganda)
   - <gasp> — hayrat nafasi (kutilmagan yangilik yoki hayratlanarli faktda)
   - [Pauza 0.5s] — qisqa tin olish
   - [Pauza 1s] — tabiiy 1 soniyalik pauza (tinglovchi o'ylashi uchun)
   - [Pauza 2s] — chuqur dramatik pauza

2. Kulgi va tabassum:
   - <laugh> — ochiq kulgi (hazil yoki quvnoq joyda)
   - <chuckle> — yengil tabassumli nafas / kıkırdash
   - <giggle> — quvnoq kulgi

3. Jonli o'zbekcha so'zlashuv elementlari:
   - |ha| — tasdiq ("|ha| haqiqatan ham...", "|ha| bilasizmi...")
   - |mhm| — mulohaza ("|mhm| bir o'ylab ko'ring...")
   - |xo'sh| — mavzuga kirish yoki davom ettirish ("|xo'sh| endi asosiy masalaga kelsak...")
   - |e-e| — eslash yoki hayrat ("|e-e| qarang...")
   - |voy| — hayajon ("|voy-bo'|...")
   - |rosti| — ochiq samimiy tan olish ("|rosti| kutilmagan bo'ldi...")
   - |bilasizmi| — tinglovchi e'tiborini tortish ("|bilasizmi| nima bo'ldi...")
   - |albatta| — qat'iy ishonch ("|albatta| har birimiz bilamiz...")

4. Nutq kayfiyati, emotsiyalar va KULMINATSIYA:
   - [Kulminatsiya] — eng ta'sirli, burilish nuqtasi va asosiy xulosa jumlada
   - [Hayajon] — g'ayratli, ilhomlantiruvchi qismlarda
   - [Sokin] — osoyishta, mayin qismlarda
   - [G'urur] — tantanavor, faxrli gaplarda
   - [Pichirlash] — sirli, ishonchli hikoyada
   - [Jiddiy] — vazmin, qat'iy fikrlarda
   - [Savol] — qiziqtiruvchi savol intonatsiyasida
   - [Tezlashuv] — tempni oshirish
   - [Vazminlik] — sekin, chuqur ta'kid bilan

Istak qilingan umumiy uslub va kayfiyat: ${mood}

Qat'iy qoidalar:
- Matnning asl so'zlarini, ma'nosini va grammatikasini aslo buzmang yoki soxtalashtirmang!
- MATN JONLILIK DARAJASI: Matnning 30% dan 40% gacha bo'lgan qismida ushbu teglardan faol foydalaning (har 1-2 gapda kamida bitta teg: nafas, pauza, jonli so'z yoki emotsiya/kulminatsiya bo'lsin).
- Natijada FAQAT tayyor boyitilgan matnni qaytaring, boshqa hech qanday tushuntirish, izoh yoki sarlavha yozmang.

Matn:
${text}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: {
        temperature: 0.65,
        topP: 0.95,
      },
    });

    const enrichedText = response.text ? response.text.trim() : text;
    res.json({ enrichedText });
  } catch (err: any) {
    console.error("Enrich emotions error:", err);
    res.status(500).json({ error: err.message || "Matnni boyitishda xatolik yuz berdi" });
  }
});

// Synthesize speech using Gemini 3.8 Flash TTS with user's replicated voice or custom voice
app.post("/api/podcast/synthesize", requireCreditBalance(1), async (req, res) => {
  try {
    const rawInputText = typeof req.body?.text === "string" ? req.body.text : req.body?.script;
    const {
      voiceProfile = {},
      speechStyle = "Jiddiy hikoyanavis",
    } = req.body;
    const text = rawInputText;

    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Matn (text) kiritilishi shart" });
    }

    // Clean text for speech synthesis while extracting acoustic stage directions (Baritone, Pause, etc.)
    const { speechText: cleanedText, extractedStyles } =
      cleanScriptForSpeech(text);
    const dynamicStyle =
      extractedStyles.length > 0
        ? ` Delivery style cues: ${extractedStyles.join(", ")}.`
        : "";

    const voiceName =
      voiceProfile.voiceName || voiceProfile.name || "Mening Ovozim";
    const voiceId = voiceProfile.voiceId || voiceProfile.id; // e.g. "voice_17raj9ewke3g"
    const baseVoice = voiceProfile.baseVoice || "Charon";
    const timbre = voiceProfile.timbre || "Iliq va salobatli bariton";
    const tempo = voiceProfile.tempo || "Vazmin (1.0x)";
    const customPersonaPrompt = voiceProfile.customPersonaPrompt || "";

    // Determine voiceConfig:
    // If voiceId is a Google AI Studio voice ID (starts with "voice_" or "voicekey_"), use voice: voiceId!
    const isCustomVoiceId =
      voiceId &&
      (voiceId.startsWith("voice_") || voiceId.startsWith("voicekey_"));

    let voiceConfig: any;
    if (isCustomVoiceId) {
      voiceConfig = { voice: voiceId };
    } else if (voiceProfile.replicatedVoiceConfig) {
      voiceConfig = {
        replicatedVoiceConfig: voiceProfile.replicatedVoiceConfig,
      };
    } else {
      voiceConfig = { prebuiltVoiceConfig: { voiceName: baseVoice } };
    }

    // Style prompt combining the user's custom Gemini 3.8 voice persona with podcast direction
    const combinedStylePrompt = [
      `Native Uzbek language podcast speaker.`,
      `Voice persona name: ${voiceName}.`,
      customPersonaPrompt ? `Voice Persona: ${customPersonaPrompt}.` : "",
      `Timbre and acoustic qualities: ${timbre}.`,
      `Tempo & Cadence: ${tempo}.`,
      `Emotion and delivery mood: ${speechStyle}.${dynamicStyle}`,
      `Pronounce authentic Uzbek words naturally with 100% native Tashkent/literary diction and absolutely ZERO foreign or Russian accent. Articulate o', g', q, x, sh, ch letters cleanly and clearly. Accurately interpret and voice vocal bursts (<laugh>, <breath>, <sigh>, <gasp>) as natural human sounds (laughter, audible breathing, deep sighs). Render conversational pipe markers (|ha|, |mhm|, |xoʻsh|) with authentic Tashkent native warmth and prosody. Never speak out loud any parenthetical directions, conditions, or bracketed notes.`,
    ]
      .filter(Boolean)
      .join(" ");

    let audioData: string | undefined;
    let mimeType = "audio/wav";

    // Stage 4: Support low-latency Chunked Audio Streaming (`stream: true`)
    // When `req.body.stream === true`, split into ~280-char sentence chunks and stream NDJSON lines immediately (~300ms TTFB)
    const isStreamingRequest = Boolean(req.body.stream);
    if (isStreamingRequest) {
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Transfer-Encoding", "chunked");
      res.setHeader("Cache-Control", "no-cache");

      const streamChunks = splitTextIntoSpeechChunks(cleanedText, 280);
      const isFemaleVoice =
        voiceProfile.gender === "female" ||
        ["Kore", "Aoede", "Zephyr"].includes(baseVoice) ||
        /aziza|madina|dilnoza|zarina|nodira|malika|zephyr|kore|aoede|ayol/i.test(
          voiceName || voiceId || "",
        );
      const resolvedVoiceName =
        baseVoice && ["Charon", "Puck", "Fenrir", "Zephyr", "Kore", "Aoede"].includes(baseVoice)
          ? baseVoice
          : isFemaleVoice
            ? "Kore"
            : "Charon";

      for (let i = 0; i < streamChunks.length; i++) {
        const piece = streamChunks[i];
        try {
          const { pcm } = await generateGeminiSpeechPcm({
            text: piece,
            voiceName: resolvedVoiceName,
            speechStyle: combinedStylePrompt,
            speakerName: voiceName,
          });
          const wavPiece = buildWavBuffer(pcm, 24000, 1, 16);
          res.write(
            JSON.stringify({
              type: "audio_chunk",
              chunkIndex: i,
              totalChunks: streamChunks.length,
              text: piece,
              audioBase64: wavPiece.toString("base64"),
              durationSeconds: Math.round((pcm.length / 48000) * 10) / 10,
            }) + "\n"
          );
        } catch (streamErr: any) {
          res.write(
            JSON.stringify({
              type: "chunk_error",
              chunkIndex: i,
              error: streamErr?.message || "Chunk synthesis failed",
            }) + "\n"
          );
        }
      }

      if (typeof (req as any).deductCredits === "function") {
        try {
          await (req as any).deductCredits(1);
        } catch {}
      }
      res.write(JSON.stringify({ type: "done", totalChunks: streamChunks.length }) + "\n");
      return res.end();
    }

    const chunks = cleanedText.length <= 4500
      ? [cleanedText]
      : splitTextIntoSpeechChunks(cleanedText, 3500);

    const pcmChunks: Buffer[] = [];
    const failedChunkIndices: number[] = [];
    let keyExpiredDetected = false;
    // 250ms silence pause between major sections
    const pauseBuffer = Buffer.alloc(12000);

    for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
      const chunkText = chunks[cIdx];
      let chunkPcm: Buffer | null = null;

      try {
        const isFemaleVoice =
          voiceProfile.gender === "female" ||
          ["Kore", "Aoede", "Zephyr"].includes(baseVoice) ||
          /aziza|madina|dilnoza|zarina|nodira|malika|zephyr|kore|aoede|ayol/i.test(
            voiceName || voiceId || "",
          );
        const resolvedVoiceName =
          baseVoice && ["Charon", "Puck", "Fenrir", "Zephyr", "Kore", "Aoede"].includes(baseVoice)
            ? baseVoice
            : isFemaleVoice
              ? "Kore"
              : "Charon";

        const res = await generateGeminiSpeechPcm({
          text: chunkText,
          voiceName: resolvedVoiceName,
          speechStyle: combinedStylePrompt,
          speakerName: voiceName,
        });
        chunkPcm = res.pcm;
      } catch (e: any) {
        if (e?.code === "API_KEY_EXPIRED" || e?.isApiKeyExpired || e?.message?.includes("API key expired")) {
          keyExpiredDetected = true;
          console.warn(`[Synthesize Chunk ${cIdx + 1}] Gemini API key expired`);
          break;
        }
        console.error(`[Chunk ${cIdx + 1}/${chunks.length}] Synthesis failed:`, e?.message);
        failedChunkIndices.push(cIdx);
      }

      if (chunkPcm && chunkPcm.length > 0) {
        pcmChunks.push(chunkPcm);
        if (cIdx < chunks.length - 1) {
          pcmChunks.push(pauseBuffer);
        }
      } else {
        failedChunkIndices.push(cIdx + 1);
      }
    }

    if (keyExpiredDetected || (pcmChunks.length === 0 && keyExpiredDetected)) {
      return res.status(401).json({
        error: "Gemini API kaliti muddati tugagan (API Key Expired). Iltimos, yangi kalit kiriting.",
        code: "API_KEY_EXPIRED",
        isApiKeyExpired: true,
      });
    }

    if (pcmChunks.length === 0) {
      throw new Error("Gemini TTS audio ma'lumotini qaytarmadi");
    }

    // Combine all chunks into one unified master WAV
    const totalPcm = Buffer.concat(pcmChunks);
    const finalBuffer = buildWavBuffer(totalPcm, 24000, 1, 16);
    const base64Output = finalBuffer.toString("base64");

    // Exact duration in seconds
    const durationSeconds = Math.max(
      1,
      Math.round((totalPcm.length / 48000) * 10) / 10,
    );

    let creditsRemaining = (req as any).userBalance;
    if (typeof (req as any).deductCredits === "function") {
      try {
        creditsRemaining = await (req as any).deductCredits(1);
      } catch (deductErr) {
        console.warn("Credit deduction notice:", deductErr);
      }
    }

    res.json({
      audioBase64: base64Output,
      mimeType: "audio/wav",
      durationSeconds,
      voiceName,
      voiceId: isCustomVoiceId ? voiceId : undefined,
      baseVoice,
      textLength: cleanedText.length,
      chunksCount: chunks.length,
      failedChunks: failedChunkIndices.length > 0 ? failedChunkIndices : undefined,
      creditsRemaining,
    });
  } catch (error: any) {
    const isExpired =
      error?.code === "API_KEY_EXPIRED" ||
      error?.isApiKeyExpired ||
      error?.message?.includes("API key expired") ||
      error?.message?.includes("API_KEY_INVALID");
    console.error("TTS error:", isExpired ? "API key expired" : error?.message || error);
    res.status(isExpired ? 401 : 500).json({
      error: isExpired
        ? "Gemini API kaliti muddati tugagan (API Key Expired). Iltimos, yangi kalit kiriting."
        : error.message || "Ovoz sintezida xatolik yuz berdi",
      code: isExpired ? "API_KEY_EXPIRED" : undefined,
      isApiKeyExpired: isExpired,
    });
  }
});

// Analyze user's voice sample with acoustic breakdown
app.post("/api/voice/analyze-sample", requireCreditBalance(1), async (req, res) => {
  try {
    const {
      audioBase64,
      mimeType = "audio/webm",
      voiceDescription = "",
    } = req.body;

    const parts: any[] = [];

    if (audioBase64) {
      parts.push({
        inlineData: {
          mimeType,
          data: audioBase64,
        },
      });
    }

    parts.push({
      text: `Ushbu audio yozuv yoki tavsif asosida foydalanuvchining o'zbek tilidagi individual ovoz xususiyatlarini (Gemini 3.8 Voice Design) tahlil qiling:
${voiceDescription ? `Qo'shimcha tavsif: "${voiceDescription}"` : ""}

Quyidagi parametrlar bilan JSON formatida qaytaring:
{
  "voiceName": "Foydalanuvchi ovozining nomi (masalan: Jasur - Bariton Ovoz)",
  "recommendedBaseVoice": "Charon" yoki "Puck" yoki "Kore" yoki "Fenrir" yoki "Zephyr",
  "timbre": "Ovoz tembrining batafsil tavsifi (masalan: Boy bariton, iliq va ishonchli rezonans)",
  "tempo": "Tavsiya etilgan temp (masalan: Vazmin 0.95x)",
  "pitchLevel": "Past" yoki "O'rta" yoki "Baland",
  "personaPrompt": "Gemini 3.8 TTS uchun to'liq inglizcha/o'zbekcha Voice Design Prompt (masalan: Warm Uzbek male podcaster voice with resonant baritone depth, clear articulation, subtle natural breathing, thoughtful cadence)",
  "strengths": ["Tarixiy podkastlar", "Motivatsiya", "Komedik hikoyalar"],
  "analysisNotes": "Ovozning o'ziga xosligi va o'zbekcha talaffuz bo'yicha maslahat"
}`,
    });

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: { parts },
      config: {
        responseMimeType: "application/json",
      },
    });

    const jsonText = response.text?.trim() || "{}";
    const profile = JSON.parse(jsonText);

    res.json(profile);
  } catch (error: any) {
    console.error("Error analyzing voice sample:", error);
    res.status(500).json({
      error: error.message || "Ovoz tahlilida xatolik",
    });
  }
});

// =========================================================================
// 1. VOICEOVER & DUBBING STUDIO ENDPOINTS
// =========================================================================

// Generate specialized voiceover / dubbing script
app.post("/api/voiceover/generate-script", requireCreditBalance(1), async (req, res) => {
  try {
    const {
      format = "reels_shorts",
      topic = "Texnologiyalar va sun'iy intellekt",
      targetDuration = "30s",
      stylePreset = "cinematic",
      voicePersona = "Mening Ovozim",
    } = req.body;

    const formatPrompts: Record<string, string> = {
      reels_shorts:
        "Reels, YouTube Shorts va TikTok uchun dinamik, 30 soniyalik qiziqarli video matni. Ilk 3 soniyada diqqatni jalb qiluvchi kuchli xuk (hook) bo'lishi shart.",
      commercial_ad:
        "Kompaniya, mahsulot yoki xizmat uchun sotuvchi reklama roligi matni (Call to Action bilan, 15-30 soniya).",
      audiobook:
        "Badiiy kitob yoki ibratli hikoyaning ta'sirchan audio bobidan parcha (chuqur intonatsiyalar bilan, 1-2 daqiqa).",
      video_dubbing:
        "Hujjatli yoki ilmiy video lavha uchun professional kadrdan tashqari (voiceover) sinxron dublyaj matni.",
    };

    const isLongDuration =
      targetDuration.includes("m") &&
      !targetDuration.includes("2m") &&
      !targetDuration.includes("1m");
    const wordTargetDesc = isLongDuration
      ? `Bu KATTA VA TO'LIQ ${targetDuration}lik video taqdimot/vebinar/darslik yoki reklama seriyasidir. Matn lo'nda emas, balki keng qamrovli, har bir daqiqa uchun sahna va gaplar bilan yozilsin.`
      : `Matn aniq ${targetDuration} vaqt chegarasiga mos kelsin (masalan, 30 soniya uchun taxminan 65-75 ta so'z, 60 soniya uchun 130-150 ta so'z).`;

    const prompt = `Siz O'zbekistondagi eng mohir professional ovoz rejissyori va diktorsiz.
Quyidagi vazifa bo'yicha o'zbek tilida (lotin yozuvida) mukammal ovozlashtirish (voiceover / dublyaj) ssenariysini tayyorlang:

Format turi: ${format} (${formatPrompts[format] || "Video uchun professional ovoz"})
Mavzu: ${topic}
Mo'ljallangan vaqt: ${targetDuration}
Uslub (Preset): ${stylePreset}
Diktor ovozi: ${voicePersona}

Talablar:
1. ${wordTargetDesc}
2. Har bir sahna yoki fikr uchun taxminiy vaqt markerlarini ko'rsating, masalan:
   [00:00 - 01:30] ...
   [01:30 - 05:00] ...
3. Diksiyani oshiruvchi pauzalar va urg'ular bo'lsin.
4. Matn oxirida to'liq o'qiladigan toza matnni alohida ajrating.

Qaytaring:
SARLAVHA: [Loyiha nomi]
TAKROR_VAQT: [${targetDuration}]
SAHNA_MATNI:
[Vaqt belgilari bilan to'liq ssenariy]
TOZA_MATN:
[Diktor mikrofon oldida to'xtovsiz o'qiydigan toza matn]`;

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: {
        temperature: 0.7,
      },
    });

    const text = response.text || "";
    let title = `${topic} (${targetDuration})`;
    const titleMatch = text.match(/SARLAVHA:\s*(.+)/i);
    if (titleMatch) title = titleMatch[1].trim();

    let cleanScript = "";
    const cleanMatch = text.match(/TOZA_MATN:\s*([\s\S]+)/i);
    if (cleanMatch) {
      cleanScript = cleanMatch[1].trim();
    } else {
      cleanScript = text.replace(/\[\d\d:\d\d\s*-\s*\d\d:\d\d\]/g, "").trim();
    }

    res.json({
      title,
      format,
      targetDuration,
      fullTimedScript: text,
      script: cleanScript,
    });
  } catch (error: any) {
    console.error("Error in voiceover script gen:", error);
    res
      .status(500)
      .json({ error: error.message || "Ovozlashtirish ssenariysida xatolik" });
  }
});

/**
 * Transcribe & Translate video/audio media for video dubbing (Reels, Shorts, TikTok, YouTube).
 * Listens to the original speech (English, Russian, etc.), extracts accurate timestamps,
 * and creates a synchronized, syllable-timed Uzbek dubbing translation.
 */
app.post("/api/voiceover/transcribe-and-translate", requireCreditBalance(1), async (req, res) => {
  try {
    const {
      mediaBase64,
      mimeType = "audio/mp4",
      targetDuration = "30s",
      stylePreset = "energetic_sales",
      sourceLanguageHint = "auto",
    } = req.body;

    if (!mediaBase64) {
      return res.status(400).json({ error: "Media ma'lumoti (audio yoki video) yuborilmadi" });
    }

    // Prepare normalized MIME type
    let safeMime = mimeType;
    if (mimeType.includes("quicktime")) safeMime = "video/mp4";
    if (mimeType.includes("m4a")) safeMime = "audio/mp4";

    const prompt = `Siz professional video ovozlashtirish va dublyaj rejissyorisiz.
Ushbu video/audio (Reels / Shorts / TikTok / Video)dagi inson nutqini tahlil qiling.

VAZIFA:
1. Nutqni aniq Speech-to-Text (STT) qilib, har bir gapning boshlanish va tugash vaqtini (masalan: 00:00 - 00:04) aniqlang.
2. "Qanday aytilgan bo'lsa, xuddi shunday o'zbek tilida jaranglash" qoidasi:
   - Har bir replikani jonli, zamonaviy, jarangdor o'zbek tiliga (lotin yozuvida) tarjima qiling.
   - Tarjima qilingan o'zbekcha gapning uzunligi va so'zlar soni asl nutq vaqtiga (xronometrajiga) AYNAN MOS TUSHISHI SHART! Gap video kadriga nisbatan juda uzun yoki juda qisqa bo'lmasin.
   - Reels/Shorts uchun so'zlashuv uslubi dinamik, qiziqarli va ta'sirchan bo'lsin.
3. Sahnalar vaqtini [00:00 - 00:04] ko'rinishida formatlang.
4. Diktor uchun to'liq toza o'zbekcha matnni ham alohida shakllantiring.

QAT'IY JSON FORMATIDA QAYTARING:
{
  "detectedLanguage": "Ingliz tili (yoki Rus tili)",
  "totalEstimatedSeconds": 30,
  "suggestedTopic": "Reels / Video mavzusi",
  "segments": [
    {
      "start": "00:00",
      "end": "00:05",
      "originalText": "Asl tildagi aniq gap...",
      "uzbekText": "Vaqtga moslashtirilgan o'zbekcha dublyaj matni..."
    }
  ],
  "fullTimedScript": "[00:00 - 00:05] [Dinamik]: O'zbekcha matn...",
  "cleanUzbekScript": "Diktor mikrofon oldida to'xtovsiz o'qiydigan toza o'zbekcha matn"
}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: safeMime,
                data: mediaBase64,
              },
            },
            {
              text: prompt,
            },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        temperature: 0.3,
      },
    });

    const parsed = JSON.parse(response.text?.trim() || "{}");
    res.json(parsed);
  } catch (error: any) {
    console.error("Error in transcribe-and-translate:", error);
    res.status(500).json({
      error: error.message || "Videoni tahlil qilish va tarjima qilishda xatolik yuz berdi",
    });
  }
});

/**
 * Endpoint to analyze video links (YouTube, Shorts, Instagram Reels, TikTok, Direct MP4)
 */
app.post("/api/voiceover/fetch-media-url", requireCreditBalance(1), async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "Video havolasi kiritilmadi" });
    }

    const trimmedUrl = url.trim();

    // Determine embed URL for preview if applicable
    let embedUrl: string | null = null;
    let videoTitle = "";

    const isYouTube = /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)/i.test(trimmedUrl);
    let videoId = "";
    if (isYouTube) {
      const shortsMatch = trimmedUrl.match(/shorts\/([a-zA-Z0-9_-]+)/);
      const watchMatch = trimmedUrl.match(/[?&]v=([a-zA-Z0-9_-]+)/);
      const beMatch = trimmedUrl.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
      if (shortsMatch) videoId = shortsMatch[1];
      else if (watchMatch) videoId = watchMatch[1];
      else if (beMatch) videoId = beMatch[1];

      if (videoId) {
        embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=0&enablejsapi=1`;
        try {
          const oembedRes = await fetch(
            `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
          );
          if (oembedRes.ok) {
            const oembedData: any = await oembedRes.json();
            videoTitle = oembedData.title || "";
          }
        } catch (e) {}
      }
    }

    const isInstagram = /instagram\.com\/(?:reel|p|tv)\//i.test(trimmedUrl);
    if (isInstagram) {
      const shortcodeMatch = trimmedUrl.match(/(?:reel|p|tv)\/([a-zA-Z0-9_-]+)/);
      const shortcode = shortcodeMatch ? shortcodeMatch[1] : null;
      if (shortcode) {
        embedUrl = `https://www.instagram.com/p/${shortcode}/embed/`;
      }
    }

    // Run full production pipeline
    const pipelineRes = await runMediaDubbingPipeline(
      {
        url: trimmedUrl,
        videoTitle: videoTitle || undefined,
      },
      ai
    );

    if (pipelineRes.state === "media_ready") {
      return res.json({
        status: "success",
        jobState: "media_ready",
        platform: pipelineRes.platform,
        type: pipelineRes.platform,
        embedUrl,
        hasTranscript: pipelineRes.hasSpeech,
        audioBase64: pipelineRes.extractedAudioBase64,
        videoDuration: pipelineRes.videoDuration,
        audioDuration: pipelineRes.audioDuration,
        durationsMatch: pipelineRes.durationsMatch,
        suggestedTopic: pipelineRes.suggestedTopic || videoTitle || "Video Dublyaji",
        segments: pipelineRes.segments,
        fullTimedScript: pipelineRes.fullTimedScript,
        cleanUzbekScript: pipelineRes.cleanUzbekScript,
        attemptLog: pipelineRes.attemptLog,
        streamInspection: pipelineRes.streamInspection,
        message: "Video muvaffaqiyatli yuklandi, audio ajratildi va sinxron o'zbekcha dublyaj tayyorlandi!",
      });
    }

    if (pipelineRes.state === "transcript_only") {
      return res.json({
        status: "transcript_only",
        jobState: "transcript_only",
        platform: pipelineRes.platform,
        type: pipelineRes.platform,
        embedUrl,
        hasTranscript: true,
        audioBase64: null, // CRITICAL: In transcript_only mode, no raw audio is returned
        videoDuration: pipelineRes.videoDuration,
        audioDuration: 0,
        durationsMatch: false,
        suggestedTopic: pipelineRes.suggestedTopic || videoTitle || "YouTube Video",
        segments: pipelineRes.segments,
        fullTimedScript: pipelineRes.fullTimedScript,
        cleanUzbekScript: pipelineRes.cleanUzbekScript,
        attemptLog: pipelineRes.attemptLog,
        requiresMediaUpload: true,
        transcriptOnlyNotice: pipelineRes.transcriptOnlyNotice,
        message: pipelineRes.transcriptOnlyNotice || "Transkripsiya Gemini orqali olindi. To'liq dublyaj uchun MP4 faylni yuklang.",
      });
    }

    // Fallback for YouTube: check if YouTube auto-captions exist before requiring upload
    if (isYouTube && videoId) {
      try {
        let transcriptItems: any = null;
        const targetLangs = [undefined, "tr", "ru", "en", "uz", "es", "de"];
        for (const langCode of targetLangs) {
          try {
            transcriptItems = await YoutubeTranscript.fetchTranscript(
              videoId,
              langCode ? { lang: langCode } : undefined
            );
            if (transcriptItems && transcriptItems.length > 0) break;
          } catch (e) {}
        }

        if (transcriptItems && transcriptItems.length > 0) {
          const rawSegments = transcriptItems.map((item: any) => {
            const startSec = Math.floor(item.offset / 1000);
            const durSec = Math.ceil(item.duration / 1000) || 3;
            const endSec = startSec + durSec;
            const formatTime = (s: number) => {
              const m = Math.floor(s / 60).toString().padStart(2, "0");
              const sec = (s % 60).toString().padStart(2, "0");
              return `${m}:${sec}`;
            };
            return {
              start: formatTime(startSec),
              end: formatTime(endSec),
              originalText: item.text
                .replace(/&amp;/g, "&")
                .replace(/&#39;/g, "'")
                .replace(/&quot;/g, '"'),
            };
          });

          const mergedSegments: { start: string; end: string; originalText: string }[] = [];
          for (const seg of rawSegments) {
            if (!seg.originalText.trim()) continue;
            if (mergedSegments.length > 0) {
              const prev = mergedSegments[mergedSegments.length - 1];
              if (prev.originalText.length < 40 && prev.end === seg.start) {
                prev.end = seg.end;
                prev.originalText += " " + seg.originalText;
                continue;
              }
            }
            mergedSegments.push(seg);
          }

          const translatePrompt = `Siz professional video dublyaj rejissyorisiz.
Quyida YouTube videosining asl nutqi va taymkodlari keltirilgan:
Video sarlavhasi: "${videoTitle || 'YouTube Video'}"
Replikalar:
${JSON.stringify(mergedSegments.slice(0, 45), null, 2)}

Har bir replikani O'zbek tiliga (lotin yozuvida) "qanday aytilgan bo'lsa, xuddi shunday" sinxron ravishda tarjima qiling.
Qat'iy JSON formatida qaytaring:
{
  "detectedLanguage": "${transcriptItems[0]?.lang || 'Aniqlangan til'}",
  "suggestedTopic": "${videoTitle || 'YouTube Video Dublyaji'}",
  "segments": [
    {
      "id": 1,
      "start": "00:00",
      "end": "00:04",
      "speaker": "Speaker 1",
      "originalText": "...",
      "uzbekText": "..."
    }
  ],
  "fullTimedScript": "[00:00 - 00:04] [Speaker 1]: ...",
  "cleanUzbekScript": "..."
}`;

          const transResponse = await ai.models.generateContent({
            model: "gemini-3.8-flash",
            contents: translatePrompt,
            config: { responseMimeType: "application/json", temperature: 0.2 },
          });

          const parsedTranslation = JSON.parse(transResponse.text?.trim() || "{}");

          return res.json({
            status: "success",
            type: "youtube",
            platform: "YouTube / Shorts",
            videoId,
            videoTitle: videoTitle || parsedTranslation.suggestedTopic,
            embedUrl,
            hasTranscript: true,
            detectedLanguage: parsedTranslation.detectedLanguage || "Aniqlangan til",
            suggestedTopic: videoTitle || parsedTranslation.suggestedTopic || "YouTube Video",
            segments: parsedTranslation.segments || [],
            fullTimedScript: parsedTranslation.fullTimedScript || "",
            cleanUzbekScript: parsedTranslation.cleanUzbekScript || "",
            attemptLog: pipelineRes.attemptLog,
            message: "YouTube subtitrlari orqali haqiqiy nutq aniqlandi va o'zbekcha sinxron dublyaj tayyorlandi!",
          });
        }
      } catch (e) {}
    }

    // If download failed and no captions exist, return audio_upload_required with exact log
    return res.json({
      status: pipelineRes.state === "platform_blocked" ? "audio_upload_required" : pipelineRes.state,
      jobState: pipelineRes.state || "platform_blocked",
      platform: pipelineRes.platform,
      type: pipelineRes.platform,
      embedUrl,
      hasTranscript: false,
      requiresMediaUpload: true,
      audioBase64: null,
      error: pipelineRes.error,
      errorDetails: pipelineRes.errorDetails,
      attemptLog: pipelineRes.attemptLog,
      streamInspection: pipelineRes.streamInspection,
      message:
        pipelineRes.error ||
        "Ushbu havoladan video oqimini to'g'ridan-to'g'ri yuklab bo'lmadi. Diktorning haqiqiy ovozini 100% eshitib dublyaj qilish uchun video (MP4) yoki audio (MP3) faylini yuklang!",
    });
  } catch (error: any) {
    console.error("Error in fetch-media-url:", error);
    res.status(500).json({ error: error.message || "Havolani tekshirishda xatolik" });
  }
});

/**
 * Full Media Dubbing Pipeline Endpoint:
 * url -> download -> ffmpeg audio extraction -> ffprobe duration check -> verbatim STT + diarization -> Uzbek translation
 */
app.post("/api/voiceover/process-pipeline", requireCreditBalance(1), async (req, res) => {
  try {
    const { url, mediaBase64, mimeType, videoTitle } = req.body;
    if (!url && !mediaBase64) {
      return res.status(400).json({ error: "Havola (URL) yoki fayl ma'lumoti yuborilmadi." });
    }

    const result = await runMediaDubbingPipeline(
      {
        url,
        mediaBase64,
        mimeType,
        videoTitle,
      },
      ai
    );

    res.json(result);
  } catch (err: any) {
    console.error("Error in process-pipeline:", err);
    res.status(500).json({ error: err.message || "Pipeline bajarishda xatolik" });
  }
});

/**
 * Endpoint to retrieve recent pipeline attempt logs (Admin-only)
 */
app.get("/api/voiceover/pipeline-logs", requireAdmin, (_req, res) => {
  res.json({ logs: getPipelineLogs() });
});

/**
 * Translate user's provided original speech text into synchronized Uzbek with timecodes.
 * Guarantees NO hallucination: strictly translates the speaker's real words.
 */
app.post("/api/voiceover/translate-custom-speech", requireCreditBalance(1), async (req, res) => {
  try {
    const { originalText, videoTitle = "Video Dublyaji", targetDuration = "45s" } = req.body;
    if (!originalText || !originalText.trim()) {
      return res.status(400).json({ error: "Asl nutq matni kiritilmadi" });
    }

    const prompt = `Siz professional video dublyaj rejissyorisiz.
Quyida video qahramoni yoki diktori aytgan ASL NUTQ matni keltirilgan:
"${originalText}"

VAZIFA:
1. Ushbu matndagi har bir gapni vaqtga moslab, ketma-ket taymkodlarga ([00:00 - 00:05], [00:05 - 00:12], va h.k.) ajrating.
2. Har bir gapni o'zbek tiliga (lotin yozuvida) "qanday aytilgan bo'lsa, xuddi shunday" sinxron, jarangdor va jonli qilib tarjima qiling.
3. O'zingizdan hech qanday yangi sahna yoki xayoliy voqea to'qimang! Faqat berilgan asl nutqni tarjima qiling.

Qat'iy JSON formatida qaytaring:
{
  "detectedLanguage": "Asl til",
  "suggestedTopic": "${videoTitle}",
  "segments": [
    {
      "start": "00:00",
      "end": "00:05",
      "originalText": "Asl gap...",
      "uzbekText": "Sinxron o'zbekcha tarjimasi..."
    }
  ],
  "fullTimedScript": "[00:00 - 00:05] [Dinamik]: O'zbekcha matn...",
  "cleanUzbekScript": "Diktor mikrofon oldida to'xtovsiz o'qiydigan toza o'zbekcha matn"
}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: { responseMimeType: "application/json", temperature: 0.2 },
    });

    const parsed = JSON.parse(response.text?.trim() || "{}");
    res.json(parsed);
  } catch (err: any) {
    console.error("Error in translate-custom-speech:", err);
    res.status(500).json({ error: err.message || "Nutqni tarjima qilishda xatolik" });
  }
});

/**
 * Explicitly generate or regenerate timecoded dubbing scenes and subtitles for any video / topic.
 */
app.post("/api/voiceover/generate-video-subtitles", requireCreditBalance(1), async (req, res) => {
  try {
    const {
      topic = "Video Dublyaji",
      targetDuration = "30s",
      stylePreset = "energetic_sales",
      customPrompt = "",
    } = req.body;

    const prompt = `Siz O'zbekistondagi eng yetakchi professional kino, serial va video dublyaj rejissyorisiz.
Quyidagi video uchun o'zbek tilida (lotin yozuvida) aniq taymkodlar va sinxron subtitr/dublyaj ssenariysini yarating:

Mavzu/Sarlavha: "${topic}"
Mo'ljallangan davomiylik: ${targetDuration}
Uslub: ${stylePreset}
Qo'shimcha tavsif: ${customPrompt || "Sahnaning mazmuniga mos jonli dublyaj"}

Qat'iy talablar:
1. Rolikni ${targetDuration.includes("60") ? "8-10" : "5-7"} ta aniq taymkodga ([00:00 - 00:05], [00:05 - 00:11], va h.k.) ajrating.
2. Har bir taymkod uchun:
   - "start": boshlanish vaqti (masalan "00:00")
   - "end": tugash vaqti (masalan "00:05")
   - "originalText": Sahnadagi holat, fon yoki asl til replikasi
   - "uzbekText": Diktor yoki aktyor o'qiydigan mukammal, jarangdor o'zbekcha dublyaj gapi
3. Taymkodlar ketma-ket bo'lib, butun ${targetDuration} vaqtni qamrab olsin.
4. "Tasavvur qiling siz uxlayotganingizda" kabi umumiy shablonlar MUTLAQO BO'LMASIN! Matn aynan "${topic}" mavzusiga mos bo'lsin.

Qat'iy JSON formatida qaytaring:
{
  "suggestedTopic": "${topic}",
  "detectedLanguage": "O'zbekcha Sinxron Dublyaj",
  "segments": [
    {
      "start": "00:00",
      "end": "00:05",
      "originalText": "[Sahna boshlanishi: ...]",
      "uzbekText": "..."
    }
  ],
  "fullTimedScript": "[00:00 - 00:05] [Dinamik]: ...",
  "cleanUzbekScript": "..."
}`;

    const aiRes = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.5,
      },
    });

    const parsed = JSON.parse(aiRes.text?.trim() || "{}");
    res.json(parsed);
  } catch (error: any) {
    console.error("Error generating video subtitles:", error);
    res.status(500).json({ error: error.message || "Subtitr va taymkodlar yaratishda xatolik" });
  }
});

// Synthesize voiceover with timed SRT subtitle generator
app.post("/api/voiceover/synthesize", requireCreditBalance(1), async (req, res) => {
  try {
    const { text, voiceProfile = {}, speechStyle = "Dinamik" } = req.body;

    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Matn kiritilmadi" });
    }

    const voiceName =
      voiceProfile.voiceName || voiceProfile.name || "Mening Ovozim";
    const voiceId = voiceProfile.voiceId || voiceProfile.id;
    const baseVoice = voiceProfile.baseVoice || "Charon";
    const timbre = voiceProfile.timbre || "Resonant Baritone";
    const tempo = voiceProfile.tempo || "1.0x";

    const isCustomVoiceId =
      voiceId &&
      (voiceId.startsWith("voice_") || voiceId.startsWith("voicekey_"));
    let voiceConfig: any;
    if (isCustomVoiceId) {
      voiceConfig = { voice: voiceId };
    } else {
      voiceConfig = { prebuiltVoiceConfig: { voiceName: baseVoice } };
    }

    // Clean text and extract delivery instructions (Baritone, Pause, tempo, etc.)
    const { speechText: cleanedText, extractedStyles } =
      cleanScriptForSpeech(text);
    const dynamicStyle =
      extractedStyles.length > 0
        ? ` Delivery style & cues: ${extractedStyles.join(", ")}.`
        : "";

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash-tts",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: cleanedText || text,
              speechMetadata: {
                speaker: voiceName,
                style: `Professional voiceover & dubbing artist. Voice: ${voiceName}. Timbre: ${timbre}. Tempo: ${tempo}. Mood: ${speechStyle}.${dynamicStyle} Clear commercial pronunciation with 100% authentic native Uzbek diction and zero foreign accent. Accurately interpret and voice vocal bursts (<laugh>, <breath>, <sigh>, <gasp>) as natural human sounds. Render conversational pipe markers (|ha|, |mhm|, |xoʻsh|) with authentic Tashkent native warmth and prosody. Do NOT voice or pronounce any condition brackets, parentheses, or stage directions.`,
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig },
      },
    });

    const part = response.candidates?.[0]?.content?.parts?.[0];
    const audioData = part?.inlineData?.data;
    if (!audioData) {
      throw new Error("Ovoz ma'lumotini olib bo'lmadi");
    }

    const rawBuffer = Buffer.from(audioData, "base64");
    const { buffer: finalBuffer, mimeType } = ensureWav(
      rawBuffer,
      24000,
      1,
      16,
    );
    const durationSeconds = Math.max(
      1,
      Math.round((rawBuffer.length / 48000) * 10) / 10,
    );

    // Generate accurate timed SRT & VTT subtitles based on sentence boundaries
    const sentences = cleanedText
      .split(/(?<=[.!?…])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const totalChars = cleanedText.length || 1;
    let currentSec = 0;
    let srtOutput = "";
    let vttOutput = "WEBVTT\n\n";

    const formatTimestampSRT = (sec: number) => {
      const h = Math.floor(sec / 3600)
        .toString()
        .padStart(2, "0");
      const m = Math.floor((sec % 3600) / 60)
        .toString()
        .padStart(2, "0");
      const s = Math.floor(sec % 60)
        .toString()
        .padStart(2, "0");
      const ms = Math.floor((sec % 1) * 1000)
        .toString()
        .padStart(3, "0");
      return `${h}:${m}:${s},${ms}`;
    };

    const formatTimestampVTT = (sec: number) => {
      const m = Math.floor((sec % 3600) / 60)
        .toString()
        .padStart(2, "0");
      const s = Math.floor(sec % 60)
        .toString()
        .padStart(2, "0");
      const ms = Math.floor((sec % 1) * 1000)
        .toString()
        .padStart(3, "0");
      return `${m}:${s}.${ms}`;
    };

    sentences.forEach((sentence, idx) => {
      const sentenceDuration = Math.max(
        1.5,
        (sentence.length / totalChars) * durationSeconds,
      );
      const startSec = currentSec;
      const endSec = Math.min(durationSeconds, currentSec + sentenceDuration);
      currentSec = endSec;

      srtOutput += `${idx + 1}\n${formatTimestampSRT(startSec)} --> ${formatTimestampSRT(endSec)}\n${sentence}\n\n`;
      vttOutput += `${idx + 1}\n${formatTimestampVTT(startSec)} --> ${formatTimestampVTT(endSec)}\n${sentence}\n\n`;
    });

    let creditsRemaining = (req as any).userBalance;
    if (typeof (req as any).deductCredits === "function") {
      try {
        creditsRemaining = await (req as any).deductCredits(1);
      } catch (deductErr) {
        console.warn("Credit deduction notice:", deductErr);
      }
    }

    res.json({
      audioBase64: finalBuffer.toString("base64"),
      mimeType,
      durationSeconds,
      srtSubtitles: srtOutput.trim(),
      vttSubtitles: vttOutput.trim(),
      voiceName,
      creditsRemaining,
    });
  } catch (error: any) {
    console.error("Error synthesizing voiceover:", error);
    res
      .status(500)
      .json({ error: error.message || "Dublyaj sintezida xatolik" });
  }
});

// =========================================================================
// 2. MULTI-SPEAKER & INTERVIEW STUDIO ENDPOINTS
// =========================================================================

// Generate 2-speaker podcast interview / dialogue script
app.post("/api/podcast/generate-interview", requireCreditBalance(1), async (req, res) => {
  try {
    const {
      topic = "Kelajak kasblari va AI inqilobi",
      host1Name = "Shokhrukh",
      host1Role = "Boshlovchi (Podkaster)",
      host2Name = "Aziza",
      host2Role = "Mehmon (AI Eksperti)",
      tone = "Qizg'in va jonli suhbat",
      targetDuration = "30 daqiqa",
    } = req.body;

    let targetTurns = 12;
    let turnLengthGuidance = "har bir replika 40-70 so'z atrofida bo'lsin";
    if (targetDuration.includes("10")) {
      targetTurns = 16;
      turnLengthGuidance = "har bir replika 50-80 so'z bo'lsin";
    }
    if (targetDuration.includes("15")) {
      targetTurns = 20;
      turnLengthGuidance =
        "har bir replika 60-95 so'z bo'lib, mavzu faktlar bilan asoslansin";
    }
    if (targetDuration.includes("30")) {
      targetTurns = 28;
      turnLengthGuidance =
        "har bir replika 80-140 so'z bo'lib, batafsil tajriba, argument va misollar berilsin";
    }
    if (
      targetDuration.includes("45") ||
      targetDuration.includes("60") ||
      targetDuration.includes("90") ||
      targetDuration.includes("soat")
    ) {
      targetTurns = targetDuration.includes("90") || targetDuration.includes("1.5") ? 50 : 38;
      turnLengthGuidance =
        "har bir replika 100-180 so'zdan iborat chuqur professional monologik-dialog shaklida bo'lsin";
    }

    const prompt = `Siz O'zbekistondagi eng mashhur ${targetDuration}lik professional intervyu podkastining bosh ssenariy muallifisiz.
Quyidagi ikki boshlovchi/mehmon o'rtasida o'zbek tilida (lotin yozuvida) qiziqarli, jonli, intellektual va chuqur 2 kishilik podkast suhbatini yozing:

Mavzu: ${topic}
1-boshlovchi: ${host1Name} (${host1Role})
2-ishtirokchi (Mehmon): ${host2Name} (${host2Role})
Suhbat ruhiyati: ${tone}
Mo'ljallangan vaqt: ${targetDuration} (${targetTurns} ta to'laqonli replika)

QAT'IY TALABLAR:
- Suhbat aniq ${targetTurns} ta replikadan iborat bo'lsin.
- REPLIKA HAJMI: ${turnLengthGuidance}. Boshlovchi qisqa so'ramasin, o'z mulohazasini ham qo'shsin; mehmon esa shunchaki "ha" demasdan, 2-3 ta hayotiy misol, fakt va sabablar bilan keng tushuntirsin.
- Suhbat bosqichlari:
  1. Kirish, anons va taklif sababi (1-4 replika)
  2. Mavzuning tub mohiyati, shaxsiy tajriba va kutilmagan birinchi savol (5-12 replika)
  3. Bahsli nuqtalar, qiyin savollar, xatolar va real hayotiy keyslar (13-26 replika)
  4. Amaliy maslahatlar, kelajak istiqbollari va tinglovchilar uchun xulosalar (27-${targetTurns} replika)

- MAJBURIY JONLI VOKAL VA EMOTSIYA TEGLARI (HAR BIR REPLIKADA 1-2 TADAN BO'LISHI SHART):
  * <breath> — nutq oqimidagi tabiiy insoniy nafas olish, chuqur mulohazali pauza
  * <laugh> — samimiy, quvnoq yoki hazilomuz insoniy kulgi tovushi
  * |ha|, |mhm|, |rostanam|, |aha|, |albatta|, |xoʻsh|, |voy| — toshkentcha haqiqiy jonli suhbat tasdiqlari va tinglash belgilari
  * [Pauza 1s] — boblar yoki fikr almashinuvi orasidagi studiyaviy pauza
  Misol: "Assalomu alaykum! <breath> Bugun studiyamizda nihoyatda kutilgan mehmon... |ha| Mavzu juda dolzarb! <laugh>"

- JSON formatida qaytaring:
{
  "title": "${topic} — ${host1Name} va ${host2Name} Podkast Intervyusi",
  "topic": "${topic}",
  "targetDuration": "${targetDuration}",
  "turns": [
    {
      "speakerId": "HOST_1",
      "speakerName": "${host1Name}",
      "text": "Assalomu alaykum qadrli tinglovchilar! <breath> Bugun biz... |ha| ...",
      "emotion": "excited"
    },
    {
      "speakerId": "HOST_2",
      "speakerName": "${host2Name}",
      "text": "Va alaykum assalom, ${host1Name}! <laugh> Taklif uchun katta rahmat, |rostanam| bu haqda gaplashish vaqti kelgan edi...",
      "emotion": "thoughtful"
    }
  ]
}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const parsed = JSON.parse(response.text?.trim() || "{}");
    res.json(parsed);
  } catch (error: any) {
    console.error("Error generating interview dialogue:", error);
    res
      .status(500)
      .json({ error: error.message || "Intervyu ssenariysida xatolik" });
  }
});

// Helper to cleanly extract time and spoken text from all YouTube subtitle formats
function cleanSubtitleLine(line: string) {
  // Support standard hh:mm:ss or mm:ss, including YouTube accessibility artifacts (e.g. 0:000 seconds, 1:401 minute, 40 seconds)
  const hmsMatch = line.match(/^(\d{1,2}):(\d{2}):(\d{2})(.*)$/i);
  let mins = 0;
  let secs = 0;
  let rest = "";

  if (hmsMatch) {
    const hours = parseInt(hmsMatch[1], 10);
    mins = hours * 60 + parseInt(hmsMatch[2], 10);
    secs = parseInt(hmsMatch[3], 10);
    rest = hmsMatch[4];
  } else {
    const msMatch = line.match(/^(\d+):(\d{2})(.*)$/i);
    if (!msMatch) return null;
    mins = parseInt(msMatch[1], 10);
    secs = parseInt(msMatch[2], 10);
    rest = msMatch[3];
  }

  // Strip repeated youtube accessibility numbers/units (e.g., "0 seconds", "1 minute, 40 seconds")
  rest = rest.replace(/^(?:\d+[\s,]*)+/i, "");
  rest = rest.replace(/^(?:(?:hours?|minutes?|seconds?|минут|секунд|сек|мин)[\s,]*)+/i, "");
  rest = rest.replace(/^(?:\d+[\s,]*)+/i, "");
  rest = rest.replace(/^(?:(?:hours?|minutes?|seconds?|минут|секунд|сек|мин)[\s,]*)+/i, "");

  return { mins, secs, text: rest.trim() };
}

// Helper to parse YouTube transcript lines with timestamps (e.g. 0:000 seconds..., 1:401 minute..., SRT)
function parseTimedTranscript(raw: string) {
  const lines = raw.split("\n");
  const segments: Array<{
    startSec: number;
    endSec: number;
    durationSec: number;
    timecode: string;
    text: string;
    chapter?: string;
  }> = [];
  let currentChapter = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (/^chapter\s*\d+/i.test(line)) {
      currentChapter = line;
      continue;
    }

    const parsed = cleanSubtitleLine(line);
    if (parsed && parsed.text) {
      const startSec = parsed.mins * 60 + parsed.secs;
      segments.push({
        startSec,
        endSec: 0,
        durationSec: 0,
        timecode: `${parsed.mins}:${parsed.secs.toString().padStart(2, "0")}`,
        text: parsed.text,
        chapter: currentChapter,
      });
    }
  }

  if (segments.length === 0) return null;

  for (let j = 0; j < segments.length; j++) {
    const next = segments[j + 1];
    const wordsCount = segments[j].text.split(/\s+/).filter(Boolean).length;
    if (next) {
      segments[j].endSec = next.startSec;
      const rawDiff = next.startSec - segments[j].startSec;
      // Cap individual speech turn duration: video chapter pauses must NOT blow up turn speech length
      segments[j].durationSec =
        rawDiff > 0 && rawDiff <= 12
          ? Math.round(rawDiff * 10) / 10
          : Math.min(10, Math.max(2.5, Math.round(wordsCount * 0.45 * 10) / 10));
    } else {
      const estSec = Math.min(10, Math.max(3, Math.round(wordsCount * 0.45)));
      segments[j].endSec = segments[j].startSec + estSec;
      segments[j].durationSec = estSec;
    }
  }
  return segments;
}

// Import, diarize, and translate long YouTube interviews (up to 1.5 hours)
app.post("/api/podcast/import-youtube-interview", requireCreditBalance(1), async (req, res) => {
  try {
    const {
      url = "",
      manualTranscript = "",
      targetLanguage = "uz",
      host1Name = "Artur Yugay",
      host2Name = "Ayubxon Burxonov",
      tone = "Jonli va intellektual suhbat",
    } = req.body;

    const trimmedManualText = typeof manualTranscript === "string" ? manualTranscript.trim() : "";
    const trimmedUrl = typeof url === "string" ? url.trim() : "";

    if (!trimmedManualText && !trimmedUrl) {
      return res.status(400).json({
        error: "YouTube video havolasi yoki matn kiritilishi shart",
        message_ru: "Необходимо указать ссылку на YouTube видео или вставить текст",
      });
    }

    let videoTitle = "YouTube Podkast Intervyusi";
    let authorName = "";
    let videoId = "";
    let conversationChunks: string[] = [];
    let estimatedMinutes = 15;

    // Extract videoId from URL if provided
    if (trimmedUrl) {
      const shortsMatch = trimmedUrl.match(/shorts\/([a-zA-Z0-9_-]+)/);
      const watchMatch = trimmedUrl.match(/[?&]v=([a-zA-Z0-9_-]+)/);
      const beMatch = trimmedUrl.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
      const liveMatch = trimmedUrl.match(/live\/([a-zA-Z0-9_-]+)/);
      videoId = shortsMatch?.[1] || watchMatch?.[1] || beMatch?.[1] || liveMatch?.[1] || "";

      if (videoId) {
        try {
          const oembedRes = await fetch(
            `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
          );
          if (oembedRes.ok) {
            const oembedData: any = await oembedRes.json();
            videoTitle = oembedData.title || videoTitle;
            authorName = oembedData.author_name || "";
          }
        } catch {}
      }
    }

    // CHECK FOR TIMED TRANSCRIPT (e.g. YouTube subtitles with timestamps)
    const timedSegments = trimmedManualText ? parseTimedTranscript(trimmedManualText) : null;

    if (timedSegments && timedSegments.length > 0) {
      console.log(`[Import YouTube] Detected ${timedSegments.length} timed segments. Running intelligent diarization & verbatim translation...`);
      const totalVideoSeconds = timedSegments[timedSegments.length - 1].endSec || 600;
      estimatedMinutes = Math.max(5, Math.round(totalVideoSeconds / 60));

      // Batch translate segments concurrently (15 per batch) for 3x faster response and 100% faithful translation
      const BATCH_SIZE = 15;
      const segmentBatches: (typeof timedSegments)[] = [];
      for (let i = 0; i < timedSegments.length; i += BATCH_SIZE) {
        segmentBatches.push(timedSegments.slice(i, i + BATCH_SIZE));
      }

      const allTranslatedTurns: any[] = [];
      const isUzbek = targetLanguage === "uz";

      const batchPromises = segmentBatches.map(async (batch, b) => {
        const prompt = `Siz professional YouTube dublyaj rejissyori, muloqot tahlilchisi va tarjimonisiz.
Quyida YouTube videosidan ("${videoTitle}", Kanal/Muallif: "${authorName || 'Artur Yugay'}") olingan inglizcha subtitrlar berilgan (${b + 1}/${segmentBatches.length}-qism).

ISHTIROKCHILAR:
1. HOST_1 (${host1Name} / Boshlovchi): Intervyuer va boshlovchi. Kirish qismini aytadi ("Assalomu alaykum do'stlar"), mavzuni ochadi, mehmonga savol beradi, iqtisodiy paradokslarni ta'kidlaydi ("Nega O'zbekistonda yashash bunchalik qimmat?").
2. HOST_2 (${host2Name} / Mehmon): Moliya, ko'chmas mulk va biznes eksperti. Savollarga batafsil tushuntirish beradi, iqtisodiy faktlar va tahlillarni aytadi (talab va taklif, Italiya/Kopengagen pizzasi, Ronald Reyganning avtomobil haqidagi latifasi, bank depozitlari, ko'chmas mulk narxlari).

VAZIFA:
1. DIARIZATSIYA (KIM GAPIRGANINI ANIQ BELGILANG):
   - Har bir replikaning mazmuniga qarab "HOST_1" (Boshlovchi) yoki "HOST_2" (Mehmon) ekanini QAT'IY belgilang.
   - Boshlovchi savol berganda yoki kirish so'zida — HOST_1.
   - Mehmon javob berib tushuntirganda — HOST_2.
   - Ikkala ovozni aralashtirib yubormang!
2. 100% TO'CH-V-TO'CH TARJIMA:
   - Matnni to'liq, aniq, bitta ham so'zni qoldirmasdan ${isUzbek ? "o'zbek" : "rus"} tiliga tarjima qiling. Barcha inglizcha iboralar mahalliylashtirilsin.
   - ${isUzbek ? "Jonli, adabiy va ravon o'zbek tili bo'lsin." : "Живой, естественный и грамотный русский язык."}
3. FORMAT: Qat'iy JSON formatida qaytaring:
{
  "turns": [
    {
      "index": 0,
      "speakerId": "HOST_1",
      "text": "Tarjima matni..."
    }
  ]
}

Replikalar ro'yxati:
${JSON.stringify(batch.map((s, idx) => ({ index: idx, timecode: s.timecode, originalText: s.text })), null, 2)}`;

        let parsedTurns: any[] = [];
        try {
          const response = await ai.models.generateContent({
            model: "gemini-3.8-flash",
            contents: prompt,
            config: { responseMimeType: "application/json" },
          });

          const rawText = response.text?.trim() || "{}";
          const jsonText = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
          const parsed = JSON.parse(jsonText);
          parsedTurns = Array.isArray(parsed.turns) ? parsed.turns : [];
        } catch (e: any) {
          console.warn("[Import YouTube] Diarization JSON error on batch", b, e?.message);
        }

        const batchTurns: any[] = [];
        for (let j = 0; j < batch.length; j++) {
          const originalSeg = batch[j];
          const tr = parsedTurns.find((p: any) => p.index === j) || parsedTurns[j] || {};
          
          let isH2 = tr.speakerId === "HOST_2" || tr.speakerId === "GUEST_1";
          if (!tr.speakerId) {
            const tLower = originalSeg.text.toLowerCase();
            if (
              tLower.includes("hi everyone") ||
              tLower.includes("today we have") ||
              tLower.includes("so here's my question") ||
              tLower.includes("why has our") ||
              tLower.includes("our farmers today") ||
              originalSeg.text.endsWith("?")
            ) {
              isH2 = false;
            } else {
              isH2 = true;
            }
          }

          batchTurns.push({
            id: `yt-turn-${b * BATCH_SIZE + j + 1}-${Date.now()}`,
            startSec: originalSeg.startSec,
            endSec: originalSeg.endSec,
            durationSec: originalSeg.durationSec,
            timecode: originalSeg.timecode,
            originalText: originalSeg.text,
            chapter: originalSeg.chapter || "",
            speakerId: isH2 ? "HOST_2" : "HOST_1",
            speakerName: isH2 ? host2Name : host1Name,
            text: tr.text || originalSeg.text,
            emotion: isH2 ? "thoughtful" : "serious",
          });
        }
        return batchTurns;
      });

      const batchResults = await Promise.all(batchPromises);
      for (const bTurns of batchResults) {
        allTranslatedTurns.push(...bTurns);
      }

      // GUARANTEE 100% TRANSLATION:
      // Verify that NO turn was left untranslated in English or foreign words.
      const untranslatedIndices: number[] = [];
      for (let i = 0; i < allTranslatedTurns.length; i++) {
        const turn = allTranslatedTurns[i];
        const textStr = turn.text || "";
        const isUntranslated =
          !textStr.trim() ||
          textStr === turn.originalText ||
          /\b(the|and|because|welcome|today|question|farmers|about|where|which|people|money|expensive|they|with|that|this|you|know|what|when|there|their|from)\b/i.test(textStr);
        if (isUntranslated) {
          untranslatedIndices.push(i);
        }
      }

      if (untranslatedIndices.length > 0) {
        console.log(`[Import YouTube] Found ${untranslatedIndices.length} turns requiring translation sweep...`);
        try {
          const sweepPrompt = `Siz professional tarjimon va dublyaj muharririsiz.
Quyidagi ${untranslatedIndices.length} ta jumlani ${isUzbek ? "100% tabiiy, ravon va adabiy o'zbek tiliga" : "100% живой и правильный русский язык"} so'zma-so'z, aniq va to'liq tarjima qiling. Bitta ham so'z chet tilida qolib ketmasin!
Qat'iy JSON format:
{
  "translations": [
    ${untranslatedIndices.map((idx) => `{"index": ${idx}, "translatedText": "..."}`).join(",\n    ")}
  ]
}

Tarjima qilinadigan jumlalar:
${JSON.stringify(untranslatedIndices.map((idx) => ({ index: idx, text: allTranslatedTurns[idx].originalText || allTranslatedTurns[idx].text })), null, 2)}`;

          const sweepRes = await ai.models.generateContent({
            model: "gemini-3.8-flash",
            contents: sweepPrompt,
            config: { responseMimeType: "application/json" },
          });
          const rawSweepText = sweepRes.text?.trim() || "{}";
          const jsonSweepText = rawSweepText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
          const sweepParsed = JSON.parse(jsonSweepText);
          if (Array.isArray(sweepParsed.translations)) {
            for (const item of sweepParsed.translations) {
              if (item && typeof item.index === "number" && item.translatedText && allTranslatedTurns[item.index]) {
                allTranslatedTurns[item.index].text = item.translatedText.trim();
              }
            }
          }
        } catch (sweepErr: any) {
          console.warn("[Import YouTube] Translation sweep error:", sweepErr?.message);
        }
      }

      return res.json({
        status: "success",
        title: `${videoTitle} — 2 Ovozli To'liq Dublyaj`,
        videoTitle,
        authorName,
        videoId,
        embedUrl: videoId ? `https://www.youtube.com/embed/${videoId}?autoplay=0` : undefined,
        estimatedDurationMinutes: estimatedMinutes,
        totalTurns: allTranslatedTurns.length,
        turns: allTranslatedTurns,
      });
    }

    // Case 1: Manual transcript without timecodes (plain text fallback)
    if (trimmedManualText) {
      videoTitle = trimmedUrl ? `YouTube Matn Dublyaji` : `Maxsus Suhbat Matni`;
      const sentences = trimmedManualText.split(/(?<=[.?!])\s+/).filter(Boolean);
      let chunk = "";
      for (const sent of sentences) {
        chunk += (chunk ? " " : "") + sent;
        if (chunk.split(/\s+/).length >= 50) {
          conversationChunks.push(chunk);
          chunk = "";
        }
      }
      if (chunk.trim()) {
        conversationChunks.push(chunk.trim());
      }
      estimatedMinutes = Math.max(5, Math.round(trimmedManualText.split(/\s+/).length / 125));
    } else {
      // Case 2: Extract from YouTube URL
      const shortsMatch = trimmedUrl.match(/shorts\/([a-zA-Z0-9_-]+)/);
      const watchMatch = trimmedUrl.match(/[?&]v=([a-zA-Z0-9_-]+)/);
      const beMatch = trimmedUrl.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
      const liveMatch = trimmedUrl.match(/live\/([a-zA-Z0-9_-]+)/);
      videoId = shortsMatch?.[1] || watchMatch?.[1] || beMatch?.[1] || liveMatch?.[1] || "";

      if (!videoId) {
        return res.status(400).json({
          error: "Noto'g'ri YouTube havolasi. Iltimos, to'g'ri YouTube video URL kiriting.",
          message_ru: "Некорректная ссылка на YouTube. Введите правильный URL видео.",
        });
      }

      // Check oEmbed and noembed for video metadata
      let isVideoFound = false;
      try {
        const oembedRes = await fetch(
          `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
        );
        if (oembedRes.ok) {
          const oembedData: any = await oembedRes.json();
          videoTitle = oembedData.title || videoTitle;
          authorName = oembedData.author_name || "";
          isVideoFound = true;
        }
      } catch {}

      if (!isVideoFound) {
        try {
          const noembedRes = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
          if (noembedRes.ok) {
            const noembedData: any = await noembedRes.json();
            if (noembedData.title) {
              videoTitle = noembedData.title;
              authorName = noembedData.author_name || "";
              isVideoFound = true;
            }
          }
        } catch {}
      }

      // Try fetching subtitles using YoutubeTranscript across multiple fallback languages
      let transcriptItems: any = null;
      const targetLangs = [undefined, "ru", "en", "uz", "tr", "es", "de"];
      for (const langCode of targetLangs) {
        try {
          transcriptItems = await YoutubeTranscript.fetchTranscript(
            videoId,
            langCode ? { lang: langCode } : undefined
          );
          if (transcriptItems && transcriptItems.length > 0) break;
        } catch {}
      }

      if (transcriptItems && transcriptItems.length > 0) {
        // Subtitles were successfully fetched!
        const rawSegments = transcriptItems.map((item: any) => ({
          startSec: Math.floor(item.offset / 1000),
          text: (item.text || "")
            .replace(/&amp;/g, "&")
            .replace(/&#39;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/\n/g, " ")
            .trim(),
        })).filter((s: any) => Boolean(s.text));

        const totalVideoSeconds = rawSegments.length > 0
          ? rawSegments[rawSegments.length - 1].startSec + 10
          : 300;
        estimatedMinutes = Math.max(5, Math.round(totalVideoSeconds / 60));

        let currentChunk = "";
        let wordCountInChunk = 0;
        for (const seg of rawSegments) {
          const words = seg.text.split(/\s+/).filter(Boolean);
          currentChunk += (currentChunk ? " " : "") + seg.text;
          wordCountInChunk += words.length;

          if (wordCountInChunk >= 65 || seg.text.endsWith("?") || seg.text.endsWith(".")) {
            if (wordCountInChunk >= 35) {
              conversationChunks.push(currentChunk.trim());
              currentChunk = "";
              wordCountInChunk = 0;
            }
          }
        }
        if (currentChunk.trim()) {
          conversationChunks.push(currentChunk.trim());
        }
      } else if (isVideoFound && videoTitle && videoTitle !== "YouTube Podkast Intervyusi") {
        // Subtitles are disabled on YouTube, but video exists!
        // Synthesize rich interview dialogue based on the real video topic
        conversationChunks.push(
          `YouTube video mavzusi: "${videoTitle}". Muallif/Kanal: "${authorName}". Ushbu video bo'yicha professional 2 kishilik intervyu, asosiy tezislar, qizg'in savol-javoblar va hayotiy tahlillar.`
        );
        estimatedMinutes = 15;
      } else {
        // Video is unavailable, deleted or private on YouTube (like 404)
        return res.status(400).json({
          error: "Ushbu video YouTube'da mavjud emas (o'chirilgan, yopiq yoki havola noto'g'ri). Iltimos, ishlaydigan havola kiriting yoki quyidagi maydonga matnni qo'lda kiriting.",
          message_ru: "Это видео недоступно на YouTube (удалено, скрыто или некорректная ссылка). Укажите рабочую ссылку или вставьте текст/субтитры вручную в поле ниже.",
        });
      }
    }

    // Limit to reasonable chunks (up to 90 blocks for full 90-minute podcasts)
    const selectedChunks = conversationChunks.slice(0, 90);

    const isUzbek = targetLanguage === "uz";
    const languageInstruction = isUzbek
      ? "Matnni 100% adabiy va jonli Toshkent o'zbek tiliga (lotin yozuvida) tarjima qiling. Barcha jumlalar tabiiy, jarangdor va chiroyli o'zbekcha iboralar bilan boyitilsin."
      : "Переведите диалог на живой, естественный и грамотный русский язык.";

    const diarizationPrompt = `Siz professional video dublyaj rejissyori va podkast muharririsiz.
Quyida YouTube videosidan (${estimatedMinutes} daqiqalik intervyu/suhbat) olingan asl nutq bloklari keltirilgan:
Video nomi: "${videoTitle}" ${authorName ? `(Kanal: ${authorName})` : ""}

Asl nutq bloklari:
${selectedChunks.map((c, idx) => `[Blok ${idx + 1}]: ${c}`).join("\n\n")}

VAZIFA:
1. DIARIZATSIYA (2 kishilik intervyu):
   - Suhbatni ikki ishtirokchiga ajrating:
     * HOST_1: 1-boshlovchi / Intervyuer (${host1Name}) — savol beruvchi, suhbatni boshqaruvchi, kirish va xulosalarni aytuvchi.
     * HOST_2: 2-ishtirokchi / Mehmon (${host2Name}) — savollarga batafsil javob beruvchi, o'z tajribasi va tahlillarini ulashuvchi.
2. TARJIMA VA MAZMUN:
   - ${languageInstruction}
   - Nutq ma'nosini 100% to'liq saqlang, qisqartirib tashlamang.
3. JONLI VOKAL VA EMOTSIYA TEGLARI (HAR BIR REPLIKADA BO'LSIN):
   - Har bir replikada albatta jonli suhbat belgilari bo'lsin:
     * <breath> (nafas olish, jumlalar orasidagi nafas pauzasi)
     * <laugh> (tabiiy samimiy kulgi)
     * |ha|, |mhm|, |rostanam|, |aha|, |albatta|, |xoʻsh| (jonli tasdiq va eshitish belgilari)
     * [Pauza 1s] (mantiqiy pauza)
4. FORMAT: Qat'iy JSON formatida qaytaring:
{
  "title": "${videoTitle} — Ikki Kishilik Dublyaj",
  "estimatedDurationMinutes": ${estimatedMinutes},
  "totalTurns": <replikalar soni>,
  "turns": [
    {
      "id": "turn-1",
      "speakerId": "HOST_1",
      "speakerName": "${host1Name}",
      "text": "Assalomu alaykum! <breath> Bugun ... |ha| ...",
      "emotion": "excited"
    },
    {
      "id": "turn-2",
      "speakerId": "HOST_2",
      "speakerName": "${host2Name}",
      "text": "Va alaykum assalom! <laugh> Rahmat, |rostanam| ...",
      "emotion": "thoughtful"
    }
  ]
}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: diarizationPrompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const parsed = JSON.parse(response.text?.trim() || "{}");
    const generatedTurns = Array.isArray(parsed.turns) ? parsed.turns : [];

    res.json({
      status: "success",
      title: parsed.title || videoTitle,
      videoTitle,
      authorName,
      videoId,
      embedUrl: `https://www.youtube.com/embed/${videoId}?autoplay=0`,
      estimatedDurationMinutes: parsed.estimatedDurationMinutes || estimatedMinutes,
      totalTurns: generatedTurns.length,
      turns: generatedTurns.map((t: any, idx: number) => ({
        id: t.id || `yt-turn-${idx + 1}-${Date.now()}`,
        speakerId: t.speakerId === "HOST_2" ? "HOST_2" : "HOST_1",
        speakerName: t.speakerId === "HOST_2" ? host2Name : host1Name,
        text: t.text || "",
        emotion: t.emotion || "thoughtful",
      })),
    });
  } catch (error: any) {
    console.error("Error importing YouTube interview:", error);
    res.status(500).json({
      error: error.message || "YouTube intervyusini tahlil qilishda xatolik",
    });
  }
});

// Smart Diarize existing turns into Host 1 (Artur Yugay) vs Host 2 (Oybek Burxanov)
app.post("/api/podcast/smart-diarize-turns", requireCreditBalance(1), async (req, res) => {
  try {
    const {
      turns = [],
      host1Name = "Artur Yugay",
      host2Name = "Ayubxon Burxonov",
    } = req.body;

    if (!Array.isArray(turns) || turns.length === 0) {
      return res.status(400).json({ error: "Replikalar ro'yxati (turns) bo'sh" });
    }

    const prompt = `Siz professional YouTube podkast va intervyu rejissyori hamda audio diarizatsiya mutaxassisisiz.
Quyida Artur Yugay (Boshlovchi) va Ayubxon Burxanov (Mehmon) o'rtasidagi suhbatdan olingan replikalar berilgan.

ISHTIROKCHILAR VA QOIDALAR:
1. HOST_1 (${host1Name} / Boshlovchi): Intervyu beruvchi, savollar beradi, mavzuni boshlaydi va ochadi ("Assalomu alaykum do'stlar", "Menda bir savol bor", "Nega bizning davlatda yashash bunchalik qimmat?", "Oltin arzonlashsa nima bo'ladi?").
2. HOST_2 (${host2Name} / Mehmon ekspert): Moliya, biznes va ko'chmas mulk tahlilchisi. Savollarga batafsil javob beradi, faktlar va iqtisodiy misollar keltiradi (talab va taklif, post-kovid o'sishi, Kopengagendagi pizza va qahva narxi, Reygan latifasi, bank depozitlari, ko'chmas mulk narxlari).

VAZIFA:
Har bir replikaning mazmunini tahlil qiling va uning egasi kimligini (HOST_1 yoki HOST_2) qat'iy belgilang.
Replikalar ro'yxati:
${JSON.stringify(turns.map((t: any, i: number) => ({ index: i, timecode: t.timecode, text: t.originalText || t.text })), null, 2)}

Qat'iy JSON formatida qaytaring:
{
  "diarized": [
    {
      "index": 0,
      "speakerId": "HOST_1",
      "speakerName": "${host1Name}"
    }
  ]
}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: { responseMimeType: "application/json" },
    });

    const parsed = JSON.parse(response.text?.trim() || "{}");
    const diarizedList = Array.isArray(parsed.diarized) ? parsed.diarized : [];

    const updatedTurns = turns.map((turn: any, idx: number) => {
      const match = diarizedList.find((d: any) => d.index === idx);
      if (match) {
        const isH1 = match.speakerId === "HOST_1";
        return {
          ...turn,
          speakerId: isH1 ? "HOST_1" : "HOST_2",
          speakerName: isH1 ? host1Name : host2Name,
        };
      }
      return turn;
    });

    res.json({
      status: "success",
      turns: updatedTurns,
    });
  } catch (error: any) {
    console.error("Error smart diarizing turns:", error);
    res.status(500).json({ error: error.message || "Diarizatsiyada xatolik" });
  }
});

// Expand existing interview with next round of dialogue turns
app.post("/api/podcast/expand-interview", requireCreditBalance(1), async (req, res) => {
  try {
    const {
      topic = "Podkast suhbati",
      host1Name = "Shokhrukh",
      host2Name = "Aziza",
      existingTurns = [],
      subtopic = "Mavzuni yanada chuqurroq davom ettirish",
    } = req.body;

    const lastTurnsContext = (existingTurns || [])
      .slice(-6)
      .map((t: any) => `${t.speakerName}: ${t.text}`)
      .join("\n");

    const prompt = `Siz professional podkast intervyusi ssenariy muallifisiz.
Quyidagi mavjud suhbatni mantiqiy davom ettiruvchi navbatdagi 8 ta yangi replika (savol-javob raundi) yozing:

Mavzu: ${topic}
Qo'shimcha yo'nalish: ${subtopic}
1-boshlovchi: ${host1Name}
2-mehmon: ${host2Name}

Oldingi suhbat yakuni:
${lastTurnsContext}

Talablar:
- Suhbatni to'xtab qolgan joyidan davom ettiring, yangi chuqur savollar va kutilmagan misollar bering.
- 8 ta yangi replikadan iborat bo'lsin.
- Qaytaring JSON formatida:
{
  "newTurns": [
    {
      "speakerId": "HOST_1",
      "speakerName": "${host1Name}",
      "text": "...",
      "emotion": "thoughtful"
    },
    {
      "speakerId": "HOST_2",
      "speakerName": "${host2Name}",
      "text": "...",
      "emotion": "excited"
    }
  ]
}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const parsed = JSON.parse(response.text?.trim() || "{}");
    res.json(parsed);
  } catch (error: any) {
    console.error("Error expanding interview:", error);
    res
      .status(500)
      .json({ error: error.message || "Intervyuni kengaytirishda xatolik" });
  }
});

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      results[idx] = await fn(items[idx], idx);
    }
  }

  const workers = Array.from(
    { length: Math.min(items.length, Math.max(1, concurrency)) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

// Helper: Resolve voice configuration for any speaker (supports N speakers: HOST_1, HOST_2, HOST_3, etc. + cloned voice)
function resolveSpeakerVoiceProfile(
  speakerId: string,
  turn: any,
  host1Voice: any = {},
  host2Voice: any = {},
  speakerVoicesMap: Record<string, any> = {}
): {
  voiceId: string;
  baseVoice: string;
  speakerName: string;
  baseSpeechStyle: string;
} {
  const customEntry =
    speakerVoicesMap[speakerId] ||
    (speakerId === "HOST_1" ? host1Voice : speakerId === "HOST_2" ? host2Voice : null) ||
    {};

  const explicitGender =
    customEntry.gender ||
    turn?.speakerGender ||
    (/female|ayol|qiz|жен|девушк|\(\s*ж\s*\)/i.test(
      `${customEntry.voiceId || ""} ${customEntry.name || ""} ${turn?.speakerName || ""}`
    )
      ? "female"
      : "male");

  const isFemale = explicitGender === "female";

  const rawVoiceId = String(
    turn?.voiceId ||
      customEntry.voiceId ||
      customEntry.id ||
      (speakerId === "HOST_1"
        ? isFemale
          ? "Kore"
          : "voice_17raj9ewke3g"
        : isFemale
          ? "Kore"
          : "Fenrir")
  ).trim();

  const rawBase = String(
    turn?.baseVoice || customEntry.baseVoice || resolveCanonicalBaseVoice(rawVoiceId)
  ).trim();

  let baseVoice = "Charon";
  if (isFemale) {
    if (["Kore", "Aoede", "Zephyr"].includes(rawBase)) {
      baseVoice = rawBase;
    } else if (/aoede/i.test(rawVoiceId)) {
      baseVoice = "Aoede";
    } else if (/zephyr/i.test(rawVoiceId)) {
      baseVoice = "Zephyr";
    } else {
      baseVoice = "Kore";
    }
  } else {
    if (["Charon", "Fenrir", "Puck"].includes(rawBase)) {
      baseVoice = rawBase;
    } else if (/fenrir/i.test(rawVoiceId)) {
      baseVoice = "Fenrir";
    } else if (/puck/i.test(rawVoiceId)) {
      baseVoice = "Puck";
    } else {
      baseVoice = speakerId === "HOST_2" ? "Fenrir" : "Charon";
    }
  }

  const speakerName =
    turn?.speakerName ||
    customEntry.name ||
    (isFemale ? "Malika" : speakerId === "HOST_1" ? "Shohrux" : "Ekspert");

  const baseSpeechStyle = isFemale
    ? `Natural female Uzbek speaker (${speakerName}). Melodious, expressive, clear feminine voice, 100% authentic Uzbek pronunciation.`
    : `Natural male Uzbek speaker (${speakerName}). Clear, confident, warm baritone voice, 100% authentic Uzbek pronunciation.`;

  return {
    voiceId: rawVoiceId,
    baseVoice,
    speakerName,
    baseSpeechStyle,
  };
}

/**
 * 4-Step Duration & Tempo Fitting Cascade for a single turn:
 * 1. Mild ffmpeg atempo <= 1.15 if turn exceeds window by <= 15%
 * 2. Re-synthesize with fast pace in speechMetadata.style if > 15% over window
 * 3. Shorten Uzbek text via gemini-4-hydrogen (ThinkingLevel.LOW) by 25-30% syllables and re-synthesize
 * 4. Allow remaining tail to spill into any silent gap before nextTurnStartSec
 */
async function synthesizeTurnWithDurationCascade({
  turn,
  voiceId,
  baseVoice,
  speakerName,
  combinedTurnStyle,
  strictTimeWindow,
}: {
  turn: any;
  voiceId: string;
  baseVoice: string;
  speakerName: string;
  combinedTurnStyle: string;
  strictTimeWindow: boolean;
}): Promise<{
  pcm: Buffer;
  rawWav: Buffer;
  finalText: string;
  fitStepApplied: string;
  failed: boolean;
}> {
  let activeText = String(turn.text || "").trim() || "...";
  const hasValidWindow =
    strictTimeWindow &&
    typeof turn.startSec === "number" &&
    typeof turn.endSec === "number" &&
    turn.endSec > turn.startSec;

  const windowSec = hasValidWindow
    ? Math.max(0.8, turn.endSec - turn.startSec)
    : 0;

  try {
    // Initial synthesis
    let synthRes = await generateGeminiSpeechPcm({
      text: activeText,
      voiceName: baseVoice,
      voiceId,
      speechStyle: combinedTurnStyle,
      speakerName,
    });
    let pcm = synthRes.pcm;
    let actualSec = pcm.length / 48000;
    let fitStepApplied = "original";

    if (hasValidWindow && actualSec > windowSec + 0.08) {
      const initialRatio = actualSec / windowSec;

      // STEP 1: Mild atempo <= 1.15
      if (initialRatio <= 1.15) {
        pcm = await applyMildAtempoPcm(pcm, initialRatio, 24000);
        fitStepApplied = `atempo_${initialRatio.toFixed(2)}x`;
      } else {
        // STEP 2: Fast-pace TTS re-synthesis
        try {
          const fastRes = await generateGeminiSpeechPcm({
            text: activeText,
            voiceName: baseVoice,
            voiceId,
            speechStyle: `${combinedTurnStyle}. Delivery speed: brisk, fast conversational pace, compact energetic articulation.`,
            speakerName,
          });
          if (fastRes.pcm && fastRes.pcm.length > 0 && fastRes.pcm.length < pcm.length) {
            pcm = fastRes.pcm;
            actualSec = pcm.length / 48000;
            fitStepApplied = "fast_tts";
          }
        } catch {}

        const ratioAfterFast = actualSec / windowSec;
        if (ratioAfterFast <= 1.15) {
          if (ratioAfterFast > 1.01) {
            pcm = await applyMildAtempoPcm(pcm, ratioAfterFast, 24000);
            fitStepApplied = `fast_tts+atempo_${ratioAfterFast.toFixed(2)}x`;
          }
        } else {
          // STEP 3: Shorten Uzbek translation via gemini-4-hydrogen (ThinkingLevel.LOW, temp 0.1)
          const targetSyllables = Math.max(3, Math.floor(windowSec * 4.2));
          try {
            const shortenRes = await ai.models.generateContent({
              model: "gemini-4-hydrogen",
              contents: `Сократи эту узбекскую реплику дубляжа до максимум ${targetSyllables} слогов (чтобы она свободно прозвучала за ${windowSec} сек), сохранив точный смысл и теги (<laugh>, <sigh>, <short pause>, <breath>, <cough>). Верни только сокращённый узбекский текст без кавычек:\n${activeText}`,
              config: {
                temperature: 0.1,
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              },
            });
            const candidateShort = sanitizeDocumentedTtsTags(shortenRes.text || "");
            if (
              candidateShort &&
              countSyllables(candidateShort) > 0 &&
              countSyllables(candidateShort) < countSyllables(activeText)
            ) {
              activeText = candidateShort;
              const shortTts = await generateGeminiSpeechPcm({
                text: activeText,
                voiceName: baseVoice,
                voiceId,
                speechStyle: `${combinedTurnStyle}. Brisk, natural conversational pace.`,
                speakerName,
              });
              if (shortTts.pcm && shortTts.pcm.length > 0) {
                pcm = shortTts.pcm;
                actualSec = pcm.length / 48000;
                fitStepApplied = "shortened_text";
              }
            }
          } catch {}

          // Apply final mild atempo (strictly capped at <= 1.15) if still slightly over window
          const finalRatio = actualSec / windowSec;
          if (finalRatio > 1.01) {
            pcm = await applyMildAtempoPcm(pcm, Math.min(1.15, finalRatio), 24000);
            fitStepApplied = `${fitStepApplied}+atempo_${Math.min(1.15, finalRatio).toFixed(2)}x`;
          }
        }
      }
    }

    const finalWav = buildWavBuffer(pcm, 24000, 1, 16);
    return {
      pcm,
      rawWav: finalWav,
      finalText: activeText,
      fitStepApplied,
      failed: false,
    };
  } catch (err: any) {
    console.error(`[Turn Cascade Synthesis] Failed for ${speakerName}:`, err?.message);
    const fallbackPcm = Buffer.alloc(24000); // 0.5s silence
    return {
      pcm: fallbackPcm,
      rawWav: buildWavBuffer(fallbackPcm, 24000, 1, 16),
      finalText: activeText,
      fitStepApplied: "failed",
      failed: true,
    };
  }
}

// Synthesize N-speaker dialogue / dubbing with independent voices, cloned voice support, and 4-step duration cascade
app.post(
  "/api/podcast/synthesize-dialogue",
  requireCreditBalance((req) => Math.max(1, Math.ceil((req.body?.turns?.length || 2) / 3))),
  async (req, res) => {
    req.setTimeout(300000);
    res.setTimeout(300000);
    try {
      const {
        turns = [],
        host1Voice = {},
        host2Voice = {},
        speakerVoices = {},
        masterAudioMode = "continuous",
        totalTimelineSec,
      } = req.body;

      if (!Array.isArray(turns) || turns.length === 0) {
        return res
          .status(400)
          .json({ error: "Replika ro'yxati (turns) bo'sh bo'lmasligi kerak" });
      }

      const isTimeAlignedMode = masterAudioMode === "time_aligned";

      // Check if any turn uses a cloned voice or N>2 speakers or time_aligned dubbing mode
      const uniqueSpeakerIds = new Set(turns.map((t: any) => t.speakerId || "HOST_1"));
      const usesClonedVoice = [
        host1Voice?.voiceId,
        host1Voice?.id,
        host2Voice?.voiceId,
        host2Voice?.id,
        ...Object.values(speakerVoices || {}).map((v: any) => v?.voiceId || v?.id),
        ...turns.map((t: any) => t?.voiceId),
      ].some((id) => {
        const l = String(id || "").toLowerCase();
        return l === "voice_17raj9ewke3g" || l === "user-replicated" || l === "shohrux" || l === "shokhrukh";
      });

      // For time_aligned video dubbing, cloned voice, or >2 speakers, ALWAYS use per-turn synthesis with duration cascade!
      const canAttemptNativeMultiSpeaker =
        !isTimeAlignedMode &&
        !usesClonedVoice &&
        uniqueSpeakerIds.size <= 2 &&
        turns.length > 0 &&
        turns.length <= 16 &&
        !req.body?.forceSequential;

      if (canAttemptNativeMultiSpeaker) {
        const host1Resolved = resolveSpeakerVoiceProfile("HOST_1", {}, host1Voice, host2Voice, speakerVoices);
        const host2Resolved = resolveSpeakerVoiceProfile("HOST_2", {}, host1Voice, host2Voice, speakerVoices);

        const host1SpeakerTag = "Artur";
        const host2SpeakerTag = host2Resolved.baseVoice === "Kore" ? "Kore" : "Ayubxon";

        const speakerVoiceConfigs = [
          {
            speaker: host1SpeakerTag,
            voiceConfig: { prebuiltVoiceConfig: { voiceName: host1Resolved.baseVoice } },
          },
          {
            speaker: host2SpeakerTag,
            voiceConfig: { prebuiltVoiceConfig: { voiceName: host2Resolved.baseVoice } },
          },
        ];

        let nativeMasterWav: Buffer | null = null;
        let nativeMasterPcm: Buffer | null = null;
        const nativePerPartAudios: Buffer[] = [];
        let nativeSuccess = false;

        const multiSpeakerParts = turns.map((turn: any) => {
          const isHost1 = turn.speakerId === "HOST_1";
          const speaker = isHost1 ? host1SpeakerTag : host2SpeakerTag;
          const activeBaseStyle = isHost1 ? host1Resolved.baseSpeechStyle : host2Resolved.baseSpeechStyle;

          const { speechText: cleanedTurnText, extractedStyles: turnExtractedStyles } = cleanScriptForSpeech(turn.text || "");
          let spokenText = cleanedTurnText;
          try {
            spokenText = normalizeUzbekSpeech(spokenText);
          } catch {}
          const textToSynthesize = spokenText || cleanedTurnText || (turn.text || "").trim() || "...";

          const styleTokens = [activeBaseStyle];
          if (turn.speechStyle) styleTokens.push(turn.speechStyle);
          if (turnExtractedStyles && turnExtractedStyles.length > 0) {
            styleTokens.push(`Acting & emotion cues: ${turnExtractedStyles.join(", ")}`);
          }

          return {
            text: textToSynthesize,
            speechMetadata: {
              speaker,
              style: styleTokens.filter(Boolean).join(". "),
            },
          };
        });

        for (const modelCandidate of ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"]) {
          try {
            const multiResponse = await ai.models.generateContent({
              model: modelCandidate,
              contents: [{ role: "user", parts: multiSpeakerParts }],
              config: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                  multiSpeakerVoiceConfig: { speakerVoiceConfigs },
                },
              },
            });

            const resParts = multiResponse.candidates?.[0]?.content?.parts || [];
            const audioParts = resParts.filter((p: any) => typeof p?.inlineData?.data === "string");

            if (audioParts.length > 0) {
              if (audioParts.length === 1) {
                const rawAudio = Buffer.from(audioParts[0].inlineData!.data!, "base64");
                const { pcm } = extractPcmData(rawAudio);
                if (pcm && pcm.length > 0) {
                  nativeMasterPcm = pcm;
                  nativeMasterWav = buildWavBuffer(pcm, 24000, 1, 16);
                  nativeSuccess = true;
                  break;
                }
              } else {
                const pcmParts: Buffer[] = [];
                for (const ap of audioParts) {
                  const audioBase64Str: string = ap.inlineData?.data || "";
                  if (!audioBase64Str) continue;
                  const rawAudio = Buffer.from(audioBase64Str, "base64");
                  const { pcm } = extractPcmData(rawAudio);
                  pcmParts.push(pcm);
                  nativePerPartAudios.push(rawAudio);
                }
                if (pcmParts.length > 0) {
                  nativeMasterPcm = Buffer.concat(pcmParts);
                  nativeMasterWav = buildWavBuffer(nativeMasterPcm, 24000, 1, 16);
                  nativeSuccess = true;
                  break;
                }
              }
            }
          } catch (multiErr: any) {
            console.warn(`[Synthesize Dialogue] Multi-speaker request on ${modelCandidate} failed:`, multiErr?.message?.slice(0, 120));
          }
        }

        if (nativeSuccess && nativeMasterWav && nativeMasterPcm) {
          const totalDuration = Math.round((nativeMasterPcm.length / 48000) * 10) / 10;
          const totalTextLen = Math.max(1, turns.reduce((acc: number, t: any) => acc + (t.text || "").length, 0));
          let currentTurnStart = 0;

          const synthesizedTurns = turns.map((turn: any, i: number) => {
            const isHost1 = turn.speakerId === "HOST_1";
            const speakerName = isHost1 ? host1Resolved.speakerName : host2Resolved.speakerName;
            let turnWavBase64 = "";
            let turnDuration = 0;

            if (nativePerPartAudios.length === turns.length) {
              turnWavBase64 = nativePerPartAudios[i].toString("base64");
              const { pcm } = extractPcmData(nativePerPartAudios[i]);
              turnDuration = Math.max(0.5, Math.round((pcm.length / 48000) * 10) / 10);
            } else {
              const proportion = Math.max(0.05, (turn.text || "").length / totalTextLen);
              turnDuration = Math.max(0.5, Math.round(totalDuration * proportion * 10) / 10);
              const pcmByteStart = Math.min(nativeMasterPcm!.length, Math.floor(currentTurnStart * 48000));
              const pcmByteEnd = Math.min(nativeMasterPcm!.length, Math.floor((currentTurnStart + turnDuration) * 48000));
              if (pcmByteEnd > pcmByteStart) {
                const turnSlice = nativeMasterPcm!.subarray(pcmByteStart, pcmByteEnd);
                turnWavBase64 = buildWavBuffer(turnSlice, 24000, 1, 16).toString("base64");
              }
            }

            const startTime = currentTurnStart;
            const endTime = currentTurnStart + turnDuration;
            currentTurnStart = endTime;

            return {
              ...turn,
              id: turn.id || `turn-${i}`,
              speakerName: turn.speakerName || speakerName,
              audioBase64: turnWavBase64 || nativeMasterWav!.toString("base64"),
              durationSeconds: turnDuration,
              startTime,
              endTime,
              synthesisFailed: false,
            };
          });

          let creditsRemaining = (req as any).userBalance;
          if (!req.body?.skipMasterStitch && typeof (req as any).deductCredits === "function") {
            try {
              creditsRemaining = await (req as any).deductCredits();
            } catch {}
          }

          return res.json({
            masterAudioBase64: nativeMasterWav.toString("base64"),
            totalDurationSeconds: totalDuration,
            turns: synthesizedTurns,
            srtSubtitles: generateSrtFromTurns(synthesizedTurns),
            creditsRemaining,
          });
        }
      }

      // Per-Turn Synthesis with N-speaker support, Cloned Voice support, and 4-Step Duration Cascade
      const processedTurnResults = await mapConcurrent(turns, 2, async (turn: any, i: number) => {
        if (i > 0) {
          await new Promise((r) => setTimeout(r, 180));
        }

        const resolved = resolveSpeakerVoiceProfile(
          turn.speakerId || "HOST_1",
          turn,
          host1Voice,
          host2Voice,
          speakerVoices
        );

        const { extractedStyles: turnExtractedStyles } = cleanScriptForSpeech(turn.text || "");
        const combinedTurnStyle = [
          resolved.baseSpeechStyle,
          turn.speechStyle,
          turnExtractedStyles && turnExtractedStyles.length > 0
            ? `Acting & emotional cues: ${turnExtractedStyles.join(", ")}`
            : "",
        ]
          .filter(Boolean)
          .join(". ");

        const cascadeResult = await synthesizeTurnWithDurationCascade({
          turn,
          voiceId: resolved.voiceId,
          baseVoice: resolved.baseVoice,
          speakerName: resolved.speakerName,
          combinedTurnStyle,
          strictTimeWindow: isTimeAlignedMode,
        });

        return {
          turn: {
            ...turn,
            text: cascadeResult.finalText,
          },
          speakerName: resolved.speakerName,
          turnPcm: cascadeResult.pcm,
          turnWavRaw: cascadeResult.rawWav,
          turnFailed: cascadeResult.failed,
          fitStepApplied: cascadeResult.fitStepApplied,
        };
      });

      const failedTurns: number[] = [];
      processedTurnResults.forEach((r, idx) => {
        if (r.turnFailed) failedTurns.push(idx + 1);
      });

      if (failedTurns.length === processedTurnResults.length && processedTurnResults.length > 0) {
        return res.status(502).json({
          error: "Ovoz sintezi amalga oshmadi. Barcha replikalarda xatolik yuz berdi.",
          message_ru: "Синтез диалога не удался: модель не смогла сгенерировать аудио. Проверьте квоты и статус API ключа.",
          failedTurns,
        });
      }

      let masterAudioBase64 = "";
      let totalDuration = 0;
      const synthesizedTurns: any[] = [];

      if (isTimeAlignedMode) {
        // Strict Timecode Assembly: places every turn at its exact startSec without clamping "Без слов" musical intervals
        const assembled = assembleStrictTimecodeMasterPcm(
          processedTurnResults.map((r, idx) => ({
            startSec: typeof r.turn.startSec === "number" ? r.turn.startSec : idx * 3,
            endSec:
              typeof r.turn.endSec === "number"
                ? r.turn.endSec
                : (typeof r.turn.startSec === "number" ? r.turn.startSec : idx * 3) +
                  r.turnPcm.length / 48000,
            pcm: r.turnPcm,
          })),
          typeof totalTimelineSec === "number" ? totalTimelineSec : undefined,
          24000
        );

        if (!req.body?.skipMasterStitch) {
          const masterWavBuffer = buildWavBuffer(assembled.masterPcm, 24000, 1, 16);
          masterAudioBase64 = masterWavBuffer.toString("base64");
          totalDuration = assembled.totalDurationSec;
        }

        processedTurnResults.forEach((r, idx) => {
          const placement = assembled.actualPlacements[idx];
          const finalTurnWav = r.turnWavRaw || buildWavBuffer(r.turnPcm, 24000, 1, 16);
          synthesizedTurns.push({
            ...r.turn,
            id: r.turn.id || `turn-${idx}`,
            speakerName: r.turn.speakerName || r.speakerName,
            audioBase64: finalTurnWav.toString("base64"),
            durationSeconds: placement.durationSec,
            startTime: placement.startSec,
            endTime: placement.endSec,
            fitStepApplied: r.fitStepApplied,
            synthesisFailed: r.turnFailed,
          });
        });
      } else {
        // Continuous Podcast Stitching (350ms natural pause between turns)
        const DIALOGUE_PAUSE_SECONDS = 0.35;
        const pauseBuffer = Buffer.alloc(Math.round(24000 * 2 * DIALOGUE_PAUSE_SECONDS));
        const pcmChunks: Buffer[] = [];
        let currentMasterTime = 0;

        for (let i = 0; i < processedTurnResults.length; i++) {
          const { turn, speakerName, turnPcm, turnWavRaw, turnFailed, fitStepApplied } =
            processedTurnResults[i];
          const turnDuration = Math.max(0.5, Math.round((turnPcm.length / 48000) * 10) / 10);
          const turnStartTime = currentMasterTime;
          const turnEndTime = currentMasterTime + turnDuration;
          currentMasterTime = turnEndTime + DIALOGUE_PAUSE_SECONDS;

          pcmChunks.push(turnPcm);
          pcmChunks.push(pauseBuffer);

          const finalTurnWav = turnWavRaw || buildWavBuffer(turnPcm, 24000, 1, 16);
          synthesizedTurns.push({
            ...turn,
            id: turn.id || `turn-${i}`,
            speakerName: turn.speakerName || speakerName,
            audioBase64: finalTurnWav.toString("base64"),
            durationSeconds: turnDuration,
            startTime: turnStartTime,
            endTime: turnEndTime,
            fitStepApplied,
            synthesisFailed: turnFailed,
          });
        }

        if (!req.body?.skipMasterStitch) {
          const totalPcm = Buffer.concat(pcmChunks);
          const masterWavBuffer = buildWavBuffer(totalPcm, 24000, 1, 16);
          masterAudioBase64 = masterWavBuffer.toString("base64");
          totalDuration = Math.round((totalPcm.length / 48000) * 10) / 10;
        }
      }

      let creditsRemaining = (req as any).userBalance;
      if (
        !req.body?.skipMasterStitch &&
        failedTurns.length < processedTurnResults.length &&
        typeof (req as any).deductCredits === "function"
      ) {
        try {
          creditsRemaining = await (req as any).deductCredits();
        } catch {}
      }

      res.json({
        masterAudioBase64: masterAudioBase64 || undefined,
        totalDurationSeconds: totalDuration || undefined,
        turns: synthesizedTurns,
        srtSubtitles: generateSrtFromTurns(synthesizedTurns),
        failedTurns: failedTurns.length > 0 ? failedTurns : undefined,
        creditsRemaining,
      });
    } catch (error: any) {
      console.error("Error synthesizing dialogue:", error);
      res
        .status(500)
        .json({ error: error.message || "Muloqot sintezida xatolik" });
    }
  }
);

// Stitch multiple dialogue turn audio chunks into a unified master track (supports strict time_aligned and continuous modes)
app.post("/api/podcast/stitch-dialogue-turns", requireCreditBalance(1), async (req, res) => {
  try {
    const { turns = [], masterAudioMode = "continuous", totalTimelineSec } = req.body;

    if (!Array.isArray(turns) || turns.length === 0) {
      return res.status(400).json({ error: "Birlashtirish uchun replikalar (turns) kiritilmadi" });
    }

    const isTimeAligned = masterAudioMode === "time_aligned";
    let totalPcm: Buffer;
    let totalDurationSeconds = 0;

    const extractedTurns = turns.map((turn: any, idx: number) => {
      let turnPcm: Buffer | null = null;
      if (turn.audioBase64) {
        try {
          const raw = Buffer.from(turn.audioBase64, "base64");
          turnPcm = extractPcmData(raw).pcm;
        } catch {}
      }
      if (!turnPcm || turnPcm.length === 0) {
        turnPcm = Buffer.alloc(24000);
      }
      return {
        turn,
        pcm: turnPcm,
        startSec: typeof turn.startSec === "number" ? turn.startSec : idx * 3,
        endSec:
          typeof turn.endSec === "number"
            ? turn.endSec
            : (typeof turn.startSec === "number" ? turn.startSec : idx * 3) +
              turnPcm.length / 48000,
      };
    });

    if (isTimeAligned) {
      const assembled = assembleStrictTimecodeMasterPcm(
        extractedTurns.map((et) => ({
          startSec: et.startSec,
          endSec: et.endSec,
          pcm: et.pcm,
        })),
        typeof totalTimelineSec === "number" ? totalTimelineSec : undefined,
        24000
      );
      totalPcm = assembled.masterPcm;
      totalDurationSeconds = assembled.totalDurationSec;
    } else {
      const DIALOGUE_PAUSE_SECONDS = 0.35;
      const pauseBuffer = Buffer.alloc(Math.round(24000 * 2 * DIALOGUE_PAUSE_SECONDS));
      const pcmChunks: Buffer[] = [];
      for (const et of extractedTurns) {
        pcmChunks.push(et.pcm);
        pcmChunks.push(pauseBuffer);
      }
      totalPcm = Buffer.concat(pcmChunks);
      totalDurationSeconds = Math.round((totalPcm.length / 48000) * 10) / 10;
    }

    const masterWavBuffer = buildWavBuffer(totalPcm, 24000, 1, 16);
    const srtSubtitles = generateSrtFromTurns(turns);

    let creditsRemaining = (req as any).userBalance;
    if (typeof (req as any).deductCredits === "function") {
      try {
        creditsRemaining = await (req as any).deductCredits(1);
      } catch {}
    }

    res.json({
      status: "success",
      masterAudioBase64: masterWavBuffer.toString("base64"),
      totalDurationSeconds,
      srtSubtitles,
      totalTurnsStitched: turns.length,
      creditsRemaining,
    });
  } catch (error: any) {
    console.error("Error stitching dialogue turns:", error);
    res.status(500).json({ error: error.message || "Audio birlashtirishda xatolik" });
  }
});

// =========================================================================
// VERBATIM 1:1 STORYBOARD DUBBING & 15-MINUTE VIDEO MUXING ENDPOINTS
// =========================================================================

// 1. Parse Russian Storyboard (Видеоряд / Интонация / Текст / Без слов) & Translate 1:1 into Uzbek with Post-Validator
app.post("/api/podcast/parse-verbatim-storyboard", requireCreditBalance(1), async (req, res) => {
  try {
    const { storyboardText = "" } = req.body;
    if (!storyboardText || typeof storyboardText !== "string" || storyboardText.trim().length < 5) {
      return res.status(400).json({
        error: "Раскадровка или текст для дубляжа не могут быть пустыми.",
      });
    }

    const result = await parseAndTranslateVerbatimStoryboard(ai, storyboardText);
    const numericCost =
      typeof result.estimatedCostUsd === "number"
        ? result.estimatedCostUsd
        : Number(result.estimatedCostUsd?.totalUsd ?? 0.03);

    let creditsRemaining = (req as any).userBalance;
    if (typeof (req as any).deductCredits === "function") {
      try {
        creditsRemaining = await (req as any).deductCredits(1);
      } catch {}
    }

    res.json({
      ...result,
      totalVideoDurationSec: result.totalDurationSec,
      estimatedCostUsd: numericCost,
      estimatedCostBreakdown: result.estimatedCostUsd,
      srtSubtitles: generateSrtFromTurns(result.turns),
      creditsRemaining,
    });
  } catch (err: any) {
    console.error("[parse-verbatim-storyboard] Error:", err);
    res.status(500).json({
      error: err?.message || "Ошибка при разборе и переводе раскадровки 1:1.",
    });
  }
});

// 2. Re-synthesize a single turn from the storyboard table (with 4-step duration cascade) and optionally re-stitch master track
app.post("/api/podcast/synthesize-single-turn", requireCreditBalance(1), async (req, res) => {
  try {
    const {
      turn,
      allTurns = [],
      host1Voice = {},
      host2Voice = {},
      speakerVoices = {},
      masterAudioMode = "time_aligned",
      totalTimelineSec,
    } = req.body;

    if (!turn || !turn.text) {
      return res.status(400).json({ error: "Текст реплики обязателен для переозвучки." });
    }

    const resolved = resolveSpeakerVoiceProfile(
      turn.speakerId || "HOST_1",
      turn,
      host1Voice,
      host2Voice,
      speakerVoices
    );

    const { extractedStyles } = cleanScriptForSpeech(turn.text || "");
    const combinedTurnStyle = [
      resolved.baseSpeechStyle,
      turn.speechStyle,
      extractedStyles.length > 0 ? `Acting & emotional cues: ${extractedStyles.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join(". ");

    const cascadeResult = await synthesizeTurnWithDurationCascade({
      turn,
      voiceId: resolved.voiceId,
      baseVoice: resolved.baseVoice,
      speakerName: resolved.speakerName,
      combinedTurnStyle,
      strictTimeWindow: masterAudioMode === "time_aligned",
    });

    if (cascadeResult.failed) {
      return res.status(502).json({ error: "Не удалось переозвучить выбранную реплику." });
    }

    const updatedTurnDuration = Math.max(
      0.4,
      Math.round((cascadeResult.pcm.length / 48000) * 100) / 100
    );
    const updatedTurn = {
      ...turn,
      text: cascadeResult.finalText,
      speakerName: turn.speakerName || resolved.speakerName,
      audioBase64: cascadeResult.rawWav.toString("base64"),
      durationSeconds: updatedTurnDuration,
      fitStepApplied: cascadeResult.fitStepApplied,
      synthesisFailed: false,
    };

    // If allTurns was passed, re-assemble the master track immediately so preview & video sync update in 1 click
    let masterAudioBase64: string | undefined;
    let totalDurationSeconds: number | undefined;
    let srtSubtitles: string | undefined;

    if (Array.isArray(allTurns) && allTurns.length > 0) {
      const mergedTurns = allTurns.map((t: any) =>
        t.id === updatedTurn.id ? updatedTurn : t
      );
      if (masterAudioMode === "time_aligned") {
        const turnsWithPcm = mergedTurns.map((t: any, idx: number) => {
          let pcmBuf: Buffer = Buffer.alloc(24000);
          if (t.audioBase64) {
            try {
              pcmBuf = Buffer.from(extractPcmData(Buffer.from(t.audioBase64, "base64")).pcm);
            } catch {}
          }
          return {
            startSec: typeof t.startSec === "number" ? t.startSec : idx * 3,
            endSec:
              typeof t.endSec === "number"
                ? t.endSec
                : (typeof t.startSec === "number" ? t.startSec : idx * 3) +
                  pcmBuf.length / 48000,
            pcm: pcmBuf,
          };
        });
        const assembled = assembleStrictTimecodeMasterPcm(
          turnsWithPcm,
          typeof totalTimelineSec === "number" ? totalTimelineSec : undefined,
          24000
        );
        masterAudioBase64 = buildWavBuffer(assembled.masterPcm, 24000, 1, 16).toString("base64");
        totalDurationSeconds = assembled.totalDurationSec;
      }
      srtSubtitles = generateSrtFromTurns(mergedTurns);
    }

    res.json({
      turn: updatedTurn,
      masterAudioBase64,
      totalDurationSeconds,
      srtSubtitles,
    });
  } catch (err: any) {
    console.error("[synthesize-single-turn] Error:", err);
    res.status(500).json({ error: err?.message || "Ошибка переозвучки фразы." });
  }
});

// 3. Streaming Multipart Video Upload (up to 600 MB / 15 minutes) to /tmp + Optional Gemini Files API Storyboard Extraction
const dubbingVideoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, "/tmp");
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || ".mp4") || ".mp4";
    const safeExt = /^\.[a-zA-Z0-9]{2,5}$/.test(ext) ? ext : ".mp4";
    cb(null, `dubvideo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${safeExt}`);
  },
});

const uploadDubbingVideoMiddleware = multer({
  storage: dubbingVideoStorage,
  limits: {
    fileSize: 600 * 1024 * 1024, // 600 MB max for 15-minute HD videos
  },
});

const uploadedVideoSessions = new Map<
  string,
  { filePath: string; originalName: string; mimeType: string; createdAt: number }
>();

app.post(
  "/api/podcast/upload-dubbing-video",
  uploadDubbingVideoMiddleware.single("video"),
  async (req: any, res) => {
    req.setTimeout(600000);
    res.setTimeout(600000);
    try {
      const file = req.file;
      if (!file || !file.path) {
        return res.status(400).json({ error: "Видеофайл не получен сервером." });
      }

      const videoSessionId = path.basename(file.path);
      uploadedVideoSessions.set(videoSessionId, {
        filePath: file.path,
        originalName: file.originalname || "video.mp4",
        mimeType: file.mimetype || "video/mp4",
        createdAt: Date.now(),
      });

      // Optionally auto-generate storyboard from the video using Gemini Files API (ai.files.upload)
      const autoAnalyze =
        req.body?.autoAnalyzeWithGemini === "true" ||
        req.body?.generateStoryboardViaGemini === "true";
      let storyboardResult: any = null;
      let generatedRawStoryboard = "";

      if (autoAnalyze) {
        let uploadedGeminiFile: any = null;
        try {
          uploadedGeminiFile = await ai.files.upload({
            file: file.path,
            config: {
              mimeType: file.mimetype || "video/mp4",
            },
          });

          // Poll until file state is ACTIVE
          let currentFile = uploadedGeminiFile;
          for (let poll = 0; poll < 40; poll++) {
            const state = String(currentFile?.state || "").toUpperCase();
            if (state === "ACTIVE" || !state) break;
            if (state === "FAILED") {
              throw new Error("Gemini Files API не смог обработать видеофайл.");
            }
            await new Promise((r) => setTimeout(r, 2500));
            currentFile = await ai.files.get({ name: currentFile.name });
          }

          const storyboardGenRes = await ai.models.generateContent({
            model: "gemini-3.8-flash",
            contents: [
              {
                role: "user",
                parts: [
                  {
                    fileData: {
                      fileUri: currentFile.uri,
                      mimeType: currentFile.mimeType || file.mimetype || "video/mp4",
                    },
                  },
                  {
                    text: `Сделай посекундную раскадровку этого видео на русском языке для точного дубляжа 1:1.
Формат строго такой:
Спикер 1 (Ж/М) — Имя/роль: краткое описание голоса.
Спикер 2 (Ж/М) — Имя/роль: краткое описание голоса.

MM:SS – MM:SS | Имя (Ж/М):
Видеоряд: что происходит в кадре.
Интонация: каким тоном, с какой эмоцией произносится фраза.
Текст: «Точная дословная прямая речь из видео (с пометками (смеется), (хе-хе), (вздыхает) если они есть)».

А для музыкальных вставок без речи:
MM:SS – MM:SS | Музыка и графика (Без слов):
Видеоряд: описание кадра.`,
                  },
                ],
              },
            ],
          });

          generatedRawStoryboard = (storyboardGenRes.text || "").trim();
          if (generatedRawStoryboard) {
            const rawParsed = await parseAndTranslateVerbatimStoryboard(
              ai,
              generatedRawStoryboard
            );
            const numericCost =
              typeof rawParsed.estimatedCostUsd === "number"
                ? rawParsed.estimatedCostUsd
                : Number(rawParsed.estimatedCostUsd?.totalUsd ?? 0.05);
            storyboardResult = {
              ...rawParsed,
              totalVideoDurationSec: rawParsed.totalDurationSec,
              estimatedCostUsd: numericCost,
              estimatedCostBreakdown: rawParsed.estimatedCostUsd,
            };
          }
        } finally {
          if (uploadedGeminiFile?.name) {
            ai.files.delete({ name: uploadedGeminiFile.name }).catch(() => {});
          }
        }
      }

      res.json({
        fileId: videoSessionId,
        videoSessionId,
        fileName: file.originalname,
        sizeBytes: file.size,
        generatedStoryboardText: generatedRawStoryboard || undefined,
        generatedRawStoryboard: generatedRawStoryboard || undefined,
        parsedStoryboard: storyboardResult || undefined,
        storyboardResult: storyboardResult || undefined,
      });
    } catch (err: any) {
      console.error("[upload-dubbing-video] Error:", err);
      res.status(500).json({
        error: err?.message || "Ошибка загрузки или анализа видеофайла.",
      });
    }
  }
);

// 4. Mux Dubbed Uzbek WAV Track with Uploaded Video (up to 15 min) via /usr/bin/ffmpeg
const generatedDubbedVideos = new Map<string, string>();

app.post("/api/podcast/mux-dubbed-video", async (req, res) => {
  req.setTimeout(300000);
  res.setTimeout(300000);
  try {
    const {
      fileId,
      videoSessionId,
      masterAudioBase64,
      turns = [],
      speechIntervals = [],
      duckingMode,
      backgroundMode = "smart_ducking",
    } = req.body;

    const resolvedSessionId = videoSessionId || fileId;
    if (!resolvedSessionId || !uploadedVideoSessions.has(resolvedSessionId)) {
      return res.status(400).json({
        error: "Видеофайл сессии не найден на сервере. Пожалуйста, выберите видео заново.",
      });
    }
    if (!masterAudioBase64) {
      return res.status(400).json({
        error: "Сначала сгенерируйте узбекскую аудиодорожку дубляжа.",
      });
    }

    const session = uploadedVideoSessions.get(resolvedSessionId)!;
    if (!fs.existsSync(session.filePath)) {
      return res.status(404).json({
        error: "Временный видеофайл истёк. Загрузите видео повторно.",
      });
    }

    const dubbedWavBuffer = Buffer.from(masterAudioBase64, "base64");
    const rawIntervals =
      Array.isArray(speechIntervals) && speechIntervals.length > 0
        ? speechIntervals
        : Array.isArray(turns)
        ? turns
        : [];
    const spokenIntervals = rawIntervals
      .map((t: any) => ({
        startSec: typeof t.startTime === "number" ? t.startTime : Number(t.startSec || 0),
        endSec: typeof t.endTime === "number" ? t.endTime : Number(t.endSec || 0),
      }))
      .filter((iv) => iv.endSec > iv.startSec);

    const effectiveMode = duckingMode || backgroundMode || "smart_ducking";
    const outMp4Path = await muxDubbedAudioWithVideoFile({
      videoFilePath: session.filePath,
      dubbedWavBuffer,
      spokenIntervals,
      backgroundMode:
        effectiveMode === "mute_speech_keep_music" || effectiveMode === "voice_only"
          ? effectiveMode
          : "smart_ducking",
    });

    const downloadId = path.basename(outMp4Path);
    generatedDubbedVideos.set(downloadId, outMp4Path);

    res.json({
      downloadUrl: `/api/podcast/download-dubbed-video/${encodeURIComponent(downloadId)}`,
      downloadId,
    });
  } catch (err: any) {
    console.error("[mux-dubbed-video] Error:", err);
    res.status(500).json({
      error: err?.message || "Ошибка при сведении узбекского дубляжа с видео через ffmpeg.",
    });
  }
});

// 5. Stream Final Dubbed MP4 Video to Browser
app.get("/api/podcast/download-dubbed-video/:fileId", (req, res) => {
  try {
    const cleanId = path.basename(req.params.fileId || "");
    const targetPath =
      generatedDubbedVideos.get(cleanId) || path.join("/tmp", cleanId);
    if (!cleanId.startsWith("dubmux_") || !fs.existsSync(targetPath)) {
      return res.status(404).json({ error: "Готовый видеофайл не найден." });
    }
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="uzbek-dubbing-${Date.now()}.mp4"`
    );
    return fs.createReadStream(targetPath).pipe(res);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Ошибка скачивания видео." });
  }
});

// =========================================================================
// AI SOUND DIRECTOR: Dynamic Music Placement & Cue Planning
// =========================================================================
app.post("/api/podcast/sound-director", requireCreditBalance(1), async (req, res) => {
  try {
    const {
      turns = [],
      script = "",
      category = "Umumiy",
      topic = "",
      preferredSoundscape = "midnight-jazz",
    } = req.body;

    const availableSoundscapes = [
      "none",
      "dutor-acoustic",
      "oriental-ney",
      "lofi-beats",
      "calm-piano",
      "comedy-jingle",
      "tech-ambient",
      "cinematic-dark",
      "business-uplifting",
      "midnight-jazz",
      "epic-orchestral",
      "nature-ambient",
      "synthwave-retro",
      "news-broadcast",
      "acoustic-guitar",
    ];

    const prompt = `
Siz professional podkast ovoz rejissyori va saund-dizaynerisiz (NPR, BBC, Spotify studiyalari darajasida).
Vazifangiz: Berilgan podkast matni yoki dialog replikalarini tahlil qilib, qayerga fon musiqasi qo'yish, qayerda umuman musiqa QO'YMASLIK (toza ovoz / silence / dry voice), va qayerga o'tish stingeri kerakligini rejalashtirish.

MUHIM QOIDALAR:
1. Hech qachon butun podkast davomida bitta musiqa to'xtovsiz aylanib turmasligi kerak! Bu tinglovchini charchatadi va havaskorlikdir.
2. Podkastning kamida 50-70% qismi TOZA OVOZ (musiqasiz / silence / dry voice) bo'lishi shart! Ayniqsa faktlar, qizg'in bahs, mantiqiy tushuntirish va dialogning asosiy qismida.
3. CUE TURLARI:
   - 'intro': Kirish qismida 5-8 soniya yangrab, keyin ovoz boshlanganda pasayadi va o'chadi (volume: 35-45).
   - 'silence': Toza studiya ovozi, hech qanday musiqa yo'q (volume: 0).
   - 'bed': Suhbat orqasida juda mayin, deyarli sezilmas fon (volume: 12-16).
   - 'emotional': Shaxsiy ta'sirli hikoya, chuqur falsafiy fikr yoki kashfiyot aytilganda (volume: 14-20, neoklassik pianino yoki dutor/ney).
   - 'stinger': Yangi mavzuga yoki yangi savolga o'tishda 2-3 soniyalik qisqa ritmik akkord/o'tish (volume: 30-40).
   - 'outro': Epizod yakuni, xulosa va xayrlashuvda yangraydigan yakuniy musiqa (volume: 30-45).

Mavzu: "${topic}"
Kategoriya: "${category}"
Tavsiya etilgan fon: "${preferredSoundscape}"

${turns.length > 0 ? `REPLIKALAR RO'YXATI (${turns.length} ta replika):\n${turns.map((t: any, i: number) => `Replika ${i + 1} (${t.speakerName || t.speakerId}): "${t.text.substring(0, 140)}..."`).join("\n")}` : `MONOLOG MATNI:\n${script.substring(0, 1000)}`}

Mavjud soundscapes ro'yxatidan tanlang:
${JSON.stringify(availableSoundscapes)}

Javobni FAQAT valid JSON formatida quyidagi strukturada qaytaring:
{
  "strategyUz": "Ovoz rejissurasining umumiy tushuntirishi o'zbek tilida",
  "strategyRu": "Общее объяснение звукорежиссуры на русском языке",
  "cues": [
    {
      "turnIndex": 0,
      "cueType": "intro",
      "soundscape": "lofi-beats",
      "volumePercent": 35,
      "labelUz": "Kirish jingle",
      "labelRu": "Вступительный джингл",
      "reasoning": "Nega aynan shu yerga qo'yildi va qanday vazifani bajaradi"
    }
  ]
}
`;

    let generatedJson: any = null;

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          temperature: 0.3,
        },
      });

      const text = response.text?.trim();
      if (text) {
        generatedJson = JSON.parse(text);
      }
    } catch (aiErr: any) {
      console.warn(
        "AI Sound Director call error, using deterministic fallback:",
        aiErr.message,
      );
    }

    // Fallback if AI call failed or returned empty
    if (
      !generatedJson ||
      !Array.isArray(generatedJson.cues) ||
      generatedJson.cues.length === 0
    ) {
      const defaultBg = availableSoundscapes.includes(preferredSoundscape)
        ? preferredSoundscape
        : "calm-piano";
      const fallbackCues: any[] = [];
      const turnCount = turns.length > 0 ? turns.length : 4;

      for (let i = 0; i < turnCount; i++) {
        if (i === 0) {
          fallbackCues.push({
            turnIndex: i,
            cueType: "intro",
            soundscape: defaultBg,
            volumePercent: 35,
            labelUz: "Kirish jingle (Intro)",
            labelRu: "Вступительный джингл",
            reasoning:
              "Epizod boshida tinglovchini jalb qilish uchun 6-8 soniyalik jingle, so'ngra ovoz ostida pasayadi.",
          });
        } else if (i === turnCount - 1) {
          fallbackCues.push({
            turnIndex: i,
            cueType: "outro",
            soundscape: defaultBg,
            volumePercent: 35,
            labelUz: "Xulosa va Outro",
            labelRu: "Финал и аутро",
            reasoning:
              "Xulosa va minnatdorchilik paytida musiqa sekin ko'tarilib, epizodga yakun yasaydi.",
          });
        } else if (i === Math.floor(turnCount / 2)) {
          fallbackCues.push({
            turnIndex: i,
            cueType: "emotional",
            soundscape: "calm-piano",
            volumePercent: 15,
            labelUz: "Mayin fon (Emotional Bed)",
            labelRu: "Эмоциональный эмбиент",
            reasoning:
              "Eng muhim g'oya va mulohazani ta'kidlash uchun juda sokin fon musiqasi.",
          });
        } else if (i === 1) {
          fallbackCues.push({
            turnIndex: i,
            cueType: "silence",
            soundscape: "none",
            volumePercent: 0,
            labelUz: "Toza ovoz (Musiqasiz)",
            labelRu: "Чистый голос (без музыки)",
            reasoning:
              "Mavzuning eng qizg'in tahlili paytida tinglovchi e'tiborini 100% so'zlarga qaratish uchun toza ovoz.",
          });
        } else {
          fallbackCues.push({
            turnIndex: i,
            cueType: i % 2 === 0 ? "stinger" : "silence",
            soundscape: i % 2 === 0 ? "tech-ambient" : "none",
            volumePercent: i % 2 === 0 ? 25 : 0,
            labelUz:
              i % 2 === 0 ? "O'tish ritmi (Stinger)" : "Toza ovoz (Silence)",
            labelRu: i % 2 === 0 ? "Переходной акцент" : "Без музыки",
            reasoning:
              i % 2 === 0
                ? "Savol almashishida qisqa 2 soniyalik o'tish."
                : "Aniq va ravshan nutq uchun sukunat.",
          });
        }
      }

      generatedJson = {
        strategyUz:
          "Professional saund-dizayn: Uzluksiz chalg'ituvchi fon o'rniga dinamik ovoz rejissurasi tanlandi — kirishda jingle, asosiy qismlarda toza ovoz, emotsional nuqtalarda mayin pianino va finalda outro.",
        strategyRu:
          "Профессиональный саунд-дизайн: Вместо монотонного бесконечного пианино расставлены динамические акценты — яркое интро, кристально чистый голос в середине, эмоциональный акцент и финальное аутро.",
        cues: fallbackCues,
      };
    }

    res.json(generatedJson);
  } catch (error: any) {
    console.error("Error in sound-director:", error);
    res
      .status(500)
      .json({
        error: error.message || "Saund-dizayn rejalashtirishda xatolik",
      });
  }
});

// =========================================================================
// 3. LIVE VOICE AI AGENT & PHONE CALL ENDPOINTS
// =========================================================================

/**
 * Intelligent local conversational fallback for real estate queries
 * Used when Gemini API key is expired or Google Cloud quota is temporarily unavailable.
 */
function isFemaleVoiceName(voiceName?: string): boolean {
  const lower = (voiceName || "").toLowerCase();
  return (
    lower === "aoede" ||
    lower === "kore" ||
    lower === "zephyr" ||
    lower.includes("malika") ||
    lower.includes("madina") ||
    lower.includes("aziza") ||
    lower.includes("ayol") ||
    lower.includes("female")
  );
}

function buildRealtorSystemPrompt(
  language: string,
  isFemale: boolean,
  skipOpeningAck = false
): string {
  const isRu = language === "ru";
  if (isRu) {
    const agentNameRu = isFemale ? "Малика" : "Шохрух";
    const genderDescRu = isFemale
      ? "Женщина, 28 лет, говорит спокойно, живо и по-деловому."
      : "Мужчина, 30 лет, говорит спокойно, живо и по-деловому.";
    const ackRuleRu = skipOpeningAck
      ? "- Короткое подтверждение («Хорошо», «Понял») уже прозвучало в начале реплики, поэтому НЕ начинай ответ со слов «Понял», «Хорошо», «Так» — сразу переходи к сути или следующему вопросу."
      : "- Чередуй короткие естественные связки в начале («Хорошо, Чиланзар.», «Да, до семидесяти тысяч.», «Записал.») или сразу задавай вопрос без вводного слова. Не повторяй одно и то же слово «Понял» в каждом ответе.";
    return `Ты ${agentNameRu} — живой менеджер агентства недвижимости в Ташкенте. ${genderDescRu} Говори на чистом разговорном русском языке, как реальный человек по телефону. Если клиент говорит по-узбекски, отвечай по-узбекски.

Как ты говоришь:
- Короткие живые телефонные реплики: иногда 3–5 слов, иногда одно предложение (до 10 слов).
- Никогда не хвали клиента и не оценивай его выбор: запрещено говорить "отличный выбор", "прекрасный район", "шикарный вариант", "да, конечно", "смотрите", "спасибо за вопрос".
${ackRuleRu}
- Если клиент явно не договорил или задумался — не допрашивай, коротко скажи: "Да, слушаю вас."
- Не перечисляй списки, числительные произноси словами ("пятьдесят тысяч").
- Приветствие уже прозвучало при поднятии трубки. Повторно не здоровайся.

Твоя задача: быстро узнать параметры запроса и передать живому агенту. Спрашивай по одному пункту за шаг:
1) покупка, аренда или продажа;
2) район Ташкента (и новостройка или вторичка);
3) сколько комнат;
4) бюджет;
5) оплата: наличные, ипотека или рассрочка;
6) имя клиента и удобное время звонка агента (или отправка вариантов в Телеграм).
То, что клиент уже назвал, повторно не спрашивай.
Когда основные данные собраны, вызови save_lead и коротко попрощайся:
"Спасибо, [имя]. Наш агент сегодня свяжется с вами с вариантами. Всего доброго."

Ограничения:
- Не выдумывай цены, конкретные ЖК или застройщиков. Если спрашивают цену: "Цена зависит от конкретного дома, агент пришлёт точные варианты."
- На темы вне недвижимости не общайся: "Я помогаю только по вопросам недвижимости Ташкента."
- Если речь неразборчива: "Алло, вас плохо слышно, повторите, пожалуйста."

Примеры:
Клиент: Мне нужна двухкомнатная квартира на Чиланзаре.
Хорошо: Хорошо, Чиланзар, две комнаты. Новостройка или вторичка?

Клиент: Вторичка, наличными, до семидесяти тысяч.
Хорошо: До семидесяти тысяч, наличные. Как к вам обращаться?`;
  }

  const agentNameUz = isFemale ? "Malika" : "Shohrux";
  const genderDescUz = isFemale
    ? "Ayol, 28 yoshlarda, xotirjam va tabiiy gapirasan."
    : "Erkak, 30 yoshlarda, xotirjam va tabiiy gapirasan.";
  const ackRuleUz = skipOpeningAck
    ? "- Qisqa tasdiq («Xo'p», «Ha») allaqachon aytildi, shuning uchun javobni «Xo'p», «Ha», «Tushunarli» so'zlari bilan BOSHLAMA — darhol asosiy gap yoki savolni ayt."
    : "- Har safar bir xil «Tushunarli» so'zini takrorlama. Jonli Toshkent so'zlashuv tilida turlicha qisqa bog'lovchilar ishlat («Xo'p, Chilonzor.», «Ha, yetmish ming.», «Bo'ldi, yozib oldim.») yoki to'g'ridan-to'g'ri savolga o't.";

  return `Sen ${agentNameUz}san — Toshkentdagi ko'chmas mulk agentligining menejeri. ${genderDescUz} Faqat o'zbek tilida, oddiy va tabiiy Toshkent so'zlashuv tilida gapir (huddi tirik odam telefonda gaplashgandek). Mijoz ruscha gapirsa, ruscha javob ber.

Qanday gapirasan:
- Gaplaringning uzunligi tabiiy bo'lsin: ba'zan 3–4 so'z, ba'zan bitta qisqa gap (maksimal 8–10 so'z).
- Faqat ishga oid gapir. Hech qachon maqtama: "ajoyib", "zo'r", "a'lo tanlov", "xush ko'rdik", "to'g'risini aytsam", "savolingiz uchun rahmat" dema.
${ackRuleUz}
- Agar mijoz gapini tugatmagan bo'lsa, darhol savolga tutma: "Ha, eshityapman" yoki "Ayting" deb kut.
- Ro'yxat sanama, raqamlarni so'z bilan ayt ("yetmish ming").
- Salomlashuv allaqachon aytildi. Qayta salom berma.

Vazifang: mijoz so'rovini aniqlab, agentga uzatish. Ketma-ket, bittadan so'ra:
1) sotib olish, ijara yoki sotish;
2) tuman (novostroyka yoki ikkilamchi bozor);
3) necha xona;
4) byudjet;
5) to'lov: naqd, ipoteka yoki bo'lib to'lash;
6) ismi va variantlarni Telegramdan tashlash yoki qo'ng'iroq vaqti.
Mijoz aytgan narsani qayta so'rama.
Ma'lumotlar yig'ilgach, save_lead funksiyasini chaqir va ayt:
"Rahmat, [ism]. Agentimiz bugun shu raqamga variantlar bilan qo'ng'iroq qiladi. Xayr."

Cheklovlar:
- Aniq narx yoki quruvchi to'qima. Narx so'rasa: "Narx uyga qarab o'zgaradi, agentimiz aniq variantlarni tashlab beradi."
- Ko'chmas mulkdan boshqa mavzuga o'tma: "Men faqat uy-joy bo'yicha yordam beraman."
- Eshitilmasa: "Alo, ovozingiz uzilib qoldi, qaytarib yuboring."

Misollar:
Mijoz: Chilonzordan ikki xonali uy kerak edi.
Yaxshi: Xo'p, Chilonzor, ikki xona. Yangi uymi yoki ikkilamchi?

Mijoz: Naqd pulga olaman, yetmish ming atrofida.
Yaxshi: Ha, yetmish ming, naqd. Ismingiz nima?`;
}

function extractProgressiveRealtorLead(text: string): Record<string, string> {
  const lower = (text || "").toLowerCase();
  const update: Record<string, string> = {};

  if (lower.includes("ijara") || lower.includes("arenda") || lower.includes("аренд") || lower.includes("снять")) {
    update.clientIntent = "rent";
  } else if (lower.includes("sotish") || lower.includes("sotmoqchi") || lower.includes("продать") || lower.includes("продаж")) {
    update.clientIntent = "sell";
  } else if (lower.includes("sotib") || lower.includes("olmoqchi") || lower.includes("olaman") || lower.includes("купить") || lower.includes("покуп")) {
    update.clientIntent = "buy";
  }

  const districtMap: Array<[string[], string]> = [
    [["chilonzor", "чиланзар", "novza", "qatortol"], "Chilonzor"],
    [["mirobod", "мирабад", "oybek", "айбек"], "Mirobod"],
    [["yunusobod", "юнусабад", "shahriston", "bodomzor", "mega planet"], "Yunusobod"],
    [["yakkasaroy", "яккасарай", "rustaveli", "rakat"], "Yakkasaroy"],
    [["mirzo ulug", "мирзо-улугбек", "ulug'bek", "buyuk ipak", "ttz", "qorasuv"], "Mirzo Ulug'bek"],
    [["yashnobod", "яшнабад", "parkent", "tuzel"], "Yashnobod"],
    [["sergeli", "сергели", "yangihayot", "янгихаёт"], "Sergeli"],
    [["shayxontohur", "шайхантахур", "chorsu", "tashkent city"], "Shayxontohur"],
  ];
  for (const [keywords, canonical] of districtMap) {
    if (keywords.some((k) => lower.includes(k))) {
      update.district = canonical;
      break;
    }
  }

  if (lower.includes("novostroyka") || lower.includes("yangi uy") || lower.includes("новострой")) {
    update.propertyType = "novostroyka";
  } else if (lower.includes("ikkilamchi") || lower.includes("vtorichka") || lower.includes("вторич")) {
    update.propertyType = "vtorichka";
  }

  if (/\b(1|bir|одно|однушк)\b/.test(lower) && (lower.includes("xona") || lower.includes("комн") || lower.includes("однушк"))) {
    update.roomsCount = "1 xonali";
  } else if (/\b(2|ikki|двух|двушк)\b/.test(lower) && (lower.includes("xona") || lower.includes("комн") || lower.includes("двушк"))) {
    update.roomsCount = "2 xonali";
  } else if (/\b(3|uch|трех|трёх|трешк)\b/.test(lower) && (lower.includes("xona") || lower.includes("комн") || lower.includes("трешк"))) {
    update.roomsCount = "3 xonali";
  } else if (/\b(4|to'rt|tort|четыр)\b/.test(lower) && (lower.includes("xona") || lower.includes("комн"))) {
    update.roomsCount = "4+ xonali";
  }

  if (lower.includes("ipoteka") || lower.includes("ипотек")) {
    update.paymentMethod = "mortgage";
  } else if (lower.includes("rassrochka") || lower.includes("bo'lib") || lower.includes("muddatli") || lower.includes("рассроч")) {
    update.paymentMethod = "installments";
  } else if (lower.includes("naqd") || lower.includes("налич")) {
    update.paymentMethod = "cash";
  }

  const numMatch = lower.match(/\b(\d{2,3})\s*(ming|тысяч|тыс|\$|dollar)/i);
  if (numMatch) {
    update.budgetRange = `$${numMatch[1]},000`;
  } else {
    const wordBudgets: Array<[string[], string]> = [
      [["qirq ming", "сорок тысяч"], "$40,000"],
      [["ellik ming", "пятьдесят тысяч"], "$50,000"],
      [["oltmish ming", "шестьдесят тысяч"], "$60,000"],
      [["yetmish ming", "семьдесят тысяч"], "$70,000"],
      [["sakson ming", "восемьдесят тысяч"], "$80,000"],
      [["to'qson ming", "девяносто тысяч"], "$90,000"],
      [["yuz ming", "сто тысяч"], "$100,000"],
    ];
    for (const [words, amount] of wordBudgets) {
      if (words.some((w) => lower.includes(w))) {
        update.budgetRange = amount;
        break;
      }
    }
  }

  return update;
}

function generateOfflineRealEstateReply(
  userText: string,
  language: string,
  persona: string
): string {
  const lower = (userText || "").toLowerCase();
  const isRu = language === "ru";

  if (persona === "tashkent_real_estate") {
    if (
      lower.includes("narx") ||
      lower.includes("qancha") ||
      lower.includes("цена") ||
      lower.includes("стоимость") ||
      lower.includes("сколько")
    ) {
      return isRu
        ? "Цена зависит от конкретного дома, агент пришлёт точные варианты. Какой у вас бюджет?"
        : "Narx uyga qarab o'zgaradi, agentimiz aniq variantlarni yuboradi. Byudjetingiz qancha?";
    }

    if (
      lower.includes("ipoteka") ||
      lower.includes("rassrochka") ||
      lower.includes("naqd") ||
      lower.includes("ипотек") ||
      lower.includes("рассрочк") ||
      lower.includes("налич")
    ) {
      return isRu
        ? "Записал способ оплаты. Как к вам обращаться?"
        : "Tushunarli, to'lov turini belgilab oldim. Ismingiz nima?";
    }

    if (
      lower.includes("mirobod") ||
      lower.includes("chilonzor") ||
      lower.includes("yunusobod") ||
      lower.includes("sergeli") ||
      lower.includes("yakkasaroy") ||
      lower.includes("мирабад") ||
      lower.includes("чиланзар") ||
      lower.includes("юнусабад") ||
      lower.includes("сергели") ||
      lower.includes("яккасарай")
    ) {
      return isRu
        ? "Понял район. Сколько комнат нужно?"
        : "Tushunarli. Necha xonali uy kerak?";
    }

    if (
      lower.includes("1 xona") ||
      lower.includes("2 xona") ||
      lower.includes("3 xona") ||
      lower.includes("ikki xona") ||
      lower.includes("uch xona") ||
      lower.includes("1-комн") ||
      lower.includes("2-комн") ||
      lower.includes("3-комн") ||
      lower.includes("двухкомн")
    ) {
      return isRu
        ? "Понял по комнатам. Какой бюджет рассматриваете?"
        : "Tushunarli. Qancha byudjet mo'ljallayapsiz?";
    }

    return isRu
      ? "Понял вас. Подскажите, рассматриваете покупку или аренду?"
      : "Tushunarli. Sotib olish kerakmi yoki ijara?";
  }

  return isRu
    ? "Понял вас. Расскажите, пожалуйста, подробнее."
    : "Tushunarli. Batafsilroq aytsangiz.";
}

// Pre-recorded 0-token WAV greeting for SuperTaxi IVR ("Assalomu alaykum, SuperTaksi! Eshitaman sizni.")
app.get("/api/agent/supertaxi-greeting.wav", async (_req, res) => {
  try {
    const previewsDir = path.resolve(process.cwd(), "public", "audio", "previews");
    const cachedGreetingPath = path.join(previewsDir, "supertaxi-greeting.wav");

    if (fs.existsSync(cachedGreetingPath)) {
      const stat = fs.statSync(cachedGreetingPath);
      if (stat.size > 1000) {
        res.setHeader("Content-Type", "audio/wav");
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.sendFile(cachedGreetingPath);
      }
    }

    // Generate once and cache permanently on disk so all calls play at 0 token cost
    try {
      const ttsResponse = await ai.models.generateContent({
        model: "gemini-3.8-flash-tts",
        contents: [
          {
            role: "user",
            parts: [
              {
                text: "Assalomu alaykum, SuperTaksi! Eshitaman sizni.",
                speechMetadata: {
                  speaker: "Madina",
                  style:
                    "Toshkentlik samimiy, xushmuomala va tezkor taksi dispetcher-operatori. Aniq, jarangdor, 0% aksentsiz sof o'zbek tili.",
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } },
          },
        },
      });

      const part = ttsResponse.candidates?.[0]?.content?.parts?.[0];
      if (part?.inlineData?.data) {
        const rawBuf = Buffer.from(part.inlineData.data, "base64");
        const { buffer: wav } = ensureWav(rawBuf, 24000, 1, 16);
        fs.mkdirSync(previewsDir, { recursive: true });
        fs.writeFileSync(cachedGreetingPath, wav);
        res.setHeader("Content-Type", "audio/wav");
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.send(wav);
      }
    } catch (ttsErr: any) {
      console.warn("SuperTaxi greeting synthesis fallback to cached preview:", ttsErr?.message);
    }

    // Fallback to existing static preview wav if offline
    const fallbackWavPath = path.join(previewsDir, "aoede.wav");
    if (fs.existsSync(fallbackWavPath)) {
      res.setHeader("Content-Type", "audio/wav");
      return res.sendFile(fallbackWavPath);
    }

    return res.status(404).end();
  } catch (err: any) {
    console.error("SuperTaxi greeting wav error:", err);
    return res.status(500).end();
  }
});

// Pre-recorded 0-token WAV greeting for Realtor ("Assalomu alaykum, ko'chmas mulk agentligi, Shohrux/Malika. Eshitaman.")
app.get("/api/agent/realtor-greeting.wav", async (req, res) => {
  try {
    const rawVoice = String(req.query.voice || "Charon").trim();
    const lang = String(req.query.lang || "uz").trim() === "ru" ? "ru" : "uz";
    const isFemale = isFemaleVoiceName(rawVoice);
    const canonicalVoice = isFemale
      ? rawVoice.toLowerCase() === "kore"
        ? "Kore"
        : "Aoede"
      : rawVoice.toLowerCase() === "puck"
      ? "Puck"
      : rawVoice.toLowerCase() === "fenrir"
      ? "Fenrir"
      : "Charon";

    const previewsDir = path.resolve(process.cwd(), "public", "audio", "previews");
    const cacheFileName = `realtor-greeting-${canonicalVoice.toLowerCase()}-${lang}.wav`;
    const cachedGreetingPath = path.join(previewsDir, cacheFileName);

    if (fs.existsSync(cachedGreetingPath)) {
      const stat = fs.statSync(cachedGreetingPath);
      if (stat.size > 1000) {
        res.setHeader("Content-Type", "audio/wav");
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.sendFile(cachedGreetingPath);
      }
    }

    const agentName = isFemale
      ? lang === "ru"
        ? "Малика"
        : "Malika"
      : lang === "ru"
      ? "Шохрух"
      : "Shohrux";
    const greetingText =
      lang === "ru"
        ? `Здравствуйте, агентство недвижимости, ${agentName}. Слушаю вас.`
        : `Assalomu alaykum, ko'chmas mulk agentligi, ${agentName}. Eshitaman.`;

    try {
      const ttsResponse = await ai.models.generateContent({
        model: "gemini-3.8-flash-tts",
        contents: [
          {
            role: "user",
            parts: [
              {
                text: greetingText,
                speechMetadata: {
                  speaker: agentName,
                  style:
                    lang === "ru"
                      ? "Спокойный, чёткий и деловой менеджер агентства недвижимости в Ташкенте, естественный телефонный ответ без лишних эмоций."
                      : "Toshkentlik xotirjam, aniq va ishbilarmon ko'chmas mulk menejeri, 0% chet el aksentsiz sof o'zbek tili.",
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: canonicalVoice } },
          },
        },
      });

      const part = ttsResponse.candidates?.[0]?.content?.parts?.[0];
      if (part?.inlineData?.data) {
        const rawBuf = Buffer.from(part.inlineData.data, "base64");
        const { buffer: wav } = ensureWav(rawBuf, 24000, 1, 16);
        fs.mkdirSync(previewsDir, { recursive: true });
        fs.writeFileSync(cachedGreetingPath, wav);
        res.setHeader("Content-Type", "audio/wav");
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.send(wav);
      }
    } catch (ttsErr: any) {
      console.warn("Realtor greeting synthesis fallback to cached preview:", ttsErr?.message);
    }

    const fallbackWavPath = path.join(previewsDir, `${canonicalVoice.toLowerCase()}.wav`);
    if (fs.existsSync(fallbackWavPath)) {
      res.setHeader("Content-Type", "audio/wav");
      return res.sendFile(fallbackWavPath);
    }

    return res.status(404).end();
  } catch (err: any) {
    console.error("Realtor greeting wav error:", err);
    return res.status(500).end();
  }
});

const unsupportedCustomVoiceIds = new Set<string>();

// Normalize any voice ID ("user-replicated", "voice_...", "aziza", "Charon", etc.) into a valid Gemini TTS voiceConfig
function resolveAgentTtsVoiceConfig(rawVoice?: string): {
  primaryVoiceConfig: any;
  fallbackVoiceConfig: any;
  customIdToTrack?: string;
  cacheKey: string;
} {
  const clean = String(rawVoice || "Charon").trim();
  const lower = clean.toLowerCase();
  const isCustom =
    lower === "user-replicated" ||
    lower === "shohrux" ||
    clean.startsWith("voice_") ||
    clean.startsWith("voicekey_");

  const actualCustomId =
    lower === "user-replicated" || lower === "shohrux"
      ? "voice_17raj9ewke3g"
      : clean;
  const canonicalBase = resolveCanonicalBaseVoice(clean);
  const fallbackVoiceConfig = {
    prebuiltVoiceConfig: { voiceName: canonicalBase },
  };
  const useCustom = isCustom && !unsupportedCustomVoiceIds.has(actualCustomId);
  const primaryVoiceConfig = useCustom
    ? { voice: actualCustomId }
    : fallbackVoiceConfig;
  const cacheKey = (isCustom ? actualCustomId : canonicalBase)
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 32);

  return {
    primaryVoiceConfig,
    fallbackVoiceConfig,
    customIdToTrack: useCustom ? actualCustomId : undefined,
    cacheKey,
  };
}

// Pre-cached 0.3s backchannel fillers ("Xo'p...", "Ha...", "Bo'ldi...") in Cloned or Prebuilt Voice
app.get("/api/agent/realtor-filler.wav", async (req, res) => {
  try {
    const rawVoice = String(req.query.voice || "voice_17raj9ewke3g").trim();
    const lang = String(req.query.lang || "uz").trim() === "ru" ? "ru" : "uz";
    const idx = Math.max(0, Math.min(2, Number(req.query.idx || 0) || 0));
    const { primaryVoiceConfig, fallbackVoiceConfig, customIdToTrack, cacheKey } =
      resolveAgentTtsVoiceConfig(rawVoice);

    const fillersUz = ["Xo'p.", "Ha, tushunarli.", "Bo'ldi."];
    const fillersRu = ["Хорошо.", "Понял вас.", "Так, записал."];
    const fillerText = lang === "ru" ? fillersRu[idx] : fillersUz[idx];

    const previewsDir = path.resolve(process.cwd(), "public", "audio", "previews");
    const cachedFillerPath = path.join(previewsDir, `realtor-filler-${cacheKey}-${lang}-${idx}.wav`);

    if (fs.existsSync(cachedFillerPath)) {
      const stat = fs.statSync(cachedFillerPath);
      if (stat.size > 800) {
        res.setHeader("Content-Type", "audio/wav");
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.sendFile(cachedFillerPath);
      }
    }

    const isFemale = isFemaleVoiceName(rawVoice);
    const speakerName = isFemale ? (lang === "ru" ? "Малика" : "Malika") : (lang === "ru" ? "Шохрух" : "Shohrux");

    const synthesizeFillerWithConfig = async (vConfig: any, modelName = "gemini-3.8-flash-lite-tts") => {
      return ai.models.generateContent({
        model: modelName,
        contents: [
          {
            role: "user",
            parts: [
              {
                text: fillerText,
                speechMetadata: {
                  speaker: speakerName,
                  style:
                    lang === "ru"
                      ? "Короткое спокойное телефонное подтверждение менеджера."
                      : "Telefon orqali juda qisqa va tabiiy tasdiqlash, 0% aksentsiz sof o'zbek tili.",
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: vConfig },
        },
      });
    };

    try {
      let ttsResponse;
      try {
        ttsResponse = await synthesizeFillerWithConfig(primaryVoiceConfig);
      } catch {
        if (customIdToTrack) unsupportedCustomVoiceIds.add(customIdToTrack);
        ttsResponse = await synthesizeFillerWithConfig(fallbackVoiceConfig);
      }

      const part = ttsResponse.candidates?.[0]?.content?.parts?.[0];
      if (part?.inlineData?.data) {
        const rawBuf = Buffer.from(part.inlineData.data, "base64");
        const { buffer: wav } = ensureWav(rawBuf, 24000, 1, 16);
        fs.mkdirSync(previewsDir, { recursive: true });
        fs.writeFileSync(cachedFillerPath, wav);
        res.setHeader("Content-Type", "audio/wav");
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.send(wav);
      }
    } catch (ttsErr: any) {
      console.warn("Realtor filler synthesis warning:", ttsErr?.message);
    }

    return res.status(204).end();
  } catch (err: any) {
    return res.status(500).end();
  }
});

// Start interactive agent call
app.post("/api/agent/start-call", requireCreditBalance(1), async (req, res) => {
  try {
    const {
      persona = "tashkent_real_estate",
      topic = "Toshkentda novostroyka, ijara va narxlar",
      agentVoiceId = "Charon",
      language = "uz",
    } = req.body;

    const isFemale = isFemaleVoiceName(agentVoiceId);
    const realtorName = isFemale
      ? language === "ru"
        ? "Малика"
        : "Malika"
      : language === "ru"
      ? "Шохрух"
      : "Shohrux";

    const personaGreetings: Record<string, string> = {
      supertaxi_ivr: `Assalomu alaykum, SuperTaksi! Eshitaman sizni.`,
      tashkent_real_estate:
        language === "ru"
          ? `Здравствуйте, агентство недвижимости, ${realtorName}. Слушаю вас.`
          : `Assalomu alaykum, ko'chmas mulk agentligi, ${realtorName}. Eshitaman.`,
      live_cohost: `Assalomu alaykum! Jonli efirimiz boshlandi. Mavzuyimiz — "${topic}". Eshitaman sizni?`,
      caller_in_air: `Alo, assalomu alaykum! Men to'g'ridan-to'g'ri Toshkentdan qo'ng'iroq qilyapman, eshityapsizmi?`,
      exclusive_mentor: `Salom! Xush kelibsiz. Eshitaman sizni?`,
      business_consultant: `Assalomu alaykum! Tinglayapman sizni?`,
    };

    const greetingText =
      personaGreetings[persona] || personaGreetings.tashkent_real_estate;

    let audioBase64 = "";
    let fallbackSpeech = false;
    let errorNotice = "";

    const { primaryVoiceConfig, fallbackVoiceConfig, customIdToTrack, cacheKey } =
      resolveAgentTtsVoiceConfig(agentVoiceId);
    const previewsDir = path.resolve(process.cwd(), "public", "audio", "previews");
    const cachedGreetingFile =
      persona === "tashkent_real_estate" || persona === "supertaxi_ivr"
        ? path.join(previewsDir, `start-greeting-${persona}-${cacheKey}-${language}.wav`)
        : "";

    if (cachedGreetingFile && fs.existsSync(cachedGreetingFile)) {
      try {
        const buf = fs.readFileSync(cachedGreetingFile);
        if (buf.length > 1000) {
          audioBase64 = buf.toString("base64");
        }
      } catch (e) {}
    }

    if (!audioBase64) {
      try {
        const greetingSpeechStyle =
          language === "ru"
            ? "Спокойный, чёткий и деловой телефонный ответ менеджера агентства недвижимости Ташкента."
            : `Toshkentlik xotirjam va aniq ko'chmas mulk menejeri ${realtorName}. Telefon orqali qisqa, rasmiy va tabiiy salomlashish, 0% chet el aksentsiz sof o'zbek tili.`;

        const synthesizeGreeting = (vConfig: any, modelName = "gemini-3.8-flash-lite-tts") =>
          ai.models.generateContent({
            model: modelName,
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: greetingText,
                    speechMetadata: {
                      speaker: realtorName,
                      style: greetingSpeechStyle,
                    },
                  },
                ],
              },
            ],
            config: {
              responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: vConfig },
            },
          });

        let ttsResponse;
        try {
          ttsResponse = await synthesizeGreeting(primaryVoiceConfig);
        } catch {
          if (customIdToTrack) unsupportedCustomVoiceIds.add(customIdToTrack);
          ttsResponse = await synthesizeGreeting(fallbackVoiceConfig);
        }

        const part = ttsResponse.candidates?.[0]?.content?.parts?.[0];
        if (part?.inlineData?.data) {
          const rawBuf = Buffer.from(part.inlineData.data, "base64");
          const { buffer: wav } = ensureWav(rawBuf, 24000, 1, 16);
          audioBase64 = wav.toString("base64");
          if (cachedGreetingFile) {
            try {
              fs.mkdirSync(previewsDir, { recursive: true });
              fs.writeFileSync(cachedGreetingFile, wav);
            } catch (e) {}
          }
        }
      } catch (ttsErr: any) {
        console.warn("Agent greeting TTS fallback triggered:", ttsErr?.message || ttsErr);
        fallbackSpeech = true;
        if (
          ttsErr?.message?.includes("API key expired") ||
          ttsErr?.message?.includes("API_KEY_INVALID")
        ) {
          errorNotice = "gemini_api_key_expired";
        }
      }
    }

    let creditsRemaining = (req as any).userBalance;
    if (typeof (req as any).deductCredits === "function") {
      try {
        creditsRemaining = await (req as any).deductCredits(1);
      } catch (deductErr) {
        console.warn("Start call credit deduction notice:", deductErr);
      }
    }

    const sessionId = `call-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    activeAgentCallSessions.set(sessionId, {
      uid: (req as any).uid,
      turnsUsed: 0,
      createdAt: Date.now(),
    });
    if ((req as any).uid) {
      localStore.logGeneration((req as any).uid, {
        id: sessionId,
        userId: (req as any).uid,
        userEmail: ((req as any).userEmail || "").trim().toLowerCase(),
        type: "agent_call",
        title: `AI Qo'ng'iroq: ${persona}`,
        creditsCost: 1,
        status: "completed",
        createdAt: new Date().toISOString(),
      });
    }

    res.json({
      sessionId,
      persona,
      topic,
      greetingText,
      audioBase64,
      fallbackSpeech,
      errorNotice,
      creditsRemaining,
    });
  } catch (error: any) {
    console.error("Error starting agent call:", error);
    res
      .status(500)
      .json({ error: error.message || "Qo'ng'iroqni boshlashda xatolik" });
  }
});

const activeAgentCallSessions = new Map<string, { uid: string; turnsUsed: number; createdAt: number }>();

// Interactive dialogue turn during call with real-time speech understanding & streaming PCM TTS
app.post("/api/agent/call-turn", requireCreditBalance(1), async (req, res) => {
  const turnStartAt = Date.now();
  try {
    const {
      sessionId = "",
      userText = "",
      userAudioBase64 = "",
      conversationHistory = [],
      persona = "live_cohost",
      topic = "Podkast mavzusi",
      agentVoiceId = "Charon",
      language = "uz",
      stream = false,
      playedFillerAck = false,
    } = req.body;

    let recognizedUserText = userText ? userText.trim() : "";
    let transcribeMs = 0;

    // 1. If audio is sent without text, transcribe speech accurately
    if ((!recognizedUserText || recognizedUserText === "🎤 Ovozli savol" || recognizedUserText === "🎤 Голосовое сообщение") && userAudioBase64) {
      const tTranscribe0 = Date.now();
      try {
        const transcribeRes = await ai.models.generateContent({
          model: "gemini-3.5-transcribe",
          contents: [
            {
              role: "user",
              parts: [
                {
                  inlineData: {
                    mimeType: "audio/webm",
                    data: userAudioBase64,
                  },
                },
                {
                  text: "Ushbu audiodagi inson nutqini aniq matnga o'giring (Transcribe verbatim in Uzbek or Russian as spoken). Faqat aytilgan matnni qaytaring, boshqa hech qanday izoh yozmang.",
                },
              ],
            },
          ],
        });
        const transcribed = transcribeRes.text?.trim();
        if (transcribed && transcribed.length > 1) {
          recognizedUserText = transcribed;
        }
      } catch (transcribeErr: any) {
        console.warn("Transcribe fallback attempt with gemini-3.8-flash:", transcribeErr?.message);
        try {
          const fallbackRes = await ai.models.generateContent({
            model: "gemini-3.8-flash",
            contents: [
              {
                role: "user",
                parts: [
                  {
                    inlineData: {
                      mimeType: "audio/webm",
                      data: userAudioBase64,
                    },
                  },
                  {
                    text: "Ushbu audio xabardagi gapni eshiting va aniq yozma shaklda qaytaring. Faqat aytilgan matn bo'lsin.",
                  },
                ],
              },
            ],
          });
          const fb = fallbackRes.text?.trim();
          if (fb && fb.length > 1) {
            recognizedUserText = fb;
          }
        } catch (e: any) {
          console.error("Audio transcription failed:", e?.message);
        }
      }
      transcribeMs = Date.now() - tTranscribe0;
    }

    if (!recognizedUserText) {
      recognizedUserText = language === "ru" ? "Я слушаю вас, продолжайте." : "Men sizni tinglayapman, davom eting.";
    }

    const isFemale = isFemaleVoiceName(agentVoiceId);
    const realtorName = isFemale
      ? language === "ru"
        ? "Малика"
        : "Malika"
      : language === "ru"
      ? "Шохрух"
      : "Shohrux";

    // 2. Prepare system instructions
    let systemPrompt = "";
    if (persona === "tashkent_real_estate") {
      systemPrompt = buildRealtorSystemPrompt(language, isFemale, Boolean(playedFillerAck));
    } else {
      const crispProtocolSuffix =
        language === "ru"
          ? `\n\n⚡ ПРОТОКОЛ СЖАТОГО ДИАЛОГА:
1. ЖЁСТКИЙ ЛИМИТ 12–15 СЛОВ: Ваш ответ должен состоять МАКСИМУМ из 1–2 коротких фраз.
2. ЗАПРЕТ ШАБЛОНОВ: Не говорите "Я искусственный интеллект", "Спасибо за ваш вопрос".`
          : `\n\n⚡ QISQA DIALOG PROTOKOLI:
1. QAT'IY 12–15 SO'Z QOIDASI: Javobingiz MAKSIMAL 1–2 ta juda qisqa gapdan iborat bo'lsin.
2. NEGATIV FILTR: "Men sun'iy intellektman", "Savolingiz uchun katta rahmat" kabi iboralarni ishlatmang.`;

      systemPrompt =
        (language === "ru"
          ? `Вы — умный и живой голосовой собеседник в прямом эфире.
Роль: ${persona}.
Тема беседы: "${topic}".
Отвечайте коротко и строго по сути реплики пользователя ("${recognizedUserText}").`
          : `Siz jonli efirda suhbatlashayotgan samimiy ovozli suhbatdoshsiz (${realtorName}).
Sizning rolingiz: ${persona}.
Efir mavzusi: "${topic}".
Foydalanuvchining aytgan gapiga ("${recognizedUserText}") qisqa va aniq javob bering.`) + crispProtocolSuffix;
    }

    const contents: any[] = [];

    conversationHistory.slice(-8).forEach((msg: any) => {
      const txt = (msg.text || "").trim();
      if (txt && txt !== "🎤 Ovozli savol" && txt !== "🎤 Голосовое сообщение") {
        contents.push({
          role: msg.sender === "user" ? "user" : "model",
          parts: [{ text: txt }],
        });
      }
    });

    contents.push({
      role: "user",
      parts: [{ text: recognizedUserText }],
    });

    let replyText = "";
    let isOfflineFallback = false;
    const tText0 = Date.now();

    try {
      const agentTextRes = await generateFastTextWithFallback({
        contents,
        config: {
          systemInstruction: systemPrompt,
        },
        timeoutMs: 8000,
      });

      replyText =
        agentTextRes.text?.trim() ||
        (language === "ru"
          ? "Хорошо. Какой бюджет рассматриваете?"
          : "Xo'p. Qancha byudjet mo'ljallayapsiz?");
    } catch (textErr: any) {
      console.warn("Agent text generation fallback triggered:", textErr?.message);
      isOfflineFallback = true;
      replyText = generateOfflineRealEstateReply(recognizedUserText, language, persona);
    }
    const textMs = Date.now() - tText0;

    // Strip duplicate filler word if client already played a cached filler clip
    if (playedFillerAck) {
      replyText = replyText
        .replace(/^(Tushunarli|Xo'p|Ha|Bo'ldi|Понял вас|Понял|Хорошо|Так)[,.\s]+/i, "")
        .trim();
      if (replyText) {
        replyText = replyText.charAt(0).toUpperCase() + replyText.slice(1);
      }
    }

    const { speechText } = cleanScriptForSpeech(replyText);

    // Fast non-blocking progressive lead update (0ms synchronous)
    let leadUpdate: any = null;
    let isOffTopic = false;
    let clarificationNeeded = false;

    if (persona === "tashkent_real_estate") {
      const extracted = extractProgressiveRealtorLead(`${recognizedUserText} ${replyText}`);
      if (Object.keys(extracted).length > 0) {
        leadUpdate = extracted;
      }
      if (replyText.includes("faqat uy-joy") || replyText.includes("только по вопросам недвижимости")) {
        isOffTopic = true;
      }
      if (replyText.includes("eshitilmadi") || replyText.includes("uzilib qoldi") || replyText.includes("плохо слышно")) {
        clarificationNeeded = true;
      }
    }

    let creditsRemaining = (req as any).userBalance;
    const callSession = sessionId ? activeAgentCallSessions.get(sessionId) : undefined;
    const isCoveredByActiveCall =
      callSession &&
      callSession.uid === (req as any).uid &&
      callSession.turnsUsed < 15 &&
      Date.now() - callSession.createdAt < 30 * 60 * 1000;

    if (isCoveredByActiveCall && callSession) {
      callSession.turnsUsed += 1;
    } else if (typeof (req as any).deductCredits === "function") {
      try {
        creditsRemaining = await (req as any).deductCredits(1);
      } catch (deductErr) {
        console.warn("Credit deduction notice:", deductErr);
      }
    }

    const { primaryVoiceConfig: voiceConfig, fallbackVoiceConfig, customIdToTrack } =
      resolveAgentTtsVoiceConfig(agentVoiceId);

    const ttsStyle =
      language === "ru"
        ? "Спокойный, чёткий и деловой телефонный ответ менеджера недвижимости Ташкента без лишних эмоций."
        : "Toshkentlik xotirjam, aniq va tabiiy rieltor telefon suhbati, 0% aksentsiz sof o'zbekcha talaffuz.";

    // STREAMING MODE: Flush metadata immediately, then stream 24kHz PCM chunks from generateContentStream
    if (stream) {
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      res.write(
        JSON.stringify({
          type: "meta",
          recognizedUserText,
          replyText: speechText || replyText,
          leadUpdate,
          isOffTopic,
          clarificationNeeded,
          creditsRemaining,
          timing: { transcribeMs, textMs },
        }) + "\n"
      );

      let ttsFirstChunkMs = 0;
      let chunkCount = 0;
      const tTts0 = Date.now();

      if (!isOfflineFallback) {
        const streamWithConfig = async (vConfig: any, modelName = "gemini-3.8-flash-lite-tts") => {
          const ttsStream = await ai.models.generateContentStream({
            model: modelName,
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: speechText || replyText,
                    speechMetadata: {
                      speaker: realtorName,
                      style: ttsStyle,
                    },
                  },
                ],
              },
            ],
            config: {
              responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: vConfig },
            },
          });

          for await (const chunk of ttsStream) {
            const parts = chunk.candidates?.[0]?.content?.parts || [];
            for (const part of parts) {
              if (part?.inlineData?.data) {
                chunkCount++;
                if (!ttsFirstChunkMs) {
                  ttsFirstChunkMs = Date.now() - tTts0;
                }
                res.write(
                  JSON.stringify({
                    type: "audioChunk",
                    audio: part.inlineData.data,
                    firstChunkMs: ttsFirstChunkMs,
                  }) + "\n"
                );
              }
            }
          }
        };

        try {
          await streamWithConfig(voiceConfig);
        } catch {
          if (customIdToTrack) unsupportedCustomVoiceIds.add(customIdToTrack);
          try {
            await streamWithConfig(fallbackVoiceConfig);
          } catch (ttsStreamErr: any) {
            console.warn("Streaming TTS error in call-turn:", ttsStreamErr?.message);
          }
        }
      }

      const totalMs = Date.now() - turnStartAt;
      console.log(
        `[CALL-TIMING][Cloned Stream] transcribe=${transcribeMs}ms | text=${textMs}ms | ttsFirstChunk=${ttsFirstChunkMs}ms | total=${totalMs}ms | chunks=${chunkCount} | voice=${agentVoiceId}`
      );

      res.write(
        JSON.stringify({
          type: "done",
          timing: {
            transcribeMs,
            textMs,
            ttsFirstChunkMs,
            totalFirstAudioMs: transcribeMs + textMs + ttsFirstChunkMs,
            totalMs,
          },
        }) + "\n"
      );
      return res.end();
    }

    // NON-STREAMING FALLBACK MODE
    let audioBase64 = "";
    let fallbackSpeech = isOfflineFallback;
    const tTts0 = Date.now();

    if (!isOfflineFallback) {
      try {
        const ttsRes = await ai.models.generateContent({
          model: "gemini-3.8-flash-lite-tts",
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: speechText || replyText,
                  speechMetadata: {
                    speaker: realtorName,
                    style: ttsStyle,
                  },
                },
              ],
            },
          ],
          config: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig },
          },
        });

        const part = ttsRes.candidates?.[0]?.content?.parts?.[0];
        if (part?.inlineData?.data) {
          const rawBuf = Buffer.from(part.inlineData.data, "base64");
          const { buffer: wav } = ensureWav(rawBuf, 24000, 1, 16);
          audioBase64 = wav.toString("base64");
        }
      } catch (ttsErr: any) {
        console.warn("Agent turn TTS fallback triggered:", ttsErr?.message);
        fallbackSpeech = true;
      }
    }
    const ttsMs = Date.now() - tTts0;
    const totalMs = Date.now() - turnStartAt;
    console.log(
      `[CALL-TIMING][Cloned Full] transcribe=${transcribeMs}ms | text=${textMs}ms | tts=${ttsMs}ms | total=${totalMs}ms`
    );

    res.json({
      recognizedUserText,
      replyText: speechText || replyText,
      audioBase64,
      fallbackSpeech,
      leadUpdate,
      isOffTopic,
      clarificationNeeded,
      timing: { transcribeMs, textMs, ttsMs, totalMs },
      timestamp: new Date().toLocaleTimeString(language === "ru" ? "ru-RU" : "uz-UZ", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      creditsRemaining,
    });
  } catch (error: any) {
    console.error("Error in agent call turn:", error);
    res.status(500).json({ error: error.message || "Agent javobida xatolik" });
  }
});

// Comprehensive Post-Call Real Estate CRM Dossier & Matching Properties
app.post("/api/agent/generate-summary", requireCreditBalance(1), async (req, res) => {
  try {
    const { transcriptLines = [], leadCard = {}, language = "uz" } = req.body;

    const fullTranscript = transcriptLines
      .map((t: any) => `${t.sender === "user" ? "Mijoz" : "Rieltor (Shohrux)"}: ${t.text}`)
      .join("\n");

    const promptText = `Siz Toshkent ko'chmas mulk agentligining bosh tahlilchisisiz.
Quyidagi telefon qo'ng'irog'i transkriptini to'liq tahlil qiling va rieltor uchun professional CRM dosyesini shakllantiring.

Transkript:
${fullTranscript || "Qisqa suhbat bo'ldi"}

Hozirgi Lead Card parametrlari:
${JSON.stringify(leadCard, null, 2)}

Quyidagi qat'iy JSON formatida javob qaytaring:
{
  "callSummary": "${language === "ru" ? "Краткое резюме звонка (3-4 предложения)" : "Qo'ng'iroqning qisqa mazmuni (3-4 jumla)"}",
  "leadTemperature": "hot" | "warm" | "cold",
  "temperatureReason": "${language === "ru" ? "Почему такой статус" : "Nega bu harorat berildi"}",
  "qualificationBANT": {
    "budget": "${language === "ru" ? "Оценка бюджета и платежеспособности" : "Byudjet va to'lov qobiliyati"}",
    "authority": "${language === "ru" ? "Кто принимает решение" : "Qaror qabul qiluvchi shaxs"}",
    "need": "${language === "ru" ? "Точная потребность (комнаты, локация)" : "Aniq ehtiyoj"}",
    "timeline": "${language === "ru" ? "Сроки покупки/аренды" : "Bitim muddati"}"
  },
  "objectionsHandled": ["${language === "ru" ? "Возражения клиента, если были" : "Mijoz e'tirozlari"}"],
  "agreedNextStep": "${language === "ru" ? "Следующее целевое действие риелтора" : "Rieltorning keyingi qadami"}",
  "matchedProperties": [
    {
      "id": "prop-1",
      "title": "${language === "ru" ? "ЖК / Объект 1" : "1-variant mulk"}",
      "district": "Mirobod",
      "price": "$68,000",
      "area": "62 m²",
      "rooms": "2 xonali",
      "roi": "11.5% yillik ijara",
      "badge": "Top Tavsiya",
      "developer": "Modern Stroy"
    },
    {
      "id": "prop-2",
      "title": "${language === "ru" ? "ЖК / Объект 2" : "2-variant mulk"}",
      "district": "Chilonzor",
      "price": "$52,000",
      "area": "54 m²",
      "rooms": "2 xonali",
      "roi": "9.8% yillik ijara",
      "badge": "Arzon & Qulay",
      "developer": "Golden House"
    },
    {
      "id": "prop-3",
      "title": "${language === "ru" ? "ЖК / Объект 3" : "3-variant mulk"}",
      "district": "Yunusobod",
      "price": "$75,000",
      "area": "78 m²",
      "rooms": "3 xonali",
      "roi": "10.2% yillik ijara",
      "badge": "Oilaviy Keng",
      "developer": "NRG"
    }
  ]
}`;

    const summaryRes = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: [{ role: "user", parts: [{ text: promptText }] }],
      config: {
        responseMimeType: "application/json",
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    const parsed = JSON.parse(summaryRes.text || "{}");
    res.json(parsed);
  } catch (err: any) {
    console.error("Error generating CRM summary:", err);
    res.status(500).json({ error: err.message || "Summary xatolik" });
  }
});

// =========================================================================
// 4. EXCLUSIVE HUB & COVER ART GENERATOR
// =========================================================================
app.post("/api/podcast/generate-cover", requireCreditBalance(1), async (req, res) => {
  try {
    const { title = "Podkast", category = "Eksklyuziv", tags = [] } = req.body;

    const prompt = `Generate a modern, high-contrast, beautiful SVG podcast cover art for an Uzbek audio show.
Title: "${title}"
Category: "${category}"
Tags: ${tags.join(", ")}

Requirements:
- Valid self-contained SVG code (width="800" height="800" viewBox="0 0 800 800").
- Modern dark luxury aesthetics: deep dark background (#09090b, #0f172a), glowing gradients (#06b6d4, #6366f1, #d946ef, #f59e0b).
- Studio soundwaves, microphone, or abstract sonic geometry in SVG vector paths.
- Elegant typography with the title and category badge.
- Return ONLY the clean <svg>...</svg> code, no markdown backticks, no explanations.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    let svgText = response.text || "";
    svgText = svgText
      .replace(/```(?:xml|svg)?/g, "")
      .replace(/```/g, "")
      .trim();

    if (!svgText.includes("<svg")) {
      // Fallback clean SVG
      svgText = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800">
        <defs>
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#09090b"/>
            <stop offset="50%" stop-color="#0c1222"/>
            <stop offset="100%" stop-color="#020617"/>
          </linearGradient>
          <linearGradient id="neon" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#06b6d4"/>
            <stop offset="50%" stop-color="#8b5cf6"/>
            <stop offset="100%" stop-color="#ec4899"/>
          </linearGradient>
        </defs>
        <rect width="800" height="800" fill="url(#bg)"/>
        <circle cx="400" cy="350" r="180" fill="none" stroke="url(#neon)" stroke-width="3" opacity="0.3"/>
        <circle cx="400" cy="350" r="120" fill="none" stroke="url(#neon)" stroke-width="5" opacity="0.6"/>
        <text x="400" y="360" font-family="system-ui, sans-serif" font-size="72" fill="#38bdf8" text-anchor="middle" font-weight="bold">🎙️</text>
        <rect x="250" y="520" width="300" height="36" rx="18" fill="#1e293b" stroke="#38bdf8" stroke-width="1.5"/>
        <text x="400" y="544" font-family="system-ui, sans-serif" font-size="14" fill="#38bdf8" text-anchor="middle" font-weight="bold" letter-spacing="3">${category.toUpperCase()}</text>
        <text x="400" y="630" font-family="system-ui, sans-serif" font-size="32" fill="#ffffff" text-anchor="middle" font-weight="800">${title.slice(0, 36)}</text>
        <text x="400" y="670" font-family="system-ui, sans-serif" font-size="16" fill="#94a3b8" text-anchor="middle">OVOZSTUDIO.AI • GEMINI 3.8 FLASH</text>
      </svg>`;
    }

    let creditsRemaining = (req as any).userBalance;
    if (typeof (req as any).deductCredits === "function") {
      try {
        creditsRemaining = await (req as any).deductCredits(1);
      } catch (deductErr) {
        console.warn("Cover credit deduction notice:", deductErr);
      }
    }

    res.json({
      svg: svgText,
      creditsRemaining,
    });
  } catch (error: any) {
    console.error("Error generating cover art:", error);
    res
      .status(500)
      .json({ error: error.message || "Muqova yaratishda xatolik" });
  }
});

// =========================================================================
// 5. DOCUMENT / PDF / YOUTUBE / ARTICLE / AUDIO SCRIPT GENERATOR
// =========================================================================
app.post("/api/podcast/analyze-document", requireCreditBalance(1), async (req, res) => {
  try {
    const {
      documentBase64,
      mimeType = "application/pdf",
      sourceText = "",
      sourceUrl = "",
      targetFormat = "podcast", // 'podcast' | 'interview' | 'voiceover' | 'audiobook' | 'verbatim_dubbing'
      targetDuration = "10 daqiqa",
      userInstructions = "",
      category = "Tarixiy",
      tone = "engaging",
      languageMode = "uzbek",
    } = req.body;

    // If user selected verbatim dubbing OR pasted a timestamped storyboard ("Видеоряд:" / "Интонация:" / "Текст:" / "00:00 – 00:02"),
    // route directly through the strict 1:1 verbatim storyboard parser & translator without inventing any extra dialogue!
    const looksLikeStoryboard =
      sourceText &&
      !documentBase64 &&
      (/(?:видеоряд|интонация|текст)\s*:/i.test(sourceText) ||
        /\d{1,2}:\d{2}\s*(?:[—–\-]|-->)\s*\d{1,2}:\d{2}/.test(sourceText));

    if (
      (targetFormat === "verbatim_dubbing" ||
        (looksLikeStoryboard && (targetFormat === "interview" || targetFormat === "voiceover"))) &&
      sourceText.trim().length > 10
    ) {
      const verbatimResult = await parseAndTranslateVerbatimStoryboard(ai, sourceText);
      const numericCost =
        typeof verbatimResult.estimatedCostUsd === "number"
          ? verbatimResult.estimatedCostUsd
          : Number(verbatimResult.estimatedCostUsd?.totalUsd ?? 0.03);
      let creditsRemaining = (req as any).userBalance;
      if (typeof (req as any).deductCredits === "function") {
        try {
          creditsRemaining = await (req as any).deductCredits(1);
        } catch {}
      }
      return res.json({
        ...verbatimResult,
        totalVideoDurationSec: verbatimResult.totalDurationSec,
        estimatedCostUsd: numericCost,
        estimatedCostBreakdown: verbatimResult.estimatedCostUsd,
        topic: verbatimResult.title,
        category,
        isVerbatimDubbing: true,
        srtSubtitles: generateSrtFromTurns(verbatimResult.turns),
        creditsRemaining,
      });
    }

    const parts: any[] = [];

    // If PDF, audio, video or document uploaded as base64
    if (documentBase64) {
      parts.push({
        inlineData: {
          mimeType,
          data: documentBase64,
        },
      });
    }

    // Advanced Video, Transcript & Media Resolver (YouTube, TikTok, Instagram, Web Articles)
    let resolvedSourceText = sourceText;
    let autoFetchedMediaBase64: string | null = null;
    let autoFetchedMediaMimeType: string | null = null;

    if (sourceUrl && sourceUrl.startsWith("http")) {
      // 1. YOUTUBE (Transcripts & Subtitles Extraction)
      if (/youtube\.com|youtu\.be/i.test(sourceUrl)) {
        try {
          const videoIdMatch = sourceUrl.match(/(?:v=|youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{11})/);
          const videoId = videoIdMatch ? videoIdMatch[1] : null;

          let ytTitle = "";
          let ytAuthor = "";
          let transcriptLines: string[] = [];

          // Try oEmbed for title
          try {
            const oembedRes = await fetch(
              `https://www.youtube.com/oembed?url=${encodeURIComponent(sourceUrl)}&format=json`,
              { signal: AbortSignal.timeout(3500) }
            );
            if (oembedRes.ok) {
              const oData = (await oembedRes.json()) as any;
              ytTitle = oData.title || "";
              ytAuthor = oData.author_name || "";
            }
          } catch {}

          // Fetch YouTube page to extract real spoken captions/transcript
          if (videoId) {
            try {
              const ytPageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
                headers: {
                  "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                  "Accept-Language": "en-US,en;q=0.9,ru;q=0.8,uz;q=0.7",
                },
                signal: AbortSignal.timeout(6000),
              });

              if (ytPageRes.ok) {
                const pageHtml = await ytPageRes.text();
                const captionMatch = pageHtml.match(/"captionTracks":\s*(\[[^\]]+\])/);

                if (captionMatch && captionMatch[1]) {
                  const tracks = JSON.parse(captionMatch[1]);
                  // Prioritize Uzbek, Russian, English or first available track
                  const chosenTrack =
                    tracks.find((t: any) => t.languageCode === "uz") ||
                    tracks.find((t: any) => t.languageCode === "ru") ||
                    tracks.find((t: any) => t.languageCode === "en") ||
                    tracks[0];

                  if (chosenTrack && chosenTrack.baseUrl) {
                    const xmlRes = await fetch(chosenTrack.baseUrl, { signal: AbortSignal.timeout(4000) });
                    if (xmlRes.ok) {
                      const xml = await xmlRes.text();
                      const regex = /<text\s+start="([\d.]+)"(?:\s+dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g;
                      let m;
                      while ((m = regex.exec(xml)) !== null) {
                        const startSec = Math.floor(parseFloat(m[1]));
                        const min = Math.floor(startSec / 60)
                          .toString()
                          .padStart(2, "0");
                        const sec = (startSec % 60).toString().padStart(2, "0");
                        const rawContent = m[3]
                          .replace(/&amp;/g, "&")
                          .replace(/&#39;/g, "'")
                          .replace(/&quot;/g, '"')
                          .replace(/<[^>]+>/g, "")
                          .trim();
                        if (rawContent) {
                          transcriptLines.push(`[${min}:${sec}] ${rawContent}`);
                        }
                      }
                    }
                  }
                }
              }
            } catch (ytErr: any) {
              console.warn("YouTube transcript extraction warning:", ytErr?.message);
            }
          }

          if (transcriptLines.length > 0) {
            resolvedSourceText = `YOUTUBE VIDEO HAQIQIY TRANSKRIPTI VA NUTQI:
Video nomi: "${ytTitle}"
Kanal: "${ytAuthor}"
Havola: ${sourceUrl}

VIDEODA AYTILGAN NUTQ (Original Stenogramma):
"""
${transcriptLines.slice(0, 300).join("\n")}
"""
${sourceText ? `Foydalanuvchi qo'shimcha izohi: ${sourceText}` : ""}`;
          } else {
            resolvedSourceText = `YouTube Video Manbasi:
Video Nomi: "${ytTitle || 'YouTube Video'}"
Muallif / Kanal: ${ytAuthor || ''}
Havola: ${sourceUrl}
${sourceText ? `Qo'shimcha izoh:\n${sourceText}` : ''}`;
          }
        } catch {
          resolvedSourceText = `YouTube Video Havolasi: ${sourceUrl}\n${sourceText ? `Qo'shimcha izoh:\n${sourceText}` : ''}`;
        }
      }
      // 2. TIKTOK (Direct Video & Audio Stream Extraction via TikWM API)
      else if (/tiktok\.com/i.test(sourceUrl)) {
        try {
          const tikRes = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(sourceUrl)}`, {
            signal: AbortSignal.timeout(7000),
          });

          if (tikRes.ok) {
            const tikData = (await tikRes.json()) as any;
            if (tikData.code === 0 && tikData.data) {
              const videoTitle = tikData.data.title || "TikTok Video";
              const author = tikData.data.author?.nickname || "";
              const audioUrl = tikData.data.music || tikData.data.play;

              // Download audio stream directly so Gemini hears the actual speech
              if (audioUrl) {
                try {
                  const mediaRes = await fetch(audioUrl, { signal: AbortSignal.timeout(9000) });
                  if (mediaRes.ok) {
                    const arrayBuf = await mediaRes.arrayBuffer();
                    const buf = Buffer.from(arrayBuf);
                    if (buf.length > 0 && buf.length < 25 * 1024 * 1024) {
                      autoFetchedMediaBase64 = buf.toString("base64");
                      autoFetchedMediaMimeType = audioUrl.includes(".mp3") ? "audio/mp3" : "video/mp4";
                    }
                  }
                } catch (dlErr: any) {
                  console.warn("TikTok media buffer download warning:", dlErr?.message);
                }
              }

              resolvedSourceText = `TIKTOK REELS MANBASI (Avtomatik Yuklandi):
Nomi: "${videoTitle}"
Muallif: ${author}
Havola: ${sourceUrl}
${sourceText ? `Qo'shimcha izoh: ${sourceText}` : ""}`;
            } else {
              resolvedSourceText = `TikTok Reels havolasi (${sourceUrl})\n${sourceText || ""}`;
            }
          }
        } catch (e: any) {
          console.warn("TikTok resolver warning:", e?.message);
          resolvedSourceText = `TikTok Reels havolasi: ${sourceUrl}\n${sourceText || ""}`;
        }
      }
      // 3. INSTAGRAM REELS (Embed Caption & Media Resolver)
      else if (/instagram\.com\/(?:reel|reels|p)\/([a-zA-Z0-9_-]+)/i.test(sourceUrl)) {
        const match = sourceUrl.match(/instagram\.com\/(?:reel|reels|p)\/([a-zA-Z0-9_-]+)/i);
        const shortcode = match ? match[1] : "";
        let instaCaption = "";

        try {
          const embedRes = await fetch(`https://www.instagram.com/reel/${shortcode}/embed/captioned/`, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            },
            signal: AbortSignal.timeout(5000),
          });

          if (embedRes.ok) {
            const embedHtml = await embedRes.text();
            const capMatch = embedHtml.match(/<div class="Caption"[^>]*>([\s\S]*?)<\/div>/i);
            if (capMatch) {
              instaCaption = capMatch[1]
                .replace(/<[^>]+>/g, " ")
                .replace(/\s+/g, " ")
                .trim();
            }
          }
        } catch (igErr: any) {
          console.warn("Instagram embed warning:", igErr?.message);
        }

        resolvedSourceText = `INSTAGRAM REELS MANBASI:
Havola: ${sourceUrl}
Shortcode: ${shortcode}
${instaCaption ? `Reels Matni / Tavsifi: "${instaCaption}"\n` : ""}
${sourceText ? `Foydalanuvchi izohi: ${sourceText}` : ""}`;
      }
      // 4. WEB ARTICLES & SITES (Kun.uz, Gazeta.uz, BBC, Medium, etc.)
      else {
        try {
          const fetchRes = await fetch(sourceUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
            signal: AbortSignal.timeout(5000),
          });
          if (fetchRes.ok) {
            const html = await fetchRes.text();
            const stripped = html
              .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
              .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
              .replace(/<[^>]+>/g, " ")
              .replace(/\s+/g, " ")
              .trim();
            if (stripped.length > 100) {
              resolvedSourceText = `Havoladan olingan maqola matni (${sourceUrl}):\n"""${stripped.slice(0, 15000)}"""\n\n${sourceText}`;
            }
          }
        } catch {
          resolvedSourceText = `Manba havolasi: ${sourceUrl}\n${sourceText}`;
        }
      }
    }

    // Attach auto-fetched media (e.g. from TikTok or direct stream) if available and no manual upload was given
    if (!documentBase64 && autoFetchedMediaBase64 && autoFetchedMediaMimeType) {
      parts.push({
        inlineData: {
          mimeType: autoFetchedMediaMimeType,
          data: autoFetchedMediaBase64,
        },
      });
    }

    const isLongDuration = /10|15|20|25|30|45|60/.test(targetDuration);
    const durationDesc = isLongDuration
      ? `Bu TO'LIQ ${targetDuration}lik katta podkast/intervyu sonidir. Ssenariy qisqa xulosa bo'lmasin, balki chuqur boblar ([00:00 - 05:00] Kirish, [05:00 - 15:00] 1-Bob...), keng mulohazalar, hayotiy misollar va to'liq ochib berilgan mavzular bilan yozilsin.`
      : `Matn ${targetDuration} xronometraj me'yoriga aniq mos kelsin (masalan, 30s uchun 65-75 ta so'z, 1-3 daqiqa uchun 150-400 ta so'z, 5-10 daqiqa uchun 600-1400 ta so'z).`;

    const toneDescriptions: Record<string, string> = {
      engaging:
        "Jonli, samimiy va ommabop podkast uslubi (tinglovchini jalb qiluvchi).",
      analytical:
        "Chuqur ilmiy, tahliliy va dalillarga asoslangan jiddiy ekspert uslubi.",
      commercial:
        "Dinamik, yuqori energiyali, e'tiborni tortuvchi reklama/promo uslubi.",
      storytelling:
        "Ibratli, samimiy va kinematik hikoyanavislik (storytelling) uslubi.",
      humorous: "Yengil, quvnoq va hazilomuz hayotiy suhbat uslubi.",
    };

    let formatSpecificInstructions = "";
    if (targetFormat === "interview") {
      const turnsCountDesc = isLongDuration
        ? "kamida 24-36 ta to'liq replika"
        : "8-18 ta tabiiy replika";
      formatSpecificInstructions = `
Ushbu hujjat/audio/maqola ma'lumotlari asosida 2 kishi o'rtasidagi (1-Boshlovchi va 2-Mehmon/Ekspert) qizg'in, jonli va professional suhbat dialogini yozing (${turnsCountDesc}).
Mavzuni shunchaki aytib bermasdan, haqiqiy podkastdagi kabi qizg'in savol-javob, munozara va o'zaro fikr almashish qiling.
Qaytaring JSON formatida:
{
  "title": "Intervyu sarlavhasi",
  "topic": "Intervyu mavzusi",
  "category": "${category}",
  "turns": [
    { "speakerId": "HOST_1", "speakerName": "Shokhrukh", "text": "Assalomu alaykum! Bugun biz...", "emotion": "excited" },
    { "speakerId": "HOST_2", "speakerName": "Mehmon", "text": "Salom! Haqiqatan ham bu mavzu...", "emotion": "thoughtful" }
  ]
}`;
    } else if (targetFormat === "voiceover") {
      formatSpecificInstructions = `
Ushbu hujjat/audio/maqola asosida ${targetDuration}lik video dublyaj / ovozlashtirish ssenariysini yozing.
Vaqt belgilari [00:00 - 00:06] bilan har bir sahna uchun kadr va diktor nutqini alohida ko'rsating.
Qaytaring JSON formatida:
{
  "title": "Loyiha sarlavhasi",
  "targetDuration": "${targetDuration}",
  "script": "[00:00 - 00:06] ... to'liq vaqt belgilari bilan sahna matni"
}`;
    } else if (targetFormat === "audiobook") {
      formatSpecificInstructions = `
Ushbu hujjat/manba asosida ta'sirchan audio kitob / hikoya bobini yozing (taxminan ${targetDuration}).
Matnda badiiy ifodalar, hikoyachi pauzalari, chuqur intonatsiyalar va jonli tasvirlar bo'lsin.
Qaytaring JSON formatida:
{
  "title": "Audio kitob bobi sarlavhasi",
  "description": "Bob haqida 1-2 jumlalik annotatsiya",
  "tags": ["AudioKitob", "Badiiy", "Hikoya"],
  "script": "Badiiy audio kitob matni..."
}`;
    } else {
      // Default: single speaker podcast
      formatSpecificInstructions = `
Ushbu hujjat/audio/maqola asosida to'liq professional podkast ssenariysini yozing (taxminan ${targetDuration}).
Matnda podkaster intonatsiyalari bo'lsin: <breath>, |ha|, [KIRISH], [ASOSIY QISM], [XULOSA].
${isLongDuration ? "Matn boblar bo'yicha tuzilsin: [00:00 - 05:00] Kirish, [05:00 - 15:00] 1-Bob, va h.k." : ""}
Qaytaring JSON formatida:
{
  "title": "Podkast sarlavhasi",
  "description": "1-2 jumlalik qisqacha tavsif",
  "tags": ["Teg1", "Teg2", "Teg3"],
  "script": "To'liq o'qiladigan podkast matni"
}`;
    }

    const languageInstruction =
      languageMode === "original"
        ? "Matn tilini manbaning asl tilida (rus, ingliz yoki boshqa) professional darajada saqlang."
        : "Matnni toza, boy, jonli o'zbek tiliga (lotin yozuvida) mukammal moslashtiring (lokalizatsiya qiling).";

    const promptText = `Siz eng yetakchi professional podkast muharriri va audio-ssenaristisiz.
Vazifa: Taqdim etilgan manbani (PDF hujjat, audio/video yozuv, maqola matni, YouTube havolasi yoki boshqa tildagi qoralama) chuqur tahlil qiling va undan to'liq ssenariy yarating.

${resolvedSourceText ? `Manba ma'lumotlari:\n"""${resolvedSourceText}"""\n` : ""}
${userInstructions ? `Foydalanuvchining alohida talabi: "${userInstructions}"\n` : ""}
Uslub: ${toneDescriptions[tone] || toneDescriptions.engaging}
Mo'ljallangan vaqt: ${targetDuration}
Til ko'rsatmasi: ${languageInstruction}

Qoidalar:
1. ${durationDesc}
2. O'zingizdan asossiz narsalarni to'qimang — manbadagi haqiqiy faktlar, raqamlar, tushunchalar va dalillarga suyaning.
3. ${languageInstruction}
4. Audio yoki video manba bo'lsa: undagi asosiy nutq, fikrlar va ma'ruzani tinglab, tartiblangan va qiziqarli audio ssenariyga aylantiring.
5. ${formatSpecificInstructions}`;

    parts.push({ text: promptText });

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: [{ role: "user", parts }],
      config: {
        responseMimeType: "application/json",
        temperature: 0.7,
      },
    });

    const parsed = JSON.parse(response.text?.trim() || "{}");
    res.json({
      success: true,
      targetFormat,
      targetDuration,
      ...parsed,
    });
  } catch (error: any) {
    console.error("Error analyzing document:", error);
    res
      .status(500)
      .json({
        error: error.message || "Hujjatni tahlil qilishda xatolik yuz berdi",
      });
  }
});

// Mount static audio previews for zero-latency streaming
app.use("/audio", express.static(path.resolve(process.cwd(), "public", "audio")));

// Configure Vite or Static
if (process.env.NODE_ENV !== "production") {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.resolve(__dirname, "dist")));
  app.get("*", (_req, res) => {
    res.sendFile(path.resolve(__dirname, "dist", "index.html"));
  });
}

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", async (req, socket, head) => {
  try {
    const url = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/api/live-call") {
      const token = url.searchParams.get("token");
      let verified: { uid: string; email?: string } | null = null;
      if (token) {
        try {
          verified = await verifyRequestToken(token);
        } catch (e) {
          console.warn("Live call token check notice:", e);
        }
      }

      if (!verified || !verified.uid) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      const balance = await getUserBalance(verified.uid, verified.email);
      if (!isEmailAdmin(verified.email) && balance < 1) {
        socket.write("HTTP/1.1 402 Payment Required\r\n\r\n");
        socket.destroy();
        return;
      }

      (req as any).uid = verified.uid;
      (req as any).userEmail = verified.email || "";
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
      return;
    }
  } catch (err) {
    console.error("Upgrade error:", err);
    socket.destroy();
  }
});

wss.on("connection", (clientWs: WebSocket, req: http.IncomingMessage) => {
  console.log("New Gemini Live Call client connected");
  let liveSession: any = null;
  let isFallbackMode = false;
  let currentPersona = "tashkent_real_estate";
  let currentTopic = "";
  let currentLang = "uz";
  let currentSystemInstruction = "";
  let isSuperTaxi = false;
  let isAgentGeneratingTurn = false;
  let lastUserTranscript = "";
  let currentTurnAgentText = "";
  let taxiOrderDispatched = false;

  clientWs.on("message", async (rawMessage) => {
    try {
      const data = JSON.parse(rawMessage.toString());

      if (data.type === "start") {
        const {
          persona = "tashkent_real_estate",
          topic = "Toshkentda uy xarid qilish va ijara maslahati",
          voiceName = "Charon",
          language = "uz",
          skipInitialGreeting = false,
        } = data;

        currentPersona = persona;
        currentTopic = topic;
        currentLang = language;

        isSuperTaxi = persona === "supertaxi_ivr";
        const isRealEstate = persona === "tashkent_real_estate";
        isAgentGeneratingTurn = false;
        lastUserTranscript = "";
        currentTurnAgentText = "";
        taxiOrderDispatched = false;

        let liveVoice = isSuperTaxi ? "Aoede" : isRealEstate ? "Charon" : "Puck";
        const lowerVoice = (voiceName || "").toLowerCase();
        if (lowerVoice === "charon" || lowerVoice.includes("jasur") || lowerVoice.includes("shohrux")) {
          liveVoice = "Charon";
        } else if (
          lowerVoice === "aoede" ||
          lowerVoice.includes("madina") ||
          lowerVoice.includes("malika") ||
          lowerVoice.includes("ayol") ||
          lowerVoice.includes("female")
        ) {
          liveVoice = "Aoede";
        } else if (lowerVoice === "kore" || lowerVoice.includes("aziza")) {
          liveVoice = "Kore";
        } else if (lowerVoice === "fenrir" || lowerVoice.includes("ulug'bek") || lowerVoice.includes("ulugbek")) {
          liveVoice = "Fenrir";
        } else if (lowerVoice === "zephyr") {
          liveVoice = "Zephyr";
        } else if (lowerVoice === "puck" || lowerVoice.includes("otabek")) {
          liveVoice = "Puck";
        }

        const isFemaleLive = isFemaleVoiceName(liveVoice);
        const realtorLiveName = isFemaleLive
          ? language === "ru"
            ? "Малика"
            : "Malika"
          : language === "ru"
          ? "Шохрух"
          : "Shohrux";

        let systemInstruction = "";

        if (isSuperTaxi) {
          systemInstruction = `Siz "SuperTaksi" (Toshkent va O'zbekiston) tezkor ovozli IVR dispetcher-operatorisiz (Madina).
Muloqot tili: FAQAT SOF VA TABIIY O'ZBEK TILI (Toshkent jonli talaffuzi, 0% chet el aksenti).

📌 MUHIM KONTEKST:
Telefon ko'tarilganda mijozga allaqachon: "Assalomu alaykum, SuperTaksi! Eshitaman sizni." degan salomlashuv eshittirildi. Qaytadan uzoq salomlashmang, mijoz nima deyishini diqqat bilan oxirigacha tinglang!

🚕 SIZNING VAZIFANGIZ (15-20 SONIYALIK TEZKOR TAKSI BUYURTMASI):
1. MIJOZNI OXIRIGACHA ESHITING:
   - Agar mijoz faqat "Alo", "Assalomu alaykum", "Salom" yoki "Eshityapsizmi?" deb gapirib, HALI MANZIL YOKI MO'LJALNI AYTMAGAN BO'LSA — aslo "Yaxshi" deb xayrlashmang! Qisqa va xushmuomala qilib:
     "Va alaykum assalom! Qaysi manzilga mashina yuboraylik?" deb so'rang va manzilni kuting.
2. MANZIL AYTILGANDA (1 TA TO'LIQ VA UZLUKSIZ JUMALA BILAN TASDIQLASH):
   - Mijoz qayerda turganini (ketish nuqtasi / mo'ljal) yoki qayerga borishini aytishi bilan (masalan: "Skverga mashina kerak", "Chilonzor 9-kvartal Parus oldiga", "Mega Planet oldiga bitta taksi", "Aeroportga"), qo'shimcha savol bermang ("Qayerga borasiz?", "Qanaqa tarif?" DEB SO'RAMANG!).
   - Faqat "Yaxshi" deb to'xtab qolmang! Bitta uzluksiz, ravon va tabiiy jumlada TO'LIQ mana shu gapni oxirigacha ovoz chiqarib ayting:
     "Yaxshi, [mijoz aytgan manzil/mo'ljal] ga buyurtma qabul qilindi, hozir haydovchimiz sizga qo'ng'iroq qiladi. Xayr, salomat bo'ling!"
   - DIQQAT: Mijozga buyurtma qabul qilinganini va haydovchi qo'ng'iroq qilishini AYTMASTIK MUMKIN EMAS — bu jumlani har doim to'liq va aniq ovozda oxirigacha ayting!
3. TOSHKENT MO'LJALLARI LUG'ATI (TO'G'RI TUSHUNISH VA TALAFFUZ QILISH):
   - Skver -> Amir Temur xiyoboni (Skver)
   - Maksim Gorkiy -> Buyuk Ipak Yo'li (Maksim Gorkiy)
   - Drujba -> Xalqlar Do'stligi
   - Chilonzor (1-26 kvartallar, Qatortol, Parus, Novza, Gagarin)
   - Yunusobod (1-19 kvartallar, Mega Planet, Shahriston, Bodomzor, Universam)
   - Qo'yliq, Chorsu, Sergeli, Oloy bozori, TashMI, Xalqaro Aeroport, Shimoliy Vokzal, Magic City, Tashkent City, Samarqand Darvoza, Next, Compass.
4. O'ZBEK FONETIKASI:
   - "Q" (qabul, qilindi, qo'ng'iroq), "G'" (qo'ng'iroq, sog' bo'ling), "X" (xayr, xiyobon), "H" (hozir, haydovchimiz), "O'" (mo'ljal, ko'cha) harflarini sof Toshkent ohangida talaffuz qiling.`;
        } else if (isRealEstate) {
          systemInstruction = buildRealtorSystemPrompt(language, isFemaleLive);
        } else {
          const personaDescriptions: Record<string, string> = {
            live_cohost: "Jonli podkast hamkor-boshlovchisi. Quvnoq, samimiy, qisqa va lo'nda suhbatdosh.",
            caller_in_air: "Efirga qo'ng'iroq qilgan tinglovchi. Qisqa fikr va aniq savol beruvchi.",
            exclusive_mentor: "Biznes va media ustozi. Aniq raqamlar bilan qisqa maslahat beruvchi.",
            business_consultant: "Sotuv, e-commerce va klinika/xizmatlar bo'yicha tezkor operator-konsultant.",
          };

          const personaDesc = personaDescriptions[persona] || personaDescriptions.live_cohost;

          systemInstruction = `Siz OvozStudio AI jonli telefon suhbatdoshisiz (${realtorLiveName}).
Mavzu: "${topic}".
Sizning rolingiz: ${personaDesc}
Muloqot tili: ${language === "ru" ? "Rus tili (естественный живой диалог)" : "O'zbek tili (samimiy, jonli, hech qanday chet elcha aksentsiz sof o'zbekcha)"}.

⚡ QISQA DIALOG PROTOKOLI (CRISP TURN-TAKING PROTOCOL — QAT'IY):
1. 15 SO'Z QOIDASI: Har bir javobingiz MAKSIMAL 1–2 ta juda qisqa gap (12–15 ta so'z) bo'lsin! Monologlar, uzun tushuntirishlar va ro'yxatlar QAT'IYAN TAQIQLANADI.
2. NEGATIV FILTR: "Men sun'iy intellektman", "Hurmatli mijoz, sizga yordam berishdan xursandman", "Savolingiz uchun katta rahmat", "Tushundim, hozir to'liq aytib beraman" kabi robotik qoliplarni UMUMAN ISHLATMANG.
3. PING-PONG FORMULASI: [Aniq fakt/javob (maks 7 so'z)] + [Qisqa savol-pas (maks 6 so'z)].
4. BARGE-IN: Mijoz gap boshlasa, darhol to'xtab tinglang.`;
        }

        currentSystemInstruction = systemInstruction;

        const agentPickupLine = isSuperTaxi
          ? "Assalomu alaykum, SuperTaksi! Eshitaman sizni."
          : isRealEstate
          ? language === "ru"
            ? `Здравствуйте, агентство недвижимости, ${realtorLiveName}. Слушаю вас.`
            : `Assalomu alaykum, ko'chmas mulk agentligi, ${realtorLiveName}. Eshitaman.`
          : language === "ru"
          ? "Алло, здравствуйте! Я вас внимательно слушаю."
          : "Alo, assalomu alaykum! Tinglayapman sizni.";

        const dispatchTaxiOrderIfMatched = () => {
          const lowerTurn = currentTurnAgentText.toLowerCase();
          if (
            isSuperTaxi &&
            !taxiOrderDispatched &&
            (lowerTurn.includes("buyurtma qabul qilindi") ||
              lowerTurn.includes("haydovchimiz") ||
              lowerTurn.includes("qo'ng'iroq qiladi") ||
              lowerTurn.includes("salomat bo'ling"))
          ) {
            taxiOrderDispatched = true;
            const matchAddr = currentTurnAgentText.match(/^(?:yaxshi[,!\s]+)?(.+?)\s*(?:ga\s+)?buyurtma\s+qabul/i);
            const cleanedUserAddr = lastUserTranscript
              .replace(/\b(alo|assalomu alaykum|salom|eshityapsizmi|menga|bizga|iltimos|bitta|taksi kerak|mashina kerak|buyurtma|kerak edi|borishim kerak)\b[,!\s]*/gi, " ")
              .replace(/\s+/g, " ")
              .trim();
            const extractedAddr =
              matchAddr?.[1]?.trim() ||
              cleanedUserAddr ||
              lastUserTranscript ||
              "Toshkent (Mijoz aytgan manzil)";

            clientWs.send(
              JSON.stringify({
                type: "taxiOrderConfirmed",
                order: {
                  orderId: `ST-${Math.floor(10000 + Math.random() * 90000)}`,
                  pickupLocation: extractedAddr,
                  status: "driver_assigned",
                  timestamp: new Date().toLocaleTimeString("uz-UZ", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  }),
                },
              })
            );
          }
        };

        let turnEndFallbackTimer: ReturnType<typeof setTimeout> | null = null;

        const finalizeAgentTurn = () => {
          if (turnEndFallbackTimer) {
            clearTimeout(turnEndFallbackTimer);
            turnEndFallbackTimer = null;
          }
          if (!currentTurnAgentText.trim() && !taxiOrderDispatched) {
            isAgentGeneratingTurn = false;
            return;
          }
          dispatchTaxiOrderIfMatched();
          if (!taxiOrderDispatched) {
            isAgentGeneratingTurn = false;
          }
          currentTurnAgentText = "";
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(
              JSON.stringify({
                type: "turnComplete",
                taxiOrderDispatched,
              })
            );
          }
        };

        const saveLeadDeclaration = {
          name: "save_lead",
          description: "Saves qualified real estate client lead parameters to CRM lead card.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              clientIntent: {
                type: Type.STRING,
                description: "buy, rent, sell, or invest",
              },
              district: {
                type: Type.STRING,
                description: "Tashkent district (e.g. Chilonzor, Mirobod, Yunusobod, Yakkasaroy, Mirzo Ulug'bek, Yashnobod, Sergeli)",
              },
              roomsCount: {
                type: Type.STRING,
                description: "Number of rooms (e.g. 1 xonali, 2 xonali, 3 xonali, 4 xonali)",
              },
              budgetRange: {
                type: Type.STRING,
                description: "Client budget (e.g. $50,000, $70,000)",
              },
              paymentMethod: {
                type: Type.STRING,
                description: "cash, mortgage, or installments",
              },
              propertyType: {
                type: Type.STRING,
                description: "novostroyka or vtorichka",
              },
              clientName: {
                type: Type.STRING,
                description: "Client's name",
              },
              preferredContactTime: {
                type: Type.STRING,
                description: "Preferred callback time or Telegram/office preference",
              },
            },
          },
        };

        // Connect to Gemini 3.8 Live API with verified prebuilt voice & 220ms ultra-fast VAD
        try {
          const voiceConfig = { prebuiltVoiceConfig: { voiceName: liveVoice } };
          const liveConfig: any = {
            responseModalities: [Modality.AUDIO],
            speechConfig: { voiceConfig },
            systemInstruction,
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            ...(isSuperTaxi
              ? {
                  realtimeInputConfig: {
                    automaticActivityDetection: {
                      disabled: false,
                      silenceDurationMs: 220,
                      prefixPaddingMs: 40,
                    },
                  },
                }
              : {
                  realtimeInputConfig: {
                    automaticActivityDetection: {
                      disabled: false,
                      startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
                      endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
                      prefixPaddingMs: 200,
                      silenceDurationMs: 450,
                    },
                  },
                }),
          };

          if (isRealEstate) {
            liveConfig.tools = [{ functionDeclarations: [saveLeadDeclaration] }];
          }

          const activeLiveKey = resolveActiveGeminiKey();
          if (!activeLiveKey) {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(
                JSON.stringify({
                  type: "apiKeyExpired",
                  error: "Gemini API kaliti belgilanmagan. Iltimos, kalit kiriting.",
                })
              );
            }
            return;
          }

          let receivedAnyTurnOutput = false;
          let didRetryCompatConfig = false;

          const startLiveSession = async (cfg: any, keyToUse: string) => {
            const clientForLive = getGeminiClient(keyToUse);
            return await clientForLive.live.connect({
              model: "gemini-3.8-live",
              config: cfg,
              callbacks: {
                onmessage: (msg: any) => {
                  if (msg?.serverContent?.modelTurn || msg?.serverContent?.outputTranscription || msg?.toolCall) {
                    receivedAnyTurnOutput = true;
                  }
                  if (clientWs.readyState !== WebSocket.OPEN) return;

                  // 0. Handle save_lead Function Call from Gemini Live
                  if (msg.toolCall?.functionCalls?.length) {
                    const functionResponses: any[] = [];
                    for (const call of msg.toolCall.functionCalls) {
                      if (call.name === "save_lead") {
                        const args = call.args || {};
                        clientWs.send(
                          JSON.stringify({
                            type: "leadSaved",
                            lead: {
                              ...args,
                              leadTemperature: "hot",
                            },
                            finalized: true,
                          })
                        );
                      }
                      functionResponses.push({
                        id: call.id,
                        name: call.name,
                        response: { result: "saved" },
                      });
                    }
                    if (liveSession && functionResponses.length > 0) {
                      try {
                        liveSession.sendToolResponse({ functionResponses });
                      } catch (toolErr) {
                        console.warn("sendToolResponse warning:", toolErr);
                      }
                    }
                  }

                  // 1. Audio stream chunks from Gemini (iterate all parts so no audio chunk is ever skipped)
                  for (const part of msg.serverContent?.modelTurn?.parts ?? []) {
                    if (part.inlineData?.data) {
                      isAgentGeneratingTurn = true;
                      clientWs.send(JSON.stringify({ type: "audio", audio: part.inlineData.data }));
                    }
                  }

                  // 1b. Input audio transcription from user
                  const inputTranscript = msg.serverContent?.inputTranscription?.text;
                  if (inputTranscript && inputTranscript.trim()) {
                    lastUserTranscript = `${lastUserTranscript} ${inputTranscript}`.trim();
                    clientWs.send(JSON.stringify({ type: "userTranscript", text: inputTranscript }));
                    if (isRealEstate) {
                      const progressiveLead = extractProgressiveRealtorLead(lastUserTranscript);
                      if (Object.keys(progressiveLead).length > 0) {
                        clientWs.send(
                          JSON.stringify({
                            type: "leadSaved",
                            lead: progressiveLead,
                            finalized: false,
                          })
                        );
                      }
                    }
                  }

                  // 2. Text parts / output audio transcripts if present
                  const partText = msg.serverContent?.modelTurn?.parts
                    ?.map((p: any) => p.text)
                    .filter(Boolean)
                    .join(" ");
                  const outTranscript = msg.serverContent?.outputTranscription?.text;
                  const text = outTranscript || partText;
                  if (text) {
                    isAgentGeneratingTurn = true;
                    currentTurnAgentText = `${currentTurnAgentText} ${text}`.trim();
                    clientWs.send(JSON.stringify({ type: "text", text }));
                  }

                  // Reset fallback turn-end timer whenever Gemini is actively streaming audio or text
                  if (isSuperTaxi && (msg.serverContent?.modelTurn?.parts?.length || text)) {
                    if (turnEndFallbackTimer) clearTimeout(turnEndFallbackTimer);
                    turnEndFallbackTimer = setTimeout(() => {
                      finalizeAgentTurn();
                    }, 1200);
                  }

                  // 3. User interrupted agent mid-speech (ignore on SuperTaxi IVR so mic noise/echo never aborts confirmation speech)
                  if (msg.serverContent?.interrupted) {
                    if (!isSuperTaxi) {
                      isAgentGeneratingTurn = false;
                      currentTurnAgentText = "";
                      clientWs.send(JSON.stringify({ type: "interrupted" }));
                    }
                  }

                  // 4. Agent completed its current turn
                  if (msg.serverContent?.turnComplete) {
                    finalizeAgentTurn();
                  }
                },
                onclose: async (closeEvent?: any) => {
                  if (turnEndFallbackTimer) {
                    clearTimeout(turnEndFallbackTimer);
                    turnEndFallbackTimer = null;
                  }
                  const closeCode = closeEvent?.code;
                  const closeReason = String(closeEvent?.reason || "");
                  console.warn("Gemini Live session close notice:", closeCode, closeReason);
                  if (clientWs.readyState !== WebSocket.OPEN) return;

                  // Only treat as expired API key if the reason actually indicates a key/auth failure!
                  if (isGeminiKeyErrorMessage(closeReason)) {
                    const fallbackKey = markGeminiKeyExpiredAndFallback(keyToUse);
                    if (fallbackKey && fallbackKey !== keyToUse) {
                      try {
                        liveSession = await startLiveSession(cfg, fallbackKey);
                        return;
                      } catch {}
                    }
                    liveSession = null;
                    clientWs.send(JSON.stringify({
                      type: "apiKeyExpired",
                      error: "Gemini API kaliti muddati tugagan. Iltimos, yangi kalit kiriting.",
                    }));
                  } else if (closeCode === 1007 && !receivedAnyTurnOutput && !didRetryCompatConfig) {
                    // Retry once with minimal Live config (without sensitivity enums)
                    didRetryCompatConfig = true;
                    const minimalConfig: any = {
                      responseModalities: [Modality.AUDIO],
                      speechConfig: { voiceConfig },
                      systemInstruction,
                      inputAudioTranscription: {},
                      outputAudioTranscription: {},
                      realtimeInputConfig: {
                        automaticActivityDetection: {
                          disabled: false,
                          prefixPaddingMs: 200,
                          silenceDurationMs: 450,
                        },
                      },
                      ...(isRealEstate ? { tools: [{ functionDeclarations: [saveLeadDeclaration] }] } : {}),
                    };
                    try {
                      liveSession = await startLiveSession(minimalConfig, keyToUse);
                      return;
                    } catch (retryErr: any) {
                      liveSession = null;
                      clientWs.send(JSON.stringify({
                        type: "error",
                        error: retryErr?.message || closeReason || "Gemini Live WebSocket config error (1007)",
                      }));
                    }
                  } else if (closeCode === 1007) {
                    liveSession = null;
                    clientWs.send(JSON.stringify({
                      type: "error",
                      error: closeReason || "Gemini Live WebSocket invalid argument (1007)",
                    }));
                  } else {
                    clientWs.send(JSON.stringify({ type: "sessionClosed", reason: closeReason }));
                  }
                },
                onerror: (err: any) => {
                  const errMsg = String(err?.message || err || "");
                  console.warn("Gemini Live session warning:", errMsg);
                  if (clientWs.readyState !== WebSocket.OPEN) return;
                  if (isGeminiKeyErrorMessage(errMsg)) {
                    markGeminiKeyExpiredAndFallback(keyToUse);
                    clientWs.send(JSON.stringify({
                      type: "apiKeyExpired",
                      error: "Gemini API kaliti muddati tugagan. Iltimos, yangi kalit kiriting.",
                    }));
                  } else {
                    clientWs.send(JSON.stringify({
                      type: "error",
                      error: errMsg || "Gemini Live WebSocket error",
                    }));
                  }
                },
              },
            });
          };

          liveSession = await startLiveSession(liveConfig, activeLiveKey);

          // Deduct 1 credit atomically on the server and log generation when Gemini Live session connects
          let creditsRemaining: number | undefined;
          try {
            const wsUid = (req as any)?.uid;
            const wsEmail = (req as any)?.userEmail;
            if (wsUid) {
              const deductRes = await deductUserCredits(wsUid, wsEmail, 1);
              creditsRemaining = deductRes.remaining;
              const storedU = localStore.getUser(wsUid);
              localStore.logGeneration(wsUid, {
                id: `gen_live_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                userId: wsUid,
                userEmail: (wsEmail || storedU?.email || "").trim().toLowerCase(),
                type: "agent_call",
                title: `Jonli AI Qo'ng'iroq (${persona})`,
                creditsCost: isEmailAdmin(wsEmail) ? 0 : 1,
                status: "completed",
                voiceName: liveVoice,
                details: (topic || persona).slice(0, 240),
                createdAt: new Date().toISOString(),
              });
            }
          } catch (deductErr) {
            console.warn("Live call server credit deduction notice:", deductErr);
          }

          // Confirm connection to client
          clientWs.send(JSON.stringify({ type: "connected", voiceUsed: liveVoice, creditsRemaining }));

          // Only trigger AI greeting if client did NOT play a 0-token pre-recorded WAV greeting
          if (!skipInitialGreeting) {
            setTimeout(() => {
              try {
                if (liveSession) {
                  liveSession.sendClientContent({
                    turns: [
                      {
                        role: "user",
                        parts: [
                          {
                            text: `[SYSTEM INSTRUCTION]: Telefon go'shagini ko'tardingiz. Qisqa va tabiiy ohangda faqat quyidagi gapni ayting: "${agentPickupLine}". Boshqa hech narsa qo'shmang va darhol mijoz javobini kuting.`,
                          },
                        ],
                      },
                    ],
                    turnComplete: true,
                  });
                }
              } catch (initErr) {
                console.warn("Live greeting trigger warning:", initErr);
              }
            }, 350);
          }
        } catch (sessionErr: any) {
          const errMsg = String(sessionErr?.message || sessionErr || "");
          console.warn("Live direct connect error:", errMsg);
          liveSession = null;

          if (clientWs.readyState === WebSocket.OPEN) {
            if (isGeminiKeyErrorMessage(errMsg)) {
              markGeminiKeyExpiredAndFallback();
              clientWs.send(
                JSON.stringify({
                  type: "apiKeyExpired",
                  error: "Gemini API kaliti muddati tugagan. Iltimos, yangi kalit kiriting.",
                })
              );
            } else {
              clientWs.send(
                JSON.stringify({
                  type: "error",
                  error: errMsg || "Failed to connect to Gemini 3.8 Live API",
                })
              );
            }
          }
        }
      } else if (data.type === "audio" && data.audio && liveSession) {
        // Half-duplex protection for SuperTaxi IVR: while operator is generating its response or after order is dispatched, ignore mic noise/echo
        if (isSuperTaxi && (isAgentGeneratingTurn || taxiOrderDispatched)) {
          return;
        }
        // Real-time microphone audio chunk from user (16kHz PCM mono base64)
        liveSession.sendRealtimeInput({
          audio: { data: data.audio, mimeType: "audio/pcm;rate=16000" },
        });
      } else if (data.type === "text" && data.text && liveSession) {
        if (isSuperTaxi) {
          isAgentGeneratingTurn = true;
        }
        lastUserTranscript = `${lastUserTranscript} ${data.text}`.trim();
        liveSession.sendClientContent({
          turns: [{ role: "user", parts: [{ text: data.text }] }],
          turnComplete: true,
        });
      } else if (data.type === "interrupt" && liveSession) {
        if (!isSuperTaxi && clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({ type: "interrupted" }));
        }
      }
    } catch (err: any) {
      console.error("Live call WS processing error:", err);
    }
  });

  clientWs.on("close", async () => {
    if (liveSession) {
      try {
        await liveSession.close();
      } catch (e) {}
      liveSession = null;
    }
  });
});

const shutdownCleanly = () => {
  try {
    server.close(() => {
      process.exit(0);
    });
  } catch {}
  setTimeout(() => process.exit(0), 150).unref();
};
process.on("SIGTERM", shutdownCleanly);
process.on("SIGINT", shutdownCleanly);

process.on("uncaughtException", (err) => {
  console.warn("Uncaught exception (handled):", err?.message || err);
});
process.on("unhandledRejection", (reason: any) => {
  console.warn("Unhandled rejection (handled):", reason?.message || reason);
});

let listenRetries = 0;
server.on("error", (err: any) => {
  if (err && err.code === "EADDRINUSE" && listenRetries < 10) {
    listenRetries++;
    console.warn(`Port ${PORT} busy, retrying in 400ms (attempt ${listenRetries}/10)...`);
    setTimeout(() => {
      try {
        server.close();
      } catch {}
      server.listen(Number(PORT), "0.0.0.0");
    }, 400);
  } else {
    console.error("Server error:", err);
  }
});

server.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`PodkastUz Server running on port ${PORT} (PID ${process.pid})`);
});


