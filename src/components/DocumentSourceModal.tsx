import React, { useState, useRef } from 'react';
import {
  FileText,
  Upload,
  Link,
  Sparkles,
  X,
  FileCheck,
  CheckCircle2,
  AlertCircle,
  FileUp,
  Clock,
  Layers,
  ArrowRight,
} from 'lucide-react';

interface DocumentSourceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (data: {
    targetFormat: 'podcast' | 'interview' | 'voiceover';
    title?: string;
    description?: string;
    tags?: string[];
    script?: string;
    turns?: any[];
  }) => void;
  defaultFormat?: 'podcast' | 'interview' | 'voiceover';
  lang: 'uz' | 'ru';
}

export const DocumentSourceModal: React.FC<DocumentSourceModalProps> = ({
  isOpen,
  onClose,
  onApply,
  defaultFormat = 'podcast',
  lang,
}) => {
  const [activeTab, setActiveTab] = useState<'upload' | 'text' | 'link'>('upload');
  const [targetFormat, setTargetFormat] = useState<'podcast' | 'interview' | 'voiceover'>(defaultFormat);
  const [targetDuration, setTargetDuration] = useState<string>('2 daqiqa');
  const [userInstructions, setUserInstructions] = useState<string>('');

  // File upload state
  const [uploadedFile, setUploadedFile] = useState<{
    name: string;
    size: string;
    mimeType: string;
    base64: string;
  } | null>(null);

  // Pasted text state
  const [sourceText, setSourceText] = useState<string>('');

  // Link state
  const [sourceUrl, setSourceUrl] = useState<string>('');

  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMsg(null);
    const mimeType = file.type || (file.name.endsWith('.pdf') ? 'application/pdf' : 'text/plain');
    const sizeStr = `${(file.size / 1024).toFixed(1)} KB`;

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64Data = (reader.result as string).split(',')[1];
      setUploadedFile({
        name: file.name,
        size: sizeStr,
        mimeType,
        base64: base64Data,
      });
    };
    reader.readAsDataURL(file);
  };

  const handleAnalyze = async () => {
    setErrorMsg(null);

    // Validation
    if (activeTab === 'upload' && !uploadedFile) {
      setErrorMsg(lang === 'uz' ? 'Iltimos, PDF yoki matnli fayl yuklang' : 'Загрузите PDF или текстовый файл');
      return;
    }
    if (activeTab === 'text' && !sourceText.trim()) {
      setErrorMsg(lang === 'uz' ? 'Iltimos, maqola yoki qoralama matnini kiriting' : 'Введите текст статьи или черновика');
      return;
    }
    if (activeTab === 'link' && !sourceUrl.trim()) {
      setErrorMsg(lang === 'uz' ? 'Iltimos, havola kiriting' : 'Введите ссылку');
      return;
    }

    setIsAnalyzing(true);
    try {
      const payload: any = {
        targetFormat,
        targetDuration,
        userInstructions,
      };

      if (activeTab === 'upload' && uploadedFile) {
        payload.documentBase64 = uploadedFile.base64;
        payload.mimeType = uploadedFile.mimeType;
      } else if (activeTab === 'text') {
        payload.sourceText = sourceText;
      } else if (activeTab === 'link') {
        payload.sourceText = `Manba havolasi: ${sourceUrl}`;
      }

      const res = await fetch('/api/podcast/analyze-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Tahlil qilishda xatolik');
      }

      const data = await res.json();
      onApply({
        targetFormat,
        title: data.title,
        description: data.description,
        tags: data.tags,
        script: data.script,
        turns: data.turns,
      });
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Xatolik yuz berdi');
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/80 backdrop-blur-md">
      <div className="relative w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 text-zinc-400 hover:text-white rounded-full bg-zinc-800/60 hover:bg-zinc-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 mb-2">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span>Gemini 3.8 Document & Multimodal Analyzer</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            {lang === 'uz'
              ? 'PDF, Maqola yoki Hujjatdan Ssenariy Yaratish'
              : 'Создание Сценария из PDF, Статьи или Документа'}
          </h2>
          <p className="text-xs sm:text-sm text-zinc-400 mt-1">
            {lang === 'uz'
              ? 'Hujjatni yuklang yoki ruscha/inglizcha maqola matnini yuboring. Gemini 3.8 uni chuqur tahlil qilib, jonli o\'zbek tilidagi ssenariyga aylantiradi.'
              : 'Загрузите PDF или отправьте статью на русском/английском. Gemini 3.8 проанализирует и адаптирует в живой узбекский сценарий.'}
          </p>
        </div>

        {/* Source Tabs */}
        <div className="grid grid-cols-3 gap-2 bg-zinc-950 p-1.5 rounded-2xl border border-zinc-800 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('upload')}
            className={`py-2 px-3 rounded-xl transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'upload'
                ? 'bg-cyan-500 text-zinc-950 font-bold shadow-md shadow-cyan-500/20'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>{lang === 'uz' ? 'PDF / Hujjat' : 'PDF / Документ'}</span>
          </button>
          <button
            onClick={() => setActiveTab('text')}
            className={`py-2 px-3 rounded-xl transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'text'
                ? 'bg-cyan-500 text-zinc-950 font-bold shadow-md shadow-cyan-500/20'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>{lang === 'uz' ? 'Maqola Matni' : 'Текст Статьи'}</span>
          </button>
          <button
            onClick={() => setActiveTab('link')}
            className={`py-2 px-3 rounded-xl transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'link'
                ? 'bg-cyan-500 text-zinc-950 font-bold shadow-md shadow-cyan-500/20'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Link className="w-3.5 h-3.5" />
            <span>{lang === 'uz' ? 'Havola / Video' : 'Ссылка / Видео'}</span>
          </button>
        </div>

        {/* Tab 1: File Upload */}
        {activeTab === 'upload' && (
          <div className="space-y-3">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".pdf,.txt,.md,.doc,.docx"
              className="hidden"
            />
            <div
              onClick={() => fileInputRef.current?.click()}
              className="p-8 border-2 border-dashed border-zinc-800 hover:border-cyan-500/50 rounded-2xl bg-zinc-950/60 flex flex-col items-center justify-center text-center cursor-pointer transition-all hover:bg-zinc-950"
            >
              <FileUp className="w-10 h-10 text-cyan-400 mb-2 animate-bounce" />
              <p className="text-sm font-bold text-white">
                {uploadedFile
                  ? uploadedFile.name
                  : lang === 'uz'
                  ? 'PDF yoki hujjat faylini tanlash uchun bosing'
                  : 'Нажмите для выбора PDF или документа'}
              </p>
              <p className="text-xs text-zinc-500 mt-1">
                {uploadedFile
                  ? `${uploadedFile.size} • Tayyor`
                  : 'PDF, TXT, Markdown (Maksimal 20MB)'}
              </p>
            </div>
          </div>
        )}

        {/* Tab 2: Text / Article */}
        {activeTab === 'text' && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-400">
              {lang === 'uz'
                ? 'Maqola, qoralama yoki faktlar matnini shu yerga qo\'ying:'
                : 'Вставьте текст статьи, черновик на любом языке:'}
            </label>
            <textarea
              rows={6}
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              placeholder={
                lang === 'uz'
                  ? 'Masalan: Rus yoki ingliz tilidagi yangilik, ilmiy maqola, tarixiy faktlar...'
                  : 'Например: текст статьи на русском, заметки, пресс-релиз...'
              }
              className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl p-4 text-xs sm:text-sm text-zinc-200 focus:outline-none focus:border-cyan-500 resize-none font-sans leading-relaxed"
            />
          </div>
        )}

        {/* Tab 3: Link / Video */}
        {activeTab === 'link' && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-400">
              {lang === 'uz' ? 'YouTube, Reels yoki Maqola havolasi:' : 'Ссылка на статью, YouTube или Reels:'}
            </label>
            <input
              type="text"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://..."
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-xs sm:text-sm text-white focus:outline-none focus:border-cyan-500"
            />
          </div>
        )}

        {/* Configuration: Target Format & Duration */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          {/* Target Format */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              {lang === 'uz' ? 'Qanday ssenariy yaratilsin?' : 'В какой формат преобразовать?'}
            </label>
            <select
              value={targetFormat}
              onChange={(e) => setTargetFormat(e.target.value as any)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-cyan-500"
            >
              <option value="podcast">Yakka Boshlovchi Podkasti (Podcast)</option>
              <option value="interview">2 Kishi Intervyu Dialogi (Multi-Speaker)</option>
              <option value="voiceover">Video Dublyaj / Ovozlashtirish (Reels/Ads)</option>
            </select>
          </div>

          {/* Target Duration */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-cyan-400" />
              {lang === 'uz' ? 'Mo\'ljallangan vaqt:' : 'Желаемое время звучания:'}
            </label>
            <select
              value={targetDuration}
              onChange={(e) => setTargetDuration(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-cyan-500"
            >
              <option value="30 soniya">30 soniya (Qisqa xuk / Reels)</option>
              <option value="1 daqiqa">1 daqiqa (Tezkor yangiliklar)</option>
              <option value="2 daqiqa">2 daqiqa (Standart podkast soni)</option>
              <option value="4 daqiqa">4 daqiqa (Batafsil chuqur tahlil)</option>
            </select>
          </div>
        </div>

        {/* User Instructions */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-zinc-300">
            {lang === 'uz' ? 'Maxsus talab va ko\'rsatmalar (ixtiyoriy):' : 'Особые пожелания (необязательно):'}
          </label>
          <input
            type="text"
            value={userInstructions}
            onChange={(e) => setUserInstructions(e.target.value)}
            placeholder={
              lang === 'uz'
                ? 'Masalan: Asosiy e\'tiborni 2-bo\'limga qarating, kulgili misollar qo\'shing...'
                : 'Например: акцент на факты, сделать в юмористическом тоне...'
            }
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
          />
        </div>

        {/* Error Message */}
        {errorMsg && (
          <div className="p-3 bg-red-950/40 border border-red-500/40 rounded-xl text-xs text-red-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* CTA Analyze Button */}
        <button
          onClick={handleAnalyze}
          disabled={isAnalyzing}
          className="w-full py-3.5 bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 disabled:opacity-50 text-zinc-950 font-bold text-sm rounded-2xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-cyan-500/25 cursor-pointer"
        >
          <Sparkles className={`w-4 h-4 ${isAnalyzing ? 'animate-spin' : ''}`} />
          <span>
            {isAnalyzing
              ? (lang === 'uz' ? 'Gemini 3.8 Hujjatni Tahlil Qilmoqda...' : 'Gemini 3.8 Анализирует...')
              : (lang === 'uz' ? 'Hujjat Asosida Ssenariyni Yaratish' : 'Сгенерировать Сценарий по Документу')}
          </span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
