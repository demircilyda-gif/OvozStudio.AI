import React, { useState } from 'react';
import { VoiceProfile, AmbientSoundscape } from '../types/podcast';
import { VoiceCardItem } from './VoiceCardItem';
import { XYPad } from './XYPad';
import { LiveDurationCostScrubber } from './LiveDurationCostScrubber';
import { AMBIENT_SOUNDSCAPES } from '../data/ambientSoundscapes';
import { Sliders, Music, Plus, Play, Square } from 'lucide-react';
import { getVoicePreviewUrl } from '../data/voicePreviews';

interface VoiceConsoleProps {
  voices: VoiceProfile[];
  selectedVoiceId: string;
  onSelectVoice: (id: string) => void;
  onOpenVoiceStudio: () => void;
  // XY Pad controls
  tempo: number;
  onChangeTempo: (t: number) => void;
  timbreValue: number;
  onChangeTimbreValue: (tb: number) => void;
  // Scrubber controls
  wordCount: number;
  targetSeconds: number;
  onChangeTargetSeconds?: (sec: number) => void;
  isAdmin: boolean;
  // Ambient Soundscape
  ambientSound: AmbientSoundscape;
  onChangeAmbientSound: (sound: AmbientSoundscape) => void;
  ambientVolume: number;
  onChangeAmbientVolume: (vol: number) => void;
  lang: 'uz' | 'ru';
}

