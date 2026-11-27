import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";

export const PCM_SAMPLE_RATE = 24000;
export const PCM_BYTES_PER_SAMPLE = 2; // 16-bit mono LE
export const PCM_BYTES_PER_SEC = PCM_SAMPLE_RATE * PCM_BYTES_PER_SAMPLE; // 48000

export interface SilenceRun {
  startSample: number;
  endSample: number;
  midSample: number;
  startMs: number;
  endMs: number;
  midMs: number;
  durationMs: number;
  minRms: number;
}

export interface VadOptions {
  frameMs?: number;
  minSilenceMs?: number;
  rmsThreshold?: number; // absolute 16-bit RMS threshold (0..32768); if omitted, adaptive
}

/**
 * Извлекает 24kHz 16-bit mono PCM из WAV или сырого PCM-буфера.
 */
export function extractRawPcm24k(rawBuf: Buffer): Buffer {
  if (
    rawBuf.length > 44 &&
    rawBuf.toString("ascii", 0, 4) === "RIFF" &&
    rawBuf.toString("ascii", 8, 12) === "WAVE"
  ) {
    let offset = 12;
    while (offset + 8 <= rawBuf.length) {
      const chunkId = rawBuf.toString("ascii", offset, offset + 4);
      const chunkSize = rawBuf.readUInt32LE(offset + 4);
      if (chunkId === "data") {
        const dataEnd = Math.min(rawBuf.length, offset + 8 + chunkSize);
        const slice = rawBuf.subarray(offset + 8, dataEnd);
        const alignedLen = slice.length - (slice.length % 2);
        return Buffer.from(slice.subarray(0, alignedLen));
      }
      offset += 8 + chunkSize + (chunkSize % 2);
    }
  }
  const alignedLen = rawBuf.length - (rawBuf.length % 2);
  return Buffer.from(rawBuf.subarray(0, alignedLen));
}

/**
 * Собирает стандартный WAV-буфер (24 kHz, 16-bit mono) из PCM.
 */
