import React, { useState, useRef, useEffect, useCallback } from 'react';
import { VoiceProfile, AgentPersonaType, RealEstateLeadCard } from '../types/podcast';
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
} from 'lucide-react';

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
  userClonedVoiceId,
  lang,
}) => {
  const shokhrukhVoiceId = userClonedVoiceId || 'voice_17raj9ewke3g';

  // Engine: 'shokhrukh_natural' (Recommended, 0% accent, authentic Shahrukh voice) vs 'gemini_live'
  const [callEngine, setCallEngine] = useState<'shokhrukh_natural' | 'gemini_live'>('shokhrukh_natural');

  // Call Configuration (Defaults to Real Estate Broker with Shahrukh's voice)
  const [selectedPersona, setSelectedPersona] = useState<AgentPersonaType>('tashkent_real_estate');
  const [callTopic, setCallTopic] = useState<string>('Toshkentda novostroyka, ikkilamchi bozor, ijara va narxlar');
  const [agentVoiceId, setAgentVoiceId] = useState<string>(shokhrukhVoiceId);

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
    keyNotes: '',
  });
  const [copiedLead, setCopiedLead] = useState<boolean>(false);
  const [activeTabSubView, setActiveTabSubView] = useState<'agent' | 'prices' | 'lead'>('agent');

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

  // Play realistic telephone ringtone
  const playRingtone = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
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
          ctx.close();
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

  // Play incoming 24kHz live audio chunk from Gemini 3.8 Live API
  const playLiveAudioChunk = useCallback((base64Pcm: string) => {
    try {
      if (!outputAudioCtxRef.current) {
        outputAudioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
          sampleRate: 24000,
        });
      }
      const ctx = outputAudioCtxRef.current;
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
      const res = await fetch('/api/agent/call-turn', {
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
      const replyText = data.replyText || '';
      setCurrentSubtitle(replyText);

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
    if (inputAudioCtxRef.current) {
      inputAudioCtxRef.current.close().catch(() => {});
      inputAudioCtxRef.current = null;
    }
    if (outputAudioCtxRef.current) {
      outputAudioCtxRef.current.close().catch(() => {});
      outputAudioCtxRef.current = null;
    }
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
        const res = await fetch('/api/agent/start-call', {
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
      // MODE 2: RAW GEMINI 3.8 LIVE WEBSOCKET STREAMING
      // ----------------------------------------------------
      if (stream) {
        const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
          sampleRate: 16000,
        });
        inputAudioCtxRef.current = inputCtx;
        const source = inputCtx.createMediaStreamSource(stream);
        const processor = inputCtx.createScriptProcessor(4096, 1, 1);
        micProcessorRef.current = processor;
        source.connect(processor);
        processor.connect(inputCtx.destination);

        processor.onaudioprocess = (e) => {
          if (isMuted || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
          const inputBuffer = e.inputBuffer.getChannelData(0);
          const pcm16Base64 = float32ToPcm16Base64(inputBuffer);
          wsRef.current.send(JSON.stringify({ type: 'audio', audio: pcm16Base64 }));
        };
      }

      // Initialize 24kHz AudioContext for model output playback
      outputAudioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 24000,
      });

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/live-call`;
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

  // End Call
  const handleEndCall = () => {
    cleanupCall();
    setCallStatus('ended');
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
    content += `Dvigatel: ${callEngine === 'shokhrukh_natural' ? 'Shohrux Haqiqiy Ovoz (Ultra-Natural TTS Live)' : 'Gemini 3.8 Live API'}\n`;
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
      <div className="bg-gradient-to-r from-emerald-950/70 via-zinc-900 to-purple-950/70 border border-emerald-500/30 rounded-2xl p-5 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-full bg-emerald-500/5 blur-3xl pointer-events-none" />
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-bold border border-emerald-500/30 flex items-center gap-1">
                <Zap className="w-3 h-3" />
                {callEngine === 'shokhrukh_natural' ? 'SHOHRUX HAQIQIY OVOZ LIVE (0% AKSENT)' : 'GEMINI 3.8 LIVE API (SPEECH-TO-SPEECH)'}
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
              {lang === 'uz' ? "Toshkent Ko'chmas Mulki & Podkast Ovozli Agenti" : 'Голосовой AI-Агент Недвижимости Ташкента'}
            </h2>
            <p className="text-xs sm:text-sm text-zinc-300 mt-1 max-w-2xl leading-relaxed">
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
            <div className="flex items-center gap-2.5 bg-black/70 border border-emerald-500/60 px-4 py-2.5 rounded-2xl shadow-lg">
              <span className="w-3 h-3 rounded-full bg-emerald-400 animate-ping" />
              <div className="text-left">
                <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider">
                  {lang === 'uz' ? 'Aloqa faol' : 'На линии'}
                </p>
                <p className="text-lg font-mono font-black text-white">{formatTime(callDuration)}</p>
              </div>
            </div>
          )}
        </div>

        {/* Engine Switcher & Sub-navigation tabs */}
        {callStatus === 'idle' && (
          <div className="mt-4 pt-4 border-t border-zinc-800/80 flex flex-wrap items-center justify-between gap-3">
            {/* Engine Toggle */}
            <div className="flex items-center gap-1.5 bg-black/50 p-1 rounded-xl border border-zinc-800">
              <button
                type="button"
                onClick={() => {
                  setCallEngine('shokhrukh_natural');
                  setAgentVoiceId(shokhrukhVoiceId);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  callEngine === 'shokhrukh_natural'
                    ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <span>⭐ Shohrux Haqiqiy Ovoz (0% Aksent)</span>
              </button>
              <button
                type="button"
                onClick={() => setCallEngine('gemini_live')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  callEngine === 'gemini_live'
                    ? 'bg-purple-600 text-white shadow-md'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <span>⚡ Gemini 3.8 Live API</span>
              </button>
            </div>

            {/* Navigation Tabs */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveTabSubView('agent')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTabSubView === 'agent'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                    : 'bg-zinc-900/80 text-zinc-400 hover:text-white border border-zinc-800'
                }`}
              >
                <PhoneCall className="w-3.5 h-3.5" />
                <span>{lang === 'uz' ? 'Qo\'ng\'iroq' : 'Звонок'}</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTabSubView('prices')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTabSubView === 'prices'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                    : 'bg-zinc-900/80 text-zinc-400 hover:text-white border border-zinc-800'
                }`}
              >
                <TrendingUp className="w-3.5 h-3.5" />
                <span>{lang === 'uz' ? 'Toshkent Narxlari' : 'Цены Ташкента'}</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTabSubView('lead')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTabSubView === 'lead'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                    : 'bg-zinc-900/80 text-zinc-400 hover:text-white border border-zinc-800'
                }`}
              >
                <Key className="w-3.5 h-3.5" />
                <span>{lang === 'uz' ? 'Lead-Kartasi' : 'Карточка Лида'}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* STATE 1: ACTIVE CALL OR CALLING SCREEN (FULL CALL INTERFACE) */}
      {(callStatus === 'calling' || callStatus === 'connected') && (
        <div className="bg-zinc-950 border border-emerald-500/40 rounded-3xl p-6 sm:p-10 shadow-2xl relative overflow-hidden flex flex-col items-center text-center space-y-6">
          {/* Background Ambient Glow */}
          <div
            className={`absolute inset-0 bg-radial transition-all duration-700 pointer-events-none ${
              agentSpeaking
                ? 'from-purple-900/30 via-transparent to-transparent'
                : userSpeaking
                ? 'from-emerald-900/30 via-transparent to-transparent'
                : 'from-zinc-900/20 via-transparent to-transparent'
            }`}
          />

          {/* Top Status */}
          <div className="flex items-center gap-2 relative z-10">
            <span
              className={`w-3 h-3 rounded-full ${
                callStatus === 'calling' ? 'bg-amber-400 animate-ping' : 'bg-emerald-400 animate-pulse'
              }`}
            />
            <span className="text-xs sm:text-sm font-bold text-zinc-300 font-mono tracking-wider">
              {callStatus === 'calling'
                ? lang === 'uz'
                  ? 'QO\'NG\'IROQ QILINMOQDA (GO\'SHAK KO\'TARILMOQDA)...'
                  : 'ВЫЗОВ (ПОДНЯТИЕ ТРУБКИ)...'
                : `● JONLI ALOQA • ${formatTime(callDuration)}`}
            </span>
          </div>

          {/* Central Pulsating Voice Orb / Avatar */}
          <div className="relative z-10 my-4 flex items-center justify-center">
            <div
              className={`absolute rounded-full transition-all duration-200 pointer-events-none ${
                agentSpeaking
                  ? 'w-48 h-48 sm:w-64 sm:h-64 bg-purple-500/20 border border-purple-500/40 animate-ping'
                  : userSpeaking
                  ? 'w-48 h-48 sm:w-64 sm:h-64 bg-emerald-500/20 border border-emerald-500/40 animate-ping'
                  : 'w-36 h-36 bg-zinc-800/30'
              }`}
            />
            <div
              className={`absolute rounded-full transition-transform duration-150 pointer-events-none ${
                agentSpeaking
                  ? 'w-40 h-40 sm:w-52 sm:h-52 bg-gradient-to-r from-purple-600/30 to-indigo-600/30 border border-purple-400/50 scale-110 shadow-[0_0_50px_rgba(168,85,247,0.4)]'
                  : userSpeaking
                  ? 'w-40 h-40 sm:w-52 sm:h-52 bg-gradient-to-r from-emerald-600/30 to-teal-600/30 border border-emerald-400/50 scale-110 shadow-[0_0_50px_rgba(16,185,129,0.4)]'
                  : 'w-32 h-32 bg-zinc-900 border border-zinc-800'
              }`}
              style={{
                transform: `scale(${1 + audioLevel * 0.4})`,
              }}
            />

            {/* Central Circle */}
            <div className="w-28 h-28 sm:w-36 sm:h-36 rounded-full bg-gradient-to-tr from-zinc-900 via-zinc-800 to-zinc-950 border-2 border-emerald-500/60 flex flex-col items-center justify-center shadow-2xl relative z-10">
              {selectedPersona === 'tashkent_real_estate' ? (
                <Building2 className={`w-10 h-10 sm:w-12 sm:h-12 transition-colors ${
                  agentSpeaking ? 'text-purple-400 animate-bounce' : userSpeaking ? 'text-emerald-400' : 'text-zinc-300'
                }`} />
              ) : (
                <Bot
                  className={`w-10 h-10 sm:w-12 sm:h-12 transition-colors ${
                    agentSpeaking ? 'text-purple-400 animate-bounce' : userSpeaking ? 'text-emerald-400' : 'text-zinc-400'
                  }`}
                />
              )}
              <span className="text-[10px] font-bold text-zinc-300 mt-1 uppercase tracking-wider font-mono">
                {agentVoiceId === shokhrukhVoiceId ? 'SHOHRUX' : agentVoiceId}
              </span>
            </div>
          </div>

          {/* Caller Details & Current Live Status */}
          <div className="space-y-2 relative z-10 max-w-lg">
            <h3 className="text-lg sm:text-xl font-black text-white">
              {personaConfig[selectedPersona].titleUz}
            </h3>
            <p className="text-xs text-zinc-400 line-clamp-2">
              <span className="text-zinc-500">{lang === 'uz' ? 'Mavzu:' : 'Тема:'}</span> "{callTopic}"
            </p>

            <div className="pt-2">
              <span
                className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${
                  agentSpeaking
                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                    : userSpeaking
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : isLoadingTurn
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse'
                    : 'bg-zinc-900 text-zinc-400 border border-zinc-800'
                }`}
              >
                {agentSpeaking ? (
                  <>
                    <Volume2 className="w-3.5 h-3.5 animate-pulse" />
                    <span>{lang === 'uz' ? 'Shohrux gapirmoqda...' : 'Шохрух говорит...'}</span>
                  </>
                ) : userSpeaking ? (
                  <>
                    <Mic className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                    <span>{lang === 'uz' ? 'Siz gapiryapsiz...' : 'Вы говорите...'}</span>
                  </>
                ) : isLoadingTurn ? (
                  <>
                    <Zap className="w-3.5 h-3.5 text-amber-400 animate-bounce" />
                    <span>{lang === 'uz' ? 'O\'ylamoqda...' : 'Думает...'}</span>
                  </>
                ) : (
                  <>
                    <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                    <span>{lang === 'uz' ? '🎙️ Sizni tinglayapman — bemalol gapiring!' : '🎙️ Слушаю вас — говорите свободно!'}</span>
                  </>
                )}
              </span>
            </div>
          </div>

          {/* Quick Voice Prompt Suggestions during the call */}
          {selectedPersona === 'tashkent_real_estate' && (
            <div className="w-full max-w-xl relative z-10 pt-1">
              <p className="text-[11px] text-zinc-400 mb-1.5 font-medium">
                {lang === 'uz' ? 'Tezkor savol berish (bosing yoki mikrofonga ayting):' : 'Быстрый вопрос (нажмите или скажите вслух):'}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                {[
                  'Chilonzorda arzonroq 2 xonali uy bormi?',
                  'Mirobodda 1 m² narxi qancha?',
                  'Investitsiyaga qaysi tuman eng foydali?',
                  'Kotlovandan olish xavfsizmi, kadastr bormi?',
                  'Sergelida yangi uylar qanchadan?',
                ].map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => handleSendQuickPrompt(q)}
                    className="px-2.5 py-1 bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-700/80 text-[11px] text-zinc-300 hover:text-white rounded-lg transition-colors cursor-pointer"
                  >
                    💬 {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Live Subtitles Strip */}
          <div className="w-full max-w-xl bg-zinc-900/80 backdrop-blur-md border border-zinc-800 rounded-2xl p-4 text-center min-h-[64px] flex items-center justify-center relative z-10">
            <p className="text-xs sm:text-sm text-zinc-200 italic font-medium leading-relaxed">
              {currentSubtitle ? (
                `"${currentSubtitle}"`
              ) : (
                <span className="text-zinc-500 text-xs not-italic">
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
                  ? 'bg-amber-500/20 border-2 border-amber-500 text-amber-300'
                  : 'bg-zinc-800/80 hover:bg-zinc-700 border border-zinc-700 text-zinc-200'
              }`}
              title={isMuted ? 'Mikrofonni yoqish' : 'Mikrofonni o\'chirish'}
            >
              {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
              <span className="text-[9px] font-bold mt-0.5">{isMuted ? 'Muted' : 'Mic'}</span>
            </button>

            {/* End Call Button (Big Red) */}
            <button
              type="button"
              onClick={handleEndCall}
              className="w-18 h-18 rounded-full bg-gradient-to-tr from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white flex flex-col items-center justify-center shadow-xl shadow-red-600/40 hover:scale-105 active:scale-95 transition-all cursor-pointer border-2 border-red-400"
              title="Qo'ng'iroqni tugatish"
            >
              <PhoneOff className="w-8 h-8" />
              <span className="text-[10px] font-black uppercase tracking-wider mt-0.5">
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
                  ? 'bg-purple-600 hover:bg-purple-500 text-white shadow-purple-600/30 animate-pulse'
                  : 'bg-zinc-800/50 border border-zinc-800 text-zinc-500 cursor-not-allowed'
              }`}
              title="Agent gapini to'xtatish"
            >
              <Zap className="w-6 h-6" />
              <span className="text-[9px] font-bold mt-0.5">{lang === 'uz' ? 'To\'xtatish' : 'Перебить'}</span>
            </button>
          </div>

          {/* Quick Text Input Fallback (Optional) */}
          <div className="w-full max-w-md pt-2 relative z-10">
            <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-1.5">
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
                className="flex-1 bg-transparent text-xs text-white focus:outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  handleSendQuickPrompt(textInput);
                  setTextInput('');
                }}
                disabled={!textInput.trim()}
                className="p-1.5 text-emerald-400 hover:text-emerald-300 disabled:text-zinc-600 cursor-pointer"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STATE 2: CALL ENDED SUMMARY SCREEN */}
      {callStatus === 'ended' && (
        <div className="bg-zinc-950 border border-zinc-800 rounded-3xl p-6 sm:p-8 shadow-xl text-center space-y-5">
          <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mx-auto">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-white">
              {lang === 'uz' ? 'Qo\'ng\'iroq yakunlandi' : 'Звонок завершен'}
            </h3>
            <p className="text-xs text-zinc-400 mt-1">
              {lang === 'uz'
                ? `Davomiyligi: ${formatTime(callDuration)} • Mavzu: "${callTopic}"`
                : `Длительность: ${formatTime(callDuration)} • Тема: "${callTopic}"`}
            </p>
          </div>

          {/* Transcripts List */}
          {transcriptLines.length > 0 && (
            <div className="max-h-64 overflow-y-auto text-left space-y-2 bg-zinc-900/60 p-4 rounded-2xl border border-zinc-800/80">
              {transcriptLines.map((line) => (
                <div key={line.id} className="text-xs">
                  <span className="font-semibold text-zinc-400 mr-1.5">
                    [{line.timestamp}] {line.sender === 'user' ? 'Siz:' : 'Shohrux:'}
                  </span>
                  <span className={line.sender === 'user' ? 'text-zinc-200' : 'text-emerald-300'}>
                    {line.text}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={handleStartCall}
              className="px-6 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-emerald-600/30 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>{lang === 'uz' ? 'Qaytadan Qo\'ng\'iroq Qilish' : 'Позвонить снова'}</span>
            </button>

            {transcriptLines.length > 0 && (
              <button
                type="button"
                onClick={downloadTranscript}
                className="px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 rounded-xl text-xs font-semibold flex items-center gap-2 cursor-pointer"
              >
                <Download className="w-4 h-4 text-emerald-400" />
                <span>{lang === 'uz' ? 'Transkriptni Yuklab Olish' : 'Скачать транскрипт'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setCallStatus('idle')}
              className="px-4 py-2.5 text-zinc-400 hover:text-white text-xs font-medium cursor-pointer"
            >
              {lang === 'uz' ? 'Sozlamalarga qaytish' : 'К настройкам'}
            </button>
          </div>
        </div>
      )}

      {/* STATE 3: PRE-CALL CONFIGURATION & DIAL SCREEN (IDLE) */}
      {callStatus === 'idle' && (
        <>
          {activeTabSubView === 'prices' && (
            <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-emerald-400" />
                    <span>{lang === 'uz' ? 'Toshkent Ko\'chmas Mulki Narxlar Radari (2025-2026)' : 'Радар Цен на Недвижимость Ташкента'}</span>
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    {lang === 'uz'
                      ? 'AI Rieltor ushbu narxlar va bozor realligidan kelib chiqib aniq maslahat beradi.'
                      : 'AI Риелтор опирается на актуальные рыночные цены за м² и ставки аренды.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTabSubView('agent')}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold cursor-pointer"
                >
                  📞 Qo'ng'iroqqa o'tish
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {tashkentDistricts.map((d) => (
                  <div key={d.name} className="p-4 rounded-xl bg-zinc-900/70 border border-zinc-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sm text-white">{d.name}</span>
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[11px] font-mono font-bold border border-emerald-500/30">
                        {d.price}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400">{d.desc}</p>
                    <div className="text-[10px] text-purple-300 font-medium">
                      🔑 Ijara daromadi: <span className="text-white font-mono font-bold">{d.rent}/oy</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTabSubView === 'lead' && (
            <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-6 space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Key className="w-5 h-5 text-amber-400" />
                    <span>{lang === 'uz' ? 'Rieltor Lead-Kartasi (Buyurtma Shakli)' : 'Карточка Заявки Клиента (Lead)'}</span>
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    {lang === 'uz'
                      ? 'AI bilan gaplashgach yoki oldindan parametrlarni belgilab, Telegramga yuborish uchun nusxa oling.'
                      : 'Заполните параметры для риелтора или скопируйте сформированную заявку в Telegram.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCopyLead}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  {copiedLead ? <Check className="w-4 h-4 text-white" /> : <Copy className="w-4 h-4" />}
                  <span>{copiedLead ? 'Nusxalandi!' : 'Telegramga Nusxalash'}</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="text-[11px] font-semibold text-zinc-400 block mb-1">Maqsad:</label>
                  <select
                    value={reLeadCard.clientIntent}
                    onChange={(e) => setReLeadCard({ ...reLeadCard, clientIntent: e.target.value as any })}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white"
                  >
                    <option value="buy">Sotib olish (Kuplya)</option>
                    <option value="rent">Ijara (Arenda)</option>
                    <option value="invest">Investitsiya (Flipping/ROI)</option>
                    <option value="sell">Sotish (Prodaja)</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-zinc-400 block mb-1">Tuman:</label>
                  <select
                    value={reLeadCard.district}
                    onChange={(e) => setReLeadCard({ ...reLeadCard, district: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white"
                  >
                    {tashkentDistricts.map((d) => (
                      <option key={d.name} value={d.name}>{d.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-zinc-400 block mb-1">Byudjet:</label>
                  <input
                    type="text"
                    value={reLeadCard.budgetRange}
                    onChange={(e) => setReLeadCard({ ...reLeadCard, budgetRange: e.target.value })}
                    placeholder="$40,000 - $70,000"
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white"
                  />
                </div>
              </div>

              <div className="p-4 bg-zinc-900/60 rounded-xl border border-zinc-800 font-mono text-xs text-zinc-300 space-y-1">
                <p className="text-emerald-400 font-bold">📋 Tayyor Telegram / CRM matni:</p>
                <p>• Maqsad: {reLeadCard.clientIntent.toUpperCase()}</p>
                <p>• Tuman: {reLeadCard.district}</p>
                <p>• Byudjet: {reLeadCard.budgetRange}</p>
                <p>• Xonalar: {reLeadCard.roomsCount} • Turi: {reLeadCard.propertyType}</p>
              </div>
            </div>
          )}

          {activeTabSubView === 'agent' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column: Persona & Setup (7 cols) */}
              <div className="lg:col-span-7 space-y-5">
                {/* Step 1: Select Persona */}
                <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-5 space-y-3">
                  <label className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                    <Bot className="w-4 h-4 text-emerald-400" />
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
                          className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer relative ${
                            isSel
                              ? 'bg-emerald-950/40 border-emerald-500 shadow-md shadow-emerald-500/10'
                              : 'bg-zinc-900/60 border-zinc-800 hover:border-zinc-700'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-bold text-white flex items-center gap-1.5">
                              <Icon className={`w-3.5 h-3.5 ${isSel ? 'text-emerald-400' : 'text-zinc-400'}`} />
                              {conf.titleUz.split('(')[0]}
                            </span>
                            {isSel && <span className="w-2 h-2 rounded-full bg-emerald-400" />}
                          </div>
                          <p className="text-[11px] text-zinc-400 line-clamp-2 leading-relaxed">
                            {lang === 'uz' ? conf.descUz : conf.descRu}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Step 2: Topic & Context */}
                <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-5 space-y-3">
                  <label className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                    <Radio className="w-4 h-4 text-purple-400" />
                    <span>{lang === 'uz' ? '2. Qo\'ng\'iroq Mavzusi yoki Savol' : '2. Тема Звонка или Вопрос'}</span>
                  </label>

                  <input
                    type="text"
                    value={callTopic}
                    onChange={(e) => setCallTopic(e.target.value)}
                    placeholder="Mavzuni kiriting..."
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors"
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
                          className="px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[11px] text-emerald-400 hover:text-emerald-300 rounded-lg transition-colors cursor-pointer"
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
                          className="px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[11px] text-zinc-400 hover:text-zinc-200 rounded-lg transition-colors cursor-pointer"
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
                <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                      <Volume2 className="w-4 h-4 text-cyan-400" />
                      <span>{lang === 'uz' ? '3. Ovoz Tembrini Tanlang' : '3. Тембр Голоса'}</span>
                    </label>
                    <span className="text-[10px] text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/30">
                      Tavsiya: Shohrux
                    </span>
                  </div>

                  <div className="space-y-2">
                    {[
                      {
                        id: shokhrukhVoiceId,
                        name: 'SHOKHRUKH (Mening Haqiqiy Ovozim)',
                        tag: '⭐ SHAXSIY REPLIKATSIYA (0% AKSENT)',
                        desc: 'Google AI Studio orqali yaratilgan haqiqiy shaxsiy ovoz — 100% tabiiy o\'zbekcha talaffuz!',
                      },
                      { id: 'Aoede', name: 'Aoede (Tavsiya)', tag: '🔥 Samimiy & xarizmatik ayol ovozi', desc: 'Juda jonli, iliq, xarizmatik broker' },
                      { id: 'Charon', name: 'Charon', tag: '🎩 Katta rieltor-broker', desc: 'Vazmin, nufuzli, chuqur bariton' },
                      { id: 'Puck', name: 'Puck', tag: '⚡ Dinamik & yosh broker', desc: 'Faol, tezkor, optimistik' },
                      { id: 'Kore', name: 'Kore', tag: '🌸 Muloyim maslahatchi', desc: 'Iliq, ishonchli ayol ovozi' },
                      { id: 'Fenrir', name: 'Fenrir', tag: '💪 Tajribali ekspert', desc: 'Kuchli, qat\'iy, aniq' },
                    ].map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setAgentVoiceId(v.id)}
                        className={`w-full p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                          agentVoiceId === v.id
                            ? 'bg-emerald-950/50 border-emerald-500 text-emerald-200 shadow-md shadow-emerald-500/10'
                            : 'bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-bold text-white">{v.name}</p>
                          <span className="text-[10px] text-emerald-400 font-semibold">{v.tag}</span>
                        </div>
                        <p className="text-[10px] text-zinc-400 mt-0.5">{v.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Glowing Big Call Action Card */}
                <div className="bg-gradient-to-br from-emerald-950/60 to-zinc-950 border-2 border-emerald-500/40 rounded-2xl p-6 text-center space-y-4 shadow-xl shadow-emerald-950/30">
                  <div className="w-14 h-14 rounded-full bg-emerald-500/20 border border-emerald-400/50 flex items-center justify-center text-emerald-400 mx-auto shadow-[0_0_25px_rgba(16,185,129,0.3)]">
                    <PhoneCall className="w-7 h-7 animate-pulse" />
                  </div>

                  <div>
                    <h4 className="text-base font-bold text-white">
                      {lang === 'uz' ? 'Shohrux bilan Jonli Muloqot' : 'Живой Разговор с Шохрухом'}
                    </h4>
                    <p className="text-xs text-zinc-400 mt-1 max-w-xs mx-auto leading-relaxed">
                      {lang === 'uz'
                        ? 'Tugmani bosing. Go\'shak ko\'tarilgach, Shohrux salom berib sizni tinglaydi. Erkin savol bering!'
                        : 'Нажмите кнопку. Когда Шохрух поднимет трубку и поздоровается, говорите свободно в микрофон!'}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleStartCall}
                    className="w-full py-4 bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600 hover:from-emerald-400 hover:to-teal-500 text-white rounded-xl text-sm font-black flex items-center justify-center gap-2.5 shadow-xl shadow-emerald-500/40 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer tracking-wide uppercase"
                  >
                    <PhoneCall className="w-5 h-5 fill-current" />
                    <span>{lang === 'uz' ? '📞 Qo\'ng\'iroqni Boshlash (Jonli)' : '📞 Начать Звонок (Живой)'}</span>
                  </button>

                  <div className="flex items-center justify-center gap-1.5 text-[11px] text-zinc-400">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    <span>
                      {callEngine === 'shokhrukh_natural'
                        ? (lang === 'uz' ? 'Shohrux haqiqiy ovozi • 0% aksent' : 'Настоящий голос Шохруха • 0% акцента')
                        : 'Gemini 3.8 Live API'}
                    </span>
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
