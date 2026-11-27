import type { AmbientSoundscape } from '../types/podcast';

export interface AmbientSoundscapeOption {
  id: AmbientSoundscape;
  icon: string;
  labelUz: string;
  labelRu: string;
  descUz: string;
  descRu: string;
}

export const AMBIENT_SOUNDSCAPES: AmbientSoundscapeOption[] = [
  {
    id: 'none',
    icon: '🎙️',
    labelUz: 'Toza ovoz (Musiqasiz)',
    labelRu: 'Чистый голос (Без фона)',
    descUz: 'Faqat studiya ovozi',
    descRu: 'Только студийный голос',
  },
  {
    id: 'dutor-acoustic',
    icon: '🪕',
    labelUz: 'Milliy Dutor Akustika',
    labelRu: 'Национальный Дутар',
    descUz: "O'zbekona iliq dutor ohangi",
    descRu: 'Тёплая узбекская акустика дутара',
  },
  {
    id: 'oriental-ney',
    icon: '🪈',
    labelUz: 'Sharqona Nay',
    labelRu: 'Восточный Най',
    descUz: 'Tarixiy va madaniy mavzular uchun',
    descRu: 'Для исторических и культурных тем',
  },
  {
    id: 'lofi-beats',
    icon: '🎧',
    labelUz: 'Lo-Fi Podkast Bit',
    labelRu: 'Lo-Fi Подкаст Бит',
    descUz: 'Zamonaviy suhbatlar uchun yumshoq ritm',
    descRu: 'Мягкий ритм для современных бесед',
  },
  {
    id: 'calm-piano',
    icon: '🎹',
    labelUz: 'Sokin Pianino',
    labelRu: 'Спокойное Пианино',
    descUz: 'Psixologiya va samimiy hikoyalar',
    descRu: 'Психология и душевные истории',
  },
  {
    id: 'comedy-jingle',
    icon: '🎭',
    labelUz: 'Quvnoq Shou Fon',
    labelRu: 'Весёлый Шоу-Фон',
    descUz: 'Hazil va yengil koʼngilochar efir',
    descRu: 'Юмор и лёгкий развлекательный эфир',
  },
  {
    id: 'tech-ambient',
    icon: '💻',
    labelUz: 'Tech & AI Ambient',
    labelRu: 'Tech & AI Эмбиент',
    descUz: 'Texnologiya va startap podkastlari',
    descRu: 'Технологии и стартап-подкасты',
  },
  {
    id: 'cinematic-dark',
    icon: '🎬',
    labelUz: 'Kinematografik Sirli',
    labelRu: 'Кинематографический',
    descUz: 'Tergov va hujjatli hikoyalar',
    descRu: 'Расследования и документалистика',
  },
  {
    id: 'business-uplifting',
    icon: '📈',
    labelUz: 'Biznes & Muvaffaqiyat',
    labelRu: 'Бизнес и Развитие',
    descUz: 'Ishonchli korporativ fon',
    descRu: 'Уверенный корпоративный фон',
  },
  {
    id: 'midnight-jazz',
    icon: '🎷',
    labelUz: 'Tungi Jazz',
    labelRu: 'Ночной Джаз',
    descUz: 'Kechki intervyu va suhbatlar',
    descRu: 'Вечерние интервью и беседы',
  },
  {
    id: 'epic-orchestral',
    icon: '🎻',
    labelUz: 'Epik Orkestr',
    labelRu: 'Эпичный Оркестр',
    descUz: 'Katta tarixiy voqealar va treylerlar',
    descRu: 'Крупные исторические события и трейлеры',
  },
  {
    id: 'nature-ambient',
    icon: '🌿',
    labelUz: 'Tabiat Sadosi',
    labelRu: 'Звуки Природы',
    descUz: 'Sokin dam olish va meditatsiya',
    descRu: 'Релакс и медитация',
  },
  {
    id: 'deep-focus',
    icon: '🧠',
    labelUz: 'Chuqur Diqqat (Focus)',
    labelRu: 'Глубокий Фокус',
    descUz: "Ta'lim va ilmiy tahlillar",
    descRu: 'Обучение и научный разбор',
  },
  {
    id: 'synthwave-retro',
    icon: '🌆',
    labelUz: 'Retro Synthwave',
    labelRu: 'Ретро Синтвейв',
    descUz: 'Kreativ va madaniy mavzular',
    descRu: 'Креатив и поп-культура',
  },
  {
    id: 'news-broadcast',
    icon: '📡',
    labelUz: 'Yangiliklar Efiri',
    labelRu: 'Новостной Эфир',
    descUz: 'Tezkor xabarlar va sharhlar',
    descRu: 'Оперативные сводки и обзоры',
  },
  {
    id: 'acoustic-guitar',
    icon: '🎸',
    labelUz: 'Akustik Gitara',
    labelRu: 'Акустическая Гитара',
    descUz: 'Samimiy hayotiy hikoyalar',
    descRu: 'Тёплые жизненные истории',
  },
];