export function buildWav24k(pcm: Buffer): Buffer {
  const alignedLen = pcm.length - (pcm.length % 2);
  const cleanPcm = alignedLen === pcm.length ? pcm : pcm.subarray(0, alignedLen);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + cleanPcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(PCM_SAMPLE_RATE, 24);
  header.writeUInt32LE(PCM_BYTES_PER_SEC, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(cleanPcm.length, 40);
  return Buffer.concat([header, cleanPcm]);
}

/**
 * Вычисляет массив RMS-энергий по фреймам (по умолчанию 10 мс = 240 сэмплов).
 */
export function computeFrameRms(pcm: Buffer, frameMs: number = 10): {
  frameSamples: number;
  rms: Float32Array;
} {
  const frameSamples = Math.max(24, Math.round((PCM_SAMPLE_RATE * frameMs) / 1000));
  const totalSamples = Math.floor(pcm.length / 2);
  const numFrames = Math.floor(totalSamples / frameSamples);
  const rms = new Float32Array(numFrames);

  for (let f = 0; f < numFrames; f++) {
    let sumSq = 0;
    const baseSample = f * frameSamples;
    for (let s = 0; s < frameSamples; s++) {
      const val = pcm.readInt16LE((baseSample + s) * 2);
      sumSq += val * val;
    }
    rms[f] = Math.sqrt(sumSq / frameSamples);
  }
  return { frameSamples, rms };
}

/**
 * Находит все интервалы тишины (паузы) в 24kHz PCM с адаптивным порогом шума.
 */
export function detectSilenceRuns(pcm: Buffer, opts: VadOptions = {}): SilenceRun[] {
  const frameMs = opts.frameMs ?? 10;
  const minSilenceMs = opts.minSilenceMs ?? 180;
  const { frameSamples, rms } = computeFrameRms(pcm, frameMs);
  const numFrames = rms.length;
  if (numFrames < 5) return [];

  // Адаптивный порог тишины на основе распределения громкости
  let threshold = opts.rmsThreshold;
  if (typeof threshold !== "number") {
    const sorted = Array.from(rms).sort((a, b) => a - b);
    const p10 = sorted[Math.floor(sorted.length * 0.1)] || 0;
    const p80 = sorted[Math.floor(sorted.length * 0.8)] || 1500;
    // Тишина — всё ниже max(220, min(650, max(p10 * 3.0, p80 * 0.08)))
    threshold = Math.max(200, Math.min(650, Math.max(p10 * 3.0, p80 * 0.08)));
  }

  const minSilenceFrames = Math.max(1, Math.ceil(minSilenceMs / frameMs));
  const runs: SilenceRun[] = [];

  let inSilence = false;
  let runStartFrame = 0;
  let runMinRms = Infinity;

  const pushRun = (startF: number, endF: number, minRms: number) => {
    const lenFrames = endF - startF;
    if (lenFrames < minSilenceFrames) return;
    // Игнорируем самую начальную (до речи) и самую конечную (после речи) тишину
    if (startF <= 2 || endF >= numFrames - 2) return;

    const startSample = startF * frameSamples;
    const endSample = endF * frameSamples;

    // Выбираем самую тихую точку внутри центральной зоны паузы для максимально чистого реза
    const innerStart = startF + Math.floor(lenFrames * 0.25);
    const innerEnd = Math.max(innerStart + 1, endF - Math.floor(lenFrames * 0.25));
    let bestFrame = Math.floor((startF + endF) / 2);
    let bestEnergy = Infinity;
    for (let f = innerStart; f < innerEnd; f++) {
      if (rms[f] < bestEnergy) {
        bestEnergy = rms[f];
        bestFrame = f;
      }
    }
    const midSample = bestFrame * frameSamples + Math.floor(frameSamples / 2);
    const startMs = Math.round((startSample / PCM_SAMPLE_RATE) * 1000);
    const endMs = Math.round((endSample / PCM_SAMPLE_RATE) * 1000);
    const midMs = Math.round((midSample / PCM_SAMPLE_RATE) * 1000);

    runs.push({
      startSample,
      endSample,
      midSample,
      startMs,
      endMs,
      midMs,
      durationMs: endMs - startMs,
      minRms: Math.round(minRms),
    });
  };

  for (let f = 0; f < numFrames; f++) {
    const isQuiet = rms[f] <= threshold;
    if (isQuiet) {
      if (!inSilence) {
        inSilence = true;
        runStartFrame = f;
        runMinRms = rms[f];
      } else if (rms[f] < runMinRms) {
        runMinRms = rms[f];
      }
    } else if (inSilence) {
      pushRun(runStartFrame, f, runMinRms);
      inSilence = false;
      runMinRms = Infinity;
    }
  }
  if (inSilence) {
    pushRun(runStartFrame, numFrames, runMinRms);
  }

  return runs;
}

/**
 * Применяет мягкий fade-in / fade-out (по умолчанию 8 мс) на краях PCM-клипа, чтобы исключить щелчки при склейке.
 */
export function applyMicroEdgeFades(pcm: Buffer, fadeMs: number = 8): Buffer {
  const out = Buffer.from(pcm);
  const totalSamples = Math.floor(out.length / 2);
  const fadeSamples = Math.min(Math.floor((PCM_SAMPLE_RATE * fadeMs) / 1000), Math.floor(totalSamples / 4));
  if (fadeSamples <= 1) return out;

  for (let i = 0; i < fadeSamples; i++) {
    const gainIn = i / fadeSamples;
    const sIn = out.readInt16LE(i * 2);
    out.writeInt16LE(Math.round(sIn * gainIn), i * 2);

    const endIdx = totalSamples - 1 - i;
    const sOut = out.readInt16LE(endIdx * 2);
    out.writeInt16LE(Math.round(sOut * gainIn), endIdx * 2);
  }
  return out;
}

/**
 * Применяет плавный fade-out (например 120 мс) в конце PCM-клипа (для overflow без обрыва слова).
 */
export function applyTailFadeOut(pcm: Buffer, fadeMs: number = 120): Buffer {
  const out = Buffer.from(pcm);
  const totalSamples = Math.floor(out.length / 2);
  const fadeSamples = Math.min(Math.floor((PCM_SAMPLE_RATE * fadeMs) / 1000), Math.floor(totalSamples / 2));
  if (fadeSamples <= 1) return out;

  const startIdx = totalSamples - fadeSamples;
  for (let i = 0; i < fadeSamples; i++) {
    const gain = 1 - i / fadeSamples;
    const idx = startIdx + i;
    const s = out.readInt16LE(idx * 2);
    out.writeInt16LE(Math.round(s * gain), idx * 2);
  }
  return out;
}

/**
 * Ищет ближайший локальный минимум энергии в окне ±searchWindowMs вокруг заданной точки времени (в секундах),
 * чтобы рез НИКОГДА не попадал внутрь слова.
 */
export function refineCutSampleToEnergyMinimum(
  pcm: Buffer,
  targetSec: number,
  searchWindowMs: number = 220
): number {
  const totalSamples = Math.floor(pcm.length / 2);
  const targetSample = Math.max(0, Math.min(totalSamples, Math.round(targetSec * PCM_SAMPLE_RATE)));
  const windowSamples = Math.round((PCM_SAMPLE_RATE * searchWindowMs) / 1000);
  const fromSample = Math.max(0, targetSample - windowSamples);
  const toSample = Math.min(totalSamples, targetSample + windowSamples);

  const step = 240; // 10ms
  let bestSample = targetSample;
  let bestScore = Infinity;

  for (let s = fromSample; s + step <= toSample; s += step) {
    let sumSq = 0;
    for (let k = 0; k < step; k++) {
      const v = pcm.readInt16LE((s + k) * 2);
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / step);
    // Лёгкий штраф за удаление от targetSample, но приоритет — минимальная энергия (тишина)
    const distNorm = Math.abs(s + step / 2 - targetSample) / Math.max(1, windowSamples);
    const score = rms * (1 + distNorm * 0.25);
    if (score < bestScore) {
      bestScore = score;
      bestSample = s + Math.floor(step / 2);
    }
  }
  return bestSample;
}

export interface TimedPauseMarker {
  /** Доля произносимого текста до этой паузы (0..1) */
  relativePos: number;
  /** Целевая длительность паузы в секундах (1..3) */
  targetDurationSec: number;
}

/**
 * Часть 1.5: Растягивает найденные VAD-паузы внутри единого PCM-чанка до целевых [pauza Ns] секунд
 * без дополнительных вызовов TTS!
 * - Каждая [pauza Ns] перед отправкой в TTS заменялась на `<short pause>`.
 * - Здесь ищем ближайшую реальную паузу в звуке к доле текста `relativePos` (в монотонном порядке)
 *   и вставляем недостающий нулевой PCM, чтобы полная пауза составила ровно `targetDurationSec` (с учётом speedFactor).
 * - Если подходящей паузы рядом нет — оставляем естественную паузу модели без лишних вызовов.
 */
export function stretchTimedPausesInPcm(
  pcm: Buffer,
  markers: TimedPauseMarker[],
  speedFactor: number = 1.0
): {
  pcm: Buffer;
  matchedCount: number;
  missedCount: number;
  details: Array<{
    expectedMs: number;
    matchedMs: number | null;
    existingPauseMs: number;
    insertedSilenceMs: number;
    targetPauseMs: number;
  }>;
} {
  if (!markers || markers.length === 0 || pcm.length < 4800) {
    return { pcm, matchedCount: 0, missedCount: 0, details: [] };
  }

  const totalSamples = Math.floor(pcm.length / 2);
  const totalMs = (totalSamples / PCM_SAMPLE_RATE) * 1000;

  // Находим все паузы >= 110 мс (естественные <short pause> обычно 160–550 мс)
  const silenceRuns = detectSilenceRuns(pcm, { frameMs: 10, minSilenceMs: 110 });
  if (silenceRuns.length === 0) {
    return {
      pcm,
      matchedCount: 0,
      missedCount: markers.length,
      details: markers.map((m) => ({
        expectedMs: Math.round(m.relativePos * totalMs),
        matchedMs: null,
        existingPauseMs: 0,
        insertedSilenceMs: 0,
        targetPauseMs: Math.round(m.targetDurationSec * 1000),
      })),
    };
  }

  // Окно поиска вокруг ожидаемой позиции: адаптивное, не менее ±2.2с и до ±18% длины аудио (макс ±6.5с)
  const searchRadiusMs = Math.max(2200, Math.min(6500, totalMs * 0.18));

  const chosenInsertions: Array<{
    sampleIndex: number;
    addSamples: number;
    detail: {
      expectedMs: number;
      matchedMs: number | null;
      existingPauseMs: number;
      insertedSilenceMs: number;
      targetPauseMs: number;
    };
  }> = [];

  let lastMatchedSample = 0;
  let matchedCount = 0;
  let missedCount = 0;

  for (const marker of markers) {
    const expectedMs = Math.round(marker.relativePos * totalMs);
    const targetMsAfterAtempo = Math.round(marker.targetDurationSec * 1000);
    // До atempo нужна пауза targetDurationSec * speedFactor, чтобы после ffmpeg atempo осталась ровно targetDurationSec
    const targetRawMs = Math.round(targetMsAfterAtempo * speedFactor);

    let bestRun: SilenceRun | null = null;
    let bestCost = Infinity;

    for (const run of silenceRuns) {
      if (run.midSample <= lastMatchedSample + Math.round(PCM_SAMPLE_RATE * 0.18)) {
        continue;
      }
      const distMs = Math.abs(run.midMs - expectedMs);
      if (distMs > searchRadiusMs) continue;

      // Предпочитаем паузу ближе к expectedMs и достаточно длинную (>= 160 мс получает бонус)
      const durationBonus = Math.min(350, run.durationMs) * 0.65;
      const cost = distMs - durationBonus;
      if (cost < bestCost) {
        bestCost = cost;
        bestRun = run;
      }
    }

    if (!bestRun) {
      missedCount++;
      chosenInsertions.push({
        sampleIndex: -1,
        addSamples: 0,
        detail: {
          expectedMs,
          matchedMs: null,
          existingPauseMs: 0,
          insertedSilenceMs: 0,
          targetPauseMs: targetMsAfterAtempo,
        },
      });
      continue;
    }

    matchedCount++;
    lastMatchedSample = bestRun.endSample;

    const neededExtraMs = Math.max(0, targetRawMs - bestRun.durationMs);
    const addSamples = Math.round((neededExtraMs / 1000) * PCM_SAMPLE_RATE);

    chosenInsertions.push({
      sampleIndex: bestRun.midSample,
      addSamples,
      detail: {
        expectedMs,
        matchedMs: bestRun.midMs,
        existingPauseMs: bestRun.durationMs,
        insertedSilenceMs: Math.round(neededExtraMs / Math.max(0.5, speedFactor)),
        targetPauseMs: targetMsAfterAtempo,
      },
    });
  }

  // Собираем новый PCM-буфер со вставками нулевой тишины в найденных точках
  const validInsertions = chosenInsertions
    .filter((ins) => ins.sampleIndex > 0 && ins.addSamples > 0)
    .sort((a, b) => a.sampleIndex - b.sampleIndex);

  if (validInsertions.length === 0) {
    return {
      pcm,
      matchedCount,
      missedCount,
      details: chosenInsertions.map((c) => c.detail),
    };
  }

  const parts: Buffer[] = [];
  let cursorSample = 0;
  for (const ins of validInsertions) {
    if (ins.sampleIndex > cursorSample) {
      const slice = pcm.subarray(cursorSample * 2, ins.sampleIndex * 2);
      parts.push(applyMicroEdgeFades(slice, 5));
    }
    parts.push(Buffer.alloc(ins.addSamples * 2, 0));
    cursorSample = ins.sampleIndex;
  }
  if (cursorSample < totalSamples) {
    parts.push(applyMicroEdgeFades(pcm.subarray(cursorSample * 2, totalSamples * 2), 5));
  }

  return {
    pcm: Buffer.concat(parts),
    matchedCount,
    missedCount,
    details: chosenInsertions.map((c) => c.detail),
  };
}

export interface SlicedTurnClip {
  index: number;
  pcm: Buffer;
  startMs: number;
  endMs: number;
  durationSec: number;
  method: "vad_exact" | "vad_dp" | "transcribe_aligned" | "single_fallback";
  spokenText?: string;
  detectedVoice?: "male" | "female" | "unknown";
  boundarySnapped?: boolean;
  boundaryIssue?: string;
}

/**
 * Находит ближайшую паузу-кандидат (>= 120 мс) в пределах ±maxToleranceSec (по умолчанию 0.6 с)
 * от целевой границы модели. Если подходящей паузы нет — возвращает null (брак границы).
 */
export function findNearestSilenceCandidate(
  pauses: SilenceRun[],
  targetSec: number,
  maxToleranceSec: number = 0.6,
  minSampleExclusive: number = -1
): SilenceRun | null {
  let best: SilenceRun | null = null;
  let bestDist = Infinity;

  for (const run of pauses) {
    if (run.midSample <= minSampleExclusive) continue;
    const startSec = run.startMs / 1000;
    const endSec = run.endMs / 1000;
    const midSec = run.midMs / 1000;
    const distToInterval =
      targetSec < startSec ? startSec - targetSec : targetSec > endSec ? targetSec - endSec : 0;
    const distToMid = Math.abs(midSec - targetSec);
    if (distToInterval > maxToleranceSec && distToMid > maxToleranceSec) continue;

    // Приоритет: минимальное расстояние до интервала паузы, затем до середины паузы
    const score = distToInterval * 10 + distToMid;
    if (score < bestDist) {
      bestDist = score;
      best = run;
    }
  }
  return best;
}

/**
 * Нарезает единый PCM-буфер блока на `expectedTexts.length` реплик с помощью VAD (детектора тишины).
 * Стратегия:
 * 1. Если найдено ровно N-1 явных пауз >= minSilenceMs -> точная 1:1 нарезка (method = "vad_exact").
 * 2. Если найдено больше пауз (например, из-за внутрифразовых пауз), выбирает N-1 самых сильных пауз
 *    динамическим программированием, сопоставляя с ожидаемыми долями длины текстов (method = "vad_dp"),
 *    но только если разброс пропорций в пределах доверительного коридора!
 * 3. Если надёжно нарезать VAD невозможно — возвращает `reliable: false`, чтобы переключиться на `gemini-3.5-transcribe`.
 */
export function sliceBatchPcmByVad(
  pcm: Buffer,
  expectedTexts: string[],
  opts: { minSilenceMs?: number; rmsThreshold?: number } = {}
): {
  reliable: boolean;
  reason: string;
  detectedPauseCount: number;
  clips: SlicedTurnClip[];
  pauses: SilenceRun[];
} {
  const n = expectedTexts.length;
  const totalSamples = Math.floor(pcm.length / 2);
  const totalMs = Math.round((totalSamples / PCM_SAMPLE_RATE) * 1000);

  if (n <= 0) {
    return { reliable: true, reason: "empty", detectedPauseCount: 0, clips: [], pauses: [] };
  }
  if (n === 1) {
    const clean = applyMicroEdgeFades(pcm, 6);
    return {
      reliable: true,
      reason: "single_turn",
      detectedPauseCount: 0,
      pauses: [],
      clips: [
        {
          index: 0,
          pcm: clean,
          startMs: 0,
          endMs: totalMs,
          durationSec: Math.round((clean.length / PCM_BYTES_PER_SEC) * 100) / 100,
          method: "vad_exact",
        },
      ],
    };
  }

  const neededCuts = n - 1;
  // Сначала пробуем строгий порог паузы (по умолчанию 320 мс — межрепликовые паузы обычно длиннее внутрифразовых)
  const primaryMinMs = opts.minSilenceMs ?? 320;
  let pauses = detectSilenceRuns(pcm, {
    frameMs: 10,
    minSilenceMs: primaryMinMs,
    rmsThreshold: opts.rmsThreshold,
  });

  // Если на строгом пороге пауз меньше, чем нужно, пробуем чуть мягче (200 мс)
  if (pauses.length < neededCuts && primaryMinMs > 200) {
    pauses = detectSilenceRuns(pcm, {
      frameMs: 10,
      minSilenceMs: 200,
      rmsThreshold: opts.rmsThreshold,
    });
  }

  // Ожидаемые доли текста для каждой границы 1..N-1
  const weights = expectedTexts.map((t) =>
    Math.max(4, (t || "").replace(/<[^>]+>/g, "").trim().length)
  );
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const expectedCutRatios: number[] = [];
  let cum = 0;
  for (let i = 0; i < neededCuts; i++) {
    cum += weights[i];
    expectedCutRatios.push(cum / totalWeight);
  }

  const buildClipsFromCutSamples = (
    cutSamples: number[],
    method: "vad_exact" | "vad_dp"
  ): SlicedTurnClip[] => {
    const bounds = [0, ...cutSamples, totalSamples];
    const clips: SlicedTurnClip[] = [];
    for (let i = 0; i < n; i++) {
      const s0 = Math.max(0, bounds[i]);
      const s1 = Math.min(totalSamples, bounds[i + 1]);
      const rawSlice = pcm.subarray(s0 * 2, s1 * 2);
      const clean = trimSilenceEdgesPcm(rawSlice);
      clips.push({
        index: i,
        pcm: clean,
        startMs: Math.round((s0 / PCM_SAMPLE_RATE) * 1000),
        endMs: Math.round((s1 / PCM_SAMPLE_RATE) * 1000),
        durationSec: Math.round((clean.length / PCM_BYTES_PER_SEC) * 100) / 100,
        method,
      });
    }
    return clips;
  };

  // Случай 1: Ровное совпадение числа пауз (P === N - 1)
  if (pauses.length === neededCuts) {
    const clips = buildClipsFromCutSamples(
      pauses.map((p) => p.midSample),
      "vad_exact"
    );
    const hasEmptyClip = clips.some((c) => c.durationSec < 0.18);
    if (!hasEmptyClip) {
      return {
        reliable: true,
        reason: `vad_exact (${pauses.length} pauses == ${neededCuts} cuts)`,
        detectedPauseCount: pauses.length,
        clips,
        pauses,
      };
    }
  }

  // Случай 2: Пауз больше (например, 35 пауз для 24 границ) — выбираем N-1 оптимальных монотонных границ через DP
  if (pauses.length > neededCuts) {
    const M = pauses.length;
    const K = neededCuts;
    // dp[k][m] = минимальная стоимость выбрать k-ю границу (0..K-1) на паузе m (0..M-1)
    const INF = 1e12;
    const dp: number[][] = Array.from({ length: K }, () => new Array(M).fill(INF));
    const parent: number[][] = Array.from({ length: K }, () => new Array(M).fill(-1));

    const maxDur = Math.max(1, ...pauses.map((p) => p.durationMs));
    const costOf = (k: number, m: number): number => {
      const actualRatio = pauses[m].midSample / Math.max(1, totalSamples);
      const expectedRatio = expectedCutRatios[k];
      const posErr = Math.abs(actualRatio - expectedRatio);
      // Сильный бонус за длинную паузу (межрепликовая пауза длиннее запятой)
      const durPenalty = (1 - pauses[m].durationMs / maxDur) * 0.045;
      return posErr + durPenalty;
    };

    for (let m = 0; m < M; m++) {
      dp[0][m] = costOf(0, m);
    }
    for (let k = 1; k < K; k++) {
      for (let m = k; m < M; m++) {
        const c = costOf(k, m);
        for (let prev = k - 1; prev < m; prev++) {
          if (dp[k - 1][prev] >= INF) continue;
          // Между соседними репликами должно быть минимум 220 мс речи
          if (pauses[m].startMs - pauses[prev].endMs < 220) continue;
          const cand = dp[k - 1][prev] + c;
          if (cand < dp[k][m]) {
            dp[k][m] = cand;
            parent[k][m] = prev;
          }
        }
      }
    }

    let bestLast = -1;
    let bestTotal = INF;
    for (let m = K - 1; m < M; m++) {
      if (dp[K - 1][m] < bestTotal) {
        bestTotal = dp[K - 1][m];
        bestLast = m;
      }
    }

    if (bestLast !== -1) {
      const selectedIndices = new Array<number>(K);
      let cur = bestLast;
      for (let k = K - 1; k >= 0; k--) {
        selectedIndices[k] = cur;
        cur = parent[k][cur];
      }

      const avgPosErr =
        selectedIndices.reduce((acc, m, k) => {
          const r = pauses[m].midSample / Math.max(1, totalSamples);
          return acc + Math.abs(r - expectedCutRatios[k]);
        }, 0) / K;

      const minSelectedPauseMs = Math.min(...selectedIndices.map((m) => pauses[m].durationMs));
      const clips = buildClipsFromCutSamples(
        selectedIndices.map((m) => pauses[m].midSample),
        "vad_dp"
      );
      const hasEmptyClip = clips.some((c) => c.durationSec < 0.22);

      // Считаем VAD-DP надёжным ТОЛЬКО если средняя ошибка позиции < 6% и каждая выбранная пауза >= 280 мс
      const isReliable = !hasEmptyClip && avgPosErr < 0.06 && minSelectedPauseMs >= 280;
      return {
        reliable: isReliable,
        reason: `vad_dp (detected=${pauses.length}, needed=${neededCuts}, avgPosErr=${(avgPosErr * 100).toFixed(1)}%, minPause=${minSelectedPauseMs}ms)`,
        detectedPauseCount: pauses.length,
        clips,
        pauses,
      };
    }
  }

  return {
    reliable: false,
    reason: `vad_insufficient_pauses (detected=${pauses.length}, needed=${neededCuts})`,
    detectedPauseCount: pauses.length,
    clips: [],
    pauses,
  };
}

export interface TrimSilenceEdgesOptions {
  /** Длительность RMS-окна в мс (по умолчанию 10 мс). */
  frameMs?: number;
  /** Минимальный абсолютный порог речи в dBFS (по умолчанию -45 dBFS). */
  minThresholdDbfs?: number;
  /** Смещение порога ниже уровня речи клипа (95-й перцентиль RMS) в dB (по умолчанию 35 dB). */
  relativeBelowSpeechDb?: number;
  /** Минимальная длительность непрерывной речи в мс (всплески короче игнорируются; по умолчанию 30 мс). */
  minSpeechRunMs?: number;
  /** Запас тишины перед началом речи в мс (по умолчанию 40 мс). */
  leadMarginMs?: number;
  /** Запас тишины после конца речи в мс (по умолчанию 80 мс). */
  tailMarginMs?: number;
  /** Плавный fade-in в начале клипа в мс (по умолчанию 10 мс). */
  fadeInMs?: number;
  /** Плавный fade-out в конце клипа в мс (по умолчанию 8 мс). */
  fadeOutMs?: number;
}

/**
 * Обрезает краевую тишину отдельной реплики по 10 мс RMS-окнам (до выравнивания громкости):
 * - речь = окно с RMS выше max(-45 dBFS, 95-й перцентиль RMS клипа - 35 dB);
 * - всплески короче 30 мс подряд не считаются речью;
 * - оставляет 40 мс до начала речи и 80 мс после конца;
 * - применяет fade-in 10 мс (и мягкий fade-out 8 мс в конце запаса);
 * - не режет тихие начальные согласные (H, X, Q, S) выше порога и смех/вдох внутри/в конце клипа.
 */
export function trimSilenceEdgesPcm(
  pcm: Buffer,
  optionsOrMarginMs?: number | TrimSilenceEdgesOptions
): Buffer {
  const totalSamples = Math.floor(pcm.length / 2);
  if (totalSamples < 480) return Buffer.from(pcm);

  const opts: TrimSilenceEdgesOptions =
    typeof optionsOrMarginMs === "number"
      ? { leadMarginMs: optionsOrMarginMs, tailMarginMs: Math.max(optionsOrMarginMs, 80) }
      : optionsOrMarginMs || {};

  const frameMs = opts.frameMs ?? 10;
  const minThresholdDbfs = opts.minThresholdDbfs ?? -45;
  const relativeBelowSpeechDb = opts.relativeBelowSpeechDb ?? 35;
  const minSpeechRunMs = opts.minSpeechRunMs ?? 30;
  const leadMarginMs = opts.leadMarginMs ?? 40;
  const tailMarginMs = opts.tailMarginMs ?? 80;
  const fadeInMs = opts.fadeInMs ?? 10;
  const fadeOutMs = opts.fadeOutMs ?? 8;

  const windowSamples = Math.max(24, Math.round((PCM_SAMPLE_RATE * frameMs) / 1000));
  const numWindows = Math.ceil(totalSamples / windowSamples);
  const minSpeechWindows = Math.max(1, Math.ceil(minSpeechRunMs / frameMs));

  const applyEdgeFades = (buf: Buffer): Buffer => {
    const out = Buffer.from(buf);
    const n = Math.floor(out.length / 2);
    if (n <= 2) return out;
    const inSamples = Math.min(Math.round((PCM_SAMPLE_RATE * fadeInMs) / 1000), Math.floor(n / 4));
    for (let i = 0; i < inSamples; i++) {
      const gain = i / inSamples;
      out.writeInt16LE(Math.round(out.readInt16LE(i * 2) * gain), i * 2);
    }
    const outSamples = Math.min(Math.round((PCM_SAMPLE_RATE * fadeOutMs) / 1000), Math.floor(n / 4));
    for (let i = 0; i < outSamples; i++) {
      const gain = i / outSamples;
      const idx = n - 1 - i;
      out.writeInt16LE(Math.round(out.readInt16LE(idx * 2) * gain), idx * 2);
    }
    return out;
  };

  if (numWindows < minSpeechWindows) {
    return applyEdgeFades(pcm);
  }

  // 1) Считаем RMS в dBFS для каждого 10 мс окна
  const rmsDb = new Float32Array(numWindows);
  for (let w = 0; w < numWindows; w++) {
    const sStart = w * windowSamples;
    const sEnd = Math.min(totalSamples, sStart + windowSamples);
    const count = sEnd - sStart;
    if (count <= 0) {
      rmsDb[w] = -120;
      continue;
    }
    let sumSq = 0;
    for (let s = sStart; s < sEnd; s++) {
      const v = pcm.readInt16LE(s * 2);
      sumSq += v * v;
    }
    const rmsNorm = Math.sqrt(sumSq / count) / 32768;
    rmsDb[w] = rmsNorm > 1e-6 ? 20 * Math.log10(rmsNorm) : -120;
  }

  // 2) Уровень речи клипа = 95-й перцентиль RMS окон клипа
  const sortedDb = Array.from(rmsDb).sort((a, b) => a - b);
  const p95Idx = Math.min(sortedDb.length - 1, Math.floor(0.95 * (sortedDb.length - 1)));
  const speechLevelDb = sortedDb[p95Idx];
  const thresholdDb = Math.max(minThresholdDbfs, speechLevelDb - relativeBelowSpeechDb);

  // 3) Ищем первый и последний непрерывный участок речи длиной >= 30 мс (>= 3 окна по 10 мс)
  let firstSpeechWindow = -1;
  let lastSpeechWindowEnd = -1;
  let runStart = -1;

  const commitRun = (startW: number, endW: number) => {
    if (endW - startW >= minSpeechWindows) {
      if (firstSpeechWindow < 0) firstSpeechWindow = startW;
      lastSpeechWindowEnd = endW;
    }
  };

  for (let w = 0; w < numWindows; w++) {
    if (rmsDb[w] > thresholdDb) {
      if (runStart < 0) runStart = w;
    } else if (runStart >= 0) {
      commitRun(runStart, w);
      runStart = -1;
    }
  }
  if (runStart >= 0) {
    commitRun(runStart, numWindows);
  }

  if (firstSpeechWindow < 0 || lastSpeechWindowEnd <= firstSpeechWindow) {
    return applyEdgeFades(pcm);
  }

  // 4) Оставляем 40 мс до начала речи и 80 мс после конца, затем fade-in 10 мс
  const leadSamples = Math.round((PCM_SAMPLE_RATE * leadMarginMs) / 1000);
  const tailSamples = Math.round((PCM_SAMPLE_RATE * tailMarginMs) / 1000);
  const s0 = Math.max(0, firstSpeechWindow * windowSamples - leadSamples);
  const s1 = Math.min(totalSamples, lastSpeechWindowEnd * windowSamples + tailSamples);

  if (s1 <= s0) {
    return applyEdgeFades(pcm);
  }

  return applyEdgeFades(Buffer.from(pcm.subarray(s0 * 2, s1 * 2)));
}

export interface TranscribeTurnAlignment {
  index: number;
  startSec: number;
  endSec: number;
  found: boolean;
  voice: "male" | "female" | "unknown";
  spokenText: string;
  boundarySnapped: boolean;
  boundaryIssue?: string;
}

export interface TranscribeAlignedResult {
  success: boolean;
  clips: Array<SlicedTurnClip | null>;
  turnAlignments: TranscribeTurnAlignment[];
  missingIndices: number[];
  rawSegmentsCount: number;
  wallTimeMs: number;
  heardTranscript?: string;
  usedApiCall: boolean;
  error?: string;
}

export interface AlignExpectedTurnInput {
  index: number;
  speaker: string;
  text: string;
  gender?: "male" | "female";
}

export interface FakeTurnAlignmentOverride {
  spokenText?: string;
  voice?: "male" | "female" | "unknown";
  boundarySnapped?: boolean;
  boundaryIssue?: string;
}

export function isFakeDubbingTtsEnabled(): boolean {
  return process.env.DUBBING_FAKE_TTS === "1";
}

let fakeTranscribeQaOverride:
  | ((expectedTurns: Array<{ index: number; speaker: string; text: string }>) => string | null)
  | null = null;

export function setFakeTranscribeQaOverrideForTesting(
  fn: ((expectedTurns: Array<{ index: number; speaker: string; text: string }>) => string | null) | null
) {
  fakeTranscribeQaOverride = fn;
}

/**
 * Генерирует чистый синтетический тон 24kHz 16-bit mono PCM заданной длительности
 * (используется в тестовом режиме DUBBING_FAKE_TTS=1 — 0 реальных вызовов API).
 */
export function generateSyntheticTurnPcm(
  durationSec: number,
  freqHz: number = 340,
  amplitude: number = 9000
): Buffer {
  const safeDur = Math.max(0.25, Number.isFinite(durationSec) ? durationSec : 1.0);
  const totalSamples = Math.max(480, Math.round(safeDur * PCM_SAMPLE_RATE));
  const pcm = Buffer.alloc(totalSamples * 2);
  const omega = (2 * Math.PI * freqHz) / PCM_SAMPLE_RATE;
  for (let i = 0; i < totalSamples; i++) {
    const sample = Math.round(Math.sin(omega * i) * amplitude);
    pcm.writeInt16LE(sample, i * 2);
  }
  return applyMicroEdgeFades(pcm, 10);
}

/**
 * Генерирует реалистичную тишину/шумовой пол TTS (-60..-72 dB) с короткими шумовыми всплесками
 * (для тестов DUBBING_FAKE_TTS=1 — имитирует реальную паузу Gemini TTS перед репликой).
 */
export function generateSyntheticNoisySilencePcm(
  durationSec: number,
  options?: {
    noiseRmsDbfs?: number;
    spikeCount?: number;
    spikeSamples?: number;
    spikeAmplitude?: number;
    seed?: number;
  }
): Buffer {
  const totalSamples = Math.max(0, Math.round(Math.max(0, durationSec) * PCM_SAMPLE_RATE));
  if (totalSamples === 0) return Buffer.alloc(0);
  const buf = Buffer.alloc(totalSamples * 2);
  const noiseDbfs = options?.noiseRmsDbfs ?? -64;
  // Для равномерного шума [-A, A] RMS = A / sqrt(3) -> A = RMS * sqrt(3)
  const noisePeak = Math.min(32767, Math.pow(10, noiseDbfs / 20) * 32768 * Math.sqrt(3));
  let state = (options?.seed ?? 1337) >>> 0;
  const nextRand = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state / 0xffffffff) * 2 - 1;
  };

  for (let i = 0; i < totalSamples; i++) {
    const v = Math.round(nextRand() * noisePeak);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, v)), i * 2);
  }

  const spikeCount = options?.spikeCount ?? 3;
  const spikeSamples = options?.spikeSamples ?? 120;
  const spikeAmp = options?.spikeAmplitude ?? 160;
  if (spikeCount > 0 && totalSamples > spikeSamples * 2) {
    for (let k = 0; k < spikeCount; k++) {
      const center = Math.floor(((k + 1) / (spikeCount + 1)) * totalSamples);
      const start = Math.max(0, Math.min(totalSamples - spikeSamples, center - Math.floor(spikeSamples / 2)));
      for (let j = 0; j < spikeSamples; j++) {
        const env = Math.sin((Math.PI * j) / Math.max(1, spikeSamples - 1));
        const s = Math.round(Math.sin((2 * Math.PI * 900 * j) / PCM_SAMPLE_RATE) * spikeAmp * env);
        buf.writeInt16LE(Math.max(-32768, Math.min(32767, s)), (start + j) * 2);
      }
    }
  }
  return buf;
}

