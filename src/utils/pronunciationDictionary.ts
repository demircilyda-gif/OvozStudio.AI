/**
 * Словарь произношения проекта («Слово → Как произносить»).
 *
 * Применяется ТОЛЬКО к тексту, отправляемому в TTS (и для выравнивания/QA по реальному тексту TTS).
 * Субтитры, SRT, таблица реплик, CSV и JSON-экспорт сохраняют исходный текст без замен.
 */

export interface PronunciationDictionaryEntry {
  word: string;
  pronunciation: string;
}

export const DEFAULT_PRONUNCIATION_DICTIONARY: PronunciationDictionaryEntry[] = [
  { word: 'Hybrid', pronunciation: 'gibrid' },
];

const APOSTROPHE_RE = /[ʻʼ‘’`´']/g;

function normalizeApostrophes(input: string): string {
  return String(input || '').replace(APOSTROPHE_RE, "'");
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Очищает и нормализует список записей словаря произношения.
 * Пустые записи отбрасываются; при дубликатах побеждает последняя запись.
 */
export function normalizePronunciationDictionary(
  entries?: ReadonlyArray<Partial<PronunciationDictionaryEntry>> | null
): PronunciationDictionaryEntry[] {
  if (!Array.isArray(entries)) return [];
  const byKey = new Map<string, PronunciationDictionaryEntry>();
  for (const raw of entries) {
    if (!raw || typeof raw !== 'object') continue;
    const word = String(raw.word ?? '').trim();
    const pronunciation = String(raw.pronunciation ?? '').trim();
    if (!word || !pronunciation) continue;
    const key = normalizeApostrophes(word).toLowerCase();
    byKey.set(key, { word, pronunciation });
  }
  return Array.from(byKey.values());
}

/**
 * Проверяет, является ли символ частью слова (буква, цифра или узбекский апостроф).
 * Узбекские апострофы (ʻ ʼ ‘ ’ ') считаются частью слова и НЕ разрывают его.
 */
const WORD_CHAR_RE = /[\p{L}\p{N}'’‘ʻʼ]/u;

function buildWholeWordPattern(word: string): RegExp {
  // Каждому апострофу в искомом слове соответствует любой вариант узбекского апострофа.
  const normalized = normalizeApostrophes(word.trim());
  const parts = normalized.split("'").map((part) => escapeRegExp(part));
  const body = parts.join("[ʻʼ‘’`´']");
  return new RegExp(body, 'giu');
}

function replaceInPlainSegment(
  segment: string,
  compiledEntries: Array<{ regex: RegExp; pronunciation: string }>
): string {
  let result = segment;
  for (const { regex, pronunciation } of compiledEntries) {
    regex.lastIndex = 0;
    let out = '';
    let lastIdx = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(result)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      const prevChar = start > 0 ? result[start - 1] : '';
      const nextChar = end < result.length ? result[end] : '';
      const prevIsWord = prevChar ? WORD_CHAR_RE.test(prevChar) : false;
      const nextIsWord = nextChar ? WORD_CHAR_RE.test(nextChar) : false;

      if (!prevIsWord && !nextIsWord) {
        out += result.slice(lastIdx, start) + pronunciation;
        lastIdx = end;
      }
      if (match[0].length === 0) {
        regex.lastIndex += 1;
      }
    }
    if (lastIdx > 0) {
      out += result.slice(lastIdx);
      result = out;
    }
  }
  return result;
}

/**
 * Применяет словарь произношения к тексту перед всеми остальными преобразованиями текста TTS.
 * - Заменяет только целые слова без учёта регистра.
 * - Узбекские апострофы (ʻ ʼ ‘ ’ ') не разрывают слово.
 * - Теги TTS в угловых скобках (<laugh>, <short pause> и т.д.) не затрагиваются.
 */
export function applyPronunciationDictionary(
  text: string,
  entries?: ReadonlyArray<Partial<PronunciationDictionaryEntry>> | null
): string {
  const rawText = String(text || '');
  if (!rawText) return rawText;

  const cleanEntries = normalizePronunciationDictionary(entries);
  if (cleanEntries.length === 0) return rawText;

  // Более длинные слова/фразы обрабатываем первыми, чтобы избежать частичного перекрытия
  const sorted = [...cleanEntries].sort((a, b) => b.word.length - a.word.length);
  const compiled = sorted.map((entry) => ({
    regex: buildWholeWordPattern(entry.word),
    pronunciation: entry.pronunciation,
  }));

  // Разделяем строку на обычные сегменты и <...> теги TTS; теги оставляем нетронутыми
  const parts = rawText.split(/(<[^>]*>)/g);
  return parts
    .map((part) => {
      if (!part) return part;
      if (part.startsWith('<') && part.endsWith('>')) {
        return part;
      }
      return replaceInPlainSegment(part, compiled);
    })
    .join('');
}

/**
 * Каноническое представление словаря для включения в хэши кэша (если требуется отладка).
 */
export function serializePronunciationDictionary(
  entries?: ReadonlyArray<Partial<PronunciationDictionaryEntry>> | null
): string {
  const clean = normalizePronunciationDictionary(entries);
  return clean
    .map((e) => `${normalizeApostrophes(e.word).toLowerCase()}=>${e.pronunciation}`)
    .sort()
    .join('|');
}
