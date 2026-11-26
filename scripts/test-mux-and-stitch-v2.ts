import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MuxAudioChunkStore } from '../server/services/muxAudioChunkStore';
import {
  stitchDialogueTurnsClient,
  decodeBase64ToBytes,
  encodeBytesToBase64,
  MASTER_FADE_OUT_MS,
} from '../src/utils/clientMasterStitcher';
import { computeTurnAudioHash, buildTurnAudioCacheKey } from '../src/utils/db';

function makeConstantWavBase64(durationSec: number, sampleRate = 24000, amplitude = 20000): string {
  const numSamples = Math.round(durationSec * sampleRate);
  const dataByteLen = numSamples * 2;
  const wav = new Uint8Array(new ArrayBuffer(44 + dataByteLen));
  const view = new DataView(wav.buffer);
  const writeStr = (off: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataByteLen, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataByteLen, true);
  let pos = 44;
  for (let i = 0; i < numSamples; i++) {
    view.setInt16(pos, amplitude, true);
    pos += 2;
  }
  return encodeBytesToBase64(wav);
}

async function runTests() {
  // === TEST 1: 20-minute (~55 MB) WAV chunked upload (8 MB chunks) + assembly + security checks ===
  const tmpTestRoot = path.join(os.tmpdir(), `ovozstudio_chunk_test_${Date.now()}`);
  const store = new MuxAudioChunkStore(tmpTestRoot);

  // 20 minutes @ 24kHz 16-bit mono = 20 * 60 * 48,000 + 44 = 57,600,044 bytes (~54.93 MiB)
  const totalWavSize = 20 * 60 * 48000 + 44;
  const wavBuf = Buffer.alloc(totalWavSize);
  wavBuf.write('RIFF', 0, 'ascii');
  wavBuf.writeUInt32LE(totalWavSize - 8, 4);
  wavBuf.write('WAVE', 8, 'ascii');
  // Seed distinct deterministic pattern across the whole 55 MB track so corruption would be caught
  for (let off = 44; off < totalWavSize; off += 4096) {
    wavBuf[off] = (off >>> 12) & 0xff;
  }
  const expectedSha256 = crypto.createHash('sha256').update(wavBuf).digest('hex');

  const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MB chunks
  const totalChunks = Math.ceil(wavBuf.length / CHUNK_SIZE);
  assert.equal(totalChunks, 7, 'Expected 7 chunks of 8 MB for 55 MiB 20-min WAV');

  const uploadId = `mux_test20m_${Date.now()}`;
  const ownerUid = 'user_owner_123';

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(wavBuf.length, start + CHUNK_SIZE);
    const slice = wavBuf.subarray(start, end);
    const res = await store.saveChunk({
      uploadId,
      index: i,
      total: totalChunks,
      chunkBuffer: slice,
      ownerUid,
    });
    if (i < totalChunks - 1) {
      assert.equal(res.status, 'chunk_received');
      assert.equal(res.received, i + 1);
    } else {
      assert.equal(res.status, 'assembled');
      assert.equal(res.assembledSizeBytes, totalWavSize);
    }
  }

  // Security: another user cannot consume this uploadId
  await assert.rejects(
    () => store.consumeAssembled(uploadId, 'other_user_999'),
    /Нет доступа/
  );

  // Security: path traversal uploadId rejected
  await assert.rejects(
    () =>
      store.saveChunk({
        uploadId: '../escape_dir',
        index: 0,
        total: 1,
        chunkBuffer: Buffer.from('abc'),
        ownerUid,
      }),
    /Некорректный идентификатор/
  );

  // Consume & verify SHA-256 matches 20-min WAV byte-for-byte
  const consumed = await store.consumeAssembled(uploadId, ownerUid);
  assert.equal(consumed.sizeBytes, totalWavSize);
  const assembledBuf = await fs.promises.readFile(consumed.filePath);
  const actualSha256 = crypto.createHash('sha256').update(assembledBuf).digest('hex');
  assert.equal(actualSha256, expectedSha256, 'Assembled 20-min WAV SHA-256 mismatch!');

  await consumed.cleanup();
  assert.equal(fs.existsSync(consumed.filePath), false, 'Expected assembled file cleaned up');
  await fs.promises.rm(tmpTestRoot, { recursive: true, force: true });
  console.log(
    `✅ TEST 1 PASSED: 20-minute WAV (${(totalWavSize / 1024 / 1024).toFixed(2)} MiB) uploaded in ${totalChunks}x8MB chunks, assembled byte-for-byte, ownership & path confinement verified.`
  );

  // === TEST 2: IndexedDB key & content hash invalidation ===
  const hBase = computeTurnAudioHash({ text: 'Salom dunyo', voiceKey: 'Kore|1.0', styleKey: 'iliq' });
  const hSame = computeTurnAudioHash({ text: '  Salom dunyo  ', voiceKey: 'Kore|1.0', styleKey: 'iliq' });
  const hDiffText = computeTurnAudioHash({ text: 'Salom do‘stim', voiceKey: 'Kore|1.0', styleKey: 'iliq' });
  const hDiffVoice = computeTurnAudioHash({ text: 'Salom dunyo', voiceKey: 'Charon|1.0', styleKey: 'iliq' });
  const hDiffStyle = computeTurnAudioHash({ text: 'Salom dunyo', voiceKey: 'Kore|1.0', styleKey: 'quvnoq' });

  assert.equal(hBase, hSame, 'Trimmed identical inputs must produce identical hash');
  assert.notEqual(hBase, hDiffText, 'Text change must invalidate hash');
  assert.notEqual(hBase, hDiffVoice, 'Voice change must invalidate hash');
  assert.notEqual(hBase, hDiffStyle, 'Style change must invalidate hash');

  const k1 = buildTurnAudioCacheKey('uid1::projA', 'turn_1', hBase);
  const k2 = buildTurnAudioCacheKey('uid1::projB', 'turn_1', hBase);
  assert.notEqual(k1, k2, 'Different projects must have isolated cache keys');
  console.log('✅ TEST 2 PASSED: IndexedDB key (project + turnId + hash(text, voice, style)) verified.');

  // === TEST 3: 120 ms fade-out on overflow turns & end of master track ===
  assert.equal(MASTER_FADE_OUT_MS, 120);
  const sampleRate = 24000;
  const fadeSamples = Math.round((sampleRate * 120) / 1000); // 2880 samples
  const const3s = makeConstantWavBase64(3.0, sampleRate, 20000);
  const const1s = makeConstantWavBase64(1.0, sampleRate, 20000);

  // Turn 1 starts at 0.0s, lasts 3.0s, but Turn 2 starts at 1.5s -> Turn 1 overflows (3.0 > 1.5 + 0.3 + 0.02)!
  // Turn 2 starts at 1.5s (+0.3s shift = 1.8s), lasts 1.0s -> ends at 2.8s.
  // Total track ends at 3.0s (end of Turn 1). Also test Turn 2 alone ending at master track boundary!
  const overflowRes = stitchDialogueTurnsClient({
    turns: [
      { id: 'ov1', speakerId: 'HOST_1', speakerName: 'A', text: 'Long overflow', startSec: 0, endSec: 1.4, audioBase64: const3s },
      { id: 'ov2', speakerId: 'HOST_2', speakerName: 'B', text: 'Next turn', startSec: 1.5, endSec: 2.5, audioBase64: const1s },
    ],
    masterAudioMode: 'time_aligned',
    totalVideoDurationSec: 3.0,
  });

  assert.equal(overflowRes.turns[0].syncStatus, 'overflow', 'Turn 1 must be marked overflow');

  // Verify fade-out at end of master track (last 120 ms of a single constant-amplitude clip reaching exact track end)
  const endFadeRes = stitchDialogueTurnsClient({
    turns: [
      { id: 't_end', speakerId: 'HOST_1', speakerName: 'A', text: 'Tail check', startSec: 0, endSec: 1.0, audioBase64: const1s },
    ],
    masterAudioMode: 'time_aligned',
    totalVideoDurationSec: 1.0,
  });

  const endBytes = decodeBase64ToBytes(endFadeRes.masterAudioBase64);
  const endView = new DataView(endBytes.buffer, endBytes.byteOffset, endBytes.byteLength);
  const totalEndSamples = (endBytes.byteLength - 44) / 2;
  const midSample = endView.getInt16(44 + Math.floor(totalEndSamples * 0.5) * 2, true);
  const fadeMidSample = endView.getInt16(44 + (totalEndSamples - Math.floor(fadeSamples / 2)) * 2, true);
  const lastSample = endView.getInt16(44 + (totalEndSamples - 1) * 2, true);

  assert.equal(midSample, 20000, 'Body before fade-out must remain full amplitude');
  assert.ok(
    fadeMidSample > 9000 && fadeMidSample < 11000,
    `Midpoint of 120ms fade-out should be ~10000, got ${fadeMidSample}`
  );
  assert.ok(lastSample < 50, `Final sample at track end must fade near 0, got ${lastSample}`);

  // Also verify overflow turn fade-out independently (Turn 1 is 3.0s overflowing next turn at 4.0s? No, next turn at 1.5s, Turn 2 is silent!)
  const silent1s = makeConstantWavBase64(1.0, sampleRate, 0);
  const isolatedOverflow = stitchDialogueTurnsClient({
    turns: [
      { id: 'ov_iso_1', speakerId: 'HOST_1', speakerName: 'A', text: 'Overflow turn', startSec: 0, endSec: 1.0, audioBase64: const3s },
      { id: 'ov_iso_2', speakerId: 'HOST_2', speakerName: 'B', text: 'Silent next', startSec: 1.2, endSec: 5.0, audioBase64: silent1s },
    ],
    masterAudioMode: 'time_aligned',
    totalVideoDurationSec: 5.0,
  });
  assert.equal(isolatedOverflow.turns[0].syncStatus, 'overflow');
  const ovBytes = decodeBase64ToBytes(isolatedOverflow.masterAudioBase64);
  const ovView = new DataView(ovBytes.buffer, ovBytes.byteOffset, ovBytes.byteLength);
  const turn1EndSample = Math.round(3.0 * sampleRate);
  const ovBody = ovView.getInt16(44 + Math.round(2.5 * sampleRate) * 2, true);
  const ovFadeMid = ovView.getInt16(44 + (turn1EndSample - Math.floor(fadeSamples / 2)) * 2, true);
  const ovFadeEnd = ovView.getInt16(44 + (turn1EndSample - 1) * 2, true);

  assert.equal(ovBody, 20000, 'Overflow turn body before last 120ms should be full amplitude');
  assert.ok(ovFadeMid > 9000 && ovFadeMid < 11000, `Overflow turn 120ms fade midpoint expected ~10000, got ${ovFadeMid}`);
  assert.ok(ovFadeEnd < 50, `Overflow turn final sample must fade near 0, got ${ovFadeEnd}`);

  console.log('✅ TEST 3 PASSED: 120ms linear fade-out verified on overflow turns and at end of master track.');
  console.log('ALL V2 TESTS PASSED!');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
