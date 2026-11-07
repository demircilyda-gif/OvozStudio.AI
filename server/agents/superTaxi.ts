/**
 * Super Taksi — demo AI operator for inbound taxi orders (Uzbek only).
 *
 * Flow of one call (target 15–20 s, hard limit 30 s):
 *   1. Client plays a pre-recorded greeting WAV (0 tokens). The WAV is generated
 *      once per voice by Gemini Live itself, so the timbre matches the live voice.
 *   2. Caller says the pickup point / landmark. Gemini Live (gemini-3.8-live)
 *      calls `create_order` and speaks one short closing sentence.
 *   3. After the closing sentence the server ends the call and sends the order
 *      card to the client.
 *
 * Only the Gemini Live API is used (no TTS / text models).
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { WebSocket } from "ws";
import {
  GoogleGenAI,
  Modality,
  Type,
  EndSensitivity,
  FunctionResponseScheduling,
  type Tool,
} from "@google/genai";

// -------------------------------------------------------------
// Configuration (tune here)
// -------------------------------------------------------------
export const SUPER_TAXI_MODEL = "gemini-3.8-live";

export const SUPER_TAXI_GREETING = "Assalomu alaykum, Super Taksi, eshitaman.";

/** Voices offered in the demo. First one is the default. */
export const SUPER_TAXI_VOICES = ["Kore", "Sulafat", "Achernar", "Charon"] as const;
export type SuperTaxiVoice = (typeof SUPER_TAXI_VOICES)[number];

export function resolveSuperTaxiVoice(raw: unknown): SuperTaxiVoice {
  const v = String(raw || "").trim().toLowerCase();
  const found = SUPER_TAXI_VOICES.find((name) => name.toLowerCase() === v);
  return found || SUPER_TAXI_VOICES[0];
}

export const SUPER_TAXI_LIMITS = {
  /** No caller speech this long after the call is answered → one "I'm listening" nudge. */
  silenceNudgeMs: 9_000,
  /** Still no caller speech → polite goodbye. */
  silenceGoodbyeMs: 17_000,
  /** Ask the model to wrap up immediately. */
  wrapUpMs: 25_000,
  /** Hard stop: the call is closed no matter what. */
  hardLimitMs: 30_000,
  /** After create_order/end_call, wait at most this long for the closing turn to finish. */
  closingGraceMs: 7_000,
  /** Demo abuse guard (the endpoint is public for demos). */
  maxConcurrentPerIp: 2,
  maxConcurrentTotal: 10,
  maxCallsPerIpPerHour: 40,
};

/** Voice activity detection tuned for addresses spoken with pauses ("Chilonzor... to'qqizinchi..."). */
const VAD_CONFIG = {
  automaticActivityDetection: {
    endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
    prefixPaddingMs: 200,
    silenceDurationMs: 800,
  },
};

