import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import {
  Mic2,
  Users2,
  Film,
  PhoneCall,
  Sliders,
  Crown,
  FolderKanban,
  Sparkles,
  BookOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Lock,
  LogOut,
  Zap,
  Plus,
  X,
} from 'lucide-react';

export type AppTab = 'landing' | 'studio' | 'dialogue' | 'voiceover' | 'agent' | 'exclusive' | 'cms' | 'voices' | 'guide' | 'docs';

interface SidebarProps {
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  studioMode: 'solo' | 'interview' | 'voiceover';
  setStudioMode: (mode: 'solo' | 'interview' | 'voiceover') => void;
  lang: 'uz' | 'ru';
  setLang: (lang: 'uz' | 'ru') => void;
  totalPodcastsCount: number;
  onOpenNotebookLMModal: () => void;
  onOpenDocumentModal: () => void;
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  isMobileOpen: boolean;
  setIsMobileOpen: (open: boolean) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  studioMode,
  setStudioMode,
  lang,
  setLang,
  totalPodcastsCount,
  onOpenNotebookLMModal,
  isCollapsed,
  setIsCollapsed,
  isMobileOpen,
  setIsMobileOpen,
}) => {
  const { user, isAdmin, credits, logout, openAuthModal, openPricingModal } = useAuth();

  // Navigation Items
  const studioItems = [
    {
      id: 'studio-solo',
      tab: 'studio' as AppTab,
      mode: 'solo' as const,
      labelUz: 'Yakkaxon Podkast',
      labelRu: 'Текст в Речь',
      sublabelUz: 'Audio Sintez',
      sublabelRu: 'Синтез речи 24kHz',
      icon: Mic2,
      active: activeTab === 'studio' && studioMode === 'solo',
    },
    {
      id: 'studio-dialogue',
      tab: 'studio' as AppTab,
      mode: 'interview' as const,
      labelUz: '2 Ovozli Intervyu',
      labelRu: 'Диалог & Интервью',
      sublabelUz: 'Multi-speaker audio',
      sublabelRu: '2 диктора',
      icon: Users2,
      active: (activeTab === 'studio' && studioMode === 'interview') || activeTab === 'dialogue',
    },
    {
      id: 'studio-voiceover',
      tab: 'studio' as AppTab,
      mode: 'voiceover' as const,
      labelUz: 'Video Dublyaj',
      labelRu: 'Дубляж Видео',
      sublabelUz: 'Taymlayn & Sinxron',
      sublabelRu: 'Таймлайн и субтитры',
      icon: Film,
      active: (activeTab === 'studio' && studioMode === 'voiceover') || activeTab === 'voiceover',
    },
    {
      id: 'agent',
      tab: 'agent' as AppTab,
      labelUz: 'AI Qo\'ng\'iroq (Agent)',
      labelRu: 'AI Голосовой Агент',
      sublabelUz: 'Jonli muloqot & CRM',
      sublabelRu: 'Звонки и CRM лиды',
      icon: PhoneCall,
      active: activeTab === 'agent',
    },
  ];

  const assetsItems = [
    {
      id: 'voices',
      tab: 'voices' as AppTab,
      labelUz: 'Ovozlar Laboratoriyasi',
      labelRu: 'Лаборатория Голосов',
      sublabelUz: 'Shaxsiy klonlash',
      sublabelRu: 'Репликация голоса',
      icon: Sliders,
      active: activeTab === 'voices',
    },
    {
      id: 'exclusive',
      tab: 'exclusive' as AppTab,
      labelUz: 'Eksklyuziv VIP Hub',
      labelRu: 'Эксклюзив VIP',
      sublabelUz: 'Masterklass & Muqova',
      sublabelRu: 'Мастерклассы и арт',
      icon: Crown,
      active: activeTab === 'exclusive',
    },
    {
      id: 'cms',
      tab: 'cms' as AppTab,
      labelUz: 'Mening Kutubxonam',
      labelRu: 'Медиатека',
      sublabelUz: `${totalPodcastsCount} ta fayl`,
      sublabelRu: `${totalPodcastsCount} файлов`,
      icon: FolderKanban,
      badge: totalPodcastsCount > 0 ? totalPodcastsCount : undefined,
      active: activeTab === 'cms',
    },
  ];

  const toolsItems = [
    {
      id: 'notebooklm',
      labelUz: 'NotebookLM & Hujjat',
      labelRu: 'NotebookLM & Документы',
      sublabelUz: 'PDF, YouTube, matn',
      sublabelRu: 'Импорт из источников',
      icon: Sparkles,
      onClick: () => {
        onOpenNotebookLMModal();
        setIsMobileOpen(false);
      },
    },
    {
      id: 'guide',
      tab: 'guide' as AppTab,
      labelUz: 'Qo\'llanma & API',
      labelRu: 'Руководство',
      sublabelUz: 'Hujjatlar & maslahatlar',
      sublabelRu: 'Инструкции',
      icon: BookOpen,
      active: activeTab === 'guide',
    },
  ];

  const handleSelectNav = (item: any) => {
    if (item.onClick) {
      item.onClick();
      return;
    }
    if (item.tab) {
      setActiveTab(item.tab);
      if (item.mode) {
        setStudioMode(item.mode);
      }
    }
    setIsMobileOpen(false);
  };

  return (
    <>
      {/* Mobile Backdrop with Smooth Fade */}
      <AnimatePresence>
        {isMobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setIsMobileOpen(false)}
            className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm md:hidden"
          />
        )}
      </AnimatePresence>

      {/* Main Sidebar Container with Smooth Ease-in-out Width Spring */}
      <motion.aside
        initial={false}
        animate={{
          width: isCollapsed ? 72 : 256,
        }}
        transition={{
          duration: 0.3,
          ease: [0.25, 1, 0.5, 1], // Silk smooth cubic-bezier ease-in-out
        }}
        className={`fixed md:sticky top-0 left-0 z-50 h-screen flex flex-col justify-between bg-[#141414] border-r border-[#2B2B27] select-none overflow-hidden ${
          isMobileOpen
            ? 'translate-x-0 shadow-2xl'
            : '-translate-x-full md:translate-x-0'
        }`}
      >
        {/* Top: Logo & Collapse Toggle */}
        <div className="flex flex-col border-b border-[#2B2B27] shrink-0">
          <div className="h-16 px-4 flex items-center justify-between gap-3">
            {/* Brand Logo & Wordmark */}
            <motion.div
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                setActiveTab('studio');
                setStudioMode('solo');
              }}
              className="flex items-center gap-2.5 cursor-pointer overflow-hidden group shrink-0"
            >
              {/* Sonic Waveform Geometric Monogram */}
              <div className="w-9 h-9 rounded-full bg-[#1D1D1B] border border-[#2B2B27] p-2 flex items-center justify-center shrink-0 shadow-inner group-hover:border-[#0E7C86] transition-colors">
                <div className="flex items-center gap-0.5 h-4">
                  <div className="w-1 bg-[#0E7C86] rounded-full h-2 animate-pulse" />
                  <div className="w-1 bg-[#5CC8CF] rounded-full h-4" />
                  <div className="w-1 bg-[#C4552D] rounded-full h-3" />
                  <div className="w-1 bg-[#C98A12] rounded-full h-1.5" />
                </div>
              </div>

              <AnimatePresence initial={false}>
                {!isCollapsed && (
                  <motion.div
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: 'auto' }}
                    exit={{ opacity: 0, width: 0 }}
                    transition={{ duration: 0.2, ease: 'easeInOut' }}
                    className="flex flex-col leading-tight whitespace-nowrap overflow-hidden"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="font-serif text-lg tracking-tight text-[#EDEAE2]">
                        ovoz<span className="text-[#5CC8CF] italic">studio</span>
                      </span>
                      <span className="w-1.5 h-1.5 rounded-full bg-[#5CC8CF] animate-ping" />
                    </div>
                    <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#7D7A70]">
                      STUDIO ENGINE
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>

            {/* Desktop Collapse / Expand Toggle Button */}
            <motion.button
              type="button"
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.92 }}
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="hidden md:flex p-1.5 rounded-full text-[#7D7A70] hover:text-[#EDEAE2] hover:bg-[#1D1D1B] transition-colors cursor-pointer shrink-0"
              title={isCollapsed ? 'Kengaytirish (Expand)' : 'Kichraytirish (Collapse)'}
            >
              {isCollapsed ? (
                <PanelLeftOpen className="w-4 h-4 text-[#7D7A70]" />
              ) : (
                <PanelLeftClose className="w-4 h-4 text-[#7D7A70]" />
              )}
            </motion.button>

            {/* Mobile Close Button */}
            <button
              type="button"
              onClick={() => setIsMobileOpen(false)}
              className="md:hidden p-1.5 rounded-full text-[#7D7A70] hover:text-[#EDEAE2] hover:bg-[#1D1D1B] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Center: Scrollable Navigation Groups */}
        <div className="flex-1 overflow-y-auto no-scrollbar py-4 px-2 space-y-6">
          {/* Group 1: Core Studio Workspaces */}
          <div className="space-y-1">
            <AnimatePresence initial={false}>
              {!isCollapsed && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.18 }}
                  className="px-3 pb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[#7D7A70] overflow-hidden"
                >
                  01 — {lang === 'uz' ? 'STUDIYA' : 'СТУДИЯ'}
                </motion.div>
              )}
            </AnimatePresence>

            {studioItems.map((item) => {
              const Icon = item.icon;
              return (
                <motion.button
                  key={item.id}
                  type="button"
                  whileHover={{ x: 2 }}
                  whileTap={{ scale: 0.98 }}
                  transition={{ duration: 0.15 }}
                  onClick={() => handleSelectNav(item)}
                  title={isCollapsed ? (lang === 'uz' ? item.labelUz : item.labelRu) : undefined}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-full text-xs font-medium transition-all cursor-pointer group text-left ${
                    item.active
                      ? 'bg-[#1D1D1B] text-[#EDEAE2] border border-[#2B2B27] shadow-sm'
                      : 'text-[#7D7A70] hover:text-[#EDEAE2] hover:bg-[#1D1D1B]/50 border border-transparent'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 shrink-0 transition-colors ${
                      item.active ? 'text-[#5CC8CF]' : 'text-[#7D7A70] group-hover:text-[#EDEAE2]'
                    }`}
                  />
                  <AnimatePresence initial={false}>
                    {!isCollapsed && (
                      <motion.div
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -6 }}
                        transition={{ duration: 0.18, ease: 'easeInOut' }}
                        className="flex-1 leading-snug overflow-hidden whitespace-nowrap"
                      >
                        <div className="truncate text-[#EDEAE2] font-medium">
                          {lang === 'uz' ? item.labelUz : item.labelRu}
                        </div>
                        <div className="font-mono text-[10px] uppercase tracking-wider text-[#7D7A70] truncate">
                          {lang === 'uz' ? item.sublabelUz : item.sublabelRu}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.button>
              );
            })}
          </div>

          {/* Group 2: Voices & Library */}
          <div className="space-y-1">
            <AnimatePresence initial={false}>
              {!isCollapsed && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.18 }}
                  className="px-3 pb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[#7D7A70] overflow-hidden"
                >
                  02 — {lang === 'uz' ? 'AKTIVLAR' : 'АКТИВЫ'}
                </motion.div>
              )}
            </AnimatePresence>

            {assetsItems.map((item) => {
              const Icon = item.icon;
              return (
                <motion.button
                  key={item.id}
                  type="button"
                  whileHover={{ x: 2 }}
                  whileTap={{ scale: 0.98 }}
                  transition={{ duration: 0.15 }}
                  onClick={() => handleSelectNav(item)}
                  title={isCollapsed ? (lang === 'uz' ? item.labelUz : item.labelRu) : undefined}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-full text-xs font-medium transition-all cursor-pointer group text-left ${
                    item.active
                      ? 'bg-[#1D1D1B] text-[#EDEAE2] border border-[#2B2B27] shadow-sm'
                      : 'text-[#7D7A70] hover:text-[#EDEAE2] hover:bg-[#1D1D1B]/50 border border-transparent'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 shrink-0 transition-colors ${
                      item.active ? 'text-[#5CC8CF]' : 'text-[#7D7A70] group-hover:text-[#EDEAE2]'
                    }`}
                  />
                  <AnimatePresence initial={false}>
                    {!isCollapsed && (
                      <motion.div
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -6 }}
                        transition={{ duration: 0.18, ease: 'easeInOut' }}
                        className="flex-1 flex items-center justify-between gap-1 overflow-hidden whitespace-nowrap"
                      >
                        <div className="leading-snug truncate">
                          <div className="truncate text-[#EDEAE2] font-medium">
                            {lang === 'uz' ? item.labelUz : item.labelRu}
                          </div>
                          <div className="font-mono text-[10px] uppercase tracking-wider text-[#7D7A70] truncate">
                            {lang === 'uz' ? item.sublabelUz : item.sublabelRu}
                          </div>
                        </div>
                        {item.badge !== undefined && (
                          <span className="text-[10px] px-2 py-0.2 rounded-full bg-[#1D1D1B] text-[#5CC8CF] font-mono border border-[#2B2B27] shrink-0">
                            {item.badge}
                          </span>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.button>
              );
            })}
          </div>

          {/* Group 3: Integrations & Docs */}
          <div className="space-y-1">
            <AnimatePresence initial={false}>
              {!isCollapsed && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.18 }}
                  className="px-3 pb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-[#7D7A70] overflow-hidden"
                >
                  03 — {lang === 'uz' ? 'MANBALAR' : 'ИСТОЧНИКИ'}
                </motion.div>
              )}
            </AnimatePresence>

            {toolsItems.map((item) => {
              const Icon = item.icon;
              return (
                <motion.button
                  key={item.id}
                  type="button"
                  whileHover={{ x: 2 }}
                  whileTap={{ scale: 0.98 }}
                  transition={{ duration: 0.15 }}
                  onClick={() => handleSelectNav(item)}
                  title={isCollapsed ? (lang === 'uz' ? item.labelUz : item.labelRu) : undefined}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-full text-xs font-medium transition-all cursor-pointer group text-left ${
                    (item as any).active
                      ? 'bg-[#1D1D1B] text-[#EDEAE2] border border-[#2B2B27] shadow-sm'
                      : 'text-[#7D7A70] hover:text-[#EDEAE2] hover:bg-[#1D1D1B]/50 border border-transparent'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0 text-[#0E7C86]" />
                  <AnimatePresence initial={false}>
                    {!isCollapsed && (
                      <motion.div
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -6 }}
                        transition={{ duration: 0.18, ease: 'easeInOut' }}
                        className="flex-1 leading-snug overflow-hidden whitespace-nowrap"
                      >
                        <div className="truncate text-[#EDEAE2] font-medium">
                          {lang === 'uz' ? item.labelUz : item.labelRu}
                        </div>
                        <div className="font-mono text-[10px] uppercase tracking-wider text-[#7D7A70] truncate">
                          {lang === 'uz' ? item.sublabelUz : item.sublabelRu}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* Bottom Tray: Credits, Language & User Profile */}
        <div className="border-t border-[#2B2B27] p-3 bg-[#0E0E0D] space-y-3 shrink-0">
          {/* Credits Gauge */}
          <AnimatePresence initial={false} mode="wait">
            {!isCollapsed ? (
              <motion.div
                key="expanded-credits"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="bg-[#141414] border border-[#2B2B27] rounded-[16px] p-2.5 space-y-2"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#7D7A70] font-mono text-[11px] uppercase tracking-wider flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-[#5CC8CF]" />
                    <span>{lang === 'uz' ? 'Balans' : 'Баланс'}</span>
                  </span>
                  <span className="font-mono font-bold text-[#5CC8CF] text-xs">
                    {isAdmin ? '∞ Cheksiz' : `${credits} kredit`}
                  </span>
                </div>

                {!isAdmin && (
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={openPricingModal}
                    className="w-full py-1.5 px-2 bg-[#0E7C86] hover:bg-[#0A5A62] text-white rounded-full text-[11px] font-medium flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>{lang === 'uz' ? 'Balansni to\'ldirish' : 'Пополнить баланс'}</span>
                  </motion.button>
                )}
              </motion.div>
            ) : (
              <motion.button
                key="collapsed-credits"
                type="button"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={openPricingModal}
                title={isAdmin ? 'Admin (Cheksiz)' : `${credits} kredit qoldi`}
                className="w-full flex items-center justify-center p-2 rounded-full bg-[#1D1D1B] border border-[#2B2B27] text-[#5CC8CF] transition-colors"
              >
                <Zap className="w-4 h-4 text-[#5CC8CF]" />
              </motion.button>
            )}
          </AnimatePresence>

          {/* User Account Drawer & Language */}
          <div className="flex items-center justify-between gap-2">
            {/* User Profile or Login Trigger */}
            {user ? (
              <div className="flex items-center gap-2 overflow-hidden flex-1">
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt={user.displayName || 'User'}
                    className="w-8 h-8 rounded-full object-cover border border-[#2B2B27] shrink-0"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-[#0E7C86] flex items-center justify-center text-white text-xs font-bold shrink-0">
                    {user.email ? user.email[0].toUpperCase() : 'U'}
                  </div>
                )}

                <AnimatePresence initial={false}>
                  {!isCollapsed && (
                    <motion.div
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: 'auto' }}
                      exit={{ opacity: 0, width: 0 }}
                      transition={{ duration: 0.18 }}
                      className="flex flex-col overflow-hidden leading-tight flex-1 whitespace-nowrap"
                    >
                      <span className="text-xs font-medium text-[#EDEAE2] truncate">
                        {user.displayName || user.email?.split('@')[0]}
                      </span>
                      <span className="font-mono text-[9px] uppercase tracking-wider text-[#7D7A70] truncate">
                        {isAdmin ? '👑 Admin VIP' : user.email}
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => openAuthModal()}
                className={`flex items-center justify-center gap-2 py-2 rounded-full text-xs font-medium bg-[#0E7C86] hover:bg-[#0A5A62] text-white transition-all cursor-pointer shadow-sm ${
                  isCollapsed ? 'w-full px-2' : 'flex-1 px-3'
                }`}
                title={lang === 'uz' ? 'Kirish' : 'Войти'}
              >
                <Lock className="w-3.5 h-3.5" />
                <AnimatePresence initial={false}>
                  {!isCollapsed && (
                    <motion.span
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                    >
                      {lang === 'uz' ? 'Kirish' : 'Войти'}
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.button>
            )}

            {/* Logout Button if signed in */}
            {user && (
              <motion.button
                type="button"
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={logout}
                className="p-2 rounded-full text-[#7D7A70] hover:text-[#C4552D] hover:bg-[#1D1D1B] transition-colors cursor-pointer shrink-0"
                title={lang === 'uz' ? 'Chiqish' : 'Выйти'}
              >
                <LogOut className="w-4 h-4" />
              </motion.button>
            )}

            {/* Language Switcher */}
            <AnimatePresence initial={false}>
              {!isCollapsed && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.18 }}
                  className="flex items-center bg-[#1D1D1B] border border-[#2B2B27] rounded-full p-0.5 text-[10px] font-mono shrink-0"
                >
                  <button
                    type="button"
                    onClick={() => setLang('uz')}
                    className={`px-2 py-0.5 rounded-full transition-colors ${
                      lang === 'uz' ? 'bg-[#0E7C86] text-white' : 'text-[#7D7A70] hover:text-[#EDEAE2]'
                    }`}
                  >
                    UZ
                  </button>
                  <button
                    type="button"
                    onClick={() => setLang('ru')}
                    className={`px-2 py-0.5 rounded-full transition-colors ${
                      lang === 'ru' ? 'bg-[#0E7C86] text-white' : 'text-[#7D7A70] hover:text-[#EDEAE2]'
                    }`}
                  >
                    RU
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.aside>
    </>
  );
};
