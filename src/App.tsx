import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SlimIconRail } from './components/SlimIconRail';
import { AppTab } from './components/Sidebar';
import { ScriptCanvas } from './components/ScriptCanvas';
import { VoiceConsole } from './components/VoiceConsole';
import { StickyBottomBar } from './components/StickyBottomBar';
import { LiveWritingWaveform } from './components/LiveWritingWaveform';
import { PlaybackTimelineWithWords } from './components/PlaybackTimelineWithWords';
import { VoiceStudioModal } from './components/VoiceStudioModal';
import { PodcastCMS, CMSPodcastItem } from './components/PodcastCMS';
import { VoicesManagerTab } from './components/VoicesManagerTab';
import { PodcastGuideModal } from './components/PodcastGuideModal';
import { VoiceoverStudio } from './components/VoiceoverStudio';
import { DialogueStudio } from './components/DialogueStudio';
import { VoiceAgentTab } from './components/VoiceAgentTab';
import { ExclusiveProductionHub } from './components/ExclusiveProductionHub';
import { DocumentSourceModal } from './components/DocumentSourceModal';
import { NotebookLMIntegrationModal } from './components/NotebookLMIntegrationModal';
import { AuthModal } from './components/AuthModal';
import { PricingModal } from './components/PricingModal';
import { LandingPage } from './components/LandingPage';
import { DocsScreen } from './components/DocsScreen';
import { useAuth } from './context/AuthContext';
import { PODCAST_CATEGORIES } from './data/categories';
import { PREBUILT_VOICE_PROFILES, USER_REPLICATED_VOICE, DEFAULT_USER_VOICE } from './data/voices';
import { VoiceProfile, PodcastCategory, AmbientSoundscape } from './types/podcast';
import { getAllPodcastsFromDb, savePodcastToDb, deletePodcastFromDb } from './utils/db';
import { getMappedTimbrePrompt } from './utils/audioUtils';
import { Zap, FileText, X } from 'lucide-react';
import { authFetch } from './utils/authFetch';
import { GenerationCountdownHUD } from './components/GenerationCountdownHUD';
import {
  useGenerationCountdown,
  calculateAudioSynthesizeSeconds,
} from './hooks/useGenerationCountdown';

const LOCAL_STORAGE_VOICES_KEY = 'podkast_uz_voices_v5';
const LOCAL_STORAGE_PODCASTS_KEY = 'podkast_uz_library_v2';

