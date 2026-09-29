import React, { useState, useRef, useEffect } from 'react';
import { VoiceProfile, DialogueTurn, AmbientSoundscape, SoundCueType, AudioSegmentCue } from '../types/podcast';
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
} from 'lucide-react';

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
      const name = isH1 ? speaker1Name : speaker2Name;
      const isFemale = !isH1 && speaker2Gender === 'female';

      const sampleText = isH1
        ? `Assalomu alaykum! Men ${name}man. Bugungi intervyu podkastimizga xush kelibsiz.`
        : isFemale
        ? `Salom! Men ${name} bo'laman. Bugungi qiziqarli suhbatda qatnashishdan judayam mamnunman.`
        : `Assalomu alaykum! Men ${name}man. Bugungi intervyuda dolzarb savollarga javob berishga tayyorman.`;

      const res = await fetch('/api/podcast/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: sampleText,
          voiceProfile: {
            voiceName: name,
            voiceId: prof?.voiceId || prof?.id,
            baseVoice: prof?.baseVoice || (isFemale ? 'Kore' : 'Charon'),
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
      {/* Banner */}
      <div className="rounded-2xl bg-gradient-to-r from-emerald-950/60 via-zinc-900 to-cyan-950/60 border border-emerald-500/30 p-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-semibold border border-emerald-500/40 flex items-center gap-1.5">
                <Users2 className="w-3.5 h-3.5" />
                {lang === 'uz' ? 'Multi-Speaker Intervyu Studiyasi' : 'Мультиспикер & Интервью Студия'}
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 text-xs font-mono border border-cyan-500/30">
                2 Mustaqil Ovoz (Dual-Voice TTS)
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
              {lang === 'uz' ? '2 Boshlovchi va Mehmon Dialogi' : 'Диалог 2-х Ведущих и Экспертов'}
            </h1>
            <p className="text-zinc-400 text-sm mt-1 max-w-2xl">
              {lang === 'uz'
                ? 'O\'z ovozingizni (SHOKHRUKH) boshlovchi sifatida, ikkinchi taklif qilingan ovozni esa mehmon sifatida ulab, to\'liq ketma-ketlikda jonli dialog yarating.'
                : 'Используйте свой голос как ведущего и выберите второй голос для гостя, создавая живой многоголосый диалог.'}
            </p>
          </div>

          {/* Speakers summary pill */}
          <div className="flex items-center gap-2 bg-zinc-950/80 border border-emerald-500/30 p-2.5 rounded-xl">
            <div className="px-3 py-1.5 bg-emerald-950/60 rounded-lg border border-emerald-500/30 text-xs">
              <span className="text-[10px] text-zinc-400 block">1-Spiker (Siz):</span>
              <span className="font-bold text-emerald-300 flex items-center gap-1">
                {speaker1Profile?.name}
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              </span>
            </div>
            <span className="text-zinc-500 font-bold">&</span>
            <div className="px-3 py-1.5 bg-cyan-950/60 rounded-lg border border-cyan-500/30 text-xs">
              <span className="text-[10px] text-zinc-400 block">2-Spiker (Mehmon):</span>
              <span className="font-bold text-cyan-300">{speaker2Profile?.name}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Speaker Configuration & Script Builder (8 cols) */}
        <div className="lg:col-span-8 space-y-6">
          {/* STEP 1: Dialogue Topic & AI Script Generator + Document Upload */}
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-emerald-400" />
                {lang === 'uz' ? '1. Dialog Mavzusi & Ssenariy Yaratish' : '1. Тема Диалога и Создание Сценария'}
              </h3>

              {onOpenDocumentModal && (
                <button
                  type="button"
                  onClick={onOpenDocumentModal}
                  className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-cyan-300 border border-cyan-500/40 text-xs font-semibold flex items-center gap-1.5 transition-all hover:scale-105 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{lang === 'uz' ? 'PDF / Maqoladan Dialog Yaratish' : 'Из PDF/Статьи'}</span>
                </button>
              )}
            </div>

            {/* Duration Selector & Timing Info */}
            <div className="p-3 bg-zinc-950/70 border border-zinc-800 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-zinc-300 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-emerald-400" />
                  {lang === 'uz' ? 'Intervyu Davomiyligi:' : 'Длительность интервью:'}
                </span>
                <span className="text-[11px] font-mono text-zinc-400">
                  {turns.length} {lang === 'uz' ? 'replika' : 'реплик'} • ~{Math.max(1, Math.round(turns.reduce((acc, t) => acc + t.text.trim().split(/\s+/).filter(Boolean).length, 0) / 125))} {lang === 'uz' ? 'daqiqa' : 'мин'}
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
                    className={`flex-1 py-1.5 px-2.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
                      targetDuration === d.id
                        ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300 font-bold'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700'
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
                placeholder="Intervyu mavzusi..."
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2 text-xs sm:text-sm text-zinc-200 focus:outline-none focus:border-emerald-500"
              />
              <button
                onClick={handleGenerateInterview}
                disabled={isGeneratingScript || !topic.trim()}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 transition-all shadow-md shadow-emerald-600/20 whitespace-nowrap cursor-pointer"
              >
                <Sparkles className={`w-3.5 h-3.5 ${isGeneratingScript ? 'animate-spin' : ''}`} />
                {isGeneratingScript ? (lang === 'uz' ? 'Yozilmoqda...' : 'Генерация...') : (lang === 'uz' ? `AI Intervyu Matni (${targetDuration})` : `AI Диалог (${targetDuration})`)}
              </button>
              <button
                onClick={handleExpandInterview}
                disabled={isExpandingDialogue || turns.length === 0}
                className="px-3.5 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-amber-300 border border-amber-500/40 rounded-xl text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap"
                title="Suhbatni yana 15 daqiqaga kengaytirish"
              >
                <Sparkles className={`w-3.5 h-3.5 ${isExpandingDialogue ? 'animate-spin' : ''}`} />
                {isExpandingDialogue ? (lang === 'uz' ? 'Kengaytirilmoqda...' : 'Расширение...') : (lang === 'uz' ? '+15 daqiqa qo\'shish' : '+15 минут')}
              </button>
            </div>
          </div>

          {/* STEP 2: Speakers Selector Card */}
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
              <Users2 className="w-4 h-4 text-emerald-400" />
              {lang === 'uz' ? '2. Ishtirokchilar va Ularning Ovozlari' : '2. Участники и Их Голоса'}
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Speaker 1 (Host - User's Voice) */}
              <div className="p-4 rounded-xl bg-zinc-950 border border-emerald-500/30 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5" /> 1-Boshlovchi (O'zingiz)
                  </span>
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/40">
                    Haqiqiy Klon Ovoz
                  </span>
                </div>

                <div>
                  <label className="text-[10px] uppercase font-mono text-zinc-400 block mb-1">
                    {lang === 'uz' ? 'Spiker Ismi:' : 'Имя спикера:'}
                  </label>
                  <input
                    type="text"
                    value={speaker1Name}
                    onChange={(e) => setSpeaker1Name(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                    placeholder="Masalan: Shokhrukh"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] uppercase font-mono text-zinc-400">
                      {lang === 'uz' ? 'Tanlangan Ovoz:' : 'Выбранный голос:'}
                    </label>
                    <button
                      type="button"
                      onClick={() => handleTestSpeakerVoice('host1')}
                      className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      {previewingSpeaker === 'host1' ? (
                        <>
                          <Pause className="w-3 h-3 animate-spin" />
                          <span>To'xtatish</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3 h-3" />
                          <span>Eshittirish</span>
                        </>
                      )}
                    </button>
                  </div>
                  <select
                    value={speaker1VoiceId}
                    onChange={(e) => setSpeaker1VoiceId(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500"
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
                  <label className="text-[10px] uppercase font-mono text-zinc-400 block mb-1.5">
                    {lang === 'uz' ? 'Nutq Tempi (Tezligi):' : 'Темп речи:'}
                  </label>
                  <div className="grid grid-cols-4 gap-1">
                    {['0.85x', '1.0x', '1.1x', '1.2x'].map((tVal) => (
                      <button
                        key={tVal}
                        type="button"
                        onClick={() => setSpeaker1Tempo(tVal)}
                        className={`py-1 px-1.5 text-[11px] rounded font-mono transition-all text-center ${
                          speaker1Tempo === tVal
                            ? 'bg-emerald-600 text-white font-bold'
                            : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
                        }`}
                      >
                        {tVal}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Speaker 2 (Guest / Aziza) */}
              <div className="p-4 rounded-xl bg-zinc-950 border border-cyan-500/30 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-cyan-400 flex items-center gap-1.5">
                    <Bot className="w-3.5 h-3.5" /> 2-Mehmon / Ekspert
                  </span>
                  <div className="flex items-center gap-1 bg-zinc-900 p-0.5 rounded-lg border border-zinc-800">
                    <button
                      type="button"
                      onClick={() => setSpeaker2GenderFilter('all')}
                      className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                        speaker2GenderFilter === 'all'
                          ? 'bg-zinc-700 text-white font-bold'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      Barchasi
                    </button>
                    <button
                      type="button"
                      onClick={() => setSpeaker2GenderFilter('female')}
                      className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                        speaker2GenderFilter === 'female'
                          ? 'bg-cyan-500 text-black font-bold'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      Ayollar (Kore)
                    </button>
                    <button
                      type="button"
                      onClick={() => setSpeaker2GenderFilter('male')}
                      className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                        speaker2GenderFilter === 'male'
                          ? 'bg-cyan-500 text-black font-bold'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      Erkaklar
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] uppercase font-mono text-zinc-400 block mb-1">
                      {lang === 'uz' ? 'Ismi:' : 'Имя:'}
                    </label>
                    <input
                      type="text"
                      value={speaker2Name}
                      onChange={(e) => setSpeaker2Name(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
                      placeholder="Aziza"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-mono text-zinc-400 block mb-1">
                      {lang === 'uz' ? 'Roli / Kasbi:' : 'Роль / Профессия:'}
                    </label>
                    <input
                      type="text"
                      value={speaker2Role}
                      onChange={(e) => setSpeaker2Role(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-cyan-500"
                      placeholder="AI & Fan Eksperti"
                    />
                  </div>
                </div>

                {/* Speaker 2 Voice Select & Preview Button */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] uppercase font-mono text-zinc-400">
                      {lang === 'uz' ? 'Mehmon Ovozi (O\'zbekcha):' : 'Голос гостя:'}
                    </label>
                    <button
                      type="button"
                      onClick={() => handleTestSpeakerVoice('host2')}
                      className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      {previewingSpeaker === 'host2' ? (
                        <>
                          <Pause className="w-3 h-3 animate-spin" />
                          <span>To'xtatish</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3 h-3" />
                          <span>Eshittirish (Namuna)</span>
                        </>
                      )}
                    </button>
                  </div>
                  <select
                    value={speaker2VoiceId}
                    onChange={(e) => handleSelectSpeaker2Voice(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-cyan-500"
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
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-zinc-800/80">
                  <div>
                    <label className="text-[10px] uppercase font-mono text-zinc-400 block mb-1">
                      {lang === 'uz' ? 'Tempi (Tezlik):' : 'Темп речи:'}
                    </label>
                    <div className="grid grid-cols-4 gap-1">
                      {['0.85x', '1.0x', '1.1x', '1.2x'].map((tVal) => (
                        <button
                          key={tVal}
                          type="button"
                          onClick={() => setSpeaker2Tempo(tVal)}
                          className={`py-1 text-[10px] rounded font-mono transition-all text-center ${
                            speaker2Tempo === tVal
                              ? 'bg-cyan-600 text-white font-bold'
                              : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
                          }`}
                        >
                          {tVal}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] uppercase font-mono text-zinc-400 block mb-1">
                      {lang === 'uz' ? 'Tembr & Ohang:' : 'Тембр / Интонация:'}
                    </label>
                    <select
                      value={speaker2Timbre}
                      onChange={(e) => setSpeaker2Timbre(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-300 focus:outline-none focus:border-cyan-500"
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
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-emerald-400" />
                {lang === 'uz' ? '3. Suhbat Replikalari & AI Ovoz Rejissyori' : '3. Реплики Беседы и AI Звукорежиссер'}
              </h3>
              <span className="text-xs font-mono text-zinc-400">
                {turns.length} {lang === 'uz' ? 'ta replika' : 'реплик'}
              </span>
            </div>

            {/* AI Sound Director Banner & Auto-Planner */}
            <div className="bg-gradient-to-r from-purple-950/40 via-zinc-900 to-indigo-950/40 border border-purple-500/30 rounded-2xl p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 rounded-lg bg-purple-500/20 text-purple-300 border border-purple-500/30">
                      <Sliders className="w-4 h-4" />
                    </span>
                    <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
                      {lang === 'uz' ? 'AI Ovoz Rejissyori (Dinamik Saund-Dizayn)' : 'AI Звукорежиссер (Динамический саунд-дизайн)'}
                    </h4>
                  </div>
                  <p className="text-xs text-zinc-400 mt-1">
                    {lang === 'uz'
                      ? "Bitta monoton musiqadan voz kechib, har bir replika uchun alohida reja: kirish jingle'i, suhbatda toza ovoz (musiqasiz), chuqur fikrlarda mayin fon va o'tish stingerlari."
                      : 'Динамическая расстановка музыки: интро-джингл, кристально чистый голос без музыки в середине, акценты и эмоциональный фон.'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCleanAllTurns}
                    className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-amber-300 border border-amber-500/40 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all hover:scale-105 cursor-pointer whitespace-nowrap"
                    title="Barcha replikalardan skobkalar va ovoz shartlarini tozalash"
                  >
                    <Eraser className="w-3.5 h-3.5 text-amber-400" />
                    <span>{lang === 'uz' ? 'Shartlarni tozalash' : 'Очистить условия'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handlePlanSoundDirector}
                    disabled={isPlanningSound || turns.length === 0}
                    className="px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-md shadow-purple-600/20 whitespace-nowrap cursor-pointer"
                  >
                    <Sparkles className={`w-3.5 h-3.5 ${isPlanningSound ? 'animate-spin' : ''}`} />
                    {isPlanningSound
                      ? (lang === 'uz' ? 'Rejalashtirilmoqda...' : 'Анализ...')
                      : (lang === 'uz' ? 'AI Saund-Reja Tuzish' : 'AI Расстановка Музыки')}
                  </button>
                </div>
              </div>

              {/* Speech Condition Protection Notice */}
              <div className="p-2.5 rounded-xl bg-indigo-950/40 border border-indigo-500/20 text-xs text-indigo-200 flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <p className="leading-relaxed text-[11px] text-zinc-300">
                  <strong className="text-emerald-300">{lang === 'uz' ? 'Ovoz kafolati:' : 'Защита от зачитывания ремарок:'}</strong>{' '}
                  {lang === 'uz'
                    ? 'Replikalardagi [Bariton], [Mezzo], [00:00], [Pauza] kabi barcha shartlar replikada tursa ham, sintez paytida avtomatik tarzda diktor tembri va emotsiyasiga o\'tkaziladi va baland ovozda O\'QILMAYDI!'
                    : 'Условия тембра ([Баритон], [Меццо]), таймкоды и ремарки в скобках автоматически формируют голос Gemini TTS и НЕ озвучиваются вслух!'}
                </p>
              </div>

              {soundDirectorStrategy && (
                <div className="p-2.5 rounded-xl bg-purple-950/30 border border-purple-500/30 text-xs text-purple-200 flex items-start gap-2">
                  <Sparkles className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
                  <p className="leading-relaxed">
                    <strong>{lang === 'uz' ? 'Rejissura strategiyasi:' : 'Стратегия режиссуры:'}</strong>{' '}
                    {lang === 'uz' ? soundDirectorStrategy.strategyUz : soundDirectorStrategy.strategyRu}
                  </p>
                </div>
              )}
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
                    className={`p-3.5 rounded-xl border transition-all ${
                      isCurrentlyActive
                        ? 'border-yellow-400 bg-yellow-950/20 shadow-lg shadow-yellow-500/10'
                        : isHost1
                        ? 'bg-emerald-950/20 border-emerald-500/30'
                        : 'bg-cyan-950/20 border-cyan-500/30'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleTurnSpeaker(turn.id)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-transform active:scale-95 cursor-pointer ${
                            isHost1
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                          }`}
                          title="Spikerni almashtirish uchun bosing"
                        >
                          {isHost1 ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
                          {turn.speakerName} ({isHost1 ? '1-Boshlovchi (Siz)' : '2-Mehmon'})
                        </button>

                        {turnConditions.hasConditions && (
                          <div className="flex items-center gap-1.5">
                            <span
                              className="px-2 py-0.5 rounded-md bg-zinc-900 border border-amber-500/30 text-amber-300 text-[10px] font-mono flex items-center gap-1"
                              title="Bu shart ovoz modulatsiyasi uchun ishlatiladi va baland ovozda o'qilmaydi"
                            >
                              <ShieldCheck className="w-3 h-3 text-emerald-400" />
                              <span>{turnConditions.conditions.slice(0, 2).join(' ')}</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCleanSingleTurn(turn.id)}
                              className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-amber-300 text-[10px] transition-colors cursor-pointer"
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
                            className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-cyan-300 text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                            title="Faqat shu replikani eshitish"
                          >
                            {isTurnPlaying ? <Pause className="w-2.5 h-2.5" /> : <Play className="w-2.5 h-2.5" />}
                            <span>{isTurnPlaying ? 'Pauza' : 'Eshittirish'}</span>
                          </button>
                        )}
                        {turn.emotion && (
                          <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">
                            {turn.emotion}
                          </span>
                        )}
                        <button
                          onClick={() => removeTurn(turn.id)}
                          className="p-1 text-zinc-500 hover:text-red-400 transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <textarea
                      rows={2}
                      value={turn.text}
                      onChange={(e) => updateTurnText(turn.id, e.target.value)}
                      className="w-full bg-zinc-950/80 border border-zinc-800 rounded-lg p-2.5 text-xs sm:text-sm text-zinc-200 focus:outline-none focus:border-zinc-600 resize-none font-sans leading-relaxed"
                      placeholder="Ushbu spikerning replikasi..."
                    />

                    {/* Turn Music Cue Selector Strip */}
                    <div className="mt-2.5 pt-2 border-t border-zinc-800/80 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-zinc-400 flex items-center gap-1 font-medium">
                          <Music className="w-3 h-3 text-purple-400" />
                          {lang === 'uz' ? 'Fon rejissurasi:' : 'Саунд:'}
                        </span>

                        <div className="flex items-center gap-1 bg-zinc-950/80 p-0.5 rounded-lg border border-zinc-800">
                          <button
                            type="button"
                            onClick={() => handleUpdateTurnCue(turn.id, 'silence')}
                            className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-all cursor-pointer ${
                              turn.musicCue?.cueType === 'silence' || !turn.musicCue?.enabled
                                ? 'bg-zinc-800 text-amber-300 border border-amber-500/40 shadow-sm'
                                : 'text-zinc-500 hover:text-zinc-300'
                            }`}
                            title="Toza studiya nutqi, hech qanday musiqasiz"
                          >
                            🔇 {lang === 'uz' ? 'Toza ovoz' : 'Без музыки'}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleUpdateTurnCue(turn.id, 'intro')}
                            className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-all cursor-pointer ${
                              turn.musicCue?.cueType === 'intro' && turn.musicCue?.enabled
                                ? 'bg-purple-900/60 text-purple-300 border border-purple-500/40 shadow-sm'
                                : 'text-zinc-500 hover:text-zinc-300'
                            }`}
                          >
                            🎵 Intro
                          </button>

                          <button
                            type="button"
                            onClick={() => handleUpdateTurnCue(turn.id, 'emotional', 'calm-piano')}
                            className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-all cursor-pointer ${
                              turn.musicCue?.cueType === 'emotional' && turn.musicCue?.enabled
                                ? 'bg-cyan-900/60 text-cyan-300 border border-cyan-500/40 shadow-sm'
                                : 'text-zinc-500 hover:text-zinc-300'
                            }`}
                          >
                            🎹 {lang === 'uz' ? 'Pianino' : 'Пианино'}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleUpdateTurnCue(turn.id, 'stinger', 'tech-ambient')}
                            className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-all cursor-pointer ${
                              turn.musicCue?.cueType === 'stinger' && turn.musicCue?.enabled
                                ? 'bg-emerald-900/60 text-emerald-300 border border-emerald-500/40 shadow-sm'
                                : 'text-zinc-500 hover:text-zinc-300'
                            }`}
                          >
                            ⚡ Stinger
                          </button>

                          <button
                            type="button"
                            onClick={() => handleUpdateTurnCue(turn.id, 'outro')}
                            className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-all cursor-pointer ${
                              turn.musicCue?.cueType === 'outro' && turn.musicCue?.enabled
                                ? 'bg-rose-900/60 text-rose-300 border border-rose-500/40 shadow-sm'
                                : 'text-zinc-500 hover:text-zinc-300'
                            }`}
                          >
                            🎬 Outro
                          </button>
                        </div>
                      </div>

                      {turn.musicCue?.reasoning && (
                        <span className="text-[10px] text-zinc-500 italic max-w-[280px] truncate" title={turn.musicCue.reasoning}>
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
                className="w-full sm:w-auto px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors border border-zinc-700 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                {lang === 'uz' ? 'Yangi Replika Qo\'shish' : 'Добавить реплику'}
              </button>

              <button
                onClick={handleSynthesizeDialogue}
                disabled={isSynthesizing || turns.length === 0}
                className="w-full sm:w-auto px-6 py-2.5 bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 disabled:opacity-50 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-600/25 cursor-pointer"
              >
                <Volume2 className={`w-4 h-4 ${isSynthesizing ? 'animate-pulse' : ''}`} />
                {isSynthesizing
                  ? (lang === 'uz' ? 'Ikkala Ovoz Sintez Qilinmoqda...' : 'Синтез диалога...')
                  : (lang === 'uz' ? 'To\'liq Dialog Podkastni Yaratish (Dual TTS)' : 'Синтезировать Диалог (Dual TTS)')}
              </button>
            </div>
          </div>
        </div>

        {/* Right: Master Audio Player & Karaoke Turns (4 cols) */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-emerald-400" />
              {lang === 'uz' ? '3. Birlashtirilgan Master Audio' : '3. Мастер-трек диалога'}
            </h3>

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

                {/* Big Master Player */}
                <div className="p-4 rounded-xl bg-zinc-950 border border-emerald-500/30 space-y-3">
                  <div className="flex items-center gap-4">
                    <button
                      onClick={toggleMasterPlay}
                      className="w-12 h-12 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center transition-transform hover:scale-105 shadow-md shadow-emerald-600/30 cursor-pointer shrink-0"
                    >
                      {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                    </button>

                    <div className="flex-1">
                      <div className="flex items-center justify-between text-xs text-zinc-400">
                        <span>{lang === 'uz' ? 'Efir davomiyligi' : 'Длительность'}:</span>
                        <span className="font-mono text-emerald-300 font-bold">
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
                                  ? 'bg-emerald-400 shadow-sm shadow-emerald-400/50'
                                  : isPlaying
                                  ? 'bg-emerald-950 animate-pulse'
                                  : 'bg-zinc-800'
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
                    className="relative h-2 bg-zinc-900 rounded-full overflow-hidden cursor-pointer hover:bg-zinc-800 transition-colors"
                  >
                    <div
                      className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-emerald-500 to-cyan-400 rounded-full transition-all"
                      style={{ width: `${totalDuration > 0 ? (masterCurrentTime / totalDuration) * 100 : 0}%` }}
                    />
                  </div>

                  {/* Dynamic Sound Design Map & Ducking Mode */}
                  <div className="p-3 bg-zinc-900/80 rounded-xl border border-purple-500/25 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-zinc-300 flex items-center gap-1.5">
                        <Music className="w-3.5 h-3.5 text-purple-400" />
                        {lang === 'uz' ? 'Dinamik Ovoz Rejissurasi:' : 'Динамический саунд:'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setDynamicDuckingEnabled(!dynamicDuckingEnabled)}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all cursor-pointer ${
                          dynamicDuckingEnabled
                            ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                            : 'bg-zinc-800 text-zinc-400'
                        }`}
                      >
                        {dynamicDuckingEnabled
                          ? (lang === 'uz' ? 'Dinamik Cues (Smart)' : 'Активны Cues')
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
                            className={`px-2 py-1 rounded text-[10px] whitespace-nowrap font-medium transition-all border ${
                              isCur
                                ? 'ring-1 ring-yellow-400 border-yellow-400/80 bg-yellow-950/40 text-yellow-200'
                                : isSil
                                ? 'bg-zinc-950/70 border-zinc-800 text-zinc-400'
                                : cueType === 'intro'
                                ? 'bg-purple-950/50 border-purple-500/40 text-purple-300'
                                : cueType === 'stinger'
                                ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-300'
                                : cueType === 'emotional'
                                ? 'bg-cyan-950/50 border-cyan-500/40 text-cyan-300'
                                : 'bg-rose-950/50 border-rose-500/40 text-rose-300'
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
                  <div className="pt-2 border-t border-zinc-800/80 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-1.5 text-zinc-300">
                      <Music className={`w-3.5 h-3.5 ${isPlaying && ambientEnabled && ambientSound !== 'none' ? 'text-purple-400 animate-spin' : 'text-purple-400'}`} />
                      <span className="font-semibold">{lang === 'uz' ? 'Asosiy fon:' : 'Фон:'}</span>
                    </div>

                    <select
                      value={ambientSound}
                      onChange={(e) => setAmbientSound(e.target.value as AmbientSoundscape)}
                      className="bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs rounded-lg px-2 py-1 font-medium focus:outline-none focus:border-emerald-500 cursor-pointer max-w-[150px] truncate"
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
                      className={`px-2 py-0.5 rounded-md font-semibold text-[11px] transition-all cursor-pointer ${
                        ambientEnabled && ambientSound !== 'none'
                          ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                          : 'bg-zinc-800 text-zinc-400'
                      }`}
                    >
                      {ambientEnabled && ambientSound !== 'none'
                        ? (lang === 'uz' ? 'Yoqilgan' : 'Вкл')
                        : (lang === 'uz' ? 'O\'chirilgan' : 'Выкл')}
                    </button>

                    {ambientEnabled && ambientSound !== 'none' && (
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-zinc-400 font-mono">{ambientVolume}%</span>
                        <input
                          type="range"
                          min="5"
                          max="40"
                          step="5"
                          value={ambientVolume}
                          onChange={(e) => setAmbientVolume(parseInt(e.target.value))}
                          className="w-14 accent-purple-400 h-1 bg-zinc-800 rounded-lg cursor-pointer"
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Live Transcript / Subtitle Sync Feed */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-zinc-400">
                    {lang === 'uz' ? 'Ketma-ket Yangrayotgan Replikalar:' : 'Живой эфирный текст:'}
                  </p>
                  <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                    {synthesizedTurns.map((turn, i) => {
                      const isActive = activeTurnIndex === i;
                      const isHost1 = turn.speakerId === 'HOST_1';
                      return (
                        <div
                          key={turn.id}
                          className={`p-2.5 rounded-lg text-xs transition-all ${
                            isActive
                              ? 'bg-emerald-500/20 border border-emerald-400 text-white font-medium scale-[1.02]'
                              : 'bg-zinc-950/60 border border-zinc-800 text-zinc-400'
                          }`}
                        >
                          <div className="flex items-center justify-between text-[10px] mb-1">
                            <span className={isHost1 ? 'text-emerald-400 font-bold' : 'text-cyan-400 font-bold'}>
                              {turn.speakerName}
                            </span>
                            <span className="font-mono text-zinc-500">
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
                      className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 border border-zinc-700 transition-all hover:scale-[1.01] cursor-pointer"
                    >
                      {isSaved ? <Check className="w-4 h-4 text-emerald-400" /> : <Save className="w-4 h-4 text-cyan-400" />}
                      <span>{isSaved ? 'CMS Kutubxonasiga Saqlandi!' : 'CMS Kutubxonasiga Saqlash'}</span>
                    </button>
                  )}

                  <button
                    onClick={downloadMasterAudio}
                    className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-md shadow-emerald-600/20 cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    {lang === 'uz' ? 'To\'liq Master WAV Audioni Yuklash' : 'Скачать мастер-трек WAV'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-8 rounded-xl bg-zinc-950/60 border border-dashed border-zinc-800 text-center space-y-2">
                <Users2 className="w-8 h-8 text-zinc-600 mx-auto" />
                <p className="text-xs text-zinc-400 font-medium">
                  {lang === 'uz' ? 'Dialog hali sintez qilinmadi' : 'Диалог еще не синтезирован'}
                </p>
                <p className="text-[11px] text-zinc-500">
                  {lang === 'uz'
                    ? 'Chap tarafdagi "To\'liq Dialog Podkastni Yaratish" tugmasini bosing. Barcha replikalar birlashtiriladi.'
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
