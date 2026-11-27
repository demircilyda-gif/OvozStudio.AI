import { normalizeUzbekSpeech } from './uzbekNormalizer';
import {
  applyPronunciationDictionary,
  type PronunciationDictionaryEntry,
} from './pronunciationDictionary';

/**
 * Единый модуль формирования стиля Gemini 3.8 TTS, тега <laugh> и текста для TTS.
 * Используется и сервером (перед вызовом TTS и при кэшировании), и браузером (при расчёте ключа кэша).
 */

export const DEFAULT_BASE_STYLE_MALE = 'warm, relaxed, friendly';
export const DEFAULT_BASE_STYLE_FEMALE = 'lively, casual, friendly';

export function getDefaultBaseStyleForGender(gender?: string | null): string {
  return String(gender || '').toLowerCase() === 'female'
    ? DEFAULT_BASE_STYLE_FEMALE
    : DEFAULT_BASE_STYLE_MALE;
}

const APOSTROPHE_RE = /[ʻʼ‘’`´']/g;

function normalizeForMatch(input: string): string {
  return String(input || '')
    .replace(APOSTROPHE_RE, "'")
    .toLowerCase();
}

interface DeliveryEmotionRule {
  /** Префиксы начала слова (или словосочетания, напр. "past ovozda") */
  prefixes: string[];
  /** Короткое английское слово эмоции для поля style */
  emotion: string;
}

/**
 * Словарь эмоций колонки «Подача» (узбекские + русские основы).
 * Поиск — без учёта регистра, по началу слова (с нормализацией всех вариантов апострофов).
 */
export const DELIVERY_EMOTION_RULES: DeliveryEmotionRule[] = [
  // Узбекские основы (строго по спецификации)
  { prefixes: ['azart', 'hayajon'], emotion: 'excited' },
  { prefixes: ['kulib'], emotion: 'amused' },
  { prefixes: ['kulimsira', 'tabassum'], emotion: 'smiling' },
  { prefixes: ['hazil'], emotion: 'playful' },
  { prefixes: ['chaqiriq', 'chorlab'], emotion: 'inviting' },
  { prefixes: ['shubha'], emotion: 'doubtful' },
  { prefixes: ['hayiq'], emotion: 'nervous' },
  { prefixes: ['qiziqib', 'qiziqish'], emotion: 'curious' },
  { prefixes: ['qiziqtir', 'sirli', 'intriga'], emotion: 'mysterious' },
  { prefixes: ['zavq'], emotion: 'delighted' },
  { prefixes: ['xursand', 'quvon'], emotion: 'happy' },
  { prefixes: ['mamnun'], emotion: 'pleased' },
  { prefixes: ['hayrat'], emotion: 'surprised' },
  { prefixes: ['xavotir'], emotion: 'worried' },
  { prefixes: ['tetik'], emotion: 'energetic' },
  { prefixes: ['faxr'], emotion: 'proud' },
  { prefixes: ["ta'sirlan"], emotion: 'impressed' },
  { prefixes: ['havas'], emotion: 'admiring' },
  { prefixes: ['iliq'], emotion: 'warm' },
  { prefixes: ['tinchlantir'], emotion: 'reassuring' },
  { prefixes: ['tinchlanib'], emotion: 'calm' },
  { prefixes: ['yengillik'], emotion: 'relieved' },
  { prefixes: ['ohista', 'past ovozda'], emotion: 'quietly' },

  // Русские основы (из прежнего словаря buildShortEnglishDelivery для совместимости с RU-сценариями)
  { prefixes: ['восторг', 'эмоц', 'драмат'], emotion: 'excited' },
  { prefixes: ['удивл', 'вау', 'пораж'], emotion: 'surprised' },
  { prefixes: ['восхищ'], emotion: 'admiring' },
  { prefixes: ['радост', 'весел'], emotion: 'happy' },
  { prefixes: ['бодр', 'энергич', 'живо'], emotion: 'energetic' },
  { prefixes: ['улыб'], emotion: 'smiling' },
  { prefixes: ['смее', 'смеё', 'смех', 'смея'], emotion: 'amused' },
  { prefixes: ['шутл', 'ирон', 'подкол', 'подшуч'], emotion: 'playful' },
  { prefixes: ['любопыт', 'интерес', 'заинтерес', 'спраш', 'вопрос'], emotion: 'curious' },
  { prefixes: ['скепт', 'сомн'], emotion: 'doubtful' },
  { prefixes: ['тревож', 'обеспок', 'взволн'], emotion: 'worried' },
  { prefixes: ['уверен', 'эксперт', 'делов', 'четк', 'чётк', 'информат'], emotion: 'confident' },
  { prefixes: ['серьез', 'серьёз', 'сдержан', 'задумч', 'вдумч', 'спокойн'], emotion: 'calm' },
  { prefixes: ['мягк', 'тепл', 'тёпл', 'дружел', 'приветл'], emotion: 'warm' },
  { prefixes: ['тихо', 'шёпот', 'шепот', 'приглуш'], emotion: 'quietly' },
  { prefixes: ['успокаив'], emotion: 'reassuring' },
  { prefixes: ['интриг', 'загадоч', 'таинств'], emotion: 'mysterious' },
  { prefixes: ['гордо'], emotion: 'proud' },
  { prefixes: ['облегч'], emotion: 'relieved' },
  { prefixes: ['нервн', 'робк', 'опаск'], emotion: 'nervous' },
  { prefixes: ['впечатл'], emotion: 'impressed' },
  { prefixes: ['довольн'], emotion: 'pleased' },
  { prefixes: ['призыв', 'зазыв'], emotion: 'inviting' },
];

const WORD_CHAR_RE = /[\p{L}\p{N}']/u;

function findPrefixWordStartIndex(normalizedText: string, prefix: string): number {
  let searchFrom = 0;
  while (searchFrom <= normalizedText.length - prefix.length) {
    const idx = normalizedText.indexOf(prefix, searchFrom);
    if (idx < 0) return -1;
    const prevChar = idx > 0 ? normalizedText[idx - 1] : '';
    const startsAtWordBoundary = !prevChar || !WORD_CHAR_RE.test(prevChar);
    if (startsAtWordBoundary) {
      return idx;
    }
    searchFrom = idx + 1;
  }
  return -1;
}

/**
 * Извлекает до maxEmotions (по умолчанию 2) английских слов эмоций из поля «Подача» (intonationRu)
 * строго в порядке появления в тексте.
 */
export function extractEmotionsFromDelivery(
  intonationRu?: string | null,
  maxEmotions = 2
): string[] {
  const normalized = normalizeForMatch(intonationRu || '');
  if (!normalized.trim()) return [];

  const matches: Array<{ index: number; emotion: string }> = [];
  for (const rule of DELIVERY_EMOTION_RULES) {
    let bestIdx = -1;
    for (const prefix of rule.prefixes) {
      const idx = findPrefixWordStartIndex(normalized, prefix);
      if (idx >= 0 && (bestIdx < 0 || idx < bestIdx)) {
        bestIdx = idx;
      }
    }
    if (bestIdx >= 0) {
      matches.push({ index: bestIdx, emotion: rule.emotion });
    }
  }

  matches.sort((a, b) => a.index - b.index);

  const unique: string[] = [];
  for (const m of matches) {
    if (!unique.includes(m.emotion)) {
      unique.push(m.emotion);
      if (unique.length >= maxEmotions) break;
    }
  }
  return unique;
}

/**
 * Очищает базовый стиль спикера (без указаний темпа).
 */
export function sanitizeBaseStyle(baseStyle?: string | null, gender?: string | null): string {
  const raw = String(baseStyle ?? '').trim();
  if (!raw) return getDefaultBaseStyleForGender(gender);
  // Убираем случайные висячие запятые и множественные пробелы
  const cleaned = raw
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .trim();
  return cleaned || getDefaultBaseStyleForGender(gender);
}

/**
 * Собирает итоговый style реплики для Gemini 3.8 TTS:
 * - базовый стиль спикера
 * - плюс до 2 эмоций из «Подачи» (если useDeliveryEmotions !== false)
 * - БЕЗ указаний темпа (никаких "speaking rapidly", "natural conversational pace", "relaxed pace")
 * - на нейтральных репликах (без совпадений или при выключенном флажке) возвращается ТОЛЬКО базовый стиль.
 */
export function buildTurnTtsStyle(params: {
  baseStyle?: string | null;
  gender?: string | null;
  intonationRu?: string | null;
  useDeliveryEmotions?: boolean;
}): { style: string; emotions: string[]; baseStyle: string } {
  const baseStyle = sanitizeBaseStyle(params.baseStyle, params.gender);
  const useEmotions = params.useDeliveryEmotions !== false;
  if (!useEmotions) {
    return { style: baseStyle, emotions: [], baseStyle };
  }

  const emotions = extractEmotionsFromDelivery(params.intonationRu, 2);
  if (emotions.length === 0) {
    return { style: baseStyle, emotions: [], baseStyle };
  }

  // Не дублируем слово, которое уже входит в базовый стиль спикера
  const baseTokens = new Set(
    baseStyle
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
  const appended = emotions.filter((e) => !baseTokens.has(e.toLowerCase()));
  const style = appended.length > 0 ? `${baseStyle}, ${appended.join(', ')}` : baseStyle;

  return { style, emotions, baseStyle };
}

/**
 * Проверяет, содержит ли стиль указание `quietly` (для цели громкости -21 LUFS).
 */
export function hasQuietlyStyle(style?: string | null): boolean {
  return /\bquietly\b/i.test(String(style || ''));
}

/**
 * Проверяет, есть ли в «Подаче» слово на основе `kulib` (для вставки тега `<laugh>`).
 */
export function hasKulibDelivery(intonationRu?: string | null): boolean {
  const normalized = normalizeForMatch(intonationRu || '');
  if (!normalized.trim()) return false;
  return findPrefixWordStartIndex(normalized, 'kulib') >= 0;
}

/**
 * Подсчёт слогов в узбекской/русской строке (без учёта тегов <...>).
 */
export function countSpeechSyllables(text: string): number {
  const clean = String(text || '').replace(/<[^>]+>/g, ' ');
  const matches = clean.match(/[aeiouöüаеёиоуыэюяў]/gi);
  return matches ? matches.length : 0;
}

/**
 * Решает, нужно ли добавить тег `<laugh>` в конец текста реплики:
 * - только если включены эмоции из «Подачи»
 * - только если в `intonationRu` есть `kulib`
 * - только если времени до начала следующей реплики (`windowSec + gapAfterSec`)
 *   больше расчётной длительности речи (`слоги / 5`) минимум на 0.5 с.
 */
export function shouldAppendLaughTag(params: {
  intonationRu?: string | null;
  useDeliveryEmotions?: boolean;
  textForSyllables: string;
  windowSec: number;
  gapAfterSec?: number;
}): boolean {
  if (params.useDeliveryEmotions === false) return false;
  if (!hasKulibDelivery(params.intonationRu)) return false;
  if (/<\s*laugh\s*>/i.test(params.textForSyllables || '')) return false;

  const syllables = countSpeechSyllables(params.textForSyllables);
  const estimatedSpeechSec = syllables / 5.0;
  const availableUntilNextSec =
    Math.max(0, Number(params.windowSec) || 0) + Math.max(0, Number(params.gapAfterSec) || 0);

  return availableUntilNextSec - estimatedSpeechSec >= 0.5;
}

/**
 * Клиент-и-сервер санитизация тегов TTS (оставляет только документированные теги Gemini 3.8 TTS,
 * удаляет невалидные теги и служебные скобки).
 */
export function sanitizeTtsTagsShared(input: string): string {
  return String(input || '')
    .replace(/<\s*(?:chuckle|giggle|kulgi)\s*>/gi, ' <laugh> ')
    .replace(/<\s*(?:gasp|hansirash|nafas|deep_breath)\s*>/gi, ' <breath> ')
    .replace(/<\s*(?:pause|short_pause|pauza)\s*>/gi, ' <short pause> ')
    .replace(/<(?!(\/?(?:laugh|sigh|short pause|breath|cough))\b)[^>]+>/gi, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .trim();
}

/**
 * Готовит финальный текст, который уходит в Gemini 3.8 TTS (и используется в ключе кэша + выравнивании/QA):
 * 1. Словарь произношения (ПЕРЕД всеми остальными преобразованиями текста!)
 * 2. Узбекская нормализация чисел/сокращений (с сохранением <...> тегов)
 * 3. Санитизация тегов (без добавления `<short pause>`)
 * 4. Добавление `<laugh>` в конец при наличии `kulib` и запаса >= 0.5 с до следующей реплики.
 */
export function prepareTurnTextForTts(params: {
  rawText: string;
  pronunciationDictionary?: ReadonlyArray<Partial<PronunciationDictionaryEntry>> | null;
  intonationRu?: string | null;
  useDeliveryEmotions?: boolean;
  windowSec: number;
  gapAfterSec?: number;
  decimalStyle?: 'butun' | 'u';
}): {
  ttsText: string;
  appendedLaugh: boolean;
  syllables: number;
} {
  // 1. Сначала словарь произношения
  const afterDict = applyPronunciationDictionary(
    String(params.rawText || ''),
    params.pronunciationDictionary
  );

  // 2. Узбекская нормализация чисел (сохраняя <...> теги)
  const tagMap: string[] = [];
  const withPlaceholders = afterDict.replace(/<[^>]+>/g, (m) => {
    const idx = tagMap.length;
    tagMap.push(m);
    return ` __TTSTAG${idx}__ `;
  });

  let normalized = withPlaceholders;
  try {
    normalized = normalizeUzbekSpeech(withPlaceholders, {
      decimalStyle: params.decimalStyle || 'butun',
    });
  } catch {
    normalized = withPlaceholders;
  }

  let restored = normalized.replace(/__TTSTAG(\d+)__/g, (_m, idxStr) => {
    const idx = Number(idxStr);
    return tagMap[idx] || '';
  });

  // 3. Очистка тегов и пробелов (без автодобавления <short pause>)
  restored = sanitizeTtsTagsShared(restored)
    .replace(/<\s*short\s+pause\s*>/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .trim();

  if (!restored) {
    restored = String(params.rawText || '').trim();
  }

  const syllables = countSpeechSyllables(restored);

  // 4. Добавляем <laugh> в конец, если подходит условие kulib + запас >= 0.5 с
  const appendedLaugh = shouldAppendLaughTag({
    intonationRu: params.intonationRu,
    useDeliveryEmotions: params.useDeliveryEmotions,
    textForSyllables: restored,
    windowSec: params.windowSec,
    gapAfterSec: params.gapAfterSec,
  });

  const ttsText = appendedLaugh ? `${restored} <laugh>` : restored;

  return {
    ttsText,
    appendedLaugh,
    syllables,
  };
}
