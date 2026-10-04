import React, { useState, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
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
  onOpenNotebookLMGuide?: () => void;
}

export const DocumentSourceModal: React.FC<DocumentSourceModalProps> = ({
  isOpen,
  onClose,
  onApply,
  defaultFormat = 'podcast',
  lang,
  onOpenNotebookLMGuide,
}) => {
  const { isAuthenticated, requireAuth } = useAuth();
  const [activeTab, setActiveTab] = useState<'upload' | 'text' | 'link'>('upload');
  const [targetFormat, setTargetFormat] = useState<'podcast' | 'interview' | 'voiceover' | 'audiobook'>(defaultFormat);
  const [targetDurationPreset, setTargetDurationPreset] = useState<string>('10 daqiqa');
  const [customMinutes, setCustomMinutes] = useState<number>(15);
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
          ? "Fayl hajmi 35MB dan oshmasligi kerak. Katta fayllar uchun YouTube havola yoki matn nusxasidan foydalaning."
          : 'Размер файла не должен превышать 35МБ. Для больших файлов используйте ссылку на видео или текст.'
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
      ? `${customMinutes} daqiqa`
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
        targetFormat: targetFormat === 'audiobook' ? 'podcast' : targetFormat,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#161511]/60 backdrop-blur-sm animate-in fade-in duration-200">
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
              ? 'PDF, Video yoki Matndan Podkast Yaratish'
              : 'Создание Подкаста из PDF, Видео или Текста'}
          </h2>
          <p className="text-xs text-[#5D594E] mt-1">
            {lang === 'uz'
              ? 'NotebookLM konspekti, video, PDF yoki audio faylni yuboring. Eng kerakli mohiyat qisqa Reels yoki to\'liq o\'zbekcha podkastga aylanadi.'
              : 'Загрузите заметки, видео, PDF или аудио для преобразования в готовый сценарий подкаста.'}
          </p>

          {/* NotebookLM workflow helper banner */}
          <div className="mt-3 p-3.5 rounded-2xl bg-white border border-[rgba(22,21,17,0.12)] flex items-start gap-2.5 text-[11px] text-[#5D594E] shadow-2xs">
            <span className="p-1 rounded-lg bg-[#0E7C86]/10 text-[#0E7C86] shrink-0 font-bold font-mono">LM</span>
            <div>
              <p className="font-semibold text-[#161511]">
                {lang === 'uz' ? 'NotebookLM bilan integratsiya qanday ishlaydi?' : 'Как интегрировать с NotebookLM?'}
              </p>
              <p className="text-[#5D594E] mt-0.5 leading-relaxed">
                {lang === 'uz'
                  ? '1) NotebookLM’dagi konspektni "Maqola Matni"ga qo\'ying yoki 2) Audio Overview (mp3) faylini yuklang — OvozStudio darhol o\'zbekcha ovozlarda tayyorlab beradi.'
                  : '1) Скопируйте заметки из NotebookLM во вкладку "Текст" или 2) Загрузите MP3 файл — OvozStudio сразу создаст подкаст на чистом узбекском.'}
              </p>
              {onOpenNotebookLMGuide && (
                <button
                  type="button"
                  onClick={onOpenNotebookLMGuide}
                  className="mt-1.5 text-[#0E7C86] hover:text-[#0A5A62] font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <span>{lang === 'uz' ? "Yo'riqnomani ko'rish" : 'Открыть руководство'}</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
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
            <span>{lang === 'uz' ? 'Maqola Matni' : 'Текст'}</span>
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
            <span>{lang === 'uz' ? 'Video Havola' : 'Ссылка'}</span>
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
                  ? 'Fayl tanlash uchun bosing (PDF, Word, TXT, MP3, WAV, MP4)'
                  : 'Нажмите для выбора файла (PDF, DOCX, TXT, MP3, WAV, MP4)'}
              </p>
              <p className="font-mono text-xs text-[#7D7A70] mt-1">
                {uploadedFile
                  ? `${uploadedFile.size} • ${uploadedFile.category.toUpperCase()} • Tayyor`
                  : 'PDF hujjatlar, audio yozuvlar yoki maqolalar (Maksimal 35MB)'}
              </p>
            </div>
          </div>
        )}

        {/* Tab 2: Text / Article */}
        {activeTab === 'text' && (
          <div className="space-y-2">
            <label className="font-mono text-xs text-[#5D594E] uppercase tracking-wider block">
              {lang === 'uz'
                ? 'Maqola, qoralama yoki ma\'ruza matnini shu yerga qo\'ying:'
                : 'Вставьте текст статьи, лекции или черновик:'}
            </label>
            <textarea
              rows={6}
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              placeholder={
                lang === 'uz'
                  ? 'Masalan: Maqola matni, intervyu tezislari, tahliliy yangiliklar...'
                  : 'Например: текст статьи, заметки, тезисы...'
              }
              className="w-full bg-white border border-[rgba(22,21,17,0.14)] rounded-2xl p-4 text-xs sm:text-sm text-[#161511] placeholder-[#7D7A70] focus:outline-none focus:border-[#0E7C86] resize-none font-sans leading-relaxed shadow-xs"
            />
          </div>
        )}

        {/* Tab 3: Link / Video */}
        {activeTab === 'link' && (
          <div className="space-y-2">
            <label className="font-mono text-xs text-[#5D594E] uppercase tracking-wider block">
              {lang === 'uz' ? 'YouTube, TikTok yoki Veb-havola:' : 'Ссылка на YouTube, TikTok или статью:'}
            </label>
            <input
              type="text"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              className="w-full bg-white border border-[rgba(22,21,17,0.14)] rounded-full px-4 py-3 text-xs sm:text-sm text-[#161511] placeholder-[#7D7A70] focus:outline-none focus:border-[#0E7C86] shadow-xs"
            />
            <div className="p-3.5 bg-white border border-[rgba(22,21,17,0.12)] rounded-xl space-y-1.5 text-[11px] text-[#5D594E] shadow-2xs">
              <div className="flex items-center gap-2 text-[#161511] font-semibold">
                <Sparkles className="w-3.5 h-3.5 text-[#0E7C86]" />
                <span>{lang === 'uz' ? 'Aqlli Media Integratsiya:' : 'Как это работает по ссылке:'}</span>
              </div>
              <ul className="space-y-1 list-disc list-inside text-[#5D594E] text-[10.5px]">
                <li><strong className="text-[#161511]">YouTube:</strong> {lang === 'uz' ? "Videoning nutqi olinadi va o'zbekchaga o'giriladi." : 'Извлекается стенограмма речи спикера и переводится.'}</li>
                <li><strong className="text-[#161511]">Audio / Podkast:</strong> {lang === 'uz' ? "Audio tahlil qilinadi va yangi podkast tuziladi." : 'Анализируется дорожка и создается сценарий.'}</li>
              </ul>
            </div>
          </div>
        )}

        {/* Format Selector: Solo vs Interview vs Voiceover */}
        <div className="space-y-1.5 pt-1">
          <label className="font-mono text-xs uppercase tracking-wider text-[#5D594E] flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-[#0E7C86]" />
              <span>{lang === 'uz' ? 'Qanday formatda ssenariy yaratilsin?' : 'В каком формате создать сценарий?'}</span>
            </span>
          </label>
          <div className="grid grid-cols-3 gap-2">
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
              <span>{lang === 'uz' ? 'Yakka Podkast' : 'Одиночный'}</span>
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
              <span>{lang === 'uz' ? '2 Kishi Intervyu' : 'Интервью (2 голоса)'}</span>
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
              <span>{lang === 'uz' ? 'Reels Dublyaj' : 'Reels / Озвучка'}</span>
            </button>
          </div>
        </div>

        {/* Configuration: Duration and Topic focus */}
        <div className="pt-1">
          <div className="space-y-1.5">
            <label className="font-mono text-xs uppercase tracking-wider text-[#5D594E] flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-[#0E7C86]" />
                {lang === 'uz' ? 'Podkast davomiyligi (Xronometraj):' : 'Длительность подкаста:'}
              </span>
              <span className="text-[10px] text-[#0A5A62] font-mono font-bold">
                {finalTargetDuration}
              </span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <select
                value={targetDurationPreset}
                onChange={(e) => setTargetDurationPreset(e.target.value)}
                className="w-full bg-white border border-[rgba(22,21,17,0.14)] rounded-full px-4 py-2 text-xs text-[#161511] focus:outline-none focus:border-[#0E7C86] cursor-pointer shadow-xs"
              >
                <option value="30 soniya">30 soniya (Reels / Shorts xuk)</option>
                <option value="1 daqiqa">1 daqiqa (Tezkor yangiliklar)</option>
                <option value="2 daqiqa">2 daqiqa (Qisqa xulosa / Reels)</option>
                <option value="3 daqiqa">3 daqiqa (Qisqa podkast)</option>
                <option value="5 daqiqa">5 daqiqa (Mavzu sharhi)</option>
                <option value="10 daqiqa">10 daqiqa (Standart podkast soni)</option>
                <option value="15 daqiqa">15 daqiqa (Tahliliy podkast)</option>
                <option value="custom">Ixtiyoriy daqiqa (Custom)...</option>
              </select>

              {targetDurationPreset === 'custom' ? (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={customMinutes}
                    onChange={(e) => setCustomMinutes(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-24 bg-white border border-[rgba(22,21,17,0.14)] rounded-full px-3 py-1.5 text-xs text-[#161511] focus:outline-none focus:border-[#0E7C86]"
                  />
                  <span className="font-mono text-xs text-[#7D7A70]">
                    {lang === 'uz' ? 'daqiqa (1 dan 120 gacha)' : 'минут (от 1 до 120)'}
                  </span>
                </div>
              ) : (
                <div className="font-mono text-[11px] text-[#7D7A70] flex items-center bg-white border border-[rgba(22,21,17,0.12)] px-3 rounded-full">
                  {lang === 'uz'
                    ? 'Gemini mos so\'zlar sonini tanlaydi.'
                    : 'Gemini подберет точное число слов.'}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Tone and Language Adaptation */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="font-mono text-xs uppercase tracking-wider text-[#5D594E] flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-[#0E7C86]" />
              {lang === 'uz' ? 'Ijro ohangi va uslubi:' : 'Тон и стиль подачи:'}
            </label>
            <select
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              className="w-full bg-white border border-[rgba(22,21,17,0.14)] rounded-full px-4 py-2 text-xs text-[#161511] focus:outline-none focus:border-[#0E7C86] cursor-pointer shadow-xs"
            >
              <option value="engaging">Jonli, samimiy va jalb qiluvchi</option>
              <option value="analytical">Chuqur ilmiy, tahliliy ekspert</option>
              <option value="commercial">Dinamik va yuqori energiya</option>
              <option value="storytelling">Badiiy, ta'sirchan hikoyanavislik</option>
              <option value="humorous">Yengil, quvnoq va hazilomuz</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="font-mono text-xs uppercase tracking-wider text-[#5D594E] flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-[#0E7C86]" />
              {lang === 'uz' ? 'Til moslashuvi:' : 'Языковая адаптация:'}
            </label>
            <select
              value={languageMode}
              onChange={(e) => setLanguageMode(e.target.value as any)}
              className="w-full bg-white border border-[rgba(22,21,17,0.14)] rounded-full px-4 py-2 text-xs text-[#161511] focus:outline-none focus:border-[#0E7C86] cursor-pointer shadow-xs"
            >
              <option value="uzbek">O'zbek tiliga mukammal lokalizatsiya</option>
              <option value="original">Asl tilda saqlash (Ruscha / Inglizcha)</option>
            </select>
          </div>
        </div>

        {/* User Instructions */}
        <div className="space-y-1.5">
          <label className="font-mono text-xs uppercase tracking-wider text-[#5D594E] block">
            {lang === 'uz' ? 'Maxsus ko\'rsatmalar (ixtiyoriy):' : 'Пожелания (необязательно):'}
          </label>
          <input
            type="text"
            value={userInstructions}
            onChange={(e) => setUserInstructions(e.target.value)}
            placeholder={
              lang === 'uz'
                ? 'Masalan: Hayotiy misollar va savol-javob qo\'shing...'
                : 'Например: добавить примеры, диалог...'
            }
            className="w-full bg-white border border-[rgba(22,21,17,0.14)] rounded-full px-4 py-2.5 text-xs text-[#161511] placeholder-[#7D7A70] focus:outline-none focus:border-[#0E7C86] shadow-xs"
          />
        </div>

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
              ? (lang === 'uz' ? 'Multimodal Tahlil Qilmoqda...' : 'Анализирует...')
              : (lang === 'uz' ? `${finalTargetDuration}lik Mukammal Ssenariy Yaratish` : `Сгенерировать Сценарий (${finalTargetDuration})`)}
          </span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

