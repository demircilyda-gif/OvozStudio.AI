import React, { useState, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  Wand2,
  Copy,
  Check,
  Wind,
  Eraser,
  BookmarkPlus,
} from 'lucide-react';
import { PodcastCategory } from '../types/podcast';
import { PODCAST_CATEGORIES } from '../data/categories';
import { stripAllStageConditions, detectScriptConditions } from '../utils/audioUtils';

interface ScriptCanvasProps {
  category: PodcastCategory;
  onSelectCategory: (cat: PodcastCategory) => void;
  title: string;
  onChangeTitle: (title: string) => void;
  scriptText: string;
  onChangeScriptText: (text: string) => void;
  tempo: number;
  onOpenDocumentModal: () => void;
  onSaveDraft?: () => void;
  lang: 'uz' | 'ru';
}

export const ScriptCanvas: React.FC<ScriptCanvasProps> = ({
  category,
  onSelectCategory,
  title,
  onChangeTitle,
  scriptText,
  onChangeScriptText,
  tempo,
  onOpenDocumentModal,
  onSaveDraft,
  lang,
}) => {
  const { requireAuth } = useAuth();
  const [customPrompt, setCustomPrompt] = useState('');
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [copied, setCopied] = useState(false);
  const [cleanNotice, setCleanNotice] = useState<string | null>(null);

  // Real-time analysis of script conditions
  const conditionAnalysis = useMemo(() => detectScriptConditions(scriptText), [scriptText]);

  const handleCleanConditions = () => {
    const cleaned = stripAllStageConditions(scriptText);
    onChangeScriptText(cleaned);
    setCleanNotice(
      lang === 'uz'
        ? "Barcha skobka va shartlar tozalandi! Faqat toza nutq qoldi."
        : 'Сценарий очищен от всех ремарок. Остался чистый текст.'
    );
    setTimeout(() => setCleanNotice(null), 3000);
  };

  const wordCount = scriptText.trim() ? scriptText.trim().split(/\s+/).filter(Boolean).length : 0;
  const charCount = scriptText.length;
  const estimatedSeconds = Math.round((wordCount / (125 * tempo)) * 60);

  // Insert vocal cues or stage directions
  const insertCue = (cue: string) => {
    onChangeScriptText(scriptText ? `${scriptText} ${cue}` : cue);
  };

  // Generate Script via API
  const handleGenerateScript = async () => {
    if (
      !requireAuth(
        () => {},
        lang === 'uz'
          ? "Ssenariy generatsiyasi faqat ro'yxatdan o'tgan foydalanuvchilar uchun ochiq."
          : "Генерация сценария доступна только для зарегистрированных пользователей."
      )
    ) {
      return;
    }

    setIsGeneratingScript(true);
    try {
      const topicPrompt = customPrompt.trim() || title.trim() || category.nameUz;
      const res = await fetch('/api/podcast/generate-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topicPrompt,
          category: category.nameUz,
          targetDuration: '2 daqiqa',
          speechStyle: 'Samimiy & Jonli',
          tempo: `${tempo}x`,
          customPersonaPrompt: "Professional o'zbek tili diktori",
        }),
      });

      if (!res.ok) throw new Error('Ssenariy yaratishda xatolik yuz berdi');
      const data = await res.json();
      if (data.script) {
        onChangeScriptText(data.script);
        if (data.title && !title) onChangeTitle(data.title);
      }
    } catch (e: any) {
      alert(`Xatolik: ${e.message}`);
    } finally {
      setIsGeneratingScript(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(scriptText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex-1 space-y-4 select-none">
      {/* Markaz Studio Panel: 01 — Ssenariy va matn */}
      <div className="border border-[rgba(22,21,17,0.14)] rounded-[20px] bg-[rgba(255,255,255,0.52)] backdrop-blur-sm p-6 space-y-4 shadow-[0_30px_50px_-30px_rgba(22,21,17,0.15)]">
        {/* Panel Header Label with Hairline */}
        <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#0A5A62]">
          <span>01 — Ssenariy va matn</span>
          <span className="h-[1px] flex-1 bg-[rgba(22,21,17,0.14)]" />
          <span className="text-[#5D594E] text-[10.5px] font-mono tracking-normal">
            {wordCount} {lang === 'uz' ? 'soʻz' : 'слов'} · {Math.floor(estimatedSeconds / 60)}m {estimatedSeconds % 60}s
          </span>
        </div>

        {/* Title Input (Instrument Serif) */}
        <div className="flex items-center justify-between gap-3">
          <input
            type="text"
            value={title}
            onChange={(e) => onChangeTitle(e.target.value)}
            placeholder={
              lang === 'uz'
                ? "Podkast Mavzusi yoki Sarlavhasi..."
                : "Тема или Заголовок Подкаста..."
            }
            className="w-full bg-transparent font-serif font-normal text-2xl sm:text-3xl text-[#161511] placeholder:text-[#5D594E]/60 border-0 border-b border-[rgba(22,21,17,0.14)] pb-2 focus:outline-none focus:border-[#0E7C86] tracking-tight transition-colors"
          />

          {onSaveDraft && (
            <button
              type="button"
              onClick={onSaveDraft}
              disabled={!scriptText.trim()}
              className="p-2 rounded-xl bg-white border border-[rgba(22,21,17,0.14)] hover:border-[#161511] text-[#161511] transition-colors cursor-pointer shrink-0"
              title={lang === 'uz' ? 'Qoralamani saqlash' : 'Сохранить черновик'}
            >
              <BookmarkPlus className="w-4 h-4 text-[#0E7C86]" />
            </button>
          )}
        </div>

        {/* Category Pills */}
        <div>
          <span className="block text-xs font-semibold text-[#5D594E] mb-2">
            {lang === 'uz' ? 'Kategoriya va mavzu' : 'Категория и жанр'}
          </span>
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5">
            {PODCAST_CATEGORIES.slice(0, 8).map((cat) => {
              const isSel = cat.id === category.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => onSelectCategory(cat)}
                  className={`btn-pill text-xs px-3.5 py-1.5 whitespace-nowrap transition-all cursor-pointer ${
                    isSel
                      ? 'bg-[#161511] text-[#F4F1EA] border-[#161511]'
                      : 'bg-transparent border-[rgba(22,21,17,0.14)] text-[#5D594E] hover:border-[#161511] hover:text-[#161511]'
                  }`}
                >
                  {lang === 'uz' ? cat.nameUz : cat.nameRu}
                </button>
              );
            })}
          </div>
        </div>

        {/* AI Prompt Assistant Row */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
          <input
            type="text"
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder={
              lang === 'uz'
                ? "Mavzuni kiriting (masalan: Amir Temur va Samarqand, Sun'iy intellekt kelajagi...)"
                : "Введите тему подкаста для AI генератора..."
            }
            className="flex-1 bg-white border border-[rgba(22,21,17,0.14)] rounded-xl px-4 py-2 text-xs text-[#161511] placeholder:text-[#5D594E]/60 focus:outline-none focus:border-[#0E7C86]"
          />

          <button
            type="button"
            onClick={handleGenerateScript}
            disabled={isGeneratingScript}
            className="btn-pill btn-solid text-xs py-2 px-4 flex items-center justify-center gap-1.5 shrink-0"
          >
            {isGeneratingScript ? (
              <div className="w-3.5 h-3.5 border-2 border-[#F4F1EA] border-t-transparent rounded-full animate-spin" />
            ) : (
              <Wand2 className="w-3.5 h-3.5 text-[#5CC8CF]" />
            )}
            <span>{lang === 'uz' ? 'AI Ssenariy Yaratish' : 'AI Сценарий'}</span>
          </button>
        </div>

        {/* Vocal Cues & Emotion Tag Buttons (Terracotta & Teal) */}
        <div>
          <span className="block text-xs font-semibold text-[#5D594E] mb-2">
            {lang === 'uz' ? 'Jonli tovushlar va emotsiyalar (bosing, matnga qoʻshiladi):' : 'Живые эффекты и паузы:'}
          </span>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => insertCue('<breath>')}
                className="font-mono text-xs border border-[rgba(196,85,45,0.4)] text-[#C4552D] hover:bg-[rgba(196,85,45,0.08)] rounded-full px-3 py-1 transition-colors cursor-pointer"
              >
                &lt;breath&gt; nafas
              </button>
              <button
                type="button"
                onClick={() => insertCue('<laugh>')}
                className="font-mono text-xs border border-[rgba(196,85,45,0.4)] text-[#C4552D] hover:bg-[rgba(196,85,45,0.08)] rounded-full px-3 py-1 transition-colors cursor-pointer"
              >
                &lt;laugh&gt; kulgu
              </button>
              <button
                type="button"
                onClick={() => insertCue('|ha|')}
                className="font-mono text-xs border border-[rgba(14,124,134,0.4)] text-[#0A5A62] hover:bg-[rgba(14,124,134,0.08)] rounded-full px-3 py-1 transition-colors cursor-pointer"
              >
                |ha| tasdiq
              </button>
              <button
                type="button"
                onClick={() => insertCue('|mhm|')}
                className="font-mono text-xs border border-[rgba(14,124,134,0.4)] text-[#0A5A62] hover:bg-[rgba(14,124,134,0.08)] rounded-full px-3 py-1 transition-colors cursor-pointer"
              >
                |mhm|
              </button>
              <button
                type="button"
                onClick={() => insertCue('[Pauza 1s]')}
                className="font-mono text-xs border border-[rgba(22,21,17,0.2)] text-[#161511] hover:bg-black/5 rounded-full px-3 py-1 transition-colors cursor-pointer"
              >
                [Pauza]
              </button>
              <button
                type="button"
                onClick={() => insertCue('[Hayajon]')}
                className="font-mono text-xs border border-[rgba(22,21,17,0.2)] text-[#161511] hover:bg-black/5 rounded-full px-3 py-1 transition-colors cursor-pointer"
              >
                [Hayajon]
              </button>
            </div>

            <div className="flex items-center gap-2">
              {conditionAnalysis.hasConditions && (
                <button
                  type="button"
                  onClick={handleCleanConditions}
                  className="font-mono text-xs text-[#C4552D] hover:underline flex items-center gap-1 cursor-pointer"
                  title="Barcha skobka va shartlarni tozalash"
                >
                  <Eraser className="w-3 h-3" />
                  <span>{lang === 'uz' ? 'Tozalash' : 'Очистить'}</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleCopy}
                disabled={!scriptText.trim()}
                className="font-mono text-xs text-[#5D594E] hover:text-[#161511] flex items-center gap-1 cursor-pointer"
              >
                {copied ? <Check className="w-3 h-3 text-[#0E7C86]" /> : <Copy className="w-3 h-3" />}
                <span>{copied ? (lang === 'uz' ? 'Nusxalandi' : 'Скопировано') : (lang === 'uz' ? 'Nusxa' : 'Копия')}</span>
              </button>
            </div>
          </div>
        </div>

        {cleanNotice && (
          <div className="p-2.5 rounded-xl bg-[rgba(14,124,134,0.08)] text-[#0A5A62] text-xs flex items-center gap-2 font-mono">
            <Check className="w-3.5 h-3.5 shrink-0" />
            <span>{cleanNotice}</span>
          </div>
        )}

        {/* Script Editor (White Block, Radius 16, Mono 13px, LH 1.9) */}
        <div>
          <span className="block text-xs font-semibold text-[#5D594E] mb-1.5">
            {lang === 'uz'
              ? 'Matn — tuzilma teglari tembr va ohangni boshqaradi, ovozda oʻqilmaydi'
              : 'Текст сценария (теги [KIRISH], <breath> управляют голосом)'}
          </span>
          <textarea
            rows={14}
            value={scriptText}
            onChange={(e) => onChangeScriptText(e.target.value)}
            placeholder={
              lang === 'uz'
                ? `[KIRISH] Assalomu alaykum, qadrli tinglovchilar! <breath> Bugun siz bilan birga qiziqarli voqealarni oʻrganamiz...`
                : 'Введите текст подкаста на узбекском или русском языке...'
            }
            className="w-full bg-white border border-[rgba(22,21,17,0.14)] rounded-[16px] p-5 font-mono text-[13px] leading-[1.9] text-[#3A382F] placeholder:text-[#5D594E]/50 focus:outline-none focus:border-[#0E7C86] resize-y transition-colors shadow-sm"
          />
        </div>
      </div>
    </div>
  );
};
