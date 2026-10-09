import React, { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import {
  Play,
  Square,
  Check,
  Sparkles,
  Volume2,
  ShieldCheck,
  Compass,
  LayoutGrid,
  Radio,
  Sliders,
  AudioWaveform,
} from 'lucide-react';
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
// Voice 3D Palette Mapping
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
  ulugbek: { tint: '#9DB4DC', core: '#24549C', modelLabel: 'STUDIO · BAS', shortName: 'Ulugʻbek' },
  'ulugbek-history': { tint: '#9DB4DC', core: '#24549C', modelLabel: 'STUDIO · BAS', shortName: 'Ulugʻbek' },

  // Aziza: tint #9FE0D6, core #0E9488
  aziza: { tint: '#9FE0D6', core: '#0E9488', modelLabel: 'STUDIO · SOPRANO', shortName: 'Aziza' },
  'aziza-ai': { tint: '#9FE0D6', core: '#0E9488', modelLabel: 'STUDIO · SOPRANO', shortName: 'Aziza' },

  // Otabek: tint #EFD9A0, core #C98A12
  otabek: { tint: '#EFD9A0', core: '#C98A12', modelLabel: 'STUDIO · TENOR', shortName: 'Otabek' },
  'otabek-comedy': { tint: '#EFD9A0', core: '#C98A12', modelLabel: 'STUDIO · TENOR', shortName: 'Otabek' },

  // Madina: tint #E9B39C, core #C4552D
  madina: { tint: '#E9B39C', core: '#C4552D', modelLabel: 'STUDIO · VIBRANT', shortName: 'Madina' },
  'madina-journalist': { tint: '#E9B39C', core: '#C4552D', modelLabel: 'STUDIO · VIBRANT', shortName: 'Madina' },

  // Jasur: tint #B8BCE0, core #3B3F6E
  'jasur-business': { tint: '#B8BCE0', core: '#3B3F6E', modelLabel: 'STUDIO · BAS', shortName: 'Jasur' },

  // Harmonic defaults for other voices
  'malika-tech': { tint: '#F5C6D6', core: '#A83261', modelLabel: 'STUDIO · SOPRANO', shortName: 'Malika' },
  'nodira-analyst': { tint: '#B6E2D3', core: '#0E7C86', modelLabel: 'STUDIO · BARITON', shortName: 'Nodira' },
  'sevara-science': { tint: '#9FE0D6', core: '#0E7C86', modelLabel: 'STUDIO · BARITON', shortName: 'Sevara' },
  'sherzod-investigation': { tint: '#B8BCE0', core: '#3B3F6E', modelLabel: 'STUDIO · BAS', shortName: 'Sherzod' },
  'javohir-media': { tint: '#D6C7B2', core: '#4A3E31', modelLabel: 'STUDIO · BAS', shortName: 'Javohir' },
  'sanjar-radio': { tint: '#EFD9A0', core: '#C98A12', modelLabel: 'STUDIO · TENOR', shortName: 'Sanjar' },
};

export function getPaletteForVoice(v: VoiceProfile): VoicePalette {
  const idKey = v.id.toLowerCase();
  if (VOICE_3D_PALETTES[idKey]) return VOICE_3D_PALETTES[idKey];

  const nameKey = v.name.toLowerCase();
  for (const k of Object.keys(VOICE_3D_PALETTES)) {
    if (nameKey.includes(k)) return VOICE_3D_PALETTES[k];
  }

  return {
    tint: '#9FD8DD',
    core: '#0E7C86',
    modelLabel: v.gender === 'female' ? 'AYOL · NEURAL TTS' : 'ERKAK · NEURAL TTS',
    shortName: v.name.split(' ')[0] || v.name,
  };
}

