import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { parseReadyScript } from "../src/utils/readyScriptParser.ts";
import { planDialogueSubBlocks } from "../src/utils/dialogueMacroBlocks.ts";
import { normalizeUzbekSpeech } from "../src/utils/uzbekNormalizer.ts";
import { DUBBING_MODELS_CONFIG } from "../server/config/dubbingModels.ts";
import { sanitizeDocumentedTtsTags } from "../server/services/verbatimStoryboardService.ts";
import {
  alignBatchAudioViaTranscribe,
  buildWav24k,
  extractRawPcm24k,
  PCM_BYTES_PER_SEC,
  PCM_SAMPLE_RATE,
  type SlicedTurnClip,
} from "../server/services/dubbing/batchAudioSlicer.ts";
import {
  computeSubBlockCacheHash,
  evaluateSubBlockQa,
  stripLegacyPauseArtifacts,
  type BatchInputTurn,
  type ResolvedBatchSpeaker,
} from "../server/services/dubbing/batchDialogueEngine.ts";

dotenv.config();

const FIXTURE_PATH = path.resolve(
  process.cwd(),
  "scripts",
  "fixtures",
  "01_tiggo_8_hybrid_uz_dublyaj_v4.txt"
);
const CACHE_DIR = path.resolve(process.cwd(), "data", "dubbing-block-cache");
const OUTPUT_WAV_PATH = path.resolve(
  process.cwd(),
  "public",
  "audio",
  "voice-drift-probe-scenes1-2.wav"
);

export interface ClipAcousticMetrics {
  durationSec: number;
  medianF0Hz: number;
  voicedFrames: number;
  speechRmsDb: number;
  peakDb: number;
}

export interface TurnComparisonRow {
  turnIndex: number;
  timecode: string;
  sceneShort: string;
  speakerId: string;
  speakerName: string;
  gender: "male" | "female";
  textPreview: string;
  experiment: {
    qaOk: boolean;
    qaIssues: string[];
    method: string;
    durationSec: number;
    f0Hz: number;
    semitonesFromSpeakerMedian: number | null;
    speechDb: number;
    spokenText?: string;
    detectedVoice?: string;
  };
  cached: {
    subBlockNum: number;
    subBlockQa: string;
    durationSec: number;
    f0Hz: number;
    semitonesFromSpeakerMedian: number | null;
    speechDb: number;
  } | null;
}

export interface SpeakerSummaryStats {
  speakerId: string;
  speakerName: string;
  voiceName: string;
  experimentMedianF0Hz: number;
  experimentF0RangeHz: [number, number];
  experimentSemitoneSpread: number;
  experimentDbRange: [number, number];
  experimentDbSpread: number;
  cachedMedianF0Hz: number;
  cachedF0RangeHz: [number, number];
  cachedSemitoneSpread: number;
  cachedDbRange: [number, number];
  cachedDbSpread: number;
}

export interface VoiceDriftProbeReport {
  wavPath: string;
  wavPublicUrl: string;
  ttsCallsUsed: number;
  alignmentCallsUsed: number;
  rawAudioDurationSec: number;
  overallQaPassed: boolean;
  overallQaReasons: string[];
  blockDurationRatio: number;
  transcriptWordRatio?: number;
  rows: TurnComparisonRow[];
  speakerSummaries: SpeakerSummaryStats[];
}

function computeMedian(values: number[]): number {
  const valid = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (valid.length === 0) return 0;
  const mid = Math.floor(valid.length / 2);
  return valid.length % 2 === 1 ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2;
}

function semitoneDiff(f0Hz: number, refHz: number): number | null {
  if (!Number.isFinite(f0Hz) || f0Hz <= 0 || !Number.isFinite(refHz) || refHz <= 0) {
    return null;
  }
  return Math.round(12 * Math.log2(f0Hz / refHz) * 100) / 100;
}

/**
 * Measures median F0 (Hz via autocorrelation on voiced frames) and speech-only RMS loudness (dBFS,
 * excluding silence frames below -45 dBFS) on 24 kHz 16-bit mono PCM.
 */
