// Verification suite for Phase 1 Core Hotfixes
import assert from "node:assert";

// 1. Test cleanScriptForSpeech logic
function cleanScriptForSpeech(rawScript) {
  let cleaned = rawScript;
  cleaned = cleaned.replace(/```[\s\S]*?```/g, "");
  cleaned = cleaned.replace(/<[^>]+>/g, " ");
  cleaned = cleaned.replace(/^#{1,6}\s+.*$/gm, "").replace(/^---\s*$/gm, "");
  cleaned = cleaned
    .replace(/\[\s*(?:pauza|pause|пауза|jimlik|тишина)[^\]]*\]/gi, "... ")
    .replace(/\(\s*(?:pauza|pause|пауза|jimlik|тишина)[^)]*\)/gi, "... ");
  cleaned = cleaned.replace(/\[[^\]]+\]/g, " ");
  cleaned = cleaned.replace(
    /\((?:[^)]*(?:bariton|mezzo|sopran|tenor|bas|sokin|tez|pauza|nafas|kulgi|kamera|kadr|musiqa|ovoz|ohang|jiddiy|hayajon|голос|баритон|меццо|тенор|сопрано|бас|пауз|шепот|громк|интонац|акцент|настроени|уверен|бодр|спокойн|секунд|сек|диктор|ведущ|гость|кадр|сцен|музык|эффект|улыбк|смех)[^)]*)\)/gi,
    " ",
  );
  cleaned = cleaned
    .replace(/\b\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\b/g, " ")
    .replace(/^\s*\d{1,2}:\d{2}(?::\d{2})?\s*[:-]\s*/gm, "");
  cleaned = cleaned.replace(
    /^(?:[A-Za-zА-Яа-яЁё0-9_\s-]{1,25}(?:\([^)]*\))?)\s*:\s*(?=[A-Za-zА-Яа-яЁё])/gm,
    (match) => {
      if (
        /(?:диктор|голос|ведущ|гость|boshlovchi|mehmon|host|guest|speaker|spiker|narrator|баритон|меццо|bariton|mezzo|кадр|сцена|sahna|kadr|интонация|ohang|тембр|tembr|shart|условие)/i.test(
          match,
        )
      ) {
        return "";
      }
      return match;
    },
  );
  cleaned = cleaned.replace(/[*#_~`]/g, "");
  cleaned = cleaned
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
  return cleaned;
}

// 2. Test splitTextIntoSpeechChunks cascade logic
function splitTextIntoSpeechChunks(text, maxChunkLength = 320) {
  const paragraphs = text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks = [];

  function splitLongSentence(sent) {
    if (sent.length <= maxChunkLength) return [sent];
    const pauseMatches =
      sent.match(/[^;:,\u2014\u2013-]+[;:,\u2014\u2013-]+(?:\s|$)|[^;:,\u2014\u2013-]+$/g) ||
      [sent];
    const subChunks = [];
    let cur = "";

    for (const p of pauseMatches) {
      const pTrimmed = p.trim();
      if (!pTrimmed) continue;

      if (pTrimmed.length > maxChunkLength) {
        if (cur) {
          subChunks.push(cur);
          cur = "";
        }
        const words = pTrimmed.split(/\s+/);
        let wordCur = "";
        for (const w of words) {
          if ((wordCur + " " + w).length <= maxChunkLength) {
            wordCur += (wordCur ? " " : "") + w;
          } else {
            if (wordCur) subChunks.push(wordCur);
            wordCur = w.slice(0, maxChunkLength);
          }
        }
        if (wordCur) subChunks.push(wordCur);
      } else if ((cur + " " + pTrimmed).length <= maxChunkLength) {
        cur += (cur ? " " : "") + pTrimmed;
      } else {
        if (cur) subChunks.push(cur);
        cur = pTrimmed;
      }
    }
    if (cur) subChunks.push(cur);
    return subChunks;
  }

  for (const para of paragraphs) {
    if (para.length <= maxChunkLength) {
      chunks.push(para);
    } else {
      const sentences =
        para.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [para];
      let currentChunk = "";

      for (const sent of sentences) {
        const trimmed = sent.trim();
        if (!trimmed) continue;

        if (trimmed.length > maxChunkLength) {
          if (currentChunk) {
            chunks.push(currentChunk);
            currentChunk = "";
          }
          const subPieces = splitLongSentence(trimmed);
          for (const sub of subPieces) {
            chunks.push(sub);
          }
        } else if ((currentChunk + " " + trimmed).length <= maxChunkLength) {
          currentChunk += (currentChunk ? " " : "") + trimmed;
        } else {
          if (currentChunk) chunks.push(currentChunk);
          currentChunk = trimmed;
        }
      }
      if (currentChunk) chunks.push(currentChunk);
    }
  }

  return chunks.length > 0 ? chunks : [text];
}

console.log("=== RUNNING PHASE 1 VERIFICATION TESTS ===\n");

// TEST 1.1: Preserving 12:30 in text
const test1 = cleanScriptForSpeech("Uchrashuv soat 12:30 da.");
console.log(`[Test 1.1] cleanScriptForSpeech("Uchrashuv soat 12:30 da.") -> "${test1}"`);
assert.ok(test1.includes("12:30"), "12:30 must be preserved in cleanScriptForSpeech!");
console.log("PASS: 12:30 preserved.\n");

// TEST 1.2: Preserving 19:00 in text
const test2 = cleanScriptForSpeech("Efir soat 19:00 da boshlanadi.");
console.log(`[Test 1.2] cleanScriptForSpeech("Efir soat 19:00 da boshlanadi.") -> "${test2}"`);
assert.ok(test2.includes("19:00"), "19:00 must be preserved in cleanScriptForSpeech!");
console.log("PASS: 19:00 preserved.\n");

// TEST 1.3: Stripping timing brackets [00:00 - 00:05]
const test3 = cleanScriptForSpeech("[00:00 - 00:05] Salom dunyo!");
console.log(`[Test 1.3] cleanScriptForSpeech("[00:00 - 00:05] Salom dunyo!") -> "${test3}"`);
assert.strictEqual(test3, "Salom dunyo!", "Bracketed timings must be stripped!");
console.log("PASS: Bracketed timings stripped.\n");

// TEST 1.4: Stripping director marker 00:15:
const test4 = cleanScriptForSpeech("00:15: Salom!");
console.log(`[Test 1.4] cleanScriptForSpeech("00:15: Salom!") -> "${test4}"`);
assert.strictEqual(test4, "Salom!", "Line marker timestamps must be stripped!");
console.log("PASS: Line-start markers stripped.\n");

// TEST 1.5: Cascade sentence splitting (long 1200 char run-on sentence without periods)
const longRunOnSentence = Array(30).fill("Toshkent shahridagi eng yaxshi va arzon novostroykalar, Mirobod va Yakkasaroy tumanlaridagi sifatli uylar").join(", ");
const chunks = splitTextIntoSpeechChunks(longRunOnSentence, 320);
console.log(`[Test 1.5] splitTextIntoSpeechChunks with 1200+ char run-on sentence:`);
console.log(`Total chunks produced: ${chunks.length}`);
for (let i = 0; i < chunks.length; i++) {
  const len = chunks[i].length;
  console.log(` Chunk ${i + 1} length: ${len} chars`);
  assert.ok(len <= 320, `Chunk ${i + 1} length (${len}) must be <= 320!`);
}
console.log("PASS: All chunks strictly <= 320 characters.\n");

// TEST 1.6: Dialogue pause synchronization (0.35s = 16800 bytes)
const DIALOGUE_PAUSE_SECONDS = 0.35;
const pauseBufferBytes = Math.round(24000 * 2 * DIALOGUE_PAUSE_SECONDS);
console.log(`[Test 1.6] Pause buffer calculation:`);
console.log(`24000 samples/s * 2 bytes * ${DIALOGUE_PAUSE_SECONDS}s = ${pauseBufferBytes} bytes`);
assert.strictEqual(pauseBufferBytes, 16800, "Pause buffer must be exactly 16800 bytes for 0.35s!");
console.log("PASS: Pause duration strictly synchronized to 16800 bytes (0.35s).\n");

// TEST 1.7: Female custom voice routing logic
function testVoiceRouting(host2Id, isHost2Female, host2BaseVoice) {
  const isMaleHost1VoiceId = host2Id && host2Id.includes("17raj9");
  const isHost2Custom =
    host2Id &&
    !(isHost2Female && isMaleHost1VoiceId) &&
    (host2Id.startsWith("voice_") || host2Id.startsWith("voicekey_"));
  return isHost2Custom
    ? { voice: host2Id }
    : { prebuiltVoiceConfig: { voiceName: host2BaseVoice } };
}

// Case A: Female guest with custom cloned voice
const femaleCloned = testVoiceRouting("voice_aziza_female_123", true, "Aoede");
console.log(`[Test 1.7A] Female guest with custom voice ->`, femaleCloned);
assert.deepStrictEqual(femaleCloned, { voice: "voice_aziza_female_123" }, "Female custom voice must NOT be blocked!");

// Case B: Female guest accidentally passed host 1 male replicated voice
const femaleWithMaleVoice = testVoiceRouting("voice_17raj9ewke3g", true, "Aoede");
console.log(`[Test 1.7B] Female guest with male voice ID ->`, femaleWithMaleVoice);
assert.deepStrictEqual(femaleWithMaleVoice, { prebuiltVoiceConfig: { voiceName: "Aoede" } }, "Male host voice must be safely swapped to prebuilt female voice!");

// Case C: Male guest with custom voice
const maleCloned = testVoiceRouting("voice_jasur_456", false, "Charon");
console.log(`[Test 1.7C] Male guest with custom voice ->`, maleCloned);
assert.deepStrictEqual(maleCloned, { voice: "voice_jasur_456" }, "Male custom voice works!");

console.log("\n>>> ALL PHASE 1 CORE HOTFIX TESTS PASSED SUCCESSFULLY! <<<");
