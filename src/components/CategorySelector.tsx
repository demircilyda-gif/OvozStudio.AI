import React from 'react';
import {
  Landmark,
  Laugh,
  Cpu,
  HeartHandshake,
  Search,
  TrendingUp,
  Sparkles,
  Layers,
  Check,
  ChevronRight
} from 'lucide-react';
import { PodcastCategory } from '../types/podcast';
import { PODCAST_CATEGORIES } from '../data/categories';

interface CategorySelectorProps {
  selectedCategoryId: string;
  onSelectCategory: (category: PodcastCategory) => void;
  lang: 'uz' | 'ru';
}

export const CategorySelector: React.FC<CategorySelectorProps> = ({
  selectedCategoryId,
  onSelectCategory,
  lang,
}) => {
  const getIcon = (iconName: string) => {
    switch (iconName) {
      case 'Landmark':
        return <Landmark className="w-5 h-5 text-amber-400" />;
      case 'Laugh':
        return <Laugh className="w-5 h-5 text-emerald-400" />;
      case 'Cpu':
        return <Cpu className="w-5 h-5 text-blue-400" />;
      case 'HeartHandshake':
        return <HeartHandshake className="w-5 h-5 text-rose-400" />;
      case 'Search':
        return <Search className="w-5 h-5 text-purple-400" />;
      case 'TrendingUp':
        return <TrendingUp className="w-5 h-5 text-cyan-400" />;
      default:
        return <Sparkles className="w-5 h-5 text-violet-400" />;
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
          <Layers className="w-3.5 h-3.5 text-cyan-400" />
          {lang === 'uz' ? '1. Podkast Toifasini (Kategoriyasini) Tanlang' : '1. Выберите Категорию Подкаста'}
        </label>
        <span className="text-[11px] text-zinc-500">
          {lang === 'uz' ? 'Tarixiy, komedik va boshqalar' : 'Исторические, комедийные и др.'}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3">
        {PODCAST_CATEGORIES.map((cat) => {
          const isSelected = cat.id === selectedCategoryId;
          return (
            <button
              key={cat.id}
              onClick={() => onSelectCategory(cat)}
              className={`p-3.5 rounded-2xl border text-left flex flex-col justify-between transition-all hover:scale-[1.02] ${
                isSelected
                  ? 'bg-zinc-900 border-cyan-500 ring-2 ring-cyan-500/20 shadow-lg shadow-cyan-500/10'
                  : 'bg-zinc-950/80 border-zinc-800/80 hover:border-zinc-700 hover:bg-zinc-900/60'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className={`p-2 rounded-xl ${cat.colorTheme.bg} border ${cat.colorTheme.border}`}>
                    {getIcon(cat.iconName)}
                  </div>
                  {isSelected && (
                    <div className="w-5 h-5 rounded-full bg-cyan-500 flex items-center justify-center text-zinc-950">
                      <Check className="w-3 h-3 stroke-[3]" />
                    </div>
                  )}
                </div>

                <h4 className="font-bold text-white text-xs sm:text-sm">
                  {lang === 'uz' ? cat.nameUz : cat.nameRu}
                </h4>
                <p className="text-[10px] text-zinc-400 mt-1 line-clamp-2 leading-relaxed">
                  {cat.taglineUz}
                </p>
              </div>

              <div className="mt-2.5 pt-2 border-t border-zinc-800/60 flex items-center justify-between text-[10px] text-zinc-500">
                <span>{cat.suggestedVoice} ({cat.suggestedTempo})</span>
                <ChevronRight className="w-3 h-3 text-zinc-600" />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