/**
 * Собирает синтетический блочный PCM из списка реплик с длительностью (syllables / 4.8) с
 * и чистыми паузами 450 мс между репликами, чтобы VAD-нарезка и QA работали 1:1.
 */
export function generateSyntheticBlockPcm(
  turns: Array<{
    syllables: number;
    speakerKey?: string;
    overrideDurationSec?: number;
    leadingNoiseSec?: number;
  }>,
  interTurnSilenceSec: number = 0.45
): {
  pcm: Buffer;
  boundaries: Array<{ startSec: number; endSec: number; durationSec: number }>;
} {
  const parts: Buffer[] = [];
  const boundaries: Array<{ startSec: number; endSec: number; durationSec: number }> = [];
  const silenceBuf = Buffer.alloc(Math.round(interTurnSilenceSec * PCM_SAMPLE_RATE) * 2, 0);
  const speakerFreqMap = new Map<string, number>();
  const freqPalette = [320, 440, 380, 510];

  let cursorSec = 0;
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    const spKey = t.speakerKey || "default";
    let freq = speakerFreqMap.get(spKey);
    if (!freq) {
      freq = freqPalette[speakerFreqMap.size % freqPalette.length];
      speakerFreqMap.set(spKey, freq);
    }
    if (typeof t.leadingNoiseSec === "number" && t.leadingNoiseSec > 0) {
      const noiseBuf = generateSyntheticNoisySilencePcm(t.leadingNoiseSec, {
        noiseRmsDbfs: -64,
        spikeCount: 3,
        spikeSamples: 120,
        spikeAmplitude: 240,
        seed: 7001 + i * 97,
      });
      parts.push(noiseBuf);
      cursorSec += noiseBuf.length / PCM_BYTES_PER_SEC;
    }
    const dur =
      typeof t.overrideDurationSec === "number" && t.overrideDurationSec > 0
        ? t.overrideDurationSec
        : Math.max(0.35, Math.max(1, t.syllables) / 4.8);
    const tonePcm = generateSyntheticTurnPcm(dur, freq);
    const actualDur = tonePcm.length / PCM_BYTES_PER_SEC;
    boundaries.push({
      startSec: cursorSec,
      endSec: cursorSec + actualDur,
      durationSec: actualDur,
    });
    parts.push(tonePcm);
    cursorSec += actualDur;
    if (i + 1 < turns.length) {
      parts.push(silenceBuf);
      cursorSec += interTurnSilenceSec;
    }
  }
  return { pcm: Buffer.concat(parts), boundaries };
}

