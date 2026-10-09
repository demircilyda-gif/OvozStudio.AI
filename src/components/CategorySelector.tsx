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
        return <TrendingUp className="w-4 h-4 text-amber-400" />;
      default:
        return <Sparkles className="w-4 h-4 text-violet-400" />;
    }
  };

  const selectedCategory = PODCAST_CATEGORIES.find((c) => c.id === selectedCategoryId) || PODCAST_CATEGORIES[0];
  const quickCategories = PODCAST_CATEGORIES.slice(0, 5);

  return (
    <div className="space-y-3 bg-white/80 border border-[rgba(22,21,17,0.14)] rounded-[22px] p-4 shadow-[0_20px_40px_-20px_rgba(22,21,17,0.18)] backdrop-blur-md">
      <div className="flex items-center justify-between gap-2">
        <label className="font-mono text-xs uppercase tracking-wider text-[#5D594E] flex items-center gap-2">
          <Layers className="w-4 h-4 text-[#0E7C86]" />
          <span>{lang === 'uz' ? 'Podkast Toifasi (Mavzu Usuli)' : 'Тематика и Жанр Подкаста'}</span>
        </label>
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="font-mono text-xs text-[#0E7C86] hover:text-[#0A5A62] font-medium flex items-center gap-1 cursor-pointer transition-colors"
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
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all cursor-pointer border ${
                  isSelected
                    ? 'bg-[#161511] text-[#F4F1EA] border-[#161511] shadow-xs'
                    : 'bg-white border-[rgba(22,21,17,0.12)] text-[#5D594E] hover:border-[#161511] hover:text-[#161511]'
                }`}
              >
                {getIcon(cat.iconName)}
                <span>{lang === 'uz' ? cat.nameUz : cat.nameRu}</span>
                {isSelected && <Check className="w-3.5 h-3.5 text-[#5CC8CF] stroke-[2.5]" />}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-mono text-[#5D594E] bg-[#ECE7DB]/50 border border-dashed border-[rgba(22,21,17,0.2)] hover:border-[#161511] hover:text-[#161511] whitespace-nowrap cursor-pointer"
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
                className={`p-3 rounded-2xl border text-left flex flex-col justify-between transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-white border-[#161511] ring-2 ring-[#0E7C86]/30 shadow-sm'
                    : 'bg-white/70 border-[rgba(22,21,17,0.12)] hover:border-[#161511] text-[#161511]'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="p-1.5 rounded-lg bg-[#ECE7DB] border border-[rgba(22,21,17,0.08)]">
                      {getIcon(cat.iconName)}
                    </div>
                    {isSelected && (
                      <div className="w-4 h-4 rounded-full bg-[#0E7C86] flex items-center justify-center text-white">
                        <Check className="w-2.5 h-2.5 stroke-[3]" />
                      </div>
                    )}
                  </div>
                  <h4 className="font-serif text-sm text-[#161511]">
                    {lang === 'uz' ? cat.nameUz : cat.nameRu}
                  </h4>
                  <p className="text-[10px] text-[#5D594E] mt-0.5 line-clamp-1">
                    {cat.taglineUz}
                  </p>
                </div>
                <div className="mt-2 pt-1.5 border-t border-[rgba(22,21,17,0.08)] flex items-center justify-between text-[9px] font-mono text-[#7D7A70]">
                  <span>{lang === 'uz' ? `Ovoz: ${cat.suggestedVoice}` : `Голос: ${cat.suggestedVoice}`}</span>
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