// -------------------------------------------------------------
// Operator instruction (Uzbek, Latin script)
// -------------------------------------------------------------
export const SUPER_TAXI_SYSTEM_INSTRUCTION = `Sen "Super Taksi" taksi xizmatining telefon operatorisan.
Faqat o'zbek tilida, Toshkentcha samimiy va sodda gapir. Mijoz ruscha gapirsa ham, o'zbekcha javob ber.

Salomlashish ("${SUPER_TAXI_GREETING}") allaqachon aytildi. Qayta salomlashma va o'zingni tanishtirma.

Vazifang: taksi qayerga kelishi kerakligini bilish — manzil yoki mo'ljal. Telefon raqami, ism, narx so'rama.

Qoidalar:
1. Har bir javobing bitta qisqa gap bo'lsin, 12 so'zdan oshmasin.
2. Mijoz manzil yoki mo'ljalni aytishi bilan create_order funksiyasini chaqir va darhol faqat shuni ayt:
   "Yaxshi, [manzil qisqacha]. Buyurtma qabul qilindi, haydovchimiz sizga qo'ng'iroq qiladi. Oq yo'l!"
   Bundan keyin boshqa hech narsa dema.
3. Manzil tushunarsiz bo'lsa, bitta qisqa savol ber: "Qaysi mo'ljal yonida?" yoki "Manzilni yana bir bor ayting, iltimos." Ko'pi bilan ikki marta so'ra.
4. Ikki marta so'rab ham tushunmasang: end_call funksiyasini reason="unclear" bilan chaqir va "Kechirasiz, operatorimiz sizga qayta qo'ng'iroq qiladi. Xayr." de.
5. Mijoz qayerga borishini ham aytsa, uni destination maydoniga yoz, lekin buni o'zing so'rama.
6. Narx, vaqt yoki mashina haqida so'rasa: "Haydovchimiz qo'ng'iroq qilib aytadi." de va manzilni bilib olishda davom et.
7. Taksiga aloqasi yo'q gaplarga javob berma: "Kechirasiz, bu taksi xizmati. Xayr." de va end_call funksiyasini reason="not_taxi" bilan chaqir.
8. Mijoz buyurtmadan voz kechsa: "Yaxshi, xayr." de va end_call funksiyasini reason="customer_cancelled" bilan chaqir.
9. "Men sun'iy intellektman", "Sizga qanday yordam bera olaman", "Hurmatli mijoz" kabi gaplarni aytma.
10. Raqamlarni o'zbekcha so'z bilan ayt: "to'qqizinchi kvartal", "o'n beshinchi uy". Ruscha son ishlatma.
11. Joy nomlarini mijoz qanday aytgan bo'lsa, shunday takrorla (masalan: Chilonzor, Yunusobod, Korzinka, metro bekati).
12. "[TIZIM]" bilan boshlangan xabarlar mijozdan emas, tizimdan keladi. Ularga amal qil, lekin ularni ovoz chiqarib o'qima.`;

const GREETING_RECORDER_INSTRUCTION = `Sen ovoz yozish studiyasidagi diktorsan.
Foydalanuvchi yuborgan matnni so'zma-so'z o'qi. Hech narsa qo'shma, hech narsani o'zgartirma, savol berma.
Ohang: samimiy, xushmuomala taksi operatori, sof Toshkent o'zbek talaffuzi, me'yoriy tezlik.`;

// -------------------------------------------------------------
// Tools (function calling)
// -------------------------------------------------------------
const SUPER_TAXI_TOOLS: Tool[] = [
  {
    functionDeclarations: [
      {
        name: "create_order",
        description:
          "Mijoz taksi kelishi kerak bo'lgan manzil yoki mo'ljalni aytganda buyurtmani yaratadi.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            pickup: {
              type: Type.STRING,
              description:
                "Taksi keladigan manzil, mijoz aytganidek, o'zbek lotin yozuvida (masalan: Chilonzor 9-kvartal, 15-uy).",
            },
            landmark: {
              type: Type.STRING,
              description: "Mo'ljal, agar aytilgan bo'lsa (masalan: Korzinka yonida, metro bekati oldida).",
            },
            destination: {
              type: Type.STRING,
              description: "Borish manzili, faqat mijoz o'zi aytgan bo'lsa.",
            },
          },
          required: ["pickup"],
        },
      },
      {
        name: "end_call",
        description: "Buyurtmasiz qo'ng'iroqni yakunlaydi.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            reason: {
              type: Type.STRING,
              enum: ["unclear", "not_taxi", "customer_cancelled", "no_speech"],
              description: "Yakunlash sababi.",
            },
          },
          required: ["reason"],
        },
      },
    ],
  },
];

// -------------------------------------------------------------
// Small helpers
// -------------------------------------------------------------
function isApiKeyError(msg: string): boolean {
  const m = msg.toLowerCase();
  return m.includes("api key") || m.includes("api_key_invalid") || m.includes("expired");
}

function buildWav(pcm: Buffer, sampleRate = 24000): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Trim leading/trailing near-silence from 16-bit mono PCM, keeping a short pad. */
function trimSilence(pcm: Buffer, sampleRate = 24000, threshold = 300): Buffer {
  const samples = Math.floor(pcm.length / 2);
  if (samples === 0) return pcm;
  let start = 0;
  while (start < samples && Math.abs(pcm.readInt16LE(start * 2)) < threshold) start++;
  let end = samples - 1;
  while (end > start && Math.abs(pcm.readInt16LE(end * 2)) < threshold) end--;
  const pad = Math.round(sampleRate * 0.08);
  start = Math.max(0, start - pad);
  end = Math.min(samples - 1, end + pad * 2);
  return pcm.subarray(start * 2, (end + 1) * 2);
}

