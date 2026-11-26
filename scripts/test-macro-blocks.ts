import assert from 'node:assert/strict';
import { parseReadyScript, formatSecToTimecode } from '../src/utils/readyScriptParser';
import { planDialogueMacroBlocks } from '../src/utils/dialogueMacroBlocks';
import { splitTurnsIntoMacroBlocks as serverSplitTurnsIntoMacroBlocks } from '../server/services/dubbing/batchDialogueEngine';

// Helper to build a scene of N turns filling [startSec .. endSec] with short intra-scene pauses
function buildSceneRows(
  sceneHeader: string,
  count: number,
  startSec: number,
  endSec: number,
  startIndex: number
): string[] {
  const rows: string[] = [sceneHeader];
  const totalSpan = endSec - startSec;
  const step = totalSpan / count;
  for (let i = 0; i < count; i++) {
    const s = Math.round((startSec + i * step) * 10) / 10;
    const isLast = i === count - 1;
    const e = isLast ? endSec : Math.round((startSec + (i + 1) * step - 0.2) * 10) / 10;
    const speaker = (startIndex + i) % 2 === 0 ? 'Азиз' : 'Вероника';
    rows.push(
      `${formatSecToTimecode(s)}–${formatSecToTimecode(e)} (${Math.max(1, Math.round(e - s))}s) | ${speaker} | средний | живо | Sahna matni #${startIndex + i + 1}, Tiggo 8 Pro Max! | Реплика #${startIndex + i + 1}`
    );
  }
  return rows;
}

console.log('--- TEST 7: Tiggo 8 v4 (79 turns, === N-SAHNA ===) -> 4 blocks with boundaries 01:33, 03:21/03:25, 06:21/06:27 ---');
// 8 scenes totaling 79 turns:
// Block 1: 1-SAHNA (12) + 2-SAHNA (8) = 20 turns (00:00 -> 01:33), next starts at 01:33 (0s gap, 2-SAHNA+3-SAHNA = 27 > 25 so cut MUST stay at 01:33)
// Block 2: 3-SAHNA (19 turns, 01:33 -> 03:21), pause 4s to 03:25
// Block 3: 4-SAHNA (11) + 5-SAHNA (11) = 22 turns (03:25 -> 06:21), pause 6s to 06:27
// Block 4: 6-SAHNA (10) + 7-SAHNA (8) = 18 turns (06:27 -> 08:10)
// Total = 12 + 8 + 19 + 11 + 11 + 10 + 8 = 79 turns!
const tiggoV4Lines = [
  'Спикеры: Азиз (М), Вероника (Ж)',
  ...buildSceneRows('=== 1-SAHNA: Kirish va tashqi ko\'rinish (00:00–00:52) ===', 12, 0, 52, 0),
  ...buildSceneRows('=== 2-SAHNA: Old qism va optika (00:53–01:33) ===', 8, 53, 93, 12),
  ...buildSceneRows('=== 3-SAHNA: Salon va multimedia (01:33–03:21) ===', 19, 93, 201, 20),
  '[03:21–03:25 dinamik musiqa va kadr almashinuvi]',
  ...buildSceneRows('=== 4-SAHNA: Ikkinchi qator va qulaylik (03:25–04:50) ===', 11, 205, 290, 39),
  ...buildSceneRows('=== 5-SAHNA: Yukxona va uchinchi qator (04:51–06:21) ===', 11, 291, 381, 50),
  '[06:21–06:27 dvigatel ovozi va trassaga chiqish]',
  ...buildSceneRows('=== 6-SAHNA: Test-drayv va tezlanish (06:27–07:20) ===', 10, 387, 440, 61),
  ...buildSceneRows('=== 7-SAHNA: Xulosa va narxlar (07:21–08:10) ===', 8, 441, 490, 71),
];

const parsed = parseReadyScript(tiggoV4Lines.join('\n'));
assert.equal(parsed.ok, true, `Parse failed: ${JSON.stringify(parsed.errors)}`);
assert.equal(parsed.turns.length, 79, 'Expected 79 turns');
assert.equal(parsed.turns[0].sceneTitle, "1-SAHNA: Kirish va tashqi ko'rinish (00:00–00:52)");
assert.equal(parsed.turns[20].sceneTitle, '3-SAHNA: Salon va multimedia (01:33–03:21)');

const blocks = planDialogueMacroBlocks(parsed.turns, { maxSize: 25, minPauseSec: 0.5 });
assert.equal(blocks.length, 4, `Expected 4 blocks, got ${blocks.length}`);
assert.ok(blocks.every((b) => b.turns.length <= 25), 'Every block must be <= 25 turns');

// Verify exact boundaries: 01:33, 03:21/03:25, 06:21/06:27
const b0 = blocks[0].boundaryAfter!;
const b1 = blocks[1].boundaryAfter!;
const b2 = blocks[2].boundaryAfter!;
assert.equal(b0.endOfBlockTimecode, '01:33');
assert.equal(b0.startOfNextTimecode, '01:33');
assert.equal(b0.isMidConversation, true, '01:33 has 0s pause so it must be flagged as tight/mid-conversation boundary');

