import { hasQuietlyStyle } from "../../../src/utils/dubbingStyle.ts";

/**
 * Выравнивание громкости нарезанных клипов по стандарту ITU-R BS.1770-4 (K-взвешенная
 * интегрированная громкость с абсолютным порогом -70 LKFS и относительным порогом -10 LU)
 * плюс мягкий lookahead peak-лимитер с потолком -1.0 dBFS.
 *
 * Применяется сразу после нарезки суб-блока на клипы (и в одиночной перегенерации)
 * ДО записи в кэш и ДО отправки в браузер.
 */

export const DEFAULT_TARGET_LUFS = -18.0;
export const QUIETLY_TARGET_LUFS = -21.0;
export const PEAK_CEILING_DBFS = -1.0;
export const PEAK_CEILING_LINEAR = Math.pow(10, PEAK_CEILING_DBFS / 20); // ~0.8912509
const MIN_DIRECT_MEASURE_SEC = 1.0;
const MAX_SAFE_GAIN_DB = 24.0;
const MIN_SAFE_GAIN_DB = -24.0;

interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/**
 * Коэффициенты двух каскадов K-взвешивания ITU-R BS.1770-4 для произвольной частоты дискретизации fs
 * (точный билинейный расчёт по аналоговым прототипам BS.1770-4, дающий совпадение с таблицей на 48 кГц
 * и точный отклик на 24 кГц).
 */
function computeBs1770KWeightingBiquads(sampleRate: number): {
  shelf: BiquadCoeffs;
  highpass: BiquadCoeffs;
} {
  // Stage 1: Acoustic head-effect high-shelf (+3.999843853973347 dB, f0 = 1681.974450955533 Hz, Q = 0.7071752369554196)
  const db = 3.999843853973347;
  const f0Shelf = 1681.974450955533;
  const qShelf = 0.7071752369554196;
  const kShelf = Math.tan((Math.PI * f0Shelf) / sampleRate);
  const vh = Math.pow(10, db / 20);
  const vb = Math.pow(vh, 0.4996667741545416);
  const a0Shelf = 1 + kShelf / qShelf + kShelf * kShelf;

  const shelf: BiquadCoeffs = {
    b0: (vh + (vb * kShelf) / qShelf + kShelf * kShelf) / a0Shelf,
    b1: (2 * (kShelf * kShelf - vh)) / a0Shelf,
    b2: (vh - (vb * kShelf) / qShelf + kShelf * kShelf) / a0Shelf,
    a1: (2 * (kShelf * kShelf - 1)) / a0Shelf,
    a2: (1 - kShelf / qShelf + kShelf * kShelf) / a0Shelf,
  };

  // Stage 2: RLB weighting high-pass (f0 = 38.13547087602444 Hz, Q = 0.5003270373238773)
  const f0Hp = 38.13547087602444;
  const qHp = 0.5003270373238773;
  const kHp = Math.tan((Math.PI * f0Hp) / sampleRate);
  const a0Hp = 1 + kHp / qHp + kHp * kHp;

  const highpass: BiquadCoeffs = {
    b0: 1 / a0Hp,
    b1: -2 / a0Hp,
    b2: 1 / a0Hp,
    a1: (2 * (kHp * kHp - 1)) / a0Hp,
    a2: (1 - kHp / qHp + kHp * kHp) / a0Hp,
  };

  return { shelf, highpass };
}

function applyBiquad(samples: Float64Array, c: BiquadCoeffs): Float64Array {
  const out = new Float64Array(samples.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return out;
}

function pcm16ToFloat64(pcm: Buffer): Float64Array {
  const count = Math.floor(pcm.length / 2);
  const out = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = pcm.readInt16LE(i * 2) / 32768.0;
  }
  return out;
}

function float64ToPcm16(samples: Float64Array): Buffer {
  const out = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(32767 / 32768, samples[i]));
    out.writeInt16LE(Math.round(clamped * 32768), i * 2);
  }
  return out;
}

