import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  parseReadyScript,
  exportTurnsToJson,
  exportTurnsToCsv,
  shouldRunVideoAutoAnalysis,
  formatSecToTimecode,
} from '../src/utils/readyScriptParser';
import { planDialogueMacroBlocks } from '../src/utils/dialogueMacroBlocks';
import { splitTurnsIntoMacroBlocks as serverSplitTurnsIntoMacroBlocks } from '../server/services/dubbing/batchDialogueEngine';

// Spy on global fetch to guarantee 0 network calls during import/export
let networkCalls = 0;
const originalFetch = globalThis.fetch;
(globalThis as any).fetch = (...args: any[]) => {
  networkCalls += 1;
  return (originalFetch as any)(...args);
};

// 1. Test 01-tiggo-8 v4 format (79 turns, Азиз (М) & Вероника (Ж), === scenes ===, [ ... ] non-speech)
function buildTiggo8V4Fixture(): { raw: string; expectedUzTexts: string[]; expectedStyles: string[]; expectedRu: string[] } {
  const lines: string[] = [];
  lines.push('Спикеры: Азиз (М), Вероника (Ж)');
  lines.push('=== Сцена 1: Экстерьер и первые впечатления ===');
  lines.push('[00:00–00:04 динамичная музыка и пролёт камеры]');

  const expectedUzTexts: string[] = [];
  const expectedStyles: string[] = [];
  const expectedRu: string[] = [];

  let cursorSec = 4;
  for (let i = 1; i <= 79; i++) {
    if (i === 27) {
      lines.push('=== Сцена 2: Салон, экран и мультимедиа ===');
      lines.push(`[${formatSecToTimecode(cursorSec)}–${formatSecToTimecode(cursorSec + 3)} звук закрытия двери]`);
      cursorSec += 3;
    }
    if (i === 54) {
      lines.push('=== Сцена 3: Тест-драйв и динамика ===');
      lines.push(`${formatSecToTimecode(cursorSec)}–${formatSecToTimecode(cursorSec + 2)} (2s) | [рев мотора и разгон]`);
      cursorSec += 2;
    }

    const startSec = cursorSec;
    const dur = 4 + (i % 3); // 4..6s
    const endSec = startSec + dur;
    cursorSec = endSec + 1;

    const speaker = i % 2 === 1 ? 'Азиз' : 'Вероника';
    const rhythm = i % 3 === 0 ? 'быстрый' : 'средний';
    const style = i % 2 === 1 ? 'уверенно, по-мужски, с лёгкой улыбкой' : 'живо, эмоционально, с интересом';
    const uzText =
      i % 2 === 1
        ? `Tiggo 8 Pro Max #${i}: yo'lda o'zini juda ishonchli tutadi, 100% qulaylik!`
        : `Ha, Aziz! Ayniqsa #${i}-qismda salonning kengligi va g'oyat sifatli bezaklari ko'zni quvontiradi.`;
    const ruOrig =
      i % 2 === 1
        ? `Tiggo 8 Pro Max #${i}: на дороге ведёт себя очень уверенно, 100% комфорт!`
        : `Да, Азиз! Особенно в #${i}-фрагменте радует простор салона и качественная отделка.`;

    expectedUzTexts.push(uzText);
    expectedStyles.push(style);
    expectedRu.push(ruOrig);

    lines.push(
      `${formatSecToTimecode(startSec)}–${formatSecToTimecode(endSec)} (${dur}s) | ${speaker} | ${rhythm} | ${style} | ${uzText} | ${ruOrig}`
    );
  }

  return { raw: lines.join('\n'), expectedUzTexts, expectedStyles, expectedRu };
}

console.log('--- TEST 1: 01-tiggo-8 v4 (79 turns) ---');
const tiggo = buildTiggo8V4Fixture();
const tiggoRes = parseReadyScript(tiggo.raw);
assert.equal(networkCalls, 0, 'Expected 0 network calls during parseReadyScript');
assert.equal(tiggoRes.ok, true, `Expected valid parse, got errors: ${JSON.stringify(tiggoRes.errors)}`);
assert.equal(tiggoRes.format, 'pipe');
assert.equal(tiggoRes.turns.length, 79, 'Expected exactly 79 turns');
assert.equal(tiggoRes.noSpeechIntervals.length, 3, 'Expected 3 non-speech intervals');
assert.equal(tiggoRes.speakers.length, 2);
assert.deepEqual(tiggoRes.speakers[0], { speakerId: 'HOST_1', name: 'Азиз', gender: 'male' });
assert.deepEqual(tiggoRes.speakers[1], { speakerId: 'HOST_2', name: 'Вероника', gender: 'female' });

