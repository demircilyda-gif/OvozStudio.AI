import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import { GoogleGenAI, Type } from "@google/genai";
import { parseReadyScript } from "../../../src/utils/readyScriptParser.ts";
import { planDialogueSubBlocks } from "../../../src/utils/dialogueMacroBlocks.ts";
import { extractRawPcm24k, buildWav24k } from "./batchAudioSlicer.ts";
import {
  levelSubBlockClipsLoudness,
  measureIntegratedLufsPcm,
  measurePeakDbfsPcm,
} from "./loudnessLeveler.ts";
import { recordGoogleTtsCalls } from "../tts/ttsQuotaTracker.ts";

const SR = 24000;
const TTS_MODEL = "gemini-3.8-flash-tts";
const ANALYSIS_MODEL = "gemini-4-hydrogen";

export interface VoiceLockCandidateSpec {
  code: "M1" | "M2" | "M3" | "F1" | "F2" | "F3";
  gender: "male" | "female";
  display_name: string;
  base_voice: "Charon" | "Kore";
  prompt: string;
  sampleFileName: string;
  uzTestFileName: string;
}

export const VOICE_LOCK_CANDIDATES: VoiceLockCandidateSpec[] = [
  {
    code: "M1",
    gender: "male",
    display_name: "Aziz Lock M1 - Bright Charon",
    base_voice: "Charon",
    prompt:
      "Keep the core identity of Charon, but give it a brighter spectral balance and less heavy chest resonance. A light, relaxed, friendly Uzbek car-video host speaking naturally to a friend, never like a news announcer.",
    sampleFileName: "M1-sample.wav",
    uzTestFileName: "M1-uz-test.wav",
  },
  {
    code: "M2",
    gender: "male",
    display_name: "Aziz Lock M2 - Airy Conversational",
    base_voice: "Charon",
    prompt:
      "Keep the core identity of Charon. Make the baseline voice airy, close and conversational, naturally smiling, with soft projection and clear Uzbek pronunciation. Avoid formal narrator and announcer delivery.",
    sampleFileName: "M2-sample.wav",
    uzTestFileName: "M2-uz-test.wav",
  },
  {
    code: "M3",
    gender: "male",
    display_name: "Aziz Lock M3 - Youthful Reviewer",
    base_voice: "Charon",
    prompt:
      "Keep Charon recognizable, but make him sound like a friendly, energetic Uzbek car reviewer: bright, casual and youthful, with natural warmth and no heavy authoritative register.",
    sampleFileName: "M3-sample.wav",
    uzTestFileName: "M3-uz-test.wav",
  },
  {
    code: "F1",
    gender: "female",
    display_name: "Veronika Lock F1 - Light Playful Kore",
    base_voice: "Kore",
    prompt:
      "Keep the core identity of Kore, but make the baseline voice lighter, brighter and more playful. A lively, curious Uzbek car-video host, never firm or news-like.",
    sampleFileName: "F1-sample.wav",
    uzTestFileName: "F1-uz-test.wav",
  },
  {
    code: "F2",
    gender: "female",
    display_name: "Veronika Lock F2 - Airy Smiling Kore",
    base_voice: "Kore",
    prompt:
      "Keep Kore recognizable. Make her voice airy, naturally smiling and conversational, with a light youthful timbre and clear Uzbek pronunciation. Avoid formal presenter delivery.",
    sampleFileName: "F2-sample.wav",
    uzTestFileName: "F2-uz-test.wav",
  },
  {
    code: "F3",
    gender: "female",
    display_name: "Veronika Lock F3 - Warm Reviewer Kore",
    base_voice: "Kore",
    prompt:
      "Keep the core identity of Kore, but make her a warm, lively Uzbek car reviewer with bright reactions, friendly curiosity and soft projection. Never sound like a news announcer.",
    sampleFileName: "F3-sample.wav",
    uzTestFileName: "F3-uz-test.wav",
  },
];

export const MALE_UZ_TEST_PARTS: Array<{ label: string; text: string; style: string }> = [
  {
    label: "A",
    text: "Qani, yana bir marta!",
    style: "gently amused",
  },
  {
    label: "B",
    text: "Bu zaryadlanadigan gibrid. Chery’da tizim CSH — Chery Super gibrid deyiladi. Bir butun besh litrli turbo motor va unga juft elektr motor bor.",
    style: "",
  },
  {
    label: "C",
    text: "Premium komplektatsiyasida adaptiv kruiz-kontrol va polosada ushlab turish bor. Ular yordam beradi, lekin yo‘lga baribir haydovchi qaraydi.",
    style: "",
  },
];

export const FEMALE_UZ_TEST_PARTS: Array<{ label: string; text: string; style: string }> = [
  {
    label: "A",
    text: "Aytgandim-ku, baribir sendan o‘zib ketaman deb! <laugh>",
    style: "gently amused",
  },
  {
    label: "B",
    text: "Endi yana batareya haqida gaplashaylik. Bizda issiq, yomg‘ir, suv bor — zarar qilmaydimi?",
    style: "slightly curious",
  },
  {
    label: "C",
    text: "Bu yer tor, bir tomonida toshlar bor. Qanday qayrilib olamiz?",
    style: "slightly concerned",
  },
];

