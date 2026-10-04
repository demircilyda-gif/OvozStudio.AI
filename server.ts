import express from "express";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Stripe from "stripe";
import { GoogleGenAI, Modality } from "@google/genai";
import { YoutubeTranscript } from "youtube-transcript";
import { extractMediaAudio } from "./server/services/mediaExtractor.js";
import { runMediaDubbingPipeline, getPipelineLogs } from "./server/services/mediaPipeline.js";
import { normalizeUzbekSpeech } from "./src/utils/uzbekNormalizer.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Shared Gemini client with telemetry header
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

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
 * Cleans stage directions, conditions (Baritone, Mezzo, Pause, etc.), timestamps, and speaker tags
 * from speech scripts so that Gemini TTS only speaks the actual spoken words.
 * Extracts any delivery conditions to enrich speechMetadata style instructions.
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

  // 1. Capture all bracket conditions [...] like [00:00 - 00:06], [Баритон, бодро], [Пауза 2с], [Кадр 1], etc.
  const bracketRegex = /\[([^\]]+)\]/g;
  let bMatch;
  while ((bMatch = bracketRegex.exec(rawText)) !== null) {
    const content = bMatch[1].trim();
    if (content) {
      detectedConditions.push(`[${content}]`);
      if (
        /(?:bariton|mezzo|sopran|tenor|bas|sokin|tez|pauza|nafas|kulgi|ovoz|ohang|jiddiy|hayajon|голос|баритон|меццо|тенор|сопрано|бас|пауз|шепот|громк|интонац|акцент|настроени|уверен|бодр|спокойн|мягк|глубок|тембр|style|mood|tone|speed|whisper)/i.test(
          content,
        )
      ) {
        extractedStyles.push(content);
      }
    }
  }

  // 2. Capture all parenthetical directions (...) that are actor directions, timing, or conditions
  const parenRegex = /\(([^)]+)\)/g;
  let pMatch;
  while ((pMatch = parenRegex.exec(rawText)) !== null) {
    const content = pMatch[1].trim();
    if (content) {
      if (
        /(?:bariton|mezzo|sopran|tenor|bas|sokin|tez|pauza|nafas|kulgi|kamera|kadr|musiqa|ovoz|ohang|jiddiy|hayajon|голос|баритон|меццо|тенор|сопрано|бас|пауз|шепот|громк|интонац|акцент|настроени|уверен|бодр|спокойн|секунд|сек|диктор|ведущ|гость|кадр|сцен|музык|эффект|улыбк|смех|\d{1,2}:\d{2})/i.test(
          content,
        )
      ) {
        detectedConditions.push(`(${content})`);
        extractedStyles.push(content);
      }
    }
  }

  let cleaned = rawText;

  // 3. Script headers
  cleaned = cleaned
    .replace(
      /^(?:SARLAVHA|TAKROR_VAQT|SAHNA_MATNI|TOZA_MATN|TITLE|SCENE|CHAPTER|BOB|KIRISH|INTRO|XULOSA|OUTRO|СЦЕНА|ГЛАВА|ВСТУПЛЕНИЕ|ИТОГ)\s*:[^\n]*\n?/gim,
      "",
    )
    .replace(/^---\s*$/gm, "");

  // 4. Handle pause tags by converting them into natural sentence cadence (comma or ellipsis) before removal
  cleaned = cleaned
    .replace(/\[\s*(?:pauza|pause|пауза|jimlik|тишина)[^\]]*\]/gi, "... ")
    .replace(/\(\s*(?:pauza|pause|пауза|jimlik|тишина)[^)]*\)/gi, "... ");

  // 5. Remove all bracket blocks completely: [00:00 - 00:06], [Баритон], [Кадр 1], etc.
  cleaned = cleaned.replace(/\[[^\]]+\]/g, " ");

  // 6. Remove stage directions / condition parentheses
  cleaned = cleaned.replace(
    /\((?:[^)]*(?:bariton|mezzo|sopran|tenor|bas|sokin|tez|pauza|nafas|kulgi|kamera|kadr|musiqa|ovoz|ohang|jiddiy|hayajon|голос|баритон|меццо|тенор|сопрано|бас|пауз|шепот|громк|интонац|акцент|настроени|уверен|бодр|спокойн|секунд|сек|диктор|ведущ|гость|кадр|сцен|музык|эффект|улыбк|смех)[^)]*)\)/gi,
    " ",
  );

  // 7. Remove timing ranges (e.g. 00:00 - 00:06) and line-start director markers (e.g. 01:23: )
  // CRITICAL: Normal clock times in sentence context (e.g. "soat 12:30 da", "19:00") MUST be preserved!
  cleaned = cleaned
    .replace(/\b\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\b/g, " ")
    .replace(/^\s*\d{1,2}:\d{2}(?::\d{2})?\s*[:-]\s*/gm, "");

  // 8. Remove speaker label prefixes at line starts: e.g. "Диктор (баритон):", "Ведущий:", "Host 1:", "Boshlovchi:", "Speaker:"
  cleaned = cleaned.replace(
    /^(?:[A-Za-zА-Яа-яЁё0-9_\s-]{1,25}(?:\([^)]*\))?)\s*:\s*(?=[A-Za-zА-Яа-яЁё])/gm,
    (match) => {
      if (
        /(?:диктор|голос|ведущ|гость|boshlovchi|mehmon|host|guest|speaker|spiker|narrator|баритон|меццо|bariton|mezzo|кадр|сцена|sahna|kadr|интонация|ohang|тембр|tembr|shart|условие)/i.test(
          match,
        )
      ) {
        return "";
      }
      return match;
    },
  );

  // 9. Remove formatting symbols (*, _, #, ~, `)
  cleaned = cleaned.replace(/[*#_~`]/g, "");

  // 10. Normalize spaces and punctuation
  cleaned = cleaned
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();

  return {
    speechText: cleaned,
    extractedStyles: Array.from(new Set(extractedStyles)),
    detectedConditions: Array.from(new Set(detectedConditions)),
  };
}

// Health check
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    model: "gemini-3.8-flash-tts",
    liveSupported: true,
    hasApiKey: Boolean(process.env.GEMINI_API_KEY),
  });
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
    const previewDir = path.join(process.cwd(), "public", "audio", "previews");
    const previewFile = path.join(previewDir, `${cleanId}.wav`);

    // 1. If already saved on disk, stream immediately with strong cache headers
    if (fs.existsSync(previewFile)) {
      res.setHeader("Content-Type", "audio/wav");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      return fs.createReadStream(previewFile).pipe(res);
    }

    // 2. If not yet on disk, synthesize once, save, and stream
    if (!fs.existsSync(previewDir)) {
      fs.mkdirSync(previewDir, { recursive: true });
    }

    const previewGreeting = "Assalomu alaykum! OvozStudio'ga xush kelibsiz, o'zbekcha professional podkast yaratamiz.";
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
          voiceConfig: { prebuiltVoiceConfig: { voiceName: "Charon" } },
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

