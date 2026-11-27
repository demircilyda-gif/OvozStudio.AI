import fs from "node:fs";
import path from "node:path";
import type { GoogleGenAI } from "@google/genai";
import { parseReadyScript } from "../../../src/utils/readyScriptParser.ts";
import { planDialogueSubBlocks } from "../../../src/utils/dialogueMacroBlocks.ts";
import { stitchDialogueTurnsClient } from "../../../src/utils/clientMasterStitcher.ts";
import {
  DEFAULT_BASE_STYLE_FEMALE,
  DEFAULT_BASE_STYLE_MALE,
} from "../../../src/utils/dubbingStyle.ts";
import { DEFAULT_PRONUNCIATION_DICTIONARY } from "../../../src/utils/pronunciationDictionary.ts";
import {
  buildCleanTurnStyleForTts,
  computeSubBlockCacheHash,
  prepareBatchTurnForTts,
  synthesizeDialogueInMacroBlocks,
  type BatchDialogueExecutionResult,
  type BatchInputTurn,
  type ResolvedBatchSpeaker,
} from "./batchDialogueEngine.ts";
import { extractRawPcm24k, buildWav24k } from "./batchAudioSlicer.ts";
import { measureIntegratedLufsPcm } from "./loudnessLeveler.ts";

export interface Exp3VariantConfig {
  id: "A" | "B" | "C";
  label: string;
  maleVoice: string;
  femaleVoice: string;
  useDeliveryEmotions: boolean;
  wavFileName: string;
}

export const EXP3_VARIANTS: Exp3VariantConfig[] = [
  {
    id: "A",
    label: "Variant A (Charon + Kore, эмоции ВЫКЛ)",
    maleVoice: "Charon",
    femaleVoice: "Kore",
    useDeliveryEmotions: false,
    wavFileName: "exp3-A-kore-noemo.wav",
  },
  {
    id: "B",
    label: "Variant B (Charon + Aoede, эмоции ВКЛ)",
    maleVoice: "Charon",
    femaleVoice: "Aoede",
    useDeliveryEmotions: true,
    wavFileName: "exp3-B-aoede.wav",
  },
  {
    id: "C",
    label: "Variant C (Charon + Zephyr, эмоции ВКЛ)",
    maleVoice: "Charon",
    femaleVoice: "Zephyr",
    useDeliveryEmotions: true,
    wavFileName: "exp3-C-zephyr.wav",
  },
];

const SR = 24000;

function formatMmSs(sec?: number | null): string {
  if (typeof sec !== "number" || !Number.isFinite(sec)) return "—";
  const safe = Math.max(0, sec);
  const mm = Math.floor(safe / 60);
  const ss = safe - mm * 60;
  return `${String(mm).padStart(2, "0")}:${ss.toFixed(2).padStart(5, "0")}`;
}

