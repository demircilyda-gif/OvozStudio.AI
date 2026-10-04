import React, { useState, useRef, useEffect } from 'react';
import { VoiceProfile, DialogueTurn, AmbientSoundscape, SoundCueType, AudioSegmentCue } from '../types/podcast';
import { getVoicePreviewUrl } from '../data/voicePreviews';
import { AMBIENT_SOUNDSCAPES } from '../data/ambientSoundscapes';
import {
  generateAmbientAudioBuffer,
  audioBufferToWav,
  getAudioContext,
  mixAudioTracks,
  base64ToArrayBuffer,
  autoPlanPodcastCues,
  cleanScriptForSpeech,
  stripAllStageConditions,
  detectScriptConditions,
} from '../utils/audioUtils';
import {
  Users2,
  Sparkles,
  Play,
  Pause,
  Download,
  Plus,
  Trash2,
  CheckCircle2,
  Volume2,
  Clock,
  MessageSquare,
  Bot,
  User,
  Upload,
  Save,
  Check,
  Music,
  Headphones,
  Sliders,
  Gauge,
  ShieldCheck,
  Eraser,
  Lock,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface DialogueStudioProps {
  voices: VoiceProfile[];
  userClonedVoiceId: string;
  initialTurns?: DialogueTurn[];
  initialTopic?: string;
  onSaveToCMS?: (item: any) => void;
  onOpenDocumentModal?: () => void;
  lang: 'uz' | 'ru';
}

export const DialogueStudio: React.FC<DialogueStudioProps> = ({
  voices,
  userClonedVoiceId,
  initialTurns,
  initialTopic,
  onSaveToCMS,
  onOpenDocumentModal,
  lang,
}) => {
  const { isAuthenticated, requireAuth, useCredit, logGeneration } = useAuth();

  // Speaker 1 (User's cloned voice)
  const [speaker1VoiceId, setSpeaker1VoiceId] = useState<string>(() => {
    return userClonedVoiceId || 'voice_17raj9ewke3g';
  });
  const [speaker1Name, setSpeaker1Name] = useState<string>('Shokhrukh');
  const [speaker1Role, setSpeaker1Role] = useState<string>('Boshlovchi (Podkaster)');
  const [speaker1Tempo, setSpeaker1Tempo] = useState<string>('1.0x');

  // Keep speaker1VoiceId in sync with user's verified cloned voice
  useEffect(() => {
    if (userClonedVoiceId) {
      setSpeaker1VoiceId(userClonedVoiceId);
    }
  }, [userClonedVoiceId]);

  // Speaker 2 (Guest / Expert) - Default to genuine female voice Aziza (Kore)
  const [speaker2GenderFilter, setSpeaker2GenderFilter] = useState<'all' | 'female' | 'male'>('female');
  const [speaker2VoiceId, setSpeaker2VoiceId] = useState<string>(() => {
    const aziza = voices.find((v) => v.id === 'aziza-ai' || v.baseVoice === 'Kore') || voices[1] || voices[0];
    return aziza?.id || 'aziza-ai';
  });
  const [speaker2Name, setSpeaker2Name] = useState<string>('Aziza');
  const [speaker2Role, setSpeaker2Role] = useState<string>('AI & Fan Eksperti');
  const [speaker2Gender, setSpeaker2Gender] = useState<'female' | 'male'>('female');
  const [speaker2Tempo, setSpeaker2Tempo] = useState<string>('1.0x');
  const [speaker2Timbre, setSpeaker2Timbre] = useState<string>('Mayin & Intellektual');
  const [speaker2Emotion, setSpeaker2Emotion] = useState<string>('thoughtful');

  // Preview testing for speakers
  const [previewingSpeaker, setPreviewingSpeaker] = useState<'host1' | 'host2' | null>(null);
  const speakerPreviewAudioRef = useRef<HTMLAudioElement | null>(null);

  const speaker1Profile = voices.find((v) => v.id === speaker1VoiceId) || voices[0];
  const speaker2Profile =
    voices.find((v) => v.id === speaker2VoiceId) ||
    voices.find((v) => (speaker2Gender === 'female' ? v.gender === 'female' || v.baseVoice === 'Kore' || v.baseVoice === 'Aoede' : v.gender === 'male')) ||
    voices.find((v) => v.id === 'aziza-ai' || v.baseVoice === 'Kore') ||
    voices.find((v) => v.gender === 'female') ||
    voices[1];

  const handleSelectSpeaker2Voice = (vId: string) => {
    setSpeaker2VoiceId(vId);
    const chosen = voices.find((v) => v.id === vId);
    if (chosen) {
      const isFemale = chosen.gender === 'female' || chosen.baseVoice === 'Kore' || chosen.baseVoice === 'Aoede';
      setSpeaker2Gender(isFemale ? 'female' : 'male');
      if (chosen.tempo) setSpeaker2Tempo(chosen.tempo.match(/[\d.]+x/)?.[0] || '1.0x');
      if (chosen.timbre) setSpeaker2Timbre(chosen.timbre);

      if (chosen.name.includes('Aziza')) {
        setSpeaker2Name('Aziza');
        setSpeaker2Role('AI & Fan Eksperti');
      } else if (chosen.name.includes('Madina')) {
        setSpeaker2Name('Madina');
        setSpeaker2Role('Jurnalist & Podkaster');
      } else if (chosen.name.includes('Dilnoza')) {
        setSpeaker2Name('Dilnoza');
        setSpeaker2Role('Psixolog & Bloger');
      } else if (chosen.name.includes('Zarina')) {
        setSpeaker2Name('Zarina');
        setSpeaker2Role('Adabiyot & Madaniyat');
      } else if (chosen.name.includes('Nodira')) {
        setSpeaker2Name('Nodira');
        setSpeaker2Role('Biznes & Tahlilchi');
      } else if (chosen.name.includes('Malika')) {
        setSpeaker2Name('Malika');
        setSpeaker2Role('Startap & Innovatsiya');
      } else if (chosen.name.includes('Jasur')) {
        setSpeaker2Name('Jasur');
        setSpeaker2Role('Tadbirkor & Biznes Ekspert');
      } else if (chosen.name.includes('Otabek')) {
        setSpeaker2Name('Otabek');
        setSpeaker2Role('Quvnoq Boshlovchi');
      } else if (chosen.name.includes('Ulug\'bek')) {
        setSpeaker2Name('Ulug\'bek');
        setSpeaker2Role('Tarixchi & Professor');
      } else if (chosen.name.includes('Farrux')) {
        setSpeaker2Name('Farrux');
        setSpeaker2Role('IT Muhandis');
      } else if (chosen.name.includes('Bobur')) {
        setSpeaker2Name('Bobur');
        setSpeaker2Role('Motivator & Spiker');
      }
    }
  };

  const handleTestSpeakerVoice = async (speaker: 'host1' | 'host2') => {
    if (previewingSpeaker === speaker) {
      if (speakerPreviewAudioRef.current) {
        speakerPreviewAudioRef.current.pause();
      }
      setPreviewingSpeaker(null);
      return;
    }

    try {
      setPreviewingSpeaker(speaker);
      const isH1 = speaker === 'host1';
      const prof = isH1 ? speaker1Profile : speaker2Profile;
      const previewUrl =
        prof?.sampleAudioUrl ||
        (prof?.id ? getVoicePreviewUrl(prof.id) : undefined) ||
        (prof?.id ? `/api/voices/preview/${prof.id}` : undefined);

      if (previewUrl) {
        const audio = new Audio(previewUrl);
        speakerPreviewAudioRef.current = audio;
        audio.onended = () => setPreviewingSpeaker(null);
        audio.onerror = () => setPreviewingSpeaker(null);
        await audio.play();
        return;
      }

      const spkName = prof?.name || (isH1 ? speaker1Name : speaker2Name);
      const isFemaleSpeaker = prof?.gender === 'female' || prof?.baseVoice === 'Kore' || prof?.baseVoice === 'Aoede';

      const sampleText = isH1
        ? `Assalomu alaykum! Men ${spkName}man. Bugungi intervyu podkastimizga xush kelibsiz.`
        : isFemaleSpeaker
        ? `Salom! Men ${spkName} bo'laman. Bugungi qiziqarli suhbatda qatnashishdan judayam mamnunman.`
        : `Assalomu alaykum! Men ${spkName}man. Bugungi intervyuda dolzarb savollarga javob berishga tayyorman.`;

      const res = await fetch('/api/podcast/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: sampleText,
          voiceProfile: {
            voiceName: spkName,
            voiceId: prof?.voiceId || prof?.id,
            baseVoice: prof?.baseVoice || (isFemaleSpeaker ? 'Kore' : 'Charon'),
            timbre: isH1 ? prof?.timbre : speaker2Timbre || prof?.timbre,
            tempo: isH1 ? speaker1Tempo : speaker2Tempo,
            customPersonaPrompt: prof?.customPersonaPrompt,
          },
        }),
      });

      if (!res.ok) throw new Error('Ovoz sintezida xato');
      const data = await res.json();
      if (data.audioBase64) {
        const audio = new Audio(`data:audio/wav;base64,${data.audioBase64}`);
        speakerPreviewAudioRef.current = audio;
        audio.onended = () => setPreviewingSpeaker(null);
        audio.play().catch(console.warn);
      } else {
        setPreviewingSpeaker(null);
      }
    } catch (err) {
      console.warn('Speaker voice test error:', err);
      setPreviewingSpeaker(null);
    }
  };

  const [topic, setTopic] = useState<string>(
    initialTopic || 'Sun\'iy intellekt va inson tafakkuri: Kim kimni boshqaradi?'
  );
  const [tone, setTone] = useState<string>('Jonli va intellektual bahs');

  const [targetDuration, setTargetDuration] = useState<string>('30 daqiqa');
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [isExpandingDialogue, setIsExpandingDialogue] = useState(false);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  // Turns
  const [turns, setTurns] = useState<DialogueTurn[]>(() => {
    if (initialTurns && initialTurns.length > 0) return initialTurns;
    return [
      {
        id: 'turn-1',
        speakerId: 'HOST_1',
        speakerName: 'Shokhrukh',
        text: 'Assalomu alaykum aziz do\'stlar! Bugun studiyamizda sun\'iy intellekt bo\'yicha yetakchi mutaxassis Aziza mehmon. Xush kelibsiz!',
        emotion: 'excited',
        musicCue: {
          enabled: true,
          cueType: 'intro',
          soundscape: 'midnight-jazz',
          volumePercent: 35,
          labelUz: 'Kirish Jingle (Intro)',
          labelRu: 'Вступительный джингл',
          reasoning: 'Epizod boshida 6-8s dinamik jingle, boshlovchi salomi ostida pasayadi.',
        },
      },
      {
        id: 'turn-2',
        speakerId: 'HOST_2',
        speakerName: 'Aziza',
        text: 'Va alaykum assalom, Shokhrukh! Taklif uchun katta rahmat. Bugungi mavzu haqiqatan ham har birimizning kelajagimizga taalluqli.',
        emotion: 'thoughtful',
        musicCue: {
          enabled: false,
          cueType: 'silence',
          soundscape: 'none',
          volumePercent: 0,
          labelUz: 'Toza ovoz (Silence)',
          labelRu: 'Чистый голос (без музыки)',
          reasoning: 'Suhbatning asosiy qismida 100% toza nutq va diqqatni jamlash uchun musiqasiz.',
        },
      },
      {
        id: 'turn-3',
        speakerId: 'HOST_1',
        speakerName: 'Shokhrukh',
        text: 'Ayting-chi, ko\'pchilik sun\'iy intellekt inson kasblarini yo\'q qiladi deb qo\'rqmoqda. Bu qo\'rquv qanchalik to\'g\'ri?',
        emotion: 'skeptical',
        musicCue: {
          enabled: true,
          cueType: 'stinger',
          soundscape: 'tech-ambient',
          volumePercent: 25,
          labelUz: "O'tish Stingeri",
          labelRu: 'Переходной акцент',
          reasoning: "Dolzarb bahsli savolga o'tishda 2 soniyalik qisqa kiber-stinger.",
        },
      },
      {
        id: 'turn-4',
        speakerId: 'HOST_2',
        speakerName: 'Aziza',
        text: 'Aslida AI insonni almashtirmaydi, balki AIdan unumli foydalangan inson boshqa mutaxassislardan ancha oldinga o\'tib ketadi.',
        emotion: 'thoughtful',
        musicCue: {
          enabled: true,
          cueType: 'emotional',
          soundscape: 'calm-piano',
          volumePercent: 14,
          labelUz: 'Mayin Pianino Foni',
          labelRu: 'Эмоциональный эмбиент',
          reasoning: 'Kelajak haqidagi chuqur xulosani ta\'kidlash uchun mayin sokin neoklassik fon.',
        },
      },
    ];
  });

  // Sound Director State
  const [soundDirectorStrategy, setSoundDirectorStrategy] = useState<{
    strategyUz: string;
    strategyRu: string;
  } | null>({
    strategyUz: "Professional saund-dizayn: Uzluksiz chalg'ituvchi fon o'rniga dinamik reja tuzildi — kirishda jingle, suhbatda toza ovoz (silence), savol almashganda stinger va xulosada mayin pianino.",
    strategyRu: "Профессиональный саунд-дизайн: Интеллектуальная расстановка — интро-джингл, чистый голос без музыки в диалоге, переходной акцент и эмоциональный эмбиент в финале.",
  });
  const [isPlanningSound, setIsPlanningSound] = useState(false);
  const [dynamicDuckingEnabled, setDynamicDuckingEnabled] = useState(true);

  // Sync when initialTurns changes (e.g. from Document/PDF analysis)
  useEffect(() => {
    if (initialTurns && initialTurns.length > 0) {
      setTurns(initialTurns);
    }
  }, [initialTurns]);

  useEffect(() => {
    if (initialTopic) {
      setTopic(initialTopic);
    }
  }, [initialTopic]);

  // Synthesis results
  const [masterAudioBase64, setMasterAudioBase64] = useState<string | null>(null);
  const [totalDuration, setTotalDuration] = useState<number>(0);
  const [synthesizedTurns, setSynthesizedTurns] = useState<DialogueTurn[]>([]);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [activeTurnIndex, setActiveTurnIndex] = useState<number>(-1);

  // Ambient Soundscape for Interviews
  const [ambientSound, setAmbientSound] = useState<AmbientSoundscape>('midnight-jazz');
  const [ambientEnabled, setAmbientEnabled] = useState<boolean>(true);
  const [ambientVolume, setAmbientVolume] = useState<number>(18);
  const ambientAudioRef = useRef<HTMLAudioElement | null>(null);

  // Maintain ambient loop in DialogueStudio
  useEffect(() => {
    if (ambientSound === 'none') {
      if (ambientAudioRef.current) {
        ambientAudioRef.current.pause();
        ambientAudioRef.current.src = '';
      }
      return;
    }

    try {
      const ctx = getAudioContext();
      const buf = generateAmbientAudioBuffer(ctx, 16.0, ambientSound);
      const blob = audioBufferToWav(buf, ctx.sampleRate);
      const url = URL.createObjectURL(blob);

      if (!ambientAudioRef.current) {
        ambientAudioRef.current = new Audio(url);
      } else {
        ambientAudioRef.current.src = url;
      }
      ambientAudioRef.current.loop = true;
      ambientAudioRef.current.volume = Math.max(0, Math.min(1, (ambientVolume / 100) * 0.65));

      if (isPlaying && ambientEnabled) {
        ambientAudioRef.current.play().catch(() => {});
      }

      return () => {
        URL.revokeObjectURL(url);
      };
    } catch (e) {
      console.error('Failed to create dialogue ambient audio loop:', e);
    }
  }, [ambientSound]);

  useEffect(() => {
    if (ambientAudioRef.current) {
      ambientAudioRef.current.volume = Math.max(0, Math.min(1, (ambientVolume / 100) * 0.65));
    }
  }, [ambientVolume]);

  // Individual turn audio player
  const [playingTurnId, setPlayingTurnId] = useState<string | null>(null);
  const singleAudioRef = useRef<HTMLAudioElement | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Generate dialogue script
  const handleGenerateInterview = async () => {
    if (
      !requireAuth(
        () => {},
        lang === 'uz'
          ? "2 kishilik intervyu ssenariysini yaratish faqat ro'yxatdan o'tgan foydalanuvchilar uchun ochiq. Avval tizimga kiring!"
          : "Генерация диалога доступна только для зарегистрированных пользователей."
      )
    )
      return;

    setIsGeneratingScript(true);
    try {
      const res = await fetch('/api/podcast/generate-interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          host1Name: speaker1Name,
          host1Role: speaker1Role || 'Boshlovchi',
          host2Name: speaker2Name,
          host2Role: speaker2Role || 'Mehmon',
          tone,
          targetDuration,
        }),
      });

      if (!res.ok) throw new Error('Intervyu yaratishda xatolik');
      const data = await res.json();
      if (Array.isArray(data.turns) && data.turns.length > 0) {
        setTurns(
          data.turns.map((t: any, idx: number) => ({
            id: `turn-${idx + 1}-${Date.now()}`,
            speakerId: t.speakerId === 'HOST_2' ? 'HOST_2' : 'HOST_1',
            speakerName: t.speakerName || (t.speakerId === 'HOST_2' ? speaker2Name : speaker1Name),
            text: t.text,
            emotion: t.emotion || 'neutral',
          }))
        );
      }
    } catch (e: any) {
      alert(`Xatolik: ${e.message}`);
    } finally {
      setIsGeneratingScript(false);
    }
  };

  // Expand interview with +8 new deep turns (+15 minutes)
  const handleExpandInterview = async () => {
    setIsExpandingDialogue(true);
    try {
      const res = await fetch('/api/podcast/expand-interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          host1Name: speaker1Name,
          host2Name: speaker2Name,
          existingTurns: turns,
          subtopic: 'Keyingi chuqur savollar, bahsli faktlar va hayotiy misollar',
        }),
      });

      if (!res.ok) throw new Error('Intervyuni kengaytirishda xato');
      const data = await res.json();
      if (Array.isArray(data.newTurns) && data.newTurns.length > 0) {
        const added = data.newTurns.map((t: any, idx: number) => ({
          id: `turn-exp-${Date.now()}-${idx}`,
          speakerId: t.speakerId === 'HOST_2' ? 'HOST_2' : 'HOST_1',
          speakerName: t.speakerName || (t.speakerId === 'HOST_2' ? speaker2Name : speaker1Name),
          text: t.text,
          emotion: t.emotion || 'thoughtful',
        }));
        setTurns((prev) => [...prev, ...added]);
      }
    } catch (e: any) {
      alert(`Xatolik: ${e.message}`);
    } finally {
      setIsExpandingDialogue(false);
    }
  };

  // Add empty turn
  const addTurn = () => {
    const lastSpeaker = turns[turns.length - 1]?.speakerId;
    const nextSpeaker = lastSpeaker === 'HOST_1' ? 'HOST_2' : 'HOST_1';
    const nextName = nextSpeaker === 'HOST_1' ? speaker1Name : speaker2Name;

    setTurns([
      ...turns,
      {
        id: `turn-${Date.now()}`,
        speakerId: nextSpeaker,
        speakerName: nextName,
        text: '',
        emotion: 'neutral',
      },
    ]);
  };

  // Remove turn
  const removeTurn = (id: string) => {
    if (turns.length <= 2) {
      alert('Kamida 2 ta replika bo\'lishi kerak!');
      return;
    }
    setTurns(turns.filter((t) => t.id !== id));
  };

  // Update turn text
  const updateTurnText = (id: string, text: string) => {
    setTurns(turns.map((t) => (t.id === id ? { ...t, text } : t)));
  };

  // Toggle speaker for turn
  const toggleTurnSpeaker = (id: string) => {
    setTurns(
      turns.map((t) => {
        if (t.id !== id) return t;
        const newSpeakerId = t.speakerId === 'HOST_1' ? 'HOST_2' : 'HOST_1';
        return {
          ...t,
          speakerId: newSpeakerId,
          speakerName: newSpeakerId === 'HOST_1' ? speaker1Name : speaker2Name,
        };
      })
    );
  };

  // Clean all turns from bracketed conditions and timing tags
  const handleCleanAllTurns = () => {
    setTurns((prev) =>
      prev.map((t) => ({
        ...t,
        text: stripAllStageConditions(t.text),
      }))
    );
  };

  // Clean single turn
  const handleCleanSingleTurn = (turnId: string) => {
    setTurns((prev) =>
      prev.map((t) =>
        t.id === turnId ? { ...t, text: stripAllStageConditions(t.text) } : t
      )
    );
  };

  // Synthesize Dialogue
  const handleSynthesizeDialogue = async () => {
    if (
      !requireAuth(
        () => {},
        lang === 'uz'
          ? "2 kishilik intervyu ovozini yaratish faqat ro'yxatdan o'tgan foydalanuvchilar uchun ochiq. Begonalar bepul API limitlarini sarflay olmaydi. Avval kiring!"
          : "Синтез диалога доступен только для зарегистрированных пользователей."
      )
    )
      return;

    const invalidTurn = turns.find((t) => !t.text.trim());
    if (invalidTurn) {
      alert('Barcha replikalar uchun matn kiritilishi lozim!');
      return;
    }

    setIsSynthesizing(true);
    try {
      const res = await fetch('/api/podcast/synthesize-dialogue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          turns,
          host1Voice: {
            voiceId: speaker1Profile?.voiceId || speaker1Profile?.id || 'voice_17raj9ewke3g',
            baseVoice: speaker1Profile?.baseVoice || 'Charon',
            gender: 'male',
            tempo: speaker1Tempo,
          },
          host2Voice: {
            voiceId: speaker2Profile?.voiceId || speaker2Profile?.id,
            baseVoice: speaker2Profile?.baseVoice || (speaker2Gender === 'female' ? 'Kore' : 'Charon'),
            gender: speaker2Gender,
            tempo: speaker2Tempo,
            timbre: speaker2Timbre || speaker2Profile?.timbre,
            customPersonaPrompt: speaker2Profile?.customPersonaPrompt,
            role: speaker2Role,
          },
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Muloqot sintezida xatolik');
      }

      const data = await res.json();
      setMasterAudioBase64(data.masterAudioBase64);
      setTotalDuration(data.totalDurationSeconds || 0);
      setSynthesizedTurns(data.turns || []);
      setIsPlaying(false);
      setActiveTurnIndex(-1);

      // Deduct credit & record generation
      await useCredit(1);
      await logGeneration('podcast', topic || '2 Ovozli Intervyu', 1);
    } catch (e: any) {
      alert(`Xatolik: ${e.message}`);
    } finally {
      setIsSynthesizing(false);
    }
  };

  // Master audio playback tracking
  const [masterCurrentTime, setMasterCurrentTime] = useState(0);

  const toggleMasterPlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      ambientAudioRef.current?.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      if (ambientEnabled && ambientSound !== 'none') {
        ambientAudioRef.current?.play().catch(console.warn);
      }
      setIsPlaying(true);
    }
  };

  // Play individual turn with auto-advance to next turn
  const playSingleTurn = (turnId: string, audioBase64?: string) => {
    if (!audioBase64) return;
    if (playingTurnId === turnId) {
      singleAudioRef.current?.pause();
      setPlayingTurnId(null);
      return;
    }

    if (singleAudioRef.current) {
      singleAudioRef.current.pause();
    }
    const audio = new Audio(`data:audio/wav;base64,${audioBase64}`);
    singleAudioRef.current = audio;
    setPlayingTurnId(turnId);

    audio.onended = () => {
      setPlayingTurnId(null);
      // Auto-advance to next turn
      const currentIdx = turns.findIndex((t) => t.id === turnId);
      if (currentIdx !== -1 && currentIdx < turns.length - 1) {
        const nextTurn = turns[currentIdx + 1];
        const nextAudio = synthesizedTurns.find((st) => st.id === nextTurn.id)?.audioBase64;
        if (nextAudio) {
          playSingleTurn(nextTurn.id, nextAudio);
        }
      }
    };
    audio.play().catch(console.warn);
  };

  // Sound Director AI Planner
  const handlePlanSoundDirector = async () => {
    setIsPlanningSound(true);
    try {
      const res = await fetch('/api/podcast/sound-director', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          turns,
          topic,
          category: 'Intervyu & Muloqot',
          preferredSoundscape: ambientSound,
        }),
      });

      if (!res.ok) throw new Error('Sound director request failed');
      const data = await res.json();
      if (data.strategyUz) {
        setSoundDirectorStrategy({
          strategyUz: data.strategyUz,
          strategyRu: data.strategyRu,
        });
      }

      if (Array.isArray(data.cues) && data.cues.length > 0) {
        setTurns((prev) =>
          prev.map((turn, idx) => {
            const cue = data.cues.find((c: any) => c.turnIndex === idx) || data.cues[idx];
            if (!cue) return turn;
            return {
              ...turn,
              musicCue: {
                enabled: cue.cueType !== 'silence' && cue.volumePercent > 0,
                cueType: cue.cueType,
                soundscape: cue.soundscape,
                volumePercent: cue.volumePercent,
                labelUz: cue.labelUz,
                labelRu: cue.labelRu,
                reasoning: cue.reasoning,
              },
            };
          })
        );
      }
    } catch (err) {
      console.warn('Fallback to local sound director:', err);
      const localCues = autoPlanPodcastCues(totalDuration || 60, turns.length, ambientSound);
      setTurns((prev) =>
        prev.map((turn, idx) => {
          const cue = localCues[idx];
          if (!cue) return turn;
          return {
            ...turn,
            musicCue: {
              enabled: cue.cueType !== 'silence' && cue.volumePercent > 0,
              cueType: cue.cueType,
              soundscape: cue.soundscape,
              volumePercent: cue.volumePercent,
              labelUz: cue.labelUz,
              labelRu: cue.labelRu,
              reasoning: cue.reasoning,
            },
          };
        })
      );
    } finally {
      setIsPlanningSound(false);
    }
  };

  // Turn Cue Updater
  const handleUpdateTurnCue = (turnId: string, cueType: SoundCueType, soundscape?: AmbientSoundscape) => {
    setTurns((prev) =>
      prev.map((t) => {
        if (t.id !== turnId) return t;
        const isSilence = cueType === 'silence';
        const snd = soundscape || (isSilence ? 'none' : t.musicCue?.soundscape || ambientSound);
        return {
          ...t,
          musicCue: {
            enabled: !isSilence,
            cueType,
            soundscape: snd,
            volumePercent: isSilence ? 0 : cueType === 'intro' || cueType === 'outro' ? 35 : cueType === 'stinger' ? 25 : 14,
            labelUz: isSilence
              ? 'Toza ovoz (Musiqasiz)'
              : cueType === 'intro'
              ? 'Kirish Jingle'
              : cueType === 'stinger'
              ? "O'tish Stingeri"
              : cueType === 'emotional'
              ? 'Mayin Fon (Bed)'
              : cueType === 'outro'
              ? 'Xulosa Outro'
              : 'Fon Musiqasi',
            labelRu: isSilence
              ? 'Чистый голос (без музыки)'
              : cueType === 'intro'
              ? 'Вступительный джингл'
              : cueType === 'stinger'
              ? 'Переходной акцент'
              : cueType === 'emotional'
              ? 'Эмоциональный эмбиент'
              : cueType === 'outro'
              ? 'Финал и аутро'
              : 'Фоновая музыка',
            reasoning: isSilence
              ? 'Sukunat: nutqning maksimal tiniqligi uchun musiqasiz.'
              : `${snd} musiqasi tanlandi.`,
          },
        };
      })
    );
  };

  // Sync turn highlight with audio currentTime and apply dynamic cue ducking
  const handleTimeUpdate = () => {
    if (!audioRef.current || synthesizedTurns.length === 0) return;
    const curr = audioRef.current.currentTime;
    setMasterCurrentTime(curr);
    const activeIdx = synthesizedTurns.findIndex(
      (t) => curr >= (t.startTime || 0) && curr <= (t.endTime || 0) + 0.3
    );
    setActiveTurnIndex(activeIdx);

    // Dynamic Sound Design Ducking during playback:
    if (dynamicDuckingEnabled && ambientAudioRef.current && activeIdx >= 0) {
      const activeTurn = turns[activeIdx];
      const cue = activeTurn?.musicCue;
      if (cue) {
        if (!cue.enabled || cue.cueType === 'silence' || cue.soundscape === 'none' || cue.volumePercent <= 0) {
          ambientAudioRef.current.volume = 0; // Pure dry silence!
        } else {
          const factor = (cue.volumePercent / 100) * 0.65;
          ambientAudioRef.current.volume = Math.max(0, Math.min(1, factor));
        }
      }
    }
  };

  // Save Dialogue to CMS
  const handleSaveToCMS = () => {
    if (!onSaveToCMS) return;

    const fullScript = turns
      .map((t) => `[${t.speakerName}]: ${t.text}`)
      .join('\n\n');

    onSaveToCMS({
      title: `Intervyu: ${topic.slice(0, 45)}`,
      category: 'Intervyu & Muloqot',
      description: `${speaker1Name} va ${speaker2Name} o'rtasidagi 2 kishilik podkast intervyusi.`,
      tags: ['Intervyu', 'MultiSpeaker', 'Dialog', 'Gemini38'],
      script: fullScript,
      voiceName: `${speaker1Name} & ${speaker2Name}`,
      durationSeconds: totalDuration || 60,
      rawAudioWavBase64: masterAudioBase64 || '',
      ambientSound,
      ambientVolume: ambientEnabled ? ambientVolume : 0,
    });

    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const downloadMasterAudio = async () => {
    if (!masterAudioBase64) return;
    try {
      const rawBuf = base64ToArrayBuffer(masterAudioBase64);
      let downloadBlob: Blob;
      if (ambientEnabled && ambientSound !== 'none') {
        const segmentCues: AudioSegmentCue[] = synthesizedTurns.map((st, i) => {
          const turn = turns[i] || turns.find((t) => t.id === st.id);
          const mc = turn?.musicCue;
          return {
            id: `cue-${st.id}`,
            turnIndex: i,
            startTime: st.startTime || 0,
            endTime: st.endTime || totalDuration,
            cueType: mc?.cueType || (i === 0 ? 'intro' : i === synthesizedTurns.length - 1 ? 'outro' : 'silence'),
            soundscape: mc?.soundscape || (mc?.cueType === 'silence' ? 'none' : ambientSound),
            volumePercent: mc?.volumePercent ?? (mc?.cueType === 'silence' ? 0 : 20),
            labelUz: mc?.labelUz || '',
            labelRu: mc?.labelRu || '',
          };
        });

        const { wavBlob } = await mixAudioTracks(rawBuf, ambientSound, ambientVolume, 100, segmentCues);
        downloadBlob = wavBlob;
      } else {
        downloadBlob = new Blob([rawBuf], { type: 'audio/wav' });
      }
      const url = URL.createObjectURL(downloadBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `intervyu-dialog-${Date.now()}.wav`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download error:', err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Banner: Warm Paper & Glass Card */}
      <div className="border border-[rgba(22,21,17,0.14)] rounded-[22px] bg-[rgba(255,255,255,0.52)] backdrop-blur-md p-6 sm:p-7 relative overflow-hidden shadow-[0_30px_50px_-30px_rgba(22,21,17,0.15)]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-5 relative z-10">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-2.5">
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#0A5A62] border border-[rgba(14,124,134,0.35)] rounded-full px-3 py-1 bg-white/60 flex items-center gap-1.5">
                <Users2 className="w-3.5 h-3.5 text-[#0E7C86]" />
                {lang === 'uz' ? 'Multi-Speaker Studiyasi' : 'Мультиспикер Студия'}
              </span>
              <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-[#C4552D] border border-[rgba(196,85,45,0.35)] rounded-full px-2.5 py-0.5 bg-[#C4552D]/5">
                Dual-Voice TTS · Gemini 3.8
              </span>
            </div>
            <h1 className="font-serif text-3xl sm:text-4xl text-[#161511] font-normal tracking-tight leading-tight">
              {lang === 'uz' ? (
                <>2 Boshlovchi va Mehmon <em>Dialogi</em></>
              ) : (
                <>Диалог 2-х Ведущих и <em>Экспертов</em></>
              )}
            </h1>
            <p className="text-[#5D594E] text-sm mt-1.5 max-w-2xl leading-relaxed">
              {lang === 'uz'
                ? 'Oʻz ovozingizni (SHOKHRUKH) boshlovchi sifatida, ikkinchi taklif qilingan ovozni esa mehmon sifatida ulab, toʻliq ketma-ketlikda jonli dialog yarating.'
                : 'Используйте свой голос как ведущего и выберите второй голос для гостя, создавая живой многоголосый диалог.'}
            </p>
          </div>

          {/* Speakers summary pill */}
          <div className="flex items-center gap-2 bg-white/90 border border-[rgba(22,21,17,0.14)] p-2.5 rounded-2xl shadow-xs shrink-0">
            <div className="px-3 py-1.5 bg-[#F4F1EA] rounded-xl border border-[rgba(22,21,17,0.1)] text-xs">
              <span className="text-[10px] text-[#5D594E] block font-mono uppercase tracking-wider">1-Spiker (Siz):</span>
              <span className="font-bold text-[#0A5A62] flex items-center gap-1">
                {speaker1Profile?.name}
                <CheckCircle2 className="w-3 h-3 text-[#0E7C86]" />
              </span>
            </div>
            <span className="text-[#161511]/30 font-bold">&</span>
            <div className="px-3 py-1.5 bg-[#FAF8F3] rounded-xl border border-[rgba(196,85,45,0.25)] text-xs">
              <span className="text-[10px] text-[#5D594E] block font-mono uppercase tracking-wider">2-Spiker (Mehmon):</span>
              <span className="font-bold text-[#C4552D]">{speaker2Profile?.name}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Speaker Configuration & Script Builder (8 cols) */}
        <div className="lg:col-span-8 space-y-6">
          {/* STEP 1: Dialogue Topic & AI Script Generator + Document Upload */}
          <div className="border border-[rgba(22,21,17,0.14)] rounded-[20px] bg-[rgba(255,255,255,0.52)] backdrop-blur-sm p-6 space-y-4 shadow-[0_30px_50px_-30px_rgba(22,21,17,0.15)]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#0A5A62] flex-1">
                <span>01 — Dialog mavzusi va ssenariy</span>
                <span className="h-[1px] flex-1 bg-[rgba(22,21,17,0.14)] mr-3" />
              </div>

              {onOpenDocumentModal && (
                <button
                  type="button"
                  onClick={onOpenDocumentModal}
                  className="btn-pill btn-ghost text-xs px-3.5 py-1.5 flex items-center gap-1.5 shrink-0"
                >
                  <Upload className="w-3.5 h-3.5 text-[#0E7C86]" />
                  <span>{lang === 'uz' ? 'PDF / Maqoladan' : 'Из PDF/Статьи'}</span>
                </button>
              )}
            </div>

            {/* Duration Selector & Timing Info */}
            <div className="p-3.5 bg-white border border-[rgba(22,21,17,0.14)] rounded-xl space-y-2.5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#161511] flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-[#0E7C86]" />
                  {lang === 'uz' ? 'Intervyu Davomiyligi:' : 'Длительность интервью:'}
                </span>
                <span className="text-[11px] font-mono text-[#5D594E]">
                  {turns.length} {lang === 'uz' ? 'replika' : 'реплик'} · ~{Math.max(1, Math.round(turns.reduce((acc, t) => acc + t.text.trim().split(/\s+/).filter(Boolean).length, 0) / 125))} {lang === 'uz' ? 'daqiqa' : 'мин'}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { id: '15 daqiqa', label: '15 daq', desc: '18 ta replika' },
                  { id: '30 daqiqa', label: '30 daqiqa', desc: '26 ta replika' },
                  { id: '45 daqiqa', label: '45 daqiqa', desc: '36 ta replika' },
                  { id: '60 daqiqa (1 soat)', label: '60 daqiqa (1 soat)', desc: 'Katta intervyu' },
                ].map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setTargetDuration(d.id)}
                    className={`btn-pill text-xs py-1.5 px-3.5 transition-all cursor-pointer ${
                      targetDuration === d.id
                        ? 'bg-[#161511] text-[#F4F1EA] font-semibold border-[#161511]'
                        : 'bg-transparent border-[rgba(22,21,17,0.14)] text-[#5D594E] hover:border-[#161511] hover:text-[#161511]'
                    }`}
                  >
                    <div>{d.label}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder={lang === 'uz' ? "Intervyu mavzusi (masalan: Sun'iy intellekt kelajagi va O'zbekiston)..." : "Тема интервью..."}
                className="flex-1 bg-white border border-[rgba(22,21,17,0.14)] rounded-xl px-4 py-2.5 text-xs sm:text-sm text-[#161511] placeholder:text-[#5D594E]/60 focus:outline-none focus:border-[#0E7C86]"
              />
              <button
                onClick={handleGenerateInterview}
                disabled={isGeneratingScript || !topic.trim()}
                className="btn-pill btn-solid text-xs py-2.5 px-4 flex items-center justify-center gap-1.5 shrink-0"
              >
                <Sparkles className={`w-3.5 h-3.5 text-[#5CC8CF] ${isGeneratingScript ? 'animate-spin' : ''}`} />
                {isGeneratingScript ? (lang === 'uz' ? 'Yozilmoqda...' : 'Генерация...') : (lang === 'uz' ? `AI Intervyu Matni (${targetDuration})` : `AI Диалог (${targetDuration})`)}
              </button>
              <button
                onClick={handleExpandInterview}
                disabled={isExpandingDialogue || turns.length === 0}
                className="btn-pill btn-ghost text-xs py-2.5 px-3.5 flex items-center justify-center gap-1.5 shrink-0 text-[#C4552D] border-[rgba(196,85,45,0.4)]"
                title="Suhbatni yana 15 daqiqaga kengaytirish"
              >
                <Sparkles className={`w-3.5 h-3.5 ${isExpandingDialogue ? 'animate-spin' : ''}`} />
                {isExpandingDialogue ? (lang === 'uz' ? 'Kengaytirilmoqda...' : 'Расширение...') : (lang === 'uz' ? '+15 daq' : '+15 мин')}
              </button>
            </div>
          </div>

          {/* STEP 2: Speakers Selector Card */}
          <div className="border border-[rgba(22,21,17,0.14)] rounded-[20px] bg-[rgba(255,255,255,0.52)] backdrop-blur-sm p-6 space-y-4 shadow-[0_30px_50px_-30px_rgba(22,21,17,0.15)]">
            <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#0A5A62]">
              <span>02 — Ishtirokchilar va ularning ovozlari</span>
              <span className="h-[1px] flex-1 bg-[rgba(22,21,17,0.14)]" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Speaker 1 (Host - User's Voice) */}
              <div className="p-4 rounded-2xl bg-white border border-[rgba(22,21,17,0.14)] space-y-3 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#0A5A62] flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5" /> 1-Boshlovchi (Oʻzingiz)
                  </span>
                  <span className="text-[10px] font-mono text-[#0E7C86] border border-[#0E7C86]/30 px-2 py-0.5 rounded-full bg-[#0E7C86]/5">
                    Haqiqiy Klon Ovoz
                  </span>
                </div>

                <div>
                  <label className="text-[10px] uppercase font-mono text-[#5D594E] block mb-1">
                    {lang === 'uz' ? 'Spiker Ismi:' : 'Имя спикера:'}
                  </label>
                  <input
                    type="text"
                    value={speaker1Name}
                    onChange={(e) => setSpeaker1Name(e.target.value)}
                    className="w-full bg-[#F4F1EA]/50 border border-[rgba(22,21,17,0.14)] rounded-xl px-3 py-1.5 text-xs text-[#161511] focus:outline-none focus:border-[#0E7C86]"
                    placeholder="Masalan: Shokhrukh"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] uppercase font-mono text-[#5D594E]">
                      {lang === 'uz' ? 'Tanlangan Ovoz:' : 'Выбранный голос:'}
                    </label>
                    <button
                      type="button"
                      onClick={() => handleTestSpeakerVoice('host1')}
                      className="text-[11px] text-[#0E7C86] hover:underline flex items-center gap-1 cursor-pointer transition-colors"
                      title={lang === 'uz' ? 'Ovoz namunasini tinglash (0s kutish, tekin)' : 'Прослушать голос'}
                    >
                      {previewingSpeaker === 'host1' ? (
                        <>
                          <Pause className="w-3 h-3 animate-spin" />
                          <span>{lang === 'uz' ? "To'xtatish" : 'Стоп'}</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3 h-3 fill-current" />
                          <span>{lang === 'uz' ? 'Namuna (0s)' : 'Прослушать'}</span>
                        </>
                      )}
                    </button>
                  </div>
                  <select
                    value={speaker1VoiceId}
                    onChange={(e) => setSpeaker1VoiceId(e.target.value)}
                    className="w-full bg-[#F4F1EA]/50 border border-[rgba(22,21,17,0.14)] rounded-xl px-3 py-1.5 text-xs text-[#161511] focus:outline-none focus:border-[#0E7C86] cursor-pointer"
                  >
                    {voices.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} {v.isReplicatedVoice || v.id.includes('17raj9') ? '★ (Ovoz Nusxam)' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Speaker 1 Tempo */}
                <div>
                  <label className="text-[10px] uppercase font-mono text-[#5D594E] block mb-1.5">
                    {lang === 'uz' ? 'Nutq Tempi (Tezligi):' : 'Темп речи:'}
                  </label>
                  <div className="grid grid-cols-4 gap-1">
                    {['0.85x', '1.0x', '1.1x', '1.2x'].map((tVal) => (
                      <button
                        key={tVal}
                        type="button"
                        onClick={() => setSpeaker1Tempo(tVal)}
                        className={`py-1 px-1.5 text-[11px] rounded-lg font-mono transition-all text-center cursor-pointer ${
                          speaker1Tempo === tVal
                            ? 'bg-[#161511] text-[#F4F1EA] font-bold'
                            : 'bg-[#F4F1EA]/60 text-[#5D594E] hover:text-[#161511] border border-[rgba(22,21,17,0.1)]'
                        }`}
                      >
                        {tVal}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Speaker 2 (Guest / Aziza) */}
              <div className="p-4 rounded-2xl bg-white border border-[rgba(196,85,45,0.3)] space-y-3 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#C4552D] flex items-center gap-1.5">
                    <Bot className="w-3.5 h-3.5" /> 2-Mehmon / Ekspert
                  </span>
                  <div className="flex items-center gap-1 bg-[#F4F1EA] p-0.5 rounded-lg border border-[rgba(22,21,17,0.1)]">
                    <button
                      type="button"
                      onClick={() => setSpeaker2GenderFilter('all')}
                      className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                        speaker2GenderFilter === 'all'
                          ? 'bg-[#161511] text-[#F4F1EA] font-bold'
                          : 'text-[#5D594E] hover:text-[#161511]'
                      }`}
                    >
                      Barchasi
                    </button>
                    <button
                      type="button"
                      onClick={() => setSpeaker2GenderFilter('female')}
                      className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                        speaker2GenderFilter === 'female'
                          ? 'bg-[#C4552D] text-white font-bold'
                          : 'text-[#5D594E] hover:text-[#161511]'
                      }`}
                    >
                      Ayollar (Kore)
                    </button>
                    <button
                      type="button"
                      onClick={() => setSpeaker2GenderFilter('male')}
                      className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                        speaker2GenderFilter === 'male'
                          ? 'bg-[#0E7C86] text-white font-bold'
                          : 'text-[#5D594E] hover:text-[#161511]'
                      }`}
                    >
                      Erkaklar
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] uppercase font-mono text-[#5D594E] block mb-1">
                      {lang === 'uz' ? 'Ismi:' : 'Имя:'}
                    </label>
                    <input
                      type="text"
                      value={speaker2Name}
                      onChange={(e) => setSpeaker2Name(e.target.value)}
                      className="w-full bg-[#F4F1EA]/50 border border-[rgba(22,21,17,0.14)] rounded-xl px-2.5 py-1.5 text-xs text-[#161511] focus:outline-none focus:border-[#C4552D]"
                      placeholder="Aziza"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-mono text-[#5D594E] block mb-1">
                      {lang === 'uz' ? 'Roli / Kasbi:' : 'Роль / Профессия:'}
                    </label>
                    <input
                      type="text"
                      value={speaker2Role}
                      onChange={(e) => setSpeaker2Role(e.target.value)}
                      className="w-full bg-[#F4F1EA]/50 border border-[rgba(22,21,17,0.14)] rounded-xl px-2.5 py-1.5 text-xs text-[#161511] focus:outline-none focus:border-[#C4552D]"
                      placeholder="AI & Fan Eksperti"
                    />
                  </div>
                </div>

                {/* Speaker 2 Voice Select & Preview Button */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] uppercase font-mono text-[#5D594E]">
                      {lang === 'uz' ? "Mehmon Ovozi (O'zbekcha):" : 'Голос гостя:'}
                    </label>
                    <button
                      type="button"
                      onClick={() => handleTestSpeakerVoice('host2')}
                      className="text-[11px] text-[#FACC15] hover:underline flex items-center gap-1 cursor-pointer transition-colors"
                      title={lang === 'uz' ? 'Ovoz namunasini tinglash (0s kutish, tekin)' : 'Прослушать голос (встроено)'}
                    >
                      {previewingSpeaker === 'host2' ? (
                        <>
                          <Pause className="w-3 h-3 animate-spin" />
                          <span>{lang === 'uz' ? "To'xtatish" : 'Стоп'}</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3 h-3 fill-current" />
                          <span>{lang === 'uz' ? 'Namuna (0s)' : 'Прослушать'}</span>
                        </>
                      )}
                    </button>
                  </div>
                  <select
                    value={speaker2VoiceId}
                    onChange={(e) => handleSelectSpeaker2Voice(e.target.value)}
                    className="w-full bg-[#F4F1EA]/50 border border-[rgba(22,21,17,0.14)] rounded-xl px-3 py-1.5 text-xs text-[#161511] focus:outline-none focus:border-[#C4552D] cursor-pointer"
                  >
                    {voices
                      .filter((v) => {
                        // Exclude the user's custom replicated voice from being selected as the second guest speaker
                        if (v.isReplicatedVoice || v.id.includes('17raj9')) return false;
                        if (speaker2GenderFilter === 'female') return v.gender === 'female' || v.baseVoice === 'Kore' || v.baseVoice === 'Aoede';
                        if (speaker2GenderFilter === 'male') return v.gender === 'male' || v.baseVoice === 'Charon' || v.baseVoice === 'Puck' || v.baseVoice === 'Fenrir';
                        return true;
                      })
                      .map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.gender === 'female' ? '♀ ' : '♂ '}
                          {v.name}
                        </option>
                      ))}
                  </select>
                </div>

                {/* Speaker 2 Tempo & Timbre Controls */}
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[rgba(22,21,17,0.08)]">
                  <div>
                    <label className="text-[10px] uppercase font-mono text-[#5D594E] block mb-1">
                      {lang === 'uz' ? 'Tempi (Tezlik):' : 'Темп речи:'}
                    </label>
                    <div className="grid grid-cols-4 gap-1">
                      {['0.85x', '1.0x', '1.1x', '1.2x'].map((tVal) => (
                        <button
                          key={tVal}
                          type="button"
                          onClick={() => setSpeaker2Tempo(tVal)}
                          className={`py-1 text-[10px] rounded-lg font-mono transition-all text-center cursor-pointer ${
                            speaker2Tempo === tVal
                              ? 'bg-[#161511] text-[#F4F1EA] font-bold'
                              : 'bg-[#F4F1EA]/60 text-[#5D594E] hover:text-[#161511] border border-[rgba(22,21,17,0.1)]'
                          }`}
                        >
                          {tVal}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] uppercase font-mono text-[#5D594E] block mb-1">
                      {lang === 'uz' ? 'Tembr & Ohang:' : 'Тембр / Интонация:'}
                    </label>
                    <select
                      value={speaker2Timbre}
                      onChange={(e) => setSpeaker2Timbre(e.target.value)}
                      className="w-full bg-[#F4F1EA]/50 border border-[rgba(22,21,17,0.14)] rounded-lg px-2 py-1 text-[11px] text-[#161511] focus:outline-none focus:border-[#C4552D] cursor-pointer"
                    >
                      <option value="Mayin & Intellektual">Mayin & Intellektual (Aziza)</option>
                      <option value="Yorqin & Jurnalistik">Yorqin & Jurnalistik (Madina)</option>
                      <option value="Tinchlantiruvchi & Psixologik">Tinchlantiruvchi & Mehrli (Dilnoza)</option>
                      <option value="Nafis & Badiiy Adabiyot">Nafis & Adabiy (Zarina)</option>
                      <option value="Salobatli & Ishbilarmon">Salobatli & Rasmiy (Jasur)</option>
                      <option value="Quvnoq & Hazilomuz">Quvnoq & Dinamik (Otabek)</option>
                      <option value="Epik & Tarixiy Vazmin">Epik & Vazmin (Ulug'bek)</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* STEP 3: Dialogue Turns & AI Sound Director */}
          <div className="border border-[rgba(22,21,17,0.14)] rounded-[20px] bg-[rgba(255,255,255,0.52)] backdrop-blur-sm p-6 space-y-4 shadow-[0_30px_50px_-30px_rgba(22,21,17,0.15)]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#0A5A62] flex-1">
                <span>03 — Suhbat replikalari va ovoz rejissyori</span>
                <span className="h-[1px] flex-1 bg-[rgba(22,21,17,0.14)] mr-3" />
              </div>
              <span className="text-xs font-mono text-[#5D594E]">
                {turns.length} {lang === 'uz' ? 'ta replika' : 'реплик'}
              </span>
            </div>

            {/* Clean Dialogue Actions Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-white border border-[rgba(22,21,17,0.14)] rounded-xl shadow-xs">
              <div className="flex items-center gap-2 text-xs text-[#5D594E]">
                <ShieldCheck className="w-4 h-4 text-[#0E7C86] shrink-0" />
                <span>
                  {lang === 'uz'
                    ? 'Barcha shartlar [Bariton, Pauza] avtomatik diktor tembriga oʻtkaziladi va baland ovozda oʻqilmaydi.'
                    : 'Ремарки в скобках формируют интонацию и не зачитываются вслух.'}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCleanAllTurns}
                  className="btn-pill btn-ghost text-xs py-1.5 px-3 flex items-center gap-1.5"
                  title="Barcha replikalardan skobkalar va ovoz shartlarini tozalash"
                >
                  <Eraser className="w-3.5 h-3.5 text-[#5D594E]" />
                  <span>{lang === 'uz' ? 'Shartlarni tozalash' : 'Очистить условия'}</span>
                </button>
              </div>
            </div>

            {/* Turn by turn list */}
            <div className="space-y-3 pt-2">
              {turns.map((turn, index) => {
                const isHost1 = turn.speakerId === 'HOST_1';
                const isCurrentlyActive = activeTurnIndex === index;
                const turnAudio = synthesizedTurns[index]?.audioBase64;
                const isTurnPlaying = playingTurnId === turn.id;
                const turnConditions = detectScriptConditions(turn.text);

                return (
                  <div
                    key={turn.id}
                    className={`p-4 rounded-2xl border transition-all ${
                      isCurrentlyActive
                        ? 'border-[#0E7C86] bg-[rgba(14,124,134,0.06)] shadow-sm'
                        : isHost1
                        ? 'bg-white border-[rgba(22,21,17,0.14)] border-l-4 border-l-[#0E7C86] shadow-xs'
                        : 'bg-[#FAF8F3] border-[rgba(22,21,17,0.14)] border-l-4 border-l-[#C4552D] shadow-xs'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleTurnSpeaker(turn.id)}
                          className={`btn-pill text-xs py-1 px-3 flex items-center gap-1.5 cursor-pointer font-semibold ${
                            isHost1
                              ? 'bg-[rgba(14,124,134,0.1)] text-[#0A5A62] border border-[rgba(14,124,134,0.3)]'
                              : 'bg-[rgba(196,85,45,0.1)] text-[#C4552D] border border-[rgba(196,85,45,0.3)]'
                          }`}
                          title="Spikerni almashtirish uchun bosing"
                        >
                          {isHost1 ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
                          {turn.speakerName} ({isHost1 ? '1-Boshlovchi (Siz)' : '2-Mehmon'})
                        </button>

                        {turnConditions.hasConditions && (
                          <div className="flex items-center gap-1.5">
                            <span
                              className="font-mono text-[10.5px] border border-[rgba(196,85,45,0.4)] text-[#C4552D] rounded-full px-2.5 py-0.5 flex items-center gap-1 bg-white"
                              title="Bu shart ovoz modulatsiyasi uchun ishlatiladi"
                            >
                              <ShieldCheck className="w-3 h-3 text-[#0E7C86]" />
                              <span>{turnConditions.conditions.slice(0, 2).join(' ')}</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCleanSingleTurn(turn.id)}
                              className="p-1 rounded-full hover:bg-[rgba(22,21,17,0.06)] text-[#5D594E] hover:text-[#C4552D] text-[10px] transition-colors cursor-pointer"
                              title="Replikadagi shart va belgilarni olib tashlash"
                            >
                              <Eraser className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {turnAudio && (
                          <button
                            type="button"
                            onClick={() => playSingleTurn(turn.id, turnAudio)}
                            className="btn-pill btn-ghost text-[10.5px] py-0.5 px-2.5 flex items-center gap-1 cursor-pointer"
                            title="Faqat shu replikani eshitish"
                          >
                            {isTurnPlaying ? <Pause className="w-2.5 h-2.5" /> : <Play className="w-2.5 h-2.5" />}
                            <span>{isTurnPlaying ? 'Pauza' : 'Eshittirish'}</span>
                          </button>
                        )}
                        {turn.emotion && (
                          <span className="font-mono text-[10px] uppercase px-2 py-0.5 rounded-full border border-[rgba(22,21,17,0.14)] text-[#5D594E]">
                            {turn.emotion}
                          </span>
                        )}
                        <button
                          onClick={() => removeTurn(turn.id)}
                          className="p-1.5 text-[#5D594E] hover:text-[#C4552D] rounded-full hover:bg-[rgba(196,85,45,0.08)] transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <textarea
                      rows={2}
                      value={turn.text}
                      onChange={(e) => updateTurnText(turn.id, e.target.value)}
                      className="w-full bg-white border border-[rgba(22,21,17,0.14)] rounded-xl p-3 text-xs sm:text-sm text-[#161511] focus:outline-none focus:border-[#0E7C86] resize-none font-sans leading-relaxed shadow-2xs"
                      placeholder="Ushbu spikerning replikasi..."
                    />

                    {/* Turn Music Cue Selector Strip */}
                    <div className="mt-2.5 pt-2 border-t border-[rgba(22,21,17,0.08)] flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-[#5D594E] flex items-center gap-1 font-mono uppercase tracking-wider">
                          <Music className="w-3 h-3 text-[#0E7C86]" />
                          {lang === 'uz' ? 'Fon:' : 'Саунд:'}
                        </span>

                        <div className="flex items-center gap-1 bg-[#F4F1EA] p-0.5 rounded-full border border-[rgba(22,21,17,0.1)]">
                          <button
                            type="button"
                            onClick={() => handleUpdateTurnCue(turn.id, 'silence')}
                            className={`px-2.5 py-0.5 rounded-full text-[10.5px] font-semibold transition-all cursor-pointer ${
                              turn.musicCue?.cueType === 'silence' || !turn.musicCue?.enabled
                                ? 'bg-[#161511] text-[#F4F1EA]'
                                : 'text-[#5D594E] hover:text-[#161511]'
                            }`}
                            title="Toza studiya nutqi, musiqasiz"
                          >
                            🔇 {lang === 'uz' ? 'Toza' : 'Без музыки'}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleUpdateTurnCue(turn.id, 'intro')}
                            className={`px-2.5 py-0.5 rounded-full text-[10.5px] font-semibold transition-all cursor-pointer ${
                              turn.musicCue?.cueType === 'intro' && turn.musicCue?.enabled
                                ? 'bg-[#0E7C86] text-white'
                                : 'text-[#5D594E] hover:text-[#161511]'
                            }`}
                          >
                            🎵 Intro
                          </button>

                          <button
                            type="button"
                            onClick={() => handleUpdateTurnCue(turn.id, 'emotional', 'calm-piano')}
                            className={`px-2.5 py-0.5 rounded-full text-[10.5px] font-semibold transition-all cursor-pointer ${
                              turn.musicCue?.cueType === 'emotional' && turn.musicCue?.enabled
                                ? 'bg-[#0E7C86] text-white'
                                : 'text-[#5D594E] hover:text-[#161511]'
                            }`}
                          >
                            🎹 {lang === 'uz' ? 'Pianino' : 'Пианино'}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleUpdateTurnCue(turn.id, 'stinger', 'tech-ambient')}
                            className={`px-2.5 py-0.5 rounded-full text-[10.5px] font-semibold transition-all cursor-pointer ${
                              turn.musicCue?.cueType === 'stinger' && turn.musicCue?.enabled
                                ? 'bg-[#C4552D] text-white'
                                : 'text-[#5D594E] hover:text-[#161511]'
                            }`}
                          >
                            ⚡ Stinger
                          </button>

                          <button
                            type="button"
                            onClick={() => handleUpdateTurnCue(turn.id, 'outro')}
                            className={`px-2.5 py-0.5 rounded-full text-[10.5px] font-semibold transition-all cursor-pointer ${
                              turn.musicCue?.cueType === 'outro' && turn.musicCue?.enabled
                                ? 'bg-[#161511] text-[#F4F1EA]'
                                : 'text-[#5D594E] hover:text-[#161511]'
                            }`}
                          >
                            🎬 Outro
                          </button>
                        </div>
                      </div>

                      {turn.musicCue?.reasoning && (
                        <span className="text-[10px] text-[#5D594E] italic max-w-[280px] truncate" title={turn.musicCue.reasoning}>
                          💡 {turn.musicCue.reasoning}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Add turn button & Synthesize action */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3">
              <button
                onClick={addTurn}
                className="btn-pill btn-ghost text-xs px-4 py-2 flex items-center justify-center gap-1.5 w-full sm:w-auto"
              >
                <Plus className="w-4 h-4 text-[#0E7C86]" />
                {lang === 'uz' ? 'Yangi Replika Qoʻshish' : 'Добавить реплику'}
              </button>

              <button
                onClick={handleSynthesizeDialogue}
                disabled={isSynthesizing || turns.length === 0}
                className="btn-pill btn-solid text-xs sm:text-sm py-2.5 px-6 flex items-center justify-center gap-2 w-full sm:w-auto shadow-sm"
              >
                <Volume2 className={`w-4 h-4 text-[#5CC8CF] ${isSynthesizing ? 'animate-pulse' : ''}`} />
                {isSynthesizing
                  ? (lang === 'uz' ? 'Ikkala Ovoz Sintez Qilinmoqda...' : 'Синтез диалога...')
                  : (lang === 'uz' ? 'Toʻliq Dialog Podkastni Yaratish (Dual TTS)' : 'Синтезировать Диалог (Dual TTS)')}
              </button>
            </div>
          </div>
        </div>

        {/* Right: Master Audio Player & Karaoke Turns (4 cols) */}
        <div className="lg:col-span-4 space-y-6">
          <div className="border border-[rgba(22,21,17,0.14)] rounded-[20px] bg-[rgba(255,255,255,0.52)] backdrop-blur-sm p-5 space-y-4 shadow-[0_30px_50px_-30px_rgba(22,21,17,0.15)]">
            <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#0A5A62]">
              <span>04 — Master audio</span>
              <span className="h-[1px] flex-1 bg-[rgba(22,21,17,0.14)]" />
            </div>

            {masterAudioBase64 ? (
              <div className="space-y-4">
                <audio
                  ref={audioRef}
                  src={`data:audio/wav;base64,${masterAudioBase64}`}
                  onTimeUpdate={handleTimeUpdate}
                  onEnded={() => {
                    setIsPlaying(false);
                    setActiveTurnIndex(-1);
                    ambientAudioRef.current?.pause();
                    if (ambientAudioRef.current) ambientAudioRef.current.currentTime = 0;
                  }}
                />

                {/* Bounded Dark Studio Screen Panel for Master Console */}
                <div className="p-4 sm:p-5 rounded-2xl bg-[#141414] border border-[#2B2B27] text-[#EDEAE2] space-y-4 shadow-[0_30px_50px_-20px_rgba(20,20,20,0.45)]">
                  <div className="flex items-center gap-4">
                    <button
                      onClick={toggleMasterPlay}
                      className="w-12 h-12 rounded-full bg-[#0E7C86] hover:bg-[#0A5A62] text-white flex items-center justify-center transition-transform hover:scale-105 shadow-md shadow-[#0E7C86]/30 cursor-pointer shrink-0"
                    >
                      {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5 fill-current" />}
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between text-xs text-[#7D7A70]">
                        <span className="font-mono uppercase text-[10px] tracking-wider">{lang === 'uz' ? 'Efir vaqti' : 'Время'}:</span>
                        <span className="font-mono text-[#5CC8CF] font-bold">
                          {masterCurrentTime.toFixed(1)}s / {totalDuration}s
                        </span>
                      </div>
                      <div className="flex items-center gap-1 mt-2 h-6">
                        {[30, 60, 90, 45, 80, 100, 70, 40, 85, 95, 60, 40, 75, 55, 90].map((h, i) => {
                          const barProgress = (i / 15) * totalDuration;
                          const isPassed = masterCurrentTime >= barProgress;
                          return (
                            <div
                              key={i}
                              className={`w-1 rounded-full transition-all ${
                                isPassed
                                  ? 'bg-[#5CC8CF]'
                                  : isPlaying
                                  ? 'bg-[#0E7C86]/30 animate-pulse'
                                  : 'bg-[#2B2B27]'
                              }`}
                              style={{ height: `${h}%` }}
                            />
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Seek Bar */}
                  <div
                    onClick={(e) => {
                      if (!audioRef.current || !totalDuration) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const clickPos = (e.clientX - rect.left) / rect.width;
                      const newTime = clickPos * totalDuration;
                      audioRef.current.currentTime = newTime;
                      setMasterCurrentTime(newTime);
                      if (ambientAudioRef.current && ambientAudioRef.current.duration) {
                        ambientAudioRef.current.currentTime = newTime % ambientAudioRef.current.duration;
                      }
                    }}
                    className="relative h-2 bg-[#2B2B27] rounded-full overflow-hidden cursor-pointer"
                  >
                    <div
                      className="absolute left-0 top-0 bottom-0 bg-[#0E7C86] rounded-full transition-all"
                      style={{ width: `${totalDuration > 0 ? (masterCurrentTime / totalDuration) * 100 : 0}%` }}
                    />
                  </div>

                  {/* Dynamic Sound Design Map & Ducking Mode */}
                  <div className="p-3 bg-[#1D1D1B] rounded-xl border border-[#2B2B27] space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono text-[10.5px] uppercase tracking-wider text-[#EDEAE2] flex items-center gap-1.5">
                        <Music className="w-3.5 h-3.5 text-[#5CC8CF]" />
                        {lang === 'uz' ? 'Ovoz Rejissurasi:' : 'Саунд-дизайн:'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setDynamicDuckingEnabled(!dynamicDuckingEnabled)}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider transition-all cursor-pointer ${
                          dynamicDuckingEnabled
                            ? 'bg-[#0E7C86] text-white'
                            : 'bg-[#2B2B27] text-[#7D7A70]'
                        }`}
                      >
                        {dynamicDuckingEnabled
                          ? (lang === 'uz' ? 'Dinamik Cues' : 'Активны Cues')
                          : (lang === 'uz' ? 'Statik Loop' : 'Статичный')}
                      </button>
                    </div>

                    {/* Visual Cue Track blocks */}
                    <div className="flex items-center gap-1 overflow-x-auto py-1 scrollbar-thin">
                      {turns.map((t, idx) => {
                        const isCur = activeTurnIndex === idx;
                        const cueType = t.musicCue?.cueType || 'silence';
                        const isSil = cueType === 'silence' || !t.musicCue?.enabled;

                        return (
                          <div
                            key={t.id}
                            className={`px-2 py-1 rounded-md text-[10px] whitespace-nowrap font-mono transition-all border ${
                              isCur
                                ? 'border-[#5CC8CF] bg-[#0E7C86]/30 text-white font-bold'
                                : isSil
                                ? 'bg-[#141414] border-[#2B2B27] text-[#7D7A70]'
                                : cueType === 'intro'
                                ? 'bg-[#0E7C86]/20 border-[#0E7C86]/50 text-[#5CC8CF]'
                                : cueType === 'stinger'
                                ? 'bg-[#C4552D]/20 border-[#C4552D]/50 text-[#C4552D]'
                                : cueType === 'emotional'
                                ? 'bg-[#C98A12]/20 border-[#C98A12]/50 text-[#C98A12]'
                                : 'bg-[#1D1D1B] border-[#2B2B27] text-[#EDEAE2]'
                            }`}
                            title={`${t.speakerName}: ${t.musicCue?.labelUz || cueType}`}
                          >
                            {isSil ? '🔇 Toza' : cueType === 'intro' ? '🎵 Intro' : cueType === 'stinger' ? '⚡ Stinger' : cueType === 'emotional' ? '🎹 Fon' : '🎬 Outro'}
                            <span className="text-[9px] opacity-60 ml-1">#{idx + 1}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Ambient Music Controls for Dialogue */}
                  <div className="pt-2 border-t border-[#2B2B27] flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-1.5 text-[#EDEAE2]">
                      <Music className={`w-3.5 h-3.5 ${isPlaying && ambientEnabled && ambientSound !== 'none' ? 'text-[#5CC8CF] animate-spin' : 'text-[#5CC8CF]'}`} />
                      <span className="font-mono text-[10.5px] uppercase tracking-wider">{lang === 'uz' ? 'Asosiy fon:' : 'Фон:'}</span>
                    </div>

                    <select
                      value={ambientSound}
                      onChange={(e) => setAmbientSound(e.target.value as AmbientSoundscape)}
                      className="bg-[#1D1D1B] border border-[#2B2B27] text-[#EDEAE2] text-xs rounded-lg px-2 py-1 font-medium focus:outline-none focus:border-[#0E7C86] cursor-pointer max-w-[150px] truncate"
                    >
                      {AMBIENT_SOUNDSCAPES.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.icon} {lang === 'uz' ? s.labelUz : s.labelRu}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      onClick={() => {
                        const next = !ambientEnabled;
                        setAmbientEnabled(next);
                        if (!next) {
                          ambientAudioRef.current?.pause();
                        } else if (isPlaying && ambientSound !== 'none') {
                          ambientAudioRef.current?.play().catch(console.warn);
                        }
                      }}
                      className={`px-2.5 py-0.5 rounded-full font-mono text-[10px] uppercase tracking-wider transition-all cursor-pointer ${
                        ambientEnabled && ambientSound !== 'none'
                          ? 'bg-[#0E7C86] text-white'
                          : 'bg-[#2B2B27] text-[#7D7A70]'
                      }`}
                    >
                      {ambientEnabled && ambientSound !== 'none'
                        ? (lang === 'uz' ? 'Yoqilgan' : 'Вкл')
                        : (lang === 'uz' ? "O'chirilgan" : 'Выкл')}
                    </button>

                    {ambientEnabled && ambientSound !== 'none' && (
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-[#7D7A70] font-mono">{ambientVolume}%</span>
                        <input
                          type="range"
                          min="5"
                          max="40"
                          step="5"
                          value={ambientVolume}
                          onChange={(e) => setAmbientVolume(parseInt(e.target.value))}
                          className="w-14 accent-[#0E7C86] h-1 bg-[#2B2B27] rounded-lg cursor-pointer"
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Live Transcript / Subtitle Sync Feed */}
                <div className="space-y-2">
                  <p className="font-mono text-[10.5px] uppercase tracking-wider text-[#5D594E]">
                    {lang === 'uz' ? 'Ketma-ket Yangrayotgan Replikalar:' : 'Живой эфирный текст:'}
                  </p>
                  <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                    {synthesizedTurns.map((turn, i) => {
                      const isActive = activeTurnIndex === i;
                      const isHost1 = turn.speakerId === 'HOST_1';
                      return (
                        <div
                          key={turn.id}
                          className={`p-3 rounded-xl text-xs transition-all ${
                            isActive
                              ? 'bg-[rgba(14,124,134,0.12)] border border-[#0E7C86] text-[#161511] font-medium'
                              : 'bg-white border border-[rgba(22,21,17,0.1)] text-[#5D594E]'
                          }`}
                        >
                          <div className="flex items-center justify-between text-[10px] mb-1">
                            <span className={isHost1 ? 'text-[#0A5A62] font-bold' : 'text-[#C4552D] font-bold'}>
                              {turn.speakerName}
                            </span>
                            <span className="font-mono text-[#5D594E]">
                              {turn.startTime?.toFixed(1)}s - {turn.endTime?.toFixed(1)}s
                            </span>
                          </div>
                          <p className="leading-snug">{turn.text}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Action Buttons: Save to CMS & Download */}
                <div className="space-y-2 pt-1">
                  {onSaveToCMS && (
                    <button
                      onClick={handleSaveToCMS}
                      className="btn-pill btn-ghost w-full py-2.5 flex items-center justify-center gap-2 text-xs font-semibold"
                    >
                      {isSaved ? <Check className="w-4 h-4 text-[#0E7C86]" /> : <Save className="w-4 h-4 text-[#0E7C86]" />}
                      <span>{isSaved ? 'CMS Kutubxonasiga Saqlandi!' : 'CMS Kutubxonasiga Saqlash'}</span>
                    </button>
                  )}

                  <button
                    onClick={downloadMasterAudio}
                    className="btn-pill btn-solid w-full py-2.5 flex items-center justify-center gap-2 text-xs font-bold"
                  >
                    <Download className="w-4 h-4 text-[#5CC8CF]" />
                    {lang === 'uz' ? "To'liq Master WAV Audioni Yuklash" : 'Скачать мастер-трек WAV'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-8 rounded-2xl bg-white border border-dashed border-[rgba(22,21,17,0.2)] text-center space-y-2">
                <Users2 className="w-8 h-8 text-[#5D594E]/50 mx-auto" />
                <p className="text-xs text-[#161511] font-medium">
                  {lang === 'uz' ? 'Dialog hali sintez qilinmadi' : 'Диалог еще не синтезирован'}
                </p>
                <p className="text-[11px] text-[#5D594E]">
                  {lang === 'uz'
                    ? 'Chap tarafdagi "Toʻliq Dialog Podkastni Yaratish" tugmasini bosing. Barcha replikalar birlashtiriladi.'
                    : 'Нажмите "Синтезировать Диалог" слева.'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