export function measureClipAcoustics(pcm: Buffer): ClipAcousticMetrics {
  const totalSamples = Math.floor(pcm.length / 2);
  const durationSec = Math.round((totalSamples / PCM_SAMPLE_RATE) * 100) / 100;
  if (totalSamples < 480) {
    return { durationSec, medianF0Hz: 0, voicedFrames: 0, speechRmsDb: -90, peakDb: -90 };
  }

  let peakAbs = 0;
  for (let i = 0; i < totalSamples; i++) {
    const a = Math.abs(pcm.readInt16LE(i * 2)) / 32768;
    if (a > peakAbs) peakAbs = a;
  }
  const peakDb = Math.round(20 * Math.log10(Math.max(1e-6, peakAbs)) * 10) / 10;

  // Speech-only RMS over 20ms frames (480 samples) above -45 dBFS (~0.0056)
  const rmsFrameLen = 480;
  const speechThresholdLinear = Math.pow(10, -45 / 20);
  let speechSumSq = 0;
  let speechSampleCount = 0;
  for (let start = 0; start + rmsFrameLen <= totalSamples; start += rmsFrameLen) {
    let frameSumSq = 0;
    for (let i = 0; i < rmsFrameLen; i++) {
      const s = pcm.readInt16LE((start + i) * 2) / 32768;
      frameSumSq += s * s;
    }
    const frameRms = Math.sqrt(frameSumSq / rmsFrameLen);
    if (frameRms >= speechThresholdLinear) {
      speechSumSq += frameSumSq;
      speechSampleCount += rmsFrameLen;
    }
  }
  const speechRmsLinear =
    speechSampleCount > 0 ? Math.sqrt(speechSumSq / speechSampleCount) : 1e-6;
  const speechRmsDb = Math.round(20 * Math.log10(Math.max(1e-6, speechRmsLinear)) * 10) / 10;

  // Autocorrelation F0 over 40ms frames (960 samples), 20ms hop, range 75..340 Hz
  const frameLen = 960;
  const hop = 480;
  const minLag = Math.floor(PCM_SAMPLE_RATE / 340);
  const maxLag = Math.floor(PCM_SAMPLE_RATE / 75);
  const f0s: number[] = [];

  for (let start = 0; start + frameLen <= totalSamples; start += hop) {
    let energy = 0;
    for (let i = 0; i < frameLen; i++) {
      const s = pcm.readInt16LE((start + i) * 2);
      energy += s * s;
    }
    const rms16 = Math.sqrt(energy / frameLen);
    if (rms16 < 700) continue;

    let bestLag = -1;
    let bestCorr = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let num = 0;
      let d1 = 0;
      let d2 = 0;
      for (let i = 0; i < frameLen - lag; i += 2) {
        const a = pcm.readInt16LE((start + i) * 2);
        const b = pcm.readInt16LE((start + i + lag) * 2);
        num += a * b;
        d1 += a * a;
        d2 += b * b;
      }
      const corr = num / (Math.sqrt(d1 * d2) + 1e-9);
      if (corr > bestCorr) {
        bestCorr = corr;
        bestLag = lag;
      }
    }
    if (bestCorr > 0.55 && bestLag > 0) {
      f0s.push(PCM_SAMPLE_RATE / bestLag);
    }
  }

  return {
    durationSec,
    medianF0Hz: Math.round(computeMedian(f0s) * 10) / 10,
    voicedFrames: f0s.length,
    speechRmsDb,
    peakDb,
  };
}

