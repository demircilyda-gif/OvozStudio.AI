import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";
import ffmpegStatic from "ffmpeg-static";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import { DUBBING_MODELS_CONFIG } from "../../config/dubbingModels.ts";
import {
  extractRawPcm24k,
  buildWav24k,
  detectSilenceRuns,
  slicePcmByAlignmentSegments,
  sliceBatchPcmByVad,
  trimSilenceEdgesPcm,
  isFakeDubbingTtsEnabled,
  generateSyntheticBlockPcm,
  generateSyntheticTurnPcm,
  PCM_SAMPLE_RATE,
  PCM_BYTES_PER_SEC,
  type ParsedAlignmentRow,
  type SlicedTurnClip,
} from "./batchAudioSlicer.ts";
import {
  levelSubBlockClipsLoudness,
  measureIntegratedLufsPcm,
  measurePeakDbfsPcm,
  measureTruePeakDbfsPcm,
} from "./loudnessLeveler.ts";
import {
  extractVoiceLockSafeEmotion,
  prepareTurnTextForTts,
  VOICE_LOCK_ALLOWED_STYLES,
} from "../../../src/utils/dubbingStyle.ts";
import {
  normalizePronunciationDictionary,
  type PronunciationDictionaryEntry,
} from "../../../src/utils/pronunciationDictionary.ts";
import { countSyllables } from "../verbatimStoryboardService.ts";
import { recordGoogleTtsCalls, getTtsQuotaStatus } from "../tts/ttsQuotaTracker.ts";
import {
  type BatchInputTurn,
  type BatchSynthesizedTurnResult,
  type ResolvedBatchSpeaker,
  type SpeakerVoiceType,
  type TurnQaStatus,
  buildSingleSpeakerVoiceConfig,
  emitTtsPayloadObservation,
  evaluateSubBlockQa,
  fitSlicedTurnToTimecode,
  isStoredVoiceId,
  resolveEffectiveVoiceType,
  stripLegacyPauseArtifacts,
  validateStoredVoiceBeforeTts,
  type ValidatedStoredVoiceInfo,
} from "./batchDialogueEngine.ts";

export const VOICE_LOCK_PIPELINE_VERSION = "voice-lock-v1";
export const VOICE_LOCK_MAX_SPEECH_SEC_PER_SPEAKER = 600;
export const VOICE_LOCK_MAX_TOKENS_PER_SPEAKER = 7500;
export const VOICE_LOCK_CACHE_DIR = path.resolve(process.cwd(), "data", "voice-lock-cache");

function ensureVoiceLockCacheDir() {
  if (!fs.existsSync(VOICE_LOCK_CACHE_DIR)) {
    fs.mkdirSync(VOICE_LOCK_CACHE_DIR, { recursive: true });
  }
}

export interface VoiceLockAcousticsSegment {
  label: "beginning" | "middle" | "end";
  startSec: number;
  endSec: number;
  durSec: number;
  f0MedHz: number;
  f0P10Hz: number;
  f0P90Hz: number;
  centroidHz: number;
  tiltDb: number;
  hnrProxy: number;
  mfcc: number[];
}

export interface VoiceLockIdentityQaResult {
  sameSpeakerBeginning: boolean;
  sameSpeakerMiddle: boolean;
  sameSpeakerEnd: boolean;
  driftDetected: boolean;
  confidence: number;
  explanationRu: string;
  passed: boolean;
  usedApiCall: boolean;
}

export interface VoiceLockTurnAlignmentDetail {
  turnId: string;
  globalIndex: number;
  speakerTurnIndex: number;
  startSec: number;
  endSec: number;
  spokenText: string;
  found: boolean;
  confidence: number;
  method: string;
  boundarySnapped: boolean;
  boundaryIssue?: string;
  sentText: string;
  sentStyle: string;
  lufsBefore: number | null;
  lufsAfter: number | null;
  truePeakAfterDbfs: number | null;
}

export interface VoiceLockSpeakerTrackReport {
  speakerId: string;
  speakerName: string;
  gender: "male" | "female";
  voiceType: SpeakerVoiceType;
  voiceId: string;
  identityVersion: string;
  cacheKey: string;
  fromCache: boolean;
  status: "ok" | "failed";
  failureReasons: string[];
  turnCount: number;
  partsSentCount: number;
  expectedSpeechSec: number;
  estimatedTokens: number;
  rawDurationSec: number;
  ttsCallsUsed: number;
  alignmentCallsUsed: number;
  identityQaCallsUsed: number;
  ttsWallTimeMs: number;
  alignmentWallTimeMs: number;
  identityQaWallTimeMs: number;
  rawPcm: Buffer;
  rawWavBuffer: Buffer;
  sentStyles: Array<{ turnId: string; globalIndex: number; intonationRu: string; style: string }>;
  turnDetails: VoiceLockTurnAlignmentDetail[];
  acoustics: {
    beginning: VoiceLockAcousticsSegment;
    middle: VoiceLockAcousticsSegment;
    end: VoiceLockAcousticsSegment;
    mfccDistBegMid: number;
    mfccDistBegEnd: number;
    mfccDistMidEnd: number;
  };
  identityQa: VoiceLockIdentityQaResult;
}

export interface VoiceLockExecutionResult {
  voiceLockMode: "full_speaker_tracks";
  overallSuccess: boolean;
  identityQaPassed: boolean;
  turns: BatchSynthesizedTurnResult[];
  speakerTracks: VoiceLockSpeakerTrackReport[];
  ttsCallsUsed: number;
  alignmentCallsUsed: number;
  identityQaCallsUsed: number;
  transcribeCallsUsed: number;
  ttsWallTimeMs: number;
  alignWallTimeMs: number;
  provider: "google" | "cache" | "fake" | "mixed";
  modeUsed: "voice_lock_full_speaker_tracks";
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
// FAKE TEST HOOKS (used only in automated tests with DUBBING_FAKE_TTS=1)
// =========================================================================

export interface VoiceLockFakeFault {
  failAlignmentForSpeaker?: boolean;
  failTurnIndex?: number;
  failIdentityQa?: boolean;
  overrideIdentityQa?: Partial<VoiceLockIdentityQaResult>;
}

type VoiceLockFakeFaultInjector = (ctx: {
  speaker: ResolvedBatchSpeaker;
  turns: BatchInputTurn[];
}) => VoiceLockFakeFault | null;

let voiceLockFakeFaultInjector: VoiceLockFakeFaultInjector | null = null;
export function setVoiceLockFakeFaultInjectorForTesting(fn: VoiceLockFakeFaultInjector | null) {
  voiceLockFakeFaultInjector = fn;
}

// =========================================================================
// AUDIO HELPERS (16kHz downsampler for Hydrogen uploads + local DSP metrics)
// =========================================================================

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

function decodeAudioBytesToPcm24kMono(rawBytes: Buffer, mimeType?: string): Buffer {
  const mime = String(mimeType || "").toLowerCase();
  if (rawBytes.length >= 44 && rawBytes.subarray(0, 4).toString("ascii") === "RIFF") {
    const sampleRate = rawBytes.readUInt32LE(24);
    const channels = rawBytes.readUInt16LE(22);
    const bitsPerSample = rawBytes.readUInt16LE(34);
    if (sampleRate === PCM_SAMPLE_RATE && channels === 1 && bitsPerSample === 16) {
      return extractRawPcm24k(rawBytes);
    }
  }
  if (mime.includes("l16") || mime.includes("pcm")) {
    return rawBytes.length % 2 === 0 ? rawBytes : rawBytes.subarray(0, rawBytes.length - 1);
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ovoz-vlock2-"));
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
      ["-y", "-i", inPath, "-ac", "1", "-ar", String(PCM_SAMPLE_RATE), "-f", "s16le", outPath],
      { stdio: "ignore" }
    );
    return fs.readFileSync(outPath);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function buildWavWithRate(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  const dataSize = pcm.length;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
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
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * Downsamples 24kHz mono 16-bit PCM to 16kHz mono WAV (exact 3:2 linear resampling)
 * strictly for compact Gemini inlineData uploads to Hydrogen (keeps timing 100% identical,
 * while all audio slicing stays on full-resolution 24kHz PCM).
 */
function buildCompact16kWavFromPcm24k(pcm24k: Buffer): Buffer {
  const nIn = Math.floor(pcm24k.length / 2);
  const nOut = Math.max(1, Math.floor((nIn * 16000) / 24000));
  const out = Buffer.alloc(nOut * 2);
  for (let i = 0; i < nOut; i++) {
    const srcPos = (i * 24000) / 16000;
    const idx0 = Math.min(nIn - 1, Math.floor(srcPos));
    const idx1 = Math.min(nIn - 1, idx0 + 1);
    const frac = srcPos - idx0;
    const s0 = pcm24k.readInt16LE(idx0 * 2);
    const s1 = pcm24k.readInt16LE(idx1 * 2);
    const v = Math.round(s0 + (s1 - s0) * frac);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, v)), i * 2);
  }
  return buildWavWithRate(out, 16000);
}

