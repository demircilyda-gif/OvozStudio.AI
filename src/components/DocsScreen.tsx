import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface DocsScreenProps {
  lang: 'uz' | 'ru';
  onOpenPricingModal: () => void;
}

export const DocsScreen: React.FC<DocsScreenProps> = ({ lang, onOpenPricingModal }) => {
  const [activeSection, setActiveSection] = useState('quickstart');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://ovozstudio.uz';
  const wsOrigin = origin.replace(/^http/, 'ws');

  const copyToClipboard = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const curlCode = `# Yakkaxon podkast yoki TTS sintezi (24kHz WAV):
curl ${origin}/api/podcast/synthesize \\
  -H "Authorization: Bearer <FIREBASE_ID_TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "text": "Assalomu alaykum! <breath> Bugun sizga ajoyib yangilik aytaman.",
    "voiceProfile": {
      "voiceId": "sardor",
      "voiceName": "Sardor",
      "baseVoice": "Charon",
      "timbre": "Iliq va salobatli bariton"
    },
    "speechStyle": "Samimiy & Jonli"
  }'`;

  const agentWsCode = `// Real-time WebSocket ulanish (Gemini 3.8 Live):
const idToken = await auth.currentUser.getIdToken();
const ws = new WebSocket(\`${wsOrigin}/api/live-call?token=\${encodeURIComponent(idToken)}\`);

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: "start",
    persona: "tashkent_real_estate", // yoki "supertaxi_ivr"
    voiceName: "Puck",
    language: "uz"
  }));
};`;

  const callCode = `curl ${origin}/api/agent/start-call \\
  -H "Authorization: Bearer <FIREBASE_ID_TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "persona": "tashkent_real_estate",
    "topic": "Toshkentda 2 xonali kvartira xaridi",
    "agentVoiceId": "Puck",
    "language": "uz"
  }'`;

  const coverCode = `curl ${origin}/api/podcast/generate-cover \\
  -H "Authorization: Bearer <FIREBASE_ID_TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "Oʻzbekiston 2030: AI Inqilobi",
    "category": "EKSKLYUZIV",
    "tags": ["AI", "Biznes", "Toshkent"]
  }'`;

  return (
    <div className="max-w-6xl mx-auto py-4 px-2 sm:px-6">
      <div className="grid grid-cols-1 md:grid-cols-[230px_1fr] gap-8 items-start">
        {/* Sticky TOC on the left */}
        <nav className="sticky top-20 flex flex-col gap-1 text-[13.5px]">
          <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-[#0A5A62] px-3 pt-3 pb-1.5">
            {lang === 'uz' ? 'Boshlash' : 'Начало'}
          </div>
          <a
            href="#quickstart"
            onClick={() => setActiveSection('quickstart')}
            className={`px-3 py-1.5 rounded-lg transition-colors no-underline ${
              activeSection === 'quickstart' ? 'bg-[#ECE7DB] font-semibold text-[#161511]' : 'text-[#5D594E] hover:text-[#161511]'
            }`}
          >
            {lang === 'uz' ? 'Tezkor start' : 'Быстрый старт'}
          </a>
          <a
            href="#auth"
            onClick={() => setActiveSection('auth')}
            className={`px-3 py-1.5 rounded-lg transition-colors no-underline ${
              activeSection === 'auth' ? 'bg-[#ECE7DB] font-semibold text-[#161511]' : 'text-[#5D594E] hover:text-[#161511]'
            }`}
          >
            {lang === 'uz' ? 'Autentifikatsiya' : 'Аутентификация'}
          </a>

          <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-[#0A5A62] px-3 pt-4 pb-1.5">
            REST / WS Endpointlar
          </div>
          <a
            href="#tts"
            onClick={() => setActiveSection('tts')}
            className={`px-3 py-1.5 rounded-lg transition-colors no-underline font-mono text-xs ${
              activeSection === 'tts' ? 'bg-[#ECE7DB] font-semibold text-[#161511]' : 'text-[#5D594E] hover:text-[#161511]'
            }`}
          >
            POST /api/podcast/synthesize
          </a>
          <a
            href="#dialogue"
            onClick={() => setActiveSection('dialogue')}
            className={`px-3 py-1.5 rounded-lg transition-colors no-underline font-mono text-xs ${
              activeSection === 'dialogue' ? 'bg-[#ECE7DB] font-semibold text-[#161511]' : 'text-[#5D594E] hover:text-[#161511]'
            }`}
          >
            POST /api/podcast/synthesize-dialogue
          </a>
          <a
            href="#live"
            onClick={() => setActiveSection('live')}
            className={`px-3 py-1.5 rounded-lg transition-colors no-underline font-mono text-xs ${
              activeSection === 'live' ? 'bg-[#ECE7DB] font-semibold text-[#161511]' : 'text-[#5D594E] hover:text-[#161511]'
            }`}
          >
            WS /api/live-call
          </a>
          <a
            href="#call"
            onClick={() => setActiveSection('call')}
            className={`px-3 py-1.5 rounded-lg transition-colors no-underline font-mono text-xs ${
              activeSection === 'call' ? 'bg-[#ECE7DB] font-semibold text-[#161511]' : 'text-[#5D594E] hover:text-[#161511]'
            }`}
          >
            POST /api/agent/start-call
          </a>
          <a
            href="#voices"
            onClick={() => setActiveSection('voices')}
            className={`px-3 py-1.5 rounded-lg transition-colors no-underline font-mono text-xs ${
              activeSection === 'voices' ? 'bg-[#ECE7DB] font-semibold text-[#161511]' : 'text-[#5D594E] hover:text-[#161511]'
            }`}
          >
            GET /api/voices
          </a>
          <a
            href="#covers"
            onClick={() => setActiveSection('covers')}
            className={`px-3 py-1.5 rounded-lg transition-colors no-underline font-mono text-xs ${
              activeSection === 'covers' ? 'bg-[#ECE7DB] font-semibold text-[#161511]' : 'text-[#5D594E] hover:text-[#161511]'
            }`}
          >
            POST /api/podcast/generate-cover
          </a>

          <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-[#0A5A62] px-3 pt-4 pb-1.5">
            {lang === 'uz' ? 'Qoʻshimcha' : 'Справочник'}
          </div>
          <a
            href="#tags"
            onClick={() => setActiveSection('tags')}
            className={`px-3 py-1.5 rounded-lg transition-colors no-underline ${
              activeSection === 'tags' ? 'bg-[#ECE7DB] font-semibold text-[#161511]' : 'text-[#5D594E] hover:text-[#161511]'
            }`}
          >
            {lang === 'uz' ? 'Emotsiya teglari' : 'Теги эмоций'}
          </a>
          <a
            href="#limits"
            onClick={() => setActiveSection('limits')}
            className={`px-3 py-1.5 rounded-lg transition-colors no-underline ${
              activeSection === 'limits' ? 'bg-[#ECE7DB] font-semibold text-[#161511]' : 'text-[#5D594E] hover:text-[#161511]'
            }`}
          >
            {lang === 'uz' ? 'Limitlar va tariflar' : 'Лимиты и тарифы'}
          </a>
        </nav>

        {/* Documentation Content */}
        <article className="space-y-10 min-w-0">
          <div>
            <h1 className="font-serif font-normal text-[clamp(2.3rem,4vw,3.3rem)] tracking-[-0.015em] text-[#161511]">
              OvozStudio <em>API</em>.
            </h1>
            <p className="text-[#5D594E] text-base sm:text-[16.5px] leading-relaxed max-w-[62ch] mt-3">
              {lang === 'uz'
                ? 'Oʻzbek tilidagi tabiiy studiya ovozi, 2 spikerli intervyular, jonli AI telefon agentlari (Rieltor / SuperTaksi IVR), video dublyaj va SVG muqova generatori — bagona himoyalangan REST va WebSocket API orqali.'
                : 'Естественный узбекский синтез речи, 2-голосые интервью, живые телефонные AI-агенты (Риелтор / SuperTaksi IVR), видео-дубляж и генератор обложек через единый защищенный REST и WebSocket API.'}
            </p>
          </div>

          {/* Quickstart */}
          <div id="quickstart" className="pt-6 border-t border-[rgba(22,21,17,0.14)]">
            <h2 className="font-serif font-normal text-2xl text-[#161511]">
              {lang === 'uz' ? 'Tezkor start' : 'Быстрый старт'}
            </h2>
            <p className="text-[#3A382F] text-[14.5px] mt-2">
              {lang === 'uz'
                ? 'Matnni 24kHz HD WAV audioga aylantirish uchun bitta POST soʻrov yuboring. Javobda base64 WAV va yangilangan kredit balansi qaytadi.'
                : 'Для синтеза текста в 24kHz HD WAV достаточно одного POST-запроса. В ответе возвращается base64 WAV и актуальный остаток кредитов.'}
            </p>

            <div className="mt-4">
              <div className="flex justify-between items-center bg-[#0E0E0D] text-[#7D7A70] font-mono text-[10px] uppercase tracking-[0.12em] px-5 py-2.5 rounded-t-2xl">
                <span>POST /api/podcast/synthesize</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(curlCode, 1)}
                  className="flex items-center gap-1 text-[#5CC8CF] hover:text-white cursor-pointer bg-transparent border-0 font-mono text-[10px]"
                >
                  {copiedIndex === 1 ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedIndex === 1 ? 'Nusxalandi!' : 'KODNI OLISH'}</span>
                </button>
              </div>
              <pre className="bg-[#141414] text-[#EDEAE2] p-5 rounded-b-2xl font-mono text-xs sm:text-[12.5px] leading-relaxed overflow-x-auto whitespace-pre m-0">
                {curlCode}
              </pre>
            </div>
          </div>

          {/* Authentication */}
          <div id="auth" className="pt-6 border-t border-[rgba(22,21,17,0.14)]">
            <h2 className="font-serif font-normal text-2xl text-[#161511]">
              {lang === 'uz' ? 'Autentifikatsiya va Xavfsizlik' : 'Аутентификация и Безопасность'}
            </h2>
            <p className="text-[#3A382F] text-[14.5px] mt-2 leading-relaxed">
              {lang === 'uz' ? (
                <>
                  Barcha generatsiya endpointlari <code className="font-mono text-xs bg-[rgba(14,124,134,0.08)] text-[#0A5A62] px-2 py-0.5 rounded">Authorization: Bearer &lt;FIREBASE_ID_TOKEN&gt;</code> sarlavhasi orqali qatʼiy tekshiriladi.
                  Tokenni mijoz ilovada <code className="font-mono text-xs bg-[rgba(14,124,134,0.08)] text-[#0A5A62] px-2 py-0.5 rounded">await auth.currentUser.getIdToken()</code> orqali oling.
                  Yangi foydalanuvchilarga roʻyxatdan oʻtganda bir martalik <b>5 ta start krediti</b> avtomatik taqdim etiladi; balans tugaganda server <code>402 Payment Required</code> qaytaradi.
                </>
              ) : (
                <>
                  Все генеративные маршруты защищены заголовком <code className="font-mono text-xs bg-[rgba(14,124,134,0.08)] text-[#0A5A62] px-2 py-0.5 rounded">Authorization: Bearer &lt;FIREBASE_ID_TOKEN&gt;</code>.
                  Получите токен через Firebase Auth: <code className="font-mono text-xs bg-[rgba(14,124,134,0.08)] text-[#0A5A62] px-2 py-0.5 rounded">await auth.currentUser.getIdToken()</code>.
                  При первой регистрации начисляется разовый бонус <b>5 стартовых кредитов</b>; при нулевом балансе сервер возвращает <code>402 Payment Required</code>.
                </>
              )}
            </p>
          </div>

          {/* POST /api/podcast/synthesize */}
          <div id="tts" className="pt-6 border-t border-[rgba(22,21,17,0.14)]">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-serif font-normal text-2xl text-[#161511]">Text-to-Speech & Podkast Sintezi</h2>
              <span className="font-mono text-xs tracking-wider bg-[rgba(14,124,134,0.12)] text-[#0A5A62] px-2.5 py-1 rounded-md">
                POST /api/podcast/synthesize
              </span>
            </div>
            <p className="text-[#3A382F] text-[14.5px] mt-2">
              {lang === 'uz'
                ? 'Matnni 24kHz studiya sifatidagi WAV audioga sintez qiladi. Uzun matnlar avtomatik boʻlaklarga ajratilib yagona master faylga ulanadi (narxi: 1 kredit).'
                : 'Синтез текста в студийный WAV 24kHz. Длинные сценарии автоматически разбиваются на части и склеиваются в единый мастер-файл (стоимость: 1 кредит).'}
            </p>

            <div className="mt-4 border border-[rgba(22,21,17,0.14)] rounded-xl overflow-hidden bg-white/70">
              <table className="w-full text-left text-[13.5px]">
                <thead>
                  <tr className="border-b border-[rgba(22,21,17,0.14)] font-mono text-[10px] uppercase tracking-[0.12em] text-[#5D594E]">
                    <th className="p-3">Parametr</th>
                    <th className="p-3">Tur</th>
                    <th className="p-3">Tavsif</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgba(22,21,17,0.08)]">
                  <tr>
                    <td className="p-3 font-mono text-xs text-[#0E7C86]">text</td>
                    <td className="p-3 font-mono text-xs text-[#5D594E]">string</td>
                    <td className="p-3">Sintez qilinadigan matn. Emotsiya va pauza teglari qoʻllab-quvvatlanadi.</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-mono text-xs text-[#0E7C86]">voiceProfile.voiceId</td>
                    <td className="p-3 font-mono text-xs text-[#5D594E]">string</td>
                    <td className="p-3">
                      Kanonik ovoz ID: <code>sardor</code>, <code>aziza</code>, <code>madina</code>, <code>jasur</code>, <code>otabek</code>, <code>nilufar</code>, <code>ulugbek</code> yoki shaxsiy klon ID (<code>voice_17raj9ewke3g</code>)
                    </td>
                  </tr>
                  <tr>
                    <td className="p-3 font-mono text-xs text-[#0E7C86]">voiceProfile.baseVoice</td>
                    <td className="p-3 font-mono text-xs text-[#5D594E]">string</td>
                    <td className="p-3"><code>Charon</code> · <code>Aoede</code> · <code>Kore</code> · <code>Fenrir</code> · <code>Puck</code> · <code>Zephyr</code></td>
                  </tr>
                  <tr>
                    <td className="p-3 font-mono text-xs text-[#0E7C86]">speechStyle</td>
                    <td className="p-3 font-mono text-xs text-[#5D594E]">string</td>
                    <td className="p-3"><code>Jiddiy hikoyanavis</code> · <code>Samimiy &amp; Jonli</code> · <code>Dramatik &amp; Epik</code></td>
                  </tr>
                  <tr>
                    <td className="p-3 font-mono text-xs text-[#0E7C86]">stream</td>
                    <td className="p-3 font-mono text-xs text-[#5D594E]">boolean</td>
                    <td className="p-3">Ixtiyoriy. <code>true</code> boʻlsa NDJSON audio boʻlaklarini real vaqtda qaytaradi.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* POST /api/podcast/synthesize-dialogue */}
          <div id="dialogue" className="pt-6 border-t border-[rgba(22,21,17,0.14)]">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-serif font-normal text-2xl text-[#161511]">2 Ovozli Intervyu Sintezi</h2>
              <span className="font-mono text-xs tracking-wider bg-[rgba(14,124,134,0.12)] text-[#0A5A62] px-2.5 py-1 rounded-md">
                POST /api/podcast/synthesize-dialogue
              </span>
            </div>
            <p className="text-[#3A382F] text-[14.5px] mt-2">
              {lang === 'uz'
                ? 'HOST_1 va HOST_2 replikalaridan iborat dialog massivini (`turns`) tabiiy suhbat ohangida yagona WAV treklarga birlashtiradi. Katta suhbatlar uchun `/api/podcast/stitch-dialogue-turns` bilan SRT/VTT subtitrlar ham yaratiladi.'
                : 'Синтезирует диалог двух спикеров (`HOST_1` и `HOST_2`) из массива `turns` с естественными перебивками и склейкой в мастер-трек WAV + SRT/VTT субтитры.'}
            </p>
          </div>

          {/* WS /api/live-call */}
          <div id="live" className="pt-6 border-t border-[rgba(22,21,17,0.14)]">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-serif font-normal text-2xl text-[#161511]">Jonli Agent — Duplex WebSocket</h2>
              <span className="font-mono text-xs tracking-wider bg-[rgba(196,85,45,0.12)] text-[#C4552D] px-2.5 py-1 rounded-md">
                WS /api/live-call?token=&lt;ID_TOKEN&gt;
              </span>
            </div>
            <p className="text-[#3A382F] text-[14.5px] mt-2">
              {lang === 'uz'
                ? '16kHz PCM kirish va 24kHz PCM chiqish orqali real vaqtda ovozli muloqot (`tashkent_real_estate` rieltor eksperti va `supertaxi_ivr` taksi dispetcheri).'
                : 'Потоковый двусторонний голосовой звонок (вход 16kHz PCM, выход 24kHz PCM) для персон `tashkent_real_estate` и `supertaxi_ivr`.'}
            </p>

            <div className="mt-4">
              <div className="flex justify-between items-center bg-[#0E0E0D] text-[#7D7A70] font-mono text-[10px] uppercase tracking-[0.12em] px-5 py-2.5 rounded-t-2xl">
                <span>WebSocket — /api/live-call</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(agentWsCode, 2)}
                  className="flex items-center gap-1 text-[#5CC8CF] hover:text-white cursor-pointer bg-transparent border-0 font-mono text-[10px]"
                >
                  {copiedIndex === 2 ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedIndex === 2 ? 'Nusxalandi!' : 'KODNI OLISH'}</span>
                </button>
              </div>
              <pre className="bg-[#141414] text-[#EDEAE2] p-5 rounded-b-2xl font-mono text-xs sm:text-[12.5px] leading-relaxed overflow-x-auto whitespace-pre m-0">
                {agentWsCode}
              </pre>
            </div>
          </div>

          {/* POST /api/agent/start-call */}
          <div id="call" className="pt-6 border-t border-[rgba(22,21,17,0.14)]">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-serif font-normal text-2xl text-[#161511]">HTTP Agent Qoʻngʻiroq Sessiyasi</h2>
              <span className="font-mono text-xs tracking-wider bg-[rgba(14,124,134,0.12)] text-[#0A5A62] px-2.5 py-1 rounded-md">
                POST /api/agent/start-call
              </span>
            </div>
            <p className="text-[#3A382F] text-[14.5px] mt-2">
              {lang === 'uz'
                ? 'HTTP rejimida AI agent qoʻngʻirogʻini boshlaydi (`sessionId` va salomlashuv WAV qaytaradi), keyingi replikalar `POST /api/agent/call-turn` va yakuniy CRM tahlil `POST /api/agent/generate-summary` orqali yuboriladi.'
                : 'Запускает сессию голосового агента по HTTP (возвращает `sessionId` и аудио приветствия), последующие реплики обрабатываются через `POST /api/agent/call-turn`, а итоговое CRM-досье — через `POST /api/agent/generate-summary`.'}
            </p>

            <div className="mt-4">
              <div className="flex justify-between items-center bg-[#0E0E0D] text-[#7D7A70] font-mono text-[10px] uppercase tracking-[0.12em] px-5 py-2.5 rounded-t-2xl">
                <span>POST /api/agent/start-call</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(callCode, 3)}
                  className="flex items-center gap-1 text-[#5CC8CF] hover:text-white cursor-pointer bg-transparent border-0 font-mono text-[10px]"
                >
                  {copiedIndex === 3 ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedIndex === 3 ? 'Nusxalandi!' : 'KODNI OLISH'}</span>
                </button>
              </div>
              <pre className="bg-[#141414] text-[#EDEAE2] p-5 rounded-b-2xl font-mono text-xs sm:text-[12.5px] leading-relaxed overflow-x-auto whitespace-pre m-0">
                {callCode}
              </pre>
            </div>
          </div>

          {/* GET /api/voices */}
          <div id="voices" className="pt-6 border-t border-[rgba(22,21,17,0.14)]">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-serif font-normal text-2xl text-[#161511]">Ovozlar Katalogi va Namuna</h2>
              <span className="font-mono text-xs tracking-wider bg-[rgba(201,138,18,0.15)] text-[#8A6410] px-2.5 py-1 rounded-md">
                GET /api/voices
              </span>
            </div>
            <p className="text-[#3A382F] text-[14.5px] mt-2">
              {lang === 'uz' ? (
                <>
                  Tizimdagi barcha faol prebuilt va klonlangan ovozlar roʻyxatini qaytaradi. Ovoz namunasini tinglash: <code>GET /api/voices/preview/:id</code> (masalan: <code>sardor</code>, <code>aziza</code>, <code>madina</code>, <code>jasur</code>, <code>otabek</code>, <code>nilufar</code>, <code>ulugbek</code>). Yangi tizimli ovoz klonlash (<code>POST /api/voices/replicate</code>) xavfsizlik maqsadida faqat administrator uchun ruxsat etilgan.
                </>
              ) : (
                <>
                  Возвращает единый каталог студийных и клонированных голосов. Прослушивание демо-образца: <code>GET /api/voices/preview/:id</code> (<code>sardor</code>, <code>aziza</code>, <code>madina</code>, <code>jasur</code>, <code>otabek</code>, <code>nilufar</code>, <code>ulugbek</code>). Клонирование и удаление системных голосов доступно только администратору.
                </>
              )}
            </p>
          </div>

          {/* POST /api/podcast/generate-cover */}
          <div id="covers" className="pt-6 border-t border-[rgba(22,21,17,0.14)]">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-serif font-normal text-2xl text-[#161511]">SVG Muqova Generatori</h2>
              <span className="font-mono text-xs tracking-wider bg-[rgba(14,124,134,0.12)] text-[#0A5A62] px-2.5 py-1 rounded-md">
                POST /api/podcast/generate-cover
              </span>
            </div>
            <p className="text-[#3A382F] text-[14.5px] mt-2">
              {lang === 'uz'
                ? 'Podkast epizodi uchun 800x800 oʻlchamdagi vektor SVG muqova yaratadi (narxi: 1 kredit).'
                : 'Генерирует векторную обложку 800x800 SVG для выпуска подкаста (стоимость: 1 кредит).'}
            </p>
            <div className="mt-4">
              <div className="flex justify-between items-center bg-[#0E0E0D] text-[#7D7A70] font-mono text-[10px] uppercase tracking-[0.12em] px-5 py-2.5 rounded-t-2xl">
                <span>POST /api/podcast/generate-cover</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(coverCode, 4)}
                  className="flex items-center gap-1 text-[#5CC8CF] hover:text-white cursor-pointer bg-transparent border-0 font-mono text-[10px]"
                >
                  {copiedIndex === 4 ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedIndex === 4 ? 'Nusxalandi!' : 'KODNI OLISH'}</span>
                </button>
              </div>
              <pre className="bg-[#141414] text-[#EDEAE2] p-5 rounded-b-2xl font-mono text-xs sm:text-[12.5px] leading-relaxed overflow-x-auto whitespace-pre m-0">
                {coverCode}
              </pre>
            </div>
          </div>

          {/* Emotion Tags */}
          <div id="tags" className="pt-6 border-t border-[rgba(22,21,17,0.14)]">
            <h2 className="font-serif font-normal text-2xl text-[#161511]">
              {lang === 'uz' ? 'Emotsiya teglari' : 'Теги эмоций и пауз'}
            </h2>
            <p className="text-[#3A382F] text-[14.5px] mt-2">
              Matn ichida ishlatiladi — sintez ularni ovoz ohangi bilan ijro etadi, ovozda soʻz sifatida oʻqilmaydi:
            </p>

            <div className="mt-4 border border-[rgba(22,21,17,0.14)] rounded-xl overflow-hidden bg-white/70">
              <table className="w-full text-left text-[13.5px]">
                <thead>
                  <tr className="border-b border-[rgba(22,21,17,0.14)] font-mono text-[10px] uppercase tracking-[0.12em] text-[#5D594E]">
                    <th className="p-3">Teg</th>
                    <th className="p-3">Effekt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgba(22,21,17,0.08)]">
                  <tr>
                    <td className="p-3 font-mono text-xs text-[#C4552D]">&lt;breath&gt; · &lt;sigh&gt;</td>
                    <td className="p-3">Yengil tabiiy nafas va xoʻrsinish — matnni jonlantiradi</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-mono text-xs text-[#C4552D]">&lt;laugh&gt;</td>
                    <td className="p-3">Haqiqiy kulgu va tabassum</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-mono text-xs text-[#0A5A62]">|ha| · |mhm| · |xoʻsh|</td>
                    <td className="p-3">Jonli tasdiqlash va suhbat reaksiyalari</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-mono text-xs text-[#0A5A62]">[Pauza 1s] · [Pauza 2s]</td>
                    <td className="p-3">Dramatik yoki maʼlumotli pauza</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-mono text-xs text-[#0A5A62]">[Hayajon] · [Kulminatsiya]</td>
                    <td className="p-3">Kayfiyat oʻzgarishi — temp va ohang moslashadi</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Limits & Pricing */}
          <div id="limits" className="pt-6 border-t border-[rgba(22,21,17,0.14)] pb-8">
            <h2 className="font-serif font-normal text-2xl text-[#161511]">
              {lang === 'uz' ? 'Limitlar va Tariflar' : 'Лимиты и тарифы'}
            </h2>
            <div className="mt-4 border border-[rgba(22,21,17,0.14)] rounded-xl overflow-hidden bg-white/70">
              <table className="w-full text-left text-[13.5px]">
                <thead>
                  <tr className="border-b border-[rgba(22,21,17,0.14)] font-mono text-[10px] uppercase tracking-[0.12em] text-[#5D594E]">
                    <th className="p-3">Tarif</th>
                    <th className="p-3">Kreditlar</th>
                    <th className="p-3">Tezlik / Limit</th>
                    <th className="p-3">Narx</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgba(22,21,17,0.08)]">
                  <tr>
                    <td className="p-3 font-semibold">Roʻyxatdan oʻtish bonusi</td>
                    <td className="p-3">5 kredit (bir martalik)</td>
                    <td className="p-3">10 soʻrov / daqiqa</td>
                    <td className="p-3">Bepul</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-semibold">Start Paketi</td>
                    <td className="p-3">+25 kredit</td>
                    <td className="p-3">10 soʻrov / daqiqa</td>
                    <td className="p-3">49,000 soʻm</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-semibold">Ijodkor Pro</td>
                    <td className="p-3">+100 kredit</td>
                    <td className="p-3">10 soʻrov / daqiqa</td>
                    <td className="p-3">129,000 soʻm</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-semibold">Media Studiya VIP</td>
                    <td className="p-3">+350 kredit</td>
                    <td className="p-3">VIP ustuvorlik</td>
                    <td className="p-3">299,000 soʻm</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-6 flex justify-start">
              <button
                type="button"
                onClick={onOpenPricingModal}
                className="btn-pill btn-solid text-xs py-2.5 px-5"
              >
                {lang === 'uz' ? 'Tarif rejasini tanlash' : 'Выбрать тариф'}
              </button>
            </div>
          </div>
        </article>
      </div>
    </div>
  );
};
