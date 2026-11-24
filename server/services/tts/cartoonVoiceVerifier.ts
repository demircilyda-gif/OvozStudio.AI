import fs from "fs";
import path from "path";
import type { GoogleGenAI } from "@google/genai";
import {
  CHARACTER_VOICES,
  getPublicCharacterVoices,
  sanitizeStyleForGooglePolicy,
  findDisallowedChildAgeTermsInStyle,
} from "../../config/characterVoices.ts";
import { resolvePitchShiftFfmpeg } from "../../utils/ffmpegBinary.ts";
import { generateTtsAgentProposals } from "./ttsAgent.ts";
import {
  synthesizeTtsOvozlash,
  applyPitchAndSpeedPcm24k,
  setGeminiStyleObserver,
  getStoredTtsRecord,
} from "./ttsService.ts";

const SLEEP_MS_BETWEEN_TTS = 7000; // Respect 10 RPM Gemini TTS quota

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateTestSinePcm24k(seconds: number, freqHz: number = 330): Buffer {
  const sampleCount = Math.round(24000 * seconds);
  const buf = Buffer.alloc(sampleCount * 2);
  for (let i = 0; i < sampleCount; i++) {
    const val = Math.round(Math.sin((2 * Math.PI * freqHz * i) / 24000) * 12000);
    buf.writeInt16LE(val, i * 2);
  }
  return buf;
}