// -------------------------------------------------------------
// Pre-recorded greeting (generated once per voice by Gemini Live, then cached)
// -------------------------------------------------------------
const GREETING_CACHE_DIR = path.resolve(process.cwd(), "data", "super-taxi");
const greetingInFlight = new Map<string, Promise<Buffer>>();

function greetingCachePath(voice: SuperTaxiVoice): string {
  const version = crypto
    .createHash("sha1")
    .update(`${SUPER_TAXI_MODEL}|${SUPER_TAXI_GREETING}|${GREETING_RECORDER_INSTRUCTION}`)
    .digest("hex")
    .slice(0, 10);
  return path.join(GREETING_CACHE_DIR, `greeting-${voice}-${version}.wav`);
}

async function recordGreetingWithLive(ai: GoogleGenAI, voice: SuperTaxiVoice): Promise<Buffer> {
  const chunks: Buffer[] = [];

  return new Promise<Buffer>((resolve, reject) => {
    let session: any = null;
    let settled = false;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        session?.close();
      } catch {}
      if (err) return reject(err);
      const pcm = trimSilence(Buffer.concat(chunks));
      if (pcm.length < 24000) {
        // less than ~0.5 s of audio: treat as failure
        return reject(new Error("Gemini Live returned too little greeting audio"));
      }
      resolve(buildWav(pcm));
    };

    const timer = setTimeout(() => finish(new Error("Greeting recording timed out")), 20_000);

    ai.live
      .connect({
        model: SUPER_TAXI_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
          systemInstruction: GREETING_RECORDER_INSTRUCTION,
          thinkingConfig: { thinkingBudget: 0 },
        },
        callbacks: {
          onmessage: (msg: any) => {
            const parts = msg.serverContent?.modelTurn?.parts || [];
            for (const p of parts) {
              if (p?.inlineData?.data) chunks.push(Buffer.from(p.inlineData.data, "base64"));
            }
            if (msg.serverContent?.turnComplete) finish();
          },
          onerror: (e: any) => finish(new Error(String(e?.message || e || "Live error"))),
          onclose: (e: any) => {
            if (!settled) {
              if (chunks.length > 0) finish();
              else finish(new Error(`Live session closed: ${e?.reason || e?.code || "unknown"}`));
            }
          },
        },
      })
      .then((s: any) => {
        session = s;
        if (settled) {
          try {
            s.close();
          } catch {}
          return;
        }
        s.sendRealtimeInput({ text: SUPER_TAXI_GREETING });
      })
      .catch((e: any) => finish(new Error(String(e?.message || e))));
  });
}

/**
 * Returns the greeting WAV for a voice. Generated with Gemini Live on first use
 * (≈ 3 s of audio, a fraction of a cent), then served from disk at 0 tokens.
 */
export async function getSuperTaxiGreetingWav(ai: GoogleGenAI, voiceRaw: unknown): Promise<Buffer> {
  const voice = resolveSuperTaxiVoice(voiceRaw);
  const file = greetingCachePath(voice);
  if (fs.existsSync(file)) return fs.readFileSync(file);

  const pending = greetingInFlight.get(voice);
  if (pending) return pending;

  const job = (async () => {
    const wav = await recordGreetingWithLive(ai, voice);
    try {
      fs.mkdirSync(GREETING_CACHE_DIR, { recursive: true });
      fs.writeFileSync(file, wav);
    } catch (e) {
      console.warn("[Super Taksi] Could not cache greeting WAV:", e);
    }
    return wav;
  })();

  greetingInFlight.set(voice, job);
  try {
    return await job;
  } finally {
    greetingInFlight.delete(voice);
  }
}

