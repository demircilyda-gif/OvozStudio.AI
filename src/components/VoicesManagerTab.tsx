import React, { useState } from 'react';
import {
  Mic2,
  Plus,
  Play,
  Pause,
  Edit2,
  Trash2,
  Sparkles,
  Sliders,
  Volume2,
  Check,
  UserCheck,
  ShieldCheck,
  Fingerprint,
} from 'lucide-react';
import { VoiceProfile } from '../types/podcast';

interface VoicesManagerTabProps {
  voices: VoiceProfile[];
  selectedVoiceId: string;
  onSelectVoice: (id: string) => void;
  onAddOrEditVoice: (voice?: VoiceProfile) => void;
  onDeleteVoice: (id: string) => void;
  lang: 'uz' | 'ru';
}

export const VoicesManagerTab: React.FC<VoicesManagerTabProps> = ({
  voices,
  selectedVoiceId,
  onSelectVoice,
  onAddOrEditVoice,
  onDeleteVoice,
  lang,
}) => {
  const [testingVoiceId, setTestingVoiceId] = useState<string | null>(null);
  const [audioInstance, setAudioInstance] = useState<HTMLAudioElement | null>(null);

  const handleTestVoice = async (voice: VoiceProfile) => {
    if (testingVoiceId === voice.id && audioInstance) {
      audioInstance.pause();
      setTestingVoiceId(null);
      return;
    }

    setTestingVoiceId(voice.id);
    try {
      const sampleText =
        lang === 'uz'
          ? `Salom! Men ${voice.name}man. O'zbek tilida sifatli va qiziqarli podkast yaratishga tayyorman.`
          : `Здравствуйте! Это ${voice.name} в Gemini 3.8 Flash TTS.`;

      const res = await fetch('/api/podcast/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: sampleText,
          voiceProfile: {
            voiceName: voice.name,
            voiceId: voice.voiceId || voice.id,
            baseVoice: voice.baseVoice,
            timbre: voice.timbre,
            tempo: voice.tempo,
            customPersonaPrompt: voice.customPersonaPrompt,
          },
          speechStyle: voice.style,
        }),
      });

      if (!res.ok) throw new Error('Test sintez xatosi');
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
        setAudioInstance(audio);
        audio.onended = () => setTestingVoiceId(null);
        audio.onerror = () => setTestingVoiceId(null);
        await audio.play();
      }
    } catch (err: any) {
      alert(`Ovoz testida xatolik: ${err.message}`);
      setTestingVoiceId(null);
    }
  };

  const userCustomVoices = voices.filter((v) => v.isUserCustomVoice);
  const catalogVoices = voices.filter((v) => !v.isUserCustomVoice);

  return (
    <div className="space-y-8">
      {/* Banner */}
      <div className="bg-gradient-to-r from-zinc-900 via-zinc-900/90 to-zinc-950 border border-zinc-800 rounded-3xl p-5 sm:p-7 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 flex items-center gap-1.5">
              <Mic2 className="w-3.5 h-3.5 text-cyan-400" />
              Gemini 3.8 TTS Live • Voice Replication
            </span>
            <span className="text-xs text-zinc-500">•</span>
            <span className="text-xs text-zinc-400">{voices.length} {lang === 'uz' ? 'ta ovoz profili' : 'голосов'}</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white mt-1">
            {lang === 'uz' ? 'Ovozlar Boshqaruvi & Voice Replication' : 'Управление Голосами & Voice Replication'}
          </h2>
          <p className="text-xs sm:text-sm text-zinc-400 mt-1 max-w-xl">
            {lang === 'uz'
              ? 'Google AI Studio-da yaratilgan shaxsiy ovozingizni ulang, sinab ko\'ring va podkastlaringiz uchun tanlang.'
              : 'Подключайте свою голосовую копию из Google AI Studio, тестируйте звучание и используйте для озвучивания.'}
          </p>
        </div>

        <button
          onClick={() => onAddOrEditVoice()}
          className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-zinc-950 font-bold text-sm shadow-lg shadow-cyan-500/20 transition-all hover:scale-105 active:scale-95 self-start sm:self-center"
        >
          <Plus className="w-4 h-4 stroke-[3]" />
          <span>{lang === 'uz' ? 'Ovoz Qo\'shish / Import' : 'Добавить Голос'}</span>
        </button>
      </div>

      {/* Section 1: User Replicated & Custom Voices */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Fingerprint className="w-5 h-5 text-emerald-400" />
          <h3 className="text-base sm:text-lg font-bold text-white">
            {lang === 'uz' ? 'Sizning Shaxsiy Ovoz Nusxalaringiz (Voice Replication)' : 'Ваши Персональные Голоса (Voice Replication)'}
          </h3>
          <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
            {userCustomVoices.length}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {userCustomVoices.map((voice) => {
            const isSelected = voice.id === selectedVoiceId;
            const isTesting = testingVoiceId === voice.id;

            return (
              <div
                key={voice.id}
                className={`rounded-2xl p-5 border flex flex-col justify-between transition-all ${
                  isSelected
                    ? 'bg-gradient-to-b from-zinc-900 to-zinc-950 border-cyan-500 ring-2 ring-cyan-500/20 shadow-xl'
                    : 'bg-zinc-900/60 border-zinc-800 hover:border-zinc-700'
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-emerald-500 text-zinc-950 flex items-center justify-center font-bold text-sm shadow-md shadow-cyan-500/20">
                        <Fingerprint className="w-5 h-5 stroke-[2.5]" />
                      </div>
                      <div>
                        <h4 className="font-bold text-white text-sm sm:text-base">{voice.name}</h4>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[10px] font-bold px-2 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                            Replicated Voice
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {voice.voiceId && (
                    <div className="text-[11px] font-mono text-cyan-300 bg-zinc-950 px-2.5 py-1 rounded-lg border border-zinc-800 flex items-center justify-between">
                      <span>ID:</span>
                      <span className="font-bold">{voice.voiceId}</span>
                    </div>
                  )}

                  {/* Timbre & Tempo */}
                  <div className="space-y-1 text-xs text-zinc-300">
                    <div className="flex items-center gap-1.5 text-zinc-400">
                      <span className="font-semibold text-zinc-300">{lang === 'uz' ? 'Tembr:' : 'Тембр:'}</span>
                      <span className="truncate">{voice.timbre}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-zinc-400">
                      <span className="font-semibold text-zinc-300">{lang === 'uz' ? 'Uslub:' : 'Стиль:'}</span>
                      <span className="truncate">{voice.style}</span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="pt-4 mt-4 border-t border-zinc-800/80 flex items-center justify-between gap-2">
                  <button
                    onClick={() => handleTestVoice(voice)}
                    disabled={isTesting}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                      isTesting
                        ? 'bg-amber-500 text-zinc-950 animate-pulse'
                        : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700'
                    }`}
                  >
                    {isTesting ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                    <span>{isTesting ? 'Sintez...' : 'Sinash'}</span>
                  </button>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => onAddOrEditVoice(voice)}
                      className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
                      title="Tahrirlash"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => onSelectVoice(voice.id)}
                      className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                        isSelected
                          ? 'bg-emerald-500 text-zinc-950 shadow-md shadow-emerald-500/20'
                          : 'bg-cyan-500 hover:bg-cyan-400 text-zinc-950'
                      }`}
                    >
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                      <span>{isSelected ? (lang === 'uz' ? 'Faol Ovoz' : 'Активен') : (lang === 'uz' ? 'Tanlash' : 'Выбрать')}</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Section 2: Catalog Voices */}
      <div className="space-y-4 pt-4 border-t border-zinc-900">
        <div className="flex items-center gap-2">
          <Mic2 className="w-5 h-5 text-cyan-400" />
          <h3 className="text-base sm:text-lg font-bold text-white">
            {lang === 'uz' ? 'Standart Gemini 3.8 Ovozlar Katalogi' : 'Стандартный Каталог Голосов Gemini 3.8'}
          </h3>
          <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-zinc-800 text-zinc-400">
            {catalogVoices.length}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {catalogVoices.map((voice) => {
            const isSelected = voice.id === selectedVoiceId;
            const isTesting = testingVoiceId === voice.id;

            return (
              <div
                key={voice.id}
                className={`rounded-2xl p-5 border flex flex-col justify-between transition-all ${
                  isSelected
                    ? 'bg-zinc-900 border-cyan-500 ring-2 ring-cyan-500/20 shadow-xl'
                    : 'bg-zinc-900/60 border-zinc-800 hover:border-zinc-700'
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-9 rounded-xl bg-zinc-800 text-zinc-300 flex items-center justify-center font-bold text-sm">
                        🎙️
                      </div>
                      <div>
                        <h4 className="font-bold text-white text-sm sm:text-base">{voice.name}</h4>
                        <p className="text-[11px] text-zinc-400">
                          {voice.baseVoice} • {voice.pitchLevel}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Timbre & Tempo */}
                  <div className="space-y-1 text-xs text-zinc-300">
                    <div className="flex items-center gap-1.5 text-zinc-400">
                      <span className="font-semibold text-zinc-300">{lang === 'uz' ? 'Tembr:' : 'Тембр:'}</span>
                      <span className="truncate">{voice.timbre}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-zinc-400">
                      <span className="font-semibold text-zinc-300">{lang === 'uz' ? 'Uslub:' : 'Стиль:'}</span>
                      <span className="truncate">{voice.style}</span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="pt-4 mt-4 border-t border-zinc-800/80 flex items-center justify-between gap-2">
                  <button
                    onClick={() => handleTestVoice(voice)}
                    disabled={isTesting}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                      isTesting
                        ? 'bg-amber-500 text-zinc-950 animate-pulse'
                        : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700'
                    }`}
                  >
                    {isTesting ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                    <span>{isTesting ? 'Sintez...' : 'Sinash'}</span>
                  </button>

                  <button
                    onClick={() => onSelectVoice(voice.id)}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                      isSelected
                        ? 'bg-cyan-500 text-zinc-950 shadow-md shadow-cyan-500/20'
                        : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
                    }`}
                  >
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                    <span>{isSelected ? (lang === 'uz' ? 'Faol Ovoz' : 'Активен') : (lang === 'uz' ? 'Tanlash' : 'Выбрать')}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
