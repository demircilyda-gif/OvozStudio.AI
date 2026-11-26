import assert from 'node:assert/strict';
import {
  stitchDialogueTurnsClient,
  decodeBase64ToBytes,
  encodeBytesToBase64,
} from '../src/utils/clientMasterStitcher';
import type { DialogueTurn } from '../src/types/podcast';

function makeSineWavBase64(opts: {
  durationSec: number;
  sampleRate?: number;
  numChannels?: number;
  freqHz?: number;
  amplitude?: number;
}): string {
  const sampleRate = opts.sampleRate ?? 24000;
  const numChannels = opts.numChannels ?? 1;
  const freqHz = opts.freqHz ?? 440;
  const amplitude = opts.amplitude ?? 12000;
  const numFrames = Math.round(opts.durationSec * sampleRate);
  const dataByteLen = numFrames * numChannels * 2;
  const wav = new Uint8Array(44 + dataByteLen);
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
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataByteLen, true);

  let pos = 44;
  for (let f = 0; f < numFrames; f++) {
    const sample = Math.round(Math.sin((2 * Math.PI * freqHz * f) / sampleRate) * amplitude);
    for (let ch = 0; ch < numChannels; ch++) {
      view.setInt16(pos, sample, true);
      pos += 2;
    }
  }
  return encodeBytesToBase64(wav);
}

// 1. Stress test: 79 turns across 8m10s (490s) — exact scale that exceeded Cloud Run's 32 MB HTTP limit
const clipA = makeSineWavBase64({ durationSec: 4.5, freqHz: 330 });
const clipB = makeSineWavBase64({ durationSec: 4.0, freqHz: 520 });
const largeTurns: DialogueTurn[] = [];
for (let i = 0; i < 79; i++) {
  const startSec = i * 6.0;
  const dur = i % 2 === 0 ? 4.5 : 4.0;
  largeTurns.push({
    id: `turn_${i + 1}`,
    speakerId: i % 2 === 0 ? 'HOST_1' : 'HOST_2',
    speakerName: i % 2 === 0 ? 'Veronika' : 'Aziz',
    text: `Replika ${i + 1} matni`,
    startSec,
    endSec: startSec + dur,
    audioBase64: i % 2 === 0 ? clipA : clipB,
    syncStatus: 'ok',
  });
}

const t0 = Date.now();
const aligned = stitchDialogueTurnsClient({
  turns: largeTurns,
  masterAudioMode: 'time_aligned',
  totalVideoDurationSec: 490,
});
const elapsedMs = Date.now() - t0;

assert.equal(aligned.turns.length, 79, 'Expected 79 stitched turns');
assert.equal(aligned.totalDurationSeconds, 490, 'Expected 490.0s master duration');
assert.ok(aligned.masterWavBytes.byteLength > 23_000_000, 'Expected >23 MB 24kHz WAV');
assert.ok(aligned.masterAudioBase64.length > 30_000_000, 'Expected >30 MB base64 WAV');
assert.ok(elapsedMs < 5000, `Stitching took too long: ${elapsedMs}ms`);

// Verify RIFF/WAVE header on decoded output
const decodedMaster = decodeBase64ToBytes(aligned.masterAudioBase64);
const headerView = new DataView(decodedMaster.buffer, decodedMaster.byteOffset, decodedMaster.byteLength);
const riff = String.fromCharCode(...decodedMaster.slice(0, 4));
const wave = String.fromCharCode(...decodedMaster.slice(8, 12));
assert.equal(riff, 'RIFF');
assert.equal(wave, 'WAVE');
assert.equal(headerView.getUint16(22, true), 1, 'Expected mono');
assert.equal(headerView.getUint32(24, true), 24000, 'Expected 24000 Hz');
assert.equal(headerView.getUint16(34, true), 16, 'Expected 16-bit PCM');

// Check peak amplitude over a 200-sample window inside turn #10 (60.5s) vs silence in gap (5.2s)
let peakTurn10 = 0;
const turn10Start = Math.round(60.5 * 24000);
for (let k = 0; k < 200; k++) {
  peakTurn10 = Math.max(peakTurn10, Math.abs(headerView.getInt16(44 + (turn10Start + k) * 2, true)));
}
let peakGap = 0;
const gapStart = Math.round(5.2 * 24000);
for (let k = 0; k < 200; k++) {
  peakGap = Math.max(peakGap, Math.abs(headerView.getInt16(44 + (gapStart + k) * 2, true)));
}
assert.ok(peakTurn10 > 10000, `Expected strong audio energy inside turn #10, got peak=${peakTurn10}`);
assert.equal(peakGap, 0, 'Expected silence in inter-turn gap');

// Verify SRT output
assert.ok(aligned.srtSubtitles.includes('00:01:00,000 --> 00:01:04,500'), 'Expected accurate SRT timestamp');
assert.ok(aligned.srtSubtitles.includes('[Veronika]: Replika 1 matni'), 'Expected SRT speaker & text');

// 2. Continuous mode + 44.1 kHz stereo WAV resampling test
const stereo44kClip = makeSineWavBase64({ durationSec: 1.5, sampleRate: 44100, numChannels: 2, freqHz: 440 });
const contResult = stitchDialogueTurnsClient({
  turns: [
    { id: 'c1', speakerId: 'HOST_1', speakerName: 'A', text: 'Birinchi', audioBase64: stereo44kClip },
    { id: 'c2', speakerId: 'HOST_2', speakerName: 'B', text: 'Ikkinchi', audioBase64: stereo44kClip },
  ],
  masterAudioMode: 'continuous',
});

assert.equal(contResult.turns.length, 2);
// 2 * (1.5s + 0.35s pause) = 3.7s
assert.equal(contResult.totalDurationSeconds, 3.7);
assert.equal(contResult.turns[0].startTime, 0);
assert.equal(contResult.turns[0].endTime, 1.5);
assert.equal(contResult.turns[1].startTime, 1.85);
assert.equal(contResult.turns[1].endTime, 3.35);

console.log(
  `✅ clientMasterStitcher tests passed! (79 turns / 490s -> ${(aligned.masterWavBytes.byteLength / 1024 / 1024).toFixed(1)} MB WAV stitched in ${elapsedMs}ms)`
);
