import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseReadyScript } from "../src/utils/readyScriptParser.ts";
import { planDialogueSubBlocks } from "../src/utils/dialogueMacroBlocks.ts";
import { stitchDialogueTurnsClient } from "../src/utils/clientMasterStitcher.ts";
import { countSyllables } from "../server/services/verbatimStoryboardService.ts";
import {
  synthesizeDialogueInMacroBlocks,
  evaluateSubBlockQa,
  buildTurnPaceDirective,
  computeSubBlockCacheHash,
  canSaveSubBlockToCache,
  fitSlicedTurnToTimecode,
  setFakeDubbingFaultInjectorForTesting,
  setTtsPayloadObserverForTesting,
  type BatchInputTurn,
  type ResolvedBatchSpeaker,
} from "../server/services/dubbing/batchDialogueEngine.ts";
import {
  generateSyntheticTurnPcm,
  PCM_BYTES_PER_SEC,
} from "../server/services/dubbing/batchAudioSlicer.ts";
import type { DialogueTurn } from "../src/types/podcast.ts";

// Enforce Stage 0 fake mode
process.env.DUBBING_FAKE_TTS = "1";

const BLOCK_CACHE_DIR = path.resolve(process.cwd(), "data", "dubbing-block-cache");
const TIGGO8_PATH = path.resolve(
  process.cwd(),
  "public",
  "assets",
  "aistudio",
  "01_tiggo_8_hybrid_uz_dublyaj_v4_225b7287.txt"
);

function clearBlockCache() {
  if (fs.existsSync(BLOCK_CACHE_DIR)) {
    for (const f of fs.readdirSync(BLOCK_CACHE_DIR)) {
      if (f.endsWith(".json")) fs.unlinkSync(path.join(BLOCK_CACHE_DIR, f));
    }
  }
}

// Strict trap: any real GoogleGenAI API call in DUBBING_FAKE_TTS=1 MUST fail the test immediately!
let realApiCallsDetected = 0;
const trapAi: any = {
  models: {
    generateContent: async () => {
      realApiCallsDetected += 1;
      throw new Error("UNEXPECTED REAL GEMINI API CALL IN DUBBING_FAKE_TTS=1 MODE!");
    },
  },
};

function loadTiggo8BatchTurns(): {
  turns: BatchInputTurn[];
  speakerMap: Map<string, ResolvedBatchSpeaker>;
  rawTurns: DialogueTurn[];
} {
  const txt = fs.readFileSync(TIGGO8_PATH, "utf8");
  const parsed = parseReadyScript(txt);
  assert.equal(parsed.turns.length, 79, "Expected 79 turns in Tiggo 8 v4");

  const speakerMap = new Map<string, ResolvedBatchSpeaker>();
  speakerMap.set("HOST_1", {
    speakerId: "HOST_1",
    speakerName: "Азиз",
    baseVoice: "Charon",
    isCloned: false,
    baseSpeechStyle: "Calm friendly automotive expert",
  });
  speakerMap.set("HOST_2", {
    speakerId: "HOST_2",
    speakerName: "Вероника",
    baseVoice: "Kore",
    isCloned: false,
    baseSpeechStyle: "Lively curious co-host",
  });

  // Match speakerId to Азиз -> HOST_1, Вероника -> HOST_2
  const batchTurns: BatchInputTurn[] = parsed.turns.map((t, i) => {
    const isAziz = /азиз|aziz/i.test(t.speakerName || "");
    const speakerId = isAziz ? "HOST_1" : "HOST_2";
    const nextStart =
      i + 1 < parsed.turns.length && typeof parsed.turns[i + 1].startSec === "number"
        ? parsed.turns[i + 1].startSec!
        : 523;
    const gapAfterSec =
      typeof t.endSec === "number"
        ? Math.max(0, Math.round((nextStart - t.endSec) * 100) / 100)
        : 0;
    return {
      id: t.id,
      index: i,
      speakerId,
      speakerName: t.speakerName,
      text: t.text,
      cleanSpeechText: t.text,
      style: t.intonationRu ? `Delivery: ${t.intonationRu}` : "Natural Uzbek dubbing",
      startSec: t.startSec,
      endSec: t.endSec,
      gapAfterSec,
      intonationRu: t.intonationRu,
      originalTextRu: t.originalTextRu,
      speakerGender: t.speakerGender,
      sceneTitle: t.sceneTitle,
      rawTurn: { ...t, speakerId, gapAfterSec },
    };
  });

  return { turns: batchTurns, speakerMap, rawTurns: parsed.turns };
}

