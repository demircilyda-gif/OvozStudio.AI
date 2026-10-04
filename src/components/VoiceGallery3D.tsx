import React, { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, Html } from '@react-three/drei';
import { Play, Square, Check, Sparkles, Volume2, ShieldCheck, Compass } from 'lucide-react';
import { VoiceProfile } from '../types/podcast';
import { getVoicePreviewUrl } from '../data/voicePreviews';
import { connectAudioElement } from '../utils/audioReactive';

// -------------------------------------------------------------
// WebGL Support Detection Utility
// -------------------------------------------------------------
export function isWebGLAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl') || canvas.getContext('webgl2'))
    );
  } catch {
    return false;
  }
}

// -------------------------------------------------------------
// Voice 3D Palette Mapping (Prompt specifications)
// -------------------------------------------------------------
export interface VoicePalette {
  tint: string;
  core: string;
  modelLabel: string;
  shortName: string;
}

export const VOICE_3D_PALETTES: Record<string, VoicePalette> = {
  // SHOKHRUKH: tint #9FD8DD, teal core #0E7C86
  shokhrukh: { tint: '#9FD8DD', core: '#0E7C86', modelLabel: '0% AKSENT · LIVE', shortName: 'SHOKHRUKH' },
  'voice_17raj9ewke3g': { tint: '#9FD8DD', core: '#0E7C86', modelLabel: '0% AKSENT · LIVE', shortName: 'SHOKHRUKH' },

  // Ulugʻbek: tint #9DB4DC, core #24549C
  ulugbek: { tint: '#9DB4DC', core: '#24549C', modelLabel: 'GEMINI 3.8 · BAS', shortName: 'Ulugʻbek' },
  'ulugbek-history': { tint: '#9DB4DC', core: '#24549C', modelLabel: 'GEMINI 3.8 · BAS', shortName: 'Ulugʻbek' },

  // Aziza: tint #9FE0D6, core #0E9488
  aziza: { tint: '#9FE0D6', core: '#0E9488', modelLabel: 'GEMINI 3.8 · SOPRANO', shortName: 'Aziza' },
  'aziza-ai': { tint: '#9FE0D6', core: '#0E9488', modelLabel: 'GEMINI 3.8 · SOPRANO', shortName: 'Aziza' },

  // Otabek: tint #EFD9A0, core #C98A12
  otabek: { tint: '#EFD9A0', core: '#C98A12', modelLabel: 'GEMINI 3.8 · TENOR', shortName: 'Otabek' },
  'otabek-comedy': { tint: '#EFD9A0', core: '#C98A12', modelLabel: 'GEMINI 3.8 · TENOR', shortName: 'Otabek' },

  // Madina: tint #E9B39C, core #C4552D
  madina: { tint: '#E9B39C', core: '#C4552D', modelLabel: 'GEMINI 3.8 · VIBRANT', shortName: 'Madina' },
  'madina-journalist': { tint: '#E9B39C', core: '#C4552D', modelLabel: 'GEMINI 3.8 · VIBRANT', shortName: 'Madina' },

  // Fenrir: tint #B8BCE0, core #3B3F6E
  fenrir: { tint: '#B8BCE0', core: '#3B3F6E', modelLabel: 'FENRIR · DEEP BAS', shortName: 'Fenrir' },
  'jasur-business': { tint: '#B8BCE0', core: '#3B3F6E', modelLabel: 'CHARON · BAS', shortName: 'Jasur' },

  // Harmonic defaults for other voices
  'malika-tech': { tint: '#F5C6D6', core: '#A83261', modelLabel: 'AOEDE · FAST', shortName: 'Malika' },
  'nodira-analyst': { tint: '#B6E2D3', core: '#0E7C86', modelLabel: 'KORE · CORPORATE', shortName: 'Nodira' },
  aoede: { tint: '#E9B39C', core: '#C4552D', modelLabel: 'AOEDE · LIVE', shortName: 'Aoede' },
  charon: { tint: '#D6C7B2', core: '#4A3E31', modelLabel: 'CHARON · BARITON', shortName: 'Charon' },
  puck: { tint: '#EFD9A0', core: '#C98A12', modelLabel: 'PUCK · TENOR', shortName: 'Puck' },
  kore: { tint: '#9FE0D6', core: '#0E9488', modelLabel: 'KORE · SOPRANO', shortName: 'Kore' },
};

