import React, { useState, useEffect } from 'react';
import {
  Sliders,
  Volume2,
  Mic2,
  Gauge,
  Sparkles,
  Music,
  Plus,
  Edit2,
  Check,
  Radio,
  UserCheck,
  Play,
  Pause,
  ShieldCheck,
  Fingerprint,
  Headphones,
} from 'lucide-react';
import { VoiceProfile, AmbientSoundscape } from '../types/podcast';
import { getVoicePreviewUrl } from '../data/voicePreviews';
import { AMBIENT_SOUNDSCAPES } from '../data/ambientSoundscapes';
import { playAmbientPreview, stopAmbientPreview } from '../utils/audioUtils';
import { VoiceMandala } from './VoiceMandala';
import { connectAudioElement } from '../utils/audioReactive';

interface VoiceSettingsPanelProps {
  voices: VoiceProfile[];
  selectedVoiceId: string;
  onSelectVoice: (voiceId: string) => void;
  onOpenVoiceStudio: (voice?: VoiceProfile) => void;
  // Speech controls
  tempo: number; // 0.75 - 1.35
  onChangeTempo: (val: number) => void;
  timbre: string;
  onChangeTimbre: (val: string) => void;
  style: string;
  onChangeStyle: (val: string) => void;
  ambientSound: AmbientSoundscape;
  onChangeAmbientSound: (val: AmbientSoundscape) => void;
  ambientVolume: number;
  onChangeAmbientVolume: (val: number) => void;
  lang: 'uz' | 'ru';
}

