import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseReadyScript } from "../src/utils/readyScriptParser.ts";
import { planDialogueSubBlocks } from "../src/utils/dialogueMacroBlocks.ts";
import { stitchDialogueTurnsClient } from "../src/utils/clientMasterStitcher.ts";
import {
  DUBBING_CACHE_VERSION as CLIENT_CACHE_VERSION,
  computeSubBlockClientHash,
  buildSubBlockCacheKey,
  planSubBlockCacheExecution,
  type CachedDialogueSubBlock,
} from "../src/utils/dubbingSubBlockCache.ts";
import { countSyllables } from "../server/services/verbatimStoryboardService.ts";
import {
  DUBBING_CACHE_VERSION,
  DUBBING_PROMPT_VERSION,
  synthesizeDialogueInMacroBlocks,
  evaluateSubBlockQa,
  buildTurnPaceDirective,
  buildCleanTurnStyleForTts,
  tokenizeForQa,
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
  parseAlignmentModelOutput,
  type SlicedTurnClip,
} from "../server/services/dubbing/batchAudioSlicer.ts";
import { DUBBING_MODELS_CONFIG } from "../server/config/dubbingModels.ts";
import type { DialogueTurn } from "../src/types/podcast.ts";

// Enforce Stage 0 fake mode (0 real Gemini API calls!)
process.env.DUBBING_FAKE_TTS = "1";

const BLOCK_CACHE_DIR = path.resolve(process.cwd(), "data", "dubbing-block-cache");
const FIXTURES_DIR = path.resolve(process.cwd(), "scripts", "fixtures");
const TIGGO8_PATH = path.resolve(FIXTURES_DIR, "01_tiggo_8_hybrid_uz_dublyaj_v4.txt");

function clearBlockCache() {
  if (fs.existsSync(BLOCK_CACHE_DIR)) {
    for (const f of fs.readdirSync(BLOCK_CACHE_DIR)) {
      if (f.endsWith(".json")) fs.unlinkSync(path.join(BLOCK_CACHE_DIR, f));
    }
  }
}

// Strict trap: any real GoogleGenAI API call in DUBBING_FAKE_TTS=1 MUST fail immediately!
let realApiCallsDetected = 0;
const trapAi: any = {
  models: {
    generateContent: async () => {
      realApiCallsDetected += 1;
      throw new Error("UNEXPECTED REAL GEMINI API CALL IN DUBBING_FAKE_TTS=1 MODE!");
    },
  },
};

function makeDefaultSpeakerMap(): Map<string, ResolvedBatchSpeaker> {
  const speakerMap = new Map<string, ResolvedBatchSpeaker>();
  speakerMap.set("HOST_1", {
    speakerId: "HOST_1",
    speakerName: "Азиз",
    baseVoice: "Charon",
    voiceId: "charon",
    gender: "male",
    isCloned: false,
    baseSpeechStyle: "",
  });
  speakerMap.set("HOST_2", {
    speakerId: "HOST_2",
    speakerName: "Вероника",
    baseVoice: "Kore",
    voiceId: "kore",
    gender: "female",
    isCloned: false,
    baseSpeechStyle: "",
  });
  return speakerMap;
}