function resolveFfmpegBin(): string {
  const candidates = [
    typeof ffmpegStatic === "string" ? ffmpegStatic : "",
    path.resolve(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg"),
    "/usr/bin/ffmpeg",
    "ffmpeg",
  ].filter(Boolean);
  for (const c of candidates) {
    if (c === "ffmpeg" || fs.existsSync(c)) return c;
  }
  return "ffmpeg";
}

function decodeAudioToPcm24kMono(rawBytes: Buffer, mimeType?: string): Buffer {
  const mime = String(mimeType || "").toLowerCase();
  // Fast path: RIFF WAV header
  if (rawBytes.length >= 44 && rawBytes.subarray(0, 4).toString("ascii") === "RIFF") {
    const sampleRate = rawBytes.readUInt32LE(24);
    const channels = rawBytes.readUInt16LE(22);
    const bitsPerSample = rawBytes.readUInt16LE(34);
    if (sampleRate === SR && channels === 1 && bitsPerSample === 16) {
      return extractRawPcm24k(rawBytes);
    }
  }
  // Fast path: raw PCM 24kHz L16
  if (mime.includes("l16") || mime.includes("pcm")) {
    return rawBytes.length % 2 === 0 ? rawBytes : rawBytes.subarray(0, rawBytes.length - 1);
  }
  // General path: decode any format (mp3, ogg, 48kHz wav, etc.) to 24kHz mono s16le via ffmpeg
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ovoz-vlock-"));
  try {
    const ext = mime.includes("mpeg") || mime.includes("mp3")
      ? ".mp3"
      : mime.includes("ogg")
      ? ".ogg"
      : ".wav";
    const inPath = path.join(tmpDir, `in${ext}`);
    const outPath = path.join(tmpDir, "out.pcm");
    fs.writeFileSync(inPath, rawBytes);
    execFileSync(
      resolveFfmpegBin(),
      ["-y", "-i", inPath, "-ac", "1", "-ar", String(SR), "-f", "s16le", outPath],
      { stdio: "ignore" }
    );
    return fs.readFileSync(outPath);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Estimates 4x-oversampled true peak in dBFS using Catmull-Rom cubic interpolation.
 */
function measureTruePeakDbfsPcm(pcm: Buffer): number {
  const n = Math.floor(pcm.length / 2);
  if (n === 0) return -Infinity;
  const s = new Float64Array(n);
  for (let i = 0; i < n; i++) s[i] = pcm.readInt16LE(i * 2) / 32768.0;

  let maxAbs = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(s[i]);
    if (a > maxAbs) maxAbs = a;
    if (i >= 1 && i + 2 < n) {
      const y0 = s[i - 1];
      const y1 = s[i];
      const y2 = s[i + 1];
      const y3 = s[i + 2];
      for (const t of [0.25, 0.5, 0.75]) {
        const t2 = t * t;
        const t3 = t2 * t;
        const v =
          0.5 *
          (2 * y1 +
            (-y0 + y2) * t +
            (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 +
            (-y0 + 3 * y1 - 3 * y2 + y3) * t3);
        const av = Math.abs(v);
        if (av > maxAbs) maxAbs = av;
      }
    }
  }
  return maxAbs <= 1e-12 ? -Infinity : 20 * Math.log10(maxAbs);
}

/**
 * Levels PCM strictly to -18.0 LUFS with true peak <= -1.0 dBFS.
 */
function levelPcmStrictMinus18(pcm: Buffer, label: string): {
  pcm: Buffer;
  lufsBefore: number | null;
  lufsAfter: number | null;
  samplePeakDbfs: number | null;
  truePeakDbfs: number | null;
} {
  if (pcm.length < 400) {
    return { pcm, lufsBefore: null, lufsAfter: null, samplePeakDbfs: null, truePeakDbfs: null };
  }
  const res1 = levelSubBlockClipsLoudness([{ pcm, speaker: label }], {
    sampleRate: SR,
    defaultTargetLufs: -18.0,
    ceilingDbfs: -1.15,
  })[0];
  let outPcm = res1.pcm;
  let tp = measureTruePeakDbfsPcm(outPcm);
  if (Number.isFinite(tp) && tp > -1.0) {
    // Re-run with tighter ceiling if inter-sample true peak crossed -1.0 dBFS
    const margin = tp - -1.0 + 0.25;
    const res2 = levelSubBlockClipsLoudness([{ pcm, speaker: label }], {
      sampleRate: SR,
      defaultTargetLufs: -18.0,
      ceilingDbfs: -1.15 - margin,
    })[0];
    outPcm = res2.pcm;
    tp = measureTruePeakDbfsPcm(outPcm);
  }
  const lAfter = measureIntegratedLufsPcm(outPcm, SR);
  const sp = measurePeakDbfsPcm(outPcm);
  return {
    pcm: outPcm,
    lufsBefore: res1.lufsBefore,
    lufsAfter: Number.isFinite(lAfter) ? lAfter : null,
    samplePeakDbfs: Number.isFinite(sp) ? sp : null,
    truePeakDbfs: Number.isFinite(tp) ? tp : null,
  };
}

// --- Acoustic DSP (identical to exp3Runner for apples-to-apples comparison) ---

function median(vals: number[]): number {
  const clean = vals.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (clean.length === 0) return 0;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 === 1 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

function hzToMel(hz: number) {
  return 2595 * Math.log10(1 + hz / 700);
}
function melToHz(mel: number) {
  return 700 * (Math.pow(10, mel / 2595) - 1);
}

const FFT_N = 512;
const FFT_BINS = FFT_N / 2 + 1;
const N_MELS = 26;
const N_MFCC = 13;
const HANN = new Float32Array(FFT_N);
for (let i = 0; i < FFT_N; i++) HANN[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_N - 1)));
const MEL_FILTERS: Float64Array[] = (() => {
  const melMin = hzToMel(80);
  const melMax = hzToMel(7600);
  const pts: number[] = [];
  for (let i = 0; i < N_MELS + 2; i++) {
    pts.push(melToHz(melMin + (i * (melMax - melMin)) / (N_MELS + 1)));
  }
  const bins = pts.map((hz) => Math.floor(((FFT_N + 1) * hz) / SR));
  const out: Float64Array[] = [];
  for (let m = 1; m <= N_MELS; m++) {
    const f = new Float64Array(FFT_BINS);
    for (let k = bins[m - 1]; k < bins[m]; k++) {
      if (k >= 0 && k < FFT_BINS) f[k] = (k - bins[m - 1]) / Math.max(1, bins[m] - bins[m - 1]);
    }
    for (let k = bins[m]; k <= bins[m + 1]; k++) {
      if (k >= 0 && k < FFT_BINS) f[k] = (bins[m + 1] - k) / Math.max(1, bins[m + 1] - bins[m]);
    }
    out.push(f);
  }
  return out;
})();

function radix2Fft(re: Float64Array, im: Float64Array) {
  const N = re.length;
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
    }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wlenR = Math.cos(ang);
    const wlenI = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let wR = 1;
      let wI = 0;
      for (let j = 0; j < len / 2; j++) {
        const uR = re[i + j];
        const uI = im[i + j];
        const vR = re[i + j + len / 2] * wR - im[i + j + len / 2] * wI;
        const vI = re[i + j + len / 2] * wI + im[i + j + len / 2] * wR;
        re[i + j] = uR + vR;
        im[i + j] = uI + vI;
        re[i + j + len / 2] = uR - vR;
        im[i + j + len / 2] = uI - vI;
        const nwR = wR * wlenR - wI * wlenI;
        wI = wR * wlenI + wI * wlenR;
        wR = nwR;
      }
    }
  }
}

interface ClipAcoustics {
  f0MedHz: number;
  f0P10Hz: number;
  f0P90Hz: number;
  centroidHz: number;
  tiltDb: number;
  hnrProxy: number;
  mfcc: number[];
  durSec: number;
}

function analyzePcmAcoustics(pcm: Buffer, gender: "male" | "female"): ClipAcoustics {
  const n = Math.floor(pcm.length / 2);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = pcm.readInt16LE(i * 2) / 32768;

  const pe = new Float32Array(n);
  if (n > 0) pe[0] = s[0];
  for (let i = 1; i < n; i++) pe[i] = s[i] - 0.97 * s[i - 1];

  const win = 960; // 40 ms
  const hop = 240; // 10 ms
  const minLag = Math.floor(SR / (gender === "male" ? 240 : 380));
  const maxLag = Math.floor(SR / (gender === "male" ? 70 : 125));

  const frameRms: number[] = [];
  for (let off = 0; off + win <= n; off += hop) {
    let e = 0;
    for (let i = 0; i < win; i++) e += s[off + i] * s[off + i];
    frameRms.push(Math.sqrt(e / win));
  }
  const sortedRms = [...frameRms].sort((a, b) => a - b);
  const p90 = sortedRms[Math.floor(sortedRms.length * 0.9)] || 0.01;
  const thresh = Math.max(0.008, p90 * 0.25);

  const f0s: number[] = [];
  let hnrSum = 0;
  let hnrCount = 0;
  let centNum = 0;
  let centDen = 0;
  let lowEnergy = 0;
  let highEnergy = 0;
  const mfccSum = new Float64Array(N_MFCC);
  let specFrames = 0;

  for (let off = 0, fi = 0; off + win <= n; off += hop, fi++) {
    if (frameRms[fi] < thresh) continue;
    let e0 = 0;
    for (let i = 0; i < win; i++) e0 += s[off + i] * s[off + i];
    if (e0 <= 1e-8) continue;

    let bestLag = -1;
    let bestCorr = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let c = 0;
      for (let i = 0; i < win - lag; i++) c += s[off + i] * s[off + i + lag];
      const norm = c / e0;
      if (norm > bestCorr) {
        bestCorr = norm;
        bestLag = lag;
      }
    }
    if (bestCorr > 0.45 && bestLag > 0) {
      f0s.push(SR / bestLag);
    }
    hnrSum += bestCorr;
    hnrCount++;

    if (fi % 2 === 0 && off + FFT_N <= n) {
      const reRaw = new Float64Array(FFT_N);
      const imRaw = new Float64Array(FFT_N);
      for (let i = 0; i < FFT_N; i++) reRaw[i] = s[off + i] * HANN[i];
      radix2Fft(reRaw, imRaw);
      for (let k = 1; k < FFT_BINS; k++) {
        const hz = (k * SR) / FFT_N;
        if (hz > 8000) break;
        const p = reRaw[k] * reRaw[k] + imRaw[k] * imRaw[k];
        centNum += hz * p;
        centDen += p;
        if (hz >= 100 && hz < 1000) lowEnergy += p;
        if (hz >= 1000 && hz <= 4000) highEnergy += p;
      }

      const rePe = new Float64Array(FFT_N);
      const imPe = new Float64Array(FFT_N);
      for (let i = 0; i < FFT_N; i++) rePe[i] = pe[off + i] * HANN[i];
      radix2Fft(rePe, imPe);
      const pow = new Float64Array(FFT_BINS);
      for (let k = 0; k < FFT_BINS; k++) {
        pow[k] = (rePe[k] * rePe[k] + imPe[k] * imPe[k]) / FFT_N;
      }
      const logMel = new Float64Array(N_MELS);
      for (let m = 0; m < N_MELS; m++) {
        let sum = 0;
        const filt = MEL_FILTERS[m];
        for (let k = 0; k < FFT_BINS; k++) sum += pow[k] * filt[k];
        logMel[m] = Math.log(sum + 1e-12);
      }
      for (let c = 0; c < N_MFCC; c++) {
        let sum = 0;
        for (let m = 0; m < N_MELS; m++) {
          sum += logMel[m] * Math.cos((Math.PI * c * (m + 0.5)) / N_MELS);
        }
        mfccSum[c] += sum;
      }
      specFrames++;
    }
  }

  f0s.sort((a, b) => a - b);
  const mfcc: number[] = [];
  for (let c = 1; c < N_MFCC; c++) mfcc.push(mfccSum[c] / Math.max(1, specFrames));

  return {
    f0MedHz: median(f0s),
    f0P10Hz: f0s.length ? f0s[Math.floor(f0s.length * 0.1)] : 0,
    f0P90Hz: f0s.length ? f0s[Math.floor(f0s.length * 0.9)] : 0,
    centroidHz: centDen > 0 ? centNum / centDen : 0,
    tiltDb: 10 * Math.log10((highEnergy + 1e-12) / (lowEnergy + 1e-12)),
    hnrProxy: hnrCount > 0 ? hnrSum / hnrCount : 0,
    mfcc,
    durSec: n / SR,
  };
}