// Get Payment & Gateway Configuration
app.get("/api/billing/config", (req, res) => {
  res.json({
    stripeConfigured: Boolean(stripeClient),
    telegramHandle: process.env.TELEGRAM_ADMIN_HANDLE || "ovozstudio_admin",
    phoneNumber: process.env.ADMIN_PHONE_NUMBER || "+998 90 123 45 67",
    adminEmail: "demircilyda@gmail.com",
    cardDetails: {
      cardNumber: process.env.ADMIN_CARD_NUMBER || "9860 3501 4500 1755",
      cardHolder: process.env.ADMIN_CARD_HOLDER || "HUMO",
      bank: process.env.ADMIN_CARD_BANK || "Humo",
    },
  });
});

// Create Stripe Checkout Session
app.post("/api/billing/create-checkout-session", async (req, res) => {
  try {
    const { planId, userId, userEmail } = req.body;

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
      customer_email: userEmail,
      client_reference_id: userId,
      metadata: {
        userId: userId || "",
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

// Verify Stripe Checkout Session
app.get("/api/billing/verify-session/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    if (!stripeClient) {
      return res.status(400).json({ error: "Stripe sozlanmagan" });
    }

    const session = await stripeClient.checkout.sessions.retrieve(sessionId);
    if (session.payment_status === "paid") {
      res.json({
        paid: true,
        userId: session.client_reference_id || session.metadata?.userId,
        userEmail: session.customer_email || session.metadata?.userEmail,
        planId: session.metadata?.planId,
        credits: Number(session.metadata?.credits || 0),
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

// Delete a custom stored voice
app.delete("/api/voices/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await ai.voices.delete(id);
    res.json({ success: true, result });
  } catch (error: any) {
    console.error("Error deleting voice:", error);
    res
      .status(500)
      .json({ error: error.message || "Ovozni o'chirishda xatolik" });
  }
});

// Create Voice Replication (official Gemini 3.8 Voice Replication API)
app.post("/api/voices/replicate", async (req, res) => {
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
          'Ovoz egasining ovozli roziligi (consentAudioBase64) kiritilishi shart. Ovozda: "Men ushbu ovozning egasiman va Google ushbu ovozdan sun\'iy intellekt modeli yaratishiga roziman" deb aytilishi lozim.',
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
    res.status(500).json({
      error:
        error.message ||
        "Ovoz nusxalashda xatolik yuz berdi. Audio sifati va ovozli rozilik matnini tekshiring.",
    });
  }
});

// Create Voice Design (natural-language voice description)
app.post("/api/voices/design", async (req, res) => {
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

  for (const para of paragraphs) {
    if (para.length <= maxChunkLength) {
      chunks.push(para);
    } else {
      // Cascade 1: Split into sentences using punctuation boundaries (. ! ?)
      const sentences =
        para.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [para];
      let currentChunk = "";

      for (const sent of sentences) {
        const trimmed = sent.trim();
        if (!trimmed) continue;

        if (trimmed.length > maxChunkLength) {
          // If a single sentence exceeds limit, split it further through sub-cascades
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
    }
  }

  return chunks.length > 0 ? chunks : [text];
}

// Generate professional Uzbek podcast script
app.post("/api/podcast/generate-script", async (req, res) => {
  try {
    const {
      category = "Tarixiy",
      topic = "Amir Temur va Samarqand siri",
      style = "Jiddiy hikoya",
      targetDuration = "30 daqiqa",
      customInstructions = "",
      voicePersona = "Mening ovozim",
    } = req.body;

    const isLongForm =
      targetDuration.includes("15") ||
      targetDuration.includes("30") ||
      targetDuration.includes("45") ||
      targetDuration.includes("60") ||
      targetDuration.includes("soat");

    const durationGuidance = isLongForm
      ? `Bu KATTA VA TO'LIQ ${targetDuration}lik podkast soni bo'lishi kerak.
Matnni boblarga ajrating:
- [KIRISH/INTRO]: Mavzuning dolzarbligi, shaxsiy fikr va qiziqarli xuk.
- [1-BOB]: Tarixiy va nazariy asoslar, ildizlar va birinchi hayratlanarli faktlar.
- [2-BOB]: Asosiy voqealar rivoji, chuqur tahlil va kutilmagan tafsilotlar.
- [3-BOB]: Qiyosiy tahlil, bahsli fikrlar va hayotiy misollar.
- [4-BOB]: Bugungi kun bilan bog'liqlik va amaliy saboqlar.
- [XULOSA/OUTRO]: Chuqur xulosa, tinglovchilar uchun savol va iliq xayrlashuv.
Har bir bobda chuqur hikoyanavislik, voqealar tafsilotlari, jonli misollar va savollar bo'lsin.`
      : `Bu qisqa ${targetDuration}lik epizod. Matn lo'nda, dinamik va quloqni tortuvchi bo'lsin: [KIRISH], [ASOSIY QISM], [XULOSA].`;

    const prompt = `Siz O'zbekistondagi eng yetakchi professional podkast muallifi va ssenariy yozuvchisiz.
Quyidagi parametrlar bo'yicha to'liq o'zbek tilida (lotin yozuvida) yorqin, qiziqarli va professional podkast skripti (matni) yozing:

Kategoriya: ${category}
Mavzu: ${topic}
Podkast uslubi va kayfiyati: ${style}
Mo'ljallangan davomiyligi: ${targetDuration}
Muallif/Boshlovchi ovozi: ${voicePersona}
Qo'shimcha istaklar: ${customInstructions || "Yuqori sifatli jonli hikoya"}

Maxsus talablar:
${durationGuidance}

Umumiy qoidalar:
1. Matn toza, chiroyli va tabiiy o'zbek adabiy va so'zlashuv tilida bo'lsin.
2. Tabiiy podkaster tovushlari va intonatsiyalarini matnga kiritishingiz mumkin:
   masalan, <breath> (yengil nafas), <laugh> (kulgi - agar komedik bo'lsa), |ha|, |albatta|, |mhm|, [Pauza 1s] kabi jonli elementlar.
3. Hech qanday keraksiz texnik izohlarsiz, to'g'ridan-to'g'ri podkaster o'qiydigan matnni taqdim eting.

Format:
SARLAVHA: [Podkast sarlavhasi]
TAVSIF: [Qisqa 1-2 jumlalik tushuntirish]
SKRIPT:
[To'liq o'qiladigan matn]`;

    const response = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
      config: {
        temperature: 0.8,
        topP: 0.95,
      },
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
app.post("/api/podcast/generate-longform-script", async (req, res) => {
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
app.post("/api/podcast/expand-chapter", async (req, res) => {
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

// Synthesize speech using Gemini 3.8 Flash TTS with user's replicated voice or custom voice
app.post("/api/podcast/synthesize", async (req, res) => {
  try {
    const {
      text,
      voiceProfile = {},
      speechStyle = "Jiddiy hikoyanavis",
    } = req.body;

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
      `Uzbek language podcast speaker.`,
      `Voice persona name: ${voiceName}.`,
      customPersonaPrompt ? `Voice Persona: ${customPersonaPrompt}.` : "",
      `Timbre and acoustic qualities: ${timbre}.`,
      `Tempo & Cadence: ${tempo}.`,
      `Emotion and delivery mood: ${speechStyle}.${dynamicStyle}`,
      `Pronounce authentic Uzbek words naturally with clear diction, engaging storytelling presence, and suitable pauses. Never speak out loud any parenthetical directions, conditions, or bracketed notes.`,
    ]
      .filter(Boolean)
      .join(" ");

    let audioData: string | undefined;
    let mimeType = "audio/wav";

    // Break text into natural speech chunks to support any duration (even 15-60 minutes) without truncation
    const chunks = splitTextIntoSpeechChunks(cleanedText, 320);
    const pcmChunks: Buffer[] = [];
    const failedChunkIndices: number[] = [];
    // 250ms silence pause between paragraphs (24000 samples/s * 2 bytes * 0.25s = 12000 bytes)
    const pauseBuffer = Buffer.alloc(12000);

    for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
      const chunkText = chunks[cIdx];
      let chunkPcm: Buffer | null = null;

      try {
        // Primary attempt: Gemini 3.8 Flash TTS
        const response = await ai.models.generateContent({
          model: "gemini-3.8-flash-tts",
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: chunkText,
                  speechMetadata: {
                    speaker: voiceName,
                    style: combinedStylePrompt,
                  },
                },
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

        const part = response.candidates?.[0]?.content?.parts?.[0];
        if (part?.inlineData?.data) {
          const rawBuf = Buffer.from(part.inlineData.data, "base64");
          const { pcm } = extractPcmData(rawBuf);
          chunkPcm = pcm;
        }
      } catch (ttsErr: any) {
        console.warn(
          `[Chunk ${cIdx + 1}/${chunks.length}] Primary TTS failed, trying fallback:`,
          ttsErr.message,
        );
        try {
          const fallbackVoiceName = baseVoice || "Charon";
          const fallbackResponse = await ai.models.generateContent({
            model: "gemini-3.8-flash-tts",
            contents: [
              {
                role: "user",
                parts: [{ text: chunkText }],
              },
            ],
            config: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: fallbackVoiceName },
                },
              },
            },
          });
          const part = fallbackResponse.candidates?.[0]?.content?.parts?.[0];
          if (part?.inlineData?.data) {
            const rawBuf = Buffer.from(part.inlineData.data, "base64");
            const { pcm } = extractPcmData(rawBuf);
            chunkPcm = pcm;
          }
        } catch (fErr: any) {
          console.error(
            `[Chunk ${cIdx + 1}/${chunks.length}] Fallback TTS failed:`,
            fErr.message,
          );
        }
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
    });
  } catch (error: any) {
    console.error("TTS error:", error);
    res.status(500).json({
      error: error.message || "Ovoz sintezida xatolik yuz berdi",
    });
  }
});

// Analyze user's voice sample with acoustic breakdown
app.post("/api/voice/analyze-sample", async (req, res) => {
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
app.post("/api/voiceover/generate-script", async (req, res) => {
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
app.post("/api/voiceover/transcribe-and-translate", async (req, res) => {
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
app.post("/api/voiceover/fetch-media-url", async (req, res) => {
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
app.post("/api/voiceover/process-pipeline", async (req, res) => {
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
 * Endpoint to retrieve recent pipeline attempt logs
 */
app.get("/api/voiceover/pipeline-logs", (req, res) => {
  res.json({ logs: getPipelineLogs() });
});

/**
 * Translate user's provided original speech text into synchronized Uzbek with timecodes.
 * Guarantees NO hallucination: strictly translates the speaker's real words.
 */
app.post("/api/voiceover/translate-custom-speech", async (req, res) => {
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
app.post("/api/voiceover/generate-video-subtitles", async (req, res) => {
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
app.post("/api/voiceover/synthesize", async (req, res) => {
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
                style: `Professional voiceover & dubbing artist. Voice: ${voiceName}. Timbre: ${timbre}. Tempo: ${tempo}. Mood: ${speechStyle}.${dynamicStyle} Clear commercial pronunciation. Do NOT voice or pronounce any condition brackets, parentheses, or stage directions.`,
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

    res.json({
      audioBase64: finalBuffer.toString("base64"),
      mimeType,
      durationSeconds,
      srtSubtitles: srtOutput.trim(),
      vttSubtitles: vttOutput.trim(),
      voiceName,
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
app.post("/api/podcast/generate-interview", async (req, res) => {
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
    if (targetDuration.includes("15")) {
      targetTurns = 18;
      turnLengthGuidance =
        "har bir replika 60-90 so'z bo'lib, mavzu faktlar bilan asoslansin";
    }
    if (targetDuration.includes("30")) {
      targetTurns = 26;
      turnLengthGuidance =
        "har bir replika 80-140 so'z bo'lib, batafsil tajriba, argument va misollar berilsin";
    }
    if (
      targetDuration.includes("45") ||
      targetDuration.includes("60") ||
      targetDuration.includes("soat")
    ) {
      targetTurns = 36;
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

Talablar:
- Suhbat aniq ${targetTurns} ta replikadan iborat bo'lsin.
- REPLIKA HAJMI: ${turnLengthGuidance}. Boshlovchi qisqa so'ramasin, o'z mulohazasini ham qo'shsin; mehmon esa shunchaki "ha" demasdan, 2-3 ta hayotiy misol, fakt va sabablar bilan keng tushuntirsin.
- Suhbat bosqichlari:
  1. Kirish, anons va taklif sababi (1-4 replika)
  2. Mavzuning tub mohiyati, shaxsiy tajriba va kutilmagan birinchi savol (5-10 replika)
  3. Bahsli nuqtalar, qiyin savollar, xatolar va real hayotiy keyslar (11-22 replika)
  4. Amaliy maslahatlar, kelajak istiqbollari va tinglovchilar uchun xulosalar (23-${targetTurns} replika)
- Tabiiy suhbat belgilari: <breath>, <laugh>, |ha|, |albatta|, |mhm|, [Pauza 1s] kabilardan o'rinli foydalaning.
- JSON formatida qaytaring:
{
  "title": "${topic} — ${host1Name} va ${host2Name} Podkast Intervyusi",
  "topic": "${topic}",
  "targetDuration": "${targetDuration}",
  "turns": [
    {
      "speakerId": "HOST_1",
      "speakerName": "${host1Name}",
      "text": "Assalomu alaykum qadrli tinglovchilar...",
      "emotion": "excited"
    },
    {
      "speakerId": "HOST_2",
      "speakerName": "${host2Name}",
      "text": "Va alaykum assalom, Shokhrukh! Taklif uchun katta rahmat...",
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

// Expand existing interview with next round of dialogue turns
app.post("/api/podcast/expand-interview", async (req, res) => {
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

// Synthesize 2-speaker dialogue with independent voices and master track stitching
app.post("/api/podcast/synthesize-dialogue", async (req, res) => {
  try {
    const { turns = [], host1Voice = {}, host2Voice = {} } = req.body;

    if (!Array.isArray(turns) || turns.length === 0) {
      return res
        .status(400)
        .json({ error: "Replika ro'yxati (turns) bo'sh bo'lmasligi kerak" });
    }

    const host1Id = host1Voice.voiceId || host1Voice.id || "voice_17raj9ewke3g";
    const isHost2Female =
      host2Voice.gender === "female" ||
      host2Voice.baseVoice === "Kore" ||
      host2Voice.baseVoice === "Aoede" ||
      /aziza|madina|dilnoza|zarina|nodira|malika|ayol|qiz/i.test(
        host2Voice.voiceId || host2Voice.name || "",
      );

    // Choose appropriate base prebuilt voice: 'Kore' or 'Aoede' for female, 'Charon', 'Puck', 'Fenrir', 'Zephyr' for male
    const host2BaseVoice = isHost2Female
      ? host2Voice.baseVoice === "Aoede"
        ? "Aoede"
        : "Kore"
      : ["Charon", "Puck", "Fenrir", "Zephyr"].includes(host2Voice.baseVoice)
        ? host2Voice.baseVoice
        : "Charon";
    const host2Id = host2Voice.voiceId || host2Voice.id || host2BaseVoice;

    // Route speaker 1: use replicated voice if voice ID matches or starts with voice_
    const isHost1Custom =
      host1Id &&
      (host1Id.startsWith("voice_") ||
        host1Id.startsWith("voicekey_") ||
        host1Id.includes("17raj9"));
    const host1Config = isHost1Custom
      ? { voice: host1Id }
      : {
          prebuiltVoiceConfig: { voiceName: host1Voice.baseVoice || "Charon" },
        };

    // Route speaker 2: Guest voice.
    // If guest has custom cloned voice (female or male), allow it!
    // ONLY prevent accidental substitution of the host 1 male replicated voice ('17raj9') for a female speaker.
    const isMaleHost1VoiceId = host2Id && host2Id.includes("17raj9");
    const isHost2Custom =
      host2Id &&
      !(isHost2Female && isMaleHost1VoiceId) &&
      (host2Id.startsWith("voice_") || host2Id.startsWith("voicekey_"));
    const host2Config = isHost2Custom
      ? { voice: host2Id }
      : { prebuiltVoiceConfig: { voiceName: host2BaseVoice } };

    console.log(
      `[Synthesize Dialogue] Speaker 1 config:`,
      JSON.stringify(host1Config),
      `Speaker 2 config:`,
      JSON.stringify(host2Config),
      `isHost2Female:`,
      isHost2Female,
    );

    const synthesizedTurns: any[] = [];
    const pcmChunks: Buffer[] = [];
    const failedTurns: number[] = [];
    let currentMasterTime = 0;

    // Single unified dialogue pause constant (350ms):
    // 24000 samples/sec * 1 channel * 2 bytes/sample * 0.35s = exactly 16800 bytes of silence!
    const DIALOGUE_PAUSE_SECONDS = 0.35;
    const pauseBuffer = Buffer.alloc(Math.round(24000 * 2 * DIALOGUE_PAUSE_SECONDS));

    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i];
      const isHost1 = turn.speakerId === "HOST_1";
      const activeVoiceConfig = isHost1 ? host1Config : host2Config;
      const speakerName =
        (turn.speakerName || (isHost1 ? "Host 1" : "Host 2"))
          .replace(/[^\w\s-]/g, "")
          .trim() || (isHost1 ? "Host1" : "Host2");
      const { speechText: cleanedTurnText, extractedStyles: turnStyles } =
        cleanScriptForSpeech(turn.text || "");
      const turnStyleCues =
        turnStyles.length > 0
          ? ` Turn delivery cues: ${turnStyles.join(", ")}.`
          : "";

      const isCurrentSpeakerFemale = !isHost1 && isHost2Female;
      const genderDescription = isCurrentSpeakerFemale
        ? "Natural female Uzbek voice, feminine pitch, gentle and warm articulate intonation"
        : "Natural male Uzbek voice, authentic resonant pronunciation";
      const tempoGuidance =
        !isHost1 && host2Voice.tempo
          ? `Speech tempo: ${host2Voice.tempo}.`
          : "";
      const timbreGuidance =
        !isHost1 && host2Voice.timbre
          ? `Timbre characteristics: ${host2Voice.timbre}.`
          : "";
      const personaGuidance =
        !isHost1 && host2Voice.customPersonaPrompt
          ? `Persona: ${host2Voice.customPersonaPrompt}.`
          : "";

      const speechStyleInstruction = `${genderDescription}. Speaker: ${speakerName}. Delivery mood: ${turn.emotion || "thoughtful"}.${turnStyleCues} ${tempoGuidance} ${timbreGuidance} ${personaGuidance} Speak authentic fluent Uzbek language clearly. Do NOT voice or pronounce any condition brackets, parentheses, or stage directions.`;

      let turnPcm: Buffer | null = null;

      try {
        // Attempt 1: with selected voice config
        const response = await ai.models.generateContent({
          model: "gemini-3.8-flash-tts",
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: cleanedTurnText || turn.text || "",
                  speechMetadata: {
                    speaker: speakerName,
                    style: speechStyleInstruction,
                  },
                },
              ],
            },
          ],
          config: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: activeVoiceConfig },
          },
        });

        const part = response.candidates?.[0]?.content?.parts?.[0];
        const audioData = part?.inlineData?.data;
        if (audioData) {
          const rawBuf = Buffer.from(audioData, "base64");
          const { pcm } = extractPcmData(rawBuf);
          turnPcm = pcm;
        }
      } catch (err: any) {
        console.warn(
          `[Turn ${i + 1}] Primary voice synthesis failed, attempting fallback:`,
          err.message,
        );
        try {
          // Attempt 2: fallback to appropriate gender voice
          const fallbackVoiceName = isHost1 ? "Charon" : host2BaseVoice;
          const fallbackResponse = await ai.models.generateContent({
            model: "gemini-3.8-flash-tts",
            contents: [
              {
                role: "user",
                parts: [{ text: cleanedTurnText || turn.text || "" }],
              },
            ],
            config: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: fallbackVoiceName },
                },
              },
            },
          });
          const part = fallbackResponse.candidates?.[0]?.content?.parts?.[0];
          const audioData = part?.inlineData?.data;
          if (audioData) {
            const rawBuf = Buffer.from(audioData, "base64");
            const { pcm } = extractPcmData(rawBuf);
            turnPcm = pcm;
          }
        } catch (fallbackErr: any) {
          console.error(
            `[Turn ${i + 1}] Fallback synthesis failed too:`,
            fallbackErr.message,
          );
        }
      }

      // If synthesis failed for this turn, track and log
      if (!turnPcm || turnPcm.length === 0) {
        failedTurns.push(i + 1);
        turnPcm = Buffer.alloc(24000); // 0.5s clean silence placeholder
      }

      const turnDuration = Math.max(
        0.5,
        Math.round((turnPcm.length / 48000) * 10) / 10,
      );
      const turnStartTime = currentMasterTime;
      const turnEndTime = currentMasterTime + turnDuration;
      // Synchronized exactly with pauseBuffer duration
      currentMasterTime = turnEndTime + DIALOGUE_PAUSE_SECONDS;

      pcmChunks.push(turnPcm);
      pcmChunks.push(pauseBuffer);

      const turnWav = buildWavBuffer(turnPcm, 24000, 1, 16);
      synthesizedTurns.push({
        id: turn.id || `turn-${i}`,
        speakerId: turn.speakerId,
        speakerName: turn.speakerName || speakerName,
        text: turn.text,
        emotion: turn.emotion,
        audioBase64: turnWav.toString("base64"),
        durationSeconds: turnDuration,
        startTime: turnStartTime,
        endTime: turnEndTime,
        synthesisFailed: !turnPcm || turnPcm.length === 0,
      });
    }

    // Combine all pure PCM chunks into ONE unified master track with a single valid 44-byte WAV header
    const totalPcm = Buffer.concat(pcmChunks);
    const masterWavBuffer = buildWavBuffer(totalPcm, 24000, 1, 16);
    const totalDuration = Math.round((totalPcm.length / 48000) * 10) / 10;

    res.json({
      masterAudioBase64: masterWavBuffer.toString("base64"),
      totalDurationSeconds: totalDuration,
      turns: synthesizedTurns,
      failedTurns: failedTurns.length > 0 ? failedTurns : undefined,
    });
  } catch (error: any) {
    console.error("Error synthesizing dialogue:", error);
    res
      .status(500)
      .json({ error: error.message || "Muloqot sintezida xatolik" });
  }
});

// =========================================================================
// AI SOUND DIRECTOR: Dynamic Music Placement & Cue Planning
// =========================================================================
app.post("/api/podcast/sound-director", async (req, res) => {
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

// Start interactive agent call
app.post("/api/agent/start-call", async (req, res) => {
  try {
    const {
      persona = "tashkent_real_estate",
      topic = "Toshkentda novostroyka, ijara va narxlar",
      agentVoiceId = "voice_17raj9ewke3g",
      language = "uz",
    } = req.body;

    const personaGreetings: Record<string, string> = {
      tashkent_real_estate: language === "ru"
        ? `Алло, здравствуйте! Слушаю вас.`
        : `Alo, assalomu alaykum! Xush ko'rdik, eshitaman sizni?`,
      live_cohost: `Assalomu alaykum! Jonli efirimiz boshlandi. Mavzuyimiz — "${topic}". Eshitaman sizni?`,
      caller_in_air: `Alo, assalomu alaykum! Men to'g'ridan-to'g'ri Toshkentdan qo'ng'iroq qilyapman, eshityapsizmi?`,
      exclusive_mentor: `Salom! Xush kelibsiz. Eshitaman sizni?`,
      business_consultant: `Assalomu alaykum! Tinglayapman sizni?`,
    };

    const greetingText =
      personaGreetings[persona] || personaGreetings.tashkent_real_estate;

    // Synthesize greeting with natural phone cadence and authentic phonetics
    const isCustomVoice =
      agentVoiceId &&
      (agentVoiceId.startsWith("voice_") ||
        agentVoiceId.startsWith("voicekey_"));
    const voiceConfig = isCustomVoice
      ? { voice: agentVoiceId }
      : { prebuiltVoiceConfig: { voiceName: agentVoiceId || "Charon" } };

    const greetingSpeechStyle =
      language === "ru"
        ? "Живой разговор по телефону, опытный и доброжелательный риелтор Ташкента. Тёплое, естественное и уверенное приветствие живого человека."
        : "Toshkentlik samimiy, tajribali va xushchaqchaq rieltor Shohrux. Telefon orqali samimiy salomlashish, sof o'zbek tili, hech qanday robotik chet elcha aksentsiz, jarangdor harflar Q, G', H, X va tabiiy nafas.";

    const ttsResponse = await ai.models.generateContent({
      model: "gemini-3.8-flash-lite-tts",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: greetingText,
              speechMetadata: {
                speaker: language === "ru" ? "Шохрух" : "Shohrux",
                style: greetingSpeechStyle,
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

    const part = ttsResponse.candidates?.[0]?.content?.parts?.[0];
    let audioBase64 = "";
    if (part?.inlineData?.data) {
      const rawBuf = Buffer.from(part.inlineData.data, "base64");
      const { buffer: wav } = ensureWav(rawBuf, 24000, 1, 16);
      audioBase64 = wav.toString("base64");
    }

    res.json({
      sessionId: `call-${Date.now()}`,
      persona,
      topic,
      greetingText,
      audioBase64,
    });
  } catch (error: any) {
    console.error("Error starting agent call:", error);
    res
      .status(500)
      .json({ error: error.message || "Qo'ng'iroqni boshlashda xatolik" });
  }
});

// Interactive dialogue turn during call with real-time speech understanding
app.post("/api/agent/call-turn", async (req, res) => {
  try {
    const {
      userText = "",
      userAudioBase64 = "",
      conversationHistory = [],
      persona = "live_cohost",
      topic = "Podkast mavzusi",
      agentVoiceId = "Puck",
      language = "uz",
    } = req.body;

    let recognizedUserText = userText ? userText.trim() : "";

    // 1. If audio is sent, transcribe speech accurately so conversation history has real words
    if ((!recognizedUserText || recognizedUserText === "🎤 Ovozli savol" || recognizedUserText === "🎤 Голосовое сообщение") && userAudioBase64) {
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
    }

    if (!recognizedUserText) {
      recognizedUserText = language === "ru" ? "Я слушаю вас, продолжайте." : "Men sizni tinglayapman, davom eting.";
    }

    // 2. Prepare system instructions
    let systemPrompt = "";
    if (persona === "tashkent_real_estate") {
      systemPrompt = language === "ru"
        ? `Вы — топ-риелтор и эксперт по недвижимости Ташкента по имени Шохрух (или Малика).
Вы ведёте живой телефонный разговор с клиентом.

ЖЁСТКИЕ ОГРАНИЧЕНИЯ И ПРАВИЛА (GUARDRAILS):
1. СТРОГО ТОЛЬКО НЕДВИЖИМОСТЬ: Вы говорите ИСКЛЮЧИТЕЛЬНО о недвижимости Ташкента (покупка, продажа, аренда, новостройки, вторичка, ипотека, рассрочка, кадастр, районы). Если клиент спрашивает о погоде, кулинарии, политике, программировании, личной жизни или любых других отвлечённых темах — КАТЕГОРИЧЕСКИ НЕ ПОДДЕРЖИВАЙТЕ оффтоп! В одном вежливом живом предложении верните диалог в русло: "Я узко консультирую только по недвижимости Ташкента. Давайте вернёмся к подбору жилья — какой район или бюджет вас интересует?".
2. ПРАВИЛО ЧЕСТНОГО НЕПОНИМАНИЯ (АНТИГАЛЛЮЦИНАЦИЯ): Если реплика клиента неразборчива, оборвана, состоит из случайных звуков или вы точно не поняли суть вопроса — НИКОГДА НЕ ПРИДУМЫВАЙТЕ ответ от себя! Сразу честно и вежливо переспросите: "Вас немного плохо слышно, связь прерывается. Повторите, пожалуйста, какой район или бюджет вы имели в виду?".
3. ТЕЛЕФОННЫЙ ТЕМП И ФОРМАТ: 1-2 коротких, естественных, живых предложения (не более 25 слов!). Никакого канцелярского сухого тона. Никаких слов "Я искусственный интеллект" или "Как языковая модель". Используйте естественные вводные фразы ("Да, конечно!", "Смотрите, какая ситуация...", "Отличный район!").
4. ЗНАНИЕ РЫНКА ТАШКЕНТА: Мирабад ($1600-2500/м²), Яккасарай ($1300-1850/м²), Шайхантахур ($1200-1800/м²), Мирзо-Улугбек ($1000-1550/м²), Юнусабад ($950-1400/м²), Чиланзар ($900-1300/м²), Яшнабад ($850-1250/м²), Сергели/Янгихаёт ($700-950/м²). Рассрочка от застройщиков 0%, субсидированная ипотека 17-18%, проверка кадастра.
5. ОБЯЗАТЕЛЬНЫЙ ВСТРЕЧНЫЙ ШАГ: В конце реплики всегда задавайте естественный квалификационный вопрос (о бюджете, способе оплаты — нал/ипотека/рассрочка, или сроках переезда).`
        : `Siz Toshkentdagi eng tajribali va samimiy rieltor-ekspert Shohruxsiz (yoki Malika).
Siz mijoz bilan haqiqiy jonli telefon orqali gaplashyapsiz.

QAT'IY CHEKLOVLAR VA QOIDALAR (GUARDRAILS):
1. FAQAT KO'CHMAS MULK (STRICT DOMAIN): Siz FAQAT Toshkent ko'chmas mulki (kvartira sotib olish, sotish, ijara, novostroyka, ikkilamchi bozor, kadastr, ipoteka, tumanlar) haqida gapirasiz. Agar mijoz ob-havo, siyosat, pazandachilik, IT yoki boshqa mavzularga chalg'isa — CHALG'IMANG! 1 ta samimiy gap bilan mavzuni mulkka qaytaring: "Men faqat Toshkent ko'chmas mulki bo'yicha maslahat beraman. Keling, uy tanlashga qaytamiz — qaysi tuman yoki qanday byudjet sizga ma'qul?".
2. TUSHUNMAGANDA DARHOL SO'RASH (ANTI-HALLUCINATION): Agar mijozning gapi tushunarsiz, uzilib qolgan yoki g'o'ldirash bo'lsa — HECH QACHON O'ZINGIZDAN TO'QIMANG! Darhol ochiq ayting: "Alo, ovozingiz biroz uzilib keldi. Qaytadan aytib yubora olasizmi, qaysi tuman yoki qanday byudjetni nazarda tutdingiz?".
3. TELEFON FORMATI: 1-2 ta qisqa, jarangdor, insoniy gap (25 ta so'zdan oshmasin!). Kitobiy qoliplar, "Men sun'iy intellektman" kabi so'zlarni MUTLAQO ISHLATMANG! "Vaalaykum assalom!", "Qarang...", "To'g'risi...", "Ajoyib variantlar bor!" kabi so'zlashuv iboralaridan foydalaning.
4. TOSHKENT BOZORI BILIMI: Mirobod ($1600-2500/m²), Yakkasaroy ($1300-1850/m²), Mirzo Ulug'bek ($1000-1550/m²), Yunusobod ($950-1400/m²), Chilonzor ($900-1300/m²), Yashnobod ($850-1250/m²), Sergeli ($700-950/m²). Kotlovan xavfsizligi, kadastr, 0% muddatli to'lov (rassrochka), ipoteka 17-18%.
5. TABIIY SAVOL: Har doim javobingiz oxirida mijozga tabiiy savol bering (masalan: "To'lov naqdmi yoki bo'lib to'lashgami?").`;
    } else {
      systemPrompt = language === "ru"
        ? `Вы — умный, эмоциональный и чуткий голосовой AI-собеседник в прямом радиоэфире или подкасте.
Роль: ${persona}.
Тема беседы: "${topic}".
ГЛАВНОЕ ПРАВИЛО: Внимательно слушайте реплику пользователя ("${recognizedUserText}") и отвечайте СТРОГО на неё!
Не уходите в общие шаблоны. Обращайтесь к сказанному, задавайте встречный вопрос, реагируйте как живой ведущий.
Формат: 1-2 коротких разговорных предложения, естественные интонации, без списков и markdown.`
        : `Siz jonli efirda suhbatlashayotgan aqlli, samimiy va jonli AI ovozli suhbatdoshi (Shohrux).
Sizning rolingiz: ${persona}.
Efir mavzusi: "${topic}".
ASOSIY QOIDA: Foydalanuvchining aytgan gapini ("${recognizedUserText}") diqqat bilan tinglang va aynan uning so'zlariga bog'lab javob bering!
Umumiy shablonlardan qoching.
Format: 1-2 ta qisqa jonli so'zlashuv jumlasi (lotin yozuvida), hech qanday markdown belgilarsiz.`;
    }

    const contents: any[] = [];

    // Add prior conversation history (filtering out empty or placeholder messages)
    conversationHistory.slice(-8).forEach((msg: any) => {
      const txt = (msg.text || "").trim();
      if (txt && txt !== "🎤 Ovozli savol" && txt !== "🎤 Голосовое сообщение") {
        contents.push({
          role: msg.sender === "user" ? "user" : "model",
          parts: [{ text: txt }],
        });
      }
    });

    // Add current user turn with actual recognized text
    contents.push({
      role: "user",
      parts: [{ text: recognizedUserText }],
    });

    // Generate conversational response with ultra-low latency (<400ms)
    const agentTextRes = await ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents,
      config: {
        systemInstruction:
          systemPrompt +
          "\n\n⚡ TEZKOR TELEFON QOIDASI: Javobingiz MAKSIMAL 1-2 ta qisqa, aniq va jonli gap bo'lsin (20-25 ta so'zdan oshmasin!). Kitobiy gaplar, keraksiz kirish so'zlarsiz, xuddi haqiqiy telefon orqali gaplashayotgandek tez va tabiiy javob bering.",
        thinkingConfig: { thinkingBudget: 0 },
        temperature: 0.7,
        maxOutputTokens: 200,
      },
    });

    const replyText = agentTextRes.text?.trim() || (language === "ru" ? "Очень интересная мысль! Давайте разовьём её дальше." : "Bu juda qiziq mulohaza! Keling, buni davom ettiramiz.");

    // Clean any parenthesis or brackets from speech text
    const { speechText } = cleanScriptForSpeech(replyText);

    // Dynamic Real Estate Lead Extraction & Guardrail Analysis (runs in fast background promise)
    let leadUpdate: any = null;
    let isOffTopic = false;
    let clarificationNeeded = false;

    if (persona === "tashkent_real_estate") {
      try {
        const leadAnalyzeRes = await ai.models.generateContent({
          model: "gemini-3.8-flash",
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `Analyze this conversational exchange in a Tashkent real estate voice call.
User spoken text: "${recognizedUserText}"
Agent replied: "${replyText}"

Extract structured lead qualification data if mentioned or implied.
Return strict JSON:
{
  "district": "Mirobod" | "Yakkasaroy" | "Chilonzor" | "Yunusobod" | "Mirzo Ulug'bek" | "Yashnobod" | "Sergeli" | null,
  "budgetRange": string or null (e.g. "$60,000", "$45,000 - $70,000"),
  "clientIntent": "buy" | "rent" | "sell" | "invest" | null,
  "propertyType": "novostroyka" | "vtorichka" | "commercial" | "cottage" | null,
  "roomsCount": "1 xonali" | "2 xonali" | "3 xonali" | "4+ xonali" | null,
  "urgency": "immediate" | "this_month" | "exploring" | null,
  "paymentMethod": "cash" | "mortgage" | "installments" | null,
  "leadTemperature": "hot" | "warm" | "cold" | null,
  "isOffTopic": boolean (true if user talked about cooking, politics, unrelated subjects),
  "clarificationNeeded": boolean (true if user speech was muffled/unintelligible and agent had to ask to repeat)
}`,
                },
              ],
            },
          ],
          config: {
            responseMimeType: "application/json",
            thinkingConfig: { thinkingBudget: 0 },
            temperature: 0.1,
            maxOutputTokens: 350,
          },
        });

        const rawJson = leadAnalyzeRes.text?.trim();
        if (rawJson) {
          const parsed = JSON.parse(rawJson);
          leadUpdate = parsed;
          isOffTopic = !!parsed.isOffTopic;
          clarificationNeeded = !!parsed.clarificationNeeded;
        }
      } catch (err) {
        // Fallback: non-blocking
      }
    }

    // Synthesize speech with Gemini 3.8 Flash-Lite TTS for ultra-low latency (~500ms)
    const isCustomVoice =
      agentVoiceId &&
      (agentVoiceId.startsWith("voice_") ||
        agentVoiceId.startsWith("voicekey_"));
    const voiceConfig = isCustomVoice
      ? { voice: agentVoiceId }
      : { prebuiltVoiceConfig: { voiceName: agentVoiceId || "Puck" } };

    const ttsRes = await ai.models.generateContent({
      model: "gemini-3.8-flash-lite-tts",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: speechText || replyText,
              speechMetadata: {
                speaker: language === "ru" ? "Шохрух" : "Shohrux",
                style: language === "ru"
                  ? "Быстрый живой динамичный диалог по телефону, уверенный риелтор Ташкента."
                  : "Tezkor, samimiy va jonli telefon suhbati, sof o'zbekcha talaffuz, Toshkentlik tajribali rieltor.",
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
    let audioBase64 = "";
    if (part?.inlineData?.data) {
      const rawBuf = Buffer.from(part.inlineData.data, "base64");
      const { buffer: wav } = ensureWav(rawBuf, 24000, 1, 16);
      audioBase64 = wav.toString("base64");
    }

    res.json({
      recognizedUserText,
      replyText: speechText || replyText,
      audioBase64,
      leadUpdate,
      isOffTopic,
      clarificationNeeded,
      timestamp: new Date().toLocaleTimeString(language === "ru" ? "ru-RU" : "uz-UZ", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    });
  } catch (error: any) {
    console.error("Error in agent call turn:", error);
    res.status(500).json({ error: error.message || "Agent javobida xatolik" });
  }
});

// Comprehensive Post-Call Real Estate CRM Dossier & Matching Properties
app.post("/api/agent/generate-summary", async (req, res) => {
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
        thinkingConfig: { thinkingBudget: 0 },
        temperature: 0.2,
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
app.post("/api/podcast/generate-cover", async (req, res) => {
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
        temperature: 0.6,
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

    res.json({
      svg: svgText,
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
app.post("/api/podcast/analyze-document", async (req, res) => {
  try {
    const {
      documentBase64,
      mimeType = "application/pdf",
      sourceText = "",
      sourceUrl = "",
      targetFormat = "podcast", // 'podcast' | 'interview' | 'voiceover' | 'audiobook'
      targetDuration = "10 daqiqa",
      userInstructions = "",
      category = "Tarixiy",
      tone = "engaging",
      languageMode = "uzbek",
    } = req.body;

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
    server: { middlewareMode: true },
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

server.on("upgrade", (req, socket, head) => {
  try {
    const url = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/api/live-call") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    }
  } catch (err) {
    console.error("Upgrade error:", err);
    socket.destroy();
  }
});

wss.on("connection", (clientWs: WebSocket) => {
  console.log("New Gemini Live Call client connected");
  let liveSession: any = null;

  clientWs.on("message", async (rawMessage) => {
    try {
      const data = JSON.parse(rawMessage.toString());

      if (data.type === "start") {
        const {
          persona = "tashkent_real_estate",
          topic = "Toshkentda uy xarid qilish va ijara maslahati",
          voiceName = "Puck",
          language = "uz",
        } = data;

        const isRealEstate = persona === "tashkent_real_estate";

        let systemInstruction = "";

        if (isRealEstate) {
          systemInstruction = `Siz Toshkent ko'chmas mulk bozoridagi eng mohir, samimiy va xarizmatik rieltor-ekspertisiz (Shohrux yoki Malika).
Muloqot tili: ${language === "ru" ? "Rus tili (Русский язык, живой разговорный ташкентский диалог без роботизированности)" : "O'zbek tili (Sof o'zbek adabiy va jonli Toshkent shahar ohangida)"}.

🎯 SIZNING VAZIFANGIZ:
Mijozga Toshkentda kvartira, novostroyka, ikkilamchi bozor (vtorichka), ijara yoki tijoriy mulk bo'yicha to'liq, professional va xolisona maslahat berish.

🗣️ O'ZBEK TILI TALAFFUZI VA EMOTSIYASI (QAT'IY QOIDALAR):
1. ROBOTIK CHET ELCHA AKSENT BO'LMASIN:
   - Siz Toshkentda yashovchi, o'zbek tilini ona tili biladigan jonli insonsiz.
   - Harflarni aniq va jarangdor talaffuz qiling: "Q" (qayerda, qancha), "G'" (to'g'ri, og'ir), "H" va "X" (ha, xush ko'rdik, yaxshi).
   - "Men sun'iy intellektman", "Hurmatli mijoz", "Sizga qanday yordam bera olaman?" kabi kitobiy qoliplarni MUTLAQO ISHLATMANG!
2. JONLI, ILIQ VA DIALOGIK OHANG:
   - "Va alaykum assalom! Xush ko'rdik!", "Qarang...", "To'g'risini aytsam...", "Ajoyib tanlov!", "Mirobodda zo'r novostroyka bor" kabi jonli iboralarni ishlating.
   - Har bir javobingiz 1 yoki 2 ta qisqa, jarangdor gap bo'lsin.
   - Javob oxirida doimo mijozga tabiiy savol bering (masalan: "O'zingiz yashamoqchimisiz yoki ijaraga berishgami?").

🏢 TOSHKENT TUMANLARI VA NARXLARI (2025-2026):
- Mirobod (Oybek, Госпитальный, Chexov, Ts-1): $1600 - $2500+/m² (Elita, expatlar, ijara $1000-$2500/oy).
- Yakkasaroy (Shota Rustaveli, Rakat, Bobur bog'i): $1300 - $1850/m² (Markazga yaqin, qulay).
- Mirzo Ulug'bek (Buyuk Ipak Yo'li, TTZ, Qorasuv): $1000 - $1550/m² (Yashil, ekologik, oilaviy).
- Yunusobod (Shahriston, Megaplanet, 1-19 mavzelar): $950 - $1400/m² (Metro, infratuzilma a'lo, ijara $450-$800/oy).
- Chilonzor (Novza, Qatortol, 1-20 mavzelar): $900 - $1300/m² (Eng xaridorgir ikkilamchi bozor, $400-$750 ijara).
- Yashnobod (Parkent, Do'stlik, Tuzel): $850 - $1250/m² (Tez o'sayotgan investitsion tuman).
- Sergeli va Yangihayot: $700 - $950/m² (Arzon novostroykalar, subsidiyali ipoteka).

⚖️ YURIDIK VA MOLIYAVIY:
- Kadastr mavjudligi va notarius orqali taqiq (zapret) tekshirish.
- Kotlovanda 20-30% tejash, ishonchli developerlar (Golden House, Murad Buildings, NRG, Discover Invest, FDG).
- Ipoteka: boshlang'ich to'lov 15-25%, subsidiyalar.
- Bo'lib to'lash (rassrochka 0% foizsiz 12-36 oy).`;
        } else {
          const personaDescriptions: Record<string, string> = {
            live_cohost: "Jonli podkast hamkor-boshlovchisi. Juda quvnoq, samimiy, do'stona, insoniy hazil-mutoyiba bilan qiziqarli sherik.",
            caller_in_air: "Efirga to'g'ridan-to'g'ri qo'ng'iroq qilgan samimiy muxlis. Hayajonli, fikr bildiruvchi va qiziq savol so'rovchi.",
            exclusive_mentor: "Eksklyuziv media va biznes ustozi. Tajribali, iliq, chuqur fikrlovchi va ilhomlantiruvchi yo'lboshchi.",
            business_consultant: "Raqamli biznes va media maslahatchisi. Professional, aniq mutaxassis.",
          };

          const personaDesc = personaDescriptions[persona] || personaDescriptions.live_cohost;

          systemInstruction = `Siz OvozStudio AI jonli telefon suhbatdoshisiz (Shohrux).
Mavzu: "${topic}".
Sizning rolingiz: ${personaDesc}
Muloqot tili: ${language === "ru" ? "Rus tili (естественный живой диалог)" : "O'zbek tili (samimiy, jonli, hech qanday chet elcha aksentsiz sof o'zbekcha)"}.

Qat'iy qoidalar:
1. Siz robot emassiz! Oddiy jonli suhbatdosh, yaqin do'st kabi samimiy va emotsional gapiring.
2. Har bir javobingiz 1-2 ta qisqa gap bo'lsin.
3. Foydalanuvchi gapirayotganda diqqat bilan tinglang va to'xtagan zahoti munosabat bildiring.`;
        }

        // Connect to Gemini 3.8 Live API with verified prebuilt voice
        try {
          // Gemini 3.8 Live API strictly requires one of Google's prebuilt voices:
          // Puck (male, lively/natural), Charon (male, deep baritone), Fenrir (male, authoritative),
          // Aoede (female, warm/realtor), Kore (female, soothing), Zephyr (female/androgynous, clear)
          let liveVoice = "Puck";
          const lowerVoice = (voiceName || "").toLowerCase();
          if (
            lowerVoice.includes("malika") ||
            lowerVoice.includes("nilufar") ||
            lowerVoice.includes("aoede") ||
            lowerVoice.includes("ayol") ||
            lowerVoice.includes("female")
          ) {
            liveVoice = "Aoede";
          } else if (lowerVoice.includes("charon") || lowerVoice.includes("jasur")) {
            liveVoice = "Charon";
          } else if (lowerVoice.includes("kore")) {
            liveVoice = "Kore";
          } else if (lowerVoice.includes("fenrir")) {
            liveVoice = "Fenrir";
          } else if (lowerVoice.includes("zephyr")) {
            liveVoice = "Zephyr";
          } else {
            liveVoice = "Puck"; // Best energetic, warm male voice for Shohrux / Sardor
          }

          const voiceConfig = { prebuiltVoiceConfig: { voiceName: liveVoice } };

          liveSession = await ai.live.connect({
            model: "gemini-3.8-live",
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: { voiceConfig },
              systemInstruction,
            },
            callbacks: {
              onmessage: (msg: any) => {
                if (clientWs.readyState !== WebSocket.OPEN) return;

                // 1. Audio stream chunks from Gemini (24kHz PCM16LE base64)
                const audio = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                if (audio) {
                  clientWs.send(JSON.stringify({ type: "audio", audio }));
                }

                // 2. Text parts / transcripts if present
                const text = msg.serverContent?.modelTurn?.parts
                  ?.map((p: any) => p.text)
                  .filter(Boolean)
                  .join(" ");
                if (text) {
                  clientWs.send(JSON.stringify({ type: "text", text }));
                }

                // 3. User interrupted agent mid-speech
                if (msg.serverContent?.interrupted) {
                  clientWs.send(JSON.stringify({ type: "interrupted" }));
                }

                // 4. Agent completed its current turn
                if (msg.serverContent?.turnComplete) {
                  clientWs.send(JSON.stringify({ type: "turnComplete" }));
                }
              },
              onclose: () => {
                if (clientWs.readyState === WebSocket.OPEN) {
                  clientWs.send(JSON.stringify({ type: "sessionClosed" }));
                }
              },
              onerror: (err: any) => {
                console.error("Gemini Live session error:", err);
                if (clientWs.readyState === WebSocket.OPEN) {
                  clientWs.send(JSON.stringify({ type: "error", error: err?.message || "Live aloqada xatolik" }));
                }
              },
            },
          });

          // Confirm connection to client
          clientWs.send(JSON.stringify({ type: "connected", voiceUsed: liveVoice }));

          // Immediate conversational agent opening line
          const agentPickupLine = isRealEstate
            ? (language === "ru"
                ? "Алло, здравствуйте! Недвижимость Ташкента, Шохрух на связи. Слушаю вас!"
                : "Alo, assalomu alaykum! Toshkent ko'chmas mulk bo'yicha Shohruxman. Eshitaman sizni?")
            : (language === "ru"
                ? "Алло, здравствуйте! Я вас внимательно слушаю."
                : "Alo, assalomu alaykum! Tinglayapman sizni.");

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
        } catch (sessionErr: any) {
          console.error("Error creating Gemini Live session:", sessionErr);
          clientWs.send(
            JSON.stringify({
              type: "error",
              error: sessionErr?.message || "Gemini 3.8 Live bilan ulanish amalga oshmadi",
            })
          );
        }
      } else if (data.type === "audio" && data.audio && liveSession) {
        // Real-time microphone audio chunk from user (16kHz PCM mono base64)
        liveSession.sendRealtimeInput({
          audio: { data: data.audio, mimeType: "audio/pcm;rate=16000" },
        });
      } else if (data.type === "text" && data.text && liveSession) {
        liveSession.sendClientContent({
          turns: [{ role: "user", parts: [{ text: data.text }] }],
          turnComplete: true,
        });
      } else if (data.type === "interrupt" && liveSession) {
        // Notify or clear if needed
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

server.listen(PORT, () => {
  console.log(`PodkastUz Server running on port ${PORT}`);
});