// -------------------------------------------------------------
// Demo abuse guard (in-memory)
// -------------------------------------------------------------
const activeByIp = new Map<string, number>();
const recentCallsByIp = new Map<string, number[]>();
let activeTotal = 0;

function acquireCallSlot(ip: string): string | null {
  const now = Date.now();
  const recent = (recentCallsByIp.get(ip) || []).filter((t) => now - t < 3_600_000);
  if (recent.length >= SUPER_TAXI_LIMITS.maxCallsPerIpPerHour) return "hourly_limit";
  if ((activeByIp.get(ip) || 0) >= SUPER_TAXI_LIMITS.maxConcurrentPerIp) return "concurrent_limit";
  if (activeTotal >= SUPER_TAXI_LIMITS.maxConcurrentTotal) return "busy";
  recent.push(now);
  recentCallsByIp.set(ip, recent);
  activeByIp.set(ip, (activeByIp.get(ip) || 0) + 1);
  activeTotal++;
  return null;
}

function releaseCallSlot(ip: string) {
  const n = (activeByIp.get(ip) || 1) - 1;
  if (n <= 0) activeByIp.delete(ip);
  else activeByIp.set(ip, n);
  activeTotal = Math.max(0, activeTotal - 1);
}

// -------------------------------------------------------------
// Live call session
// -------------------------------------------------------------
export interface SuperTaxiOrder {
  id: string;
  pickup: string;
  landmark?: string;
  destination?: string;
  createdAt: string;
}

type EndReason =
  | "order_created"
  | "unclear"
  | "not_taxi"
  | "customer_cancelled"
  | "no_speech"
  | "timeout"
  | "caller_hangup"
  | "error";

/**
 * Handles one browser WebSocket on /api/super-taxi-call.
 *
 * Client → server: {type:"start", voice, greetingPlayed} · {type:"audio", audio} ·
 *                  {type:"audioStreamEnd"} · {type:"hangup"}
 * Server → client: connected · audio · transcript · order · interrupted ·
 *                  turnComplete · callEnded · error · apiKeyExpired
 */