export function getPaletteForVoice(v: VoiceProfile): VoicePalette {
  const idKey = v.id.toLowerCase();
  if (VOICE_3D_PALETTES[idKey]) return VOICE_3D_PALETTES[idKey];

  const nameKey = v.name.toLowerCase();
  for (const k of Object.keys(VOICE_3D_PALETTES)) {
    if (nameKey.includes(k)) return VOICE_3D_PALETTES[k];
  }

  // Fallback palette
  return {
    tint: '#9FD8DD',
    core: '#0E7C86',
    modelLabel: v.baseVoice ? `${v.baseVoice.toUpperCase()} · TTS` : 'GEMINI 3.8 TTS',
    shortName: v.name.split(' ')[0] || v.name,
  };
}

// -------------------------------------------------------------
// Individual 3D Glass Orb with Rotating Icosahedron Core
// -------------------------------------------------------------
interface GlassOrbProps {
  voice: VoiceProfile;
  palette: VoicePalette;
  position: [number, number, number];
  isSelected: boolean;
  isPlaying: boolean;
  onSelect: (id: string) => void;
  onHoverChange: (id: string | null) => void;
  isHovered: boolean;
}

const GlassOrb: React.FC<GlassOrbProps> = ({
  voice,
  palette,
  position,
  isSelected,
  isPlaying,
  onSelect,
  onHoverChange,
  isHovered,
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const orbRef = useRef<THREE.Mesh>(null);

  // Geometry and materials (Halved size: sphere radius 0.42, core radius 0.17)
  const sphereGeo = useMemo(() => new THREE.SphereGeometry(0.42, 36, 36), []);
  const icosahedronGeo = useMemo(() => new THREE.IcosahedronGeometry(0.17, 0), []);

  const glassMat = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(palette.tint),
        transmission: 1,
        thickness: 0.8,
        roughness: 0.06,
        ior: 1.45,
        clearcoat: 1,
        transparent: true,
        opacity: 0.92,
      }),
    [palette.tint]
  );

  const coreMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(palette.core),
        flatShading: true,
        roughness: 0.25,
        metalness: 0.35,
      }),
    [palette.core]
  );

  useFrame((_, delta) => {
    // 1) Inside each orb an icosahedron core slowly rotates
    if (coreRef.current) {
      coreRef.current.rotation.x += delta * (isPlaying ? 1.8 : 0.4);
      coreRef.current.rotation.y += delta * (isPlaying ? 2.4 : 0.6);
      coreRef.current.rotation.z += delta * (isPlaying ? 1.2 : 0.2);
    }

    // 2) Hover scales an orb to 1.12 (lerp .1); selected scales to 1.08
    if (groupRef.current) {
      const targetScale = isHovered ? 1.12 : isSelected ? 1.08 : 1.0;
      groupRef.current.scale.lerp(
        new THREE.Vector3(targetScale, targetScale, targetScale),
        0.1
      );
    }
  });

  return (
    <group
      ref={groupRef}
      position={position}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(voice.id);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        onHoverChange(voice.id);
      }}
      onPointerOut={() => {
        onHoverChange(null);
      }}
    >
      {/* Outer Glass Sphere */}
      <mesh
        ref={orbRef}
        geometry={sphereGeo}
        material={glassMat}
        castShadow
        receiveShadow
      />

      {/* Inside Icosahedron Core (radius 0.34, flatShading) */}
      <mesh
        ref={coreRef}
        geometry={icosahedronGeo}
        material={coreMat}
      />

      {/* HTML Overlay under each orb (Projected coordinates, adjusted for halved orb size) */}
      <Html
        position={[0, -0.72, 0]}
        center
        distanceFactor={8}
        zIndexRange={[100, 0]}
        style={{ pointerEvents: 'none' }}
      >
        <div className="flex flex-col items-center select-none text-center transform -translate-y-1">
          <div
            className={`px-3 py-1 rounded-full backdrop-blur-md border transition-all duration-200 flex items-center gap-1.5 shadow-sm ${
              isSelected
                ? 'bg-[#161511] text-[#F4F1EA] border-[#0E7C86] ring-2 ring-[#0E7C86]/40 scale-105'
                : 'bg-white/85 text-[#161511] border-[rgba(22,21,17,0.14)]'
            }`}
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: palette.core }}
            />
            <span className="font-serif text-xs font-semibold whitespace-nowrap">
              {palette.shortName}
            </span>
            {isSelected && (
              <Check className="w-3 h-3 text-[#5CC8CF] stroke-[2.5]" />
            )}
          </div>
          <span
            className="font-mono text-[9px] uppercase tracking-wider text-[#5D594E] mt-0.5 whitespace-nowrap"
            style={{ fontFamily: '"IBM Plex Mono", monospace' }}
          >
            {palette.modelLabel}
          </span>
        </div>
      </Html>
    </group>
  );
};

