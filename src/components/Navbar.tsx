import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  Mic2,
  FolderKanban,
  Sliders,
  BookOpen,
  Sparkles,
  PhoneCall,
  Crown,
  Lock,
  LogOut,
  User,
  Zap,
  ShieldCheck,
} from 'lucide-react';

export type AppTab = 'studio' | 'voiceover' | 'dialogue' | 'agent' | 'exclusive' | 'cms' | 'voices' | 'guide';

interface NavbarProps {
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  lang: 'uz' | 'ru';
  setLang: (lang: 'uz' | 'ru') => void;
  totalPodcastsCount: number;
  onOpenNotebookLMModal?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  lang,
  setLang,
  totalPodcastsCount,
  onOpenNotebookLMModal,
}) => {
  const { user, isAdmin, credits, logout, openAuthModal, openPricingModal } = useAuth();

  return (
    <header className="sticky top-0 z-40 w-full border-b border-[rgba(22,21,17,0.14)] bg-[#F4F1EA]/85 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2">
        {/* Brand */}
        <div className="flex items-center gap-2.5 cursor-pointer shrink-0" onClick={() => setActiveTab('studio')}>
          <div className="w-9 h-9 rounded-full bg-[#0E7C86] p-0.5 shadow-xs flex items-center justify-center text-white">
            <Mic2 className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-serif text-lg tracking-tight text-[#161511]">
                ovoz<span className="text-[#0E7C86] italic">studio</span>
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-[#0E7C86] animate-ping" />
              <span className="font-mono text-[9px] uppercase tracking-wider px-2 py-0.2 rounded-full bg-[#0E7C86]/10 text-[#0E7C86] border border-[#0E7C86]/20 hidden md:inline-flex items-center gap-1">
                <Sparkles className="w-2.5 h-2.5 text-[#0E7C86]" />
                OvozStudio Live
              </span>
            </div>
          </div>
        </div>

        {/* Navigation Tabs (Scrollable on mobile) */}
        <nav className="flex items-center gap-1 overflow-x-auto no-scrollbar py-1">
          {/* 1. Unified Studio (Solo, Dialogue, Dubbing) */}
          <button
            onClick={() => setActiveTab('studio')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${
              activeTab === 'studio' || activeTab === 'voiceover' || activeTab === 'dialogue'
                ? 'bg-[#161511] text-[#F4F1EA] shadow-xs'
                : 'text-[#5D594E] hover:text-[#161511] hover:bg-black/5'
            }`}
          >
            <Mic2 className="w-3.5 h-3.5 text-[#0E7C86]" />
            <span>{lang === 'uz' ? 'Studiyada Yaratish' : 'Студия Создания'}</span>
          </button>

          {/* 2. Live Voice Agent & Phone Calls */}
          <button
            onClick={() => setActiveTab('agent')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${
              activeTab === 'agent'
                ? 'bg-[#161511] text-[#F4F1EA] shadow-xs'
                : 'text-[#5D594E] hover:text-[#161511] hover:bg-black/5'
            }`}
          >
            <PhoneCall className="w-3.5 h-3.5 text-[#0E7C86]" />
            <span>{lang === 'uz' ? 'AI Qo\'ng\'iroq' : 'AI Звонок'}</span>
          </button>

          {/* 3. Exclusive Hub */}
          <button
            onClick={() => setActiveTab('exclusive')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${
              activeTab === 'exclusive'
                ? 'bg-[#161511] text-[#F4F1EA] shadow-xs'
                : 'text-[#5D594E] hover:text-[#161511] hover:bg-black/5'
            }`}
          >
            <Crown className="w-3.5 h-3.5 text-[#C98A12]" />
            <span>{lang === 'uz' ? 'Eksklyuziv' : 'Эксклюзив'}</span>
          </button>

          {/* 4. CMS Library */}
          <button
            onClick={() => setActiveTab('cms')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${
              activeTab === 'cms'
                ? 'bg-[#161511] text-[#F4F1EA] shadow-xs'
                : 'text-[#5D594E] hover:text-[#161511] hover:bg-black/5'
            }`}
          >
            <FolderKanban className="w-3.5 h-3.5 text-[#5D594E]" />
            <span>{lang === 'uz' ? 'Kutubxona' : 'Медиатека'}</span>
            {totalPodcastsCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-[#0E7C86] text-white font-mono">
                {totalPodcastsCount}
              </span>
            )}
          </button>

          {/* 5. Voices */}
          <button
            onClick={() => setActiveTab('voices')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${
              activeTab === 'voices'
                ? 'bg-[#161511] text-[#F4F1EA] shadow-xs'
                : 'text-[#5D594E] hover:text-[#161511] hover:bg-black/5'
            }`}
          >
            <Sliders className="w-3.5 h-3.5 text-[#5D594E]" />
            <span>{lang === 'uz' ? 'Ovozlarim' : 'Голоса'}</span>
          </button>

          {/* 6. Guide */}
          <button
            onClick={() => setActiveTab('guide')}
            className="p-2 text-[#5D594E] hover:text-[#161511] hover:bg-black/5 rounded-full transition-colors cursor-pointer"
            title={lang === 'uz' ? "Qo'llanma" : 'Руководство'}
          >
            <BookOpen className="w-4 h-4" />
          </button>

          {/* 7. NotebookLM Integration Modal Trigger */}
          {onOpenNotebookLMModal && (
            <button
              onClick={onOpenNotebookLMModal}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-mono uppercase tracking-wider bg-white border border-[rgba(22,21,17,0.15)] text-[#0E7C86] hover:bg-[#161511] hover:text-[#F4F1EA] transition-all cursor-pointer shadow-xs"
              title={lang === 'uz' ? "Google NotebookLM Integratsiyasi" : "Интеграция с Google NotebookLM"}
            >
              <Sparkles className="w-3.5 h-3.5 text-[#0E7C86]" />
              <span className="hidden sm:inline">NotebookLM</span>
            </button>
          )}
        </nav>

        {/* Right Actions: Auth Profile + Language Switch */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Auth State Button */}
          {user ? (
            <div className="flex items-center gap-1.5 bg-white border border-[rgba(22,21,17,0.14)] rounded-full p-1 pr-2 shadow-xs">
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName || 'User'}
                  className="w-7 h-7 rounded-full object-cover border border-[rgba(22,21,17,0.1)]"
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-[#0E7C86] flex items-center justify-center text-white text-xs font-bold">
                  {user.email ? user.email[0].toUpperCase() : 'U'}
                </div>
              )}

              <div className="hidden sm:flex flex-col text-left leading-none">
                <span className="text-[11px] font-semibold text-[#161511] truncate max-w-[100px]">
                  {user.displayName || user.email?.split('@')[0]}
                </span>
                <span className="text-[9px] text-[#7D7A70] mt-0.5">
                  {isAdmin ? (
                    <span className="text-[#C98A12] font-mono font-bold flex items-center gap-0.5">
                      <Crown className="w-2.5 h-2.5 text-[#C98A12]" /> Admin (VIP)
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={openPricingModal}
                      className="text-[#0E7C86] hover:text-[#0A5A62] font-mono flex items-center gap-1 cursor-pointer transition-colors"
                      title={lang === 'uz' ? "Balansni to'ldirish yoki tariflar" : "Пополнить баланс или тарифы"}
                    >
                      <span>⚡ {credits} {lang === 'uz' ? 'kredit' : 'кред.'}</span>
                    </button>
                  )}
                </span>
              </div>

              {/* Logout Button */}
              <button
                type="button"
                onClick={logout}
                className="p-1 rounded-full text-[#7D7A70] hover:text-[#C4552D] hover:bg-black/5 transition-colors ml-1 cursor-pointer"
                title={lang === 'uz' ? 'Chiqish' : 'Выйти'}
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={openPricingModal}
                className="hidden sm:flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium text-[#5D594E] hover:text-[#161511] bg-white border border-[rgba(22,21,17,0.14)] transition-colors cursor-pointer shadow-xs"
              >
                <Zap className="w-3 h-3 text-[#C98A12]" />
                <span>{lang === 'uz' ? 'Tariflar' : 'Тарифы'}</span>
              </button>

              <button
                type="button"
                onClick={() => openAuthModal()}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium bg-[#161511] hover:bg-[#0A5A62] text-[#F4F1EA] shadow-xs transition-all cursor-pointer"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>{lang === 'uz' ? 'Kirish' : 'Войти'}</span>
              </button>
            </div>
          )}

          {/* Language switch */}
          <div className="flex items-center gap-0.5 bg-[#ECE7DB] p-0.5 rounded-full border border-[rgba(22,21,17,0.14)] text-[10px] font-mono shrink-0">
            <button
              onClick={() => setLang('uz')}
              className={`px-2 py-0.5 rounded-full font-medium transition-colors cursor-pointer ${
                lang === 'uz' ? 'bg-[#161511] text-[#F4F1EA]' : 'text-[#5D594E] hover:text-[#161511]'
              }`}
            >
              UZ
            </button>
            <button
              onClick={() => setLang('ru')}
              className={`px-2 py-0.5 rounded-full font-medium transition-colors cursor-pointer ${
                lang === 'ru' ? 'bg-[#161511] text-[#F4F1EA]' : 'text-[#5D594E] hover:text-[#161511]'
              }`}
            >
              RU
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
