import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Phone, PhoneOff, MapPin, Clock, Mic, Car, Flag, RotateCcw } from 'lucide-react';

/**
 * Super Taksi — browser demo of the AI taxi operator (Gemini Live only).
 * Server side: server/agents/superTaxi.ts, WebSocket /api/super-taxi-call.
 */

const VOICES: { id: string; labelUz: string; labelRu: string }[] = [
  { id: 'Kore', labelUz: 'Kore · ayol, aniq', labelRu: 'Kore · женский, чёткий' },
  { id: 'Sulafat', labelUz: 'Sulafat · ayol, iliq', labelRu: 'Sulafat · женский, тёплый' },
  { id: 'Achernar', labelUz: 'Achernar · ayol, yumshoq', labelRu: 'Achernar · женский, мягкий' },
  { id: 'Charon', labelUz: 'Charon · erkak, vazmin', labelRu: 'Charon · мужской, спокойный' },
];

const TARGET_SEC = 20;
const HARD_LIMIT_SEC = 30;

type CallStatus = 'idle' | 'connecting' | 'greeting' | 'live' | 'ending' | 'ended';

interface TranscriptLine {
  role: 'caller' | 'operator';
  text: string;
}

interface TaxiOrder {
  id: string;
  pickup: string;
  landmark?: string;
  destination?: string;
  createdAt: string;
}

interface CallResult {
  reason: string;
  order: TaxiOrder | null;
  durationSec: number;
  usage?: { promptTokens: number; responseTokens: number; totalTokens: number };
}

interface SuperTaxiDemoProps {
  lang: 'uz' | 'ru';
}

// AudioWorklet that forwards mono Float32 frames to the main thread.
const CAPTURE_WORKLET = `
class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('super-taxi-capture', CaptureProcessor);
`;

function float32ToPcm16Base64(input: Float32Array): string {
  const pcm = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(pcm.buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  }
  return btoa(binary);
}

function pcm16Base64ToFloat32(b64: string): Float32Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const int16 = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
  const out = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) out[i] = int16[i] / 32768;
  return out;
}

const REASON_TEXT: Record<string, { uz: string; ru: string }> = {
  order_created: { uz: 'Buyurtma qabul qilindi', ru: 'Заказ принят' },
  unclear: { uz: 'Manzil tushunarsiz, operator qayta qo‘ng‘iroq qiladi', ru: 'Адрес не понят, перезвонит оператор' },
  not_taxi: { uz: 'Taksiga aloqasi yo‘q qo‘ng‘iroq', ru: 'Звонок не по такси' },
  customer_cancelled: { uz: 'Mijoz voz kechdi', ru: 'Клиент отказался' },
  no_speech: { uz: 'Mijoz gapirmadi', ru: 'Клиент молчал' },
  timeout: { uz: '30 soniya limiti tugadi', ru: 'Истёк лимит 30 секунд' },
  caller_hangup: { uz: 'Siz go‘shakni qo‘ydingiz', ru: 'Вы положили трубку' },
  error: { uz: 'Ulanishda xatolik', ru: 'Ошибка соединения' },
};

const ERROR_TEXT: Record<string, { uz: string; ru: string }> = {
  hourly_limit: { uz: 'Bir soatlik demo limiti tugadi. Keyinroq urinib ko‘ring.', ru: 'Исчерпан часовой лимит демо. Попробуйте позже.' },
  concurrent_limit: { uz: 'Bir vaqtda faqat 2 ta qo‘ng‘iroq mumkin.', ru: 'Одновременно не больше 2 звонков.' },
  busy: { uz: 'Demo hozir band. Birozdan keyin urinib ko‘ring.', ru: 'Демо сейчас занято. Попробуйте чуть позже.' },
  mic: { uz: 'Mikrofonga ruxsat bering.', ru: 'Разрешите доступ к микрофону.' },
  apiKey: { uz: 'Gemini API kaliti ishlamayapti.', ru: 'Ключ Gemini API не работает.' },
};