export default function App() {
  const {
    isAuthenticated,
    isAdmin,
    credits,
    requireAuth,
    useCredit,
    syncCredits,
    addCredits,
    logGeneration,
    openAuthModal,
    openPricingModal,
  } = useAuth();

  // Navigation & Language (URL Hash Synced)
  const [activeTab, setActiveTab] = useState<AppTab>(() => {
    if (typeof window !== 'undefined') {
      const h = window.location.hash;
      if (h === '#studio' || h === '#dialogue' || h === '#voiceover') return 'studio';
      if (h === '#agent') return 'agent';
      if (h === '#exclusive') return 'exclusive';
      if (h === '#cms') return 'cms';
      if (h === '#voices') return 'voices';
      if (h === '#docs') return 'docs';
    }
    return 'landing';
  });
  const [studioMode, setStudioMode] = useState<'solo' | 'interview' | 'voiceover'>(() => {
    if (typeof window !== 'undefined') {
      const h = window.location.hash;
      if (h === '#dialogue') return 'interview';
      if (h === '#voiceover') return 'voiceover';
    }
    return 'solo';
  });
  const [lang, setLang] = useState<'uz' | 'ru'>('uz');

  // Sync hash changes from browser back/forward or direct URL
  useEffect(() => {
    const handleHash = () => {
      const h = window.location.hash;
      if (h === '#studio') {
        setActiveTab('studio');
        setStudioMode('solo');
      } else if (h === '#dialogue') {
        setActiveTab('studio');
        setStudioMode('interview');
      } else if (h === '#voiceover') {
        setActiveTab('studio');
        setStudioMode('voiceover');
      } else if (h === '#agent') {
        setActiveTab('agent');
      } else if (h === '#exclusive') {
        setActiveTab('exclusive');
      } else if (h === '#cms') {
        setActiveTab('cms');
      } else if (h === '#voices') {
        setActiveTab('voices');
      } else if (h === '#docs') {
        setActiveTab('docs');
      } else if (h === '#landing') {
        setActiveTab('landing');
      }
    };
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  // Update hash when activeTab or studioMode changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      let targetHash = '#landing';
      if (activeTab === 'studio') {
        targetHash = studioMode === 'solo' ? '#studio' : studioMode === 'interview' ? '#dialogue' : '#voiceover';
      } else if (activeTab === 'agent') targetHash = '#agent';
      else if (activeTab === 'exclusive') targetHash = '#exclusive';
      else if (activeTab === 'cms') targetHash = '#cms';
      else if (activeTab === 'voices') targetHash = '#voices';
      else if (activeTab === 'docs') targetHash = '#docs';

      if (window.location.hash !== targetHash && !(activeTab === 'landing' && window.location.hash === '')) {
        window.history.replaceState(null, '', targetHash);
      }
    }
  }, [activeTab, studioMode]);

  // Voices State: Always ensure all prebuilt catalog voices are present
  const [voices, setVoices] = useState<VoiceProfile[]>(() => {
    try {
      // Clear stale legacy caches that caused missing voices or 0 voices on gender filter
      localStorage.removeItem('podkast_uz_voices');
      localStorage.removeItem('podkast_uz_voices_v1');
      localStorage.removeItem('podkast_uz_voices_v2');
      localStorage.removeItem('podkast_uz_voices_v3');
      localStorage.removeItem('podkast_uz_voices_v4');

      const saved = localStorage.getItem(LOCAL_STORAGE_VOICES_KEY);
      const customVoices: VoiceProfile[] = [];
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            // Keep ONLY user custom/replicated voices, never override prebuilt voices
            if (item.isUserCustomVoice || item.isReplicatedVoice) {
              if (item.id !== USER_REPLICATED_VOICE.id) {
                customVoices.push(item);
              }
            }
          }
        }
      }

      // Merge: all prebuilt catalog voices + user custom voices
      const voiceMap = new Map<string, VoiceProfile>();
      for (const pv of PREBUILT_VOICE_PROFILES) {
        const isFemale =
          pv.gender === 'female' ||
          ['Kore', 'Aoede', 'Zephyr'].includes(pv.baseVoice) ||
          /aziza|madina|dilnoza|zarina|nodira|malika|sevara|shahnoza|rayhon|gulzoda|umida|nigora|feruza|ayol/i.test(pv.name || pv.id);
        voiceMap.set(pv.id, {
          ...pv,
          gender: isFemale ? 'female' : 'male',
        });
      }
      for (const cv of customVoices) {
        const isFemale =
          cv.gender === 'female' ||
          ['Kore', 'Aoede', 'Zephyr'].includes(cv.baseVoice) ||
          /aziza|madina|dilnoza|zarina|nodira|malika|sevara|shahnoza|rayhon|gulzoda|umida|nigora|feruza|ayol/i.test(cv.name || cv.id);
        voiceMap.set(cv.id, {
          ...cv,
          gender: isFemale ? 'female' : 'male',
        });
      }

      return Array.from(voiceMap.values());
    } catch (e) {
      console.error(e);
    }
    return PREBUILT_VOICE_PROFILES;
  });

  const [selectedVoiceId, setSelectedVoiceId] = useState<string>(() => {
    return USER_REPLICATED_VOICE.id;
  });

  // Selected Category
  const [selectedCategory, setSelectedCategory] = useState<PodcastCategory>(PODCAST_CATEGORIES[0]);

  // Script State
  const [title, setTitle] = useState<string>(PODCAST_CATEGORIES[0].topics[0].titleUz);
  const [scriptText, setScriptText] = useState<string>(PODCAST_CATEGORIES[0].topics[0].sampleScriptUz);

  // XY Pad controls: tempo (0.75 - 1.35) and timbreValue (-1.0 to +1.0)
  const [tempo, setTempo] = useState<number>(1.0);
  const [timbreValue, setTimbreValue] = useState<number>(0.0);
  const [speechStyle] = useState<string>(PODCAST_CATEGORIES[0].suggestedStyle);
  const [ambientSound, setAmbientSound] = useState<AmbientSoundscape>('none');
  const [ambientVolume, setAmbientVolume] = useState<number>(15);

  // Scrubber target duration
  const wordCount = scriptText.trim() ? scriptText.trim().split(/\s+/).filter(Boolean).length : 0;
  const computedDuration = Math.max(15, Math.round((wordCount / (125 * tempo)) * 60));
  const [targetSeconds, setTargetSeconds] = useState<number>(computedDuration);

  // Keep targetSeconds synced with text length unless manually dragged
  useEffect(() => {
    setTargetSeconds(computedDuration);
  }, [computedDuration]);

  // Synthesizing & Audio Result
  const [isSynthesizing, setIsSynthesizing] = useState<boolean>(false);
  const soloEstimatedGenSeconds = calculateAudioSynthesizeSeconds(wordCount, tempo);
  const soloAudioCountdown = useGenerationCountdown(
    isSynthesizing,
    soloEstimatedGenSeconds,
    lang,
    'audio_solo'
  );
  const [currentAudio, setCurrentAudio] = useState<{
    rawAudioWavBase64: string;
    durationSeconds: number;
    title: string;
    voiceName: string;
    category: string;
    ambientSound: AmbientSoundscape;
    ambientVolume?: number;
  } | null>(null);

  // Modals & Document Analyzer
  const [isVoiceStudioOpen, setIsVoiceStudioOpen] = useState(false);
  const [editingVoice, setEditingVoice] = useState<VoiceProfile | null>(null);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
  const [isNotebookLMModalOpen, setIsNotebookLMModalOpen] = useState(false);
  const [documentModalFormat, setDocumentModalFormat] = useState<'podcast' | 'interview' | 'voiceover'>('podcast');
  const [interviewTopic, setInterviewTopic] = useState<string>('');
  const [interviewTurns, setInterviewTurns] = useState<any[] | undefined>(undefined);

  // CMS Podcast Library
  const [podcasts, setPodcasts] = useState<CMSPodcastItem[]>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_PODCASTS_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    return [];
  });

  // Load indexedDB data on mount
  useEffect(() => {
    const loadFromDb = async () => {
      try {
        const stored = await getAllPodcastsFromDb();
        if (stored && stored.length > 0) {
          setPodcasts(stored);
        }
      } catch (err) {
        console.warn('Could not read from IndexedDB:', err);
      }
    };
    loadFromDb();
  }, []);

  // Handle Stripe Checkout return
  const [paymentNotice, setPaymentNotice] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paymentStatus = params.get('payment_status');
    const sessionId = params.get('session_id');

    if (paymentStatus === 'success' && sessionId) {
      authFetch(`/api/billing/verify-session/${sessionId}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.paid && data.credits) {
            if (data.newlyCredited) {
              addCredits(
                data.credits,
                data.planId === 'pro' || data.planId === 'unlimited' ? data.planId : undefined
              );
              setPaymentNotice(
                lang === 'uz'
                  ? `To'lov muvaffaqiyatli qabul qilindi! Hisobingizga +${data.credits} kredit qo'shildi.`
                  : `Оплата прошла успешно! На ваш баланс начислено +${data.credits} кредитов.`
              );
            } else {
              setPaymentNotice(
                lang === 'uz'
                  ? `To'lov allaqachon tasdiqlangan. Joriy balansingiz: ${data.creditsRemaining || credits || 0} kredit.`
                  : `Оплата уже была зачислена. Ваш текущий баланс: ${data.creditsRemaining || credits || 0} кредитов.`
              );
            }
            setTimeout(() => setPaymentNotice(null), 7000);
          }
        })
        .catch(console.warn);

      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [lang, addCredits]);

  // Save voices
  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_STORAGE_VOICES_KEY, JSON.stringify(voices));
    } catch (e) {
      console.error(e);
    }
  }, [voices]);

  const activeVoice = voices.find((v) => v.id === selectedVoiceId) || DEFAULT_USER_VOICE;

  const getBreadcrumbTitle = (): string => {
    if (activeTab === 'studio') {
      if (studioMode === 'solo') return lang === 'uz' ? 'YAKKAXON PODKAST (TTS)' : 'ТЕКСТ В РЕЧЬ';
      if (studioMode === 'interview') return lang === 'uz' ? '2 OVOZLI INTERVYU' : 'ДИАЛОГ';
      if (studioMode === 'voiceover') return lang === 'uz' ? 'VIDEO DUBLYAJ' : 'ДУБЛЯЖ';
    }
    if (activeTab === 'dialogue') return lang === 'uz' ? '2 OVOZLI INTERVYU' : 'ДИАЛОГ';
    if (activeTab === 'voiceover') return lang === 'uz' ? 'VIDEO DUBLYAJ' : 'ДУБЛЯЖ';
    if (activeTab === 'agent') return lang === 'uz' ? 'AI QOʻNGʻIROQ AGENTI' : 'ГОЛОСОВОЙ АГЕНТ';
    if (activeTab === 'exclusive') return lang === 'uz' ? 'EKSKLYUZIV VIP HUB' : 'ЭКСКЛЮЗИВ VIP';
    if (activeTab === 'cms') return lang === 'uz' ? 'MENING KUTUBXONAM' : 'МЕДИАТЕКА';
    if (activeTab === 'voices') return lang === 'uz' ? 'OVOZLAR LABORATORIYASI' : 'ЛАБОРАТОРИЯ ГОЛОСОВ';
    if (activeTab === 'docs') return 'API v1.0 STABLE';
    return lang === 'uz' ? 'STUDIYA' : 'СТУДИЯ';
  };

  // Synthesize Speech Action
  const handleSynthesize = async () => {
    const isAuthed = requireAuth(
      () => {},
      lang === 'uz'
        ? "Podkast yaratish va ovoz sintezi faqat ro'yxatdan o'tgan foydalanuvchilar uchun ochiq."
        : "Генерация подкаста доступна для зарегистрированных пользователей."
    );
    if (!isAuthed) return;
    if (!scriptText.trim()) return;

    setIsSynthesizing(true);
    try {
      const mappedTimbre = getMappedTimbrePrompt(timbreValue);
      const res = await authFetch('/api/podcast/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: scriptText,
          voiceProfile: {
            voiceName: activeVoice.name,
            voiceId: activeVoice.voiceId || activeVoice.id,
            baseVoice: activeVoice.baseVoice,
            timbre: mappedTimbre,
            tempo: `${tempo}x`,
            customPersonaPrompt: activeVoice.customPersonaPrompt,
          },
          speechStyle,
        }),
      });

      if (!res.ok) {
        let errMessage = lang === 'uz' ? 'Ovoz sintezida xatolik' : 'Ошибка при синтезе речи';
        try {
          const err = await res.json();
          errMessage = (lang === 'ru' && err.message_ru) ? err.message_ru : (err.message || err.error || errMessage);
        } catch {
          const raw = await res.text().catch(() => '');
          if (res.status === 504 || res.status === 500) {
            errMessage = lang === 'uz'
              ? 'Server javob berish vaqti tugadi yoki server band. Iltimos, qaytadan urinib ko\'ring.'
              : 'Время ожидания ответа сервера истекло. Пожалуйста, повторите попытку.';
          } else if (raw) {
            errMessage = raw;
          }
        }
        throw new Error(errMessage);
      }

      let data: any;
      try {
        data = await res.json();
      } catch {
        throw new Error(
          lang === 'uz'
            ? 'Serverdan kutilmagan javob qaytdi. Qaytadan urinib ko\'ring.'
            : 'Сервер вернул неожиданный ответ. Повторите попытку.'
        );
      }
      if (data.audioBase64) {
        const audioItem = {
          rawAudioWavBase64: data.audioBase64,
          durationSeconds: data.durationSeconds || targetSeconds,
          title: title || 'O\'zbekcha Podkast',
          voiceName: activeVoice.name,
          category: selectedCategory.nameUz,
          ambientSound,
          ambientVolume,
        };
        setCurrentAudio(audioItem);

        // Auto-save to CMS
        const newCmsItem: CMSPodcastItem = {
          id: `pod-${Date.now()}`,
          title: title || 'O\'zbekcha Podkast',
          category: selectedCategory.nameUz,
          description: title || 'Podkast soni',
          tags: [selectedCategory.badgeUz],
          status: 'published',
          episodeNumber: podcasts.length + 1,
          script: scriptText,
          voiceName: activeVoice.name,
          baseVoice: activeVoice.baseVoice,
          timbre: mappedTimbre,
          tempo: `${tempo}x`,
          style: speechStyle,
          ambientSound,
          ambientVolume,
          durationSeconds: data.durationSeconds || targetSeconds,
          rawAudioWavBase64: data.audioBase64,
          createdAt: new Date().toISOString(),
        };

        savePodcastToDb(newCmsItem);
        setPodcasts((prev) => [newCmsItem, ...prev]);
        if (typeof data.creditsRemaining === 'number') {
          syncCredits(data.creditsRemaining);
        } else {
          await useCredit(1);
        }
        await logGeneration('podcast', title || 'O\'zbekcha Podkast', 1);
      }
    } catch (err: any) {
      alert(`Xatolik: ${err.message}`);
    } finally {
      setIsSynthesizing(false);
    }
  };

  const handleOpenInStudio = (p: CMSPodcastItem) => {
    setTitle(p.title);
    setScriptText(p.script);
    if (p.rawAudioWavBase64) {
      setCurrentAudio({
        title: p.title,
        voiceName: p.voiceName,
        category: p.category,
        durationSeconds: p.durationSeconds,
        rawAudioWavBase64: p.rawAudioWavBase64,
        ambientSound: p.ambientSound || 'none',
        ambientVolume: p.ambientVolume || 20,
      });
    }
    setActiveTab('studio');
    setStudioMode('solo');
  };

  return (
    <>
      {/* Signature Film Grain Overlay */}
      <div className="noise" />

      {/* If Landing Page mode is active */}
      {activeTab === 'landing' ? (
        <LandingPage
          onEnterApp={(tab, mode) => {
            setActiveTab(tab || 'studio');
            if (mode) setStudioMode(mode);
          }}
          lang={lang}
          setLang={setLang}
          onOpenAuthModal={openAuthModal}
          onOpenPricingModal={openPricingModal}
        />
      ) : (
        /* App Shell (Studio, Agent, Dubbing, Library, Voices, Docs) */
        <div className="flex h-screen w-screen bg-[#F4F1EA] text-[#161511] font-sans overflow-hidden select-none">
          {/* 1. Sidebar Left (#141414) */}
          <SlimIconRail
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            studioMode={studioMode}
            setStudioMode={setStudioMode}
            lang={lang}
            setLang={setLang}
            totalPodcastsCount={podcasts.length}
            onOpenDocumentModal={() => {
              setDocumentModalFormat(studioMode === 'interview' ? 'interview' : studioMode === 'voiceover' ? 'voiceover' : 'podcast');
              setIsDocumentModalOpen(true);
            }}
            onOpenGuideModal={() => setIsGuideOpen(true)}
          />

          {/* 2. Main Workspace Canvas (Warm Ivory #F4F1EA) */}
          <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#F4F1EA] relative">
            {/* Topbar: Sticky Glass Paper with Mono Breadcrumb & Pulse Badge */}
            <header className="h-[62px] px-4 sm:px-6 bg-[#F4F1EA]/85 backdrop-blur-md border-b border-[rgba(22,21,17,0.14)] flex items-center justify-between shrink-0 z-30">
              <div className="flex items-center gap-2 min-w-0 truncate font-mono text-xs uppercase tracking-[0.14em] text-[#5D594E]">
                <span>
                  {activeTab === 'docs'
                    ? (lang === 'uz' ? 'HUJJATLAR' : 'ДОКУМЕНТЫ')
                    : (lang === 'uz' ? 'STUDIYA' : 'СТУДИЯ')}
                </span>
                <span className="text-[#161511]/30">·</span>
                <b className="text-[#161511]">{getBreadcrumbTitle()}</b>
              </div>

              {/* OvozStudio Neural Engine Status Badge */}
              <div className="hidden sm:inline-flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-[#0A5A62] border border-[rgba(14,124,134,0.35)] rounded-full px-3 py-1">
                <i className="w-1.5 h-1.5 rounded-full bg-[#0E7C86] pulse-teal-dot" />
                <span>OvozStudio Neural Live</span>
              </div>

              {/* Topbar Right Controls */}
              <div className="flex items-center gap-3">
                {/* Language Switcher */}
                <div className="flex border border-[rgba(22,21,17,0.14)] rounded-full overflow-hidden text-[11px] font-mono">
                  <button
                    type="button"
                    onClick={() => setLang('uz')}
                    className={`px-2.5 py-1 transition-colors cursor-pointer ${
                      lang === 'uz' ? 'bg-[#161511] text-[#F4F1EA] font-semibold' : 'text-[#5D594E] hover:text-[#161511]'
                    }`}
                  >
                    UZ
                  </button>
                  <button
                    type="button"
                    onClick={() => setLang('ru')}
                    className={`px-2.5 py-1 transition-colors cursor-pointer ${
                      lang === 'ru' ? 'bg-[#161511] text-[#F4F1EA] font-semibold' : 'text-[#5D594E] hover:text-[#161511]'
                    }`}
                  >
                    RU
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setIsDocumentModalOpen(true)}
                  className="btn-pill btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5"
                >
                  <FileText className="w-3.5 h-3.5 text-[#0E7C86]" />
                  <span className="hidden sm:inline">{lang === 'uz' ? 'Hujjat / PDF' : 'Документ / PDF'}</span>
                </button>

                <button
                  type="button"
                  onClick={openPricingModal}
                  className="btn-pill btn-solid text-xs px-3.5 py-1.5 flex items-center gap-1.5 shadow-xs"
                >
                  <Zap className="w-3.5 h-3.5 text-[#5CC8CF]" />
                  <span>{isAdmin ? '∞ VIP' : `${credits} ${lang === 'uz' ? 'kredit' : 'кред.'}`}</span>
                </button>
              </div>
            </header>

            {/* Stripe Payment Return Banner */}
            {paymentNotice && (
              <div className="bg-[rgba(14,124,134,0.15)] border-b border-[#0E7C86]/30 text-[#0A5A62] px-4 py-2.5 text-xs font-semibold flex items-center justify-between shadow-xs z-30 shrink-0">
                <span>{paymentNotice}</span>
                <button
                  type="button"
                  onClick={() => setPaymentNotice(null)}
                  className="text-[#5D594E] hover:text-[#161511] p-1 rounded cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Scrollable Center Workspace */}
            <main className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 py-6 max-w-7xl w-full mx-auto pb-24">
              {/* Floating Real-time Countdown HUD during Solo Audio Synthesis */}
              {isSynthesizing && (
                <GenerationCountdownHUD
                  countdown={soloAudioCountdown}
                  isActive={isSynthesizing}
                  lang={lang}
                  title={lang === 'uz' ? `${activeVoice.name} bilan podkast ovozi yaratilmoqda` : `Создание подкаста голосом ${activeVoice.name}`}
                  subtitle={lang === 'uz' ? soloAudioCountdown.phaseNameUz : soloAudioCountdown.phaseNameRu}
                  mode="floating"
                />
              )}

              <AnimatePresence mode="wait">
                <motion.div
                  key={`${activeTab}-${studioMode}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.22, ease: [0.25, 1, 0.5, 1] }}
                  className="space-y-6"
                >
                  {/* TAB: STUDIO SOLO (Script Canvas + Voice Console) */}
                  {activeTab === 'studio' && studioMode === 'solo' && (
                    <div className="flex flex-col lg:flex-row gap-6 items-start">
                      {/* Center Column: Script Canvas & Waveforms */}
                      <div className="flex-1 w-full space-y-5 min-w-0">
                        <ScriptCanvas
                          category={selectedCategory}
                          onSelectCategory={setSelectedCategory}
                          title={title}
                          onChangeTitle={setTitle}
                          scriptText={scriptText}
                          onChangeScriptText={setScriptText}
                          tempo={tempo}
                          onOpenDocumentModal={() => setIsDocumentModalOpen(true)}
                          lang={lang}
                        />

                        {/* Live Writing Waveform with Real-time Countdown & Progress */}
                        {isSynthesizing && (
                          <LiveWritingWaveform
                            voiceName={activeVoice.name}
                            lang={lang}
                            wordCount={wordCount}
                            estimatedAudioSeconds={targetSeconds}
                            isSynthesizing={isSynthesizing}
                            countdownState={soloAudioCountdown}
                          />
                        )}

                        {/* Playback Timeline with Chapters & Word-Level Highlight */}
                        {currentAudio && !isSynthesizing && (
                          <PlaybackTimelineWithWords
                            rawAudioWavBase64={currentAudio.rawAudioWavBase64}
                            title={currentAudio.title}
                            voiceName={currentAudio.voiceName}
                            scriptText={scriptText}
                            durationSeconds={currentAudio.durationSeconds}
                            onSaveToCMS={() => {
                              const newCmsItem: CMSPodcastItem = {
                                id: `pod-${Date.now()}`,
                                title: currentAudio.title,
                                category: currentAudio.category,
                                description: currentAudio.title,
                                tags: [selectedCategory.badgeUz],
                                status: 'published',
                                episodeNumber: podcasts.length + 1,
                                script: scriptText,
                                voiceName: currentAudio.voiceName,
                                baseVoice: activeVoice.baseVoice,
                                timbre: getMappedTimbrePrompt(timbreValue),
                                tempo: `${tempo}x`,
                                style: speechStyle,
                                ambientSound: currentAudio.ambientSound,
                                ambientVolume,
                                durationSeconds: currentAudio.durationSeconds,
                                rawAudioWavBase64: currentAudio.rawAudioWavBase64,
                                createdAt: new Date().toISOString(),
                              };
                              savePodcastToDb(newCmsItem);
                              setPodcasts((prev) => [newCmsItem, ...prev]);
                            }}
                            lang={lang}
                          />
                        )}
                      </div>

                      {/* Right Column: Voice Console */}
                      <VoiceConsole
                        voices={voices}
                        selectedVoiceId={selectedVoiceId}
                        onSelectVoice={setSelectedVoiceId}
                        onOpenVoiceStudio={() => {
                          setEditingVoice(null);
                          setIsVoiceStudioOpen(true);
                        }}
                        tempo={tempo}
                        onChangeTempo={setTempo}
                        timbreValue={timbreValue}
                        onChangeTimbreValue={setTimbreValue}
                        wordCount={wordCount}
                        targetSeconds={targetSeconds}
                        onChangeTargetSeconds={setTargetSeconds}
                        isAdmin={isAdmin}
                        ambientSound={ambientSound}
                        onChangeAmbientSound={setAmbientSound}
                        ambientVolume={ambientVolume}
                        onChangeAmbientVolume={setAmbientVolume}
                        lang={lang}
                      />
                    </div>
                  )}

                  {/* TAB: MULTI-SPEAKER INTERVIEW */}
                  {(activeTab === 'studio' && studioMode === 'interview') || activeTab === 'dialogue' ? (
                    <DialogueStudio
                      voices={voices}
                      userClonedVoiceId={selectedVoiceId}
                      initialTurns={interviewTurns}
                      initialTopic={interviewTopic}
                      onOpenDocumentModal={() => {
                        setDocumentModalFormat('interview');
                        setIsDocumentModalOpen(true);
                      }}
                      onSaveToCMS={(item: any) => {
                        const newCmsItem: CMSPodcastItem = {
                          id: `interview-${Date.now()}`,
                          title: item.title,
                          category: item.category || 'Intervyu & Muloqot',
                          description: item.description,
                          tags: item.tags || ['Intervyu', 'MultiSpeaker'],
                          status: 'published',
                          episodeNumber: podcasts.length + 1,
                          script: item.script,
                          voiceName: item.voiceName,
                          baseVoice: 'Charon',
                          timbre: 'Dual Voice Studio Master',
                          tempo: '1.0x',
                          style: 'Jonli intervyu',
                          ambientSound: 'none',
                          ambientVolume: 0,
                          durationSeconds: item.durationSeconds || 60,
                          rawAudioWavBase64: item.rawAudioWavBase64,
                          createdAt: new Date().toISOString(),
                        };
                        savePodcastToDb(newCmsItem);
                        setPodcasts((prev) => [newCmsItem, ...prev]);
                      }}
                      lang={lang}
                    />
                  ) : null}

                  {/* TAB: VIDEO DUBBING & VOICEOVER */}
                  {(activeTab === 'studio' && studioMode === 'voiceover') || activeTab === 'voiceover' ? (
                    <VoiceoverStudio
                      voices={voices}
                      selectedVoiceId={selectedVoiceId}
                      onSelectVoiceId={setSelectedVoiceId}
                      onSaveToCMS={(item: any) => {
                        const newCmsItem: CMSPodcastItem = {
                          id: `voiceover-${Date.now()}`,
                          title: item.title,
                          category: 'Dublyaj & Ovozlashtirish',
                          description: item.format,
                          tags: ['Voiceover', 'Dublyaj', 'Reels'],
                          status: 'published',
                          episodeNumber: podcasts.length + 1,
                          script: item.script,
                          voiceName: item.voiceName || activeVoice.name,
                          baseVoice: 'Charon',
                          timbre: 'Studio Voiceover Master',
                          tempo: '1.0x',
                          style: 'Professional dublyaj',
                          ambientSound: 'none',
                          ambientVolume: 0,
                          durationSeconds: item.durationSeconds || 30,
                          rawAudioWavBase64: item.rawAudioWavBase64,
                          createdAt: new Date().toISOString(),
                        };
                        savePodcastToDb(newCmsItem);
                        setPodcasts((prev) => [newCmsItem, ...prev]);
                      }}
                      lang={lang}
                    />
                  ) : null}

                  {/* TAB: VOICE AGENT */}
                  {activeTab === 'agent' && (
                    <VoiceAgentTab
                      voices={voices}
                      userClonedVoiceId={selectedVoiceId}
                      lang={lang}
                    />
                  )}

                  {/* TAB: EXCLUSIVE VIP */}
                  {activeTab === 'exclusive' && (
                    <ExclusiveProductionHub
                      voices={voices}
                      userClonedVoiceId={selectedVoiceId}
                      lang={lang}
                    />
                  )}

                  {/* TAB: MEDIA LIBRARY (CMS) */}
                  {activeTab === 'cms' && (
                    <PodcastCMS
                      podcasts={podcasts}
                      onUpdatePodcast={(updated) => {
                        savePodcastToDb(updated);
                        setPodcasts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
                      }}
                      onDeletePodcast={(id) => {
                        deletePodcastFromDb(id);
                        setPodcasts((prev) => prev.filter((p) => p.id !== id));
                      }}
                      onOpenInStudio={handleOpenInStudio}
                      onCreateNew={() => {
                        setActiveTab('studio');
                        setStudioMode('solo');
                      }}
                      lang={lang}
                    />
                  )}

                  {/* TAB: VOICES LAB */}
                  {activeTab === 'voices' && (
                    <VoicesManagerTab
                      voices={voices}
                      selectedVoiceId={selectedVoiceId}
                      onSelectVoice={setSelectedVoiceId}
                      onAddOrEditVoice={(v) => {
                        setEditingVoice(v || null);
                        setIsVoiceStudioOpen(true);
                      }}
                      onDeleteVoice={(id) => {
                        setVoices((prev) => prev.filter((v) => v.id !== id));
                      }}
                      lang={lang}
                    />
                  )}

                  {/* TAB: API DOCS */}
                  {activeTab === 'docs' && (
                    <DocsScreen
                      lang={lang}
                      onOpenPricingModal={openPricingModal}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </main>

            {/* 3. Sticky Bottom Bar: Generate Button Always Visible */}
            {activeTab === 'studio' && studioMode === 'solo' && (
              <StickyBottomBar
                activeVoice={activeVoice}
                tempo={tempo}
                timbreValue={timbreValue}
                wordCount={wordCount}
                estimatedSeconds={targetSeconds}
                isSynthesizing={isSynthesizing}
                onSynthesize={handleSynthesize}
                canSynthesize={scriptText.trim().length > 0}
                isAuthenticated={isAuthenticated}
                isAdmin={isAdmin}
                lang={lang}
                countdownState={soloAudioCountdown}
              />
            )}
          </div>
        </div>
      )}

      {/* Modals */}
      <VoiceStudioModal
        isOpen={isVoiceStudioOpen}
        onClose={() => setIsVoiceStudioOpen(false)}
        onSaveVoice={(newOrUpdatedVoice) => {
          setVoices((prev) => {
            const exists = prev.some((v) => v.id === newOrUpdatedVoice.id);
            if (exists) {
              return prev.map((v) => (v.id === newOrUpdatedVoice.id ? newOrUpdatedVoice : v));
            }
            return [newOrUpdatedVoice, ...prev];
          });
          setSelectedVoiceId(newOrUpdatedVoice.id);
        }}
        editingVoice={editingVoice}
        lang={lang}
      />

      <PodcastGuideModal
        isOpen={isGuideOpen}
        onClose={() => setIsGuideOpen(false)}
        lang={lang}
      />

      <DocumentSourceModal
        isOpen={isDocumentModalOpen}
        onClose={() => setIsDocumentModalOpen(false)}
        onApply={(data) => {
          if (data.targetFormat === 'podcast') {
            if (data.title) setTitle(data.title);
            if (data.script) setScriptText(data.script);
            setActiveTab('studio');
            setStudioMode('solo');
          } else if (data.targetFormat === 'interview') {
            if (data.title) setInterviewTopic(data.title);
            if (data.turns && Array.isArray(data.turns)) setInterviewTurns(data.turns);
            setActiveTab('studio');
            setStudioMode('interview');
          } else if (data.targetFormat === 'voiceover') {
            setActiveTab('studio');
            setStudioMode('voiceover');
          }
        }}
        defaultFormat={documentModalFormat}
        lang={lang}
        onOpenNotebookLMGuide={() => setIsNotebookLMModalOpen(true)}
      />

      <NotebookLMIntegrationModal
        isOpen={isNotebookLMModalOpen}
        onClose={() => setIsNotebookLMModalOpen(false)}
        lang={lang}
        onApplySnippet={(snippetText) => {
          setScriptText(snippetText);
          setActiveTab('studio');
          setStudioMode('solo');
          setIsDocumentModalOpen(true);
        }}
      />

      <AuthModal lang={lang} />
      <PricingModal lang={lang} />
    </>
  );
}