export async function runCartoonVoiceVerification(ai: GoogleGenAI) {
  const ffInfo = resolvePitchShiftFfmpeg();

  // 1. Sanitizer & word-boundary checks
  const dirtyStyle =
    "8 years old child voice, playful kid tone, 7 yosh bola ovozi, детский голос ребёнка 6 лет, toddler baby";
  const cleanedStyle = sanitizeStyleForGooglePolicy(dirtyStyle);
  const remainingDirty = findDisallowedChildAgeTermsInStyle(cleanedStyle);
  if (remainingDirty.length > 0) {
    throw new Error(`Sanitizer missed terms: ${remainingDirty.join(", ")}`);
  }

  const safeBoundaryInput = "полёт летом над kidney";
  const safeBoundaryOutput = sanitizeStyleForGooglePolicy(safeBoundaryInput);
  const wordBoundaryPassed = safeBoundaryOutput === safeBoundaryInput;
  if (!wordBoundaryPassed) {
    throw new Error(
      `Word-boundary check failed: "${safeBoundaryInput}" -> "${safeBoundaryOutput}"`
    );
  }

  // 2. Public catalog check (no leaked voiceId)
  const pubCatalog = getPublicCharacterVoices();
  const leakedVoiceIds = pubCatalog.filter((entry) => "voiceId" in (entry as any)).length;
  if (leakedVoiceIds > 0) {
    throw new Error(`Public catalog leaked ${leakedVoiceIds} voiceId fields`);
  }

  // 3. Single-pass FFmpeg pitch shift duration delta check (<= 2%)
  const basePcm = generateTestSinePcm24k(3.0, 330);
  const baseDurSec = basePcm.length / 48000;
  const pitchDurationChecks: Array<{
    semitones: number;
    speed: number;
    filterUsed: string;
    inSec: number;
    outSec: number;
    deltaPct: number;
    passed: boolean;
  }> = [];

  for (const semi of [2, 3, 4]) {
    const res = await applyPitchAndSpeedPcm24k(basePcm, semi, 1.0);
    const outDurSec = res.pcm.length / 48000;
    const deltaPct = Math.round((Math.abs(outDurSec - baseDurSec) / baseDurSec) * 10000) / 100;
    pitchDurationChecks.push({
      semitones: semi,
      speed: 1.0,
      filterUsed: res.filterUsed,
      inSec: Number(baseDurSec.toFixed(3)),
      outSec: Number(outDurSec.toFixed(3)),
      deltaPct,
      passed: deltaPct <= 2.0,
    });
  }

  // Also test combined pitch + speed single-pass (+3 semitones, 1.1x speed -> expected ~3.0/1.1 = 2.727s)
  const comboRes = await applyPitchAndSpeedPcm24k(basePcm, 3, 1.1);
  const comboExpectedSec = baseDurSec / 1.1;
  const comboOutSec = comboRes.pcm.length / 48000;
  const comboDeltaPct =
    Math.round((Math.abs(comboOutSec - comboExpectedSec) / comboExpectedSec) * 10000) / 100;
  pitchDurationChecks.push({
    semitones: 3,
    speed: 1.1,
    filterUsed: comboRes.filterUsed,
    inSec: Number(comboExpectedSec.toFixed(3)),
    outSec: Number(comboOutSec.toFixed(3)),
    deltaPct: comboDeltaPct,
    passed: comboDeltaPct <= 2.0,
  });

  // Observe every single Gemini TTS style string sent
  const observedStyles: Array<{
    voiceName: string;
    characterVoiceId?: string;
    styles: string[];
  }> = [];
  setGeminiStyleObserver((info) => {
    observedStyles.push(info);
  });

  let totalTtsCalls = 0;
  let googleRefusals = 0;

  try {
    // 4. Generate 6 static character previews into public/audio/previews/characters/<id>.wav
    const previewsDir = path.resolve(process.cwd(), "public", "audio", "previews", "characters");
    fs.mkdirSync(previewsDir, { recursive: true });

    const previewResults: Array<{
      id: string;
      baseVoice: string;
      pitchSemitones: number;
      durationSeconds: number;
      provider: string;
      cached: boolean;
      ttsCallsUsed: number;
      fileBytes: number;
      filePath: string;
    }> = [];

    for (let i = 0; i < CHARACTER_VOICES.length; i++) {
      const charVoice = CHARACTER_VOICES[i];
      if (totalTtsCalls > 0) {
        await sleep(SLEEP_MS_BETWEEN_TTS);
      }

      const previewText =
        charVoice.previewTextUz ||
        "Salom! Bugun bizni ajoyib va quvnoq hikoya kutmoqda!";
      console.log(
        `[CartoonVerifier] Preview [${i + 1}/6] ${charVoice.id} (baseVoice=${charVoice.baseVoice}, pitch=+${charVoice.pitchSemitones})`
      );

      try {
        const synth = await synthesizeTtsOvozlash(ai, {
          text: previewText,
          voiceId: charVoice.baseVoice || "Leda",
          characterVoiceId: charVoice.id,
          language: "uz",
          preset: "auto",
          speed: 1.0,
          ownerUid: "system-preview-generator",
          directorStyle: "Short cheerful studio preview line for this animated cartoon character.",
        });
        totalTtsCalls += synth.ttsCallsUsed;

        const rec = getStoredTtsRecord(synth.id);
        if (!rec || !fs.existsSync(rec.wavPath)) {
          throw new Error(`Stored WAV missing for ${charVoice.id} (${synth.id})`);
        }

        const destWav = path.join(previewsDir, `${charVoice.id}.wav`);
        fs.copyFileSync(rec.wavPath, destWav);
        const sizeBytes = fs.statSync(destWav).size;

        previewResults.push({
          id: charVoice.id,
          baseVoice: charVoice.baseVoice || "",
          pitchSemitones: synth.pitchSemitones,
          durationSeconds: synth.durationSeconds,
          provider: synth.provider,
          cached: synth.cached,
          ttsCallsUsed: synth.ttsCallsUsed,
          fileBytes: sizeBytes,
          filePath: `/audio/previews/characters/${charVoice.id}.wav`,
        });
      } catch (err: any) {
        if (err?.code === "GOOGLE_POLICY_REFUSAL") googleRefusals++;
        throw err;
      }
    }

    // 5. Run 4 exact Uzbek Latin prompt tests (AI Agent + live TTS synthesis)
    const testCases = [
      {
        name: "Test 1",
        prompt: "Multfilm uchun quvnoq qizcha quyonchaga salom beradi",
        expectedAudience: "kids_cartoon",
        expectedCharacter: "qizcha_quvnoq",
      },
      {
        name: "Test 2",
        prompt: "Ertak: ayiqcha va asalari, uxlashdan oldin",
        expectedAudience: "kids_cartoon",
        expectedCharacter: "ertak_hikoyachi",
      },
      {
        name: "Test 3",
        prompt: "Sho'x bola va uning iti haqida qisqa sahna",
        expectedAudience: "kids_cartoon",
        expectedCharacter: "bola_shox",
      },
      {
        name: "Test 4",
        prompt: "Restoran uchun reklama",
        expectedAudience: "general",
        expectedCharacter: undefined,
      },
    ];

    const testResults: Array<{
      name: string;
      prompt: string;
      audience: string;
      expectedAudience: string;
      chosenCharacter: string | undefined;
      expectedCharacter: string | undefined;
      allVariantCharacters: Array<string | undefined>;
      reasonShort: string;
      sampleTextSnippet: string;
      synthProvider: string;
      durationSeconds: number;
      pitchSemitones: number;
      ttsCallsUsed: number;
      bolaWordUntouched?: boolean;
    }> = [];

    for (const tc of testCases) {
      console.log(`[CartoonVerifier] Running ${tc.name}: "${tc.prompt}"`);
      const agentRes = await generateTtsAgentProposals(ai, {
        task: tc.prompt,
        language: "uz",
      });

      const audience = agentRes.decision?.audience || "general";
      const reasonShort = agentRes.decision?.reasonShort || "";
      const firstProposal = agentRes.proposals[0];
      if (!firstProposal) {
        throw new Error(`${tc.name} returned 0 proposals`);
      }

      const chosenChar = firstProposal.characterVoiceId;
      const allChars = agentRes.proposals.map((p) => p.characterVoiceId);

      if (totalTtsCalls > 0) {
        await sleep(SLEEP_MS_BETWEEN_TTS);
      }

      const cleanTextForSynth = firstProposal.text
        .replace(/\[telefon\]/gi, "71 200 11 22")
        .replace(/\[manzil\]/gi, "Toshkent markazi")
        .replace(/\[narx\]/gi, "50 ming so'm");

      try {
        const synth = await synthesizeTtsOvozlash(ai, {
          text: cleanTextForSynth,
          voiceId: chosenChar
            ? CHARACTER_VOICES.find((c) => c.id === chosenChar)?.baseVoice || "Leda"
            : firstProposal.recommendedVoiceId || "ulugbek-history",
          characterVoiceId: chosenChar,
          language: "uz",
          preset: "auto",
          speed: 1.0,
          ownerUid: "system-e2e-verifier",
          directorStyle: firstProposal.deliveryStyle || firstProposal.directorStyle,
          segments: firstProposal.segments,
        });
        totalTtsCalls += synth.ttsCallsUsed;

        testResults.push({
          name: tc.name,
          prompt: tc.prompt,
          audience,
          expectedAudience: tc.expectedAudience,
          chosenCharacter: chosenChar,
          expectedCharacter: tc.expectedCharacter,
          allVariantCharacters: allChars,
          reasonShort,
          sampleTextSnippet: firstProposal.text.slice(0, 140),
          synthProvider: synth.provider,
          durationSeconds: synth.durationSeconds,
          pitchSemitones: synth.pitchSemitones,
          ttsCallsUsed: synth.ttsCallsUsed,
          ...(tc.name === "Test 3"
            ? {
                bolaWordUntouched: !/animated cartoon character/i.test(firstProposal.text),
              }
            : {}),
        });
      } catch (err: any) {
        if (err?.code === "GOOGLE_POLICY_REFUSAL") googleRefusals++;
        throw err;
      }
    }

    // 6. Audit all styles sent to Gemini
    const styleViolations: Array<{ voiceName: string; characterVoiceId?: string; badTerms: string[]; style: string }> = [];
    for (const item of observedStyles) {
      for (const s of item.styles) {
        const bad = findDisallowedChildAgeTermsInStyle(s);
        if (bad.length > 0) {
          styleViolations.push({
            voiceName: item.voiceName,
            characterVoiceId: item.characterVoiceId,
            badTerms: bad,
            style: s,
          });
        }
      }
    }

    return {
      ok: styleViolations.length === 0 && totalTtsCalls <= 10 && googleRefusals === 0,
      ffmpegBinary: ffInfo.binPath,
      rubberbandAvailable: ffInfo.hasRubberband,
      sanitizerChecks: {
        dirtyStyleCleaned: cleanedStyle,
        remainingDisallowedCount: remainingDirty.length,
        wordBoundaryPassed,
        publicCatalogCount: pubCatalog.length,
        leakedVoiceIds,
      },
      pitchDurationChecks,
      totalTtsCalls,
      withinTenCallBudget: totalTtsCalls <= 10,
      observedGeminiStyleCalls: observedStyles.length,
      styleViolationsCount: styleViolations.length,
      styleViolations,
      googleSafetyRefusals: googleRefusals,
      previewsGenerated: previewResults,
      tests: testResults,
    };
  } finally {
    setGeminiStyleObserver(null);
  }
}
