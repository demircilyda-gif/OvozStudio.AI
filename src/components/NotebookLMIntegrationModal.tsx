import React, { useState } from 'react';
import {
  X,
  Sparkles,
  BookOpen,
  ArrowRight,
  Copy,
  Check,
  Code2,
  FileText,
  Headphones,
  Zap,
  ExternalLink,
  Layers,
  Users2,
  Film,
  Download,
  Terminal,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react';

interface NotebookLMIntegrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang: 'uz' | 'ru';
  onApplySnippet?: (text: string) => void;
}

export const NotebookLMIntegrationModal: React.FC<NotebookLMIntegrationModalProps> = ({
  isOpen,
  onClose,
  lang,
  onApplySnippet,
}) => {
  const [activeTab, setActiveTab] = useState<'guide' | 'api' | 'quick_import'>('guide');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [pastedNote, setPastedNote] = useState<string>('');

  if (!isOpen) return null;

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(id);
    setTimeout(() => setCopiedCode(null), 2500);
  };

  const pythonIntegrationCode = `# OvozStudio AI ↔ NotebookLM Automation Script (Python)
# Exports notes or audio from Google Workspace / Gemini and sends to OvozStudio API

import requests
import json

OVOZSTUDIO_API_URL = "https://your-ovozstudio-instance.run.app/api/podcast/analyze-document"

def send_notebook_material_to_ovozstudio(content_text, target_format="podcast", duration="2 daqiqa"):
    """
    Sends extracted NotebookLM notes / study guide to OvozStudio
    Formats: 'podcast' (solo), 'interview' (2-host dialogue), 'voiceover' (Reels)
    """
    payload = {
        "sourceText": content_text,
        "targetFormat": target_format,
        "targetDuration": duration,
        "userInstructions": "2 soatlik materialdan eng asosiy 100% mohiyatni ajratib, o'zbek tilida tayyorla",
        "tone": "engaging",
        "languageMode": "uzbek"
    }
    
    headers = {"Content-Type": "application/json"}
    response = requests.post(OVOZSTUDIO_API_URL, json=payload, headers=headers)
    
    if response.status_code == 200:
        result = response.json()
        print("✅ Ssenariy muvaffaqiyatli yaratildi:")
        print(f"Mavzu: {result.get('title')}")
        print(f"Replikalar soni: {len(result.get('turns', []))}")
        return result
    else:
        print(f"❌ Xatolik: {response.status_code}, {response.text}")
        return None

# Misol uchun NotebookLM'dan olingan matn
sample_notes = """
AI in Healthcare 2026:
- Autonomous diagnostics now match top specialist accuracy.
- Multimodal foundation models analyze radiology and genomics concurrently.
- Localized language models empower regional clinical systems.
"""

# 2 daqiqalik o'zbekcha Reels / Podkast ssenariysiga aylantirish
send_notebook_material_to_ovozstudio(sample_notes, target_format="voiceover", duration="2 daqiqa")
`;

  const nodejsIntegrationCode = `// OvozStudio AI ↔ NotebookLM Webhook / REST Bridge (Node.js)
import fetch from "node-fetch";

const OVOZSTUDIO_URL = "https://your-ovozstudio-instance.run.app/api/podcast/analyze-document";

async function convertNotebookLMToUzbekPodcast(notesText, format = "interview") {
  const response = await fetch(OVOZSTUDIO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sourceText: notesText,
      targetFormat: format, // 'podcast' | 'interview' | 'voiceover'
      targetDuration: "2 daqiqa", // Reels yoki tezkor konspekt
      tone: "engaging",
      languageMode: "uzbek"
    })
  });

  const data = await response.json();
  console.log("OvozStudio Natijasi:", data.title);
  return data;
}
`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-[#161511]/60 backdrop-blur-sm">
      <div className="relative w-full max-w-3xl bg-[#F4F1EA] text-[#161511] border border-[rgba(22,21,17,0.14)] rounded-[26px] p-5 sm:p-8 shadow-[0_30px_50px_-30px_rgba(22,21,17,0.35)] space-y-6 max-h-[92vh] overflow-y-auto">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-5 right-5 p-2 text-[#5D594E] hover:text-[#161511] rounded-full bg-white/70 hover:bg-white border border-[rgba(22,21,17,0.1)] transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono font-semibold bg-[#0E7C86]/10 text-[#0A5A62] border border-[#0E7C86]/30 mb-2.5">
            <Sparkles className="w-3.5 h-3.5 text-[#0E7C86]" />
            <span>Google NotebookLM ↔ OvozStudio AI API Hub</span>
          </div>
          <h2 className="font-serif text-2xl sm:text-3xl text-[#161511] font-normal tracking-tight flex items-center gap-2.5">
            <BookOpen className="w-6 h-6 text-[#0E7C86]" />
            <span>
              {lang === 'uz'
                ? 'NotebookLM loyihalarini OvozStudio AI bilan integratsiya qilish'
                : 'Интеграция проектов Google NotebookLM с OvozStudio AI'}
            </span>
          </h2>
          <p className="text-xs sm:text-sm text-[#5D594E] mt-1.5 leading-relaxed">
            {lang === 'uz'
              ? 'NotebookLM’dagi 2 soatlik manbalar, PDF, YouTube yoki konspektlarni OvozStudio orqali 2 daqiqalik o\'zbekcha Reels, intervyu va professional podkastlarga aylantirish bo\'yicha to\'liq texnik yo\'riqnoma.'
              : 'Пошаговое руководство по экспорту заметок, 2-часовых видео и аудио из NotebookLM в OvozStudio для создания 2-минутных Reels и узбекских студийных подкастов.'}
          </p>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border border-[rgba(22,21,17,0.14)] p-1 rounded-full bg-white text-xs font-semibold">
          <button
            type="button"
            onClick={() => setActiveTab('guide')}
            className={`flex-1 py-2 px-3 rounded-full transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'guide'
                ? 'bg-[#161511] text-[#F4F1EA] shadow-xs'
                : 'text-[#5D594E] hover:text-[#161511]'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>{lang === 'uz' ? 'Qadamma-qadam Yo\'riqnoma' : 'Пошаговое руководство'}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('api')}
            className={`flex-1 py-2 px-3 rounded-full transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'api'
                ? 'bg-[#161511] text-[#F4F1EA] shadow-xs'
                : 'text-[#5D594E] hover:text-[#161511]'
            }`}
          >
            <Code2 className="w-4 h-4" />
            <span>{lang === 'uz' ? 'API & Avtomatlashtirish' : 'API и Скрипты'}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('quick_import')}
            className={`flex-1 py-2 px-3 rounded-full transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'quick_import'
                ? 'bg-[#161511] text-[#F4F1EA] shadow-xs'
                : 'text-[#5D594E] hover:text-[#161511]'
            }`}
          >
            <Zap className="w-4 h-4" />
            <span>{lang === 'uz' ? 'Tezkor Import' : 'Быстрый импорт'}</span>
          </button>
        </div>

        {/* TAB 1: Step-by-Step Guide */}
        {activeTab === 'guide' && (
          <div className="space-y-4">
            {/* API Architecture Reality Banner */}
            <div className="p-4 rounded-2xl bg-white border border-[rgba(22,21,17,0.14)] text-xs space-y-1.5 text-[#5D594E] shadow-2xs">
              <div className="flex items-center gap-2 text-[#0A5A62] font-mono uppercase tracking-wider font-bold">
                <ShieldCheck className="w-4 h-4 text-[#0E7C86]" />
                <span>{lang === 'uz' ? 'API haqida muhim texnik ma\'lumot:' : 'Важная информация об API:'}</span>
              </div>
              <p className="leading-relaxed text-[12px]">
                {lang === 'uz'
                  ? 'Iste\'molchilar uchun Google NotebookLM (notebooklm.google.com) ommaviy ochiq REST API kalitlariga ega emas (faqat Enterprise versiyada Gemini Notebook API mavjud). Biroq NotebookLM negizida aynan Google Gemini AI modeli ishlaydi. OvozStudio esa ushbu Gemini 3.8 motoriga to\'g\'ridan-to\'g\'ri ulangan bo\'lib, 1 000 000+ tokenlik kontekst bilan xuddi shunday va undan ham chuqurroq o\'zbekcha qayta ishlash imkonini beradi.'
                  : 'Потребительская версия Google NotebookLM не имеет публичных API-ключей. Однако в основе NotebookLM лежит модель Google Gemini, которая напрямую встроена в OvozStudio. Поэтому связка настраивается через прямой перенос конспектов, экспорт аудио или внутренний документ-хаб OvozStudio.'}
              </p>
            </div>

            {/* 3 Concrete Steps */}
            <div className="space-y-3">
              {/* Step 1 */}
              <div className="p-5 rounded-2xl bg-white border border-[rgba(22,21,17,0.14)] space-y-3 shadow-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="w-6 h-6 rounded-full bg-[#161511] text-[#F4F1EA] font-mono font-bold text-xs flex items-center justify-center">
                      1
                    </span>
                    <h3 className="text-sm font-semibold text-[#161511]">
                      {lang === 'uz'
                        ? 'NotebookLM’dan ma\'lumotlarni eksport qilish'
                        : 'Экспорт материалов из NotebookLM'}
                    </h3>
                  </div>
                  <span className="text-[10px] font-mono text-[#5D594E]">NotebookLM UI</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs text-[#5D594E] pt-1">
                  <div className="p-3.5 rounded-xl bg-[#F4F1EA] border border-[rgba(22,21,17,0.14)] space-y-1">
                    <p className="font-semibold text-[#0A5A62] flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide">
                      <FileText className="w-3.5 h-3.5 text-[#0E7C86]" />
                      <span>{lang === 'uz' ? 'A) Matn & Konspektlar:' : 'А) Заметки и саммари:'}</span>
                    </p>
                    <p className="text-[11.5px] leading-relaxed">
                      {lang === 'uz'
                        ? 'NotebookLM bloknotida yaratilgan Study Guide, Briefing Doc yoki chat javobini bitta tugma bilan nusxalab oling (Copy).'
                        : 'В блокноте NotebookLM нажмите "Копировать" на готовом Study Guide, Briefing Doc или ответе на вопрос.'}
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-[#F4F1EA] border border-[rgba(22,21,17,0.14)] space-y-1">
                    <p className="font-semibold text-[#0A5A62] flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide">
                      <Headphones className="w-3.5 h-3.5 text-[#0E7C86]" />
                      <span>{lang === 'uz' ? 'B) Audio Overview (Podkast):' : 'Б) Audio Overview:'}</span>
                    </p>
                    <p className="text-[11.5px] leading-relaxed">
                      {lang === 'uz'
                        ? 'NotebookLM 2-kishilik suhbat generatsiya qilgach, audio pleerdagi 3 nuqtani bosib, ".wav" yoki ".mp3" faylni yuklab oling.'
                        : 'После генерации диалога нажмите на 3 точки в плеере NotebookLM и скачайте MP3/WAV файл.'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Step 2 */}
              <div className="p-5 rounded-2xl bg-white border border-[rgba(22,21,17,0.14)] space-y-3 shadow-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="w-6 h-6 rounded-full bg-[#161511] text-[#F4F1EA] font-mono font-bold text-xs flex items-center justify-center">
                      2
                    </span>
                    <h3 className="text-sm font-semibold text-[#161511]">
                      {lang === 'uz'
                        ? 'OvozStudio’ga kiritish va formatni tanlash'
                        : 'Перенос в OvozStudio и выбор формата'}
                    </h3>
                  </div>
                  <span className="text-[10px] font-mono text-[#5D594E]">OvozStudio Hub</span>
                </div>
                <p className="text-xs text-[#5D594E]">
                  {lang === 'uz'
                    ? 'OvozStudio’da "PDF, NotebookLM va Matn Hub" bo\'limini oching:'
                    : 'В OvozStudio откройте окно "PDF, NotebookLM и Текст":'}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                  <div className="p-3 rounded-xl bg-[#F4F1EA] border border-[rgba(22,21,17,0.14)] text-center space-y-1">
                    <Film className="w-4 h-4 text-[#C4552D] mx-auto" />
                    <p className="font-semibold text-[#161511] text-[11px]">Reels / Shorts (30–60s)</p>
                    <p className="text-[10.5px] text-[#5D594E]">
                      {lang === 'uz' ? 'Ijtimoiy tarmoqlar uchun dinamik video' : 'Для динамичных коротких видео'}
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-[#F4F1EA] border border-[rgba(22,21,17,0.14)] text-center space-y-1">
                    <Zap className="w-4 h-4 text-[#C98A12] mx-auto" />
                    <p className="font-semibold text-[#161511] text-[11px]">2 Daqiqa Xulosa</p>
                    <p className="text-[10.5px] text-[#5D594E]">
                      {lang === 'uz' ? '2 soatlik mavzuning 100% qaymog\'i' : 'Сжатие 2 часов в 2 минуты сути'}
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-[#F4F1EA] border border-[rgba(22,21,17,0.14)] text-center space-y-1">
                    <Users2 className="w-4 h-4 text-[#0E7C86] mx-auto" />
                    <p className="font-semibold text-[#161511] text-[11px]">2 Kishi Intervyu</p>
                    <p className="text-[10.5px] text-[#5D594E]">
                      {lang === 'uz' ? 'NotebookLM uslubidagi jonli dialog' : 'Живой диалог 2 ведущих'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Step 3 */}
              <div className="p-5 rounded-2xl bg-white border border-[rgba(22,21,17,0.14)] space-y-2 shadow-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="w-6 h-6 rounded-full bg-[#161511] text-[#F4F1EA] font-mono font-bold text-xs flex items-center justify-center">
                      3
                    </span>
                    <h3 className="text-sm font-semibold text-[#161511]">
                      {lang === 'uz'
                        ? 'O\'zbekcha professional ovozda sintez qilish va eksport'
                        : 'Генерация узбекской озвучки и экспорт'}
                    </h3>
                  </div>
                  <span className="text-[10px] font-mono text-[#5D594E]">Audio Engine</span>
                </div>
                <p className="text-xs text-[#5D594E] leading-relaxed">
                  {lang === 'uz'
                    ? 'Gemini 3.8 ssenariyni yaratib beradi. OvozStudio unga Aoede, Puck, Kore ovozlarini beradi, Ambient musiqa qo\'shadi va tayyor MP3 qilib beradi.'
                    : 'Gemini 3.8 формирует сценарий, OvozStudio озвучивает его студийными голосами с фоновой музыкой и отдаёт готовый MP3.'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: API & Automation Scripts */}
        {activeTab === 'api' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#161511]">
                <Terminal className="w-4 h-4 text-[#0E7C86]" />
                <span>{lang === 'uz' ? 'Python / Node.js integratsiya skriptlari:' : 'Скрипты автоматической интеграции:'}</span>
              </div>
              <span className="text-[10.5px] font-mono text-[#0A5A62] bg-white px-2.5 py-1 rounded-full border border-[rgba(22,21,17,0.1)]">POST /api/podcast/analyze-document</span>
            </div>

            {/* Python Code Block (dark #141414 studio code block) */}
            <div className="relative rounded-2xl bg-[#141414] border border-[#2B2B27] p-4 font-mono text-[11px] text-[#EDEAE2] overflow-x-auto shadow-md">
              <div className="flex items-center justify-between pb-2 border-b border-[#2B2B27] mb-3 text-[#7D7A70] text-[10px]">
                <span className="text-[#5CC8CF]">python_integration.py</span>
                <button
                  type="button"
                  onClick={() => handleCopy(pythonIntegrationCode, 'py')}
                  className="px-2.5 py-1 rounded-full bg-[#1D1D1B] hover:bg-[#2B2B27] text-[#EDEAE2] flex items-center gap-1 text-[10px] transition-colors cursor-pointer"
                >
                  {copiedCode === 'py' ? <Check className="w-3 h-3 text-[#5CC8CF]" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedCode === 'py' ? 'Nusxalandi' : 'Nusxalash'}</span>
                </button>
              </div>
              <pre>{pythonIntegrationCode}</pre>
            </div>

            {/* Node.js Code Block */}
            <div className="relative rounded-2xl bg-[#141414] border border-[#2B2B27] p-4 font-mono text-[11px] text-[#EDEAE2] overflow-x-auto shadow-md">
              <div className="flex items-center justify-between pb-2 border-b border-[#2B2B27] mb-3 text-[#7D7A70] text-[10px]">
                <span className="text-[#5CC8CF]">nodejs_bridge.js</span>
                <button
                  type="button"
                  onClick={() => handleCopy(nodejsIntegrationCode, 'js')}
                  className="px-2.5 py-1 rounded-full bg-[#1D1D1B] hover:bg-[#2B2B27] text-[#EDEAE2] flex items-center gap-1 text-[10px] transition-colors cursor-pointer"
                >
                  {copiedCode === 'js' ? <Check className="w-3 h-3 text-[#5CC8CF]" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedCode === 'js' ? 'Nusxalandi' : 'Nusxalash'}</span>
                </button>
              </div>
              <pre>{nodejsIntegrationCode}</pre>
            </div>
          </div>
        )}

        {/* TAB 3: Quick Import Tester */}
        {activeTab === 'quick_import' && (
          <div className="space-y-4">
            <div className="p-5 rounded-2xl bg-white border border-[rgba(22,21,17,0.14)] space-y-3 shadow-xs">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-[#161511] flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-[#0E7C86]" />
                  <span>
                    {lang === 'uz'
                      ? 'NotebookLM’dan nusxalangan xulosani bu yerga qo\'ying:'
                      : 'Вставьте скопированный текст из NotebookLM:'}
                  </span>
                </label>
                <span className="text-[10px] font-mono text-[#5D594E]">
                  {pastedNote.length > 0 ? `${pastedNote.length} ta belgi` : 'Matn bo\'sh'}
                </span>
              </div>

              <textarea
                rows={6}
                value={pastedNote}
                onChange={(e) => setPastedNote(e.target.value)}
                placeholder={
                  lang === 'uz'
                    ? "Masalan: NotebookLM'dagi Briefing Doc, Study Guide yoki 2 soatlik video bo'yicha tuzilgan konspekt matni..."
                    : "Например: Briefing Doc, тезисы или конспект из блокнота NotebookLM..."
                }
                className="w-full bg-[#F4F1EA] border border-[rgba(22,21,17,0.14)] rounded-xl p-3.5 text-xs text-[#161511] focus:outline-none focus:border-[#0E7C86] focus:bg-white resize-none font-sans leading-relaxed transition-colors"
              />

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    const sample = `AI and Space Tech 2026:
1. Starship Flight 6 demonstrated full reusable orbital maneuvers.
2. Next-gen satellite constellations now integrate onboard neural networks for real-time terrain telemetry.
3. Rapid global broadband connectivity is bridging rural education gaps across Central Asia.`;
                    setPastedNote(sample);
                  }}
                  className="text-[11px] text-[#0A5A62] hover:text-[#0E7C86] underline underline-offset-2 cursor-pointer font-mono"
                >
                  {lang === 'uz' ? 'Namuna matnni yuklash' : 'Загрузить тестовый пример'}
                </button>

                <button
                  type="button"
                  disabled={!pastedNote.trim()}
                  onClick={() => {
                    if (onApplySnippet && pastedNote.trim()) {
                      onApplySnippet(pastedNote.trim());
                      onClose();
                    }
                  }}
                  className="btn-pill btn-solid text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
                >
                  <Sparkles className="w-3.5 h-3.5 text-[#5CC8CF]" />
                  <span>
                    {lang === 'uz'
                      ? 'Podkast Hubga o\'tkazish va O\'zbekcha 2 daqiqalik audio yaratish'
                      : 'Передать в Студию и озвучить на узбекском (2 мин)'}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Direct Workflow Advice */}
            <div className="p-3.5 rounded-2xl bg-white border border-[rgba(22,21,17,0.14)] flex items-start gap-3 text-xs text-[#5D594E] shadow-2xs">
              <CheckCircle2 className="w-4 h-4 text-[#0E7C86] shrink-0 mt-0.5" />
              <p className="leading-relaxed">
                {lang === 'uz'
                  ? 'Ushbu tugmani bosganingizda, matn avtomatik ravishda OvozStudio Ssenariy Hubiga yuboriladi va u yerda siz "2 daqiqa xulosa" yoki "2 kishilik intervyu" formatini tanlab, to\'liq o\'zbekcha podkast hosil qilasiz.'
                  : 'При нажатии текст передаётся в Студию, где одним кликом генерируется готовый 2-минутный концентрат или двухголосый диалог на узбекском языке.'}
              </p>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[rgba(22,21,17,0.14)] text-xs">
          <div className="flex items-center gap-2 text-[#5D594E] font-mono text-[11px]">
            <span className="w-2 h-2 rounded-full bg-[#0E7C86] pulse-teal-dot"></span>
            <span>{lang === 'uz' ? 'Gemini 3.8 Multimodal dvigateli faol' : 'Движок Gemini 3.8 Multimodal активен'}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-pill btn-ghost text-xs"
            >
              {lang === 'uz' ? 'Yopish' : 'Закрыть'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
