import React, { useState } from 'react';
import {
  FileText,
  Sparkles,
  Wand2,
  Clock,
  Play,
  RotateCcw,
  Tag,
  Smile,
  Wind,
  HelpCircle,
  Copy,
  Check,
  Upload,
  BookmarkPlus,
  Save,
} from 'lucide-react';
import { PodcastCategory, PodcastTopic } from '../types/podcast';

interface ScriptEditorProps {
  category: PodcastCategory;
  title: string;
  onChangeTitle: (title: string) => void;
  description: string;
  onChangeDescription: (desc: string) => void;
  tags: string[];
  onChangeTags: (tags: string[]) => void;
  scriptText: string;
  onChangeScriptText: (text: string) => void;
  tempo: number;
  onSynthesize: () => void;
  isSynthesizing: boolean;
  onSaveDraft?: () => void;
  onOpenDocumentModal?: () => void;
  lang: 'uz' | 'ru';
}

export const ScriptEditor: React.FC<ScriptEditorProps> = ({
  category,
  title,
  onChangeTitle,
  description,
  onChangeDescription,
  tags,
  onChangeTags,
  scriptText,
  onChangeScriptText,
  tempo,
  onSynthesize,
  isSynthesizing,
  onSaveDraft,
  onOpenDocumentModal,
  lang,
}) => {
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const [copied, setCopied] = useState(false);

  // Word count & Duration calculation
  const wordCount = scriptText.trim() ? scriptText.trim().split(/\s+/).length : 0;
  // Standard speech in Uzbek is roughly 120-130 words per minute at 1.0x
  const estimatedSeconds = Math.round((wordCount / (125 * tempo)) * 60);
  const estMins = Math.floor(estimatedSeconds / 60);
  const estSecs = estimatedSeconds % 60;

  // Insert vocal cues or stage directions
  const insertCue = (cue: string) => {
    onChangeScriptText(scriptText ? `${scriptText} ${cue}` : cue);
  };

  const [isPolishing, setIsPolishing] = useState(false);

  // Polish user's draft and calibrate timing
  const handlePolishAndTiming = async () => {
    if (!scriptText.trim()) {
      alert(lang === 'uz' ? 'Iltimos, avval matn maydoniga qoralama yoki ssenariy matnini kiriting' : 'Сначала введите текст для анализа в поле ввода');
      return;
    }

    setIsPolishing(true);
    try {
      const res = await fetch('/api/podcast/analyze-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceText: scriptText,
          targetFormat: 'podcast',
          category: category.nameUz,
          userInstructions:
            'Ushbu qoralama yoki mavjud ssenariyni (rus, ingliz yoki o\'zbek tilidagi) chuqur tahlil qiling. Vaqt va temp me\'yorlariga moslang, nutq oqimini yaxshilang, tabiiy nafas va podkast belgilari (<breath>, <laugh>, |ha|, [Pauza 1s]) qo\'shing.',
        }),
      });

      if (!res.ok) throw new Error('Matnni tahlil qilishda xatolik yuz berdi');
      const data = await res.json();

      if (data.title && !title) onChangeTitle(data.title);
      if (data.description && !description) onChangeDescription(data.description);
      if (data.script) onChangeScriptText(data.script);
    } catch (err: any) {
      alert(`Xatolik: ${err.message}`);
    } finally {
      setIsPolishing(false);
    }
  };

  // Generate Script using Gemini 3.8 Flash
  const handleAIGenerate = async () => {
    setIsGeneratingScript(true);
    try {
      const res = await fetch('/api/podcast/generate-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: category.nameUz,
          topic: title || category.topics[0]?.titleUz || 'O\'zbekiston tarixi',
          style: category.suggestedStyle,
          targetDuration: '2 daqiqa',
          customInstructions: customPrompt,
        }),
      });

      if (!res.ok) throw new Error('AI ssenariy yaratishda xato');
      const data = await res.json();

      if (data.title) onChangeTitle(data.title);
      if (data.description) onChangeDescription(data.description);
      if (data.script) onChangeScriptText(data.script);

      // Auto add tags
      const autoTags = [
        category.badgeUz,
        category.nameUz.split(' ')[0],
        'Podkast',
        'Gemini38'
      ];
      onChangeTags(autoTags);
    } catch (err: any) {
      alert(`Xatolik: ${err.message}`);
    } finally {
      setIsGeneratingScript(false);
    }
  };

  // Select Topic from Category
  const handleSelectTopic = (topic: PodcastTopic) => {
    onChangeTitle(topic.titleUz);
    onChangeDescription(topic.descriptionUz);
    onChangeScriptText(topic.sampleScriptUz);
    onChangeTags([category.badgeUz, 'PodkastUz', topic.titleUz.split(' ')[0]]);
  };

  return (
    <div className="bg-zinc-900/80 border border-zinc-800 rounded-3xl p-5 sm:p-7 shadow-xl space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-zinc-800">
        <div>
          <h3 className="font-bold text-white text-base sm:text-lg flex items-center gap-2">
            <FileText className="w-5 h-5 text-cyan-400" />
            <span>{lang === 'uz' ? '2. Ssenariy va O\'zbekcha Matn' : '2. Сценарий и Текст на узбекском'}</span>
          </h3>
          <p className="text-xs text-zinc-400 mt-0.5">
            {lang === 'uz'
              ? 'Tayyor mavzuni tanlang, o\'z matningizni kiriting yoki Gemini 3.8 orqali yozdiring'
              : 'Выберите тему, введите текст или сгенерируйте сценарий через Gemini 3.8'}
          </p>
        </div>

        {/* Word count & Estimated duration */}
        <div className="flex items-center gap-3 bg-zinc-950 px-3.5 py-1.5 rounded-xl border border-zinc-800 text-xs font-mono text-zinc-300 self-start sm:self-center">
          <span className="text-zinc-400">{wordCount} {lang === 'uz' ? 'so\'z' : 'слов'}</span>
          <span className="text-zinc-600">•</span>
          <span className="text-cyan-400 flex items-center gap-1 font-semibold">
            <Clock className="w-3.5 h-3.5" />
            ~{estMins > 0 ? `${estMins}m ` : ''}{estSecs}s
          </span>
        </div>
      </div>

      {/* Suggested Topics from selected category */}
      {category.topics && category.topics.length > 0 && (
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            {lang === 'uz' ? 'Toifadagi Tayyor Mavzular:' : 'Готовые темы категории:'}
          </label>
          <div className="flex flex-wrap gap-2">
            {category.topics.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => handleSelectTopic(t)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium border text-left transition-all ${
                  title === t.titleUz
                    ? 'bg-cyan-500/15 border-cyan-500 text-cyan-300 font-bold'
                    : 'bg-zinc-950 border-zinc-800 text-zinc-300 hover:border-zinc-700 hover:text-white'
                }`}
              >
                {t.titleUz}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Title & Description Inputs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-zinc-300 mb-1">
            {lang === 'uz' ? 'Podkast Sarlavhasi' : 'Название подкаста'}
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => onChangeTitle(e.target.value)}
            placeholder="Masalan: Amir Temurning Samarqanddagi merosi"
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2 text-xs sm:text-sm text-white focus:outline-none focus:border-cyan-500"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-zinc-300 mb-1">
            {lang === 'uz' ? 'Qisqa Tavsif (Description)' : 'Краткое описание'}
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => onChangeDescription(e.target.value)}
            placeholder="Tinglovchilar uchun 1-2 jumlalik tushuntirish..."
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2 text-xs sm:text-sm text-white focus:outline-none focus:border-cyan-500"
          />
        </div>
      </div>

      {/* AI Generate Script Tool */}
      {/* AI Script Generator Bar & Document Upload */}
      <div className="p-3 sm:p-4 bg-gradient-to-r from-cyan-950/40 via-indigo-950/30 to-purple-950/30 border border-cyan-500/30 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-cyan-500/20 text-cyan-400">
            <Sparkles className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h4 className="text-xs sm:text-sm font-bold text-white">
              {lang === 'uz' ? 'Gemini 3.8 AI Ssenariy Yozuvchi' : 'AI Сценарист Gemini 3.8'}
            </h4>
            <p className="text-[11px] text-zinc-400">
              {lang === 'uz'
                ? 'Toifaga mos matn tuzish yoki o\'z PDF/maqolangizni tahlil qilib ssenariyga aylantirish'
                : 'Создание текста подкаста или анализ вашего PDF/статьи на узбекский язык'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {onOpenDocumentModal && (
            <button
              type="button"
              onClick={onOpenDocumentModal}
              className="flex-1 md:flex-initial px-3.5 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-cyan-300 border border-cyan-500/40 font-semibold text-xs flex items-center justify-center gap-1.5 transition-all hover:scale-105 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{lang === 'uz' ? 'PDF / Maqola yuklash' : 'PDF / Статья'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={handlePolishAndTiming}
            disabled={isPolishing || !scriptText.trim()}
            className="flex-1 md:flex-initial px-3.5 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 text-emerald-300 border border-emerald-500/40 font-semibold text-xs flex items-center justify-center gap-1.5 transition-all hover:scale-105 cursor-pointer"
            title={lang === 'uz' ? 'Mavjud matnni tahlil qilish, temp va vaqtini to\'g\'rilash' : 'Анализ черновика, подгонка по времени и темпу'}
          >
            <Clock className={`w-3.5 h-3.5 ${isPolishing ? 'animate-spin' : ''}`} />
            <span>{isPolishing ? (lang === 'uz' ? 'Moslanmoqda...' : 'Подгонка...') : (lang === 'uz' ? 'Vaqtni To\'g\'rilash' : 'Подгонка по времени')}</span>
          </button>

          <button
            type="button"
            onClick={handleAIGenerate}
            disabled={isGeneratingScript}
            className="flex-1 md:flex-initial px-4 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-zinc-950 font-bold text-xs flex items-center justify-center gap-2 shadow-md shadow-cyan-500/20 transition-all hover:scale-105 active:scale-95 cursor-pointer"
          >
            {isGeneratingScript ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin" />
                <span>{lang === 'uz' ? 'Ssenariy yozilmoqda...' : 'Генерация...'}</span>
              </>
            ) : (
              <>
                <Wand2 className="w-4 h-4" />
                <span>{lang === 'uz' ? 'AI Ssenariy Yozish' : 'Сгенерировать'}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Vocal burst & podcast cue helpers */}
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <span className="text-[11px] text-zinc-400 mr-1 flex items-center gap-1">
          <Wind className="w-3 h-3 text-cyan-400" />
          {lang === 'uz' ? 'Ovoz effektlarini qo\'shish:' : 'Эффекты голоса:'}
        </span>
        {[
          { cue: '<breath>', label: '<breath> (Nafas)', icon: '💨' },
          { cue: '<laugh>', label: '<laugh> (Kulgi)', icon: '😄' },
          { cue: '|ha|', label: '|ha| (Tasdiq)', icon: '🗣️' },
          { cue: '|mhm|', label: '|mhm|', icon: '✨' },
          { cue: '[Pauza 1s]', label: '[Pauza]', icon: '⏸️' },
          { cue: '[Hayajonli]', label: '[Hayajon]', icon: '🔥' },
        ].map((btn) => (
          <button
            key={btn.cue}
            type="button"
            onClick={() => insertCue(btn.cue)}
            className="px-2.5 py-1 rounded-lg text-[11px] bg-zinc-950 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 hover:border-zinc-700 transition-colors"
          >
            <span>{btn.icon} {btn.label}</span>
          </button>
        ))}
      </div>

      {/* Script Textarea */}
      <div className="space-y-1">
        <textarea
          rows={11}
          value={scriptText}
          onChange={(e) => onChangeScriptText(e.target.value)}
          placeholder={
            lang === 'uz'
              ? `Podkastingiz matnini shu yerga yozing...
Misol:
[KIRISH]
Assalomu alaykum qadrli tinglovchilar! <breath> Bugungi sonimizda siz bilan birga qiziqarli voqealarni o'rganamiz...`
              : 'Введите текст подкаста на узбекском языке...'
          }
          className="w-full bg-zinc-950 border border-zinc-800 focus:border-cyan-500 rounded-2xl p-4 text-xs sm:text-sm text-zinc-200 leading-relaxed font-sans focus:outline-none resize-y transition-colors"
        />
      </div>

      {/* Action Buttons: Synthesize Voice & Save to CMS */}
      <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
        <button
          onClick={onSynthesize}
          disabled={isSynthesizing || !scriptText.trim()}
          className={`flex-1 py-4 px-6 rounded-2xl font-bold text-sm sm:text-base flex items-center justify-center gap-3 shadow-xl transition-all cursor-pointer ${
            isSynthesizing || !scriptText.trim()
              ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
              : 'bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-zinc-950 shadow-cyan-500/25 hover:scale-[1.01] active:scale-[0.99]'
          }`}
        >
          {isSynthesizing ? (
            <>
              <div className="w-5 h-5 border-3 border-zinc-950 border-t-transparent rounded-full animate-spin" />
              <span>
                {lang === 'uz'
                  ? 'Gemini 3.8 TTS Live Ovoz Bermoqda (Sintez)...'
                  : 'Gemini 3.8 TTS Live Озвучивает (Синтез)...'}
              </span>
            </>
          ) : (
            <>
              <Play className="w-5 h-5 fill-current" />
              <span>
                {lang === 'uz'
                  ? 'Mening Ovoz bilan Podkastni Yaratish (Gemini 3.8 TTS)'
                  : 'Озвучить моим голосом (Gemini 3.8 TTS)'}
              </span>
            </>
          )}
        </button>

        {onSaveDraft && (
          <button
            type="button"
            onClick={onSaveDraft}
            disabled={!scriptText.trim()}
            className="w-full sm:w-auto py-4 px-6 rounded-2xl bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white font-bold text-sm flex items-center justify-center gap-2 border border-zinc-700 transition-all hover:scale-105 active:scale-95 cursor-pointer shadow-lg"
            title={lang === 'uz' ? 'Podkastni CMS kutubxonasiga saqlash' : 'Сохранить в CMS библиотеку'}
          >
            <Save className="w-5 h-5 text-cyan-400" />
            <span>{lang === 'uz' ? 'CMS\'ga Saqlash' : 'Сохранить в CMS'}</span>
          </button>
        )}
      </div>
    </div>
  );
};