// Local acoustics DSP (F0, centroid, spectral tilt, 12-dim MFCC) — informational metrics
const FFT_N = 512;
const FFT_BINS = FFT_N / 2 + 1;
const N_MELS = 26;
const N_MFCC = 13;
const HANN = new Float32Array(FFT_N);
for (let i = 0; i < FFT_N; i++) HANN[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_N - 1)));

function hzToMel(hz: number) {
  return 2595 * Math.log10(1 + hz / 700);
}
function melToHz(mel: number) {
  return 700 * (Math.pow(10, mel / 2595) - 1);
}
const MEL_FILTERS: Float64Array[] = (() => {
  const melMin = hzToMel(80);
  const melMax = hzToMel(7600);
  const pts: number[] = [];
  for (let i = 0; i < N_MELS + 2; i++) {
    pts.push(melToHz(melMin + (i * (melMax - melMin)) / (N_MELS + 1)));
  }
  const bins = pts.map((hz) => Math.floor(((FFT_N + 1) * hz) / PCM_SAMPLE_RATE));
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

function medianPos(vals: number[]): number {
  const clean = vals.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (clean.length === 0) return 0;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 === 1 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

export function analyzeVoiceLockSegmentAcoustics(
  pcm: Buffer,
  gender: "male" | "female",
  label: "beginning" | "middle" | "end",
  startSec: number,
  endSec: number
): VoiceLockAcousticsSegment {
  const n = Math.floor(pcm.length / 2);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = pcm.readInt16LE(i * 2) / 32768;

  const pe = new Float32Array(n);
  if (n > 0) pe[0] = s[0];
  for (let i = 1; i < n; i++) pe[i] = s[i] - 0.97 * s[i - 1];

  const win = 960;
  const hop = 240;
  const minLag = Math.floor(PCM_SAMPLE_RATE / (gender === "male" ? 240 : 380));
  const maxLag = Math.floor(PCM_SAMPLE_RATE / (gender === "male" ? 70 : 125));

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
      f0s.push(PCM_SAMPLE_RATE / bestLag);
    }
    hnrSum += bestCorr;
    hnrCount++;

    if (fi % 2 === 0 && off + FFT_N <= n) {
      const reRaw = new Float64Array(FFT_N);
      const imRaw = new Float64Array(FFT_N);
      for (let i = 0; i < FFT_N; i++) reRaw[i] = s[off + i] * HANN[i];
      radix2Fft(reRaw, imRaw);
      for (let k = 1; k < FFT_BINS; k++) {
        const hz = (k * PCM_SAMPLE_RATE) / FFT_N;
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
    label,
    startSec: Math.round(startSec * 100) / 100,
    endSec: Math.round(endSec * 100) / 100,
    durSec: Math.round((n / PCM_SAMPLE_RATE) * 100) / 100,
    f0MedHz: Math.round(medianPos(f0s) * 10) / 10,
    f0P10Hz: f0s.length ? Math.round(f0s[Math.floor(f0s.length * 0.1)] * 10) / 10 : 0,
    f0P90Hz: f0s.length ? Math.round(f0s[Math.floor(f0s.length * 0.9)] * 10) / 10 : 0,
    centroidHz: centDen > 0 ? Math.round(centNum / centDen) : 0,
    tiltDb: Math.round(10 * Math.log10((highEnergy + 1e-12) / (lowEnergy + 1e-12)) * 100) / 100,
    hnrProxy: hnrCount > 0 ? Math.round((hnrSum / hnrCount) * 1000) / 1000 : 0,
    mfcc,
  };
}

function mfccDistance(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.round(Math.sqrt(s) * 100) / 100;
}

function extractPcmWindowSec(pcm: Buffer, startSec: number, endSec: number): Buffer {
  const totalSamples = Math.floor(pcm.length / 2);
  const s0 = Math.max(0, Math.min(totalSamples, Math.floor(startSec * PCM_SAMPLE_RATE)));
  const s1 = Math.max(s0, Math.min(totalSamples, Math.floor(endSec * PCM_SAMPLE_RATE)));
  return Buffer.from(pcm.subarray(s0 * 2, s1 * 2));
}

// =========================================================================
// WHOLE-SPEAKER VOICE LOCK CACHE (COMPLETELY SEPARATE FROM SUB-BLOCK CACHE)
// =========================================================================

export function computeVoiceLockSpeakerCacheHash(params: {
  voiceId: string;
  voiceType: SpeakerVoiceType;
  identityVersion: string;
  model: string;
  parts: Array<{ turnId: string; text: string; style: string }>;
  pronunciationDictionary?: ReadonlyArray<Partial<PronunciationDictionaryEntry>> | null;
  pipelineVersion?: string;
}): string {
  const cleanDict = normalizePronunciationDictionary(params.pronunciationDictionary || []);
  const payload = {
    cacheNamespace: "voice_lock_full_speaker_track",
    pipelineVersion: params.pipelineVersion || VOICE_LOCK_PIPELINE_VERSION,
    voiceId: String(params.voiceId || "").trim(),
    voiceType: params.voiceType,
    identityVersion: String(params.identityVersion || "").trim(),
    model: params.model,
    pronunciationDictionary: cleanDict,
    parts: params.parts.map((p) => ({
      turnId: p.turnId,
      text: p.text,
      style: p.style,
    })),
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 28);
}

interface CachedVoiceLockSpeakerTrack {
  v: 1;
  pipelineVersion: string;
  cacheKey: string;
  voiceId: string;
  voiceType: SpeakerVoiceType;
  identityVersion: string;
  model: string;
  savedAt: string;
  rawPcmBase64: string;
  clipsBase64: string[];
  turnDetails: VoiceLockTurnAlignmentDetail[];
  acoustics: VoiceLockSpeakerTrackReport["acoustics"];
  identityQa: VoiceLockIdentityQaResult;
}

function loadCachedVoiceLockSpeakerTrack(
  cacheKey: string,
  expectedCount: number,
  expectedVoiceId: string,
  expectedIdentityVersion: string
): CachedVoiceLockSpeakerTrack | null {
  try {
    const filePath = path.join(VOICE_LOCK_CACHE_DIR, `${cacheKey}.json`);
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<CachedVoiceLockSpeakerTrack>;
    if (
      parsed?.v !== 1 ||
      parsed.pipelineVersion !== VOICE_LOCK_PIPELINE_VERSION ||
      parsed.cacheKey !== cacheKey ||
      parsed.voiceId !== expectedVoiceId ||
      parsed.identityVersion !== expectedIdentityVersion ||
      !parsed.identityQa?.passed ||
      !Array.isArray(parsed.clipsBase64) ||
      parsed.clipsBase64.length !== expectedCount ||
      !Array.isArray(parsed.turnDetails) ||
      parsed.turnDetails.length !== expectedCount ||
      typeof parsed.rawPcmBase64 !== "string"
    ) {
      return null;
    }
    return parsed as CachedVoiceLockSpeakerTrack;
  } catch {
    return null;
  }
}

function saveCachedVoiceLockSpeakerTrack(entry: CachedVoiceLockSpeakerTrack): boolean {
  try {
    if (!entry.identityQa?.passed) return false;
    ensureVoiceLockCacheDir();
    const filePath = path.join(VOICE_LOCK_CACHE_DIR, `${entry.cacheKey}.json`);
    fs.writeFileSync(filePath, JSON.stringify(entry), "utf8");
    return true;
  } catch {
    return false;
  }
}

// =========================================================================
// WHOLE-SPEAKER ALIGNMENT (gemini-4-hydrogen)
// =========================================================================

async function alignWholeSpeakerTrackWithHydrogen(
  ai: GoogleGenAI,
  params: {
    rawPcm: Buffer;
    speaker: ResolvedBatchSpeaker;
    turns: Array<{
      turnId: string;
      globalIndex: number;
      text: string;
      style: string;
    }>;
    fakeFault?: VoiceLockFakeFault | null;
  }
): Promise<{
  clips: Array<SlicedTurnClip | null>;
  rows: Array<{
    turnId: string;
    index: number;
    startSec: number;
    endSec: number;
    spokenText: string;
    found: boolean;
    confidence: number;
    boundarySnapped: boolean;
    boundaryIssue?: string;
  }>;
  usedApiCall: boolean;
  wallTimeMs: number;
  error?: string;
}> {
  const t0 = Date.now();
  const { rawPcm, speaker, turns, fakeFault } = params;
  const totalSamples = Math.floor(rawPcm.length / 2);
  const totalDurationSec = totalSamples / PCM_SAMPLE_RATE;
  const gender = speaker.gender || "male";
  const silenceMinMs = 120;
  const snapToleranceSec = 0.6;

  const silenceCandidates = detectSilenceRuns(rawPcm, {
    frameMs: 10,
    minSilenceMs: silenceMinMs,
  });

  // Fake mode for automated tests (DUBBING_FAKE_TTS=1)
  if (isFakeDubbingTtsEnabled()) {
    if (fakeFault?.failAlignmentForSpeaker) {
      return {
        clips: turns.map(() => null),
        rows: turns.map((t, idx) => ({
          turnId: t.turnId,
          index: idx,
          startSec: 0,
          endSec: 0,
          spokenText: "",
          found: false,
          confidence: 0,
          boundarySnapped: false,
          boundaryIssue: `simulated_alignment_failure (speaker ${speaker.speakerId})`,
        })),
        usedApiCall: false,
        wallTimeMs: Date.now() - t0,
        error: `Simulated alignment failure for ${speaker.speakerName}`,
      };
    }

    const vad = sliceBatchPcmByVad(
      rawPcm,
      turns.map((t) => t.text),
      { minSilenceMs: silenceMinMs }
    );

    if (vad.clips.length !== turns.length) {
      return {
        clips: turns.map(() => null),
        rows: turns.map((t, idx) => ({
          turnId: t.turnId,
          index: idx,
          startSec: 0,
          endSec: 0,
          spokenText: "",
          found: false,
          confidence: 0,
          boundarySnapped: false,
          boundaryIssue: `vad_pause_mismatch (${vad.clips.length}/${turns.length})`,
        })),
        usedApiCall: false,
        wallTimeMs: Date.now() - t0,
        error: `Fake alignment could not slice all ${turns.length} turns`,
      };
    }

    const clips: Array<SlicedTurnClip | null> = [];
    const rows: Array<{
      turnId: string;
      index: number;
      startSec: number;
      endSec: number;
      spokenText: string;
      found: boolean;
      confidence: number;
      boundarySnapped: boolean;
      boundaryIssue?: string;
    }> = [];

    for (let i = 0; i < turns.length; i++) {
      if (fakeFault?.failTurnIndex === i) {
        clips.push(null);
        rows.push({
          turnId: turns[i].turnId,
          index: i,
          startSec: 0,
          endSec: 0,
          spokenText: "",
          found: false,
          confidence: 0,
          boundarySnapped: false,
          boundaryIssue: `simulated_missing_turn (${turns[i].turnId})`,
        });
        continue;
      }
      const c = vad.clips[i];
      const cleanSpoken = turns[i].text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      clips.push({
        ...c,
        method: "transcribe_aligned",
        spokenText: cleanSpoken,
        detectedVoice: gender,
        boundarySnapped: true,
      });
      rows.push({
        turnId: turns[i].turnId,
        index: i,
        startSec: Math.round((c.startMs / 1000) * 1000) / 1000,
        endSec: Math.round((c.endMs / 1000) * 1000) / 1000,
        spokenText: cleanSpoken,
        found: true,
        confidence: 0.99,
        boundarySnapped: true,
      });
    }

    return {
      clips,
      rows,
      usedApiCall: false,
      wallTimeMs: Date.now() - t0,
    };
  }

  // Live Gemini 4 Hydrogen alignment (1 call for the whole speaker track)
  const rawWavSizeBytes = rawPcm.length + 44;
  // Use 16kHz WAV for Hydrogen upload when 24kHz WAV > 10MB to keep inlineData compact & reliable;
  // slicing ALWAYS uses full-resolution 24kHz rawPcm!
  const uploadWav =
    rawWavSizeBytes > 10 * 1024 * 1024 ? buildCompact16kWavFromPcm24k(rawPcm) : buildWav24k(rawPcm);

  const turnListText = turns
    .map((t, i) => {
      const cleanBody = t.text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const laughNote = /<\s*laugh\s*>/i.test(t.text) ? " (ends with laughter)" : "";
      return `${i} | ${t.turnId} | ${cleanBody}${laughNote}`;
    })
    .join("\n");

  const silenceSummary =
    silenceCandidates.length > 0
      ? silenceCandidates
          .slice(0, 250)
          .map(
            (s) =>
              `${(s.startMs / 1000).toFixed(2)}–${(s.endMs / 1000).toFixed(2)}s (${s.durationMs}ms)`
          )
          .join(", ")
      : "none detected";

  const prompt = `Listen carefully to this ${totalDurationSec.toFixed(2)}-second single-speaker Uzbek audio track spoken by ${speaker.speakerName} (${gender}).
Align ALL ${turns.length} scripted lines below in exact ascending order.

DETECTED PCM SILENCE PAUSES (>= ${silenceMinMs}ms):
${silenceSummary}

STRICT RULES:
- Return every index from 0 to ${turns.length - 1} once in ascending order with its exact turnId.
- startSec and endSec are decimal seconds within [0.00, ${totalDurationSec.toFixed(2)}], covering the complete utterance without cutting off the first or last word.
- Snap inter-turn boundaries to real silence pauses from the list above whenever a pause separates two turns.
- If a line is marked "(ends with laughter)", include the laughter inside that line's [startSec, endSec], and start the NEXT line strictly at its first spoken word (do NOT include the silence gap after laughter in either line).
- Timestamps MUST be strictly non-overlapping and monotonically ascending: next startSec >= previous endSec.
- spokenText MUST transcribe VERBATIM what was actually spoken in Uzbek in that interval.
- confidence is a number in [0.0, 1.0] expressing alignment certainty.
- If a scripted line is completely missing/skipped in the audio, set found=false, startSec=0, endSec=0, spokenText="", confidence=0.

SCRIPTED LINES (index | turnId | expected Uzbek text):
${turnListText}`;

  const alignmentModel = DUBBING_MODELS_CONFIG.audioAlignmentModel; // gemini-4-hydrogen
  const response = await ai.models.generateContent({
    model: alignmentModel,
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType: "audio/wav",
              data: uploadWav.toString("base64"),
            },
          },
          { text: prompt },
        ],
      },
    ],
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      maxOutputTokens: 16384,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          turns: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                index: { type: Type.INTEGER },
                turnId: { type: Type.STRING },
                startSec: { type: Type.NUMBER },
                endSec: { type: Type.NUMBER },
                spokenText: { type: Type.STRING },
                found: { type: Type.BOOLEAN },
                confidence: { type: Type.NUMBER },
              },
              required: ["index", "turnId", "startSec", "endSec", "spokenText", "found", "confidence"],
            },
          },
        },
        required: ["turns"],
      },
    },
  });

  const rawText = String(response.text || "").trim();
  const segMap = new Map<number, ParsedAlignmentRow>();
  const confMap = new Map<number, number>();
  let parseError: string | undefined;

  try {
    const unfenced = rawText
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const parsed = JSON.parse(unfenced);
    const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.turns) ? parsed.turns : [];
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      let idx = typeof item.index === "number" ? Math.trunc(item.index) : parseInt(String(item.index), 10);
      if (!Number.isFinite(idx) || idx < 0 || idx >= turns.length) {
        // fallback lookup by turnId
        const byId = turns.findIndex((t) => t.turnId === String(item.turnId || ""));
        if (byId >= 0) idx = byId;
      }
      if (!Number.isFinite(idx) || idx < 0 || idx >= turns.length) continue;
      const s0 = Number(item.startSec);
      const s1 = Number(item.endSec);
      if (!Number.isFinite(s0) || !Number.isFinite(s1)) continue;
      const found = Boolean(item.found) && s1 > s0;
      const spokenText = String(item.spokenText || "").trim();
      const conf = Number.isFinite(Number(item.confidence))
        ? Math.max(0, Math.min(1, Number(item.confidence)))
        : found
          ? 0.85
          : 0;
      segMap.set(idx, {
        startSec: s0,
        endSec: s1,
        found,
        voice: gender,
        spokenText,
      });
      confMap.set(idx, conf);
    }
    if (segMap.size === 0) {
      parseError = `hydrogen_alignment_empty (${rawText.slice(0, 120)})`;
    }
  } catch (err: any) {
    parseError = `hydrogen_alignment_json_error: ${err?.message || err}`;
  }

  const expectedForSlicer = turns.map((t, i) => ({
    index: i,
    speaker: speaker.speakerName,
    text: t.text,
    gender,
  }));

  const sliced = slicePcmByAlignmentSegments(rawPcm, expectedForSlicer, segMap, {
    silenceCandidates,
    silenceMinMs,
    snapToleranceSec,
  });

  const rows = turns.map((t, i) => {
    const alignInfo = sliced.turnAlignments[i];
    return {
      turnId: t.turnId,
      index: i,
      startSec: alignInfo?.startSec ?? 0,
      endSec: alignInfo?.endSec ?? 0,
      spokenText: alignInfo?.spokenText ?? "",
      found: Boolean(alignInfo?.found),
      confidence: confMap.get(i) ?? (alignInfo?.found ? 0.8 : 0),
      boundarySnapped: Boolean(alignInfo?.boundarySnapped),
      boundaryIssue: alignInfo?.boundaryIssue,
    };
  });

  return {
    clips: sliced.clips,
    rows,
    usedApiCall: true,
    wallTimeMs: Date.now() - t0,
    error: parseError,
  };
}

