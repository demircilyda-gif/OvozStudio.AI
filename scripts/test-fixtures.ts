import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  parseReadyScript,
  pickBuiltInVoiceForGender,
  checkSynthesisVoiceWarnings,
  isClonedVoiceProfile,
} from '../src/utils/readyScriptParser';
import { planDialogueMacroBlocks } from '../src/utils/dialogueMacroBlocks';

// Extract expected 5th pipe column (0-indexed col 4) directly from raw pipe lines
function extractRawFifthColumns(rawText: string): string[] {
  const cols5: string[] = [];
  for (const rawLine of rawText.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (/^(?:спикеры|speakers|spikerlar)\s*[:—-]/i.test(trimmed)) continue;
    if (/^={2,}/.test(trimmed)) continue;
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) continue;
    if (!trimmed.includes('|')) continue;

    let rowContent = trimmed;
    if (rowContent.startsWith('|')) rowContent = rowContent.slice(1);
    if (rowContent.endsWith('|')) rowContent = rowContent.slice(0, -1);
    const cols = rowContent.split('|');

    const joined = cols.map((c) => c.trim().toLowerCase()).join('|');
    if (
      (joined.includes('таймкод') || joined.includes('timecode') || joined.includes('время')) &&
      (joined.includes('спикер') || joined.includes('speaker'))
    ) {
      continue;
    }
    if (/^[\s|:-]+$/.test(trimmed)) continue;
    const col1 = (cols[1] ?? '').trim();
    const hasBracketNonSpeech = cols.slice(1).some((c) => {
      const t = c.trim();
      return t.startsWith('[') && t.endsWith(']');
    });
    if (hasBracketNonSpeech && (cols.length <= 2 || col1.startsWith('[') || col1 === '—' || col1 === '-' || col1 === '')) {
      continue;
    }

    if (cols.length >= 5) {
      cols5.push((cols[4] ?? '').trim());
    }
  }
  return cols5;
}

console.log('--- CHECK 1: Real "Спикеры: ... | Всего реплик: ..." header parsing ---');
const realHeaderSample = [
  'Спикеры: Азиз (М), Вероника (Ж) | Всего реплик: 79 (Вероника: 42, Азиз: 37)',
  '=== 1-SAHNA: Kirish ===',
  "00:00–00:05 (5s) | Азиз | средний | бодро | Assalomu alaykum, do'stlar! | Всем привет, друзья!",
  "00:06–00:11 (5s) | Вероника | средний | живо | Bugun yangi avtomobilni ko'ramiz. | Сегодня посмотрим новый автомобиль.",
].join('\n');
const headerRes = parseReadyScript(realHeaderSample);
assert.equal(headerRes.ok, true, `Header sample failed: ${JSON.stringify(headerRes.errors)}`);
assert.equal(headerRes.speakers.length, 2, 'Must parse strictly 2 speakers before "|"');
assert.deepEqual(headerRes.speakers, [
  { speakerId: 'HOST_1', name: 'Азиз', gender: 'male' },
  { speakerId: 'HOST_2', name: 'Вероника', gender: 'female' },
]);
console.log('PASS CHECK 1: Strictly 2 speakers parsed (Азиз=male, Вероника=female).');

console.log('--- CHECK 2: Auto-assign built-in voices by gender & pre-synthesis voice warnings ---');
const sampleVoices = [
  { id: 'voice_17raj9ewke3g', name: 'Shohrux (Клон)', gender: 'male', baseVoice: 'Charon', isReplicatedVoice: true },
  { id: 'sardor', name: 'Sardor', gender: 'male', baseVoice: 'Charon', isReplicatedVoice: false },
  { id: 'aziza', name: 'Aziza', gender: 'female', baseVoice: 'Kore', isReplicatedVoice: false },
  { id: 'malika', name: 'Malika', gender: 'female', baseVoice: 'Aoede', isReplicatedVoice: false },
];

const pickedMale = pickBuiltInVoiceForGender(sampleVoices, 'male');
const pickedFemale = pickBuiltInVoiceForGender(sampleVoices, 'female', pickedMale ? [pickedMale.id] : []);
assert.equal(pickedMale?.id, 'sardor', 'Must pick built-in male voice, NEVER cloned voice');
assert.equal(isClonedVoiceProfile(pickedMale), false);
assert.equal(pickedFemale?.id, 'aziza', 'Must pick built-in female voice');
assert.equal(isClonedVoiceProfile(pickedFemale), false);

const okWarnings = checkSynthesisVoiceWarnings(
  [
    { speakerId: 'HOST_1', name: 'Азиз', gender: 'male', voice: pickedMale },
    { speakerId: 'HOST_2', name: 'Вероника', gender: 'female', voice: pickedFemale },
  ],
  headerRes.turns
);
assert.equal(okWarnings.length, 0, `Expected 0 warnings for matching built-in voices, got: ${okWarnings}`);