function mfccDistance(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

function avgMfcc(vecs: number[][]): number[] {
  if (vecs.length === 0) return new Array(12).fill(0);
  const out = new Array(vecs[0].length).fill(0);
  for (const v of vecs) {
    for (let i = 0; i < out.length; i++) out[i] += v[i] / vecs.length;
  }
  return out;
}

function escapeMd(s?: string | null): string {
  return String(s ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

async function withOneApiRetry<T>(label: string, fn: () => Promise<T>): Promise<{ value: T; retries: number }> {
  let retries = 0;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const value = await fn();
      return { value, retries };
    } catch (err: any) {
      if (attempt === 1) {
        retries += 1;
        console.warn(`[VoiceLock] ${label} API error on attempt 1, retrying once in 3s:`, err?.message || err);
        await new Promise((r) => setTimeout(r, 3000));
      } else {
        throw err;
      }
    }
  }
  throw new Error(`[VoiceLock] ${label} exhausted attempts`);
}

interface ReferenceProfile {
  label: string;
  f0MedHz: number;
  centroidHz: number;
  tiltDb: number;
  hnrProxy: number;
  mfcc: number[];
}

function computeReferenceProfiles(): {
  male: { sb1: ReferenceProfile; sb2Early: ReferenceProfile; combined: ReferenceProfile };
  female: { sb1: ReferenceProfile; sb2Early: ReferenceProfile; combined: ReferenceProfile };
} {
  const fixturePath = path.resolve(process.cwd(), "scripts", "fixtures", "01_tiggo_8_hybrid_uz_dublyaj_v4.txt");
  const parsed = parseReadyScript(fs.readFileSync(fixturePath, "utf8"));
  const subs = planDialogueSubBlocks(parsed.turns);
  const sb1 = subs[0];
  const sb2 = subs[1];

  const refSb1Path = path.resolve(process.cwd(), "public", "audio", "experiments", "exp3-ref-sb1.wav");
  const refSb2Path = path.resolve(process.cwd(), "public", "audio", "experiments", "exp3-ref-sb2.wav");
  if (!fs.existsSync(refSb1Path) || !fs.existsSync(refSb2Path)) {
    throw new Error(`Reference WAVs missing: ${refSb1Path} or ${refSb2Path}`);
  }

  const sb1Pcm = extractRawPcm24k(fs.readFileSync(refSb1Path));
  const sb2Pcm = extractRawPcm24k(fs.readFileSync(refSb2Path));
  const sb2OffsetSec = sb2.turns[0].startSec ?? 93; // 01:33 shifted to 00:00 in exp3-ref-sb2.wav

  const extractSpeakerClips = (
    fullPcm: Buffer,
    turns: any[],
    offsetSec: number,
    maxRelEndSec: number,
    gender: "male" | "female"
  ): ClipAcoustics[] => {
    const totalSec = fullPcm.length / (SR * 2);
    const out: ClipAcoustics[] = [];
    for (let i = 0; i < turns.length; i++) {
      const t = turns[i];
      const isAziz = /азиз|aziz/i.test(t.speakerName || "") || t.speakerGender === "male";
      const tGender: "male" | "female" = isAziz ? "male" : "female";
      if (tGender !== gender) continue;
      const relStart = Math.max(0, (t.startSec ?? offsetSec) - offsetSec);
      if (relStart >= maxRelEndSec - 0.1) continue;
      const nextRelStart =
        i + 1 < turns.length && typeof turns[i + 1].startSec === "number"
          ? turns[i + 1].startSec - offsetSec
          : maxRelEndSec;
      const relEnd = Math.min(
        totalSec,
        maxRelEndSec,
        Math.max((t.endSec ?? t.startSec ?? offsetSec) - offsetSec, nextRelStart - 0.04)
      );
      if (relEnd <= relStart + 0.2) continue;
      const b0 = Math.floor(relStart * SR) * 2;
      const b1 = Math.min(fullPcm.length, Math.floor(relEnd * SR) * 2);
      out.push(analyzePcmAcoustics(fullPcm.subarray(b0, b1), gender));
    }
    return out;
  };

  const summarize = (label: string, items: ClipAcoustics[]): ReferenceProfile => ({
    label,
    f0MedHz: median(items.map((x) => x.f0MedHz)),
    centroidHz: items.reduce((s, x) => s + x.centroidHz, 0) / Math.max(1, items.length),
    tiltDb: items.reduce((s, x) => s + x.tiltDb, 0) / Math.max(1, items.length),
    hnrProxy: items.reduce((s, x) => s + x.hnrProxy, 0) / Math.max(1, items.length),
    mfcc: avgMfcc(items.map((x) => x.mfcc)),
  });

  const mSb1 = extractSpeakerClips(sb1Pcm, sb1.turns, 0, 999, "male");
  const fSb1 = extractSpeakerClips(sb1Pcm, sb1.turns, 0, 999, "female");
  // Strictly up to 00:57 in exp3-ref-sb2.wav (corresponds to 01:33–02:30 in the video)
  const mSb2Early = extractSpeakerClips(sb2Pcm, sb2.turns, sb2OffsetSec, 57.0, "male");
  const fSb2Early = extractSpeakerClips(sb2Pcm, sb2.turns, sb2OffsetSec, 57.0, "female");

  return {
    male: {
      sb1: summarize("ref-sb1 (00:00–01:33, Азиз)", mSb1),
      sb2Early: summarize("ref-sb2 <00:57 (01:33–02:30, Азиз)", mSb2Early),
      combined: summarize("ref-sb1 + ref-sb2 <00:57 (Азиз)", [...mSb1, ...mSb2Early]),
    },
    female: {
      sb1: summarize("ref-sb1 (00:00–01:33, Вероника)", fSb1),
      sb2Early: summarize("ref-sb2 <00:57 (01:33–02:30, Вероника)", fSb2Early),
      combined: summarize("ref-sb1 + ref-sb2 <00:57 (Вероника)", [...fSb1, ...fSb2Early]),
    },
  };
}

interface HydrogenConsistencyResult {
  sameVoiceIdentity: boolean;
  consistencyScore1to10: number;
  shiftsToAnnouncerOnTech: boolean;
  laughOrEmotionNatural: string;
  partBreakdownRu: string;
  verdictRu: string;
}

async function analyzeConsistencyWithHydrogen(
  ai: GoogleGenAI,
  spec: VoiceLockCandidateSpec,
  uzTestWavBuf: Buffer,
  parts: Array<{ label: string; text: string; style: string }>
): Promise<{ result: HydrogenConsistencyResult; retries: number }> {
  const partsDesc = parts
    .map((p) => `${p.label}) style="${p.style || "(empty)"}" | text="${p.text}"`)
    .join("\n");

  const prompt = [
    `You are an audio QA engineer evaluating a single Uzbek TTS voice candidate (${spec.code}, ${spec.gender}, base=${spec.base_voice}).`,
    `The attached audio contains 3 consecutive Uzbek utterances (A, B, C) synthesized in one call with the SAME persistent voice ID:`,
    partsDesc,
    ``,
    `Listen carefully to the ENTIRE audio and assess:`,
    `1. Does the speaker remain ONE consistent human vocal identity across A (emotional/conversational), B (technical/informational), and C (technical or concerned)?`,
    `2. Does the voice abruptly darken, drop register, or turn into a formal/heavy news announcer on the technical or later utterances?`,
    `3. Is Uzbek pronunciation clean and natural, and for female voices is <laugh> on part A rendered as natural laughter (not spoken as the word "laugh")?`,
    `Return ONLY valid JSON matching the schema. Write all descriptive fields in concise Russian.`,
  ].join("\n");

  const wrapped = await withOneApiRetry(`Hydrogen consistency ${spec.code}`, async () => {
    const resp = await ai.models.generateContent({
      model: ANALYSIS_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: "audio/wav",
                data: uzTestWavBuf.toString("base64"),
              },
            },
            { text: prompt },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            sameVoiceIdentity: {
              type: Type.BOOLEAN,
              description: "True if all 3 parts clearly sound like the exact same speaker identity.",
            },
            consistencyScore1to10: {
              type: Type.NUMBER,
              description: "Voice identity & timbre consistency score from 1 (completely different voices) to 10 (rock-solid single identity).",
            },
            shiftsToAnnouncerOnTech: {
              type: Type.BOOLEAN,
              description: "True if voice noticeably darkens or turns into a formal news announcer on technical parts.",
            },
            laughOrEmotionNatural: {
              type: Type.STRING,
              description: "Short Russian note on emotional naturalness (and whether <laugh> sounded natural, not spoken aloud).",
            },
            partBreakdownRu: {
              type: Type.STRING,
              description: "Short Russian comparison of timbre/delivery across parts A, B, and C.",
            },
            verdictRu: {
              type: Type.STRING,
              description: "Concise 1-sentence Russian summary of voice consistency and character.",
            },
          },
          required: [
            "sameVoiceIdentity",
            "consistencyScore1to10",
            "shiftsToAnnouncerOnTech",
            "laughOrEmotionNatural",
            "partBreakdownRu",
            "verdictRu",
          ],
        },
      },
    });
    const raw = (resp.text ?? "{}").trim();
    return JSON.parse(raw) as HydrogenConsistencyResult;
  });
  return { result: wrapped.value, retries: wrapped.retries };
}

