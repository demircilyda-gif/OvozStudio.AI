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
          gradient.addColorStop(0, '#06b6d4'); // cyan-500
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
    <div className="bg-gradient-to-b from-zinc-900/90 to-zinc-950 border border-zinc-800 rounded-3xl p-5 sm:p-7 shadow-2xl backdrop-blur-xl">
      {/* Hidden audio element */}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="metadata"
        />
      )}

      {/* Header Info */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-5 border-b border-zinc-800/80">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 flex items-center gap-1">
              <Radio className="w-3 h-3 text-cyan-400 animate-pulse" />
              {lang === 'uz' ? 'Tinglashga tayyor' : 'Готово к прослушиванию'}
            </span>
            <span className="text-xs text-zinc-500">•</span>
            <span className="text-xs text-zinc-400 font-medium">{category}</span>
          </div>
          <h3 className="text-lg sm:text-xl font-bold text-white mt-1">
            {title}
          </h3>
          <p className="text-xs text-zinc-400 mt-0.5 flex items-center gap-1.5">
            <Disc className="w-3.5 h-3.5 text-cyan-400" />
            <span>{lang === 'uz' ? 'Ovoz:' : 'Голос:'} <strong className="text-zinc-200">{voiceName}</strong></span>
            <span>•</span>
            <span>Gemini 3.8 TTS Live 24kHz Studio Master</span>
          </p>
        </div>

        {/* Playback speed buttons */}
        <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-xl border border-zinc-800 self-start sm:self-center">
          {[0.8, 1.0, 1.25, 1.5].map((rate) => (
            <button
              key={rate}
              onClick={() => changeSpeed(rate)}
              className={`px-2 py-0.5 rounded-lg text-xs font-semibold transition-all ${
                playbackRate === rate
                  ? 'bg-cyan-500 text-zinc-950 shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              {rate}x
            </button>
          ))}
        </div>
      </div>

      {/* Interactive Waveform Canvas */}
      <div className="mt-5">
        <div
          onClick={handleSeek}
          className="relative h-20 w-full bg-zinc-950 rounded-2xl border border-zinc-800/80 cursor-pointer overflow-hidden group hover:border-cyan-500/40 transition-colors"
        >
          <canvas
            ref={canvasRef}
            width={720}
            height={80}
            className="w-full h-full block"
          />

          {/* Time scrubber tooltip / bar */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-cyan-400 shadow-md shadow-cyan-400/50 pointer-events-none transition-all"
            style={{
              left: `${totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0}%`,
            }}
          />
        </div>

        {/* Time labels */}
        <div className="flex items-center justify-between text-xs font-mono text-zinc-400 mt-2 px-1">
          <span>{formatTime(currentTime)}</span>
          <span className="text-zinc-600">/</span>
          <span>{formatTime(totalDuration)}</span>
        </div>
      </div>

      {/* Sound Director & Interactive Cue Timeline Track */}
      <div className="mt-4 p-4 rounded-2xl bg-zinc-950/80 border border-purple-500/25 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <span className="p-1 rounded-lg bg-purple-500/20 text-purple-300 border border-purple-500/30">
              <Sliders className="w-3.5 h-3.5" />
            </span>
            <div>
              <h4 className="text-xs sm:text-sm font-bold text-white flex items-center gap-1.5">
                {lang === 'uz' ? 'Ovoz Rejissyori: Dinamik Saund-Dizayn & Sukunat' : 'Звукорежиссура: Динамический саунд и тишина'}
              </h4>
              <p className="text-[11px] text-zinc-400">
                {lang === 'uz'
                  ? 'Bitta zerikarli uzluksiz fondan voz kechilgan: kirishda jingle, asosiy nutqda toza ovoz (silence), kerakli nuqtada mayin fon.'
                  : 'Без монотонного длинного пианино: интро-джингл, кристально чистый голос без музыки в середине, акцент и аутро.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            {/* Mode switch */}
            <div className="flex items-center bg-zinc-900 p-0.5 rounded-lg border border-zinc-800 text-[11px]">
              <button
                type="button"
                onClick={() => setSoundDirectorMode(true)}
                className={`px-2 py-1 rounded font-semibold transition-all cursor-pointer ${
                  soundDirectorMode
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {lang === 'uz' ? 'Dinamik Rejissura' : 'Динамика'}
              </button>
              <button
                type="button"
                onClick={() => setSoundDirectorMode(false)}
                className={`px-2 py-1 rounded font-semibold transition-all cursor-pointer ${
                  !soundDirectorMode
                    ? 'bg-zinc-800 text-zinc-200'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {lang === 'uz' ? 'Statik Loop' : 'Статично'}
              </button>
            </div>

            {/* AI Auto-plan button */}
            <button
              type="button"
              onClick={handleRunSoundDirector}
              disabled={isPlanningDirector}
              className="px-3 py-1 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
            >
              <Sparkles className={`w-3 h-3 ${isPlanningDirector ? 'animate-spin' : ''}`} />
              <span>{isPlanningDirector ? (lang === 'uz' ? 'Reja tuzilmoqda...' : 'Анализ...') : (lang === 'uz' ? 'AI Taklif' : 'AI План')}</span>
            </button>
          </div>
        </div>

        {directorStrategy && (
          <div className="p-2 rounded-xl bg-purple-950/30 border border-purple-500/20 text-[11px] text-purple-200 flex items-start gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-purple-400 shrink-0 mt-0.5" />
            <p>
              <strong>{lang === 'uz' ? 'Strategiya:' : 'Стратегия:'}</strong>{' '}
              {lang === 'uz' ? directorStrategy.strategyUz : directorStrategy.strategyRu}
            </p>
          </div>
        )}

        {/* Visual Cue Track blocks */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-zinc-400 px-0.5">
            <span>{lang === 'uz' ? 'Musiqa va Sukunat xaritasi (bosib o\'zgartiring):' : 'Карта музыки и тишины (нажмите для переключения):'}</span>
            <span className="text-[10px] text-zinc-500">
              {lang === 'uz' ? '🔇 Bosganda toza ovoz / musiqa almashadi' : '🔇 Клик переключает звук/тишину'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
            {cues.map((cue, idx) => {
              const isActive = currentTime >= (cue.startTime ?? 0) && currentTime < (cue.endTime ?? totalDuration);
              const isSilence = cue.cueType === 'silence' || cue.soundscape === 'none' || cue.volumePercent <= 0;

              return (
                <div
                  key={cue.id || idx}
                  className={`p-2 rounded-xl border transition-all text-xs flex flex-col justify-between ${
                    isActive
                      ? 'border-yellow-400 bg-yellow-950/20 shadow-md shadow-yellow-500/10 ring-1 ring-yellow-400/50'
                      : isSilence
                      ? 'bg-zinc-900/60 border-zinc-800'
                      : cue.cueType === 'intro'
                      ? 'bg-purple-950/30 border-purple-500/30'
                      : cue.cueType === 'stinger'
                      ? 'bg-emerald-950/30 border-emerald-500/30'
                      : cue.cueType === 'emotional'
                      ? 'bg-cyan-950/30 border-cyan-500/30'
                      : 'bg-rose-950/30 border-rose-500/30'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="font-mono text-[10px] text-zinc-400">
                      {formatTime(cue.startTime ?? 0)} - {formatTime(cue.endTime ?? totalDuration)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleToggleCueSilence(cue.id)}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-colors ${
                        isSilence
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          : 'bg-zinc-800 text-zinc-300 hover:text-white'
                      }`}
                      title={isSilence ? 'Musiqani yoqish' : 'Sukunat (toza ovoz) qilish'}
                    >
                      {isSilence ? '🔇 Sukunat' : '🎵 Musiqa'}
                    </button>
                  </div>

                  <div className="my-1">
                    <div className="font-bold text-zinc-200 flex items-center gap-1 text-[11px] truncate">
                      {isSilence ? (
                        <span className="text-zinc-400">Toza ovoz (Silence)</span>
                      ) : (
                        <span>{lang === 'uz' ? cue.labelUz : cue.labelRu}</span>
                      )}
                    </div>
                    {cue.reasoning && (
                      <p className="text-[10px] text-zinc-500 line-clamp-2 mt-0.5 leading-tight" title={cue.reasoning}>
                        {cue.reasoning}
                      </p>
                    )}
                  </div>

                  {!isSilence && (
                    <div className="mt-1 pt-1 border-t border-zinc-800/60 flex items-center justify-between text-[10px]">
                      <select
                        value={cue.soundscape}
                        onChange={(e) => handleUpdateCueSound(cue.id, e.target.value as AmbientSoundscape)}
                        className="bg-zinc-950 border border-zinc-800 text-zinc-300 rounded px-1.5 py-0.5 text-[10px] max-w-[110px] truncate cursor-pointer"
                      >
                        {AMBIENT_SOUNDSCAPES.filter((s) => s.id !== 'none').map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.icon} {lang === 'uz' ? s.labelUz : s.labelRu}
                          </option>
                        ))}
                      </select>
                      <span className="font-mono text-zinc-400">{cue.volumePercent}%</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Transport Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 mt-4 pt-4 border-t border-zinc-800/70">
        <div className="flex items-center gap-3">
          {/* Main Play/Pause Button */}
          <button
            onClick={togglePlay}
            className="w-14 h-14 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-zinc-950 font-bold flex items-center justify-center shadow-lg shadow-cyan-500/25 transition-all hover:scale-105 active:scale-95"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <Pause className="w-6 h-6 fill-current text-zinc-950" />
            ) : (
              <Play className="w-6 h-6 fill-current text-zinc-950 translate-x-0.5" />
            )}
          </button>

          {/* Restart */}
          <button
            onClick={() => {
              if (audioRef.current) {
                audioRef.current.currentTime = 0;
                setCurrentTime(0);
              }
            }}
            className="p-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-800 transition-colors"
            title={lang === 'uz' ? 'Boshiga qaytarish' : 'С начала'}
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          {/* Volume Control */}
          <div className="flex items-center gap-2 bg-zinc-950 px-3 py-2 rounded-xl border border-zinc-800">
            <button
              onClick={() => {
                if (audioRef.current) {
                  const nextMuted = !isMuted;
                  setIsMuted(nextMuted);
                  audioRef.current.muted = nextMuted;
                }
              }}
              className="text-zinc-400 hover:text-white transition-colors"
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="w-4 h-4 text-rose-400" />
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
              className="w-16 sm:w-20 accent-cyan-400 h-1 bg-zinc-800 rounded-lg cursor-pointer"
            />
          </div>
        </div>

        {/* Ambient Soundscape Live Controls */}
        <div className="flex flex-wrap items-center gap-2.5 bg-zinc-950/90 px-3 py-2 rounded-xl border border-zinc-800 text-xs">
          <div className="flex items-center gap-1.5 text-zinc-300">
            <Music className={`w-3.5 h-3.5 ${isPlaying && ambientEnabled && currentAmbient !== 'none' ? 'text-purple-400 animate-spin' : 'text-purple-400'}`} />
            <span className="font-semibold">{lang === 'uz' ? 'Fon musiqasi:' : 'Фоновая музыка:'}</span>
          </div>

          {/* Soundscape Selector */}
          <select
            value={currentAmbient}
            onChange={(e) => handleSelectAmbient(e.target.value as AmbientSoundscape)}
            className="bg-zinc-900 border border-zinc-700/80 text-zinc-200 text-xs rounded-lg px-2.5 py-1 font-medium focus:outline-none focus:border-purple-500 cursor-pointer max-w-[170px] truncate"
          >
            {AMBIENT_SOUNDSCAPES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.icon} {lang === 'uz' ? s.labelUz : s.labelRu}
              </option>
            ))}
          </select>

          <button
            onClick={handleToggleAmbient}
            className={`px-2.5 py-1 rounded-lg font-semibold transition-all flex items-center gap-1 cursor-pointer ${
              ambientEnabled && currentAmbient !== 'none'
                ? 'bg-purple-500/25 text-purple-300 border border-purple-500/40 shadow-sm shadow-purple-500/20'
                : 'bg-zinc-800/80 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${ambientEnabled && currentAmbient !== 'none' ? 'bg-purple-400 animate-pulse' : 'bg-zinc-600'}`} />
            {ambientEnabled && currentAmbient !== 'none'
              ? (lang === 'uz' ? 'Yoqilgan' : 'Вкл')
              : (lang === 'uz' ? 'O\'chirilgan' : 'Выкл')}
          </button>

          {ambientEnabled && currentAmbient !== 'none' && (
            <div className="flex items-center gap-2 pl-2 border-l border-zinc-800">
              <span className="text-[10px] text-zinc-400 font-mono">{ambientVol}%</span>
              <input
                type="range"
                min="5"
                max="50"
                step="5"
                value={ambientVol}
                onChange={(e) => setAmbientVol(parseInt(e.target.value))}
                className="w-16 accent-purple-400 h-1 bg-zinc-800 rounded-lg cursor-pointer"
                title={lang === 'uz' ? 'Fon ovozi balandligi' : 'Громкость фона'}
              />
            </div>
          )}

          {isPlaying && ambientEnabled && currentAmbient !== 'none' && (
            <span className="text-[10px] px-2 py-0.5 rounded-md bg-purple-950/60 border border-purple-500/30 text-purple-300 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              {lang === 'uz' ? 'Efirda yangramoqda' : 'Звучит в эфире'}
            </span>
          )}
        </div>
      </div>

      {/* Export & Download Section (Requested: popular audio formats MP3, WAV with quality selection) */}
      <div className="mt-6 pt-5 border-t border-zinc-800/80 bg-zinc-950/60 -mx-5 -mb-5 sm:-mx-7 sm:-mb-7 p-5 sm:p-7 rounded-b-3xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              <FileAudio className="w-4 h-4 text-cyan-400" />
              {lang === 'uz' ? 'Podkastni yuklab olish va eksport qilish' : 'Экспорт и скачивание подкаста'}
            </h4>
            <p className="text-xs text-zinc-400">
              {lang === 'uz'
                ? 'Format (MP3, WAV), ovoz sifati va fon musiqasi sozlamalarini tanlang'
                : 'Выберите формат (MP3, WAV), качество аудио и фоновую музыку'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {/* Format Selector */}
            <div className="flex items-center bg-zinc-900 rounded-xl p-1 border border-zinc-800 text-xs">
              <button
                onClick={() => setExportFormat('wav')}
                className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                  exportFormat === 'wav'
                    ? 'bg-cyan-500 text-zinc-950 shadow-sm'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                WAV (Studio)
              </button>
              <button
                onClick={() => setExportFormat('mp3')}
                className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                  exportFormat === 'mp3'
                    ? 'bg-cyan-500 text-zinc-950 shadow-sm'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                MP3
              </button>
            </div>

            {/* Quality Selector */}
            <select
              value={exportQuality}
              onChange={(e: any) => setExportQuality(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 text-xs text-zinc-200 rounded-xl px-3 py-2 font-medium focus:outline-none focus:border-cyan-500"
            >
              <option value="lossless">
                {lang === 'uz' ? 'Lossless (24kHz Studio Master)' : 'Lossless (24kHz Studio)'}
              </option>
              <option value="320k">320 kbps (Ultra HQ)</option>
              <option value="192k">192 kbps (Standard HQ)</option>
              <option value="128k">128 kbps (Ixcham / Compact)</option>
            </select>

            {/* Include Ambient Checkbox */}
            <label className="flex items-center gap-1.5 text-xs text-zinc-300 cursor-pointer bg-zinc-900 px-3 py-2 rounded-xl border border-zinc-800 hover:border-zinc-700">
              <input
                type="checkbox"
                checked={includeAmbientInExport && ambientEnabled && currentAmbient !== 'none'}
                disabled={!ambientEnabled || currentAmbient === 'none'}
                onChange={(e) => setIncludeAmbientInExport(e.target.checked)}
                className="accent-cyan-400 rounded"
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
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs sm:text-sm bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-700 transition-all hover:scale-105 active:scale-95 cursor-pointer shadow-md"
              >
                {isSavedToCMS ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span className="text-emerald-300">{lang === 'uz' ? 'Kutubxonaga Saqlandi!' : 'Сохранено!'}</span>
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 text-cyan-400" />
                    <span>{lang === 'uz' ? 'CMS\'ga Saqlash' : 'Сохранить в CMS'}</span>
                  </>
                )}
              </button>
            )}

            {/* Download Button */}
            <button
              onClick={handleExport}
              disabled={isExporting}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all shadow-lg ${
                exportSuccess
                  ? 'bg-emerald-500 text-zinc-950 shadow-emerald-500/20'
                  : 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-zinc-950 shadow-cyan-500/20 active:scale-95'
              }`}
            >
              {isExporting ? (
                <>
                  <div className="w-4 h-4 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin" />
                  <span>{lang === 'uz' ? 'Tayyorlanmoqda...' : 'Экспорт...'}</span>
                </>
              ) : exportSuccess ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>{lang === 'uz' ? 'Yuklab olindi!' : 'Скачано!'}</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
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
