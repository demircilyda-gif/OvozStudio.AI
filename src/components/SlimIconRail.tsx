import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import {
  FileText,
  BookOpen,
  Lock,
  LogOut,
  Menu,
  X,
  Home,
} from 'lucide-react';
import { AppTab } from './Sidebar';

interface SlimIconRailProps {
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  studioMode: 'solo' | 'interview' | 'voiceover';
  setStudioMode: (mode: 'solo' | 'interview' | 'voiceover') => void;
  lang: 'uz' | 'ru';
  setLang: (lang: 'uz' | 'ru') => void;
  totalPodcastsCount: number;
  onOpenDocumentModal: () => void;
  onOpenGuideModal: () => void;
}

export const SlimIconRail: React.FC<SlimIconRailProps> = ({
  activeTab,
  setActiveTab,
  studioMode,
  setStudioMode,
  lang,
  setLang,
  totalPodcastsCount,
  onOpenDocumentModal,
  onOpenGuideModal,
}) => {
  const { user, isAdmin, credits, logout, openAuthModal, openPricingModal } = useAuth();
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);

  const navItems = [
    {
      id: 'studio-solo',
      labelUz: 'Studiya',
      labelRu: 'Студия',
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="5.5" y="1.5" width="5" height="9" rx="2.5" stroke="currentColor" strokeWidth="1.4" />
          <path d="M3 8a5 5 0 0 0 10 0M8 13v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      ),
      active: activeTab === 'studio' && studioMode === 'solo',
      onClick: () => {
        setActiveTab('studio');
        setStudioMode('solo');
        setIsMobileDrawerOpen(false);
      },
    },
    {
      id: 'studio-dialogue',
      labelUz: '2 Ovozli Intervyu',
      labelRu: '2 Голоса (Диалог)',
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="5" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.4" />
          <path d="M1.5 13.5c0-2.2 1.8-3.5 4-3.5s4 1.3 4 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="11.5" cy="6" r="2" stroke="currentColor" strokeWidth="1.4" />
          <path d="M10 13c.2-1.4 1.3-2.3 2.8-2.3 1.2 0 2.2.6 2.6 1.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      ),
      active: (activeTab === 'studio' && studioMode === 'interview') || activeTab === 'dialogue',
      onClick: () => {
        setActiveTab('studio');
        setStudioMode('interview');
        setIsMobileDrawerOpen(false);
      },
    },
    {
      id: 'agent',
      labelUz: 'AI Qoʻngʻiroq',
      labelRu: 'AI Звонки',
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M3 2.5c0-.5.5-.9 1-.6l8 4.6c.5.3.5 1 0 1.3l-8 4.6c-.5.3-1-.1-1-.6v-9.3Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M14 9.5c1 .8 1 2.2 0 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      ),
      active: activeTab === 'agent',
      onClick: () => {
        setActiveTab('agent');
        setIsMobileDrawerOpen(false);
      },
    },
    {
      id: 'studio-voiceover',
      labelUz: 'Video Dublyaj',
      labelRu: 'Видео Дубляж',
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="1.5" y="3" width="13" height="10" rx="2" stroke="currentColor" strokeWidth="1.4" />
          <path d="m6.5 6 3.5 2-3.5 2V6Z" fill="currentColor" />
        </svg>
      ),
      active: (activeTab === 'studio' && studioMode === 'voiceover') || activeTab === 'voiceover',
      onClick: () => {
        setActiveTab('studio');
        setStudioMode('voiceover');
        setIsMobileDrawerOpen(false);
      },
    },
    {
      id: 'exclusive',
      labelUz: 'Eksklyuziv VIP',
      labelRu: 'Эксклюзив VIP',
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="m8 1.5 1.8 4 4.4.5-3.3 3 1 4.4L8 11l-3.9 2.4 1-4.4-3.3-3 4.4-.5L8 1.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      ),
      active: activeTab === 'exclusive',
      onClick: () => {
        setActiveTab('exclusive');
        setIsMobileDrawerOpen(false);
      },
    },
    {
      id: 'cms',
      labelUz: 'Kutubxona',
      labelRu: 'Медиатека',
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M2 3.5c2.5-1.3 5-1.3 6 0 1-1.3 3.5-1.3 6 0v9c-2.5-1.3-5-1.3-6 0-1-1.3-3.5-1.3-6 0v-9Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M8 3.5v9" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      ),
      badge: totalPodcastsCount > 0 ? totalPodcastsCount : undefined,
      active: activeTab === 'cms',
      onClick: () => {
        setActiveTab('cms');
        setIsMobileDrawerOpen(false);
      },
    },
    {
      id: 'voices',
      labelUz: 'Ovozlarim',
      labelRu: 'Мои голоса',
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M2 6v4M5 3.5v9M8 5v6M11 2.5v11M14 6.5v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      ),
      active: activeTab === 'voices',
      onClick: () => {
        setActiveTab('voices');
        setIsMobileDrawerOpen(false);
      },
    },
    {
      id: 'docs',
      labelUz: 'Hujjatlar · API',
      labelRu: 'Документы · API',
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M4 1.5h5.5L13 5v9.5H4v-13Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M9.5 1.5V5H13" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      ),
      active: activeTab === 'docs',
      onClick: () => {
        setActiveTab('docs');
        setIsMobileDrawerOpen(false);
      },
    },
  ];

  return (
    <>
      {/* Mobile Top Floating Toggle */}
      <div className="lg:hidden fixed top-3 left-3 z-50">
        <button
          type="button"
          onClick={() => setIsMobileDrawerOpen(true)}
          className="w-10 h-10 rounded-xl bg-[#ECE7DB] text-[#161511] border border-[rgba(22,21,17,0.14)] flex items-center justify-center shadow-md cursor-pointer"
          aria-label="Open navigation menu"
        >
          <Menu className="w-5 h-5 text-[#0A5A62]" />
        </button>
      </div>

      {/* Mobile Slide-In Navigation Drawer */}
      <AnimatePresence>
        {isMobileDrawerOpen && (
          <div className="lg:hidden fixed inset-0 z-50">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMobileDrawerOpen(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />

            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="absolute top-0 bottom-0 left-0 w-[260px] bg-[#ECE7DB] text-[#161511] p-5 flex flex-col justify-between shadow-2xl z-10 border-r border-[rgba(22,21,17,0.14)]"
            >
              <div>
                <div className="flex items-center justify-between pb-5 border-b border-[rgba(22,21,17,0.14)]">
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setActiveTab('landing');
                      setIsMobileDrawerOpen(false);
                    }}
                    className="flex items-center gap-2 font-bold text-lg text-[#161511] no-underline"
                  >
                    <span>ovozstudio</span>
                    <i className="w-2.5 h-2.5 rounded-full bg-[#0E7C86] pulse-teal-dot" />
                  </a>

                  <button
                    type="button"
                    onClick={() => setIsMobileDrawerOpen(false)}
                    className="p-1 rounded-lg text-[#5D594E] hover:text-[#161511]"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <nav className="flex flex-col gap-1.5 mt-4">
                  {/* Home / Bosh ekran */}
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('landing');
                      setIsMobileDrawerOpen(false);
                    }}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                      activeTab === 'landing'
                        ? 'bg-[rgba(14,124,134,0.12)] text-[#0A5A62] shadow-[inset_3px_0_0_#0E7C86] font-semibold'
                        : 'text-[#5D594E] hover:text-[#161511] hover:bg-black/5'
                    }`}
                  >
                    <Home className="w-4 h-4 opacity-80" />
                    <span>{lang === 'uz' ? 'Bosh ekran' : 'Главная'}</span>
                  </button>

                  {navItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={item.onClick}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                        item.active
                          ? 'bg-[rgba(14,124,134,0.12)] text-[#0A5A62] shadow-[inset_3px_0_0_#0E7C86] font-semibold'
                          : 'text-[#5D594E] hover:text-[#161511] hover:bg-black/5'
                      }`}
                    >
                      <span className="opacity-80 shrink-0">{item.icon}</span>
                      <span>{lang === 'uz' ? item.labelUz : item.labelRu}</span>
                      {item.badge !== undefined && (
                        <span className="ml-auto font-mono text-[10px] bg-[#0E7C86] text-white rounded-full px-2 py-0.5">
                          {item.badge}
                        </span>
                      )}
                    </button>
                  ))}
                </nav>
              </div>

              {/* Bottom Drawer User & Credits */}
              <div className="pt-4 border-t border-[rgba(22,21,17,0.14)] space-y-3">
                <div
                  onClick={() => {
                    setIsMobileDrawerOpen(false);
                    openPricingModal();
                  }}
                  className="bg-white/80 border border-[rgba(22,21,17,0.14)] rounded-xl p-3 font-mono text-[10.5px] uppercase tracking-wider text-[#5D594E] cursor-pointer hover:border-[#0E7C86]/50 transition-colors shadow-xs"
                >
                  <b className="block text-[#0A5A62] text-xs font-semibold tracking-widest mb-1">
                    {isAdmin ? '∞ VIP HISOB' : `+${credits} KREDIT`}
                  </b>
                  <span>{lang === 'uz' ? 'Balans va toʻlovlar' : 'Баланс и тарифы'}</span>
                </div>

                <div className="flex items-center gap-2.5 pt-1">
                  <div className="w-8 h-8 rounded-full bg-[#0E7C86] text-white flex items-center justify-center font-bold text-xs shrink-0">
                    {user?.email ? user.email[0].toUpperCase() : 'SH'}
                  </div>
                  <div className="truncate flex-1">
                    <b className="block text-xs text-[#161511] truncate">
                      {user?.displayName || (user?.email ? user.email.split('@')[0] : 'SHOKHRUKH')}
                    </b>
                    <span className="flex items-center gap-1.5 text-[11px] text-[#5D594E]">
                      <i className="w-1.5 h-1.5 rounded-full bg-[#4CC38A] inline-block" />
                      <span>{lang === 'uz' ? 'Replication faol' : 'Онлайн'}</span>
                    </span>
                  </div>
                </div>
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      {/* Desktop 236px Fixed Light Paper Sidebar (--paper-2: #ECE7DB) */}
      <aside className="hidden lg:flex w-[236px] h-screen sticky top-0 left-0 z-40 bg-[#ECE7DB] text-[#161511] flex-col justify-between p-4 pb-3 select-none shrink-0 border-r border-[rgba(22,21,17,0.14)]">
        {/* Top: Logo & Nav List */}
        <div className="flex flex-col">
          {/* Logo with pulsing teal dot */}
          <div className="flex items-center justify-between px-2 pt-1 pb-4">
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setActiveTab('landing');
              }}
              className="flex items-center gap-2 font-bold text-lg tracking-tight text-[#161511] no-underline group cursor-pointer"
              title="Bosh ekranga qaytish"
            >
              <span>ovozstudio</span>
              <i className="w-2.5 h-2.5 rounded-full bg-[#0E7C86] pulse-teal-dot" />
            </a>
          </div>

          {/* Navigation Links */}
          <nav className="flex flex-col gap-1 mt-1">
            {/* Quick link to Landing / Bosh ekran */}
            <button
              type="button"
              onClick={() => setActiveTab('landing')}
              className={`flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                activeTab === 'landing'
                  ? 'bg-[rgba(14,124,134,0.12)] text-[#0A5A62] shadow-[inset_3px_0_0_#0E7C86] font-semibold'
                  : 'text-[#5D594E] hover:text-[#161511] hover:bg-black/5'
              }`}
            >
              <Home className="w-4 h-4 opacity-80" />
              <span>{lang === 'uz' ? 'Bosh ekran' : 'Главная'}</span>
            </button>

            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={item.onClick}
                className={`flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                  item.active
                    ? 'bg-[rgba(14,124,134,0.12)] text-[#0A5A62] shadow-[inset_3px_0_0_#0E7C86] font-semibold'
                    : 'text-[#5D594E] hover:text-[#161511] hover:bg-black/5'
                }`}
              >
                <span className="opacity-80 shrink-0">{item.icon}</span>
                <span className="truncate">{lang === 'uz' ? item.labelUz : item.labelRu}</span>
                {item.badge !== undefined && (
                  <span className="ml-auto font-mono text-[10px] bg-[#0E7C86] text-white rounded-full px-2 py-0.5">
                    {item.badge}
                  </span>
                )}
              </button>
            ))}

            <div className="h-[1px] bg-[rgba(22,21,17,0.14)] my-2" />

            {/* Document Modal Trigger */}
            <button
              type="button"
              onClick={onOpenDocumentModal}
              className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium text-[#5D594E] hover:text-[#161511] hover:bg-black/5 transition-colors cursor-pointer"
            >
              <FileText className="w-4 h-4 opacity-80" />
              <span className="truncate">{lang === 'uz' ? 'Hujjat / PDF' : 'Документ / PDF'}</span>
            </button>

            {/* Guide Modal Trigger */}
            <button
              type="button"
              onClick={onOpenGuideModal}
              className="flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium text-[#5D594E] hover:text-[#161511] hover:bg-black/5 transition-colors cursor-pointer"
            >
              <BookOpen className="w-4 h-4 opacity-80" />
              <span className="truncate">{lang === 'uz' ? 'Qoʻllanma' : 'Гид'}</span>
            </button>
          </nav>
        </div>

        {/* Bottom Rail: Credits & User Profile */}
        <div className="flex flex-col gap-2.5 pt-2">
          {/* Credits Card in Mono Style */}
          <div
            onClick={openPricingModal}
            className="bg-white/80 border border-[rgba(22,21,17,0.14)] rounded-xl p-3 font-mono text-[10.5px] uppercase tracking-wider text-[#5D594E] cursor-pointer hover:border-[#0E7C86]/50 transition-colors shadow-xs"
          >
            <b className="block text-[#0A5A62] text-xs font-semibold tracking-wider mb-0.5">
              {isAdmin ? '∞ VIP HISOB' : `+${credits} KREDIT`}
            </b>
            <span>{isAdmin ? 'Cheksiz generatsiya' : `${credits} podkast qoldi`}</span>
          </div>

          {/* User Account Row */}
          {user ? (
            <div className="flex items-center gap-2.5 px-2 py-2 border-t border-[rgba(22,21,17,0.14)]">
              <div className="w-8 h-8 rounded-full bg-[#0E7C86] text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-xs">
                {user.email ? user.email[0].toUpperCase() : 'SH'}
              </div>
              <div className="truncate flex-1">
                <b className="block text-[13px] text-[#161511] truncate font-medium">
                  {user.displayName || (user.email ? user.email.split('@')[0] : 'SHOKHRUKH')}
                </b>
                <span className="flex items-center gap-1.5 text-[10.5px] text-[#5D594E]">
                  <i className="w-1.5 h-1.5 rounded-full bg-[#4CC38A] inline-block" />
                  <span>{lang === 'uz' ? 'Voice Replication faol' : 'Онлайн'}</span>
                </span>
              </div>
              <button
                type="button"
                onClick={logout}
                className="p-1 text-[#5D594E] hover:text-rose-500 cursor-pointer"
                title={lang === 'uz' ? 'Chiqish' : 'Выйти'}
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-[rgba(22,21,17,0.14)]">
              <button
                type="button"
                onClick={() => openAuthModal()}
                className="btn-pill btn-solid w-full justify-center text-xs py-2 shadow-xs cursor-pointer"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>{lang === 'uz' ? 'Kirish' : 'Войти'}</span>
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
};