export const VoiceSettingsPanel: React.FC<VoiceSettingsPanelProps> = ({
  voices,
  selectedVoiceId,
  onSelectVoice,
  onOpenVoiceStudio,
  tempo,
  onChangeTempo,
  timbre,
  onChangeTimbre,
  style,
  onChangeStyle,
  ambientSound,
  onChangeAmbientSound,
  ambientVolume,
  onChangeAmbientVolume,
  lang,
}) => {
  const currentVoice = voices.find((v) => v.id === selectedVoiceId) || voices[0];
  const [isPlayingSample, setIsPlayingSample] = useState(false);
  const [audioInstance, setAudioInstance] = useState<HTMLAudioElement | null>(null);

  const [previewingSoundscape, setPreviewingSoundscape] = useState<AmbientSoundscape | null>(null);

  useEffect(() => {
    return () => {
      stopAmbientPreview();
    };
  }, []);

  const handleTogglePreviewAmbient = (soundId: AmbientSoundscape, e: React.MouseEvent) => {
    e.stopPropagation();
    if (previewingSoundscape === soundId) {
      stopAmbientPreview();
      setPreviewingSoundscape(null);
    } else {
      stopAmbientPreview();
      playAmbientPreview(soundId, ambientVolume);
      setPreviewingSoundscape(soundId);
    }
  };

  const timbreOptions = [
    { id: 'Iliq va salobatli boy bariton', labelUz: 'Iliq boy bariton', labelRu: 'Теплый баритон', descUz: 'Podkastlar uchun ideal salobatli ovoz' },
    { id: 'Chuqur jarangdor bas', labelUz: 'Chuqur bas', labelRu: 'Глубокий бас', descUz: 'Tarixiy va jiddiy mavzular' },
    { id: 'Yorqin va jarangdor tenor', labelUz: 'Yorqin tenor', labelRu: 'Яркий тенор', descUz: 'Quvnoq, chaqqon va komedik' },
    { id: 'Mayin va samimiy soprano', labelUz: 'Mayin soprano', labelRu: 'Мягкое сопрано', descUz: 'Tinchlantiruvchi va muloyim' },
    { id: 'Neytral va professional studio tembri', labelUz: 'Neytral studio', labelRu: 'Нейтральный', descUz: 'IT, yangiliklar va ta\'lim' },
  ];

  const styleOptions = [
    { id: 'Jiddiy & Samimiy hikoyanavis', labelUz: 'Jiddiy hikoyanavis', labelRu: 'Серьезный рассказчик' },
    { id: 'Hujjatli & Epik hikoya', labelUz: 'Hujjatli & Epik', labelRu: 'Документальный / Эпик' },
    { id: 'Quvnoq & Hazilomuz suhbat', labelUz: 'Quvnoq & Kulgili', labelRu: 'Комедийный / Живой' },
    { id: 'Tahliliy & Ekspert ilmiy', labelUz: 'Tahliliy & Ilmiy', labelRu: 'Экспертный / Научный' },
    { id: 'Tinchlantiruvchi & Ruhiy', labelUz: 'Tinchlantiruvchi', labelRu: 'Успокаивающий / Релакс' },
    { id: 'Dramatik & Sirli', labelUz: 'Dramatik & Detektiv', labelRu: 'Драматический / Детектив' },
  ];

  // Play instant sample of current active voice (Built-in, Zero token consumption)
  const handlePlayVoiceSample = async () => {
    if (isPlayingSample && audioInstance) {
      audioInstance.pause();
      setIsPlayingSample(false);
      return;
    }

    if (audioInstance) {
      audioInstance.pause();
    }

    try {
      setIsPlayingSample(true);
      const previewUrl =
        currentVoice.sampleAudioUrl ||
        getVoicePreviewUrl(currentVoice.id) ||
        `/api/voices/preview/${currentVoice.id}`;

      const audio = new Audio(previewUrl);
      setAudioInstance(audio);
      connectAudioElement(audio);
      audio.onended = () => setIsPlayingSample(false);
      audio.onerror = () => {
        if (previewUrl !== `/api/voices/preview/${currentVoice.id}`) {
          audio.src = `/api/voices/preview/${currentVoice.id}`;
          connectAudioElement(audio);
          audio.play().catch(() => setIsPlayingSample(false));
        } else {
          setIsPlayingSample(false);
        }
      };
      await audio.play();
    } catch {
      setIsPlayingSample(false);
    }
  };

  return (
    <div className="bg-white/80 border border-[rgba(22,21,17,0.14)] rounded-[24px] p-5 sm:p-6 shadow-[0_20px_40px_-20px_rgba(22,21,17,0.18)] backdrop-blur-md space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-[rgba(22,21,17,0.1)]">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-[#0E7C86]/10 text-[#0E7C86] border border-[#0E7C86]/25">
            <Sliders className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-serif text-lg text-[#161511]">
              {lang === 'uz' ? 'Ovoz va Sintez Sozlamalari' : 'Настройки Озвучивания'}
            </h3>
            <p className="font-mono text-[11px] uppercase tracking-wider text-[#5D594E]">
              {lang === 'uz' ? 'Ovoz tembri, tezligi va saundtrek' : 'Тембр, темп и музыка'}
            </p>
          </div>
        </div>

        {/* Add/Import Voice button */}
        <button
          onClick={() => onOpenVoiceStudio()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#161511] text-[#F4F1EA] hover:bg-[#0A5A62] text-xs font-medium transition-all cursor-pointer shadow-xs"
        >
          <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
          <span>{lang === 'uz' ? 'Ovoz qo\'shish' : 'Добавить голос'}</span>
        </button>
      </div>

      {/* Active Voice Card with Audio Test Button & Real Audio-Reactive Voice Mandala */}
      <div className="p-5 rounded-2xl bg-white border border-[rgba(22,21,17,0.12)] shadow-xs space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#0E7C86] text-white flex items-center justify-center font-bold text-lg shadow-sm">
              {currentVoice.isReplicatedVoice ? <Fingerprint className="w-5 h-5" /> : <Mic2 className="w-5 h-5" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-serif text-base text-[#161511]">{currentVoice.name}</h4>
                {currentVoice.isReplicatedVoice && (
                  <span className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#0E7C86]/10 text-[#0E7C86] border border-[#0E7C86]/25 flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" />
                    Klonlangan
                  </span>
                )}
              </div>
              <p className="text-xs text-[#5D594E] mt-0.5">
                <span>{currentVoice.timbre || 'Professional diktor'}</span>
              </p>
            </div>
          </div>

          <button
            onClick={handlePlayVoiceSample}
            disabled={isPlayingSample}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-full font-medium text-xs transition-all cursor-pointer ${
              isPlayingSample
                ? 'bg-[#0E7C86] text-white animate-pulse'
                : 'bg-[#161511] text-[#F4F1EA] hover:bg-[#0A5A62] shadow-xs'
            }`}
          >
            {isPlayingSample ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
            <span>{isPlayingSample ? (lang === 'uz' ? 'Tinglanmoqda...' : 'Играет...') : (lang === 'uz' ? 'Ovozni sinash' : 'Тест голоса')}</span>
          </button>
        </div>

        {/* Real Audio-Reactive Voice Mandala (420x420 canvas centered) */}
        <div className="relative py-2 px-1 flex flex-col items-center justify-center bg-[#F4F1EA]/65 rounded-2xl border border-[rgba(22,21,17,0.08)] overflow-hidden">
          <div className="w-full flex items-center justify-between px-3 text-[10px] font-mono uppercase tracking-wider text-[#5D594E]">
            <span className="flex items-center gap-1.5 text-[#0E7C86] font-semibold">
              <span className={`w-2 h-2 rounded-full ${isPlayingSample ? 'bg-[#C4552D] pulse-teal-dot' : 'bg-[#0E7C86]'}`} />
              {isPlayingSample
                ? lang === 'uz' ? 'Jonli Sintez (Web Audio)' : 'Живой синтез (Web Audio)'
                : lang === 'uz' ? 'Ovoz Mandalasi (48 Radial Bar)' : 'Голосовая Мандала (48 Баров)'}
            </span>
            <span className="text-[10px] text-[#7D7A70] lowercase">
              {isPlayingSample ? 'fft: 512 • .78 smooth' : 'nafas olish holatida'}
            </span>
          </div>

          <VoiceMandala
            size={420}
            voiceName={currentVoice.name}
            className="w-full max-w-[340px] sm:max-w-[400px]"
          />

          <div className="w-full flex items-center justify-between px-3 pt-0.5 text-[11px] font-mono text-[#5D594E]">
            <span className="truncate max-w-[220px]">{currentVoice.timbre}</span>
            <span className="text-[#0E7C86] font-semibold">{currentVoice.baseVoice || 'Gemini 3.8'}</span>
          </div>
        </div>

        <div className="text-[11px] text-[#5D594E] bg-[#ECE7DB]/50 p-2.5 rounded-xl border border-[rgba(22,21,17,0.08)] flex items-center justify-between">
          <span>{currentVoice.timbre}</span>
          <button
            onClick={() => onOpenVoiceStudio(currentVoice)}
            className="text-[#0E7C86] hover:text-[#0A5A62] font-semibold underline decoration-dotted cursor-pointer"
          >
            {lang === 'uz' ? 'Tahrirlash' : 'Настроить'}
          </button>
        </div>
      </div>

      {/* Voice Selection (Registered Voices) */}
      <div className="space-y-2">
        <label className="text-xs font-mono uppercase tracking-wider text-[#5D594E] flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <UserCheck className="w-3.5 h-3.5 text-[#0E7C86]" />
            {lang === 'uz' ? 'Ro\'yxatdagi ovozlar' : 'Список доступных голосов'}
          </span>
          <span className="text-[10px] text-[#7D7A70]">{voices.length} ta mavjud</span>
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
          {voices.map((v) => {
            const isSelected = v.id === selectedVoiceId;
            return (
              <div
                key={v.id}
                onClick={() => onSelectVoice(v.id)}
                className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                  isSelected
                    ? 'bg-[#161511] text-[#F4F1EA] border-[#161511] shadow-xs'
                    : 'bg-white border-[rgba(22,21,17,0.12)] hover:border-[#161511] text-[#161511]'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                        isSelected ? 'bg-white/20 text-[#F4F1EA]' : 'bg-[#ECE7DB] text-[#161511]'
                      }`}
                    >
                      {v.isReplicatedVoice ? '⭐' : '🎙️'}
                    </div>
                    <div className="truncate">
                      <div className={`font-semibold text-xs truncate flex items-center gap-1 ${isSelected ? 'text-[#F4F1EA]' : 'text-[#161511]'}`}>
                        <span>{v.name}</span>
                      </div>
                      <div className={`text-[10px] truncate ${isSelected ? 'text-[#EDEAE2]/70' : 'text-[#7D7A70]'}`}>
                        {v.isReplicatedVoice ? 'Klonlangan ovoz' : v.timbre || 'Studiya diktori'}
                      </div>
                    </div>
                  </div>
                  {isSelected && <Check className="w-4 h-4 text-[#5CC8CF] shrink-0" />}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Speech Tempo Slider */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-mono uppercase tracking-wider text-[#5D594E] flex items-center gap-1.5">
            <Gauge className="w-3.5 h-3.5 text-[#0E7C86]" />
            <span>{lang === 'uz' ? 'Nutq Tempi (Tezligi)' : 'Темп Речи (Скорость)'}</span>
          </label>
          <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-md bg-[#ECE7DB] text-[#0A5A62] border border-[rgba(22,21,17,0.1)]">
            {tempo.toFixed(2)}x
          </span>
        </div>

        <input
          type="range"
          min="0.75"
          max="1.35"
          step="0.05"
          value={tempo}
          onChange={(e) => onChangeTempo(parseFloat(e.target.value))}
          className="w-full accent-[#0E7C86] h-1.5 bg-[#ECE7DB] rounded-lg cursor-pointer"
        />

        <div className="flex justify-between text-[10px] font-mono text-[#7D7A70]">
          <span>0.75x (Vazmin)</span>
          <span>1.0x (Standart)</span>
          <span>1.35x (Tezkor)</span>
        </div>
      </div>

      {/* Timbre / Tone Selector */}
      <div className="space-y-2">
        <label className="text-xs font-mono uppercase tracking-wider text-[#5D594E] flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-[#C4552D]" />
          <span>{lang === 'uz' ? 'Ovoz Tembri va Ohangi' : 'Тембр и Оттенок Голоса'}</span>
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {timbreOptions.map((opt) => {
            const isSelected = timbre === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => onChangeTimbre(opt.id)}
                className={`p-2.5 rounded-xl border text-left transition-all ${
                  isSelected
                    ? 'bg-[#161511] text-[#F4F1EA] border-[#161511] shadow-xs'
                    : 'bg-white border-[rgba(22,21,17,0.12)] text-[#5D594E] hover:border-[#161511] hover:text-[#161511]'
                }`}
              >
                <div className={`font-semibold text-xs ${isSelected ? 'text-[#F4F1EA]' : 'text-[#161511]'}`}>
                  {lang === 'uz' ? opt.labelUz : opt.labelRu}
                </div>
                <div className={`text-[10px] truncate mt-0.5 ${isSelected ? 'text-[#EDEAE2]/70' : 'text-[#7D7A70]'}`}>{opt.descUz}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Style & Emotion Selector */}
      <div className="space-y-2">
        <label className="text-xs font-mono uppercase tracking-wider text-[#5D594E] flex items-center gap-1.5">
          <Volume2 className="w-3.5 h-3.5 text-[#0E7C86]" />
          <span>{lang === 'uz' ? 'Ijro Uslubi va Kayfiyati' : 'Стиль и Настроение Озвучки'}</span>
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {styleOptions.map((opt) => {
            const isSelected = style === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => onChangeStyle(opt.id)}
                className={`p-2 rounded-full border text-center text-xs font-semibold transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-[#161511] text-[#F4F1EA] border-[#161511] shadow-xs'
                    : 'bg-white border-[rgba(22,21,17,0.12)] text-[#5D594E] hover:border-[#161511]'
                }`}
              >
                {lang === 'uz' ? opt.labelUz : opt.labelRu}
              </button>
            );
          })}
        </div>
      </div>

      {/* AI Sound Director & Soundtrack Selection */}
      <div className="space-y-3 pt-3 border-t border-[rgba(22,21,17,0.1)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-[#0E7C86]/10 text-[#0E7C86] flex items-center justify-center">
              <Headphones className="w-3.5 h-3.5" />
            </div>
            <div>
              <span className="text-xs font-bold text-[#161511] block">
                {lang === 'uz' ? 'AI Ovoz Rejissyori & Saundtrek' : 'AI Звукорежиссёр и Саундтрек'}
              </span>
              <span className="text-[10px] text-[#7D7A70]">
                {lang === 'uz' ? 'Dinamik Ducking (Nutq paytida musiqa pasayadi)' : 'Авто-приглушение Ducking во время речи'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {previewingSoundscape && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#0E7C86]/15 text-[#0A5A62] border border-[#0E7C86]/30 flex items-center gap-1 animate-pulse">
                {lang === 'uz' ? 'Tinglanmoqda...' : 'Играет...'}
              </span>
            )}
            {ambientSound !== 'none' && (
              <span className="text-[11px] font-mono text-[#0A5A62] font-bold bg-[#ECE7DB] px-2 py-0.5 rounded-md border border-[rgba(22,21,17,0.1)]">
                {ambientVolume}%
              </span>
            )}
          </div>
        </div>

        {/* 6 Clean Soundscape Presets */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {[
            { id: 'calm-piano' as AmbientSoundscape, icon: '🎹', labelUz: 'Neoklassik Pianino', labelRu: 'Пианино' },
            { id: 'midnight-jazz' as AmbientSoundscape, icon: '🎷', labelUz: 'Tungi Djaz', labelRu: 'Джаз' },
            { id: 'lofi-beats' as AmbientSoundscape, icon: '☕', labelUz: 'Lo-Fi Hip-Hop', labelRu: 'Lo-Fi' },
            { id: 'tech-ambient' as AmbientSoundscape, icon: '🚀', labelUz: 'Tech & Startap', labelRu: 'Tech Эмбиент' },
            { id: 'nature-ambient' as AmbientSoundscape, icon: '🌲', labelUz: 'Tabiat & Tinchlik', labelRu: 'Природа' },
            { id: 'none' as AmbientSoundscape, icon: '🤫', labelUz: 'Toza Sukunat (Dry)', labelRu: 'Без музыки' },
          ].map((item) => {
            const isSelected = ambientSound === item.id;
            const isPreviewing = previewingSoundscape === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onChangeAmbientSound(item.id);
                  if (item.id !== 'none') {
                    playAmbientPreview(item.id, ambientVolume);
                    setPreviewingSoundscape(item.id);
                  } else {
                    stopAmbientPreview();
                    setPreviewingSoundscape(null);
                  }
                }}
                className={`p-2.5 rounded-xl border text-left flex items-center justify-between gap-1.5 transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-[#161511] text-[#F4F1EA] border-[#161511] shadow-xs'
                    : 'bg-white border-[rgba(22,21,17,0.12)] text-[#5D594E] hover:border-[#161511]'
                }`}
              >
                <div className="flex items-center gap-1.5 truncate">
                  <span className="text-base">{item.icon}</span>
                  <span className={`text-xs font-semibold truncate ${isSelected ? 'text-[#F4F1EA]' : 'text-[#161511]'}`}>
                    {lang === 'uz' ? item.labelUz : item.labelRu}
                  </span>
                </div>
                {item.id !== 'none' && isPreviewing && (
                  <span className="w-2 h-2 rounded-full bg-[#0E7C86] animate-ping shrink-0" />
                )}
              </button>
            );
          })}
        </div>

        {/* Master Volume Slider with Ducking Hint */}
        {ambientSound !== 'none' && (
          <div className="space-y-1.5 pt-2 bg-white/70 p-3 rounded-xl border border-[rgba(22,21,17,0.12)]">
            <div className="flex justify-between items-center text-xs">
              <span className="text-[#5D594E] font-medium flex items-center gap-1.5">
                <Music className="w-3 h-3 text-[#C98A12]" />
                {lang === 'uz' ? 'Fon balandligi (Nutq davomida 12% ga avto-pasayadi):' : 'Громкость саундтрека (при речи авто-приглушение до 12%):'}
              </span>
              <span className="font-mono text-[#0A5A62] font-bold">{ambientVolume}%</span>
            </div>
            <input
              type="range"
              min="5"
              max="40"
              step="5"
              value={ambientVolume}
              onChange={(e) => onChangeAmbientVolume(parseInt(e.target.value, 10))}
              className="w-full accent-[#0E7C86] h-1.5 bg-[#ECE7DB] rounded-lg cursor-pointer"
            />
            <div className="flex justify-between text-[10px] font-mono text-[#7D7A70]">
              <span>5% (Juda mayin)</span>
              <span>15-20% (Ideal podkast standarti)</span>
              <span>40% (Kuchli)</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
