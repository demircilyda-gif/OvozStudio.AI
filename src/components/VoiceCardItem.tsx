import React, { useRef, useState, useMemo, useEffect } from 'react';
import { VoiceProfile } from '../types/podcast';
import { getVoicePreviewUrl } from '../data/voicePreviews';
import { Volume2, Play, Square } from 'lucide-react';
import { connectAudioElement } from '../utils/audioReactive';

interface VoiceCardItemProps {
  voice: VoiceProfile;
  isSelected: boolean;
  onSelect: () => void;
  lang: 'uz' | 'ru';
}

// Global reference so only one voice preview plays at a time across the entire UI
let activeAudioPreview: HTMLAudioElement | null = null;
let activeStopCallback: (() => void) | null = null;

export const VoiceCardItem: React.FC<VoiceCardItemProps> = ({
  voice,
  isSelected,
  onSelect,
  lang,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progressRatio, setProgressRatio] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Deterministic mini waveform heights
  const miniWaveBars = useMemo(() => {
    const bars: number[] = [];
    let seed = 0;
    for (let i = 0; i < voice.name.length; i++) {
      seed = (seed + voice.name.charCodeAt(i) * 31) % 1000;
    }
    for (let i = 0; i < 16; i++) {
      const val = 20 + Math.abs(Math.sin((seed + i * 17) * 0.4)) * 75;
      bars.push(Math.round(val));
    }
    return bars;
  }, [voice.name]);

  const previewUrl = useMemo(() => {
    return voice.sampleAudioUrl || getVoicePreviewUrl(voice.id) || `/api/voices/preview/${voice.id}`;
  }, [voice.id, voice.sampleAudioUrl]);

  // Clean up audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (activeStopCallback === stopPlayback) {
        activeStopCallback = null;
        activeAudioPreview = null;
      }
    };
  }, []);

  const stopPlayback = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);
    setProgressRatio(0);
  };

  const playPreview = () => {
    // If another voice is currently playing, stop it first
    if (activeStopCallback && activeStopCallback !== stopPlayback) {
      activeStopCallback();
    }

    if (!audioRef.current) {
      const audio = new Audio(previewUrl);
      audio.preload = 'auto';
      audio.volume = 0.95;
      connectAudioElement(audio);

      audio.ontimeupdate = () => {
        if (audio.duration && !isNaN(audio.duration) && audio.duration > 0) {
          setProgressRatio(audio.currentTime / audio.duration);
        }
      };

      audio.onended = () => {
        setIsPlaying(false);
        setProgressRatio(0);
        if (activeAudioPreview === audio) {
          activeAudioPreview = null;
          activeStopCallback = null;
        }
      };

      audio.onerror = () => {
        // Fallback to API route if direct static file failed
        if (previewUrl !== `/api/voices/preview/${voice.id}`) {
          audio.src = `/api/voices/preview/${voice.id}`;
          connectAudioElement(audio);
          audio.play().catch(() => {});
        } else {
          setIsPlaying(false);
        }
      };

      audioRef.current = audio;
    } else {
      connectAudioElement(audioRef.current);
    }

    activeAudioPreview = audioRef.current;
    activeStopCallback = stopPlayback;

    audioRef.current.currentTime = 0;
    audioRef.current
      .play()
      .then(() => setIsPlaying(true))
      .catch(() => setIsPlaying(false));
  };

  const togglePreview = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isPlaying) {
      stopPlayback();
    } else {
      playPreview();
    }
  };

  // Hover preview support (desktop)
  const handleMouseEnter = () => {
    if (!isPlaying) {
      playPreview();
    }
  };

  const handleMouseLeave = () => {
    if (isPlaying) {
      stopPlayback();
    }
  };

  // Voice color dot
  const getDotColor = () => {
    if (voice.isReplicatedVoice) return '#0E7C86';
    if (voice.gender === 'female') return '#C4552D';
    if (voice.baseVoice === 'Fenrir') return '#24549C';
    if (voice.baseVoice === 'Puck') return '#C98A12';
    return '#0A5A62';
  };

  return (
    <div
      onClick={onSelect}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`p-2.5 rounded-xl transition-all cursor-pointer relative select-none border ${
        isSelected
          ? 'bg-[rgba(14,124,134,0.08)] border-[#0E7C86] text-[#161511] shadow-sm'
          : 'bg-white/70 hover:bg-white border-[rgba(22,21,17,0.12)] text-[#3A382F]'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        {/* Left: Dot + Names */}
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: getDotColor() }}
          />

          <div className="truncate">
            <div className="font-semibold text-xs text-[#161511] truncate flex items-center gap-1.5">
              <span>{voice.name}</span>
              {isPlaying && (
                <Volume2 className="w-3 h-3 text-[#0E7C86] animate-pulse shrink-0" />
              )}
            </div>
            <div className="text-[10px] text-[#5D594E] font-mono uppercase tracking-wider truncate mt-0.5">
              {voice.isReplicatedVoice
                ? (lang === 'uz' ? 'Replikatsiya' : 'Клон')
                : (voice.baseVoice?.toUpperCase() || 'STUDIO')}
            </div>
          </div>
        </div>

        {/* Right: Play Button + Mini Waveform */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={togglePreview}
            className={`w-6 h-6 rounded-full flex items-center justify-center transition-all cursor-pointer ${
              isPlaying
                ? 'bg-[#0E7C86] text-white shadow-sm'
                : 'bg-[#161511] text-[#F4F1EA] hover:bg-[#0A5A62]'
            }`}
            title={isPlaying ? 'Toʻxtatish' : 'Tinglash'}
          >
            {isPlaying ? (
              <Square className="w-2.5 h-2.5 fill-current" />
            ) : (
              <Play className="w-2.5 h-2.5 fill-current translate-x-0.5" />
            )}
          </button>

          {/* Mini Waveform */}
          <div className="flex items-center gap-0.5 h-5 shrink-0 pr-0.5">
            {miniWaveBars.map((heightPct, idx) => {
              const barProgress = idx / miniWaveBars.length;
              const isPast = isPlaying && barProgress <= progressRatio;
              return (
                <div
                  key={idx}
                  className={`w-0.5 rounded-full transition-all duration-150 ${
                    isPlaying
                      ? isPast
                        ? 'bg-[#0E7C86]'
                        : 'bg-[#0E7C86]/35'
                      : isSelected
                      ? 'bg-[#0E7C86]/60'
                      : 'bg-zinc-300'
                  }`}
                  style={{
                    height: `${
                      isPlaying
                        ? Math.min(100, Math.max(20, heightPct * (1 + Math.sin(idx * 0.8 + progressRatio * 12) * 0.4)))
                        : heightPct * 0.7
                    }%`,
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