export const VoiceConsole: React.FC<VoiceConsoleProps> = ({
  voices,
  selectedVoiceId,
  onSelectVoice,
  onOpenVoiceStudio,
  tempo,
  onChangeTempo,
  timbreValue,
  onChangeTimbreValue,
  wordCount,
  targetSeconds,
  onChangeTargetSeconds,
  isAdmin,
  ambientSound,
  onChangeAmbientSound,
  ambientVolume,
  onChangeAmbientVolume,
  lang,
}) => {
  const [filterGender, setFilterGender] = useState<'all' | 'female' | 'male'>('all');
  const [isPlayingHero, setIsPlayingHero] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const heroAudioRef = React.useRef<HTMLAudioElement | null>(null);

  const activeVoice = voices.find((v) => v.id === selectedVoiceId) || voices[0];

  const filteredVoices = voices.filter((v) => {
    if (filterGender === 'all') return true;
    const isFemale =
      v.gender === 'female' ||
      ['Kore', 'Aoede', 'Zephyr'].includes(v.baseVoice) ||
      /aziza|madina|dilnoza|zarina|nodira|malika|sevara|shahnoza|rayhon|gulzoda|umida|nigora|feruza|ayol|жен/i.test(v.name || v.id);
    const isMale =
      v.gender === 'male' ||
      ['Charon', 'Puck', 'Fenrir'].includes(v.baseVoice) ||
      /jasur|otabek|ulugbek|farrux|bobur|javohir|sanjar|sherzod|eldor|bekzod|alisher|rustam|shokhrukh|erkak|муж/i.test(v.name || v.id);

    if (filterGender === 'female') return isFemale;
    if (filterGender === 'male') return isMale;
    return true;
  });

  const toggleHeroAudio = () => {
    if (isPlayingHero) {
      heroAudioRef.current?.pause();
      setIsPlayingHero(false);
    } else {
      const url = activeVoice.sampleAudioUrl || getVoicePreviewUrl(activeVoice.id) || `/audio/previews/${activeVoice.id}.wav`;
      if (!heroAudioRef.current) {
        heroAudioRef.current = new Audio(url);
        heroAudioRef.current.onended = () => setIsPlayingHero(false);
      } else {
        heroAudioRef.current.src = url;
      }
      heroAudioRef.current.currentTime = 0;
      heroAudioRef.current.play().then(() => setIsPlayingHero(true)).catch(() => setIsPlayingHero(false));
    }
  };

  return (
    <div className="w-full lg:w-80 xl:w-92 shrink-0 space-y-4 select-none">
      {/* Markaz Studio Panel: 02 — Ovoz va Sintez */}
      <div className="border border-[rgba(22,21,17,0.14)] rounded-[20px] bg-[rgba(255,255,255,0.65)] backdrop-blur-md p-5 space-y-4 shadow-[0_30px_50px_-30px_rgba(22,21,17,0.15)]">
        {/* Panel Header Label with Hairline */}
        <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#0A5A62]">
          <span>02 — Ovoz tanlash</span>
          <span className="h-[1px] flex-1 bg-[rgba(22,21,17,0.14)]" />
          <button
            type="button"
            onClick={onOpenVoiceStudio}
            className="text-[10px] text-[#0E7C86] hover:underline flex items-center gap-1 font-mono uppercase tracking-wider cursor-pointer"
            title={lang === 'uz' ? 'Yangi ovoz qoʻshish' : 'Добавить голос'}
          >
            <Plus className="w-3 h-3" />
            <span>{lang === 'uz' ? 'Klonlash' : 'Клон'}</span>
          </button>
        </div>

        {/* Hero Voice Card (42px radial teal tile, 48-bar waveform, test play button) */}
        <div className="border border-[rgba(22,21,17,0.14)] rounded-2xl p-4 bg-white shadow-sm space-y-3">
          <div className="flex items-center gap-3">
            {/* 42px Radial Tile */}
            <div className="w-[42px] h-[42px] rounded-[14px] bg-[radial-gradient(circle_at_30%_28%,#12a3b0,#0A5A62_78%)] text-white font-bold flex items-center justify-center shrink-0 shadow-sm relative overflow-hidden">
              <span className="relative z-10 text-xs tracking-wider">
                {activeVoice.name.slice(0, 2).toUpperCase()}
              </span>
              <div className="absolute inset-0 bg-[radial-gradient(50%_50%_at_66%_30%,rgba(255,255,255,0.4),transparent)]" />
            </div>

            <div className="min-w-0 flex-1 truncate">
              <b className="block text-sm text-[#161511] font-semibold truncate leading-tight">
                {activeVoice.name}
              </b>
              <span className="font-mono text-[10px] uppercase tracking-wider text-[#0A5A62] block mt-0.5">
                {activeVoice.isReplicatedVoice ? 'Haqiqiy shaxsiy ovoz · 0% aksent' : 'Studio Master · 24 kHz'}
              </span>
            </div>

            <button
              type="button"
              onClick={toggleHeroAudio}
              className="btn-pill btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5 shrink-0"
              title={lang === 'uz' ? 'Ovoz namunasini tinglash' : 'Слушать пример голоса'}
            >
              {isPlayingHero ? <Square className="w-3 h-3 fill-current text-[#0E7C86]" /> : <Play className="w-3 h-3 fill-current text-[#0E7C86]" />}
              <span>{isPlayingHero ? (lang === 'uz' ? 'Toʻxtatish' : 'Стоп') : (lang === 'uz' ? 'Sinash' : 'Тест')}</span>
            </button>
          </div>

          {/* Waveform visualizer */}
          <div className="flex items-center gap-[2px] h-8 pt-1">
            {Array.from({ length: 42 }).map((_, i) => {
              const h = 20 + 60 * Math.abs(Math.sin(i * 0.7) + 0.4 * Math.sin(i * 0.23 + 2));
              return (
                <span
                  key={i}
                  className={`flex-1 rounded-sm transition-all duration-200 ${
                    isPlayingHero ? 'bg-gradient-to-t from-[#0E7C86] to-[#5CC8CF]' : 'bg-[rgba(14,124,134,0.3)]'
                  }`}
                  style={{
                    height: `${isPlayingHero ? Math.min(100, h * (0.8 + 0.4 * Math.sin(i * 0.5 + Date.now() * 0.01))) : h * 0.35}%`,
                  }}
                />
              );
            })}
          </div>
        </div>

        {/* Gender Filter Tabs */}
        <div className="flex items-center bg-[#ECE7DB] rounded-full p-1 text-xs font-medium text-[#5D594E]">
          <button
            type="button"
            onClick={() => setFilterGender('all')}
            className={`flex-1 py-1 rounded-full transition-all cursor-pointer ${
              filterGender === 'all' ? 'bg-[#161511] text-[#F4F1EA] font-semibold shadow-xs' : 'hover:text-[#161511]'
            }`}
          >
            {lang === 'uz' ? 'Barchasi' : 'Все'}
          </button>
          <button
            type="button"
            onClick={() => setFilterGender('female')}
            className={`flex-1 py-1 rounded-full transition-all cursor-pointer ${
              filterGender === 'female' ? 'bg-[#161511] text-[#F4F1EA] font-semibold shadow-xs' : 'hover:text-[#161511]'
            }`}
          >
            {lang === 'uz' ? 'Ayol' : 'Женские'}
          </button>
          <button
            type="button"
            onClick={() => setFilterGender('male')}
            className={`flex-1 py-1 rounded-full transition-all cursor-pointer ${
              filterGender === 'male' ? 'bg-[#161511] text-[#F4F1EA] font-semibold shadow-xs' : 'hover:text-[#161511]'
            }`}
          >
            {lang === 'uz' ? 'Erkak' : 'Мужские'}
          </button>
        </div>

        {/* Scrollable Voice Cards Grid */}
        <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1 visible-scrollbar">
          {filteredVoices.map((v) => (
            <VoiceCardItem
              key={v.id}
              voice={v}
              isSelected={v.id === selectedVoiceId}
              onSelect={() => onSelectVoice(v.id)}
              lang={lang}
            />
          ))}
        </div>

        {/* Nutq Tempi Slider (Simple & Clean) */}
        <div className="pt-2 border-t border-[rgba(22,21,17,0.12)]">
          <div className="flex justify-between items-center mb-1 text-xs">
            <span className="font-semibold text-[#5D594E]">
              {lang === 'uz' ? 'Nutq tempi' : 'Темп речи'}:
            </span>
            <span className="font-mono text-xs text-[#0A5A62] font-semibold">{tempo.toFixed(2)}x</span>
          </div>
          <input
            type="range"
            min="75"
            max="135"
            value={Math.round(tempo * 100)}
            onChange={(e) => onChangeTempo(Number(e.target.value) / 100)}
            className="w-full accent-[#0E7C86] cursor-pointer"
          />
          <div className="flex justify-between font-mono text-[10px] text-[#5D594E] tracking-tight mt-0.5">
            <span>0.75x</span>
            <span>1.0x standart</span>
            <span>1.35x</span>
          </div>
        </div>

        {/* Advanced Accordion Toggle: Clean & Hidden by Default */}
        <div className="pt-2 border-t border-[rgba(22,21,17,0.12)]">
          <button
            type="button"
            onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
            className="w-full py-2 px-3 rounded-xl bg-white/70 hover:bg-white border border-[rgba(22,21,17,0.12)] text-xs font-mono text-[#5D594E] hover:text-[#161511] flex items-center justify-between transition-all cursor-pointer"
          >
            <span className="flex items-center gap-1.5 font-medium">
              <Sliders className="w-3.5 h-3.5 text-[#0E7C86]" />
              <span>
                {isAdvancedOpen
                  ? (lang === 'uz' ? 'Kengaytirilgan sozlamalar ▴' : 'Скрыть доп. параметры ▴')
                  : (lang === 'uz' ? 'Kengaytirilgan sozlamalar (XY Pad) ▾' : 'Расширенные настройки (XY Pad) ▾')}
              </span>
            </span>
            <span className="text-[10px] text-[#0A5A62] font-semibold">
              {isAdvancedOpen ? 'Yopish' : 'Ochish'}
            </span>
          </button>

          {isAdvancedOpen && (
            <div className="pt-3 space-y-4 animate-in fade-in duration-150">
              {/* XY Pad Timbre × Style */}
              <div>
                <XYPad
                  tempo={tempo}
                  onChangeTempo={onChangeTempo}
                  timbreValue={timbreValue}
                  onChangeTimbreValue={onChangeTimbreValue}
                  lang={lang}
                />
              </div>

              {/* Duration Scrubber */}
              <div>
                <LiveDurationCostScrubber
                  wordCount={wordCount}
                  tempo={tempo}
                  targetSeconds={targetSeconds}
                  onChangeTargetSeconds={onChangeTargetSeconds}
                  isAdmin={isAdmin}
                  lang={lang}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
