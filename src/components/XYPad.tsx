import React, { useRef, useState, useEffect, useCallback } from 'react';

interface XYPadProps {
  tempo: number; // 0.75 to 1.35
  onChangeTempo: (tempo: number) => void;
  timbreValue: number; // -1 (deep baritone) to +1 (bright clarity)
  onChangeTimbreValue: (val: number) => void;
  lang: 'uz' | 'ru';
}

export const XYPad: React.FC<XYPadProps> = ({
  tempo,
  onChangeTempo,
  timbreValue,
  onChangeTimbreValue,
  lang,
}) => {
  const padRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Convert tempo (0.75 to 1.35) to percentage (0 to 100)
  // 0.75 -> 0%, 1.05 -> 50%, 1.35 -> 100%
  const tempoToPercent = (t: number) => Math.max(0, Math.min(100, ((t - 0.75) / (1.35 - 0.75)) * 100));
  // Convert timbreValue (-1 to +1) to percentage (0 to 100, where +1 is top = 0% in DOM, -1 is bottom = 100%)
  const timbreToPercent = (tb: number) => Math.max(0, Math.min(100, ((1 - tb) / 2) * 100));

  const handlePointer = useCallback((e: MouseEvent | TouchEvent | React.MouseEvent | React.TouchEvent) => {
    if (!padRef.current) return;
    const rect = padRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;

    const relX = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const relY = Math.max(0, Math.min(rect.height, clientY - rect.top));

    const normX = relX / rect.width; // 0 to 1
    const normY = relY / rect.height; // 0 to 1 (0 is top, 1 is bottom)

    // Calculate tempo: 0.75 + normX * (1.35 - 0.75)
    const newTempo = Math.round((0.75 + normX * 0.6) * 100) / 100;
    // Calculate timbre: 1 - normY * 2 (+1 at top, -1 at bottom)
    const newTimbre = Math.round((1 - normY * 2) * 100) / 100;

    onChangeTempo(newTempo);
    onChangeTimbreValue(newTimbre);
  }, [onChangeTempo, onChangeTimbreValue]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    handlePointer(e);
  };

  useEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (isDragging) handlePointer(e);
    };
    const onEnd = () => {
      if (isDragging) setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onEnd);
      window.addEventListener('touchmove', onMove);
      window.addEventListener('touchend', onEnd);
    }
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
  }, [isDragging, handlePointer]);

  const xPercent = tempoToPercent(tempo);
  const yPercent = timbreToPercent(timbreValue);

  return (
    <div className="space-y-2 select-none">
      <div className="flex items-center justify-between text-xs">
        <span className="text-zinc-300 font-semibold tracking-wide">
          {lang === 'uz' ? 'XY Ovoz Pult (Tembr × Tezlik)' : 'XY Пульт (Тембр × Скорость)'}
        </span>
        <span className="font-mono text-xs text-[#FACC15] tabular-nums font-semibold">
          {tempo.toFixed(2)}x · {timbreValue >= 0 ? `+${Math.round(timbreValue * 100)}%` : `${Math.round(timbreValue * 100)}%`}
        </span>
      </div>

      {/* 2D Pad Surface */}
      <div
        ref={padRef}
        onMouseDown={handleMouseDown}
        onTouchStart={handlePointer}
        className="relative w-full h-36 rounded-2xl bg-[#2D2D42] overflow-hidden cursor-crosshair shadow-inner"
        style={{
          boxShadow: isDragging ? '0 0 25px rgba(79,70,229,0.25) inset' : undefined,
        }}
      >
        {/* Soft Grid Guides */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20">
          <div className="w-full h-px bg-[#4F46E5]" />
        </div>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20">
          <div className="h-full w-px bg-[#4F46E5]" />
        </div>

        {/* Center Target Mark */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-zinc-500/30 pointer-events-none" />

        {/* Axis Direction Indicators */}
        <div className="absolute top-2 left-1/2 -translate-x-1/2 text-[10px] text-zinc-400/80 font-medium pointer-events-none">
          ▲ {lang === 'uz' ? 'Yorqin / Aniq' : 'Яркий / Звонкий'}
        </div>
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] text-zinc-400/80 font-medium pointer-events-none">
          ▼ {lang === 'uz' ? 'Chuqur / Bas' : 'Глубокий / Бас'}
        </div>
        <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono text-zinc-400/80 pointer-events-none">
          0.75x
        </div>
        <div className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono text-zinc-400/80 pointer-events-none">
          1.35x
        </div>

        {/* Dynamic XY Cursor Thumb */}
        <div
          className="absolute w-6 h-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#FACC15] flex items-center justify-center transition-transform pointer-events-none"
          style={{
            left: `${xPercent}%`,
            top: `${yPercent}%`,
            boxShadow: '0 0 16px rgba(250, 204, 21, 0.65), 0 0 35px rgba(79, 70, 229, 0.45)',
            transform: `translate(-50%, -50%) scale(${isDragging ? 1.25 : 1})`,
          }}
        >
          <div className="w-2 h-2 rounded-full bg-[#1E1E2C]" />
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] text-zinc-400 px-1">
        <span>{lang === 'uz' ? 'Vazmin' : 'Спокойный'}</span>
        <button
          type="button"
          onClick={() => {
            onChangeTempo(1.0);
            onChangeTimbreValue(0);
          }}
          className="text-[11px] text-zinc-400 hover:text-[#FACC15] transition-colors cursor-pointer"
        >
          {lang === 'uz' ? 'Standartga qaytarish (1.0x)' : 'Сброс (1.0x)'}
        </button>
        <span>{lang === 'uz' ? 'Tezkor' : 'Быстрый'}</span>
      </div>
    </div>
  );
};
