import React from 'react';
import { Clock, Zap } from 'lucide-react';

interface LiveDurationCostScrubberProps {
  wordCount: number;
  tempo: number; // 0.75 - 1.35
  targetSeconds: number; // dynamically computed or adjusted
  onChangeTargetSeconds?: (sec: number) => void;
  isAdmin: boolean;
  lang: 'uz' | 'ru';
}

export const LiveDurationCostScrubber: React.FC<LiveDurationCostScrubberProps> = ({
  wordCount,
  tempo,
  targetSeconds,
  onChangeTargetSeconds,
  isAdmin,
  lang,
}) => {
  // Compute estimated cost: 1 credit per ~3 minutes (180s)
  const estimatedCredits = isAdmin ? 0 : Math.max(1, Math.ceil(targetSeconds / 180));

  const formatMinSec = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="space-y-2 select-none">
      <div className="flex items-center justify-between text-xs">
        <span className="text-zinc-300 font-semibold flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-[#FACC15]" />
          <span>{lang === 'uz' ? 'Davomiylik va Narx' : 'Длительность и Стоимость'}</span>
        </span>
        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="text-zinc-200 font-bold">{formatMinSec(targetSeconds)}</span>
          <span className="text-zinc-500">·</span>
          <span className="text-[#FACC15] font-semibold flex items-center gap-1">
            <Zap className="w-3 h-3 fill-current" />
            {isAdmin ? 'VIP' : `${estimatedCredits} ${lang === 'uz' ? 'kredit' : 'кред.'}`}
          </span>
        </div>
      </div>

      {/* Scrubber Track */}
      <div className="space-y-1">
        <input
          type="range"
          min="15"
          max="900" // up to 15 mins
          step="5"
          value={targetSeconds}
          onChange={(e) => onChangeTargetSeconds && onChangeTargetSeconds(parseInt(e.target.value, 10))}
          className="w-full h-2 rounded-lg bg-[#1E1E2C] accent-[#FACC15] cursor-pointer appearance-none"
        />

        <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400">
          <span>00:15</span>
          <span>
            {wordCount} {lang === 'uz' ? 'so\'z matn' : 'слов'}
          </span>
          <span>15:00</span>
        </div>
      </div>
    </div>
  );
};
