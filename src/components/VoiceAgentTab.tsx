import React, { useState, useRef, useEffect, useCallback } from 'react';
import { VoiceProfile, AgentPersonaType, RealEstateLeadCard } from '../types/podcast';
import { LiveCallCard } from './LiveCallCard';
import { VoiceGallery3D } from './VoiceGallery3D';
import {
  PhoneCall,
  PhoneOff,
  Mic,
  MicOff,
  Bot,
  Radio,
  Volume2,
  Download,
  ShieldCheck,
  CheckCircle2,
  Zap,
  RotateCcw,
  Send,
  Building2,
  Key,
  TrendingUp,
  Copy,
  Check,
  Sparkles,
  Flame,
  ShieldAlert,
  FileText,
  CheckSquare,
  HelpCircle,
  ArrowRight,
  BadgeAlert,
  DollarSign,
  MapPin,
  Home,
  BookOpen,
  Lock,
  Play,
  Square,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getVoicePreviewUrl } from '../data/voicePreviews';
import { connectAudioElement } from '../utils/audioReactive';
import {
  getAudioContext,
  getLiveInputAudioContext,
  getLiveOutputAudioContext,
  closeLiveAudioContexts,
} from '../utils/audioUtils';
import { authFetch, getCurrentIdToken } from '../utils/authFetch';

interface VoiceAgentTabProps {
  voices: VoiceProfile[];
  userClonedVoiceId: string;
  lang: 'uz' | 'ru';
}

interface TranscriptLine {
  id: string;
  sender: 'user' | 'agent';
  text: string;
  timestamp: string;
}