/**
 * Измеряет интегрированную громкость (LUFS) по ITU-R BS.1770-4 с 400 мс блоками,
 * шагом 100 мс, абсолютным гейтом -70 LKFS и относительным гейтом -10 LU.
 * Возвращает -Infinity для полной тишины.
 */
export function measureIntegratedLufsFloat(
  samples: Float64Array,
  sampleRate = 24000
): number {
  if (samples.length === 0) return -Infinity;

  const { shelf, highpass } = computeBs1770KWeightingBiquads(sampleRate);
  const weighted = applyBiquad(applyBiquad(samples, shelf), highpass);

  const blockSamples = Math.max(1, Math.round(0.4 * sampleRate)); // 400 ms
  const hopSamples = Math.max(1, Math.round(0.1 * sampleRate)); // 100 ms

  // Очень короткий клип (< 400 мс): считаем K-взвешенную мощность по всему клипу
  if (weighted.length < blockSamples) {
    let sumSq = 0;
    for (let i = 0; i < weighted.length; i++) {
      sumSq += weighted[i] * weighted[i];
    }
    const meanSq = sumSq / weighted.length;
    if (meanSq <= 1e-12) return -Infinity;
    return -0.691 + 10 * Math.log10(meanSq);
  }

  // Префиксные суммы квадратов для O(N) расчёта всех перекрывающихся 400 мс окон
  const prefixSq = new Float64Array(weighted.length + 1);
  for (let i = 0; i < weighted.length; i++) {
    prefixSq[i + 1] = prefixSq[i] + weighted[i] * weighted[i];
  }

  const blockPowers: number[] = [];
  for (let start = 0; start + blockSamples <= weighted.length; start += hopSamples) {
    const z = (prefixSq[start + blockSamples] - prefixSq[start]) / blockSamples;
    if (z > 0) {
      const l = -0.691 + 10 * Math.log10(z);
      if (l > -70.0) {
        blockPowers.push(z);
      }
    }
  }

  if (blockPowers.length === 0) {
    // Фоллбэк: если сигнал ниже -70 LKFS, всё равно вернём -Infinity
    return -Infinity;
  }

  // Относительный гейт: -10 LU от среднего над абсолютным гейтом
  let absSum = 0;
  for (let i = 0; i < blockPowers.length; i++) absSum += blockPowers[i];
  const absMean = absSum / blockPowers.length;
  const relThresholdLufs = -0.691 + 10 * Math.log10(absMean) - 10.0;

  let relSum = 0;
  let relCount = 0;
  for (let i = 0; i < blockPowers.length; i++) {
    const l = -0.691 + 10 * Math.log10(blockPowers[i]);
    if (l > relThresholdLufs) {
      relSum += blockPowers[i];
      relCount++;
    }
  }

  const finalMean = relCount > 0 ? relSum / relCount : absMean;
  if (finalMean <= 1e-12) return -Infinity;
  return -0.691 + 10 * Math.log10(finalMean);
}

export function measureIntegratedLufsPcm(pcm: Buffer, sampleRate = 24000): number {
  return measureIntegratedLufsFloat(pcm16ToFloat64(pcm), sampleRate);
}

export function measurePeakDbfsFloat(samples: Float64Array): number {
  let maxAbs = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > maxAbs) maxAbs = a;
  }
  if (maxAbs <= 1e-12) return -Infinity;
  return 20 * Math.log10(maxAbs);
}

export function measurePeakDbfsPcm(pcm: Buffer): number {
  return measurePeakDbfsFloat(pcm16ToFloat64(pcm));
}

/**
 * Оценка 4x-пересэмплированного True Peak (dBFS) через кубическую интерполяцию Catmull-Rom.
 */
