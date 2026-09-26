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
} from 'lucide-react';
import {
  base64ToArrayBuffer,
  getAudioContext,
  mixAudioTracks,
  exportAudioWithQuality
} from '../utils/audioUtils';
import { AmbientSoundscape } from '../types/podcast';

interface AudioPreviewPlayerProps {
  rawAudioWavBase64: string;
  title: string;
  voiceName: string;
  category: string;
  ambientSound: AmbientSoundscape;
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
  
  // Ambient background mixer state (Default OFF for 100% clean pristine voice output without hum/noise)
  const [ambientEnabled, setAmbientEnabled] = useState(false);
  const [ambientVolume, setAmbientVolume] = useState(15); // gentle 15% if user turns it on

  // Export & Download settings
  const [exportFormat, setExportFormat] = useState<'wav' | 'mp3'>('wav');
  const [exportQuality, setExportQuality] = useState<'lossless' | '320k' | '192k' | '128k'>('lossless');
  const [includeAmbientInExport, setIncludeAmbientInExport] = useState(false);
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
      setIsPlaying(false);
    } else {
      audioRef.current.play().catch(console.error);
      setIsPlaying(true);
    }
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
      setCurrentTime(audio.currentTime);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [audioUrl, durationSeconds]);

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

      if (includeAmbientInExport && ambientEnabled && ambientSound !== 'none') {
        const { wavBlob } = await mixAudioTracks(
          rawBuffer,
          ambientSound,
          ambientVolume,
          100
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
        <div className="flex items-center gap-2.5 bg-zinc-950/80 px-3 py-2 rounded-xl border border-zinc-800/80 text-xs">
          <div className="flex items-center gap-1.5 text-zinc-300">
            <Music className="w-3.5 h-3.5 text-purple-400" />
            <span>{lang === 'uz' ? 'Fon musiqasi:' : 'Фоновая музыка:'}</span>
          </div>

          <button
            onClick={() => setAmbientEnabled(!ambientEnabled)}
            className={`px-2 py-0.5 rounded-md font-semibold transition-colors ${
              ambientEnabled
                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                : 'bg-zinc-800 text-zinc-400'
            }`}
          >
            {ambientEnabled ? (lang === 'uz' ? 'Yoqilgan' : 'Вкл') : (lang === 'uz' ? 'O\'chirilgan' : 'Выкл')}
          </button>

          {ambientEnabled && (
            <div className="flex items-center gap-1.5 pl-2 border-l border-zinc-800">
              <span className="text-[10px] text-zinc-400">{ambientVolume}%</span>
              <input
                type="range"
                min="5"
                max="50"
                step="5"
                value={ambientVolume}
                onChange={(e) => setAmbientVolume(parseInt(e.target.value))}
                className="w-14 accent-purple-400 h-1 bg-zinc-800 rounded-lg cursor-pointer"
                title={lang === 'uz' ? 'Fon ovozi balandligi' : 'Громкость фона'}
              />
            </div>
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
                checked={includeAmbientInExport && ambientEnabled}
                disabled={!ambientEnabled}
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
