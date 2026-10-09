import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface DocsScreenProps {
  lang: 'uz' | 'ru';
  onOpenPricingModal: () => void;
}

export const DocsScreen: React.FC<DocsScreenProps> = ({ lang, onOpenPricingModal }) => {
  const [activeSection, setActiveSection] = useState('quickstart');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const copyToClipboard = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const curlCode = `# 1 soatlik podkast yoki oddiy TTS sintezi:
# Firebase ID Token (user.getIdToken()) orqali haqiqiy avtorizatsiya:
curl https://api.ovozstudio.uz/api/podcast/synthesize \\
  -H "Authorization: Bearer <FIREBASE_ID_TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "script": "Assalomu alaykum! <breath> Bugun sizga bir ajoyib yangilik aytaman.",
    "voiceProfile": {
      "voiceId": "shokhrukh",
      "voiceName": "SHOKHRUKH",
      "baseVoice": "Puck",
      "timbre": "Bariton"
    },
    "speechStyle": "Samimiy & Jonli"
  }' --output salom.wav`;

  const agentCode = `{
  "persona": "toshkent_rieltor_eksperti",
  "voice": "shokhrukh",
  "language": "uz",
  "tools": [
    "lead_card",          // mijoz kartochkasi avtomatik toʻldiriladi
    "price_radar",        // bozor narxlari boʻyicha jonli tahlil
    "crm_dossier",        // CRM yozuvlari: mulklar, tarix
    "realtor_scripts"     // sotuv skriptlari va javob shablonlari
  ],
  "on_end": "webhook:call_completed"
}`;

  const callCode = `{
  "to": "+998901234567",
  "agent": "toshkent_rieltor_eksperti",
  "goal": "Koʻrishuvga kelishib olish",
  "context": { "lead_id": "LPMAMA-0231" },
  "max_duration_min": 10
}`;

  return (
    <div className="max-w-6xl mx-auto py-4 px-2 sm:px-6">
      <div className="grid grid-cols-1 md:grid-cols-[210px_1fr] gap-8 items-start">
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
            Endpointlar
          </div>
          <a
            href="#tts"
            onClick={() => setActiveSection('tts')}
            className={`px-3 py-1.5 rounded-lg transition-colors no-underline ${
              activeSection === 'tts' ? 'bg-[#ECE7DB] font-semibold text-[#161511]' : 'text-[#5D594E] hover:text-[#161511]'
            }`}
          >
            POST /v1/tts
          </a>
          <a
            href="#live"
            onClick={() => setActiveSection('live')}
            className={`px-3 py-1.5 rounded-lg transition-colors no-underline ${
              activeSection === 'live' ? 'bg-[#ECE7DB] font-semibold text-[#161511]' : 'text-[#5D594E] hover:text-[#161511]'
            }`}
          >
            WS /v1/agents/live
          </a>
          <a
            href="#call"
            onClick={() => setActiveSection('call')}
            className={`px-3 py-1.5 rounded-lg transition-colors no-underline ${
              activeSection === 'call' ? 'bg-[#ECE7DB] font-semibold text-[#161511]' : 'text-[#5D594E] hover:text-[#161511]'
            }`}
          >
            POST /v1/agents/call
          </a>
          <a
            href="#voices"
            onClick={() => setActiveSection('voices')}
            className={`px-3 py-1.5 rounded-lg transition-colors no-underline ${
              activeSection === 'voices' ? 'bg-[#ECE7DB] font-semibold text-[#161511]' : 'text-[#5D594E] hover:text-[#161511]'
            }`}
          >
            GET /v1/voices
          </a>
          <a
            href="#covers"
            onClick={() => setActiveSection('covers')}
            className={`px-3 py-1.5 rounded-lg transition-colors no-underline ${
              activeSection === 'covers' ? 'bg-[#ECE7DB] font-semibold text-[#161511]' : 'text-[#5D594E] hover:text-[#161511]'
            }`}
          >
            POST /v1/covers
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
            href="#webhooks"
            onClick={() => setActiveSection('webhooks')}
            className={`px-3 py-1.5 rounded-lg transition-colors no-underline ${
              activeSection === 'webhooks' ? 'bg-[#ECE7DB] font-semibold text-[#161511]' : 'text-[#5D594E] hover:text-[#161511]'
            }`}
          >
            Webhooks
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
                ? 'Oʻzbek tilidagi eng tabiiy ovoz — endi sizning mahsulotingizda. Text-to-speech, jonli AI-agentlar, video dublyaj va muqova generatori: bitta REST/WebSocket API orqali. Kalitni oling, 10 daqiqada ulaning.'
                : 'Самый естественный узбекский голос в ваших продуктах. Text-to-Speech, диалоги, голосовые AI-агенты и дубляж через единый REST/WebSocket API.'}
            </p>
          </div>

          {/* Quickstart */}
          <div id="quickstart" className="pt-6 border-t border-[rgba(22,21,17,0.14)]">
            <h2 className="font-serif font-normal text-2xl text-[#161511]">
              {lang === 'uz' ? 'Tezkor start' : 'Быстрый старт'}
            </h2>
            <p className="text-[#3A382F] text-[14.5px] mt-2">
              {lang === 'uz'
                ? 'Matnni ovozga aylantirish uchun bitta soʻrov yetarli. API kalitingizni kabinet boʻlimida oling.'
                : 'Для синтеза текста в речь достаточно одного запроса curl. Передайте текст и получите WAV.'}
            </p>

            <div className="mt-4">
              <div className="flex justify-between items-center bg-[#0E0E0D] text-[#7D7A70] font-mono text-[10px] uppercase tracking-[0.12em] px-5 py-2.5 rounded-t-2xl">
                <span>curl — birinchi soʻrov</span>
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
                <span className="text-[#7D7A70]"># 1 soatlik podkast yoki oddiy TTS sintezi (Firebase ID Token):</span>{'\n'}
                curl <span className="text-[#5CC8CF]">https://api.ovozstudio.uz/api/podcast/synthesize</span> \{'\n'}
                {'  '}-H <span className="text-[#C98A12]">"Authorization: Bearer &lt;FIREBASE_ID_TOKEN&gt;"</span> \{'\n'}
                {'  '}-H <span className="text-[#C98A12]">"Content-Type: application/json"</span> \{'\n'}
                {'  '}-d <span className="text-[#C98A12]">'{'{'}{'\n'}
                {'    '}<span className="text-[#5CC8CF]">"script"</span>: <span className="text-[#E08B5A]">"Assalomu alaykum! &lt;breath&gt; Bugun sizga bir ajoyib yangilik aytaman."</span>,{'\n'}
                {'    '}<span className="text-[#5CC8CF]">"voiceProfile"</span>: {'{'}{'\n'}
                {'      '}<span className="text-[#5CC8CF]">"voiceId"</span>: <span className="text-[#E08B5A]">"shokhrukh"</span>,{'\n'}
                {'      '}<span className="text-[#5CC8CF]">"voiceName"</span>: <span className="text-[#E08B5A]">"SHOKHRUKH"</span>{'\n'}
                {'    '}{'}'}{'\n'}
                {'  }'}'</span> <span className="text-[#7D7A70]">--output salom.wav</span>
              </pre>
            </div>

            <div className="mt-4 border-l-4 border-[#0E7C86] bg-[rgba(14,124,134,0.06)] rounded-r-xl p-4 text-[13.5px] text-[#3A382F]">
              <b className="text-[#0A5A62] block mb-1">0% aksent kafolati.</b>
              Oʻzbek tili — asosiy til, ingliz tilidan tarjima qilingan sunʼiy TTS emas. Voice Replication orqali oʻz ovozingizni klonlab, korporativ brend ovozingizni yarata olasiz.
            </div>
          </div>

          {/* Authentication */}
          <div id="auth" className="pt-6 border-t border-[rgba(22,21,17,0.14)]">
            <h2 className="font-serif font-normal text-2xl text-[#161511]">
              {lang === 'uz' ? 'Autentifikatsiya' : 'Аутентификация'}
            </h2>
            <p className="text-[#3A382F] text-[14.5px] mt-2 leading-relaxed">
              {lang === 'uz' ? (
                <>
                  Barcha API soʻrovlari <code className="font-mono text-xs bg-[rgba(14,124,134,0.08)] text-[#0A5A62] px-2 py-0.5 rounded">Authorization: Bearer &lt;ID_TOKEN&gt;</code> sarlavhasi bilan yuboriladi.
                  Tokenni Firebase Auth orqali oling: <code className="font-mono text-xs bg-[rgba(14,124,134,0.08)] text-[#0A5A62] px-2 py-0.5 rounded">auth.currentUser.getIdToken()</code>.
                  Statik doimiy API kalitlar (<span className="font-mono text-xs text-[#0A5A62]">OZS_live_...</span>) korporativ mijozlar uchun tez orada taqdim etiladi (ishlab chiqilmoqda).
                </>
              ) : (
                <>
                  Все API-запросы защищены заголовком <code className="font-mono text-xs bg-[rgba(14,124,134,0.08)] text-[#0A5A62] px-2 py-0.5 rounded">Authorization: Bearer &lt;ID_TOKEN&gt;</code>.
                  Получите токен через Firebase Auth: <code className="font-mono text-xs bg-[rgba(14,124,134,0.08)] text-[#0A5A62] px-2 py-0.5 rounded">auth.currentUser.getIdToken()</code>.
                  Постоянные API-ключи (<span className="font-mono text-xs text-[#0A5A62]">OZS_live_...</span>) для корпоративных интеграций станут доступны в ближайшее время (в разработке).
                </>
              )}
            </p>
          </div>

          {/* POST /v1/tts */}
          <div id="tts" className="pt-6 border-t border-[rgba(22,21,17,0.14)]">
            <div className="flex items-center gap-3">
              <h2 className="font-serif font-normal text-2xl text-[#161511]">Text-to-Speech</h2>
              <span className="font-mono text-xs tracking-wider bg-[rgba(14,124,134,0.12)] text-[#0A5A62] px-2.5 py-1 rounded-md">
                POST /v1/tts
              </span>
            </div>
            <p className="text-[#3A382F] text-[14.5px] mt-2">
              Matndan studiya sifatidagi audioga sintez. Uzun matnlar (1 soatgacha) avtomatik boblar boʻyicha boʻlinadi, natija bitta faylda qaytadi.
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
                    <td className="p-3 font-mono text-xs text-[#0E7C86]">voice</td>
                    <td className="p-3 font-mono text-xs text-[#5D594E]">string</td>
                    <td className="p-3">Ovoz ID: <code>shokhrukh</code>, <code>aziza-ai</code>, <code>jasur-business</code>… yoki shaxsiy klon ID</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-mono text-xs text-[#0E7C86]">text</td>
                    <td className="p-3 font-mono text-xs text-[#5D594E]">string</td>
                    <td className="p-3">1 000 000 belgigacha. Emotsiya teglari qoʻllanadi</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-mono text-xs text-[#0E7C86]">tempo</td>
                    <td className="p-3 font-mono text-xs text-[#5D594E]">number</td>
                    <td className="p-3">0.75 – 1.35 (standart 1.0)</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-mono text-xs text-[#0E7C86]">style</td>
                    <td className="p-3 font-mono text-xs text-[#5D594E]">string</td>
                    <td className="p-3"><code>epik</code> · <code>komedik</code> · <code>tahliliy</code> · <code>dramatik</code></td>
                  </tr>
                  <tr>
                    <td className="p-3 font-mono text-xs text-[#0E7C86]">music</td>
                    <td className="p-3 font-mono text-xs text-[#5D594E]">object</td>
                    <td className="p-3"><code>{'{ "track": "neoklassik", "ducking_db": -12 }'}</code></td>
                  </tr>
                  <tr>
                    <td className="p-3 font-mono text-xs text-[#0E7C86]">format</td>
                    <td className="p-3 font-mono text-xs text-[#5D594E]">string</td>
                    <td className="p-3"><code>wav_24k</code> · <code>mp3_320</code> · <code>mp3_192</code></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* WS /v1/agents/live */}
          <div id="live" className="pt-6 border-t border-[rgba(22,21,17,0.14)]">
            <div className="flex items-center gap-3">
              <h2 className="font-serif font-normal text-2xl text-[#161511]">Jonli Agent — Duplex Suhbat</h2>
              <span className="font-mono text-xs tracking-wider bg-[rgba(196,85,45,0.12)] text-[#C4552D] px-2.5 py-1 rounded-md">
                WS /v1/agents/live
              </span>
            </div>
            <p className="text-[#3A382F] text-[14.5px] mt-2">
              Real-time ovozli muloqot: mijoz gapiradi — agent tushunadi va tabiiy oʻzbekcha ovozda javob beradi (OvozStudio Live). Veb-sayt widgetida yoki telefonda ishlaydi.
            </p>

            <div className="mt-4">
              <div className="flex justify-between items-center bg-[#0E0E0D] text-[#7D7A70] font-mono text-[10px] uppercase tracking-[0.12em] px-5 py-2.5 rounded-t-2xl">
                <span>agent konfiguratsiyasi — koʻchmas mulk misoli</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(agentCode, 2)}
                  className="flex items-center gap-1 text-[#5CC8CF] hover:text-white cursor-pointer bg-transparent border-0 font-mono text-[10px]"
                >
                  {copiedIndex === 2 ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedIndex === 2 ? 'Nusxalandi!' : 'KODNI OLISH'}</span>
                </button>
              </div>
              <pre className="bg-[#141414] text-[#EDEAE2] p-5 rounded-b-2xl font-mono text-xs sm:text-[12.5px] leading-relaxed overflow-x-auto whitespace-pre m-0">
                {agentCode}
              </pre>
            </div>
          </div>

          {/* POST /v1/agents/call */}
          <div id="call" className="pt-6 border-t border-[rgba(22,21,17,0.14)]">
            <div className="flex items-center gap-3">
              <h2 className="font-serif font-normal text-2xl text-[#161511]">Outbound Qoʻngʻiroq</h2>
              <span className="font-mono text-xs tracking-wider bg-[rgba(14,124,134,0.12)] text-[#0A5A62] px-2.5 py-1 rounded-md">
                POST /v1/agents/call
              </span>
            </div>
            <p className="text-[#3A382F] text-[14.5px] mt-2">
              Agent oʻzi mijozga qoʻngʻiroq qiladi: leadlar bazasini qizitadi, ehtiyojni aniqlaydi, uchrashuv rejalashtiradi. Call-markaz oʻrniga — bir necha qator kod.
            </p>

            <div className="mt-4">
              <div className="flex justify-between items-center bg-[#0E0E0D] text-[#7D7A70] font-mono text-[10px] uppercase tracking-[0.12em] px-5 py-2.5 rounded-t-2xl">
                <span>POST /v1/agents/call</span>
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

          {/* GET /v1/voices */}
          <div id="voices" className="pt-6 border-t border-[rgba(22,21,17,0.14)]">
            <div className="flex items-center gap-3">
              <h2 className="font-serif font-normal text-2xl text-[#161511]">Ovozlar va Klonlash</h2>
              <span className="font-mono text-xs tracking-wider bg-[rgba(201,138,18,0.15)] text-[#8A6410] px-2.5 py-1 rounded-md">
                GET /v1/voices
              </span>
            </div>
            <p className="text-[#3A382F] text-[14.5px] mt-2">
              18 ta professional ovoz (bariton, tenor, soprano, bas) va sizning shaxsiy klonlaringiz. Klonlash: 30 soniyalik namuna → <code>POST /v1/voices/clone</code> orqali.
            </p>
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
                    <td className="p-3 font-mono text-xs text-[#C4552D]">&lt;breath&gt;</td>
                    <td className="p-3">Yengil tabiiy nafas — matnni „tirik“ qiladi</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-mono text-xs text-[#C4552D]">&lt;laugh&gt;</td>
                    <td className="p-3">Haqiqiy kulgu va tabassum</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-mono text-xs text-[#0A5A62]">|ha| · |mhm|</td>
                    <td className="p-3">Jonli tasdiqlash, intervyu reaksiyalari</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-mono text-xs text-[#0A5A62]">[Pauza 2s]</td>
                    <td className="p-3">Dramatik yoki maʼlumotli pauza</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-mono text-xs text-[#0A5A62]">[Hayajon] · [Jimjitlik]</td>
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
                    <th className="p-3">TTS</th>
                    <th className="p-3">Jonli Agentlar</th>
                    <th className="p-3">Parallel Oqim</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgba(22,21,17,0.08)]">
                  <tr>
                    <td className="p-3 font-semibold">Start (Bepul)</td>
                    <td className="p-3">5 podkast / oy</td>
                    <td className="p-3">1 daqiqa sinov</td>
                    <td className="p-3">1</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-semibold">Ijodkor Pro</td>
                    <td className="p-3">100 podkast / oy</td>
                    <td className="p-3">100 daqiqa / oy</td>
                    <td className="p-3">5</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-semibold">Media VIP</td>
                    <td className="p-3">350 podkast / oy</td>
                    <td className="p-3">5 000 daqiqa / oy</td>
                    <td className="p-3">25</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-semibold">Enterprise SLA</td>
                    <td className="p-3">Cheksiz</td>
                    <td className="p-3">Call-markaz SLA</td>
                    <td className="p-3">Cheksiz</td>
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
