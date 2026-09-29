import React from 'react';
import {
  Mic2,
  FolderKanban,
  Sliders,
  BookOpen,
  Sparkles,
  Film,
  Users2,
  PhoneCall,
  Crown,
} from 'lucide-react';

export type AppTab = 'studio' | 'voiceover' | 'dialogue' | 'agent' | 'exclusive' | 'cms' | 'voices' | 'guide';

interface NavbarProps {
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  lang: 'uz' | 'ru';
  setLang: (lang: 'uz' | 'ru') => void;
  totalPodcastsCount: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  lang,
  setLang,
  totalPodcastsCount,
}) => {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-zinc-800 bg-zinc-950/85 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2">
        {/* Brand */}
        <div className="flex items-center gap-2.5 cursor-pointer shrink-0" onClick={() => setActiveTab('studio')}>
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-500 via-indigo-500 to-purple-500 p-0.5 shadow-lg shadow-cyan-500/20">
            <div className="w-full h-full bg-zinc-950 rounded-[10px] flex items-center justify-center">
              <Mic2 className="w-4 h-4 text-cyan-400" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-base sm:text-lg tracking-tight bg-gradient-to-r from-zinc-100 via-white to-zinc-400 bg-clip-text text-transparent">
                OvozStudio<span className="text-cyan-400">.AI</span>
              </span>
              <span className="text-[9px] font-semibold uppercase px-1.5 py-0.2 rounded-full bg-cyan-950/80 text-cyan-300 border border-cyan-800/60 hidden md:inline-flex items-center gap-1">
                <Sparkles className="w-2.5 h-2.5 text-cyan-400" />
                Gemini 3.8 Live
              </span>
            </div>
          </div>
        </div>

        {/* Navigation Tabs (Scrollable on mobile) */}
        <nav className="flex items-center gap-1 overflow-x-auto no-scrollbar py-1">
          {/* 1. Unified Studio (Solo, Dialogue, Dubbing) */}
          <button
            onClick={() => setActiveTab('studio')}
            className={`flex items-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
              activeTab === 'studio' || activeTab === 'voiceover' || activeTab === 'dialogue'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm shadow-cyan-500/10'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
            }`}
          >
            <Mic2 className="w-3.5 h-3.5 text-cyan-400" />
            <span>{lang === 'uz' ? 'Studiyada Yaratish' : 'Студия Создания'}</span>
          </button>

          {/* 2. Live Voice Agent & Phone Calls */}
          <button
            onClick={() => setActiveTab('agent')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
              activeTab === 'agent'
                ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40 shadow-sm shadow-blue-500/10'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
            }`}
          >
            <PhoneCall className="w-3.5 h-3.5 text-blue-400" />
            <span>{lang === 'uz' ? 'AI Qo\'ng\'iroq' : 'AI Звонок'}</span>
          </button>

          {/* 3. Exclusive Hub */}
          <button
            onClick={() => setActiveTab('exclusive')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
              activeTab === 'exclusive'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm shadow-amber-500/10'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
            }`}
          >
            <Crown className="w-3.5 h-3.5 text-amber-400" />
            <span>{lang === 'uz' ? 'Eksklyuziv' : 'Эксклюзив'}</span>
          </button>

          {/* 4. CMS Library */}
          <button
            onClick={() => setActiveTab('cms')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
              activeTab === 'cms'
                ? 'bg-zinc-800 text-white border border-zinc-700'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
            }`}
          >
            <FolderKanban className="w-3.5 h-3.5 text-zinc-400" />
            <span>{lang === 'uz' ? 'Kutubxona' : 'Медиатека'}</span>
            {totalPodcastsCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-zinc-800 text-cyan-400 border border-cyan-800/50 font-mono">
                {totalPodcastsCount}
              </span>
            )}
          </button>

          {/* 5. Voices */}
          <button
            onClick={() => setActiveTab('voices')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
              activeTab === 'voices'
                ? 'bg-zinc-800 text-white border border-zinc-700'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/60'
            }`}
          >
            <Sliders className="w-3.5 h-3.5 text-zinc-400" />
            <span>{lang === 'uz' ? 'Ovozlarim' : 'Голоса'}</span>
          </button>

          {/* 6. Guide */}
          <button
            onClick={() => setActiveTab('guide')}
            className="p-2 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 rounded-xl transition-colors"
            title={lang === 'uz' ? "Qo'llanma" : 'Руководство'}
          >
            <BookOpen className="w-4 h-4" />
          </button>
        </nav>

        {/* Language switch */}
        <div className="flex items-center gap-1 bg-zinc-900 p-1 rounded-xl border border-zinc-800 text-xs shrink-0">
          <button
            onClick={() => setLang('uz')}
            className={`px-2 py-0.5 rounded-lg font-medium transition-colors ${
              lang === 'uz' ? 'bg-cyan-500 text-zinc-950 font-bold' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            UZ
          </button>
          <button
            onClick={() => setLang('ru')}
            className={`px-2 py-0.5 rounded-lg font-medium transition-colors ${
              lang === 'ru' ? 'bg-cyan-500 text-zinc-950 font-bold' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            RU
          </button>
        </div>
      </div>
    </header>
  );
};