// =========================================================================
// VOICE IDENTITY QA (gemini-4-hydrogen: sample_audio vs begin/mid/end 30s)
// =========================================================================

async function runVoiceIdentityQaWithHydrogen(
  ai: GoogleGenAI,
  params: {
    speaker: ResolvedBatchSpeaker;
    validatedVoice: ValidatedStoredVoiceInfo;
    rawPcm: Buffer;
    fakeFault?: VoiceLockFakeFault | null;
  }
): Promise<{
  identityQa: VoiceLockIdentityQaResult;
  acoustics: VoiceLockSpeakerTrackReport["acoustics"];
  wallTimeMs: number;
}> {
  const t0 = Date.now();
  const { speaker, validatedVoice, rawPcm, fakeFault } = params;
  const gender = speaker.gender || "male";
  const totalDurSec = rawPcm.length / PCM_BYTES_PER_SEC;

  // Extract beginning 30s, middle 30s, end 30s windows from speaker's raw track
  const winSec = Math.min(30, Math.max(1, totalDurSec));
  const begStart = 0;
  const begEnd = Math.min(totalDurSec, winSec);

  const midCenter = totalDurSec / 2;
  const midStart = Math.max(0, midCenter - winSec / 2);
  const midEnd = Math.min(totalDurSec, midStart + winSec);

  const endStart = Math.max(0, totalDurSec - winSec);
  const endEnd = totalDurSec;

  const begPcm = extractPcmWindowSec(rawPcm, begStart, begEnd);
  const midPcm = extractPcmWindowSec(rawPcm, midStart, midEnd);
  const endPcm = extractPcmWindowSec(rawPcm, endStart, endEnd);

  const begAc = analyzeVoiceLockSegmentAcoustics(begPcm, gender, "beginning", begStart, begEnd);
  const midAc = analyzeVoiceLockSegmentAcoustics(midPcm, gender, "middle", midStart, midEnd);
  const endAc = analyzeVoiceLockSegmentAcoustics(endPcm, gender, "end", endStart, endEnd);

  const acoustics: VoiceLockSpeakerTrackReport["acoustics"] = {
    beginning: begAc,
    middle: midAc,
    end: endAc,
    mfccDistBegMid: mfccDistance(begAc.mfcc, midAc.mfcc),
    mfccDistBegEnd: mfccDistance(begAc.mfcc, endAc.mfcc),
    mfccDistMidEnd: mfccDistance(midAc.mfcc, endAc.mfcc),
  };

  if (isFakeDubbingTtsEnabled()) {
    const failed = Boolean(fakeFault?.failIdentityQa);
    const ov = fakeFault?.overrideIdentityQa || {};
    const sameSpeakerBeginning = ov.sameSpeakerBeginning ?? !failed;
    const sameSpeakerMiddle = ov.sameSpeakerMiddle ?? !failed;
    const sameSpeakerEnd = ov.sameSpeakerEnd ?? !failed;
    const driftDetected = ov.driftDetected ?? failed;
    const passed =
      sameSpeakerBeginning && sameSpeakerMiddle && sameSpeakerEnd && !driftDetected;
    return {
      identityQa: {
        sameSpeakerBeginning,
        sameSpeakerMiddle,
        sameSpeakerEnd,
        driftDetected,
        confidence: ov.confidence ?? (passed ? 0.96 : 0.35),
        explanationRu:
          ov.explanationRu ??
          (passed
            ? `Тестовая проверка идентичности пройдена (${speaker.voiceId}).`
            : `Обнаружен дрейф/смена голоса в тестовом режиме (${speaker.voiceId}).`),
        passed,
        usedApiCall: false,
      },
      acoustics,
      wallTimeMs: Date.now() - t0,
    };
  }

  // Decode sample_audio from ai.voices.get(voiceId) (must exist for reference comparison)
  let sampleWav16k: Buffer | null = null;
  if (validatedVoice.sampleAudioBytes && validatedVoice.sampleAudioBytes.length > 0) {
    const samplePcm24k = decodeAudioBytesToPcm24kMono(
      validatedVoice.sampleAudioBytes,
      validatedVoice.sampleAudioMimeType
    );
    sampleWav16k = buildCompact16kWavFromPcm24k(samplePcm24k);
  }

  const begWav16k = buildCompact16kWavFromPcm24k(begPcm);
  const midWav16k = buildCompact16kWavFromPcm24k(midPcm);
  const endWav16k = buildCompact16kWavFromPcm24k(endPcm);

  const parts: any[] = [];
  if (sampleWav16k) {
    parts.push({ text: "AUDIO 1 — REFERENCE VOICE SAMPLE (stored persistent voice sample_audio):" });
    parts.push({ inlineData: { mimeType: "audio/wav", data: sampleWav16k.toString("base64") } });
  }
  parts.push({
    text: `AUDIO ${sampleWav16k ? "2" : "1"} — BEGINNING SEGMENT (${begStart.toFixed(1)}s–${begEnd.toFixed(1)}s of track):`,
  });
  parts.push({ inlineData: { mimeType: "audio/wav", data: begWav16k.toString("base64") } });

  parts.push({
    text: `AUDIO ${sampleWav16k ? "3" : "2"} — MIDDLE SEGMENT (${midStart.toFixed(1)}s–${midEnd.toFixed(1)}s of track):`,
  });
  parts.push({ inlineData: { mimeType: "audio/wav", data: midWav16k.toString("base64") } });

  parts.push({
    text: `AUDIO ${sampleWav16k ? "4" : "3"} — END SEGMENT (${endStart.toFixed(1)}s–${endEnd.toFixed(1)}s of track):`,
  });
  parts.push({ inlineData: { mimeType: "audio/wav", data: endWav16k.toString("base64") } });

  parts.push({
    text: `You are an audio forensic voice-identity verifier for an Uzbek video dubbing track of speaker "${speaker.speakerName}" (${gender}, persistent voiceId=${speaker.voiceId}).
Compare the speaker identity (vocal timbre, resonance, core person identity — NOT normal emotional pitch/energy variation!) across ${
      sampleWav16k
        ? "the REFERENCE VOICE SAMPLE and the BEGINNING, MIDDLE, and END 30-second segments"
        : "the BEGINNING, MIDDLE, and END 30-second segments"
    }.

IMPORTANT DISTINCTION:
- Natural emotional inflection (smiling, mild excitement, softer phrasing, curious questioning) is EXPECTED and is STILL THE SAME SPEAKER.
- Flag driftDetected=true or sameSpeaker*=false ONLY if the voice noticeably changes into a different person, switches gender, or shifts dramatically into a heavy formal news-announcer / different vocal identity.

Return strictly JSON matching the schema with a concise Russian explanation in explanationRu.`,
  });

  const resp = await ai.models.generateContent({
    model: DUBBING_MODELS_CONFIG.audioAlignmentModel, // gemini-4-hydrogen
    contents: [{ role: "user", parts }],
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          sameSpeakerBeginning: { type: Type.BOOLEAN },
          sameSpeakerMiddle: { type: Type.BOOLEAN },
          sameSpeakerEnd: { type: Type.BOOLEAN },
          driftDetected: { type: Type.BOOLEAN },
          confidence: { type: Type.NUMBER },
          explanationRu: { type: Type.STRING },
        },
        required: [
          "sameSpeakerBeginning",
          "sameSpeakerMiddle",
          "sameSpeakerEnd",
          "driftDetected",
          "confidence",
          "explanationRu",
        ],
      },
    },
  });

  const rawText = String(resp.text || "{}")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const parsed = JSON.parse(rawText);

  const sameSpeakerBeginning = Boolean(parsed.sameSpeakerBeginning);
  const sameSpeakerMiddle = Boolean(parsed.sameSpeakerMiddle);
  const sameSpeakerEnd = Boolean(parsed.sameSpeakerEnd);
  const driftDetected = Boolean(parsed.driftDetected);
  const confidence = Number.isFinite(Number(parsed.confidence))
    ? Math.max(0, Math.min(1, Number(parsed.confidence)))
    : 0;
  const explanationRu = String(parsed.explanationRu || "").trim() || "Нет пояснения.";
  const passed =
    sameSpeakerBeginning && sameSpeakerMiddle && sameSpeakerEnd && !driftDetected;

  return {
    identityQa: {
      sameSpeakerBeginning,
      sameSpeakerMiddle,
      sameSpeakerEnd,
      driftDetected,
      confidence: Math.round(confidence * 100) / 100,
      explanationRu,
      passed,
      usedApiCall: true,
    },
    acoustics,
    wallTimeMs: Date.now() - t0,
  };
}

