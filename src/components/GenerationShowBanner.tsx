import React, { useEffect, useRef } from 'react';

export const AUDIO_BAR_CONFIGS = [
  { duration: '0.70s', delay: '0.04s' },
  { duration: '1.15s', delay: '0.22s' },
  { duration: '0.82s', delay: '0.11s' },
  { duration: '1.08s', delay: '0.34s' },
  { duration: '0.75s', delay: '0.08s' },
  { duration: '0.94s', delay: '0.28s' },
  { duration: '1.20s', delay: '0.15s' },
  { duration: '0.78s', delay: '0.40s' },
  { duration: '1.02s', delay: '0.02s' },
  { duration: '0.86s', delay: '0.25s' },
  { duration: '1.12s', delay: '0.18s' },
  { duration: '0.72s', delay: '0.36s' },
  { duration: '1.05s', delay: '0.10s' },
  { duration: '0.88s', delay: '0.31s' },
  { duration: '1.18s', delay: '0.21s' },
  { duration: '0.74s', delay: '0.05s' },
  { duration: '0.98s', delay: '0.38s' },
  { duration: '1.10s', delay: '0.13s' },
  { duration: '0.80s', delay: '0.26s' },
  { duration: '1.16s', delay: '0.07s' },
  { duration: '0.90s', delay: '0.33s' },
  { duration: '1.04s', delay: '0.16s' },
  { duration: '0.84s', delay: '0.29s' },
  { duration: '1.14s', delay: '0.12s' },
];

export const GENERATION_STATUS_MESSAGES = [
  'AI ssenariy yozmoqda…',
  'Gemini boblar boʻyicha boʻlmoqda…',
  'SHOKHRUKH ovozi sintez qilinmoqda…',
  'Lyria musiqa + ducking…',
];

export const SIMULATION_SCRIPT_UZ_LONG = `[KIRISH]
Assalomu alaykum va xush kelibsiz! <breath> Bugungi katta podkast sonimizda biz sun'iy intellekt, ovoz sintezi va kelajak texnologiyalarining O'zbekistondagi yangi to'lqini haqida gaplashamiz. [Pauza] Texnologiyalar shunchalik tez sur'atlarda o'zgarmoqdaki, ularni chuqur tahlil qilish har birimiz uchun nihoyatda muhim... <laugh>

[ASOSIY QISM]
Birinchi navbatda, neyron tarmoqlarning fonetik tahlil imkoniyatlariga to'xtalamiz. <breath> Har bir so'z, har bir urg'u va hatto jumlalar orasidagi nafas olish ritmi inson qulog'iga tabiiy eshitilishi uchun yuzlab parametrlarni hisobga olish kerak. [Pauza] Gemini 3.8 va OvozStudio modellari orqali biz o'zbek tilining boy jilosini to'liq saqlab qolishga muvaffaq bo'ldik. Tinglovchi har bir gap ortidagi his-tuyg'uni his qila oladi.

[KULMINATSIYA]
Endi esa eng hayajonli qismga yetib keldik! <breath> Tasavvur qiling, istalgan mavzudagi murakkab ilmiy maqolalar yoki adabiy durdonalar bir necha daqiqada professional studiya sifatidagi podkastga aylanadi. [Pauza] Bu oddiygina mexanik o'qish emas, balki jonli diktor ijrosi bilan tenglashadigan yangi davr san'atidir! <laugh>

[XULOSA]
Xulosa qilib aytganda, texnologiya inson tafakkurini cheklamaydi, aksincha unga yangi ufqlarni ochib beradi. [Pauza] Bugungi katta sonimizni biz bilan birga tinglaganingiz uchun tashakkur. <breath> O'z fikrlaringizni qoldiring va keyingi yangi sonlarda ko'rishguncha salomat bo'ling!`;

