import React, { useState, useRef } from 'react';
import { VoiceProfile, VoiceoverFormat } from '../types/podcast';
import {
  Film,
  Sparkles,
  Play,
  Pause,
  Download,
  Copy,
  Clock,
  Check,
  FileText,
  Volume2,
  Tv,
  BookOpen,
  ShoppingBag,
  Sliders,
  CheckCircle2,
  Upload,
  Save,
} from 'lucide-react';

interface VoiceoverStudioProps {
  voices: VoiceProfile[];
  selectedVoiceId: string;
  onSelectVoiceId: (id: string) => void;
  onSaveToCMS?: (item: any) => void;
  onOpenDocumentModal?: () => void;
  lang: 'uz' | 'ru';
}

export const VoiceoverStudio: React.FC<VoiceoverStudioProps> = ({
  voices,
  selectedVoiceId,
  onSelectVoiceId,
  onSaveToCMS,
  onOpenDocumentModal,
  lang,
}) => {
  const [format, setFormat] = useState<VoiceoverFormat>('reels_shorts');
  const [targetDuration, setTargetDuration] = useState<string>('30s');
  const [topic, setTopic] = useState<string>('Sun\'iy intellekt va kelajak texnologiyalari');
  const [stylePreset, setStylePreset] = useState<'cinematic' | 'energetic_sales' | 'storytelling' | 'documentary' | 'whisper'>('cinematic');

  const [script, setScript] = useState<string>(
    `[00:00 - 00:06] Tasavvur qiling: siz uxlayotganingizda, sun'iy intellekt sizning ovozingizda butun boshli podkastni yozib tugatdi!\n[00:06 - 00:15] Bu ertak emas, bu bugungi kun realligi. Gemini 3.8 Flash endi inson ovozini soniyalar ichida mukammal takrorlay oladi.\n[00:15 - 00:24] Endi qimmatbaho studiyalar yoki soatlab montaj shart emas. Shunchaki o'z ovozingizni ulang va yangi davrga qadam qo'ying.\n[00:24 - 00:30] Kanalimizga obuna bo'ling va eng so'nggi audio-texnologiyalarni birinchilardan bo'lib sinab ko'ring!`
  );

  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  // Result state
  const [resultAudio, setResultAudio] = useState<string | null>(null);
  const [audioDuration, setAudioDuration] = useState<number>(0);
  const [srtSubtitles, setSrtSubtitles] = useState<string>('');
  const [vttSubtitles, setVttSubtitles] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [copiedSubtitle, setCopiedSubtitle] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<'srt' | 'vtt'>('srt');

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Active voice
  const activeVoice = voices.find((v) => v.id === selectedVoiceId) || voices[0];

  // Estimated reading speed (approx 2.4 words per second in Uzbek)
  const wordCount = script.trim().split(/\s+/).filter(Boolean).length;
  const estimatedSeconds = Math.round((wordCount / 2.4) * 10) / 10;

  // Generate script
  const handleGenerateScript = async () => {
    setIsGeneratingScript(true);
    try {
      const res = await fetch('/api/voiceover/generate-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format,
          topic,
          targetDuration,
          stylePreset,
          voicePersona: activeVoice?.name || 'Mening Ovozim',
        }),
      });

      if (!res.ok) throw new Error('Ssenariy yaratishda xatolik');
      const data = await res.json();
      if (data.fullTimedScript) {
        setScript(data.fullTimedScript);
      } else if (data.script) {
        setScript(data.script);
      }
    } catch (e: any) {
      alert(`Xatolik: ${e.message}`);
    } finally {
      setIsGeneratingScript(false);
    }
  };

  // Synthesize voiceover
  const handleSynthesize = async () => {
    if (!script.trim()) return;
    setIsSynthesizing(true);
    try {
      const res = await fetch('/api/voiceover/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: script,
          voiceProfile: {
            voiceName: activeVoice?.name,
            voiceId: activeVoice?.voiceId || activeVoice?.id,
            baseVoice: activeVoice?.baseVoice,
            timbre: activeVoice?.timbre,
            tempo: activeVoice?.tempo,
          },
          speechStyle: stylePreset,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Dublyaj sintezida xatolik');
      }

      const data = await res.json();
      setResultAudio(data.audioBase64);
      setAudioDuration(data.durationSeconds || 0);
      setSrtSubtitles(data.srtSubtitles || '');
      setVttSubtitles(data.vttSubtitles || '');
      setIsPlaying(false);
    } catch (e: any) {
      alert(`Xatolik: ${e.message}`);
    } finally {
      setIsSynthesizing(false);
    }
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const copySubtitles = () => {
    const textToCopy = activeSubTab === 'srt' ? srtSubtitles : vttSubtitles;
    navigator.clipboard.writeText(textToCopy);
    setCopiedSubtitle(true);
    setTimeout(() => setCopiedSubtitle(false), 2000);
  };

  const downloadSrt = () => {
    const blob = new Blob([activeSubTab === 'srt' ? srtSubtitles : vttSubtitles], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `voiceover-subtitles.${activeSubTab}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadAudio = () => {
    if (!resultAudio) return;
    const byteCharacters = atob(resultAudio);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `voiceover-${format}-${Date.now()}.wav`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveToCMS = () => {
    if (!onSaveToCMS) return;
    onSaveToCMS({
      title: `Ovozlashtirish: ${topic.slice(0, 45)}`,
      category: 'Ovozlashtirish & Dublyaj',
      description: `${format} formati uchun ${targetDuration}lik professional dublyaj.`,
      tags: ['Ovozlashtirish', 'Dublyaj', format, 'Subtitr'],
      script,
      voiceName: activeVoice.name,
      durationSeconds: audioDuration || 30,
      rawAudioWavBase64: resultAudio || '',
      ambientSound: 'none',
      ambientVolume: 0,
    });
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-2xl bg-gradient-to-r from-purple-950/60 via-zinc-900 to-indigo-950/60 border border-purple-500/30 p-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="px-3 py-1 rounded-full bg-purple-500/20 text-purple-300 text-xs font-semibold border border-purple-500/40 flex items-center gap-1.5">
                <Film className="w-3.5 h-3.5" />
                {lang === 'uz' ? 'Eksklyuziv Ovozlashtirish & Dublyaj' : 'Эксклюзивная Озвучка и Дубляж'}
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 text-xs font-mono border border-cyan-500/30">
                Gemini 3.8 Flash TTS
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
              {lang === 'uz' ? 'Video, Reels va Reklama uchun Ovozlashtirish' : 'Озвучка для Reels, Видео и Рекламы'}
            </h1>
            <p className="text-zinc-400 text-sm mt-1 max-w-2xl">
              {lang === 'uz'
                ? 'Aniq xronometraj, sahna markerlari va avtomatik SRT/VTT subtitrlar bilan professional ovoz yozish studiyasi.'
                : 'Профессиональная озвучка с точным хронометражем, маркерами сцен и автоматической генерацией субтитров SRT/VTT.'}
            </p>
          </div>

          {/* Active Voice Pill */}
          <div className="bg-zinc-950/80 border border-purple-500/30 p-3.5 rounded-xl flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-300 font-bold">
              {activeVoice?.name?.[0] || 'V'}
            </div>
            <div>
              <p className="text-[11px] text-zinc-400 uppercase tracking-wider font-semibold">
                {lang === 'uz' ? 'Tanlangan Ovoz:' : 'Выбранный Голос:'}
              </p>
              <p className="text-sm font-bold text-white flex items-center gap-1.5">
                {activeVoice?.name}
                {activeVoice?.isReplicatedVoice && (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                )}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Configuration & Script Editor (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          {/* Format & Duration Selector */}
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
              <Tv className="w-4 h-4 text-purple-400" />
              {lang === 'uz' ? '1. Format va Mo\'ljallangan Vaqt' : '1. Формат и Хронометраж'}
            </h3>

            {/* Formats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { id: 'reels_shorts', label: 'Reels / Shorts', icon: Film, dur: '30s' },
                { id: 'commercial_ad', label: 'Video Reklama', icon: ShoppingBag, dur: '15s' },
                { id: 'audiobook', label: 'Audio Kitob', icon: BookOpen, dur: '2 daqiqa' },
                { id: 'video_dubbing', label: 'Kadrdan tashqari', icon: Tv, dur: '60s' },
              ].map((item) => {
                const Icon = item.icon;
                const isSelected = format === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setFormat(item.id as VoiceoverFormat);
                      setTargetDuration(item.dur);
                    }}
                    className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between cursor-pointer ${
                      isSelected
                        ? 'bg-purple-950/40 border-purple-500/60 text-white shadow-sm shadow-purple-500/20'
                        : 'bg-zinc-950/60 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                    }`}
                  >
                    <Icon className={`w-4 h-4 mb-2 ${isSelected ? 'text-purple-400' : 'text-zinc-500'}`} />
                    <span className="text-xs font-semibold">{item.label}</span>
                    <span className="text-[10px] text-zinc-500">{item.dur}</span>
                  </button>
                );
              })}
            </div>

            {/* Target Duration & Style Preset */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-zinc-400" />
                  {lang === 'uz' ? 'Xronometraj chegarasi:' : 'Хронометраж:'}
                </label>
                <div className="flex gap-1.5">
                  {['15s', '30s', '45s', '60s', '2m'].map((dur) => (
                    <button
                      key={dur}
                      onClick={() => setTargetDuration(dur)}
                      className={`flex-1 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                        targetDuration === dur
                          ? 'bg-purple-500 text-white border-purple-400 font-bold'
                          : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                      }`}
                    >
                      {dur}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5 flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-zinc-400" />
                  {lang === 'uz' ? 'Ovozlashtirish kayfiyati:' : 'Настроение озвучки:'}
                </label>
                <select
                  value={stylePreset}
                  onChange={(e) => setStylePreset(e.target.value as any)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-purple-500"
                >
                  <option value="cinematic">Kinematik & Sirli (Cinematic)</option>
                  <option value="energetic_sales">Yuqori energiya & Sotuvchi (Sales/Promo)</option>
                  <option value="documentary">Hujjatli & Qat'iy diktor (Documentary)</option>
                  <option value="storytelling">Iliq hikoyachi & Samimiy (Storytelling)</option>
                  <option value="whisper">Sirli shivirlash & Mayin (Whisper)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Script Generation & Text Editor */}
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                <FileText className="w-4 h-4 text-purple-400" />
                {lang === 'uz' ? '2. Ovozlashtirish Matni & Sahnalar' : '2. Текст Озвучки и Сцены'}
              </h3>
              <div className="flex items-center gap-2 text-xs text-zinc-400 font-mono">
                <span>{wordCount} {lang === 'uz' ? 'so\'z' : 'слов'}</span>
                <span>•</span>
                <span className="text-purple-400">~{estimatedSeconds}s</span>
              </div>
            </div>

            {/* Topic Input + AI Generator + Document Upload */}
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder={lang === 'uz' ? 'Mavzu (masalan: Yangi brend taqdimoti)...' : 'Тема озвучки...'}
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2 text-xs sm:text-sm text-zinc-200 focus:outline-none focus:border-purple-500"
              />

              <div className="flex items-center gap-2">
                {onOpenDocumentModal && (
                  <button
                    type="button"
                    onClick={onOpenDocumentModal}
                    className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-cyan-300 border border-cyan-500/40 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all hover:scale-105 cursor-pointer whitespace-nowrap"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>{lang === 'uz' ? 'PDF / Maqola' : 'Из PDF'}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleGenerateScript}
                  disabled={isGeneratingScript || !topic.trim()}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-1.5 transition-all shadow-md shadow-purple-600/20 whitespace-nowrap cursor-pointer"
                >
                  <Sparkles className={`w-3.5 h-3.5 ${isGeneratingScript ? 'animate-spin' : ''}`} />
                  {isGeneratingScript ? 'Yozilmoqda...' : lang === 'uz' ? 'AI Ssenariy' : 'AI Сценарий'}
                </button>
              </div>
            </div>

            {/* Textarea */}
            <textarea
              rows={8}
              value={script}
              onChange={(e) => setScript(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3.5 text-xs sm:text-sm text-zinc-200 font-mono leading-relaxed focus:outline-none focus:border-purple-500 resize-y"
              placeholder="[00:00 - 00:05] Sahnangiz matni..."
            />

            {/* Synthesize CTA */}
            <div className="pt-2 flex items-center justify-between">
              <div className="text-xs text-zinc-500">
                {lang === 'uz'
                  ? 'Matndagi [00:00 - 00:05] belgilari subtitrlar uchun avtomatik ishlatiladi.'
                  : 'Таймкоды [00:00 - 00:05] автоматически преобразуются в субтитры.'}
              </div>
              <button
                onClick={handleSynthesize}
                disabled={isSynthesizing || !script.trim()}
                className="px-6 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white rounded-xl text-sm font-bold flex items-center gap-2 transition-all shadow-lg shadow-purple-600/25 cursor-pointer"
              >
                <Volume2 className={`w-4 h-4 ${isSynthesizing ? 'animate-pulse' : ''}`} />
                {isSynthesizing
                  ? (lang === 'uz' ? 'Sintez qilinmoqda...' : 'Синтез...')
                  : (lang === 'uz' ? 'Ovozlashtirishni Yaratish (TTS)' : 'Озвучить (TTS)')}
              </button>
            </div>
          </div>
        </div>

        {/* Right: Audio Player & Subtitles Generator (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          {/* Audio Result Card */}
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
              <Volume2 className="w-4 h-4 text-purple-400" />
              {lang === 'uz' ? '3. Ovozlashtirilgan Audio' : '3. Озвученная дорожка'}
            </h3>

            {resultAudio ? (
              <div className="space-y-4">
                <audio
                  ref={audioRef}
                  src={`data:audio/wav;base64,${resultAudio}`}
                  onEnded={() => setIsPlaying(false)}
                />

                {/* Player Box */}
                <div className="p-4 rounded-xl bg-zinc-950 border border-purple-500/30 flex items-center gap-4">
                  <button
                    onClick={togglePlay}
                    className="w-12 h-12 rounded-xl bg-purple-600 hover:bg-purple-500 text-white flex items-center justify-center transition-transform hover:scale-105 shadow-md shadow-purple-600/30 cursor-pointer"
                  >
                    {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                  </button>

                  <div className="flex-1">
                    <p className="text-xs text-zinc-400">
                      {lang === 'uz' ? 'Davomiyligi:' : 'Длительность:'} <span className="text-white font-mono font-bold">{audioDuration}s</span>
                    </p>
                    {/* Simulated Waveform Visual */}
                    <div className="flex items-center gap-1 mt-2 h-7">
                      {[40, 70, 30, 90, 60, 100, 80, 50, 95, 45, 85, 65, 30, 75, 55, 90, 40].map((h, i) => (
                        <div
                          key={i}
                          className={`w-1 rounded-full transition-all ${
                            isPlaying ? 'bg-purple-400 animate-pulse' : 'bg-zinc-700'
                          }`}
                          style={{ height: `${h}%` }}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {/* Action Buttons: Save to CMS & Download */}
                <div className="space-y-2">
                  {onSaveToCMS && (
                    <button
                      onClick={handleSaveToCMS}
                      className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 border border-zinc-700 transition-all hover:scale-[1.01] cursor-pointer"
                    >
                      {isSaved ? <Check className="w-4 h-4 text-emerald-400" /> : <Save className="w-4 h-4 text-purple-400" />}
                      <span>{isSaved ? 'CMS Kutubxonasiga Saqlandi!' : 'CMS Kutubxonasiga Saqlash'}</span>
                    </button>
                  )}

                  <button
                    onClick={downloadAudio}
                    className="w-full py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-md shadow-purple-600/20"
                  >
                    <Download className="w-4 h-4" />
                    {lang === 'uz' ? 'WAV Audioni Yuklab Olish' : 'Скачать WAV аудио'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-8 rounded-xl bg-zinc-950/60 border border-dashed border-zinc-800 text-center space-y-2">
                <Volume2 className="w-8 h-8 text-zinc-600 mx-auto" />
                <p className="text-xs text-zinc-400 font-medium">
                  {lang === 'uz' ? 'Audio hali yaratilmadi' : 'Аудио еще не создано'}
                </p>
                <p className="text-[11px] text-zinc-500">
                  {lang === 'uz'
                    ? 'Chap paneldagi "Ovozlashtirishni Yaratish" tugmasini bosing.'
                    : 'Нажмите "Озвучить (TTS)" на панели слева.'}
                </p>
              </div>
            )}
          </div>

          {/* Subtitles Box (SRT / VTT) */}
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                <FileText className="w-4 h-4 text-purple-400" />
                {lang === 'uz' ? '4. Sinxron Subtitrlar (SRT / VTT)' : '4. Синхронные Субтитры (SRT / VTT)'}
              </h3>

              {/* Subtitle Format Tabs */}
              <div className="flex items-center bg-zinc-950 p-1 rounded-lg border border-zinc-800 text-xs">
                <button
                  onClick={() => setActiveSubTab('srt')}
                  className={`px-2.5 py-1 rounded-md font-mono cursor-pointer ${
                    activeSubTab === 'srt' ? 'bg-purple-600 text-white font-bold' : 'text-zinc-400'
                  }`}
                >
                  .SRT
                </button>
                <button
                  onClick={() => setActiveSubTab('vtt')}
                  className={`px-2.5 py-1 rounded-md font-mono cursor-pointer ${
                    activeSubTab === 'vtt' ? 'bg-purple-600 text-white font-bold' : 'text-zinc-400'
                  }`}
                >
                  .VTT
                </button>
              </div>
            </div>

            {srtSubtitles ? (
              <div className="space-y-3">
                <pre className="p-3 bg-zinc-950 rounded-xl border border-zinc-800 text-[11px] text-zinc-300 font-mono max-h-56 overflow-y-auto leading-relaxed">
                  {activeSubTab === 'srt' ? srtSubtitles : vttSubtitles}
                </pre>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={copySubtitles}
                    className="py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    {copiedSubtitle ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedSubtitle ? 'Nusxalandi!' : 'Nusxa olish'}
                  </button>
                  <button
                    onClick={downloadSrt}
                    className="py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-sm shadow-purple-600/20 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    .{activeSubTab.toUpperCase()} Yuklab Olish
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-6 rounded-xl bg-zinc-950/60 border border-zinc-800 text-center text-xs text-zinc-500">
                {lang === 'uz'
                  ? 'Subtitrlar audio sintez qilingandan so\'ng avtomatik paydo bo\'ladi.'
                  : 'Субтитры появятся автоматически после озвучивания.'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