export function measureTruePeakDbfsFloat(samples: Float64Array): number {
  const n = samples.length;
  if (n === 0) return -Infinity;
  let maxAbs = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(samples[i]);
    if (a > maxAbs) maxAbs = a;
    if (i >= 1 && i + 2 < n) {
      const y0 = samples[i - 1];
      const y1 = samples[i];
      const y2 = samples[i + 1];
      const y3 = samples[i + 2];
      for (const t of [0.25, 0.5, 0.75]) {
        const t2 = t * t;
        const t3 = t2 * t;
        const v =
          0.5 *
          (2 * y1 +
            (-y0 + y2) * t +
            (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 +
            (-y0 + 3 * y1 - 3 * y2 + y3) * t3);
        const av = Math.abs(v);
        if (av > maxAbs) maxAbs = av;
      }
    }
  }
  if (maxAbs <= 1e-12) return -Infinity;
  return 20 * Math.log10(maxAbs);
}

export function measureTruePeakDbfsPcm(pcm: Buffer): number {
  return measureTruePeakDbfsFloat(pcm16ToFloat64(pcm));
}

/**
 * Применяет усиление (в дБ) и мягкий lookahead brickwall peak-лимитер с потолком ceilingLinear (-1.0 dBFS).
 * Не допускает жёсткого клиппинга и гарантирует peak <= ceilingLinear.
 */
function applyGainAndPeakLimiter(
  input: Float64Array,
  gainDb: number,
  sampleRate = 24000,
  ceilingLinear = PEAK_CEILING_LINEAR
): Float64Array {
  const n = input.length;
  const gained = new Float64Array(n);
  const linearGain = Math.pow(10, gainDb / 20);
  let maxPeak = 0;

  for (let i = 0; i < n; i++) {
    const v = input[i] * linearGain;
    gained[i] = v;
    const a = Math.abs(v);
    if (a > maxPeak) maxPeak = a;
  }

  // Быстрый путь: если ни один пик не превышает потолок, лимитер не нужен
  if (maxPeak <= ceilingLinear) {
    return gained;
  }

  // 1. Для каждого сэмпла вычисляем требуемый мгновенный коэффициент снижения усиления
  const lookahead = Math.max(1, Math.round(0.005 * sampleRate)); // 5 ms
  const releaseCoeff = Math.exp(-1 / Math.max(1, Math.round(0.06 * sampleRate))); // 60 ms release

  // Скользящий максимум амплитуды на окне [i, i + lookahead] (монотонная очередь O(N))
  const localPeak = new Float64Array(n);
  const dequeIdx = new Int32Array(n);
  let head = 0;
  let tail = 0;

  for (let i = n - 1; i >= 0; i--) {
    const val = Math.abs(gained[i]);
    while (tail > head && Math.abs(gained[dequeIdx[tail - 1]]) <= val) {
      tail--;
    }
    dequeIdx[tail++] = i;
    while (head < tail && dequeIdx[head] > i + lookahead) {
      head++;
    }
    localPeak[i] = Math.abs(gained[dequeIdx[head]]);
  }

  // 2. Целевое усиление с мягким огибающим release
  const targetGain = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    targetGain[i] = localPeak[i] > ceilingLinear ? ceilingLinear / localPeak[i] : 1.0;
  }

  // Сглаживание атаки (обратный проход, чтобы усиление плавно снижалось к пику заранее)
  const smoothed = new Float64Array(n);
  let g = 1.0;
  const attackStep = 1.0 / lookahead;
  for (let i = n - 1; i >= 0; i--) {
    if (targetGain[i] < g) {
      g = targetGain[i];
    } else {
      g = Math.min(targetGain[i], g + attackStep);
    }
    smoothed[i] = g;
  }

  // Сглаживание восстановления (прямой проход) + гарантия строгого потолка
  const out = new Float64Array(n);
  let env = 1.0;
  for (let i = 0; i < n; i++) {
    const desired = smoothed[i];
    if (desired < env) {
      env = desired;
    } else {
      env = releaseCoeff * env + (1 - releaseCoeff) * desired;
    }
    // Строгий предохранитель: сэмпл никогда не должен превысить потолок
    const absSample = Math.abs(gained[i]);
    const effectiveGain =
      absSample * env > ceilingLinear ? ceilingLinear / absSample : env;
    out[i] = gained[i] * effectiveGain;
  }

  return out;
}

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export interface LoudnessClipInput {
  pcm: Buffer;
  speaker: string;
  style?: string;
}

