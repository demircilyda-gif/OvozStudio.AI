import { useState, useEffect, useRef } from 'react';

export interface GenerationCountdownState {
  elapsedSeconds: number;
  remainingSeconds: number;
  remainingDigits: string;
  progressPercent: number;
  currentPhase: 1 | 2 | 3 | 4;
  phaseNameUz: string;
  phaseNameRu: string;
  formattedElapsed: string;
  formattedRemaining: string;
  formattedEstimated: string;
  safeEstimatedSeconds: number;
}

export function formatDurationHuman(seconds: number, lang: 'uz' | 'ru'): string {
  const rounded = Math.max(1, Math.round(seconds));
  if (rounded < 60) {
    return lang === 'uz' ? `${rounded} soniya` : `${rounded} сек`;
  }
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  if (secs === 0) {
    return lang === 'uz' ? `${mins} daqiqa` : `${mins} мин`;
  }
  return lang === 'uz' ? `${mins} daqiqa ${secs} soniya` : `${mins} мин ${secs} сек`;
}

export function formatTimeDigits(secs: number): string {
  const safeSecs = Math.max(0, Math.round(secs));
  const m = Math.floor(safeSecs / 60);
  const s = safeSecs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Pre-calculation helpers
export function calculateAudioSynthesizeSeconds(wordCount: number, tempo: number = 1.0): number {
  const safeWords = Math.max(10, wordCount || 10);
  const safeTempo = Math.max(0.5, Math.min(2.0, tempo || 1.0));
  // Base latency (~2.8s) + ~1.1s per 85 words adjusted for tempo
  const calc = 2.8 + (safeWords / (85 * safeTempo));
  return Math.max(4, Math.round(calc));
}

export function calculateInterviewDialogueSeconds(turnsCount: number): number {
  const safeTurns = Math.max(1, turnsCount || 1);
  // Processed in parallel batches of 5 (each batch ~14s) + master WAV stitch (~3.5s)
  const batches = Math.ceil(safeTurns / 5);
  return Math.max(6, Math.round(batches * 14 + 3.5));
}

export function calculateAiScriptSeconds(targetDurationStr: string, format: 'solo' | 'interview' = 'solo'): number {
  const lower = (targetDurationStr || '').toLowerCase();
  if (format === 'interview') {
    if (lower.includes('90') || lower.includes('1.5') || lower.includes('полтора')) return 45;
    if (lower.includes('60') || lower.includes('1 soat') || lower.includes('1 час')) return 35;
    if (lower.includes('45')) return 28;
    if (lower.includes('30') || lower.includes('30 daqiqa')) return 24;
    if (lower.includes('15') || lower.includes('15 daqiqa')) return 18;
    if (lower.includes('10')) return 15;
    if (lower.includes('5')) return 12;
    return 20;
  }
  // Solo
  if (lower.includes('10')) return 18;
  if (lower.includes('5')) return 14;
  if (lower.includes('3')) return 11;
  if (lower.includes('2')) return 9;
  if (lower.includes('1')) return 7;
  if (lower.includes('30 soniya')) return 6;
  return 10;
}

export type GenerationTaskType = 'audio_solo' | 'audio_dialogue' | 'audio_voiceover' | 'script_solo' | 'script_interview';

export function useGenerationCountdown(
  isActive: boolean,
  estimatedTotalSeconds: number,
  lang: 'uz' | 'ru' = 'uz',
  taskType: GenerationTaskType = 'audio_solo'
): GenerationCountdownState {
  const [elapsed, setElapsed] = useState<number>(0);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!isActive) {
      setElapsed(0);
      startTimeRef.current = 0;
      return;
    }

    startTimeRef.current = Date.now();
    setElapsed(0);

    const interval = setInterval(() => {
      const now = Date.now();
      const diffSecs = (now - startTimeRef.current) / 1000;
      setElapsed(diffSecs);
    }, 100);

    return () => clearInterval(interval);
  }, [isActive]);

  const safeEstimated = Math.max(3, estimatedTotalSeconds);
  const remainingSeconds = Math.max(1, Math.round(safeEstimated - elapsed));

  // Calculate smooth progress
  let progressPercent = 0;
  if (isActive) {
    if (elapsed < safeEstimated) {
      progressPercent = Math.min(94, (elapsed / safeEstimated) * 94);
    } else {
      // Gentle creep between 94% and 98.5% if network takes slightly longer
      const overtime = elapsed - safeEstimated;
      const creep = Math.min(4.5, (overtime / (safeEstimated * 0.5)) * 4.5);
      progressPercent = Math.min(98.5, 94 + creep);
    }
  }

  // Determine current generation phase depending on task type
  let currentPhase: 1 | 2 | 3 | 4 = 1;
  let phaseNameUz = "Ssenariy tahlili va fonetik tayyorlash...";
  let phaseNameRu = "Анализ текста и фонетическая подготовка...";

  if (taskType === 'script_solo' || taskType === 'script_interview') {
    if (progressPercent < 25) {
      currentPhase = 1;
      phaseNameUz = "Mavzu, dramaturgiya va struktura tahlili...";
      phaseNameRu = "Анализ темы, драматургии и структуры...";
    } else if (progressPercent < 60) {
      currentPhase = 2;
      phaseNameUz = taskType === 'script_interview'
        ? "2 boshlovchi o'rtasida jonli dialog yaratilmoqda..."
        : "Gemini AI bilan o'zbekcha mualliflik matni yozilmoqda...";
      phaseNameRu = taskType === 'script_interview'
        ? "Создание живого диалога между ведущими..."
        : "Генерация авторского текста подкаста...";
    } else if (progressPercent < 85) {
      currentPhase = 3;
      phaseNameUz = "Hissiyotlar, pauzalar va nafas nuqtalari joylashtirilmoqda...";
      phaseNameRu = "Расстановка эмоций, дыхания и естественных пауз...";
    } else {
      currentPhase = 4;
      phaseNameUz = "Ssenariy yakuniy tahriri va vaqt kalibratsiyasi...";
      phaseNameRu = "Финальная редактура и калибровка таймингов...";
    }
  } else if (taskType === 'audio_dialogue') {
    if (progressPercent < 22) {
      currentPhase = 1;
      phaseNameUz = "Replikalar va 2 boshlovchi ovozlari taqsimlanmoqda...";
      phaseNameRu = "Распределение реплик и голосов двух ведущих...";
    } else if (progressPercent < 65) {
      currentPhase = 2;
      phaseNameUz = "Parallel oqimlarda Dual-TTS ovoz sintezi ketmoqda...";
      phaseNameRu = "Параллельный нейросинтез реплик Dual-TTS...";
    } else if (progressPercent < 88) {
      currentPhase = 3;
      phaseNameUz = "Akustik muvozanat va replikalararo pauzalar sozlanmoqda...";
      phaseNameRu = "Балансировка громкости и пауз между репликами...";
    } else {
      currentPhase = 4;
      phaseNameUz = "Master WAV audio-trek va karaoke vaqtlari tikilmoqda...";
      phaseNameRu = "Сборка мастер-трека WAV и таймкодов караоке...";
    }
  } else {
    // audio_solo or audio_voiceover
    if (progressPercent < 24) {
      currentPhase = 1;
      phaseNameUz = "Matn tahlili va fonetik tayyorlash...";
      phaseNameRu = "Анализ текста и фонетическая подготовка...";
    } else if (progressPercent < 68) {
      currentPhase = 2;
      phaseNameUz = "OvozStudio Neural TTS ovoz generatsiyasi...";
      phaseNameRu = "Нейросетевой синтез голоса OvozStudio...";
    } else if (progressPercent < 90) {
      currentPhase = 3;
      phaseNameUz = "Akustik tembr va 24 kHz sifat kalibratsiyasi...";
      phaseNameRu = "Акустическая калибровка и 24 кГц тембр...";
    } else {
      currentPhase = 4;
      phaseNameUz = "Master WAV audio-trekni yig'ish va tayyorlash...";
      phaseNameRu = "Сборка чистого master-трека WAV...";
    }
  }

  return {
    elapsedSeconds: Math.floor(elapsed),
    remainingSeconds,
    remainingDigits: formatTimeDigits(remainingSeconds),
    progressPercent: Math.round(progressPercent * 10) / 10,
    currentPhase,
    phaseNameUz,
    phaseNameRu,
    formattedElapsed: formatTimeDigits(Math.floor(elapsed)),
    formattedRemaining: formatDurationHuman(remainingSeconds, lang),
    formattedEstimated: formatDurationHuman(safeEstimated, lang),
    safeEstimatedSeconds: safeEstimated,
  };
}
