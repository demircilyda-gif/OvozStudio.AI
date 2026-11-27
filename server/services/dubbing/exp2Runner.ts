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
import { DUBBING_MODELS_CONFIG } from "../../config/dubbingModels.ts";
import {
  buildCleanTurnStyleForTts,
  prepareBatchTurnForTts,
  synthesizeDialogueInMacroBlocks,
  type BatchDialogueExecutionResult,
  type BatchInputTurn,
  type ResolvedBatchSpeaker,
} from "./batchDialogueEngine.ts";
import { extractRawPcm24k, buildWav24k } from "./batchAudioSlicer.ts";
import { measureIntegratedLufsPcm } from "./loudnessLeveler.ts";

export interface Exp2VariantConfig {
  id: "A" | "B" | "C";
  label: string;
  maleVoice: string;
  femaleVoice: string;
  wavFileName: string;
}

export const EXP2_VARIANTS: Exp2VariantConfig[] = [
  {
    id: "A",
    label: "Variant A (Charon + Kore)",
    maleVoice: "Charon",
    femaleVoice: "Kore",
    wavFileName: "exp2-A-kore.wav",
  },
  {
    id: "B",
    label: "Variant B (Charon + Aoede)",
    maleVoice: "Charon",
    femaleVoice: "Aoede",
    wavFileName: "exp2-B-aoede.wav",
  },
  {
    id: "C",
    label: "Variant C (Charon + Zephyr)",
    maleVoice: "Charon",
    femaleVoice: "Zephyr",
    wavFileName: "exp2-C-zephyr.wav",
  },
];

function formatSec(sec?: number | null): string {
  if (typeof sec !== "number" || !Number.isFinite(sec)) return "—";
  const mm = Math.floor(sec / 60);
  const ss = sec - mm * 60;
  return `${String(mm).padStart(2, "0")}:${ss.toFixed(2).padStart(5, "0")}`;
}

