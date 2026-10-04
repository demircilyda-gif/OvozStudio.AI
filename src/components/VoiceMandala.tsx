import React, { useEffect, useRef } from 'react';
import { getAudioReactiveSnapshot } from '../utils/audioReactive';

interface VoiceMandalaProps {
  className?: string;
  size?: number; // default 420
  voiceName?: string;
  isInteractive?: boolean;
}

export const VoiceMandala: React.FC<VoiceMandalaProps> = ({
  className = '',
  size = 420,
  voiceName,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isVisibleRef = useRef<boolean>(true);
  const animFrameIdRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Viewport IntersectionObserver
    const observer = new IntersectionObserver(
      ([entry]) => {
        isVisibleRef.current = entry.isIntersecting;
        if (entry.isIntersecting && !animFrameIdRef.current) {
          animFrameIdRef.current = requestAnimationFrame(render);
        } else if (!entry.isIntersecting && animFrameIdRef.current) {
          cancelAnimationFrame(animFrameIdRef.current);
          animFrameIdRef.current = null;
        }
      },
      { threshold: 0.05 }
    );
    observer.observe(canvas);

    const W = size;
    const H = size;
    const cx = W / 2;
    const cy = H / 2;
    const baseRadius = Math.min(W, H) * 0.21; // ~88.2px
    const maxBarSpan = Math.min(W, H) * 0.25; // ~105px (fits within 420x420)
    const startTime = performance.now();

    function setupDPR() {
      if (!canvas || !ctx) return;
      // Cap DPR at 2
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    setupDPR();
    window.addEventListener('resize', setupDPR);

    function render(now: number) {
      if (!isVisibleRef.current) {
        animFrameIdRef.current = null;
        return;
      }

      if (!ctx) return;

      const t = (now - startTime) / 1000; // time in seconds
      ctx.clearRect(0, 0, W, H);

      // Snapshot from Web Audio API
      const snapshot = getAudioReactiveSnapshot();
      const isPlaying = snapshot.isPlaying;

      // Energy for center dot & outer ring
      let avgEnergy = snapshot.avgEnergy;
      if (!isPlaying) {
        // Idle breathing energy
        avgEnergy = 0.06 + 0.05 * Math.sin(t * 1.6);
      }

      // Slow rotation: t * 0.06 rad/s
      const rotation = t * 0.06;

      // 1) Thin ink 16% inner circle
      ctx.save();
      ctx.strokeStyle = 'rgba(22, 21, 17, 0.16)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, cy, baseRadius, 0, Math.PI * 2);
      ctx.stroke();

      // Subtle inner secondary guide circle
      ctx.strokeStyle = 'rgba(14, 124, 134, 0.08)';
      ctx.beginPath();
      ctx.arc(cx, cy, baseRadius * 0.62, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // 2) Outer energy ring that expands with average energy
      ctx.save();
      const outerRingRadius = baseRadius + maxBarSpan * 0.65 + avgEnergy * 35;
      ctx.strokeStyle = `rgba(14, 124, 134, ${0.12 + avgEnergy * 0.45})`;
      ctx.lineWidth = 1 + avgEnergy * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, outerRingRadius, 0, Math.PI * 2);
      ctx.stroke();

      // Halo shimmer around outer energy ring
      if (avgEnergy > 0.15) {
        ctx.strokeStyle = `rgba(196, 85, 45, ${avgEnergy * 0.28})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx, cy, outerRingRadius + 6 + avgEnergy * 10, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

      // 3) 48 Radial Bars
      // bar length = 4px + (freqData[2+i]/255) * 55%
      // bars teal #0E7C86, every 8th terracotta #C4552D, lineCap round
      const barCount = 48;
      ctx.save();
      ctx.lineCap = 'round';

      for (let i = 0; i < barCount; i++) {
        let barRatio: number;

        if (isPlaying) {
          const freqVal = snapshot.freqData[2 + i] || 0;
          barRatio = freqVal / 255;
        } else {
          // Idle breathing with gentle sine: (0.08 + 0.07*sin(t*1.6 + i*0.4))
          barRatio = 0.08 + 0.07 * Math.sin(t * 1.6 + i * 0.4);
        }

        const barLength = 4 + barRatio * maxBarSpan;
        const angle = rotation + (i / barCount) * Math.PI * 2;

        const isTerracotta = i % 8 === 0;
        ctx.strokeStyle = isTerracotta ? '#C4552D' : '#0E7C86';
        ctx.lineWidth = isTerracotta ? 3.6 : 3.0;

        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);

        const x0 = cx + cosA * baseRadius;
        const y0 = cy + sinA * baseRadius;
        const x1 = cx + cosA * (baseRadius + barLength);
        const y1 = cy + sinA * (baseRadius + barLength);

        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
      ctx.restore();

      // 4) Pulsing terracotta center dot (radius 5 + avgEnergy*22)
      ctx.save();
      const dotRadius = Math.max(3, 5 + avgEnergy * 22);

      // Soft glow around center dot
      const grad = ctx.createRadialGradient(cx, cy, dotRadius * 0.2, cx, cy, dotRadius * 2);
      grad.addColorStop(0, 'rgba(196, 85, 45, 0.4)');
      grad.addColorStop(1, 'rgba(196, 85, 45, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, dotRadius * 2, 0, Math.PI * 2);
      ctx.fill();

      // Solid terracotta center dot
      ctx.fillStyle = '#C4552D';
      ctx.beginPath();
      ctx.arc(cx, cy, dotRadius, 0, Math.PI * 2);
      ctx.fill();

      // Pinpoint highlight inside dot
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.beginPath();
      ctx.arc(cx - dotRadius * 0.25, cy - dotRadius * 0.25, Math.max(1.2, dotRadius * 0.22), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      animFrameIdRef.current = requestAnimationFrame(render);
    }

    animFrameIdRef.current = requestAnimationFrame(render);

    return () => {
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
        animFrameIdRef.current = null;
      }
      observer.disconnect();
      window.removeEventListener('resize', setupDPR);
    };
  }, [size]);

  return (
    <div className={`relative flex flex-col items-center justify-center ${className}`}>
      <canvas
        ref={canvasRef}
        className="w-full max-w-[420px] aspect-square mx-auto block cursor-pointer select-none"
        title={voiceName ? `${voiceName} ovoz mandalasi` : 'Ovoz mandalasi'}
      />
    </div>
  );
};
