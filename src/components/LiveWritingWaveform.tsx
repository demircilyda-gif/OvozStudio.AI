import React, { useEffect, useRef } from 'react';
import { Clock, Sparkles, CheckCircle2, Waves, Radio } from 'lucide-react';
import {
  useGenerationCountdown,
  formatTimeDigits,
  calculateAudioSynthesizeSeconds,
  GenerationCountdownState,
} from '../hooks/useGenerationCountdown';

interface LiveWritingWaveformProps {
  lang: 'uz' | 'ru';
  voiceName: string;
  wordCount?: number;
  estimatedAudioSeconds?: number;
  isSynthesizing?: boolean;
  countdownState?: GenerationCountdownState;
}

export const LiveWritingWaveform: React.FC<LiveWritingWaveformProps> = ({
  lang,
  voiceName,
  wordCount = 100,
  estimatedAudioSeconds = 30,
  isSynthesizing = true,
  countdownState,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Calculate estimated generation duration in seconds (only needed if countdownState is not provided)
  const estimatedGenSeconds = calculateAudioSynthesizeSeconds(wordCount);

  // Fallback internal countdown only if no parent countdown is supplied (prevents duplicate intervals)
  const fallbackCountdown = useGenerationCountdown(
    countdownState ? false : isSynthesizing,
    estimatedGenSeconds,
    lang,
    'audio_solo'
  );

  const activeCountdown = countdownState || fallbackCountdown;
  const {
    formattedElapsed,
    formattedRemaining,
    formattedEstimated,
    remainingDigits,
    progressPercent,
    currentPhase,
    phaseNameUz,
    phaseNameRu,
  } = activeCountdown;

  // Audio Waveform Animation Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let progress = 0;
    let phase = 0;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      const centerY = height / 2;

      ctx.clearRect(0, 0, width, height);

      if (progress < 0.95) {
        progress += 0.007;
      } else {
        progress = 0.95 + Math.sin(phase * 2) * 0.02;
      }
      phase += 0.09;

      const currentX = width * progress;

      // Baseline
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(14, 124, 134, 0.2)';
      ctx.lineWidth = 1;
      ctx.moveTo(0, centerY);
      ctx.lineTo(width, centerY);
      ctx.stroke();

      // Secondary ambient wave (Teal)
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(14, 124, 134, 0.45)';
      ctx.lineWidth = 1.5;
      for (let x = 0; x <= currentX; x += 3) {
        const norm = x / width;
        const amp = Math.sin(norm * Math.PI) * (height * 0.28);
        const y = centerY + Math.sin(x * 0.04 + phase * 0.8) * Math.cos(x * 0.02 - phase) * amp;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Primary voice synthesis waveform (Teal Light & Saffron)
      ctx.beginPath();
      ctx.strokeStyle = '#0E7C86';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = 'rgba(14, 124, 134, 0.4)';
      ctx.shadowBlur = 10;

      for (let x = 0; x <= currentX; x += 2) {
        const norm = x / width;
        const envelope = Math.sin(norm * Math.PI * 1.5) * Math.cos(norm * Math.PI * 0.8);
        const speechBurst = Math.sin(x * 0.09 + phase) * Math.sin(x * 0.03 - phase * 1.5);
        const amp = Math.abs(envelope) * (height * 0.38) + 4;
        const y = centerY + speechBurst * amp;

        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Leading spark cursor
      if (currentX > 2 && currentX < width) {
        const norm = currentX / width;
        const envelope = Math.sin(norm * Math.PI * 1.5) * Math.cos(norm * Math.PI * 0.8);
        const speechBurst = Math.sin(currentX * 0.09 + phase) * Math.sin(currentX * 0.03 - phase * 1.5);
        const amp = Math.abs(envelope) * (height * 0.38) + 4;
        const cursorY = centerY + speechBurst * amp;

        const glowGrad = ctx.createRadialGradient(currentX, cursorY, 0, currentX, cursorY, 16);
        glowGrad.addColorStop(0, 'rgba(92, 200, 207, 0.9)');
        glowGrad.addColorStop(0.5, 'rgba(14, 124, 134, 0.4)');
        glowGrad.addColorStop(1, 'rgba(14, 124, 134, 0)');
        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.arc(currentX, cursorY, 16, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#0E7C86';
        ctx.beginPath();
        ctx.arc(currentX, cursorY, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
    };
  }, []);

  const phases = [
    { id: 1, labelUz: 'Matn tahlili', labelRu: 'Анализ' },
    { id: 2, labelUz: 'Neyro-TTS', labelRu: 'Синтез' },
    { id: 3, labelUz: 'Akustika (24k)', labelRu: 'Калибровка' },
    { id: 4, labelUz: 'Master WAV', labelRu: 'Сборка' },
  ];

  return (
    <div className="border border-[#0E7C86]/35 rounded-[22px] bg-white p-5 sm:p-6 space-y-4 shadow-md select-none transition-all animate-in fade-in duration-300">
      {/* Top Header: Voice Info + Prominent Countdown Timer */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[rgba(22,21,17,0.08)] pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[rgba(14,124,134,0.12)] border border-[rgba(14,124,134,0.25)] flex items-center justify-center shrink-0">
            <Radio className="w-5 h-5 text-[#0E7C86] animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm sm:text-base text-[#161511]">
                {voiceName}
              </span>
              <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-[#0A5A62] bg-[rgba(14,124,134,0.12)] px-2 py-0.5 rounded-full font-semibold">
                <i className="w-1.5 h-1.5 rounded-full bg-[#0E7C86] pulse-teal-dot" />
                <span>OvozStudio Neural Live</span>
              </span>
            </div>
            <p className="text-xs text-[#5D594E] mt-0.5">
              {wordCount > 0 ? `${wordCount} ${lang === 'uz' ? "so'z" : 'слов'}` : ''}
              {estimatedAudioSeconds > 0
                ? ` · ~${formatTimeDigits(estimatedAudioSeconds)} ${lang === 'uz' ? 'audio' : 'аудио'}`
                : ''}
            </p>
          </div>
        </div>

        {/* Live Audio Status Strip without timer duplication */}
        <div className="flex items-center gap-2 bg-[#F4F1EA] border border-[rgba(22,21,17,0.14)] rounded-2xl px-3.5 py-2 self-start sm:self-auto shadow-2xs font-mono text-xs">
          <div className="w-2 h-2 rounded-full bg-[#0E7C86] pulse-teal-dot" />
          <span className="font-bold text-[#0A5A62]">24 kHz PCM</span>
          <span className="text-[#5D594E]">·</span>
          <span className="font-bold text-[#161511]">{progressPercent}%</span>
        </div>
      </div>

      {/* Progress Bar with Percentage and Elapsed Time */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="text-[#161511] font-semibold flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[#0E7C86]" />
            <span>{lang === 'uz' ? phaseNameUz : phaseNameRu}</span>
          </span>
          <span className="text-[#0E7C86] font-bold text-sm">
            {progressPercent}%
          </span>
        </div>

        {/* Modern Animated Progress Track */}
        <div className="w-full h-2.5 bg-[#EAE6DD] rounded-full overflow-hidden p-0.5 border border-[rgba(22,21,17,0.1)] relative">
          <div
            className="h-full bg-gradient-to-r from-[#0E7C86] via-[#20A2AE] to-[#5CC8CF] rounded-full transition-all duration-200 ease-out relative shadow-sm"
            style={{ width: `${Math.max(4, Math.min(100, progressPercent))}%` }}
          >
            <div className="absolute inset-0 bg-white/20 animate-pulse rounded-full" />
          </div>
        </div>

        <div className="flex items-center justify-between text-[11px] font-mono text-[#5D594E] pt-0.5">
          <span>{lang === 'uz' ? `O'tgan vaqt: ${formattedElapsed}` : `Прошло: ${formattedElapsed}`}</span>
          <span>{lang === 'uz' ? `Taxminiy umumiy vaqt: ~${formattedEstimated}` : `Общее время: ~${formattedEstimated}`}</span>
        </div>
      </div>

      {/* Waveform Canvas */}
      <div className="w-full h-20 bg-[#F4F1EA] rounded-xl overflow-hidden border border-[rgba(22,21,17,0.1)] relative">
        <canvas
          ref={canvasRef}
          width={800}
          height={80}
          className="w-full h-full block"
        />
        <div className="absolute bottom-1.5 right-2.5 font-mono text-[9.5px] uppercase tracking-wider text-[#0A5A62]/75 bg-white/80 px-2 py-0.5 rounded-md backdrop-blur-xs">
          24 kHz PCM 16-bit
        </div>
      </div>

      {/* 4-Step Process Pipeline Indicator */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 border-t border-[rgba(22,21,17,0.06)]">
        {phases.map((ph) => {
          const isDone = currentPhase > ph.id;
          const isCurrent = currentPhase === ph.id;
          return (
            <div
              key={ph.id}
              className={`p-2 rounded-xl text-center border transition-all ${
                isCurrent
                  ? 'bg-[rgba(14,124,134,0.12)] border-[#0E7C86] text-[#0A5A62] font-semibold'
                  : isDone
                  ? 'bg-zinc-50 border-zinc-200 text-zinc-700'
                  : 'bg-transparent border-transparent text-[#7D7A70] opacity-50'
              }`}
            >
              <div className="flex items-center justify-center gap-1 text-[11px]">
                {isDone ? (
                  <CheckCircle2 className="w-3 h-3 text-[#0E7C86]" />
                ) : isCurrent ? (
                  <Waves className="w-3 h-3 text-[#0E7C86] animate-bounce" />
                ) : (
                  <span className="w-3 h-3 rounded-full border border-zinc-300 inline-flex items-center justify-center text-[8px] font-mono">
                    {ph.id}
                  </span>
                )}
                <span className="truncate">{lang === 'uz' ? ph.labelUz : ph.labelRu}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
