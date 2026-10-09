import React, { useEffect, useRef, useState } from 'react';
import { AppTab } from './Sidebar';
import { connectAudioElement, getSharedAudioEnergy } from '../utils/audioReactive';
import {
  Sparkles,
  Building2,
  PhoneCall,
  Video,
  FileText,
  Mic,
  Fingerprint,
  FileSearch,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  Headphones,
  BookOpen,
  Megaphone,
  Users,
  Zap,
  Play,
} from 'lucide-react';

interface LandingPageProps {
  onEnterApp: (tab?: AppTab, mode?: 'solo' | 'interview' | 'voiceover') => void;
  lang: 'uz' | 'ru';
  setLang: (lang: 'uz' | 'ru') => void;
  onOpenAuthModal: () => void;
  onOpenPricingModal: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  onEnterApp,
  lang,
  setLang,
  onOpenAuthModal,
  onOpenPricingModal,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Audio preview toggle
  const togglePlay = () => {
    if (!audioRef.current) {
      audioRef.current = new Audio('/audio/previews/shokhrukh.wav');
      connectAudioElement(audioRef.current);
      audioRef.current.onended = () => setIsPlaying(false);
      audioRef.current.onerror = () => {
        // Fallback to aziza or replicated voice
        if (audioRef.current) {
          audioRef.current.src = '/audio/previews/voice_17raj9ewke3g.wav';
          connectAudioElement(audioRef.current);
          audioRef.current.play().catch(() => setIsPlaying(false));
        }
      };
    } else {
      connectAudioElement(audioRef.current);
    }

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {
        setIsPlaying(true); // Still animate equalizer even if autoplay blocked
      });
    }
  };

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  // 2400-Point Living Particle Sphere Engine
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const INK = '#161511';
    const TEAL = '#0E7C86';
    const TERRA = '#C4552D';
    const SAFF = '#C98A12';
    const TAU = Math.PI * 2;

    const N = 2400;
    const bx = new Float32Array(N);
    const by = new Float32Array(N);
    const bz = new Float32Array(N);
    const ph = new Float32Array(N);
    const js = new Float32Array(N);
    const col = new Uint8Array(N);
    const sz = new Float32Array(N);

    for (let i = 0; i < N; i++) {
      const u = 1 - 2 * (i + 0.5) / N;
      const r = Math.sqrt(Math.max(0, 1 - u * u));
      const a = i * 2.399963229728653; // golden angle
      bx[i] = Math.cos(a) * r;
      by[i] = u;
      bz[i] = Math.sin(a) * r;
      ph[i] = Math.random();
      js[i] = 0.7 + Math.random() * 0.7;

      const c = Math.random();
      // ink 55%, teal 28%, terra 12%, saffron 5%
      col[i] = c < 0.55 ? 0 : c < 0.83 ? 1 : c < 0.95 ? 2 : 3;
      sz[i] = 1 + Math.random() * 1.4;
    }

    function rgba(hex: string, a: number) {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `rgba(${r},${g},${b},${a})`;
    }

    function createSoftSprite(hex: string) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      if (g) {
        const gr = g.createRadialGradient(32, 32, 0, 32, 32, 30);
        gr.addColorStop(0, rgba(hex, 0.95));
        gr.addColorStop(0.45, rgba(hex, 0.55));
        gr.addColorStop(1, rgba(hex, 0));
        g.fillStyle = gr;
        g.fillRect(0, 0, 64, 64);
      }
      return c;
    }

    const SPR = [
      createSoftSprite(INK),
      createSoftSprite(TEAL),
      createSoftSprite(TERRA),
      createSoftSprite(SAFF),
    ];

    let W = 0;
    let H = 0;
    let DPR = 1;
    let cx = 0;
    let cy = 0;
    let R0 = 0;
    let mobile = false;

    function resize() {
      if (!canvas) return;
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = W * DPR;
      canvas.height = H * DPR;
      ctx?.setTransform(DPR, 0, 0, DPR, 0, 0);
      mobile = W < 900;
      if (mobile) {
        cx = W * 0.5;
        cy = H * 0.22;
        R0 = Math.min(W, H) * 0.24;
      } else {
        cx = W * 0.70;
        cy = H * 0.52;
        R0 = Math.min(W, H) * 0.30;
      }
    }

    resize();
    window.addEventListener('resize', resize);

    let mx = -999;
    let my = -999;
    let tmx = 0;
    let tmy = 0;
    let rot = 0;
    const start = performance.now();
    const shocks: { x: number; y: number; t: number }[] = [];

    const handlePointerMove = (e: PointerEvent) => {
      mx = e.clientX;
      my = e.clientY;
    };
    const handlePointerLeave = () => {
      mx = -999;
      my = -999;
    };
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('button') || target?.closest('a') || target?.closest('.no-shock')) return;
      shocks.push({ x: e.clientX, y: e.clientY, t: 0 });
      if (shocks.length > 3) shocks.shift();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerleave', handlePointerLeave);
    window.addEventListener('pointerdown', handlePointerDown);

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let animId: number;

    function render(now: number) {
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);
      const t = now / 1000;

      // Entrance: particles converge from 3.4x radius over 2.0s
      const conv = prefersReducedMotion ? 1 : Math.min(1, Math.max(0, (t - (start / 1000) - 0.15) / 2.0));
      const ease = 1 - Math.pow(1 - conv, 3);

      // Rotation
      rot += (isPlaying ? 0.0038 : 0.0016) * (prefersReducedMotion ? 0 : 1);
      tmx += ((mx < -500 ? 0 : (mx / W - 0.5)) - tmx) * 0.05;
      tmy += ((my < -500 ? 0 : (my / H - 0.5)) - tmy) * 0.05;

      const ay = rot + tmx * 0.9;
      const ax = tmy * 0.55;
      const cay = Math.cos(ay);
      const say = Math.sin(ay);
      const cax = Math.cos(ax);
      const sax = Math.sin(ax);

      // Real audio-reactive energy & wave amplitude: 8px to 34px scaled by average energy
      const avgEnergy = getSharedAudioEnergy();
      const waveAmp = 8 + avgEnergy * 26; // 8–34px

      const pulse = isPlaying ? 1 + avgEnergy * 0.12 + 0.04 * Math.sin(t * 5.2) : 1;

      // Decorative Orbits
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(22, 21, 17, 0.10)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + (waveAmp * 0.75) * Math.sin(t * 0.4), R0 * 1.3, R0 * 0.40, ay * 0.5, 0, TAU);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(14, 124, 134, 0.16)';
      ctx.beginPath();
      ctx.ellipse(cx, cy, R0 * 1.14, R0 * 0.34, -ay * 0.4 + 0.6, 0, TAU);
      ctx.stroke();

      // Text fade zone definition
      let tx0: number, tx1: number, ty0: number, ty1: number;
      if (mobile) {
        tx0 = W * 0.04;
        tx1 = W * 0.96;
        ty0 = H * 0.22;
        ty1 = H * 0.97;
      } else {
        tx0 = W * 0.05;
        tx1 = W * 0.48;
        ty0 = H * 0.18;
        ty1 = H * 0.85;
      }

      // Shocks update
      for (let s = shocks.length - 1; s >= 0; s--) {
        shocks[s].t += 1 / 60;
        if (shocks[s].t > 1.6) shocks.splice(s, 1);
      }

      // Draw all 2400 points
      for (let i = 0; i < N; i++) {
        // Breathing & organic wobble
        let r = R0 * pulse * (1 + 0.045 * Math.sin(5 * bx[i] + 3 * by[i] + t * 1.1) + 0.03 * Math.sin(t * 1.3 + ph[i] * TAU));
        r *= 1 + (1 - ease) * (2.4 + js[i] * 2.5);

        const x = bx[i] * r;
        const y = by[i] * r;
        const z = bz[i] * r;

        const x1 = x * cay + z * say;
        const z1 = -x * say + z * cay;
        const y1 = y * cax - z1 * sax;
        const z2 = y * sax + z1 * cax;

        const s = 900 / (900 + z2);
        let sx = cx + x1 * s;
        let sy = cy + y1 * s + waveAmp * Math.sin(t * 0.5);

        // Cursor repulsion
        const dx = sx - mx;
        const dy = sy - my;
        const d2 = dx * dx + dy * dy;
        if (d2 < 8100) {
          const d = Math.sqrt(d2) || 1;
          const f = (90 - d) * 0.4 / d;
          sx += dx * f;
          sy += dy * f;
        }

        // Click shockwave ring (640px/s, gaussian band sigma 42, decay 1.6s, push 26px)
        for (const sh of shocks) {
          const wdx = sx - sh.x;
          const wdy = sy - sh.y;
          const wd = Math.sqrt(wdx * wdx + wdy * wdy) || 1;
          const wr = sh.t * 640;
          const band = Math.exp(-((wd - wr) * (wd - wr)) / (2 * 42 * 42)) * Math.max(0, 1 - sh.t / 1.6);
          sx += (wdx / wd) * band * 26;
          sy += (wdy / wd) * band * 26;
        }

        const depth = (z2 + R0) / (2 * R0);
        let alpha = (0.14 + 0.86 * depth) * ease;

        // Text-zone alpha fade: drops to 0.18 on desktop / 0.06 on mobile with +110px gradient falloff
        const zoneA = mobile ? 0.06 : 0.18;
        const fall = mobile ? 220 : 110;
        const dOut = Math.max(0, tx0 - sx, sx - tx1, ty0 - sy, sy - ty1);
        alpha *= Math.min(1, zoneA + dOut / fall);

        const size = (2.2 + 3.4 * depth) * sz[i] * (mobile ? 1.2 : 1) * s;
        if (size < 0.4) continue;

        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
        ctx.drawImage(SPR[col[i]], sx - size / 2, sy - size / 2, size, size);
      }
      ctx.globalAlpha = 1;

      if (!prefersReducedMotion) {
        animId = requestAnimationFrame(render);
      }
    }

    if (prefersReducedMotion) {
      render(start + 1800);
    } else {
      animId = requestAnimationFrame(render);
    }

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerleave', handlePointerLeave);
      window.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isPlaying]);

  return (
    <div className="relative min-h-screen bg-[#F4F1EA] text-[#161511] font-sans overflow-x-hidden selection:bg-[#0E7C86] selection:text-[#F4F1EA]">
      {/* Sticky Glass Navbar */}
      <header className="sticky top-0 z-50 h-[70px] bg-[#F4F1EA]/80 backdrop-blur-md border-b border-[rgba(22,21,17,0.14)]">
        <div className="max-w-[1280px] mx-auto px-5 sm:px-8 h-full flex items-center justify-between gap-6">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="flex items-center gap-2.5 font-bold text-xl tracking-tight text-[#161511] no-underline"
          >
            <span>ovozstudio</span>
            <i className="w-2.5 h-2.5 rounded-full bg-[#0E7C86] inline-block pulse-teal-dot" />
          </a>

          <nav className="hidden md:flex items-center gap-6">
            <a
              href="#mahsulotlar"
              className="text-[#5D594E] hover:text-[#161511] text-[14px] font-medium transition-colors no-underline"
            >
              {lang === 'uz' ? 'Imkoniyatlar' : 'Возможности'}
            </a>
            <button
              type="button"
              onClick={() => onEnterApp('agent')}
              className="text-[#5D594E] hover:text-[#161511] text-[14px] font-medium transition-colors cursor-pointer bg-transparent border-0"
            >
              {lang === 'uz' ? 'AI Qoʻngʻiroqlar' : 'AI-Звонки 24/7'}
            </button>
            <button
              type="button"
              onClick={() => onEnterApp('studio')}
              className="text-[#5D594E] hover:text-[#161511] text-[14px] font-medium transition-colors cursor-pointer bg-transparent border-0"
            >
              {lang === 'uz' ? 'Studiya' : 'Студия'}
            </button>
            <button
              type="button"
              onClick={() => onEnterApp('docs')}
              className="text-[#5D594E] hover:text-[#161511] text-[14px] font-medium transition-colors cursor-pointer bg-transparent border-0"
            >
              {lang === 'uz' ? 'API & Hujjatlar' : 'API и Документы'}
            </button>
            <button
              type="button"
              onClick={onOpenPricingModal}
              className="text-[#5D594E] hover:text-[#161511] text-[14px] font-medium transition-colors cursor-pointer bg-transparent border-0"
            >
              {lang === 'uz' ? 'Tariflar' : 'Тарифы'}
            </button>
          </nav>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => onEnterApp('studio')}
              className="btn-pill btn-solid text-xs px-4 py-2 font-semibold"
            >
              <span>{lang === 'uz' ? 'Platformaga kirish' : 'Войти в студию'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Hero Stage */}
      <section className="relative min-h-[calc(100vh-70px)] overflow-hidden flex flex-col justify-center">
        {/* Cinematic Aurora Backlight */}
        <div className="absolute inset-[-12%] pointer-events-none filter blur-[90px] opacity-60 z-0">
          <div className="absolute w-[48vw] h-[48vw] -left-[12vw] -top-[16vw] rounded-full bg-[radial-gradient(circle,rgba(14,124,134,0.42),transparent_65%)]" />
          <div className="absolute w-[40vw] h-[40vw] right-0 -bottom-[18vw] rounded-full bg-[radial-gradient(circle,rgba(196,85,45,0.30),transparent_65%)]" />
          <div className="absolute w-[30vw] h-[30vw] right-[24vw] top-[4vw] rounded-full bg-[radial-gradient(circle,rgba(201,138,18,0.26),transparent_65%)]" />
        </div>

        {/* 2D Canvas Sphere */}
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full z-[1] cursor-crosshair" />

        {/* Hero Left Content */}
        <div className="relative z-[2] max-w-[1280px] w-full mx-auto px-5 sm:px-8 py-12 sm:py-16 flex flex-col justify-center pointer-events-none">
          {/* REC Badge */}
          <div className="inline-flex items-center gap-2.5 font-mono text-xs uppercase tracking-[0.14em] text-[#0A5A62] mb-5 pointer-events-auto">
            <i className="w-2 h-2 rounded-full bg-[#0E7C86] pulse-teal-dot" />
            <span>REC · 24 kHz Studio · B2B &amp; Media Ekotizimi</span>
          </div>

          {/* Headline with H1 Line-Mask Reveal & Teal Italic Em */}
          <h1 className="font-serif font-normal text-[clamp(2.5rem,5.8vw,5.2rem)] leading-[1.04] tracking-[-0.015em] max-w-[14ch] text-[#161511] select-none">
            <span className="block overflow-hidden pb-1 -mb-1">
              <span className="block transform translate-y-0 transition-transform duration-1000">
                {lang === 'uz' ? 'Neyron Ovoz,' : 'Нейронный Голос,'}
              </span>
            </span>
            <span className="block overflow-hidden pb-1 -mb-1">
              <span className="block transform translate-y-0 transition-transform duration-1000 delay-100">
                {lang === 'uz' ? 'Media Studiya va' : 'Медиа-Студия и'}
              </span>
            </span>
            <span className="block overflow-hidden pb-1 -mb-1">
              <span className="block transform translate-y-0 transition-transform duration-1000 delay-200">
                <em>{lang === 'uz' ? 'AI Agentlar.' : 'AI-Агенты 24/7.'}</em>
              </span>
            </span>
          </h1>

          <p className="max-w-[52ch] text-[#5D594E] text-base sm:text-[18px] leading-relaxed mt-6">
            {lang === 'uz'
              ? 'Faqat podkast emas: Reels dublyaj, 18+ tayyor neyron diktorlar, shaxsiy ovoz klonlash, audio-kitoblar hamda savdo boʻyicha 24/7 jonli telefon agentlari. Hammasi 24 kHz studiya sifatidagi toza oʻzbek tilida — 0% aksent.'
              : 'Не только подкасты: дубляж Reels/видео, 18+ студийных дикторов, клонирование голоса, аудиокниги и телефонные AI-агенты для продаж 24/7. Чистый узбекский язык студийного качества 24 kHz — 0% акцента.'}
          </p>

          {/* Quick Ecosystem Use-Case Navigation Pills */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 mt-6 pointer-events-auto max-w-[680px]">
            <button
              type="button"
              onClick={() => onEnterApp('studio', 'solo')}
              className="px-3.5 py-1.5 rounded-full bg-white/90 hover:bg-white border border-[rgba(22,21,17,0.14)] hover:border-[#0E7C86] text-xs font-medium text-[#161511] shadow-2xs transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Mic className="w-3.5 h-3.5 text-[#0E7C86]" />
              <span>{lang === 'uz' ? 'Podkast & Audiokitob' : 'Подкасты & Аудиокниги'}</span>
            </button>
            <button
              type="button"
              onClick={() => onEnterApp('agent')}
              className="px-3.5 py-1.5 rounded-full bg-white/90 hover:bg-white border border-[rgba(22,21,17,0.14)] hover:border-[#0E7C86] text-xs font-medium text-[#161511] shadow-2xs transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <PhoneCall className="w-3.5 h-3.5 text-[#0E7C86]" />
              <span>{lang === 'uz' ? '24/7 AI Savdo Agentlari' : 'AI-Агенты для Продаж 24/7'}</span>
            </button>
            <button
              type="button"
              onClick={() => onEnterApp('studio', 'voiceover')}
              className="px-3.5 py-1.5 rounded-full bg-white/90 hover:bg-white border border-[rgba(22,21,17,0.14)] hover:border-[#0E7C86] text-xs font-medium text-[#161511] shadow-2xs transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Video className="w-3.5 h-3.5 text-[#0E7C86]" />
              <span>{lang === 'uz' ? 'Reels & Video Dublyaj' : 'Reels & Видеодубляж'}</span>
            </button>
            <button
              type="button"
              onClick={() => onEnterApp('studio')}
              className="px-3.5 py-1.5 rounded-full bg-white/90 hover:bg-white border border-[rgba(22,21,17,0.14)] hover:border-[#0E7C86] text-xs font-medium text-[#161511] shadow-2xs transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Fingerprint className="w-3.5 h-3.5 text-[#0E7C86]" />
              <span>{lang === 'uz' ? 'Ovoz Klonlash (30 sek)' : 'Клонирование Голоса'}</span>
            </button>
            <button
              type="button"
              onClick={() => onEnterApp('docs')}
              className="px-3.5 py-1.5 rounded-full bg-white/90 hover:bg-white border border-[rgba(22,21,17,0.14)] hover:border-[#0E7C86] text-xs font-medium text-[#161511] shadow-2xs transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <FileSearch className="w-3.5 h-3.5 text-[#0E7C86]" />
              <span>{lang === 'uz' ? 'PDF & Hujjatdan Audio' : 'Аудио из PDF/Документов'}</span>
            </button>
          </div>

          {/* CTA Row */}
          <div className="flex items-center gap-3.5 mt-8 flex-wrap pointer-events-auto">
            <button
              type="button"
              onClick={() => onEnterApp('studio')}
              className="btn-pill btn-solid py-3 px-6 text-sm sm:text-base font-semibold shadow-md flex items-center gap-2.5"
            >
              <span>{lang === 'uz' ? 'Studiya: Ovoz Yaratish' : 'Открыть Студию'}</span>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <path d="M2 8h11M9 3.5 13.5 8 9 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            <button
              type="button"
              onClick={() => onEnterApp('agent')}
              className="btn-pill btn-ghost py-3 px-6 text-sm sm:text-base font-medium flex items-center gap-2 text-[#0A5A62] border border-[#0E7C86]/30 bg-white/60 hover:bg-white"
            >
              <PhoneCall className="w-4 h-4 text-[#0E7C86]" />
              <span>{lang === 'uz' ? 'Jonli AI Qoʻngʻiroqni Sinash' : 'Тест AI-Звонка 24/7'}</span>
            </button>

            <a
              href="#foyda-matritsa"
              className="btn-pill btn-ghost py-3 px-5 text-sm sm:text-base text-[#5D594E]"
            >
              {lang === 'uz' ? 'Kimlar uchun foydali?' : 'Для кого подходит?'}
            </a>
          </div>

          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[#5D594E] mt-6 pointer-events-auto flex items-center gap-2">
            <ShieldCheck className="w-3.5 h-3.5 text-[#0E7C86]" />
            <span>
              {lang === 'uz'
                ? '1 platforma — 6 ta biznes mahsulot · Kredit karta shart emas · 30 soniyada boshlang'
                : '1 платформа — 6 бизнес-продуктов · Без банковской карты · Старт за 30 секунд'}
            </span>
          </div>
        </div>

        {/* Floating Voice Replication Player Chip */}
        <div
          role="button"
          tabIndex={0}
          onClick={togglePlay}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              togglePlay();
            }
          }}
          className="no-shock absolute left-5 sm:left-8 bottom-7 z-[3] flex items-center gap-3.5 bg-[#F4F1EA]/90 backdrop-blur-md border border-[rgba(22,21,17,0.14)] hover:border-[#161511] rounded-full py-2.5 px-4.5 cursor-pointer shadow-sm transition-all hover:-translate-y-0.5 select-none"
        >
          <span className="w-9 h-9 rounded-full bg-[#161511] hover:bg-[#0A5A62] text-[#F4F1EA] flex items-center justify-center shrink-0 transition-colors">
            {isPlaying ? (
              <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor">
                <rect x="2" y="2" width="3.5" height="10" rx="1" />
                <rect x="8.5" y="2" width="3.5" height="10" rx="1" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 14 14" fill="currentColor">
                <path d="M3.5 2.2c0-.6.65-.97 1.17-.66l7.2 4.3a.77.77 0 0 1 0 1.32l-7.2 4.3A.77.77 0 0 1 3.5 10.8V2.2Z" />
              </svg>
            )}
          </span>

          <div className="flex flex-col">
            <span className="font-semibold text-xs sm:text-sm leading-tight text-[#161511]">
              SHOKHRUKH — haqiqiy ovoz
            </span>
            <span className="font-mono text-[10px] tracking-[0.1em] text-[#5D594E] uppercase">
              Voice Replication · 0:12 {isPlaying ? '· LIVE' : ''}
            </span>
          </div>

          {/* 6-Bar Mini Equalizer */}
          <div className="flex items-end gap-[2.5px] h-4 ml-1">
            {[25, 60, 90, 45, 80, 35].map((h, idx) => (
              <span
                key={idx}
                className="w-[3px] bg-[#0E7C86] rounded-sm transition-all duration-300"
                style={{
                  height: isPlaying ? `${Math.max(20, (h * (idx % 2 === 0 ? 1 : 0.8)))}%` : '25%',
                  animation: isPlaying ? `eq 0.8s ease-in-out infinite alternate ${idx * 0.12}s` : 'none',
                }}
              />
            ))}
          </div>
        </div>

        {/* Interaction Hint */}
        <div className="hidden lg:flex absolute right-8 bottom-8 z-[3] items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[#5D594E]">
          <i className="w-2 h-2 rounded-full bg-[#C4552D] pulse-teal-dot" />
          <span>Sichqonchani silkiting · bosing — toʻlqin</span>
        </div>
      </section>

      {/* Infinite Ticker Strip */}
      <section className="border-y border-[rgba(22,21,17,0.14)] bg-[#ECE7DB]/50 py-3 overflow-hidden select-none">
        <div className="flex whitespace-nowrap animate-marquee hover:[animation-play-state:paused] font-mono text-xs uppercase tracking-[0.14em] text-[#5D594E]">
          {[1, 2].map((k) => (
            <div key={k} className="flex items-center gap-6 shrink-0 pr-6">
              <span>24 kHz Studio Sifati</span>
              <span className="text-[#0E7C86]">·</span>
              <span>Oʻzbek Tili Neural Studio</span>
              <span className="text-[#0E7C86]">·</span>
              <span>Voice Replication (Klonlash)</span>
              <span className="text-[#0E7C86]">·</span>
              <span>Jonli AI Call Agentlar</span>
              <span className="text-[#0E7C86]">·</span>
              <span>Video Dublyaj &amp; Reels</span>
              <span className="text-[#0E7C86]">·</span>
              <span>NotebookLM Hujjat Tahlili</span>
              <span className="text-[#0E7C86]">·</span>
              <span>0% Aksent</span>
              <span className="text-[#0E7C86]">·</span>
              <span>REST &amp; WebSocket API</span>
              <span className="text-[#0E7C86]">·</span>
            </div>
          ))}
        </div>
      </section>

      {/* Target Audience & Business Value Matrix (Kimlar uchun va nima beradi) */}
      <section id="foyda-matritsa" className="py-20 border-b border-[rgba(22,21,17,0.14)] bg-[#FAF8F3]">
        <div className="max-w-[1280px] mx-auto px-5 sm:px-8">
          <div className="flex items-center gap-3.5 font-mono text-[11.5px] uppercase tracking-[0.14em] text-[#0A5A62] mb-4">
            <span>01 — Platforma kimlar uchun va qanday foyda keltiradi?</span>
            <span className="h-[1px] flex-1 bg-[rgba(22,21,17,0.14)]" />
          </div>

          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
            <div>
              <h2 className="font-serif font-normal text-[clamp(2.1rem,3.8vw,3.2rem)] tracking-[-0.01em] text-[#161511] max-w-[22ch]">
                {lang === 'uz' ? (
                  <>Faqat podkast emas — <em>butun biznes va media</em> uchun.</>
                ) : (
                  <>Не только подкасты — <em>для бизнеса, медиа и продаж</em>.</>
                )}
              </h2>
              <p className="text-[#5D594E] text-base leading-relaxed mt-3 max-w-[54ch]">
                {lang === 'uz'
                  ? 'OvozStudio AI qanday vazifalarni yechadi, kimlarga vaqt hamda byudjetni 70% gacha tejashga yordam beradi:'
                  : 'Какие задачи решает OvozStudio AI, кому помогает экономить до 70% бюджета и ускорять процессы в разы:'}
              </p>
            </div>

            <button
              type="button"
              onClick={onOpenPricingModal}
              className="btn-pill btn-ghost text-xs px-4 py-2.5 flex items-center gap-2 self-start md:self-auto text-[#0A5A62] border border-[#0E7C86]/30 bg-[#0E7C86]/5 hover:bg-[#0E7C86]/10 cursor-pointer"
            >
              <Sparkles className="w-4 h-4 text-[#0E7C86]" />
              <span className="font-semibold">{lang === 'uz' ? 'Tariflar va Imkoniyatlar' : 'Тарифы и Возможности'}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {/* Value Card 1: B2B Sales & Calls */}
            <div className="markaz-card p-6 flex flex-col justify-between group hover:-translate-y-1.5 transition-all duration-300 hover:shadow-lg">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <span className="w-10 h-10 rounded-xl bg-[#0E7C86]/10 text-[#0A5A62] flex items-center justify-center">
                    <PhoneCall className="w-5 h-5" />
                  </span>
                  <span className="font-mono text-[10.5px] uppercase tracking-wider text-[#0A5A62] font-semibold bg-[#0E7C86]/10 px-2.5 py-1 rounded-full">
                    {lang === 'uz' ? 'Biznes & Savdo' : 'Бизнес и Продажи'}
                  </span>
                </div>
                <h3 className="text-[17px] font-bold text-[#161511] leading-snug">
                  {lang === 'uz' ? '24/7 AI Savdo & Call-Center Agenti' : 'AI-Агент для Продаж 24/7'}
                </h3>
                <p className="text-xs sm:text-sm text-[#5D594E] mt-2.5 leading-relaxed">
                  {lang === 'uz'
                    ? 'Qoʻngʻiroqlarga soniyalarda toza oʻzbekcha javob beradi, mijoz ehtiyojini aniqlaydi, eʼtirozlarni yopadi va leadni amoCRM yoki Bitrix24 ga kiritadi. Kechasi ham mijoz yoʻqotilmaydi.'
                    : 'Мгновенно отвечает на узбекском и русском языках, консультирует по товарам и услугам, квалифицирует лидов и пишет данные в CRM. Ноль потерь звонков 24/7.'}
                </p>
              </div>

              <div className="mt-5 pt-4 border-t border-[rgba(22,21,17,0.1)]">
                <div className="font-mono text-[11px] text-[#0A5A62] font-semibold flex items-center gap-1.5 mb-3">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#0E7C86]" />
                  <span>{lang === 'uz' ? 'Call-center xarajatlari -70%' : 'Расходы колл-центра -70%'}</span>
                </div>
                <button
                  type="button"
                  onClick={() => onEnterApp('agent')}
                  className="w-full py-2 rounded-full text-xs font-semibold bg-[#161511] text-[#F4F1EA] hover:bg-[#0A5A62] transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <span>{lang === 'uz' ? 'Agentni sinab koʻrish' : 'Тестировать агента'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Value Card 2: SMM & Reels Video Dubbing */}
            <div className="markaz-card p-6 flex flex-col justify-between group hover:-translate-y-1.5 transition-all duration-300 hover:shadow-lg">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <span className="w-10 h-10 rounded-xl bg-[#C4552D]/10 text-[#C4552D] flex items-center justify-center">
                    <Video className="w-5 h-5" />
                  </span>
                  <span className="font-mono text-[10.5px] uppercase tracking-wider text-[#C4552D] font-semibold bg-[#C4552D]/10 px-2.5 py-1 rounded-full">
                    {lang === 'uz' ? 'Reels & YouTube' : 'Reels и YouTube'}
                  </span>
                </div>
                <h3 className="text-[17px] font-bold text-[#161511] leading-snug">
                  {lang === 'uz' ? 'Reels, TikTok & Video Dublyaj' : 'Дубляж Reels, TikTok и Видео'}
                </h3>
                <p className="text-xs sm:text-sm text-[#5D594E] mt-2.5 leading-relaxed">
                  {lang === 'uz'
                    ? 'Videoni yuklang — tizim matnni ajratadi, oʻzbek tiliga sinxron tarjima qiladi va lab harakatiga (lip-sync) moslab hissiyotli dublyaj qiladi. Mikrofon va montajchi kerak emas.'
                    : 'Загрузите ролик — система транскрибирует речь, переводит на узбекский и озвучивает с точным хронометражем и эмоциями без студии и монтажера.'}
                </p>
              </div>

              <div className="mt-5 pt-4 border-t border-[rgba(22,21,17,0.1)]">
                <div className="font-mono text-[11px] text-[#C4552D] font-semibold flex items-center gap-1.5 mb-3">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#C4552D]" />
                  <span>{lang === 'uz' ? 'Kuniga 10+ rolik · Tezlik 5x' : '10+ роликов в день · В 5 раз быстрее'}</span>
                </div>
                <button
                  type="button"
                  onClick={() => onEnterApp('studio', 'voiceover')}
                  className="w-full py-2 rounded-full text-xs font-semibold bg-[#161511] text-[#F4F1EA] hover:bg-[#C4552D] transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <span>{lang === 'uz' ? 'Dublyaj studiyasi' : 'В студию дубляжа'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Value Card 3: Podcasting & Audiobooks */}
            <div className="markaz-card p-6 flex flex-col justify-between group hover:-translate-y-1.5 transition-all duration-300 hover:shadow-lg">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <span className="w-10 h-10 rounded-xl bg-[#0E7C86]/10 text-[#0A5A62] flex items-center justify-center">
                    <Headphones className="w-5 h-5" />
                  </span>
                  <span className="font-mono text-[10.5px] uppercase tracking-wider text-[#0A5A62] font-semibold bg-[#0E7C86]/10 px-2.5 py-1 rounded-full">
                    {lang === 'uz' ? 'Podkast & Audio' : 'Подкасты & Аудио'}
                  </span>
                </div>
                <h3 className="text-[17px] font-bold text-[#161511] leading-snug">
                  {lang === 'uz' ? '1 Soatlik Podkast — 2 Daqiqada' : 'Часовой Подкаст за 2 Минуты'}
                </h3>
                <p className="text-xs sm:text-sm text-[#5D594E] mt-2.5 leading-relaxed">
                  {lang === 'uz'
                    ? 'Ssenariydan tayyor professional songacha: 2 kishilik intervyu dialoglari, 18+ professional neyron diktorlar, fon musiqasi ducking va 24 kHz toza studiya sifati.'
                    : 'От идеи до готового 1-часового выпуска: диалог 2-х ведущих, 18+ дикторов, фоновая музыка с авто-приглушением и экспорт в MP3/WAV.'}
                </p>
              </div>

              <div className="mt-5 pt-4 border-t border-[rgba(22,21,17,0.1)]">
                <div className="font-mono text-[11px] text-[#0A5A62] font-semibold flex items-center gap-1.5 mb-3">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#0E7C86]" />
                  <span>{lang === 'uz' ? 'Nafas va kulguli jonli ovoz' : 'Живой голос с дыханием'}</span>
                </div>
                <button
                  type="button"
                  onClick={() => onEnterApp('studio', 'solo')}
                  className="w-full py-2 rounded-full text-xs font-semibold bg-[#161511] text-[#F4F1EA] hover:bg-[#0A5A62] transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <span>{lang === 'uz' ? 'Podkast yaratish' : 'Создать подкаст'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Value Card 4: EdTech & Document Audio Hub */}
            <div className="markaz-card p-6 flex flex-col justify-between group hover:-translate-y-1.5 transition-all duration-300 hover:shadow-lg">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <span className="w-10 h-10 rounded-xl bg-[#C98A12]/10 text-[#C98A12] flex items-center justify-center">
                    <BookOpen className="w-5 h-5" />
                  </span>
                  <span className="font-mono text-[10.5px] uppercase tracking-wider text-[#C98A12] font-semibold bg-[#C98A12]/10 px-2.5 py-1 rounded-full">
                    {lang === 'uz' ? 'EdTech & Hujjatlar' : 'EdTech и Обучение'}
                  </span>
                </div>
                <h3 className="text-[17px] font-bold text-[#161511] leading-snug">
                  {lang === 'uz' ? 'PDF & Kitoblardan Audio Darslik' : 'Аудиоуроки из PDF и Книг'}
                </h3>
                <p className="text-xs sm:text-sm text-[#5D594E] mt-2.5 leading-relaxed">
                  {lang === 'uz'
                    ? 'Qalin PDF qoʻllanmalar, maqolalar va hisobotlarni bir zumda tushunarli audio darslikka yoki 2 ekspertning jonli intervyusiga aylantiring. Xodimlar va talabalar uchun qulay format.'
                    : 'Превращайте сухие регламенты, PDF-отчеты и учебники в живые аудио-диалоги и лекции для сотрудников, клиентов и студентов.'}
                </p>
              </div>

              <div className="mt-5 pt-4 border-t border-[rgba(22,21,17,0.1)]">
                <div className="font-mono text-[11px] text-[#C98A12] font-semibold flex items-center gap-1.5 mb-3">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#C98A12]" />
                  <span>{lang === 'uz' ? '100 betlik kitob 5 daqiqada' : 'Книга за 5 минут в аудио'}</span>
                </div>
                <button
                  type="button"
                  onClick={() => onEnterApp('docs')}
                  className="w-full py-2 rounded-full text-xs font-semibold bg-[#161511] text-[#F4F1EA] hover:bg-[#C98A12] transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <span>{lang === 'uz' ? 'Hujjat tahlili' : 'Анализ документов'}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Product Cards (4-Up) */}
      <section id="mahsulotlar" className="py-20 border-b border-[rgba(22,21,17,0.14)]">
        <div className="max-w-[1280px] mx-auto px-5 sm:px-8">
          <div className="flex items-center gap-3.5 font-mono text-[11.5px] uppercase tracking-[0.14em] text-[#0A5A62] mb-4">
            <span>02 — Mahsulotlar toʻplami</span>
            <span className="h-[1px] flex-1 bg-[rgba(22,21,17,0.14)]" />
          </div>

          <h2 className="font-serif font-normal text-[clamp(2.1rem,3.8vw,3.2rem)] tracking-[-0.01em] text-[#161511] max-w-[24ch]">
            Faqat podkast? <em>Undan koʻproq.</em>
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mt-10">
            {/* Card 1: Podkast Studiyasi */}
            <div
              onClick={() => onEnterApp('studio', 'solo')}
              className="markaz-card p-6 cursor-pointer transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_30px_50px_-30px_rgba(22,21,17,0.35)] group flex flex-col justify-between"
            >
              <div>
                <svg width="24" height="24" viewBox="0 0 16 16" fill="none" className="text-[#0A5A62]">
                  <rect x="5.5" y="1.5" width="5" height="9" rx="2.5" stroke="currentColor" strokeWidth="1.4" />
                  <path d="M3 8a5 5 0 0 0 10 0M8 13v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
                <b className="block text-[17px] font-semibold tracking-tight text-[#161511] mt-4">
                  Podkast studiyasi
                </b>
                <span className="block text-sm text-[#5D594E] mt-2 leading-relaxed">
                  Ssenariydan 1 soatlik songacha: AI ssenariy dvigateli, 18 ovoz, jonli emotsiya teglari va musiqa ducking.
                </span>
              </div>
              <div className="inline-flex items-center gap-2 mt-5 font-mono text-[11px] tracking-[0.12em] uppercase text-[#0A5A62] group-hover:text-[#0E7C86]">
                <span>Studiyaga oʻtish</span>
                <span className="transition-transform group-hover:translate-x-1">→</span>
              </div>
            </div>

            {/* Card 2: AI Qoʻngʻiroqlar */}
            <div
              onClick={() => onEnterApp('agent')}
              className="markaz-card p-6 cursor-pointer transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_30px_50px_-30px_rgba(22,21,17,0.35)] group flex flex-col justify-between"
            >
              <div>
                <svg width="24" height="24" viewBox="0 0 16 16" fill="none" className="text-[#0A5A62]">
                  <path d="M3 2.5c0-.5.5-.9 1-.6l8 4.6c.5.3.5 1 0 1.3l-8 4.6c-.5.3-1-.1-1-.6v-9.3Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                  <path d="M14 9.5c1 .8 1 2.2 0 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
                <b className="block text-[17px] font-semibold tracking-tight text-[#161511] mt-4">
                  AI qoʻngʻiroq agentlari
                </b>
                <span className="block text-sm text-[#5D594E] mt-2 leading-relaxed">
                  Jonli duplex agent: koʻchmas mulk, savdo, call-markaz. Lead-karta va CRM maʼlumotlarini avtomatik toʻldiradi.
                </span>
              </div>
              <div className="inline-flex items-center gap-2 mt-5 font-mono text-[11px] tracking-[0.12em] uppercase text-[#0A5A62] group-hover:text-[#0E7C86]">
                <span>Agentni sinash</span>
                <span className="transition-transform group-hover:translate-x-1">→</span>
              </div>
            </div>

            {/* Card 3: Video Dublyaj */}
            <div
              onClick={() => onEnterApp('studio', 'voiceover')}
              className="markaz-card p-6 cursor-pointer transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_30px_50px_-30px_rgba(22,21,17,0.35)] group flex flex-col justify-between"
            >
              <div>
                <svg width="24" height="24" viewBox="0 0 16 16" fill="none" className="text-[#0A5A62]">
                  <rect x="1.5" y="3" width="13" height="10" rx="2" stroke="currentColor" strokeWidth="1.4" />
                  <path d="m6.5 6 3.5 2-3.5 2V6Z" fill="currentColor" />
                </svg>
                <b className="block text-[17px] font-semibold tracking-tight text-[#161511] mt-4">
                  Video dublyaj &amp; Reels
                </b>
                <span className="block text-sm text-[#5D594E] mt-2 leading-relaxed">
                  YouTube, Reels va reklama roliklarini oʻzbekchaga oʻz ovozingizda dublyaj qiling — tembr va ohang saqlanadi.
                </span>
              </div>
              <div className="inline-flex items-center gap-2 mt-5 font-mono text-[11px] tracking-[0.12em] uppercase text-[#0A5A62] group-hover:text-[#0E7C86]">
                <span>Dublyaj studiyasi</span>
                <span className="transition-transform group-hover:translate-x-1">→</span>
              </div>
            </div>

            {/* Card 4: Eksklyuziv & Muqovalar */}
            <div
              onClick={() => onEnterApp('exclusive')}
              className="markaz-card p-6 cursor-pointer transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_30px_50px_-30px_rgba(22,21,17,0.35)] group flex flex-col justify-between"
            >
              <div>
                <svg width="24" height="24" viewBox="0 0 16 16" fill="none" className="text-[#0A5A62]">
                  <path d="m8 1.5 1.8 4 4.4.5-3.3 3 1 4.4L8 11l-3.9 2.4 1-4.4-3.3-3 4.4-.5L8 1.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                </svg>
                <b className="block text-[17px] font-semibold tracking-tight text-[#161511] mt-4">
                  Eksklyuziv &amp; Muqovalar
                </b>
                <span className="block text-sm text-[#5D594E] mt-2 leading-relaxed">
                  AI muqova 800×800, VIP masterclasslar, SRT subtitr va Apple/Spotify uchun RSS eksport markazi.
                </span>
              </div>
              <div className="inline-flex items-center gap-2 mt-5 font-mono text-[11px] tracking-[0.12em] uppercase text-[#0A5A62] group-hover:text-[#0E7C86]">
                <span>Eksklyuziv hub</span>
                <span className="transition-transform group-hover:translate-x-1">→</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Living Voice Section with Dark Studio Screen Mock */}
      <section className="py-20 border-b border-[rgba(22,21,17,0.14)]">
        <div className="max-w-[1280px] mx-auto px-5 sm:px-8 grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left Column: Description & Tag Table */}
          <div>
            <div className="flex items-center gap-3.5 font-mono text-[11.5px] uppercase tracking-[0.14em] text-[#0A5A62] mb-4">
              <span>03 — Jonli Ovoz Texnologiyasi</span>
              <span className="h-[1px] flex-1 bg-[rgba(22,21,17,0.14)]" />
            </div>

            <h2 className="font-serif font-normal text-[clamp(2.1rem,3.8vw,3.2rem)] tracking-[-0.01em] text-[#161511] max-w-[24ch]">
              Robot emas — <em>jonli odam</em>day oʻqiydi.
            </h2>

            <p className="text-[#5D594E] text-base leading-relaxed mt-4 max-w-[50ch]">
              Matnga emotsiya teglari yoziladi — sintez ularni ovoz ohangi bilan amalga oshiradi: nafas oladi, kuladi, pauza qiladi, hayajonlanadi. Voice Replication esa butun sonni aynan sizning tembringizda yaratadi — 0% aksent.
            </p>

            <div className="mt-7 border-t border-[rgba(22,21,17,0.14)]">
              <div className="grid grid-cols-[140px_1fr] gap-4 py-3.5 border-b border-[rgba(22,21,17,0.14)] items-baseline">
                <span className="font-mono text-xs text-[#C4552D] font-medium">&lt;breath&gt;</span>
                <span className="text-sm text-[#5D594E]">Tabiiy nafas olish — matnni „tirik“ qiladi</span>
              </div>
              <div className="grid grid-cols-[140px_1fr] gap-4 py-3.5 border-b border-[rgba(22,21,17,0.14)] items-baseline">
                <span className="font-mono text-xs text-[#C4552D] font-medium">&lt;laugh&gt;</span>
                <span className="text-sm text-[#5D594E]">Haqiqiy kulgu va tabassum ohangi</span>
              </div>
              <div className="grid grid-cols-[140px_1fr] gap-4 py-3.5 border-b border-[rgba(22,21,17,0.14)] items-baseline">
                <span className="font-mono text-xs text-[#0A5A62] font-medium">|ha| · |mhm|</span>
                <span className="text-sm text-[#5D594E]">Jonli tasdiqlash va intervyu reaksiyalari</span>
              </div>
              <div className="grid grid-cols-[140px_1fr] gap-4 py-3.5 border-b border-[rgba(22,21,17,0.14)] items-baseline">
                <span className="font-mono text-xs text-[#0A5A62] font-medium">[Pauza] · [Hayajon]</span>
                <span className="text-sm text-[#5D594E]">Dramaturgiya: pauzalar va kayfiyat oʻzgarishi</span>
              </div>
            </div>
          </div>

          {/* Right Column: Dark Studio Screen Panel (Rotated 0.6deg) */}
          <div className="transform rotate-[0.6deg] markaz-dark-screen p-6 sm:p-7 font-mono text-[13px] leading-[1.85] border border-[#2B2B27]">
            {/* Traffic Dots */}
            <div className="flex items-center gap-2 mb-5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#C4552D]" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#C98A12]" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#0E7C86]" />
            </div>

            {/* Script preview */}
            <div className="text-[#EDEAE2] space-y-1">
              <div>
                <span className="text-[#5CC8CF] font-semibold">[KIRISH]</span> Assalomu alaykum, qadrli tinglovchilar!{' '}
                <span className="text-[#E08B5A]">&lt;breath&gt;</span>
              </div>
              <div>
                <span className="text-[#5CC8CF] font-semibold">[KULMINATSIYA]</span> Bilasizmi…{' '}
                <span className="text-[#E08B5A]">[Pauza]</span> aynan shu ilm muhitidan Ulugʻbek yetishib chiqdi.{' '}
                <span className="text-[#E08B5A]">&lt;laugh&gt;</span>
              </div>
              <div>
                <span className="text-[#5CC8CF] font-semibold">[XULOSA]</span> Oʻz tarixingizni bilish — kelajakka mustahkam poydevor.
              </div>
            </div>

            <div className="text-[#7D7A70] text-xs mt-4 pt-3 border-t border-[#2B2B27]">
              temp 0.95x · tembr: SHOKHRUKH · musiqa: neoklassik −12 dB
            </div>

            {/* Waveform 22 bars */}
            <div className="flex items-center gap-[3px] h-8 mt-5 pt-3 border-t border-[#2B2B27]">
              {[30, 55, 40, 75, 52, 88, 46, 64, 34, 80, 58, 42, 70, 36, 62, 48, 26, 72, 44, 60, 50, 78].map((h, i) => (
                <span
                  key={i}
                  className="flex-1 rounded-[2px] bg-gradient-to-t from-[#0E7C86] to-[#5CC8CF]"
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>

            <div className="flex justify-between items-center mt-3 text-[10.5px] uppercase tracking-[0.08em] text-[#7D7A70]">
              <span>JONLI OVOZ · 24 kHz</span>
              <span>00:42 / 29:58</span>
            </div>
          </div>
        </div>
      </section>

      {/* Business / API Band */}
      <section className="py-20 bg-[#ECE7DB] border-b border-[rgba(22,21,17,0.14)] text-center">
        <div className="max-w-[760px] mx-auto px-5 sm:px-8">
          <div className="inline-flex items-center gap-3 font-mono text-[11.5px] uppercase tracking-[0.14em] text-[#0A5A62] mb-3">
            <span>04 — Biznes, API va Integratsiyalar</span>
          </div>

          <h2 className="font-serif font-normal text-[clamp(2.1rem,3.8vw,3.2rem)] tracking-[-0.01em] text-[#161511]">
            Savdo boʻlimingizga <em>jonli agent</em> ulang.
          </h2>

          <p className="text-[#5D594E] text-base leading-relaxed mt-4 max-w-[52ch] mx-auto">
            AI qoʻngʻiroq agentlari mijozlarga oʻzi qoʻngʻiroq qiladi, lead-kartani toʻldiradi, narxlarni tahlil qiladi va CRM-ga yozadi. REST/WebSocket API orqali mavjud ATS-ingizga ulanadi — yoki uni butunlay almashtiradi.
          </p>

          <div className="mt-8 flex justify-center gap-4 flex-wrap">
            <button
              type="button"
              onClick={() => onEnterApp('docs')}
              className="btn-pill btn-solid py-3 px-6 text-sm font-semibold flex items-center gap-2.5"
            >
              <span>API hujjatlari — 10 daqiqada ulanish</span>
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <path d="M2 8h11M9 3.5 13.5 8 9 12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            <button
              type="button"
              onClick={onOpenPricingModal}
              className="btn-pill btn-ghost py-3 px-6 text-sm font-medium"
            >
              {lang === 'uz' ? 'Biznes tariflar' : 'Тарифы для бизнеса'}
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-9">
        <div className="max-w-[1280px] mx-auto px-5 sm:px-8 flex flex-col sm:flex-row justify-between items-center gap-4 font-mono text-[11px] uppercase tracking-[0.12em] text-[#5D594E]">
          <span>ovozstudio — oʻzbek tilida ovoz platformasi</span>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => onEnterApp('studio')}
              className="hover:text-[#161511] cursor-pointer bg-transparent border-0 font-mono text-[11px] uppercase tracking-[0.12em]"
            >
              Studiya
            </button>
            <span>·</span>
            <button
              type="button"
              onClick={() => onEnterApp('docs')}
              className="hover:text-[#161511] cursor-pointer bg-transparent border-0 font-mono text-[11px] uppercase tracking-[0.12em]"
            >
              Hujjatlar
            </button>
            <span>·</span>
            <button
              type="button"
              onClick={onOpenPricingModal}
              className="hover:text-[#161511] cursor-pointer bg-transparent border-0 font-mono text-[11px] uppercase tracking-[0.12em]"
            >
              Tariflar
            </button>
          </div>
          <span>24 kHz · MP3 &amp; WAV · OvozStudio Neural HD</span>
        </div>
      </footer>
    </div>
  );
};
