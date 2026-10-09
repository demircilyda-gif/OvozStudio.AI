import React from 'react';
import { Clock, Sparkles, CheckCircle2, Waves, Activity, Calculator, Radio } from 'lucide-react';
import {
  GenerationCountdownState,
  formatTimeDigits,
  formatDurationHuman,
} from '../hooks/useGenerationCountdown';

interface GenerationCountdownHUDProps {
  countdown: GenerationCountdownState;
  isActive: boolean;
  lang: 'uz' | 'ru';
  title?: string;
  subtitle?: string;
  mode?: 'floating' | 'inline' | 'modal';
  onCancel?: () => void;
}

export const GenerationCountdownHUD: React.FC<GenerationCountdownHUDProps> = ({
  countdown,
  isActive,
  lang,
  title,
  subtitle,
  mode = 'inline',
}) => {
  if (!isActive) return null;

  const defaultTitle = lang === 'uz' ? 'Podkast Tayyorlanmoqda' : 'Создание Подкаста';
  const defaultSubtitle = lang === 'uz' ? countdown.phaseNameUz : countdown.phaseNameRu;

  const phases = [
    { id: 1, labelUz: 'Tahlil', labelRu: 'Анализ' },
    { id: 2, labelUz: 'Neyro-Sintez', labelRu: 'Синтез' },
    { id: 3, labelUz: 'Akustika (24k)', labelRu: 'Калибровка' },
    { id: 4, labelUz: 'Master WAV', labelRu: 'Сборка' },
  ];

  const content = (
    <div className="relative overflow-hidden bg-white/95 backdrop-blur-md border-2 border-[#0E7C86] rounded-2xl p-4 sm:p-5 shadow-[0_20px_50px_-15px_rgba(14,124,134,0.35)] select-none transition-all animate-in fade-in zoom-in-95 duration-200">
      {/* Ambient Top Glow Line */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#0E7C86] via-[#5CC8CF] to-[#C4552D] animate-pulse" />

      {/* Main Grid: Info + Big Digital Countdown */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[rgba(22,21,17,0.08)] pb-4">
        {/* Left: Title & Neural Indicator */}
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#0E7C86] to-[#0A5A62] text-white flex items-center justify-center shrink-0 shadow-md">
            <Radio className="w-5 h-5 animate-pulse text-[#5CC8CF]" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-bold text-sm sm:text-base text-[#161511]">
                {title || defaultTitle}
              </h4>
              <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-[#0A5A62] bg-[#0E7C86]/10 border border-[#0E7C86]/20 px-2 py-0.5 rounded-full font-semibold">
                <i className="w-1.5 h-1.5 rounded-full bg-[#0E7C86] animate-ping" />
                <span>OvozStudio Live</span>
              </span>
            </div>
            <p className="text-xs text-[#5D594E] flex items-center gap-1.5 mt-0.5 font-sans">
              <Activity className="w-3.5 h-3.5 text-[#0E7C86] animate-spin" style={{ animationDuration: '3s' }} />
              <span className="font-medium text-[#161511]">{subtitle || defaultSubtitle}</span>
            </p>
          </div>
        </div>

        {/* Right: Big Digital Timer Card */}
        <div className="flex items-center gap-3 bg-[#F4F1EA] border border-[rgba(22,21,17,0.14)] rounded-2xl px-4 py-2 self-start sm:self-auto shadow-xs">
          <Clock className="w-5 h-5 text-[#0E7C86] animate-spin" style={{ animationDuration: '4s' }} />
          <div className="text-right">
            <div className="text-[10px] uppercase font-mono tracking-wider text-[#5D594E]">
              {lang === 'uz' ? 'Qolgan vaqt' : 'Осталось времени'}
            </div>
            <div className="flex items-baseline justify-end gap-1.5">
              <span className="font-mono font-extrabold text-xl sm:text-2xl text-[#0A5A62] tracking-tight">
                {countdown.remainingDigits}
              </span>
              <span className="text-xs font-mono text-[#5D594E]">
                (~{countdown.formattedRemaining})
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Progress Bar & Real-time Stats */}
      <div className="pt-3 space-y-2">
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="text-[#161511] font-semibold flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[#0E7C86]" />
            <span>
              {lang === 'uz' ? `Bosqich ${countdown.currentPhase}/4: ${countdown.phaseNameUz}` : `Этап ${countdown.currentPhase}/4: ${countdown.phaseNameRu}`}
            </span>
          </span>
          <span className="text-[#0E7C86] font-extrabold text-sm sm:text-base">
            {countdown.progressPercent}%
          </span>
        </div>

        {/* Gradient Progress Bar */}
        <div className="w-full h-3 bg-[#EAE6DD] rounded-full overflow-hidden p-0.5 border border-[rgba(22,21,17,0.12)] relative">
          <div
            className="h-full bg-gradient-to-r from-[#0E7C86] via-[#20A2AE] to-[#5CC8CF] rounded-full transition-all duration-200 ease-out relative shadow-sm"
            style={{ width: `${Math.max(4, Math.min(100, countdown.progressPercent))}%` }}
          >
            <div className="absolute inset-0 bg-white/25 animate-pulse rounded-full" />
          </div>
        </div>

        {/* Elapsed vs Estimated Timers */}
        <div className="flex items-center justify-between text-[11px] font-mono text-[#5D594E] pt-0.5">
          <span>
            {lang === 'uz' ? `O'tgan vaqt: ${countdown.formattedElapsed}` : `Прошло времени: ${countdown.formattedElapsed}`}
          </span>
          <span className="text-[#0A5A62] font-semibold">
            {lang === 'uz' ? `Jami hisoblangan: ~${countdown.formattedEstimated}` : `Всего рассчитано: ~${countdown.formattedEstimated}`}
          </span>
        </div>
      </div>

      {/* 4-Phase Step Pipeline */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3 mt-3 border-t border-[rgba(22,21,17,0.06)]">
        {phases.map((ph) => {
          const isDone = countdown.currentPhase > ph.id;
          const isCurrent = countdown.currentPhase === ph.id;
          return (
            <div
              key={ph.id}
              className={`p-2 rounded-xl text-center border transition-all ${
                isCurrent
                  ? 'bg-[rgba(14,124,134,0.12)] border-[#0E7C86] text-[#0A5A62] font-semibold ring-1 ring-[#0E7C86]/30'
                  : isDone
                  ? 'bg-zinc-50 border-zinc-200 text-zinc-700'
                  : 'bg-transparent border-transparent text-[#7D7A70] opacity-50'
              }`}
            >
              <div className="flex items-center justify-center gap-1.5 text-[11px]">
                {isDone ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#0E7C86]" />
                ) : isCurrent ? (
                  <Waves className="w-3.5 h-3.5 text-[#0E7C86] animate-bounce" />
                ) : (
                  <span className="w-3.5 h-3.5 rounded-full border border-zinc-300 inline-flex items-center justify-center text-[8px] font-mono">
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

  if (mode === 'floating') {
    return (
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[95%] max-w-2xl px-2">
        {content}
      </div>
    );
  }

  return content;
};

interface PreCalculationBadgeProps {
  estimatedSeconds: number;
  wordCount?: number;
  audioDurationSeconds?: number;
  creditsCost?: number;
  lang: 'uz' | 'ru';
  className?: string;
}

export const PreCalculationBadge: React.FC<PreCalculationBadgeProps> = ({
  estimatedSeconds,
  wordCount,
  audioDurationSeconds,
  creditsCost,
  lang,
  className = '',
}) => {
  const safeEst = Math.max(3, estimatedSeconds);
  const formattedTime = formatDurationHuman(safeEst, lang);
  const formattedDigits = formatTimeDigits(safeEst);

  return (
    <div
      className={`inline-flex items-center gap-2 bg-[#F4F1EA] border border-[rgba(22,21,17,0.14)] rounded-xl px-3 py-1.5 text-xs font-mono text-[#5D594E] shadow-2xs ${className}`}
      title={lang === 'uz' ? "Generatsiya boshlanishidan oldin aniq hisoblangan vaqt" : "Точно рассчитанное время до начала генерации"}
    >
      <div className="flex items-center gap-1 text-[#0E7C86] font-semibold">
        <Calculator className="w-3.5 h-3.5 text-[#0E7C86]" />
        <span>{lang === 'uz' ? "Hisoblangan vaqt:" : "Расчетное время:"}</span>
      </div>
      <span className="font-bold text-[#161511]">
        ~{formattedTime} ({formattedDigits})
      </span>
      {typeof audioDurationSeconds === 'number' && audioDurationSeconds > 0 && (
        <span className="text-[11px] text-[#0A5A62] bg-[rgba(14,124,134,0.1)] px-1.5 py-0.5 rounded-md">
          {lang === 'uz'
            ? `Audio: ~${formatTimeDigits(audioDurationSeconds)}`
            : `Аудио: ~${formatTimeDigits(audioDurationSeconds)}`}
        </span>
      )}
      {typeof creditsCost === 'number' && (
        <span className="text-[10px] text-[#C4552D] font-bold">
          {creditsCost} kr.
        </span>
      )}
    </div>
  );
};
