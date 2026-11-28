/**
 * Stage 2 Voice Lock Comprehensive Automated Test Suite (DUBBING_FAKE_TTS=1).
 *
 * Tests against the REAL Tiggo 8 fixture (`scripts/fixtures/01_tiggo_8_hybrid_uz_dublyaj_v4.txt`):
 *  1. Exact 2 TTS calls on full Tiggo 8 (79 turns).
 *  2. Aziz gets 37 turns in 1 call; Veronika gets 42 turns in 1 call.
 *  3. Exact `voice_din40bswsfcy` & `voice_jobdfz42xizz` via `{ voice: ... }` — zero Charon/Kore substitution.
 *  4. Prompted voices NEVER enter `multiSpeakerVoiceConfig` (both Voice Lock and standard engine).
 *  5. Safe emotions: neutral => `""`, emotional => max 1 from 11-row table, zero forbidden words,
 *     `softly` leveled to -21 LUFS, regular to -18 LUFS, true peak <= -1.0 dBFS.
 *  6. Original interleaved order (79 turns) preserved accurately.
 *  7. Changing `voiceId` or `identityVersion` invalidates Voice Lock cache; repeat run hits cache (0 TTS calls).
 *  8. Old sub-block cache (`data/dubbing-block-cache/`) is NEVER modified or written by Voice Lock.
 *  9. One speaker failure isolates ONLY that speaker (marks its turns failed, keeps other speaker intact, 0 voice swap).
 * 10. Expired/missing stored voice throws explicit error BEFORE TTS (0 TTS calls, no fallback).
 * 11. Pre-flight guard rejects > 600s or > 7500 tokens per speaker (0 TTS calls).
 * 12. `kie.ai` is NEVER invoked.
 * 13. Identity QA failure marks `identityQaPassed=false`, `overallSuccess=false`, with ZERO auto-retry.
 */

import assert from "assert";
import fs from "fs";
import path from "path";
import { parseReadyScript } from "../src/utils/readyScriptParser.ts";
import {
  AZIZ_VOICE_LOCK_M2,
  VERONIKA_VOICE_LOCK_F1,
} from "../src/data/voices.ts";
import {
  VOICE_LOCK_ALLOWED_STYLES,
  extractVoiceLockSafeEmotion,
} from "../src/utils/dubbingStyle.ts";
import {
  DEFAULT_PRONUNCIATION_DICTIONARY,
} from "../src/utils/pronunciationDictionary.ts";
import {
  type BatchInputTurn,
  type ResolvedBatchSpeaker,
  type TtsPayloadObservation,
  buildSingleSpeakerVoiceConfig,
  setTtsPayloadObserverForTesting,
  setFakeStoredVoiceValidatorForTesting,
  synthesizeDialogueInMacroBlocks,
} from "../server/services/dubbing/batchDialogueEngine.ts";
import {
  VOICE_LOCK_CACHE_DIR,
  computeVoiceLockSpeakerCacheHash,
  setVoiceLockFakeFaultInjectorForTesting,
  synthesizeDialogueInVoiceLockMode,
} from "../server/services/dubbing/voiceLockEngine.ts";

process.env.DUBBING_FAKE_TTS = "1";

const FIXTURE_PATH = path.resolve(
  process.cwd(),
  "scripts",
  "fixtures",
  "01_tiggo_8_hybrid_uz_dublyaj_v4.txt"
);
const SUB_BLOCK_CACHE_DIR = path.resolve(process.cwd(), "data", "dubbing-block-cache");

const FORBIDDEN_STYLE_REGEX =
  /\b(authoritative|confident|news|narrator|deep|serious|professional|dramatic|warm\s+resonant|commanding|excited\s+energetic)\b/i;

