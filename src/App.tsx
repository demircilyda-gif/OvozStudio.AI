import React, { useState, useEffect } from 'react';
import { Navbar, AppTab } from './components/Navbar';
import { CategorySelector } from './components/CategorySelector';
import { ScriptEditor } from './components/ScriptEditor';
import { VoiceSettingsPanel } from './components/VoiceSettingsPanel';
import { AudioPreviewPlayer } from './components/AudioPreviewPlayer';
import { VoiceStudioModal } from './components/VoiceStudioModal';
import { PodcastCMS, CMSPodcastItem } from './components/PodcastCMS';
import { VoicesManagerTab } from './components/VoicesManagerTab';
import { PodcastGuideModal } from './components/PodcastGuideModal';
import { VoiceoverStudio } from './components/VoiceoverStudio';
import { DialogueStudio } from './components/DialogueStudio';
import { VoiceAgentTab } from './components/VoiceAgentTab';
import { ExclusiveProductionHub } from './components/ExclusiveProductionHub';
import { DocumentSourceModal } from './components/DocumentSourceModal';
import { PODCAST_CATEGORIES } from './data/categories';
import { PREBUILT_VOICE_PROFILES, USER_REPLICATED_VOICE, DEFAULT_USER_VOICE } from './data/voices';
import { VoiceProfile, PodcastCategory, AmbientSoundscape } from './types/podcast';
import { Sparkles, Radio, HelpCircle, Layers, CheckCircle, ShieldCheck } from 'lucide-react';

const LOCAL_STORAGE_VOICES_KEY = 'podkast_uz_voices_v2';
const LOCAL_STORAGE_PODCASTS_KEY = 'podkast_uz_library_v2';