function formatMmSsInt(sec?: number | null): string {
  if (typeof sec !== "number" || !Number.isFinite(sec)) return "—";
  const safe = Math.max(0, Math.round(sec));
  const mm = Math.floor(safe / 60);
  const ss = safe % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function escapeMdCell(s?: string | null): string {
  return String(s ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

function median(vals: number[]): number {
  const clean = vals.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (clean.length === 0) return 0;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 === 1 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

function mean(vals: number[]): number {
  const clean = vals.filter((v) => Number.isFinite(v));
  if (clean.length === 0) return NaN;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

function semitonesDiff(hz: number, refHz: number): number {
  if (!(hz > 0) || !(refHz > 0)) return NaN;
  return 12 * Math.log2(hz / refHz);
}

// --- Acoustic DSP (F0 median, spectral centroid Hz, spectral tilt dB, 12-dim MFCC) ---

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
for (let i = 0; i < FFT_N; i++) {
  HANN[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_N - 1)));
}
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
      if (k >= 0 && k < FFT_BINS) {
        f[k] = (k - bins[m - 1]) / Math.max(1, bins[m] - bins[m - 1]);
      }
    }
    for (let k = bins[m]; k <= bins[m + 1]; k++) {
      if (k >= 0 && k < FFT_BINS) {
        f[k] = (bins[m + 1] - k) / Math.max(1, bins[m + 1] - bins[m]);
      }
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
      // Raw spectrum for centroid & tilt (100-1000 Hz vs 1000-4000 Hz)
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

      // Pre-emphasized spectrum for 12-dim MFCC voice identity
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

  const mfcc: number[] = [];
  for (let c = 1; c < N_MFCC; c++) {
    mfcc.push(mfccSum[c] / Math.max(1, specFrames));
  }

  return {
    f0MedHz: median(f0s),
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

interface TurnMetricRow {
  num: number;
  speakerId: string;
  speakerName: string;
  scriptTimecode: string;
  wavRange: string;
  clipDurSec: number;
  windowDurSec: number;
  qa: string;
  f0Hz: number;
  f0SemitonesFromSpeakerMed: number;
  centroidHz: number;
  tiltDb: number;
  hnrProxy: number;
  lufsBefore: number | null;
  lufsAfter: number | null;
  sentStyle: string;
  sentText: string;
  mfcc: number[];
}

interface SpeakerSummary {
  speakerName: string;
  turnCount: number;
  f0MedHz: number;
  f0MinHz: number;
  f0MaxHz: number;
  centroidMeanHz: number;
  tiltMeanDb: number;
  hnrMean: number;
  lufsBeforeMean: number | null;
  lufsAfterMean: number | null;
  avgMfcc: number[];
}

function finalizeRowsAndSummary(rows: TurnMetricRow[]): {
  rows: TurnMetricRow[];
  aziz: SpeakerSummary;
  veronika: SpeakerSummary;
} {
  const azizRows = rows.filter((r) => r.speakerId === "HOST_1");
  const veroRows = rows.filter((r) => r.speakerId === "HOST_2");
  const azizMedF0 = median(azizRows.map((r) => r.f0Hz));
  const veroMedF0 = median(veroRows.map((r) => r.f0Hz));

  const updated = rows.map((r) => {
    const refF0 = r.speakerId === "HOST_1" ? azizMedF0 : veroMedF0;
    return {
      ...r,
      f0SemitonesFromSpeakerMed: semitonesDiff(r.f0Hz, refF0),
    };
  });

  const makeSummary = (name: string, list: TurnMetricRow[]): SpeakerSummary => {
    const f0s = list.map((r) => r.f0Hz).filter((v) => v > 0);
    const lBef = list.map((r) => r.lufsBefore).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const lAft = list.map((r) => r.lufsAfter).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    return {
      speakerName: name,
      turnCount: list.length,
      f0MedHz: median(f0s),
      f0MinHz: f0s.length ? Math.min(...f0s) : 0,
      f0MaxHz: f0s.length ? Math.max(...f0s) : 0,
      centroidMeanHz: mean(list.map((r) => r.centroidHz)),
      tiltMeanDb: mean(list.map((r) => r.tiltDb)),
      hnrMean: mean(list.map((r) => r.hnrProxy)),
      lufsBeforeMean: lBef.length ? mean(lBef) : null,
      lufsAfterMean: lAft.length ? mean(lAft) : null,
      avgMfcc: avgMfcc(list.map((r) => r.mfcc)),
    };
  };

  return {
    rows: updated,
    aziz: makeSummary("Азиз", updated.filter((r) => r.speakerId === "HOST_1")),
    veronika: makeSummary("Вероника", updated.filter((r) => r.speakerId === "HOST_2")),
  };
}

function buildBatchTurnsForSubBlock(
  subTurns: any[],
  allParsedTurns: any[],
  globalOffset: number
): BatchInputTurn[] {
  return subTurns.map((t, i) => {
    const isAziz = /азиз|aziz/i.test(t.speakerName || "") || t.speakerGender === "male";
    const speakerId = isAziz ? "HOST_1" : "HOST_2";
    const nextInFull = allParsedTurns[globalOffset + i + 1];
    const nextStart =
      nextInFull && typeof nextInFull.startSec === "number"
        ? nextInFull.startSec
        : (t.endSec ?? 0);
    const gapAfterSec =
      typeof t.endSec === "number"
        ? Math.max(0, Math.round((nextStart - t.endSec) * 100) / 100)
        : 0;
    return {
      id: t.id,
      index: i,
      speakerId,
      speakerName: t.speakerName || (isAziz ? "Азиз" : "Вероника"),
      text: t.text,
      cleanSpeechText: t.text,
      style: t.intonationRu || "",
      startSec: t.startSec,
      endSec: t.endSec,
      gapAfterSec,
      intonationRu: t.intonationRu,
      originalTextRu: t.originalTextRu,
      speakerGender: isAziz ? "male" : "female",
      sceneTitle: t.sceneTitle,
      rawTurn: { ...t, speakerId, speakerGender: isAziz ? "male" : "female", gapAfterSec },
    };
  });
}

function makeSpeakerMap(maleVoice: string, femaleVoice: string): Map<string, ResolvedBatchSpeaker> {
  // Deterministic order: HOST_1 first (SpeakerOne), HOST_2 second (SpeakerTwo)
  return new Map<string, ResolvedBatchSpeaker>([
    [
      "HOST_1",
      {
        speakerId: "HOST_1",
        speakerName: "Азиз",
        baseVoice: maleVoice,
        voiceId: maleVoice.toLowerCase(),
        gender: "male",
        isCloned: false,
        baseSpeechStyle: DEFAULT_BASE_STYLE_MALE,
      },
    ],
    [
      "HOST_2",
      {
        speakerId: "HOST_2",
        speakerName: "Вероника",
        baseVoice: femaleVoice,
        voiceId: femaleVoice.toLowerCase(),
        gender: "female",
        isCloned: false,
        baseSpeechStyle: DEFAULT_BASE_STYLE_FEMALE,
      },
    ],
  ]);
}

function stitchSubBlockShiftedToZero(
  batchTurns: BatchInputTurn[],
  clips: Array<{
    pcm: Buffer;
    wavBase64: string;
    durationSec: number;
    originalDurationSec: number;
    atempoApplied?: number;
    syncStatus?: string;
    qa?: string;
    qaReason?: string;
    slicingMethod?: string;
    generationMode?: string;
    lufsBefore?: number | null;
    lufsAfter?: number | null;
  }>
) {
  const baseStartSec = Math.min(
    ...batchTurns.map((t) => (typeof t.startSec === "number" ? t.startSec : 0))
  );
  const maxRelEndSec = Math.max(
    ...batchTurns.map((t) =>
      Math.max(0.5, (typeof t.endSec === "number" ? t.endSec : baseStartSec + 1) - baseStartSec)
    )
  );

  const stitched = stitchDialogueTurnsClient({
    turns: batchTurns.map((orig, i) => {
      const c = clips[i];
      const relStart = Math.max(0, (orig.startSec ?? baseStartSec) - baseStartSec);
      const relEnd = Math.max(relStart + 0.5, (orig.endSec ?? orig.startSec ?? baseStartSec) - baseStartSec);
      return {
        ...orig.rawTurn,
        id: orig.id,
        speakerId: orig.speakerId,
        speakerName: orig.speakerName,
        text: orig.text,
        sceneTitle: orig.sceneTitle,
        startSec: relStart,
        endSec: relEnd,
        audioBase64: c.wavBase64,
        dubbedDurationSec: c.durationSec,
        originalDurationSec: c.originalDurationSec,
        atempoApplied: c.atempoApplied ?? 1.0,
        syncStatus: (c.syncStatus as any) ?? "ok",
        qa: (c.qa as any) ?? "ok",
        qaReason: c.qaReason,
        slicingMethod: c.slicingMethod ?? "transcribe_aligned",
        generationMode: (c.generationMode as any) ?? "mode_a",
        lufsBefore: c.lufsBefore ?? null,
        lufsAfter: c.lufsAfter ?? null,
        needsShorten: false,
        subBlockIndex: 0,
      };
    }),
    masterAudioMode: "time_aligned",
    totalVideoDurationSec: Math.ceil(maxRelEndSec + 1),
  });

  return { baseStartSec, stitched, wavBuf: Buffer.from(stitched.masterAudioBase64, "base64") };
}

export async function runExperiment3Live(ai: GoogleGenAI) {
  const fixturePath = path.resolve(
    process.cwd(),
    "scripts",
    "fixtures",
    "01_tiggo_8_hybrid_uz_dublyaj_v4.txt"
  );
  if (!fs.existsSync(fixturePath)) {
    throw new Error(`Fixture not found: ${fixturePath}`);
  }

  const rawText = fs.readFileSync(fixturePath, "utf8");
  const parsed = parseReadyScript(rawText);
  if (!parsed.ok || parsed.turns.length < 44) {
    throw new Error(`Failed to parse Tiggo 8 v4 fixture (turns=${parsed.turns.length})`);
  }

  const fullSubBlocks = planDialogueSubBlocks(parsed.turns);
  const sub1 = fullSubBlocks[0];
  const sub2 = fullSubBlocks[1];
  const sub3 = fullSubBlocks[2];
  if (!sub1 || !sub2 || !sub3) {
    throw new Error(`Expected >= 3 sub-blocks for Tiggo 8 v4, got ${fullSubBlocks.length}`);
  }

  const outDir = path.resolve(process.cwd(), "public", "audio", "experiments");
  fs.mkdirSync(outDir, { recursive: true });
  const cacheDir = path.resolve(process.cwd(), "data", "dubbing-block-cache");

  const defaultSpeakerMap = makeSpeakerMap("Charon", "Kore");
  const sb1Turns = buildBatchTurnsForSubBlock(sub1.turns, parsed.turns, sub1.startTurnIndex);
  const sb2Turns = buildBatchTurnsForSubBlock(sub2.turns, parsed.turns, sub2.startTurnIndex);
  const sb3Turns = buildBatchTurnsForSubBlock(sub3.turns, parsed.turns, sub3.startTurnIndex);

  // =========================================================================
  // 1. REFERENCE WAVs & METRICS (0 TTS calls!)
  // =========================================================================

  // 1a. exp3-ref-sb1.wav: check server cache first; if absent, copy exp2-A-kore.wav (same SB#1 Charon+Kore emotions=ON)
  const sb1Prepared = sb1Turns.map((t) =>
    prepareBatchTurnForTts(t, defaultSpeakerMap.get(t.speakerId), {
      useDeliveryEmotions: true,
      pronunciationDictionary: DEFAULT_PRONUNCIATION_DICTIONARY,
    })
  );
  const sb1Hash = computeSubBlockCacheHash(sb1Prepared, defaultSpeakerMap, "A", true);
  const sb1CachePath = path.join(cacheDir, `${sb1Hash}.json`);
  const refSb1WavPath = path.join(outDir, "exp3-ref-sb1.wav");
  let refSb1SourceNote = "";
  let refSb1RowsRaw: TurnMetricRow[] = [];

  if (fs.existsSync(sb1CachePath)) {
    const c1 = JSON.parse(fs.readFileSync(sb1CachePath, "utf8"));
    const pcms: Buffer[] = c1.clips.map((b64: string) => Buffer.from(b64, "base64"));
    const stitched1 = stitchSubBlockShiftedToZero(
      sb1Turns,
      pcms.map((pcm, i) => ({
        pcm,
        wavBase64: buildWav24k(pcm).toString("base64"),
        durationSec: pcm.length / (SR * 2),
        originalDurationSec: Math.max(0.5, (sb1Turns[i].endSec ?? 0) - (sb1Turns[i].startSec ?? 0)),
        lufsBefore: c1.lufsBefore?.[i] ?? null,
        lufsAfter: c1.lufsAfter?.[i] ?? null,
      }))
    );
    fs.writeFileSync(refSb1WavPath, stitched1.wavBuf);
    refSb1SourceNote = `Серверный кэш полной озвучки (\`${sb1Hash}.json\`, Charon + Kore, эмоции ВКЛ)`;
    refSb1RowsRaw = sb1Prepared.map((t, i) => {
      const ac = analyzePcmAcoustics(pcms[i], t.speakerGender === "female" ? "female" : "male");
      const st = stitched1.stitched.turns[i];
      return {
        num: i + 1,
        speakerId: t.speakerId,
        speakerName: t.speakerName,
        scriptTimecode: `${formatMmSsInt(t.startSec)}–${formatMmSsInt(t.endSec)}`,
        wavRange: `${formatMmSs(st?.startTime)}–${formatMmSs(st?.endTime)}`,
        clipDurSec: ac.durSec,
        windowDurSec: Math.max(0.5, (t.endSec ?? 0) - (t.startSec ?? 0)),
        qa: c1.qa || "ok",
        f0Hz: ac.f0MedHz,
        f0SemitonesFromSpeakerMed: 0,
        centroidHz: ac.centroidHz,
        tiltDb: ac.tiltDb,
        hnrProxy: ac.hnrProxy,
        lufsBefore: c1.lufsBefore?.[i] ?? null,
        lufsAfter: c1.lufsAfter?.[i] ?? measureIntegratedLufsPcm(pcms[i], SR),
        sentStyle: t.style,
        sentText: t.cleanSpeechText,
        mfcc: ac.mfcc,
      };
    });
  } else {
    const exp2APath = path.join(outDir, "exp2-A-kore.wav");
    if (!fs.existsSync(exp2APath)) {
      throw new Error(`Neither SB#1 cache (${sb1CachePath}) nor ${exp2APath} exists`);
    }
    fs.copyFileSync(exp2APath, refSb1WavPath);
    refSb1SourceNote = `Скопировано из \`exp2-A-kore.wav\` (в серверном кэше \`data/dubbing-block-cache/\` файл суб-блока №1 \`${sb1Hash}.json\` отсутствует; \`exp2-A-kore.wav\` — идентичный суб-блок №1, Charon + Kore, эмоции ВКЛ, -18 LUFS)`;
    const fullPcm = extractRawPcm24k(fs.readFileSync(exp2APath));
    const totalSec = fullPcm.length / (SR * 2);
    refSb1RowsRaw = sb1Prepared.map((t, i) => {
      const slotStart = t.startSec ?? 0;
      const nextStart =
        i + 1 < sb1Prepared.length && typeof sb1Prepared[i + 1].startSec === "number"
          ? sb1Prepared[i + 1].startSec!
          : Math.min(totalSec, (t.endSec ?? slotStart + 3) + 1.0);
      const slotEnd = Math.min(totalSec, Math.max(t.endSec ?? slotStart + 1, nextStart - 0.04));
      const b0 = Math.max(0, Math.floor(slotStart * SR) * 2);
      const b1 = Math.min(fullPcm.length, Math.floor(slotEnd * SR) * 2);
      const slotPcm = fullPcm.subarray(b0, Math.max(b0, b1));
      const ac = analyzePcmAcoustics(slotPcm, t.speakerGender === "female" ? "female" : "male");
      const lAfter = slotPcm.length >= 2400 ? measureIntegratedLufsPcm(slotPcm, SR) : null;
      return {
        num: i + 1,
        speakerId: t.speakerId,
        speakerName: t.speakerName,
        scriptTimecode: `${formatMmSsInt(t.startSec)}–${formatMmSsInt(t.endSec)}`,
        wavRange: `${formatMmSs(slotStart)}–${formatMmSs(slotEnd)}`,
        clipDurSec: ac.durSec,
        windowDurSec: Math.max(0.5, (t.endSec ?? 0) - (t.startSec ?? 0)),
        qa: "ref (exp2-A)",
        f0Hz: ac.f0MedHz,
        f0SemitonesFromSpeakerMed: 0,
        centroidHz: ac.centroidHz,
        tiltDb: ac.tiltDb,
        hnrProxy: ac.hnrProxy,
        lufsBefore: null,
        lufsAfter: lAfter,
        sentStyle: t.style,
        sentText: t.cleanSpeechText,
        mfcc: ac.mfcc,
      };
    });
  }
  const refSb1Data = finalizeRowsAndSummary(refSb1RowsRaw);

  // 1b. exp3-ref-sb2.wav from current full dubbing cache (31074d9bd79c89ccd54a3b91.json)
  const sb2Prepared = sb2Turns.map((t) =>
    prepareBatchTurnForTts(t, defaultSpeakerMap.get(t.speakerId), {
      useDeliveryEmotions: true,
      pronunciationDictionary: DEFAULT_PRONUNCIATION_DICTIONARY,
    })
  );
  const sb2Hash = computeSubBlockCacheHash(sb2Prepared, defaultSpeakerMap, "A", true);
  const sb2CachePath = path.join(cacheDir, `${sb2Hash}.json`);
  if (!fs.existsSync(sb2CachePath)) {
    throw new Error(`SB#2 cache file not found at ${sb2CachePath}`);
  }
  const c2 = JSON.parse(fs.readFileSync(sb2CachePath, "utf8"));
  const sb2Pcms: Buffer[] = c2.clips.map((b64: string) => Buffer.from(b64, "base64"));
  const stitched2 = stitchSubBlockShiftedToZero(
    sb2Turns,
    sb2Pcms.map((pcm, i) => ({
      pcm,
      wavBase64: buildWav24k(pcm).toString("base64"),
      durationSec: pcm.length / (SR * 2),
      originalDurationSec: Math.max(0.5, (sb2Turns[i].endSec ?? 0) - (sb2Turns[i].startSec ?? 0)),
      lufsBefore: c2.lufsBefore?.[i] ?? null,
      lufsAfter: c2.lufsAfter?.[i] ?? null,
    }))
  );
  const refSb2WavPath = path.join(outDir, "exp3-ref-sb2.wav");
  fs.writeFileSync(refSb2WavPath, stitched2.wavBuf);
  const refSb2RowsRaw: TurnMetricRow[] = sb2Prepared.map((t, i) => {
    const ac = analyzePcmAcoustics(sb2Pcms[i], t.speakerGender === "female" ? "female" : "male");
    const st = stitched2.stitched.turns[i];
    return {
      num: i + 1,
      speakerId: t.speakerId,
      speakerName: t.speakerName,
      scriptTimecode: `${formatMmSsInt(t.startSec)}–${formatMmSsInt(t.endSec)}`,
      wavRange: `${formatMmSs(st?.startTime)}–${formatMmSs(st?.endTime)}`,
      clipDurSec: ac.durSec,
      windowDurSec: Math.max(0.5, (t.endSec ?? 0) - (t.startSec ?? 0)),
      qa: c2.qa || "ok",
      f0Hz: ac.f0MedHz,
      f0SemitonesFromSpeakerMed: 0,
      centroidHz: ac.centroidHz,
      tiltDb: ac.tiltDb,
      hnrProxy: ac.hnrProxy,
      lufsBefore: c2.lufsBefore?.[i] ?? null,
      lufsAfter: c2.lufsAfter?.[i] ?? null,
      sentStyle: t.style,
      sentText: t.cleanSpeechText,
      mfcc: ac.mfcc,
    };
  });
  const refSb2All = finalizeRowsAndSummary(refSb2RowsRaw);
  const refSb2Before = finalizeRowsAndSummary(refSb2RowsRaw.slice(0, 9)); // 01:33–02:30
  const refSb2After = finalizeRowsAndSummary(refSb2RowsRaw.slice(9)); // 02:30–03:21

  // 1c. Current full dubbing SB#3 from cache (4f71470482f2487da3664117.json, baseline for comparison, 0 TTS calls)
  const sb3PreparedDefault = sb3Turns.map((t) =>
    prepareBatchTurnForTts(t, defaultSpeakerMap.get(t.speakerId), {
      useDeliveryEmotions: true,
      pronunciationDictionary: DEFAULT_PRONUNCIATION_DICTIONARY,
    })
  );
  const sb3Hash = computeSubBlockCacheHash(sb3PreparedDefault, defaultSpeakerMap, "A", true);
  const sb3CachePath = path.join(cacheDir, `${sb3Hash}.json`);
  let refSb3Data: ReturnType<typeof finalizeRowsAndSummary> | null = null;
  if (fs.existsSync(sb3CachePath)) {
    const c3 = JSON.parse(fs.readFileSync(sb3CachePath, "utf8"));
    const sb3Pcms: Buffer[] = c3.clips.map((b64: string) => Buffer.from(b64, "base64"));
    const stitched3Ref = stitchSubBlockShiftedToZero(
      sb3Turns,
      sb3Pcms.map((pcm, i) => ({
        pcm,
        wavBase64: buildWav24k(pcm).toString("base64"),
        durationSec: pcm.length / (SR * 2),
        originalDurationSec: Math.max(0.5, (sb3Turns[i].endSec ?? 0) - (sb3Turns[i].startSec ?? 0)),
        lufsBefore: c3.lufsBefore?.[i] ?? null,
        lufsAfter: c3.lufsAfter?.[i] ?? null,
      }))
    );
    refSb3Data = finalizeRowsAndSummary(
      sb3PreparedDefault.map((t, i) => {
        const ac = analyzePcmAcoustics(sb3Pcms[i], t.speakerGender === "female" ? "female" : "male");
        const st = stitched3Ref.stitched.turns[i];
        return {
          num: i + 1,
          speakerId: t.speakerId,
          speakerName: t.speakerName,
          scriptTimecode: `${formatMmSsInt(t.startSec)}–${formatMmSsInt(t.endSec)}`,
          wavRange: `${formatMmSs(st?.startTime)}–${formatMmSs(st?.endTime)}`,
          clipDurSec: ac.durSec,
          windowDurSec: Math.max(0.5, (t.endSec ?? 0) - (t.startSec ?? 0)),
          qa: c3.qa || "ok",
          f0Hz: ac.f0MedHz,
          f0SemitonesFromSpeakerMed: 0,
          centroidHz: ac.centroidHz,
          tiltDb: ac.tiltDb,
          hnrProxy: ac.hnrProxy,
          lufsBefore: c3.lufsBefore?.[i] ?? null,
          lufsAfter: c3.lufsAfter?.[i] ?? null,
          sentStyle: t.style,
          sentText: t.cleanSpeechText,
          mfcc: ac.mfcc,
        };
      })
    );
  }

  // =========================================================================
  // 2. RUN EXACTLY 3 LIVE VARIANTS (A, B, C) ON SUB-BLOCK #3 (bypassCache=true, maxExtraTtsCalls=0)
  // =========================================================================
  const variantResults: Array<{
    variant: Exp3VariantConfig;
    wavPath: string;
    wavBytes: number;
    totalWavDurationSec: number;
    baseStartSec: number;
    ttsCallsUsed: number;
    transcribeCallsUsed: number;
    ttsWallTimeMs: number;
    alignWallTimeMs: number;
    apiRetries: number;
    qaPassedCount: number;
    qaFailedCount: number;
    qaReasons: string[];
    data: ReturnType<typeof finalizeRowsAndSummary>;
  }> = [];

  for (const variant of EXP3_VARIANTS) {
    const speakerMap = makeSpeakerMap(variant.maleVoice, variant.femaleVoice);
    console.log(
      `\n[Exp3] Starting ${variant.label} (SB#3: 11 turns, 03:25–04:49, cache OFF, maxExtraTtsCalls=0, emotions=${variant.useDeliveryEmotions})...`
    );

    let execResult: BatchDialogueExecutionResult | null = null;
    let apiRetries = 0;

    // Retry ONLY on thrown API/network error (max 1 retry), NEVER on QA failure!
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        execResult = await synthesizeDialogueInMacroBlocks(ai, {
          turns: sb3Turns,
          speakerMap,
          strictTimeWindow: true,
          bypassCache: true,
          maxExtraTtsCalls: 0,
          useDeliveryEmotions: variant.useDeliveryEmotions,
          pronunciationDictionary: DEFAULT_PRONUNCIATION_DICTIONARY,
        });
        break;
      } catch (err: any) {
        if (attempt === 1) {
          apiRetries += 1;
          console.warn(
            `[Exp3] ${variant.label} API/network error on attempt 1, retrying once in 3s:`,
            err?.message || err
          );
          await new Promise((r) => setTimeout(r, 3000));
        } else {
          throw err;
        }
      }
    }

    if (!execResult) {
      throw new Error(`[Exp3] ${variant.label} returned empty result`);
    }

    const { baseStartSec, stitched, wavBuf } = stitchSubBlockShiftedToZero(
      sb3Turns,
      execResult.turns.map((r) => ({
        pcm: r.pcm,
        wavBase64: r.wavBase64,
        durationSec: r.dubbedDurationSec,
        originalDurationSec: r.originalDurationSec,
        atempoApplied: r.atempoApplied,
        syncStatus: r.syncStatus,
        qa: r.qa,
        qaReason: r.qaReason,
        slicingMethod: r.slicingMethod,
        generationMode: r.generationMode,
        lufsBefore: r.lufsBefore,
        lufsAfter: r.lufsAfter,
      }))
    );

    const wavOutPath = path.join(outDir, variant.wavFileName);
    fs.writeFileSync(wavOutPath, wavBuf);

    const rowsRaw: TurnMetricRow[] = execResult.turns.map((r, i) => {
      const orig = sb3Turns[i];
      const sp = speakerMap.get(orig.speakerId);
      const ac = analyzePcmAcoustics(r.pcm, orig.speakerGender === "female" ? "female" : "male");
      const st = stitched.turns[i];
      const fallbackStyle = buildCleanTurnStyleForTts(orig, sp, variant.useDeliveryEmotions);
      return {
        num: i + 1,
        speakerId: orig.speakerId,
        speakerName: r.speakerName,
        scriptTimecode: `${formatMmSsInt(orig.startSec)}–${formatMmSsInt(orig.endSec)}`,
        wavRange: `${formatMmSs(st?.startTime)}–${formatMmSs(st?.endTime)}`,
        clipDurSec: r.dubbedDurationSec,
        windowDurSec: r.originalDurationSec,
        qa: r.qaReason ? `${r.qa} (${r.qaReason.slice(0, 60)})` : r.qa,
        f0Hz: ac.f0MedHz,
        f0SemitonesFromSpeakerMed: 0,
        centroidHz: ac.centroidHz,
        tiltDb: ac.tiltDb,
        hnrProxy: ac.hnrProxy,
        lufsBefore: typeof r.lufsBefore === "number" ? r.lufsBefore : null,
        lufsAfter: typeof r.lufsAfter === "number" ? r.lufsAfter : null,
        sentStyle: r.sentStyle ?? fallbackStyle,
        sentText: r.sentText ?? orig.cleanSpeechText,
        mfcc: ac.mfcc,
      };
    });

    const data = finalizeRowsAndSummary(rowsRaw);
    const qaPassedCount = execResult.turns.filter((t) => t.qa === "ok" || t.qa === "retried").length;
    const qaFailedCount = execResult.turns.filter((t) => t.qa === "failed").length;
    const qaReasons = execResult.failedSubBlocks.flatMap((f) => f.reasons);

    console.log(
      `[Exp3] Done ${variant.label}: QA=${qaPassedCount}/${sb3Turns.length}, TTS=${execResult.ttsCallsUsed} (${execResult.ttsWallTimeMs}ms), Align=${execResult.transcribeCallsUsed} (${execResult.alignWallTimeMs}ms), wav=${(wavBuf.length / 1024 / 1024).toFixed(2)} MB`
    );

    variantResults.push({
      variant,
      wavPath: `/audio/experiments/${variant.wavFileName}`,
      wavBytes: wavBuf.length,
      totalWavDurationSec: stitched.totalDurationSeconds,
      baseStartSec,
      ttsCallsUsed: execResult.ttsCallsUsed,
      transcribeCallsUsed: execResult.transcribeCallsUsed,
      ttsWallTimeMs: execResult.ttsWallTimeMs,
      alignWallTimeMs: execResult.alignWallTimeMs,
      apiRetries,
      qaPassedCount,
      qaFailedCount,
      qaReasons,
      data,
    });
  }

  // =========================================================================
  // 3. GENERATE public/audio/experiments/exp3-report.md
  // =========================================================================
  const totalTtsCalls = variantResults.reduce((s, r) => s + r.ttsCallsUsed, 0);
  const totalAlignCalls = variantResults.reduce((s, r) => s + r.transcribeCallsUsed, 0);

  const md: string[] = [];
  md.push(`# Эксперимент 3 — Суб-блок №3 Tiggo 8 Hybrid v4 (технический текст, 03:25–04:49)`);
  md.push("");
  md.push(`- **Дата прогона:** ${new Date().toISOString()}`);
  md.push(`- **Сцена / суб-блок:** Суб-блок №3 (\`4-SAHNA. Tog‘ yo‘li, rekuperatsiya, 540° kamera va yordamchilar\`, 11 реплик, \`03:25–04:49\`, сумма окон \`79 с\`)`);
  md.push(`- **Параметры движка:** без изменений; \`bypassCache: true\`, \`maxExtraTtsCalls: 0\`, \`strictTimeWindow: true\`, словарь произношения включён, выравнивание громкости BS.1770-4 до \`-18 LUFS\`.`);
  md.push(`- **Базовые стили:** Азиз (M) = \`${DEFAULT_BASE_STYLE_MALE}\` | Вероника (F) = \`${DEFAULT_BASE_STYLE_FEMALE}\``);
  md.push(`- **Итого API-вызовов:** TTS (\`gemini-3.8-flash-tts\`) = **${totalTtsCalls}**, выравниваний = **${totalAlignCalls}** (повторы при ошибке API: ${variantResults.reduce((s, r) => s + r.apiRetries, 0)}).`);
  md.push(`- **Таймкоды в WAV:** суб-блоки №2 и №3 сдвинуты к \`00:00\` (\`exp3-ref-sb2.wav\`: сдвиг \`-01:33\`, граница \`02:30\` звучит на \`00:57\`; \`exp3-A/B/C\`: сдвиг \`-03:25\`) с полным сохранением всех интервалов и пауз между репликами.`);
  md.push("");

  md.push(`## Файлы для прослушивания`);
  md.push("");
  md.push(`| Файл | Описание | Размер / Длина | QA | Вызовы TTS / Выравнивание |`);
  md.push(`|---|---|---|---|---|`);
  md.push(
    `| \`/audio/experiments/exp3-ref-sb1.wav\` | Референс: Суб-блок №1 (\`00:00–01:33\`, 16 реплик). ${refSb1SourceNote} | ${(fs.statSync(refSb1WavPath).size / 1024 / 1024).toFixed(2)} MB | ref | 0 (из файла) |`
  );
  md.push(
    `| \`/audio/experiments/exp3-ref-sb2.wav\` | Референс: Суб-блок №2 из текущей полной озвучки (\`01:33–03:21\`, 17 реплик, \`Charon + Kore\`, эмоции ВКЛ, кэш \`${sb2Hash}.json\`; точка \`02:30\` = \`00:57\` в WAV) | ${(fs.statSync(refSb2WavPath).size / 1024 / 1024).toFixed(2)} MB, ${stitched2.stitched.totalDurationSeconds.toFixed(1)}s | ok | 0 (из кэша) |`
  );
  for (const vr of variantResults) {
    md.push(
      `| \`${vr.wavPath}\` | **${vr.variant.label}** (\`03:25–04:49\`, 11 реплик) | ${(vr.wavBytes / 1024 / 1024).toFixed(2)} MB, ${vr.totalWavDurationSec.toFixed(1)}s | **${vr.qaPassedCount}/11** | ${vr.ttsCallsUsed} (${(vr.ttsWallTimeMs / 1000).toFixed(1)}s) / ${vr.transcribeCallsUsed} (${(vr.alignWallTimeMs / 1000).toFixed(1)}s) |`
    );
  }
  md.push("");

  // Cross-variant acoustic comparison table (Aziz & Veronika separately)
  md.push(`## Сводное сравнение акустики (проверка гипотезы «тяжёлого голоса»)`);
  md.push("");
  md.push(`> **Ориентиры:** более **лёгкий/разговорный** голос обычно имеет более высокий центроид спектра (Гц), менее отрицательный наклон спектра (дБ), более высокую F0 (для женского голоса) и меньшую MFCC-дистанцию до \`ref-sb1\` / \`ref-sb2 (до 02:30)\`.`);
  md.push("");

  const comparisonGroups: Array<{ label: string; aziz: SpeakerSummary; veronika: SpeakerSummary }> = [
    { label: "ref-sb1 (00:00–01:33, Charon+Kore, эмо ВКЛ)", aziz: refSb1Data.aziz, veronika: refSb1Data.veronika },
    { label: "ref-sb2 ДО 02:30 (01:33–02:30, Charon+Kore)", aziz: refSb2Before.aziz, veronika: refSb2Before.veronika },
    { label: "ref-sb2 ПОСЛЕ 02:30 (02:30–03:21, Charon+Kore)", aziz: refSb2After.aziz, veronika: refSb2After.veronika },
  ];
  if (refSb3Data) {
    comparisonGroups.push({
      label: "ref-sb3 ТЕКУЩАЯ (03:25–04:49, Charon+Kore, эмо ВКЛ)",
      aziz: refSb3Data.aziz,
      veronika: refSb3Data.veronika,
    });
  }
  for (const vr of variantResults) {
    comparisonGroups.push({
      label: `exp3-${vr.variant.id} (${vr.variant.maleVoice}+${vr.variant.femaleVoice}, эмо ${vr.variant.useDeliveryEmotions ? "ВКЛ" : "ВЫКЛ"})`,
      aziz: vr.data.aziz,
      veronika: vr.data.veronika,
    });
  }

  const fmtSummaryTable = (speakerKey: "aziz" | "veronika", title: string) => {
    md.push(`### ${title}`);
    md.push("");
    md.push(
      `| Участок / Вариант | Реплик | Медиана F0 (диапазон) | Средний центроид (яркость) | Наклон спектра | HNR | Средний LUFS до | MFCC до SB1 | MFCC до SB2 (<02:30) |`
    );
    md.push(`|---|---:|---:|---:|---:|---:|---:|---:|---:|`);
    const ref1Mfcc = refSb1Data[speakerKey].avgMfcc;
    const ref2EarlyMfcc = refSb2Before[speakerKey].avgMfcc;
    for (const g of comparisonGroups) {
      const s = g[speakerKey];
      const lBef = s.lufsBeforeMean !== null ? `${s.lufsBeforeMean.toFixed(1)} LUFS` : "—";
      const d1 = mfccDistance(s.avgMfcc, ref1Mfcc).toFixed(1);
      const d2 = mfccDistance(s.avgMfcc, ref2EarlyMfcc).toFixed(1);
      md.push(
        `| ${g.label} | ${s.turnCount} | ${s.f0MedHz.toFixed(0)} Гц (${s.f0MinHz.toFixed(0)}–${s.f0MaxHz.toFixed(0)}) | ${s.centroidMeanHz.toFixed(0)} Гц | ${s.tiltMeanDb.toFixed(1)} дБ | ${s.hnrMean.toFixed(2)} | ${lBef} | ${d1} | ${d2} |`
      );
    }
    md.push("");
  };

  fmtSummaryTable("aziz", "Азиз (Charon во всех вариантах)");
  fmtSummaryTable("veronika", "Вероника (Kore / Aoede / Zephyr)");

  // Per-turn detailed tables
  const pushTurnTable = (title: string, subtitle: string, rows: TurnMetricRow[]) => {
    md.push(`## ${title}`);
    md.push("");
    if (subtitle) {
      md.push(subtitle);
      md.push("");
    }
    md.push(
      `| # | Спикер | Таймкод | В WAV | Клип/Окно | QA | F0 (Гц / полут.) | Центроид (яркость) | Наклон | LUFS до → после | Отправленный style | Отправленный текст |`
    );
    md.push(`|---:|---|---|---|---|---|---:|---:|---:|---|---|---|`);
    for (const r of rows) {
      const stStr = Number.isFinite(r.f0SemitonesFromSpeakerMed)
        ? `${r.f0SemitonesFromSpeakerMed >= 0 ? "+" : ""}${r.f0SemitonesFromSpeakerMed.toFixed(1)} st`
        : "—";
      const lBef = r.lufsBefore !== null ? r.lufsBefore.toFixed(1) : "—";
      const lAft = r.lufsAfter !== null ? r.lufsAfter.toFixed(1) : "—";
      md.push(
        `| ${String(r.num).padStart(2, "0")} | ${escapeMdCell(r.speakerName)} | ${r.scriptTimecode} | ${r.wavRange} | ${r.clipDurSec.toFixed(2)}s/${r.windowDurSec.toFixed(1)}s | ${escapeMdCell(r.qa)} | ${r.f0Hz.toFixed(0)} Гц (${stStr}) | ${r.centroidHz.toFixed(0)} Гц | ${r.tiltDb.toFixed(1)} дБ | ${lBef} → ${lAft} | \`${escapeMdCell(r.sentStyle)}\` | ${escapeMdCell(r.sentText)} |`
      );
    }
    md.push("");
  };

  for (const vr of variantResults) {
    const qaNote = vr.qaReasons.length > 0 ? ` Замечания QA: \`${escapeMdCell(vr.qaReasons.join("; "))}\`.` : "";
    pushTurnTable(
      `Эксперимент 3 — ${vr.variant.label}`,
      `WAV: \`${vr.wavPath}\` (сдвиг \`-03:25\`). QA: **${vr.qaPassedCount}/11**, TTS: ${vr.ttsCallsUsed} (${(vr.ttsWallTimeMs / 1000).toFixed(2)}s), выравнивание: ${vr.transcribeCallsUsed} (${(vr.alignWallTimeMs / 1000).toFixed(2)}s).${qaNote}`,
      vr.data.rows
    );
  }

  if (refSb3Data) {
    pushTurnTable(
      `Референс: текущий Суб-блок №3 из полной озвучки (Charon + Kore, эмоции ВКЛ)`,
      `Кэш: \`data/dubbing-block-cache/${sb3Hash}.json\` (0 вызовов TTS).`,
      refSb3Data.rows
    );
  }

  pushTurnTable(
    `Референс: Суб-блок №2 из текущей полной озвучки (exp3-ref-sb2.wav)`,
    `WAV: \`/audio/experiments/exp3-ref-sb2.wav\` (сдвиг \`-01:33\`, кэш \`${sb2Hash}.json\`, 0 вызовов TTS). Переломный момент \`02:30\` = реплика #10 (\`00:57\` в WAV).`,
    refSb2All.rows
  );

  pushTurnTable(
    `Референс: Суб-блок №1 (exp3-ref-sb1.wav)`,
    `WAV: \`/audio/experiments/exp3-ref-sb1.wav\`. ${refSb1SourceNote}.`,
    refSb1Data.rows
  );

  const reportPath = path.join(outDir, "exp3-report.md");
  fs.writeFileSync(reportPath, md.join("\n"), "utf8");

  return {
    ok: true,
    reportPath: "/audio/experiments/exp3-report.md",
    totalTtsCalls,
    totalAlignCalls,
    refFiles: [
      { file: "/audio/experiments/exp3-ref-sb1.wav", bytes: fs.statSync(refSb1WavPath).size },
      { file: "/audio/experiments/exp3-ref-sb2.wav", bytes: fs.statSync(refSb2WavPath).size },
    ],
    variants: variantResults.map((vr) => ({
      id: vr.variant.id,
      label: vr.variant.label,
      wavPath: vr.wavPath,
      wavBytes: vr.wavBytes,
      qa: `${vr.qaPassedCount}/11`,
      ttsCallsUsed: vr.ttsCallsUsed,
      transcribeCallsUsed: vr.transcribeCallsUsed,
      apiRetries: vr.apiRetries,
      aziz: {
        f0MedHz: Math.round(vr.data.aziz.f0MedHz),
        centroidMeanHz: Math.round(vr.data.aziz.centroidMeanHz),
        tiltMeanDb: Number(vr.data.aziz.tiltMeanDb.toFixed(1)),
        lufsBeforeMean: vr.data.aziz.lufsBeforeMean !== null ? Number(vr.data.aziz.lufsBeforeMean.toFixed(1)) : null,
      },
      veronika: {
        f0MedHz: Math.round(vr.data.veronika.f0MedHz),
        centroidMeanHz: Math.round(vr.data.veronika.centroidMeanHz),
        tiltMeanDb: Number(vr.data.veronika.tiltMeanDb.toFixed(1)),
        lufsBeforeMean: vr.data.veronika.lufsBeforeMean !== null ? Number(vr.data.veronika.lufsBeforeMean.toFixed(1)) : null,
      },
    })),
  };
}
