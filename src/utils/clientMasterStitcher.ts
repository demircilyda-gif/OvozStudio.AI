import type { DialogueTurn } from '../types/podcast';

export interface ClientStitchInput {
  turns: DialogueTurn[];
  masterAudioMode: 'time_aligned' | 'continuous';
  totalVideoDurationSec?: number;
  sampleRate?: number;
}

export interface ClientStitchResult {
  masterAudioBase64: string;
  masterWavBytes: Uint8Array;
  totalDurationSeconds: number;
  turns: DialogueTurn[];
  srtSubtitles: string;
}

export function decodeBase64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const cleaned = b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64;
  if (typeof globalThis.atob === 'function') {
    const bin = globalThis.atob(cleaned);
    const len = bin.length;
    const out = new Uint8Array(new ArrayBuffer(len));
    for (let i = 0; i < len; i++) {
      out[i] = bin.charCodeAt(i);
    }
    return out;
  }
  // Node.js fallback (for unit tests)
  const buf = Buffer.from(cleaned, 'base64');
  const out = new Uint8Array(new ArrayBuffer(buf.byteLength));
  out.set(buf);
  return out;
}

export function encodeBytesToBase64(bytes: Uint8Array): string {
  if (typeof globalThis.btoa === 'function') {
    // Chunked conversion avoids Maximum Call Stack Size Exceeded on large (>10MB) WAV buffers
    const CHUNK = 0x8000;
    const parts: string[] = [];
    for (let i = 0; i < bytes.length; i += CHUNK) {
      const sub = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
      parts.push(String.fromCharCode.apply(null, sub as unknown as number[]));
    }
    return globalThis.btoa(parts.join(''));
  }
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

function readAscii(view: DataView, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length && offset + i < view.byteLength; i++) {
    out += String.fromCharCode(view.getUint8(offset + i));
  }
  return out;
}

/**
 * Extract 16-bit signed mono PCM samples at targetSampleRate from a WAV (or raw PCM) byte array.
 */
function extractMonoInt16Pcm(bytes: Uint8Array, targetSampleRate: number): Int16Array<ArrayBuffer> {
  if (bytes.byteLength < 2) return new Int16Array(0);

  let sampleRate = targetSampleRate;
  let numChannels = 1;
  let bitsPerSample = 16;
  let dataOffset = 0;
  let dataLength = bytes.byteLength;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (bytes.byteLength >= 44 && readAscii(view, 0, 4) === 'RIFF' && readAscii(view, 8, 4) === 'WAVE') {
    let offset = 12;
    let foundData = false;
    while (offset + 8 <= bytes.byteLength) {
      const chunkId = readAscii(view, offset, 4);
      const chunkSize = view.getUint32(offset + 4, true);
      const chunkDataStart = offset + 8;

      if (chunkId === 'fmt ' && chunkDataStart + 16 <= bytes.byteLength) {
        numChannels = Math.max(1, view.getUint16(chunkDataStart + 2, true));
        sampleRate = Math.max(8000, view.getUint32(chunkDataStart + 4, true));
        bitsPerSample = view.getUint16(chunkDataStart + 14, true) || 16;
      } else if (chunkId === 'data') {
        dataOffset = chunkDataStart;
        dataLength = Math.min(chunkSize, bytes.byteLength - chunkDataStart);
        foundData = true;
        break;
      }

      // Advance to next chunk (chunks are word-aligned)
      offset = chunkDataStart + chunkSize + (chunkSize % 2);
      if (chunkSize === 0 && !foundData) break;
    }

    if (!foundData) {
      dataOffset = 44;
      dataLength = Math.max(0, bytes.byteLength - 44);
    }
  }

  const bytesPerSample = Math.max(1, Math.floor(bitsPerSample / 8));
  const frameSize = bytesPerSample * numChannels;
  const numFrames = Math.floor(dataLength / frameSize);
  if (numFrames <= 0) return new Int16Array(0);

  const mono = new Int16Array(numFrames);
  for (let f = 0; f < numFrames; f++) {
    let sum = 0;
    for (let ch = 0; ch < numChannels; ch++) {
      const pos = dataOffset + f * frameSize + ch * bytesPerSample;
      if (bitsPerSample === 16) {
        sum += view.getInt16(pos, true);
      } else if (bitsPerSample === 8) {
        sum += (view.getUint8(pos) - 128) << 8;
      } else if (bitsPerSample === 32) {
        sum += Math.max(-32768, Math.min(32767, Math.round(view.getFloat32(pos, true) * 32767)));
      }
    }
    mono[f] = Math.max(-32768, Math.min(32767, Math.round(sum / numChannels)));
  }

  if (sampleRate === targetSampleRate) {
    return mono;
  }

  // Linear resample to targetSampleRate
  const ratio = sampleRate / targetSampleRate;
  const outLen = Math.max(1, Math.round(mono.length / ratio));
  const resampled = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcPos = i * ratio;
    const idx0 = Math.min(mono.length - 1, Math.floor(srcPos));
    const idx1 = Math.min(mono.length - 1, idx0 + 1);
    const frac = srcPos - idx0;
    resampled[i] = Math.round(mono[idx0] * (1 - frac) + mono[idx1] * frac);
  }
  return resampled;
}