async function runAllStageTests() {
  clearBlockCache();
  const { turns: tiggoTurns, speakerMap } = loadTiggo8BatchTurns();

  // =========================================================================
  // STAGE 1 TESTS: Pace directives, zero <short pause>, sub-block splitting
  // =========================================================================
  console.log("=== Running Stage 1 Tests ===");

  // 1a. Pace hints by syllable density
  const fastDir = buildTurnPaceDirective({
    cleanSpeechText: "Batareya yaxshi himoyalangan va harorat nazorati bor, sinovdan o‘tgan.",
    startSec: 0,
    endSec: 3, // > 5.5 syl/s
  });
  assert.ok(
    fastDir.includes("fast, brisk dubbing pace, no pauses inside or after the sentence"),
    `Expected fast pace hint, got: ${fastDir}`
  );
  assert.ok(fastDir.includes("Say the line exactly once, word for word."));

  const midDir = buildTurnPaceDirective({
    cleanSpeechText: "Hammaga salom, men Azizman, bugun mashina ko‘ramiz.",
    startSec: 0,
    endSec: 3.4, // ~4.7 syl/s
  });
  assert.ok(
    midDir.includes("lively natural conversational pace"),
    `Expected lively pace hint, got: ${midDir}`
  );
  assert.ok(midDir.includes("Say the line exactly once, word for word."));

  const slowDir = buildTurnPaceDirective({
    cleanSpeechText: "Hammaga xayr!",
    startSec: 0,
    endSec: 2, // 2.5 syl/s < 4.5
  });
  assert.ok(
    slowDir.includes("relaxed natural pace"),
    `Expected relaxed pace hint, got: ${slowDir}`
  );
  assert.ok(slowDir.includes("Say the line exactly once, word for word."));

  // 1b. Sub-block splitting on real Tiggo 8 v4
  const subBlocks = planDialogueSubBlocks(tiggoTurns);
  console.log(
    `Tiggo 8 v4 sub-blocks: ${subBlocks.length} (${subBlocks
      .map((sb) => `${sb.turns.length}t/${sb.windowSumSec}s`)
      .join(", ")})`
  );
  assert.ok(
    subBlocks.length >= 11 && subBlocks.length <= 15,
    `Expected ~12-14 sub-blocks for Tiggo 8 v4, got ${subBlocks.length}`
  );
  let qaSplitsCount = 0;
  for (let i = 0; i < subBlocks.length; i++) {
    const sb = subBlocks[i];
    assert.ok(sb.turns.length <= 8, `Sub-block ${i} exceeds 8 turns: ${sb.turns.length}`);
    assert.ok(sb.windowSumSec <= 40.01, `Sub-block ${i} exceeds 40s window sum: ${sb.windowSumSec}s`);
    if (i + 1 < subBlocks.length) {
      const lastTurn = sb.turns[sb.turns.length - 1];
      if (/\?[\s"'»”’)]*$/.test(lastTurn.text.trim())) {
        qaSplitsCount++;
      }
    }
  }
  assert.equal(qaSplitsCount, 0, `Expected 0 Q->A splits across sub-blocks, got ${qaSplitsCount}`);

  // Scene 2 alone (00:51-01:33, 9 turns) must split into <= 2 sub-blocks
  const scene2Turns = tiggoTurns.filter((t) => /2-SAHNA/i.test(t.sceneTitle || ""));
  assert.equal(scene2Turns.length, 9, "Expected 9 turns in Scene 2 of Tiggo 8");
  const scene2SubBlocks = planDialogueSubBlocks(scene2Turns);
  assert.equal(
    scene2SubBlocks.length,
    2,
    `Expected 2 sub-blocks for Scene 2, got ${scene2SubBlocks.length}`
  );

  // 1c. Verify zero "<short pause>" and zero "distinct pause" in emitted TTS payloads
  const observedPayloads: Array<{ channel: string; text: string; style: string }> = [];
  setTtsPayloadObserverForTesting(({ channel, parts }) => {
    for (const p of parts) {
      observedPayloads.push({ channel, text: p.text, style: p.style });
    }
  });

  await synthesizeDialogueInMacroBlocks(trapAi, {
    turns: scene2Turns,
    speakerMap,
    strictTimeWindow: true,
    bypassCache: true,
  });
  setTtsPayloadObserverForTesting(null);

  assert.equal(observedPayloads.length, 9);
  for (const p of observedPayloads) {
    assert.ok(!/short\s+pause/i.test(p.text), `Found <short pause> in text: ${p.text}`);
    assert.ok(!/distinct\s+pause/i.test(p.style), `Found distinct pause in style: ${p.style}`);
    assert.ok(
      p.style.includes("Say the line exactly once, word for word."),
      `Missing exact-once instruction in style: ${p.style}`
    );
  }
  console.log("✅ STAGE 1 PASSED: Clean prompts, density pace hints, optimal sub-blocks verified.");

  // =========================================================================
  // STAGE 2 TESTS: QA Evaluator & Escalation Cascade (retry -> split -> Mode B -> failed)
  // =========================================================================
  console.log("=== Running Stage 2 Tests ===");

  const sampleSub = scene2SubBlocks[0].turns; // 4 turns
  let mockCursorMs = 0;
  const cleanClips = sampleSub.map((t) => {
    const dur = Math.max(0.35, countSyllables(t.cleanSpeechText) / 4.8);
    const pcm = generateSyntheticTurnPcm(dur, 350);
    const startMs = mockCursorMs;
    const endMs = startMs + Math.round(dur * 1000);
    mockCursorMs = endMs + 450;
    return {
      pcm,
      startMs,
      endMs,
      durationSec: dur,
      method: "vad_exact",
    };
  });
  const expectedText = sampleSub.map((t) => t.cleanSpeechText).join(" ");

  // 2a. Clean passes (including brand loanwords like Premium, Luxury)
  const qaClean = evaluateSubBlockQa({
    expectedTurns: sampleSub,
    slicedClips: cleanClips,
    transcriptText: expectedText,
  });
  assert.equal(qaClean.passed, true, `Clean sub-block should pass QA, got: ${qaClean.reasons}`);

  // 2b. Script-inherent repetitions must NOT be flagged (e.g., last two turns of Tiggo 8 both say "Hammaga xayr!")
  const goodbyeTurns = tiggoTurns.slice(-2);
  let gbCursorMs = 0;
  const goodbyeClips = goodbyeTurns.map((t) => {
    const dur = Math.max(0.35, countSyllables(t.cleanSpeechText) / 4.8);
    const startMs = gbCursorMs;
    const endMs = startMs + Math.round(dur * 1000);
    gbCursorMs = endMs + 450;
    return {
      pcm: generateSyntheticTurnPcm(dur, 350),
      startMs,
      endMs,
      durationSec: dur,
      method: "vad_exact",
    };
  });
  const qaRepeatInScript = evaluateSubBlockQa({
    expectedTurns: goodbyeTurns,
    slicedClips: goodbyeClips,
    transcriptText: goodbyeTurns.map((t) => t.cleanSpeechText).join(" "),
  });
  assert.equal(
    qaRepeatInScript.passed,
    true,
    `Script-inherent repeat should pass QA, got: ${qaRepeatInScript.reasons}`
  );

  // 2c. Unintended repetition (> 1.2 ratio) -> FAIL
  const qaRep = evaluateSubBlockQa({
    expectedTurns: sampleSub,
    slicedClips: cleanClips,
    transcriptText: `${expectedText} ${sampleSub[0].cleanSpeechText} ${sampleSub[1].cleanSpeechText}`,
  });
  assert.equal(qaRep.passed, false);
  assert.ok(qaRep.reasons.some((r) => r.includes("repetition_detected")));

  // 2d. Omission (< 0.8 ratio) -> FAIL
  const qaOmit = evaluateSubBlockQa({
    expectedTurns: sampleSub,
    slicedClips: cleanClips,
    transcriptText: sampleSub.slice(0, 2).map((t) => t.cleanSpeechText).join(" "),
  });
  assert.equal(qaOmit.passed, false);
  assert.ok(qaOmit.reasons.some((r) => r.includes("omission_detected")));

  // 2e. Spoken "short pause" -> FAIL
  const qaShortPause = evaluateSubBlockQa({
    expectedTurns: sampleSub,
    slicedClips: cleanClips,
    transcriptText: `${expectedText} short pause`,
  });
  assert.equal(qaShortPause.passed, false);
  assert.ok(qaShortPause.reasons.some((r) => r.includes("short_pause_spoken")));

  // 2f. Obvious English leak not in expected text -> FAIL
  const qaEngLeak = evaluateSubBlockQa({
    expectedTurns: sampleSub,
    slicedClips: cleanClips,
    transcriptText: `${expectedText} conversational`,
  });
  assert.equal(qaEngLeak.passed, false);
  assert.ok(qaEngLeak.reasons.some((r) => r.includes("english_leak")));

  // 2g. Clip overlap -> FAIL
  const overlappingClips = cleanClips.map((c, idx) =>
    idx === 1 ? { ...c, startMs: cleanClips[0].endMs - 250 } : c
  );
  const qaOverlap = evaluateSubBlockQa({
    expectedTurns: sampleSub,
    slicedClips: overlappingClips,
    transcriptText: expectedText,
  });
  assert.equal(qaOverlap.passed, false);
  assert.ok(qaOverlap.reasons.some((r) => r.includes("clip_overlap_or_order")));

  // 2h. Duration anomaly (> 1.6x on clip / > 1.35x on block) -> FAIL
  const slowClips = cleanClips.map((c) => ({
    ...c,
    pcm: generateSyntheticTurnPcm(c.durationSec * 1.8, 350),
    durationSec: c.durationSec * 1.8,
  }));
  const qaSlow = evaluateSubBlockQa({
    expectedTurns: sampleSub,
    slicedClips: slowClips,
    transcriptText: expectedText,
  });
  assert.equal(qaSlow.passed, false);
  assert.ok(qaSlow.reasons.some((r) => r.includes("block_duration_ratio")));

  // 2i. Escalation Cascade: Attempt 1 fails ("short pause") -> Attempt 2 succeeds -> qa = "retried"
  clearBlockCache();
  const singleSubInput = sampleSub;
  setFakeDubbingFaultInjectorForTesting(({ stage }) => {
    if (stage === "primary") return { overrideTranscript: `${expectedText} short pause` };
    return null;
  });
  const retryRes = await synthesizeDialogueInMacroBlocks(trapAi, {
    turns: singleSubInput,
    speakerMap,
    strictTimeWindow: true,
    bypassCache: true,
  });
  assert.equal(retryRes.retriesUsed, 1, "Expected exactly 1 retry");
  assert.ok(retryRes.turns.every((t) => t.qa === "retried"), "All turns should be qa=retried");

  // 2j. Escalation Cascade: primary + retry fail -> split_half succeeds
  clearBlockCache();
  let sawSplitHalf = false;
  setFakeDubbingFaultInjectorForTesting(({ stage }) => {
    if (stage === "primary" || stage === "retry") {
      return { overrideTranscript: "too short" };
    }
    if (stage === "split_half") sawSplitHalf = true;
    return null;
  });
  const splitRes = await synthesizeDialogueInMacroBlocks(trapAi, {
    turns: singleSubInput,
    speakerMap,
    strictTimeWindow: true,
    bypassCache: true,
  });
  assert.equal(sawSplitHalf, true, "Expected escalation to split_half");
  assert.ok(splitRes.turns.every((t) => t.qa === "retried"));

  // 2k. Escalation Cascade: primary + retry + split_half fail -> Mode B succeeds
  clearBlockCache();
  let sawModeB = false;
  setFakeDubbingFaultInjectorForTesting(({ stage, mode }) => {
    if (stage !== "mode_b") return { overrideTranscript: "too short" };
    if (mode === "B") sawModeB = true;
    return null;
  });
  const modeBRes = await synthesizeDialogueInMacroBlocks(trapAi, {
    turns: singleSubInput,
    speakerMap,
    strictTimeWindow: true,
    bypassCache: true,
  });
  assert.equal(sawModeB, true, "Expected escalation to Mode B");
  assert.ok(modeBRes.turns.every((t) => t.qa === "retried"));

  // 2l. Escalation Cascade: ALL attempts fail -> qa = "failed" + explicit qaReason + NOT cached!
  clearBlockCache();
  setFakeDubbingFaultInjectorForTesting(() => ({
    overrideTranscript: "short pause broken",
  }));
  const failRes = await synthesizeDialogueInMacroBlocks(trapAi, {
    turns: singleSubInput,
    speakerMap,
    strictTimeWindow: true,
    bypassCache: true,
  });
  assert.ok(failRes.turns.every((t) => t.qa === "failed"), "Must mark turns qa=failed");
  assert.ok(
    failRes.turns.every((t) => Boolean(t.qaReason && t.qaReason.includes("short_pause_spoken"))),
    "Must populate explicit qaReason"
  );
  const cacheFilesAfterFail = fs.existsSync(BLOCK_CACHE_DIR)
    ? fs.readdirSync(BLOCK_CACHE_DIR).filter((f) => f.endsWith(".json"))
    : [];
  assert.equal(cacheFilesAfterFail.length, 0, "Failed sub-block MUST NOT be cached!");

  setFakeDubbingFaultInjectorForTesting(null);
  console.log("✅ STAGE 2 PASSED: QA evaluator & full escalation cascade verified.");

  // =========================================================================
  // STAGE 3 TESTS: Cache v2 key & QA/method write gate
  // =========================================================================
  console.log("=== Running Stage 3 Tests ===");
  clearBlockCache();

  const h1 = computeSubBlockCacheHash(singleSubInput, speakerMap, "A");
  const modifiedTextTurns = singleSubInput.map((t, i) =>
    i === 0 ? { ...t, cleanSpeechText: `${t.cleanSpeechText} test` } : t
  );
  const h2 = computeSubBlockCacheHash(modifiedTextTurns, speakerMap, "A");
  const h3 = computeSubBlockCacheHash(singleSubInput.slice(0, 3), speakerMap, "A");
  assert.notEqual(h1, h2, "Cache v2 key must change when text changes");
  assert.notEqual(h1, h3, "Cache v2 key must change when sub-block composition changes");

  assert.equal(canSaveSubBlockToCache("ok", ["vad_exact", "vad_exact"]), true);
  assert.equal(canSaveSubBlockToCache("retried", ["transcribe_aligned"]), true);
  assert.equal(canSaveSubBlockToCache("failed", ["vad_exact"]), false);
  assert.equal(canSaveSubBlockToCache("ok", ["vad_exact", "vad_dp_soft"]), false);
  assert.equal(canSaveSubBlockToCache("ok", ["proportional_energy_cut"]), false);

  // Forced vad_dp_soft must NOT be cached
  setFakeDubbingFaultInjectorForTesting(() => ({ forceMethod: "vad_dp_soft" }));
  await synthesizeDialogueInMacroBlocks(trapAi, {
    turns: singleSubInput,
    speakerMap,
    strictTimeWindow: true,
    bypassCache: false,
  });
  setFakeDubbingFaultInjectorForTesting(null);
  assert.equal(
    fs.existsSync(BLOCK_CACHE_DIR)
      ? fs.readdirSync(BLOCK_CACHE_DIR).filter((f) => f.endsWith(".json")).length
      : 0,
    0,
    "vad_dp_soft sub-block must NOT be cached"
  );

  // Clean run writes v2 cache, second run hits cache
  const firstClean = await synthesizeDialogueInMacroBlocks(trapAi, {
    turns: singleSubInput,
    speakerMap,
    strictTimeWindow: true,
    bypassCache: false,
  });
  assert.equal(firstClean.provider, "fake");
  const cachedFiles = fs.readdirSync(BLOCK_CACHE_DIR).filter((f) => f.endsWith(".json"));
  assert.equal(cachedFiles.length, 1, "Expected 1 v2 cache file written");
  const parsedCache = JSON.parse(
    fs.readFileSync(path.join(BLOCK_CACHE_DIR, cachedFiles[0]), "utf8")
  );
  assert.equal(parsedCache.v, 2, "Cache entry must be v: 2");

  const secondHit = await synthesizeDialogueInMacroBlocks(trapAi, {
    turns: singleSubInput,
    speakerMap,
    strictTimeWindow: true,
    bypassCache: false,
  });
  assert.equal(secondHit.provider, "cache", "Second run must hit v2 cache");
  console.log("✅ STAGE 3 PASSED: Cache v2 key, QA gate, and fallback rejection verified.");

  // =========================================================================
  // STAGE 4 TESTS: Zero-overlap stitching, pause drain, 1.15x boost, scene shift <= 0.1s
  // =========================================================================
  console.log("=== Running Stage 4 Tests ===");

  // 4a. Single-turn atempo boost up to 1.15x and needsShorten without text rewrite
  const tightTurn: BatchInputTurn = {
    ...singleSubInput[0],
    startSec: 0,
    endSec: 2.0,
    gapAfterSec: 0,
  };
  const pcm113 = generateSyntheticTurnPcm(2.15, 350); // needs ~1.12x (between 1.10 and 1.15)
  const fit113 = await fitSlicedTurnToTimecode(pcm113, tightTurn, true);
  assert.ok(
    fit113.atempoApplied > 1.1 && fit113.atempoApplied <= 1.15,
    `Expected single-turn atempo boost in (1.10, 1.15], got ${fit113.atempoApplied}`
  );
  assert.equal(fit113.needsShorten, false, "Should fit cleanly within 1.15x boost");

  const pcmTooLong = generateSyntheticTurnPcm(3.2, 350); // still exceeds 2.0s even at 1.15x (2.78s)
  const fitTooLong = await fitSlicedTurnToTimecode(pcmTooLong, tightTurn, true);
  assert.equal(fitTooLong.atempoApplied, 1.15, "Must cap single-turn boost at 1.15x");
  assert.equal(fitTooLong.needsShorten, true, "Must set needsShorten=true without changing text");

  // 4b. Zero overlap + shift accumulation + drain on pause + scene-start shift > 0.1s overflow
  const wav25 = Buffer.concat([
    Buffer.from(
      (() => {
        const p = generateSyntheticTurnPcm(2.5, 330);
        const h = Buffer.alloc(44);
        h.write("RIFF", 0);
        h.writeUInt32LE(36 + p.length, 4);
        h.write("WAVE", 8);
        h.write("fmt ", 12);
        h.writeUInt32LE(16, 16);
        h.writeUInt16LE(1, 20);
        h.writeUInt16LE(1, 22);
        h.writeUInt32LE(24000, 24);
        h.writeUInt32LE(48000, 28);
        h.writeUInt16LE(2, 32);
        h.writeUInt16LE(16, 34);
        h.write("data", 36);
        h.writeUInt32LE(p.length, 40);
        return Buffer.concat([h, p]);
      })()
    ),
  ]).toString("base64");

  const stitchTest = stitchDialogueTurnsClient({
    turns: [
      // Turn 0: 0..2s window, 2.5s audio -> pushes Turn 1 to 2.58s (shift +0.58s <= 1.2s)
      { id: "s0", speakerId: "HOST_1", speakerName: "A", text: "T0", sceneTitle: "S1", startSec: 0, endSec: 2.0, audioBase64: wav25 },
      // Turn 1: 2..4.5s window, 2.5s audio -> starts at 2.58s, ends at 5.08s; next starts at 6.5s (pause drains shift!)
      { id: "s1", speakerId: "HOST_2", speakerName: "B", text: "T1", sceneTitle: "S1", startSec: 2.0, endSec: 4.5, audioBase64: wav25 },
      // Turn 2: 6.5..9.0s window -> shift drained back to 0!
      { id: "s2", speakerId: "HOST_1", speakerName: "A", text: "T2", sceneTitle: "S2", startSec: 6.5, endSec: 9.0, audioBase64: wav25 },
      // Turn 3: S2 second line 9.5..11.2s (audio 2.5s -> ends 12.0s) pushes S3 (starts 11.5s) by +0.58s > 0.1s!
      { id: "s2b", speakerId: "HOST_2", speakerName: "B", text: "T2b", sceneTitle: "S2", startSec: 9.5, endSec: 11.2, audioBase64: wav25 },
      { id: "s3", speakerId: "HOST_1", speakerName: "A", text: "T3", sceneTitle: "S3", startSec: 11.5, endSec: 14.5, audioBase64: wav25 },
    ],
    masterAudioMode: "time_aligned",
    totalVideoDurationSec: 15,
  });

  // Zero overlap check between ALL consecutive turns
  for (let i = 1; i < stitchTest.turns.length; i++) {
    const gap = (stitchTest.turns[i].startTime ?? 0) - (stitchTest.turns[i - 1].endTime ?? 0);
    assert.ok(gap >= 0.075, `Overlap detected between turn ${i - 1} and ${i}: gap=${gap}s`);
  }
  assert.equal(stitchTest.turns[1].shiftedStartBySec, 0.58, "Turn 1 should absorb +0.58s shift");
  assert.equal(stitchTest.turns[2].shiftedStartBySec, 0, "Pause should drain shift back to 0 at S2");
  assert.equal(stitchTest.turns[2].syncStatus, "ok", "S2 starts cleanly with 0 shift");
  // S3 starts at 11.5, pushed to 12.08 (+0.58s > 0.1s at scene start!) -> overflow!
  assert.equal(stitchTest.turns[4].syncStatus, "overflow", "Scene start shift > 0.1s must be overflow");
  assert.equal(stitchTest.turns[4].needsShorten, true, "Scene start shift > 0.1s must set needsShorten");
  console.log("✅ STAGE 4 PASSED: Zero overlap, pause drain, 1.15x single-turn boost, and scene shift rules verified.");

  // =========================================================================
  // FULL TIGGO 8 v4 ACCEPTANCE TEST IN DUBBING_FAKE_TTS=1 MODE
  // =========================================================================
  console.log("=== Running Full Tiggo 8 v4 Test-Mode Acceptance ===");
  clearBlockCache();

  const fullRes = await synthesizeDialogueInMacroBlocks(trapAi, {
    turns: tiggoTurns,
    speakerMap,
    strictTimeWindow: true,
    bypassCache: false,
  });

  assert.equal(realApiCallsDetected, 0, "MUST have 0 real Gemini API calls in fake mode");
  assert.equal(fullRes.ttsCallsUsed, 0, "Fake mode must report 0 real TTS calls");
  assert.equal(fullRes.transcribeCallsUsed, 0, "Fake mode must report 0 real transcribe calls");
  assert.equal(fullRes.turns.length, 79, "Must return all 79 turns");
  assert.equal(fullRes.stats.qaFailed, 0, "Expected 0 QA failures");
  assert.equal(fullRes.stats.qaOk, 79, "Expected all 79 turns qa=ok");

  // Stitch full 79-turn track with clientMasterStitcher
  const stitchedInput: DialogueTurn[] = fullRes.turns.map((r, i) => ({
    ...tiggoTurns[i].rawTurn,
    id: r.id,
    speakerId: r.speakerId,
    speakerName: r.speakerName,
    text: r.text,
    sceneTitle: tiggoTurns[i].sceneTitle,
    startSec: tiggoTurns[i].startSec,
    endSec: tiggoTurns[i].endSec,
    audioBase64: r.wavBase64,
    dubbedDurationSec: r.dubbedDurationSec,
    originalDurationSec: r.originalDurationSec,
    atempoApplied: r.atempoApplied,
    syncStatus: r.syncStatus,
    qa: r.qa,
    qaReason: r.qaReason,
    slicingMethod: r.slicingMethod,
    needsShorten: r.needsShorten,
    subBlockIndex: r.subBlockIndex,
  }));

  const stitched = stitchDialogueTurnsClient({
    turns: stitchedInput,
    masterAudioMode: "time_aligned",
    totalVideoDurationSec: 523,
  });

  let overlaps = 0;
  let maxShift = 0;
  let sceneStartsTotal = 0;
  let sceneStartsWithin01 = 0;

  for (let i = 0; i < stitched.turns.length; i++) {
    const t = stitched.turns[i];
    const shift = t.shiftedStartBySec ?? 0;
    if (shift > maxShift) maxShift = shift;

    if (i > 0) {
      const prev = stitched.turns[i - 1];
      const gap = (t.startTime ?? 0) - (prev.endTime ?? 0);
      if (gap < 0.075) overlaps++;

      if (t.sceneTitle && prev.sceneTitle && t.sceneTitle !== prev.sceneTitle) {
        sceneStartsTotal++;
        if (shift <= 0.1 + 1e-4) {
          sceneStartsWithin01++;
        } else {
          assert.equal(
            t.syncStatus,
            "overflow",
            `Scene start ${t.sceneTitle} with shift=${shift}s > 0.1s MUST be marked overflow`
          );
          assert.equal(
            t.needsShorten,
            true,
            `Scene start ${t.sceneTitle} with shift=${shift}s > 0.1s MUST set needsShorten=true`
          );
        }
      }
    }
  }

  console.log(
    `Full Tiggo 8 v4 Acceptance Summary: subBlocks=${fullRes.subBlocksTotal}, turns=${stitched.turns.length}, overlaps=${overlaps}, maxShift=${maxShift.toFixed(2)}s, cleanSceneStarts=${sceneStartsWithin01}/${sceneStartsTotal}, realApiCalls=${realApiCallsDetected}`
  );

  assert.equal(overlaps, 0, `Expected 0 voice overlaps, found ${overlaps}`);
  assert.ok(maxShift <= 1.2, `Expected max shift <= 1.2s, got ${maxShift.toFixed(2)}s`);
  assert.ok(
    sceneStartsWithin01 >= sceneStartsTotal - 1,
    `Expected clean scene starts (<=0.1s), got ${sceneStartsWithin01}/${sceneStartsTotal}`
  );

  // =========================================================================
  // STAGE 5 TESTS: UI quota forecast, bypassCache sub-block regen, fast-pace, Scene 2 budget
  // =========================================================================
  console.log("=== Running Stage 5 Tests ===");

  // 5a. Scene 2 of Tiggo 8 (00:51–01:33, 9 turns) must split into <= 2 sub-blocks (<= 2 TTS + <= 2 transcribe)
  const s5Scene2Turns = tiggoTurns.filter((t) => /2-SAHNA/i.test(t.sceneTitle || ""));
  assert.equal(s5Scene2Turns.length, 9, `Expected 9 turns in Scene 2, got ${s5Scene2Turns.length}`);
  const s5Scene2SubBlocks = planDialogueSubBlocks(s5Scene2Turns, { maxTurns: 8, maxWindowSec: 40 });
  assert.ok(
    s5Scene2SubBlocks.length <= 2,
    `Scene 2 must split into <= 2 sub-blocks for <=2 TTS + <=2 transcribe budget, got ${s5Scene2SubBlocks.length}`
  );
  const scene2Res = await synthesizeDialogueInMacroBlocks(trapAi, {
    turns: s5Scene2Turns,
    speakerMap,
    strictTimeWindow: true,
    bypassCache: true,
  });
  assert.equal(scene2Res.subBlocksTotal, 2, "Scene 2 must execute in 2 sub-blocks");
  assert.equal(scene2Res.turns.length, 9, "Scene 2 must return all 9 turns");
  assert.equal(scene2Res.stats.qaFailed, 0, "Scene 2 must have 0 QA failures");

  // 5b. bypassCache: true must bypass v2 cache (provider === 'fake', NOT 'cache')
  const cachedScene2Hit = await synthesizeDialogueInMacroBlocks(trapAi, {
    turns: s5Scene2Turns,
    speakerMap,
    strictTimeWindow: true,
    bypassCache: false,
  });
  assert.equal(cachedScene2Hit.provider, "cache", "Cached Scene 2 must hit v2 cache");
  const bypassedScene2 = await synthesizeDialogueInMacroBlocks(trapAi, {
    turns: s5Scene2Turns,
    speakerMap,
    strictTimeWindow: true,
    bypassCache: true,
  });
  assert.equal(bypassedScene2.provider, "fake", "bypassCache: true must bypass v2 cache");

  // 5c. Forced fast-pace button («Быстрее») forces brisk pace without modifying text
  const s5FastDir = buildTurnPaceDirective(
    { cleanSpeechText: "Salom do'stim", startSec: 0, endSec: 5 },
    true
  );
  assert.ok(
    s5FastDir.includes("fast, brisk dubbing pace"),
    `forceFastPace must force fast pace directive, got: ${s5FastDir}`
  );

  // Clean up test cache files created during fake run so live runs start fresh
  clearBlockCache();

  console.log("✅ STAGE 5 PASSED: Sub-block quota budget (Scene 2 <= 2 sub-blocks), bypassCache, and fast-pace verified.");
  console.log("🎉 ALL STAGES 0–5 & TIGGO 8 v4 FAKE-MODE ACCEPTANCE TESTS PASSED!");
}

runAllStageTests().catch((err) => {
  console.error("❌ Stage test failed:", err);
  process.exit(1);
});