function loadTiggo8Fixture(): {
  turns: BatchInputTurn[];
  speakerMap: Map<string, ResolvedBatchSpeaker>;
  azizSpeakerId: string;
  veronikaSpeakerId: string;
} {
  const raw = fs.readFileSync(FIXTURE_PATH, "utf-8");
  const parsed = parseReadyScript(raw);
  assert.strictEqual(parsed.errors.length, 0, `Fixture parse errors: ${JSON.stringify(parsed.errors)}`);
  assert.strictEqual(parsed.turns.length, 79, `Expected 79 turns in Tiggo 8 fixture, got ${parsed.turns.length}`);

  const totalDur = Math.max(...parsed.turns.map((t) => Number(t.endSec) || 0));
  const turns: BatchInputTurn[] = parsed.turns.map((t, idx) => {
    const nextStartSec =
      idx + 1 < parsed.turns.length && typeof parsed.turns[idx + 1]?.startSec === "number"
        ? parsed.turns[idx + 1].startSec!
        : totalDur;
    const gapAfterSec = Math.max(0, Math.round((nextStartSec - (t.endSec || 0)) * 100) / 100);
    return {
      index: idx,
      id: t.id,
      speakerId: t.speakerId,
      speakerName: t.speakerName,
      speakerGender: t.speakerGender,
      text: t.text,
      cleanSpeechText: t.text,
      style: "",
      originalTextRu: t.originalTextRu,
      intonationRu: t.intonationRu,
      startSec: t.startSec,
      endSec: t.endSec,
      gapAfterSec,
      nextTurnStartSec: nextStartSec,
      rawTurn: t,
    };
  });

  // Identify Aziz (male) & Veronika (female) speakerIds dynamically
  const azizTurn = turns.find((t) => t.speakerGender === "male" || /азиз|aziz/i.test(t.speakerName || ""));
  const veronikaTurn = turns.find(
    (t) => t.speakerGender === "female" || /вероник|veronik/i.test(t.speakerName || "")
  );
  assert(azizTurn && veronikaTurn, "Could not identify Aziz and Veronika in Tiggo 8 fixture");

  const speakerMap = new Map<string, ResolvedBatchSpeaker>();
  speakerMap.set(azizTurn.speakerId, {
    speakerId: azizTurn.speakerId,
    speakerName: azizTurn.speakerName || "Азиз",
    gender: "male",
    voiceType: "prompted",
    voiceId: AZIZ_VOICE_LOCK_M2.voiceId!,
    identityVersion: AZIZ_VOICE_LOCK_M2.identityVersion!,
    baseVoice: "Charon",
    isCloned: false,
    baseSpeechStyle: "",
  });
  speakerMap.set(veronikaTurn.speakerId, {
    speakerId: veronikaTurn.speakerId,
    speakerName: veronikaTurn.speakerName || "Вероника",
    gender: "female",
    voiceType: "prompted",
    voiceId: VERONIKA_VOICE_LOCK_F1.voiceId!,
    identityVersion: VERONIKA_VOICE_LOCK_F1.identityVersion!,
    baseVoice: "Kore",
    isCloned: false,
    baseSpeechStyle: "",
  });

  return {
    turns,
    speakerMap,
    azizSpeakerId: azizTurn.speakerId,
    veronikaSpeakerId: veronikaTurn.speakerId,
  };
}

function snapshotDir(dirPath: string): Map<string, number> {
  const snap = new Map<string, number>();
  if (!fs.existsSync(dirPath)) return snap;
  for (const name of fs.readdirSync(dirPath)) {
    const st = fs.statSync(path.join(dirPath, name));
    snap.set(name, st.mtimeMs);
  }
  return snap;
}

const dummyAi = {} as any;

