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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/80 backdrop-blur-md">
      <div className="relative w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-5 max-h-[92vh] overflow-y-auto">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 text-zinc-400 hover:text-white rounded-full bg-zinc-800/60 hover:bg-zinc-800 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 mb-2">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span>Gemini 3.8 Multimodal & Content Hub</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            {lang === 'uz'
              ? 'PDF, Video, Audio yoki Matndan Ssenariy Yaratish'
              : 'Создание Сценария из PDF, Видео, Аудио или Текста'}
          </h2>
          <p className="text-xs sm:text-sm text-zinc-400 mt-1">
            {lang === 'uz'
              ? 'PDF hujjat, YouTube/video havola, audio yozuv yoki maqola matnini yuboring. Gemini 3.8 uni tahlil qilib, 30 soniyadan 60 daqiqagacha bo\'lgan professional ssenariyga aylantiradi.'
              : 'Загрузите PDF, ссылку на YouTube/видео, аудиозапись или текст. Gemini 3.8 создаст готовый сценарий хронометражем от 30 секунд до 60 минут.'}
          </p>
        </div>

        {/* Source Tabs */}
        <div className="grid grid-cols-3 gap-2 bg-zinc-950 p-1.5 rounded-2xl border border-zinc-800 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('upload')}
            className={`py-2 px-3 rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'upload'
                ? 'bg-cyan-500 text-zinc-950 font-bold shadow-md shadow-cyan-500/20'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>{lang === 'uz' ? 'PDF / Audio / Hujjat' : 'PDF / Аудио / Файл'}</span>
          </button>
          <button
            onClick={() => setActiveTab('text')}
            className={`py-2 px-3 rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
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
            className={`py-2 px-3 rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'link'
                ? 'bg-cyan-500 text-zinc-950 font-bold shadow-md shadow-cyan-500/20'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Link className="w-3.5 h-3.5" />
            <span>{lang === 'uz' ? 'YouTube / Video Havola' : 'Ссылка YouTube/Видео'}</span>
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
              className="p-7 border-2 border-dashed border-zinc-800 hover:border-cyan-500/50 rounded-2xl bg-zinc-950/60 flex flex-col items-center justify-center text-center cursor-pointer transition-all hover:bg-zinc-950"
            >
              {uploadedFile?.category === 'audio' ? (
                <Music className="w-10 h-10 text-emerald-400 mb-2" />
              ) : uploadedFile?.category === 'video' ? (
                <Video className="w-10 h-10 text-purple-400 mb-2" />
              ) : (
                <FileUp className="w-10 h-10 text-cyan-400 mb-2 animate-bounce" />
              )}
              <p className="text-sm font-bold text-white">
                {uploadedFile
                  ? uploadedFile.name
                  : lang === 'uz'
                  ? 'Fayl tanlash uchun bosing (PDF, Word, TXT, MP3, WAV, MP4)'
                  : 'Нажмите для выбора файла (PDF, DOCX, TXT, MP3, WAV, MP4)'}
              </p>
              <p className="text-xs text-zinc-500 mt-1">
                {uploadedFile
                  ? `${uploadedFile.size} • ${uploadedFile.category.toUpperCase()} • Tayyor`
                  : 'PDF hujjatlar, diktofon yozuvlari (MP3/WAV), video yoki maqolalar (Maksimal 35MB)'}
              </p>
            </div>
          </div>
        )}

        {/* Tab 2: Text / Article */}
        {activeTab === 'text' && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-400">
              {lang === 'uz'
                ? 'Maqola, qoralama yoki ma\'ruza matnini shu yerga qo\'ying:'
                : 'Вставьте текст статьи, лекции или черновик на любом языке:'}
            </label>
            <textarea
              rows={6}
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              placeholder={
                lang === 'uz'
                  ? 'Masalan: Rus yoki ingliz tilidagi maqola, intervyu tezislari, tahliliy yangiliklar...'
                  : 'Например: текст статьи на русском/английском, заметки, тезисы...'
              }
              className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl p-4 text-xs sm:text-sm text-zinc-200 focus:outline-none focus:border-cyan-500 resize-none font-sans leading-relaxed"
            />
          </div>
        )}

        {/* Tab 3: Link / Video */}
        {activeTab === 'link' && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-400">
              {lang === 'uz' ? 'YouTube video, TikTok, Reels yoki Veb-maqola havolasi:' : 'Ссылка на YouTube, TikTok, Reels или статью:'}
            </label>
            <input
              type="text"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=... yoki https://vt.tiktok.com/..."
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-xs sm:text-sm text-white focus:outline-none focus:border-cyan-500"
            />
            <div className="p-3 bg-zinc-950/80 rounded-xl border border-zinc-800/80 space-y-1.5 text-[11px] text-zinc-400">
              <div className="flex items-center gap-2 text-cyan-300 font-semibold">
                <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                <span>{lang === 'uz' ? 'Aqlli Media Integratsiya:' : 'Как это работает по ссылке:'}</span>
              </div>
              <ul className="space-y-1 list-disc list-inside text-zinc-400 text-[10.5px]">
                <li><strong className="text-zinc-200">YouTube:</strong> {lang === 'uz' ? "Videoning haqiqiy asl nutqi (stenogramma/subtitrlar) avtomatik olinadi va o'zbekchaga o'giriladi." : 'Извлекается реальная стенограмма речи спикера и точно переводится.'}</li>
                <li><strong className="text-zinc-200">TikTok:</strong> {lang === 'uz' ? "Video audio oqimi to'g'ridan-to'g'ri olinadi va Gemini nutqni tinglaydi." : 'Аудиодорожка извлекается напрямую через поток и передается в ИИ.'}</li>
                <li><strong className="text-zinc-200">Instagram Reels:</strong> {lang === 'uz' ? "Tavsifi tahlil qilinadi; 100% video-sinxron dublyaj uchun MP4 faylini yuklash tavsiya etiladi." : 'Считывается описание Reels; для идеального дубляжа можно также загрузить MP4 файл.'}</li>
              </ul>
            </div>
          </div>
        )}

        {/* Format Selector: Solo vs Interview vs Voiceover */}
        <div className="space-y-1.5 pt-1">
          <label className="text-xs font-semibold text-zinc-300 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              <span>{lang === 'uz' ? 'Qanday formatda ssenariy yaratilsin?' : 'В каком формате создать сценарий?'}</span>
            </span>
          </label>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setTargetFormat('podcast')}
              className={`py-2 px-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                targetFormat === 'podcast'
                  ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 shadow-sm'
                  : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Mic2 className="w-3.5 h-3.5 text-cyan-400" />
              <span>{lang === 'uz' ? 'Yakka Podkast' : 'Одиночный'}</span>
            </button>

            <button
              type="button"
              onClick={() => setTargetFormat('interview')}
              className={`py-2 px-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                targetFormat === 'interview'
                  ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300 shadow-sm'
                  : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Users2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>{lang === 'uz' ? '2 Kishi Intervyu' : 'Интервью (2 голоса)'}</span>
            </button>

            <button
              type="button"
              onClick={() => setTargetFormat('voiceover')}
              className={`py-2 px-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                targetFormat === 'voiceover'
                  ? 'bg-purple-500/20 border-purple-400 text-purple-300 shadow-sm'
                  : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Film className="w-3.5 h-3.5 text-purple-400" />
              <span>{lang === 'uz' ? 'Reels Dublyaj' : 'Reels / Озвучка'}</span>
            </button>
          </div>
        </div>

        {/* Configuration: Duration and Topic focus */}
        <div className="pt-1">
          {/* Target Duration */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-zinc-300 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-cyan-400" />
                {lang === 'uz' ? 'Podkast davomiyligi (Xronometraj):' : 'Длительность подкаста:'}
              </span>
              <span className="text-[10px] text-cyan-400 font-mono font-bold">
                {finalTargetDuration}
              </span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <select
                value={targetDurationPreset}
                onChange={(e) => setTargetDurationPreset(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-cyan-500"
              >
                <option value="30 soniya">30 soniya (Reels / Shorts xuk)</option>
                <option value="1 daqiqa">1 daqiqa (Tezkor yangiliklar / Reklama)</option>
                <option value="3 daqiqa">3 daqiqa (Qisqa podkast / Mini-intervyu)</option>
                <option value="5 daqiqa">5 daqiqa (Mavzu sharhi)</option>
                <option value="10 daqiqa">10 daqiqa (Standart podkast soni)</option>
                <option value="15 daqiqa">15 daqiqa (Katta tahliliy podkast)</option>
                <option value="25 daqiqa">25 daqiqa (Chuqur ekspert suhbati)</option>
                <option value="45 daqiqa">45 daqiqa (Katta eksklyuziv son)</option>
                <option value="60 daqiqa">60 daqiqa (To'liq soatlik podkast efiri)</option>
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
                    className="w-24 bg-zinc-950 border border-cyan-500/50 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none"
                  />
                  <span className="text-xs text-zinc-400">
                    {lang === 'uz' ? 'daqiqa (1 dan 120 gacha)' : 'минут (от 1 до 120)'}
                  </span>
                </div>
              ) : (
                <div className="text-[11px] text-zinc-400 flex items-center bg-zinc-950/60 px-3 rounded-xl border border-zinc-800">
                  {lang === 'uz'
                    ? 'Gemini ushbu xronometrajga mos so\'zlar soni va boblar tuzilishini tanlaydi.'
                    : 'Gemini подберет точное число слов и структуру глав под этот хронометраж.'}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Tone and Language Adaptation */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-purple-400" />
              {lang === 'uz' ? 'Ijro ohangi va uslubi:' : 'Тон и стиль подачи:'}
            </label>
            <select
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-purple-500"
            >
              <option value="engaging">Jonli, samimiy va jalb qiluvchi (Engaging)</option>
              <option value="analytical">Chuqur ilmiy, tahliliy ekspert (Analytical)</option>
              <option value="commercial">Dinamik va yuqori energiya (Sales/Promo)</option>
              <option value="storytelling">Badiiy, ta'sirchan hikoyanavislik (Storytelling)</option>
              <option value="humorous">Yengil, quvnoq va hazilomuz (Humorous)</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-emerald-400" />
              {lang === 'uz' ? 'Til moslashuvi:' : 'Языковая адаптация:'}
            </label>
            <select
              value={languageMode}
              onChange={(e) => setLanguageMode(e.target.value as any)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500"
            >
              <option value="uzbek">O'zbek tiliga mukammal lokalizatsiya (Tabiiy jonli nutq)</option>
              <option value="original">Asl tilda saqlash (Ruscha / Inglizcha)</option>
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
                ? 'Masalan: 3-bo\'limga urg\'u bering, hayotiy misollar va savol-javob qo\'shing...'
                : 'Например: сделать упор на факты, добавить юмор, диалог между экспертом и новичком...'
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
              ? (lang === 'uz' ? 'Gemini 3.8 Multimodal Tahlil Qilmoqda...' : 'Gemini 3.8 Анализирует...')
              : (lang === 'uz' ? `${finalTargetDuration}lik Mukammal Ssenariy Yaratish` : `Сгенерировать Сценарий (${finalTargetDuration})`)}
          </span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