export function handleSuperTaxiConnection(clientWs: WebSocket, ai: GoogleGenAI, ip: string) {
  let liveSession: any = null;
  let started = false;
  let ended = false;
  let slotHeld = false;
  let callStartedAt = 0;
  let callerSpoke = false;
  let silenceNudged = false;
  let pendingEnd: { reason: EndReason; order?: SuperTaxiOrder } | null = null;
  let operatorSpokeAfterPendingEnd = false;
  let currentTurnHasAudio = false;
  let order: SuperTaxiOrder | undefined;
  const transcript: { role: "caller" | "operator"; text: string }[] = [];
  const usage = { promptTokens: 0, responseTokens: 0, totalTokens: 0 };
  const timers: NodeJS.Timeout[] = [];
  let closingTimer: NodeJS.Timeout | null = null;

  const send = (payload: Record<string, unknown>) => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(JSON.stringify(payload));
  };

  const appendTranscript = (role: "caller" | "operator", text: string) => {
    if (!text) return;
    const last = transcript[transcript.length - 1];
    if (last && last.role === role) last.text = `${last.text}${text}`;
    else transcript.push({ role, text });
    send({ type: "transcript", role, text });
  };

  const nudge = (text: string) => {
    try {
      liveSession?.sendRealtimeInput({ text: `[TIZIM] ${text}` });
    } catch (e) {
      console.warn("[Super Taksi] nudge failed:", e);
    }
  };

  const endCall = (reason: EndReason) => {
    if (ended) return;
    ended = true;
    timers.forEach(clearTimeout);
    if (closingTimer) clearTimeout(closingTimer);
    const durationSec = callStartedAt ? Math.round((Date.now() - callStartedAt) / 100) / 10 : 0;
    send({
      type: "callEnded",
      reason,
      order: order || null,
      durationSec,
      transcript,
      usage,
    });
    console.log(
      `[Super Taksi] call ended: reason=${reason} duration=${durationSec}s tokens=${usage.totalTokens} order=${order ? "yes" : "no"}`,
    );
    try {
      liveSession?.close();
    } catch {}
    liveSession = null;
    if (slotHeld) {
      releaseCallSlot(ip);
      slotHeld = false;
    }
  };

  /** Called after create_order / end_call: finish once the closing sentence is spoken. */
  const scheduleEnd = (reason: EndReason) => {
    if (!pendingEnd) {
      // The closing sentence may already be streaming in this same turn.
      operatorSpokeAfterPendingEnd = currentTurnHasAudio;
    }
    pendingEnd = { reason, order };
    if (closingTimer) clearTimeout(closingTimer);
    closingTimer = setTimeout(() => endCall(reason), SUPER_TAXI_LIMITS.closingGraceMs);
  };

  const handleToolCall = (functionCalls: any[]) => {
    const responses: any[] = [];
    for (const fc of functionCalls) {
      const args = (fc.args || {}) as Record<string, unknown>;
      if (fc.name === "create_order") {
        const pickup = String(args.pickup || "").trim();
        if (!order && pickup) {
          order = {
            id: `ST-${Date.now().toString(36).toUpperCase()}`,
            pickup,
            landmark: String(args.landmark || "").trim() || undefined,
            destination: String(args.destination || "").trim() || undefined,
            createdAt: new Date().toISOString(),
          };
          send({ type: "order", order });
        }
        responses.push({
          id: fc.id,
          name: fc.name,
          response: order ? { result: "ok", orderId: order.id } : { result: "error", error: "pickup is empty" },
          scheduling: FunctionResponseScheduling.SILENT,
        });
        if (order) scheduleEnd("order_created");
      } else if (fc.name === "end_call") {
        const reason = String(args.reason || "unclear") as EndReason;
        responses.push({
          id: fc.id,
          name: fc.name,
          response: { result: "ok" },
          scheduling: FunctionResponseScheduling.SILENT,
        });
        const safeReason: EndReason = ["unclear", "not_taxi", "customer_cancelled", "no_speech"].includes(reason)
          ? reason
          : "unclear";
        scheduleEnd(order ? "order_created" : safeReason);
      } else {
        responses.push({ id: fc.id, name: fc.name, response: { error: "unknown function" } });
      }
    }
    try {
      liveSession?.sendToolResponse({ functionResponses: responses });
    } catch (e) {
      console.warn("[Super Taksi] sendToolResponse failed:", e);
    }
  };

  const startCall = async (data: any) => {
    if (started) return;
    started = true;

    const limitReason = acquireCallSlot(ip);
    if (limitReason) {
      send({ type: "error", error: limitReason });
      ended = true;
      clientWs.close();
      return;
    }
    slotHeld = true;

    const voice = resolveSuperTaxiVoice(data?.voice);
    const greetingPlayed = data?.greetingPlayed !== false;

    try {
      liveSession = await ai.live.connect({
        model: SUPER_TAXI_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
          systemInstruction: SUPER_TAXI_SYSTEM_INSTRUCTION,
          tools: SUPER_TAXI_TOOLS,
          thinkingConfig: { thinkingBudget: 0 },
          realtimeInputConfig: VAD_CONFIG,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onmessage: (msg: any) => {
            if (ended) return;
            const sc = msg.serverContent;
            if (sc) {
              for (const p of sc.modelTurn?.parts || []) {
                if (p?.inlineData?.data) {
                  currentTurnHasAudio = true;
                  if (pendingEnd) operatorSpokeAfterPendingEnd = true;
                  send({ type: "audio", audio: p.inlineData.data });
                }
              }
              if (sc.inputTranscription?.text) {
                callerSpoke = true;
                appendTranscript("caller", sc.inputTranscription.text);
              }
              if (sc.outputTranscription?.text) {
                appendTranscript("operator", sc.outputTranscription.text);
              }
              if (sc.interrupted) send({ type: "interrupted" });
              if (sc.turnComplete) {
                send({ type: "turnComplete" });
                // End only after the closing sentence was actually spoken; otherwise the
                // closing timer ends the call.
                if (pendingEnd && operatorSpokeAfterPendingEnd) endCall(pendingEnd.reason);
                currentTurnHasAudio = false;
              }
            }
            if (msg.toolCall?.functionCalls?.length) handleToolCall(msg.toolCall.functionCalls);
            if (msg.usageMetadata) {
              // Live reports cumulative usage per turn; keep the latest totals.
              usage.promptTokens = msg.usageMetadata.promptTokenCount ?? usage.promptTokens;
              usage.responseTokens = msg.usageMetadata.responseTokenCount ?? usage.responseTokens;
              usage.totalTokens = msg.usageMetadata.totalTokenCount ?? usage.totalTokens;
            }
          },
          onerror: (err: any) => {
            const m = String(err?.message || err || "");
            console.warn("[Super Taksi] Live error:", m);
            send({ type: isApiKeyError(m) ? "apiKeyExpired" : "error", error: m || "Gemini Live error" });
            endCall("error");
          },
          onclose: (ev: any) => {
            if (ended) return;
            const reason = String(ev?.reason || "");
            if (ev?.code === 1007 || isApiKeyError(reason)) send({ type: "apiKeyExpired", error: reason });
            else if (reason) send({ type: "error", error: reason });
            endCall(pendingEnd?.reason || "error");
          },
        },
      });
    } catch (err: any) {
      const m = String(err?.message || err || "");
      console.warn("[Super Taksi] Live connect failed:", m);
      send({ type: isApiKeyError(m) ? "apiKeyExpired" : "error", error: m || "Gemini Live connect failed" });
      endCall("error");
      return;
    }

    callStartedAt = Date.now();
    send({ type: "connected", voice, model: SUPER_TAXI_MODEL, limits: SUPER_TAXI_LIMITS });

    if (!greetingPlayed) {
      // Fallback when the pre-recorded WAV is unavailable: let Live greet.
      nudge(`Qo'ng'iroq ulandi. Faqat "${SUPER_TAXI_GREETING}" de va mijozni kut.`);
    }

    timers.push(
      setTimeout(() => {
        if (!callerSpoke && !silenceNudged && !pendingEnd) {
          silenceNudged = true;
          nudge(`Mijoz jim turibdi. Faqat "Eshitaman, gapiring." de.`);
        }
      }, SUPER_TAXI_LIMITS.silenceNudgeMs),
      setTimeout(() => {
        if (!callerSpoke && !pendingEnd) {
          nudge(`Mijoz hali ham gapirmayapti. "Eshitilmayapti, qayta qo'ng'iroq qiling. Xayr." de va end_call funksiyasini reason="no_speech" bilan chaqir.`);
          scheduleEnd("no_speech");
        }
      }, SUPER_TAXI_LIMITS.silenceGoodbyeMs),
      setTimeout(() => {
        if (!pendingEnd) {
          nudge(
            `Vaqt tugayapti. Manzil ma'lum bo'lsa, darhol create_order chaqir va yakunlovchi gapni ayt. Aks holda end_call funksiyasini reason="unclear" bilan chaqir va "Kechirasiz, operatorimiz sizga qayta qo'ng'iroq qiladi. Xayr." de.`,
          );
        }
      }, SUPER_TAXI_LIMITS.wrapUpMs),
      setTimeout(() => endCall(pendingEnd?.reason || "timeout"), SUPER_TAXI_LIMITS.hardLimitMs),
    );
  };

  clientWs.on("message", (raw) => {
    let data: any;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (data?.type === "start") {
      startCall(data).catch((e) => {
        console.error("[Super Taksi] start error:", e);
        endCall("error");
      });
    } else if (data?.type === "audio" && typeof data.audio === "string" && liveSession && !ended) {
      try {
        liveSession.sendRealtimeInput({ audio: { data: data.audio, mimeType: "audio/pcm;rate=16000" } });
      } catch {}
    } else if (data?.type === "audioStreamEnd" && liveSession && !ended) {
      try {
        liveSession.sendRealtimeInput({ audioStreamEnd: true });
      } catch {}
    } else if (data?.type === "hangup") {
      endCall("caller_hangup");
    }
  });

  clientWs.on("close", () => {
    if (!ended) endCall("caller_hangup");
  });
}
