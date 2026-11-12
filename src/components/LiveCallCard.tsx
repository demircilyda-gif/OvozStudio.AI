import React, { useEffect, useRef, useState } from 'react';
import {
  PhoneCall,
  PhoneOff,
  Mic,
  MicOff,
  Building2,
  FileText,
  Key,
  Flame,
  ShieldCheck,
  Lock,
  Sparkles,
  ArrowRight,
  RotateCcw,
  Send,
  MapPin,
  Navigation,
  Clock,
  CheckCircle2,
} from 'lucide-react';
import { AgentPersonaType, RealEstateLeadCard, TaxiOrderCard, TranscriptLine } from '../types/podcast';
import { useAuth } from '../context/AuthContext';

interface LiveCallCardProps {
  callStatus: 'idle' | 'calling' | 'connected' | 'ended';
  callDuration: number;
  agentSpeaking: boolean;
  userSpeaking: boolean;
  currentSubtitle: string;
  transcriptLines: TranscriptLine[];
  callTopic: string;
  reLeadCard: RealEstateLeadCard;
  selectedPersona?: AgentPersonaType;
  taxiOrderCard?: TaxiOrderCard | null;
  onStartCall: () => void;
  onEndCall: () => void;
  onToggleMute: () => void;
  isMuted: boolean;
  onResetCall: () => void;
  onGoToCRM: () => void;
  onGoToLead: () => void;
  isAuthenticated: boolean;
  lang: 'uz' | 'ru';
  agentVoiceName?: string;
  onSendText?: (text: string) => void;
  micWarning?: string | null;
  apiKeyNotice?: string | null;
  callErrorMessage?: string | null;
  onDismissNotice?: () => void;
}

