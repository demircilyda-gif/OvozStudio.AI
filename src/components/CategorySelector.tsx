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
  const [isExpanded, setIsExpanded] = React.useState(false);

  const getIcon = (iconName: string) => {
    switch (iconName) {
      case 'Landmark':
        return <Landmark className="w-4 h-4 text-amber-400" />;
      case 'Laugh':
        return <Laugh className="w-4 h-4 text-emerald-400" />;
      case 'Cpu':
        return <Cpu className="w-4 h-4 text-blue-400" />;
      case 'HeartHandshake':
        return <HeartHandshake className="w-4 h-4 text-rose-400" />;
      case 'Search':
        return <Search className="w-4 h-4 text-purple-400" />;
      case 'TrendingUp':
        return <TrendingUp className="w-4 h-4 text-cyan-400" />;
      default:
        return <Sparkles className="w-4 h-4 text-violet-400" />;
    }
  };

  const selectedCategory = PODCAST_CATEGORIES.find((c) => c.id === selectedCategoryId) || PODCAST_CATEGORIES[0];
  const quickCategories = PODCAST_CATEGORIES.slice(0, 5);

  return (
    <div className="space-y-3 bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-4">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
          <Layers className="w-4 h-4 text-cyan-400" />
          <span>{lang === 'uz' ? 'Podkast Toifasi (Mavzu Usuli)' : 'Тематика и Жанр Подкаста'}</span>
        </label>
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-xs text-cyan-400 hover:text-cyan-300 font-medium flex items-center gap-1 cursor-pointer transition-colors"
        >
          <span>{isExpanded ? (lang === 'uz' ? 'Ixcham ko\'rinish' : 'Свернуть') : (lang === 'uz' ? 'Barcha 16 toifani ko\'rish' : 'Все 16 жанров')}</span>
          <ChevronRight className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
        </button>
      </div>

      {/* Quick Category Chips */}
      {!isExpanded && (
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
          {quickCategories.map((cat) => {
            const isSelected = cat.id === selectedCategoryId;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => onSelectCategory(cat)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer border ${
                  isSelected
                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-sm shadow-cyan-500/10'
                    : 'bg-zinc-950/80 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
                }`}
              >
                {getIcon(cat.iconName)}
                <span>{lang === 'uz' ? cat.nameUz : cat.nameRu}</span>
                {isSelected && <Check className="w-3.5 h-3.5 text-cyan-400 stroke-[3]" />}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-semibold text-zinc-400 bg-zinc-950 border border-dashed border-zinc-800 hover:border-zinc-700 hover:text-zinc-200 whitespace-nowrap cursor-pointer"
          >
            <span>+11 {lang === 'uz' ? 'boshqa' : 'еще'}</span>
          </button>
        </div>
      )}

      {/* Expanded Grid of All 16 Categories */}
      {isExpanded && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 pt-2 animate-in fade-in duration-200">
          {PODCAST_CATEGORIES.map((cat) => {
            const isSelected = cat.id === selectedCategoryId;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  onSelectCategory(cat);
                  setIsExpanded(false);
                }}
                className={`p-3 rounded-xl border text-left flex flex-col justify-between transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-zinc-900 border-cyan-500 ring-2 ring-cyan-500/20 shadow-md shadow-cyan-500/10'
                    : 'bg-zinc-950/80 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900/60'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className={`p-1.5 rounded-lg ${cat.colorTheme.bg} border ${cat.colorTheme.border}`}>
                      {getIcon(cat.iconName)}
                    </div>
                    {isSelected && (
                      <div className="w-4 h-4 rounded-full bg-cyan-500 flex items-center justify-center text-zinc-950">
                        <Check className="w-2.5 h-2.5 stroke-[3]" />
                      </div>
                    )}
                  </div>
                  <h4 className="font-bold text-white text-xs">
                    {lang === 'uz' ? cat.nameUz : cat.nameRu}
                  </h4>
                  <p className="text-[10px] text-zinc-400 mt-0.5 line-clamp-1">
                    {cat.taglineUz}
                  </p>
                </div>
                <div className="mt-2 pt-1.5 border-t border-zinc-800/60 flex items-center justify-between text-[9px] text-zinc-500">
                  <span>{cat.suggestedVoice}</span>
                  <span>{cat.suggestedTempo}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