export interface LeveledClipResult {
  pcm: Buffer;
  lufsBefore: number | null;
  lufsAfter: number | null;
  targetLufs: number;
  gainDb: number;
  peakAfterDbfs: number | null;
  truePeakAfterDbfs?: number | null;
  usedMedianGain: boolean;
}

/**
 * Выравнивает громкость всех клипов суб-блока:
 * - Обычные реплики: -18 LUFS (BS.1770-4)
 * - Реплики со стилем `quietly`: -21 LUFS
 * - Клипы короче 1.0 с: медианное усиление того же спикера в суб-блоке (с поправкой -3 дБ для `quietly`)
 * - Peak-лимитер с потолком <= -1.0 dBFS на всех клипах.
 */
export function levelSubBlockClipsLoudness(
  clips: LoudnessClipInput[],
  options: {
    sampleRate?: number;
    defaultTargetLufs?: number;
    quietlyTargetLufs?: number;
    ceilingDbfs?: number;
  } = {}
): LeveledClipResult[] {
  const sampleRate = options.sampleRate ?? 24000;
  const defaultTarget = options.defaultTargetLufs ?? DEFAULT_TARGET_LUFS;
  const quietlyTarget = options.quietlyTargetLufs ?? QUIETLY_TARGET_LUFS;
  const ceilingDbfs = options.ceilingDbfs ?? PEAK_CEILING_DBFS;
  const ceilingLinear = Math.pow(10, ceilingDbfs / 20);

  // Шаг 1: первичные замеры и сбор усилений для клипов >= 1.0 с по каждому спикеру
  const parsed = clips.map((clip) => {
    const samples = pcm16ToFloat64(clip.pcm);
    const durationSec = samples.length / sampleRate;
    const isQuietly = hasQuietlyStyle(clip.style);
    const targetLufs = isQuietly ? quietlyTarget : defaultTarget;
    const measured = measureIntegratedLufsFloat(samples, sampleRate);
    const lufsBefore = Number.isFinite(measured) ? measured : null;
    const isLongEnough = durationSec >= MIN_DIRECT_MEASURE_SEC && lufsBefore !== null;
    return {
      clip,
      samples,
      durationSec,
      isQuietly,
      targetLufs,
      lufsBefore,
      isLongEnough,
    };
  });

  // Собираем базовый gain к defaultTarget (-18 LUFS) для каждого спикера по длинным клипам
  const speakerBaselineGains = new Map<string, number[]>();
  const allBaselineGains: number[] = [];

  for (const item of parsed) {
    if (!item.isLongEnough || item.lufsBefore === null) continue;
    const baselineGainDb = Math.max(
      MIN_SAFE_GAIN_DB,
      Math.min(MAX_SAFE_GAIN_DB, defaultTarget - item.lufsBefore)
    );
    const key = String(item.clip.speaker || "").trim().toLowerCase() || "__default__";
    const arr = speakerBaselineGains.get(key) || [];
    arr.push(baselineGainDb);
    speakerBaselineGains.set(key, arr);
    allBaselineGains.push(baselineGainDb);
  }

  const speakerMedianGain = new Map<string, number>();
  for (const [key, gains] of speakerBaselineGains.entries()) {
    speakerMedianGain.set(key, computeMedian(gains));
  }
  const fallbackSubBlockMedianGain =
    allBaselineGains.length > 0 ? computeMedian(allBaselineGains) : 0;

  // Шаг 2: применяем усиление + peak-лимитер
  return parsed.map((item) => {
    if (item.samples.length === 0) {
      return {
        pcm: Buffer.alloc(0),
        lufsBefore: null,
        lufsAfter: null,
        targetLufs: item.targetLufs,
        gainDb: 0,
        peakAfterDbfs: null,
        usedMedianGain: false,
      };
    }

    let gainDb = 0;
    let usedMedianGain = false;

    if (item.isLongEnough && item.lufsBefore !== null) {
      gainDb = Math.max(
        MIN_SAFE_GAIN_DB,
        Math.min(MAX_SAFE_GAIN_DB, item.targetLufs - item.lufsBefore)
      );
    } else {
      usedMedianGain = true;
      const key = String(item.clip.speaker || "").trim().toLowerCase() || "__default__";
      const spMedian = speakerMedianGain.has(key)
        ? speakerMedianGain.get(key)!
        : fallbackSubBlockMedianGain;
      const quietlyOffset = item.isQuietly ? quietlyTarget - defaultTarget : 0;
      gainDb = Math.max(
        MIN_SAFE_GAIN_DB,
        Math.min(MAX_SAFE_GAIN_DB, spMedian + quietlyOffset)
      );
    }

    let processed = applyGainAndPeakLimiter(
      item.samples,
      gainDb,
      sampleRate,
      ceilingLinear
    );
    let measuredAfter = measureIntegratedLufsFloat(processed, sampleRate);

    // Если лимитер чуть просадил интегрированную громкость на длинном клипе (> 0.35 дБ от цели),
    // делаем одну точную коррекцию усиления с тем же потолком -1 dBFS (не более +3 дБ)
    if (
      item.isLongEnough &&
      Number.isFinite(measuredAfter) &&
      Math.abs(measuredAfter - item.targetLufs) > 0.35
    ) {
      const correction = Math.max(
        -3.0,
        Math.min(3.0, item.targetLufs - measuredAfter)
      );
      const adjustedGainDb = Math.max(
        MIN_SAFE_GAIN_DB,
        Math.min(MAX_SAFE_GAIN_DB, gainDb + correction)
      );
      processed = applyGainAndPeakLimiter(
        item.samples,
        adjustedGainDb,
        sampleRate,
        ceilingLinear
      );
      gainDb = adjustedGainDb;
      measuredAfter = measureIntegratedLufsFloat(processed, sampleRate);
    }

    let truePeakAfter = measureTruePeakDbfsFloat(processed);
    if (Number.isFinite(truePeakAfter) && truePeakAfter > ceilingDbfs) {
      const margin = truePeakAfter - ceilingDbfs + 0.2;
      const tightenedCeiling = Math.pow(10, (ceilingDbfs - margin) / 20);
      processed = applyGainAndPeakLimiter(
        item.samples,
        gainDb,
        sampleRate,
        tightenedCeiling
      );
      measuredAfter = measureIntegratedLufsFloat(processed, sampleRate);
      truePeakAfter = measureTruePeakDbfsFloat(processed);
    }

    const peakAfter = measurePeakDbfsFloat(processed);

    return {
      pcm: float64ToPcm16(processed),
      lufsBefore:
        item.lufsBefore !== null ? Math.round(item.lufsBefore * 100) / 100 : null,
      lufsAfter: Number.isFinite(measuredAfter)
        ? Math.round(measuredAfter * 100) / 100
        : null,
      targetLufs: item.targetLufs,
      gainDb: Math.round(gainDb * 100) / 100,
      peakAfterDbfs: Number.isFinite(peakAfter)
        ? Math.round(peakAfter * 100) / 100
        : null,
      truePeakAfterDbfs: Number.isFinite(truePeakAfter)
        ? Math.round(truePeakAfter * 100) / 100
        : null,
      usedMedianGain,
    };
  });
}