export const SIMULATION_SCRIPT_UZ_QUICK = `[KIRISH]
Assalomu alaykum, aziz do'stlar! <breath> Bugungi tezkor ssenariy sonimizda audio texnologiyalar va ijodiy jarayonlar haqida eng qiziqarli ma'lumotlarni ulashamiz. [Pauza]

[ASOSIY QISM]
Zamonaviy raqamli media tezkorlik va yuqori sifatni talab qiladi. <breath> Ovozli loyihalarda to'g'ri intonatsiya va his-tuyg'ularni berish uchun maxsus belgilardan unumli foydalanamiz. <laugh> Masalan, tabiiy nafas va pauzalar hikoyani jonli suhbatga aylantiradi. [Pauza]

[KULMINATSIYA]
OvozStudio yordamida har bir muallif o'z g'oyalarini bir necha soniyada tayyor podkast ssenariysiga aylantirishi mumkin! <breath>

[XULOSA]
Sun'iy intellekt bilan audio olamida yangi qadam tashlang. [Pauza] Tinglaganingiz uchun rahmat, tez orada yangi ovozlarda uchrashguncha!`;

export const SIMULATION_SCRIPT_RU_LONG = `[KIRISH]
Здравствуйте и добро пожаловать! <breath> В сегодняшнем выпуске подкаста мы обсудим нейросети, голосовой синтез и новые технологии в медиа. [Pauza] Скорость развития искусственного интеллекта впечатляет каждого создателя контента... <laugh>

[ASOSIY QISM]
В первой главе разберем фонетический анализ и интонации. <breath> Каждое слово, микропаузы и дыхание диктора выстраивают живой эмоциональный контакт со слушателем. [Pauza] Модели Gemini 3.8 передают всю глубину речи с идеальным балансом.

[KULMINATSIYA]
И вот кульминационный момент нашего выпуска! <breath> Любая тема за считанные мгновения превращается в готовый сценарий с таймкодами и режиссерскими ремарками. [Pauza] Это новый уровень свободы для авторов и подкастеров! <laugh>

[XULOSA]
В заключение отметим, что технологии усиливают авторский голос. [Pauza] Спасибо, что слушали нас, делитесь мыслями и до новых встреч в эфире!`;

export const SIMULATION_SCRIPT_RU_QUICK = `[KIRISH]
Приветствуем всех слушателей! <breath> В этом экспресс-выпуске мы кратко и емко разберем создание подкастов с помощью AI. [Pauza]

[ASOSIY QISM]
Качественный звук и продуманная драматургия делают аудио захватывающим. <breath> Речевые маркеры и интонационные теги оживляют синтез речи. <laugh> 

[KULMINATSIYA]
Генерация сценария завершает балансировку глав и акцентов! <breath>

[XULOSA]
Спасибо за внимание, переходим к озвучиванию сценария! [Pauza]`;

/**
 * Tokenizer & formatter for simulated typing:
 * - Chapter tags: [KIRISH], [ASOSIY QISM], [KULMINATSIYA], [XULOSA] in teal #0E7C86 semibold
 * - Emotion tags: <breath>, <laugh>, [Pauza] in terracotta #C4552D
 * - Blinking block caret: 8x16px teal, steps(1) 1s
 */
export const FormattedSimulationView: React.FC<{ text: string }> = ({ text }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [text]);

  const tagRegex =
    /(\[KIRISH\]|\[ASOSIY QISM\]|\[KULMINATSIYA\]|\[XULOSA\]|\[BOB[^\]]*\]|\[\d{2}:\d{2}[^\]]*\]|<breath>|<laugh>|<gasp>|\[Pauza[^\]]*\]|\|ha\||\|mhm\||\[Hayajonli\])/g;

  const parts = text.split(tagRegex);

  return (
    <div
      ref={containerRef}
      className="w-full min-h-[340px] max-h-[460px] overflow-y-auto bg-white border border-[#0E7C86]/50 rounded-2xl p-4 text-xs sm:text-sm text-[#161511] leading-relaxed font-sans shadow-xs whitespace-pre-wrap select-none transition-all"
    >
      {parts.map((part, idx) => {
        if (!part) return null;
        if (
          part === '[KIRISH]' ||
          part === '[ASOSIY QISM]' ||
          part === '[KULMINATSIYA]' ||
          part === '[XULOSA]' ||
          part.startsWith('[BOB') ||
          /^\[\d{2}:\d{2}/.test(part)
        ) {
          return (
            <span
              key={idx}
              className="text-[#0E7C86] font-semibold tracking-wide"
            >
              {part}
            </span>
          );
        }
        if (
          part === '<breath>' ||
          part === '<laugh>' ||
          part === '<gasp>' ||
          part.startsWith('[Pauza') ||
          part === '|ha|' ||
          part === '|mhm|' ||
          part === '[Hayajonli]'
        ) {
          return (
            <span
              key={idx}
              className="text-[#C4552D] font-mono font-medium px-0.5"
            >
              {part}
            </span>
          );
        }
        return <span key={idx}>{part}</span>;
      })}
      {/* Blinking block caret: 8x16px teal, steps(1) 1s */}
      <span
        aria-hidden="true"
        className="inline-block w-[8px] h-[16px] bg-[#0E7C86] ml-1 align-middle rounded-[1px] animate-block-caret"
      />
    </div>
  );
};

