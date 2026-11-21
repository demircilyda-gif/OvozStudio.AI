import { GoogleGenAI } from "@google/genai";

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
      const trimmed = trimSilenceEdgesPcm(rawSlice, 20);
      const clean = applyMicroEdgeFades(trimmed, 6);
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

/**
 * Мягко подрезает краевую тишину отдельной реплики, оставляя запас marginMs с каждой стороны.
 */
export function trimSilenceEdgesPcm(pcm: Buffer, marginMs: number = 25): Buffer {
  const totalSamples = Math.floor(pcm.length / 2);
  if (totalSamples < 480) return pcm;

  const threshold = 110;
  let first = 0;
  let last = totalSamples - 1;

  while (first < totalSamples && Math.abs(pcm.readInt16LE(first * 2)) < threshold) {
    first++;
  }
  while (last > first && Math.abs(pcm.readInt16LE(last * 2)) < threshold) {
    last--;
  }

  if (first >= last) return pcm;

  const marginSamples = Math.round((PCM_SAMPLE_RATE * marginMs) / 1000);
  const s0 = Math.max(0, first - marginSamples);
  const s1 = Math.min(totalSamples, last + marginSamples + 1);
  return Buffer.from(pcm.subarray(s0 * 2, s1 * 2));
}

export interface TranscribeAlignedResult {
  success: boolean;
  clips: Array<SlicedTurnClip | null>;
  missingIndices: number[];
  rawSegmentsCount: number;
  wallTimeMs: number;
  error?: string;
}

/**
 * Часть 2.5: Точное выравнивание границ реплик в длинном блочном аудио через `gemini-3.5-transcribe`
 * с уточнением каждой точки реза по локальному минимуму энергии PCM (±220 мс), чтобы слово никогда не резалось.
 * Тратит 0 вызовов TTS!
 */