export default function App() {
  // Navigation & Language
  const [activeTab, setActiveTab] = useState<AppTab>('studio');
  const [lang, setLang] = useState<'uz' | 'ru'>('uz');

  // Voices State: initialize with default user replicated voice
  const [voices, setVoices] = useState<VoiceProfile[]>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_VOICES_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.error(e);
    }
    return PREBUILT_VOICE_PROFILES;
  });

  const [selectedVoiceId, setSelectedVoiceId] = useState<string>(() => {
    return USER_REPLICATED_VOICE.id;
  });

  // Selected Category (default: Tarixiy)
  const [selectedCategory, setSelectedCategory] = useState<PodcastCategory>(PODCAST_CATEGORIES[0]);

  // Script & Metadata State
  const [title, setTitle] = useState<string>(PODCAST_CATEGORIES[0].topics[0].titleUz);
  const [description, setDescription] = useState<string>(PODCAST_CATEGORIES[0].topics[0].descriptionUz);
  const [tags, setTags] = useState<string[]>(['Tarix', 'AmirTemur', 'Samarqand', 'PodkastUz']);
  const [scriptText, setScriptText] = useState<string>(PODCAST_CATEGORIES[0].topics[0].sampleScriptUz);

  // Voice & Speech Settings
  const [tempo, setTempo] = useState<number>(0.95);
  const [timbre, setTimbre] = useState<string>(PODCAST_CATEGORIES[0].suggestedTimbre);
  const [speechStyle, setSpeechStyle] = useState<string>(PODCAST_CATEGORIES[0].suggestedStyle);
  const [ambientSound, setAmbientSound] = useState<AmbientSoundscape>(PODCAST_CATEGORIES[0].ambientSound);
  const [ambientVolume, setAmbientVolume] = useState<number>(20);

  // Synthesizing & Audio Result
  const [isSynthesizing, setIsSynthesizing] = useState<boolean>(false);
  const [currentAudio, setCurrentAudio] = useState<{
    rawAudioWavBase64: string;
    durationSeconds: number;
    title: string;
    voiceName: string;
    category: string;
    ambientSound: AmbientSoundscape;
  } | null>(null);

  // Modals & Document Analyzer
  const [isVoiceStudioOpen, setIsVoiceStudioOpen] = useState(false);
  const [editingVoice, setEditingVoice] = useState<VoiceProfile | null>(null);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
  const [documentModalFormat, setDocumentModalFormat] = useState<'podcast' | 'interview' | 'voiceover'>('podcast');
  const [interviewTopic, setInterviewTopic] = useState<string>('');
  const [interviewTurns, setInterviewTurns] = useState<any[] | undefined>(undefined);
  const [saveSuccessNotification, setSaveSuccessNotification] = useState<string | null>(null);
  const [studioVoiceBanner, setStudioVoiceBanner] = useState<{ name: string; id: string } | null>(null);

  // Auto-detect and sync user's Google AI Studio voices on mount
  useEffect(() => {
    const fetchStudioVoices = async () => {
      try {
        const res = await fetch('/api/voices');
        if (!res.ok) return;
        const data = await res.json();
        
        if (data.replicatedVoices && data.replicatedVoices.length > 0) {
          const first = data.replicatedVoices[0];
          setStudioVoiceBanner({
            name: first.displayName || first.name || 'SHOKHRUKH',
            id: first.id || first.voiceId,
          });

          // Convert backend voices to VoiceProfile list
          const convertedStudioVoices: VoiceProfile[] = data.replicatedVoices.map((rv: any) => ({
            id: rv.id,
            voiceId: rv.id,
            name: `${rv.displayName || rv.name} (Haqiqiy Ovoz)`,
            baseVoice: 'Charon' as const,
            voiceType: 'replicated' as const,
            model: rv.model || 'models/gemini-3.8-flash-tts',
            timbre: 'Haqiqiy shaxsiy tembr (Google AI Studio Voice Replication)',
            tempo: 'Vazmin (1.0x)',
            pitchLevel: "O'rta (Bariton)" as const,
            style: 'Samimiy & Jonli podkaster',
            customPersonaPrompt: "Google AI Studio Voice Replication orqali yaratilgan haqiqiy individual ovoz.",
            isUserCustomVoice: true,
            isReplicatedVoice: true,
            sampleNotes: `Google AI Studio ID: ${rv.id}`,
          }));

          setVoices((prev) => {
            // Keep existing prebuilts, prepend new studio voices
            const filtered = prev.filter((p) => !convertedStudioVoices.some((c) => c.id === p.id));
            return [...convertedStudioVoices, ...filtered];
          });

          setSelectedVoiceId(first.id);
        }
      } catch (err) {
        console.warn('Could not sync with /api/voices:', err);
      }
    };

    fetchStudioVoices();
  }, []);

  // CMS Podcast Library
  const [podcasts, setPodcasts] = useState<CMSPodcastItem[]>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_PODCASTS_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }

    // Default Seed Podcasts for CMS
    return [
      {
        id: 'seed-history-1',
        title: 'Amir Temur va Samarqandning jahon sivilizatsiyasidagi o\'rni',
        category: 'Tarixiy & Allomalar',
        description: 'Amir Temurning me\'morchilik mo\'jizalari, Registon va jahon ilm-fani rivojidagi o\'rni.',
        tags: ['Tarix', 'AmirTemur', 'Samarqand', 'Registon'],
        status: 'published',
        episodeNumber: 1,
        script: PODCAST_CATEGORIES[0].topics[0].sampleScriptUz,
        voiceName: 'SHOKHRUKH (Mening Haqiqiy Ovozim)',
        baseVoice: 'Charon',
        timbre: 'Haqiqiy shaxsiy tembr (Google AI Studio Voice Replication)',
        tempo: '0.9x',
        style: 'Hujjatli & Epik',
        ambientSound: 'dutor-acoustic',
        ambientVolume: 20,
        durationSeconds: 110,
        rawAudioWavBase64: '',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'seed-comedy-1',
        title: 'O\'zbek to\'ylari: 500 kishi va adashib kelgan mehmonlar',
        category: 'Komedik & Hayotiy Hazillar',
        description: 'To\'ylarimizdagi eng kulgili, hayotiy va barchaga tanish voqealar haqida yengil hazil podkast.',
        tags: ['Komedik', 'Osh', 'Toylar', 'Hazil', 'Toshkent'],
        status: 'published',
        episodeNumber: 2,
        script: PODCAST_CATEGORIES[1].topics[0].sampleScriptUz,
        voiceName: 'Puck (Quvnoq & Jonli)',
        baseVoice: 'Puck',
        timbre: 'Yorqin tenor',
        tempo: '1.15x',
        style: 'Quvnoq & Hazilomuz',
        ambientSound: 'comedy-jingle',
        ambientVolume: 25,
        durationSeconds: 95,
        rawAudioWavBase64: '',
        createdAt: new Date(Date.now() - 86400000).toISOString(),
      },
    ];
  });

  // Save voices to local storage
  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_STORAGE_VOICES_KEY, JSON.stringify(voices));
    } catch (e) {
      console.error(e);
    }
  }, [voices]);

  // Save podcasts to local storage
  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_STORAGE_PODCASTS_KEY, JSON.stringify(podcasts));
    } catch (e) {
      console.error(e);
    }
  }, [podcasts]);

  // When category changes, suggest relevant audio settings
  const handleSelectCategory = (cat: PodcastCategory) => {
    setSelectedCategory(cat);
    setTimbre(cat.suggestedTimbre);
    setSpeechStyle(cat.suggestedStyle);
    setAmbientSound(cat.ambientSound);

    // Set sample topic
    if (cat.topics && cat.topics.length > 0) {
      const top = cat.topics[0];
      setTitle(top.titleUz);
      setDescription(top.descriptionUz);
      setScriptText(top.sampleScriptUz);
      setTags([cat.badgeUz, 'PodkastUz', top.titleUz.split(' ')[0]]);
    }
  };

  // Synthesize Podcast Speech via Gemini 3.8 Flash TTS with user's real voice
  const handleSynthesize = async () => {
    if (!scriptText.trim()) return;
    setIsSynthesizing(true);

    try {
      const activeVoice = voices.find((v) => v.id === selectedVoiceId) || DEFAULT_USER_VOICE;

      const res = await fetch('/api/podcast/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: scriptText,
          voiceProfile: {
            voiceName: activeVoice.name,
            voiceId: activeVoice.voiceId || activeVoice.id,
            baseVoice: activeVoice.baseVoice,
            timbre: timbre || activeVoice.timbre,
            tempo: `${tempo}x`,
            customPersonaPrompt: activeVoice.customPersonaPrompt,
          },
          speechStyle,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Ovoz sintezida xatolik');
      }

      const data = await res.json();

      if (data.audioBase64) {
        const audioItem = {
          rawAudioWavBase64: data.audioBase64,
          durationSeconds: data.durationSeconds || 60,
          title: title || 'O\'zbekcha Podkast',
          voiceName: activeVoice.name,
          category: selectedCategory.nameUz,
          ambientSound,
        };

        setCurrentAudio(audioItem);

        // Auto-save or update in CMS library
        const newCmsItem: CMSPodcastItem = {
          id: `pod-${Date.now()}`,
          title: title || 'O\'zbekcha Podkast',
          category: selectedCategory.nameUz,
          description: description || 'Gemini 3.8 orqali yaratilgan podkast',
          tags: tags.length > 0 ? tags : [selectedCategory.badgeUz],
          status: 'published',
          episodeNumber: podcasts.length + 1,
          script: scriptText,
          voiceName: activeVoice.name,
          baseVoice: activeVoice.baseVoice,
          timbre,
          tempo: `${tempo}x`,
          style: speechStyle,
          ambientSound,
          ambientVolume,
          durationSeconds: data.durationSeconds || 60,
          rawAudioWavBase64: data.audioBase64,
          createdAt: new Date().toISOString(),
        };

        setPodcasts((prev) => [newCmsItem, ...prev]);

        // Smooth scroll to audio preview player
        setTimeout(() => {
          const previewElem = document.getElementById('preview-player-section');
          if (previewElem) {
            previewElem.scrollIntoView({ behavior: 'smooth' });
          }
        }, 150);
      }
    } catch (err: any) {
      alert(`Xatolik yuz berdi: ${err.message}`);
    } finally {
      setIsSynthesizing(false);
    }
  };

  // Open Podcast from CMS in Studio
  const handleOpenInStudio = (item: CMSPodcastItem) => {
    setTitle(item.title);
    setDescription(item.description);
    setTags(item.tags);
    setScriptText(item.script);

    // Match category
    const cat = PODCAST_CATEGORIES.find((c) => c.nameUz === item.category) || PODCAST_CATEGORIES[0];
    setSelectedCategory(cat);

    // Match voice if possible
    const v = voices.find((v) => v.name === item.voiceName || v.id === item.baseVoice);
    if (v) setSelectedVoiceId(v.id);

    if (item.rawAudioWavBase64) {
      setCurrentAudio({
        rawAudioWavBase64: item.rawAudioWavBase64,
        durationSeconds: item.durationSeconds,
        title: item.title,
        voiceName: item.voiceName,
        category: item.category,
        ambientSound: item.ambientSound,
      });
    }

    setActiveTab('studio');
  };

  // Save Custom Voice from modal
  const handleSaveVoice = (newOrUpdatedVoice: VoiceProfile) => {
    setVoices((prev) => {
      const exists = prev.some((v) => v.id === newOrUpdatedVoice.id);
      if (exists) {
        return prev.map((v) => (v.id === newOrUpdatedVoice.id ? newOrUpdatedVoice : v));
      }
      return [newOrUpdatedVoice, ...prev];
    });
    setSelectedVoiceId(newOrUpdatedVoice.id);
    if (newOrUpdatedVoice.timbre) {
      setTimbre(newOrUpdatedVoice.timbre);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-zinc-950">
      {/* Top Navigation */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={(tab) => {
          if (tab === 'guide') {
            setIsGuideOpen(true);
          } else {
            setActiveTab(tab);
          }
        }}
        lang={lang}
        setLang={setLang}
        totalPodcastsCount={podcasts.length}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-8">
        {/* Active Studio Voice Detection Notification */}
        {studioVoiceBanner && (
          <div className="rounded-2xl p-4 bg-gradient-to-r from-emerald-950/60 via-zinc-900 to-cyan-950/50 border border-emerald-500/40 shadow-xl flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    Google AI Studio Voice Replication Faol
                  </span>
                  <span className="text-xs font-mono text-zinc-400 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">
                    ID: {studioVoiceBanner.id}
                  </span>
                </div>
                <h4 className="text-sm sm:text-base font-bold text-white mt-0.5">
                  {lang === 'uz'
                    ? `Sizning haqiqiy shaxsiy ovozingiz «${studioVoiceBanner.name}» avtomatik ulandi!`
                    : `Ваш настоящий голос «${studioVoiceBanner.name}» из Google AI Studio успешно подключен!`}
                </h4>
                <p className="text-xs text-zinc-400">
                  {lang === 'uz'
                    ? 'Barcha podkastlar aynan sizning ovoz nusxangizda (Voice Replication) sintez qilinadi.'
                    : 'Все подкасты будут синтезироваться именно вашей голосовой копией (Voice Replication).'}
                </p>
              </div>
            </div>

            <button
              onClick={() => {
                setEditingVoice(voices.find((v) => v.id === studioVoiceBanner.id) || null);
                setIsVoiceStudioOpen(true);
              }}
              className="shrink-0 px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-emerald-300 border border-emerald-500/30 transition-all hover:scale-105"
            >
              {lang === 'uz' ? 'Ovozni tekshirish' : 'Проверить голос'}
            </button>
          </div>
        )}

        {/* TAB 1: STUDIO (Podcast Creator & Synthesis) */}
        {activeTab === 'studio' && (
          <div className="space-y-8">
            {/* Hero / Studio Intro */}
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-zinc-900 via-zinc-900/90 to-zinc-950 border border-zinc-800/90 p-6 sm:p-8 shadow-2xl">
              <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl -z-10 pointer-events-none" />
              <div className="max-w-3xl space-y-2">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-cyan-950/80 text-cyan-300 border border-cyan-800/60 shadow-sm">
                  <Radio className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
                  <span>Gemini 3.8 TTS Live • O'zbek Tili Studiyasi</span>
                </div>
                <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight">
                  {lang === 'uz' ? (
                    <>
                      O'z Haqiqiy Ovozingizda{' '}
                      <span className="bg-gradient-to-r from-cyan-400 via-emerald-400 to-indigo-400 bg-clip-text text-transparent">
                        O'zbekcha Podkast
                      </span>{' '}
                      Yaratish
                    </>
                  ) : (
                    <>
                      Создание Подкастов Своим Голосом на{' '}
                      <span className="bg-gradient-to-r from-cyan-400 via-emerald-400 to-indigo-400 bg-clip-text text-transparent">
                        Узбекском Языке
                      </span>
                    </>
                  )}
                </h1>
                <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
                  {lang === 'uz'
                    ? 'Kategoriyani tanlang (Tarixiy, Komedik va boshqalar), Google AI Studio orqali yaratilgan haqiqiy ovozingizda matnni ovozlashtiring, temp va tembrni moslang, so\'ngra tinglab MP3/WAV formatida yuklab oling.'
                    : 'Выберите категорию (исторические, комедийные и др.), озвучивайте текст своей настоящей голосовой копией из Google AI Studio, настройте темп и тембр, прослушайте и скачайте в MP3/WAV.'}
                </p>
              </div>
            </div>

            {/* Step 1: Category Selector */}
            <CategorySelector
              selectedCategoryId={selectedCategory.id}
              onSelectCategory={handleSelectCategory}
              lang={lang}
            />

            {/* Studio Workspace: Left = Script Editor, Right = Voice & Audio Settings */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8 items-start">
              {/* Left Column: Script Editor (7 cols) */}
              <div className="lg:col-span-7 space-y-6">
                <ScriptEditor
                  category={selectedCategory}
                  title={title}
                  onChangeTitle={setTitle}
                  description={description}
                  onChangeDescription={setDescription}
                  tags={tags}
                  onChangeTags={setTags}
                  scriptText={scriptText}
                  onChangeScriptText={setScriptText}
                  tempo={tempo}
                  onSynthesize={handleSynthesize}
                  isSynthesizing={isSynthesizing}
                  onOpenDocumentModal={() => {
                    setDocumentModalFormat('podcast');
                    setIsDocumentModalOpen(true);
                  }}
                  onSaveDraft={() => {
                    const activeVoice = voices.find((v) => v.id === selectedVoiceId) || DEFAULT_USER_VOICE;
                    const newCmsItem: CMSPodcastItem = {
                      id: `pod-${Date.now()}`,
                      title: title || 'O\'zbekcha Podkast',
                      category: selectedCategory.nameUz,
                      description: description || 'Saqlangan podkast',
                      tags: tags.length > 0 ? tags : [selectedCategory.badgeUz],
                      status: 'published',
                      episodeNumber: podcasts.length + 1,
                      script: scriptText,
                      voiceName: activeVoice.name,
                      baseVoice: activeVoice.baseVoice,
                      timbre,
                      tempo: `${tempo}x`,
                      style: speechStyle,
                      ambientSound,
                      ambientVolume,
                      durationSeconds: currentAudio?.durationSeconds || Math.max(10, Math.ceil(scriptText.split(/\s+/).length / 2.3)),
                      rawAudioWavBase64: currentAudio?.rawAudioWavBase64 || '',
                      createdAt: new Date().toISOString(),
                    };
                    setPodcasts((prev) => [newCmsItem, ...prev]);
                    setSaveSuccessNotification(
                      lang === 'uz'
                        ? '✅ Podkast CMS kutubxonasiga muvaffaqiyatli saqlandi!'
                        : '✅ Подкаст успешно сохранен в CMS библиотеку!'
                    );
                    setTimeout(() => setSaveSuccessNotification(null), 3500);
                  }}
                  lang={lang}
                />
              </div>

              {/* Right Column: Voice & Speech Settings (5 cols) */}
              <div className="lg:col-span-5 space-y-6">
                <VoiceSettingsPanel
                  voices={voices}
                  selectedVoiceId={selectedVoiceId}
                  onSelectVoice={setSelectedVoiceId}
                  onOpenVoiceStudio={(v) => {
                    setEditingVoice(v || null);
                    setIsVoiceStudioOpen(true);
                  }}
                  tempo={tempo}
                  onChangeTempo={setTempo}
                  timbre={timbre}
                  onChangeTimbre={setTimbre}
                  style={speechStyle}
                  onChangeStyle={setSpeechStyle}
                  ambientSound={ambientSound}
                  onChangeAmbientSound={setAmbientSound}
                  ambientVolume={ambientVolume}
                  onChangeAmbientVolume={setAmbientVolume}
                  lang={lang}
                />
              </div>
            </div>

            {/* Live Audio Preview & Export Section */}
            {currentAudio && (
              <div id="preview-player-section" className="pt-4">
                <AudioPreviewPlayer
                  rawAudioWavBase64={currentAudio.rawAudioWavBase64}
                  title={currentAudio.title}
                  voiceName={currentAudio.voiceName}
                  category={currentAudio.category}
                  ambientSound={currentAudio.ambientSound}
                  durationSeconds={currentAudio.durationSeconds}
                  onSaveToCMS={() => {
                    const activeVoice = voices.find((v) => v.name === currentAudio.voiceName) || voices[0];
                    const newCmsItem: CMSPodcastItem = {
                      id: `pod-${Date.now()}`,
                      title: currentAudio.title,
                      category: currentAudio.category,
                      description: description || 'Gemini 3.8 orqali yaratilgan podkast',
                      tags: tags.length > 0 ? tags : [selectedCategory.badgeUz],
                      status: 'published',
                      episodeNumber: podcasts.length + 1,
                      script: scriptText,
                      voiceName: currentAudio.voiceName,
                      baseVoice: activeVoice.baseVoice,
                      timbre,
                      tempo: `${tempo}x`,
                      style: speechStyle,
                      ambientSound: currentAudio.ambientSound,
                      ambientVolume,
                      durationSeconds: currentAudio.durationSeconds,
                      rawAudioWavBase64: currentAudio.rawAudioWavBase64,
                      createdAt: new Date().toISOString(),
                    };
                    setPodcasts((prev) => [newCmsItem, ...prev]);
                    setSaveSuccessNotification(
                      lang === 'uz'
                        ? '✅ Podkast audio va ssenariysi CMS kutubxonasiga saqlandi!'
                        : '✅ Подкаст (аудио и сценарий) сохранен в CMS!'
                    );
                    setTimeout(() => setSaveSuccessNotification(null), 3500);
                  }}
                  lang={lang}
                />
              </div>
            )}
          </div>
        )}

        {/* TAB: VOICEOVER & DUBBING STUDIO */}
        {activeTab === 'voiceover' && (
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
                voiceName: item.voiceName || 'SHOKHRUKH',
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
              setPodcasts((prev) => [newCmsItem, ...prev]);
              setSaveSuccessNotification(
                lang === 'uz'
                  ? '✅ Dublyaj CMS kutubxonasiga saqlandi!'
                  : '✅ Озвучка успешно сохранена в CMS!'
              );
              setTimeout(() => setSaveSuccessNotification(null), 3500);
            }}
            lang={lang}
          />
        )}

        {/* TAB: MULTI-SPEAKER & INTERVIEW STUDIO */}
        {activeTab === 'dialogue' && (
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
                tags: item.tags || ['Intervyu', 'MultiSpeaker', 'DualVoice'],
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
              setPodcasts((prev) => [newCmsItem, ...prev]);
              setSaveSuccessNotification(
                lang === 'uz'
                  ? '✅ Intervyu dialogi CMS kutubxonasiga saqlandi!'
                  : '✅ Диалог интервью успешно сохранен в CMS!'
              );
              setTimeout(() => setSaveSuccessNotification(null), 3500);
            }}
            lang={lang}
          />
        )}

        {/* TAB: LIVE VOICE AI AGENT & CALLS */}
        {activeTab === 'agent' && (
          <VoiceAgentTab
            voices={voices}
            userClonedVoiceId={selectedVoiceId}
            lang={lang}
          />
        )}

        {/* TAB: EXCLUSIVE HUB & PRODUCTION SUITE */}
        {activeTab === 'exclusive' && (
          <ExclusiveProductionHub
            voices={voices}
            userClonedVoiceId={selectedVoiceId}
            lang={lang}
          />
        )}

        {/* TAB 2: PODCAST CMS (Content Management System) */}
        {activeTab === 'cms' && (
          <PodcastCMS
            podcasts={podcasts}
            onUpdatePodcast={(updated) => {
              setPodcasts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
            }}
            onDeletePodcast={(id) => {
              setPodcasts((prev) => prev.filter((p) => p.id !== id));
            }}
            onOpenInStudio={handleOpenInStudio}
            onCreateNew={() => setActiveTab('studio')}
            lang={lang}
          />
        )}

        {/* TAB 3: VOICES MANAGER */}
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
      </main>

      {/* Voice Studio Modal (Gemini 3.8 Voice Import & Tuning) */}
      <VoiceStudioModal
        isOpen={isVoiceStudioOpen}
        onClose={() => setIsVoiceStudioOpen(false)}
        onSaveVoice={handleSaveVoice}
        editingVoice={editingVoice}
        lang={lang}
      />

      {/* Podcast Guide Modal */}
      <PodcastGuideModal
        isOpen={isGuideOpen}
        onClose={() => setIsGuideOpen(false)}
        lang={lang}
      />

      {/* Document / PDF / YouTube / Article Analysis Modal */}
      <DocumentSourceModal
        isOpen={isDocumentModalOpen}
        onClose={() => setIsDocumentModalOpen(false)}
        onApply={(data) => {
          if (data.targetFormat === 'podcast') {
            if (data.title) setTitle(data.title);
            if (data.description) setDescription(data.description);
            if (data.tags) setTags(data.tags);
            if (data.script) setScriptText(data.script);
            setActiveTab('studio');
            setSaveSuccessNotification(
              lang === 'uz'
                ? '✅ Hujjatdan podkast ssenariysi muvaffaqiyatli shakllantirildi!'
                : '✅ Сценарий подкаста успешно создан из документа!'
            );
          } else if (data.targetFormat === 'interview') {
            if (data.title) setInterviewTopic(data.title);
            if (data.turns && Array.isArray(data.turns)) setInterviewTurns(data.turns);
            setActiveTab('dialogue');
            setSaveSuccessNotification(
              lang === 'uz'
                ? '✅ Hujjatdan 2 kishilik intervyu muvaffaqiyatli shakllantirildi!'
                : '✅ 2-голосый диалог интервью успешно создан из документа!'
            );
          } else if (data.targetFormat === 'voiceover') {
            setActiveTab('voiceover');
            setSaveSuccessNotification(
              lang === 'uz'
                ? '✅ Hujjatdan video dublyaj ssenariysi shakllantirildi!'
                : '✅ Сценарий озвучки видео сформирован!'
            );
          }
          setTimeout(() => setSaveSuccessNotification(null), 4000);
        }}
        defaultFormat={documentModalFormat}
        lang={lang}
      />

      {/* Floating Save / Notification Banner */}
      {saveSuccessNotification && (
        <div className="fixed bottom-6 right-6 z-50 animate-in fade-in slide-in-from-bottom-5 duration-300">
          <div className="bg-emerald-950/95 border border-emerald-500/50 text-emerald-200 px-5 py-3.5 rounded-2xl shadow-2xl backdrop-blur-xl flex items-center gap-3 font-semibold text-xs sm:text-sm">
            <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
            <span>{saveSuccessNotification}</span>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="w-full border-t border-zinc-900 bg-zinc-950 py-6 text-center text-xs text-zinc-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-bold text-zinc-300">OvozStudio AI</span>
            <span>—</span>
            <span>O'zbek tilida podkast yaratish platformasi</span>
          </div>
          <div>Gemini 3.8 TTS Live • Voice Replication • 24kHz Studio Audio • MP3 & WAV Eksport</div>
        </div>
      </footer>
    </div>
  );
}