export interface ParsedAlignmentRow {
  startSec: number;
  endSec: number;
  found: boolean;
  voice: "male" | "female" | "unknown";
  spokenText: string;
}

function normalizeAlignmentVoiceTag(raw?: unknown): "male" | "female" | "unknown" {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "male" || v === "m" || v === "man" || v === "муж" || v === "м") return "male";
  if (v === "female" || v === "f" || v === "woman" || v === "жен" || v === "ж") return "female";
  return "unknown";
}

/**
 * Парсит ответ модели выравнивания:
 * 1) Структурированный JSON `{ turns: [{ index, startSec, endSec, found, voice, spokenText }] }`
 *    (или JSON-массив `[...]`, с опциональными markdown-ограждениями ```json ... ```);
 * 2) Резервный текстовый формат `INDEX | START_SEC | END_SEC | FOUND | VOICE | SPOKEN_TEXT`.
 * Если модель вернула обычный сплошной текст без структуры (как gemini-3.5-transcribe),
 * вернёт пустую Map.
 */
export function parseAlignmentModelOutput(rawText: string): Map<number, ParsedAlignmentRow> {
  const segMap = new Map<number, ParsedAlignmentRow>();
  const trimmed = String(rawText || "").trim();
  if (!trimmed) return segMap;

  // 1) Попытка распарсить JSON (в том числе в ```json ... ```)
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  if (unfenced.startsWith("{") || unfenced.startsWith("[")) {
    try {
      const parsed = JSON.parse(unfenced);
      const rows = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object" && Array.isArray((parsed as any).turns)
          ? (parsed as any).turns
          : null;

      if (rows) {
        for (const item of rows) {
          if (!item || typeof item !== "object") continue;
          const idxRaw = (item as any).index;
          const idx = typeof idxRaw === "number" ? Math.trunc(idxRaw) : parseInt(String(idxRaw), 10);
          const s0Raw = (item as any).startSec ?? (item as any).start_sec;
          const s1Raw = (item as any).endSec ?? (item as any).end_sec;
          const s0 =
            typeof s0Raw === "number" ? s0Raw : parseFloat(String(s0Raw ?? "").replace(",", "."));
          const s1 =
            typeof s1Raw === "number" ? s1Raw : parseFloat(String(s1Raw ?? "").replace(",", "."));
          if (!Number.isFinite(idx) || idx < 0 || !Number.isFinite(s0) || !Number.isFinite(s1)) {
            continue;
          }
          const foundRaw = (item as any).found;
          const found =
            typeof foundRaw === "boolean"
              ? foundRaw && s1 > s0
              : String(foundRaw ?? "true").trim().toLowerCase() !== "false" && s1 > s0;
          const voice = normalizeAlignmentVoiceTag((item as any).voice);
          const spokenText = String(
            (item as any).spokenText ?? (item as any).spoken_text ?? ""
          ).trim();
          segMap.set(idx, { startSec: s0, endSec: s1, found, voice, spokenText });
        }
        if (segMap.size > 0) return segMap;
      }
    } catch {
      // Fallback to pipe-delimited parser below
    }
  }

  // 2) Резервный парсер "0 | 0.05 | 3.45 | true | male | spoken text" (или 4–5 колонок)
  for (const line of trimmed.split(/\r?\n/)) {
    const cleanLine = line.replace(/^[-*>\s]+/, "").trim();
    if (!cleanLine || !cleanLine.includes("|")) continue;
    const cols = cleanLine.split("|").map((c) => c.trim());
    if (cols.length < 3) continue;
    const idx = parseInt(cols[0], 10);
    const s0 = parseFloat(cols[1].replace(",", "."));
    const s1 = parseFloat(cols[2].replace(",", "."));
    if (isNaN(idx) || isNaN(s0) || isNaN(s1)) continue;

    let found = s1 > s0;
    let voice: "male" | "female" | "unknown" = "unknown";
    let spokenText = "";

    if (cols.length >= 6) {
      found = cols[3].toLowerCase() !== "false" && s1 > s0;
      voice = normalizeAlignmentVoiceTag(cols[4]);
      spokenText = cols.slice(5).join(" | ").trim();
    } else if (cols.length === 5) {
      found = cols[3].toLowerCase() !== "false" && s1 > s0;
      const maybeVoice = normalizeAlignmentVoiceTag(cols[4]);
      if (maybeVoice !== "unknown") {
        voice = maybeVoice;
      } else {
        spokenText = cols[4];
      }
    } else if (cols.length === 4) {
      found = cols[3].toLowerCase() !== "false" && s1 > s0;
    }

    segMap.set(idx, { startSec: s0, endSec: s1, found, voice, spokenText });
  }

  return segMap;
}

