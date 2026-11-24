/**
 * Cartoon character voice test (Gemini TTS only + local ffmpeg pitch shift).
 *
 * Run on the server where GEMINI_API_KEY and ffmpeg are available:
 *   npx tsx scripts/test-cartoon-voices.ts
 *
 * Gemini TTS calls: 4 (prebuilt voices) + 1 Voice Design attempt + 1 synth with the
 * designed voice if Google accepts it = at most 6 of the daily 100.
 *
 * Output: data/cartoon-voice-test/*.wav (data/ is gitignored) + report.json
 *
 * Policy note: we do NOT ask for a child's age or try to bypass safety filters.
 * Characters are played the way dubbing studios do it: adult voices with a
 * bright, playful cartoon delivery. If Voice Design rejects the prompt, the
 * rejection is recorded and respected.
 */

import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const MODEL = process.env.DUBBING_TTS_MODEL || "gemini-3.8-flash-tts";
const OUT_DIR = path.resolve(process.cwd(), "data", "cartoon-voice-test");
const SAMPLE_RATE = 24000;

const TEST_LINE =
  "Voy, qarang! Bu yerda katta qizil shar bor! <laugh> Kel, birga o'ynaymiz!";

const CARTOON_STYLE =
  "Bright, playful animated cartoon character voice. High energy, light and bouncy, " +
  "exaggerated expressive intonation, delighted and curious. Native Uzbek pronunciation.";

const PREBUILT_CANDIDATES = [
  { id: "qizcha_quvnoq", label: "Qizcha (quvnoq) — Leda", voice: "Leda" },
  { id: "qizcha_mayin", label: "Qizcha (mayin) — Achird", voice: "Achird" },
  { id: "bola_sho'x", label: "O'g'il bola (sho'x) — Puck", voice: "Puck" },
  { id: "mitti_qahramon", label: "Mitti qahramon — Sadachbia", voice: "Sadachbia" },
];

const VOICE_DESIGN_PROMPT =
  "Adult female voice actress specialized in animated cartoon characters. " +
  "Bright, high, playful and warm timbre, lively and expressive delivery, " +
  "clear native Uzbek (Tashkent) pronunciation.";

const PITCH_STEPS = [2, 3, 4];

type Result = { id: string; label: string; ok: boolean; file?: string; seconds?: number; error?: string };

function wav(pcm: Buffer): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SAMPLE_RATE, 24);
  h.writeUInt32LE(SAMPLE_RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** Strips a RIFF header if the API returned WAV instead of raw PCM. */
function toPcm(buf: Buffer): Buffer {
  if (buf.length > 44 && buf.toString("ascii", 0, 4) === "RIFF") {
    let off = 12;
    while (off < buf.length - 8) {
      const id = buf.toString("ascii", off, off + 4);
      const size = buf.readUInt32LE(off + 4);
      if (id === "data") return buf.subarray(off + 8, off + 8 + size);
      off += 8 + size;
    }
  }
  return buf;
}

async function synth(ai: GoogleGenAI, voiceConfig: any): Promise<Buffer> {
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: "user",
        parts: [{ text: TEST_LINE, speechMetadata: { speaker: "Character", style: CARTOON_STYLE } } as any],
      },
    ],
    config: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig } } as any,
  });
  for (const p of res.candidates?.[0]?.content?.parts || []) {
    if (p.inlineData?.data) return toPcm(Buffer.from(p.inlineData.data, "base64"));
  }
  throw new Error("No audio in response");
}

function save(name: string, pcm: Buffer): string {
  const file = path.join(OUT_DIR, `${name}.wav`);
  fs.writeFileSync(file, wav(pcm));
  return file;
}

function ffmpegHas(filter: string): boolean {
  try {
    return execFileSync("ffmpeg", ["-hide_banner", "-filters"], { encoding: "utf8" }).includes(` ${filter} `);
  } catch {
    return false;
  }
}

/** Pitch up by N semitones keeping duration. Uses rubberband if available, else asetrate+atempo. */
function pitchShift(input: string, semitones: number, useRubberband: boolean): string {
  const out = input.replace(/\.wav$/, `_pitch+${semitones}.wav`);
  const ratio = Math.pow(2, semitones / 12);
  const filter = useRubberband
    ? `rubberband=pitch=${ratio.toFixed(4)}`
    : `asetrate=${Math.round(SAMPLE_RATE * ratio)},aresample=${SAMPLE_RATE},atempo=${(1 / ratio).toFixed(4)}`;
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", input, "-af", filter, out]);
  return out;
}

async function main() {
  const key = (process.env.CUSTOM_GEMINI_API_KEY || process.env.GEMINI_API_KEY || process.env.API_KEY || "").trim();
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const ai = new GoogleGenAI({ apiKey: key });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const results: Result[] = [];
  let ttsCalls = 0;

  // 1. Prebuilt voices with cartoon delivery
  for (const c of PREBUILT_CANDIDATES) {
    try {
      ttsCalls++;
      const pcm = await synth(ai, { prebuiltVoiceConfig: { voiceName: c.voice } });
      results.push({ id: c.id, label: c.label, ok: true, file: save(c.id, pcm), seconds: pcm.length / (SAMPLE_RATE * 2) });
    } catch (e: any) {
      results.push({ id: c.id, label: c.label, ok: false, error: String(e?.message || e).slice(0, 300) });
    }
    await new Promise((r) => setTimeout(r, 7000)); // stay under 10 RPM
  }

  // 2. Voice Design: adult cartoon voice actress (no child age requested)
  let designedVoiceId: string | null = null;
  const design: any = { prompt: VOICE_DESIGN_PROMPT };
  try {
    const v: any = await (ai as any).voices.create({
      store: true,
      voice: {
        type: "prompted",
        display_name: "Cartoon voice actress (test)",
        model: MODEL,
        gender: "female",
        language_code: "uz-UZ",
        prompted: { input: VOICE_DESIGN_PROMPT },
      },
    });
    designedVoiceId = v?.id || v?.name || null;
    design.accepted = Boolean(designedVoiceId);
    design.voiceId = designedVoiceId;
  } catch (e: any) {
    design.accepted = false;
    design.error = String(e?.message || e).slice(0, 300);
  }

  if (designedVoiceId) {
    try {
      ttsCalls++;
      const pcm = await synth(ai, { voice: designedVoiceId });
      results.push({ id: "voice_design_actress", label: `Voice Design — ${designedVoiceId}`, ok: true, file: save("voice_design_actress", pcm), seconds: pcm.length / (SAMPLE_RATE * 2) });
    } catch (e: any) {
      results.push({ id: "voice_design_actress", label: "Voice Design", ok: false, error: String(e?.message || e).slice(0, 300) });
    }
  }

  // 3. Local pitch shift (0 Gemini calls)
  const rubberband = ffmpegHas("rubberband");
  const pitched: string[] = [];
  for (const r of results.filter((x) => x.ok && x.file)) {
    for (const st of PITCH_STEPS) {
      try {
        pitched.push(pitchShift(r.file!, st, rubberband));
      } catch (e: any) {
        pitched.push(`FAILED ${r.id} +${st}: ${String(e?.message || e).slice(0, 120)}`);
      }
    }
  }

  const report = { model: MODEL, testLine: TEST_LINE, ttsCalls, rubberband, results, voiceDesign: design, pitched };
  fs.writeFileSync(path.join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
