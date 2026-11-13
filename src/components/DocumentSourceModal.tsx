import React, { useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { authFetch } from '../utils/authFetch';
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
  Music,
  Video,
  Sliders,
  Globe,
  Mic2,
  Users2,
  Film,
} from 'lucide-react';

interface DocumentSourceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (data: {
    targetFormat: 'podcast' | 'interview' | 'voiceover' | 'audiobook';
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
  const { isAuthenticated, requireAuth } = useAuth();
  const [activeTab, setActiveTab] = useState<'upload' | 'text' | 'link'>('upload');
  const [targetFormat, setTargetFormat] = useState<'podcast' | 'interview' | 'voiceover' | 'audiobook' | 'verbatim_dubbing'>(defaultFormat);
  const [targetDurationPreset, setTargetDurationPreset] = useState<string>('5 daqiqa');
  const [customMinutes, setCustomMinutes] = useState<number>(10);
  const [tone, setTone] = useState<string>('engaging');
  const [languageMode, setLanguageMode] = useState<'uzbek' | 'original'>('uzbek');
  const [userInstructions, setUserInstructions] = useState<string>('');

  // File upload state
  const [uploadedFile, setUploadedFile] = useState<{
    name: string;
    size: string;
    mimeType: string;
    base64: string;
    category: 'document' | 'audio' | 'video';
  } | null>(null);

  // Pasted text state
  const [sourceText, setSourceText] = useState<string>('');

  // Link state
  const [sourceUrl, setSourceUrl] = useState<string>('');

  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const isStoryboardOrVideoSource =
    targetFormat === 'verbatim_dubbing' ||
    targetFormat === 'voiceover' ||
    uploadedFile?.category === 'video' ||
    /(?:Видеоряд:|Интонация:|Текст:|\d{1,2}:\d{2}\s*[–—-]\s*\d{1,2}:\d{2})/i.test(sourceText);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMsg(null);
    let mimeType = file.type;
    let category: 'document' | 'audio' | 'video' = 'document';

    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith('.pdf')) {
      mimeType = 'application/pdf';
    } else if (lowerName.endsWith('.txt') || lowerName.endsWith('.md')) {
      mimeType = 'text/plain';
    } else if (lowerName.endsWith('.mp3')) {
      mimeType = 'audio/mp3';
      category = 'audio';
    } else if (lowerName.endsWith('.wav')) {
      mimeType = 'audio/wav';
      category = 'audio';
    } else if (lowerName.endsWith('.m4a')) {
      mimeType = 'audio/m4a';
      category = 'audio';
    } else if (lowerName.endsWith('.mp4')) {
      mimeType = 'video/mp4';
      category = 'video';
    }

    if (!mimeType) {
      mimeType = 'application/octet-stream';
    }

    const sizeMb = file.size / (1024 * 1024);
    if (sizeMb > 35) {
      setErrorMsg(
        lang === 'uz'
          ? "Fayl hajmi 35MB dan oshmasligi kerak. 15 daqiqalik katta videolar (600 MB gacha) uchun '2 Ovozli Intervyu' -> 'Aniq Dublyaj 1:1' bo'limidan foydalaning."
          : 'Для больших видео до 15 мин (до 600 МБ) используйте загрузку прямо в разделе «2 Ovozli Intervyu -> Точный дубляж 1:1».'
      );
      return;
    }

    const sizeStr = sizeMb < 1 ? `${(file.size / 1024).toFixed(1)} KB` : `${sizeMb.toFixed(1)} MB`;

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64Data = (reader.result as string).split(',')[1];
      setUploadedFile({
        name: file.name,
        size: sizeStr,
        mimeType,
        base64: base64Data,
        category,
      });
    };
    reader.readAsDataURL(file);
  };

  const finalTargetDuration =
    targetDurationPreset === 'custom'
      ? `${Math.min(10, customMinutes)} daqiqa`
      : targetDurationPreset;

  const handleAnalyze = async () => {
    if (
      !requireAuth(
        () => {},
        lang === 'uz'
          ? "Hujjatni tahlil qilish va ssenariy yaratish faqat ro'yxatdan o'tgan foydalanuvchilar uchun ochiq. Avval kiring!"
          : "Анализ документов доступен только для зарегистрированных пользователей."
      )
    )
      return;

    setErrorMsg(null);

    // Validation
    if (activeTab === 'upload' && !uploadedFile) {
      setErrorMsg(lang === 'uz' ? 'Iltimos, PDF, audio yoki matnli fayl yuklang' : 'Загрузите PDF, аудио или текстовый файл');
      return;
    }
    if (activeTab === 'text' && !sourceText.trim()) {
      setErrorMsg(lang === 'uz' ? 'Iltimos, maqola yoki raskadrovka matnini kiriting' : 'Введите текст статьи или раскадровку');
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
        targetDuration: finalTargetDuration,
        userInstructions,
        tone,
        languageMode,
      };

      if (activeTab === 'upload' && uploadedFile) {
        payload.documentBase64 = uploadedFile.base64;
        payload.mimeType = uploadedFile.mimeType;
      } else if (activeTab === 'text') {
        payload.sourceText = sourceText;
      } else if (activeTab === 'link') {
        payload.sourceUrl = sourceUrl;
        payload.sourceText = `Manba havolasi: ${sourceUrl}`;
      }

      const res = await authFetch('/api/podcast/analyze-document', {
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
        targetFormat:
          targetFormat === 'audiobook'
            ? 'podcast'
            : targetFormat === 'verbatim_dubbing'
            ? 'interview'
            : targetFormat,
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
    <div className="fixed inset-0 z-[9999] isolate flex items-center justify-center p-4 bg-[#161511]/75 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl bg-[#F4F1EA] text-[#161511] border border-[rgba(22,21,17,0.14)] rounded-[26px] p-6 sm:p-8 shadow-[0_30px_60px_-20px_rgba(22,21,17,0.35)] space-y-5 max-h-[92vh] overflow-y-auto no-scrollbar">
        {/* Soft Glow */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-[#0E7C86]/10 blur-3xl pointer-events-none" />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 text-[#5D594E] hover:text-[#161511] rounded-full hover:bg-black/5 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono uppercase tracking-wider bg-[#0E7C86]/10 text-[#0E7C86] border border-[#0E7C86]/20 mb-2">
            <Sparkles className="w-3.5 h-3.5 text-[#0E7C86]" />
            <span>Hujjat & Manbalar Hubi</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-serif text-[#161511] tracking-tight">
            {lang === 'uz'
              ? 'PDF, Raskadrovka yoki Matndan Yaratish'
              : 'Импорт PDF, Раскадровки или Статьи'}
          </h2>
          <p className="text-xs text-[#5D594E] mt-1">
            {lang === 'uz'
              ? 'PDF maqola, NotebookLM konspekti yoki taymkodli ruscha raskadrovkani yuboring.'
              : 'Загрузите PDF, статью или раскадровку с таймкодами для создания подкаста или точного дубляжа 1:1.'}
          </p>
        </div>

        {/* Source Tabs */}
        <div className="grid grid-cols-3 gap-2 bg-[#ECE7DB] p-1 rounded-full text-xs font-medium">
          <button
            onClick={() => setActiveTab('upload')}
            className={`py-2 px-3 rounded-full transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'upload'
                ? 'bg-[#161511] text-[#F4F1EA] shadow-xs'
                : 'text-[#5D594E] hover:text-[#161511]'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>{lang === 'uz' ? 'PDF / Audio' : 'PDF / Аудио'}</span>
          </button>
          <button
            onClick={() => setActiveTab('text')}
            className={`py-2 px-3 rounded-full transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'text'
                ? 'bg-[#161511] text-[#F4F1EA] shadow-xs'
                : 'text-[#5D594E] hover:text-[#161511]'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>{lang === 'uz' ? 'Matn / Raskadrovka' : 'Текст / Раскадровка'}</span>
          </button>
          <button
            onClick={() => setActiveTab('link')}
            className={`py-2 px-3 rounded-full transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'link'
                ? 'bg-[#161511] text-[#F4F1EA] shadow-xs'
                : 'text-[#5D594E] hover:text-[#161511]'
            }`}
          >
            <Link className="w-3.5 h-3.5" />
            <span>{lang === 'uz' ? 'Havola' : 'Ссылка'}</span>
          </button>
        </div>

        {/* Tab 1: File Upload */}
        {activeTab === 'upload' && (
          <div className="space-y-3">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".pdf,.txt,.md,.doc,.docx,.mp3,.wav,.m4a,.aac,.mp4,.webm"
              className="hidden"
            />
            <div
              onClick={() => fileInputRef.current?.click()}
              className="p-8 rounded-2xl bg-white hover:bg-[#ECE7DB]/50 border-2 border-dashed border-[rgba(22,21,17,0.18)] hover:border-[#0E7C86] flex flex-col items-center justify-center text-center cursor-pointer transition-all shadow-xs"
            >
              {uploadedFile?.category === 'audio' ? (
                <Music className="w-10 h-10 text-[#0E7C86] mb-2" />
              ) : uploadedFile?.category === 'video' ? (
                <Video className="w-10 h-10 text-[#0E7C86] mb-2" />
              ) : (
                <FileUp className="w-10 h-10 text-[#0E7C86] mb-2 animate-bounce" />
              )}
              <p className="text-sm font-semibold text-[#161511]">
                {uploadedFile
                  ? uploadedFile.name
                  : lang === 'uz'
                  ? 'Fayl tanlash uchun bosing (PDF, Word, TXT, MP3, WAV)'
                  : 'Нажмите для выбора файла (PDF, DOCX, TXT, MP3, WAV)'}
              </p>
              <p className="font-mono text-xs text-[#7D7A70] mt-1">
                {uploadedFile
                  ? `${uploadedFile.size} • ${uploadedFile.category.toUpperCase()} • Tayyor`
                  : lang === 'uz'
                  ? 'PDF hujjatlar, audio yozuvlar yoki maqolalar'
                  : 'Документы PDF, аудио или текстовые файлы'}
              </p>
            </div>
          </div>
        )}

        {/* Tab 2: Text / Article / Storyboard */}
        {activeTab === 'text' && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="font-mono text-xs text-[#5D594E] uppercase tracking-wider block">
                {lang === 'uz'
                  ? 'Maqola matni yoki taymkodli ruscha raskadrovka:'
                  : 'Вставьте текст статьи или раскадровку с таймкодами:'}
              </label>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    setSourceText(
                      "O'zbekistonda sun'iy intellekt texnologiyalari bank, ta'lim, tibbiyot va davlat xizmatlarida keng joriy etilmoqda. 2026-yilga kelib mahalliy o'zbek tilidagi ovozli modellar va raqamli ekotizimlar biznes samaradorligini 40 foizga oshirdi."
                    )
                  }
                  className="text-[10.5px] px-2.5 py-1 rounded-full bg-[#0E7C86]/10 hover:bg-[#0E7C86]/20 text-[#0A5A62] border border-[#0E7C86]/25 transition-colors cursor-pointer font-medium"
                >
                  + {lang === 'uz' ? 'AI & Iqtisodiyot konspekti' : 'Шаблон: ИИ и экономика'}
                </button>
              </div>
            </div>
            <textarea
              rows={6}
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              placeholder={
                lang === 'uz'
                  ? 'Masalan: Maqola matni yoki 00:00 – 00:02 | Девушка (Ж): Текст: «...»'
                  : 'Например: текст статьи или раскадровка 00:00 – 00:02 | Девушка (Ж): Текст: «...»'
              }
              className="w-full bg-white border border-[rgba(22,21,17,0.14)] rounded-2xl p-4 text-xs sm:text-sm text-[#161511] placeholder-[#7D7A70] focus:outline-none focus:border-[#0E7C86] resize-none font-sans leading-relaxed shadow-xs"
            />
          </div>
        )}

        {/* Tab 3: Link / Video */}
        {activeTab === 'link' && (
          <div className="space-y-2">
            <label className="font-mono text-xs text-[#5D594E] uppercase tracking-wider block">
              {lang === 'uz' ? 'Veb-maqola yoki video havolasi:' : 'Ссылка на статью или видео:'}
            </label>
            <input
              type="text"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://..."
              className="w-full bg-white border border-[rgba(22,21,17,0.14)] rounded-full px-4 py-3 text-xs sm:text-sm text-[#161511] placeholder-[#7D7A70] focus:outline-none focus:border-[#0E7C86] shadow-xs"
            />
          </div>
        )}

        {/* Format Selector */}
        <div className="space-y-1.5 pt-1">
          <label className="font-mono text-xs uppercase tracking-wider text-[#5D594E] flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-[#0E7C86]" />
              <span>{lang === 'uz' ? 'Rejimni tanlang:' : 'Выберите режим работы:'}</span>
            </span>
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button
              type="button"
              onClick={() => setTargetFormat('verbatim_dubbing')}
              className={`py-2 px-2.5 rounded-full text-xs font-medium flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                targetFormat === 'verbatim_dubbing'
                  ? 'bg-[#0E7C86] text-white shadow-xs'
                  : 'bg-white border border-[rgba(22,21,17,0.12)] text-[#5D594E] hover:border-[#0E7C86]'
              }`}
            >
              <Video className="w-3.5 h-3.5" />
              <span>{lang === 'uz' ? 'Aniq Dublyaj 1:1' : 'Дубляж 1:1'}</span>
            </button>

            <button
              type="button"
              onClick={() => setTargetFormat('interview')}
              className={`py-2 px-2.5 rounded-full text-xs font-medium flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                targetFormat === 'interview'
                  ? 'bg-[#161511] text-[#F4F1EA] shadow-xs'
                  : 'bg-white border border-[rgba(22,21,17,0.12)] text-[#5D594E] hover:border-[#161511]'
              }`}
            >
              <Users2 className="w-3.5 h-3.5" />
              <span>{lang === 'uz' ? '2 Ovozli Intervyu' : 'Интервью (2 голоса)'}</span>
            </button>

            <button
              type="button"
              onClick={() => setTargetFormat('podcast')}
              className={`py-2 px-2.5 rounded-full text-xs font-medium flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                targetFormat === 'podcast'
                  ? 'bg-[#161511] text-[#F4F1EA] shadow-xs'
                  : 'bg-white border border-[rgba(22,21,17,0.12)] text-[#5D594E] hover:border-[#161511]'
              }`}
            >
              <Mic2 className="w-3.5 h-3.5" />
              <span>{lang === 'uz' ? 'Yakka Podkast' : 'Соло Подкаст'}</span>
            </button>

            <button
              type="button"
              onClick={() => setTargetFormat('voiceover')}
              className={`py-2 px-2.5 rounded-full text-xs font-medium flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                targetFormat === 'voiceover'
                  ? 'bg-[#161511] text-[#F4F1EA] shadow-xs'
                  : 'bg-white border border-[rgba(22,21,17,0.12)] text-[#5D594E] hover:border-[#161511]'
              }`}
            >
              <Film className="w-3.5 h-3.5" />
              <span>{lang === 'uz' ? 'Reels Ovoz' : 'Reels Озвучка'}</span>
            </button>
          </div>
        </div>

        {/* Duration Selector: ONLY shown when generating AI Podcast/Interview by topic/article (max 10 min), hidden for video/verbatim dubbing */}
        {!isStoryboardOrVideoSource ? (
          <div className="pt-1">
            <div className="space-y-1.5">
              <label className="font-mono text-xs uppercase tracking-wider text-[#5D594E] flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-[#0E7C86]" />
                  {lang === 'uz' ? 'Podkast davomiyligi (10 daqiqagacha):' : 'Длительность подкаста (до 10 минут):'}
                </span>
                <span className="text-[10px] text-[#0A5A62] font-mono font-bold">
                  {finalTargetDuration}
                </span>
              </label>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { val: '1 daqiqa', labelUz: '1 daqiqa', labelRu: '1 минута' },
                  { val: '3 daqiqa', labelUz: '3 daqiqa', labelRu: '3 минуты' },
                  { val: '5 daqiqa', labelUz: '5 daqiqa', labelRu: '5 минут' },
                  { val: '10 daqiqa', labelUz: '10 daqiqa', labelRu: '10 минут' },
                ].map((d) => (
                  <button
                    key={d.val}
                    type="button"
                    onClick={() => setTargetDurationPreset(d.val)}
                    className={`py-2 px-3 rounded-full text-xs font-medium transition-all cursor-pointer ${
                      targetDurationPreset === d.val
                        ? 'bg-[#161511] text-[#F4F1EA] font-semibold'
                        : 'bg-white border border-[rgba(22,21,17,0.14)] text-[#5D594E] hover:text-[#161511]'
                    }`}
                  >
                    {lang === 'uz' ? d.labelUz : d.labelRu}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="p-3 rounded-xl bg-[#0E7C86]/10 border border-[#0E7C86]/25 text-xs text-[#0A5A62] flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#0E7C86] shrink-0" />
            <span>
              {lang === 'uz'
                ? "Taymkodli raskadrovka va videodublyajda davomiylik avtomatik ravishda video va taymkodlar bo'yicha belgilanadi (1:1)."
                : 'При дубляже видео и раскадровки с таймкодами длительность определяется автоматически по таймкодам (1:1 без отсебятины).'}
            </span>
          </div>
        )}

        {/* Error Message */}
        {errorMsg && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* CTA Analyze Button */}
        <button
          onClick={handleAnalyze}
          disabled={isAnalyzing}
          className="w-full py-3.5 bg-[#161511] hover:bg-[#0A5A62] disabled:opacity-50 text-[#F4F1EA] font-medium text-sm rounded-full flex items-center justify-center gap-2 transition-all shadow-xs cursor-pointer"
        >
          <Sparkles className={`w-4 h-4 ${isAnalyzing ? 'animate-spin' : ''}`} />
          <span>
            {isAnalyzing
              ? (lang === 'uz' ? 'Tahlil Qilinmoqda...' : 'Обработка...')
              : isStoryboardOrVideoSource
              ? (lang === 'uz' ? '1:1 Aniq Dublyajga Oʻtkazish' : 'Перевести раскадровку 1:1 по таймкодам')
              : (lang === 'uz' ? `${finalTargetDuration}lik Ssenariy Yaratish` : `Создать сценарий (${finalTargetDuration})`)}
          </span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