function buildTiggo8BatchTurnsAndCacheBaseline(): {
  scenes12Turns: BatchInputTurn[];
  speakerMap: Map<string, ResolvedBatchSpeaker>;
  cachedClipsByTurnIndex: Map<
    number,
    { subBlockNum: number; subBlockQa: string; pcm: Buffer }
  >;
} {
  const raw = fs.readFileSync(FIXTURE_PATH, "utf8");
  const parsed = parseReadyScript(raw);

  const speakerMap = new Map<string, ResolvedBatchSpeaker>([
    [
      "HOST_1",
      {
        speakerId: "HOST_1",
        speakerName: "Азиз",
        baseVoice: "Charon",
        voiceId: "Charon",
        gender: "male",
        isCloned: false,
        baseSpeechStyle: "",
      },
    ],
    [
      "HOST_2",
      {
        speakerId: "HOST_2",
        speakerName: "Вероника",
        baseVoice: "Kore",
        voiceId: "Kore",
        gender: "female",
        isCloned: false,
        baseSpeechStyle: "",
      },
    ],
  ]);

  const toBatchTurn = (t: any, idx: number, allTurns: any[]): BatchInputTurn => {
    const nextStart =
      idx + 1 < allTurns.length && typeof allTurns[idx + 1]?.startSec === "number"
        ? allTurns[idx + 1].startSec
        : t.endSec || 0;
    const gapAfterSec =
      typeof t.endSec === "number"
        ? Math.max(0, Math.round((nextStart - t.endSec) * 100) / 100)
        : 0;
    let spoken = String(t.text || "").trim();
    try {
      spoken = normalizeUzbekSpeech(spoken, {
        decimalStyle: DUBBING_MODELS_CONFIG.decimalPronunciationStyle,
      });
    } catch {}
    const cleanSpeechText = sanitizeDocumentedTtsTags(spoken) || "...";
    return {
      id: t.id || `turn-${idx}`,
      index: idx,
      speakerId: t.speakerId || "HOST_1",
      speakerName: t.speakerName || (t.speakerId === "HOST_2" ? "Вероника" : "Азиз"),
      text: String(t.text || "").trim(),
      cleanSpeechText,
      style: [t.speechStyle, t.intonationRu].filter(Boolean).join(", "),
      startSec: t.startSec,
      endSec: t.endSec,
      gapAfterSec,
      emotion: t.emotion,
      intonationRu: t.intonationRu,
      originalTextRu: t.originalTextRu,
      speakerGender: t.speakerGender || (t.speakerId === "HOST_2" ? "female" : "male"),
      sceneTitle: t.sceneTitle,
      rawTurn: t,
    };
  };

  const allBatchTurns = parsed.turns.map((t, i) => toBatchTurn(t, i, parsed.turns));

  // Scenes 1–2 = turns 0..15 (16 turns)
  const scenes12Turns = allBatchTurns.filter((t) =>
    /^(1-SAHNA|2-SAHNA)/i.test(String(t.sceneTitle || ""))
  );
  if (scenes12Turns.length !== 16) {
    throw new Error(`Expected 16 turns in Scenes 1-2 of Tiggo 8 v4, got ${scenes12Turns.length}`);
  }

  // Load existing cached sub-blocks covering these exact 16 turns (SB#1, SB#2, SB#3) for comparison
  const currentSubBlocks = planDialogueSubBlocks(allBatchTurns, {
    maxTurns: 8,
    maxWindowSec: 40,
  });
  const cachedClipsByTurnIndex = new Map<
    number,
    { subBlockNum: number; subBlockQa: string; pcm: Buffer }
  >();

  for (let sbIdx = 0; sbIdx < currentSubBlocks.length; sbIdx++) {
    const sb = currentSubBlocks[sbIdx];
    if (sb.startTurnIndex >= scenes12Turns.length) break;
    const hash = computeSubBlockCacheHash(sb.turns, speakerMap, "A");
    const filePath = path.join(CACHE_DIR, `${hash}.json`);
    if (!fs.existsSync(filePath)) continue;
    const entry = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!Array.isArray(entry.clips) || entry.clips.length !== sb.turns.length) continue;
    for (let k = 0; k < sb.turns.length; k++) {
      const globalIdx = sb.startTurnIndex + k;
      if (globalIdx < scenes12Turns.length) {
        cachedClipsByTurnIndex.set(globalIdx, {
          subBlockNum: sbIdx + 1,
          subBlockQa: String(entry.qa || "ok"),
          pcm: Buffer.from(entry.clips[k], "base64"),
        });
      }
    }
  }

  return { scenes12Turns, speakerMap, cachedClipsByTurnIndex };
}

