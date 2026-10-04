import React, { useEffect, useRef, useState } from 'react';
import {
  Play,
  Pause,
  Download,
  Volume2,
  VolumeX,
  RotateCcw,
  Sparkles,
  Music,
  Check,
  CheckCircle2,
  Disc,
  Radio,
  FileAudio,
  Save,
  Sliders,
} from 'lucide-react';
import {
  base64ToArrayBuffer,
  getAudioContext,
  generateAmbientAudioBuffer,
  audioBufferToWav,
  mixAudioTracks,
  exportAudioWithQuality,
  autoPlanPodcastCues,
} from '../utils/audioUtils';
import { AmbientSoundscape, AudioSegmentCue, SoundCueType } from '../types/podcast';
import { AMBIENT_SOUNDSCAPES } from '../data/ambientSoundscapes';
import { connectAudioElement } from '../utils/audioReactive';

interface AudioPreviewPlayerProps {
  rawAudioWavBase64: string;
  title: string;
  voiceName: string;
  category: string;
  ambientSound: AmbientSoundscape;
  ambientVolume?: number;
  onChangeAmbientSound?: (sound: AmbientSoundscape) => void;
  durationSeconds: number;
  onSaveToCMS?: () => void;
  lang: 'uz' | 'ru';
}

export const AudioPreviewPlayer: React.FC<AudioPreviewPlayerProps> = ({
  rawAudioWavBase64,
  title,
  voiceName,
  category,
  ambientSound,
  ambientVolume = 20,
  onChangeAmbientSound,
  durationSeconds,
  onSaveToCMS,
  lang,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(durationSeconds || 0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  
  // Ambient background mixer state
  const [currentAmbient, setCurrentAmbient] = useState<AmbientSoundscape>(ambientSound);
  const [ambientEnabled, setAmbientEnabled] = useState(ambientSound !== 'none');
  const [ambientVol, setAmbientVol] = useState(ambientVolume || 20);

  // Dynamic Sound Director & Cue Timeline State
  const [soundDirectorMode, setSoundDirectorMode] = useState<boolean>(true);
  const [cues, setCues] = useState<AudioSegmentCue[]>(() =>
    autoPlanPodcastCues(durationSeconds || 60, 5, ambientSound !== 'none' ? ambientSound : 'calm-piano')
  );
  const [isPlanningDirector, setIsPlanningDirector] = useState<boolean>(false);
  const [directorStrategy, setDirectorStrategy] = useState<{ strategyUz: string; strategyRu: string } | null>({
    strategyUz: "Dinamik saund-dizayn: Bitta uzluksiz fondan voz kechilib, kirishda 8 soniyalik jingle, asosiy qismda toza ovoz (silence), chuqur fikrda mayin fon va finalda outro qo'yildi.",
    strategyRu: "Динамический саунд-дизайн: Вместо бесконечного лупа расставлены акценты — яркое интро, чистый голос без музыки в середине, акцент и финальное аутро.",
  });

  // Export & Download settings
  const [exportFormat, setExportFormat] = useState<'wav' | 'mp3'>('wav');
  const [exportQuality, setExportQuality] = useState<'lossless' | '320k' | '192k' | '128k'>('lossless');
  const [includeAmbientInExport, setIncludeAmbientInExport] = useState(ambientSound !== 'none');
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);
  const [isSavedToCMS, setIsSavedToCMS] = useState(false);

  // Audio elements & Canvas refs
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const audioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const ambientAudioRef = useRef<HTMLAudioElement | null>(null);

  // Sync ambient sound if prop changes
  useEffect(() => {
    setCurrentAmbient(ambientSound);
    if (ambientSound !== 'none') {
      setAmbientEnabled(true);
      setIncludeAmbientInExport(true);
    }
  }, [ambientSound]);

  // Maintain ambient audio loop
  useEffect(() => {
    if (currentAmbient === 'none') {
      if (ambientAudioRef.current) {
        ambientAudioRef.current.pause();
        ambientAudioRef.current.src = '';
      }
      return;
    }

    try {
      const ctx = getAudioContext();
      // Generate a 16-second seamless loop for ambient playback
      const ambientBuf = generateAmbientAudioBuffer(ctx, 16.0, currentAmbient);
      const wavBlob = audioBufferToWav(ambientBuf, ctx.sampleRate);
      const url = URL.createObjectURL(wavBlob);

      if (!ambientAudioRef.current) {
        ambientAudioRef.current = new Audio(url);
      } else {
        ambientAudioRef.current.src = url;
      }
      ambientAudioRef.current.loop = true;
      ambientAudioRef.current.volume = isMuted ? 0 : Math.max(0, Math.min(1, (ambientVol / 100) * 0.65));

      if (isPlaying && ambientEnabled) {
        ambientAudioRef.current.play().catch(() => {});
      }

      return () => {
        URL.revokeObjectURL(url);
      };
    } catch (err) {
      console.error('Failed to create ambient audio loop:', err);
    }
  }, [currentAmbient]);

  // Sync ambient volume
  useEffect(() => {
    if (ambientAudioRef.current) {
      ambientAudioRef.current.volume = isMuted ? 0 : Math.max(0, Math.min(1, (ambientVol / 100) * 0.65));
    }
  }, [ambientVol, isMuted]);

  // Initialize and load audio data
  const [audioUrl, setAudioUrl] = useState<string>('');

  useEffect(() => {
    if (!rawAudioWavBase64) return;

    try {
      const buffer = base64ToArrayBuffer(rawAudioWavBase64);
      
      // Compute accurate duration from WAV data chunk size (24kHz 16-bit mono = 48,000 bytes/sec)
      if (buffer.byteLength > 44) {
        const view = new DataView(buffer);
        let offset = 12;
        while (offset < buffer.byteLength - 8) {
          const chunkId = String.fromCharCode(
            view.getUint8(offset),
            view.getUint8(offset + 1),
            view.getUint8(offset + 2),
            view.getUint8(offset + 3)
          );
          const chunkSize = view.getUint32(offset + 4, true);
          if (chunkId === 'data') {
            const realDuration = Math.round((chunkSize / 48000) * 10) / 10;
            if (realDuration > 0) {
              setTotalDuration(realDuration);
            }
            break;
          }
          offset += 8 + chunkSize;
        }
      }

      const blob = new Blob([buffer], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);

      return () => {
        URL.revokeObjectURL(url);
      };
    } catch (err) {
      console.error('Failed to create audio URL:', err);
    }
  }, [rawAudioWavBase64]);

  // Handle Play/Pause
  const togglePlay = () => {
    if (!audioRef.current) return;
    connectAudioElement(audioRef.current);
    if (isPlaying) {
      audioRef.current.pause();
      if (ambientAudioRef.current) {
        ambientAudioRef.current.pause();
      }
      setIsPlaying(false);
    } else {
      audioRef.current.play().catch(console.error);
      if (ambientEnabled && currentAmbient !== 'none' && ambientAudioRef.current) {
        ambientAudioRef.current.play().catch(console.error);
      }
      setIsPlaying(true);
    }
  };

  const handleToggleAmbient = () => {
    const next = !ambientEnabled;
    setAmbientEnabled(next);
    setIncludeAmbientInExport(next);
    if (!next) {
      ambientAudioRef.current?.pause();
    } else {
      if (isPlaying && ambientAudioRef.current && currentAmbient !== 'none') {
        ambientAudioRef.current.play().catch(console.error);
      }
    }
  };

  const handleSelectAmbient = (sound: AmbientSoundscape) => {
    setCurrentAmbient(sound);
    if (sound !== 'none') {
      setAmbientEnabled(true);
      setIncludeAmbientInExport(true);
    }
    onChangeAmbientSound?.(sound);
  };

  // Setup Web Audio Analyser for Waveform
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;

    const ctx = getAudioContext();
    if (!analyserRef.current) {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analyserRef.current = analyser;

      if (!audioSourceRef.current) {
        try {
          const source = ctx.createMediaElementSource(audio);
          source.connect(analyser);
          analyser.connect(ctx.destination);
          audioSourceRef.current = source;
        } catch (e) {
          // source already connected
        }
      }
    }

    const handleLoadedMetadata = () => {
      if (audio.duration && Number.isFinite(audio.duration) && audio.duration > 0) {
        setTotalDuration(Math.round(audio.duration * 10) / 10);
      }
    };

    const handleTimeUpdate = () => {
      const cur = audio.currentTime;
      setCurrentTime(cur);

      // Real-time sound director ducking & silence enforcement
      if (soundDirectorMode && ambientAudioRef.current && ambientEnabled) {
        const activeCue = cues.find((c) => (c.startTime ?? 0) <= cur && cur < (c.endTime ?? (totalDuration || 60)));
        if (activeCue) {
          if (activeCue.cueType === 'silence' || activeCue.soundscape === 'none' || activeCue.volumePercent <= 0) {
            ambientAudioRef.current.volume = 0; // Pure dry silence!
          } else {
            const factor = (activeCue.volumePercent / 100) * 0.65;
            ambientAudioRef.current.volume = isMuted ? 0 : Math.max(0, Math.min(1, factor));
          }
        }
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      if (ambientAudioRef.current) {
        ambientAudioRef.current.pause();
        ambientAudioRef.current.currentTime = 0;
      }
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [audioUrl, durationSeconds, soundDirectorMode, cues, ambientEnabled, isMuted]);

  // Sync cues to actual audio duration when totalDuration updates
  useEffect(() => {
    if (totalDuration > 0) {
      setCues((prev) => {
        if (!prev || prev.length === 0) {
          return autoPlanPodcastCues(totalDuration, 5, currentAmbient !== 'none' ? currentAmbient : 'calm-piano');
        }
        const oldTotal = prev[prev.length - 1]?.endTime || totalDuration;
        const scale = totalDuration / oldTotal;
        return prev.map((c) => ({
          ...c,
          startTime: Math.round((c.startTime ?? 0) * scale * 10) / 10,
          endTime: Math.round((c.endTime ?? totalDuration) * scale * 10) / 10,
        }));
      });
    }
  }, [totalDuration]);

  // AI Sound Director request
  const handleRunSoundDirector = async () => {
    setIsPlanningDirector(true);
    try {
      const res = await fetch('/api/podcast/sound-director', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: title,
          category,
          preferredSoundscape: currentAmbient,
          turns: [
            { speakerName: voiceName, text: `Podkast boshlanishi: ${title}` },
            { speakerName: voiceName, text: `Asosiy tahlil, faktlar va mulohazalar` },
            { speakerName: voiceName, text: `Chuqur falsafiy ma'no va shaxsiy hikoya` },
            { speakerName: voiceName, text: `Yangi xulosalar va taqqoslash` },
            { speakerName: voiceName, text: `Epizod yakuni va tinglovchilarga minnatdorchilik` },
          ],
        }),
      });

      if (!res.ok) throw new Error('Sound director request failed');
      const data = await res.json();
      if (data.strategyUz) {
        setDirectorStrategy({ strategyUz: data.strategyUz, strategyRu: data.strategyRu });
      }
      if (Array.isArray(data.cues) && data.cues.length > 0) {
        const segDur = (totalDuration || 60) / data.cues.length;
        const plannedCues: AudioSegmentCue[] = data.cues.map((c: any, i: number) => ({
          id: `cue-${i}-${Date.now()}`,
          turnIndex: i,
          startTime: Math.round(i * segDur * 10) / 10,
          endTime: Math.round((i + 1) * segDur * 10) / 10,
          cueType: c.cueType,
          soundscape: c.soundscape,
          volumePercent: c.volumePercent,
          labelUz: c.labelUz,
          labelRu: c.labelRu,
          reasoning: c.reasoning,
        }));
        setCues(plannedCues);
      }
    } catch (err) {
      console.warn('Fallback to local sound director:', err);
      setCues(autoPlanPodcastCues(totalDuration || 60, 5, currentAmbient));
    } finally {
      setIsPlanningDirector(false);
    }
  };

  const handleToggleCueSilence = (cueId: string) => {
    setCues((prev) =>
      prev.map((c) => {
        if (c.id !== cueId) return c;
        const willBeSilence = c.cueType !== 'silence';
        return {
          ...c,
          cueType: willBeSilence ? 'silence' : 'bed',
          soundscape: willBeSilence ? 'none' : currentAmbient !== 'none' ? currentAmbient : 'calm-piano',
          volumePercent: willBeSilence ? 0 : 15,
          labelUz: willBeSilence ? 'Toza ovoz (Silence)' : 'Mayin fon (Bed)',
          labelRu: willBeSilence ? 'Чистый голос (без музыки)' : 'Эмбиент',
        };
      })
    );
  };

  const handleUpdateCueSound = (cueId: string, snd: AmbientSoundscape) => {
    setCues((prev) =>
      prev.map((c) => {
        if (c.id !== cueId) return c;
        const isNone = snd === 'none';
        return {
          ...c,
          soundscape: snd,
          cueType: isNone ? 'silence' : c.cueType === 'silence' ? 'bed' : c.cueType,
          volumePercent: isNone ? 0 : c.volumePercent || 15,
          labelUz: isNone ? 'Toza ovoz' : AMBIENT_SOUNDSCAPES.find((s) => s.id === snd)?.labelUz || 'Fon',
          labelRu: isNone ? 'Чистый голос' : AMBIENT_SOUNDSCAPES.find((s) => s.id === snd)?.labelRu || 'Фон',
        };
      })
    );
  };

  // Canvas visualizer loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const analyser = analyserRef.current;
    const bufferLength = analyser ? analyser.frequencyBinCount : 32;
    const dataArray = new Uint8Array(bufferLength);

    const render = () => {
      animFrameRef.current = requestAnimationFrame(render);
      const width = canvas.width;
      const height = canvas.height;

      ctx.clearRect(0, 0, width, height);

      if (analyser && isPlaying) {
        analyser.getByteFrequencyData(dataArray);
      } else {
        // Idle subtle wave
        for (let i = 0; i < dataArray.length; i++) {
          dataArray[i] = 15 + Math.sin(Date.now() * 0.003 + i * 0.3) * 10;
        }
      }

      const barCount = 48;
      const barWidth = (width / barCount) - 2;
      const progressRatio = totalDuration > 0 ? currentTime / totalDuration : 0;

      for (let i = 0; i < barCount; i++) {
        const dataIndex = Math.floor((i / barCount) * dataArray.length);
        const value = dataArray[dataIndex] || 20;
        const barHeight = Math.max(4, (value / 255) * (height - 8));
        const x = i * (barWidth + 2);
        const y = (height - barHeight) / 2;

        const isPlayed = i / barCount <= progressRatio;

        // Gradient coloring
        const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
        if (isPlayed) {
          gradient.addColorStop(0, '#06b6d4'); // [#FACC15]
          gradient.addColorStop(1, '#3b82f6'); // blue-500
        } else {
          gradient.addColorStop(0, '#3f3f46'); // zinc-700
          gradient.addColorStop(1, '#27272a'); // zinc-800
        }

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 2);
        ctx.fill();
      }
    };

    render();

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [isPlaying, currentTime, totalDuration]);

  // Handle Seek
  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !totalDuration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    const newTime = pos * totalDuration;
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
    if (ambientAudioRef.current && ambientAudioRef.current.duration) {
      ambientAudioRef.current.currentTime = newTime % ambientAudioRef.current.duration;
    }
  };

  // Handle Playback Speed
  const changeSpeed = (rate: number) => {
    setPlaybackRate(rate);
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  };

  // Format seconds to mm:ss
  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const rem = Math.floor(secs % 60);
    return `${mins}:${rem < 10 ? '0' : ''}${rem}`;
  };

  // Export Audio Handler
  const handleExport = async () => {
    if (!rawAudioWavBase64) return;
    setIsExporting(true);
    setExportSuccess(false);

    try {
      const rawBuffer = base64ToArrayBuffer(rawAudioWavBase64);
      let finalWavBlob: Blob;

      if (includeAmbientInExport && ambientEnabled && currentAmbient !== 'none') {
        const { wavBlob } = await mixAudioTracks(
          rawBuffer,
          currentAmbient,
          ambientVol,
          100,
          soundDirectorMode ? cues : undefined
        );
        finalWavBlob = wavBlob;
      } else {
        finalWavBlob = new Blob([rawBuffer], { type: 'audio/wav' });
      }

      await exportAudioWithQuality(
        finalWavBlob,
        exportFormat,
        exportQuality,
        `${title}_${voiceName}`
      );

      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 3500);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="bg-white/80 border border-[rgba(22,21,17,0.14)] rounded-[24px] p-5 sm:p-7 shadow-[0_20px_40px_-20px_rgba(22,21,17,0.18)] backdrop-blur-xl space-y-5">
      {/* Hidden audio element */}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="metadata"
        />
      )}

      {/* Header Info */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-5 border-b border-[rgba(22,21,17,0.1)]">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[10.5px] font-mono font-semibold bg-[#0E7C86]/10 text-[#0A5A62] border border-[#0E7C86]/30 flex items-center gap-1">
              <Radio className="w-3 h-3 text-[#0E7C86] pulse-teal-dot" />
              {lang === 'uz' ? 'Tinglashga tayyor' : 'Готово к прослушиванию'}
            </span>
            <span className="text-xs text-[#5D594E]/40">•</span>
            <span className="text-xs font-mono text-[#5D594E]">{category}</span>
          </div>
          <h3 className="font-serif text-xl sm:text-2xl text-[#161511] font-normal tracking-tight mt-1">
            {title}
          </h3>
          <p className="text-xs text-[#5D594E] mt-0.5 flex items-center gap-1.5 font-mono">
            <Disc className="w-3.5 h-3.5 text-[#0E7C86]" />
            <span>{lang === 'uz' ? 'Ovoz:' : 'Голос:'} <strong className="text-[#161511]">{voiceName}</strong></span>
            <span>•</span>
            <span>Gemini 3.8 TTS Live 24kHz Studio Master</span>
          </p>
        </div>

        {/* Playback speed buttons */}
        <div className="flex items-center gap-1 bg-[#F4F1EA] p-1 rounded-full border border-[rgba(22,21,17,0.14)] self-start sm:self-center font-mono">
          {[0.8, 1.0, 1.25, 1.5].map((rate) => (
            <button
              key={rate}
              type="button"
              onClick={() => changeSpeed(rate)}
              className={`px-2.5 py-0.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                playbackRate === rate
                  ? 'bg-[#161511] text-[#F4F1EA] shadow-2xs'
                  : 'text-[#5D594E] hover:text-[#161511]'
              }`}
            >
              {rate}x
            </button>
          ))}
        </div>
      </div>

      {/* Interactive Waveform Canvas (Studio Screen Panel #141414) */}
      <div>
        <div
          onClick={handleSeek}
          className="relative h-20 w-full bg-[#141414] rounded-2xl border border-[#2B2B27] cursor-pointer overflow-hidden group hover:border-[#5CC8CF]/50 transition-colors shadow-inner"
        >
          <canvas
            ref={canvasRef}
            width={720}
            height={80}
            className="w-full h-full block"
          />

          {/* Time scrubber tooltip / bar */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-[#5CC8CF] shadow-[0_0_10px_#5CC8CF] pointer-events-none transition-all"
            style={{
              left: `${totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0}%`,
            }}
          />
        </div>

        {/* Time labels */}
        <div className="flex items-center justify-between text-xs font-mono text-[#5D594E] mt-2 px-1">
          <span>{formatTime(currentTime)}</span>
          <span className="text-[#5D594E]/40">/</span>
          <span>{formatTime(totalDuration)}</span>
        </div>
      </div>

      {/* Transport Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-[rgba(22,21,17,0.1)]">
        <div className="flex items-center gap-3">
          {/* Main Play/Pause Button */}
          <button
            type="button"
            onClick={togglePlay}
            className="w-13 h-13 rounded-full bg-[#161511] hover:bg-[#0A5A62] text-[#F4F1EA] font-bold flex items-center justify-center shadow-md transition-all active:scale-95 cursor-pointer"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <Pause className="w-5 h-5 fill-current" />
            ) : (
              <Play className="w-5 h-5 fill-current ml-0.5" />
            )}
          </button>

          {/* Restart */}
          <button
            type="button"
            onClick={() => {
              if (audioRef.current) {
                audioRef.current.currentTime = 0;
                setCurrentTime(0);
              }
            }}
            className="p-2.5 rounded-full bg-[#F4F1EA] hover:bg-[#ECE7DB] text-[#5D594E] hover:text-[#161511] border border-[rgba(22,21,17,0.14)] transition-colors cursor-pointer"
            title={lang === 'uz' ? 'Boshiga qaytarish' : 'С начала'}
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          {/* Volume Control */}
          <div className="flex items-center gap-2 bg-[#F4F1EA] px-3 py-2 rounded-full border border-[rgba(22,21,17,0.14)]">
            <button
              type="button"
              onClick={() => {
                if (audioRef.current) {
                  const nextMuted = !isMuted;
                  setIsMuted(nextMuted);
                  audioRef.current.muted = nextMuted;
                }
              }}
              className="text-[#5D594E] hover:text-[#161511] transition-colors cursor-pointer"
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="w-4 h-4 text-[#C4552D]" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={isMuted ? 0 : volume}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setVolume(val);
                setIsMuted(false);
                if (audioRef.current) {
                  audioRef.current.volume = val;
                  audioRef.current.muted = false;
                }
              }}
              className="w-16 sm:w-20 accent-[#0E7C86] h-1 bg-[#ECE7DB] rounded-lg cursor-pointer"
            />
          </div>
        </div>

        {/* Ambient Soundscape Live Controls */}
        <div className="flex flex-wrap items-center gap-2.5 bg-[#F4F1EA] px-3 py-1.5 rounded-full border border-[rgba(22,21,17,0.14)] text-xs">
          <div className="flex items-center gap-1.5 text-[#5D594E]">
            <Music className={`w-3.5 h-3.5 ${isPlaying && ambientEnabled && currentAmbient !== 'none' ? 'text-[#0E7C86] animate-spin' : 'text-[#0E7C86]'}`} />
            <span className="font-semibold text-[11px]">{lang === 'uz' ? 'Fon musiqasi:' : 'Фоновая музыка:'}</span>
          </div>

          {/* Soundscape Selector */}
          <select
            value={currentAmbient}
            onChange={(e) => handleSelectAmbient(e.target.value as AmbientSoundscape)}
            className="bg-white border border-[rgba(22,21,17,0.14)] text-[#161511] text-xs rounded-full px-2.5 py-1 font-medium focus:outline-none focus:border-[#0E7C86] cursor-pointer max-w-[170px] truncate"
          >
            {AMBIENT_SOUNDSCAPES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.icon} {lang === 'uz' ? s.labelUz : s.labelRu}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleToggleAmbient}
            className={`px-2.5 py-1 rounded-full font-semibold transition-all flex items-center gap-1 cursor-pointer text-xs ${
              ambientEnabled && currentAmbient !== 'none'
                ? 'bg-[#0E7C86] text-white shadow-2xs'
                : 'bg-white text-[#5D594E] hover:text-[#161511] border border-[rgba(22,21,17,0.1)]'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${ambientEnabled && currentAmbient !== 'none' ? 'bg-[#5CC8CF] animate-pulse' : 'bg-[#5D594E]/40'}`} />
            {ambientEnabled && currentAmbient !== 'none'
              ? (lang === 'uz' ? 'Yoqilgan' : 'Вкл')
              : (lang === 'uz' ? 'O\'chirilgan' : 'Выкл')}
          </button>

          {ambientEnabled && currentAmbient !== 'none' && (
            <div className="flex items-center gap-2 pl-2 border-l border-[rgba(22,21,17,0.14)]">
              <span className="text-[10px] text-[#5D594E] font-mono">{ambientVol}%</span>
              <input
                type="range"
                min="5"
                max="50"
                step="5"
                value={ambientVol}
                onChange={(e) => setAmbientVol(parseInt(e.target.value))}
                className="w-16 accent-[#0E7C86] h-1 bg-[#ECE7DB] rounded-lg cursor-pointer"
                title={lang === 'uz' ? 'Fon ovozi balandligi' : 'Громкость фона'}
              />
            </div>
          )}

          {isPlaying && ambientEnabled && currentAmbient !== 'none' && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#0E7C86]/10 border border-[#0E7C86]/30 text-[#0A5A62] flex items-center gap-1 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-[#0E7C86] animate-ping" />
              {lang === 'uz' ? 'Efirda yangramoqda' : 'Звучит в эфире'}
            </span>
          )}
        </div>
      </div>

      {/* Export & Download Section */}
      <div className="mt-5 pt-5 border-t border-[rgba(22,21,17,0.1)] bg-[#F4F1EA] -mx-5 -mb-5 sm:-mx-7 sm:-mb-7 p-5 sm:p-7 rounded-b-[24px]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <h4 className="text-xs font-mono uppercase tracking-[0.14em] text-[#0A5A62] font-semibold flex items-center gap-2">
              <FileAudio className="w-4 h-4 text-[#0E7C86]" />
              {lang === 'uz' ? '04 — Podkastni yuklab olish va eksport' : '04 — Экспорт и скачивание подкаста'}
            </h4>
            <p className="text-xs text-[#5D594E]">
              {lang === 'uz'
                ? 'Format (MP3, WAV), ovoz sifati va fon musiqasi sozlamalarini tanlang'
                : 'Выберите формат (MP3, WAV), качество аудио и фоновую музыку'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {/* Format Selector */}
            <div className="flex items-center bg-white rounded-full p-1 border border-[rgba(22,21,17,0.14)] text-xs font-mono">
              <button
                type="button"
                onClick={() => setExportFormat('wav')}
                className={`px-3 py-1 rounded-full font-bold transition-all cursor-pointer ${
                  exportFormat === 'wav'
                    ? 'bg-[#161511] text-[#F4F1EA] shadow-2xs'
                    : 'text-[#5D594E] hover:text-[#161511]'
                }`}
              >
                WAV (Studio)
              </button>
              <button
                type="button"
                onClick={() => setExportFormat('mp3')}
                className={`px-3 py-1 rounded-full font-bold transition-all cursor-pointer ${
                  exportFormat === 'mp3'
                    ? 'bg-[#161511] text-[#F4F1EA] shadow-2xs'
                    : 'text-[#5D594E] hover:text-[#161511]'
                }`}
              >
                MP3
              </button>
            </div>

            {/* Quality Selector */}
            <select
              value={exportQuality}
              onChange={(e: any) => setExportQuality(e.target.value)}
              className="bg-white border border-[rgba(22,21,17,0.14)] text-xs text-[#161511] rounded-full px-3 py-1.5 font-medium focus:outline-none focus:border-[#0E7C86]"
            >
              <option value="lossless">
                {lang === 'uz' ? 'Lossless (24kHz Studio Master)' : 'Lossless (24kHz Studio)'}
              </option>
              <option value="320k">320 kbps (Ultra HQ)</option>
              <option value="192k">192 kbps (Standard HQ)</option>
              <option value="128k">128 kbps (Ixcham / Compact)</option>
            </select>

            {/* Include Ambient Checkbox */}
            <label className="flex items-center gap-1.5 text-xs text-[#161511] cursor-pointer bg-white px-3 py-1.5 rounded-full border border-[rgba(22,21,17,0.14)]">
              <input
                type="checkbox"
                checked={includeAmbientInExport && ambientEnabled && currentAmbient !== 'none'}
                disabled={!ambientEnabled || currentAmbient === 'none'}
                onChange={(e) => setIncludeAmbientInExport(e.target.checked)}
                className="accent-[#0E7C86] rounded"
              />
              <span>{lang === 'uz' ? 'Musiqa bilan' : 'С музыкой'}</span>
            </label>

            {/* Save to CMS Button */}
            {onSaveToCMS && (
              <button
                type="button"
                onClick={() => {
                  onSaveToCMS();
                  setIsSavedToCMS(true);
                  setTimeout(() => setIsSavedToCMS(false), 3000);
                }}
                className="btn-pill btn-ghost text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                {isSavedToCMS ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-[#0E7C86]" />
                    <span className="text-[#0A5A62]">{lang === 'uz' ? 'Saqlandi!' : 'Сохранено!'}</span>
                  </>
                ) : (
                  <>
                    <Save className="w-3.5 h-3.5 text-[#0E7C86]" />
                    <span>{lang === 'uz' ? 'CMS\'ga Saqlash' : 'Сохранить в CMS'}</span>
                  </>
                )}
              </button>
            )}

            {/* Download Button */}
            <button
              type="button"
              onClick={handleExport}
              disabled={isExporting}
              className="btn-pill btn-solid text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
            >
              {isExporting ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>{lang === 'uz' ? 'Eksport qilinmoqda...' : 'Экспорт...'}</span>
                </>
              ) : exportSuccess ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#5CC8CF]" />
                  <span>{lang === 'uz' ? 'Yuklandi!' : 'Скачано!'}</span>
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5" />
                  <span>
                    {lang === 'uz'
                      ? `Yuklab olish (${exportFormat.toUpperCase()})`
                      : `Скачать (${exportFormat.toUpperCase()})`}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