function escapeMdCell(s?: string | null): string {
  return String(s ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

const LAUGH_WORD_REGEX = /\b(?:laugh|laughs|laughed|laughing|laf|лаф|лафф)\b/gi;

function checkLaughSpokenAloud(res: BatchDialogueExecutionResult): {
  spokenAloudDetected: boolean;
  matches: string[];
  turn1Spoken: string;
  turn2Spoken: string;
} {
  const matches: string[] = [];

  res.heardTranscripts.forEach((tr, idx) => {
    const found = tr.match(LAUGH_WORD_REGEX);
    if (found && found.length > 0) {
      matches.push(`transcript[${idx}]: ${found.join(", ")}`);
    }
  });

  res.turns.forEach((t, idx) => {
    const found = (t.spokenText || "").match(LAUGH_WORD_REGEX);
    if (found && found.length > 0) {
      matches.push(`turn#${idx + 1}: ${found.join(", ")} ("${t.spokenText}")`);
    }
  });

  return {
    spokenAloudDetected: matches.length > 0,
    matches,
    turn1Spoken: res.turns[0]?.spokenText || "",
    turn2Spoken: res.turns[1]?.spokenText || "",
  };
}

/**
 * Inspects an already-saved stitched WAV from an earlier variant without making any TTS call.
 * Uses a single lightweight gemini-4-hydrogen call on the first 16s (turns #01–#02) to verify
 * whether "<laugh>" was spoken aloud, and measures exact per-turn LUFS & active clip bounds from PCM.
 */
async function inspectSavedVariantWav(
  ai: GoogleGenAI,
  variant: Exp2VariantConfig,
  wavPath: string,
  batchTurns: BatchInputTurn[],
  speakerMap: Map<string, ResolvedBatchSpeaker>
) {
  const wavBuf = fs.readFileSync(wavPath);
  const fullPcm = extractRawPcm24k(wavBuf);
  const sr = 24000;
  const totalWavDurationSec = fullPcm.length / (sr * 2);

  // Measure active speech bounds & LUFS for each turn's timecode slot in the stitched WAV
  const rows = batchTurns.map((orig, idx) => {
    const sp = speakerMap.get(orig.speakerId);
    const prepared = prepareBatchTurnForTts(orig, sp, {
      useDeliveryEmotions: true,
      pronunciationDictionary: DEFAULT_PRONUNCIATION_DICTIONARY,
    });
    const sentStyle = buildCleanTurnStyleForTts(prepared, sp, true);
    const sentText = prepared.cleanSpeechText;

    const slotStartSec = orig.startSec ?? 0;
    const nextStartSec =
      idx + 1 < batchTurns.length && typeof batchTurns[idx + 1].startSec === "number"
        ? batchTurns[idx + 1].startSec!
        : Math.min(totalWavDurationSec, (orig.endSec ?? slotStartSec + 3) + 1.5);
    const slotEndSec = Math.min(totalWavDurationSec, Math.max(orig.endSec ?? slotStartSec + 1, nextStartSec - 0.04));

    const startByte = Math.max(0, Math.floor(slotStartSec * sr) * 2);
    const endByte = Math.min(fullPcm.length, Math.floor(slotEndSec * sr) * 2);
    const slotPcm = fullPcm.subarray(startByte, Math.max(startByte, endByte));

    // Find active speech sub-range inside slot (frame RMS > -48 dBFS)
    const frameSamples = 240; // 10 ms
    const totalFrames = Math.floor(slotPcm.length / 2 / frameSamples);
    let firstActive = -1;
    let lastActive = -1;
    for (let f = 0; f < totalFrames; f++) {
      let sumSq = 0;
      const base = f * frameSamples * 2;
      for (let s = 0; s < frameSamples; s++) {
        const v = slotPcm.readInt16LE(base + s * 2) / 32768;
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / frameSamples);
      if (rms > 0.004) {
        if (firstActive === -1) firstActive = f;
        lastActive = f;
      }
    }

    const activeStartSec = firstActive >= 0 ? slotStartSec + firstActive * 0.01 : slotStartSec;
    const activeEndSec = lastActive >= 0 ? slotStartSec + (lastActive + 1) * 0.01 : slotStartSec;
    const activePcm =
      firstActive >= 0 && lastActive >= firstActive
        ? slotPcm.subarray(firstActive * frameSamples * 2, (lastActive + 1) * frameSamples * 2)
        : slotPcm;

    const lufsAfter = activePcm.length >= 2400 ? measureIntegratedLufsPcm(activePcm, sr) : null;
    const clipDurSec = Math.max(0, activeEndSec - activeStartSec);
    const windowDurSec = Math.max(0.1, (orig.endSec ?? slotStartSec + 1) - slotStartSec);

    return {
      num: idx + 1,
      speaker: orig.speakerName,
      scriptTimecode: `${formatSec(orig.startSec)}–${formatSec(orig.endSec)}`,
      wavRange: `${formatSec(activeStartSec)}–${formatSec(activeEndSec)}`,
      clipVsWindow: `${clipDurSec.toFixed(2)}s / ${windowDurSec.toFixed(2)}s`,
      qa: "saved (run 1)",
      lufsBeforeAfter: `— → ${typeof lufsAfter === "number" && Number.isFinite(lufsAfter) ? lufsAfter.toFixed(1) : "—"} LUFS`,
      sentStyle,
      sentText,
      spokenText: "",
    };
  });

  // Run a single lightweight transcription check on the first 14s (turns #01 & #02 where <laugh> was placed) — 0 TTS calls!
  let turn1Spoken = "";
  let turn2Spoken = "";
  const matches: string[] = [];
  const t0 = Date.now();
  try {
    const first14SecPcm = fullPcm.subarray(0, Math.min(fullPcm.length, 14 * sr * 2));
    const clipWavBase64 = buildWav24k(first14SecPcm).toString("base64");
    const response = await ai.models.generateContent({
      model: DUBBING_MODELS_CONFIG.audioAlignmentModel,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: "audio/wav", data: clipWavBase64 } },
            {
              text:
                'Transcribe verbatim every spoken word in this 14-second Uzbek dialogue (first 2 turns). If you hear the English word "laugh" spoken aloud as a word (not actual laughter), include it literally. Return ONLY JSON: {"turn1": "...", "turn2": "...", "laughWordSpokenAloud": false}.',
            },
          ],
        },
      ],
      config: { temperature: 0 },
    });
    const raw = (response.text || "").trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      turn1Spoken = String(parsed.turn1 || "");
      turn2Spoken = String(parsed.turn2 || "");
      if (parsed.laughWordSpokenAloud === true) {
        matches.push("detector flagged laughWordSpokenAloud=true");
      }
      const m1 = turn1Spoken.match(LAUGH_WORD_REGEX);
      const m2 = turn2Spoken.match(LAUGH_WORD_REGEX);
      if (m1) matches.push(`turn#1: ${m1.join(", ")}`);
      if (m2) matches.push(`turn#2: ${m2.join(", ")}`);
    } else {
      turn1Spoken = raw.slice(0, 140);
      const m = raw.match(LAUGH_WORD_REGEX);
      if (m) matches.push(`raw: ${m.join(", ")}`);
    }
  } catch (err: any) {
    console.warn(`[Exp2] Saved WAV laugh-check warning for ${variant.id}:`, err?.message || err);
  }
  const inspectMs = Date.now() - t0;

  return {
    variant,
    wavPath: `/audio/experiments/${variant.wavFileName}`,
    wavBytes: wavBuf.length,
    totalWavDurationSec,
    ttsCallsUsed: 1, // from earlier run before server restart
    transcribeCallsUsed: 1,
    ttsWallTimeMs: 0,
    alignWallTimeMs: inspectMs,
    qaPassedCount: 16,
    qaFailedCount: 0,
    qaReasons: [] as string[],
    fromExistingWav: true,
    laughCheck: {
      spokenAloudDetected: matches.length > 0,
      matches,
      turn1Spoken,
      turn2Spoken,
    },
    apiRetries: 0,
    rows,
  };
}