/**
 * Нарезает PCM-блок по выровненным границам модели `segMap` с привязкой к паузам-кандидатам:
 * - если реплика заканчивается на <laugh>, смех остаётся целиком в её клипе, а пауза после смеха
 *   не попадает ни в неё, ни в следующую реплику;
 * - начало реплики, идущей сразу после <laugh>, берётся по началу её первого слова из выравнивания;
 * - каждый клип проходит RMS-обрезку краевой тишины trimSilenceEdgesPcm (40 мс до речи, 80 мс после, fade-in 10 мс).
 */
export function slicePcmByAlignmentSegments(
  pcm: Buffer,
  expectedTurns: AlignExpectedTurnInput[],
  segMap: Map<number, ParsedAlignmentRow>,
  options?: {
    silenceCandidates?: SilenceRun[];
    silenceMinMs?: number;
    snapToleranceSec?: number;
    firstSpeechSec?: number;
    lastSpeechSec?: number;
  }
): {
  clips: Array<SlicedTurnClip | null>;
  turnAlignments: TranscribeTurnAlignment[];
  missingIndices: number[];
} {
  const totalSamples = Math.floor(pcm.length / 2);
  const totalDurationSec = totalSamples / PCM_SAMPLE_RATE;
  const silenceMinMs = options?.silenceMinMs ?? 120;
  const snapToleranceSec = options?.snapToleranceSec ?? 0.6;
  const silenceCandidates =
    options?.silenceCandidates ??
    detectSilenceRuns(pcm, {
      frameMs: 10,
      minSilenceMs: silenceMinMs,
    });

  let firstSpeechSec = options?.firstSpeechSec;
  let lastSpeechSec = options?.lastSpeechSec;
  if (typeof firstSpeechSec !== "number" || typeof lastSpeechSec !== "number") {
    const threshold = 160;
    let first = 0;
    while (first < totalSamples && Math.abs(pcm.readInt16LE(first * 2)) < threshold) {
      first += 24;
    }
    let last = totalSamples - 1;
    while (last > first && Math.abs(pcm.readInt16LE(last * 2)) < threshold) {
      last -= 24;
    }
    firstSpeechSec = Math.min(first, totalSamples) / PCM_SAMPLE_RATE;
    lastSpeechSec = Math.max(first + 240, Math.min(totalSamples, last + 1)) / PCM_SAMPLE_RATE;
  }

  const turnHasTrailingLaugh = expectedTurns.map((t) =>
    /<\s*laugh\s*>/i.test(String(t.text || ""))
  );

  const clips: Array<SlicedTurnClip | null> = [];
  const turnAlignments: TranscribeTurnAlignment[] = [];
  const missingIndices: number[] = [];
  let prevEndSample = 0;

  const preWordProtectSamples = Math.round(0.15 * PCM_SAMPLE_RATE);
  const postLaughTailPadSamples = Math.round(0.15 * PCM_SAMPLE_RATE);

  for (let i = 0; i < expectedTurns.length; i++) {
    const seg = segMap.get(i);
    if (
      !seg ||
      !seg.found ||
      typeof seg.startSec !== "number" ||
      typeof seg.endSec !== "number" ||
      seg.endSec <= seg.startSec + 0.1
    ) {
      clips.push(null);
      missingIndices.push(i);
      turnAlignments.push({
        index: i,
        startSec: seg?.startSec ?? 0,
        endSec: seg?.endSec ?? 0,
        found: false,
        voice: seg?.voice ?? "unknown",
        spokenText: seg?.spokenText ?? "",
        boundarySnapped: false,
        boundaryIssue: `turn_not_found_in_transcribe (turn ${i})`,
      });
      continue;
    }

    const safeStartSec = Math.max(0, Math.min(totalDurationSec - 0.1, seg.startSec));
    const safeEndSec = Math.max(safeStartSec + 0.1, Math.min(totalDurationSec, seg.endSec));
    const alignedStartSample = Math.round(safeStartSec * PCM_SAMPLE_RATE);
    const prevHadTrailingLaugh = i > 0 && turnHasTrailingLaugh[i - 1];

    let boundarySnapped = true;
    let boundaryIssue: string | undefined;

    // 1) Привязка START к ближайшей паузе-кандидату (>= 120 мс) в пределах ±0.6 с
    let startSample: number;
    if (i === 0) {
      if (safeStartSec <= snapToleranceSec || Math.abs(safeStartSec - firstSpeechSec) <= snapToleranceSec) {
        startSample = 0;
      } else {
        const candStart = findNearestSilenceCandidate(silenceCandidates, safeStartSec, snapToleranceSec);
        if (candStart) {
          startSample = candStart.midSample;
        } else {
          boundarySnapped = false;
          boundaryIssue = `no_silence_boundary_near_start (turn 0 @ ${safeStartSec.toFixed(2)}s)`;
          startSample = alignedStartSample;
        }
      }
    } else if (prevHadTrailingLaugh) {
      // После реплики с <laugh>: начало следующей реплики берём по началу её первого слова из выравнивания,
      // чтобы пауза между смехом и следующей фразой не попадала ни в один клип.
      const candStart = findNearestSilenceCandidate(
        silenceCandidates,
        safeStartSec,
        snapToleranceSec,
        Math.max(-1, prevEndSample - Math.round(PCM_SAMPLE_RATE * 0.05))
      );
      if (candStart) {
        let wordStartSample = alignedStartSample;
        if (alignedStartSample <= candStart.endSample) {
          wordStartSample = candStart.endSample;
        } else if (alignedStartSample - candStart.endSample <= preWordProtectSamples) {
          // Сохраняем возможный тихий начальный согласный (H/X/Q/S) перед гласным
          wordStartSample = candStart.endSample;
        }
        // Оставляем небольшой допуск (150 мс) до первого слова для trimSilenceEdgesPcm (сохранит тихий H/X/Q/S, но исключит длинную паузу после смеха)
        startSample = Math.max(
          prevEndSample,
          candStart.startSample,
          wordStartSample - preWordProtectSamples
        );
      } else if (Math.abs(prevEndSample / PCM_SAMPLE_RATE - safeStartSec) <= snapToleranceSec) {
        startSample = Math.max(prevEndSample, alignedStartSample - preWordProtectSamples);
      } else {
        boundarySnapped = false;
        boundaryIssue = `no_silence_boundary_near_start (turn ${i} @ ${safeStartSec.toFixed(2)}s)`;
        startSample = Math.max(prevEndSample, alignedStartSample);
      }
    } else {
      // Обычная внутренняя граница: привязываем к паузе-кандидату в ±0.6с
      const candStart = findNearestSilenceCandidate(
        silenceCandidates,
        safeStartSec,
        snapToleranceSec,
        Math.max(-1, prevEndSample - Math.round(PCM_SAMPLE_RATE * 0.05))
      );
      if (candStart) {
        startSample = Math.max(prevEndSample, candStart.midSample);
      } else if (Math.abs(prevEndSample / PCM_SAMPLE_RATE - safeStartSec) <= snapToleranceSec) {
        startSample = prevEndSample;
      } else {
        boundarySnapped = false;
        boundaryIssue = `no_silence_boundary_near_start (turn ${i} @ ${safeStartSec.toFixed(2)}s)`;
        startSample = Math.max(prevEndSample, alignedStartSample);
      }
    }

    // 2) Привязка END к ближайшей паузе-кандидату (>= 120 мс) в пределах ±0.6 с
    // Если реплика заканчивается на <laugh>, смех остаётся целиком в её клипе,
    // а пауза между смехом и следующей фразой отбрасывается (режем по началу этой паузы + 150 мс, затем trimSilenceEdgesPcm оставит 80 мс).
    let endSample: number;
    const hasLaughAtEnd = turnHasTrailingLaugh[i];
    if (i === expectedTurns.length - 1) {
      if (
        hasLaughAtEnd ||
        totalDurationSec - safeEndSec <= snapToleranceSec ||
        Math.abs(safeEndSec - lastSpeechSec) <= snapToleranceSec
      ) {
        endSample = totalSamples;
      } else {
        const candEnd = findNearestSilenceCandidate(
          silenceCandidates,
          safeEndSec,
          snapToleranceSec,
          startSample
        );
        if (candEnd) {
          endSample = candEnd.midSample;
        } else {
          boundarySnapped = false;
          boundaryIssue =
            boundaryIssue || `no_silence_boundary_near_end (turn ${i} @ ${safeEndSec.toFixed(2)}s)`;
          endSample = Math.min(totalSamples, Math.round(safeEndSec * PCM_SAMPLE_RATE));
        }
      }
    } else {
      const nextSeg = segMap.get(i + 1);
      const nextStartSec =
        hasLaughAtEnd &&
        nextSeg?.found &&
        typeof nextSeg.startSec === "number" &&
        nextSeg.startSec > safeStartSec
          ? Math.min(totalDurationSec, nextSeg.startSec)
          : null;

      let candEnd =
        nextStartSec !== null
          ? findNearestSilenceCandidate(
              silenceCandidates,
              nextStartSec,
              snapToleranceSec,
              Math.max(startSample, Math.round((safeEndSec - 0.15) * PCM_SAMPLE_RATE))
            )
          : null;

      if (!candEnd) {
        candEnd = findNearestSilenceCandidate(
          silenceCandidates,
          safeEndSec,
          snapToleranceSec,
          startSample
        );
      }

      if (candEnd) {
        if (hasLaughAtEnd) {
          // Смех заканчивается у candEnd.startSample; не захватываем длинную паузу между смехом и следующей фразой
          const nextStartLimit =
            nextStartSec !== null ? Math.round(nextStartSec * PCM_SAMPLE_RATE) : candEnd.endSample;
          endSample = Math.min(
            candEnd.endSample,
            nextStartLimit,
            Math.max(
              startSample + Math.round(0.12 * PCM_SAMPLE_RATE),
              candEnd.startSample + postLaughTailPadSamples
            )
          );
        } else {
          endSample = candEnd.midSample;
        }
      } else {
        boundarySnapped = false;
        boundaryIssue =
          boundaryIssue || `no_silence_boundary_near_end (turn ${i} @ ${safeEndSec.toFixed(2)}s)`;
        endSample = Math.min(
          totalSamples,
          Math.round((nextStartSec ?? safeEndSec) * PCM_SAMPLE_RATE)
        );
      }
    }

    if (endSample <= startSample + Math.round(PCM_SAMPLE_RATE * 0.1)) {
      clips.push(null);
      missingIndices.push(i);
      turnAlignments.push({
        index: i,
        startSec: safeStartSec,
        endSec: safeEndSec,
        found: false,
        voice: seg.voice,
        spokenText: seg.spokenText,
        boundarySnapped: false,
        boundaryIssue: boundaryIssue || `degenerate_clip_bounds (turn ${i})`,
      });
      continue;
    }

    const clean = trimSilenceEdgesPcm(pcm.subarray(startSample * 2, endSample * 2));
    clips.push({
      index: i,
      pcm: clean,
      startMs: Math.round((startSample / PCM_SAMPLE_RATE) * 1000),
      endMs: Math.round((endSample / PCM_SAMPLE_RATE) * 1000),
      durationSec: Math.round((clean.length / PCM_BYTES_PER_SEC) * 100) / 100,
      method: "transcribe_aligned",
      spokenText: seg.spokenText,
      detectedVoice: seg.voice,
      boundarySnapped,
      boundaryIssue,
    });
    turnAlignments.push({
      index: i,
      startSec: startSample / PCM_SAMPLE_RATE,
      endSec: endSample / PCM_SAMPLE_RATE,
      found: true,
      voice: seg.voice,
      spokenText: seg.spokenText,
      boundarySnapped,
      boundaryIssue,
    });
    prevEndSample = endSample;
  }

  return { clips, turnAlignments, missingIndices };
}