assert.equal(b1.endOfBlockTimecode, '03:21');
assert.equal(b1.startOfNextTimecode, '03:25');
assert.equal(b1.gapSec, 4);
assert.equal(b1.isSceneBoundary, true);
assert.equal(b1.isMidConversation, false);

assert.equal(b2.endOfBlockTimecode, '06:21');
assert.equal(b2.startOfNextTimecode, '06:27');
assert.equal(b2.gapSec, 6);
assert.equal(b2.isSceneBoundary, true);
assert.equal(b2.isMidConversation, false);
console.log(
  'PASS TEST 7: 4 blocks ->',
  blocks.map((b) => `${b.startTimecode}–${b.endTimecode} (${b.turns.length}t)`).join(' | ')
);

console.log('--- TEST 8: Oversized single scene (> 25 turns) splits at longest pause ---');
const bigSceneTurns = [];
let tSec = 0;
for (let i = 0; i < 34; i++) {
  const start = tSec;
  const end = start + 3;
  // Put a 3.5s pause strictly after turn index 18 (19th turn), all other pauses 0.2s (< 0.5s)
  const gap = i === 18 ? 3.5 : 0.2;
  bigSceneTurns.push({
    id: `big-${i + 1}`,
    text: `Katta sahna replikasi #${i + 1}`,
    sceneTitle: '1-SAHNA: Katta suhbat',
    startSec: start,
    endSec: end,
    gapAfterSec: gap,
  });
  tSec = Math.round((end + gap) * 10) / 10;
}
const bigBlocks = planDialogueMacroBlocks(bigSceneTurns, { maxSize: 25, minPauseSec: 0.5 });
assert.equal(bigBlocks.length, 2, '34-turn scene must split into 2 blocks');
assert.equal(bigBlocks[0].turns.length, 19, 'Must cut right after turn #19 where 3.5s pause is');
assert.equal(bigBlocks[1].turns.length, 15);
assert.equal(bigBlocks[0].boundaryAfter!.gapSec, 3.5);
assert.equal(bigBlocks[0].boundaryAfter!.isMidConversation, true, 'Cut inside a scene must be flagged');
assert.equal(bigBlocks[0].boundaryAfter!.reason, 'long_pause_in_scene');
console.log('PASS TEST 8: 34-turn scene split at 3.5s pause (19 + 15 turns).');

console.log('--- TEST 9: Strict < 0.5s avoidance even if >= 0.5s pause is early ---');
const tightTurns = [];
let cur = 0;
for (let i = 0; i < 30; i++) {
  const start = cur;
  const end = start + 2;
  // Only pause >= 0.5s is after turn index 7 (8th turn): 1.2s; all others 0.1s
  const gap = i === 7 ? 1.2 : 0.1;
  tightTurns.push({
    id: `tight-${i + 1}`,
    text: `Tez dialog #${i + 1}`,
    sceneTitle: '1-SAHNA: Tez bahs',
    startSec: start,
    endSec: end,
    gapAfterSec: gap,
  });
  cur = Math.round((end + gap) * 10) / 10;
}
const tightBlocks = planDialogueMacroBlocks(tightTurns, { maxSize: 25, minPauseSec: 0.5 });
assert.equal(tightBlocks.length, 2);
assert.equal(tightBlocks[0].turns.length, 8, 'Must pick the ONLY >=0.5s pause at turn 8 instead of cutting at 0.1s');
assert.equal(tightBlocks[1].turns.length, 22);
assert.ok(tightBlocks[0].boundaryAfter!.gapSec >= 0.5);
console.log('PASS TEST 9: Never cut at < 0.5s when a >= 0.5s pause existed (cut at turn 8, gap 1.2s).');

console.log('--- TEST 10: Client planDialogueMacroBlocks === Server batchDialogueEngine.splitTurnsIntoMacroBlocks ---');
const serverInput = parsed.turns.map((t, i) => ({
  id: t.id,
  index: i,
  speakerId: t.speakerId,
  speakerName: t.speakerName || t.speakerId,
  text: t.text,
  cleanSpeechText: t.text,
  style: t.intonationRu || '',
  startSec: t.startSec,
  endSec: t.endSec,
  sceneTitle: t.sceneTitle,
  rawTurn: t,
}));
const serverBlocks = serverSplitTurnsIntoMacroBlocks(serverInput);
assert.equal(serverBlocks.length, blocks.length, 'Client & server must produce identical block count');
for (let i = 0; i < blocks.length; i++) {
  assert.deepEqual(
    serverBlocks[i].map((x) => x.id),
    blocks[i].turns.map((x) => x.id),
    `Block #${i + 1} IDs differ between client and server`
  );
}
console.log('PASS TEST 10: Client and server macro-block splitting are 100% identical.');
console.log('\nALL MACRO-BLOCK TESTS PASSED.');
