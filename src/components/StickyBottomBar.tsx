import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Play, Lock } from 'lucide-react';
import { VoiceProfile } from '../types/podcast';

interface StickyBottomBarProps {
  activeVoice: VoiceProfile;
  tempo: number;
  timbreValue: number;
  wordCount: number;
  estimatedSeconds: number;
  isSynthesizing: boolean;
  onSynthesize: () => void;
  canSynthesize: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  lang: 'uz' | 'ru';
}

export const StickyBottomBar: React.FC<StickyBottomBarProps> = ({
  activeVoice,
  tempo,
  timbreValue,
  wordCount,
  estimatedSeconds,
  isSynthesizing,
  onSynthesize,
  canSynthesize,
  isAuthenticated,
  isAdmin,
  lang,
}) => {
  const [selectedFormat, setSelectedFormat] = useState<'mp3' | 'wav' | 'srt'>('wav');

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const estimatedCredits = isAdmin ? 0 : Math.max(1, Math.ceil(estimatedSeconds / 180));

  return (
    <div className="sticky bottom-0 left-0 right-0 z-40 bg-[#F4F1EA]/95 backdrop-blur-md border-t border-[rgba(22,21,17,0.14)] px-4 sm:px-8 py-3 select-none shadow-[0_-10px_25px_-5px_rgba(22,21,17,0.06)]">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 flex-wrap">
        {/* Left: Chapter Timeline Chips in Mono */}
        <div className="hidden md:flex items-center gap-2 overflow-x-auto no-scrollbar">
          <span className="h-8 rounded-lg bg-[#0E7C86] text-white border border-[#0E7C86] px-3 font-mono text-[10px] uppercase tracking-wider flex items-center font-medium shadow-xs">
            [KIRISH] 00:00
          </span>
          <span className="h-8 rounded-lg bg-[rgba(14,124,134,0.10)] border border-[rgba(14,124,134,0.25)] text-[#0A5A62] px-3 font-mono text-[10px] uppercase tracking-wider flex items-center font-medium">
            [BOB 1] {formatTime(Math.round(estimatedSeconds * 0.25))}
          </span>
          <span className="h-8 rounded-lg bg-[rgba(14,124,134,0.10)] border border-[rgba(14,124,134,0.25)] text-[#0A5A62] px-3 font-mono text-[10px] uppercase tracking-wider flex items-center font-medium">
            [KULMINATSIYA] {formatTime(Math.round(estimatedSeconds * 0.70))}
          </span>
          <span className="h-8 rounded-lg bg-[rgba(14,124,134,0.10)] border border-[rgba(14,124,134,0.25)] text-[#0A5A62] px-3 font-mono text-[10px] uppercase tracking-wider flex items-center font-medium">
            [XULOSA] ~{formatTime(estimatedSeconds)}
          </span>
        </div>

        {/* Mobile Voice Info */}
        <div className="flex md:hidden items-center gap-2 min-w-0">
          <span className="font-semibold text-xs text-[#161511] truncate">{activeVoice.name}</span>
          <span className="text-[10.5px] font-mono text-[#5D594E]">~{formatTime(estimatedSeconds)}</span>
        </div>

        {/* Right: Audio Format Selector + Large Teal CTA Button */}
        <div className="flex items-center gap-3 ml-auto">
          {/* Format Toggle Pill */}
          <div className="flex border border-[rgba(22,21,17,0.14)] rounded-full overflow-hidden text-[10.5px] font-mono">
            <button
              type="button"
              onClick={() => setSelectedFormat('wav')}
              className={`px-3 py-1.5 transition-colors cursor-pointer ${
                selectedFormat === 'wav' ? 'bg-[#161511] text-[#F4F1EA] font-semibold' : 'text-[#5D594E] hover:text-[#161511]'
              }`}
            >
              WAV 24k
            </button>
            <button
              type="button"
              onClick={() => setSelectedFormat('mp3')}
              className={`px-3 py-1.5 transition-colors cursor-pointer ${
                selectedFormat === 'mp3' ? 'bg-[#161511] text-[#F4F1EA] font-semibold' : 'text-[#5D594E] hover:text-[#161511]'
              }`}
            >
              MP3 320k
            </button>
            <button
              type="button"
              onClick={() => setSelectedFormat('srt')}
              className={`px-3 py-1.5 transition-colors cursor-pointer ${
                selectedFormat === 'srt' ? 'bg-[#161511] text-[#F4F1EA] font-semibold' : 'text-[#5D594E] hover:text-[#161511]'
              }`}
            >
              SRT
            </button>
          </div>

          {/* Large Teal CTA Button */}
          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onSynthesize}
            disabled={isSynthesizing || !canSynthesize}
            className={`btn-pill text-xs sm:text-sm font-semibold py-2.5 sm:py-3 px-5 sm:px-7 flex items-center justify-center gap-2 shadow-sm whitespace-nowrap cursor-pointer ${
              isSynthesizing || !canSynthesize
                ? 'bg-zinc-300 text-zinc-500 opacity-60 cursor-not-allowed'
                : 'btn-teal'
            }`}
          >
            {isSynthesizing ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>{lang === 'uz' ? 'Sintez jarayoni...' : 'Синтез...'}</span>
              </>
            ) : !isAuthenticated ? (
              <>
                <Lock className="w-4 h-4 text-white" />
                <span>{lang === 'uz' ? 'Kirish & Podkast yaratish' : 'Войти и Создать'}</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current text-white translate-x-0.5" />
                <span>{lang === 'uz' ? 'Podkast yaratish' : 'Создать подкаст'}</span>
                <span className="hidden md:inline font-mono text-[10px] opacity-80 pl-1">
                  ({isAdmin ? 'VIP' : `${estimatedCredits} kr.`})
                </span>
              </>
            )}
          </motion.button>
        </div>
      </div>
    </div>
  );
};
