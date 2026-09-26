import React, { useState, useRef, useEffect } from 'react';
import { VoiceProfile, DialogueTurn } from '../types/podcast';
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
  const [speaker1Name, setSpeaker1Name] = useState<string>('Shokhrukh (Boshlovchi)');

  // Keep speaker1VoiceId in sync with user's verified cloned voice
  useEffect(() => {
    if (userClonedVoiceId) {
      setSpeaker1VoiceId(userClonedVoiceId);
    }
  }, [userClonedVoiceId]);

  // Speaker 2 (guest / expert)
  const [speaker2VoiceId, setSpeaker2VoiceId] = useState<string>(() => {
    const guest = voices.find((v) => v.id !== userClonedVoiceId && v.baseVoice === 'Puck') || voices[1] || voices[0];
    return guest?.id || 'Puck';
  });
  const [speaker2Name, setSpeaker2Name] = useState<string>('Aziza (AI Ekspert)');

  const [topic, setTopic] = useState<string>(
    initialTopic || 'Sun\'iy intellekt va inson tafakkuri: Kim kimni boshqaradi?'
  );
  const [tone, setTone] = useState<string>('Jonli va intellektual bahs');

  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
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
      },
      {
        id: 'turn-2',
        speakerId: 'HOST_2',
        speakerName: 'Aziza',
        text: 'Va alaykum assalom, Shokhrukh! Taklif uchun katta rahmat. Bugungi mavzu haqiqatan ham har birimizning kelajagimizga taalluqli.',
        emotion: 'thoughtful',
      },
      {
        id: 'turn-3',
        speakerId: 'HOST_1',
        speakerName: 'Shokhrukh',
        text: 'Ayting-chi, ko\'pchilik sun\'iy intellekt inson kasblarini yo\'q qiladi deb qo\'rqmoqda. Bu qo\'rquv qanchalik to\'g\'ri?',
        emotion: 'skeptical',
      },
      {
        id: 'turn-4',
        speakerId: 'HOST_2',
        speakerName: 'Aziza',
        text: 'Aslida AI insonni almashtirmaydi, balki AIdan unumli foydalangan inson boshqa mutaxassislardan ancha oldinga o\'tib ketadi.',
        emotion: 'thoughtful',
      },
    ];
  });

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

  // Individual turn audio player
  const [playingTurnId, setPlayingTurnId] = useState<string | null>(null);
  const singleAudioRef = useRef<HTMLAudioElement | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const speaker1Profile = voices.find((v) => v.id === speaker1VoiceId) || voices[0];
  const speaker2Profile = voices.find((v) => v.id === speaker2VoiceId) || voices[1] || voices[0];

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
          host1Role: 'Boshlovchi',
          host2Name: speaker2Name,
          host2Role: 'Mehmon',
          tone,
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
          },
          host2Voice: {
            voiceId: speaker2Profile?.voiceId || speaker2Profile?.id,
            baseVoice: speaker2Profile?.baseVoice || 'Puck',
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
      setIsPlaying(false);
    } else {
      audioRef.current.play();
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

  // Sync turn highlight with audio currentTime
  const handleTimeUpdate = () => {
    if (!audioRef.current || synthesizedTurns.length === 0) return;
    const curr = audioRef.current.currentTime;
    setMasterCurrentTime(curr);
    const activeIdx = synthesizedTurns.findIndex(
      (t) => curr >= (t.startTime || 0) && curr <= (t.endTime || 0) + 0.3
    );
    setActiveTurnIndex(activeIdx);
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
      ambientSound: 'none',
      ambientVolume: 0,
    });

    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  const downloadMasterAudio = () => {
    if (!masterAudioBase64) return;
    const byteCharacters = atob(masterAudioBase64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `intervyu-dialog-${Date.now()}.wav`;
    a.click();
    URL.revokeObjectURL(url);
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
          {/* Speakers Selector Card */}
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
              <Users2 className="w-4 h-4 text-emerald-400" />
              {lang === 'uz' ? '1. Ishtirokchilar va Ularning Ovozlari' : '1. Участники и Их Голоса'}
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Speaker 1 (Host) */}
              <div className="p-3.5 rounded-xl bg-zinc-950 border border-emerald-500/30 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5" /> 1-Boshlovchi (O\'zingiz)
                  </span>
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/40">
                    Haqiqiy Ovoz (Klon)
                  </span>
                </div>
                <input
                  type="text"
                  value={speaker1Name}
                  onChange={(e) => setSpeaker1Name(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-white"
                  placeholder="Ism..."
                />
                <select
                  value={speaker1VoiceId}
                  onChange={(e) => setSpeaker1VoiceId(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500"
                >
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} {v.isReplicatedVoice || v.id.includes('17raj9') ? '★ (Mening Ovoz Nusxam)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Speaker 2 (Guest) */}
              <div className="p-3.5 rounded-xl bg-zinc-950 border border-cyan-500/30 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-cyan-400 flex items-center gap-1.5">
                    <Bot className="w-3.5 h-3.5" /> 2-Mehmon / Ekspert
                  </span>
                  <span className="text-[10px] bg-cyan-500/20 text-cyan-300 px-2 py-0.5 rounded-full border border-cyan-500/40">
                    Mehmon
                  </span>
                </div>
                <input
                  type="text"
                  value={speaker2Name}
                  onChange={(e) => setSpeaker2Name(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-white"
                  placeholder="Ism..."
                />
                <select
                  value={speaker2VoiceId}
                  onChange={(e) => setSpeaker2VoiceId(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-cyan-500"
                >
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Dialogue Topic & AI Script Generator + Document Upload */}
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-emerald-400" />
                {lang === 'uz' ? '2. Dialog Mavzusi va Replikalar' : '2. Тема Диалога и Реплики'}
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

            <div className="flex gap-2">
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
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-1.5 transition-all shadow-md shadow-emerald-600/20 whitespace-nowrap cursor-pointer"
              >
                <Sparkles className={`w-3.5 h-3.5 ${isGeneratingScript ? 'animate-spin' : ''}`} />
                {isGeneratingScript ? 'Yaratilmoqda...' : lang === 'uz' ? 'AI Intervyu Matni' : 'AI Диалог'}
              </button>
            </div>

            {/* Turn by turn list */}
            <div className="space-y-3 pt-2">
              {turns.map((turn, index) => {
                const isHost1 = turn.speakerId === 'HOST_1';
                const isCurrentlyActive = activeTurnIndex === index;
                const turnAudio = synthesizedTurns[index]?.audioBase64;
                const isTurnPlaying = playingTurnId === turn.id;

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
                    <div className="flex items-center justify-between mb-2">
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
                    }}
                    className="relative h-2 bg-zinc-900 rounded-full overflow-hidden cursor-pointer hover:bg-zinc-800 transition-colors"
                  >
                    <div
                      className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-emerald-500 to-cyan-400 rounded-full transition-all"
                      style={{ width: `${totalDuration > 0 ? (masterCurrentTime / totalDuration) * 100 : 0}%` }}
                    />
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
