import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import os from "node:os";
import {
  parseReadyScript,
  exportTurnsToCsv,
  exportTurnsToJson,
} from "../src/utils/readyScriptParser.ts";
import { planDialogueSubBlocks } from "../src/utils/dialogueMacroBlocks.ts";
import { stitchDialogueTurnsClient } from "../src/utils/clientMasterStitcher.ts";
import {
  DUBBING_CACHE_VERSION as CLIENT_CACHE_VERSION,
  DEFAULT_DUBBING_TTS_MODEL,
  computeSubBlockClientHash,
  buildSubBlockCacheKey,
  planSubBlockCacheExecution,
  type CachedDialogueSubBlock,
} from "../src/utils/dubbingSubBlockCache.ts";
import { SUB_BLOCK_MAX_TURNS, SUB_BLOCK_MAX_SEC } from "../src/utils/dubbingLimits.ts";
import {
  DEFAULT_BASE_STYLE_MALE,
  DEFAULT_BASE_STYLE_FEMALE,
  buildTurnTtsStyle,
  prepareTurnTextForTts,
  shouldAppendLaughTag,
} from "../src/utils/dubbingStyle.ts";
import {
  DEFAULT_PRONUNCIATION_DICTIONARY,
  applyPronunciationDictionary,
} from "../src/utils/pronunciationDictionary.ts";
import { countSyllables } from "../server/services/verbatimStoryboardService.ts";
import {
  DUBBING_CACHE_VERSION,
  DUBBING_PROMPT_VERSION,
  synthesizeDialogueInMacroBlocks,
  synthesizeSingleTurnInModeAContext,
  splitTurnsIntoDubbingSubBlocks,
  evaluateSubBlockQa,
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
  buildWav24k,
  generateSyntheticTurnPcm,
  parseAlignmentModelOutput,
  type SlicedTurnClip,
} from "../server/services/dubbing/batchAudioSlicer.ts";
import {
  levelSubBlockClipsLoudness,
  measureIntegratedLufsPcm,
  measurePeakDbfsPcm,
} from "../server/services/dubbing/loudnessLeveler.ts";
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
    baseSpeechStyle: DEFAULT_BASE_STYLE_MALE,
  });
  speakerMap.set("HOST_2", {
    speakerId: "HOST_2",
    speakerName: "Вероника",
    baseVoice: "Kore",
    voiceId: "kore",
    gender: "female",
    isCloned: false,
    baseSpeechStyle: DEFAULT_BASE_STYLE_FEMALE,
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
  // 1. SHARED SCENE-SIZED SUB-BLOCKS (20 / 110s) & 1 SUB-BLOCK = 1 HTTP REQUEST
  // =========================================================================
  console.log("=== Test 1A: Shared Sub-Block Limits (20 / 110s) & 1 Sub-Block = 1 Request ===");
  assert.equal(SUB_BLOCK_MAX_TURNS, 20);
  assert.equal(SUB_BLOCK_MAX_SEC, 110);
  assert.equal(DUBBING_MODELS_CONFIG.subBlockMaxTurns, 20);
  assert.equal(DUBBING_MODELS_CONFIG.subBlockMaxSec, 110);

  const clientSubsTiggo = planDialogueSubBlocks(tiggoTurns);
  const serverSubsTiggo = splitTurnsIntoDubbingSubBlocks(tiggoTurns);
  const clientSizes = clientSubsTiggo.map((sb) => sb.turns.length);
  const serverSizes = serverSubsTiggo.map((sb) => sb.length);
  assert.deepEqual(
    clientSizes,
    [16, 17, 11, 13, 7, 15],
    `Tiggo 8 v4 must split into [16, 17, 11, 13, 7, 15], got [${clientSizes.join(", ")}]`
  );
  assert.deepEqual(
    serverSizes,
    clientSizes,
    "Server and browser sub-block sizes must match identically"
  );
  for (let i = 0; i < clientSubsTiggo.length; i++) {
    assert.deepEqual(
      serverSubsTiggo[i].map((t) => t.id),
      clientSubsTiggo[i].turns.map((t) => t.id),
      `Sub-block #${i + 1} turn IDs must match turn-for-turn between browser and server`
    );
  }
  const emptyCachePlan = planSubBlockCacheExecution({
    fullTurns: tiggoTurns,
    projectKey: "test_project",
    getSpeakerVoiceKey: (t) => (t.speakerId === "HOST_1" ? "charon" : "kore"),
    getTurnStyleKey: (t) => t.style || "",
    cachedSubBlocksByKey: new Map(),
  });
  assert.equal(
    emptyCachePlan.requestBatches.length,
    6,
    `1 sub-block = 1 HTTP request -> expected 6 requestBatches, got ${emptyCachePlan.requestBatches.length}`
  );
  assert.ok(
    emptyCachePlan.requestBatches.every((b) => b.subBlocks.length === 1),
    "Every HTTP request batch must contain strictly 1 sub-block"
  );
  console.log("✅ TEST 1A PASSED: Tiggo 8 splits into [16, 17, 11, 13, 7, 15], client===server, 6 HTTP batches.");

  // =========================================================================
  // 1B. BASE STYLE, DELIVERY EMOTIONS, NO PACE DIRECTIVES & <laugh>
  // =========================================================================
  console.log("=== Test 1B: Constant Base Style, Delivery Emotions (Tiggo 8 Scenes 1-2) & <laugh> ===");

  // Legacy dirty input -> stripped, no pace directives
  const cleanSampleStyle = buildCleanTurnStyleForTts(
    {
      cleanSpeechText: "Hammaga salom, bugun yangi avtomobilni ko‘ramiz.",
      startSec: 0,
      endSec: 3.2,
      intonationRu: "Бодро, радостно",
      speakerGender: "male",
      style:
        "Natural male Uzbek speaker (Азиз). Clear warm baritone voice, 100% authentic Uzbek pronunciation. Say the line exactly once, word for word.",
    },
    speakerMap.get("HOST_1"),
    true
  );
  assert.equal(cleanSampleStyle, "warm, relaxed, friendly, energetic, happy");
  assert.ok(!/rapidly|pace/i.test(cleanSampleStyle), `Pace directive forbidden in style: ${cleanSampleStyle}`);

  // When delivery emotions disabled -> base style ONLY, never <laugh>
  const disabledEmotionStyle = buildTurnTtsStyle({
    baseStyle: DEFAULT_BASE_STYLE_FEMALE,
    gender: "female",
    intonationRu: "kulib, taklif qilib",
    useDeliveryEmotions: false,
  }).style;
  assert.equal(disabledEmotionStyle, DEFAULT_BASE_STYLE_FEMALE);
  assert.equal(
    shouldAppendLaughTag({
      textForSyllables: "Hammaga salom!",
      intonationRu: "kulib",
      useDeliveryEmotions: false,
      windowSec: 6,
      gapAfterSec: 1,
    }),
    false,
    "<laugh> must NOT be added when useDeliveryEmotions=false"
  );
  assert.equal(
    shouldAppendLaughTag({
      textForSyllables: "Bu juda uzun jumla bo‘lib vaqt yetmaydi deb hisoblaymiz hammamiz birga.",
      intonationRu: "kulib",
      useDeliveryEmotions: true,
      windowSec: 2.0,
      gapAfterSec: 0,
    }),
    false,
    "<laugh> must NOT be added when free time < 0.5s"
  );

  // Verify exact Tiggo 8 v4 Scenes 1-2 (first 16 turns = sub-block #1)
  const scenes12Turns = clientSubsTiggo[0].turns;
  assert.equal(scenes12Turns.length, 16, "Expected 16 turns in Tiggo 8 Scenes 1-2");

  const expectedScene12Emotions: Record<number, string> = {
    1: "excited, amused",
    2: "amused, inviting",
    4: "smiling",
    6: "doubtful, curious",
    8: "curious",
    16: "pleased, smiling",
  };

  const observedPayloads: Array<{ channel: string; text: string; style: string; speaker?: string }> = [];
  setTtsPayloadObserverForTesting(({ channel, parts }) => {
    for (const p of parts) {
      observedPayloads.push({ channel, text: p.text, style: p.style, speaker: p.speaker });
    }
  });

  const scenes12Result = await synthesizeDialogueInMacroBlocks(trapAi, {
    turns: scenes12Turns,
    speakerMap,
    strictTimeWindow: true,
    bypassCache: true,
    useDeliveryEmotions: true,
    pronunciationDictionary: DEFAULT_PRONUNCIATION_DICTIONARY,
  });
  setTtsPayloadObserverForTesting(null);

  assert.equal(observedPayloads.length, 16);
  for (let i = 0; i < observedPayloads.length; i++) {
    const turnNum = i + 1;
    const p = observedPayloads[i];
    const t = scenes12Turns[i];
    const expectedBase =
      t.speakerId === "HOST_1" ? DEFAULT_BASE_STYLE_MALE : DEFAULT_BASE_STYLE_FEMALE;
    const expectedEmotionSuffix = expectedScene12Emotions[turnNum];
    const expectedFullStyle = expectedEmotionSuffix
      ? `${expectedBase}, ${expectedEmotionSuffix}`
      : expectedBase;

    assert.equal(
      p.style,
      expectedFullStyle,
      `Turn #${turnNum} (${t.intonationRu}) style mismatch: expected "${expectedFullStyle}", got "${p.style}"`
    );
    assert.ok(!/rapidly|pace/i.test(p.style), `Forbidden pace directive in style: ${p.style}`);
    assert.ok(!/short\s+pause/i.test(p.text), `Found <short pause> in text: ${p.text}`);
    assert.ok(
      !/^\s*Speaker(?:One|Two)\s*:/i.test(p.text),
      `FORBIDDEN SpeakerOne:/SpeakerTwo: prefix in text: ${p.text}`
    );
    assert.ok(!/distinct\s+pause|Say\s+the\s+line|baritone|100%\s*authentic|Natural\s+(?:male|female)|Азиз|Вероника/i.test(p.style));

    const hasLaugh = p.text.includes("<laugh>");
    if (turnNum === 1 || turnNum === 2) {
      assert.equal(hasLaugh, true, `Turn #${turnNum} must end with <laugh>, got: ${p.text}`);
      assert.ok(p.text.endsWith("<laugh>"), `Turn #${turnNum} <laugh> must be at the end: ${p.text}`);
    } else {
      assert.equal(hasLaugh, false, `Turn #${turnNum} must NOT have <laugh>, got: ${p.text}`);
    }
  }
  // Check Hybrid -> gibrid happened in TTS payload for the turn containing 'Hybrid', while returned turn.text kept original Hybrid
  const hybridIdx = scenes12Turns.findIndex((t) => /\bHybrid\b/i.test(t.text));
  assert.ok(hybridIdx >= 0, "Expected at least one turn in Tiggo 8 Scenes 1-2 to contain 'Hybrid'");
  assert.ok(
    /\bgibrid\b/i.test(observedPayloads[hybridIdx].text) &&
      !/\bHybrid\b/i.test(observedPayloads[hybridIdx].text),
    `Turn #${hybridIdx + 1} TTS text must replace Hybrid -> gibrid, got: ${observedPayloads[hybridIdx].text}`
  );
  assert.ok(
    /\bHybrid\b/.test(scenes12Result.turns[hybridIdx].text),
    `Returned turn #${hybridIdx + 1} script text must preserve original 'Hybrid', got: ${scenes12Result.turns[hybridIdx].text}`
  );
  console.log("✅ TEST 1B PASSED: Scenes 1-2 styles, <laugh> only on #01/#02, zero pace directives verified.");

  // =========================================================================
  // 1C. PRONUNCIATION DICTIONARY SAFETY, NON-DESTRUCTIVE EXPORT & CACHE INVALIDATION
  // =========================================================================
  console.log("=== Test 1C: Pronunciation Dictionary Safety, Export Preservation & Cache Key Invalidation ===");

  // Whole-word, case-insensitive, Uzbek apostrophes are word chars, skips <...> tags
  assert.equal(
    applyPronunciationDictionary("Tiggo 8 Hybrid va HYBRID-auto, lekin Hybridlik emas <laugh>", [
      { word: "Hybrid", pronunciation: "gibrid" },
      { word: "laugh", pronunciation: "kulgi" },
    ]),
    "Tiggo 8 gibrid va gibrid-auto, lekin Hybridlik emas <laugh>"
  );
  assert.equal(
    applyPronunciationDictionary("Oʻzbekiston va O'zbekiston hamda o‘z", [
      { word: "o", pronunciation: "ZERO" },
      { word: "zbekiston", pronunciation: "BAD" },
    ]),
    "Oʻzbekiston va O'zbekiston hamda o‘z",
    "Uzbek apostrophe word chars must NOT split words for whole-word dictionary matching"
  );

  // Subtitles / CSV / JSON export preserve original "Hybrid" text
  const rawHybridTurn = scenes12Turns[hybridIdx].rawTurn;
  assert.ok(rawHybridTurn.text.includes("Hybrid"), `Fixture turn #${hybridIdx + 1} should contain Hybrid`);
  const exportedCsv = exportTurnsToCsv([rawHybridTurn]);
  assert.ok(exportedCsv.includes("Hybrid"), "CSV export must preserve original 'Hybrid'");
  const exportedJson = exportTurnsToJson([rawHybridTurn], undefined, undefined, {
    useDeliveryEmotions: true,
    pronunciationDictionary: DEFAULT_PRONUNCIATION_DICTIONARY,
  });
  const parsedExported = parseReadyScript(exportedJson);
  assert.equal(parsedExported.ok, true);
  assert.ok(parsedExported.turns[0].text.includes("Hybrid"), "JSON round-trip must preserve 'Hybrid'");
  assert.equal(parsedExported.useDeliveryEmotions, true);
  assert.deepEqual(parsedExported.pronunciationDictionary, DEFAULT_PRONUNCIATION_DICTIONARY);

  // Dictionary change invalidates BOTH client and server cache keys
  const clientHashDictA = computeSubBlockClientHash({
    subBlockTurns: scenes12Turns,
    getSpeakerVoiceKey: (t) => (t.speakerId === "HOST_1" ? "charon" : "kore"),
    getTurnStyleKey: (t) => t.style || "",
    getTurnTtsText: (t) =>
      prepareTurnTextForTts({
        rawText: t.text,
        intonationRu: t.intonationRu,
        useDeliveryEmotions: true,
        pronunciationDictionary: [{ word: "Hybrid", pronunciation: "gibrid" }],
        windowSec: (t.endSec || 2) - (t.startSec || 0),
        gapAfterSec: t.gapAfterSec || 0,
      }).ttsText,
    ttsModel: DEFAULT_DUBBING_TTS_MODEL,
  });
  const clientHashDictB = computeSubBlockClientHash({
    subBlockTurns: scenes12Turns,
    getSpeakerVoiceKey: (t) => (t.speakerId === "HOST_1" ? "charon" : "kore"),
    getTurnStyleKey: (t) => t.style || "",
    getTurnTtsText: (t) =>
      prepareTurnTextForTts({
        rawText: t.text,
        intonationRu: t.intonationRu,
        useDeliveryEmotions: true,
        pronunciationDictionary: [{ word: "Hybrid", pronunciation: "xibrid" }],
        windowSec: (t.endSec || 2) - (t.startSec || 0),
        gapAfterSec: t.gapAfterSec || 0,
      }).ttsText,
    ttsModel: DEFAULT_DUBBING_TTS_MODEL,
  });
  assert.notEqual(
    clientHashDictA,
    clientHashDictB,
    "Changing pronunciation dictionary MUST invalidate client sub-block cache hash"
  );

  const serverTurnsDictA = scenes12Turns.map((t) => ({
    ...t,
    cleanSpeechText: applyPronunciationDictionary(t.text, [{ word: "Hybrid", pronunciation: "gibrid" }]),
  }));
  const serverTurnsDictB = scenes12Turns.map((t) => ({
    ...t,
    cleanSpeechText: applyPronunciationDictionary(t.text, [{ word: "Hybrid", pronunciation: "xibrid" }]),
  }));
  assert.notEqual(
    computeSubBlockCacheHash(serverTurnsDictA, speakerMap, "A"),
    computeSubBlockCacheHash(serverTurnsDictB, speakerMap, "A"),
    "Changing pronunciation dictionary MUST invalidate server sub-block cache hash"
  );
  console.log("✅ TEST 1C PASSED: Pronunciation dictionary whole-word/apostrophe/tag safety, export preservation & cache invalidation verified.");

  // =========================================================================
  // 1D. BS.1770-4 LOUDNESS LEVELING & FFMPEG EBUR128 CROSS-CHECK
  // =========================================================================
  console.log("=== Test 1D: BS.1770-4 Loudness Leveling (-18 / -21 LUFS, <= -1 dBFS, <1s median, ffmpeg ebur128) ===");

  const makeSinePcmAtDbfs = (durationSec: number, peakDbfs: number, freqHz = 440): Buffer => {
    const sampleRate = 24000;
    const totalSamples = Math.round(durationSec * sampleRate);
    const amp = Math.min(0.999, Math.pow(10, peakDbfs / 20)) * 32767;
    const buf = Buffer.alloc(totalSamples * 2);
    for (let i = 0; i < totalSamples; i++) {
      const s = Math.round(Math.sin((2 * Math.PI * freqHz * i) / sampleRate) * amp);
      buf.writeInt16LE(Math.max(-32768, Math.min(32767, s)), i * 2);
    }
    return buf;
  };

  // Multi-tone speech-like synthetic clips from ~-30 LUFS up to ~-10 LUFS + a quietly clip + a <1.0s short clip
  const rawLevelClips = [
    { speaker: "HOST_1", style: "warm, relaxed, friendly", pcm: makeSinePcmAtDbfs(2.5, -27, 300) },
    { speaker: "HOST_1", style: "warm, relaxed, friendly", pcm: makeSinePcmAtDbfs(2.5, -18, 340) },
    { speaker: "HOST_1", style: "warm, relaxed, friendly", pcm: makeSinePcmAtDbfs(2.5, -7, 380) },
    { speaker: "HOST_1", style: "warm, relaxed, friendly", pcm: makeSinePcmAtDbfs(0.55, -26, 320) }, // < 1.0s short clip!
    { speaker: "HOST_2", style: "lively, casual, friendly, quietly", pcm: makeSinePcmAtDbfs(2.5, -12, 420) },
    { speaker: "HOST_2", style: "lively, casual, friendly", pcm: makeSinePcmAtDbfs(2.5, -25, 450) },
  ];

  const leveled = levelSubBlockClipsLoudness(rawLevelClips);
  assert.equal(leveled.length, rawLevelClips.length);

  for (const idx of [0, 1, 2, 5]) {
    const res = leveled[idx];
    assert.ok(
      res.lufsAfter !== null && Math.abs(res.lufsAfter - -18.0) <= 0.5,
      `Clip #${idx} expected -18.0 ± 0.5 LUFS, got ${res.lufsAfter} (before=${res.lufsBefore})`
    );
    assert.ok(
      res.peakAfterDbfs !== null && res.peakAfterDbfs <= -0.95,
      `Clip #${idx} peak must be <= -1.0 dBFS, got ${res.peakAfterDbfs}`
    );
  }
  // Quietly clip -> -21 LUFS
  assert.ok(
    leveled[4].lufsAfter !== null && Math.abs(leveled[4].lufsAfter - -21.0) <= 0.5,
    `Quietly clip expected -21.0 ± 0.5 LUFS, got ${leveled[4].lufsAfter}`
  );
  // Short clip (< 1.0s) used speaker median gain
  assert.equal(leveled[3].usedMedianGain, true, "Short <1.0s clip must use speaker median gain");
  const expectedMedianGain = leveled[1].gainDb; // median of [gain(clip0), gain(clip1), gain(clip2)]
  assert.ok(
    Math.abs(leveled[3].gainDb - expectedMedianGain) <= 0.25,
    `Short clip gain (${leveled[3].gainDb}) should match HOST_1 median gain (${expectedMedianGain})`
  );

  // Cross-check clip #0 LUFS against real ffmpeg ebur128!
  const tmpWav = path.join(os.tmpdir(), `ovoz-lufs-check-${Date.now()}.wav`);
  try {
    fs.writeFileSync(tmpWav, buildWav24k(leveled[0].pcm));
    const { spawnSync } = await import("node:child_process");
    const sp = spawnSync("ffmpeg", ["-nostats", "-i", tmpWav, "-af", "ebur128", "-f", "null", "-"], {
      encoding: "utf8",
    });
    assert.equal(sp.status, 0, `ffmpeg ebur128 failed (code ${sp.status}): ${sp.stderr}`);
    const ffmpegOutput = `${sp.stdout || ""}\n${sp.stderr || ""}`;
    const iMatch = ffmpegOutput.match(/Integrated loudness:[\s\S]*?I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/i);
    assert.ok(iMatch, `Could not parse Integrated LUFS from ffmpeg ebur128 output:\n${ffmpegOutput.slice(-400)}`);
    const ffmpegLufs = parseFloat(iMatch[1]);
    const ourLufs = measureIntegratedLufsPcm(leveled[0].pcm, 24000);
    const peakCheck = measurePeakDbfsPcm(leveled[0].pcm);
    assert.ok(
      Math.abs(ffmpegLufs - -18.0) <= 0.6 && Math.abs(ffmpegLufs - ourLufs) <= 0.5,
      `ffmpeg ebur128 (${ffmpegLufs} LUFS) vs our BS.1770 (${ourLufs} LUFS) drifted beyond tolerance!`
    );
    assert.ok(peakCheck <= -0.95, `Peak exceeded -1.0 dBFS: ${peakCheck}`);
    console.log(
      `  ✓ ffmpeg ebur128 cross-check: ours=${ourLufs.toFixed(2)} LUFS, ffmpeg=${ffmpegLufs.toFixed(2)} LUFS, peak=${peakCheck.toFixed(2)} dBFS`
    );
  } finally {
    if (fs.existsSync(tmpWav)) fs.unlinkSync(tmpWav);
  }
  console.log("✅ TEST 1D PASSED: BS.1770-4 loudness leveling (-18/-21 LUFS, limiter, <1s median, ffmpeg verified).");

  // =========================================================================
  // 1E. SINGLE-TURN REGEN IN MODE A CONTEXT ([prev, target, next])
  // =========================================================================
  console.log("=== Test 1E: Single-Turn Context Regeneration in Mode A ===");
  const singleCtxObserved: Array<{ channel: string; count: number }> = [];
  setTtsPayloadObserverForTesting(({ channel, parts }) => {
    singleCtxObserved.push({ channel, count: parts.length });
  });
  const singleCtxRes = await synthesizeSingleTurnInModeAContext(trapAi, {
    contextTurns: [scenes12Turns[0], scenes12Turns[1], scenes12Turns[2]],
    targetIndex: 1,
    speakerMap,
    strictTimeWindow: true,
    useDeliveryEmotions: true,
    pronunciationDictionary: DEFAULT_PRONUNCIATION_DICTIONARY,
  });
  setTtsPayloadObserverForTesting(null);
  assert.equal(singleCtxRes.turn.generationMode, "mode_a", "Single-turn regen with built-in voices must run in Mode A");
  assert.equal(singleCtxRes.turn.id, scenes12Turns[1].id, "Must return ONLY the target turn");
  assert.equal(singleCtxRes.provider, "fake", "Fake mode must not make real API calls");
  assert.equal(singleCtxObserved.length, 1, "Must synthesize [prev, target, next] in a single Mode A TTS call");
  assert.equal(singleCtxObserved[0].channel, "google_mode_a");
  assert.equal(singleCtxObserved[0].count, 3, "Mode A context call must include all 3 turns [prev, target, next]");
  assert.ok(singleCtxRes.turn.wavBase64 && singleCtxRes.turn.wavBase64.length > 64);
  console.log("✅ TEST 1E PASSED: Single-turn context regen uses Mode A [prev, target, next] and returns target clip.");

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

  // All sub-blocks of Tiggo 8 (6 sub-blocks) fail QA; extra TTS calls MUST NOT exceed floor(subBlocks * 0.25)
  const expectedSubBlockCount = planDialogueSubBlocks(tiggoTurns).length;
  const expectedBudget = Math.floor(expectedSubBlockCount * 0.25);
  assert.ok(expectedBudget >= 1, `Expected >=1 retry budget for Tiggo 8, got ${expectedBudget}`);

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

  const preparedOneMixedSub = oneMixedSub.map((t) => {
    const startSec = typeof t.startSec === "number" ? t.startSec : 0;
    const endSec = typeof t.endSec === "number" ? t.endSec : startSec + 2;
    const prepared = prepareTurnTextForTts({
      rawText: t.text,
      pronunciationDictionary: DEFAULT_PRONUNCIATION_DICTIONARY,
      intonationRu: t.intonationRu,
      useDeliveryEmotions: true,
      windowSec: Math.max(0.4, endSec - startSec),
      gapAfterSec: t.gapAfterSec ?? 0,
    });
    return { ...t, cleanSpeechText: prepared.ttsText };
  });
  const expectedServerHash = computeSubBlockCacheHash(preparedOneMixedSub, speakerMap, "A");
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
    pronunciationDictionary: DEFAULT_PRONUNCIATION_DICTIONARY,
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
    pronunciationDictionary: DEFAULT_PRONUNCIATION_DICTIONARY,
  });
  assert.equal(v3Hit.provider, "cache", "Second run with same voices must hit v3 disk cache");

  // Changing ONE speaker voice on server misses v3 cache & re-synthesizes BOTH speakers whole
  const speakerMapChanged = makeDefaultSpeakerMap();
  speakerMapChanged.set("HOST_2", {
    ...speakerMapChanged.get("HOST_2")!,
    baseVoice: "Aoede",
    voiceId: "aoede",
  });
  const serverHashChanged = computeSubBlockCacheHash(preparedOneMixedSub, speakerMapChanged, "A");
  assert.notEqual(expectedServerHash, serverHashChanged, "Server hash must change when one speaker voice changes");

  const reSynthBoth = await synthesizeDialogueInMacroBlocks(trapAi, {
    turns: oneMixedSub,
    speakerMap: speakerMapChanged,
    strictTimeWindow: true,
    bypassCache: false,
    pronunciationDictionary: DEFAULT_PRONUNCIATION_DICTIONARY,
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