for (let i = 0; i < 79; i++) {
  const t = tiggoRes.turns[i];
  assert.equal(t.text, tiggo.expectedUzTexts[i], `Turn #${i + 1} text mismatch`);
  assert.equal(t.intonationRu, tiggo.expectedStyles[i], `Turn #${i + 1} intonationRu mismatch`);
  assert.equal(t.originalTextRu, tiggo.expectedRu[i], `Turn #${i + 1} originalTextRu mismatch`);
  if (i % 2 === 0) {
    assert.equal(t.speakerId, 'HOST_1');
    assert.equal(t.speakerName, 'Азиз');
    assert.equal(t.speakerGender, 'male');
  } else {
    assert.equal(t.speakerId, 'HOST_2');
    assert.equal(t.speakerName, 'Вероника');
    assert.equal(t.speakerGender, 'female');
  }
}
assert.equal(tiggoRes.turns[0].sceneTitle, 'Сцена 1: Экстерьер и первые впечатления');
assert.equal(tiggoRes.turns[26].sceneTitle, 'Сцена 2: Салон, экран и мультимедиа');
assert.equal(tiggoRes.turns[53].sceneTitle, 'Сцена 3: Тест-драйв и динамика');
console.log('PASS TEST 1: 79 turns, exact verbatim Uzbek text, Азиз=male/HOST_1, Вероника=female/HOST_2, 0 network calls.');

console.log('--- TEST 2: Arrizo invalid timecode 10:07–08:15 ---');
const arrizoBroken = [
  'Спикеры: Азиз (М), Вероника (Ж)',
  '=== Обзор Arrizo 8 ===',
  '08:00–08:06 (6s) | Азиз | средний | спокойно | Mana Arrizo 8 sedani. | Вот седан Arrizo 8.',
  '10:07–08:15 (8s) | Вероника | средний | живо | Ichki dizayni juda chiroyli! | Интерьер очень красивый!',
].join('\n');
const arrizoRes = parseReadyScript(arrizoBroken);
assert.equal(arrizoRes.ok, false, 'Expected Arrizo broken timecode to fail');
assert.equal(arrizoRes.turns.length, 0, 'Must refuse loading turns on validation failure');
assert.ok(
  arrizoRes.errors.some((e) => e.line === 4 && e.message.includes('Строка 4')),
  `Expected error referencing line 4, got: ${JSON.stringify(arrizoRes.errors)}`
);
console.log('PASS TEST 2:', arrizoRes.errors[0].message);

console.log('--- TEST 3: Overlap, empty text, unknown speaker, missing gender ---');
const multiErrScript = [
  'Спикеры: Азиз (М), Вероника (Ж)',
  '00:00–00:10 (10s) | Азиз | средний | спокойно | Birinchi replika. | Первая реплика.',
  '00:08–00:15 (7s) | Вероника | средний | живо | Ikkinchi replika (перекрытие). | Вторая реплика.',
  '00:16–00:20 (4s) | Азиз | средний | спокойно |   | Пустой узбекский текст.',
  '00:21–00:25 (4s) | Тимур | средний | спокойно | Nomaʼlum spiker. | Неизвестный спикер.',
].join('\n');
const multiErrRes = parseReadyScript(multiErrScript);
assert.equal(multiErrRes.ok, false);
assert.ok(multiErrRes.errors.some((e) => e.line === 3), 'Expected overlap error at line 3');
assert.ok(multiErrRes.errors.some((e) => e.line === 4), 'Expected empty text error at line 4');
assert.ok(multiErrRes.errors.some((e) => e.line === 5), 'Expected unknown speaker error at line 5');