const badWarnings = checkSynthesisVoiceWarnings(
  [
    { speakerId: 'HOST_1', name: 'Азиз', gender: 'male', voice: sampleVoices[2] },
    { speakerId: 'HOST_2', name: 'Вероника', gender: 'female', voice: sampleVoices[0] },
  ],
  headerRes.turns
);
assert.equal(badWarnings.length, 3, `Expected 3 warnings (2 gender mismatches + 1 cloned voice), got: ${JSON.stringify(badWarnings)}`);
console.log('PASS CHECK 2: Built-in auto-assignment & pre-synthesis mismatch/cloned warnings verified.');

console.log('--- CHECK 3: Real fixture files in scripts/fixtures/*.txt ---');
const fixturesDir = path.resolve(process.cwd(), 'scripts', 'fixtures');
const files = fs.existsSync(fixturesDir)
  ? fs.readdirSync(fixturesDir).filter((f) => f.toLowerCase().endsWith('.txt')).sort()
  : [];

interface FixtureExpectation {
  label: string;
  match: RegExp;
  expectedTurns: number;
  expectedBlocks: number;
  fixArrizoBrokenTimecode?: boolean;
}

const expectations: FixtureExpectation[] = [
  { label: 'Tiggo 8', match: /tiggo[-_ ]?8/i, expectedTurns: 79, expectedBlocks: 4 },
  { label: 'Tiggo 9', match: /tiggo[-_ ]?9/i, expectedTurns: 103, expectedBlocks: 5 },
  { label: 'Arrizo 8', match: /arrizo[-_ ]?8/i, expectedTurns: 79, expectedBlocks: 5, fixArrizoBrokenTimecode: true },
];

if (files.length === 0) {
  console.log('INFO: scripts/fixtures/ has no .txt files yet. Ready to validate Tiggo 8, Tiggo 9, and Arrizo 8 once added.');
} else {
  for (const exp of expectations) {
    const fileName = files.find((f) => exp.match.test(f));
    if (!fileName) {
      console.log(`SKIP: Fixture for ${exp.label} not found yet in scripts/fixtures/`);
      continue;
    }

    const fullPath = path.join(fixturesDir, fileName);
    let raw = fs.readFileSync(fullPath, 'utf8');

    if (exp.fixArrizoBrokenTimecode && /10:07\s*[–—-]\s*08:15/.test(raw)) {
      const brokenRes = parseReadyScript(raw);
      assert.equal(brokenRes.ok, false, `${exp.label} raw file with 10:07–08:15 must be rejected before fix`);
      assert.ok(brokenRes.errors.length > 0 && brokenRes.errors[0].line > 0, 'Must report line number for 10:07–08:15');
      console.log(`PASS ${exp.label} (pre-fix rejection): ${brokenRes.errors[0].message}`);
      raw = raw.replace(/10:07(\s*[–—-]\s*)08:15/, '10:07$110:15');
    }

    const res = parseReadyScript(raw);
    assert.equal(res.ok, true, `${exp.label} (${fileName}) parse failed: ${JSON.stringify(res.errors)}`);
    assert.equal(res.turns.length, exp.expectedTurns, `${exp.label}: expected ${exp.expectedTurns} turns, got ${res.turns.length}`);

    const rawCol5 = extractRawFifthColumns(raw);
    assert.equal(rawCol5.length, res.turns.length, `${exp.label}: raw 5th column count (${rawCol5.length}) !== parsed turns (${res.turns.length})`);
    for (let i = 0; i < res.turns.length; i++) {
      assert.equal(
        res.turns[i].text,
        rawCol5[i],
        `${exp.label}: turn #${i + 1} text does not match 5th column verbatim`
      );
    }

    const blocks = planDialogueMacroBlocks(res.turns, { maxSize: 25, minPauseSec: 0.5 });
    assert.equal(
      blocks.length,
      exp.expectedBlocks,
      `${exp.label}: expected ${exp.expectedBlocks} blocks, got ${blocks.length} (${blocks
        .map((b) => `${b.startTimecode}-${b.endTimecode}[${b.turns.length}]`)
        .join(', ')})`
    );
    assert.ok(blocks.every((b) => b.turns.length <= 25), `${exp.label}: all blocks must be <= 25 turns`);

    console.log(
      `PASS ${exp.label} (${fileName}): ${res.turns.length} turns, ${blocks.length} blocks -> ${blocks
        .map((b) => `${b.startTimecode}–${b.endTimecode}(${b.turns.length})`)
        .join(' | ')}`
    );
  }
}

console.log('\nFIXTURE & VOICE CHECKS COMPLETED.');