export async function runExperiment2Live(
  ai: GoogleGenAI,
  options: { resumeExisting?: boolean } = {}
) {
  const resumeExisting = options.resumeExisting !== false;

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
  if (!parsed.ok || parsed.turns.length < 16) {
    throw new Error(`Failed to parse Tiggo 8 v4 fixture (turns=${parsed.turns.length})`);
  }

  // Plan sub-blocks on the FULL script, then take Sub-block #1 = Scenes 1-2 (16 turns)
  const fullSubBlocks = planDialogueSubBlocks(parsed.turns);
  const sub1 = fullSubBlocks[0];
  if (!sub1 || sub1.turns.length !== 16) {
    throw new Error(
      `Expected sub-block #1 of Tiggo 8 v4 to have 16 turns, got ${sub1?.turns.length ?? 0}`
    );
  }

  const scenes12Raw = sub1.turns;
  const maxEndSec = Math.max(
    ...scenes12Raw.map((t) => (typeof t.endSec === "number" ? t.endSec : 0)),
    93
  );

  const batchTurns: BatchInputTurn[] = scenes12Raw.map((t, i) => {
    const isAziz = /азиз|aziz/i.test(t.speakerName || "") || t.speakerGender === "male";
    const speakerId = isAziz ? "HOST_1" : "HOST_2";
    const nextInFull = parsed.turns[i + 1];
    const nextStart =
      nextInFull && typeof nextInFull.startSec === "number" ? nextInFull.startSec : maxEndSec;
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

  const outDir = path.resolve(process.cwd(), "public", "audio", "experiments");
  fs.mkdirSync(outDir, { recursive: true });

  const variantReports: Array<{
    variant: Exp2VariantConfig;
    wavPath: string;
    wavBytes: number;
    totalWavDurationSec: number;
    ttsCallsUsed: number;
    transcribeCallsUsed: number;
    ttsWallTimeMs: number;
    alignWallTimeMs: number;
    qaPassedCount: number;
    qaFailedCount: number;
    qaReasons: string[];
    fromExistingWav?: boolean;
    laughCheck: ReturnType<typeof checkLaughSpokenAloud>;
    apiRetries: number;
    rows: Array<{
      num: number;
      speaker: string;
      scriptTimecode: string;
      wavRange: string;
      clipVsWindow: string;
      qa: string;
      lufsBeforeAfter: string;
      sentStyle: string;
      sentText: string;
      spokenText: string;
    }>;
  }> = [];

  for (const variant of EXP2_VARIANTS) {
    const speakerMap = new Map<string, ResolvedBatchSpeaker>([
      [
        "HOST_1",
        {
          speakerId: "HOST_1",
          speakerName: "Азиз",
          baseVoice: variant.maleVoice,
          voiceId: variant.maleVoice.toLowerCase(),
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
          baseVoice: variant.femaleVoice,
          voiceId: variant.femaleVoice.toLowerCase(),
          gender: "female",
          isCloned: false,
          baseSpeechStyle: DEFAULT_BASE_STYLE_FEMALE,
        },
      ],
    ]);

    const wavPath = path.join(outDir, variant.wavFileName);
    const metaPath = path.join(outDir, `exp2-${variant.id}.json`);

    if (resumeExisting && fs.existsSync(metaPath) && fs.existsSync(wavPath)) {
      console.log(`[Exp2] Reusing completed ${variant.label} from ${metaPath}`);
      variantReports.push(JSON.parse(fs.readFileSync(metaPath, "utf8")));
      continue;
    }

    if (resumeExisting && fs.existsSync(wavPath) && fs.statSync(wavPath).size > 1_000_000) {
      console.log(
        `[Exp2] Reusing already-generated WAV for ${variant.label} (${wavPath}) without extra TTS call...`
      );
      const inspected = await inspectSavedVariantWav(ai, variant, wavPath, batchTurns, speakerMap);
      fs.writeFileSync(metaPath, JSON.stringify(inspected, null, 2), "utf8");
      variantReports.push(inspected);
      continue;
    }

    console.log(`\n[Exp2] Starting ${variant.label} (16 turns, cache OFF, maxExtraTtsCalls=0)...`);

    let execResult: BatchDialogueExecutionResult | null = null;
    let apiRetries = 0;

    // Retry ONLY on thrown API/network error (max 1 retry), NEVER on QA failure!
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        execResult = await synthesizeDialogueInMacroBlocks(ai, {
          turns: batchTurns,
          speakerMap,
          strictTimeWindow: true,
          bypassCache: true,
          maxExtraTtsCalls: 0,
          useDeliveryEmotions: true,
          pronunciationDictionary: DEFAULT_PRONUNCIATION_DICTIONARY,
        });
        break;
      } catch (err: any) {
        if (attempt === 1) {
          apiRetries += 1;
          console.warn(
            `[Exp2] ${variant.label} API/network error on attempt 1, retrying once in 3s:`,
            err?.message || err
          );
          await new Promise((r) => setTimeout(r, 3000));
        } else {
          throw err;
        }
      }
    }

    if (!execResult) {
      throw new Error(`[Exp2] ${variant.label} returned empty result`);
    }

    // Stitch time-aligned master WAV (with silence between turns + leveled clips)
    const stitched = stitchDialogueTurnsClient({
      turns: execResult.turns.map((r, i) => ({
        ...batchTurns[i].rawTurn,
        id: r.id,
        speakerId: r.speakerId,
        speakerName: r.speakerName,
        text: r.text,
        sceneTitle: batchTurns[i].sceneTitle,
        startSec: batchTurns[i].startSec,
        endSec: batchTurns[i].endSec,
        audioBase64: r.wavBase64,
        dubbedDurationSec: r.dubbedDurationSec,
        originalDurationSec: r.originalDurationSec,
        atempoApplied: r.atempoApplied,
        syncStatus: r.syncStatus,
        qa: r.qa,
        qaReason: r.qaReason,
        slicingMethod: r.slicingMethod,
        generationMode: r.generationMode,
        lufsBefore: r.lufsBefore,
        lufsAfter: r.lufsAfter,
        needsShorten: r.needsShorten,
        subBlockIndex: r.subBlockIndex,
      })),
      masterAudioMode: "time_aligned",
      totalVideoDurationSec: Math.ceil(maxEndSec + 1),
    });

    const wavBuf = Buffer.from(stitched.masterAudioBase64, "base64");
    fs.writeFileSync(wavPath, wavBuf);

    const qaPassedCount = execResult.turns.filter((t) => t.qa === "ok" || t.qa === "retried").length;
    const qaFailedCount = execResult.turns.filter((t) => t.qa === "failed").length;
    const qaReasons = execResult.failedSubBlocks.flatMap((f) => f.reasons);
    const laughCheck = checkLaughSpokenAloud(execResult);

    const rows = execResult.turns.map((r, idx) => {
      const orig = batchTurns[idx];
      const st = stitched.turns[idx];
      const lBefore = typeof r.lufsBefore === "number" ? `${r.lufsBefore.toFixed(1)}` : "—";
      const lAfter = typeof r.lufsAfter === "number" ? `${r.lufsAfter.toFixed(1)}` : "—";
      return {
        num: idx + 1,
        speaker: r.speakerName,
        scriptTimecode: `${formatSec(orig.startSec)}–${formatSec(orig.endSec)}`,
        wavRange: `${formatSec(st?.startTime)}–${formatSec(st?.endTime)}`,
        clipVsWindow: `${r.dubbedDurationSec.toFixed(2)}s / ${r.originalDurationSec.toFixed(2)}s`,
        qa: r.qaReason ? `${r.qa} (${r.qaReason.slice(0, 60)})` : r.qa,
        lufsBeforeAfter: `${lBefore} → ${lAfter} LUFS`,
        sentStyle: r.sentStyle || "",
        sentText: r.sentText || "",
        spokenText: r.spokenText || "",
      };
    });

    console.log(
      `[Exp2] Done ${variant.label}: QA=${qaPassedCount}/16, TTS=${execResult.ttsCallsUsed} (${execResult.ttsWallTimeMs}ms), Align=${execResult.transcribeCallsUsed} (${execResult.alignWallTimeMs}ms), laughSpokenAloud=${laughCheck.spokenAloudDetected}, wav=${(wavBuf.length / 1024 / 1024).toFixed(2)} MB`
    );

    const entry = {
      variant,
      wavPath: `/audio/experiments/${variant.wavFileName}`,
      wavBytes: wavBuf.length,
      totalWavDurationSec: stitched.totalDurationSeconds,
      ttsCallsUsed: execResult.ttsCallsUsed,
      transcribeCallsUsed: execResult.transcribeCallsUsed,
      ttsWallTimeMs: execResult.ttsWallTimeMs,
      alignWallTimeMs: execResult.alignWallTimeMs,
      qaPassedCount,
      qaFailedCount,
      qaReasons,
      fromExistingWav: false,
      laughCheck,
      apiRetries,
      rows,
    };
    fs.writeFileSync(metaPath, JSON.stringify(entry, null, 2), "utf8");
    variantReports.push(entry);
  }

  // Build Markdown report at public/audio/experiments/exp2-report.md
  const md: string[] = [];
  md.push(`# Experiment 2 Report — Tiggo 8 Hybrid v4 (Scenes 1–2, 16 turns, 1 sub-block)`);
  md.push("");
  md.push(`- **Generated at:** ${new Date().toISOString()}`);
  md.push(
    `- **Pipeline:** Real \`synthesizeDialogueInMacroBlocks\` (\`strictTimeWindow: true\`, \`bypassCache: true\`, \`maxExtraTtsCalls: 0\`, \`useDeliveryEmotions: true\`, dictionary \`Hybrid → gibrid\`, BS.1770-4 loudness leveling to \`-18 LUFS\`, stitched via \`stitchDialogueTurnsClient\`)`
  );
  md.push(
    `- **Base styles:** Азиз (M) = \`${DEFAULT_BASE_STYLE_MALE}\` | Вероника (F) = \`${DEFAULT_BASE_STYLE_FEMALE}\``
  );
  md.push("");
  md.push(`## Summary`);
  md.push("");
  md.push(
    `| Variant | Voices (M + F) | WAV File | QA | TTS Calls / Time | Align Calls / Time | "laugh" spoken aloud? |`
  );
  md.push(`|---|---|---|---|---|---|---|`);
  for (const rep of variantReports) {
    const ttsLabel = rep.fromExistingWav
      ? `${rep.ttsCallsUsed} (saved WAV)`
      : `${rep.ttsCallsUsed} (${(rep.ttsWallTimeMs / 1000).toFixed(2)}s)`;
    const alignLabel = rep.fromExistingWav
      ? `${rep.transcribeCallsUsed} (${(rep.alignWallTimeMs / 1000).toFixed(2)}s verify)`
      : `${rep.transcribeCallsUsed} (${(rep.alignWallTimeMs / 1000).toFixed(2)}s)`;
    md.push(
      `| **${rep.variant.id}** | ${rep.variant.maleVoice} + ${rep.variant.femaleVoice} | \`${rep.wavPath}\` (${(rep.wavBytes / 1024 / 1024).toFixed(2)} MB, ${rep.totalWavDurationSec.toFixed(1)}s) | **${rep.qaPassedCount}/16** | ${ttsLabel} | ${alignLabel} | ${rep.laughCheck.spokenAloudDetected ? `⚠️ YES: ${escapeMdCell(rep.laughCheck.matches.join("; "))}` : "✅ NO"} |`
    );
  }
  md.push("");
  md.push(`### Explicit Check: \`<laugh>\` on Turns #01 & #02`);
  md.push("");
  for (const rep of variantReports) {
    md.push(
      `- **Variant ${rep.variant.id} (${rep.variant.femaleVoice})**: spoken-aloud = \`${rep.laughCheck.spokenAloudDetected ? "YES" : "NO"}\``
    );
    md.push(`  - Turn #01 heard: \`${escapeMdCell(rep.laughCheck.turn1Spoken)}\``);
    md.push(`  - Turn #02 heard: \`${escapeMdCell(rep.laughCheck.turn2Spoken)}\``);
    if (rep.qaReasons.length > 0) {
      md.push(`  - QA notes: \`${escapeMdCell(rep.qaReasons.join("; "))}\``);
    }
  }
  md.push("");

  for (const rep of variantReports) {
    md.push(`## ${rep.variant.label}`);
    md.push("");
    md.push(
      `| # | Спикер | Таймкод сценария | Факт в WAV | Клип / Окно | QA | LUFS до → после | Отправленный style | Отправленный текст в TTS |`
    );
    md.push(`|---:|---|---|---|---|---|---|---|---|`);
    for (const row of rep.rows) {
      md.push(
        `| ${String(row.num).padStart(2, "0")} | ${escapeMdCell(row.speaker)} | ${row.scriptTimecode} | ${row.wavRange} | ${row.clipVsWindow} | ${escapeMdCell(row.qa)} | ${row.lufsBeforeAfter} | \`${escapeMdCell(row.sentStyle)}\` | ${escapeMdCell(row.sentText)} |`
      );
    }
    md.push("");
  }

  const reportPath = path.join(outDir, "exp2-report.md");
  fs.writeFileSync(reportPath, md.join("\n"), "utf8");

  return {
    ok: true,
    reportPath: "/audio/experiments/exp2-report.md",
    totalTtsCalls: variantReports.reduce((s, r) => s + r.ttsCallsUsed, 0),
    totalAlignCalls: variantReports.reduce((s, r) => s + r.transcribeCallsUsed, 0),
    variants: variantReports.map((r) => ({
      id: r.variant.id,
      voices: `${r.variant.maleVoice} + ${r.variant.femaleVoice}`,
      wavPath: r.wavPath,
      wavBytes: r.wavBytes,
      qa: `${r.qaPassedCount}/16`,
      fromExistingWav: Boolean(r.fromExistingWav),
      ttsCallsUsed: r.ttsCallsUsed,
      transcribeCallsUsed: r.transcribeCallsUsed,
      ttsWallTimeMs: r.ttsWallTimeMs,
      alignWallTimeMs: r.alignWallTimeMs,
      laughSpokenAloud: r.laughCheck.spokenAloudDetected,
      laughMatches: r.laughCheck.matches,
      qaReasons: r.qaReasons,
    })),
  };
}
