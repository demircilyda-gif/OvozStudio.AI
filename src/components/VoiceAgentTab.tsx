import React, { useState, useRef, useEffect } from 'react';
import { VoiceProfile, AgentPersonaType } from '../types/podcast';
import {
  PhoneCall,
  PhoneOff,
  Mic,
  MicOff,
  Sparkles,
  Bot,
  User,
  Radio,
  Volume2,
  Send,
  Download,
  ShieldCheck,
  CheckCircle2,
  Activity,
} from 'lucide-react';

interface VoiceAgentTabProps {
  voices: VoiceProfile[];
  userClonedVoiceId: string;
  lang: 'uz' | 'ru';
}

interface CallMessage {
  id: string;
  sender: 'user' | 'agent';
  text: string;
  audioBase64?: string;
  timestamp: string;
}

export const VoiceAgentTab: React.FC<VoiceAgentTabProps> = ({
  voices,
  userClonedVoiceId,
  lang,
}) => {
  const [selectedPersona, setSelectedPersona] = useState<AgentPersonaType>('live_cohost');
  const [callTopic, setCallTopic] = useState<string>('Sun\'iy intellekt va O\'zbekiston yoshlari kelajagi');
  const [agentVoiceId, setAgentVoiceId] = useState<string>('Puck');

  // Call status
  const [callStatus, setCallStatus] = useState<'idle' | 'calling' | 'connected' | 'ended'>('idle');
  const [callDuration, setCallDuration] = useState<number>(0);
  const [messages, setMessages] = useState<CallMessage[]>([]);
  const [textInput, setTextInput] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // Microphone recording
  const [isRecordingMic, setIsRecordingMic] = useState<boolean>(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Audio player & Web Audio sound effects
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const callTimerRef = useRef<any>(null);

  // Play realistic phone ringtone via Web Audio API
  const playRingtone = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.frequency.value = 440; // 440Hz standard telephone dial tone
      osc2.frequency.value = 480; // 480Hz
      gain.gain.value = 0.08;

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start();
      osc2.start();

      setTimeout(() => {
        try {
          osc1.stop();
          osc2.stop();
          ctx.close();
        } catch (e) {}
      }, 1200);
    } catch (e) {
      console.warn('AudioContext not permitted yet', e);
    }
  };

  // Start Call
  const handleStartCall = async () => {
    setCallStatus('calling');
    playRingtone();

    try {
      const res = await fetch('/api/agent/start-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          persona: selectedPersona,
          topic: callTopic,
          agentVoiceId,
        }),
      });

      if (!res.ok) throw new Error('Qo\'ng\'iroqni boshlashda xatolik');
      const data = await res.json();

      setCallStatus('connected');
      setCallDuration(0);

      // Start timer
      callTimerRef.current = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);

      const initialMessage: CallMessage = {
        id: `msg-${Date.now()}`,
        sender: 'agent',
        text: data.greetingText,
        audioBase64: data.audioBase64,
        timestamp: new Date().toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages([initialMessage]);

      if (data.audioBase64) {
        playAgentAudio(data.audioBase64);
      }
    } catch (err: any) {
      alert(`Xatolik: ${err.message}`);
      setCallStatus('idle');
    }
  };

  // End Call
  const handleEndCall = () => {
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
    }
    setCallStatus('ended');
  };

  // Play audio response from agent
  const playAgentAudio = (base64: string) => {
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
    }
    const audio = new Audio(`data:audio/wav;base64,${base64}`);
    activeAudioRef.current = audio;
    audio.play().catch((e) => console.warn('Autoplay prevented:', e));
  };

  // Send turn (either text or audio)
  const sendTurn = async (userText: string, audioBase64?: string) => {
    if (!userText.trim() && !audioBase64) return;
    setIsProcessing(true);

    const newUserMsg: CallMessage = {
      id: `msg-${Date.now()}`,
      sender: 'user',
      text: userText || (lang === 'uz' ? '🎤 Ovozli savol' : '🎤 Голосовое сообщение'),
      timestamp: new Date().toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, newUserMsg]);
    setTextInput('');

    try {
      const res = await fetch('/api/agent/call-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userText,
          userAudioBase64: audioBase64,
          conversationHistory: messages,
          persona: selectedPersona,
          topic: callTopic,
          agentVoiceId,
        }),
      });

      if (!res.ok) throw new Error('Agent javobida xatolik');
      const data = await res.json();

      const newAgentMsg: CallMessage = {
        id: `msg-${Date.now() + 1}`,
        sender: 'agent',
        text: data.replyText,
        audioBase64: data.audioBase64,
        timestamp: data.timestamp || new Date().toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, newAgentMsg]);

      if (data.audioBase64) {
        playAgentAudio(data.audioBase64);
      }
    } catch (e: any) {
      alert(`Xatolik: ${e.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Microphone recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const base64Data = (reader.result as string).split(',')[1];
          sendTurn('', base64Data);
        };
        stream.getTracks().forEach((track) => track.stop());
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecordingMic(true);
    } catch (err) {
      alert(lang === 'uz' ? 'Mikrofon ruxsati berilmadi. Matn orqali gaplashing.' : 'Микрофон недоступен.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      setIsRecordingMic(false);
    }
  };

  // Format seconds mm:ss
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = Math.floor(secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // Download Transcript
  const downloadTranscript = () => {
    let content = `PODKASTUZ - OVOZLI AI AGENT QO'NG'IROG'I TRANSKRIPTI\n`;
    content += `Mavzu: ${callTopic}\n`;
    content += `Sana: ${new Date().toLocaleString()}\n`;
    content += `Davomiyligi: ${formatTime(callDuration)}\n\n`;
    content += `==============================================\n\n`;

    messages.forEach((m) => {
      content += `[${m.timestamp}] ${m.sender === 'user' ? 'Siz (Foydalanuvchi)' : 'AI Agent'}:\n${m.text}\n\n`;
    });

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agent-call-transcript-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="rounded-2xl bg-gradient-to-r from-blue-950/60 via-zinc-900 to-cyan-950/60 border border-blue-500/30 p-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-3 py-1 rounded-full bg-blue-500/20 text-blue-300 text-xs font-semibold border border-blue-500/40 flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5" />
                {lang === 'uz' ? 'Jonli Efir & Interaktiv Ovozli AI Agent' : 'Интерактивный Голосовой AI-Агент'}
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 text-xs font-mono border border-cyan-500/30">
                Gemini 3.8 Flash + Phone Call
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
              {lang === 'uz' ? 'Ovozli Qo\'ng\'iroqlar va Jonli Muloqot' : 'Голосовые Звонки в Эфир и Агенты'}
            </h1>
            <p className="text-zinc-400 text-sm mt-1 max-w-2xl">
              {lang === 'uz'
                ? 'Efirga telefon orqali qo\'ng\'iroq qabul qiling, AI hamkor-boshlovchi bilan podkast mashq qiling yoki mijozlar uchun ovozli maslahatchi botni sinang.'
                : 'Принимайте живые звонки слушателей в эфир, репетируйте подкаст с AI-соведущим в реальном времени.'}
            </p>
          </div>
        </div>
      </div>

      {/* Main Container */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Persona & Scenario Config (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
              <Bot className="w-4 h-4 text-blue-400" />
              {lang === 'uz' ? '1. Agent Rolini Tanlang' : '1. Выберите Роль Агента'}
            </h3>

            {/* Persona Cards */}
            <div className="space-y-2.5">
              {[
                {
                  id: 'live_cohost',
                  title: 'Jonli Efir Hamkor-Boshlovchisi',
                  desc: 'Podkastni birga olib boruvchi, fikrlaringizni qo\'llab-quvvatlovchi aqlli spiker.',
                  badge: 'Co-Host',
                  color: 'border-blue-500/40 text-blue-300',
                },
                {
                  id: 'caller_in_air',
                  title: 'Efirga Qo\'ng\'iroq Qiluvchi Muxlis',
                  desc: 'Toshkentdan qo\'ng\'iroq qilayotgan tinglovchi: o\'tkir savollar va qiziq fikrlar.',
                  badge: 'Tinglovchi',
                  color: 'border-cyan-500/40 text-cyan-300',
                },
                {
                  id: 'exclusive_mentor',
                  title: 'VIP Eksklyuziv Mentor & Ekspert',
                  desc: 'Mavzu bo\'yicha chuqur tahliliy fikr beruvchi xususiy audio maslahatchi.',
                  badge: 'VIP Mentor',
                  color: 'border-purple-500/40 text-purple-300',
                },
                {
                  id: 'business_consultant',
                  title: 'Ovozli AI Biznes-Assistent',
                  desc: 'Kompaniya mahsulotlari va xizmatlari haqida gapirib beruvchi audio agent.',
                  badge: 'Biznes Bot',
                  color: 'border-emerald-500/40 text-emerald-300',
                },
              ].map((p) => {
                const isSelected = selectedPersona === p.id;
                return (
                  <button
                    key={p.id}
                    disabled={callStatus === 'connected' || callStatus === 'calling'}
                    onClick={() => setSelectedPersona(p.id as AgentPersonaType)}
                    className={`w-full p-3.5 rounded-xl border text-left transition-all flex flex-col gap-1 ${
                      isSelected
                        ? 'bg-blue-950/40 border-blue-500 text-white shadow-md shadow-blue-500/10'
                        : 'bg-zinc-950/60 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white">{p.title}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border bg-zinc-900 ${p.color}`}>
                        {p.badge}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400 leading-relaxed">{p.desc}</p>
                  </button>
                );
              })}
            </div>

            {/* Topic Input */}
            <div className="pt-2 space-y-1.5">
              <label className="text-xs font-medium text-zinc-400">
                {lang === 'uz' ? 'Qo\'ng\'iroq / Efir mavzusi:' : 'Тема эфира / звонка:'}
              </label>
              <input
                type="text"
                disabled={callStatus === 'connected'}
                value={callTopic}
                onChange={(e) => setCallTopic(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                placeholder="Mavzuni kiriting..."
              />
            </div>

            {/* Agent Voice Selector */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-400">
                {lang === 'uz' ? 'Agentning ovozi:' : 'Голос агента:'}
              </label>
              <select
                disabled={callStatus === 'connected'}
                value={agentVoiceId}
                onChange={(e) => setAgentVoiceId(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2 text-xs text-zinc-200 focus:outline-none focus:border-blue-500"
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

        {/* Right: Phone Call Interface & Live Transcript (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          {/* Virtual Phone Card */}
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl">
            {/* Top Phone Header */}
            <div className="p-4 bg-zinc-950 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-blue-600 to-cyan-500 flex items-center justify-center text-white font-bold">
                    <Bot className="w-5 h-5" />
                  </div>
                  {callStatus === 'connected' && (
                    <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-zinc-950 rounded-full animate-ping" />
                  )}
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">
                    {selectedPersona === 'live_cohost'
                      ? 'Hamkor-Boshlovchi (AI Co-Host)'
                      : selectedPersona === 'caller_in_air'
                      ? 'Muxlis Qo\'ng\'irog\'i (Toshkent)'
                      : 'AI Audio Maslahatchi'}
                  </h4>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-zinc-400 font-mono">
                      {callStatus === 'connected'
                        ? `Jonli Efirda • ${formatTime(callDuration)}`
                        : callStatus === 'calling'
                        ? 'Qo\'ng\'iroq ulanmoqda...'
                        : callStatus === 'ended'
                        ? 'Qo\'ng\'iroq yakunlandi'
                        : 'Kutilmoqda'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Call Controls Button */}
              {callStatus === 'connected' || callStatus === 'calling' ? (
                <button
                  onClick={handleEndCall}
                  className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-md shadow-red-600/30 cursor-pointer"
                >
                  <PhoneOff className="w-4 h-4" />
                  {lang === 'uz' ? 'Yakunlash' : 'Сбросить'}
                </button>
              ) : (
                <button
                  onClick={handleStartCall}
                  className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition-all shadow-lg shadow-emerald-600/25 cursor-pointer"
                >
                  <PhoneCall className="w-4 h-4" />
                  {lang === 'uz' ? 'Efirga Qo\'ng\'iroq Qilish' : 'Позвонить в эфир'}
                </button>
              )}
            </div>

            {/* Active Soundwave Visualizer */}
            {callStatus === 'connected' && (
              <div className="py-4 px-6 bg-blue-950/20 border-b border-zinc-800 flex items-center justify-center gap-1.5">
                {[15, 35, 60, 95, 70, 40, 85, 100, 50, 75, 90, 45, 65, 30, 20].map((h, i) => (
                  <div
                    key={i}
                    className={`w-1 rounded-full bg-cyan-400 transition-all ${
                      isProcessing ? 'animate-pulse bg-blue-400' : ''
                    }`}
                    style={{
                      height: `${h * 0.35}px`,
                      animationDuration: `${0.4 + (i % 5) * 0.15}s`,
                    }}
                  />
                ))}
              </div>
            )}

            {/* Live Message History */}
            <div className="p-4 h-72 overflow-y-auto space-y-3 bg-zinc-950/60">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-2">
                  <PhoneCall className="w-10 h-10 text-zinc-700" />
                  <p className="text-xs text-zinc-400 font-medium">
                    {lang === 'uz'
                      ? 'Qo\'ng\'iroq qilish uchun yuqoridagi "Efirga Qo\'ng\'iroq Qilish" tugmasini bosing'
                      : 'Нажмите "Позвонить в эфир", чтобы начать голосовой диалог'}
                  </p>
                </div>
              ) : (
                messages.map((m) => {
                  const isAgent = m.sender === 'agent';
                  return (
                    <div
                      key={m.id}
                      className={`flex gap-2.5 ${isAgent ? 'justify-start' : 'justify-end'}`}
                    >
                      {isAgent && (
                        <div className="w-7 h-7 rounded-lg bg-blue-600/30 border border-blue-500/40 flex items-center justify-center text-blue-300 text-xs shrink-0">
                          <Bot className="w-3.5 h-3.5" />
                        </div>
                      )}
                      <div
                        className={`max-w-[80%] p-3 rounded-2xl text-xs sm:text-sm leading-relaxed ${
                          isAgent
                            ? 'bg-zinc-900 border border-zinc-800 text-zinc-100 rounded-tl-sm'
                            : 'bg-blue-600 text-white rounded-tr-sm'
                        }`}
                      >
                        <p>{m.text}</p>
                        <div className="flex items-center justify-between gap-3 mt-1.5 text-[10px] text-zinc-400">
                          <span>{m.timestamp}</span>
                          {m.audioBase64 && isAgent && (
                            <button
                              onClick={() => playAgentAudio(m.audioBase64!)}
                              className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-semibold"
                            >
                              <Volume2 className="w-3 h-3" /> Qayta eshitish
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Input Bar: Mic + Text input */}
            <div className="p-3.5 bg-zinc-950 border-t border-zinc-800 flex items-center gap-2">
              {/* Push-to-talk mic */}
              <button
                disabled={callStatus !== 'connected'}
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                onTouchStart={startRecording}
                onTouchEnd={stopRecording}
                className={`p-3 rounded-xl border transition-all cursor-pointer ${
                  isRecordingMic
                    ? 'bg-red-600 border-red-500 text-white animate-pulse shadow-lg shadow-red-600/40'
                    : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700 hover:text-white disabled:opacity-40'
                }`}
                title="Gapirish uchun bosib turing (Push to talk)"
              >
                {isRecordingMic ? <Mic className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>

              {/* Text input */}
              <input
                type="text"
                disabled={callStatus !== 'connected' || isProcessing}
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') sendTurn(textInput);
                }}
                placeholder={
                  callStatus === 'connected'
                    ? (lang === 'uz' ? 'Javobingizni yozing yoki mikrofondan gapiring...' : 'Напишите или говорите в микрофон...')
                    : (lang === 'uz' ? 'Qo\'ng\'iroq ulangandan so\'ng gapiring' : 'Сначала подключите звонок')
                }
                className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm text-white focus:outline-none focus:border-blue-500 disabled:opacity-50"
              />

              {/* Send Button */}
              <button
                disabled={callStatus !== 'connected' || !textInput.trim() || isProcessing}
                onClick={() => sendTurn(textInput)}
                className="p-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-xl transition-colors cursor-pointer"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Transcript Download CTA */}
          {messages.length > 0 && (
            <div className="flex items-center justify-between p-3.5 bg-zinc-900/60 border border-zinc-800 rounded-xl text-xs">
              <span className="text-zinc-400">
                {lang === 'uz' ? 'Ushbu qo\'ng\'iroq transkripti saqlandi' : 'Транскрипт звонка сохранен'}
              </span>
              <button
                onClick={downloadTranscript}
                className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg font-medium flex items-center gap-1.5 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                {lang === 'uz' ? 'Transkriptni Yuklab Olish' : 'Скачать транскрипт'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
