import React, { useState } from 'react';
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
} from 'lucide-react';
import { VoiceProfile, AmbientSoundscape } from '../types/podcast';

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

  const ambientOptions: { id: AmbientSoundscape; labelUz: string; labelRu: string; icon: string }[] = [
    { id: 'dutor-acoustic', labelUz: 'Milliy Dutor Navosi', labelRu: 'Узбекский дутар', icon: '🪕' },
    { id: 'lofi-beats', labelUz: 'Lo-Fi Chillhop', labelRu: 'Lo-Fi биты', icon: '🎧' },
    { id: 'comedy-jingle', labelUz: 'Quvnoq Jingle & Hazil', labelRu: 'Комедийный джингл', icon: '🎺' },
    { id: 'cinematic-dark', labelUz: 'Sirli Detektiv Drone', labelRu: 'Мрачный эмбиент', icon: '🕯️' },
    { id: 'calm-piano', labelUz: 'Sokin Pianino', labelRu: 'Спокойное пианино', icon: '🎹' },
    { id: 'tech-ambient', labelUz: 'Texno & Kelajak Arp', labelRu: 'Техно-эмбиент', icon: '⚡' },
    { id: 'none', labelUz: 'Musiqasiz (Toza ovoz)', labelRu: 'Без музыки (чистый голос)', icon: '🔇' },
  ];

  // Play instant sample of current active voice
  const handlePlayVoiceSample = async () => {
    if (isPlayingSample && audioInstance) {
      audioInstance.pause();
      setIsPlayingSample(false);
      return;
    }

    try {
      setIsPlayingSample(true);
      const sampleText =
        lang === 'uz'
          ? `Salom! Men ${currentVoice.name}man. O'zbek tilida sifatli va qiziqarli podkast yaratishga tayyorman.`
          : `Здравствуйте! Это ${currentVoice.name}. Я готов озвучить ваш подкаст на узбекском языке.`;

      const res = await fetch('/api/podcast/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: sampleText,
          voiceProfile: {
            voiceName: currentVoice.name,
            voiceId: currentVoice.voiceId || currentVoice.id,
            baseVoice: currentVoice.baseVoice,
            timbre: timbre || currentVoice.timbre,
            tempo: `${tempo}x`,
            customPersonaPrompt: currentVoice.customPersonaPrompt,
          },
          speechStyle: style,
        }),
      });

      if (!res.ok) throw new Error('Ovoz sintezida xatolik');
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
        audio.onended = () => setIsPlayingSample(false);
        audio.onerror = () => setIsPlayingSample(false);
        await audio.play();
      }
    } catch (err: any) {
      alert(`Ovozni sinashda xatolik: ${err.message}`);
      setIsPlayingSample(false);
    }
  };

  return (
    <div className="bg-zinc-900/80 border border-zinc-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-zinc-800">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
            <Sliders className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-white text-base">
              {lang === 'uz' ? 'Ovoz va Sintez Sozlamalari' : 'Настройки Озвучивания'}
            </h3>
            <p className="text-xs text-zinc-400">
              {lang === 'uz' ? 'Gemini 3.8 TTS Live • Voice Replication' : 'Gemini 3.8 TTS Live • Voice Replication'}
            </p>
          </div>
        </div>

        {/* Add/Import Voice button */}
        <button
          onClick={() => onOpenVoiceStudio()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-xs font-semibold transition-all hover:scale-105 active:scale-95"
        >
          <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
          <span>{lang === 'uz' ? 'Ovoz qo\'shish' : 'Добавить голос'}</span>
        </button>
      </div>

      {/* Active Voice Card with Audio Test Button */}
      <div className="p-4 rounded-2xl bg-gradient-to-r from-zinc-950 via-zinc-900 to-zinc-950 border border-cyan-500/30 shadow-lg space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 text-zinc-950 flex items-center justify-center font-bold text-lg shadow-md shadow-cyan-500/20">
              {currentVoice.isReplicatedVoice ? <Fingerprint className="w-5 h-5" /> : <Mic2 className="w-5 h-5" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-bold text-white text-sm sm:text-base">{currentVoice.name}</h4>
                {currentVoice.isReplicatedVoice && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" />
                    Haqiqiy Voice Replication
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                {currentVoice.voiceId ? (
                  <span className="font-mono text-zinc-300">ID: {currentVoice.voiceId}</span>
                ) : (
                  <span>Standart Gemini 3.8 Ovoz</span>
                )}
              </p>
            </div>
          </div>

          <button
            onClick={handlePlayVoiceSample}
            disabled={isPlayingSample}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold text-xs transition-all ${
              isPlayingSample
                ? 'bg-amber-500 text-zinc-950 animate-pulse'
                : 'bg-cyan-500 hover:bg-cyan-400 text-zinc-950 shadow-md shadow-cyan-500/20 hover:scale-105'
            }`}
          >
            {isPlayingSample ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
            <span>{isPlayingSample ? 'Tinglanmoqda...' : 'Ovozni sinash'}</span>
          </button>
        </div>

        <div className="text-[11px] text-zinc-400 bg-zinc-900/80 p-2.5 rounded-xl border border-zinc-800 flex items-center justify-between">
          <span>{currentVoice.timbre}</span>
          <button
            onClick={() => onOpenVoiceStudio(currentVoice)}
            className="text-cyan-400 hover:text-cyan-300 font-semibold underline decoration-dotted"
          >
            {lang === 'uz' ? 'Tahrirlash' : 'Настроить'}
          </button>
        </div>
      </div>

      {/* Voice Selection (Registered Voices) */}
      <div className="space-y-2">
        <label className="block text-xs font-semibold text-zinc-300 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <UserCheck className="w-3.5 h-3.5 text-cyan-400" />
            {lang === 'uz' ? 'Ro\'yxatdagi ovozlar' : 'Список доступных голосов'}
          </span>
          <span className="text-[10px] text-zinc-500">{voices.length} ta mavjud</span>
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
                    ? 'bg-cyan-500/10 border-cyan-500 ring-1 ring-cyan-500/30'
                    : 'bg-zinc-950/80 border-zinc-800 hover:border-zinc-700'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                        isSelected ? 'bg-cyan-500 text-zinc-950' : 'bg-zinc-800 text-zinc-300'
                      }`}
                    >
                      {v.isReplicatedVoice ? '⭐' : '🎙️'}
                    </div>
                    <div className="truncate">
                      <div className="font-semibold text-xs text-white truncate flex items-center gap-1">
                        <span>{v.name}</span>
                      </div>
                      <div className="text-[10px] text-zinc-400 truncate">
                        {v.voiceId ? `ID: ${v.voiceId}` : v.baseVoice}
                      </div>
                    </div>
                  </div>
                  {isSelected && <Check className="w-4 h-4 text-cyan-400 shrink-0" />}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Speech Tempo Slider */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
            <Gauge className="w-3.5 h-3.5 text-cyan-400" />
            <span>{lang === 'uz' ? 'Nutq Tempi (Tezligi)' : 'Темп Речи (Скорость)'}</span>
          </label>
          <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-md bg-zinc-800 text-cyan-300 border border-zinc-700">
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
          className="w-full accent-cyan-400 h-1.5 bg-zinc-800 rounded-lg cursor-pointer"
        />

        <div className="flex justify-between text-[10px] text-zinc-400">
          <span>0.75x (Vazmin)</span>
          <span>1.0x (Standart)</span>
          <span>1.35x (Tezkor)</span>
        </div>
      </div>

      {/* Timbre / Tone Selector */}
      <div className="space-y-2">
        <label className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
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
                    ? 'bg-cyan-500/10 border-cyan-500 text-white shadow-sm'
                    : 'bg-zinc-950 border-zinc-800/80 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                }`}
              >
                <div className="font-semibold text-xs text-white">
                  {lang === 'uz' ? opt.labelUz : opt.labelRu}
                </div>
                <div className="text-[10px] text-zinc-400 truncate mt-0.5">{opt.descUz}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Style & Emotion Selector */}
      <div className="space-y-2">
        <label className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
          <Volume2 className="w-3.5 h-3.5 text-cyan-400" />
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
                className={`p-2 rounded-xl border text-center text-xs font-semibold transition-all ${
                  isSelected
                    ? 'bg-cyan-500 text-zinc-950 font-bold border-cyan-400 shadow-md shadow-cyan-500/20'
                    : 'bg-zinc-950 border-zinc-800/80 text-zinc-300 hover:border-zinc-700'
                }`}
              >
                {lang === 'uz' ? opt.labelUz : opt.labelRu}
              </button>
            );
          })}
        </div>
      </div>

      {/* Ambient Soundscape Selection */}
      <div className="space-y-3 pt-2 border-t border-zinc-800/80">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
            <Music className="w-3.5 h-3.5 text-cyan-400" />
            <span>{lang === 'uz' ? 'Fon Musiqasi (Ambient Sound)' : 'Фоновая Музыка'}</span>
          </label>
          {ambientSound !== 'none' && (
            <span className="text-xs font-mono text-zinc-400">
              {ambientVolume}% ovoz
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {ambientOptions.map((opt) => {
            const isSelected = ambientSound === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => onChangeAmbientSound(opt.id)}
                className={`p-2 rounded-xl border text-left flex items-center gap-2 transition-all ${
                  isSelected
                    ? 'bg-cyan-500/15 border-cyan-500 text-white font-semibold'
                    : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                }`}
              >
                <span className="text-base">{opt.icon}</span>
                <span className="text-xs truncate">{lang === 'uz' ? opt.labelUz : opt.labelRu}</span>
              </button>
            );
          })}
        </div>

        {ambientSound !== 'none' && (
          <div className="space-y-1 pt-1">
            <div className="flex justify-between text-[10px] text-zinc-400">
              <span>Musiqa balandligi</span>
              <span>{ambientVolume}%</span>
            </div>
            <input
              type="range"
              min="5"
              max="50"
              step="5"
              value={ambientVolume}
              onChange={(e) => onChangeAmbientVolume(parseInt(e.target.value, 10))}
              className="w-full accent-cyan-400 h-1.5 bg-zinc-800 rounded-lg cursor-pointer"
            />
          </div>
        )}
      </div>
    </div>
  );
};