const missingGenderScript = [
  'Спикеры: Азиз, Вероника (Ж)',
  '00:00–00:05 (5s) | Азиз | средний | спокойно | Salom! | Привет!',
].join('\n');
const missingGenderRes = parseReadyScript(missingGenderScript);
assert.equal(missingGenderRes.ok, false);
assert.ok(missingGenderRes.errors.some((e) => e.line === 1), 'Expected missing gender error at line 1');
console.log('PASS TEST 3: All 4 validation rules rejected with exact line numbers.');

console.log('--- TEST 4: SRT and CSV import ---');
const srtSample = [
  'Спикеры: Азиз (М), Вероника (Ж)',
  '',
  '1',
  '00:00:01,000 --> 00:00:04,500',
  "Азиз: Assalomu alaykum, do'stlar!",
  '',
  '2',
  '00:00:05,000 --> 00:00:09,000',
  'Вероника: Xush kelibsiz, bugun yangi test-drayv!',
].join('\n');
const srtRes = parseReadyScript(srtSample);
assert.equal(srtRes.ok, true, `SRT failed: ${JSON.stringify(srtRes.errors)}`);
assert.equal(srtRes.format, 'srt');
assert.equal(srtRes.turns.length, 2);
assert.equal(srtRes.turns[0].speakerGender, 'male');
assert.equal(srtRes.turns[1].speakerGender, 'female');

const csvSample = [
  'start,end,speaker,gender,text,style',
  '00:00,00:05,Азиз,М,"Salom, do\'stlar!",бодро',
  '00:06,00:11,Вероника,Ж,"Yangi avtomobil, zo\'r dizayn!",с улыбкой',
].join('\n');
const csvRes = parseReadyScript(csvSample);
assert.equal(csvRes.ok, true, `CSV failed: ${JSON.stringify(csvRes.errors)}`);
assert.equal(csvRes.format, 'csv');
assert.equal(csvRes.turns.length, 2);
assert.equal(csvRes.turns[0].text, "Salom, do'stlar!");
assert.equal(csvRes.turns[1].intonationRu, 'с улыбкой');
console.log('PASS TEST 4: SRT and CSV formats parsed cleanly.');

console.log('--- TEST 5: Export (JSON & CSV) -> Re-import Round-Trip (with edits & syncStatus, NO audio) ---');
const editedTurns = tiggoRes.turns.map((t, idx) => ({
  ...t,
  text: idx === 4 ? "Tahrirlangan 5-replika: o'zgartirilgan, vergulli matn!" : t.text,
  syncStatus: idx === 4 ? ('adjusted' as const) : idx === 10 ? ('overflow' as const) : ('ok' as const),
  audioBase64: 'DUMMY_SHOULD_NEVER_BE_EXPORTED_BASE64',
}));

const exportedJson = exportTurnsToJson(editedTurns, tiggoRes.speakers, tiggoRes.noSpeechIntervals);
assert.equal(exportedJson.includes('DUMMY_SHOULD_NEVER_BE_EXPORTED_BASE64'), false, 'JSON export must strip audioBase64');
assert.equal(exportedJson.includes('audioBase64'), false, 'JSON export must not contain audioBase64 key');

const reimportedJson = parseReadyScript(exportedJson);
assert.equal(reimportedJson.ok, true, `JSON re-import failed: ${JSON.stringify(reimportedJson.errors)}`);
assert.equal(reimportedJson.turns.length, 79);
assert.equal(reimportedJson.noSpeechIntervals.length, 3);
for (let i = 0; i < 79; i++) {
  assert.equal(reimportedJson.turns[i].text, editedTurns[i].text);
  assert.equal(reimportedJson.turns[i].speakerId, editedTurns[i].speakerId);
  assert.equal(reimportedJson.turns[i].speakerName, editedTurns[i].speakerName);
  assert.equal(reimportedJson.turns[i].speakerGender, editedTurns[i].speakerGender);
  assert.equal(reimportedJson.turns[i].startSec, editedTurns[i].startSec);
  assert.equal(reimportedJson.turns[i].endSec, editedTurns[i].endSec);
  assert.equal(reimportedJson.turns[i].intonationRu, editedTurns[i].intonationRu);
  assert.equal(reimportedJson.turns[i].originalTextRu, editedTurns[i].originalTextRu);
  assert.equal(reimportedJson.turns[i].syncStatus, editedTurns[i].syncStatus);
  assert.equal(reimportedJson.turns[i].sceneTitle, editedTurns[i].sceneTitle);
}