async function main() {
  const createdCacheFiles = new Set<string>();
  const cacheBeforeAll = snapshotDir(VOICE_LOCK_CACHE_DIR);
  const subBlockCacheBefore = snapshotDir(SUB_BLOCK_CACHE_DIR);

  try {
    const { turns, speakerMap, azizSpeakerId, veronikaSpeakerId } = loadTiggo8Fixture();

    const azizCount = turns.filter((t) => t.speakerId === azizSpeakerId).length;
    const veronikaCount = turns.filter((t) => t.speakerId === veronikaSpeakerId).length;
    assert.strictEqual(azizCount, 37, `Expected 37 Aziz turns, got ${azizCount}`);
    assert.strictEqual(veronikaCount, 42, `Expected 42 Veronika turns, got ${veronikaCount}`);
    console.log("✔ Fixture verified: 79 turns (Aziz=37, Veronika=42)");

    // -----------------------------------------------------------------------
    // TEST 1–6 & 8 & 12: Full Tiggo 8 Voice Lock run (bypassCache: true)
    // -----------------------------------------------------------------------
    const observations: TtsPayloadObservation[] = [];
    setTtsPayloadObserverForTesting((obs) => observations.push(obs));

    const res = await synthesizeDialogueInVoiceLockMode(dummyAi, {
      turns,
      speakerMap,
      strictTimeWindow: true,
      useDeliveryEmotions: true,
      pronunciationDictionary: DEFAULT_PRONUNCIATION_DICTIONARY,
      bypassCache: true,
    });

    assert.strictEqual(res.voiceLockMode, "full_speaker_tracks");
    assert.strictEqual(res.overallSuccess, true, "Full Tiggo 8 Voice Lock run should succeed");
    assert.strictEqual(res.identityQaPassed, true, "Identity QA should pass in clean fake run");
    assert.strictEqual(res.ttsCallsUsed, 2, `Expected exact 2 TTS calls, got ${res.ttsCallsUsed}`);
    assert.strictEqual(observations.length, 2, `Expected 2 observed TTS payloads, got ${observations.length}`);

    // Verify exact channel, NO multiSpeakerVoiceConfig, NO kie.ai, exact voice IDs
    for (const obs of observations) {
      assert.strictEqual(obs.channel, "google_voice_lock", `Unexpected channel: ${obs.channel}`);
      assert.strictEqual(obs.usedMultiSpeaker, false, "Voice Lock MUST NEVER use multiSpeakerVoiceConfig");
      assert.ok(
        obs.voiceConfig && typeof obs.voiceConfig.voice === "string",
        `Expected voiceConfig.voice, got ${JSON.stringify(obs.voiceConfig)}`
      );
      assert.strictEqual(
        obs.voiceConfig.prebuiltVoiceConfig,
        undefined,
        "MUST NEVER pass prebuiltVoiceConfig for persistent Voice Remix voices"
      );
      assert.ok(
        obs.voiceConfig.voice === "voice_din40bswsfcy" ||
          obs.voiceConfig.voice === "voice_jobdfz42xizz",
        `Unexpected voice ID sent: ${obs.voiceConfig.voice}`
      );
      // Verify speechMetadata has NO `speaker` field and obeys safe emotions strictly
      for (const part of obs.parts) {
        assert.strictEqual(
          part.speaker,
          undefined,
          "Voice Lock single-speaker request MUST NOT send speechMetadata.speaker"
        );
        const st = String(part.style ?? "");
        assert.ok(
          st === "" || VOICE_LOCK_ALLOWED_STYLES.has(st),
          `Disallowed Voice Lock style sent: "${st}"`
        );
        assert.ok(
          !FORBIDDEN_STYLE_REGEX.test(st),
          `Forbidden word leaked into Voice Lock style: "${st}"`
        );
      }
    }

    const azizObs = observations.find((o) => o.voiceId === "voice_din40bswsfcy");
    const veronikaObs = observations.find((o) => o.voiceId === "voice_jobdfz42xizz");
    assert(azizObs && veronikaObs, "Both Aziz M2 and Veronika F1 payloads must be observed");
    assert.strictEqual(azizObs.parts.length, 37, `Aziz must send 37 parts in 1 call, got ${azizObs.parts.length}`);
    assert.strictEqual(
      veronikaObs.parts.length,
      42,
      `Veronika must send 42 parts in 1 call, got ${veronikaObs.parts.length}`
    );
    assert.strictEqual(azizObs.identityVersion, "aziz-m2-v1");
    assert.strictEqual(veronikaObs.identityVersion, "veronika-f1-v1");
    assert.strictEqual(azizObs.voiceType, "prompted");
    assert.strictEqual(veronikaObs.voiceType, "prompted");

    // Verify neutral emotion maps to "" and all 11 safe Uzbek delivery mappings
    assert.strictEqual(extractVoiceLockSafeEmotion("Спокойно, уверенно, без пафоса"), "");
    assert.strictEqual(extractVoiceLockSafeEmotion("Tinch, xotirjam, ishonch bilan"), "");
    assert.strictEqual(extractVoiceLockSafeEmotion("Azart bilan, hayajon"), "lightly excited");
    assert.strictEqual(extractVoiceLockSafeEmotion("Kulib, hazil bilan"), "gently amused");
    assert.strictEqual(extractVoiceLockSafeEmotion("Tabassum bilan"), "smiling");
    assert.strictEqual(extractVoiceLockSafeEmotion("Qiziqib so'raydi"), "slightly curious");
    assert.strictEqual(extractVoiceLockSafeEmotion("Mamnun, xursand"), "pleased");
    assert.strictEqual(extractVoiceLockSafeEmotion("Shubha bilan"), "slightly doubtful");
    assert.strictEqual(extractVoiceLockSafeEmotion("Biroz xavotir bilan"), "slightly concerned");
    assert.strictEqual(extractVoiceLockSafeEmotion("Hayrat bilan"), "pleasantly surprised");
    assert.strictEqual(extractVoiceLockSafeEmotion("Tinchlantirib"), "gently reassuring");
    assert.strictEqual(extractVoiceLockSafeEmotion("Iliq ohangda"), "warmly");
    assert.strictEqual(extractVoiceLockSafeEmotion("Ohista, past ovozda"), "softly");
    assert.strictEqual(extractVoiceLockSafeEmotion("Ohista, past ovozda", false), "");

    // Verify original interleaved order of all 79 turns & loudness / true peak bounds
    assert.strictEqual(res.turns.length, 79, "Must restore all 79 turns");
    let checkedSoftly = 0;
    let checkedRegular = 0;
    for (let i = 0; i < turns.length; i++) {
      const orig = turns[i];
      const out = res.turns[i];
      assert.strictEqual(out.id, orig.id, `Turn order mismatch at index ${i}`);
      assert.strictEqual(out.speakerId, orig.speakerId, `Speaker mismatch at index ${i}`);
      assert.strictEqual(out.generationMode, "voice_lock", `Expected generationMode='voice_lock' at index ${i}`);
      assert.strictEqual(out.qa, "ok", `Turn ${out.id} QA should be ok, got ${out.qa} (${out.qaReason})`);
      assert(out.wavBase64 && out.wavBase64.length > 44, `Turn ${out.id} missing wavBase64`);
    }

    for (const tr of res.speakerTracks) {
      for (const td of tr.turnDetails) {
        if (td.truePeakAfterDbfs !== null) {
          assert.ok(
            td.truePeakAfterDbfs <= -0.95,
            `True peak exceeded -1.0 dBFS on ${td.turnId}: ${td.truePeakAfterDbfs} dBFS`
          );
        }
        if (td.lufsAfter !== null) {
          if (td.sentStyle === "softly") {
            checkedSoftly++;
            assert.ok(
              td.lufsAfter <= -19.5 && td.lufsAfter >= -23.0,
              `Softly turn ${td.turnId} should be leveled near -21 LUFS, got ${td.lufsAfter}`
            );
          } else {
            checkedRegular++;
            assert.ok(
              td.lufsAfter <= -16.5 && td.lufsAfter >= -19.8,
              `Regular turn ${td.turnId} should be leveled near -18 LUFS, got ${td.lufsAfter}`
            );
          }
        }
      }
    }
    assert.ok(checkedRegular > 50, `Expected >50 leveled regular turns, got ${checkedRegular}`);
    console.log(
      `✔ Tests 1–6 passed: 2 TTS calls (Aziz=37, Veronika=42), exact voice IDs, safe emotions, order restored, LUFS/TP verified (regular=${checkedRegular}, softly=${checkedSoftly})`
    );

    // -----------------------------------------------------------------------
    // TEST 4b: Prompted voices NEVER enter multiSpeakerVoiceConfig in standard engine either
    // -----------------------------------------------------------------------
    const stdObs: TtsPayloadObservation[] = [];
    setTtsPayloadObserverForTesting((obs) => stdObs.push(obs));
    const miniTurns = turns.slice(0, 4);
    await synthesizeDialogueInMacroBlocks(dummyAi, {
      turns: miniTurns,
      speakerMap,
      strictTimeWindow: true,
      bypassCache: true,
    });
    assert.ok(stdObs.length >= 2, "Standard engine should split prompted voices into single-speaker Mode B calls");
    for (const o of stdObs) {
      assert.strictEqual(
        o.usedMultiSpeaker,
        false,
        "Prompted voice MUST NEVER enter multiSpeakerVoiceConfig even in standard engine!"
      );
      assert.ok(
        !/kie/i.test(o.channel),
        `kie.ai must NEVER be called for prompted voices (got ${o.channel})`
      );
    }
    // Verify buildSingleSpeakerVoiceConfig throws on invalid voiceId instead of falling back to Charon/Kore
    assert.throws(
      () =>
        buildSingleSpeakerVoiceConfig({
          speakerId: "HOST_1",
          speakerName: "Bad",
          voiceType: "prompted",
          voiceId: "not_a_voice_id",
          baseVoice: "Charon",
          baseSpeechStyle: "",
          isCloned: false,
        }),
      /voice_/,
      "buildSingleSpeakerVoiceConfig must throw explicit error instead of falling back to Charon/Kore"
    );
    console.log("✔ Test 4b passed: prompted voices never enter multiSpeakerVoiceConfig or fallback to Charon/Kore");

    // -----------------------------------------------------------------------
    // TEST 7: Voice Lock cache hit (0 TTS calls) & invalidation on voiceId / identityVersion change
    // -----------------------------------------------------------------------
    const cacheObs1: TtsPayloadObservation[] = [];
    setTtsPayloadObserverForTesting((obs) => cacheObs1.push(obs));
    const cachedRun1 = await synthesizeDialogueInVoiceLockMode(dummyAi, {
      turns,
      speakerMap,
      strictTimeWindow: true,
      useDeliveryEmotions: true,
      pronunciationDictionary: DEFAULT_PRONUNCIATION_DICTIONARY,
      bypassCache: false,
    });
    assert.strictEqual(cachedRun1.ttsCallsUsed, 2, "First non-bypass run should populate Voice Lock cache (2 TTS calls)");

    const cacheObs2: TtsPayloadObservation[] = [];
    setTtsPayloadObserverForTesting((obs) => cacheObs2.push(obs));
    const cachedRun2 = await synthesizeDialogueInVoiceLockMode(dummyAi, {
      turns,
      speakerMap,
      strictTimeWindow: true,
      useDeliveryEmotions: true,
      pronunciationDictionary: DEFAULT_PRONUNCIATION_DICTIONARY,
      bypassCache: false,
    });
    assert.strictEqual(cachedRun2.ttsCallsUsed, 0, `Second identical run must hit Voice Lock cache (0 TTS calls), got ${cachedRun2.ttsCallsUsed}`);
    assert.strictEqual(cacheObs2.length, 0);
    assert.ok(cachedRun2.speakerTracks.every((t) => t.fromCache), "All speaker tracks should be served from cache");

    // Cache key sensitivity check: voiceId & identityVersion
    const azizSp = speakerMap.get(azizSpeakerId)!;
    const hBase = computeVoiceLockSpeakerCacheHash({
      voiceId: azizSp.voiceId!,
      voiceType: azizSp.voiceType!,
      identityVersion: azizSp.identityVersion || "aziz-m2-v1",
      model: "gemini-3.8-flash-tts",
      parts: [{ turnId: "t1", text: "Salom", style: "" }],
      pronunciationDictionary: DEFAULT_PRONUNCIATION_DICTIONARY,
    });
    const hDiffVoice = computeVoiceLockSpeakerCacheHash({
      voiceId: "voice_other123456",
      voiceType: azizSp.voiceType!,
      identityVersion: azizSp.identityVersion || "aziz-m2-v1",
      model: "gemini-3.8-flash-tts",
      parts: [{ turnId: "t1", text: "Salom", style: "" }],
      pronunciationDictionary: DEFAULT_PRONUNCIATION_DICTIONARY,
    });
    const hDiffVer = computeVoiceLockSpeakerCacheHash({
      voiceId: azizSp.voiceId!,
      voiceType: azizSp.voiceType!,
      identityVersion: "aziz-m2-v2",
      model: "gemini-3.8-flash-tts",
      parts: [{ turnId: "t1", text: "Salom", style: "" }],
      pronunciationDictionary: DEFAULT_PRONUNCIATION_DICTIONARY,
    });
    assert.notStrictEqual(hBase, hDiffVoice, "Changing voiceId MUST invalidate Voice Lock cache key");
    assert.notStrictEqual(hBase, hDiffVer, "Changing identityVersion MUST invalidate Voice Lock cache key");

    // Change identityVersion on Aziz only -> only Aziz re-runs (1 TTS call), Veronika hits cache!
    const bumpedMap = new Map(speakerMap);
    bumpedMap.set(azizSpeakerId, { ...azizSp, identityVersion: "aziz-m2-v2" });
    const cacheObs3: TtsPayloadObservation[] = [];
    setTtsPayloadObserverForTesting((obs) => cacheObs3.push(obs));
    const bumpedRun = await synthesizeDialogueInVoiceLockMode(dummyAi, {
      turns,
      speakerMap: bumpedMap,
      strictTimeWindow: true,
      useDeliveryEmotions: true,
      pronunciationDictionary: DEFAULT_PRONUNCIATION_DICTIONARY,
      bypassCache: false,
    });
    assert.strictEqual(bumpedRun.ttsCallsUsed, 1, "Bumping Aziz identityVersion should run ONLY Aziz (1 TTS call)");
    assert.strictEqual(cacheObs3[0].voiceId, "voice_din40bswsfcy");
    console.log("✔ Test 7 passed: Voice Lock cache hit (0 TTS) + strict invalidation on voiceId / identityVersion");

    // -----------------------------------------------------------------------
    // TEST 8: Old sub-block cache (`data/dubbing-block-cache/`) completely untouched
    // -----------------------------------------------------------------------
    const subBlockCacheAfter = snapshotDir(SUB_BLOCK_CACHE_DIR);
    assert.strictEqual(
      subBlockCacheAfter.size,
      subBlockCacheBefore.size,
      "Voice Lock MUST NOT add or delete files in data/dubbing-block-cache/"
    );
    for (const [fname, mtime] of subBlockCacheBefore.entries()) {
      assert.strictEqual(
        subBlockCacheAfter.get(fname),
        mtime,
        `Voice Lock modified sub-block cache file ${fname}`
      );
    }
    console.log("✔ Test 8 passed: data/dubbing-block-cache/ untouched by Voice Lock");

    // -----------------------------------------------------------------------
    // TEST 9: One speaker track failure isolates ONLY that speaker (no fallback/swap)
    // -----------------------------------------------------------------------
    const failObs: TtsPayloadObservation[] = [];
    setTtsPayloadObserverForTesting((obs) => failObs.push(obs));
    setVoiceLockFakeFaultInjectorForTesting(({ speaker }) =>
      speaker.speakerId === azizSpeakerId ? { failTurnIndex: 5 } : null
    );
    const partialRes = await synthesizeDialogueInVoiceLockMode(dummyAi, {
      turns,
      speakerMap,
      strictTimeWindow: true,
      useDeliveryEmotions: true,
      pronunciationDictionary: DEFAULT_PRONUNCIATION_DICTIONARY,
      bypassCache: true,
    });
    setVoiceLockFakeFaultInjectorForTesting(null);

    assert.strictEqual(partialRes.overallSuccess, false, "Partial track failure must set overallSuccess=false");
    assert.strictEqual(partialRes.ttsCallsUsed, 2, "Must NOT auto-retry or call single-turn recovery (still 2 TTS calls)");
    const azizTrack = partialRes.speakerTracks.find((t) => t.speakerId === azizSpeakerId)!;
    const veronikaTrack = partialRes.speakerTracks.find((t) => t.speakerId === veronikaSpeakerId)!;
    assert.strictEqual(azizTrack.status, "failed", "Aziz track must be marked failed");
    assert.strictEqual(veronikaTrack.status, "ok", "Veronika track must remain intact and ok");
    const azizFailedTurns = partialRes.turns.filter(
      (t) => t.speakerId === azizSpeakerId && t.qa === "failed"
    );
    const veronikaOkTurns = partialRes.turns.filter(
      (t) => t.speakerId === veronikaSpeakerId && t.qa === "ok" && Boolean(t.wavBase64)
    );
    assert.strictEqual(azizFailedTurns.length, 37, "All 37 Aziz turns must be marked failed");
    assert.strictEqual(veronikaOkTurns.length, 42, "All 42 Veronika turns must remain intact with audio");
    console.log("✔ Test 9 passed: Speaker track failure isolated cleanly, other speaker preserved, 0 recovery swap");

    // -----------------------------------------------------------------------
    // TEST 10: Missing / expired stored voice throws clear error BEFORE TTS
    // -----------------------------------------------------------------------
    const expiredObs: TtsPayloadObservation[] = [];
    setTtsPayloadObserverForTesting((obs) => expiredObs.push(obs));
    setFakeStoredVoiceValidatorForTesting((voiceId) => {
      if (voiceId === "voice_din40bswsfcy") {
        throw new Error(`Постоянный голос ${voiceId} не найден или истёк.`);
      }
      return {
        voiceId,
        exists: true,
        displayName: "Veronika F1",
        voiceType: "prompted",
      };
    });
    let expiredThrew = false;
    try {
      await synthesizeDialogueInVoiceLockMode(dummyAi, {
        turns,
        speakerMap,
        strictTimeWindow: true,
        bypassCache: true,
      });
    } catch (err: any) {
      expiredThrew = /не найден|истёк/i.test(String(err?.message || ""));
    } finally {
      setFakeStoredVoiceValidatorForTesting(null);
    }
    assert.strictEqual(expiredThrew, true, "Missing/expired stored voice MUST throw explicit error");
    assert.strictEqual(expiredObs.length, 0, "Zero TTS calls may happen when stored voice validation fails");
    console.log("✔ Test 10 passed: Expired/missing stored voice throws clear error before TTS (0 TTS calls)");

    // -----------------------------------------------------------------------
    // TEST 11: Pre-flight guard (> 600s or > 7500 tokens per speaker)
    // -----------------------------------------------------------------------
    const preflightObs: TtsPayloadObservation[] = [];
    setTtsPayloadObserverForTesting((obs) => preflightObs.push(obs));
    const hugeTurns: BatchInputTurn[] = [];
    for (let i = 0; i < 120; i++) {
      const aText =
        "Bu juda uzun avtomobil sharhi matni bo'lib, dvigatel quvvati, gibrid tizimi va batareya hajmi haqida batafsil tushuntiradi.";
      hugeTurns.push({
        index: i * 2,
        id: `huge_a_${i}`,
        speakerId: azizSpeakerId,
        speakerName: "Азиз",
        speakerGender: "male",
        text: aText,
        cleanSpeechText: aText,
        style: "",
        startSec: i * 6,
        endSec: i * 6 + 5.8,
        gapAfterSec: 0.2,
        rawTurn: {},
      });
      hugeTurns.push({
        index: i * 2 + 1,
        id: `huge_v_${i}`,
        speakerId: veronikaSpeakerId,
        speakerName: "Вероника",
        speakerGender: "female",
        text: "Qisqa javob.",
        cleanSpeechText: "Qisqa javob.",
        style: "",
        startSec: i * 6 + 5.8,
        endSec: i * 6 + 6.0,
        gapAfterSec: 0,
        rawTurn: {},
      });
    }
    let preflightThrew = false;
    try {
      await synthesizeDialogueInVoiceLockMode(dummyAi, {
        turns: hugeTurns,
        speakerMap,
        strictTimeWindow: true,
        bypassCache: true,
      });
    } catch (err: any) {
      preflightThrew = /600|7500|Pre-flight/i.test(String(err?.message || ""));
    }
    assert.strictEqual(preflightThrew, true, "Pre-flight guard MUST reject > 600s / > 7500 tokens per speaker");
    assert.strictEqual(preflightObs.length, 0, "Zero TTS calls allowed when pre-flight fails");
    console.log("✔ Test 11 passed: Pre-flight guard blocks > 600s / > 7500 tokens before TTS");

    // -----------------------------------------------------------------------
    // TEST 13: Identity QA failure marks run unsuccessful with ZERO auto-retry
    // -----------------------------------------------------------------------
    const qaObs: TtsPayloadObservation[] = [];
    setTtsPayloadObserverForTesting((obs) => qaObs.push(obs));
    setVoiceLockFakeFaultInjectorForTesting(({ speaker }) =>
      speaker.speakerId === veronikaSpeakerId
        ? {
            failIdentityQa: true,
            overrideIdentityQa: {
              sameSpeakerBeginning: true,
              sameSpeakerMiddle: false,
              sameSpeakerEnd: false,
              driftDetected: true,
              confidence: 0.91,
              explanationRu: "Обнаружен переход тембра в середине трека.",
            },
          }
        : null
    );
    const driftRes = await synthesizeDialogueInVoiceLockMode(dummyAi, {
      turns,
      speakerMap,
      strictTimeWindow: true,
      useDeliveryEmotions: true,
      pronunciationDictionary: DEFAULT_PRONUNCIATION_DICTIONARY,
      bypassCache: true,
    });
    setVoiceLockFakeFaultInjectorForTesting(null);

    assert.strictEqual(driftRes.identityQaPassed, false, "Drift must set identityQaPassed=false");
    assert.strictEqual(driftRes.overallSuccess, false, "Drift must set overallSuccess=false");
    assert.strictEqual(driftRes.ttsCallsUsed, 2, "Identity QA failure MUST NOT auto-retry TTS (still 2 TTS calls)");
    assert.strictEqual(qaObs.length, 2);
    console.log("✔ Test 13 passed: Identity QA drift marks overallSuccess=false with ZERO auto-retry");

    console.log("\n✅ ALL 13 STAGE 2 VOICE LOCK FAKE TESTS PASSED!");
  } finally {
    setTtsPayloadObserverForTesting(null);
    setFakeStoredVoiceValidatorForTesting(null);
    setVoiceLockFakeFaultInjectorForTesting(null);

    // Clean up any test cache files we created in data/voice-lock-cache/
    if (fs.existsSync(VOICE_LOCK_CACHE_DIR)) {
      for (const name of fs.readdirSync(VOICE_LOCK_CACHE_DIR)) {
        if (!cacheBeforeAll.has(name)) {
          createdCacheFiles.add(name);
          try {
            fs.unlinkSync(path.join(VOICE_LOCK_CACHE_DIR, name));
          } catch {}
        }
      }
    }
    if (createdCacheFiles.size > 0) {
      console.log(`🧹 Cleaned ${createdCacheFiles.size} temporary test cache file(s) from data/voice-lock-cache/`);
    }
  }
}

main().catch((err) => {
  console.error("❌ Stage 2 Voice Lock fake test failed:", err);
  process.exit(1);
});