export const SuperTaxiDemo: React.FC<SuperTaxiDemoProps> = ({ lang }) => {
  const t = (uz: string, ru: string) => (lang === 'uz' ? uz : ru);

  const [voice, setVoice] = useState<string>(VOICES[0].id);
  const [status, setStatus] = useState<CallStatus>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [order, setOrder] = useState<TaxiOrder | null>(null);
  const [result, setResult] = useState<CallResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [greetingReady, setGreetingReady] = useState<boolean | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const captureNodeRef = useRef<AudioNode | null>(null);
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const nextPlayTimeRef = useRef(0);
  const uplinkEnabledRef = useRef(false);
  const pendingSamplesRef = useRef<Float32Array[]>([]);
  const pendingCountRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callStartRef = useRef(0);
  const greetingCacheRef = useRef<Record<string, Promise<ArrayBuffer | null>>>({});
  const statusRef = useRef<CallStatus>('idle');

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Pre-fetch the cached greeting for the selected voice so the call starts instantly.
  const loadGreeting = useCallback((v: string): Promise<ArrayBuffer | null> => {
    if (!greetingCacheRef.current[v]) {
      greetingCacheRef.current[v] = fetch(`/api/super-taxi/greeting?voice=${encodeURIComponent(v)}`)
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .catch(() => null)
        .then((buf) => {
          if (!buf) delete greetingCacheRef.current[v]; // allow retry next time
          return buf;
        });
    }
    return greetingCacheRef.current[v];
  }, []);

  useEffect(() => {
    let cancelled = false;
    setGreetingReady(null);
    loadGreeting(voice).then((buf) => {
      if (!cancelled) setGreetingReady(!!buf);
    });
    return () => {
      cancelled = true;
    };
  }, [voice, loadGreeting]);

  const stopPlayback = useCallback(() => {
    sourcesRef.current.forEach((s) => {
      try {
        s.stop();
        s.disconnect();
      } catch {}
    });
    sourcesRef.current = [];
    if (outputCtxRef.current) nextPlayTimeRef.current = outputCtxRef.current.currentTime;
  }, []);

  const scheduleBuffer = useCallback((buffer: AudioBuffer, onEnded?: () => void) => {
    const ctx = outputCtxRef.current;
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime, nextPlayTimeRef.current);
    src.start(startAt);
    nextPlayTimeRef.current = startAt + buffer.duration;
    sourcesRef.current.push(src);
    src.onended = () => {
      sourcesRef.current = sourcesRef.current.filter((s) => s !== src);
      onEnded?.();
    };
  }, []);

  const playPcmChunk = useCallback(
    (b64: string) => {
      const ctx = outputCtxRef.current;
      if (!ctx) return;
      const samples = pcm16Base64ToFloat32(b64);
      if (samples.length === 0) return;
      const buffer = ctx.createBuffer(1, samples.length, 24000);
      buffer.getChannelData(0).set(samples);
      scheduleBuffer(buffer);
    },
    [scheduleBuffer],
  );

  const releaseAudio = useCallback(() => {
    uplinkEnabledRef.current = false;
    pendingSamplesRef.current = [];
    pendingCountRef.current = 0;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    try {
      captureNodeRef.current?.disconnect();
    } catch {}
    captureNodeRef.current = null;
    micStreamRef.current?.getTracks().forEach((tr) => tr.stop());
    micStreamRef.current = null;
    stopPlayback();
    inputCtxRef.current?.close().catch(() => {});
    outputCtxRef.current?.close().catch(() => {});
    inputCtxRef.current = null;
    outputCtxRef.current = null;
  }, [stopPlayback]);

  const closeSocket = useCallback(() => {
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      try {
        ws.close();
      } catch {}
    }
  }, []);

  useEffect(() => {
    return () => {
      closeSocket();
      releaseAudio();
    };
  }, [closeSocket, releaseAudio]);

  /** Wait until the operator's last words have finished playing, then hang up. */
  const finishCall = useCallback(
    (res: CallResult) => {
      setStatus('ending');
      uplinkEnabledRef.current = false;
      const ctx = outputCtxRef.current;
      const remainingMs = ctx ? Math.max(0, (nextPlayTimeRef.current - ctx.currentTime) * 1000) : 0;
      setTimeout(() => {
        closeSocket();
        releaseAudio();
        setResult(res);
        if (res.order) setOrder(res.order);
        setStatus('ended');
      }, remainingMs + 400);
    },
    [closeSocket, releaseAudio],
  );

  const sendMicFrame = useCallback((frame: Float32Array) => {
    const ws = wsRef.current;
    if (!uplinkEnabledRef.current || !ws || ws.readyState !== WebSocket.OPEN) return;
    pendingSamplesRef.current.push(frame);
    pendingCountRef.current += frame.length;
    // ~100 ms per message at 16 kHz
    if (pendingCountRef.current < 1600) return;
    const merged = new Float32Array(pendingCountRef.current);
    let offset = 0;
    for (const f of pendingSamplesRef.current) {
      merged.set(f, offset);
      offset += f.length;
    }
    pendingSamplesRef.current = [];
    pendingCountRef.current = 0;
    ws.send(JSON.stringify({ type: 'audio', audio: float32ToPcm16Base64(merged) }));
  }, []);

  const startMicCapture = useCallback(async () => {
    const ctx = inputCtxRef.current;
    const stream = micStreamRef.current;
    if (!ctx || !stream) return;
    const source = ctx.createMediaStreamSource(stream);
    if (ctx.audioWorklet) {
      const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'application/javascript' }));
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const node = new AudioWorkletNode(ctx, 'super-taxi-capture');
      node.port.onmessage = (e) => sendMicFrame(e.data as Float32Array);
      source.connect(node);
      captureNodeRef.current = node;
    } else {
      // Older browsers without AudioWorklet
      const processor = ctx.createScriptProcessor(2048, 1, 1);
      processor.onaudioprocess = (e) => sendMicFrame(new Float32Array(e.inputBuffer.getChannelData(0)));
      source.connect(processor);
      processor.connect(ctx.destination);
      captureNodeRef.current = processor;
    }
  }, [sendMicFrame]);

  const startCall = async () => {
    setError(null);
    setTranscript([]);
    setOrder(null);
    setResult(null);
    setElapsed(0);
    callStartRef.current = 0;
    setStatus('connecting');

    try {
      micStreamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      setError(ERROR_TEXT.mic[lang]);
      setStatus('idle');
      return;
    }

    const AC = window.AudioContext || (window as any).webkitAudioContext;
    inputCtxRef.current = new AC({ sampleRate: 16000 });
    outputCtxRef.current = new AC({ sampleRate: 24000 });
    nextPlayTimeRef.current = 0;

    try {
      await startMicCapture();
    } catch (e) {
      console.warn('Mic capture setup failed:', e);
      setError(ERROR_TEXT.mic[lang]);
      releaseAudio();
      setStatus('idle');
      return;
    }

    // Greeting WAV (cached on the server, 0 tokens). Fall back to a Live greeting if missing.
    const greetingRaw = await Promise.race([
      loadGreeting(voice),
      new Promise<null>((r) => setTimeout(() => r(null), 8000)),
    ]);
    let greetingBuffer: AudioBuffer | null = null;
    if (greetingRaw && outputCtxRef.current) {
      try {
        greetingBuffer = await outputCtxRef.current.decodeAudioData(greetingRaw.slice(0));
      } catch {
        greetingBuffer = null;
      }
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/api/super-taxi-call`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'start', voice, greetingPlayed: !!greetingBuffer }));
    };

    ws.onmessage = (event) => {
      let msg: any;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      switch (msg.type) {
        case 'connected': {
          callStartRef.current = Date.now();
          timerRef.current = setInterval(() => {
            setElapsed(Math.round((Date.now() - callStartRef.current) / 100) / 10);
          }, 100);
          if (greetingBuffer) {
            setStatus('greeting');
            setTranscript([{ role: 'operator', text: 'Assalomu alaykum, Super Taksi, eshitaman.' }]);
            scheduleBuffer(greetingBuffer, () => {
              uplinkEnabledRef.current = true;
              if (statusRef.current === 'greeting') setStatus('live');
            });
          } else {
            uplinkEnabledRef.current = true;
            setStatus('live');
          }
          break;
        }
        case 'audio':
          if (msg.audio) playPcmChunk(msg.audio);
          break;
        case 'interrupted':
          stopPlayback();
          break;
        case 'transcript':
          setTranscript((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === msg.role) {
              return [...prev.slice(0, -1), { ...last, text: `${last.text}${msg.text}` }];
            }
            return [...prev, { role: msg.role, text: String(msg.text || '').trimStart() }];
          });
          break;
        case 'order':
          setOrder(msg.order);
          break;
        case 'callEnded':
          finishCall({
            reason: msg.reason,
            order: msg.order,
            durationSec: msg.durationSec,
            usage: msg.usage,
          });
          break;
        case 'apiKeyExpired':
          setError(ERROR_TEXT.apiKey[lang]);
          break;
        case 'error':
          setError(ERROR_TEXT[msg.error]?.[lang] || String(msg.error || 'Error'));
          break;
      }
    };

    ws.onclose = () => {
      if (statusRef.current === 'connecting' || statusRef.current === 'greeting' || statusRef.current === 'live') {
        releaseAudio();
        setStatus('ended');
        const durationSec = callStartRef.current ? (Date.now() - callStartRef.current) / 1000 : 0;
        setResult((prev) => prev || { reason: 'error', order: null, durationSec });
      }
    };
  };

  const hangUp = () => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'hangup' }));
    } else {
      closeSocket();
      releaseAudio();
      setStatus('ended');
    }
  };

  const inCall = status === 'connecting' || status === 'greeting' || status === 'live' || status === 'ending';
  const progressPct = Math.min(100, (elapsed / HARD_LIMIT_SEC) * 100);
  const overTarget = elapsed > TARGET_SEC;

  const statusLabel: Record<CallStatus, string> = {
    idle: t('Qo‘ng‘iroqqa tayyor', 'Готов к звонку'),
    connecting: t('Ulanmoqda…', 'Соединение…'),
    greeting: t('Operator salomlashmoqda', 'Оператор здоровается'),
    live: t('Gapiring: qayerga taksi kerak?', 'Говорите: куда нужно такси?'),
    ending: t('Operator yakunlamoqda', 'Оператор завершает'),
    ended: t('Qo‘ng‘iroq tugadi', 'Звонок завершён'),
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5 select-text">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#5D594E]">
            {t('Demo · Gemini 3.8 Live', 'Демо · Gemini 3.8 Live')}
          </div>
          <h1 className="font-serif text-2xl sm:text-3xl text-[#161511] mt-1">
            {t('Super Taksi AI operatori', 'AI-оператор Super Taksi')}
          </h1>
          <p className="text-sm text-[#5D594E] mt-1 max-w-xl">
            {t(
              'Mijoz qo‘ng‘iroq qiladi, manzilni aytadi, operator buyurtmani qabul qiladi va xayrlashadi. Maqsad 20 soniya, chegara 30 soniya.',
              'Клиент звонит, называет адрес, оператор принимает заказ и прощается. Цель 20 секунд, предел 30 секунд.',
            )}
          </p>
        </div>
        <label className="flex flex-col text-xs text-[#5D594E] gap-1">
          {t('Operator ovozi', 'Голос оператора')}
          <select
            value={voice}
            disabled={inCall}
            onChange={(e) => setVoice(e.target.value)}
            className="px-3 py-2 rounded-lg border border-[rgba(22,21,17,0.18)] bg-white text-sm text-[#161511] disabled:opacity-50"
          >
            {VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {lang === 'uz' ? v.labelUz : v.labelRu}
              </option>
            ))}
          </select>
          <span className="text-[11px]">
            {greetingReady === null
              ? t('Salomlashish yozuvi tayyorlanmoqda…', 'Готовим запись приветствия…')
              : greetingReady
                ? t('Salomlashish yozuvi tayyor (0 token)', 'Запись приветствия готова (0 токенов)')
                : t('Yozuv yo‘q: Live o‘zi salomlashadi', 'Записи нет: Live поздоровается сам')}
          </span>
        </label>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        {/* Call panel */}
        <div className="rounded-2xl bg-[#1D1D1B] text-[#EDEAE2] p-5 flex flex-col gap-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  status === 'live' ? 'bg-[#5CC8CF] animate-pulse' : inCall ? 'bg-[#C98A12]' : 'bg-[#5D594E]'
                }`}
              />
              {statusLabel[status]}
            </div>
            <div className={`font-mono text-lg tabular-nums ${overTarget ? 'text-[#C98A12]' : 'text-[#EDEAE2]'}`}>
              {elapsed.toFixed(1)}s
            </div>
          </div>

          {/* 20 s target / 30 s hard limit bar */}
          <div className="space-y-1">
            <div className="relative h-2 rounded-full bg-[#2B2B27] overflow-hidden">
              <div
                className={`absolute inset-y-0 left-0 ${overTarget ? 'bg-[#C98A12]' : 'bg-[#0E7C86]'}`}
                style={{ width: `${progressPct}%` }}
              />
              <div className="absolute inset-y-0 w-px bg-[#EDEAE2]/60" style={{ left: `${(TARGET_SEC / HARD_LIMIT_SEC) * 100}%` }} />
            </div>
            <div className="flex justify-between font-mono text-[10px] text-[#7D7A70]">
              <span>0s</span>
              <span>{t('maqsad', 'цель')} {TARGET_SEC}s</span>
              <span>{t('chegara', 'предел')} {HARD_LIMIT_SEC}s</span>
            </div>
          </div>

          {/* Transcript */}
          <div className="flex-1 min-h-[180px] max-h-[320px] overflow-y-auto space-y-2 pr-1">
            {transcript.length === 0 ? (
              <p className="text-sm text-[#7D7A70]">
                {t(
                  '“Qo‘ng‘iroq qilish”ni bosing va masalan ayting: “Chilonzor to‘qqizinchi kvartal, Korzinka yoniga taksi kerak.”',
                  'Нажмите «Позвонить» и скажите, например: «Chilonzor to‘qqizinchi kvartal, Korzinka yoniga taksi kerak.»',
                )}
              </p>
            ) : (
              transcript.map((line, i) => (
                <div key={i} className={`flex ${line.role === 'caller' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                      line.role === 'caller' ? 'bg-[#0E7C86] text-white' : 'bg-[#2B2B27] text-[#EDEAE2]'
                    }`}
                  >
                    <div className="text-[10px] uppercase tracking-wider opacity-70 mb-0.5">
                      {line.role === 'caller' ? t('Mijoz', 'Клиент') : 'Super Taksi'}
                    </div>
                    {line.text}
                  </div>
                </div>
              ))
            )}
          </div>

          {error && <div className="text-sm text-[#C98A12]">{error}</div>}

          <div className="flex justify-center">
            {inCall ? (
              <button
                onClick={hangUp}
                disabled={status === 'ending'}
                className="flex items-center gap-2 px-6 py-3 rounded-full bg-[#B3402F] hover:bg-[#9A3626] text-white font-semibold disabled:opacity-60"
              >
                <PhoneOff className="w-4 h-4" />
                {t('Go‘shakni qo‘yish', 'Положить трубку')}
              </button>
            ) : (
              <button
                onClick={startCall}
                className="flex items-center gap-2 px-6 py-3 rounded-full bg-[#0E7C86] hover:bg-[#0A5A62] text-white font-semibold"
              >
                {status === 'ended' ? <RotateCcw className="w-4 h-4" /> : <Phone className="w-4 h-4" />}
                {status === 'ended' ? t('Yana qo‘ng‘iroq qilish', 'Позвонить ещё раз') : t('Qo‘ng‘iroq qilish', 'Позвонить')}
              </button>
            )}
          </div>
          {status === 'live' && (
            <div className="flex items-center justify-center gap-1.5 text-xs text-[#7D7A70]">
              <Mic className="w-3.5 h-3.5" /> {t('Mikrofon yoqilgan', 'Микрофон включён')}
            </div>
          )}
        </div>

        {/* Order card for the driver */}
        <div className="rounded-2xl bg-white border border-[rgba(22,21,17,0.14)] p-5 flex flex-col gap-4">
          <div className="flex items-center gap-2 text-[#161511] font-semibold">
            <Car className="w-5 h-5 text-[#0E7C86]" />
            {t('Haydovchi uchun buyurtma kartasi', 'Карточка заказа для водителя')}
          </div>

          {order ? (
            <div className="space-y-3 text-sm">
              <div className="font-mono text-xs text-[#5D594E]">#{order.id}</div>
              <div className="flex gap-2">
                <MapPin className="w-4 h-4 mt-0.5 text-[#0E7C86] shrink-0" />
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-[#5D594E]">{t('Olib ketish joyi', 'Точка подачи')}</div>
                  <div className="text-[#161511] font-semibold">{order.pickup}</div>
                </div>
              </div>
              {order.landmark && (
                <div className="flex gap-2">
                  <Flag className="w-4 h-4 mt-0.5 text-[#C98A12] shrink-0" />
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-[#5D594E]">{t('Mo‘ljal', 'Ориентир')}</div>
                    <div className="text-[#161511]">{order.landmark}</div>
                  </div>
                </div>
              )}
              {order.destination && (
                <div className="flex gap-2">
                  <MapPin className="w-4 h-4 mt-0.5 text-[#5D594E] shrink-0" />
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-[#5D594E]">{t('Borish manzili', 'Куда')}</div>
                    <div className="text-[#161511]">{order.destination}</div>
                  </div>
                </div>
              )}
              <div className="flex gap-2">
                <Phone className="w-4 h-4 mt-0.5 text-[#5D594E] shrink-0" />
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-[#5D594E]">{t('Mijoz raqami', 'Номер клиента')}</div>
                  <div className="text-[#161511]">{t('Demo: raqam qo‘ng‘iroqdan olinadi', 'Демо: номер берётся из звонка')}</div>
                </div>
              </div>
              <div className="flex gap-2">
                <Clock className="w-4 h-4 mt-0.5 text-[#5D594E] shrink-0" />
                <div className="text-[#161511]">
                  {new Date(order.createdAt).toLocaleTimeString(lang === 'uz' ? 'uz-UZ' : 'ru-RU')}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-[#5D594E]">
              {t('Buyurtma qabul qilingach, karta shu yerda paydo bo‘ladi.', 'Карточка появится здесь, когда оператор примет заказ.')}
            </p>
          )}

          {result && (
            <div className="mt-auto pt-4 border-t border-[rgba(22,21,17,0.1)] grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-[#5D594E]">{t('Natija', 'Итог')}</div>
                <div className="text-[#161511]">{REASON_TEXT[result.reason]?.[lang] || result.reason}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-[#5D594E]">{t('Davomiyligi', 'Длительность')}</div>
                <div className={`font-mono ${result.durationSec > TARGET_SEC ? 'text-[#C98A12]' : 'text-[#161511]'}`}>
                  {result.durationSec?.toFixed(1)}s
                </div>
              </div>
              {result.usage && result.usage.totalTokens > 0 && (
                <div className="col-span-2">
                  <div className="text-[11px] uppercase tracking-wider text-[#5D594E]">{t('Gemini Live tokenlari', 'Токены Gemini Live')}</div>
                  <div className="font-mono text-[#161511]">
                    {result.usage.totalTokens.toLocaleString()}{' '}
                    <span className="text-[#5D594E]">
                      ({t('kirish', 'вход')} {result.usage.promptTokens.toLocaleString()} · {t('chiqish', 'выход')}{' '}
                      {result.usage.responseTokens.toLocaleString()})
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SuperTaxiDemo;