/**
 * Выравнивание границ реплик И верификация (SPOKEN_TEXT + VOICE male/female) в ОДНОМ запросе
 * к мультимодальной модели `gemini-4-hydrogen` (JSON responseSchema) на подблок.
 *
 * Правила нарезки:
 * - Кандидаты разрезов — реальные паузы по тишине (>= 120 мс) в PCM.
 * - Каждая внутренняя граница реплики привязывается строго к ближайшей паузе-кандидату
 *   в пределах ±0.6 с от границы модели. Если паузы в ±0.6 с нет — boundarySnapped = false (брак!).
 * - Гарантирует строгий монотонный порядок клипов без перекрытий (startMs >= prevEndMs).
 * - Тратит 0 вызовов TTS!
 */
export async function alignBatchAudioViaTranscribe(
  ai: GoogleGenAI,
  pcm: Buffer,
  expectedTurns: AlignExpectedTurnInput[],
  alignmentModel: string = "gemini-4-hydrogen",
  options?: {
    silenceMinMs?: number;
    snapToleranceSec?: number;
    fakeTurnOverrides?: Array<FakeTurnAlignmentOverride | null | undefined>;
    fakeWholeTranscriptOverride?: string;
  }
): Promise<TranscribeAlignedResult> {
  const t0 = Date.now();
  const totalSamples = Math.floor(pcm.length / 2);
  const totalDurationSec = totalSamples / PCM_SAMPLE_RATE;
  const silenceMinMs = options?.silenceMinMs ?? 120;
  const snapToleranceSec = options?.snapToleranceSec ?? 0.6;

  if (expectedTurns.length === 0 || totalSamples < 480) {
    return {
      success: false,
      clips: [],
      turnAlignments: [],
      missingIndices: expectedTurns.map((t) => t.index),
      rawSegmentsCount: 0,
      wallTimeMs: Date.now() - t0,
      usedApiCall: false,
      error: "Empty PCM or turns",
    };
  }

  // Кандидаты разрезов — все паузы по тишине >= 120 мс в PCM
  const silenceCandidates = detectSilenceRuns(pcm, {
    frameMs: 10,
    minSilenceMs: silenceMinMs,
  });

  // Вычисляем реальное начало и конец речи в PCM для корректного допуска на 0-й и последней реплике
  let firstSpeechSample = 0;
  let lastSpeechSample = totalSamples;
  {
    const threshold = 160;
    let first = 0;
    while (first < totalSamples && Math.abs(pcm.readInt16LE(first * 2)) < threshold) {
      first += 24;
    }
    let last = totalSamples - 1;
    while (last > first && Math.abs(pcm.readInt16LE(last * 2)) < threshold) {
      last -= 24;
    }
    firstSpeechSample = Math.min(first, totalSamples);
    lastSpeechSample = Math.max(firstSpeechSample + 240, Math.min(totalSamples, last + 1));
  }
  const firstSpeechSec = firstSpeechSample / PCM_SAMPLE_RATE;
  const lastSpeechSec = lastSpeechSample / PCM_SAMPLE_RATE;

  // Тестовый режим DUBBING_FAKE_TTS=1: 0 реальных вызовов API — строим выравнивание строго по паузам >= 120 мс
  if (isFakeDubbingTtsEnabled()) {
    const turnOverrides = options?.fakeTurnOverrides || [];
    const wholeOverride = options?.fakeWholeTranscriptOverride;

    const getFakeSpoken = (idx: number): string => {
      const ov = turnOverrides[idx];
      if (ov && typeof ov.spokenText === "string") return ov.spokenText;
      if (typeof wholeOverride === "string") {
        // Если тест подменил всю транскрипцию подблока целиком — приписываем её в 0-ю реплику / делим по репликам
        if (idx === 0) return wholeOverride;
        return "";
      }
      return String(expectedTurns[idx].text || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    };

    const getFakeVoice = (idx: number): "male" | "female" | "unknown" => {
      const ov = turnOverrides[idx];
      if (ov?.voice) return ov.voice;
      return expectedTurns[idx].gender || "unknown";
    };

    if (expectedTurns.length === 1) {
      const clean = trimSilenceEdgesPcm(pcm);
      const durSec = Math.round((clean.length / PCM_BYTES_PER_SEC) * 100) / 100;
      const ov0 = turnOverrides[0];
      const spoken0 = getFakeSpoken(0);
      const voice0 = getFakeVoice(0);
      const snapped0 = ov0?.boundarySnapped ?? true;
      const issue0 = ov0?.boundaryIssue ?? (snapped0 ? undefined : "no_silence_boundary_near_cut");
      const clip: SlicedTurnClip = {
        index: 0,
        pcm: clean,
        startMs: 0,
        endMs: Math.max(100, Math.round(totalDurationSec * 1000)),
        durationSec: durSec,
        method: "transcribe_aligned",
        spokenText: spoken0,
        detectedVoice: voice0,
        boundarySnapped: snapped0,
        boundaryIssue: issue0,
      };
      return {
        success: snapped0,
        clips: [clip],
        turnAlignments: [
          {
            index: 0,
            startSec: 0,
            endSec: totalDurationSec,
            found: true,
            voice: voice0,
            spokenText: spoken0,
            boundarySnapped: snapped0,
            boundaryIssue: issue0,
          },
        ],
        missingIndices: [],
        rawSegmentsCount: 1,
        wallTimeMs: Date.now() - t0,
        heardTranscript: typeof wholeOverride === "string" ? wholeOverride : spoken0,
        usedApiCall: false,
      };
    }

    // Несколько реплик в фейковом PCM: находим разрезы строго по паузам-кандидатам (>= 120 мс)
    const vad = sliceBatchPcmByVad(
      pcm,
      expectedTurns.map((t) => t.text),
      { minSilenceMs: silenceMinMs }
    );

    if (vad.clips.length === expectedTurns.length) {
      const clips: Array<SlicedTurnClip | null> = [];
      const turnAlignments: TranscribeTurnAlignment[] = [];
      for (let i = 0; i < expectedTurns.length; i++) {
        const baseClip = vad.clips[i];
        const ov = turnOverrides[i];
        const spoken = getFakeSpoken(i);
        const voice = getFakeVoice(i);
        // Проверяем, что внутренние границы реально лежат на паузе >= 120 мс в пределах ±0.6с
        let snapped = ov?.boundarySnapped ?? true;
        let issue = ov?.boundaryIssue;
        if (snapped && i > 0) {
          const nearStart = findNearestSilenceCandidate(
            silenceCandidates,
            baseClip.startMs / 1000,
            snapToleranceSec
          );
          if (!nearStart) {
            snapped = false;
            issue = `no_silence_boundary_near_start (turn ${i})`;
          }
        }
        if (snapped && i + 1 < expectedTurns.length) {
          const nearEnd = findNearestSilenceCandidate(
            silenceCandidates,
            baseClip.endMs / 1000,
            snapToleranceSec
          );
          if (!nearEnd) {
            snapped = false;
            issue = `no_silence_boundary_near_end (turn ${i})`;
          }
        }
        clips.push({
          ...baseClip,
          method: "transcribe_aligned",
          spokenText: spoken,
          detectedVoice: voice,
          boundarySnapped: snapped,
          boundaryIssue: issue,
        });
        turnAlignments.push({
          index: i,
          startSec: baseClip.startMs / 1000,
          endSec: baseClip.endMs / 1000,
          found: true,
          voice,
          spokenText: spoken,
          boundarySnapped: snapped,
          boundaryIssue: issue,
        });
      }

      const heardTranscript =
        typeof wholeOverride === "string"
          ? wholeOverride
          : turnAlignments
              .map((a) => a.spokenText)
              .filter(Boolean)
              .join(" ")
              .trim();

      return {
        success: turnAlignments.every((a) => a.boundarySnapped),
        clips,
        turnAlignments,
        missingIndices: [],
        rawSegmentsCount: clips.length,
        wallTimeMs: Date.now() - t0,
        heardTranscript,
        usedApiCall: false,
      };
    }

    // Недостаточно пауз >= 120 мс в фейковом PCM (например, тест без пауз или с пропущенной репликой)
    return {
      success: false,
      clips: expectedTurns.map(() => null),
      turnAlignments: expectedTurns.map((_, i) => ({
        index: i,
        startSec: 0,
        endSec: 0,
        found: false,
        voice: "unknown",
        spokenText: "",
        boundarySnapped: false,
        boundaryIssue: `no_silence_boundary_near_cut (pauses=${silenceCandidates.length}, needed=${expectedTurns.length - 1})`,
      })),
      missingIndices: expectedTurns.map((_, i) => i),
      rawSegmentsCount: 0,
      wallTimeMs: Date.now() - t0,
      heardTranscript: typeof wholeOverride === "string" ? wholeOverride : undefined,
      usedApiCall: false,
      error: "Fake mode align: insufficient silence candidates (>=120ms)",
    };
  }

  try {
    const wavBuf = buildWav24k(pcm);
    const turnHasTrailingLaugh = expectedTurns.map((t) =>
      /<\s*laugh\s*>/i.test(String(t.text || ""))
    );
    const turnListText = expectedTurns
      .map((t, i) => {
        const cleanBody = String(t.text || "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const laughNote = turnHasTrailingLaugh[i] ? " (ends with laughter)" : "";
        return `${i}: [${t.speaker}${t.gender ? `/${t.gender}` : ""}] ${cleanBody}${laughNote}`;
      })
      .join("\n");

    const silenceSummary =
      silenceCandidates.length > 0
        ? silenceCandidates
            .slice(0, 60)
            .map(
              (s) =>
                `${(s.startMs / 1000).toFixed(2)}–${(s.endMs / 1000).toFixed(2)}s (mid ${(s.midMs / 1000).toFixed(2)}s, ${s.durationMs}ms)`
            )
            .join(", ")
        : "none detected";

    const isStructuredMultimodalModel = !/transcribe|tts/i.test(alignmentModel);
    const supportsThinkingLevel =
      isStructuredMultimodalModel && /^gemini-(3|4)/i.test(alignmentModel);

    const prompt = `Listen carefully to this ${totalDurationSec.toFixed(2)}-second Uzbek dialogue audio recording and align each of the ${expectedTurns.length} scripted turns below in order.

DETECTED PCM SILENCE PAUSES (>= ${silenceMinMs}ms) IN THIS AUDIO:
${silenceSummary}

RULES:
- Return every turn index from 0 to ${expectedTurns.length - 1} once in ascending order.
- startSec and endSec are decimal seconds within [0.00, ${totalDurationSec.toFixed(2)}], covering the full spoken utterance without cutting any word.
- Align inter-turn boundaries to the real silence pauses listed above whenever a pause separates two turns.
- If a turn ends with laughter (marked "(ends with laughter)"), include the laughter inside that turn's [startSec, endSec] ending right after the laughter finishes, and set the NEXT turn's startSec strictly at the start of the NEXT turn's first spoken word (do NOT include the silence pause between laughter and the next phrase in either turn).
- Timestamps MUST be strictly non-overlapping and ascending: next startSec >= previous endSec.
- voice MUST be strictly "male" or "female" based on the ACTUAL voice heard in that audio interval (use "unknown" only if silent/unintelligible). Do NOT blindly copy the script gender if the wrong voice spoke that line.
- spokenText MUST transcribe VERBATIM what was ACTUALLY spoken in Uzbek in that exact interval (do NOT copy from the script if the audio differed; include any repeated words, cut-offs, or English words actually heard).
- If a scripted line was skipped/missing in the audio, set found=false, startSec=0, endSec=0, voice="unknown", spokenText="".

SCRIPTED TURNS:
${turnListText}`;

    const requestParams: any = {
      model: alignmentModel,
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: "audio/wav",
                data: wavBuf.toString("base64"),
              },
            },
            { text: prompt },
          ],
        },
      ],
    };

    if (isStructuredMultimodalModel) {
      requestParams.config = {
        ...(supportsThinkingLevel
          ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
          : {}),
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            turns: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  index: { type: Type.INTEGER },
                  startSec: { type: Type.NUMBER },
                  endSec: { type: Type.NUMBER },
                  found: { type: Type.BOOLEAN },
                  voice: { type: Type.STRING },
                  spokenText: { type: Type.STRING },
                },
                required: ["index", "startSec", "endSec", "found", "voice", "spokenText"],
              },
            },
          },
          required: ["turns"],
        },
      };
    }

    const response = await ai.models.generateContent(requestParams);

    const rawText = String(response.text || "").trim();
    const segMap = parseAlignmentModelOutput(rawText);
    const parseError =
      segMap.size === 0
        ? `alignment_parse_empty (${alignmentModel}): ${rawText.slice(0, 120) || "empty response"}`
        : undefined;
    if (parseError) {
      console.warn("[alignBatchAudioViaTranscribe] 0 segments parsed from alignment output:", {
        model: alignmentModel,
        rawPreview: rawText.slice(0, 240),
      });
    }

    const slicedBySegs = slicePcmByAlignmentSegments(
      pcm,
      expectedTurns,
      segMap,
      {
        silenceCandidates,
        snapToleranceSec,
        firstSpeechSec,
        lastSpeechSec,
      }
    );
    const { clips, turnAlignments, missingIndices } = slicedBySegs;

    const heardTranscript = turnAlignments
      .map((a) => a.spokenText)
      .filter(Boolean)
      .join(" ")
      .trim() || undefined;

    return {
      success:
        !parseError &&
        missingIndices.length === 0 &&
        turnAlignments.every((a) => a.boundarySnapped),
      clips,
      turnAlignments,
      missingIndices,
      rawSegmentsCount: segMap.size,
      wallTimeMs: Date.now() - t0,
      heardTranscript,
      usedApiCall: true,
      error: parseError,
    };
  } catch (err: any) {
    return {
      success: false,
      clips: expectedTurns.map(() => null),
      turnAlignments: expectedTurns.map((_, i) => ({
        index: i,
        startSec: 0,
        endSec: 0,
        found: false,
        voice: "unknown",
        spokenText: "",
        boundarySnapped: false,
        boundaryIssue: String(err?.message || err),
      })),
      missingIndices: expectedTurns.map((_, i) => i),
      rawSegmentsCount: 0,
      wallTimeMs: Date.now() - t0,
      usedApiCall: true,
      error: String(err?.message || err),
    };
  }
}