function buildBatchTurnsFromParsed(
  parsedTurns: DialogueTurn[],
  totalDurationFallback: number
): BatchInputTurn[] {
  return parsedTurns.map((t, i) => {
    const isAziz = /азиз|aziz/i.test(t.speakerName || "") || t.speakerGender === "male";
    const speakerId = isAziz ? "HOST_1" : "HOST_2";
    const nextStart =
      i + 1 < parsedTurns.length && typeof parsedTurns[i + 1].startSec === "number"
        ? parsedTurns[i + 1].startSec!
        : totalDurationFallback;
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

function loadTiggo8BatchTurns(): {
  turns: BatchInputTurn[];
  speakerMap: Map<string, ResolvedBatchSpeaker>;
  rawTurns: DialogueTurn[];
} {
  assert.ok(fs.existsSync(TIGGO8_PATH), `Missing Tiggo 8 real fixture at ${TIGGO8_PATH}`);
  const txt = fs.readFileSync(TIGGO8_PATH, "utf8");
  const parsed = parseReadyScript(txt);
  assert.equal(parsed.turns.length, 79, "Expected 79 turns in Tiggo 8 v4");
  const speakerMap = makeDefaultSpeakerMap();
  const batchTurns = buildBatchTurnsFromParsed(parsed.turns, 523);
  return { turns: batchTurns, speakerMap, rawTurns: parsed.turns };
}

function formatSecToMmSs(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

/**
 * Loads a real fixture from scripts/fixtures if present, otherwise builds a realistic v4 script
 * matching the exact turn count and multi-scene structure for Tiggo 9 (103 turns) or Arrizo 8 (79 turns).
 */
function loadOrBuildV4Script(params: {
  label: string;
  filePattern: RegExp;
  expectedTurns: number;
  sceneCount: number;
}): { turns: BatchInputTurn[]; rawTurns: DialogueTurn[]; totalSec: number; source: string } {
  const existing = fs.existsSync(FIXTURES_DIR)
    ? fs.readdirSync(FIXTURES_DIR).find((f) => f.endsWith(".txt") && params.filePattern.test(f))
    : undefined;

  if (existing) {
    const txt = fs.readFileSync(path.join(FIXTURES_DIR, existing), "utf8");
    const parsed = parseReadyScript(txt);
    const totalSec =
      Math.max(
        10,
        ...parsed.turns.map((t) => Number(t.endSec) || 0)
      ) + 2;
    return {
      turns: buildBatchTurnsFromParsed(parsed.turns, totalSec),
      rawTurns: parsed.turns,
      totalSec,
      source: `fixture:${existing}`,
    };
  }

  const lines: string[] = [
    `# ${params.label} v4 (synthetic realistic v4 script)`,
    `Спикеры: Азиз (М), Вероника (Ж) | Всего реплик: ${params.expectedTurns}`,
    "",
  ];
  const sampleAziz = [
    "Bu modelda o‘n to‘qqiz dyuymli disklar va yumshoq osma tizimi o‘rnatilgan.",
    "Dvigatel quvvati yuqori, shahar ichida ham trassada ham juda ravon yuradi.",
    "Salon keng, o‘rindiqlar isitish va sovutish funksiyasi bilan jihozlangan.",
    "Batareya harorat nazorati bilan himoyalangan, sovuq havoda ham ishonchli ishlaydi.",
    "Ha, albatta, xavfsizlik tizimlari to‘liq komplektatsiyada keladi.",
  ];
  const sampleVeronika = [
    "Rostdanmi? Tashqi ko‘rinishi juda zamonaviy va sportiv ko‘rinar ekan!",
    "Yo‘lda shovqin izolyatsiyasi qanday, ichkarida sokinmi?",
    "Orqa qator yo‘lovchilari uchun joy yetarlimi, uzoq safarda qulay bo‘ladimi?",
    "Kafolat muddati va servis xizmatlari haqida ham aytib bering.",
    "Ajoyib natija, hammaga tavsiya qilamiz!",
  ];

  let cursor = 2;
  const turnsPerScene = Math.ceil(params.expectedTurns / params.sceneCount);
  for (let i = 0; i < params.expectedTurns; i++) {
    if (i % turnsPerScene === 0) {
      const sceneNum = Math.floor(i / turnsPerScene) + 1;
      if (i > 0) cursor += 3;
      lines.push(`=== ${sceneNum}-SAHNA — ${params.label} bo‘lim ${sceneNum} ===`);
    }
    const isAziz = i % 2 === 0;
    const speaker = isAziz ? "Азиз" : "Вероника";
    const text = isAziz
      ? sampleAziz[i % sampleAziz.length]
      : sampleVeronika[i % sampleVeronika.length];
    const dur = Math.max(2, Math.round(countSyllables(text) / 4.6));
    const startSec = cursor;
    const endSec = cursor + dur;
    cursor = endSec + 1;
    lines.push(
      `${formatSecToMmSs(startSec)}–${formatSecToMmSs(endSec)} (${dur}s) | ${speaker} | 4.6 | ${
        isAziz ? "уверенно, экспертно" : "живо, с интересом"
      } | ${text} | Оригинал ${i + 1}`
    );
  }

  const parsed = parseReadyScript(lines.join("\n"));
  assert.equal(
    parsed.turns.length,
    params.expectedTurns,
    `Expected ${params.expectedTurns} turns for ${params.label}`
  );
  return {
    turns: buildBatchTurnsFromParsed(parsed.turns, cursor + 2),
    rawTurns: parsed.turns,
    totalSec: cursor + 2,
    source: "synthetic_v4",
  };
}

async function runAllStageTests() {
  clearBlockCache();
  assert.equal(DUBBING_CACHE_VERSION, "v3", "Server cache version must be v3");
  assert.equal(DUBBING_PROMPT_VERSION, "v3", "Server prompt version must be v3");
  assert.equal(CLIENT_CACHE_VERSION, "v3", "Client cache version must be v3");

  const { turns: tiggoTurns, speakerMap } = loadTiggo8BatchTurns();

  // =========================================================================
  // 1. GEMINI 3.8 TTS STYLE & PROMPT RULES
  // =========================================================================
  console.log("=== Test 1: Gemini 3.8 TTS Style & Clean Text Rules ===");

  assert.equal(
    buildTurnPaceDirective({
      cleanSpeechText: "Batareya yaxshi himoyalangan va harorat nazorati bor, sinovdan o‘tgan.",
      startSec: 0,
      endSec: 3, // > 5.5 syl/s
    }),
    "speaking rapidly"
  );
  assert.equal(
    buildTurnPaceDirective({
      cleanSpeechText: "Hammaga salom, men Azizman, bugun mashina ko‘ramiz.",
      startSec: 0,
      endSec: 3.4, // ~4.7 syl/s
    }),
    "natural conversational pace"
  );
  assert.equal(
    buildTurnPaceDirective({
      cleanSpeechText: "Hammaga xayr!",
      startSec: 0,
      endSec: 2, // < 4.5 syl/s
    }),
    "relaxed pace"
  );
  assert.equal(
    buildTurnPaceDirective({ cleanSpeechText: "Salom", startSec: 0, endSec: 5 }, true),
    "speaking rapidly"
  );

  // Dirty legacy style input must be distilled into short English delivery (2-4 words) + pace
  const cleanSampleStyle = buildCleanTurnStyleForTts({
    cleanSpeechText: "Hammaga salom, bugun yangi avtomobilni ko‘ramiz.",
    startSec: 0,
    endSec: 3.2,
    intonationRu: "Бодро, радостно",
    style:
      "Natural male Uzbek speaker (Азиз). Clear warm baritone voice, 100% authentic Uzbek pronunciation. Say the line exactly once, word for word.",
  });
  assert.ok(
    cleanSampleStyle === "cheerful, lively, natural conversational pace",
    `Unexpected clean style: ${cleanSampleStyle}`
  );

  const scene2Turns = tiggoTurns.filter((t) => /2-SAHNA/i.test(t.sceneTitle || ""));
  assert.equal(scene2Turns.length, 9, "Expected 9 turns in Scene 2 of Tiggo 8");

  const observedPayloads: Array<{ channel: string; text: string; style: string; speaker?: string }> = [];
  setTtsPayloadObserverForTesting(({ channel, parts }) => {
    for (const p of parts) {
      observedPayloads.push({ channel, text: p.text, style: p.style, speaker: p.speaker });
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
    assert.ok(
      !/^\s*Speaker(?:One|Two)\s*:/i.test(p.text),
      `FORBIDDEN SpeakerOne:/SpeakerTwo: prefix in text: ${p.text}`
    );
    assert.ok(!/distinct\s+pause/i.test(p.style), `Found distinct pause in style: ${p.style}`);
    assert.ok(!/Say\s+the\s+line\s+exactly\s+once/i.test(p.style), `Found forbidden phrase in style: ${p.style}`);
    assert.ok(!/baritone/i.test(p.style), `Found baritone in style: ${p.style}`);
    assert.ok(!/100%\s*authentic/i.test(p.style), `Found 100% authentic in style: ${p.style}`);
    assert.ok(!/Natural\s+(?:male|female)/i.test(p.style), `Found Natural male/female in style: ${p.style}`);
    assert.ok(!/Азиз|Вероника/i.test(p.style), `Found speaker name in style: ${p.style}`);
    assert.ok(
      /(?:speaking rapidly|natural conversational pace|relaxed pace)$/.test(p.style),
      `Style must end with official pace directive, got: ${p.style}`
    );
  }
  console.log("✅ TEST 1 PASSED: Gemini 3.8 TTS style & clean verbatim text verified.");

  // =========================================================================
  // 2. PER-TURN ALIGNMENT QA: SHIFTED TAIL, GENDER, SILENCE SNAP, <=4 SYL, NORMALIZATION
  // =========================================================================
  console.log("=== Test 2: Per-Turn QA (Shifted Tail, Gender, Silence Boundary, <=4 Syl, Apostrophes/Digits) ===");

  // 2a. Apostrophe & digit normalization
  const normA = tokenizeForQa("19 dyuym, o‘rin va gʻildirak");
  const normB = tokenizeForQa("o'n to'qqiz dyuym o'rin va g'ildirak");
  assert.deepEqual(normA, normB, `Apostrophe + digit normalization mismatch: ${normA} vs ${normB}`);

  const subBlocksTiggo = planDialogueSubBlocks(tiggoTurns);
  const sampleSub = subBlocksTiggo[1].turns; // multi-turn mixed-gender sub-block
  assert.ok(sampleSub.length >= 4, "Need >=4 turns for per-turn QA tests");

  const buildIdealClips = (sub: BatchInputTurn[]): SlicedTurnClip[] => {
    let cursorMs = 0;
    return sub.map((t, idx) => {
      const dur = Math.max(0.45, countSyllables(t.cleanSpeechText) / 4.8);
      const startMs = cursorMs;
      const endMs = startMs + Math.round(dur * 1000);
      cursorMs = endMs + 450;
      return {
        index: idx,
        pcm: generateSyntheticTurnPcm(dur, 350),
        startMs,
        endMs,
        durationSec: dur,
        method: "transcribe_aligned",
        spokenText: t.cleanSpeechText,
        detectedVoice: t.speakerGender || "male",
        boundarySnapped: true,
      };
    });
  };

  const idealClips = buildIdealClips(sampleSub);
  const expectedWholeText = sampleSub.map((t) => t.cleanSpeechText).join(" ");

  const qaIdeal = evaluateSubBlockQa({
    expectedTurns: sampleSub,
    slicedClips: idealClips,
    transcriptText: expectedWholeText,
    speakerMap,
  });
  assert.equal(qaIdeal.passed, true, `Ideal sub-block should pass QA, got: ${qaIdeal.reasons}`);

  // 2b. ARTIFICIALLY SHIFTED TURN TAIL -> MUST FAIL WITH turn_text_mismatch!
  const turn0Words = sampleSub[0].cleanSpeechText.trim().split(/\s+/);
  const movedTail = turn0Words.slice(-2).join(" ");
  const truncatedTurn0 = turn0Words.slice(0, Math.max(1, turn0Words.length - 2)).join(" ");
  const shiftedClips: SlicedTurnClip[] = idealClips.map((c, idx) => {
    if (idx === 0) return { ...c, spokenText: truncatedTurn0 };
    if (idx === 1) return { ...c, spokenText: `${movedTail} ${c.spokenText}` };
    return c;
  });
  const qaShifted = evaluateSubBlockQa({
    expectedTurns: sampleSub,
    slicedClips: shiftedClips,
    transcriptText: shiftedClips.map((c) => c.spokenText).join(" "),
    speakerMap,
  });
  assert.equal(qaShifted.passed, false, "Artificially shifted turn tail MUST fail QA!");
  assert.ok(
    qaShifted.reasons.some((r) => r.includes("turn_text_mismatch")),
    `Expected turn_text_mismatch on shifted tail, got: ${qaShifted.reasons}`
  );

  // Also test shifted tail end-to-end via synthesizeDialogueInMacroBlocks fault injector
  clearBlockCache();
  setFakeDubbingFaultInjectorForTesting(() => ({
    fakeTurnOverrides: [
      { spokenText: truncatedTurn0 },
      { spokenText: `${movedTail} ${sampleSub[1].cleanSpeechText}` },
    ],
  }));
  const shiftedE2e = await synthesizeDialogueInMacroBlocks(trapAi, {
    turns: sampleSub,
    speakerMap,
    strictTimeWindow: true,
    bypassCache: true,
    maxExtraTtsCalls: 0,
  });
  setFakeDubbingFaultInjectorForTesting(null);
  assert.ok(shiftedE2e.turns.every((t) => t.qa === "failed"), "Shifted tail E2E must fail QA");
  assert.ok(
    shiftedE2e.failedSubBlocks.length === 1 &&
      shiftedE2e.failedSubBlocks[0].reasons.some((r) => r.includes("turn_text_mismatch")),
    `Expected failedSubBlocks with turn_text_mismatch, got: ${JSON.stringify(shiftedE2e.failedSubBlocks)}`
  );

  // 2c. Wrong VOICE gender in mixed-gender sub-block -> turn_voice_gender_mismatch
  const wrongVoiceClips = idealClips.map((c, idx) =>
    idx === 0 ? { ...c, detectedVoice: (c.detectedVoice === "male" ? "female" : "male") as "male" | "female" } : c
  );
  const qaWrongVoice = evaluateSubBlockQa({
    expectedTurns: sampleSub,
    slicedClips: wrongVoiceClips,
    transcriptText: expectedWholeText,
    speakerMap,
  });
  assert.equal(qaWrongVoice.passed, false, "Wrong VOICE gender must fail QA");
  assert.ok(
    qaWrongVoice.reasons.some((r) => r.includes("turn_voice_gender_mismatch")),
    `Expected turn_voice_gender_mismatch, got: ${qaWrongVoice.reasons}`
  );

  // 2d. Missing silence boundary within ±0.6s -> no_silence_boundary_near_cut
  clearBlockCache();
  setFakeDubbingFaultInjectorForTesting(() => ({ noInterTurnSilence: true }));
  const noSilenceRes = await synthesizeDialogueInMacroBlocks(trapAi, {
    turns: sampleSub,
    speakerMap,
    strictTimeWindow: true,
    bypassCache: true,
    maxExtraTtsCalls: 0,
  });
  setFakeDubbingFaultInjectorForTesting(null);
  assert.ok(noSilenceRes.turns.every((t) => t.qa === "failed"), "No silence boundary must fail QA");
  assert.ok(
    noSilenceRes.failedSubBlocks[0]?.reasons.some((r) => r.includes("no_silence_boundary_near_cut")),
    `Expected no_silence_boundary_near_cut, got: ${JSON.stringify(noSilenceRes.failedSubBlocks)}`
  );

  // 2e. Short turn (<= 4 syllables): valid range [0.3, 1.6]s instead of duration ratio
  const shortTurn: BatchInputTurn = {
    ...sampleSub[0],
    id: "short-1",
    text: "Ha, yaxshi!",
    cleanSpeechText: "Ha, yaxshi!", // 3 syllables <= 4
    speakerId: "HOST_1",
    speakerGender: "male",
    startSec: 0,
    endSec: 1.0,
  };
  assert.ok(countSyllables(shortTurn.cleanSpeechText) <= 4);
  const makeShortClip = (dur: number): SlicedTurnClip[] => [
    {
      index: 0,
      pcm: generateSyntheticTurnPcm(dur, 350),
      startMs: 0,
      endMs: Math.round(dur * 1000),
      durationSec: dur,
      method: "transcribe_aligned",
      spokenText: shortTurn.cleanSpeechText,
      detectedVoice: "male",
      boundarySnapped: true,
    },
  ];
  assert.equal(
    evaluateSubBlockQa({
      expectedTurns: [shortTurn],
      slicedClips: makeShortClip(0.35),
      transcriptText: shortTurn.cleanSpeechText,
      speakerMap,
    }).passed,
    true,
    "Short <=4 syl turn at 0.35s must PASS"
  );
  assert.equal(
    evaluateSubBlockQa({
      expectedTurns: [shortTurn],
      slicedClips: makeShortClip(1.4),
      transcriptText: shortTurn.cleanSpeechText,
      speakerMap,
    }).passed,
    true,
    "Short <=4 syl turn at 1.4s must PASS"
  );
  assert.equal(
    evaluateSubBlockQa({
      expectedTurns: [shortTurn],
      slicedClips: makeShortClip(0.2),
      transcriptText: shortTurn.cleanSpeechText,
      speakerMap,
    }).passed,
    false,
    "Short <=4 syl turn at 0.2s (<0.3s) must FAIL"
  );
  assert.equal(
    evaluateSubBlockQa({
      expectedTurns: [shortTurn],
      slicedClips: makeShortClip(1.8),
      transcriptText: shortTurn.cleanSpeechText,
      speakerMap,
    }).passed,
    false,
    "Short <=4 syl turn at 1.8s (>1.6s) must FAIL"
  );

  // 2f. Escalation Cascade (when retry budget allows) -> retry / split_half / mode_b
  clearBlockCache();
  let sawModeB = false;
  setFakeDubbingFaultInjectorForTesting(({ stage, mode }) => {
    if (stage !== "mode_b") return { overrideTranscript: "short pause broken" };
    if (mode === "B") sawModeB = true;
    return null;
  });
  const modeBRes = await synthesizeDialogueInMacroBlocks(trapAi, {
    turns: sampleSub,
    speakerMap,
    strictTimeWindow: true,
    bypassCache: true,
    maxExtraTtsCalls: 10,
  });
  setFakeDubbingFaultInjectorForTesting(null);
  assert.equal(sawModeB, true, "Escalation must reach Mode B when budget permits");
  assert.ok(modeBRes.turns.every((t) => t.qa === "retried"));

  console.log("✅ TEST 2 PASSED: Shifted tail, wrong gender, silence snap, <=4 syl, apostrophes/digits, and escalation verified.");

  // =========================================================================
  // 3. 25% RETRY BUDGET CAP
  // =========================================================================
  console.log("=== Test 3: 25% Extra TTS Retry Budget Cap ===");
  clearBlockCache();

  // All sub-blocks of Tiggo 8 (~13 sub-blocks) fail QA; extra TTS calls MUST NOT exceed floor(subBlocks * 0.25)
  const expectedSubBlockCount = planDialogueSubBlocks(tiggoTurns).length;
  const expectedBudget = Math.floor(expectedSubBlockCount * 0.25);
  assert.ok(expectedBudget >= 2, `Expected >=2 retry budget for Tiggo 8, got ${expectedBudget}`);

  setFakeDubbingFaultInjectorForTesting(() => ({
    overrideTranscript: "short pause broken",
  }));
  const budgetRes = await synthesizeDialogueInMacroBlocks(trapAi, {
    turns: tiggoTurns,
    speakerMap,
    strictTimeWindow: true,
    bypassCache: true,
  });
  setFakeDubbingFaultInjectorForTesting(null);

  assert.equal(budgetRes.extraTtsBudget, expectedBudget, "Budget must equal floor(subBlocks * 0.25)");
  assert.ok(
    budgetRes.extraTtsCallsUsed <= expectedBudget,
    `Extra TTS calls (${budgetRes.extraTtsCallsUsed}) exceeded 25% budget (${expectedBudget})!`
  );
  assert.equal(
    budgetRes.failedSubBlocks.length,
    expectedSubBlockCount,
    "All failing sub-blocks must be listed in failedSubBlocks"
  );
  assert.ok(
    budgetRes.failedSubBlocks.some((f) => f.reasons.some((r) => r.includes("retry_budget_exhausted"))),
    "Sub-blocks after budget exhaustion must report retry_budget_exhausted"
  );
  assert.equal(
    fs.existsSync(BLOCK_CACHE_DIR)
      ? fs.readdirSync(BLOCK_CACHE_DIR).filter((f) => f.endsWith(".json")).length
      : 0,
    0,
    "Failed sub-blocks MUST NOT be cached"
  );
  console.log(
    `✅ TEST 3 PASSED: 25% retry budget enforced (${budgetRes.extraTtsCallsUsed}/${budgetRes.extraTtsBudget} extra TTS calls on ${expectedSubBlockCount} sub-blocks).`
  );

  // =========================================================================
  // 4. WHOLE SUB-BLOCK v3 CACHE: ONE SPEAKER VOICE CHANGE + LEGACY CACHE IGNORED
  // =========================================================================
  console.log("=== Test 4: Whole Sub-Block v3 Cache (Voice Change + Legacy Non-v3 Ignored) ===");
  clearBlockCache();

  // 4a. Client-side whole-sub-block plan: changing ONE speaker's voice re-synthesizes ALL sub-blocks
  // containing that speaker WHOLE with BOTH speakers!
  const projectKey = "test_user::tiggo8";
  const fakeWavBase64 = Buffer.alloc(64, 7).toString("base64");
  const fullSubBlocks = planDialogueSubBlocks(tiggoTurns);

  let host1Voice = "charon|male";
  let host2Voice = "kore|female";
  const getVoiceKey = (t: BatchInputTurn) => (t.speakerId === "HOST_1" ? host1Voice : host2Voice);
  const getStyleKey = (t: BatchInputTurn) => t.style || "";

  // Populate v3 client cache for ALL sub-blocks with initial voices
  const clientCacheMap = new Map<string, Partial<CachedDialogueSubBlock>>();
  for (const sb of fullSubBlocks) {
    const hash = computeSubBlockClientHash({
      subBlockTurns: sb.turns,
      getSpeakerVoiceKey: getVoiceKey,
      getTurnStyleKey: getStyleKey,
    });
    const key = buildSubBlockCacheKey(projectKey, hash);
    clientCacheMap.set(key, {
      cacheKey: key,
      cacheVersion: "v3",
      projectKey,
      subBlockIndex: sb.subBlockIndex,
      subBlockHash: hash,
      qa: "ok",
      turnIds: sb.turns.map((t) => t.id),
      turns: sb.turns.map((t) => ({
        turnId: t.id,
        audioBase64: fakeWavBase64,
        qa: "ok",
      })),
      savedAt: Date.now(),
    });
  }

  // With identical voices -> 100% cache hit, 0 request batches
  const planInitial = planSubBlockCacheExecution({
    fullTurns: tiggoTurns,
    projectKey,
    getSpeakerVoiceKey: getVoiceKey,
    getTurnStyleKey: getStyleKey,
    cachedSubBlocksByKey: clientCacheMap,
  });
  assert.equal(planInitial.uncachedSubBlocks.length, 0, "All sub-blocks should hit v3 cache initially");
  assert.equal(planInitial.requestBatches.length, 0);

  // Now change ONLY HOST_2's voice (Вероника: kore -> aoede)
  host2Voice = "aoede|female";
  const planAfterVoiceChange = planSubBlockCacheExecution({
    fullTurns: tiggoTurns,
    projectKey,
    getSpeakerVoiceKey: getVoiceKey,
    getTurnStyleKey: getStyleKey,
    cachedSubBlocksByKey: clientCacheMap,
  });

  const expectedInvalidatedCount = fullSubBlocks.filter((sb) =>
    sb.turns.some((t) => t.speakerId === "HOST_2")
  ).length;
  assert.equal(
    planAfterVoiceChange.uncachedSubBlocks.length,
    expectedInvalidatedCount,
    "Every sub-block containing HOST_2 must be invalidated when HOST_2 voice changes"
  );

  // Verify EVERY invalidated sub-block with 2 speakers is sent WHOLE with BOTH speakers intact!
  for (const uncached of planAfterVoiceChange.uncachedSubBlocks) {
    const origSb = fullSubBlocks[uncached.subBlock.subBlockIndex];
    assert.deepEqual(
      uncached.subBlock.turns.map((t) => t.id),
      origSb.turns.map((t) => t.id),
      "Invalidated sub-block MUST keep all turns of BOTH speakers intact!"
    );
    const origSpeakers = new Set(origSb.turns.map((t) => t.speakerId));
    const sentSpeakers = new Set(uncached.subBlock.turns.map((t) => t.speakerId));
    assert.deepEqual(sentSpeakers, origSpeakers, "Must never strip unchanged speaker from sub-block!");
  }

  // 4b. Legacy client cache WITHOUT version 'v3' MUST be ignored!
  host2Voice = "kore|female"; // restore original voices
  const legacyClientMap = new Map<string, Partial<CachedDialogueSubBlock>>();
  for (const [k, entry] of clientCacheMap.entries()) {
    legacyClientMap.set(k, { ...entry, cacheVersion: undefined }); // legacy entry without v3
  }
  const planLegacyIgnored = planSubBlockCacheExecution({
    fullTurns: tiggoTurns,
    projectKey,
    getSpeakerVoiceKey: getVoiceKey,
    getTurnStyleKey: getStyleKey,
    cachedSubBlocksByKey: legacyClientMap,
  });
  assert.equal(
    planLegacyIgnored.cachedSubBlocks.length,
    0,
    "Legacy client cache entries without cacheVersion='v3' MUST be ignored"
  );
  assert.equal(planLegacyIgnored.uncachedSubBlocks.length, fullSubBlocks.length);

  // 4c. Server disk cache: v2 / legacy file under exact hash MUST be ignored; voice change invalidates whole sub-block
  clearBlockCache();
  const oneMixedSub = fullSubBlocks.find(
    (sb) =>
      sb.turns.some((t) => t.speakerId === "HOST_1") &&
      sb.turns.some((t) => t.speakerId === "HOST_2")
  )!.turns;

  const expectedServerHash = computeSubBlockCacheHash(oneMixedSub, speakerMap, "A");
  fs.mkdirSync(BLOCK_CACHE_DIR, { recursive: true });
  // Write a poisoned legacy v2 cache file under the exact same hash filename
  fs.writeFileSync(
    path.join(BLOCK_CACHE_DIR, `${expectedServerHash}.json`),
    JSON.stringify({
      v: 2,
      cacheVersion: "v2",
      qa: "ok",
      methods: oneMixedSub.map(() => "vad_exact"),
      clipsBase64: oneMixedSub.map(() => generateSyntheticTurnPcm(0.5, 300).toString("base64")),
    }),
    "utf8"
  );

  const afterLegacyServerRun = await synthesizeDialogueInMacroBlocks(trapAi, {
    turns: oneMixedSub,
    speakerMap,
    strictTimeWindow: true,
    bypassCache: false,
  });
  assert.equal(
    afterLegacyServerRun.provider,
    "fake",
    "Server MUST ignore legacy v2 cache file and re-synthesize fresh!"
  );
  const rewrittenDisk = JSON.parse(
    fs.readFileSync(path.join(BLOCK_CACHE_DIR, `${expectedServerHash}.json`), "utf8")
  );
  assert.equal(rewrittenDisk.v, 3, "Rewritten disk cache must be v: 3");
  assert.equal(rewrittenDisk.cacheVersion, "v3", "Rewritten disk cache must have cacheVersion: 'v3'");

  // Second run with same voices hits v3 cache
  const v3Hit = await synthesizeDialogueInMacroBlocks(trapAi, {
    turns: oneMixedSub,
    speakerMap,
    strictTimeWindow: true,
    bypassCache: false,
  });
  assert.equal(v3Hit.provider, "cache", "Second run with same voices must hit v3 disk cache");

  // Changing ONE speaker voice on server misses v3 cache & re-synthesizes BOTH speakers whole
  const speakerMapChanged = makeDefaultSpeakerMap();
  speakerMapChanged.set("HOST_2", {
    ...speakerMapChanged.get("HOST_2")!,
    baseVoice: "Aoede",
    voiceId: "aoede",
  });
  const serverHashChanged = computeSubBlockCacheHash(oneMixedSub, speakerMapChanged, "A");
  assert.notEqual(expectedServerHash, serverHashChanged, "Server hash must change when one speaker voice changes");

  const reSynthBoth = await synthesizeDialogueInMacroBlocks(trapAi, {
    turns: oneMixedSub,
    speakerMap: speakerMapChanged,
    strictTimeWindow: true,
    bypassCache: false,
  });
  assert.equal(reSynthBoth.provider, "fake", "Changed voice must re-synthesize instead of hitting old cache");
  assert.equal(reSynthBoth.turns.length, oneMixedSub.length, "Must re-synthesize whole sub-block with both speakers");
  assert.ok(canSaveSubBlockToCache("ok", ["transcribe_aligned"]));
  assert.ok(!canSaveSubBlockToCache("failed", ["transcribe_aligned"]));
  assert.ok(!canSaveSubBlockToCache("ok", ["vad_dp_soft"]));

  console.log("✅ TEST 4 PASSED: Whole sub-block v3 cache, voice-change invalidation, and legacy cache rejection verified.");

  // =========================================================================
  // 5. STAGE 4 TIMECODE FIT & ZERO-OVERLAP STITCH CHECK
  // =========================================================================
  console.log("=== Test 5: Timecode Fit (1.15x boost + needsShorten) ===");
  const tightTurn: BatchInputTurn = {
    ...sampleSub[0],
    startSec: 0,
    endSec: 2.0,
    gapAfterSec: 0,
  };
  const fitTooLong = await fitSlicedTurnToTimecode(generateSyntheticTurnPcm(3.2, 350), tightTurn, true);
  assert.equal(fitTooLong.atempoApplied, 1.15);
  assert.equal(fitTooLong.needsShorten, true);
  console.log("✅ TEST 5 PASSED: Single-turn 1.15x boost & needsShorten verified.");

  // =========================================================================
  // 6. IDEAL SYNTHETIC RECORDING OF 3 v4 SCRIPTS -> 0 FAILED SUB-BLOCKS
  // =========================================================================
  console.log("=== Test 6: Ideal Synthetic Recording of 3 v4 Scripts (Tiggo 8 + Tiggo 9 + Arrizo 8) ===");

  const scriptsToVerify = [
    {
      name: "Tiggo 8 Hybrid v4",
      turns: tiggoTurns,
      totalSec: 523,
      source: "fixture:01_tiggo_8_hybrid_uz_dublyaj_v4.txt",
    },
    (() => {
      const s = loadOrBuildV4Script({
        label: "Tiggo 9",
        filePattern: /tiggo.?9/i,
        expectedTurns: 103,
        sceneCount: 8,
      });
      return { name: "Tiggo 9 v4", ...s };
    })(),
    (() => {
      const s = loadOrBuildV4Script({
        label: "Arrizo 8",
        filePattern: /arrizo.?8/i,
        expectedTurns: 79,
        sceneCount: 7,
      });
      return { name: "Arrizo 8 v4", ...s };
    })(),
  ];

  for (const sc of scriptsToVerify) {
    clearBlockCache();
    const res = await synthesizeDialogueInMacroBlocks(trapAi, {
      turns: sc.turns,
      speakerMap,
      strictTimeWindow: true,
      bypassCache: false,
    });

    assert.equal(
      res.failedSubBlocks.length,
      0,
      `${sc.name}: expected 0 failed sub-blocks, got ${JSON.stringify(res.failedSubBlocks)}`
    );
    assert.equal(res.stats.qaFailed, 0, `${sc.name}: expected 0 qaFailed turns`);
    assert.equal(res.turns.length, sc.turns.length, `${sc.name}: turn count mismatch`);

    const stitched = stitchDialogueTurnsClient({
      turns: res.turns.map((r, i) => ({
        ...sc.turns[i].rawTurn,
        id: r.id,
        speakerId: r.speakerId,
        speakerName: r.speakerName,
        text: r.text,
        sceneTitle: sc.turns[i].sceneTitle,
        startSec: sc.turns[i].startSec,
        endSec: sc.turns[i].endSec,
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
      })),
      masterAudioMode: "time_aligned",
      totalVideoDurationSec: sc.totalSec,
    });

    let overlaps = 0;
    for (let i = 1; i < stitched.turns.length; i++) {
      const gap = (stitched.turns[i].startTime ?? 0) - (stitched.turns[i - 1].endTime ?? 0);
      if (gap < 0.075) overlaps++;
    }
    assert.equal(overlaps, 0, `${sc.name}: expected 0 overlaps, found ${overlaps}`);

    console.log(
      `  ✓ ${sc.name} (${sc.source}): ${res.turns.length} turns, ${res.subBlocksTotal} sub-blocks, 0 failed sub-blocks, 0 overlaps`
    );
  }

  // =========================================================================
  // 6. ALIGNMENT MODEL CONFIG & STRUCTURED JSON / PIPE PARSER TESTS
  // =========================================================================
  console.log("=== Test 6: Alignment Model (gemini-4-hydrogen) & Output Parser ===");
  assert.equal(
    DUBBING_MODELS_CONFIG.audioAlignmentModel,
    "gemini-4-hydrogen",
    "Structured audio alignment MUST use gemini-4-hydrogen (not plain-text gemini-3.5-transcribe)"
  );

  const jsonAligned = parseAlignmentModelOutput(
    JSON.stringify({
      turns: [
        {
          index: 0,
          startSec: 0.05,
          endSec: 3.42,
          found: true,
          voice: "male",
          spokenText: "Assalomu alaykum hammaga",
        },
        {
          index: 1,
          startSec: 3.85,
          endSec: 7.1,
          found: true,
          voice: "female",
          spokenText: "Bugun yangi Tiggo 8 ni ko'ramiz",
        },
      ],
    })
  );
  assert.equal(jsonAligned.size, 2, "JSON { turns: [...] } must parse both turns");
  assert.equal(jsonAligned.get(0)?.voice, "male");
  assert.equal(jsonAligned.get(1)?.voice, "female");
  assert.equal(jsonAligned.get(1)?.spokenText, "Bugun yangi Tiggo 8 ni ko'ramiz");

  const fencedJsonAligned = parseAlignmentModelOutput(
    "```json\n[{\"index\":0,\"startSec\":0.1,\"endSec\":2.5,\"found\":true,\"voice\":\"female\",\"spokenText\":\"Salom!\"}]\n```"
  );
  assert.equal(fencedJsonAligned.size, 1, "Markdown-fenced JSON array must parse cleanly");
  assert.equal(fencedJsonAligned.get(0)?.voice, "female");

  const pipeAligned = parseAlignmentModelOutput(
    "0 | 0.05 | 3.45 | true | male | Assalomu alaykum\n1 | 3.70 | 6.90 | true | female | Hammaga xayr"
  );
  assert.equal(pipeAligned.size, 2, "Pipe-delimited fallback format must parse cleanly");
  assert.equal(pipeAligned.get(0)?.spokenText, "Assalomu alaykum");
  assert.equal(pipeAligned.get(1)?.voice, "female");

  const plainAsrOutput = parseAlignmentModelOutput(
    "Assalomu alaykum hammaga. Bugun yangi Tiggo 8 ni ko'ramiz."
  );
  assert.equal(
    plainAsrOutput.size,
    0,
    "Unstructured plain ASR text (like gemini-3.5-transcribe) must return 0 parsed turns"
  );
  console.log("✅ TEST 6 PASSED: audioAlignmentModel=gemini-4-hydrogen & JSON/pipe parser verified.");

  assert.equal(realApiCallsDetected, 0, "MUST have 0 real Gemini API calls across entire test suite!");
  clearBlockCache();
  console.log("🎉 ALL v3 DUBBING QUALITY, CACHE, ALIGNMENT & 3-SCRIPT TESTS PASSED (0 REAL API CALLS)!");
}

runAllStageTests().catch((err) => {
  console.error("❌ Stage test failed:", err);
  process.exit(1);
});
