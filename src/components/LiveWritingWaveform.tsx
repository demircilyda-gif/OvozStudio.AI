import React, { useEffect, useRef } from 'react';

interface LiveWritingWaveformProps {
  lang: 'uz' | 'ru';
  voiceName: string;
}

export const LiveWritingWaveform: React.FC<LiveWritingWaveformProps> = ({
  lang,
  voiceName,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

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
        progress += 0.006;
      } else {
        progress = 0.95 + Math.sin(phase * 2) * 0.02;
      }
      phase += 0.08;

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

      // Leading spark
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

  return (
    <div className="border border-[rgba(22,21,17,0.14)] rounded-[20px] bg-white/90 p-5 space-y-3 shadow-sm select-none">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-2.5 h-2.5 rounded-full bg-[#0E7C86] pulse-teal-dot" />
          <span className="font-semibold text-xs sm:text-sm text-[#161511]">
            {lang === 'uz'
              ? `Jonli Ovoz Sintezi: ${voiceName}`
              : `Живой аудио-синтез: ${voiceName}`}
          </span>
        </div>
        <span className="font-mono text-xs uppercase tracking-wider text-[#0A5A62] bg-[rgba(14,124,134,0.10)] px-2.5 py-0.5 rounded-full">
          24 kHz Wave
        </span>
      </div>

      <div className="w-full h-24 bg-[#F4F1EA] rounded-xl overflow-hidden border border-[rgba(22,21,17,0.1)] relative">
        <canvas
          ref={canvasRef}
          width={800}
          height={96}
          className="w-full h-full block"
        />
      </div>

      <div className="flex items-center justify-between text-[11px] font-mono text-[#5D594E]">
        <span>Gemini 3.8 Flash TTS Engine</span>
        <span>{lang === 'uz' ? 'Ovoz toʻlqini yozilmoqda...' : 'Генерация звуковой дорожки...'}</span>
      </div>
    </div>
  );
};