// =========================================================================
// MAIN VOICE LOCK ENTRY POINT (`voiceLockMode: "full_speaker_tracks"`)
// =========================================================================

export async function synthesizeDialogueInVoiceLockMode(
  ai: GoogleGenAI,
  params: {
    turns: BatchInputTurn[];
    speakerMap: Map<string, ResolvedBatchSpeaker>;
    strictTimeWindow: boolean;
    useDeliveryEmotions?: boolean;
    pronunciationDictionary?: ReadonlyArray<Partial<PronunciationDictionaryEntry>> | null;
    bypassCache?: boolean;
    /** Optional: regenerate ONLY this speaker's full track (1 TTS call) */
    onlySpeakerId?: string;
  }
): Promise<VoiceLockExecutionResult> {
  const {
    turns: rawInputTurns,
    speakerMap,
    strictTimeWindow,
    useDeliveryEmotions = true,
    pronunciationDictionary,
    bypassCache = false,
    onlySpeakerId,
  } = params;

  // 1. Validate preconditions: time-aligned script + persistent voice_... speakers ONLY
  if (!strictTimeWindow) {
    throw new Error(
      "Режим Voice Lock (full_speaker_tracks) работает только для сценария с точными таймкодами (time_aligned)."
    );
  }
  if (!Array.isArray(rawInputTurns) || rawInputTurns.length === 0) {
    throw new Error("Список реплик для Voice Lock пуст.");
  }
  const missingTcIdx = rawInputTurns.findIndex(
    (t) => typeof t.startSec !== "number" || !Number.isFinite(t.startSec)
  );
  if (missingTcIdx !== -1) {
    throw new Error(
      `Режим Voice Lock требует таймкод начала (startSec) у каждой реплики (отсутствует у #${missingTcIdx + 1}).`
    );
  }

  // Group turns by speakerId in exact original script order
  const speakerTurnGroups = new Map<string, BatchInputTurn[]>();
  const speakerOrder: string[] = [];
  for (const t of rawInputTurns) {
    const spId = t.speakerId || "HOST_1";
    if (!speakerTurnGroups.has(spId)) {
      speakerTurnGroups.set(spId, []);
      speakerOrder.push(spId);
    }
    speakerTurnGroups.get(spId)!.push(t);
  }

  const targetSpeakerIds = onlySpeakerId
    ? speakerOrder.filter((id) => id === onlySpeakerId)
    : speakerOrder;

  if (onlySpeakerId && targetSpeakerIds.length === 0) {
    throw new Error(`Спикер ${onlySpeakerId} не найден в сценарии для перегенерации трека Voice Lock.`);
  }

  if (!onlySpeakerId && speakerOrder.length !== 2) {
    throw new Error(
      `Режим Voice Lock (full_speaker_tracks) работает только с 2 постоянными спикерами (найдено спикеров: ${speakerOrder.length}).`
    );
  }

  // Strictly validate EVERY target speaker has persistent voice_... ID (never prebuilt, never fallback)
  const validatedVoicesBySpeaker = new Map<string, ValidatedStoredVoiceInfo>();
  for (const spId of targetSpeakerIds) {
    const sp = speakerMap.get(spId);
    if (!sp) {
      throw new Error(`Не найден профиль голоса для спикера ${spId}.`);
    }
    const vt = resolveEffectiveVoiceType(sp);
    const vid = String(sp.voiceId || "").trim();
    if ((vt !== "prompted" && vt !== "replicated") || !isStoredVoiceId(vid)) {
      throw new Error(
        `Режим Voice Lock требует постоянный сохранённый голос (voice_...) для спикера «${sp.speakerName}» (получено voiceType=${vt}, voiceId="${vid}"). Подмена на Charon/Kore запрещена.`
      );
    }
    const validated = await validateStoredVoiceBeforeTts(ai, sp, { forceFresh: true });
    if (!validated) {
      throw new Error(`Не удалось проверить сохранённый голос ${vid} для спикера «${sp.speakerName}».`);
    }
    validatedVoicesBySpeaker.set(spId, validated);
  }

  // 2. Prepare per-speaker texts (pronunciation dict -> Uzbek normalizer -> <laugh>) & safe single-emotion styles
  const cleanDict = normalizePronunciationDictionary(pronunciationDictionary || []);
  const decimalStyle = DUBBING_MODELS_CONFIG.decimalPronunciationStyle || "butun";

  interface PreparedSpeakerJob {
    speakerId: string;
    speaker: ResolvedBatchSpeaker;
    voiceType: SpeakerVoiceType;
    voiceId: string;
    identityVersion: string;
    validatedVoice: ValidatedStoredVoiceInfo;
    turns: BatchInputTurn[];
    preparedTexts: string[];
    preparedStyles: string[];
    expectedSpeechSec: number;
    estimatedTokens: number;
    cacheKey: string;
  }

  const jobs: PreparedSpeakerJob[] = [];

  for (const spId of targetSpeakerIds) {
    const sp = speakerMap.get(spId)!;
    const spTurns = speakerTurnGroups.get(spId)!;
    const voiceType = resolveEffectiveVoiceType(sp);
    const voiceId = String(sp.voiceId || "").trim();
    const identityVersion = String(sp.identityVersion || `${voiceId}-v1`).trim();

    const preparedTexts: string[] = [];
    const preparedStyles: string[] = [];
    let expectedSpeechSec = 0;
    let totalChars = 0;

    for (const t of spTurns) {
      const windowSec =
        typeof t.startSec === "number" && typeof t.endSec === "number" && t.endSec > t.startSec
          ? Math.max(0.5, t.endSec - t.startSec)
          : 0;
      const prepared = prepareTurnTextForTts({
        rawText: t.text,
        pronunciationDictionary: cleanDict,
        intonationRu: t.intonationRu,
        useDeliveryEmotions,
        windowSec,
        gapAfterSec: t.gapAfterSec,
        decimalStyle,
      });
      const finalText = stripLegacyPauseArtifacts(prepared.ttsText);
      const safeStyle = extractVoiceLockSafeEmotion(t.intonationRu, useDeliveryEmotions);
      if (!VOICE_LOCK_ALLOWED_STYLES.has(safeStyle)) {
        throw new Error(`Недопустимый стиль Voice Lock: "${safeStyle}"`);
      }

      preparedTexts.push(finalText);
      preparedStyles.push(safeStyle);

      // Estimate speech duration conservatively from syllables / 4.8 + inter-turn pause (0.35s)
      const syl = Math.max(1, countSyllables(finalText));
      expectedSpeechSec += Math.max(0.35, syl / 4.8) + 0.35;
      totalChars += finalText.length + safeStyle.length + 12;
    }

    expectedSpeechSec = Math.round(expectedSpeechSec * 100) / 100;
    // Conservative token estimate for Uzbek Latin text + metadata (~3.0 chars/token)
    const estimatedTokens = Math.ceil(totalChars / 3.0);

    // Pre-flight guard: strictly enforce < 600s speech AND < 7500 tokens before ANY TTS call
    if (expectedSpeechSec >= VOICE_LOCK_MAX_SPEECH_SEC_PER_SPEAKER) {
      throw new Error(
        `Превышен лимит длительности речи Voice Lock для спикера «${sp.speakerName}»: ожидается ${expectedSpeechSec.toFixed(1)}с (лимит < ${VOICE_LOCK_MAX_SPEECH_SEC_PER_SPEAKER}с). Автоматическое разбиение отключено.`
      );
    }
    if (estimatedTokens >= VOICE_LOCK_MAX_TOKENS_PER_SPEAKER) {
      throw new Error(
        `Превышен лимит токенов Voice Lock для спикера «${sp.speakerName}»: ~${estimatedTokens} токенов (лимит < ${VOICE_LOCK_MAX_TOKENS_PER_SPEAKER}). Автоматическое разбиение отключено.`
      );
    }

    const cacheKey = computeVoiceLockSpeakerCacheHash({
      voiceId,
      voiceType,
      identityVersion,
      model: DUBBING_MODELS_CONFIG.ttsDubbingModel,
      parts: spTurns.map((t, i) => ({
        turnId: t.id,
        text: preparedTexts[i],
        style: preparedStyles[i],
      })),
      pronunciationDictionary: cleanDict,
      pipelineVersion: VOICE_LOCK_PIPELINE_VERSION,
    });

    jobs.push({
      speakerId: spId,
      speaker: sp,
      voiceType,
      voiceId,
      identityVersion,
      validatedVoice: validatedVoicesBySpeaker.get(spId)!,
      turns: spTurns,
      preparedTexts,
      preparedStyles,
      expectedSpeechSec,
      estimatedTokens,
      cacheKey,
    });
  }

  // 3. Execute 1 continuous single-speaker TTS + 1 Hydrogen alignment + 1 Hydrogen Identity QA per speaker
  const speakerTracks: VoiceLockSpeakerTrackReport[] = [];
  const perGlobalIndexClip = new Map<
    number,
    {
      pcm: Buffer;
      detail: VoiceLockTurnAlignmentDetail;
      qa: TurnQaStatus;
      qaReason?: string;
      speakerTrackStatus: "ok" | "failed";
    }
  >();

  let totalTtsCalls = 0;
  let totalAlignmentCalls = 0;
  let totalIdentityQaCalls = 0;
  let totalTtsWallMs = 0;
  let totalAlignWallMs = 0;
  const providersUsed = new Set<"google" | "cache" | "fake">();

  for (const job of jobs) {
    const sp = job.speaker;
    const gender: "male" | "female" = sp.gender === "female" ? "female" : "male";
    const voiceConfig = buildSingleSpeakerVoiceConfig(sp);

    const sentStylesSummary = job.turns.map((t, i) => ({
      turnId: t.id,
      globalIndex: t.index,
      intonationRu: String(t.intonationRu || ""),
      style: job.preparedStyles[i],
    }));

    // Check whole-speaker Voice Lock cache FIRST (never sub-block cache!)
    if (!bypassCache) {
      const cached = loadCachedVoiceLockSpeakerTrack(
        job.cacheKey,
        job.turns.length,
        job.voiceId,
        job.identityVersion
      );
      if (cached) {
        providersUsed.add("cache");
        const rawPcm = Buffer.from(cached.rawPcmBase64, "base64");
        const rawWavBuffer = buildWav24k(rawPcm);
        const cachedClips = cached.clipsBase64.map((b64) => Buffer.from(b64, "base64"));

        for (let i = 0; i < job.turns.length; i++) {
          const turn = job.turns[i];
          const detail = cached.turnDetails[i];
          perGlobalIndexClip.set(turn.index, {
            pcm: cachedClips[i],
            detail: { ...detail, method: `cache:${detail.method}` },
            qa: "ok",
            speakerTrackStatus: "ok",
          });
        }

        speakerTracks.push({
          speakerId: job.speakerId,
          speakerName: sp.speakerName,
          gender,
          voiceType: job.voiceType,
          voiceId: job.voiceId,
          identityVersion: job.identityVersion,
          cacheKey: job.cacheKey,
          fromCache: true,
          status: "ok",
          failureReasons: [],
          turnCount: job.turns.length,
          partsSentCount: job.turns.length,
          expectedSpeechSec: job.expectedSpeechSec,
          estimatedTokens: job.estimatedTokens,
          rawDurationSec: Math.round((rawPcm.length / PCM_BYTES_PER_SEC) * 100) / 100,
          ttsCallsUsed: 0,
          alignmentCallsUsed: 0,
          identityQaCallsUsed: 0,
          ttsWallTimeMs: 0,
          alignmentWallTimeMs: 0,
          identityQaWallTimeMs: 0,
          rawPcm,
          rawWavBuffer,
          sentStyles: sentStylesSummary,
          turnDetails: cached.turnDetails,
          acoustics: cached.acoustics,
          identityQa: { ...cached.identityQa, usedApiCall: false },
        });
        continue;
      }
    }

    const fakeFault =
      isFakeDubbingTtsEnabled() && voiceLockFakeFaultInjector
        ? voiceLockFakeFaultInjector({ speaker: sp, turns: job.turns })
        : null;

    // Build single-speaker parts: NO `speaker` field in speechMetadata, ONLY `{ style }`!
    const requestParts = job.turns.map((_t, i) => ({
      text: job.preparedTexts[i],
      speechMetadata: {
        style: job.preparedStyles[i],
      },
    }));

    emitTtsPayloadObservation({
      channel: "google_voice_lock",
      voiceConfig,
      usedMultiSpeaker: false,
      speakerId: sp.speakerId,
      voiceId: job.voiceId,
      voiceType: job.voiceType,
      identityVersion: job.identityVersion,
      parts: requestParts.map((p) => ({
        text: p.text,
        style: p.speechMetadata.style,
      })),
    });

    // Execute EXACTLY ONE TTS call for this speaker (NO retries, NO fallback, NO kie.ai!)
    let rawPcm: Buffer;
    let spTtsCalls = 0;
    const tTtsStart = Date.now();
    if (isFakeDubbingTtsEnabled()) {
      const freq = gender === "female" ? 235 : 135;
      const fakeBlock = generateSyntheticBlockPcm(
        job.preparedTexts.map((txt) => ({
          syllables: Math.max(1, countSyllables(txt)),
          speakerKey: `${sp.speakerId}_${freq}`,
        })),
        0.45
      );
      rawPcm = fakeBlock.pcm;
      spTtsCalls = 1; // Count the logical single-speaker TTS call in fake tests too
      providersUsed.add("fake");
    } else {
      const resp = await ai.models.generateContent({
        model: DUBBING_MODELS_CONFIG.ttsDubbingModel, // STRICTLY gemini-3.8-flash-tts
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
      spTtsCalls = 1;
      recordGoogleTtsCalls(1);
      providersUsed.add("google");

      const resParts = resp.candidates?.[0]?.content?.parts || [];
      const audioParts = resParts.filter((p: any) => typeof p?.inlineData?.data === "string");
      if (audioParts.length === 0) {
        throw new Error(
          `Gemini TTS вернул пустое аудио для трека Voice Lock спикера «${sp.speakerName}» (${job.voiceId}).`
        );
      }
      const pause300ms = Buffer.alloc(Math.floor(PCM_SAMPLE_RATE * 0.3) * 2);
      const pieces = audioParts.map((ap: any) =>
        decodeAudioBytesToPcm24kMono(
          Buffer.from(ap.inlineData.data, "base64"),
          ap.inlineData.mimeType
        )
      );
      rawPcm =
        pieces.length > 1
          ? Buffer.concat(pieces.flatMap((buf, idx) => (idx === 0 ? [buf] : [pause300ms, buf])))
          : pieces[0];
    }
    const spTtsWallMs = Date.now() - tTtsStart;
    totalTtsCalls += spTtsCalls;
    totalTtsWallMs += spTtsWallMs;

    const rawWavBuffer = buildWav24k(rawPcm);
    const rawDurationSec = Math.round((rawPcm.length / PCM_BYTES_PER_SEC) * 100) / 100;

    // 4. Separate gemini-4-hydrogen alignment for this speaker's track
    const aligned = await alignWholeSpeakerTrackWithHydrogen(ai, {
      rawPcm,
      speaker: sp,
      turns: job.turns.map((t, i) => ({
        turnId: t.id,
        globalIndex: t.index,
        text: job.preparedTexts[i],
        style: job.preparedStyles[i],
      })),
      fakeFault,
    });
    const spAlignCalls = aligned.usedApiCall ? 1 : 0;
    totalAlignmentCalls += spAlignCalls;
    totalAlignWallMs += aligned.wallTimeMs;

    // Prepare raw sliced clips (already RMS-trimmed by slicePcmByAlignmentSegments)
    const rawClipPcms: Buffer[] = [];
    const qaSlicedClips: Array<{
      pcm: Buffer;
      startMs: number;
      endMs: number;
      durationSec: number;
      method: string;
      spokenText?: string;
      detectedVoice?: "male" | "female" | "unknown";
      boundarySnapped?: boolean;
      boundaryIssue?: string;
    }> = [];

    let cursorMs = 0;
    const trackFailureReasons: string[] = [];
    if (aligned.error) {
      trackFailureReasons.push(aligned.error);
    }

    for (let i = 0; i < job.turns.length; i++) {
      const clip = aligned.clips[i];
      const row = aligned.rows[i];
      if (clip && row.found && clip.pcm.length > 0) {
        const trimmedPcm = trimSilenceEdgesPcm(clip.pcm);
        rawClipPcms.push(trimmedPcm);
        const sMs = Math.max(cursorMs, clip.startMs);
        const eMs = Math.max(sMs + 100, clip.endMs);
        qaSlicedClips.push({
          pcm: trimmedPcm,
          startMs: sMs,
          endMs: eMs,
          durationSec: Math.round((trimmedPcm.length / PCM_BYTES_PER_SEC) * 100) / 100,
          method: clip.method,
          spokenText: row.spokenText,
          detectedVoice: gender,
          boundarySnapped: row.boundarySnapped,
          boundaryIssue: row.boundaryIssue,
        });
        cursorMs = eMs;
      } else {
        const emptyFallback = Buffer.alloc(Math.round(0.35 * PCM_BYTES_PER_SEC), 0);
        rawClipPcms.push(emptyFallback);
        const sMs = cursorMs;
        const eMs = sMs + 350;
        const issue = row?.boundaryIssue || `missing_turn (${job.turns[i].id})`;
        trackFailureReasons.push(issue);
        qaSlicedClips.push({
          pcm: emptyFallback,
          startMs: sMs,
          endMs: eMs,
          durationSec: 0.35,
          method: "missing_turn",
          spokenText: row?.spokenText || "",
          detectedVoice: "unknown",
          boundarySnapped: false,
          boundaryIssue: issue,
        });
        cursorMs = eMs;
      }
    }

    // Loudness leveling: -18 LUFS regular, -21 LUFS for `softly`, true peak <= -1.0 dBFS
    const leveled = levelSubBlockClipsLoudness(
      rawClipPcms.map((pcm, i) => ({
        pcm,
        speaker: sp.speakerId,
        style: job.preparedStyles[i],
      })),
      {
        sampleRate: PCM_SAMPLE_RATE,
        defaultTargetLufs: -18.0,
        quietlyTargetLufs: -21.0,
        ceilingDbfs: -1.0,
      }
    );

    const leveledPcms = leveled.map((l, i) => l?.pcm ?? rawClipPcms[i]);

    // Update QA clips with leveled PCMs for text/duration/order evaluation
    const expectedQaTurns: BatchInputTurn[] = job.turns.map((t, i) => ({
      ...t,
      cleanSpeechText: job.preparedTexts[i],
      style: job.preparedStyles[i],
    }));

    const singleSpeakerMap = new Map<string, ResolvedBatchSpeaker>([[sp.speakerId, sp]]);
    const qaEval = evaluateSubBlockQa({
      expectedTurns: expectedQaTurns,
      slicedClips: qaSlicedClips.map((c, i) => ({
        ...c,
        pcm: leveledPcms[i],
      })),
      transcriptText: aligned.rows.map((r) => r.spokenText).filter(Boolean).join(" "),
      speakerMap: singleSpeakerMap,
    });

    if (!qaEval.passed) {
      for (const r of qaEval.reasons) {
        if (!trackFailureReasons.includes(r)) trackFailureReasons.push(r);
      }
    }

    // 5. Voice Identity QA (sample_audio vs beginning / middle / end 30s) + local acoustics
    const idQaRes = await runVoiceIdentityQaWithHydrogen(ai, {
      speaker: sp,
      validatedVoice: job.validatedVoice,
      rawPcm,
      fakeFault,
    });
    const spIdQaCalls = idQaRes.identityQa.usedApiCall ? 1 : 0;
    totalIdentityQaCalls += spIdQaCalls;

    if (!idQaRes.identityQa.passed) {
      trackFailureReasons.push(
        `voice_identity_qa_failed: ${idQaRes.identityQa.explanationRu}`
      );
    }

    const trackStatus: "ok" | "failed" =
      trackFailureReasons.length === 0 && qaEval.passed && idQaRes.identityQa.passed
        ? "ok"
        : "failed";

    const turnDetails: VoiceLockTurnAlignmentDetail[] = job.turns.map((t, i) => ({
      turnId: t.id,
      globalIndex: t.index,
      speakerTurnIndex: i,
      startSec: aligned.rows[i]?.startSec ?? 0,
      endSec: aligned.rows[i]?.endSec ?? 0,
      spokenText: aligned.rows[i]?.spokenText ?? "",
      found: Boolean(aligned.rows[i]?.found),
      confidence: aligned.rows[i]?.confidence ?? 0,
      method: qaSlicedClips[i].method,
      boundarySnapped: Boolean(qaSlicedClips[i].boundarySnapped),
      boundaryIssue: qaSlicedClips[i].boundaryIssue,
      sentText: job.preparedTexts[i],
      sentStyle: job.preparedStyles[i],
      lufsBefore: leveled[i]?.lufsBefore ?? null,
      lufsAfter: leveled[i]?.lufsAfter ?? null,
      truePeakAfterDbfs: leveled[i]?.truePeakAfterDbfs ?? null,
    }));

    // If track failed on ANY turn -> mark ALL turns of this speaker as failed (NO single-turn recovery / voice swap!),
    // while keeping the OTHER speaker's track intact!
    const failureSummaryStr =
      trackStatus === "failed" ? trackFailureReasons.slice(0, 4).join("; ") : undefined;

    for (let i = 0; i < job.turns.length; i++) {
      const turn = job.turns[i];
      perGlobalIndexClip.set(turn.index, {
        pcm: leveledPcms[i],
        detail: turnDetails[i],
        qa: trackStatus === "ok" ? "ok" : "failed",
        qaReason: failureSummaryStr,
        speakerTrackStatus: trackStatus,
      });
    }

    // Save whole-speaker track to separate Voice Lock cache ONLY when completely passed
    if (!bypassCache && trackStatus === "ok") {
      saveCachedVoiceLockSpeakerTrack({
        v: 1,
        pipelineVersion: VOICE_LOCK_PIPELINE_VERSION,
        cacheKey: job.cacheKey,
        voiceId: job.voiceId,
        voiceType: job.voiceType,
        identityVersion: job.identityVersion,
        model: DUBBING_MODELS_CONFIG.ttsDubbingModel,
        savedAt: new Date().toISOString(),
        rawPcmBase64: rawPcm.toString("base64"),
        clipsBase64: leveledPcms.map((p) => p.toString("base64")),
        turnDetails,
        acoustics: idQaRes.acoustics,
        identityQa: idQaRes.identityQa,
      });
    }

    speakerTracks.push({
      speakerId: job.speakerId,
      speakerName: sp.speakerName,
      gender,
      voiceType: job.voiceType,
      voiceId: job.voiceId,
      identityVersion: job.identityVersion,
      cacheKey: job.cacheKey,
      fromCache: false,
      status: trackStatus,
      failureReasons: trackFailureReasons,
      turnCount: job.turns.length,
      partsSentCount: requestParts.length,
      expectedSpeechSec: job.expectedSpeechSec,
      estimatedTokens: job.estimatedTokens,
      rawDurationSec,
      ttsCallsUsed: spTtsCalls,
      alignmentCallsUsed: spAlignCalls,
      identityQaCallsUsed: spIdQaCalls,
      ttsWallTimeMs: spTtsWallMs,
      alignmentWallTimeMs: aligned.wallTimeMs,
      identityQaWallTimeMs: idQaRes.wallTimeMs,
      rawPcm,
      rawWavBuffer,
      sentStyles: sentStylesSummary,
      turnDetails,
      acoustics: idQaRes.acoustics,
      identityQa: idQaRes.identityQa,
    });
  }

  // 6. Restore ORIGINAL interleaved turn order & fit each turn to its timecode
  const turnsInOriginalOrder = onlySpeakerId
    ? rawInputTurns.filter((t) => t.speakerId === onlySpeakerId)
    : [...rawInputTurns].sort((a, b) => a.index - b.index);

  const finalTurns: BatchSynthesizedTurnResult[] = [];
  let runningEffectiveEndSec = 0;

  for (let seq = 0; seq < turnsInOriginalOrder.length; seq++) {
    const turn = turnsInOriginalOrder[seq];
    const entry = perGlobalIndexClip.get(turn.index);
    const clipPcm = entry?.pcm || Buffer.alloc(Math.round(0.35 * PCM_BYTES_PER_SEC), 0);

    const origStart = typeof turn.startSec === "number" ? turn.startSec : 0;
    const incomingShiftSec =
      strictTimeWindow && seq > 0 && !onlySpeakerId
        ? Math.max(0, runningEffectiveEndSec + 0.08 - origStart)
        : 0;

    const fitted = await fitSlicedTurnToTimecode(
      clipPcm,
      turn,
      strictTimeWindow,
      incomingShiftSec
    );

    const effectiveStart =
      strictTimeWindow && seq > 0 && !onlySpeakerId
        ? Math.max(origStart, runningEffectiveEndSec + 0.08)
        : origStart;
    runningEffectiveEndSec = effectiveStart + fitted.dubbedDurationSec;

    const wavBuf = buildWav24k(fitted.pcm);

    finalTurns.push({
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
      slicingMethod: entry?.detail.method || "missing_turn",
      generationMode: "voice_lock",
      lufsBefore: entry?.detail.lufsBefore ?? null,
      lufsAfter: entry?.detail.lufsAfter ?? null,
      sentStyle: entry?.detail.sentStyle ?? "",
      sentText: entry?.detail.sentText ?? turn.text,
      spokenText: entry?.detail.spokenText,
      qa: entry?.qa || "failed",
      qaReason: entry?.qaReason,
      needsShorten: fitted.needsShorten,
      subBlockIndex: 0,
    });
  }

  let okCount = 0;
  let adjustedCount = 0;
  let overflowCount = 0;
  let qaOk = 0;
  let qaRetried = 0;
  let qaFailed = 0;
  let needsShortenCount = 0;

  for (const r of finalTurns) {
    if (r.syncStatus === "overflow") overflowCount++;
    else if (r.syncStatus === "adjusted") adjustedCount++;
    else okCount++;

    if (r.qa === "failed") qaFailed++;
    else if (r.qa === "retried") qaRetried++;
    else qaOk++;

    if (r.needsShorten) needsShortenCount++;
  }

  const identityQaPassed =
    speakerTracks.length > 0 && speakerTracks.every((st) => st.identityQa.passed);
  const overallSuccess =
    identityQaPassed && speakerTracks.every((st) => st.status === "ok") && qaFailed === 0;

  const providerSummary: VoiceLockExecutionResult["provider"] =
    providersUsed.size === 0
      ? "cache"
      : providersUsed.size === 1
        ? Array.from(providersUsed)[0]
        : "mixed";

  const quota = getTtsQuotaStatus();

  return {
    voiceLockMode: "full_speaker_tracks",
    overallSuccess,
    identityQaPassed,
    turns: finalTurns,
    speakerTracks,
    ttsCallsUsed: totalTtsCalls,
    alignmentCallsUsed: totalAlignmentCalls,
    identityQaCallsUsed: totalIdentityQaCalls,
    transcribeCallsUsed: totalAlignmentCalls,
    ttsWallTimeMs: totalTtsWallMs,
    alignWallTimeMs: totalAlignWallMs,
    provider: providerSummary,
    modeUsed: "voice_lock_full_speaker_tracks",
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
