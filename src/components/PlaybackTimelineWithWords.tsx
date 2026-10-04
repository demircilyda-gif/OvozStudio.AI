import React, { useRef, useState, useEffect } from 'react';
import {
  Play,
  Pause,
  Download,
  RotateCcw,
  Volume2,
  VolumeX,
  BookmarkCheck,
  Disc,
} from 'lucide-react';
import { exportAudioWithQuality, base64ToArrayBuffer } from '../utils/audioUtils';

interface ChapterPoint {
  id: string;
  timeSec: number;
  title: string;
}

interface PlaybackTimelineWithWordsProps {
  rawAudioWavBase64: string;
  title: string;
  voiceName: string;
  scriptText: string;
  durationSeconds: number;
  onSaveToCMS?: () => void;
  lang: 'uz' | 'ru';
}

export const PlaybackTimelineWithWords: React.FC<PlaybackTimelineWithWordsProps> = ({
  rawAudioWavBase64,
  title,
  voiceName,
  scriptText,
  durationSeconds,
  onSaveToCMS,
  lang,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(durationSeconds || 1);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string>('');
  const [isSaved, setIsSaved] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Parse words from script for real-time word highlighting
  const words = React.useMemo(() => {
    return scriptText.trim().split(/\s+/).filter(Boolean);
  }, [scriptText]);

  // Determine current active word index based on playback progress
  const activeWordIndex = Math.min(
    words.length - 1,
    Math.floor((currentTime / Math.max(0.1, totalDuration)) * words.length)
  );

  // Extract chapters or auto-generate 3-4 landmark chapters
  const chapters: ChapterPoint[] = React.useMemo(() => {
    const list: ChapterPoint[] = [];
    const dur = totalDuration || 60;
    list.push({ id: 'c1', timeSec: 0, title: lang === 'uz' ? 'Kirish' : 'Интро' });
    if (dur >= 30) {
      list.push({ id: 'c2', timeSec: Math.round(dur * 0.35), title: lang === 'uz' ? 'Asosiy tahlil' : 'Основная часть' });
    }
    if (dur >= 60) {
      list.push({ id: 'c3', timeSec: Math.round(dur * 0.75), title: lang === 'uz' ? 'Xulosalar' : 'Выводы' });
    }
    return list;
  }, [totalDuration, lang]);

  // Load audio data
  useEffect(() => {
    if (!rawAudioWavBase64) return;
    try {
      const buffer = base64ToArrayBuffer(rawAudioWavBase64);
      const blob = new Blob([buffer], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);

      const aud = new Audio(url);
      aud.onloadedmetadata = () => {
        if (aud.duration && !isNaN(aud.duration) && isFinite(aud.duration)) {
          setTotalDuration(aud.duration);
        }
      };

      return () => {
        URL.revokeObjectURL(url);
      };
    } catch {
      // Audio load error ignored
    }
  }, [rawAudioWavBase64]);

  // Audio update time loop
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
    };
  }, []);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || totalDuration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    const newTime = ratio * totalDuration;
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const jumpToChapter = (timeSec: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = timeSec;
    setCurrentTime(timeSec);
  };

  const formatMinSec = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const handleDownload = async (format: 'wav' | 'mp3') => {
    try {
      const buffer = base64ToArrayBuffer(rawAudioWavBase64);
      const blob = new Blob([buffer], { type: 'audio/wav' });
      await exportAudioWithQuality(blob, format, '320k', title || voiceName);
    } catch {
      // Download error ignored
    }
  };

  const progressPercent = totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0;

  return (
    <div className="border border-[rgba(22,21,17,0.14)] rounded-[20px] bg-white p-5 space-y-4 shadow-sm select-none">
      {audioUrl && <audio ref={audioRef} src={audioUrl} preload="auto" />}

      {/* Header Info */}
      <div className="flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 truncate">
          <Disc className="w-4 h-4 text-[#0E7C86] shrink-0 animate-spin" style={{ animationDuration: isPlaying ? '3s' : '0s' }} />
          <span className="font-semibold text-[#161511] truncate">{title || 'Oʻzbekcha Podkast'}</span>
          <span className="text-[#5D594E]">·</span>
          <span className="text-[#5D594E] font-mono text-[11px] shrink-0 uppercase tracking-wider">{voiceName}</span>
        </div>

        {/* Playback Speed Segmented Buttons */}
        <div className="flex items-center bg-[#ECE7DB] rounded-full p-0.5 font-mono text-[11px] shrink-0">
          {[0.8, 1.0, 1.25, 1.5].map((rate) => (
            <button
              key={rate}
              onClick={() => {
                setPlaybackRate(rate);
                if (audioRef.current) audioRef.current.playbackRate = rate;
              }}
              className={`px-2 py-0.5 rounded-full transition-colors cursor-pointer ${
                playbackRate === rate
                  ? 'bg-[#161511] text-[#F4F1EA] font-semibold'
                  : 'text-[#5D594E] hover:text-[#161511]'
              }`}
            >
              {rate}x
            </button>
          ))}
        </div>
      </div>

      {/* Timeline Scrubber with Chapters */}
      <div className="space-y-1.5">
        <div
          onClick={handleSeek}
          className="relative w-full h-2.5 rounded-full bg-[#ECE7DB] cursor-pointer overflow-hidden group"
        >
          {/* Progress fill */}
          <div
            className="h-full bg-[#0E7C86] rounded-full transition-all duration-75"
            style={{ width: `${progressPercent}%` }}
          />

          {/* Chapter markers */}
          {chapters.map((ch) => {
            const chPercent = (ch.timeSec / Math.max(1, totalDuration)) * 100;
            return (
              <div
                key={ch.id}
                title={ch.title}
                className="absolute top-0 bottom-0 w-0.5 bg-white/90 pointer-events-none"
                style={{ left: `${chPercent}%` }}
              />
            );
          })}
        </div>

        {/* Time Readout & Chapter Chips */}
        <div className="flex items-center justify-between text-xs font-mono text-[#5D594E]">
          <span>{formatMinSec(currentTime)}</span>
          <div className="flex items-center gap-2">
            {chapters.map((ch) => (
              <button
                key={ch.id}
                type="button"
                onClick={() => jumpToChapter(ch.timeSec)}
                className="text-[10px] text-[#5D594E] hover:text-[#0E7C86] transition-colors cursor-pointer"
              >
                {ch.title}
              </button>
            ))}
          </div>
          <span>{formatMinSec(totalDuration)}</span>
        </div>
      </div>

      {/* Word-Level Highlight Window (Live Speech Sync) */}
      {words.length > 0 && (
        <div className="p-4 rounded-xl bg-[#F4F1EA] border border-[rgba(22,21,17,0.1)] max-h-24 overflow-y-auto no-scrollbar text-xs leading-relaxed text-[#5D594E] font-mono">
          <div className="flex flex-wrap gap-x-1.5 gap-y-1">
            {words.map((w, idx) => {
              const isActive = idx === activeWordIndex && isPlaying;
              const isPast = idx < activeWordIndex;
              return (
                <span
                  key={idx}
                  className={`transition-colors rounded px-1 ${
                    isActive
                      ? 'bg-[#0E7C86] text-white font-semibold'
                      : isPast
                      ? 'text-[#161511]'
                      : 'text-[#5D594E]/70'
                  }`}
                >
                  {w}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Controls & Export Bar */}
      <div className="flex items-center justify-between gap-3 pt-2">
        <div className="flex items-center gap-2">
          {/* Main Play/Pause Button */}
          <button
            type="button"
            onClick={togglePlay}
            className="w-10 h-10 rounded-full bg-[#161511] text-[#F4F1EA] hover:bg-[#0A5A62] flex items-center justify-center font-bold transition-all cursor-pointer shadow-sm active:scale-95"
          >
            {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current translate-x-0.5" />}
          </button>

          {/* Reset button */}
          <button
            type="button"
            onClick={() => {
              if (audioRef.current) {
                audioRef.current.currentTime = 0;
                setCurrentTime(0);
              }
            }}
            className="p-2 rounded-full border border-[rgba(22,21,17,0.14)] text-[#5D594E] hover:text-[#161511] hover:border-[#161511] transition-colors cursor-pointer"
            title={lang === 'uz' ? 'Boshiga qaytarish' : 'В начало'}
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          {/* Volume Mute toggle */}
          <button
            type="button"
            onClick={() => {
              if (audioRef.current) {
                const nextMuted = !isMuted;
                setIsMuted(nextMuted);
                audioRef.current.muted = nextMuted;
              }
            }}
            className="p-2 rounded-full border border-[rgba(22,21,17,0.14)] text-[#5D594E] hover:text-[#161511] hover:border-[#161511] transition-colors cursor-pointer"
          >
            {isMuted ? <VolumeX className="w-3.5 h-3.5 text-rose-500" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Download & Save Buttons */}
        <div className="flex items-center gap-2">
          {onSaveToCMS && (
            <button
              type="button"
              onClick={() => {
                onSaveToCMS();
                setIsSaved(true);
                setTimeout(() => setIsSaved(false), 3000);
              }}
              className="btn-pill btn-ghost text-xs py-1.5 px-3 flex items-center gap-1.5"
            >
              <BookmarkCheck className={`w-3.5 h-3.5 ${isSaved ? 'text-[#0E7C86]' : ''}`} />
              <span>{isSaved ? (lang === 'uz' ? 'Saqlandi' : 'Сохранено') : (lang === 'uz' ? 'Kutubxonaga' : 'В медиатеку')}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => handleDownload('wav')}
            className="btn-pill btn-solid text-xs py-1.5 px-3 flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            <span>WAV</span>
          </button>

          <button
            type="button"
            onClick={() => handleDownload('mp3')}
            className="btn-pill btn-ghost text-xs py-1.5 px-3 flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            <span>MP3</span>
          </button>
        </div>
      </div>
    </div>
  );
};