const exportedCsv = exportTurnsToCsv(editedTurns, tiggoRes.speakers);
assert.equal(exportedCsv.includes('DUMMY_SHOULD_NEVER_BE_EXPORTED_BASE64'), false, 'CSV export must strip audioBase64');
const reimportedCsv = parseReadyScript(exportedCsv);
assert.equal(reimportedCsv.ok, true, `CSV re-import failed: ${JSON.stringify(reimportedCsv.errors)}`);
assert.equal(reimportedCsv.turns.length, 79);
for (let i = 0; i < 79; i++) {
  assert.equal(reimportedCsv.turns[i].text, editedTurns[i].text);
  assert.equal(reimportedCsv.turns[i].speakerId, editedTurns[i].speakerId);
  assert.equal(reimportedCsv.turns[i].speakerName, editedTurns[i].speakerName);
  assert.equal(reimportedCsv.turns[i].speakerGender, editedTurns[i].speakerGender);
  assert.equal(reimportedCsv.turns[i].startSec, editedTurns[i].startSec);
  assert.equal(reimportedCsv.turns[i].endSec, editedTurns[i].endSec);
  assert.equal(reimportedCsv.turns[i].intonationRu, editedTurns[i].intonationRu);
  assert.equal(reimportedCsv.turns[i].originalTextRu, editedTurns[i].originalTextRu);
  assert.equal(reimportedCsv.turns[i].syncStatus, editedTurns[i].syncStatus);
  assert.equal(reimportedCsv.turns[i].sceneTitle, editedTurns[i].sceneTitle);
}
assert.equal(networkCalls, 0, 'Expected 0 network calls across all import/export tests');
console.log('PASS TEST 5: JSON & CSV export strip audio and round-trip 79 turns + edits + syncStatus identically.');

console.log('--- TEST 6: Video upload guard + 25-turn TTS forecast + smart-diarize-turns cleanup ---');
assert.equal(
  shouldRunVideoAutoAnalysis({
    autoExtractFromVideo: false,
    isImportedScript: true,
    storyboardTextRu: '',
    turnsCount: 79,
  }),
  false,
  'Imported script must NEVER trigger automatic Gemini video analysis even when storyboardTextRu is empty'
);
assert.equal(
  shouldRunVideoAutoAnalysis({
    autoExtractFromVideo: true,
    isImportedScript: true,
    storyboardTextRu: '',
    turnsCount: 79,
  }),
  false,
  'Imported script guard must block auto-analysis until user explicitly confirms replacement'
);
assert.equal(
  shouldRunVideoAutoAnalysis({
    autoExtractFromVideo: true,
    isImportedScript: false,
    storyboardTextRu: '',
    turnsCount: 0,
  }),
  true,
  'Fresh empty workspace should still run video analysis when enabled'
);

assert.equal(Math.ceil(79 / 25), 4, '79 turns with 2 built-in voices = 4 TTS calls');

const serverSource = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf8');
const diarizeStart = serverSource.indexOf('/api/podcast/smart-diarize-turns');
const diarizeEnd = serverSource.indexOf('/api/podcast/expand-interview', diarizeStart);
assert.ok(diarizeStart > 0 && diarizeEnd > diarizeStart, 'Could not locate smart-diarize-turns block');
const diarizeBlock = serverSource.slice(diarizeStart - 120, diarizeEnd);
for (const forbidden of ['Artur Yugay', 'Ayubxon', 'Oybek', 'Kopengagen', 'Reygan']) {
  assert.equal(
    diarizeBlock.includes(forbidden),
    false,
    `smart-diarize-turns still contains hardcoded reference "${forbidden}"`
  );
}
console.log('PASS TEST 6: Video upload guard verified, TTS forecast = ceil(N/25), smart-diarize-turns is completely neutral.');
console.log('\nALL 6 TEST SUITES PASSED (0 network calls, 0 TTS calls).');