// -------------------------------------------------------------
// Interactive Carousel Row Group (Drag anywhere rotates the whole row)
// -------------------------------------------------------------
interface OrbRowGroupProps {
  voices: VoiceProfile[];
  selectedVoiceId: string;
  playingVoiceId: string | null;
  onSelectVoice: (id: string) => void;
  hoveredId: string | null;
  setHoveredId: (id: string | null) => void;
  dragVelocityRef: React.MutableRefObject<number>;
  rotationYRef: React.MutableRefObject<number>;
  isDraggingRef: React.MutableRefObject<boolean>;
}

const OrbRowGroup: React.FC<OrbRowGroupProps> = ({
  voices,
  selectedVoiceId,
  playingVoiceId,
  onSelectVoice,
  hoveredId,
  setHoveredId,
  dragVelocityRef,
  rotationYRef,
  isDraggingRef,
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const count = Math.min(voices.length, 8);
  const radius = 3.0; // circular arrangement radius tuned for halved orbs

  useFrame((_, delta) => {
    if (!groupRef.current) return;

    if (!isDraggingRef.current) {
      // Damping .08 on inertia
      dragVelocityRef.current *= 1 - 0.08;
      // Idle auto-rotation very slow (~0.0018 rad/frame)
      rotationYRef.current += dragVelocityRef.current + 0.0015;
    }

    groupRef.current.rotation.y = rotationYRef.current;
  });

  return (
    <group ref={groupRef} position={[0, 0, 0]}>
      {voices.slice(0, 8).map((voice, idx) => {
        const angle = (idx / count) * Math.PI * 2;
        const x = radius * Math.sin(angle);
        const z = radius * Math.cos(angle) - 0.2;
        const palette = getPaletteForVoice(voice);

        return (
          <GlassOrb
            key={voice.id}
            voice={voice}
            palette={palette}
            position={[x, 0.1, z]}
            isSelected={voice.id === selectedVoiceId}
            isPlaying={voice.id === playingVoiceId}
            onSelect={onSelectVoice}
            onHoverChange={setHoveredId}
            isHovered={hoveredId === voice.id}
          />
        );
      })}
    </group>
  );
};

// -------------------------------------------------------------
// VoiceGallery3D Main Component
// -------------------------------------------------------------
export interface VoiceGallery3DProps {
  voices: VoiceProfile[];
  selectedVoiceId?: string;
  onSelectVoice?: (voiceId: string) => void;
  lang?: 'uz' | 'ru';
  className?: string;
  title?: string;
  subtitle?: string;
  compact?: boolean;
}

export const VoiceGallery3D: React.FC<VoiceGallery3DProps> = ({
  voices,
  selectedVoiceId = 'voice_17raj9ewke3g',
  onSelectVoice,
  lang = 'uz',
  className = '',
  title,
  subtitle,
  compact = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isInView, setIsInView] = useState(true);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const audioInstanceRef = useRef<HTMLAudioElement | null>(null);

  // WebGL support state
  const [hasWebGL, setHasWebGL] = useState<boolean>(true);

  useEffect(() => {
    setHasWebGL(isWebGLAvailable());
  }, []);

  // Performance: Pause render loop when canvas is off-screen (IntersectionObserver)
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsInView(entry.isIntersecting);
      },
      { threshold: 0.05 }
    );
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Drag anywhere rotates the whole row (inertia, damping .08)
  const isDraggingRef = useRef(false);
  const prevPointerXRef = useRef(0);
  const dragVelocityRef = useRef(0);
  const rotationYRef = useRef(0);

  const handlePointerDown = (e: React.PointerEvent) => {
    isDraggingRef.current = true;
    prevPointerXRef.current = e.clientX;
    dragVelocityRef.current = 0;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    const deltaX = e.clientX - prevPointerXRef.current;
    prevPointerXRef.current = e.clientX;
    const dragSensitivity = 0.0055;
    rotationYRef.current += deltaX * dragSensitivity;
    dragVelocityRef.current = deltaX * dragSensitivity;
  };

  const handlePointerUp = () => {
    isDraggingRef.current = false;
  };

  // Play voice sample audio
  const handleTogglePlaySample = useCallback((voiceId: string) => {
    if (playingVoiceId === voiceId) {
      if (audioInstanceRef.current) {
        audioInstanceRef.current.pause();
        audioInstanceRef.current.currentTime = 0;
      }
      setPlayingVoiceId(null);
      return;
    }

    if (audioInstanceRef.current) {
      audioInstanceRef.current.pause();
    }

    const cleanId = voiceId.toLowerCase();
    const url = getVoicePreviewUrl(cleanId) || `/api/voices/preview/${cleanId}`;
    const audio = new Audio(url);
    connectAudioElement(audio);
    audioInstanceRef.current = audio;
    setPlayingVoiceId(voiceId);

    audio.onended = () => setPlayingVoiceId(null);
    audio.onerror = () => setPlayingVoiceId(null);
    audio.play().catch(() => setPlayingVoiceId(null));
  }, [playingVoiceId]);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioInstanceRef.current) {
        audioInstanceRef.current.pause();
        audioInstanceRef.current = null;
      }
    };
  }, []);

  const displayedVoices = useMemo(() => {
    return voices.slice(0, 8);
  }, [voices]);

  const selectedVoice = useMemo(() => {
    return voices.find((v) => v.id === selectedVoiceId) || displayedVoices[0];
  }, [voices, selectedVoiceId, displayedVoices]);

  const activePalette = useMemo(() => {
    return selectedVoice ? getPaletteForVoice(selectedVoice) : VOICE_3D_PALETTES.shokhrukh;
  }, [selectedVoice]);

  return (
    <div
      ref={containerRef}
      className={`w-full rounded-[24px] border border-[rgba(22,21,17,0.14)] bg-[#ECE7DB] shadow-[0_20px_40px_-20px_rgba(22,21,17,0.14)] overflow-hidden transition-all duration-300 relative select-none ${className}`}
    >
      {/* Header bar */}
      <div className="px-5 sm:px-7 pt-5 pb-3 flex flex-wrap items-center justify-between gap-3 border-b border-[rgba(22,21,17,0.08)] bg-[rgba(255,255,255,0.4)] backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-white shadow-2xs transition-colors duration-300"
            style={{ backgroundColor: activePalette.core }}
          >
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-serif text-base sm:text-lg font-normal text-[#161511]">
              {title || (lang === 'uz' ? '3D Ovozlar Galereyasi' : '3D Галерея Голосов')}
            </h3>
            <p
              className="font-mono text-[11px] text-[#0A5A62] font-semibold tracking-wider"
              style={{ fontFamily: '"IBM Plex Mono", monospace' }}
            >
              {subtitle || (lang === 'uz' ? '8 TA SHISHA SHAR · REAT-THREE-FIBER + DREI' : '8 СТЕКЛЯННЫХ СФЕР')}
            </p>
          </div>
        </div>

        {/* Drag Hint & Active Badge */}
        <div className="flex items-center gap-2 text-xs font-mono text-[#5D594E]">
          <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/70 border border-[rgba(22,21,17,0.1)] text-[11px]">
            <Compass className="w-3.5 h-3.5 text-[#0E7C86] animate-spin" style={{ animationDuration: '8s' }} />
            <span>{lang === 'uz' ? 'Sichqoncha bilan aylantiring' : 'Вращайте мышью'}</span>
          </span>
          {selectedVoice && (
            <span
              className="px-3 py-1 rounded-full text-white text-xs font-semibold shadow-2xs flex items-center gap-1.5 transition-colors duration-300"
              style={{ backgroundColor: activePalette.core }}
            >
              <Check className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>{activePalette.shortName}</span>
            </span>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* 3D CANVAS (Full width, 380-420px tall, DPR capped at 2)        */}
      {/* ------------------------------------------------------------- */}
      <div
        className="w-full h-[380px] sm:h-[410px] relative cursor-grab active:cursor-grabbing touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {hasWebGL ? (
          <Canvas
            frameloop={isInView ? 'always' : 'never'}
            dpr={[1, 2]} // DPR capped at 2
            camera={{ position: [0, 0.2, 5.0], fov: 44 }}
            style={{ width: '100%', height: '100%', background: '#ECE7DB' }}
          >
            {/* Scene background equals page panel color #ECE7DB (no visible canvas edges) */}
            <color attach="background" args={['#ECE7DB']} />

            {/* Studio Environment for Glass Reflections */}
            <Environment preset="studio" />

            {/* Ambient & Directional Lights */}
            <ambientLight intensity={0.8} />
            <directionalLight position={[5, 8, 5]} intensity={1.4} castShadow />
            <directionalLight position={[-5, 5, -5]} intensity={0.6} color="#9FD8DD" />
            <pointLight position={[0, -2, 2]} intensity={0.5} color="#5CC8CF" />

            {/* Orb Row Group with drag inertia & damping */}
            <OrbRowGroup
              voices={displayedVoices}
              selectedVoiceId={selectedVoiceId}
              playingVoiceId={playingVoiceId}
              onSelectVoice={(id) => {
                if (onSelectVoice) onSelectVoice(id);
                handleTogglePlaySample(id);
              }}
              hoveredId={hoveredId}
              setHoveredId={setHoveredId}
              dragVelocityRef={dragVelocityRef}
              rotationYRef={rotationYRef}
              isDraggingRef={isDraggingRef}
            />
          </Canvas>
        ) : (
          /* WebGL Fallback: static radial-gradient tiles with the same voice colors */
          <div className="w-full h-full p-6 flex flex-col justify-center items-center bg-[#ECE7DB]">
            <p className="text-xs font-mono text-[#5D594E] mb-4">
              WebGL faollashtirilmagan. Standart ovoz kartochkalari ko'rsatilmoqda:
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-2xl w-full">
              {displayedVoices.map((v) => {
                const palette = getPaletteForVoice(v);
                const isSelected = v.id === selectedVoiceId;
                return (
                  <div
                    key={v.id}
                    onClick={() => {
                      if (onSelectVoice) onSelectVoice(v.id);
                      handleTogglePlaySample(v.id);
                    }}
                    className={`p-4 rounded-2xl border text-center transition-all cursor-pointer shadow-sm ${
                      isSelected
                        ? 'border-[#0E7C86] ring-2 ring-[#0E7C86]/30 bg-white'
                        : 'border-[rgba(22,21,17,0.12)] bg-white/70 hover:bg-white'
                    }`}
                  >
                    <div
                      className="w-9 h-9 rounded-full mx-auto shadow-sm mb-2 flex items-center justify-center text-white"
                      style={{
                        background: `radial-gradient(circle at 35% 35%, ${palette.tint} 0%, ${palette.core} 100%)`,
                      }}
                    >
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <p className="font-serif text-xs font-semibold text-[#161511]">
                      {palette.shortName}
                    </p>
                    <p className="font-mono text-[9px] text-[#5D594E] mt-0.5">
                      {palette.modelLabel}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------- */}
      {/* Bottom Voice Selector Bar (Quick Switch & Test Audio)          */}
      {/* ------------------------------------------------------------- */}
      <div className="p-4 sm:p-5 bg-[rgba(255,255,255,0.65)] border-t border-[rgba(22,21,17,0.08)] backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {displayedVoices.map((voice) => {
              const palette = getPaletteForVoice(voice);
              const isSelected = voice.id === selectedVoiceId;
              const isPlaying = voice.id === playingVoiceId;

              return (
                <button
                  key={voice.id}
                  type="button"
                  onClick={() => {
                    if (onSelectVoice) onSelectVoice(voice.id);
                  }}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs ${
                    isSelected
                      ? 'bg-[#161511] text-[#F4F1EA] ring-2 ring-[#0E7C86]/30'
                      : 'bg-white hover:bg-[#F4F1EA] text-[#5D594E] hover:text-[#161511] border border-[rgba(22,21,17,0.12)]'
                  }`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: palette.core }}
                  />
                  <span>{palette.shortName}</span>
                </button>
              );
            })}
          </div>

          {/* Active Voice Test & Info */}
          {selectedVoice && (
            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={() => handleTogglePlaySample(selectedVoice.id)}
                className="px-4 py-2 rounded-full bg-[#0E7C86] hover:bg-[#0A5A62] text-white text-xs font-semibold flex items-center gap-2 shadow-xs transition-all cursor-pointer"
              >
                {playingVoiceId === selectedVoice.id ? (
                  <>
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>{lang === 'uz' ? 'To\'xtatish' : 'Стоп'}</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current translate-x-0.5" />
                    <span>{lang === 'uz' ? 'Ovozni sinash (Test)' : 'Прослушать'}</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
