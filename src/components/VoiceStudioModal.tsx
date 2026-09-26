import React, { useState, useRef, useEffect } from 'react';
import {
  Mic,
  MicOff,
  Upload,
  Sparkles,
  Play,
  Pause,
  Save,
  Sliders,
  Check,
  X,
  Volume2,
  Cpu,
  Layers,
  AlertCircle,
  HelpCircle,
  Wand2,
  FileAudio,
  Radio,
  CheckCircle2,
  ArrowRight,
  ExternalLink,
  ShieldCheck,
  Fingerprint,
  RefreshCw,
  Key,
  Info,
} from 'lucide-react';
import { VoiceProfile, BaseVoiceModel } from '../types/podcast';
import { VoiceRecorder } from '../utils/audioUtils';

interface VoiceStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveVoice: (voice: VoiceProfile) => void;
  editingVoice?: VoiceProfile | null;
  lang: 'uz' | 'ru';
}

export const VoiceStudioModal: React.FC<VoiceStudioModalProps> = ({
  isOpen,
  onClose,
  onSaveVoice,
  editingVoice,
  lang,
}) => {
  if (!isOpen) return null;

  // Tabs:
  // 1: 'studio-voices' -> Connect / use Google AI Studio Voice Replication ID
  // 2: 'replication' -> Official Voice Replication (Sample + Mandatory Verbal Consent)
  // 3: 'voice-design' -> Create voice via text description (Voice Design)
  // 4: 'parameters' -> Adjust timbre, pitch, tempo
  const [activeTab, setActiveTab] = useState<'studio-voices' | 'replication' | 'voice-design' | 'parameters'>('studio-voices');

  // Form State
  const [voiceName, setVoiceName] = useState(editingVoice?.name || 'SHOKHRUKH (Mening Haqiqiy Ovozim)');
  const [voiceId, setVoiceId] = useState(editingVoice?.voiceId || 'voice_17raj9ewke3g');
  const [baseVoice, setBaseVoice] = useState<BaseVoiceModel>(editingVoice?.baseVoice || 'Charon');
  const [timbre, setTimbre] = useState(editingVoice?.timbre || 'Haqiqiy shaxsiy tembr (Google AI Studio Voice Replication)');
  const [tempo, setTempo] = useState(editingVoice?.tempo || 'Vazmin (1.0x)');
  const [style, setStyle] = useState(editingVoice?.style || 'Samimiy & Jonli podkaster');
  const [pitchLevel, setPitchLevel] = useState<VoiceProfile['pitchLevel']>(editingVoice?.pitchLevel || "O'rta (Bariton)");
  const [personaPrompt, setPersonaPrompt] = useState(
    editingVoice?.customPersonaPrompt ||
      "Google AI Studio Voice Replication orqali yaratilgan haqiqiy individual ovoz nusxasi."
  );

  // Status banners
  const [uiError, setUiError] = useState<string | null>(null);
  const [uiSuccess, setUiSuccess] = useState<string | null>(null);

  // Studio voices fetched from backend /api/voices
  const [detectedVoices, setDetectedVoices] = useState<any[]>([]);
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);

  // Audio test state
  const [isTestingVoice, setIsTestingVoice] = useState(false);
  const [isPlayingTestAudio, setIsPlayingTestAudio] = useState(false);
  const [testAudioInstance, setTestAudioInstance] = useState<HTMLAudioElement | null>(null);

  // Replication State (Source Audio + Consent Audio)
  const [sourceAudioBase64, setSourceAudioBase64] = useState<string | null>(null);
  const [sourceAudioName, setSourceAudioName] = useState<string | null>(null);
  const [consentAudioBase64, setConsentAudioBase64] = useState<string | null>(null);
  const [consentAudioName, setConsentAudioName] = useState<string | null>(null);
  const [isReplicating, setIsReplicating] = useState(false);

  // Recording State for in-browser recording
  const [recordingTarget, setRecordingTarget] = useState<'source' | 'consent' | null>(null);
  const [recordDuration, setRecordDuration] = useState(0);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const timerRef = useRef<any>(null);

  useEffect(() => {
    fetchStudioVoices();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (testAudioInstance) testAudioInstance.pause();
    };
  }, []);

  const fetchStudioVoices = async () => {
    setIsLoadingVoices(true);
    try {
      const res = await fetch('/api/voices');
      if (res.ok) {
        const data = await res.json();
        setDetectedVoices(data.voices || []);
        if (data.replicatedVoices && data.replicatedVoices.length > 0 && !editingVoice) {
          const first = data.replicatedVoices[0];
          setVoiceId(first.id);
          setVoiceName(`${first.displayName || first.name} (Haqiqiy Ovoz)`);
        }
      }
    } catch (e) {
      console.warn('Failed to fetch voices:', e);
    } finally {
      setIsLoadingVoices(false);
    }
  };

  // Convert File to Base64
  const handleFileUpload = (file: File, type: 'source' | 'consent') => {
    setUiError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      if (type === 'source') {
        setSourceAudioBase64(base64);
        setSourceAudioName(file.name);
      } else {
        setConsentAudioBase64(base64);
        setConsentAudioName(file.name);
      }
    };
    reader.onerror = () => setUiError("Faylni o'qishda xatolik yuz berdi");
    reader.readAsDataURL(file);
  };

  // Start Mic Recording
  const startRecording = async (type: 'source' | 'consent') => {
    setUiError(null);
    try {
      const recorder = new VoiceRecorder();
      await recorder.start();
      recorderRef.current = recorder;
      setRecordingTarget(type);
      setRecordDuration(0);

      timerRef.current = setInterval(() => {
        setRecordDuration((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      setUiError(
        lang === 'uz'
          ? "Brauzer mikrofoniga ulanib bo'lmadi. Yuqoridagi «Audio fayl yuklash» tugmasi orqali telefoningizda yozilgan audio faylni yuklashingiz mumkin."
          : "Не удалось подключиться к микрофону. Вы можете загрузить аудиофайл, записанный на телефоне или диктофоне."
      );
    }
  };

  // Stop Mic Recording
  const stopRecording = async () => {
    if (!recorderRef.current) return;
    if (timerRef.current) clearInterval(timerRef.current);

    try {
      const { base64 } = await recorderRef.current.stop();
      if (recordingTarget === 'source') {
        setSourceAudioBase64(base64);
        setSourceAudioName(`Mikrofon_yozuvi_${recordDuration}s.wav`);
      } else if (recordingTarget === 'consent') {
        setConsentAudioBase64(base64);
        setConsentAudioName(`Rozilik_yozuvi_${recordDuration}s.wav`);
      }
    } catch (err: any) {
      setUiError("Yozuvni saqlashda xatolik yuz berdi");
    } finally {
      recorderRef.current = null;
      setRecordingTarget(null);
      setRecordDuration(0);
    }
  };

  // Test current selected voice
  const handleTestVoice = async (targetVoiceId?: string, targetVoiceName?: string) => {
    const vId = targetVoiceId || voiceId;
    const vName = targetVoiceName || voiceName;

    if (isPlayingTestAudio && testAudioInstance) {
      testAudioInstance.pause();
      setIsPlayingTestAudio(false);
      return;
    }

    setIsTestingVoice(true);
    setUiError(null);

    try {
      const sampleText =
        lang === 'uz'
          ? `Salom! Men ${vName}man. Google AI Studio Voice Replication texnologiyasi orqali sintez qilingan haqiqiy ovozman.`
          : `Здравствуйте! Это ${vName}. Настоящая голосовая копия через Google AI Studio Voice Replication.`;

      const res = await fetch('/api/podcast/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: sampleText,
          voiceProfile: {
            voiceName: vName,
            voiceId: vId,
            baseVoice,
            timbre,
            tempo,
            customPersonaPrompt: personaPrompt,
          },
          speechStyle: style,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Sintez xatosi');
      }

      const data = await res.json();
      if (data.audioBase64) {
        const binary = window.atob(data.audioBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        setTestAudioInstance(audio);
        setIsPlayingTestAudio(true);
        audio.onended = () => setIsPlayingTestAudio(false);
        audio.onerror = () => setIsPlayingTestAudio(false);
        await audio.play();
      }
    } catch (err: any) {
      setUiError(`Ovozni sinashda xatolik: ${err.message}`);
    } finally {
      setIsTestingVoice(false);
    }
  };

  // Create new Voice Replication via API
  const handleCreateVoiceReplication = async () => {
    if (!sourceAudioBase64) {
      setUiError(lang === 'uz' ? "1-qadam: Ovoz namunasini yuklang yoki yozing" : "Шаг 1: Загрузите или запишите образец голоса");
      return;
    }
    if (!consentAudioBase64) {
      setUiError(lang === 'uz' ? "2-qadam: Ovozli rozilik namunasini yuklang yoki yozing" : "Шаг 2: Загрузите или запишите согласие на создание голоса");
      return;
    }

    setIsReplicating(true);
    setUiError(null);
    setUiSuccess(null);

    try {
      const res = await fetch('/api/voices/replicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: voiceName,
          sourceAudioBase64,
          consentAudioBase64,
          mimeType: 'audio/wav',
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Ovoz nusxalashda xatolik');
      }

      const data = await res.json();
      const newVoiceId = data.voiceId || data.voice?.id;

      setVoiceId(newVoiceId);
      setUiSuccess(
        lang === 'uz'
          ? `🎉 Tabriklaymiz! Ovoz nusxangiz muvaffaqiyatli yaratildi (ID: ${newVoiceId})!`
          : `🎉 Поздравляем! Ваша голосовая копия успешно создана (ID: ${newVoiceId})!`
      );

      // Refresh voice list
      await fetchStudioVoices();
    } catch (err: any) {
      setUiError(`Ovoz nusxalash xatosi: ${err.message}`);
    } finally {
      setIsReplicating(false);
    }
  };

  // Save and activate voice in podcast app
  const handleSaveAndActivate = () => {
    const profile: VoiceProfile = {
      id: voiceId || `custom-${Date.now()}`,
      voiceId: voiceId,
      name: voiceName,
      baseVoice,
      voiceType: voiceId ? 'replicated' : 'prebuilt',
      model: 'models/gemini-3.8-flash-tts',
      timbre,
      tempo,
      pitchLevel,
      style,
      customPersonaPrompt: personaPrompt,
      isUserCustomVoice: true,
      isReplicatedVoice: Boolean(voiceId && (voiceId.startsWith('voice_') || voiceId.startsWith('voicekey_'))),
      sampleNotes: voiceId ? `Google AI Studio ID: ${voiceId}` : undefined,
    };

    onSaveVoice(profile);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-zinc-950 border border-zinc-800 rounded-3xl max-w-3xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-5 sm:p-6 border-b border-zinc-800/90 flex items-center justify-between bg-zinc-900/60">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-cyan-500 to-blue-600 text-zinc-950 shadow-lg shadow-cyan-500/20">
              <Fingerprint className="w-6 h-6 stroke-[2.2]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                  Gemini 3.8 Flash TTS
                </span>
                <span className="text-xs text-zinc-500">•</span>
                <span className="text-xs text-zinc-400 font-mono">Voice Replication</span>
              </div>
              <h3 className="text-lg sm:text-xl font-bold text-white mt-0.5">
                {lang === 'uz' ? 'Shaxsiy Ovoz Studiyasi & Voice Replication' : 'Студия Своего Голоса & Voice Replication'}
              </h3>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-zinc-800/80 bg-zinc-900/40 px-4 sm:px-6 overflow-x-auto gap-2">
          <button
            onClick={() => setActiveTab('studio-voices')}
            className={`py-3 px-3 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-2 whitespace-nowrap transition-all ${
              activeTab === 'studio-voices'
                ? 'border-cyan-400 text-cyan-300'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>{lang === 'uz' ? '1. Google AI Studio Ovozi (Voice ID)' : '1. Голос Google AI Studio (Voice ID)'}</span>
          </button>

          <button
            onClick={() => setActiveTab('replication')}
            className={`py-3 px-3 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-2 whitespace-nowrap transition-all ${
              activeTab === 'replication'
                ? 'border-cyan-400 text-cyan-300'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Mic className="w-4 h-4 text-cyan-400" />
            <span>{lang === 'uz' ? '2. Yangi Ovoz Nusxalash (Replication)' : '2. Клонирование Голоса (Replication)'}</span>
          </button>

          <button
            onClick={() => setActiveTab('parameters')}
            className={`py-3 px-3 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-2 whitespace-nowrap transition-all ${
              activeTab === 'parameters'
                ? 'border-cyan-400 text-cyan-300'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Sliders className="w-4 h-4 text-indigo-400" />
            <span>{lang === 'uz' ? '3. Tembr & Parametrlar' : '3. Тембр и Параметры'}</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-7 space-y-6">
          {/* Notification Alerts */}
          {uiError && (
            <div className="p-4 rounded-2xl bg-red-950/60 border border-red-500/40 text-red-200 text-xs sm:text-sm flex items-start gap-3 shadow-lg">
              <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1 leading-relaxed">{uiError}</div>
              <button onClick={() => setUiError(null)} className="text-red-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {uiSuccess && (
            <div className="p-4 rounded-2xl bg-emerald-950/60 border border-emerald-500/40 text-emerald-200 text-xs sm:text-sm flex items-start gap-3 shadow-lg">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div className="flex-1 leading-relaxed">{uiSuccess}</div>
              <button onClick={() => setUiSuccess(null)} className="text-emerald-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* TAB 1: CONNECT GOOGLE AI STUDIO VOICE */}
          {activeTab === 'studio-voices' && (
            <div className="space-y-6">
              {/* Explanation Card */}
              <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-emerald-950/40 via-zinc-900 to-zinc-900 border border-emerald-500/30 space-y-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  <h4 className="font-bold text-white text-sm sm:text-base">
                    {lang === 'uz' ? 'Google AI Studio Voice Replication Qanday Ishlaydi?' : 'Как работает Voice Replication в Google AI Studio?'}
                  </h4>
                </div>
                <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
                  {lang === 'uz'
                    ? 'Google AI Studio-da siz 30 soniyalik ovoz namunasi va rozilik bildirishi orqali shaxsiy ovozingizni nusxalagansiz (Replication). Ushbu tizim sizning unikal Voice ID (masalan, voice_17raj9ewke3g) orqali aynan sizning ovozingizda podkast sintez qiladi.'
                    : 'В Google AI Studio вы создали копию своего голоса (Voice Replication). Система использует уникальный идентификатор голоса Voice ID (например, voice_17raj9ewke3g), чтобы подкасты звучали точно вашим голосом.'}
                </p>
              </div>

              {/* Detected Voices List from Gemini API */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-zinc-300 flex items-center gap-2">
                    <Fingerprint className="w-4 h-4 text-cyan-400" />
                    <span>{lang === 'uz' ? 'AI Studio Loyihangizdagi Ovozlar:' : 'Голоса вашего проекта в Google AI Studio:'}</span>
                  </label>
                  <button
                    onClick={fetchStudioVoices}
                    disabled={isLoadingVoices}
                    className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-cyan-300 transition-colors"
                  >
                    <RefreshCw className={`w-3 h-3 ${isLoadingVoices ? 'animate-spin' : ''}`} />
                    <span>{lang === 'uz' ? 'Yangilash' : 'Обновить'}</span>
                  </button>
                </div>

                <div className="space-y-2">
                  {detectedVoices.filter((v) => v.type === 'replicated' || v.type === 'prompted').length === 0 ? (
                    <div className="p-4 rounded-2xl bg-zinc-900/60 border border-zinc-800 text-center space-y-2">
                      <p className="text-xs text-zinc-400">
                        {lang === 'uz' ? 'Standart nusxalangan ovoz: SHOKHRUKH (voice_17raj9ewke3g)' : 'Стандартный голос: SHOKHRUKH (voice_17raj9ewke3g)'}
                      </p>
                    </div>
                  ) : (
                    detectedVoices
                      .filter((v) => v.type === 'replicated' || v.type === 'prompted')
                      .map((v) => {
                        const isThisSelected = voiceId === v.id;
                        return (
                          <div
                            key={v.id}
                            className={`p-4 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                              isThisSelected
                                ? 'bg-cyan-950/30 border-cyan-500 ring-2 ring-cyan-500/20 shadow-xl'
                                : 'bg-zinc-900/60 border-zinc-800 hover:border-zinc-700'
                            }`}
                          >
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-white">{v.displayName || v.name}</span>
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                                  <ShieldCheck className="w-3 h-3" />
                                  Replicated Voice
                                </span>
                              </div>
                              <div className="text-xs font-mono text-zinc-400">
                                ID: <span className="text-cyan-300">{v.id}</span> • {v.model || 'gemini-3.8-flash-tts'}
                              </div>
                            </div>

                            <div className="flex items-center gap-2 self-start sm:self-center">
                              <button
                                onClick={() => handleTestVoice(v.id, v.displayName || v.name)}
                                disabled={isTestingVoice}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-cyan-300 border border-cyan-500/30 text-xs font-semibold transition-all hover:scale-105 active:scale-95"
                              >
                                {isTestingVoice ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                                <span>{isTestingVoice ? 'Sintez...' : 'Sinash (Test)'}</span>
                              </button>

                              <button
                                onClick={() => {
                                  setVoiceId(v.id);
                                  setVoiceName(`${v.displayName || v.name} (Haqiqiy Ovoz)`);
                                  setUiSuccess(`«${v.displayName || v.name}» faol ovoz sifatida belgilandi!`);
                                }}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                                  isThisSelected
                                    ? 'bg-emerald-500 text-zinc-950 shadow-md shadow-emerald-500/20'
                                    : 'bg-cyan-500 hover:bg-cyan-400 text-zinc-950'
                                }`}
                              >
                                <Check className="w-3.5 h-3.5 stroke-[3]" />
                                <span>{isThisSelected ? 'Tanlangan' : 'Tanlash'}</span>
                              </button>
                            </div>
                          </div>
                        );
                      })
                  )}
                </div>
              </div>

              {/* Manual Voice ID Input */}
              <div className="p-4 rounded-2xl bg-zinc-900/60 border border-zinc-800 space-y-3">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-cyan-400" />
                  <label className="text-xs font-bold text-zinc-300">
                    {lang === 'uz' ? 'Boshqa Voice ID yoki Voice Key kiritish:' : 'Ввести другой Voice ID или Voice Key:'}
                  </label>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={voiceId}
                    onChange={(e) => setVoiceId(e.target.value.trim())}
                    placeholder="Masalan: voice_17raj9ewke3g yoki voicekey_..."
                    className="flex-1 px-4 py-2.5 rounded-xl bg-zinc-950 border border-zinc-700 text-white font-mono text-xs focus:outline-none focus:border-cyan-500"
                  />
                  <button
                    onClick={() => handleTestVoice(voiceId, voiceName)}
                    disabled={!voiceId || isTestingVoice}
                    className="px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-cyan-300 border border-cyan-500/30 text-xs font-semibold flex items-center justify-center gap-2"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>{lang === 'uz' ? 'Tekshirish & Eshittirish' : 'Проверить и прослушать'}</span>
                  </button>
                </div>
                <p className="text-[11px] text-zinc-400">
                  {lang === 'uz'
                    ? 'Google AI Studio Speech & Voices sahifasida yaratilgan har qanday ovoz ID sini bu yerga nusxalab qo\'yishingiz mumkin.'
                    : 'Вы можете вставить сюда любой Voice ID, созданный в Google AI Studio во вкладке Speech & Voices.'}
                </p>
              </div>

              {/* Voice Name in App */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-zinc-300">
                  {lang === 'uz' ? 'Ilovadagi Ovoz Nomi:' : 'Отображаемое имя голоса в приложении:'}
                </label>
                <input
                  type="text"
                  value={voiceName}
                  onChange={(e) => setVoiceName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-white text-sm focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>
          )}

          {/* TAB 2: OFFICIAL VOICE REPLICATION FLOW */}
          {activeTab === 'replication' && (
            <div className="space-y-6">
              <div className="p-4 rounded-2xl bg-cyan-950/30 border border-cyan-500/30 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Info className="w-4 h-4 text-cyan-400" />
                  <h4 className="font-bold text-white text-xs sm:text-sm">
                    {lang === 'uz' ? 'Gemini 3.8 Voice Replication Talablari' : 'Требования Gemini 3.8 Voice Replication'}
                  </h4>
                </div>
                <p className="text-xs text-zinc-300 leading-relaxed">
                  {lang === 'uz'
                    ? "Google qat'iy xavfsizlik va biometrik qoidalariga ko'ra 2 ta audio talab etiladi: 1) Sizning 10-30 soniyalik tabiiy nutq namunangiz; 2) Majburiy ovozli rozilik bayonoti."
                    : 'По правилам безопасности Google требует 2 записи: 1) Образец вашей речи на 10-30 сек; 2) Обязательное голосовое согласие владельца голоса.'}
                </p>
              </div>

              {/* Step 1: Source Audio */}
              <div className="p-4 sm:p-5 rounded-2xl bg-zinc-900/60 border border-zinc-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-cyan-500 text-zinc-950 font-extrabold text-xs flex items-center justify-center">1</span>
                    {lang === 'uz' ? 'Ovoz Namunasi (10–30 soniya nutq)' : 'Образец Голоса (10-30 секунд речи)'}
                  </span>
                  {sourceAudioBase64 && (
                    <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" /> {sourceAudioName || 'Yuklandi'}
                    </span>
                  )}
                </div>

                <p className="text-xs text-zinc-400">
                  {lang === 'uz'
                    ? 'O\'zbek tilida erkin, ravon 1-2 jumla o\'qing (masalan: «Salom! Mening ismim Shoxruh. Men podkast yozmoqdaman...»)'
                    : 'Прочтите внятно 1-2 предложения на узбекском или русском языке.'}
                </p>

                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-semibold cursor-pointer transition-all border border-zinc-700">
                    <Upload className="w-4 h-4 text-cyan-400" />
                    <span>{lang === 'uz' ? 'Audio Fayl Yuklash (.wav, .mp3)' : 'Загрузить файл (.wav, .mp3)'}</span>
                    <input
                      type="file"
                      accept="audio/*"
                      onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0], 'source')}
                      className="hidden"
                    />
                  </label>

                  <button
                    onClick={() => (recordingTarget === 'source' ? stopRecording() : startRecording('source'))}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                      recordingTarget === 'source'
                        ? 'bg-red-500 text-white animate-pulse'
                        : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700'
                    }`}
                  >
                    {recordingTarget === 'source' ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4 text-red-400" />}
                    <span>{recordingTarget === 'source' ? `To'xtatish (${recordDuration}s)` : 'Mikrofon orqali yozish'}</span>
                  </button>
                </div>
              </div>

              {/* Step 2: Consent Audio */}
              <div className="p-4 sm:p-5 rounded-2xl bg-zinc-900/60 border border-zinc-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-white flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-cyan-500 text-zinc-950 font-extrabold text-xs flex items-center justify-center">2</span>
                    {lang === 'uz' ? 'Majburiy Ovozli Rozilik (Consent Audio)' : 'Обязательное Согласие (Consent Audio)'}
                  </span>
                  {consentAudioBase64 && (
                    <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" /> {consentAudioName || 'Yuklandi'}
                    </span>
                  )}
                </div>

                <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-xs font-mono text-cyan-300">
                  "{lang === 'uz'
                    ? "Men ushbu ovozning egasiman va Google ushbu ovozdan sun'iy intellekt modeli yaratishiga roziman."
                    : "I am the owner of this voice and I consent to Google using this voice to create a synthetic voice model."}"
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-semibold cursor-pointer transition-all border border-zinc-700">
                    <Upload className="w-4 h-4 text-cyan-400" />
                    <span>{lang === 'uz' ? 'Rozilik faylini yuklash' : 'Загрузить аудио согласия'}</span>
                    <input
                      type="file"
                      accept="audio/*"
                      onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0], 'consent')}
                      className="hidden"
                    />
                  </label>

                  <button
                    onClick={() => (recordingTarget === 'consent' ? stopRecording() : startRecording('consent'))}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                      recordingTarget === 'consent'
                        ? 'bg-red-500 text-white animate-pulse'
                        : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700'
                    }`}
                  >
                    {recordingTarget === 'consent' ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4 text-red-400" />}
                    <span>{recordingTarget === 'consent' ? `To'xtatish (${recordDuration}s)` : 'Rozilikni yozib olish'}</span>
                  </button>
                </div>
              </div>

              {/* Replicate Button */}
              <button
                onClick={handleCreateVoiceReplication}
                disabled={!sourceAudioBase64 || !consentAudioBase64 || isReplicating}
                className={`w-full py-3.5 px-6 rounded-2xl font-bold text-sm shadow-xl flex items-center justify-center gap-2 transition-all ${
                  sourceAudioBase64 && consentAudioBase64 && !isReplicating
                    ? 'bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 text-zinc-950 shadow-emerald-500/20 hover:scale-[1.02] active:scale-[0.98]'
                    : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                }`}
              >
                {isReplicating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Fingerprint className="w-4 h-4 stroke-[2.5]" />}
                <span>
                  {isReplicating
                    ? (lang === 'uz' ? 'Gemini 3.8 da Ovoz Nusxalanmoqda...' : 'Клонирование в Gemini 3.8...')
                    : (lang === 'uz' ? 'Gemini 3.8 da Haqiqiy Ovoz Nusxasini Yaratish' : 'Создать Копию Своего Голоса')}
                </span>
              </button>
            </div>
          )}

          {/* TAB 3: PARAMETERS & ACOUSTIC TUNING */}
          {activeTab === 'parameters' && (
            <div className="space-y-5">
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-300">
                  {lang === 'uz' ? 'Ovoz Tembri va Akustik Chuqurligi:' : 'Тембр голоса:'}
                </label>
                <input
                  type="text"
                  value={timbre}
                  onChange={(e) => setTimbre(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-white text-xs font-medium focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-300">
                  {lang === 'uz' ? 'Gemini 3.8 Voice Persona Prompt:' : 'Промпт персоны голоса:'}
                </label>
                <textarea
                  rows={3}
                  value={personaPrompt}
                  onChange={(e) => setPersonaPrompt(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-white text-xs leading-relaxed focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-zinc-300">{lang === 'uz' ? 'Ovoz Turi:' : 'Базовый голос:'}</label>
                  <select
                    value={baseVoice}
                    onChange={(e) => setBaseVoice(e.target.value as BaseVoiceModel)}
                    className="w-full px-4 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-white text-xs"
                  >
                    <option value="Charon">Charon (Vazmin Bariton)</option>
                    <option value="Puck">Puck (Quvnoq Tenor)</option>
                    <option value="Kore">Kore (Mayin Ayol)</option>
                    <option value="Fenrir">Fenrir (Chuqur Bas)</option>
                    <option value="Zephyr">Zephyr (Ilmiy / Texno)</option>
                    <option value="Aoede">Aoede (Nafis Ayol)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-zinc-300">{lang === 'uz' ? 'Balandlik (Pitch):' : 'Высота:'}</label>
                  <select
                    value={pitchLevel}
                    onChange={(e) => setPitchLevel(e.target.value as any)}
                    className="w-full px-4 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-white text-xs"
                  >
                    <option value="Past (Bas)">Past (Bas)</option>
                    <option value="O'rta (Bariton)">O'rta (Bariton)</option>
                    <option value="Baland (Tenor/Soprano)">Baland (Tenor/Soprano)</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer with Actions */}
        <div className="p-4 sm:p-6 border-t border-zinc-800/90 bg-zinc-900/60 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <Fingerprint className="w-4 h-4 text-cyan-400" />
            <span>Faol Voice ID: <strong className="font-mono text-cyan-300">{voiceId || 'Standart'}</strong></span>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            <button
              onClick={() => handleTestVoice(voiceId, voiceName)}
              disabled={isTestingVoice}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-cyan-300 border border-cyan-500/30 text-xs font-semibold transition-all hover:scale-105 active:scale-95"
            >
              {isTestingVoice ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
              <span>{isTestingVoice ? 'Sintez...' : 'Ovozni sinash'}</span>
            </button>

            <button
              onClick={handleSaveAndActivate}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-zinc-950 text-xs font-bold shadow-lg shadow-cyan-500/20 transition-all hover:scale-105 active:scale-95"
            >
              <Check className="w-4 h-4 stroke-[3]" />
              <span>{lang === 'uz' ? 'Ovozni Saqlash & Tanlash' : 'Сохранить и Выбрать'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