export async function alignBatchAudioViaTranscribe(
  ai: GoogleGenAI,
  pcm: Buffer,
  expectedTurns: Array<{ index: number; speaker: string; text: string }>,
  transcribeModel: string = "gemini-3.5-transcribe"
): Promise<TranscribeAlignedResult> {
  const t0 = Date.now();
  const totalSamples = Math.floor(pcm.length / 2);
  const totalDurationSec = totalSamples / PCM_SAMPLE_RATE;

  if (expectedTurns.length === 0 || totalSamples < 480) {
    return {
      success: false,
      clips: [],
      missingIndices: expectedTurns.map((t) => t.index),
      rawSegmentsCount: 0,
      wallTimeMs: Date.now() - t0,
      error: "Empty PCM or turns",
    };
  }

  try {
    const wavBuf = buildWav24k(pcm);
    const turnListText = expectedTurns
      .map(
        (t, i) =>
          `${i}: [${t.speaker}] ${String(t.text || "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()}`
      )
      .join("\n");

    const prompt = `Listen to this ${totalDurationSec.toFixed(2)}-second Uzbek audio recording and output ONLY timestamped alignment lines for each of the ${expectedTurns.length} scripted lines below in order.

STRICT OUTPUT FORMAT (one line per turn, plain text, no markdown, no extra text):
INDEX | START_SEC | END_SEC | FOUND
Example:
0 | 0.00 | 3.45 | true
1 | 3.60 | 6.90 | true

RULES:
- Every index from 0 to ${expectedTurns.length - 1} must appear once in ascending order.
- START_SEC and END_SEC are decimal seconds within [0.00, ${totalDurationSec.toFixed(2)}].
- Never cut mid-word: cover the complete spoken utterance for each line.
- If a line was skipped in the audio, write: INDEX | 0 | 0 | false

SCRIPTED LINES:
${turnListText}`;

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
            { text: prompt },
          ],
        },
      ],
    });

    const rawText = String(response.text || "").trim();
    const segMap = new Map<number, { startSec: number; endSec: number; found: boolean }>();

    // Парсим формат "0 | 0.00 | 3.45 | true" или "[0] 0.00-3.45"
    for (const line of rawText.split(/\r?\n/)) {
      const cleanLine = line.trim();
      if (!cleanLine) continue;
      const pipeMatch = cleanLine.match(
        /^(\d+)\s*\|\s*(\d+(?:[.,]\d+)?)\s*\|\s*(\d+(?:[.,]\d+)?)(?:\s*\|\s*(true|false))?/i
      );
      if (pipeMatch) {
        const idx = parseInt(pipeMatch[1], 10);
        const s0 = parseFloat(pipeMatch[2].replace(",", "."));
        const s1 = parseFloat(pipeMatch[3].replace(",", "."));
        const found = pipeMatch[4] ? pipeMatch[4].toLowerCase() !== "false" : s1 > s0;
        if (!isNaN(idx) && !isNaN(s0) && !isNaN(s1)) {
          segMap.set(idx, { startSec: s0, endSec: s1, found });
        }
        continue;
      }
      const rangeMatch = cleanLine.match(
        /^\[?(\d+)\]?[:.\s]+(\d+(?:[.,]\d+)?)\s*[-–]\s*(\d+(?:[.,]\d+)?)/
      );
      if (rangeMatch) {
        const idx = parseInt(rangeMatch[1], 10);
        const s0 = parseFloat(rangeMatch[2].replace(",", "."));
        const s1 = parseFloat(rangeMatch[3].replace(",", "."));
        if (!isNaN(idx) && !isNaN(s0) && !isNaN(s1)) {
          segMap.set(idx, { startSec: s0, endSec: s1, found: s1 > s0 });
        }
      }
    }

    const clips: Array<SlicedTurnClip | null> = [];
    const missingIndices: number[] = [];

    for (let i = 0; i < expectedTurns.length; i++) {
      const seg = segMap.get(i);
      if (
        !seg ||
        !seg.found ||
        typeof seg.startSec !== "number" ||
        typeof seg.endSec !== "number" ||
        seg.endSec <= seg.startSec + 0.12
      ) {
        clips.push(null);
        missingIndices.push(i);
        continue;
      }

      const safeStartSec = Math.max(0, Math.min(totalDurationSec - 0.1, seg.startSec));
      const safeEndSec = Math.max(safeStartSec + 0.12, Math.min(totalDurationSec, seg.endSec));

      // Уточняем точки реза по локальному минимуму энергии PCM (±200 мс), чтобы не обрезать начало/конец слова
      const startSample = refineCutSampleToEnergyMinimum(pcm, safeStartSec, 200);
      const endSample = refineCutSampleToEnergyMinimum(pcm, safeEndSec, 200);

      if (endSample <= startSample + Math.round(PCM_SAMPLE_RATE * 0.12)) {
        clips.push(null);
        missingIndices.push(i);
        continue;
      }

      const slice = trimSilenceEdgesPcm(pcm.subarray(startSample * 2, endSample * 2), 25);
      const clean = applyMicroEdgeFades(slice, 6);
      clips.push({
        index: i,
        pcm: clean,
        startMs: Math.round((startSample / PCM_SAMPLE_RATE) * 1000),
        endMs: Math.round((endSample / PCM_SAMPLE_RATE) * 1000),
        durationSec: Math.round((clean.length / PCM_BYTES_PER_SEC) * 100) / 100,
        method: "transcribe_aligned",
      });
    }

    return {
      success: missingIndices.length <= Math.min(3, Math.floor(expectedTurns.length * 0.2)),
      clips,
      missingIndices,
      rawSegmentsCount: segMap.size,
      wallTimeMs: Date.now() - t0,
    };
  } catch (err: any) {
    return {
      success: false,
      clips: expectedTurns.map(() => null),
      missingIndices: expectedTurns.map((_, i) => i),
      rawSegmentsCount: 0,
      wallTimeMs: Date.now() - t0,
      error: String(err?.message || err),
    };
  }
}