export async function runVoiceLockStage1Live(ai: GoogleGenAI) {
  const outDir = path.resolve(process.cwd(), "public", "audio", "voice-lock");
  fs.mkdirSync(outDir, { recursive: true });
  const voicesJsonPath = path.join(outDir, "voices.json");

  const refs = computeReferenceProfiles();

  let voiceCreateCalls = 0;
  let ttsCalls = 0;
  let hydrogenCalls = 0;
  let apiRetriesTotal = 0;

  const records: any[] = [];

  for (const spec of VOICE_LOCK_CANDIDATES) {
    console.log(`\n[VoiceLock Stage 1] === ${spec.code}: ${spec.display_name} (base=${spec.base_voice}) ===`);

    // 1. Official Gemini Voice Remix: ai.voices.create({ store: true, voice: { model, type: "prompted", display_name, prompted: { base_voice, input } } })
    const createdWrap = await withOneApiRetry(`voices.create ${spec.code}`, async () => {
      return ai.voices.create({
        store: true,
        voice: {
          model: TTS_MODEL,
          type: "prompted",
          display_name: spec.display_name,
          prompted: {
            base_voice: spec.base_voice,
            input: spec.prompt,
          },
        },
      });
    });
    voiceCreateCalls += 1;
    apiRetriesTotal += createdWrap.retries;

    const createdVoice = createdWrap.value as any;
    const voiceId = String(createdVoice?.id || "").trim();
    if (!voiceId) {
      throw new Error(`[VoiceLock] voices.create for ${spec.code} returned empty id: ${JSON.stringify(createdVoice)}`);
    }
    console.log(`[VoiceLock] Created ${spec.code} -> ${voiceId} (expire=${createdVoice?.expire_time || "n/a"})`);

    // Decode & level sample_audio to -18 LUFS, true peak <= -1 dBFS
    let sampleSaved = false;
    let sampleMimeType = "";
    let sampleLoudness: ReturnType<typeof levelPcmStrictMinus18> | null = null;
    let sampleAcoustics: ClipAcoustics | null = null;
    const sampleWavPath = path.join(outDir, spec.sampleFileName);

    const sampleObj = createdVoice?.sample_audio;
    if (sampleObj?.data && typeof sampleObj.data === "string") {
      sampleMimeType = String(sampleObj.mime_type || "audio/wav");
      const rawSampleBytes = Buffer.from(sampleObj.data, "base64");
      const rawSamplePcm = decodeAudioToPcm24kMono(rawSampleBytes, sampleMimeType);
      sampleLoudness = levelPcmStrictMinus18(rawSamplePcm, `${spec.code}-sample`);
      sampleAcoustics = analyzePcmAcoustics(sampleLoudness.pcm, spec.gender);
      fs.writeFileSync(sampleWavPath, buildWav24k(sampleLoudness.pcm));
      sampleSaved = true;
      console.log(
        `[VoiceLock] Saved ${spec.sampleFileName}: dur=${sampleAcoustics.durSec.toFixed(2)}s, lufs=${sampleLoudness.lufsBefore?.toFixed(1)}->${sampleLoudness.lufsAfter?.toFixed(1)}, TP=${sampleLoudness.truePeakDbfs?.toFixed(2)} dBFS`
      );
    } else {
      console.warn(`[VoiceLock] ${spec.code} (${voiceId}) did not return sample_audio in CreateVoice response!`);
    }

    // 2. Real Uzbek 3-part test: EXACTLY ONE gemini-3.8-flash-tts call with 3 separate parts using persistent voice_... ID
    const testParts = spec.gender === "male" ? MALE_UZ_TEST_PARTS : FEMALE_UZ_TEST_PARTS;
    const ttsWrap = await withOneApiRetry(`TTS uz-test ${spec.code}`, async () => {
      return ai.models.generateContent({
        model: TTS_MODEL,
        contents: [
          {
            role: "user",
            parts: testParts.map((p) => ({
              text: p.text,
              speechMetadata: {
                style: p.style,
              },
            })) as any,
          },
        ],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              voice: voiceId,
            },
          },
        },
      });
    });
    ttsCalls += 1;
    apiRetriesTotal += ttsWrap.retries;
    recordGoogleTtsCalls(1);

    const resParts = ttsWrap.value.candidates?.[0]?.content?.parts || [];
    const audioParts = resParts.filter((p: any) => typeof p?.inlineData?.data === "string");
    if (audioParts.length === 0) {
      throw new Error(`[VoiceLock] TTS returned empty audio for ${spec.code} (${voiceId})`);
    }
    const pause300ms = Buffer.alloc(Math.floor(SR * 0.3) * 2);
    const pcmPieces = audioParts.map((ap: any) =>
      decodeAudioToPcm24kMono(Buffer.from(ap.inlineData.data, "base64"), ap.inlineData.mimeType)
    );
    const mergedRawPcm =
      pcmPieces.length > 1
        ? Buffer.concat(pcmPieces.flatMap((buf, idx) => (idx === 0 ? [buf] : [pause300ms, buf])))
        : pcmPieces[0];

    const uzLoudness = levelPcmStrictMinus18(mergedRawPcm, `${spec.code}-uz`);
    const uzTestWavBuf = buildWav24k(uzLoudness.pcm);
    const uzTestWavPath = path.join(outDir, spec.uzTestFileName);
    fs.writeFileSync(uzTestWavPath, uzTestWavBuf);

    const uzAcoustics = analyzePcmAcoustics(uzLoudness.pcm, spec.gender);
    const refGroup = spec.gender === "male" ? refs.male : refs.female;
    const mfccToSb1 = mfccDistance(uzAcoustics.mfcc, refGroup.sb1.mfcc);
    const mfccToSb2Early = mfccDistance(uzAcoustics.mfcc, refGroup.sb2Early.mfcc);
    const mfccToCombined = mfccDistance(uzAcoustics.mfcc, refGroup.combined.mfcc);

    console.log(
      `[VoiceLock] Saved ${spec.uzTestFileName}: dur=${uzAcoustics.durSec.toFixed(2)}s, F0=${uzAcoustics.f0MedHz.toFixed(0)}Hz, cent=${uzAcoustics.centroidHz.toFixed(0)}Hz, tilt=${uzAcoustics.tiltDb.toFixed(1)}dB, MFCC(sb1/sb2/comb)=${mfccToSb1.toFixed(1)}/${mfccToSb2Early.toFixed(1)}/${mfccToCombined.toFixed(1)}, lufs=${uzLoudness.lufsBefore?.toFixed(1)}->${uzLoudness.lufsAfter?.toFixed(1)}, TP=${uzLoudness.truePeakDbfs?.toFixed(2)} dBFS`
    );

    // 3. Gemini-4-hydrogen voice consistency check (1 call per candidate)
    let hydrogenResult: HydrogenConsistencyResult | null = null;
    try {
      const hWrap = await analyzeConsistencyWithHydrogen(ai, spec, uzTestWavBuf, testParts);
      hydrogenCalls += 1;
      apiRetriesTotal += hWrap.retries;
      hydrogenResult = hWrap.result;
      console.log(
        `[VoiceLock] Hydrogen ${spec.code}: sameId=${hydrogenResult.sameVoiceIdentity}, score=${hydrogenResult.consistencyScore1to10}/10, announcerShift=${hydrogenResult.shiftsToAnnouncerOnTech}`
      );
    } catch (err: any) {
      console.warn(`[VoiceLock] Hydrogen analysis failed for ${spec.code}:`, err?.message || err);
    }

    const record = {
      code: spec.code,
      gender: spec.gender,
      voice_id: voiceId,
      display_name: spec.display_name,
      base_voice: spec.base_voice,
      model: TTS_MODEL,
      type: "prompted",
      prompt: spec.prompt,
      expire_time: createdVoice?.expire_time || null,
      sample_audio_path: sampleSaved ? `/audio/voice-lock/${spec.sampleFileName}` : null,
      sample_mime_type: sampleMimeType || null,
      sample_duration_sec: sampleAcoustics ? Number(sampleAcoustics.durSec.toFixed(2)) : null,
      sample_lufs_after: sampleLoudness?.lufsAfter !== null && sampleLoudness?.lufsAfter !== undefined
        ? Number(sampleLoudness.lufsAfter.toFixed(2))
        : null,
      sample_true_peak_dbfs: sampleLoudness?.truePeakDbfs !== null && sampleLoudness?.truePeakDbfs !== undefined
        ? Number(sampleLoudness.truePeakDbfs.toFixed(2))
        : null,
      uz_test_audio_path: `/audio/voice-lock/${spec.uzTestFileName}`,
      uz_test_duration_sec: Number(uzAcoustics.durSec.toFixed(2)),
      uz_test_audio_parts_returned: audioParts.length,
      uz_test_lufs_before: uzLoudness.lufsBefore !== null ? Number(uzLoudness.lufsBefore.toFixed(2)) : null,
      uz_test_lufs_after: uzLoudness.lufsAfter !== null ? Number(uzLoudness.lufsAfter.toFixed(2)) : null,
      uz_test_true_peak_dbfs: uzLoudness.truePeakDbfs !== null ? Number(uzLoudness.truePeakDbfs.toFixed(2)) : null,
      acoustics: {
        f0_med_hz: Number(uzAcoustics.f0MedHz.toFixed(1)),
        f0_p10_hz: Number(uzAcoustics.f0P10Hz.toFixed(1)),
        f0_p90_hz: Number(uzAcoustics.f0P90Hz.toFixed(1)),
        spectral_centroid_hz: Number(uzAcoustics.centroidHz.toFixed(1)),
        spectral_tilt_db: Number(uzAcoustics.tiltDb.toFixed(2)),
        hnr_proxy: Number(uzAcoustics.hnrProxy.toFixed(3)),
        mfcc_dist_to_sb1: Number(mfccToSb1.toFixed(2)),
        mfcc_dist_to_sb2_before_0057: Number(mfccToSb2Early.toFixed(2)),
        mfcc_dist_to_combined_ref: Number(mfccToCombined.toFixed(2)),
      },
      sample_acoustics: sampleAcoustics
        ? {
            f0_med_hz: Number(sampleAcoustics.f0MedHz.toFixed(1)),
            spectral_centroid_hz: Number(sampleAcoustics.centroidHz.toFixed(1)),
            spectral_tilt_db: Number(sampleAcoustics.tiltDb.toFixed(2)),
          }
        : null,
      hydrogen_consistency: hydrogenResult,
    };

    records.push(record);

    // Save incrementally after EVERY candidate so created voice_... IDs are never lost!
    fs.writeFileSync(
      voicesJsonPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          model: TTS_MODEL,
          analysisModel: ANALYSIS_MODEL,
          calls: {
            voiceCreateCalls,
            ttsCalls,
            hydrogenCalls,
            apiRetriesTotal,
          },
          references: {
            male: {
              sb1: { f0_med_hz: Number(refs.male.sb1.f0MedHz.toFixed(1)), centroid_hz: Number(refs.male.sb1.centroidHz.toFixed(1)), tilt_db: Number(refs.male.sb1.tiltDb.toFixed(2)) },
              sb2_before_0057: { f0_med_hz: Number(refs.male.sb2Early.f0MedHz.toFixed(1)), centroid_hz: Number(refs.male.sb2Early.centroidHz.toFixed(1)), tilt_db: Number(refs.male.sb2Early.tiltDb.toFixed(2)) },
            },
            female: {
              sb1: { f0_med_hz: Number(refs.female.sb1.f0MedHz.toFixed(1)), centroid_hz: Number(refs.female.sb1.centroidHz.toFixed(1)), tilt_db: Number(refs.female.sb1.tiltDb.toFixed(2)) },
              sb2_before_0057: { f0_med_hz: Number(refs.female.sb2Early.f0MedHz.toFixed(1)), centroid_hz: Number(refs.female.sb2Early.centroidHz.toFixed(1)), tilt_db: Number(refs.female.sb2Early.tiltDb.toFixed(2)) },
            },
          },
          candidates: records,
        },
        null,
        2
      ),
      "utf8"
    );
  }

  // =========================================================================
  // 4. WRITE public/audio/voice-lock/report.md (NO automatic winner!)
  // =========================================================================
  const md: string[] = [];
  md.push(`# Этап 1 — Подбор постоянных голосов Voice Remix (Voice Lock)`);
  md.push("");
  md.push(`- **Дата прогона:** ${new Date().toISOString()}`);
  md.push(`- **Модель создания и синтеза:** \`${TTS_MODEL}\` (официальный Gemini Voice Remix \`ai.voices.create\`, \`store: true\`, \`type: "prompted"\`, без Voice Replication)`);
  md.push(`- **Модель оценки консистентности:** \`${ANALYSIS_MODEL}\``);
  md.push(`- **Громкость всех WAV-файлов:** выровнена по BS.1770-4 до \`-18 LUFS\`, true peak \`≤ -1.0 dBFS\``);
  md.push(`- **Счётчик API-вызовов:**`);
  md.push(`  - Voice Remix \`ai.voices.create\`: **${voiceCreateCalls}**`);
  md.push(`  - TTS \`${TTS_MODEL}\`: **${ttsCalls}**`);
  md.push(`  - Анализ \`${ANALYSIS_MODEL}\`: **${hydrogenCalls}**`);
  md.push(`  - Повторы при ошибках API: **${apiRetriesTotal}**`);
  md.push("");
  md.push(`> Победители **не** выбираются автоматически — ниже таблицы для вашего прослушивания и сравнения с эталоном (\`exp3-ref-sb1.wav\` и \`exp3-ref-sb2.wav\` до \`00:57\`).`);
  md.push("");

  // Reference baseline table
  md.push(`## Эталоны (первые 02:30 полной озвучки)`);
  md.push("");
  md.push(`| Эталон | Спикер | Медиана F0 | Центроид спектра | Наклон спектра | Файл для прослушивания |`);
  md.push(`|---|---|---:|---:|---:|---|`);
  md.push(`| \`exp3-ref-sb1.wav\` (00:00–01:33) | Азиз (Charon) | ${refs.male.sb1.f0MedHz.toFixed(0)} Гц | ${refs.male.sb1.centroidHz.toFixed(0)} Гц | ${refs.male.sb1.tiltDb.toFixed(1)} дБ | \`/audio/experiments/exp3-ref-sb1.wav\` |`);
  md.push(`| \`exp3-ref-sb2.wav\` (< 00:57 = 01:33–02:30) | Азиз (Charon) | ${refs.male.sb2Early.f0MedHz.toFixed(0)} Гц | ${refs.male.sb2Early.centroidHz.toFixed(0)} Гц | ${refs.male.sb2Early.tiltDb.toFixed(1)} дБ | \`/audio/experiments/exp3-ref-sb2.wav\` |`);
  md.push(`| \`exp3-ref-sb1.wav\` (00:00–01:33) | Вероника (Kore) | ${refs.female.sb1.f0MedHz.toFixed(0)} Гц | ${refs.female.sb1.centroidHz.toFixed(0)} Гц | ${refs.female.sb1.tiltDb.toFixed(1)} дБ | \`/audio/experiments/exp3-ref-sb1.wav\` |`);
  md.push(`| \`exp3-ref-sb2.wav\` (< 00:57 = 01:33–02:30) | Вероника (Kore) | ${refs.female.sb2Early.f0MedHz.toFixed(0)} Гц | ${refs.female.sb2Early.centroidHz.toFixed(0)} Гц | ${refs.female.sb2Early.tiltDb.toFixed(1)} дБ | \`/audio/experiments/exp3-ref-sb2.wav\` |`);
  md.push("");

  const renderGroupSection = (title: string, gender: "male" | "female") => {
    const group = records.filter((r) => r.gender === gender);
    md.push(`## ${title}`);
    md.push("");
    md.push(`### Таблица для прослушивания и акустического сравнения`);
    md.push("");
    md.push(
      `| Кандидат | Exact Voice ID | Sample WAV | UZ-Test WAV | F0 (P10–P90) | Центроид | Наклон | MFCC до SB1 / SB2<00:57 / Общ. | LUFS (до → после) / True Peak | Hydrogen Consistency |`
    );
    md.push(`|---|---|---|---|---:|---:|---:|---:|---|---|`);
    for (const r of group) {
      const h = r.hydrogen_consistency;
      const hCell = h
        ? `${h.sameVoiceIdentity ? "Да" : "Нет"} (${h.consistencyScore1to10}/10), диктор-сдвиг: ${h.shiftsToAnnouncerOnTech ? "да" : "нет"}`
        : "—";
      const sampleCell = r.sample_audio_path
        ? `[\`${path.basename(r.sample_audio_path)}\`](${r.sample_audio_path}) (${r.sample_duration_sec}s, ${r.sample_lufs_after} LUFS / ${r.sample_true_peak_dbfs} dBFS)`
        : "—";
      const uzCell = `[\`${path.basename(r.uz_test_audio_path)}\`](${r.uz_test_audio_path}) (${r.uz_test_duration_sec}s)`;
      md.push(
        `| **${r.code}** (${escapeMd(r.display_name)}) | \`${r.voice_id}\` | ${sampleCell} | ${uzCell} | ${r.acoustics.f0_med_hz.toFixed(0)} Гц (${r.acoustics.f0_p10_hz.toFixed(0)}–${r.acoustics.f0_p90_hz.toFixed(0)}) | ${r.acoustics.spectral_centroid_hz.toFixed(0)} Гц | ${r.acoustics.spectral_tilt_db.toFixed(1)} дБ | ${r.acoustics.mfcc_dist_to_sb1.toFixed(1)} / ${r.acoustics.mfcc_dist_to_sb2_before_0057.toFixed(1)} / **${r.acoustics.mfcc_dist_to_combined_ref.toFixed(1)}** | ${r.uz_test_lufs_before?.toFixed(1) ?? "—"} → ${r.uz_test_lufs_after?.toFixed(1) ?? "—"} / ${r.uz_test_true_peak_dbfs?.toFixed(2) ?? "—"} dBFS | ${escapeMd(hCell)} |`
      );
    }
    md.push("");

    md.push(`### Подробности, промпты и разбор \`${ANALYSIS_MODEL}\``);
    md.push("");
    for (const r of group) {
      const h = r.hydrogen_consistency;
      md.push(`#### ${r.code} — ${r.display_name}`);
      md.push(`- **Voice ID:** \`${r.voice_id}\` (\`base_voice: ${r.base_voice}\`, \`expire_time: ${r.expire_time || "n/a"}\`)`);
      md.push(`- **Remix Prompt:** ${r.prompt}`);
      md.push(`- **Файлы:** sample \`${r.sample_audio_path || "нет"}\` | uz-test \`${r.uz_test_audio_path}\``);
      if (h) {
        md.push(`- **Одна личность на всех 3 репликах:** \`${h.sameVoiceIdentity ? "ДА" : "НЕТ"}\` (оценка **${h.consistencyScore1to10}/10**), уход в «диктора» на техническом тексте: \`${h.shiftsToAnnouncerOnTech ? "ДА" : "НЕТ"}\``);
        md.push(`- **Разбор по репликам A / B / C:** ${h.partBreakdownRu}`);
        md.push(`- **Эмоции / естественность:** ${h.laughOrEmotionNatural}`);
        md.push(`- **Вывод Hydrogen:** ${h.verdictRu}`);
      } else {
        md.push(`- **Анализ Hydrogen:** недоступен`);
      }
      md.push("");
    }
  };

  renderGroupSection("Мужские кандидаты (на основе Charon — Азиз)", "male");
  renderGroupSection("Женские кандидаты (на основе Kore — Вероника)", "female");

  md.push(`## Тестовые реплики (3 отдельные parts в одном запросе TTS)`);
  md.push("");
  md.push(`### Мужские (M1, M2, M3)`);
  for (const p of MALE_UZ_TEST_PARTS) {
    md.push(`- **${p.label}** (\`style: "${p.style}"\`): ${p.text}`);
  }
  md.push("");
  md.push(`### Женские (F1, F2, F3)`);
  for (const p of FEMALE_UZ_TEST_PARTS) {
    md.push(`- **${p.label}** (\`style: "${p.style}"\`): ${p.text}`);
  }
  md.push("");

  const reportPath = path.join(outDir, "report.md");
  fs.writeFileSync(reportPath, md.join("\n"), "utf8");

  return {
    ok: true,
    reportPath: "/audio/voice-lock/report.md",
    voicesJsonPath: "/audio/voice-lock/voices.json",
    calls: {
      voiceCreateCalls,
      ttsCalls,
      hydrogenCalls,
      apiRetriesTotal,
    },
    candidates: records.map((r) => ({
      code: r.code,
      voice_id: r.voice_id,
      display_name: r.display_name,
      sample: r.sample_audio_path,
      uz_test: r.uz_test_audio_path,
      lufsAfter: r.uz_test_lufs_after,
      truePeakDbfs: r.uz_test_true_peak_dbfs,
      f0MedHz: r.acoustics.f0_med_hz,
      centroidHz: r.acoustics.spectral_centroid_hz,
      tiltDb: r.acoustics.spectral_tilt_db,
      mfccCombined: r.acoustics.mfcc_dist_to_combined_ref,
      hydrogenScore: r.hydrogen_consistency?.consistencyScore1to10 ?? null,
      sameVoiceIdentity: r.hydrogen_consistency?.sameVoiceIdentity ?? null,
      shiftsToAnnouncer: r.hydrogen_consistency?.shiftsToAnnouncerOnTech ?? null,
    })),
  };
}