interface GenerationShowBannerProps {
  isGenerating: boolean;
  isCompleted: boolean;
  progress: number;
  statusMessage: string;
  lang: 'uz' | 'ru';
}

export const GenerationShowBanner: React.FC<GenerationShowBannerProps> = ({
  isGenerating,
  isCompleted,
  progress,
  statusMessage,
  lang,
}) => {
  return (
    <div className="p-3.5 bg-white/90 border border-[#0E7C86]/30 rounded-2xl space-y-2.5 shadow-xs transition-all">
      {/* Mono Status Line: cycles every ~2.5s, IBM Plex Mono 13px */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`w-2.5 h-2.5 rounded-full ${
              isCompleted
                ? 'bg-emerald-600'
                : 'bg-[#0E7C86] pulse-teal-dot'
            }`}
          />
          <span
            className="font-mono text-[13px] text-[#0A5A62] font-medium tracking-tight truncate"
            style={{ fontFamily: '"IBM Plex Mono", monospace' }}
          >
            {isCompleted
              ? lang === 'uz'
                ? 'Ssenariy muvaffaqiyatli tayyorlandi!'
                : 'Сценарий успешно сгенерирован!'
              : statusMessage}
          </span>
        </div>
        <span className="font-mono text-[12px] text-[#5D594E] tabular-nums font-semibold shrink-0">
          {Math.round(progress)}%
        </span>
      </div>

      {/* Progress Bar: 8px, rounded, gradient teal #0E7C86 -> #5CC8CF */}
      <div className="w-full h-[8px] bg-[#ECE7DB] rounded-full overflow-hidden border border-[rgba(22,21,17,0.08)]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#0E7C86] to-[#5CC8CF] transition-all duration-300 ease-out"
          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        />
      </div>

      {/* 24-Bar Audio Level Strip: each bar 3px wide, teal, animated heights 18%-95% with independent CSS keyframes, 0.7-1.2s alternating, freezes flat when done */}
      <div className="flex items-center justify-between sm:justify-start gap-2 pt-0.5">
        <div
          className="flex items-end gap-[3px] h-[22px] px-0.5"
          title={
            isGenerating
              ? 'Audio darajasi: sintez oqimi faol'
              : 'Audio darajasi: toʻxtatilgan'
          }
        >
          {AUDIO_BAR_CONFIGS.map((bar, i) => (
            <div
              key={i}
              style={{
                '--bar-dur': bar.duration,
                '--bar-delay': bar.delay,
              } as React.CSSProperties}
              className={`w-[3px] bg-[#0E7C86] rounded-full transition-all duration-300 ${
                isGenerating ? 'audio-bar-animated' : 'audio-bar-flat'
              }`}
            />
          ))}
        </div>
        <span className="font-mono text-[11px] text-[#5D594E]">
          {isGenerating
            ? lang === 'uz'
              ? 'Jonli audio modulyatsiyasi'
              : 'Модуляция аудиопотока'
            : lang === 'uz'
            ? 'Kanal tayyor'
            : 'Канал готов'}
        </span>
      </div>
    </div>
  );
};