// Helper: Convert Float32Array PCM into 16-bit linear PCM base64 string
function float32ToPcm16Base64(float32Array: Float32Array): string {
  const pcm16 = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(pcm16.buffer);
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export const VoiceAgentTab: React.FC<VoiceAgentTabProps> = ({
  voices,
  userClonedVoiceId,
  lang,
}) => {
  const { isAuthenticated, requireAuth, useCredit, syncCredits, logGeneration } = useAuth();
  const shokhrukhVoiceId = userClonedVoiceId || 'voice_17raj9ewke3g';

  // Engine: 'shokhrukh_natural' (Recommended, 0% accent, authentic Shahrukh voice) vs 'ovoz_live'
  const [callEngine, setCallEngine] = useState<'shokhrukh_natural' | 'ovoz_live'>('shokhrukh_natural');

  // Call Configuration (Defaults to Real Estate Broker with Shahrukh's voice)
  const [selectedPersona, setSelectedPersona] = useState<AgentPersonaType>('tashkent_real_estate');
  const [callTopic, setCallTopic] = useState<string>('Toshkentda novostroyka, ikkilamchi bozor, ijara va narxlar');
  const [agentVoiceId, setAgentVoiceId] = useState<string>(shokhrukhVoiceId);

  // Built-in instant voice preview (0 tokens, pre-saved)
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);
  const voicePreviewAudioRef = useRef<HTMLAudioElement | null>(null);

  const toggleVoicePreview = (vId: string) => {
    if (previewingVoiceId === vId) {
      if (voicePreviewAudioRef.current) {
        voicePreviewAudioRef.current.pause();
        voicePreviewAudioRef.current.currentTime = 0;
      }
      setPreviewingVoiceId(null);
      return;
    }
    const cleanId = vId.toLowerCase();
    const url = getVoicePreviewUrl(cleanId) || `/api/voices/preview/${cleanId}`;
    if (!voicePreviewAudioRef.current) {
      voicePreviewAudioRef.current = new Audio(url);
    } else {
      voicePreviewAudioRef.current.src = url;
    }
    voicePreviewAudioRef.current.volume = 0.95;
    voicePreviewAudioRef.current.onended = () => setPreviewingVoiceId(null);
    voicePreviewAudioRef.current.onerror = () => setPreviewingVoiceId(null);
    voicePreviewAudioRef.current
      .play()
      .then(() => setPreviewingVoiceId(vId))
      .catch(() => setPreviewingVoiceId(null));
  };

  // Call Lifecycle: 'idle' -> 'calling' (ringing) -> 'connected' (live) -> 'ended'
  const [callStatus, setCallStatus] = useState<'idle' | 'calling' | 'connected' | 'ended'>('idle');
  const [callDuration, setCallDuration] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [agentSpeaking, setAgentSpeaking] = useState<boolean>(false);
  const [userSpeaking, setUserSpeaking] = useState<boolean>(false);
  const [currentSubtitle, setCurrentSubtitle] = useState<string>('');
  const [transcriptLines, setTranscriptLines] = useState<TranscriptLine[]>([]);
  const [textInput, setTextInput] = useState<string>('');
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [isLoadingTurn, setIsLoadingTurn] = useState<boolean>(false);
  const [micWarning, setMicWarning] = useState<string | null>(null);

  // Real Estate Interactive Lead Card
  const [reLeadCard, setReLeadCard] = useState<RealEstateLeadCard>({
    clientIntent: 'buy',
    district: 'Mirobod',
    budgetRange: '$50,000 - $80,000',
    propertyType: 'novostroyka',
    roomsCount: '2 xonali',
    urgency: 'this_month',
    paymentMethod: 'cash',
    leadTemperature: 'warm',
    keyNotes: '',
  });
  const [copiedLead, setCopiedLead] = useState<boolean>(false);
  const [activeTabSubView, setActiveTabSubView] = useState<'agent' | 'prices' | 'lead' | 'playbook' | 'summary'>('agent');

  // Top 10 Real Estate Features State
  const [guardrailAlert, setGuardrailAlert] = useState<string | null>(null);
  const [clarificationAlert, setClarificationAlert] = useState<string | null>(null);
  const [liveLeadUpdateToast, setLiveLeadUpdateToast] = useState<string | null>(null);
  const [offTopicCount, setOffTopicCount] = useState<number>(0);
  const [clarificationCount, setClarificationCount] = useState<number>(0);
  const [crmSummaryData, setCrmSummaryData] = useState<any>(null);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState<boolean>(false);

  // Audio References
  const currentAudioElemRef = useRef<HTMLAudioElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const nextPlaybackTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const callTimerRef = useRef<any>(null);
  const conversationHistoryRef = useRef<TranscriptLine[]>([]);
  const interimSpeechRef = useRef<string>('');
  const speechSilenceTimerRef = useRef<any>(null);

  // Keep history ref in sync
  useEffect(() => {
    conversationHistoryRef.current = transcriptLines;
  }, [transcriptLines]);

  // Clean up live audio contexts on unmount
  useEffect(() => {
    return () => {
      closeLiveAudioContexts().catch(() => {});
    };
  }, []);

  // Play realistic telephone ringtone using centralized WebAudio singleton
  const playRingtone = useCallback(() => {
    try {
      const ctx = getAudioContext();
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.frequency.value = 440;
      osc2.frequency.value = 480;
      gain.gain.value = 0.04;

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start();
      osc2.start();

      setTimeout(() => {
        try {
          osc1.stop();
          osc2.stop();
          osc1.disconnect();
          osc2.disconnect();
          gain.disconnect();
        } catch (e) {}
      }, 1200);
    } catch (e) {
      console.warn('Ringtone AudioContext warning:', e);
    }
  }, []);

  // Stop current audio playback
  const stopAllAudio = useCallback(() => {
    if (speechSilenceTimerRef.current) {
      clearTimeout(speechSilenceTimerRef.current);
      speechSilenceTimerRef.current = null;
    }
    if (currentAudioElemRef.current) {
      currentAudioElemRef.current.pause();
      currentAudioElemRef.current = null;
    }
    activeSourcesRef.current.forEach((s) => {
      try {
        s.stop();
        s.disconnect();
      } catch (e) {}
    });
    activeSourcesRef.current = [];
    if (outputAudioCtxRef.current) {
      nextPlaybackTimeRef.current = outputAudioCtxRef.current.currentTime;
    }
    setAgentSpeaking(false);
    setAudioLevel(0);
  }, []);

  // Play incoming 24kHz live audio chunk from OvozStudio Live Engine
  const playLiveAudioChunk = useCallback((base64Pcm: string) => {
    try {
      const ctx = getLiveOutputAudioContext();
      outputAudioCtxRef.current = ctx;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      const binary = atob(base64Pcm);
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const int16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768.0;
      }

      const audioBuffer = ctx.createBuffer(1, float32.length, 24000);
      audioBuffer.copyToChannel(float32, 0);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      const now = ctx.currentTime;
      if (nextPlaybackTimeRef.current < now) {
        nextPlaybackTimeRef.current = now;
      }
      source.start(nextPlaybackTimeRef.current);
      nextPlaybackTimeRef.current += audioBuffer.duration;

      activeSourcesRef.current.push(source);
      setAgentSpeaking(true);
      setAudioLevel(0.65);

      source.onended = () => {
        activeSourcesRef.current = activeSourcesRef.current.filter((s) => s !== source);
        if (activeSourcesRef.current.length === 0) {
          setAgentSpeaking(false);
          setAudioLevel(0);
        }
      };
    } catch (err) {
      console.warn('Error playing Live audio chunk:', err);
    }
  }, []);

  // Play synthesized turn audio with natural phone cadence
  const playTurnAudio = useCallback((base64Wav: string, onEnd?: () => void) => {
    stopAllAudio();
    try {
      const audio = new Audio(`data:audio/wav;base64,${base64Wav}`);
      connectAudioElement(audio);
      currentAudioElemRef.current = audio;
      setAgentSpeaking(true);
      setAudioLevel(0.7);

      audio.onended = () => {
        setAgentSpeaking(false);
        setAudioLevel(0);
        currentAudioElemRef.current = null;
        if (onEnd) onEnd();
      };

      audio.onerror = () => {
        setAgentSpeaking(false);
        setAudioLevel(0);
        currentAudioElemRef.current = null;
        if (onEnd) onEnd();
      };

      audio.play().catch((err) => {
        console.warn('Audio play error:', err);
        setAgentSpeaking(false);
        setAudioLevel(0);
        if (onEnd) onEnd();
      });
    } catch (e) {
      console.error('Play audio error:', e);
      setAgentSpeaking(false);
      setAudioLevel(0);
      if (onEnd) onEnd();
    }
  }, [stopAllAudio]);

  // Execute conversational turn (Natural Engine)
  const executeNaturalTurn = useCallback(async (spokenText: string) => {
    if (!spokenText.trim() || isLoadingTurn) return;

    setIsLoadingTurn(true);
    setUserSpeaking(false);

    const userLine: TranscriptLine = {
      id: `u-${Date.now()}`,
      sender: 'user',
      text: spokenText.trim(),
      timestamp: new Date().toLocaleTimeString(lang === 'ru' ? 'ru-RU' : 'uz-UZ', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    };

    setTranscriptLines((prev) => [...prev, userLine]);

    try {
      const res = await authFetch('/api/agent/call-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userText: spokenText.trim(),
          conversationHistory: conversationHistoryRef.current,
          persona: selectedPersona,
          topic: callTopic,
          agentVoiceId: agentVoiceId,
          language: lang,
        }),
      });

      if (!res.ok) {
        throw new Error('Call turn failed');
      }

      const data = await res.json();
      if (typeof data.creditsRemaining === 'number') {
        syncCredits(data.creditsRemaining);
      }
      const replyText = data.replyText || '';
      setCurrentSubtitle(replyText);

      // Handle real-time lead qualification update
      if (data.leadUpdate) {
        setReLeadCard((prev) => ({
          ...prev,
          ...(data.leadUpdate.district ? { district: data.leadUpdate.district } : {}),
          ...(data.leadUpdate.budgetRange ? { budgetRange: data.leadUpdate.budgetRange } : {}),
          ...(data.leadUpdate.clientIntent ? { clientIntent: data.leadUpdate.clientIntent } : {}),
          ...(data.leadUpdate.propertyType ? { propertyType: data.leadUpdate.propertyType } : {}),
          ...(data.leadUpdate.roomsCount ? { roomsCount: data.leadUpdate.roomsCount } : {}),
          ...(data.leadUpdate.urgency ? { urgency: data.leadUpdate.urgency } : {}),
          ...(data.leadUpdate.paymentMethod ? { paymentMethod: data.leadUpdate.paymentMethod } : {}),
          ...(data.leadUpdate.leadTemperature ? { leadTemperature: data.leadUpdate.leadTemperature } : {}),
        }));
        setLiveLeadUpdateToast(
          lang === 'uz'
            ? '🎯 BANT Lead-kartasi jonli suhbatdan yangilandi!'
            : '🎯 Лид-карта обновлена из живого диалога!'
        );
        setTimeout(() => setLiveLeadUpdateToast(null), 3500);
      }

      // Handle Strict Real Estate Guardrail deflection
      if (data.isOffTopic) {
        setOffTopicCount((prev) => prev + 1);
        setGuardrailAlert(
          lang === 'uz'
            ? "🛡️ Guardrail faol: Begona mavzu to'xtatildi, agent suhbatni ko'chmas mulkka qaytardi"
            : '🛡️ Защита темы: оффтоп отклонён, агент вернул диалог к недвижимости'
        );
        setTimeout(() => setGuardrailAlert(null), 4500);
      }

      // Handle Anti-Hallucination clarification trigger
      if (data.clarificationNeeded) {
        setClarificationCount((prev) => prev + 1);
        setClarificationAlert(
          lang === 'uz'
            ? "✨ Halol aniqlashtirish: Ovoz noaniq bo'lgani uchun agent to'qimasdan qayta so'radi"
            : '✨ Честное уточнение: агент не стал домысливать и переспросил неясный запрос'
        );
        setTimeout(() => setClarificationAlert(null), 4500);
      }

      const agentLine: TranscriptLine = {
        id: `a-${Date.now()}`,
        sender: 'agent',
        text: replyText,
        timestamp: new Date().toLocaleTimeString(lang === 'ru' ? 'ru-RU' : 'uz-UZ', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      };
      setTranscriptLines((prev) => [...prev, agentLine]);

      if (data.audioBase64) {
        playTurnAudio(data.audioBase64, () => {
          // Restart recognition once agent finishes speaking
          restartListening();
        });
      } else {
        restartListening();
      }
    } catch (err) {
      console.error('Turn error:', err);
      restartListening();
    } finally {
      setIsLoadingTurn(false);
    }
  }, [isLoadingTurn, lang, selectedPersona, callTopic, agentVoiceId, playTurnAudio]);

  // Start continuous speech recognition for customer with smart VAD silence detection
  const startContinuousListening = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn('SpeechRecognition is not supported in this browser.');
      return;
    }

    try {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (e) {}
      }

      const rec = new SpeechRecognition();
      recognitionRef.current = rec;
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = lang === 'ru' ? 'ru-RU' : 'uz-UZ';

      rec.onstart = () => {
        console.log('Customer microphone listening...');
      };

      rec.onresult = (event: any) => {
        let currentInterim = '';
        let isFinalResult = false;
        let finalSpeech = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            isFinalResult = true;
            finalSpeech += transcript;
          } else {
            currentInterim += transcript;
          }
        }

        setUserSpeaking(true);
        setAudioLevel(0.65);

        if (currentInterim.trim()) {
          interimSpeechRef.current = currentInterim.trim();
        }

        // If browser provided final speech chunk
        if (isFinalResult && finalSpeech.trim()) {
          if (speechSilenceTimerRef.current) {
            clearTimeout(speechSilenceTimerRef.current);
            speechSilenceTimerRef.current = null;
          }
          const textToSend = (interimSpeechRef.current ? interimSpeechRef.current + ' ' : '') + finalSpeech.trim();
          interimSpeechRef.current = '';
          setUserSpeaking(false);
          try {
            rec.stop();
          } catch (e) {}
          executeNaturalTurn(textToSend.trim());
          return;
        }

        // SMART VAD: 850ms silence after speech pause triggers immediate turn!
        // Cuts user waiting time down from 10-15s to ~1.5s!
        if (interimSpeechRef.current.trim().length >= 3) {
          if (speechSilenceTimerRef.current) {
            clearTimeout(speechSilenceTimerRef.current);
          }
          speechSilenceTimerRef.current = setTimeout(() => {
            const textToSend = interimSpeechRef.current.trim();
            if (textToSend.length >= 2) {
              interimSpeechRef.current = '';
              setUserSpeaking(false);
              try {
                rec.stop();
              } catch (e) {}
              executeNaturalTurn(textToSend);
            }
          }, 850);
        }
      };

      rec.onerror = (e: any) => {
        console.warn('SpeechRecognition error:', e?.error);
        setUserSpeaking(false);
      };

      rec.onend = () => {
        setUserSpeaking(false);
      };

      rec.start();
    } catch (err) {
      console.warn('Failed to start SpeechRecognition:', err);
    }
  }, [lang, executeNaturalTurn]);

  const restartListening = useCallback(() => {
    setTimeout(() => {
      startContinuousListening();
    }, 400);
  }, [startContinuousListening]);

  // Cleanup all connections
  const cleanupCall = useCallback(() => {
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }
    if (speechSilenceTimerRef.current) {
      clearTimeout(speechSilenceTimerRef.current);
      speechSilenceTimerRef.current = null;
    }
    stopAllAudio();
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch (e) {}
      recognitionRef.current = null;
    }
    if (micProcessorRef.current) {
      micProcessorRef.current.disconnect();
      micProcessorRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
    closeLiveAudioContexts().catch(() => {});
    inputAudioCtxRef.current = null;
    outputAudioCtxRef.current = null;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setAgentSpeaking(false);
    setUserSpeaking(false);
    setAudioLevel(0);
    setIsLoadingTurn(false);
  }, [stopAllAudio]);

  // Start Call (Route by selected engine)
  const handleStartCall = async () => {
    if (
      !requireAuth(
        () => {},
        lang === 'uz'
          ? "AI Realtor Agent bilan jonli qo'ng'iroq faqat ro'yxatdan o'tgan foydalanuvchilar uchun ochiq. Begonalar API ni behuda sarflamasligi uchun avval tizimga kiring!"
          : "Голосовой AI агент звонков доступен только для зарегистрированных пользователей."
      )
    ) {
      return;
    }

    cleanupCall();
    setMicWarning(null);
    setCallStatus('calling');
    playRingtone();
    setCurrentSubtitle('');
    setTranscriptLines([]);

    // 1. Graceful microphone permission request
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      micStreamRef.current = stream;
    } catch (micErr: any) {
      console.warn('Microphone permission denied or blocked:', micErr);
      setMicWarning(
        lang === 'uz'
          ? 'Mikrofon ruxsati berilmadi yoki bloklangan. Brauzer manzili qatoridagi 🔒 yoki 🎤 belgisidan ruxsat bering, yoki quyidagi tayyor tugmalar va matn orqali bemalol muloqot qiling.'
          : 'Микрофон недоступен. Разрешите доступ в строке браузера (значок 🔒 или 🎤) или общайтесь через быстрые кнопки и текстовый ввод.'
      );
    }

    if (callEngine === 'shokhrukh_natural') {
      // ----------------------------------------------------
      // MODE 1: SHAHRUKH AUTHENTIC VOICE (0% ACCENT, NATURAL TTS LIVE)
      // ----------------------------------------------------
      try {
        // Fetch opening greeting from broker
        const res = await authFetch('/api/agent/start-call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            persona: selectedPersona,
            topic: callTopic,
            agentVoiceId: agentVoiceId,
            language: lang,
          }),
        });

        if (!res.ok) throw new Error('Start call failed');
        const data = await res.json();

        setTimeout(() => {
          setCallStatus('connected');
          setCallDuration(0);
          callTimerRef.current = setInterval(() => {
            setCallDuration((prev) => prev + 1);
          }, 1000);

          // Deduct credit ONLY after successful connection
          useCredit(1).catch(() => {});
          logGeneration('agent_call', 'AI Realtor Call', 1).catch(() => {});

          const greeting =
            data.greetingText ||
            (lang === 'ru'
              ? 'Алло, здравствуйте! Слушаю вас.'
              : "Alo, assalomu alaykum! Xush ko'rdik, eshitaman sizni?");
          setCurrentSubtitle(greeting);

          setTranscriptLines([
            {
              id: `a-${Date.now()}`,
              sender: 'agent',
              text: greeting,
              timestamp: new Date().toLocaleTimeString(lang === 'ru' ? 'ru-RU' : 'uz-UZ', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              }),
            },
          ]);

          if (data.audioBase64) {
            playTurnAudio(data.audioBase64, () => {
              if (micStreamRef.current) {
                startContinuousListening();
              }
            });
          } else if (micStreamRef.current) {
            startContinuousListening();
          }
        }, 1200);
      } catch (err: any) {
        console.error('Call start error:', err);
        setCallStatus('idle');
      }
    } else {
      // ----------------------------------------------------
      // MODE 2: HIGH-SPEED OVOZSTUDIO NEURAL LIVE STREAMING
      // ----------------------------------------------------
      if (stream) {
        const inputCtx = getLiveInputAudioContext();
        inputAudioCtxRef.current = inputCtx;
        const source = inputCtx.createMediaStreamSource(stream);
        const processor = inputCtx.createScriptProcessor(4096, 1, 1);
        micProcessorRef.current = processor;
        const muteGain = inputCtx.createGain();
        muteGain.gain.value = 0; // Eliminate local microphone echo and acoustic feedback loop
        source.connect(processor);
        processor.connect(muteGain);
        muteGain.connect(inputCtx.destination);

        processor.onaudioprocess = (e) => {
          if (isMuted || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
          const inputBuffer = e.inputBuffer.getChannelData(0);
          const pcm16Base64 = float32ToPcm16Base64(inputBuffer);
          wsRef.current.send(JSON.stringify({ type: 'audio', audio: pcm16Base64 }));
        };
      }

      // Initialize 24kHz AudioContext singleton for model output playback
      outputAudioCtxRef.current = getLiveOutputAudioContext();

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const idToken = await getCurrentIdToken();
      const wsUrl = `${protocol}//${window.location.host}/api/live-call?token=${encodeURIComponent(idToken || '')}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: 'start',
            persona: selectedPersona,
            topic: callTopic,
            voiceName: agentVoiceId,
            language: lang,
          })
        );
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'connected') {
            setCallStatus('connected');
            setCallDuration(0);
            if (callTimerRef.current) clearInterval(callTimerRef.current);
            callTimerRef.current = setInterval(() => {
              setCallDuration((prev) => prev + 1);
            }, 1000);

            // Deduct credit ONLY after successful connection
            useCredit(1).catch(() => {});
            logGeneration('agent_call', 'AI Realtor Live Call', 1).catch(() => {});
          } else if (data.type === 'audio' && data.audio) {
            playLiveAudioChunk(data.audio);
          } else if (data.type === 'text' && data.text) {
            setCurrentSubtitle(data.text);
            setTranscriptLines((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.sender === 'agent') {
                return [...prev.slice(0, -1), { ...last, text: last.text + ' ' + data.text }];
              } else {
                return [
                  ...prev,
                  {
                    id: `a-${Date.now()}`,
                    sender: 'agent',
                    text: data.text,
                    timestamp: new Date().toLocaleTimeString(lang === 'ru' ? 'ru-RU' : 'uz-UZ', {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    }),
                  },
                ];
              }
            });
          } else if (data.type === 'interrupted') {
            stopAllAudio();
          } else if (data.type === 'sessionClosed') {
            handleEndCall();
          } else if (data.type === 'error') {
            console.warn('Live API error:', data.error);
          }
        } catch (e) {}
      };

      ws.onerror = (err) => {
        console.warn('Live call WebSocket error:', err);
      };
    }
  };

  // End Call & Trigger AI CRM Summary
  const handleEndCall = () => {
    cleanupCall();
    setCallStatus('ended');
    if (selectedPersona === 'tashkent_real_estate' && conversationHistoryRef.current.length >= 2) {
      handleGenerateSummary();
    }
  };

  // Generate Post-Call AI CRM Summary & Dossier
  const handleGenerateSummary = async () => {
    setIsGeneratingSummary(true);
    try {
      const res = await authFetch('/api/agent/generate-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcriptLines: conversationHistoryRef.current,
          leadCard: reLeadCard,
          language: lang,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setCrmSummaryData(data);
        if (data.matchedProperties) {
          setReLeadCard((prev) => ({
            ...prev,
            callSummary: data.callSummary,
            leadTemperature: data.leadTemperature,
            matchedProperties: data.matchedProperties,
            nextStep: data.agreedNextStep,
          }));
        }
      }
    } catch (err) {
      console.error('CRM Summary error:', err);
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  // Toggle Mute
  const handleToggleMute = () => {
    setIsMuted((prev) => !prev);
    if (!isMuted) {
      setUserSpeaking(false);
    }
  };

  // Interrupt agent mid-speech
  const handleInterruptAgent = () => {
    stopAllAudio();
    if (callEngine === 'shokhrukh_natural') {
      restartListening();
    } else if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'interrupt' }));
    }
  };

  // Quick prompt button click
  const handleSendQuickPrompt = (text: string) => {
    if (!text.trim()) return;
    if (callEngine === 'shokhrukh_natural') {
      stopAllAudio();
      executeNaturalTurn(text.trim());
    } else if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'text', text: text.trim() }));
    }
  };

  // Immediate send when user clicks "Finished Speaking"
  const handleManualFinishSpeaking = () => {
    if (speechSilenceTimerRef.current) {
      clearTimeout(speechSilenceTimerRef.current);
      speechSilenceTimerRef.current = null;
    }
    const textToSend = interimSpeechRef.current.trim();
    if (textToSend.length >= 2) {
      interimSpeechRef.current = '';
      setUserSpeaking(false);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {}
      }
      executeNaturalTurn(textToSend);
    }
  };

  // Format seconds mm:ss
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = Math.floor(secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // Copy Lead Card to Clipboard
  const handleCopyLead = () => {
    const text = `📋 TOSHKENT KO'CHMAS MULK ZAKAZI (LEAD):\n` +
      `• Maqsad: ${reLeadCard.clientIntent.toUpperCase()}\n` +
      `• Tuman: ${reLeadCard.district}\n` +
      `• Mulk turi: ${reLeadCard.propertyType}\n` +
      `• Xonalar: ${reLeadCard.roomsCount}\n` +
      `• Byudjet: ${reLeadCard.budgetRange}\n` +
      `• Muddat: ${reLeadCard.urgency}\n` +
      (reLeadCard.keyNotes ? `• Izoh: ${reLeadCard.keyNotes}\n` : '') +
      `\nOvozStudio AI Real Estate Agent orqali shakllantirildi.`;

    navigator.clipboard.writeText(text);
    setCopiedLead(true);
    setTimeout(() => setCopiedLead(false), 2000);
  };

  // Download Transcript
  const downloadTranscript = () => {
    let content = `OVOZSTUDIO AI - JONLI QO'NG'IROQ TRANSKRIPTI\n`;
    content += `Mavzu: ${callTopic}\n`;
    content += `Persona: ${selectedPersona}\n`;
    content += `Ovoz: ${agentVoiceId}\n`;
    content += `Dvigatel: ${callEngine === 'shokhrukh_natural' ? 'Shohrux Haqiqiy Ovoz (Ultra-Natural TTS Live)' : 'OvozStudio Real-time API'}\n`;
    content += `Sana: ${new Date().toLocaleString()}\n`;
    content += `Davomiyligi: ${formatTime(callDuration)}\n\n`;
    content += `==============================================\n\n`;

    transcriptLines.forEach((m) => {
      content += `[${m.timestamp}] ${m.sender === 'user' ? 'Siz (Foydalanuvchi)' : 'AI Agent'}:\n${m.text}\n\n`;
    });

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `live-call-transcript-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupCall();
    };
  }, [cleanupCall]);

  const personaConfig: Record<
    AgentPersonaType,
    { titleUz: string; titleRu: string; descUz: string; descRu: string; badge: string; icon: any }
  > = {
    tashkent_real_estate: {
      titleUz: '🏢 Toshkent Rieltor-Eksperti (Shohrux / Malika)',
      titleRu: '🏢 Топ-Риелтор Ташкента (Шохрух / Малика)',
      descUz: 'Toshkentda novostroyka, ikkilamchi bozor, ijara, narxlar, kadastr va investitsiyalar bo\'yicha jonli professional maslahatchi.',
      descRu: 'Живой эксперт по недвижимости Ташкента: аренда, покупка, новостройки, районы, цены за м², кадастр и инвестиции.',
      badge: 'Real Estate Elite',
      icon: Building2,
    },
    live_cohost: {
      titleUz: '🎙️ Jonli Hamkor-Boshlovchi',
      titleRu: '🎙️ Живой Соведущий Подкаста',
      descUz: 'Siz bilan podkast mavzusini qizg\'in muhokama qiladi, savol beradi va muloqotni boyitadi.',
      descRu: 'Обсуждает тему подкаста, задает вопросы и естественно поддерживает диалог в прямом эфире.',
      badge: 'Live Co-Host',
      icon: Radio,
    },
    caller_in_air: {
      titleUz: '🎧 Efirga Qo\'ng\'iroq Qilgan Tinglovchi',
      titleRu: '🎧 Звонок Слушателя в Эфир',
      descUz: 'Podkastingizga qiziqib qo\'ng\'iroq qilgan faol muxlis, o\'z fikrini bildiradi.',
      descRu: 'Активный слушатель, который дозванивается в прямой эфир со своим мнением и вопросом.',
      badge: 'Listener in Air',
      icon: PhoneCall,
    },
    exclusive_mentor: {
      titleUz: '👑 Eksklyuziv Podkast Mentori (VIP)',
      titleRu: '👑 VIP Ментор и Продюсер',
      descUz: 'Podkast sifatini oshirish, auditoriyani jalb qilish bo\'yicha maslahat beradi.',
      descRu: 'Советы по качеству звука, контенту, привлечению аудитории и монетизации подкаста.',
      badge: 'VIP Mentor',
      icon: Sparkles,
    },
    business_consultant: {
      titleUz: '💼 Biznes va Media Maslahatchisi',
      titleRu: '💼 Бизнес и Медиа Консультант',
      descUz: 'Podkast orqali daromad qilish, homiylar topish va audio-marketing bo\'yicha strategik yo\'lboshchi.',
      descRu: 'Стратегия заработка на подкастах, поиск спонсоров и продвижение в Узбекистане.',
      badge: 'Consultant',
      icon: Bot,
    },
  };

  const tashkentDistricts = [
    { name: 'Mirobod', price: '$1,600 - $2,500/m²', rent: '$1,000 - $2,500', desc: 'Oybek, Госпитальный, Chexov, Ts-1 (Elita, expatlar)' },
    { name: 'Yakkasaroy', price: '$1,300 - $1,850/m²', rent: '$700 - $1,500', desc: 'Shota Rustaveli, Rakat, Bobur bog\'i (Qulay markaz)' },
    { name: 'Mirzo Ulug\'bek', price: '$1,000 - $1,550/m²', rent: '$500 - $1,000', desc: 'Buyuk Ipak Yo\'li, TTZ, Qorasuv (Yashil, oilaviy)' },
    { name: 'Yunusobod', price: '$950 - $1,400/m²', rent: '$450 - $850', desc: 'Shahriston, Megaplanet, 1-19 mavzelar (Metro tarmog\'i)' },
    { name: 'Chilonzor', price: '$900 - $1,300/m²', rent: '$400 - $800', desc: 'Novza, Qatortol, 1-20 mavzelar (Xaridorgir vtorichka)' },
    { name: 'Yashnobod', price: '$850 - $1,250/m²', rent: '$400 - $750', desc: 'Parkent, Do\'stlik, Tuzel (Tez o\'sayotgan investitsiya)' },
    { name: 'Sergeli & Yangihayot', price: '$700 - $950/m²', rent: '$300 - $600', desc: 'Yangi Sergeli, metro 1-7 bekatlar (Arzon, subsidiyali)' },
  ];

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Top Banner with Dual Engine Selector */}
      <div className="border border-[rgba(22,21,17,0.14)] rounded-[22px] bg-[rgba(255,255,255,0.52)] backdrop-blur-md p-6 sm:p-7 shadow-[0_30px_50px_-30px_rgba(22,21,17,0.35)] relative overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#0E7C86] animate-pulse" />
              <span className="px-2.5 py-0.5 rounded-full bg-[rgba(14,124,134,0.1)] text-[#0E7C86] text-[11px] font-mono tracking-wider font-semibold border border-[#0E7C86]/30 flex items-center gap-1 uppercase">
                <Zap className="w-3 h-3 text-[#0E7C86]" />
                {callEngine === 'shokhrukh_natural' ? 'SHOHRUX HAQIQIY OVOZ LIVE (0% AKSENT)' : 'OVOZSTUDIO REAL-TIME API'}
              </span>
            </div>
            <h2 className="font-serif text-2xl sm:text-3xl text-[#161511] tracking-tight">
              {lang === 'uz' ? (
                <>Toshkent Ko'chmas Mulki & <em className="italic text-[#0E7C86]">Ovozli Agenti</em></>
              ) : (
                <>Голосовой AI-Агент <em className="italic text-[#0E7C86]">Недвижимости Ташкента</em></>
              )}
            </h2>
            <p className="text-xs sm:text-sm text-[#5D594E] mt-1.5 max-w-2xl leading-relaxed">
              {callEngine === 'shokhrukh_natural'
                ? (lang === 'uz'
                    ? "Shohruxning haqiqiy ovoz nusxasi bilan to'liq jonli muloqot! Hech qanday chet elcha aksentsiz, sof o'zbek tilida Toshkent ko'chmas mulki bo'yicha maslahat oling."
                    : '100% живой голос Шохруха без американского акцента! Естественный разговорный диалог по недвижимости Ташкента.')
                : (lang === 'uz'
                    ? "Eksperimental to'g'ridan-to'g'ri WebSocket Speech-to-Speech audio oqimi."
                    : 'Экспериментальный прямой WebSocket Speech-to-Speech поток.')}
            </p>
          </div>

          {callStatus === 'connected' && (
            <div className="flex items-center gap-2.5 bg-[#141414] border border-[#2B2B27] px-4 py-2.5 rounded-2xl shadow-lg">
              <span className="w-3 h-3 rounded-full bg-[#0E7C86] animate-ping" />
              <div className="text-left">
                <p className="text-[10px] text-[#5CC8CF] font-mono uppercase tracking-wider font-bold">
                  {lang === 'uz' ? 'Aloqa faol' : 'На линии'}
                </p>
                <p className="text-lg font-mono font-bold text-[#EDEAE2]">{formatTime(callDuration)}</p>
              </div>
            </div>
          )}
        </div>

        {/* Engine Switcher & Sub-navigation tabs */}
        {callStatus === 'idle' && (
          <div className="mt-5 pt-4 border-t border-[rgba(22,21,17,0.1)] flex flex-wrap items-center justify-between gap-3">
            {/* Engine Toggle */}
            <div className="flex items-center gap-1.5 bg-[#ECE7DB] p-1 rounded-full border border-[rgba(22,21,17,0.12)]">
              <button
                type="button"
                onClick={() => {
                  setCallEngine('shokhrukh_natural');
                  setAgentVoiceId(shokhrukhVoiceId);
                }}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                  callEngine === 'shokhrukh_natural'
                    ? 'bg-[#161511] text-[#F4F1EA] shadow-2xs'
                    : 'text-[#5D594E] hover:text-[#161511]'
                }`}
              >
                <span>⭐ Shohrux Haqiqiy Ovoz (0% Aksent)</span>
              </button>
              <button
                type="button"
                onClick={() => setCallEngine('ovoz_live')}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                  callEngine === 'ovoz_live'
                    ? 'bg-[#161511] text-[#F4F1EA] shadow-2xs'
                    : 'text-[#5D594E] hover:text-[#161511]'
                }`}
              >
                <span>⚡ OvozStudio Real-time API</span>
              </button>
            </div>

            {/* Navigation Tabs */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setActiveTabSubView('agent')}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTabSubView === 'agent'
                    ? 'bg-[#0E7C86] text-white shadow-2xs'
                    : 'bg-white/80 text-[#5D594E] hover:text-[#161511] border border-[rgba(22,21,17,0.14)]'
                }`}
              >
                <PhoneCall className="w-3.5 h-3.5" />
                <span>{lang === 'uz' ? 'Qo\'ng\'iroq' : 'Звонок'}</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTabSubView('lead')}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTabSubView === 'lead'
                    ? 'bg-[#0E7C86] text-white shadow-2xs'
                    : 'bg-white/80 text-[#5D594E] hover:text-[#161511] border border-[rgba(22,21,17,0.14)]'
                }`}
              >
                <Key className="w-3.5 h-3.5" />
                <span>{lang === 'uz' ? 'LPMAMA Lead-Kartasi' : 'Лид-Карта (LPMAMA)'}</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTabSubView('prices')}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTabSubView === 'prices'
                    ? 'bg-[#0E7C86] text-white shadow-2xs'
                    : 'bg-white/80 text-[#5D594E] hover:text-[#161511] border border-[rgba(22,21,17,0.14)]'
                }`}
              >
                <TrendingUp className="w-3.5 h-3.5" />
                <span>{lang === 'uz' ? 'Narxlar Radari' : 'Радар Цен'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTabSubView('summary');
                  if (!crmSummaryData && conversationHistoryRef.current.length >= 2) {
                    handleGenerateSummary();
                  }
                }}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTabSubView === 'summary'
                    ? 'bg-[#0E7C86] text-white shadow-2xs'
                    : 'bg-white/80 text-[#5D594E] hover:text-[#161511] border border-[rgba(22,21,17,0.14)]'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>{lang === 'uz' ? 'CRM Dosye & Mulklar' : 'CRM Досье & Объекты'}</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTabSubView('playbook')}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTabSubView === 'playbook'
                    ? 'bg-[#0E7C86] text-white shadow-2xs'
                    : 'bg-white/80 text-[#5D594E] hover:text-[#161511] border border-[rgba(22,21,17,0.14)]'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>{lang === 'uz' ? 'Rieltor Skriptlari' : 'Скрипты и Инструкции'}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------- */}
      {/* ACTIVE CALL & ENDED SCREEN: Single unified LiveCallCard       */}
      {/* ------------------------------------------------------------- */}
      {callStatus !== 'idle' && (
        <div className="py-2">
          <LiveCallCard
            callStatus={callStatus}
            callDuration={callDuration}
            agentSpeaking={agentSpeaking}
            userSpeaking={userSpeaking}
            currentSubtitle={currentSubtitle}
            transcriptLines={transcriptLines}
            callTopic={callTopic}
            reLeadCard={reLeadCard}
            onStartCall={handleStartCall}
            onEndCall={handleEndCall}
            onToggleMute={handleToggleMute}
            isMuted={isMuted}
            onResetCall={() => {
              setCallStatus('idle');
              setCallDuration(0);
            }}
            onGoToCRM={() => {
              setCallStatus('idle');
              setActiveTabSubView('summary');
              if (!crmSummaryData && conversationHistoryRef.current.length >= 2) {
                handleGenerateSummary();
              }
            }}
            onGoToLead={() => {
              setCallStatus('idle');
              setActiveTabSubView('lead');
            }}
            isAuthenticated={isAuthenticated}
            lang={lang}
            agentVoiceName={agentVoiceId === shokhrukhVoiceId ? 'SHOHRUX' : 'MADINA'}
            onSendText={handleSendQuickPrompt}
            micWarning={micWarning}
          />
        </div>
      )}

      {/* Old legacy screen disabled */}
      {false && (
        <div className="hidden">
          {/* Background Ambient Glow */}
          <div
            className={`absolute inset-0 bg-radial transition-all duration-700 pointer-events-none ${
              agentSpeaking
                ? 'from-[#0E7C86]/25 via-transparent to-transparent'
                : userSpeaking
                ? 'from-[#5CC8CF]/20 via-transparent to-transparent'
                : 'from-white/5 via-transparent to-transparent'
            }`}
          />

          {/* Top Status */}
          <div className="flex items-center gap-2 relative z-10">
            <span
              className={`w-3 h-3 rounded-full ${
                callStatus === 'calling' ? 'bg-[#C98A12] animate-ping' : 'bg-[#5CC8CF] animate-pulse'
              }`}
            />
            <span className="text-xs sm:text-sm font-bold text-[#EDEAE2] font-mono tracking-wider">
              {callStatus === 'calling'
                ? lang === 'uz'
                  ? 'QO\'NG\'IROQ QILINMOQDA (GO\'SHAK KO\'TARILMOQDA)...'
                  : 'ВЫЗОВ (ПОДНЯТИЕ ТРУБКИ)...'
                : `● JONLI ALOQA • ${formatTime(callDuration)}`}
            </span>
          </div>

          {/* Microphone Warning Banner if blocked */}
          {micWarning && (
            <div className="w-full max-w-xl bg-[rgba(196,85,45,0.15)] border border-[#C4552D]/50 rounded-2xl p-3 text-xs text-[#EDEAE2] flex items-start gap-2.5 text-left relative z-10 shadow-lg">
              <span className="text-base leading-none">⚠️</span>
              <div className="flex-1">
                <p className="font-bold text-[#C4552D]">
                  {lang === 'uz' ? 'Mikrofon ruxsati berilmadi' : 'Микрофон недоступен'}
                </p>
                <p className="text-[11px] text-[#EDEAE2]/90 mt-0.5 leading-relaxed">{micWarning}</p>
              </div>
            </div>
          )}

          {/* Central Pulsating Voice Orb / Avatar */}
          <div className="relative z-10 my-4 flex items-center justify-center">
            <div
              className={`absolute rounded-full transition-all duration-200 pointer-events-none ${
                agentSpeaking
                  ? 'w-48 h-48 sm:w-64 sm:h-64 bg-[#0E7C86]/20 border border-[#0E7C86]/40 animate-ping'
                  : userSpeaking
                  ? 'w-48 h-48 sm:w-64 sm:h-64 bg-[#5CC8CF]/20 border border-[#5CC8CF]/40 animate-ping'
                  : 'w-36 h-36 bg-[#1D1D1B]'
              }`}
            />
            <div
              className={`absolute rounded-full transition-transform duration-150 pointer-events-none ${
                agentSpeaking
                  ? 'w-40 h-40 sm:w-52 sm:h-52 bg-gradient-to-r from-[#0E7C86]/30 to-[#5CC8CF]/30 border border-[#5CC8CF]/50 scale-110 shadow-[0_0_50px_rgba(14,124,134,0.4)]'
                  : userSpeaking
                  ? 'w-40 h-40 sm:w-52 sm:h-52 bg-gradient-to-r from-[#0A5A62]/30 to-[#0E7C86]/30 border border-[#0E7C86]/50 scale-110 shadow-[0_0_50px_rgba(14,124,134,0.4)]'
                  : 'w-32 h-32 bg-[#1D1D1B] border border-[#2B2B27]'
              }`}
              style={{
                transform: `scale(${1 + audioLevel * 0.4})`,
              }}
            />

            {/* Central Circle */}
            <div className="w-28 h-28 sm:w-36 sm:h-36 rounded-full bg-gradient-to-tr from-[#0E0E0D] via-[#141414] to-[#1D1D1B] border-2 border-[#0E7C86] flex flex-col items-center justify-center shadow-2xl relative z-10">
              {selectedPersona === 'tashkent_real_estate' ? (
                <Building2 className={`w-10 h-10 sm:w-12 sm:h-12 transition-colors ${
                  agentSpeaking ? 'text-[#5CC8CF] animate-bounce' : userSpeaking ? 'text-[#0E7C86]' : 'text-[#EDEAE2]'
                }`} />
              ) : (
                <Bot
                  className={`w-10 h-10 sm:w-12 sm:h-12 transition-colors ${
                    agentSpeaking ? 'text-[#5CC8CF] animate-bounce' : userSpeaking ? 'text-[#0E7C86]' : 'text-[#7D7A70]'
                  }`}
                />
              )}
              <span className="text-[10px] font-bold text-[#EDEAE2] mt-1 uppercase tracking-wider font-mono">
                {agentVoiceId === shokhrukhVoiceId
                  ? 'SHOHRUX'
                  : agentVoiceId === 'Aoede'
                  ? 'MADINA'
                  : agentVoiceId === 'Charon'
                  ? 'JASUR'
                  : agentVoiceId === 'Puck'
                  ? 'OTABEK'
                  : agentVoiceId === 'Kore'
                  ? 'AZIZA'
                  : agentVoiceId === 'Fenrir'
                  ? "ULUG'BEK"
                  : agentVoiceId}
              </span>
            </div>
          </div>

          {/* Caller Details & Current Live Status */}
          <div className="space-y-2 relative z-10 max-w-lg">
            <h3 className="font-serif text-xl sm:text-2xl text-[#EDEAE2]">
              {personaConfig[selectedPersona].titleUz}
            </h3>
            <p className="text-xs text-[#7D7A70] line-clamp-2">
              <span className="text-[#EDEAE2] font-semibold">{lang === 'uz' ? 'Mavzu:' : 'Тема:'}</span> "{callTopic}"
            </p>

            {/* Active Guardrail & Anti-hallucination Real Estate Indicators */}
            {selectedPersona === 'tashkent_real_estate' && (
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                <span className="px-2.5 py-0.5 rounded-full bg-[rgba(14,124,134,0.15)] text-[#5CC8CF] border border-[#0E7C86]/40 text-[10px] font-mono font-bold flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3 text-[#5CC8CF]" />
                  <span>{lang === 'uz' ? "Faqat Ko'chmas Mulk (Guardrail)" : 'Только Недвижимость (Guardrail)'}</span>
                  {offTopicCount > 0 && (
                    <span className="bg-[#0E7C86]/30 px-1.5 py-0.2 rounded-full text-[9px]">
                      {offTopicCount} qaytarildi
                    </span>
                  )}
                </span>

                <span className="px-2.5 py-0.5 rounded-full bg-[rgba(201,138,18,0.15)] text-[#C98A12] border border-[#C98A12]/40 text-[10px] font-mono font-bold flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-[#C98A12]" />
                  <span>{lang === 'uz' ? "Halol Aniqlashtirish (Anti-hallucination)" : 'Защита от галлюцинаций'}</span>
                  {clarificationCount > 0 && (
                    <span className="bg-[#C98A12]/30 px-1.5 py-0.2 rounded-full text-[9px]">
                      {clarificationCount}
                    </span>
                  )}
                </span>

                {reLeadCard.leadTemperature && (
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold flex items-center gap-1 border ${
                    reLeadCard.leadTemperature === 'hot'
                      ? 'bg-[rgba(196,85,45,0.15)] text-[#C4552D] border-[#C4552D]/40'
                      : reLeadCard.leadTemperature === 'warm'
                      ? 'bg-[rgba(201,138,18,0.15)] text-[#C98A12] border-[#C98A12]/40'
                      : 'bg-[rgba(14,124,134,0.15)] text-[#5CC8CF] border-[#0E7C86]/40'
                  }`}>
                    <Flame className="w-3 h-3" />
                    <span>{reLeadCard.leadTemperature?.toUpperCase()} LEAD</span>
                  </span>
                )}
              </div>
            )}

            {/* Dynamic Flash Alert Banners */}
            {guardrailAlert && (
              <div className="w-full max-w-xl bg-[#1D1D1B] border border-[#0E7C86]/60 rounded-2xl p-2.5 text-xs text-[#5CC8CF] flex items-center gap-2 text-left shadow-lg animate-bounce">
                <ShieldAlert className="w-4 h-4 text-[#5CC8CF] flex-shrink-0" />
                <p className="font-semibold flex-1 text-[11px]">{guardrailAlert}</p>
              </div>
            )}

            {clarificationAlert && (
              <div className="w-full max-w-xl bg-[#1D1D1B] border border-[#C98A12]/50 rounded-2xl p-2.5 text-xs text-[#C98A12] flex items-center gap-2 text-left shadow-lg">
                <HelpCircle className="w-4 h-4 text-[#C98A12] flex-shrink-0" />
                <p className="font-semibold flex-1 text-[11px]">{clarificationAlert}</p>
              </div>
            )}

            {liveLeadUpdateToast && (
              <div className="w-full max-w-xl bg-[#1D1D1B] border border-[#0E7C86]/50 rounded-2xl p-2.5 text-xs text-[#5CC8CF] flex items-center gap-2 text-left shadow-lg">
                <CheckCircle2 className="w-4 h-4 text-[#5CC8CF] flex-shrink-0" />
                <p className="font-semibold flex-1 text-[11px]">{liveLeadUpdateToast}</p>
              </div>
            )}

            <div className="pt-2 flex flex-col items-center gap-2">
              <span
                className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-mono font-bold transition-colors ${
                  agentSpeaking
                    ? 'bg-[#0E7C86]/20 text-[#5CC8CF] border border-[#0E7C86]/40'
                    : userSpeaking
                    ? 'bg-[#5CC8CF]/20 text-[#EDEAE2] border border-[#5CC8CF]/40'
                    : isLoadingTurn
                    ? 'bg-[#C98A12]/20 text-[#C98A12] border border-[#C98A12]/40 animate-pulse'
                    : 'bg-[#1D1D1B] text-[#7D7A70] border border-[#2B2B27]'
                }`}
              >
                {agentSpeaking ? (
                  <>
                    <Volume2 className="w-3.5 h-3.5 animate-pulse text-[#5CC8CF]" />
                    <span>
                      {agentVoiceId === 'Aoede'
                        ? (lang === 'uz' ? 'Madina gapirmoqda...' : 'Мадина говорит...')
                        : agentVoiceId === 'Kore'
                        ? (lang === 'uz' ? 'Aziza gapirmoqda...' : 'Азиза говорит...')
                        : agentVoiceId === 'Charon'
                        ? (lang === 'uz' ? 'Jasur gapirmoqda...' : 'Жасур говорит...')
                        : agentVoiceId === 'Puck'
                        ? (lang === 'uz' ? 'Otabek gapirmoqda...' : 'Отабек говорит...')
                        : agentVoiceId === 'Fenrir'
                        ? (lang === 'uz' ? "Ulug'bek gapirmoqda..." : 'Улугбек говорит...')
                        : (lang === 'uz' ? 'Shohrux gapirmoqda...' : 'Шохрух говорит...')}
                    </span>
                  </>
                ) : userSpeaking ? (
                  <>
                    <Mic className="w-3.5 h-3.5 text-[#5CC8CF] animate-pulse" />
                    <span>{lang === 'uz' ? 'Siz gapiryapsiz...' : 'Вы говорите...'}</span>
                  </>
                ) : isLoadingTurn ? (
                  <>
                    <Zap className="w-3.5 h-3.5 text-[#C98A12] animate-bounce" />
                    <span>{lang === 'uz' ? '⚡ Javob tayyorlanmoqda (~1 soniya)...' : '⚡ Ответ готовится (~1 сек)...'}</span>
                  </>
                ) : (
                  <>
                    <Radio className="w-3.5 h-3.5 text-[#5CC8CF] animate-pulse" />
                    <span>{lang === 'uz' ? '🎙️ Sizni tinglayapman — bemalol gapiring!' : '🎙️ Слушаю вас — говорите свободно!'}</span>
                  </>
                )}
              </span>

              {/* Instant finish button while user is speaking */}
              {userSpeaking && (
                <button
                  type="button"
                  onClick={handleManualFinishSpeaking}
                  className="px-4 py-1.5 bg-[#0E7C86] hover:bg-[#0A5A62] text-white rounded-full text-[11px] font-mono font-bold shadow-lg flex items-center gap-1.5 cursor-pointer animate-pulse transition-all"
                >
                  <Zap className="w-3 h-3 fill-current text-[#5CC8CF]" />
                  <span>{lang === 'uz' ? '⚡ Gapirib bo\'ldim (Javob olish)' : '⚡ Закончил говорить (Ответить)'}</span>
                </button>
              )}
            </div>
          </div>

          {/* Quick Voice Prompt & Objection Handling Chips */}
          {selectedPersona === 'tashkent_real_estate' && (
            <div className="w-full max-w-xl relative z-10 pt-1 space-y-2">
              <div className="flex items-center justify-between text-[11px] text-[#7D7A70]">
                <span className="font-medium">
                  {lang === 'uz' ? 'Tezkor savollar va e\'tirozlar testi:' : 'Быстрые вопросы и проверка отработки возражений:'}
                </span>
                <span className="text-[10px] text-[#5CC8CF] font-mono">Bosing yoki mikrofonga ayting</span>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                {[
                  { text: 'Chilonzorda arzonroq 2 xonali uy bormi?', label: '🏢 Chilonzor 2x' },
                  { text: 'Mirobodda 1 m² narxi qancha?', label: '📍 Mirobod m²' },
                  { text: 'Juda qimmat, arzonroq variant bormi?', label: '⚠️ E\'tiroz: Qimmat' },
                  { text: 'Narxlar tushishini kutyapman, shoshilmayman', label: '⏳ E\'tiroz: Kutyapman' },
                  { text: 'O\'zim rieltorsiz sotib olaman, komissiya to\'lamayman', label: '🤝 E\'tiroz: O\'zim olaman' },
                  { text: 'Subsidiyali ipoteka shartlari qanaqa?', label: '🏦 Ipoteka/Subsidiya' },
                  { text: 'Toshkentda ertaga ob-havo qanday bo\'ladi?', label: '🛡️ Test: Offtop mavzu' },
                  { text: 'Hm... anavi... haligi tuman bor-ku...', label: '✨ Test: Noaniq talaffuz' },
                ].map((item) => (
                  <button
                    key={item.text}
                    type="button"
                    onClick={() => handleSendQuickPrompt(item.text)}
                    className="px-2.5 py-1 bg-[#1D1D1B] hover:bg-[#2B2B27] border border-[#2B2B27] text-[11px] text-[#EDEAE2] rounded-full transition-colors cursor-pointer flex items-center gap-1"
                    title={item.text}
                  >
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Live Subtitles Strip */}
          <div className="w-full max-w-xl bg-[#0E0E0D] border border-[#2B2B27] rounded-2xl p-4 text-center min-h-[64px] flex items-center justify-center relative z-10 shadow-inner">
            <p className="text-xs sm:text-sm text-[#EDEAE2] italic font-medium leading-relaxed">
              {currentSubtitle ? (
                `"${currentSubtitle}"`
              ) : (
                <span className="text-[#7D7A70] text-xs not-italic">
                  {lang === 'uz'
                    ? 'Mikrofonga erkin gapiring, Shohrux sizni eshitadi...'
                    : 'Говорите в микрофон, Шохрух слушает вас в реальном времени...'}
                </span>
              )}
            </p>
          </div>

          {/* Call Controls Bar */}
          <div className="flex items-center justify-center gap-4 sm:gap-6 pt-4 relative z-10">
            {/* Mute Button */}
            <button
              type="button"
              onClick={handleToggleMute}
              className={`w-14 h-14 rounded-full flex flex-col items-center justify-center transition-all cursor-pointer shadow-lg ${
                isMuted
                  ? 'bg-[#C98A12]/20 border-2 border-[#C98A12] text-[#C98A12]'
                  : 'bg-[#1D1D1B] hover:bg-[#2B2B27] border border-[#2B2B27] text-[#EDEAE2]'
              }`}
              title={isMuted ? 'Mikrofonni yoqish' : 'Mikrofonni o\'chirish'}
            >
              {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
              <span className="text-[9px] font-mono font-bold mt-0.5">{isMuted ? 'Muted' : 'Mic'}</span>
            </button>

            {/* End Call Button (Big Red) */}
            <button
              type="button"
              onClick={handleEndCall}
              className="w-18 h-18 rounded-full bg-[#C4552D] hover:bg-[#b04823] text-white flex flex-col items-center justify-center shadow-xl hover:scale-105 active:scale-95 transition-all cursor-pointer border-2 border-[#C4552D]/80"
              title="Qo'ng'iroqni tugatish"
            >
              <PhoneOff className="w-8 h-8" />
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider mt-0.5">
                {lang === 'uz' ? 'Tugatish' : 'Сброс'}
              </span>
            </button>

            {/* Interrupt Button */}
            <button
              type="button"
              onClick={handleInterruptAgent}
              disabled={!agentSpeaking}
              className={`w-14 h-14 rounded-full flex flex-col items-center justify-center transition-all cursor-pointer shadow-lg ${
                agentSpeaking
                  ? 'bg-[#0E7C86] hover:bg-[#0A5A62] text-white shadow-[#0E7C86]/30 animate-pulse'
                  : 'bg-[#1D1D1B]/50 border border-[#2B2B27] text-[#7D7A70] cursor-not-allowed'
              }`}
              title="Agent gapini to'xtatish"
            >
              <Zap className="w-6 h-6" />
              <span className="text-[9px] font-mono font-bold mt-0.5">{lang === 'uz' ? 'To\'xtatish' : 'Перебить'}</span>
            </button>
          </div>

          {/* Quick Text Input Fallback (Optional) */}
          <div className="w-full max-w-md pt-2 relative z-10">
            <div className="flex items-center gap-2 bg-[#1D1D1B] border border-[#2B2B27] rounded-full px-4 py-2">
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSendQuickPrompt(textInput);
                    setTextInput('');
                  }
                }}
                placeholder={lang === 'uz' ? 'Yoki savolingizni yozib yuboring...' : 'Или напишите вопрос текстом...'}
                className="flex-1 bg-transparent text-xs text-[#EDEAE2] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  handleSendQuickPrompt(textInput);
                  setTextInput('');
                }}
                disabled={!textInput.trim()}
                className="p-1.5 text-[#5CC8CF] hover:text-[#EDEAE2] disabled:text-[#7D7A70] cursor-pointer"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}



      {/* STATE 3: PRE-CALL CONFIGURATION & DIAL SCREEN (IDLE) */}
      {callStatus === 'idle' && (
        <>
          {activeTabSubView === 'prices' && (
            <div className="bg-white border border-[rgba(22,21,17,0.14)] rounded-[22px] p-6 sm:p-7 space-y-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-serif text-xl sm:text-2xl text-[#161511] flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-[#0E7C86]" />
                    <span>{lang === 'uz' ? <>Toshkent Ko'chmas Mulki <em className="italic text-[#0E7C86]">Narxlar Radari</em></> : <>Радар Цен на <em className="italic text-[#0E7C86]">Недвижимость Ташкента</em></>}</span>
                  </h3>
                  <p className="text-xs text-[#5D594E] mt-1">
                    {lang === 'uz'
                      ? 'AI Rieltor ushbu narxlar va bozor realligidan kelib chiqib aniq maslahat beradi.'
                      : 'AI Риелтор опирается на актуальные рыночные цены за м² и ставки аренды.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTabSubView('agent')}
                  className="btn-pill btn-solid text-xs py-2 px-4 cursor-pointer"
                >
                  📞 Qo'ng'iroqqa o'tish
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {tashkentDistricts.map((d) => (
                  <div key={d.name} className="p-4 rounded-xl bg-[#F4F1EA]/60 border border-[rgba(22,21,17,0.1)] space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sm text-[#161511]">{d.name}</span>
                      <span className="px-2.5 py-0.5 rounded-full bg-[rgba(14,124,134,0.1)] text-[#0E7C86] text-[11px] font-mono font-bold border border-[#0E7C86]/30">
                        {d.price}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#5D594E] leading-relaxed">{d.desc}</p>
                    <div className="text-[11px] text-[#0A5A62] font-medium pt-1 border-t border-[rgba(22,21,17,0.06)]">
                      🔑 Ijara daromadi: <span className="text-[#161511] font-mono font-bold">{d.rent}/oy</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTabSubView === 'lead' && (
            <div className="bg-white border border-[rgba(22,21,17,0.14)] rounded-[22px] p-6 sm:p-7 space-y-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-serif text-xl sm:text-2xl text-[#161511] flex items-center gap-2">
                    <Key className="w-5 h-5 text-[#C98A12]" />
                    <span>{lang === 'uz' ? <>LPMAMA Metodologiyasi & <em className="italic text-[#0E7C86]">Lead-Kartasi</em></> : <>Лид-Карта по Методологии <em className="italic text-[#0E7C86]">LPMAMA</em></>}</span>
                  </h3>
                  <p className="text-xs text-[#5D594E] mt-1">
                    {lang === 'uz'
                      ? 'AI-qo\'ng\'iroq paytida avtomatik to\'ldiriladi yoki parametrlarni qo\'lda moslashtiring.'
                      : 'Автоматически заполняется во время звонка или настраивается вручную.'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyLead}
                    className="btn-pill btn-solid text-xs py-2 px-4 flex items-center gap-1.5"
                  >
                    {copiedLead ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-[#5CC8CF]" />}
                    <span>{copiedLead ? 'Nusxalandi!' : 'Telegramga Nusxalash'}</span>
                  </button>
                </div>
              </div>

              {/* LPMAMA 6-Pillar Checklist */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                {[
                  { tag: 'L', name: 'Location', desc: reLeadCard.district || 'Belgilanmagan', ok: !!reLeadCard.district },
                  { tag: 'P', name: 'Price', desc: reLeadCard.budgetRange || 'Aniqlanmagan', ok: !!reLeadCard.budgetRange },
                  { tag: 'M', name: 'Motivation', desc: reLeadCard.clientIntent ? reLeadCard.clientIntent.toUpperCase() : 'Noma\'lum', ok: !!reLeadCard.clientIntent },
                  { tag: 'A', name: 'Agent', desc: 'Eksklyuziv Shohrux', ok: true },
                  { tag: 'M', name: 'Mortgage', desc: reLeadCard.paymentMethod || 'Naqd/Ipoteka', ok: !!reLeadCard.paymentMethod },
                  { tag: 'A', name: 'Appointment', desc: reLeadCard.nextStep || 'Ko\'rik tayinlash', ok: !!reLeadCard.nextStep },
                ].map((item, idx) => (
                  <div key={idx} className="p-3 bg-[#F4F1EA]/60 border border-[rgba(22,21,17,0.1)] rounded-xl space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="w-5 h-5 rounded-full bg-[rgba(14,124,134,0.1)] text-[#0E7C86] text-xs font-mono font-bold flex items-center justify-center">
                        {item.tag}
                      </span>
                      {item.ok ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#0E7C86]" />
                      ) : (
                        <BadgeAlert className="w-3.5 h-3.5 text-[#C98A12]" />
                      )}
                    </div>
                    <p className="text-[10px] font-mono text-[#5D594E] uppercase font-bold">{item.name}</p>
                    <p className="text-xs text-[#161511] font-semibold truncate">{item.desc}</p>
                  </div>
                ))}
              </div>

              {/* Form Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2">
                <div>
                  <label className="text-[11px] font-mono uppercase tracking-wider text-[#5D594E] block mb-1">Maqsad (Intent):</label>
                  <select
                    value={reLeadCard.clientIntent}
                    onChange={(e) => setReLeadCard({ ...reLeadCard, clientIntent: e.target.value as any })}
                    className="w-full bg-[#F4F1EA]/60 border border-[rgba(22,21,17,0.14)] rounded-xl px-3 py-2 text-xs text-[#161511] focus:outline-none focus:border-[#0E7C86]"
                  >
                    <option value="buy">Sotib olish (Kuplya)</option>
                    <option value="rent">Ijara (Arenda)</option>
                    <option value="invest">Investitsiya (Flipping/ROI)</option>
                    <option value="sell">Sotish (Prodaja)</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-mono uppercase tracking-wider text-[#5D594E] block mb-1">Tuman (Location):</label>
                  <select
                    value={reLeadCard.district}
                    onChange={(e) => setReLeadCard({ ...reLeadCard, district: e.target.value })}
                    className="w-full bg-[#F4F1EA]/60 border border-[rgba(22,21,17,0.14)] rounded-xl px-3 py-2 text-xs text-[#161511] focus:outline-none focus:border-[#0E7C86]"
                  >
                    {tashkentDistricts.map((d) => (
                      <option key={d.name} value={d.name}>{d.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-mono uppercase tracking-wider text-[#5D594E] block mb-1">Byudjet (Price):</label>
                  <input
                    type="text"
                    value={reLeadCard.budgetRange}
                    onChange={(e) => setReLeadCard({ ...reLeadCard, budgetRange: e.target.value })}
                    placeholder="$50,000 - $80,000"
                    className="w-full bg-[#F4F1EA]/60 border border-[rgba(22,21,17,0.14)] rounded-xl px-3 py-2 text-xs text-[#161511] focus:outline-none focus:border-[#0E7C86]"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-mono uppercase tracking-wider text-[#5D594E] block mb-1">To'lov usuli (Payment):</label>
                  <select
                    value={reLeadCard.paymentMethod || 'cash'}
                    onChange={(e) => setReLeadCard({ ...reLeadCard, paymentMethod: e.target.value as any })}
                    className="w-full bg-[#F4F1EA]/60 border border-[rgba(22,21,17,0.14)] rounded-xl px-3 py-2 text-xs text-[#161511] focus:outline-none focus:border-[#0E7C86]"
                  >
                    <option value="cash">100% Naqd to'lov</option>
                    <option value="mortgage">Bank ipotekasi (17-18%)</option>
                    <option value="installments">0% Bo'lib to'lash (Rassrochka)</option>
                  </select>
                </div>
              </div>

              {/* Temperature & Urgency */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-mono uppercase tracking-wider text-[#5D594E] block mb-1">Mijoz Harorati (Temperature):</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['hot', 'warm', 'cold'] as const).map((temp) => (
                      <button
                        key={temp}
                        type="button"
                        onClick={() => setReLeadCard({ ...reLeadCard, leadTemperature: temp })}
                        className={`py-2 px-3 rounded-full border text-xs font-bold capitalize transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                          reLeadCard.leadTemperature === temp
                            ? temp === 'hot'
                              ? 'bg-[rgba(196,85,45,0.12)] border-[#C4552D] text-[#C4552D]'
                              : temp === 'warm'
                              ? 'bg-[rgba(201,138,18,0.12)] border-[#C98A12] text-[#C98A12]'
                              : 'bg-[rgba(14,124,134,0.12)] border-[#0E7C86] text-[#0E7C86]'
                            : 'bg-white border-[rgba(22,21,17,0.14)] text-[#5D594E] hover:border-[#161511]'
                        }`}
                      >
                        <Flame className="w-3.5 h-3.5" />
                        <span>{temp}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-mono uppercase tracking-wider text-[#5D594E] block mb-1">Keyingi Qadam (Next Action):</label>
                  <input
                    type="text"
                    value={reLeadCard.nextStep || 'Ertaga soat 15:00 da ob\'ekt ko\'rigi'}
                    onChange={(e) => setReLeadCard({ ...reLeadCard, nextStep: e.target.value })}
                    className="w-full bg-[#F4F1EA]/60 border border-[rgba(22,21,17,0.14)] rounded-xl px-3 py-2 text-xs text-[#161511] focus:outline-none focus:border-[#0E7C86]"
                  />
                </div>
              </div>

              {/* Formatted Lead Text Preview */}
              <div className="p-4 bg-[#F4F1EA]/80 rounded-xl border border-[rgba(22,21,17,0.14)] font-mono text-xs text-[#161511] space-y-1.5 shadow-2xs">
                <div className="flex items-center justify-between text-[#0E7C86] font-bold">
                  <span>📋 Telegram & CRM Tayyor Shakli:</span>
                  <span className="text-[10px] text-[#5D594E] font-mono">1 Click Copy</span>
                </div>
                <p>• <b>Harorat:</b> {reLeadCard.leadTemperature ? reLeadCard.leadTemperature.toUpperCase() : 'WARM'} LEAD 🔥</p>
                <p>• <b>Maqsad:</b> {reLeadCard.clientIntent.toUpperCase()}</p>
                <p>• <b>Tuman:</b> {reLeadCard.district}</p>
                <p>• <b>Byudjet:</b> {reLeadCard.budgetRange}</p>
                <p>• <b>Xonalar:</b> {reLeadCard.roomsCount} • Mulk turi: {reLeadCard.propertyType}</p>
                <p>• <b>To'lov:</b> {reLeadCard.paymentMethod === 'mortgage' ? 'Ipoteka' : reLeadCard.paymentMethod === 'installments' ? 'Rassrochka 0%' : 'Naqd'}</p>
                <p>• <b>Keyingi Qadam:</b> {reLeadCard.nextStep || 'Ko\'rik va shartnoma'}</p>
              </div>
            </div>
          )}

          {activeTabSubView === 'summary' && (
            <div className="bg-white border border-[rgba(22,21,17,0.14)] rounded-[22px] p-6 sm:p-7 space-y-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[rgba(22,21,17,0.08)] pb-4">
                <div>
                  <h3 className="font-serif text-xl sm:text-2xl text-[#161511] flex items-center gap-2">
                    <FileText className="w-5 h-5 text-[#0E7C86]" />
                    <span>{lang === 'uz' ? <>AI Rieltor <em className="italic text-[#0E7C86]">Qo'ng'iroq Dosyesi</em> & Tavsiya Qilingan Mulklar</> : <>CRM Досье Звонка и <em className="italic text-[#0E7C86]">Рекомендованные Объекты</em></>}</span>
                  </h3>
                  <p className="text-xs text-[#5D594E] mt-1">
                    {lang === 'uz'
                      ? 'Suhbat tahlili, BANT reytingi va Toshkent bazasidan mos 3 ta uy'
                      : 'Анализ переговоров, оценка BANT и 3 подобранных объекта по параметрам клиента.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleGenerateSummary}
                  disabled={isGeneratingSummary}
                  className="btn-pill btn-solid text-xs py-2 px-4 flex items-center gap-2 disabled:opacity-50"
                >
                  <Sparkles className="w-4 h-4 text-[#5CC8CF]" />
                  <span>{isGeneratingSummary ? 'Tahlil qilinmoqda...' : 'Dosyeni Qayta Generatsiya Qilish'}</span>
                </button>
              </div>

              {/* Temperature & Summary Banner */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-[#F4F1EA]/60 border border-[rgba(22,21,17,0.1)] space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono uppercase tracking-wider text-[#5D594E] font-bold">Mijoz Harorati:</span>
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-mono font-bold uppercase flex items-center gap-1 border ${
                      reLeadCard.leadTemperature === 'hot'
                        ? 'bg-[rgba(196,85,45,0.1)] text-[#C4552D] border-[#C4552D]/30'
                        : reLeadCard.leadTemperature === 'warm'
                        ? 'bg-[rgba(201,138,18,0.1)] text-[#C98A12] border-[#C98A12]/30'
                        : 'bg-[rgba(14,124,134,0.1)] text-[#0E7C86] border-[#0E7C86]/30'
                    }`}>
                      <Flame className="w-3.5 h-3.5" />
                      {reLeadCard.leadTemperature || 'WARM'}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#5D594E] leading-relaxed">
                    {crmSummaryData?.temperatureReason || 'Mijoz aniq parametrlar bo\'yicha qiziqish bildirdi.'}
                  </p>
                </div>

                <div className="md:col-span-2 p-4 rounded-xl bg-[#F4F1EA]/60 border border-[rgba(22,21,17,0.1)] space-y-1.5">
                  <span className="text-xs text-[#0E7C86] font-mono uppercase font-bold tracking-wider">Suhbat Mazmuni (Summary):</span>
                  <p className="text-xs text-[#161511] leading-relaxed">
                    {crmSummaryData?.callSummary || 'AI agent bilan Toshkent ko\'chmas mulki bo\'yicha telefon orqali samarali dastlabki maslahatlashuv o\'tkazildi.'}
                  </p>
                </div>
              </div>

              {/* BANT Qualification Cards */}
              <div className="space-y-2">
                <h4 className="text-xs font-mono uppercase tracking-wider text-[#5D594E] font-bold flex items-center gap-1.5">
                  <CheckSquare className="w-4 h-4 text-[#0E7C86]" />
                  <span>BANT Kwalifikatsiya Tahlili:</span>
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="p-3.5 rounded-xl bg-[#F4F1EA]/60 border border-[rgba(22,21,17,0.1)]">
                    <span className="text-[10px] text-[#0E7C86] font-bold uppercase font-mono">B — Budget</span>
                    <p className="text-xs text-[#161511] font-semibold mt-1">
                      {crmSummaryData?.qualificationBANT?.budget || reLeadCard.budgetRange || '$50,000 - $80,000'}
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-[#F4F1EA]/60 border border-[rgba(22,21,17,0.1)]">
                    <span className="text-[10px] text-[#0E7C86] font-bold uppercase font-mono">A — Authority</span>
                    <p className="text-xs text-[#161511] font-semibold mt-1">
                      {crmSummaryData?.qualificationBANT?.authority || 'Asosiy xaridor (oila boshlig\'i)'}
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-[#F4F1EA]/60 border border-[rgba(22,21,17,0.1)]">
                    <span className="text-[10px] text-[#C98A12] font-bold uppercase font-mono">N — Need</span>
                    <p className="text-xs text-[#161511] font-semibold mt-1">
                      {crmSummaryData?.qualificationBANT?.need || `${reLeadCard.district} tumanida ${reLeadCard.roomsCount}`}
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-[#F4F1EA]/60 border border-[rgba(22,21,17,0.1)]">
                    <span className="text-[10px] text-[#C98A12] font-bold uppercase font-mono">T — Timeline</span>
                    <p className="text-xs text-[#161511] font-semibold mt-1">
                      {crmSummaryData?.qualificationBANT?.timeline || 'Shu oy ichida ko\'rish va qaror qilish'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Matched Properties Catalog Simulation */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-mono uppercase tracking-wider text-[#5D594E] font-bold flex items-center gap-1.5">
                    <Home className="w-4 h-4 text-[#0E7C86]" />
                    <span>Mijoz Uchun Tanlangan 3 Ta Tavsiya:</span>
                  </h4>
                  <span className="text-[11px] font-mono text-[#0E7C86] font-medium">Bozor realligi bilan to'liq sinxron</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {(crmSummaryData?.matchedProperties || [
                    {
                      id: 'prop-1',
                      title: 'Modern City Mirabad Residence',
                      district: 'Mirobod',
                      price: '$68,000',
                      area: '62 m²',
                      rooms: '2 xonali',
                      roi: '11.5% yillik arenda',
                      badge: 'Top Tavsiya',
                      developer: 'Modern Stroy',
                    },
                    {
                      id: 'prop-2',
                      title: 'Chilanzar Green Park',
                      district: 'Chilonzor',
                      price: '$52,000',
                      area: '54 m²',
                      rooms: '2 xonali',
                      roi: '9.8% yillik arenda',
                      badge: 'Arzon & Qulay',
                      developer: 'Golden House',
                    },
                    {
                      id: 'prop-3',
                      title: 'Yunusabad Metro Plaza',
                      district: 'Yunusobod',
                      price: '$74,000',
                      area: '76 m²',
                      rooms: '3 xonali',
                      roi: '10.2% yillik arenda',
                      badge: 'Keng Maydon',
                      developer: 'NRG Uzbekistan',
                    },
                  ]).map((prop: any) => (
                    <div key={prop.id} className="p-4 rounded-xl bg-white border border-[rgba(22,21,17,0.14)] space-y-2 hover:border-[#0E7C86] transition-all shadow-2xs">
                      <div className="flex items-center justify-between">
                        <span className="px-2.5 py-0.5 rounded-full bg-[rgba(14,124,134,0.1)] text-[#0E7C86] text-[10px] font-mono font-bold border border-[#0E7C86]/30">
                          {prop.badge || 'Mos Variant'}
                        </span>
                        <span className="text-xs font-mono font-bold text-[#161511]">{prop.price}</span>
                      </div>
                      <h5 className="font-bold text-sm text-[#161511]">{prop.title}</h5>
                      <div className="flex items-center gap-2 text-[11px] text-[#5D594E]">
                        <span>📍 {prop.district}</span>
                        <span>•</span>
                        <span>📐 {prop.area}</span>
                        <span>•</span>
                        <span>🚪 {prop.rooms}</span>
                      </div>
                      <div className="pt-2 border-t border-[rgba(22,21,17,0.06)] flex items-center justify-between text-[11px]">
                        <span className="text-zinc-500">Quruvchi: {prop.developer || 'Zastroyshik'}</span>
                        <span className="text-[#0E7C86] font-bold font-mono">📈 {prop.roi}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTabSubView === 'playbook' && (
            <div className="bg-white border border-[rgba(22,21,17,0.14)] rounded-[22px] p-6 sm:p-7 space-y-6 shadow-sm">
              <div className="flex items-center justify-between border-b border-[rgba(22,21,17,0.08)] pb-4">
                <div>
                  <h3 className="font-serif text-xl sm:text-2xl text-[#161511] flex items-center gap-2">
                    <BookOpen className="w-5 h-5 text-[#0E7C86]" />
                    <span>{lang === 'uz' ? <>Rieltor Skriptlari & <em className="italic text-[#0E7C86]">AI Agent Qo'llanmasi</em></> : <>Скрипты и Речевые Модули <em className="italic text-[#0E7C86]">Риелтора</em></>}</span>
                  </h3>
                  <p className="text-xs text-[#5D594E] mt-1">
                    {lang === 'uz'
                      ? 'AI qanday gapiradi, qanday cheklovlar o\'rnatilgan va e\'tirozlarni qanday bartaraf etadi.'
                      : 'Речевые модули, отработка возражений, защита от оффтопа и регламент дожима на просмотр.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTabSubView('agent')}
                  className="btn-pill btn-solid text-xs py-1.5 px-3.5 cursor-pointer"
                >
                  📞 Qo'ng'iroqqa o'tish
                </button>
              </div>

              {/* 5 Playbook Chapters */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 1. First 10 Seconds */}
                <div className="p-4 rounded-xl bg-[#F4F1EA]/60 border border-[rgba(22,21,17,0.1)] space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-[rgba(14,124,134,0.1)] text-[#0E7C86] text-xs font-mono font-bold flex items-center justify-center">1</span>
                    <h4 className="text-sm font-bold text-[#161511]">Dastlabki 10 Soniya (Kirish & Ishonch)</h4>
                  </div>
                  <p className="text-xs text-[#5D594E] leading-relaxed">
                    AI hech qachon "Men sun'iy intellektman" deb vaqt yo'qotmaydi. Birinchi soniyadayoq samimiy o'zbekcha salom beradi: <i>"Alo, assalomu alaykum! Xush ko'rdik, eshitaman sizni?"</i> — va darhol mijozga gapirish imkonini beradi.
                  </p>
                </div>

                {/* 2. LPMAMA Qualification */}
                <div className="p-4 rounded-xl bg-[#F4F1EA]/60 border border-[rgba(22,21,17,0.1)] space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-[rgba(14,124,134,0.1)] text-[#0E7C86] text-xs font-mono font-bold flex items-center justify-center">2</span>
                    <h4 className="text-sm font-bold text-[#161511]">LPMAMA Kwalifikatsiya Zanjiri</h4>
                  </div>
                  <p className="text-xs text-[#5D594E] leading-relaxed">
                    Har bir replika oxirida tabiiy 1 ta savol beriladi: <b>L</b>ocation (tuman) → <b>P</b>rice (byudjet) → <b>M</b>otivation (yashashgami, investitsiyagami) → <b>A</b>gent → <b>M</b>ortgage (naqdmi, ipotekami) → <b>A</b>ppointment (ko'rish vaqti).
                  </p>
                </div>

                {/* 3. Objection Handling */}
                <div className="p-4 rounded-xl bg-[#F4F1EA]/60 border border-[rgba(22,21,17,0.1)] space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-[rgba(201,138,18,0.1)] text-[#C98A12] text-xs font-mono font-bold flex items-center justify-center">3</span>
                    <h4 className="text-sm font-bold text-[#161511]">E'tirozlarni Bartaraf Etish (Objections)</h4>
                  </div>
                  <p className="text-xs text-[#5D594E] leading-relaxed">
                    • <i>"Juda qimmat":</i> Alternativ tuman yoki 0% muddatli to'lovni taklif qiladi.<br />
                    • <i>"Narxlar tushishini kutyapman":</i> Inflyatsiya va ijara daromadini (10-12%) tushuntiradi.<br />
                    • <i>"O'zim rieltorsiz olaman":</i> Xaridor uchun komissiya 0% ekanini va kadastr xavfsizligini ta'kidlaydi.
                  </p>
                </div>

                {/* 4. Strict Guardrail & Anti-Hallucination */}
                <div className="p-4 rounded-xl bg-[#F4F1EA]/60 border border-[rgba(22,21,17,0.1)] space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-[rgba(196,85,45,0.1)] text-[#C4552D] text-xs font-mono font-bold flex items-center justify-center">4</span>
                    <h4 className="text-sm font-bold text-[#161511]">Cheklovlar & Halol Aniqlashtirish</h4>
                  </div>
                  <p className="text-xs text-[#5D594E] leading-relaxed">
                    • <b>Strict Domain:</b> Siyosat, pazandachilik yoki ob-havoga chalg'imaydi, 1 jumlada ko'chmas mulkka qaytaradi.<br />
                    • <b>Anti-Hallucination:</b> Agar g'o'ldirash yoki shovqin bo'lsa, o'zidan narx to'qimaydi, ochiq qayta so'raydi.
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTabSubView === 'agent' && (
            <div className="space-y-8">
              {/* Primary Visual Layer: Live Call Card (State 1: IDLE before call) */}
              <LiveCallCard
                callStatus={callStatus}
                callDuration={callDuration}
                agentSpeaking={agentSpeaking}
                userSpeaking={userSpeaking}
                currentSubtitle={currentSubtitle}
                transcriptLines={transcriptLines}
                callTopic={callTopic}
                reLeadCard={reLeadCard}
                onStartCall={handleStartCall}
                onEndCall={handleEndCall}
                onToggleMute={handleToggleMute}
                isMuted={isMuted}
                onResetCall={() => {
                  setCallStatus('idle');
                  setCallDuration(0);
                }}
                onGoToCRM={() => {
                  setCallStatus('idle');
                  setActiveTabSubView('summary');
                  if (!crmSummaryData && conversationHistoryRef.current.length >= 2) {
                    handleGenerateSummary();
                  }
                }}
                onGoToLead={() => {
                  setCallStatus('idle');
                  setActiveTabSubView('lead');
                }}
                isAuthenticated={isAuthenticated}
                lang={lang}
                agentVoiceName={agentVoiceId === shokhrukhVoiceId ? 'SHOHRUX' : 'MADINA'}
                onSendText={handleSendQuickPrompt}
                micWarning={micWarning}
              />

              {/* 3D Voice Gallery row for Agent Voice Picker */}
              <VoiceGallery3D
                voices={voices}
                selectedVoiceId={agentVoiceId}
                onSelectVoice={(id) => setAgentVoiceId(id)}
                lang={lang}
                title={lang === 'uz' ? '3D Agent Ovozlar Galereyasi' : '3D Галерея Голосов Агента'}
                subtitle={lang === 'uz' ? 'SHISHA SHARLARNI AYLANTRING VA AGENT OVOZINI TANLANG' : 'ВРАЩАЙТЕ СФЕРЫ ДЛЯ ВЫБОРА ГОЛОСА'}
              />

              {/* Persona & Voice Timbre Setup */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column: Persona & Setup (7 cols) */}
              <div className="lg:col-span-7 space-y-5">
                {/* Step 1: Select Persona */}
                <div className="bg-white border border-[rgba(22,21,17,0.14)] rounded-[22px] p-6 space-y-3.5 shadow-sm">
                  <label className="text-xs font-mono uppercase tracking-wider text-[#5D594E] font-bold flex items-center gap-2">
                    <Bot className="w-4 h-4 text-[#0E7C86]" />
                    <span>{lang === 'uz' ? '1. Suhbatdosh Personasi (Rol)' : '1. Персонаж и Роль Агента'}</span>
                  </label>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {(Object.keys(personaConfig) as AgentPersonaType[]).map((key) => {
                      const conf = personaConfig[key];
                      const isSel = selectedPersona === key;
                      const Icon = conf.icon;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => {
                            setSelectedPersona(key);
                            if (key === 'tashkent_real_estate') {
                              setCallTopic('Toshkentda novostroyka, ikkilamchi bozor, ijara va narxlar');
                            }
                          }}
                          className={`p-4 rounded-xl border text-left transition-all cursor-pointer relative ${
                            isSel
                              ? 'bg-[rgba(14,124,134,0.06)] border-[#0E7C86] shadow-2xs'
                              : 'bg-[#F4F1EA]/60 border-[rgba(22,21,17,0.1)] hover:border-[#161511]'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-bold text-[#161511] flex items-center gap-1.5">
                              <Icon className={`w-3.5 h-3.5 ${isSel ? 'text-[#0E7C86]' : 'text-[#5D594E]'}`} />
                              {conf.titleUz.split('(')[0]}
                            </span>
                            {isSel && <span className="w-2 h-2 rounded-full bg-[#0E7C86]" />}
                          </div>
                          <p className="text-[11px] text-[#5D594E] line-clamp-2 leading-relaxed">
                            {lang === 'uz' ? conf.descUz : conf.descRu}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Step 2: Topic & Context */}
                <div className="bg-white border border-[rgba(22,21,17,0.14)] rounded-[22px] p-6 space-y-3.5 shadow-sm">
                  <label className="text-xs font-mono uppercase tracking-wider text-[#5D594E] font-bold flex items-center gap-2">
                    <Radio className="w-4 h-4 text-[#0E7C86]" />
                    <span>{lang === 'uz' ? '2. Qo\'ng\'iroq Mavzusi yoki Savol' : '2. Тема Звонка или Вопрос'}</span>
                  </label>

                  <input
                    type="text"
                    value={callTopic}
                    onChange={(e) => setCallTopic(e.target.value)}
                    placeholder="Mavzuni kiriting..."
                    className="w-full bg-[#F4F1EA]/60 border border-[rgba(22,21,17,0.14)] rounded-xl px-4 py-2.5 text-xs sm:text-sm text-[#161511] focus:outline-none focus:border-[#0E7C86] transition-colors"
                  />

                  {/* Quick Topic Chips */}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {selectedPersona === 'tashkent_real_estate' ? (
                      [
                        'Chilonzordan arzonroq 2 xonali uy qidiryapman',
                        'Mirobodda novostroyka olish shartlari',
                        '$50,000 ga investitsiya varianti',
                        'Sergelida subsidiyali ipoteka',
                        'Kotlovandan olish va kadastr',
                      ].map((chip) => (
                        <button
                          key={chip}
                          type="button"
                          onClick={() => setCallTopic(chip)}
                          className="px-3 py-1 bg-white hover:bg-[#ECE7DB] border border-[rgba(22,21,17,0.14)] text-[11px] text-[#161511] rounded-full transition-all cursor-pointer font-medium"
                        >
                          + {chip}
                        </button>
                      ))
                    ) : (
                      [
                        'Sun\'iy intellekt kelajagi',
                        'O\'zbekiston IT startaplari',
                        'Podkastni monetizatsiya qilish',
                        'Amir Temur davri sirlari',
                      ].map((chip) => (
                        <button
                          key={chip}
                          type="button"
                          onClick={() => setCallTopic(chip)}
                          className="px-3 py-1 bg-white hover:bg-[#ECE7DB] border border-[rgba(22,21,17,0.14)] text-[11px] text-[#5D594E] hover:text-[#161511] rounded-full transition-all cursor-pointer font-medium"
                        >
                          + {chip}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Right Column: Voice Selection & Call Trigger (5 cols) */}
              <div className="lg:col-span-5 space-y-5">
                {/* Step 3: Agent Voice Selection */}
                <div className="bg-white border border-[rgba(22,21,17,0.14)] rounded-[22px] p-6 space-y-3.5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-mono uppercase tracking-wider text-[#5D594E] font-bold flex items-center gap-2">
                      <Volume2 className="w-4 h-4 text-[#0E7C86]" />
                      <span>{lang === 'uz' ? '3. Ovoz Tembrini Tanlang' : '3. Тембр Голоса'}</span>
                    </label>
                    <span className="text-[10px] text-[#0E7C86] font-mono font-bold bg-[rgba(14,124,134,0.1)] px-2.5 py-0.5 rounded-full border border-[#0E7C86]/30">
                      Tavsiya: Shohrux
                    </span>
                  </div>

                  <div className="space-y-2">
                    {[
                      {
                        id: shokhrukhVoiceId,
                        name: 'SHOKHRUKH (Mening Haqiqiy Ovozim)',
                        tag: '⭐ SHAXSIY REPLIKATSIYA (0% AKSENT)',
                        desc: 'OvozStudio neyron replikatsiyasi — 100% tabiiy o\'zbekcha talaffuz!',
                      },
                      { id: 'Aoede', name: 'Madina (Tavsiya)', tag: '🔥 Samimiy & xarizmatik ayol ovozi', desc: 'Juda jonli, iliq, xarizmatik broker' },
                      { id: 'Charon', name: 'Jasur', tag: '🎩 Katta rieltor-broker', desc: 'Vazmin, nufuzli, chuqur bariton' },
                      { id: 'Puck', name: 'Otabek', tag: '⚡ Dinamik & yosh broker', desc: 'Faol, tezkor, optimistik' },
                      { id: 'Kore', name: 'Aziza', tag: '🌸 Muloyim maslahatchi', desc: 'Iliq, ishonchli ayol ovozi' },
                      { id: 'Fenrir', name: 'Ulug\'bek', tag: '💪 Tajribali ekspert', desc: 'Kuchli, qat\'iy, aniq' },
                    ].map((v) => {
                      const isVoicePlaying = previewingVoiceId === v.id;
                      return (
                        <div
                          key={v.id}
                          onClick={() => setAgentVoiceId(v.id)}
                          className={`w-full p-3 rounded-xl border flex items-center justify-between gap-2 transition-all cursor-pointer ${
                            agentVoiceId === v.id
                              ? 'bg-[rgba(14,124,134,0.08)] border-[#0E7C86] text-[#161511] shadow-2xs'
                              : 'bg-[#F4F1EA]/50 border-[rgba(22,21,17,0.1)] text-[#5D594E] hover:border-[#161511]'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-1">
                              <p className="text-xs font-bold text-[#161511] truncate">{v.name}</p>
                              <span className="text-[10px] font-mono text-[#0E7C86] font-semibold shrink-0">{v.tag}</span>
                            </div>
                            <p className="text-[10px] text-[#5D594E] mt-0.5 truncate">{v.desc}</p>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleVoicePreview(v.id);
                            }}
                            className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center transition-all cursor-pointer ${
                              isVoicePlaying
                                ? 'bg-[#0E7C86] text-white shadow-sm'
                                : 'bg-white border border-[rgba(22,21,17,0.14)] text-[#161511] hover:bg-[#ECE7DB]'
                            }`}
                            title={
                              isVoicePlaying
                                ? (lang === 'uz' ? "To'xtatish" : 'Остановить')
                                : (lang === 'uz' ? "Ovoz namunasini tinglash (0s kutish, tekin)" : 'Прослушать голос (встроено)')
                            }
                          >
                            {isVoicePlaying ? (
                              <Square className="w-3 h-3 fill-current" />
                            ) : (
                              <Play className="w-3 h-3 fill-current translate-x-0.5" />
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Big Call Action Card */}
                <div className="bg-white border border-[rgba(22,21,17,0.14)] rounded-[22px] p-6 text-center space-y-4 shadow-sm">
                  <div className="w-14 h-14 rounded-full bg-[rgba(14,124,134,0.1)] border border-[#0E7C86]/30 flex items-center justify-center text-[#0E7C86] mx-auto shadow-2xs">
                    <PhoneCall className="w-7 h-7" />
                  </div>

                  <div>
                    <h4 className="font-serif text-lg font-normal text-[#161511]">
                      {lang === 'uz' ? <>Shohrux bilan <em className="italic text-[#0E7C86]">Jonli Muloqot</em></> : <>Живой Разговор с <em className="italic text-[#0E7C86]">Шохрухом</em></>}
                    </h4>
                    <p className="text-xs text-[#5D594E] mt-1 max-w-xs mx-auto leading-relaxed">
                      {lang === 'uz'
                        ? 'Tugmani bosing. Go\'shak ko\'tarilgach, Shohrux salom berib sizni tinglaydi. Erkin savol bering!'
                        : 'Нажмите кнопку. Когда Шохрух поднимет трубку и поздоровается, говорите свободно в микрофон!'}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleStartCall}
                    className="w-full btn-pill btn-solid py-3.5 text-xs sm:text-sm font-semibold flex items-center justify-center gap-2.5"
                  >
                    {!isAuthenticated ? (
                      <>
                        <Lock className="w-4 h-4 text-[#5CC8CF]" />
                        <span>{lang === 'uz' ? '🔒 Ro\'yxatdan O\'tish & Qo\'ng\'iroq' : '🔒 Войти & Начать Звонок'}</span>
                      </>
                    ) : (
                      <>
                        <PhoneCall className="w-4 h-4 fill-current text-[#5CC8CF]" />
                        <span>{lang === 'uz' ? '📞 Qo\'ng\'iroqni Boshlash (Jonli)' : '📞 Начать Звонок (Живой)'}</span>
                      </>
                    )}
                  </button>

                  <div className="flex items-center justify-center gap-1.5 text-[11px] text-[#5D594E]">
                    <ShieldCheck className="w-3.5 h-3.5 text-[#0E7C86]" />
                    <span>
                      {callEngine === 'shokhrukh_natural'
                        ? (lang === 'uz' ? 'Shohrux haqiqiy ovozi • 0% aksent' : 'Настоящий голос Шохруха • 0% акцента')
                        : 'OvozStudio Real-time API'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        </>
      )}
    </div>
  );
};