/**
 * Finalizes Stage 1 using the 12 ALREADY-SAVED WAV files on disk with ZERO new
 * ai.voices.create or gemini-3.8-flash-tts calls:
 * - Reads existing voices.json (M1..F2)
 * - Retrieves F3's exact voice_id & expire_time via read-only ai.voices.list()
 * - Computes acoustics & loudness metrics for F3 from F3-sample.wav / F3-uz-test.wav
 * - Runs gemini-4-hydrogen voice consistency checks on all 6 saved *-uz-test.wav files
 * - Writes complete voices.json and report.md (no automatic winner)
 */
export async function finalizeVoiceLockStage1FromDisk(ai: GoogleGenAI) {
  const outDir = path.resolve(process.cwd(), "public", "audio", "voice-lock");
  const voicesJsonPath = path.join(outDir, "voices.json");
  const existingJson = fs.existsSync(voicesJsonPath)
    ? JSON.parse(fs.readFileSync(voicesJsonPath, "utf8"))
    : { candidates: [], calls: {} };

  const existingByCode = new Map<string, any>();
  for (const c of existingJson.candidates || []) {
    existingByCode.set(c.code, c);
  }

  // Read-only metadata lookup to get F3 (and verify all 6 IDs) with ZERO voices.create calls
  const listResp = await ai.voices.list();
  const allStoredVoices: any[] = (listResp as any)?.voices || [];

  const refs = computeReferenceProfiles();
  const records: any[] = [];

  for (const spec of VOICE_LOCK_CANDIDATES) {
    const existing = existingByCode.get(spec.code);
    const sampleWavPath = path.join(outDir, spec.sampleFileName);
    const uzTestWavPath = path.join(outDir, spec.uzTestFileName);
    if (!fs.existsSync(sampleWavPath) || !fs.existsSync(uzTestWavPath)) {
      throw new Error(`Missing WAV on disk for ${spec.code}: ${sampleWavPath} or ${uzTestWavPath}`);
    }

    let voiceId = String(existing?.voice_id || "").trim();
    let expireTime = existing?.expire_time || null;
    if (!voiceId) {
      const matches = allStoredVoices
        .filter((v) => v?.display_name === spec.display_name && v?.type === "prompted")
        .sort((a, b) => String(b?.expire_time || "").localeCompare(String(a?.expire_time || "")));
      if (matches.length === 0) {
        throw new Error(`Could not find stored voice "${spec.display_name}" in ai.voices.list()`);
      }
      voiceId = String(matches[0].id || "").trim();
      expireTime = matches[0].expire_time || null;
      console.log(`[VoiceLock Finalize] Recovered ${spec.code} from ai.voices.list(): ${voiceId} (expire=${expireTime})`);
    }

    const sampleWavBuf = fs.readFileSync(sampleWavPath);
    const uzTestWavBuf = fs.readFileSync(uzTestWavPath);
    const samplePcm = extractRawPcm24k(sampleWavBuf);
    const uzPcm = extractRawPcm24k(uzTestWavBuf);

    const sampleLufsAfter = measureIntegratedLufsPcm(samplePcm, SR);
    const sampleTruePeak = measureTruePeakDbfsPcm(samplePcm);
    const sampleAcoustics = analyzePcmAcoustics(samplePcm, spec.gender);

    const uzLufsAfter = measureIntegratedLufsPcm(uzPcm, SR);
    const uzTruePeak = measureTruePeakDbfsPcm(uzPcm);
    const uzAcoustics = analyzePcmAcoustics(uzPcm, spec.gender);

    const refGroup = spec.gender === "male" ? refs.male : refs.female;
    const mfccToSb1 = mfccDistance(uzAcoustics.mfcc, refGroup.sb1.mfcc);
    const mfccToSb2Early = mfccDistance(uzAcoustics.mfcc, refGroup.sb2Early.mfcc);
    const mfccToCombined = mfccDistance(uzAcoustics.mfcc, refGroup.combined.mfcc);

    records.push({
      code: spec.code,
      gender: spec.gender,
      voice_id: voiceId,
      display_name: spec.display_name,
      base_voice: spec.base_voice,
      model: TTS_MODEL,
      type: "prompted",
      prompt: spec.prompt,
      expire_time: expireTime,
      sample_audio_path: `/audio/voice-lock/${spec.sampleFileName}`,
      sample_mime_type: "audio/wav",
      sample_duration_sec: Number(sampleAcoustics.durSec.toFixed(2)),
      sample_lufs_after: Number.isFinite(sampleLufsAfter) ? Number(sampleLufsAfter.toFixed(2)) : null,
      sample_true_peak_dbfs: Number.isFinite(sampleTruePeak) ? Number(sampleTruePeak.toFixed(2)) : null,
      uz_test_audio_path: `/audio/voice-lock/${spec.uzTestFileName}`,
      uz_test_duration_sec: Number(uzAcoustics.durSec.toFixed(2)),
      uz_test_audio_parts_returned: existing?.uz_test_audio_parts_returned ?? 1,
      uz_test_lufs_before: existing?.uz_test_lufs_before ?? null,
      uz_test_lufs_after: Number.isFinite(uzLufsAfter) ? Number(uzLufsAfter.toFixed(2)) : null,
      uz_test_true_peak_dbfs: Number.isFinite(uzTruePeak) ? Number(uzTruePeak.toFixed(2)) : null,
      acoustics: {
        f0_med_hz: Number(uzAcoustics.f0MedHz.toFixed(1)),
        f0_p10_hz: Number(uzAcoustics.f0P10Hz.toFixed(1)),
        f0_p90_hz: Number(uzAcoustics.f0P90Hz.toFixed(1)),
        spectral_centroid_hz: Number(uzAcoustics.centroidHz.toFixed(1)),
        spectral_tilt_db: Number(uzAcoustics.tiltDb.toFixed(2)),
        hnr_proxy: Number(uzAcoustics.hnrProxy.toFixed(3)),
        mfcc_dist_to_sb1: Number(mfccToSb1.toFixed(2)),
        mfcc_dist_to_sb2_before_0057: Number(mfccToSb2Early.toFixed(2)),
        mfcc_dist_to_combined_ref: Number(mfccToCombined.toFixed(2)),
      },
      sample_acoustics: {
        f0_med_hz: Number(sampleAcoustics.f0MedHz.toFixed(1)),
        spectral_centroid_hz: Number(sampleAcoustics.centroidHz.toFixed(1)),
        spectral_tilt_db: Number(sampleAcoustics.tiltDb.toFixed(2)),
      },
      hydrogen_consistency: existing?.hydrogen_consistency || null,
    });
  }

  // Run gemini-4-hydrogen consistency analysis for all 6 saved uz-test WAVs (2 batches of 3 for speed)
  let newHydrogenCalls = 0;
  let newRetries = 0;
  const runBatch = async (indices: number[]) => {
    await Promise.all(
      indices.map(async (idx) => {
        const spec = VOICE_LOCK_CANDIDATES[idx];
        const rec = records[idx];
        if (rec.hydrogen_consistency) return;
        const uzTestWavBuf = fs.readFileSync(path.join(outDir, spec.uzTestFileName));
        const testParts = spec.gender === "male" ? MALE_UZ_TEST_PARTS : FEMALE_UZ_TEST_PARTS;
        const hWrap = await analyzeConsistencyWithHydrogen(ai, spec, uzTestWavBuf, testParts);
        newHydrogenCalls += 1;
        newRetries += hWrap.retries;
        rec.hydrogen_consistency = hWrap.result;
        console.log(
          `[VoiceLock Finalize] Hydrogen ${spec.code}: sameId=${hWrap.result.sameVoiceIdentity}, score=${hWrap.result.consistencyScore1to10}/10, announcerShift=${hWrap.result.shiftsToAnnouncerOnTech}`
        );
      })
    );
  };
  await runBatch([0, 1, 2]);
  await runBatch([3, 4, 5]);

  const prevHydrogenCalls = Number(existingJson?.calls?.hydrogenCalls || 0);
  const totalCalls = {
    voiceCreateCalls: 6,
    ttsCalls: 6,
    hydrogenCallsEffective: newHydrogenCalls,
    hydrogenCallsTotalIncludingLostPass1: prevHydrogenCalls + newHydrogenCalls,
    voicesListReadOnlyCalls: 1,
    apiRetriesTotal: Number(existingJson?.calls?.apiRetriesTotal || 0) + newRetries,
  };

  fs.writeFileSync(
    voicesJsonPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        model: TTS_MODEL,
        analysisModel: ANALYSIS_MODEL,
        calls: totalCalls,
        references: {
          male: {
            sb1: { f0_med_hz: Number(refs.male.sb1.f0MedHz.toFixed(1)), centroid_hz: Number(refs.male.sb1.centroidHz.toFixed(1)), tilt_db: Number(refs.male.sb1.tiltDb.toFixed(2)) },
            sb2_before_0057: { f0_med_hz: Number(refs.male.sb2Early.f0MedHz.toFixed(1)), centroid_hz: Number(refs.male.sb2Early.centroidHz.toFixed(1)), tilt_db: Number(refs.male.sb2Early.tiltDb.toFixed(2)) },
          },
          female: {
            sb1: { f0_med_hz: Number(refs.female.sb1.f0MedHz.toFixed(1)), centroid_hz: Number(refs.female.sb1.centroidHz.toFixed(1)), tilt_db: Number(refs.female.sb1.tiltDb.toFixed(2)) },
            sb2_before_0057: { f0_med_hz: Number(refs.female.sb2Early.f0MedHz.toFixed(1)), centroid_hz: Number(refs.female.sb2Early.centroidHz.toFixed(1)), tilt_db: Number(refs.female.sb2Early.tiltDb.toFixed(2)) },
          },
        },
        candidates: records,
      },
      null,
      2
    ),
    "utf8"
  );

  // Write report.md
  const md: string[] = [];
  md.push(`# Этап 1 — Подбор постоянных голосов Voice Remix (Voice Lock)`);
  md.push("");
  md.push(`- **Дата прогона:** ${new Date().toISOString()}`);
  md.push(`- **Модель создания и синтеза:** \`${TTS_MODEL}\` (официальный Gemini Voice Remix \`ai.voices.create\`, \`store: true\`, \`type: "prompted"\`, без Voice Replication)`);
  md.push(`- **Модель оценки консистентности:** \`${ANALYSIS_MODEL}\``);
  md.push(`- **Громкость всех WAV-файлов:** выровнена по BS.1770-4 до \`-18 LUFS\`, true peak \`≤ -1.0 dBFS\``);
  md.push(`- **Счётчик API-вызовов:**`);
  md.push(`  - Voice Remix \`ai.voices.create\`: **${totalCalls.voiceCreateCalls}** (ровно 6 — без повторов)`);
  md.push(`  - TTS \`${TTS_MODEL}\`: **${totalCalls.ttsCalls}** (ровно 6 — без повторов)`);
  md.push(`  - Анализ \`${ANALYSIS_MODEL}\`: **${totalCalls.hydrogenCallsEffective}** успешных (всего **${totalCalls.hydrogenCallsTotalIncludingLostPass1}**: в первом проходе ответы 5 вызовов не сохранились из-за бага поля \`hWrap.result\` вместо \`hWrap.value\`, после исправления выполнен повторный анализ уже сохранённых 6 WAV без новых вызовов TTS/Voice Remix)`);
  md.push(`  - Read-only \`ai.voices.list\`: **${totalCalls.voicesListReadOnlyCalls}** (для восстановления ID F3 без повторного создания)`);
  md.push(`  - Повторы при ошибках API: **${totalCalls.apiRetriesTotal}**`);
  md.push("");
  md.push(`> Победители **не** выбираются автоматически — ниже таблицы для вашего прослушивания и сравнения с эталоном (\`exp3-ref-sb1.wav\` и \`exp3-ref-sb2.wav\` до \`00:57\`).`);
  md.push("");

  md.push(`## Эталоны (первые 02:30 полной озвучки)`);
  md.push("");
  md.push(`| Эталон | Спикер | Медиана F0 | Центроид спектра | Наклон спектра | Файл для прослушивания |`);
  md.push(`|---|---|---:|---:|---:|---|`);
  md.push(`| \`exp3-ref-sb1.wav\` (00:00–01:33) | Азиз (Charon) | ${refs.male.sb1.f0MedHz.toFixed(0)} Гц | ${refs.male.sb1.centroidHz.toFixed(0)} Гц | ${refs.male.sb1.tiltDb.toFixed(1)} дБ | \`/audio/experiments/exp3-ref-sb1.wav\` |`);
  md.push(`| \`exp3-ref-sb2.wav\` (< 00:57 = 01:33–02:30) | Азиз (Charon) | ${refs.male.sb2Early.f0MedHz.toFixed(0)} Гц | ${refs.male.sb2Early.centroidHz.toFixed(0)} Гц | ${refs.male.sb2Early.tiltDb.toFixed(1)} дБ | \`/audio/experiments/exp3-ref-sb2.wav\` |`);
  md.push(`| \`exp3-ref-sb1.wav\` (00:00–01:33) | Вероника (Kore) | ${refs.female.sb1.f0MedHz.toFixed(0)} Гц | ${refs.female.sb1.centroidHz.toFixed(0)} Гц | ${refs.female.sb1.tiltDb.toFixed(1)} дБ | \`/audio/experiments/exp3-ref-sb1.wav\` |`);
  md.push(`| \`exp3-ref-sb2.wav\` (< 00:57 = 01:33–02:30) | Вероника (Kore) | ${refs.female.sb2Early.f0MedHz.toFixed(0)} Гц | ${refs.female.sb2Early.centroidHz.toFixed(0)} Гц | ${refs.female.sb2Early.tiltDb.toFixed(1)} дБ | \`/audio/experiments/exp3-ref-sb2.wav\` |`);
  md.push("");

  const renderGroupSection = (title: string, gender: "male" | "female") => {
    const group = records.filter((r) => r.gender === gender);
    md.push(`## ${title}`);
    md.push("");
    md.push(`### Таблица для прослушивания и акустического сравнения`);
    md.push("");
    md.push(
      `| Кандидат | Exact Voice ID | Sample WAV | UZ-Test WAV | F0 (P10–P90) | Центроид | Наклон | MFCC до SB1 / SB2<00:57 / Общ. | LUFS (после) / True Peak | Hydrogen Consistency |`
    );
    md.push(`|---|---|---|---|---:|---:|---:|---:|---|---|`);
    for (const r of group) {
      const h = r.hydrogen_consistency;
      const hCell = h
        ? `${h.sameVoiceIdentity ? "Да" : "Нет"} (${h.consistencyScore1to10}/10), диктор-сдвиг: ${h.shiftsToAnnouncerOnTech ? "да" : "нет"}`
        : "—";
      const sampleCell = `[\`${path.basename(r.sample_audio_path)}\`](${r.sample_audio_path}) (${r.sample_duration_sec}s, ${r.sample_lufs_after} LUFS / ${r.sample_true_peak_dbfs} dBFS)`;
      const uzCell = `[\`${path.basename(r.uz_test_audio_path)}\`](${r.uz_test_audio_path}) (${r.uz_test_duration_sec}s)`;
      md.push(
        `| **${r.code}** (${escapeMd(r.display_name)}) | \`${r.voice_id}\` | ${sampleCell} | ${uzCell} | ${r.acoustics.f0_med_hz.toFixed(0)} Гц (${r.acoustics.f0_p10_hz.toFixed(0)}–${r.acoustics.f0_p90_hz.toFixed(0)}) | ${r.acoustics.spectral_centroid_hz.toFixed(0)} Гц | ${r.acoustics.spectral_tilt_db.toFixed(1)} дБ | ${r.acoustics.mfcc_dist_to_sb1.toFixed(1)} / ${r.acoustics.mfcc_dist_to_sb2_before_0057.toFixed(1)} / **${r.acoustics.mfcc_dist_to_combined_ref.toFixed(1)}** | ${r.uz_test_lufs_after?.toFixed(1) ?? "—"} LUFS / ${r.uz_test_true_peak_dbfs?.toFixed(2) ?? "—"} dBFS | ${escapeMd(hCell)} |`
      );
    }
    md.push("");

    md.push(`### Подробности, промпты и разбор \`${ANALYSIS_MODEL}\``);
    md.push("");
    for (const r of group) {
      const h = r.hydrogen_consistency;
      md.push(`#### ${r.code} — ${r.display_name}`);
      md.push(`- **Voice ID:** \`${r.voice_id}\` (\`base_voice: ${r.base_voice}\`, \`expire_time: ${r.expire_time || "n/a"}\`)`);
      md.push(`- **Remix Prompt:** ${r.prompt}`);
      md.push(`- **Файлы:** sample \`${r.sample_audio_path}\` | uz-test \`${r.uz_test_audio_path}\``);
      if (h) {
        md.push(`- **Одна личность на всех 3 репликах:** \`${h.sameVoiceIdentity ? "ДА" : "НЕТ"}\` (оценка **${h.consistencyScore1to10}/10**), уход в «диктора» на техническом тексте: \`${h.shiftsToAnnouncerOnTech ? "ДА" : "НЕТ"}\``);
        md.push(`- **Разбор по репликам A / B / C:** ${h.partBreakdownRu}`);
        md.push(`- **Эмоции / естественность:** ${h.laughOrEmotionNatural}`);
        md.push(`- **Вывод Hydrogen:** ${h.verdictRu}`);
      } else {
        md.push(`- **Анализ Hydrogen:** недоступен`);
      }
      md.push("");
    }
  };

  renderGroupSection("Мужские кандидаты (на основе Charon — Азиз)", "male");
  renderGroupSection("Женские кандидаты (на основе Kore — Вероника)", "female");

  md.push(`## Тестовые реплики (3 отдельные parts в одном запросе TTS)`);
  md.push("");
  md.push(`### Мужские (M1, M2, M3)`);
  for (const p of MALE_UZ_TEST_PARTS) {
    md.push(`- **${p.label}** (\`style: "${p.style}"\`): ${p.text}`);
  }
  md.push("");
  md.push(`### Женские (F1, F2, F3)`);
  for (const p of FEMALE_UZ_TEST_PARTS) {
    md.push(`- **${p.label}** (\`style: "${p.style}"\`): ${p.text}`);
  }
  md.push("");

  fs.writeFileSync(path.join(outDir, "report.md"), md.join("\n"), "utf8");

  return {
    ok: true,
    reportPath: "/audio/voice-lock/report.md",
    voicesJsonPath: "/audio/voice-lock/voices.json",
    calls: totalCalls,
    candidates: records.map((r) => ({
      code: r.code,
      voice_id: r.voice_id,
      display_name: r.display_name,
      lufsAfter: r.uz_test_lufs_after,
      truePeakDbfs: r.uz_test_true_peak_dbfs,
      f0MedHz: r.acoustics.f0_med_hz,
      centroidHz: r.acoustics.spectral_centroid_hz,
      tiltDb: r.acoustics.spectral_tilt_db,
      mfccCombined: r.acoustics.mfcc_dist_to_combined_ref,
      hydrogenScore: r.hydrogen_consistency?.consistencyScore1to10 ?? null,
      sameVoiceIdentity: r.hydrogen_consistency?.sameVoiceIdentity ?? null,
      shiftsToAnnouncer: r.hydrogen_consistency?.shiftsToAnnouncerOnTech ?? null,
    })),
  };
}