/**
 * Step 1 Experiment:
 * - Scenes 1–2 of Tiggo 8 v4 (16 turns) in ONE Mode A call (Charon + Kore), empty style on all turns.
 * - Strictly 1 TTS call (never > 2), ZERO cache writes.
 * - Existing alignment (gemini-4-hydrogen) + existing evaluateSubBlockQa.
 * - Saves experiment WAV to public/audio/voice-drift-probe-scenes1-2.wav.
 */
export async function runVoiceDriftProbe(ai: GoogleGenAI): Promise<VoiceDriftProbeReport> {
  const { scenes12Turns, speakerMap, cachedClipsByTurnIndex } =
    buildTiggo8BatchTurnsAndCacheBaseline();

  const tag1 = "SpeakerOne"; // HOST_1 = Азиз = Charon
  const tag2 = "SpeakerTwo"; // HOST_2 = Вероника = Kore

  const parts = scenes12Turns.map((t) => ({
    text: stripLegacyPauseArtifacts(t.cleanSpeechText),
    speechMetadata: {
      speaker: t.speakerId === "HOST_1" ? tag1 : tag2,
      style: "",
    },
  }));

  console.log(
    `[voice-drift-probe] Calling ${DUBBING_MODELS_CONFIG.ttsDubbingModel} (Mode A, 1 call, ${parts.length} turns, empty style, Charon + Kore)...`
  );

  // Strictly 1 TTS call (budget <= 2), NO cache writes
  const ttsResp = await ai.models.generateContent({
    model: DUBBING_MODELS_CONFIG.ttsDubbingModel,
    contents: [{ role: "user", parts: parts as any }],
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: [
            {
              speaker: tag1,
              voiceConfig: { prebuiltVoiceConfig: { voiceName: "Charon" } },
            },
            {
              speaker: tag2,
              voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
            },
          ],
        },
      },
    },
  });

  const resParts = ttsResp.candidates?.[0]?.content?.parts || [];
  const audioParts = resParts.filter((p: any) => typeof p?.inlineData?.data === "string");
  if (audioParts.length === 0) {
    throw new Error("Gemini TTS returned empty audio for voice-drift-probe");
  }

  const blockPcm = Buffer.concat(
    audioParts.map((ap: any) => extractRawPcm24k(Buffer.from(ap.inlineData.data, "base64")))
  );
  const rawAudioDurationSec = Math.round((blockPcm.length / PCM_BYTES_PER_SEC) * 100) / 100;

  // Save experiment WAV for listening
  fs.mkdirSync(path.dirname(OUTPUT_WAV_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_WAV_PATH, buildWav24k(blockPcm));

  console.log(
    `[voice-drift-probe] Raw TTS audio: ${rawAudioDurationSec}s saved to ${OUTPUT_WAV_PATH}. Aligning via ${DUBBING_MODELS_CONFIG.audioAlignmentModel}...`
  );

  // Align & verify using existing alignBatchAudioViaTranscribe + evaluateSubBlockQa
  const aligned = await alignBatchAudioViaTranscribe(
    ai,
    blockPcm,
    scenes12Turns.map((t, i) => ({
      index: i,
      speaker: t.speakerName,
      text: stripLegacyPauseArtifacts(t.cleanSpeechText),
      gender: t.speakerGender,
    })),
    DUBBING_MODELS_CONFIG.audioAlignmentModel,
    { silenceMinMs: 120, snapToleranceSec: 0.6 }
  );

  let cursorMs = 0;
  const slicedClipsForQa: Array<{
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

  for (let i = 0; i < scenes12Turns.length; i++) {
    const clip: SlicedTurnClip | null = aligned.clips[i] || null;
    const alignInfo = aligned.turnAlignments[i];
    if (clip) {
      const sMs = Math.max(cursorMs, clip.startMs);
      const eMs = Math.max(sMs + 100, clip.endMs);
      slicedClipsForQa.push({
        pcm: clip.pcm,
        startMs: sMs,
        endMs: eMs,
        durationSec: clip.durationSec,
        method: clip.method,
        spokenText: clip.spokenText,
        detectedVoice: clip.detectedVoice,
        boundarySnapped: clip.boundarySnapped,
        boundaryIssue: clip.boundaryIssue,
      });
      cursorMs = eMs;
    } else {
      const fallbackPcm = Buffer.alloc(Math.round(0.35 * PCM_BYTES_PER_SEC), 0);
      slicedClipsForQa.push({
        pcm: fallbackPcm,
        startMs: cursorMs,
        endMs: cursorMs + 350,
        durationSec: 0.35,
        method: "missing_turn",
        spokenText: alignInfo?.spokenText ?? "",
        detectedVoice: alignInfo?.voice ?? "unknown",
        boundarySnapped: false,
        boundaryIssue: alignInfo?.boundaryIssue || `missing_turn (turn ${i})`,
      });
      cursorMs += 350;
    }
  }

  const qaEval = evaluateSubBlockQa({
    expectedTurns: scenes12Turns,
    slicedClips: slicedClipsForQa,
    transcriptText: aligned.heardTranscript,
    speakerMap,
  });

  // Measure acoustics for all 16 experiment clips and all 16 cached baseline clips
  const expMetrics = slicedClipsForQa.map((c) => measureClipAcoustics(c.pcm));
  const cachedMetrics = scenes12Turns.map((_, i) => {
    const cached = cachedClipsByTurnIndex.get(i);
    return cached ? { ...cached, metrics: measureClipAcoustics(cached.pcm) } : null;
  });

  // Compute speaker medians for semitone offset calculation
  const expMedianBySpeaker = new Map<string, number>();
  const cachedMedianBySpeaker = new Map<string, number>();
  for (const spId of ["HOST_1", "HOST_2"]) {
    const expF0s = scenes12Turns
      .map((t, i) => (t.speakerId === spId ? expMetrics[i].medianF0Hz : 0))
      .filter((v) => v > 0);
    expMedianBySpeaker.set(spId, computeMedian(expF0s));

    const cachedF0s = scenes12Turns
      .map((t, i) =>
        t.speakerId === spId && cachedMetrics[i] ? cachedMetrics[i]!.metrics.medianF0Hz : 0
      )
      .filter((v) => v > 0);
    cachedMedianBySpeaker.set(spId, computeMedian(cachedF0s));
  }

  const formatMmSs = (sec?: number) => {
    const s = Math.max(0, Math.round(sec || 0));
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };

  const rows: TurnComparisonRow[] = scenes12Turns.map((t, i) => {
    const turnIssuePattern = new RegExp(`\\bturn ${i}\\b`);
    const perTurnIssues = qaEval.reasons.filter((r) => turnIssuePattern.test(r));
    const isBadIdx = qaEval.badClipIndices.includes(i);
    const spExpMed = expMedianBySpeaker.get(t.speakerId) || 0;
    const spCachedMed = cachedMedianBySpeaker.get(t.speakerId) || 0;
    const c = cachedMetrics[i];

    return {
      turnIndex: i,
      timecode: `${formatMmSs(t.startSec)}-${formatMmSs(t.endSec)}`,
      sceneShort: /^1-SAHNA/i.test(String(t.sceneTitle || "")) ? "S1" : "S2",
      speakerId: t.speakerId,
      speakerName: t.speakerName,
      gender: t.speakerGender || (t.speakerId === "HOST_2" ? "female" : "male"),
      textPreview: t.text.slice(0, 42),
      experiment: {
        qaOk: !isBadIdx && perTurnIssues.length === 0,
        qaIssues: perTurnIssues,
        method: slicedClipsForQa[i].method,
        durationSec: expMetrics[i].durationSec,
        f0Hz: expMetrics[i].medianF0Hz,
        semitonesFromSpeakerMedian: semitoneDiff(expMetrics[i].medianF0Hz, spExpMed),
        speechDb: expMetrics[i].speechRmsDb,
        spokenText: slicedClipsForQa[i].spokenText,
        detectedVoice: slicedClipsForQa[i].detectedVoice,
      },
      cached: c
        ? {
            subBlockNum: c.subBlockNum,
            subBlockQa: c.subBlockQa,
            durationSec: c.metrics.durationSec,
            f0Hz: c.metrics.medianF0Hz,
            semitonesFromSpeakerMedian: semitoneDiff(c.metrics.medianF0Hz, spCachedMed),
            speechDb: c.metrics.speechRmsDb,
          }
        : null,
    };
  });

  const speakerSummaries: SpeakerSummaryStats[] = (["HOST_1", "HOST_2"] as const).map((spId) => {
    const sp = speakerMap.get(spId)!;
    const spRows = rows.filter((r) => r.speakerId === spId);

    const expF0s = spRows.map((r) => r.experiment.f0Hz).filter((v) => v > 0);
    const expSts = spRows
      .map((r) => r.experiment.semitonesFromSpeakerMedian)
      .filter((v): v is number => v !== null);
    const expDbs = spRows.map((r) => r.experiment.speechDb).filter((v) => v > -85);

    const cF0s = spRows.map((r) => r.cached?.f0Hz || 0).filter((v) => v > 0);
    const cSts = spRows
      .map((r) => r.cached?.semitonesFromSpeakerMedian ?? null)
      .filter((v): v is number => v !== null);
    const cDbs = spRows
      .map((r) => r.cached?.speechDb ?? -90)
      .filter((v) => v > -85);

    return {
      speakerId: spId,
      speakerName: sp.speakerName,
      voiceName: sp.baseVoice,
      experimentMedianF0Hz: Math.round((expMedianBySpeaker.get(spId) || 0) * 10) / 10,
      experimentF0RangeHz: expF0s.length ? [Math.min(...expF0s), Math.max(...expF0s)] : [0, 0],
      experimentSemitoneSpread: expSts.length
        ? Math.round((Math.max(...expSts) - Math.min(...expSts)) * 100) / 100
        : 0,
      experimentDbRange: expDbs.length ? [Math.min(...expDbs), Math.max(...expDbs)] : [0, 0],
      experimentDbSpread: expDbs.length
        ? Math.round((Math.max(...expDbs) - Math.min(...expDbs)) * 10) / 10
        : 0,
      cachedMedianF0Hz: Math.round((cachedMedianBySpeaker.get(spId) || 0) * 10) / 10,
      cachedF0RangeHz: cF0s.length ? [Math.min(...cF0s), Math.max(...cF0s)] : [0, 0],
      cachedSemitoneSpread: cSts.length
        ? Math.round((Math.max(...cSts) - Math.min(...cSts)) * 100) / 100
        : 0,
      cachedDbRange: cDbs.length ? [Math.min(...cDbs), Math.max(...cDbs)] : [0, 0],
      cachedDbSpread: cDbs.length
        ? Math.round((Math.max(...cDbs) - Math.min(...cDbs)) * 10) / 10
        : 0,
    };
  });

  return {
    wavPath: OUTPUT_WAV_PATH,
    wavPublicUrl: "/audio/voice-drift-probe-scenes1-2.wav",
    ttsCallsUsed: 1,
    alignmentCallsUsed: aligned.usedApiCall ? 1 : 0,
    rawAudioDurationSec,
    overallQaPassed: qaEval.passed,
    overallQaReasons: qaEval.reasons,
    blockDurationRatio: qaEval.blockDurationRatio,
    transcriptWordRatio: qaEval.transcriptWordRatio,
    rows,
    speakerSummaries,
  };
}

export function printVoiceDriftProbeReport(report: VoiceDriftProbeReport) {
  console.log("\n======================================================================");
  console.log("VOICE DRIFT PROBE — Tiggo 8 v4 Scenes 1–2 (16 turns, 1 Mode A call)");
  console.log("======================================================================");
  console.log(
    `WAV saved: ${report.wavPath} (${report.rawAudioDurationSec}s) | TTS calls: ${report.ttsCallsUsed} | Align calls: ${report.alignmentCallsUsed}`
  );
  console.log(
    `Overall QA: ${report.overallQaPassed ? "PASS" : "FAIL"} | blockDurationRatio=${report.blockDurationRatio} | wordRatio=${report.transcriptWordRatio ?? "n/a"}`
  );
  if (report.overallQaReasons.length > 0) {
    console.log(`QA reasons: ${report.overallQaReasons.join(" | ")}`);
  }

  console.log("\nPer-turn comparison (Experiment 1x16 empty-style vs Cached 3 sub-blocks):");
  for (const r of report.rows) {
    const expSt =
      r.experiment.semitonesFromSpeakerMedian !== null
        ? `${r.experiment.semitonesFromSpeakerMedian >= 0 ? "+" : ""}${r.experiment.semitonesFromSpeakerMedian}st`
        : "n/a";
    const cStr = r.cached
      ? `SB#${r.cached.subBlockNum}(${r.cached.subBlockQa}) ${r.cached.f0Hz}Hz (${r.cached.semitonesFromSpeakerMedian !== null ? `${r.cached.semitonesFromSpeakerMedian >= 0 ? "+" : ""}${r.cached.semitonesFromSpeakerMedian}st` : "n/a"}) ${r.cached.speechDb}dB [${r.cached.durationSec}s]`
      : "no cache";
    console.log(
      `  #${String(r.turnIndex + 1).padStart(2, "0")} [${r.sceneShort} ${r.timecode}] ${r.speakerName.padEnd(8)} | EXP: ${r.experiment.qaOk ? "OK  " : "FAIL"} ${r.experiment.f0Hz}Hz (${expSt.padStart(6)}) ${r.experiment.speechDb}dB [${r.experiment.durationSec}s] | CACHE: ${cStr}${r.experiment.qaIssues.length ? ` | ERR: ${r.experiment.qaIssues.join("; ")}` : ""}`
    );
  }

  console.log("\nPer-speaker summary:");
  for (const s of report.speakerSummaries) {
    console.log(
      `  ${s.speakerName} (${s.voiceName}):` +
        `\n    EXP   (1x16, style=""): med=${s.experimentMedianF0Hz}Hz | range=${s.experimentF0RangeHz[0]}..${s.experimentF0RangeHz[1]}Hz (spread ${s.experimentSemitoneSpread} st) | loudness=${s.experimentDbRange[0]}..${s.experimentDbRange[1]}dB (spread ${s.experimentDbSpread} dB)` +
        `\n    CACHE (3 SB, old style): med=${s.cachedMedianF0Hz}Hz | range=${s.cachedF0RangeHz[0]}..${s.cachedF0RangeHz[1]}Hz (spread ${s.cachedSemitoneSpread} st) | loudness=${s.cachedDbRange[0]}..${s.cachedDbRange[1]}dB (spread ${s.cachedDbSpread} dB)`
    );
  }
}

async function main() {
  const apiKey = (
    process.env.GEMINI_API_KEY ||
    process.env.API_KEY ||
    process.env.GOOGLE_API_KEY ||
    ""
  ).trim();

  if (apiKey) {
    const ai = new GoogleGenAI({
      apiKey,
      apiVersion: "v1beta",
      httpOptions: { headers: { "User-Agent": "aistudio-build" } },
    });
    const report = await runVoiceDriftProbe(ai);
    printVoiceDriftProbeReport(report);
    return;
  }

  // Fallback when run from sandbox shell where GEMINI_API_KEY is only injected into the local dev server
  const localUrl = process.env.VOICE_DRIFT_PROBE_URL || "http://127.0.0.1:3000/api/internal/voice-drift-probe";
  const resp = await fetch(localUrl, { method: "POST" });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(
      `GEMINI_API_KEY is not set in shell and local probe endpoint returned HTTP ${resp.status}: ${body.slice(0, 300)}`
    );
  }
  const report = (await resp.json()) as VoiceDriftProbeReport;
  printVoiceDriftProbeReport(report);
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((err) => {
    console.error("[voice-drift-probe] Failed:", err);
    process.exit(1);
  });
}