function buildMono16BitWav(samples: Int16Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const dataByteLen = samples.length * 2;
  const wav = new Uint8Array(new ArrayBuffer(44 + dataByteLen));
  const view = new DataView(wav.buffer);

  const writeStr = (off: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(off + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataByteLen, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // AudioFormat = PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // ByteRate
  view.setUint16(32, 2, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample
  writeStr(36, 'data');
  view.setUint32(40, dataByteLen, true);

  let pos = 44;
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(pos, samples[i], true);
    pos += 2;
  }

  return wav;
}

function formatSrtTimestamp(sec: number): string {
  const safe = Math.max(0, Number.isFinite(sec) ? sec : 0);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = Math.floor(safe % 60);
  const ms = Math.round((safe - Math.floor(safe)) * 1000);
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const pad3 = (n: number) => String(Math.min(999, n)).padStart(3, '0');
  return `${pad2(h)}:${pad2(m)}:${pad2(s)},${pad3(ms)}`;
}

function buildSrtSubtitles(turns: DialogueTurn[]): string {
  return turns
    .map((t, idx) => {
      const startSec =
        typeof t.startTime === 'number'
          ? t.startTime
          : typeof t.startSec === 'number'
          ? t.startSec
          : idx * 4;
      const endSec =
        typeof t.endTime === 'number' && t.endTime > startSec
          ? t.endTime
          : typeof t.endSec === 'number' && t.endSec > startSec
          ? t.endSec
          : startSec + Math.max(0.5, Number(t.dubbedDurationSec || t.durationSeconds || 3));
      const cleanText = String(t.text || '')
        .replace(/<\/?[a-zA-Z_\s-]+>/g, '')
        .trim();
      const speaker = t.speakerName || t.speakerId || 'Спикер';
      return `${idx + 1}\n${formatSrtTimestamp(startSec)} --> ${formatSrtTimestamp(endSec)}\n[${speaker}]: ${cleanText}\n`;
    })
    .join('\n');
}

/**
 * Pure client-side master WAV stitcher.
 * Eliminates sending 25-40 MB base64 payloads to /api/podcast/stitch-dialogue-turns
 * (which exceeds Cloud Run's 32 MB HTTP request/response limit on 5+ minute videos).
 */
export function stitchDialogueTurnsClient(input: ClientStitchInput): ClientStitchResult {
  const sampleRate = input.sampleRate || 24000;
  const turns = input.turns || [];
  const isTimeAligned = input.masterAudioMode === 'time_aligned';

  const decodedClips = turns.map((turn) => {
    let samples = new Int16Array(0);
    if (turn.audioBase64) {
      try {
        const bytes = decodeBase64ToBytes(turn.audioBase64);
        samples = extractMonoInt16Pcm(bytes, sampleRate);
      } catch {
        samples = new Int16Array(0);
      }
    }
    if (samples.length === 0) {
      samples = new Int16Array(Math.round(sampleRate * 0.5));
    }
    return { turn, samples };
  });

  let masterSamples: Int16Array;
  let totalDurationSeconds = 0;
  let updatedTurns: DialogueTurn[] = [];

  if (isTimeAligned) {
    const MAX_SHIFT_SEC = 0.3;
    const placements: Array<{
      startSec: number;
      endSec: number;
      originalDurationSec: number;
      dubbedDurationSec: number;
      syncStatus: 'ok' | 'adjusted' | 'overflow';
    }> = [];

    let nextTurnShiftSec = 0;
    let maxEndSec =
      typeof input.totalVideoDurationSec === 'number' && input.totalVideoDurationSec > 0
        ? input.totalVideoDurationSec
        : 0;

    for (let i = 0; i < decodedClips.length; i++) {
      const { turn, samples } = decodedClips[i];
      const origStartSec = Math.max(0, typeof turn.startSec === 'number' ? turn.startSec : 0);
      const dubbedDurationSec = Math.round((samples.length / sampleRate) * 100) / 100;
      const origEndSec =
        typeof turn.endSec === 'number' && turn.endSec > origStartSec
          ? turn.endSec
          : origStartSec + dubbedDurationSec;
      const originalDurationSec = Math.round((origEndSec - origStartSec) * 100) / 100;

      const appliedShift = Math.min(MAX_SHIFT_SEC, Math.max(0, nextTurnShiftSec));
      const effectiveStartSec = origStartSec + appliedShift;
      const effectiveEndSec = effectiveStartSec + dubbedDurationSec;

      const nextOrigStartSec =
        i + 1 < decodedClips.length && typeof decodedClips[i + 1].turn.startSec === 'number'
          ? decodedClips[i + 1].turn.startSec!
          : Math.max(maxEndSec, origEndSec);

      const overflowBeyondNext = effectiveEndSec - (nextOrigStartSec - 0.02);
      if (i + 1 < decodedClips.length && overflowBeyondNext > 0) {
        nextTurnShiftSec = Math.min(MAX_SHIFT_SEC, overflowBeyondNext);
      } else {
        nextTurnShiftSec = 0;
      }

      const existingSync = turn.syncStatus;
      let syncStatus: 'ok' | 'adjusted' | 'overflow' = existingSync || 'ok';
      if (!existingSync) {
        if (i + 1 < decodedClips.length && effectiveEndSec > nextOrigStartSec + MAX_SHIFT_SEC + 0.05) {
          syncStatus = 'overflow';
        } else if (appliedShift > 0.02 || (typeof turn.atempoApplied === 'number' && turn.atempoApplied > 1.01)) {
          syncStatus = 'adjusted';
        }
      }

      maxEndSec = Math.max(maxEndSec, origEndSec, effectiveEndSec);
      placements.push({
        startSec: Math.round(effectiveStartSec * 100) / 100,
        endSec: Math.round(effectiveEndSec * 100) / 100,
        originalDurationSec,
        dubbedDurationSec,
        syncStatus,
      });
    }

    const totalSamples = Math.max(sampleRate, Math.ceil(maxEndSec * sampleRate));
    masterSamples = new Int16Array(totalSamples);

    for (let i = 0; i < decodedClips.length; i++) {
      const { samples } = decodedClips[i];
      const placement = placements[i];
      const startSample = Math.max(0, Math.round(placement.startSec * sampleRate));
      const limit = Math.min(samples.length, masterSamples.length - startSample);
      for (let s = 0; s < limit; s++) {
        const mixed = masterSamples[startSample + s] + samples[s];
        masterSamples[startSample + s] =
          mixed > 32767 ? 32767 : mixed < -32768 ? -32768 : mixed;
      }
    }

    totalDurationSeconds = Math.round((masterSamples.length / sampleRate) * 10) / 10;
    updatedTurns = decodedClips.map(({ turn }, idx) => {
      const p = placements[idx];
      return {
        ...turn,
        durationSeconds: p.dubbedDurationSec,
        originalDurationSec: turn.originalDurationSec ?? p.originalDurationSec,
        dubbedDurationSec: p.dubbedDurationSec,
        syncStatus: p.syncStatus,
        startTime: p.startSec,
        endTime: p.endSec,
      };
    });
  } else {
    const pauseSamples = Math.round(sampleRate * 0.35);
    const totalSamples = Math.max(
      sampleRate,
      decodedClips.reduce((acc, c) => acc + c.samples.length + pauseSamples, 0)
    );
    masterSamples = new Int16Array(totalSamples);

    let cursor = 0;
    updatedTurns = decodedClips.map(({ turn, samples }) => {
      const startTime = Math.round((cursor / sampleRate) * 100) / 100;
      masterSamples.set(samples, cursor);
      cursor += samples.length;
      const endTime = Math.round((cursor / sampleRate) * 100) / 100;
      cursor += pauseSamples;
      const dur = Math.round((samples.length / sampleRate) * 100) / 100;
      return {
        ...turn,
        durationSeconds: dur,
        dubbedDurationSec: dur,
        startTime,
        endTime,
      };
    });
    totalDurationSeconds = Math.round((masterSamples.length / sampleRate) * 10) / 10;
  }

  const masterWavBytes = buildMono16BitWav(masterSamples, sampleRate);
  const masterAudioBase64 = encodeBytesToBase64(masterWavBytes);
  const srtSubtitles = buildSrtSubtitles(updatedTurns);

  return {
    masterAudioBase64,
    masterWavBytes,
    totalDurationSeconds,
    turns: updatedTurns,
    srtSubtitles,
  };
}
