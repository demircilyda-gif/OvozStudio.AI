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
import { getVoicePreviewUrl } from '../data/voicePreviews';
import { VoiceGallery3D } from './VoiceGallery3D';

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

    if (audioInstance) {
      audioInstance.pause();
    }

    setTestingVoiceId(voice.id);
    try {
      const previewUrl =
        voice.sampleAudioUrl ||
        getVoicePreviewUrl(voice.id) ||
        `/api/voices/preview/${voice.id}`;

      const audio = new Audio(previewUrl);
      setAudioInstance(audio);
      audio.onended = () => setTestingVoiceId(null);
      audio.onerror = () => {
        // Fallback to API if static preview is missing
        if (previewUrl !== `/api/voices/preview/${voice.id}`) {
          audio.src = `/api/voices/preview/${voice.id}`;
          audio.play().catch(() => setTestingVoiceId(null));
        } else {
          setTestingVoiceId(null);
        }
      };
      await audio.play();
    } catch {
      setTestingVoiceId(null);
    }
  };

  const userCustomVoices = voices.filter((v) => v.isUserCustomVoice);
  const catalogVoices = voices.filter((v) => !v.isUserCustomVoice);

  return (
    <div className="space-y-8">
      {/* Banner */}
      <div className="border border-[rgba(22,21,17,0.14)] rounded-[22px] bg-[rgba(255,255,255,0.65)] backdrop-blur-md p-6 sm:p-7 shadow-[0_20px_40px_-20px_rgba(22,21,17,0.18)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-mono uppercase tracking-wider bg-[#0E7C86]/10 text-[#0E7C86] border border-[#0E7C86]/25 flex items-center gap-1.5">
              <Mic2 className="w-3.5 h-3.5 text-[#0E7C86]" />
              OvozStudio Neural Live • Voice Replication
            </span>
            <span className="text-xs text-[#7D7A70]">•</span>
            <span className="text-xs font-mono text-[#5D594E]">{voices.length} {lang === 'uz' ? 'ta ovoz profili' : 'голосов'}</span>
          </div>
          <h2 className="font-serif text-2xl sm:text-3xl text-[#161511] mt-2">
            {lang === 'uz' ? (
              <>Ovozlar Boshqaruvi & <em>Voice Replication</em></>
            ) : (
              <>Управление Голосами & <em>Voice Replication</em></>
            )}
          </h2>
          <p className="text-xs sm:text-sm text-[#5D594E] mt-1 max-w-xl">
            {lang === 'uz'
              ? 'OvozStudio-da shaxsiy replikatsiya ovozingizni ulang, sinab ko\'ring va podkastlaringiz uchun tanlang.'
              : 'Подключайте свою голосовую копию, тестируйте звучание и используйте для озвучивания.'}
          </p>
        </div>

        <button
          onClick={() => onAddOrEditVoice()}
          className="flex items-center gap-2 px-5 py-3 rounded-full bg-[#161511] hover:bg-[#0A5A62] text-[#F4F1EA] font-medium text-sm shadow-[0_10px_20px_-10px_rgba(22,21,17,0.3)] transition-all cursor-pointer self-start sm:self-center"
        >
          <Plus className="w-4 h-4 stroke-[2.5]" />
          <span>{lang === 'uz' ? 'Ovoz Qo\'shish / Import' : 'Добавить Голос'}</span>
        </button>
      </div>

      {/* 3D Voice Gallery (React Three Fiber + Drei) */}
      <VoiceGallery3D
        voices={voices}
        selectedVoiceId={selectedVoiceId}
        onSelectVoice={onSelectVoice}
        lang={lang}
        title={lang === 'uz' ? '3D Ovozlar Galereyasi' : '3D Галерея Голосов'}
        subtitle={lang === 'uz' ? '8 TA SHISHA SHAR · REACT-THREE-FIBER + DREI' : '8 СТЕКЛЯННЫХ СФЕР'}
      />

      {/* Section 1: User Replicated & Custom Voices */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Fingerprint className="w-5 h-5 text-[#0E7C86]" />
          <h3 className="font-serif text-xl text-[#161511]">
            {lang === 'uz' ? 'Sizning Shaxsiy Ovoz Nusxalaringiz (Voice Replication)' : 'Ваши Персональные Голоса (Voice Replication)'}
          </h3>
          <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-[#0E7C86]/10 text-[#0E7C86] border border-[#0E7C86]/25">
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
                className={`rounded-[20px] p-5 border flex flex-col justify-between transition-all ${
                  isSelected
                    ? 'bg-white border-[#161511] ring-2 ring-[#0E7C86]/30 shadow-[0_20px_40px_-20px_rgba(22,21,17,0.2)]'
                    : 'bg-white/70 border-[rgba(22,21,17,0.12)] hover:border-[rgba(22,21,17,0.3)]'
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="w-10 h-10 rounded-xl bg-[#0E7C86] text-white flex items-center justify-center font-bold text-sm shadow-sm">
                        <Fingerprint className="w-5 h-5 stroke-[2]" />
                      </div>
                      <div>
                        <h4 className="font-serif text-base text-[#161511]">{voice.name}</h4>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.2 rounded-full bg-[#0E7C86]/10 text-[#0E7C86] border border-[#0E7C86]/25">
                            Replicated Voice
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {voice.voiceId && (
                    <div className="text-[11px] font-mono text-[#0A5A62] bg-[#ECE7DB]/60 px-2.5 py-1 rounded-lg border border-[rgba(22,21,17,0.08)] flex items-center justify-between">
                      <span>ID:</span>
                      <span className="font-bold">{voice.voiceId}</span>
                    </div>
                  )}

                  {/* Timbre & Tempo */}
                  <div className="space-y-1 text-xs text-[#5D594E]">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-[#161511]">{lang === 'uz' ? 'Tembr:' : 'Тембр:'}</span>
                      <span className="truncate">{voice.timbre}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-[#161511]">{lang === 'uz' ? 'Uslub:' : 'Стиль:'}</span>
                      <span className="truncate">{voice.style}</span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="pt-4 mt-4 border-t border-[rgba(22,21,17,0.08)] flex items-center justify-between gap-2">
                  <button
                    onClick={() => handleTestVoice(voice)}
                    disabled={isTesting}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer ${
                      isTesting
                        ? 'bg-[#0E7C86] text-white animate-pulse'
                        : 'bg-[#ECE7DB] hover:bg-[#161511] hover:text-[#F4F1EA] text-[#161511] border border-[rgba(22,21,17,0.12)]'
                    }`}
                  >
                    {isTesting ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                    <span>{isTesting ? 'Sintez...' : 'Sinash'}</span>
                  </button>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => onAddOrEditVoice(voice)}
                      className="p-1.5 rounded-full bg-[#ECE7DB] hover:bg-[#161511] hover:text-[#F4F1EA] text-[#5D594E] transition-colors cursor-pointer"
                      title="Tahrirlash"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => onSelectVoice(voice.id)}
                      className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-[#0E7C86] text-white shadow-sm'
                          : 'bg-[#161511] hover:bg-[#0A5A62] text-[#F4F1EA]'
                      }`}
                    >
                      <Check className="w-3.5 h-3.5 stroke-[2.5]" />
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
      <div className="space-y-4 pt-4 border-t border-[rgba(22,21,17,0.1)]">
        <div className="flex items-center gap-2">
          <Mic2 className="w-5 h-5 text-[#C98A12]" />
          <h3 className="font-serif text-xl text-[#161511]">
            {lang === 'uz' ? 'Standart Neyron Ovozlar Katalogi' : 'Стандартный Каталог Нейронных Голосов'}
          </h3>
          <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-[#ECE7DB] text-[#5D594E]">
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
                className={`rounded-[20px] p-5 border flex flex-col justify-between transition-all ${
                  isSelected
                    ? 'bg-white border-[#161511] ring-2 ring-[#0E7C86]/30 shadow-[0_20px_40px_-20px_rgba(22,21,17,0.2)]'
                    : 'bg-white/70 border-[rgba(22,21,17,0.12)] hover:border-[rgba(22,21,17,0.3)]'
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-9 rounded-xl bg-[#ECE7DB] text-[#161511] flex items-center justify-center font-bold text-sm">
                        🎙️
                      </div>
                      <div>
                        <h4 className="font-serif text-base text-[#161511]">{voice.name}</h4>
                        <p className="font-mono text-[11px] text-[#7D7A70]">
                          {voice.gender === 'female' ? (lang === 'uz' ? 'Ayol ovozi' : 'Женский голос') : (lang === 'uz' ? 'Erkak ovozi' : 'Мужской голос')} • {voice.pitchLevel}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Timbre & Tempo */}
                  <div className="space-y-1 text-xs text-[#5D594E]">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-[#161511]">{lang === 'uz' ? 'Tembr:' : 'Тембр:'}</span>
                      <span className="truncate">{voice.timbre}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-[#161511]">{lang === 'uz' ? 'Uslub:' : 'Стиль:'}</span>
                      <span className="truncate">{voice.style}</span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="pt-4 mt-4 border-t border-[rgba(22,21,17,0.08)] flex items-center justify-between gap-2">
                  <button
                    onClick={() => handleTestVoice(voice)}
                    disabled={isTesting}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer ${
                      isTesting
                        ? 'bg-[#0E7C86] text-white animate-pulse'
                        : 'bg-[#ECE7DB] hover:bg-[#161511] hover:text-[#F4F1EA] text-[#161511] border border-[rgba(22,21,17,0.12)]'
                    }`}
                  >
                    {isTesting ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                    <span>{isTesting ? 'Sintez...' : 'Sinash'}</span>
                  </button>

                  <button
                    onClick={() => onSelectVoice(voice.id)}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[#0E7C86] text-white shadow-sm'
                        : 'bg-[#161511] hover:bg-[#0A5A62] text-[#F4F1EA]'
                    }`}
                  >
                    <Check className="w-3.5 h-3.5 stroke-[2.5]" />
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