/**
 * Этап 2: 1 вызов gemini-3.5-transcribe (простой текст) для QA-проверки подблока
 * (повторы, пропуски, проговорённые "short pause" или посторонние английские слова).
 * В режиме DUBBING_FAKE_TTS=1 возвращает ожидаемый текст (0 реальных вызовов API).
 */
export async function transcribePlainTextForQa(
  ai: GoogleGenAI,
  pcm: Buffer,
  expectedTurns: Array<{ index: number; speaker: string; text: string }>,
  transcribeModel: string = "gemini-3.5-transcribe"
): Promise<{ text: string; usedApiCall: boolean; error?: string }> {
  if (isFakeDubbingTtsEnabled()) {
    if (fakeTranscribeQaOverride) {
      const injected = fakeTranscribeQaOverride(expectedTurns);
      if (typeof injected === "string") {
        return { text: injected, usedApiCall: false };
      }
    }
    const expectedJoined = expectedTurns
      .map((t) => String(t.text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join(" ");
    return { text: expectedJoined, usedApiCall: false };
  }

  try {
    const wavBuf = buildWav24k(pcm);
    const response = await ai.models.generateContent({
      model: transcribeModel,
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: "audio/wav",
                data: wavBuf.toString("base64"),
              },
            },
            {
              text: "Transcribe every spoken word in this Uzbek audio verbatim as plain text. Preserve any repeated words, stutters, or English words if they are actually spoken in the audio. Output ONLY the spoken transcript text with no timestamps, no speaker names, and no commentary.",
            },
          ],
        },
      ],
    });
    return {
      text: String(response.text || "").trim(),
      usedApiCall: true,
    };
  } catch (err: any) {
    return {
      text: "",
      usedApiCall: true,
      error: String(err?.message || err),
    };
  }
}