export const LiveCallCard: React.FC<LiveCallCardProps> = ({
  callStatus,
  callDuration,
  agentSpeaking,
  userSpeaking,
  currentSubtitle,
  transcriptLines,
  callTopic,
  reLeadCard,
  selectedPersona = 'tashkent_real_estate',
  taxiOrderCard,
  onStartCall,
  onEndCall,
  onToggleMute,
  isMuted,
  onResetCall,
  onGoToCRM,
  onGoToLead,
  isAuthenticated,
  lang,
  agentVoiceName = 'SHOKHRUKH',
  onSendText,
  micWarning,
  apiKeyNotice,
  callErrorMessage,
  onDismissNotice,
}) => {
  const { isAdmin } = useAuth();
  const [activeWordIdx, setActiveWordIdx] = useState(0);
  const [localInput, setLocalInput] = useState('');
  const transcriptScrollRef = useRef<HTMLDivElement>(null);

  // Format mm:ss in mono
  const formatTime = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Word-by-word highlight: advancing every ~260ms while speech is detected
  useEffect(() => {
    if (callStatus !== 'connected' && callStatus !== 'calling') {
      setActiveWordIdx(0);
      return;
    }

    if (!agentSpeaking && !userSpeaking) return;

    const interval = setInterval(() => {
      setActiveWordIdx((prev) => prev + 1);
    }, 260);

    return () => clearInterval(interval);
  }, [callStatus, agentSpeaking, userSpeaking]);

  // Auto-scroll transcript container on new text or word
  useEffect(() => {
    if (transcriptScrollRef.current) {
      transcriptScrollRef.current.scrollTop = transcriptScrollRef.current.scrollHeight;
    }
  }, [transcriptLines, currentSubtitle, activeWordIdx]);

  // Check for emotion tokens: <breath>, <laugh>, [Pauza], etc.
  const isEmotionToken = (token: string) => {
    const clean = token.trim();
    return (
      (clean.startsWith('<') && clean.endsWith('>')) ||
      (clean.startsWith('[') && clean.endsWith(']')) ||
      clean === '<breath>' ||
      clean === '<laugh>' ||
      clean === '<gasp>' ||
      clean.startsWith('[Pauza') ||
      clean === '|ha|' ||
      clean === '|mhm|' ||
      clean === '[Hayajonli]'
    );
  };

  // Render tokens with emotion styling & word-by-word highlight
  const renderLineTokens = (
    text: string,
    isCurrentActiveLine: boolean
  ) => {
    // Regex splits on whitespace while preserving words
    const tokens = text.split(/(\s+)/);
    const nonSpaceTokens = tokens.filter((t) => !/^\s+$/.test(t) && !isEmotionToken(t));
    const totalWords = nonSpaceTokens.length;
    const highlightTargetIdx = totalWords > 0 ? activeWordIdx % totalWords : -1;

    let wordCounter = 0;

    return tokens.map((token, i) => {
      // Whitespace
      if (/^\s+$/.test(token)) {
        return <span key={i}>{token}</span>;
      }

      // Emotion tokens: <breath>, <laugh>, [Pauza], etc. in terracotta #C4552D
      if (isEmotionToken(token)) {
        return (
          <span
            key={i}
            className="text-[#C4552D] font-mono font-medium px-0.5"
          >
            {token}
          </span>
        );
      }

      const thisWordIndex = wordCounter++;
      const isHighlighted =
        isCurrentActiveLine &&
        (agentSpeaking || userSpeaking) &&
        thisWordIndex === highlightTargetIdx;

      if (isHighlighted) {
        return (
          <span
            key={i}
            className="bg-[rgba(14,124,134,0.14)] text-[#161511] font-semibold px-1 py-0.5 rounded-[4px] transition-colors duration-150"
          >
            {token}
          </span>
        );
      }

      return <span key={i}>{token}</span>;
    });
  };

  const isLive = callStatus === 'calling' || callStatus === 'connected';
  const isDone = callStatus === 'ended';
  const isIdle = callStatus === 'idle';
  const isSuperTaxi = selectedPersona === 'supertaxi_ivr';

  return (
    <div className="w-full max-w-[720px] mx-auto bg-white rounded-[24px] border border-[rgba(22,21,17,0.14)] shadow-[0_20px_40px_-20px_rgba(22,21,17,0.12)] p-5 sm:p-7 space-y-6 transition-all duration-300 ease-in-out relative overflow-hidden select-none">
      {/* ------------------------------------------------------------- */}
      {/* HEADER / AGENT ROW (Common to all states, dynamic details)   */}
      {/* ------------------------------------------------------------- */}
      <div className="flex items-center justify-between gap-4 pb-4 border-b border-[rgba(22,21,17,0.1)]">
        <div className="flex items-center gap-3.5 min-w-0">
          {/* 58px Avatar tile with 3 concentric pulsing rings */}
          <div className="relative w-[58px] h-[58px] shrink-0 flex items-center justify-center">
            <span
              className="absolute inset-0 rounded-[18px] border-[1.5px] border-[#0E7C86] pointer-events-none animate-pulse-ring-1"
              aria-hidden="true"
            />
            <span
              className="absolute inset-0 rounded-[18px] border-[1.5px] border-[#0E7C86] pointer-events-none animate-pulse-ring-2"
              aria-hidden="true"
            />
            <span
              className="absolute inset-0 rounded-[18px] border-[1.5px] border-[#0E7C86] pointer-events-none animate-pulse-ring-3"
              aria-hidden="true"
            />

            {/* Avatar core */}
            <div className={`relative z-10 w-full h-full rounded-[18px] ${
              isSuperTaxi
                ? 'bg-[radial-gradient(circle_at_center,#C98A12_0%,#8F5F08_100%)]'
                : 'bg-[radial-gradient(circle_at_center,#12A3B0_0%,#0A5A62_100%)]'
            } text-white flex items-center justify-center shadow-sm`}>
              {isSuperTaxi ? (
                <Navigation className="w-6 h-6 stroke-[2]" />
              ) : (
                <Building2 className="w-6 h-6 stroke-[2]" />
              )}
            </div>
          </div>

          {/* Agent info */}
          <div className="min-w-0">
            <h3 className="font-serif text-base sm:text-lg font-normal text-[#161511] truncate leading-tight">
              {isSuperTaxi
                ? `${agentVoiceName || 'MADINA'} — SuperTaksi IVR Dispetcheri (15–20s)`
                : `${agentVoiceName || 'SHOKHRUKH'} — Toshkent rieltor-eksperti`}
            </h3>
            <p
              className="font-mono text-[11px] text-[#0A5A62] font-semibold tracking-wider mt-0.5 flex items-center gap-1.5"
              style={{ fontFamily: '"IBM Plex Mono", monospace' }}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isLive
                    ? 'bg-[#C4552D] pulse-teal-dot'
                    : isDone
                    ? 'bg-emerald-600'
                    : 'bg-[#0E7C86]'
                }`}
              />
              <span>
                {isSuperTaxi
                  ? '0 TOKEN WAV SALOM · GEMINI 3.8 LIVE · O\'ZBEKCHA'
                  : 'OVOZSTUDIO NEURAL LIVE · 0% AKSENT'}
              </span>
            </p>
          </div>
        </div>

        {/* Mono Timer on the right */}
        <div className="text-right shrink-0">
          <div
            className={`font-mono text-base sm:text-lg font-bold tabular-nums tracking-tight ${
              isLive
                ? isSuperTaxi && callDuration > 20
                  ? 'text-[#C4552D]'
                  : 'text-[#0E7C86]'
                : isDone
                ? 'text-[#161511]'
                : 'text-[#7D7A70]'
            }`}
            style={{ fontFamily: '"IBM Plex Mono", monospace' }}
          >
            {isIdle ? '00:00' : formatTime(callDuration)}
            {isSuperTaxi && <span className="text-xs text-[#7D7A70] font-normal"> / 00:20</span>}
          </div>
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#7D7A70] block">
            {isLive
              ? isSuperTaxi
                ? 'SLA: 15-20s norma'
                : lang === 'uz' ? 'Jonli efir' : 'В эфире'
              : isDone
              ? lang === 'uz' ? 'Yakunlangan' : 'Завершен'
              : lang === 'uz' ? 'Kutish' : 'Ожидание'}
          </span>
        </div>
      </div>

      {/* Call error notification */}
      {callErrorMessage && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 text-xs text-rose-800 flex items-center justify-between gap-2 shadow-xs">
          <div className="flex items-center gap-2">
            <span className="text-base">⚠️</span>
            <span className="leading-snug">{callErrorMessage}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isAdmin &&
              (callErrorMessage.toLowerCase().includes('api key') ||
                callErrorMessage.toLowerCase().includes('kalit') ||
                callErrorMessage.toLowerCase().includes('истёк')) && (
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent('open-api-key-modal'))}
                className="btn-pill btn-solid text-[11px] py-1 px-2.5 flex items-center gap-1 cursor-pointer shadow-xs"
              >
                <Key className="w-3 h-3" />
                <span>{lang === 'uz' ? "Kalitni kiritish" : "Ввести ключ"}</span>
              </button>
            )}
            {onDismissNotice && (
              <button
                type="button"
                onClick={onDismissNotice}
                className="text-xs px-2 py-0.5 rounded hover:bg-rose-500/20 text-rose-700 font-bold cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      )}

      {/* API Key / Speech Fallback Notice */}
      {apiKeyNotice && (
        <div className="bg-[#0E7C86]/10 border border-[#0E7C86]/30 rounded-xl p-3 text-xs text-[#0A5A62] flex items-center justify-between gap-2 shadow-xs">
          <div className="flex items-center gap-2">
            <span className="text-base">ℹ️</span>
            <span className="leading-snug">{apiKeyNotice}</span>
          </div>
          {onDismissNotice && (
            <button
              type="button"
              onClick={onDismissNotice}
              className="text-xs px-2 py-0.5 rounded hover:bg-[#0E7C86]/20 text-[#0E7C86] font-bold cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* STATE 1: IDLE (Before Call)                                  */}
      {/* ------------------------------------------------------------- */}
      {isIdle && (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
          {isSuperTaxi ? (
            <div className="p-4 rounded-2xl bg-[#F4F1EA]/80 border border-[rgba(22,21,17,0.12)] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-mono font-bold text-[#161511] flex items-center gap-1.5">
                  <Navigation className="w-3.5 h-3.5 text-[#C98A12]" />
                  <span>SUPERTAKSI IVR PROTOKOLI (FAQAT O'ZBEK TILIDA · 15–20 SONIYA):</span>
                </span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-600/15 text-emerald-800 text-[10px] font-mono font-bold">
                  ~$0.0015 / qo'ng'iroq (~20 so'm)
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] font-mono">
                <div className="p-2.5 rounded-xl bg-white border border-[rgba(22,21,17,0.08)]">
                  <span className="text-[#C98A12] font-bold block">1. 0–3s (0 Token WAV)</span>
                  <span className="text-[#161511]">«Assalomu alaykum, SuperTaksi! Eshitaman sizni.»</span>
                </div>
                <div className="p-2.5 rounded-xl bg-white border border-[rgba(22,21,17,0.08)]">
                  <span className="text-[#0E7C86] font-bold block">2. 3–10s (Mijoz manzili)</span>
                  <span className="text-[#161511]">Mijoz manzil/mo'ljalni aytadi (masalan: «Skverga»)</span>
                </div>
                <div className="p-2.5 rounded-xl bg-white border border-[rgba(22,21,17,0.08)]">
                  <span className="text-emerald-700 font-bold block">3. 10–18s (Avto-uzish)</span>
                  <span className="text-[#161511]">«Yaxshi, [manzil] ga buyurtma qabul qilindi, hozir haydovchimiz sizga qo'ng'iroq qiladi. Xayr, salomat bo'ling!»</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-2xl bg-[#F4F1EA]/65 border border-[rgba(22,21,17,0.08)] flex items-start gap-3">
              <div className="p-2 rounded-xl bg-[#0E7C86]/10 text-[#0E7C86] shrink-0 mt-0.5">
                <Sparkles className="w-4 h-4" />
              </div>
              <div className="space-y-1">
                <h4 className="text-xs font-semibold text-[#161511]">
                  {lang === 'uz' ? 'Qo\'ng\'iroq mavzusi va maqsadi:' : 'Тема и контекст звонка:'}
                </h4>
                <p className="text-xs text-[#5D594E] leading-relaxed">
                  "{callTopic}"
                </p>
              </div>
            </div>
          )}

          {/* Action Button: Start Call */}
          <button
            type="button"
            onClick={onStartCall}
            className="w-full py-4 px-6 rounded-full bg-[#161511] hover:bg-[#0A5A62] text-[#F4F1EA] font-medium text-sm sm:text-base flex items-center justify-center gap-3 transition-all cursor-pointer shadow-md active:scale-[0.99]"
          >
            <PhoneCall className="w-5 h-5 fill-current text-[#5CC8CF]" />
            <span>
              {isSuperTaxi
                ? (lang === 'uz'
                    ? '🚕 SuperTaksi IVR Qo\'ng\'iroqni Boshlash (15–20s Jonli)'
                    : '🚕 Позвонить Оператору SuperTaksi IVR (15–20с Живой)')
                : (lang === 'uz' ? '📞 Qo\'ng\'iroqni Boshlash (Jonli)' : '📞 Начать Звонок (Живой)')}
            </span>
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* STATE 2: LIVE (During Call)                                  */}
      {/* ------------------------------------------------------------- */}
      {isLive && (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
          {/* Status banner */}
          <div className="flex items-center justify-between text-xs font-mono px-1">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#C4552D] animate-ping" />
              <span className="text-[#0A5A62] font-bold">
                {callStatus === 'calling'
                  ? lang === 'uz' ? 'Qo\'ng\'iroq qilinmoqda...' : 'Соединение...'
                  : lang === 'uz' ? 'Jonli Audio Suhbat Oqimi' : 'Прямой речевой канал'}
              </span>
            </div>
            <div className="text-[11px] text-[#5D594E]">
              {agentSpeaking
                ? lang === 'uz' ? '🗣️ Agent gapirmoqda' : '🗣️ Говорит агент'
                : userSpeaking
                ? lang === 'uz' ? '🎤 Siz gapiryapsiz' : '🎤 Вы говорите'
                : lang === 'uz' ? '👂 Tinglanmoqda' : '👂 Слушает'}
            </div>
          </div>

          {/* Live Transcript Block: mono 13px, lh 2 */}
          <div
            ref={transcriptScrollRef}
            className="w-full min-h-[160px] max-h-[280px] overflow-y-auto bg-[#F4F1EA]/70 rounded-2xl p-4 sm:p-5 border border-[rgba(22,21,17,0.1)] font-mono text-[13px] leading-[2] text-[#161511] space-y-2 select-text shadow-2xs"
            style={{ fontFamily: '"IBM Plex Mono", monospace' }}
          >
            {/* If no transcript stream is available yet */}
            {transcriptLines.length === 0 && !currentSubtitle && (
              <div className="flex items-center gap-1.5 text-[#5D594E] py-2">
                <span className="text-[#0A5A62] font-semibold">AGENT ·</span>
                <span>Agent tinglaydi…</span>
                <span className="inline-flex items-center gap-1 ml-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#0E7C86] animate-dot-1" />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#0E7C86] animate-dot-2" />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#0E7C86] animate-dot-3" />
                </span>
              </div>
            )}

            {/* Historical transcript lines */}
            {transcriptLines.map((line, idx) => {
              const isAgent = (line as any).speaker === 'agent' || line.sender === 'agent';
              return (
                <div key={line.id || idx} className="break-words">
                  <span
                    className={`font-semibold mr-1.5 ${
                      isAgent ? 'text-[#0A5A62]' : 'text-[#C4552D]'
                    }`}
                  >
                    {isAgent ? 'AGENT ·' : 'MIJOZ ·'}
                  </span>
                  {renderLineTokens(line.text, false)}
                </div>
              );
            })}

            {/* Currently spoken live line with word-by-word highlight */}
            {currentSubtitle && (
              <div className="break-words">
                <span className="font-semibold text-[#0A5A62] mr-1.5">
                  AGENT ·
                </span>
                {renderLineTokens(currentSubtitle, true)}
              </div>
            )}
          </div>

          {/* Mic warning banner if present */}
          {micWarning && (
            <div className="bg-[rgba(196,85,45,0.1)] border border-[#C4552D]/40 rounded-xl p-2.5 text-xs text-[#161511] flex items-center gap-2">
              <span className="text-sm">⚠️</span>
              <p className="text-[11px] leading-snug">{micWarning}</p>
            </div>
          )}

          {/* Quick text input fallback */}
          {/* SuperTaxi 15-20s SLA Progress & Live Driver Order Card */}
          {isSuperTaxi && (
            <div className="space-y-3">
              {/* 20s SLA Progress Bar */}
              <div className="p-3 rounded-xl bg-[#F4F1EA]/90 border border-[rgba(22,21,17,0.12)] space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span className="font-semibold text-[#161511] flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-[#C98A12]" />
                    <span>SuperTaksi IVR Taymeri (Norma: 15–20s, Maks: 30s)</span>
                  </span>
                  <span className="text-[#0E7C86] font-bold">
                    {callDuration <= 4
                      ? '1-Bosqich: 0-Token WAV Salomlashuv'
                      : taxiOrderCard?.status === 'driver_assigned'
                      ? '3-Bosqich: Buyurtma tasdiqlandi (Auto-uzish)'
                      : '2-Bosqich: Manzil / Mo\'ljal tinglanmoqda'}
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-black/10 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      callDuration <= 20 ? 'bg-[#0E7C86]' : 'bg-[#C4552D]'
                    }`}
                    style={{ width: `${Math.min(100, (callDuration / 20) * 100)}%` }}
                  />
                </div>
              </div>

              {/* Quick Uzbek Address Chips for testing during Live Call */}
              {onSendText && (
                <div className="space-y-1.5">
                  <span className="text-[11px] font-mono text-[#5D594E] block">
                    🚕 Mikrofonga manzilni ayting yoki tezkor sinash uchun bosing:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      'Assalomu alaykum, Skverga mashina yuboring',
                      'Chilonzor 9-kvartal, Parus oldiga bitta taksi',
                      'Yunusobod Mega Planet oldiga mashina kerak',
                      'Xalqaro Aeroportga taksi yuboring',
                      'Alo, eshitilyaptimi?',
                    ].map((phrase) => (
                      <button
                        key={phrase}
                        type="button"
                        onClick={() => onSendText(phrase)}
                        className="px-2.5 py-1 rounded-full bg-[#F4F1EA] hover:bg-[#ECE7DB] border border-[rgba(22,21,17,0.14)] text-[11px] font-mono text-[#161511] cursor-pointer transition-all active:scale-95"
                      >
                        🗣️ "{phrase}"
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Live Driver Dispatch Card Status */}
              <div className={`p-3.5 rounded-xl border transition-all ${
                taxiOrderCard?.status === 'driver_assigned'
                  ? 'bg-emerald-50/90 border-emerald-300 text-emerald-950'
                  : 'bg-[#F4F1EA]/60 border-[rgba(22,21,17,0.12)] text-[#161511]'
              }`}>
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="font-bold flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-[#0E7C86]" />
                    <span>HAYDOVCHI BUYURTMA KARTASI:</span>
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    taxiOrderCard?.status === 'driver_assigned'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-amber-500/20 text-[#8F5F08]'
                  }`}>
                    {taxiOrderCard?.status === 'driver_assigned'
                      ? '✓ HAYDOVCHIGA YUBORILDI'
                      : 'MANZIL KUTILMOQDA...'}
                  </span>
                </div>
                {taxiOrderCard?.pickupLocation && (
                  <div className="mt-2 pt-2 border-t border-black/10 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-mono">
                    <div>
                      <span className="text-[10px] text-[#5D594E] block">MANZIL / MO'LJAL:</span>
                      <span className="font-bold text-[#161511]">{taxiOrderCard.pickupLocation}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#5D594E] block">BUYURTMA ID:</span>
                      <span className="font-bold text-[#0E7C86]">{taxiOrderCard.orderId}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-[#5D594E] block">API TANNARX:</span>
                      <span className="font-bold text-[#161511]">~$0.0015 (~20 UZS)</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {onSendText && (
            <div className="flex items-center gap-2 bg-[#F4F1EA]/85 border border-[rgba(22,21,17,0.12)] rounded-full px-3.5 py-1.5 focus-within:border-[#0E7C86] transition-colors">
              <input
                type="text"
                value={localInput}
                onChange={(e) => setLocalInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && localInput.trim()) {
                    onSendText(localInput.trim());
                    setLocalInput('');
                  }
                }}
                placeholder={isSuperTaxi ? "Manzil yoki mo'ljalni yozib yuboring (masalan: Skverga)..." : (lang === 'uz' ? 'Yoki savolingizni yozib yuboring…' : 'Или напишите вопрос текстом…')}
                className="flex-1 bg-transparent text-xs text-[#161511] placeholder:text-[#7D7A70] focus:outline-none font-mono"
              />
              <button
                type="button"
                onClick={() => {
                  if (localInput.trim()) {
                    onSendText(localInput.trim());
                    setLocalInput('');
                  }
                }}
                disabled={!localInput.trim()}
                className="p-1 text-[#0E7C86] hover:text-[#0A5A62] disabled:opacity-40 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Call Controls: End Call, Mute */}
          <div className="flex items-center justify-between gap-3 pt-2">
            <button
              type="button"
              onClick={onToggleMute}
              className={`px-4 py-2.5 rounded-full font-mono text-xs font-semibold flex items-center gap-2 border transition-all cursor-pointer ${
                isMuted
                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                  : 'bg-white hover:bg-[#ECE7DB] text-[#161511] border-[rgba(22,21,17,0.14)]'
              }`}
            >
              {isMuted ? <MicOff className="w-4 h-4 text-rose-600" /> : <Mic className="w-4 h-4 text-[#0E7C86]" />}
              <span>{isMuted ? (lang === 'uz' ? 'Mikrofon o\'chiq' : 'Микрофон выкл') : (lang === 'uz' ? 'Ovoz yozilmoqda' : 'Микрофон вкл')}</span>
            </button>

            <button
              type="button"
              onClick={onEndCall}
              className="px-6 py-2.5 rounded-full bg-[#C4552D] hover:bg-[#A33F1A] text-white font-medium text-xs sm:text-sm flex items-center gap-2 shadow-xs transition-all cursor-pointer active:scale-95"
            >
              <PhoneOff className="w-4 h-4" />
              <span>{lang === 'uz' ? 'Qo\'ng\'iroqni tugatish' : 'Завершить звонок'}</span>
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* STATE 3: DONE (After Call Ended)                             */}
      {/* ------------------------------------------------------------- */}
      {isDone && (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
          {isSuperTaxi ? (
            <>
              {/* SuperTaxi Driver Order Dispatch Card */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 p-3.5 bg-emerald-50/80 border border-emerald-300 rounded-2xl">
                <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-100 border border-emerald-300 text-emerald-950 font-mono text-xs font-semibold shadow-2xs">
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>🚕 SuperTaksi Buyurtmasi Haydovchiga Yuborildi!</span>
                </div>
                <div className="text-[11px] font-mono text-emerald-950 font-bold">
                  Qo'ng'iroq vaqti: {callDuration} soniya (Norma: 15–20s)
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-4 rounded-2xl bg-[#F4F1EA]/80 border border-[rgba(22,21,17,0.14)] text-xs font-mono">
                <div>
                  <span className="text-[10px] uppercase text-[#7D7A70] block">BUYURTMA ID</span>
                  <span className="font-bold text-[#0E7C86]">{taxiOrderCard?.orderId || 'ST-84920'}</span>
                </div>
                <div className="col-span-1 sm:col-span-2">
                  <span className="text-[10px] uppercase text-[#7D7A70] block">QABUL QILINGAN MANZIL / MO'LJAL</span>
                  <span className="font-bold text-[#161511]">
                    📍 {taxiOrderCard?.pickupLocation || 'Toshkent (Mijoz manzili)'}
                    {taxiOrderCard?.destinationLocation ? ` → ${taxiOrderCard.destinationLocation}` : ''}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase text-[#7D7A70] block">LIVE API TANNARX</span>
                  <span className="font-bold text-emerald-700">
                    {taxiOrderCard?.estimatedCostUsd || '$0.0015'} (~{taxiOrderCard?.estimatedCostUzs || '20 so\'m'})
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <span className="text-xs font-mono text-[#5D594E]">
                  ✓ 0-Token WAV salomlashuv + Gemini 3.8 Live API + Avto-uzish
                </span>
                <button
                  type="button"
                  onClick={onResetCall}
                  className="px-5 py-2.5 rounded-full bg-[#161511] hover:bg-[#0A5A62] text-[#F4F1EA] text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Yangi Taksi Qo'ng'irog'i</span>
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Top Chip: "Lead-karta to'ldirildi" with drawn-check SVG */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 p-3.5 bg-emerald-50/70 border border-emerald-200/80 rounded-2xl">
                <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-100/70 border border-emerald-300/80 text-emerald-900 font-mono text-xs font-semibold shadow-2xs">
                  {/* Drawn-check SVG: stroke-dashoffset animation 0.5s */}
                  <svg
                    className="w-4 h-4 text-emerald-700 shrink-0"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path className="animate-draw-check" d="M20 6L9 17L4 12" />
                  </svg>
                  <span>{lang === 'uz' ? "Lead-karta to'ldirildi" : 'Лид-карта заполнена'}</span>
                </div>

                <div className="text-[11px] font-mono text-emerald-900/80">
                  {lang === 'uz' ? `Muloqot davomiyligi: ${formatTime(callDuration)}` : `Длительность: ${formatTime(callDuration)}`}
                </div>
              </div>

              {/* Lead Snapshot Summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-4 rounded-2xl bg-[#F4F1EA]/60 border border-[rgba(22,21,17,0.1)] text-xs">
                <div>
                  <span className="text-[10px] font-mono uppercase text-[#7D7A70] block">Maqsad</span>
                  <span className="font-semibold text-[#161511] capitalize">{reLeadCard.clientIntent || 'Sotib olish'}</span>
                </div>
                <div>
                  <span className="text-[10px] font-mono uppercase text-[#7D7A70] block">Tuman</span>
                  <span className="font-semibold text-[#161511]">{reLeadCard.district || 'Mirobod'}</span>
                </div>
                <div>
                  <span className="text-[10px] font-mono uppercase text-[#7D7A70] block">Byudjet</span>
                  <span className="font-semibold text-[#0E7C86] font-mono">{reLeadCard.budgetRange || '$50,000+'}</span>
                </div>
                <div>
                  <span className="text-[10px] font-mono uppercase text-[#7D7A70] block">Harorat</span>
                  <span className="font-semibold text-[#C4552D] font-mono uppercase flex items-center gap-1">
                    <Flame className="w-3 h-3 text-[#C4552D]" />
                    {reLeadCard.leadTemperature || 'WARM'}
                  </span>
                </div>
              </div>

              {/* Existing CRM and Lead Buttons (Stay Unchanged) */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={onGoToCRM}
                    className="px-4 py-2.5 rounded-full bg-[#0E7C86] hover:bg-[#0A5A62] text-white text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer shadow-xs"
                  >
                    <FileText className="w-4 h-4" />
                    <span>{lang === 'uz' ? 'CRM Dosyega O\'tish' : 'В CRM Досье'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={onGoToLead}
                    className="px-4 py-2.5 rounded-full bg-white hover:bg-[#ECE7DB] text-[#161511] border border-[rgba(22,21,17,0.14)] text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs"
                  >
                    <Key className="w-4 h-4 text-[#C98A12]" />
                    <span>{lang === 'uz' ? 'Lead-kartani ko\'rish' : 'Лид-карта'}</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={onResetCall}
                  className="px-4 py-2.5 rounded-full bg-white hover:bg-[#161511] hover:text-[#F4F1EA] text-[#5D594E] border border-[rgba(22,21,17,0.14)] text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{lang === 'uz' ? 'Qayta qo\'ng\'iroq qilish' : 'Позвонить снова'}</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