// -------------------------------------------------------------
// Pure 3D Glass Orb (No messy floating HTML DOM tags inside 3D!)
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

  // Smooth geometries
  const sphereGeo = useMemo(() => new THREE.SphereGeometry(0.48, 48, 48), []);
  const icosahedronGeo = useMemo(() => new THREE.IcosahedronGeometry(0.2, 0), []);

  const glassMat = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(palette.tint),
        transmission: 0.95,
        thickness: 0.85,
        roughness: 0.04,
        ior: 1.5,
        clearcoat: 1.0,
        clearcoatRoughness: 0.05,
        transparent: true,
        opacity: isSelected ? 0.96 : 0.85,
      }),
    [palette.tint, isSelected]
  );

  const coreMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(palette.core),
        flatShading: true,
        roughness: 0.2,
        metalness: 0.4,
        emissive: new THREE.Color(palette.core),
        emissiveIntensity: isSelected ? 0.5 : isHovered ? 0.3 : 0.1,
      }),
    [palette.core, isSelected, isHovered]
  );

  useFrame((_, delta) => {
    // 1) Rotating faceted gem inside
    if (coreRef.current) {
      coreRef.current.rotation.x += delta * (isPlaying ? 2.5 : 0.5);
      coreRef.current.rotation.y += delta * (isPlaying ? 3.0 : 0.7);
      coreRef.current.rotation.z += delta * (isPlaying ? 1.8 : 0.3);
    }

    // 2) Smooth scale on hover/selected
    if (groupRef.current) {
      const targetScale = isSelected ? 1.15 : isHovered ? 1.08 : 0.95;
      groupRef.current.scale.lerp(
        new THREE.Vector3(targetScale, targetScale, targetScale),
        0.12
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
      {/* Outer Physical Glass Sphere */}
      <mesh
        ref={orbRef}
        geometry={sphereGeo}
        material={glassMat}
        castShadow
        receiveShadow
      />

      {/* Glowing Inner Core */}
      <mesh
        ref={coreRef}
        geometry={icosahedronGeo}
        material={coreMat}
      />

      {/* Subtle Halo Ring for Selected Voice */}
      {isSelected && (
        <mesh position={[0, -0.55, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.35, 0.45, 32]} />
          <meshBasicMaterial
            color={new THREE.Color(palette.core)}
            transparent
            opacity={0.6}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </group>
  );
};

// -------------------------------------------------------------
// Interactive Carousel Row Group (Smooth rotation & centering)
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
  const radius = 2.8;

  useFrame(() => {
    if (!groupRef.current) return;

    if (!isDraggingRef.current) {
      // Natural damping on inertia
      dragVelocityRef.current *= 0.94;
      // Gentle idle auto-rotation
      rotationYRef.current += dragVelocityRef.current + 0.0012;
    }

    groupRef.current.rotation.y = rotationYRef.current;
  });

  return (
    <group ref={groupRef} position={[0, -0.05, 0]}>
      {voices.slice(0, 8).map((voice, idx) => {
        const angle = (idx / count) * Math.PI * 2;
        const x = radius * Math.sin(angle);
        const z = radius * Math.cos(angle);
        const palette = getPaletteForVoice(voice);

        return (
          <GlassOrb
            key={voice.id}
            voice={voice}
            palette={palette}
            position={[x, 0, z]}
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
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isInView, setIsInView] = useState(true);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'3d' | 'grid'>('3d');
  const audioInstanceRef = useRef<HTMLAudioElement | null>(null);

  // WebGL support state
  const [hasWebGL, setHasWebGL] = useState<boolean>(true);

  useEffect(() => {
    setHasWebGL(isWebGLAvailable());
  }, []);

  // Performance: Pause render loop when canvas is off-screen
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

  // Drag anywhere rotates the whole row (inertia, damping)
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
    const dragSensitivity = 0.005;
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

  const activeFocusId = hoveredId || selectedVoiceId;
  const activeFocusVoice = useMemo(() => {
    return voices.find((v) => v.id === activeFocusId) || displayedVoices[0];
  }, [voices, activeFocusId, displayedVoices]);

  const activePalette = useMemo(() => {
    return activeFocusVoice ? getPaletteForVoice(activeFocusVoice) : VOICE_3D_PALETTES.shokhrukh;
  }, [activeFocusVoice]);

  // Smoothly center a voice in 3D when chosen from chips
  const handleSelectAndCenter = (voiceId: string) => {
    if (onSelectVoice) onSelectVoice(voiceId);
    const index = displayedVoices.findIndex((v) => v.id === voiceId);
    if (index >= 0) {
      const count = Math.min(displayedVoices.length, 8);
      const targetAngle = (index / count) * Math.PI * 2;
      // Rotate carousel so this orb faces camera (angle 0)
      rotationYRef.current = -targetAngle;
      dragVelocityRef.current = 0;
    }
  };

  return (
    <div
      ref={containerRef}
      className={`w-full rounded-[24px] border border-[rgba(22,21,17,0.14)] bg-[#ECE7DB] shadow-[0_20px_40px_-20px_rgba(22,21,17,0.14)] overflow-hidden transition-all duration-300 relative select-none isolate ${className}`}
    >
      {/* 1. Header Bar with Mode Toggle */}
      <div className="px-5 sm:px-7 py-3.5 flex flex-wrap items-center justify-between gap-3 border-b border-[rgba(22,21,17,0.08)] bg-[rgba(255,255,255,0.6)] backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-white shadow-2xs transition-colors duration-300 shrink-0"
            style={{ backgroundColor: activePalette.core }}
          >
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-serif text-base sm:text-lg font-normal text-[#161511]">
              {title || (lang === 'uz' ? 'Ovozlar Studiyasi & Galereyasi' : 'Студия и Галерея Голосов')}
            </h3>
            <p className="font-mono text-[11px] text-[#0A5A62] font-semibold tracking-wider">
              {subtitle || (lang === 'uz' ? '8 TA PREMIUM OVOZ · 24kHz HD MASTER' : '8 ПРЕМИУМ ГОЛОСОВ · 24kHz HD')}
            </p>
          </div>
        </div>

        {/* View Toggle & Drag Hint */}
        <div className="flex items-center gap-2 text-xs font-mono">
          <div className="flex border border-[rgba(22,21,17,0.14)] rounded-full overflow-hidden bg-white/70 p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('3d')}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                viewMode === '3d'
                  ? 'bg-[#161511] text-[#F4F1EA] shadow-2xs'
                  : 'text-[#5D594E] hover:text-[#161511]'
              }`}
            >
              <span>🔮 3D Sharlar</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                viewMode === 'grid'
                  ? 'bg-[#161511] text-[#F4F1EA] shadow-2xs'
                  : 'text-[#5D594E] hover:text-[#161511]'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Kartochkalar</span>
            </button>
          </div>

          {viewMode === '3d' && (
            <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/70 border border-[rgba(22,21,17,0.1)] text-[11px] text-[#5D594E]">
              <Compass className="w-3.5 h-3.5 text-[#0E7C86] animate-spin" style={{ animationDuration: '8s' }} />
              <span>{lang === 'uz' ? 'Aylantiring' : 'Вращайте'}</span>
            </span>
          )}
        </div>
      </div>

      {/* 2. Active Voice Spotlight Bar (Crystal Clear, NEVER floating in 3D!) */}
      {activeFocusVoice && (
        <div className="px-5 sm:px-7 py-3 bg-white/70 border-b border-[rgba(22,21,17,0.08)] flex flex-wrap items-center justify-between gap-3 transition-colors duration-300">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-2xl flex items-center justify-center text-white shadow-sm ring-2 ring-white shrink-0"
              style={{ backgroundColor: activePalette.core }}
            >
              <span className="font-serif font-bold text-base">
                {activePalette.shortName.charAt(0)}
              </span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-serif text-sm sm:text-base font-semibold text-[#161511]">
                  {activeFocusVoice.name}
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#0E7C86]/10 text-[#0A5A62] border border-[#0E7C86]/25">
                  {activePalette.modelLabel}
                </span>
                {activeFocusVoice.id === selectedVoiceId && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-700 border border-emerald-500/30 flex items-center gap-1">
                    <Check className="w-3 h-3 stroke-[2.5]" />
                    {lang === 'uz' ? 'Faol Ovoz' : 'Активный Голос'}
                  </span>
                )}
              </div>
              <p className="text-xs text-[#5D594E] font-mono">
                {activeFocusVoice.timbre || '24kHz Lossless · O\'zbek tili'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={() => handleTogglePlaySample(activeFocusVoice.id)}
              className="px-4 py-2 rounded-full bg-[#0E7C86] hover:bg-[#0A5A62] text-white text-xs font-semibold flex items-center gap-2 shadow-xs transition-all cursor-pointer"
            >
              {playingVoiceId === activeFocusVoice.id ? (
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

            {activeFocusVoice.id !== selectedVoiceId && (
              <button
                type="button"
                onClick={() => handleSelectAndCenter(activeFocusVoice.id)}
                className="px-4 py-2 rounded-full bg-[#161511] hover:bg-[#0A5A62] text-white text-xs font-semibold shadow-xs transition-all cursor-pointer"
              >
                {lang === 'uz' ? 'Tanlash' : 'Выбрать'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* 3. Main Area: 3D Canvas OR Grid Cards */}
      {viewMode === '3d' && hasWebGL ? (
        <div
          className="w-full h-[320px] sm:h-[350px] relative cursor-grab active:cursor-grabbing touch-none overflow-hidden"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          <Canvas
            frameloop={isInView ? 'always' : 'never'}
            dpr={[1, 2]}
            camera={{ position: [0, 0.4, 4.8], fov: 42 }}
            style={{ width: '100%', height: '100%', background: '#ECE7DB' }}
          >
            <color attach="background" args={['#ECE7DB']} />
            <Environment preset="studio" />
            <ambientLight intensity={0.8} />
            <directionalLight position={[5, 8, 5]} intensity={1.4} castShadow />
            <directionalLight position={[-5, 5, -5]} intensity={0.6} color="#9FD8DD" />
            <pointLight position={[0, -2, 2]} intensity={0.5} color="#5CC8CF" />

            <OrbRowGroup
              voices={displayedVoices}
              selectedVoiceId={selectedVoiceId}
              playingVoiceId={playingVoiceId}
              onSelectVoice={(id) => {
                handleSelectAndCenter(id);
              }}
              hoveredId={hoveredId}
              setHoveredId={setHoveredId}
              dragVelocityRef={dragVelocityRef}
              rotationYRef={rotationYRef}
              isDraggingRef={isDraggingRef}
            />
          </Canvas>
        </div>
      ) : (
        /* Grid Card View (Responsive, rock-solid, ultra-clean) */
        <div className="p-5 sm:p-6 bg-[#ECE7DB]">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 max-w-5xl mx-auto">
            {displayedVoices.map((v) => {
              const palette = getPaletteForVoice(v);
              const isSelected = v.id === selectedVoiceId;
              const isPlaying = v.id === playingVoiceId;

              return (
                <div
                  key={v.id}
                  onClick={() => handleSelectAndCenter(v.id)}
                  className={`p-4 rounded-2xl border transition-all cursor-pointer shadow-xs relative flex flex-col justify-between ${
                    isSelected
                      ? 'border-[#0E7C86] ring-2 ring-[#0E7C86]/30 bg-white'
                      : 'border-[rgba(22,21,17,0.12)] bg-white/70 hover:bg-white hover:border-[#0E7C86]/60'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div
                        className="w-9 h-9 rounded-xl shadow-xs flex items-center justify-center text-white"
                        style={{ backgroundColor: palette.core }}
                      >
                        <span className="font-serif font-bold text-sm">
                          {palette.shortName.charAt(0)}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTogglePlaySample(v.id);
                        }}
                        className={`p-1.5 rounded-full transition-colors ${
                          isPlaying
                            ? 'bg-[#0E7C86] text-white'
                            : 'bg-[#ECE7DB] hover:bg-[#161511] text-[#161511] hover:text-white'
                        }`}
                        title="Ovozni sinash"
                      >
                        {isPlaying ? (
                          <Square className="w-3 h-3 fill-current" />
                        ) : (
                          <Play className="w-3 h-3 fill-current translate-x-0.5" />
                        )}
                      </button>
                    </div>

                    <div>
                      <p className="font-serif text-xs sm:text-sm font-semibold text-[#161511]">
                        {palette.shortName}
                      </p>
                      <p className="font-mono text-[10px] text-[#0A5A62] mt-0.5 font-bold">
                        {palette.modelLabel}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 pt-2 border-t border-[rgba(22,21,17,0.06)] flex items-center justify-between">
                    <span className="text-[10px] font-mono text-[#5D594E] truncate max-w-[90px]">
                      {v.timbre?.split(' ')[0] || 'Studio HD'}
                    </span>
                    {isSelected && (
                      <span className="text-[10px] font-mono font-bold text-[#0E7C86] flex items-center gap-0.5">
                        <Check className="w-3 h-3 stroke-[3]" /> Tanlangan
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 4. Bottom Horizontal Voice Chips (Quick jump & 1-click select) */}
      <div className="p-3 sm:p-4 bg-[rgba(255,255,255,0.7)] border-t border-[rgba(22,21,17,0.08)] backdrop-blur-md">
        <div className="flex items-center gap-1.5 overflow-x-auto visible-scrollbar pb-1">
          {displayedVoices.map((voice) => {
            const palette = getPaletteForVoice(voice);
            const isSelected = voice.id === selectedVoiceId;

            return (
              <button
                key={voice.id}
                type="button"
                onClick={() => handleSelectAndCenter(voice.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0 shadow-2xs ${
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
                {isSelected && <Check className="w-3 h-3 text-[#5CC8CF] stroke-[2.5]" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
