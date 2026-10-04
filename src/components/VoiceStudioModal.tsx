import React, { useState, useRef, useEffect } from 'react';
import { connectAudioElement } from '../utils/audioReactive';
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
  Lock,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
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
  const { isAuthenticated, requireAuth } = useAuth();
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
    if (
      !requireAuth(
        () => {},
        lang === 'uz'
          ? "Ovozni sinab ko'rish faqat ro'yxatdan o'tgan foydalanuvchilar uchun ochiq. Avval kiring!"
          : "Тестирование голоса доступно только для зарегистрированных пользователей."
      )
    )
      return;

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
        connectAudioElement(audio);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-[#161511]/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#F4F1EA] text-[#161511] border border-[rgba(22,21,17,0.14)] rounded-[26px] max-w-3xl w-full max-h-[92vh] flex flex-col shadow-[0_30px_50px_-30px_rgba(22,21,17,0.35)] overflow-hidden">
        {/* Header */}
        <div className="p-5 sm:p-6 border-b border-[rgba(22,21,17,0.1)] flex items-center justify-between bg-white/70 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-full bg-[#161511] text-[#F4F1EA] shadow-xs">
              <Fingerprint className="w-5 h-5 stroke-[2]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10.5px] font-mono font-semibold px-2 py-0.5 rounded-full bg-[#0E7C86]/10 text-[#0A5A62] border border-[#0E7C86]/30">
                  Gemini 3.8 Flash TTS
                </span>
                <span className="text-xs text-[#5D594E]/40">•</span>
                <span className="text-xs text-[#5D594E] font-mono">Voice Replication</span>
              </div>
              <h3 className="font-serif text-xl sm:text-2xl text-[#161511] font-normal tracking-tight mt-0.5">
                {lang === 'uz' ? 'Shaxsiy Ovoz Studiyasi & ' : 'Студия Своего Голоса & '}
                <em className="text-[#0E7C86] italic">Voice Replication</em>
              </h3>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full text-[#5D594E] hover:text-[#161511] hover:bg-white border border-[rgba(22,21,17,0.1)] transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-[rgba(22,21,17,0.1)] bg-white/50 px-4 sm:px-6 overflow-x-auto gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('studio-voices')}
            className={`py-3 px-3 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-2 whitespace-nowrap transition-all cursor-pointer ${
              activeTab === 'studio-voices'
                ? 'border-[#0E7C86] text-[#0A5A62]'
                : 'border-transparent text-[#5D594E] hover:text-[#161511]'
            }`}
          >
            <ShieldCheck className="w-4 h-4 text-[#0E7C86]" />
            <span>{lang === 'uz' ? '1. Google AI Studio Ovozi (Voice ID)' : '1. Голос Google AI Studio (Voice ID)'}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('replication')}
            className={`py-3 px-3 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-2 whitespace-nowrap transition-all cursor-pointer ${
              activeTab === 'replication'
                ? 'border-[#0E7C86] text-[#0A5A62]'
                : 'border-transparent text-[#5D594E] hover:text-[#161511]'
            }`}
          >
            <Mic className="w-4 h-4 text-[#0E7C86]" />
            <span>{lang === 'uz' ? '2. Yangi Ovoz Nusxalash (Replication)' : '2. Клонирование Голоса (Replication)'}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('parameters')}
            className={`py-3 px-3 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-2 whitespace-nowrap transition-all cursor-pointer ${
              activeTab === 'parameters'
                ? 'border-[#0E7C86] text-[#0A5A62]'
                : 'border-transparent text-[#5D594E] hover:text-[#161511]'
            }`}
          >
            <Sliders className="w-4 h-4 text-[#0E7C86]" />
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
                    <Fingerprint className="w-4 h-4 text-amber-400" />
                    <span>{lang === 'uz' ? 'AI Studio Loyihangizdagi Ovozlar:' : 'Голоса вашего проекта в Google AI Studio:'}</span>
                  </label>
                  <button
                    onClick={fetchStudioVoices}
                    disabled={isLoadingVoices}
                    className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-amber-300 transition-colors"
                  >
                    <RefreshCw className={`w-3 h-3 ${isLoadingVoices ? 'animate-spin' : ''}`} />
                    <span>{lang === 'uz' ? 'Yangilash' : 'Обновить'}</span>
                  </button>
                </div>

                <div className="space-y-2">
                  {detectedVoices.filter((v) => v.type === 'replicated' || v.type === 'prompted').length === 0 ? (
                    <div className="p-4 rounded-2xl bg-white border border-[rgba(22,21,17,0.14)] text-center space-y-2">
                      <p className="text-xs text-[#5D594E] font-mono">
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
                                ? 'bg-white border-[#0E7C86] ring-2 ring-[#0E7C86]/20 shadow-md'
                                : 'bg-white border-[rgba(22,21,17,0.14)] hover:border-[#0E7C86]'
                            }`}
                          >
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-[#161511]">{v.displayName || v.name}</span>
                                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-[#0E7C86]/10 text-[#0A5A62] border border-[#0E7C86]/30 flex items-center gap-1">
                                  <ShieldCheck className="w-3 h-3" />
                                  Replicated Voice
                                </span>
                              </div>
                              <div className="text-xs font-mono text-[#5D594E]">
                                ID: <span className="text-[#0E7C86]">{v.id}</span> • {v.model || 'gemini-3.8-flash-tts'}
                              </div>
                            </div>

                            <div className="flex items-center gap-2 self-start sm:self-center">
                              <button
                                type="button"
                                onClick={() => handleTestVoice(v.id, v.displayName || v.name)}
                                disabled={isTestingVoice}
                                className="btn-pill btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5"
                              >
                                {isTestingVoice ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                                <span>{isTestingVoice ? 'Sintez...' : 'Sinash (Test)'}</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  setVoiceId(v.id);
                                  setVoiceName(`${v.displayName || v.name} (Haqiqiy Ovoz)`);
                                  setUiSuccess(`«${v.displayName || v.name}» faol ovoz sifatida belgilandi!`);
                                }}
                                className={`btn-pill text-xs px-3 py-1.5 flex items-center gap-1.5 cursor-pointer ${
                                  isThisSelected
                                    ? 'btn-solid bg-[#0E7C86] text-white'
                                    : 'btn-solid'
                                }`}
                              >
                                <Check className="w-3.5 h-3.5 stroke-[2.5]" />
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
              <div className="p-5 rounded-2xl bg-white border border-[rgba(22,21,17,0.14)] space-y-3 shadow-xs">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-[#0E7C86]" />
                  <label className="text-xs font-mono uppercase tracking-wider text-[#5D594E]">
                    {lang === 'uz' ? 'Boshqa Voice ID yoki Voice Key kiritish:' : 'Ввести другой Voice ID или Voice Key:'}
                  </label>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={voiceId}
                    onChange={(e) => setVoiceId(e.target.value.trim())}
                    placeholder="Masalan: voice_17raj9ewke3g yoki voicekey_..."
                    className="flex-1 px-4 py-2.5 rounded-xl bg-[#F4F1EA] border border-[rgba(22,21,17,0.14)] text-[#161511] font-mono text-xs focus:outline-none focus:border-[#0E7C86] focus:bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => handleTestVoice(voiceId, voiceName)}
                    disabled={!voiceId || isTestingVoice}
                    className="btn-pill btn-ghost text-xs px-4 py-2 flex items-center justify-center gap-2"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>{lang === 'uz' ? 'Tekshirish & Eshittirish' : 'Проверить и прослушать'}</span>
                  </button>
                </div>
                <p className="text-[11px] text-[#5D594E]">
                  {lang === 'uz'
                    ? 'Google AI Studio Speech & Voices sahifasida yaratilgan har qanday ovoz ID sini bu yerga nusxalab qo\'yishingiz mumkin.'
                    : 'Вы можете вставить сюда любой Voice ID, созданный в Google AI Studio во вкладке Speech & Voices.'}
                </p>
              </div>

              {/* Voice Name in App */}
              <div className="space-y-1.5">
                <label className="text-xs font-mono uppercase tracking-wider text-[#5D594E]">
                  {lang === 'uz' ? 'Ilovadagi Ovoz Nomi:' : 'Отображаемое имя голоса в приложении:'}
                </label>
                <input
                  type="text"
                  value={voiceName}
                  onChange={(e) => setVoiceName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-white border border-[rgba(22,21,17,0.14)] text-[#161511] text-sm focus:outline-none focus:border-[#0E7C86]"
                />
              </div>
            </div>
          )}

          {/* TAB 2: OFFICIAL VOICE REPLICATION FLOW */}
          {activeTab === 'replication' && (
            <div className="space-y-6">
              <div className="p-4 rounded-2xl bg-white border border-[rgba(22,21,17,0.14)] space-y-1.5 shadow-2xs">
                <div className="flex items-center gap-2">
                  <Info className="w-4 h-4 text-[#0E7C86]" />
                  <h4 className="font-semibold text-[#161511] text-xs sm:text-sm">
                    {lang === 'uz' ? 'Gemini 3.8 Voice Replication Talablari' : 'Требования Gemini 3.8 Voice Replication'}
                  </h4>
                </div>
                <p className="text-xs text-[#5D594E] leading-relaxed">
                  {lang === 'uz'
                    ? "Google qat'iy xavfsizlik va biometrik qoidalariga ko'ra 2 ta audio talab etiladi: 1) Sizning 10-30 soniyalik tabiiy nutq namunangiz; 2) Majburiy ovozli rozilik bayonoti."
                    : 'По правилам безопасности Google требует 2 записи: 1) Образец вашей речи на 10-30 сек; 2) Обязательное голосовое согласие владельца голоса.'}
                </p>
              </div>

              {/* Step 1: Source Audio */}
              <div className="p-5 rounded-2xl bg-white border border-[rgba(22,21,17,0.14)] space-y-3 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#161511] flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#161511] text-[#F4F1EA] font-mono font-bold text-xs flex items-center justify-center">1</span>
                    {lang === 'uz' ? 'Ovoz Namunasi (10–30 soniya nutq)' : 'Образец Голоса (10-30 секунд речи)'}
                  </span>
                  {sourceAudioBase64 && (
                    <span className="text-[11px] font-mono font-bold text-[#0E7C86] flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" /> {sourceAudioName || 'Yuklandi'}
                    </span>
                  )}
                </div>

                <p className="text-xs text-[#5D594E]">
                  {lang === 'uz'
                    ? 'O\'zbek tilida erkin, ravon 1-2 jumla o\'qing (masalan: «Salom! Mening ismim Shoxruh. Men podkast yozmoqdaman...»)'
                    : 'Прочтите внятно 1-2 предложения на узбекском или русском языке.'}
                </p>

                <div className="flex flex-wrap items-center gap-3">
                  <label className="btn-pill btn-ghost text-xs px-4 py-2 cursor-pointer flex items-center gap-2">
                    <Upload className="w-4 h-4 text-[#0E7C86]" />
                    <span>{lang === 'uz' ? 'Audio Fayl Yuklash (.wav, .mp3)' : 'Загрузить файл (.wav, .mp3)'}</span>
                    <input
                      type="file"
                      accept="audio/*"
                      onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0], 'source')}
                      className="hidden"
                    />
                  </label>

                  <button
                    type="button"
                    onClick={() => (recordingTarget === 'source' ? stopRecording() : startRecording('source'))}
                    className={`btn-pill text-xs px-4 py-2 flex items-center gap-2 cursor-pointer ${
                      recordingTarget === 'source'
                        ? 'bg-[#C4552D] text-white animate-pulse'
                        : 'btn-ghost'
                    }`}
                  >
                    {recordingTarget === 'source' ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4 text-[#C4552D]" />}
                    <span>{recordingTarget === 'source' ? `To'xtatish (${recordDuration}s)` : 'Mikrofon orqali yozish'}</span>
                  </button>
                </div>
              </div>

              {/* Step 2: Consent Audio */}
              <div className="p-5 rounded-2xl bg-white border border-[rgba(22,21,17,0.14)] space-y-3 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#161511] flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#161511] text-[#F4F1EA] font-mono font-bold text-xs flex items-center justify-center">2</span>
                    {lang === 'uz' ? 'Majburiy Ovozli Rozilik (Consent Audio)' : 'Обязательное Согласие (Consent Audio)'}
                  </span>
                  {consentAudioBase64 && (
                    <span className="text-[11px] font-mono font-bold text-[#0E7C86] flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" /> {consentAudioName || 'Yuklandi'}
                    </span>
                  )}
                </div>

                <div className="p-3.5 rounded-xl bg-[#F4F1EA] border border-[rgba(22,21,17,0.14)] text-xs font-mono text-[#0A5A62]">
                  "{lang === 'uz'
                    ? "Men ushbu ovozning egasiman va Google ushbu ovozdan sun'iy intellekt modeli yaratishiga roziman."
                    : "I am the owner of this voice and I consent to Google using this voice to create a synthetic voice model."}"
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <label className="btn-pill btn-ghost text-xs px-4 py-2 cursor-pointer flex items-center gap-2">
                    <Upload className="w-4 h-4 text-[#0E7C86]" />
                    <span>{lang === 'uz' ? 'Rozilik faylini yuklash' : 'Загрузить аудио согласия'}</span>
                    <input
                      type="file"
                      accept="audio/*"
                      onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0], 'consent')}
                      className="hidden"
                    />
                  </label>

                  <button
                    type="button"
                    onClick={() => (recordingTarget === 'consent' ? stopRecording() : startRecording('consent'))}
                    className={`btn-pill text-xs px-4 py-2 flex items-center gap-2 cursor-pointer ${
                      recordingTarget === 'consent'
                        ? 'bg-[#C4552D] text-white animate-pulse'
                        : 'btn-ghost'
                    }`}
                  >
                    {recordingTarget === 'consent' ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4 text-[#C4552D]" />}
                    <span>{recordingTarget === 'consent' ? `To'xtatish (${recordDuration}s)` : 'Rozilikni yozib olish'}</span>
                  </button>
                </div>
              </div>

              {/* Replicate Button */}
              <button
                type="button"
                onClick={handleCreateVoiceReplication}
                disabled={!sourceAudioBase64 || !consentAudioBase64 || isReplicating}
                className={`w-full btn-pill py-3 text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 shadow-xs cursor-pointer ${
                  sourceAudioBase64 && consentAudioBase64 && !isReplicating
                    ? 'btn-solid'
                    : 'bg-[#ECE7DB] text-[#5D594E] cursor-not-allowed border border-[rgba(22,21,17,0.1)]'
                }`}
              >
                {isReplicating ? <RefreshCw className="w-4 h-4 animate-spin text-[#5CC8CF]" /> : <Fingerprint className="w-4 h-4 text-[#5CC8CF]" />}
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
                <label className="text-xs font-mono uppercase tracking-wider text-[#5D594E]">
                  {lang === 'uz' ? 'Ovoz Tembri va Akustik Chuqurligi:' : 'Тембр голоса:'}
                </label>
                <input
                  type="text"
                  value={timbre}
                  onChange={(e) => setTimbre(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-white border border-[rgba(22,21,17,0.14)] text-[#161511] text-xs font-medium focus:outline-none focus:border-[#0E7C86]"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-mono uppercase tracking-wider text-[#5D594E]">
                  {lang === 'uz' ? 'Gemini 3.8 Voice Persona Prompt:' : 'Промпт персоны голоса:'}
                </label>
                <textarea
                  rows={3}
                  value={personaPrompt}
                  onChange={(e) => setPersonaPrompt(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-white border border-[rgba(22,21,17,0.14)] text-[#161511] text-xs leading-relaxed focus:outline-none focus:border-[#0E7C86]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-mono uppercase tracking-wider text-[#5D594E]">{lang === 'uz' ? 'Ovoz Turi:' : 'Базовый голос:'}</label>
                  <select
                    value={baseVoice}
                    onChange={(e) => setBaseVoice(e.target.value as BaseVoiceModel)}
                    className="w-full px-4 py-2.5 rounded-xl bg-white border border-[rgba(22,21,17,0.14)] text-[#161511] text-xs focus:outline-none focus:border-[#0E7C86]"
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
                  <label className="text-xs font-mono uppercase tracking-wider text-[#5D594E]">{lang === 'uz' ? 'Balandlik (Pitch):' : 'Высота:'}</label>
                  <select
                    value={pitchLevel}
                    onChange={(e) => setPitchLevel(e.target.value as any)}
                    className="w-full px-4 py-2.5 rounded-xl bg-white border border-[rgba(22,21,17,0.14)] text-[#161511] text-xs focus:outline-none focus:border-[#0E7C86]"
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
        <div className="p-4 sm:p-6 border-t border-[rgba(22,21,17,0.1)] bg-white/70 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-[#5D594E] font-mono">
            <Fingerprint className="w-4 h-4 text-[#0E7C86]" />
            <span>Faol Voice ID: <strong className="font-mono text-[#0A5A62]">{voiceId || 'Standart'}</strong></span>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => handleTestVoice(voiceId, voiceName)}
              disabled={isTestingVoice}
              className="btn-pill btn-ghost text-xs px-4 py-2 flex items-center justify-center gap-2"
            >
              {isTestingVoice ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
              <span>{isTestingVoice ? 'Sintez...' : 'Ovozni sinash'}</span>
            </button>

            <button
              type="button"
              onClick={handleSaveAndActivate}
              className="btn-pill btn-solid text-xs font-semibold flex items-center justify-center gap-2 shadow-xs cursor-pointer"
            >
              <Check className="w-4 h-4 stroke-[2.5]" />
              <span>{lang === 'uz' ? 'Ovozni Saqlash & Tanlash' : 'Сохранить и Выбрать'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
