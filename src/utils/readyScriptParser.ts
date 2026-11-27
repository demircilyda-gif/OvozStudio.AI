import { DialogueTurn } from '../types/podcast';
import {
  normalizePronunciationDictionary,
  type PronunciationDictionaryEntry,
} from './pronunciationDictionary';

export type ReadyScriptFormat = 'pipe' | 'json' | 'csv' | 'srt';

export interface ParsedSpeakerInfo {
  speakerId: 'HOST_1' | 'HOST_2';
  name: string;
  gender: 'male' | 'female';
  baseStyle?: string;
}

export interface ReadyScriptNoSpeechInterval {
  timecode: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  description: string;
}

export interface ReadyScriptValidationError {
  line: number;
  message: string;
}

export interface ReadyScriptParseResult {
  ok: boolean;
  format?: ReadyScriptFormat;
  speakers: ParsedSpeakerInfo[];
  turns: DialogueTurn[];
  noSpeechIntervals: ReadyScriptNoSpeechInterval[];
  totalDurationSec: number;
  errors: ReadyScriptValidationError[];
  useDeliveryEmotions?: boolean;
  pronunciationDictionary?: PronunciationDictionaryEntry[];
}

export interface VideoAutoAnalysisGuardInput {
  autoExtractFromVideo: boolean;
  isImportedScript: boolean;
  storyboardTextRu: string;
  turnsCount: number;
}

/**
 * Pure guard deciding whether uploading a video file should trigger Gemini video analysis.
 * Imported scripts (or any populated turns table when auto-extract is off) must NEVER
 * be overwritten automatically on video upload.
 */
export function shouldRunVideoAutoAnalysis(input: VideoAutoAnalysisGuardInput): boolean {
  if (input.isImportedScript) return false;
  if (input.turnsCount > 0) return Boolean(input.autoExtractFromVideo);
  const isStoryboardFieldEmpty = !input.storyboardTextRu.trim();
  return Boolean(input.autoExtractFromVideo || isStoryboardFieldEmpty);
}

/**
 * Format seconds into MM:SS (or HH:MM:SS if >= 3600s), preserving tenths if non-integer.
 */
export function formatSecToTimecode(sec: number): string {
  const safe = Math.max(0, Number.isFinite(sec) ? sec : 0);
  const rounded = Math.round(safe * 1000) / 1000;
  const totalWholeSec = Math.floor(rounded);
  const frac = Math.round((rounded - totalWholeSec) * 1000);

  const hours = Math.floor(totalWholeSec / 3600);
  const mins = Math.floor((totalWholeSec % 3600) / 60);
  const secs = totalWholeSec % 60;

  const pad2 = (n: number) => String(n).padStart(2, '0');
  const base =
    hours > 0
      ? `${pad2(hours)}:${pad2(mins)}:${pad2(secs)}`
      : `${pad2(mins)}:${pad2(secs)}`;

  if (frac > 0) {
    const fracStr = String(frac).padStart(3, '0').replace(/0+$/, '');
    return `${base}.${fracStr}`;
  }
  return base;
}

/**
 * Parse a timecode ("MM:SS", "HH:MM:SS", "MM:SS.mmm", "HH:MM:SS,mmm") or numeric seconds string.
 * Returns null if invalid.
 */
export function parseTimecodeToSec(raw: string | number | undefined | null): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw >= 0 ? Math.round(raw * 1000) / 1000 : null;
  }
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Pure numeric seconds (e.g. "12" or "12.5" or "12,5" or "12s" or "12с")
  const pureNum = trimmed.match(/^(\d+(?:[.,]\d+)?)\s*(?:s|с|sec|сек)?$/i);
  if (pureNum) {
    const val = Number(pureNum[1].replace(',', '.'));
    return Number.isFinite(val) && val >= 0 ? Math.round(val * 1000) / 1000 : null;
  }

  // HH:MM:SS(.mmm|,mmm) or MM:SS(.mmm|,mmm)
  const parts = trimmed.split(':');
  if (parts.length !== 2 && parts.length !== 3) return null;

  if (parts.length === 2) {
    const mStr = parts[0].trim();
    const sStr = parts[1].trim().replace(',', '.');
    if (!/^\d+$/.test(mStr) || !/^\d+(?:\.\d+)?$/.test(sStr)) return null;
    const mins = Number(mStr);
    const secs = Number(sStr);
    if (!Number.isFinite(mins) || !Number.isFinite(secs) || secs >= 60) return null;
    return Math.round((mins * 60 + secs) * 1000) / 1000;
  }

  const hStr = parts[0].trim();
  const mStr = parts[1].trim();
  const sStr = parts[2].trim().replace(',', '.');
  if (!/^\d+$/.test(hStr) || !/^\d+$/.test(mStr) || !/^\d+(?:\.\d+)?$/.test(sStr)) return null;
  const hrs = Number(hStr);
  const mins = Number(mStr);
  const secs = Number(sStr);
  if (!Number.isFinite(hrs) || !Number.isFinite(mins) || !Number.isFinite(secs) || mins >= 60 || secs >= 60) {
    return null;
  }
  return Math.round((hrs * 3600 + mins * 60 + secs) * 1000) / 1000;
}

/**
 * Normalize gender label from RU/EN/UZ tokens to 'male' | 'female' | null.
 */
export function parseGenderToken(raw: string | undefined | null): 'male' | 'female' | null {
  if (!raw) return null;
  const cleaned = raw.trim().toLowerCase().replace(/[()[\].]/g, '');
  if (!cleaned) return null;
  if (['м', 'm', 'male', 'муж', 'мужской', 'мужчина', 'erkak', '♂'].includes(cleaned)) {
    return 'male';
  }
  if (['ж', 'f', 'female', 'жен', 'женский', 'женщина', 'ayol', '♀'].includes(cleaned)) {
    return 'female';
  }
  return null;
}

/**
 * Normalize rhythm/pace token from RU/EN/UZ labels to DialogueTurn['pace'].
 */
function parsePaceToken(raw: string | undefined | null): DialogueTurn['pace'] {
  if (!raw) return undefined;
  const cleaned = raw.trim().toLowerCase();
  if (!cleaned) return undefined;
  if (/^(fast|быстр|энергич|жив|динамич|бодр|tez|1\.[1-9])/i.test(cleaned)) {
    return 'fast';
  }
  if (/^(slow|медлен|спокойн|размерен|плавн|sekin|0\.[5-8])/i.test(cleaned)) {
    return 'slow';
  }
  if (/^(normal|средн|обычн|ровн|умерен|norm|o'rtacha|1\.0)/i.test(cleaned)) {
    return 'normal';
  }
  return undefined;
}

function normalizeSpeakerKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Extract speaker name and optional inline gender like "Азиз (М)" or "Вероника (Ж)".
 */
function splitNameAndInlineGender(raw: string): { name: string; gender: 'male' | 'female' | null } {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (match) {
    const g = parseGenderToken(match[2]);
    if (g) {
      return { name: match[1].trim(), gender: g };
    }
  }
  return { name: trimmed, gender: null };
}

/**
 * Parse a timecode range such as "00:12–00:19 (7s)", "00:12 - 00:19", "01:02:03—01:02:09".
 */
function parseTimecodeRange(raw: string): {
  startSec: number;
  endSec: number;
  startRaw: string;
  endRaw: string;
} | null {
  // Strip optional trailing duration like "(7s)", "(7.5s)", "(7с)", "(7 сек)"
  const withoutDur = raw.trim().replace(/\s*\(\s*\d+(?:[.,]\d+)?\s*(?:s|с|sec|сек)?\s*\)\s*$/i, '').trim();
  const match = withoutDur.match(
    /^(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?)\s*(?:–|—|-|->|-->|\.\.)\s*(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?)$/
  );
  if (!match) return null;
  const startSec = parseTimecodeToSec(match[1]);
  const endSec = parseTimecodeToSec(match[2]);
  if (startSec === null || endSec === null) return null;
  return {
    startSec,
    endSec,
    startRaw: match[1],
    endRaw: match[2],
  };
}

function parseSrtTimecodeRange(raw: string): {
  startSec: number;
  endSec: number;
  startRaw: string;
  endRaw: string;
} | null {
  const match = raw
    .trim()
    .match(
      /^(\d{1,2}:\d{2}:\d{2}(?:[.,]\d{1,3})?|\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\s*-->\s*(\d{1,2}:\d{2}:\d{2}(?:[.,]\d{1,3})?|\d{1,2}:\d{2}(?:[.,]\d{1,3})?)$/
    );
  if (!match) return null;
  const startSec = parseTimecodeToSec(match[1]);
  const endSec = parseTimecodeToSec(match[2]);
  if (startSec === null || endSec === null) return null;
  return {
    startSec,
    endSec,
    startRaw: match[1],
    endRaw: match[2],
  };
}

/**
 * Parse "Спикеры: Азиз (М), Вероника (Ж)" header line.
 * Takes ONLY the text before the first "|" (e.g. ignores "| Всего реплик: 79 (...)").
 */
function parseSpeakersHeaderLine(
  lineText: string,
  lineNumber: number,
  errors: ReadyScriptValidationError[]
): Map<string, ParsedSpeakerInfo> | null {
  const match = lineText.match(/^(?:спикеры|speakers|spikerlar)\s*[:—-]\s*(.+)$/i);
  if (!match) return null;

  const map = new Map<string, ParsedSpeakerInfo>();
  const speakersPart = match[1].split('|')[0].trim();
  const rawEntries = speakersPart
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (rawEntries.length === 0) {
    errors.push({
      line: lineNumber,
      message: `Строка ${lineNumber}: список «Спикеры:» пуст`,
    });
    return map;
  }

  let idx = 0;
  for (const entry of rawEntries) {
    const { name, gender } = splitNameAndInlineGender(entry);
    if (!name) {
      errors.push({
        line: lineNumber,
        message: `Строка ${lineNumber}: пустое имя спикера в «${entry}»`,
      });
      continue;
    }
    if (!gender) {
      errors.push({
        line: lineNumber,
        message: `Строка ${lineNumber}: у спикера «${name}» не указан пол (укажите (М) или (Ж))`,
      });
      continue;
    }
    if (idx >= 2) {
      errors.push({
        line: lineNumber,
        message: `Строка ${lineNumber}: поддерживается до 2 спикеров (HOST_1 и HOST_2), лишний спикер «${name}»`,
      });
      continue;
    }
    const speakerId: 'HOST_1' | 'HOST_2' = idx === 0 ? 'HOST_1' : 'HOST_2';
    map.set(normalizeSpeakerKey(name), {
      speakerId,
      name,
      gender,
    });
    idx += 1;
  }

  return map;
}

/**
 * RFC-4180 CSV parser preserving exact 1-based starting line number of each record.
 */
function parseCsvRecords(rawText: string, delimiter: ',' | ';'): Array<{ line: number; fields: string[] }> {
  const records: Array<{ line: number; fields: string[] }> = [];
  let fields: string[] = [];
  let current = '';
  let inQuotes = false;
  let line = 1;
  let recordStartLine = 1;
  let atRecordStart = true;

  for (let i = 0; i < rawText.length; i++) {
    const ch = rawText[i];
    if (atRecordStart && ch !== '\r' && ch !== '\n') {
      recordStartLine = line;
      atRecordStart = false;
    }

    if (inQuotes) {
      if (ch === '"') {
        if (rawText[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line += 1;
        current += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      fields.push(current);
      current = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && rawText[i + 1] === '\n') {
        i += 1;
      }
      fields.push(current);
      current = '';
      if (fields.some((f) => f.trim().length > 0)) {
        records.push({ line: recordStartLine, fields });
      }
      fields = [];
      line += 1;
      atRecordStart = true;
    } else {
      current += ch;
    }
  }

  if (current.length > 0 || fields.length > 0) {
    fields.push(current);
    if (fields.some((f) => f.trim().length > 0)) {
      records.push({ line: recordStartLine, fields });
    }
  }

  return records;
}

function detectFormat(cleanText: string): ReadyScriptFormat {
  const trimmed = cleanText.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return 'json';
  }

  // Check SRT: contains timecode arrow "-->"
  if (/^\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?\s*-->\s*\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?/m.test(trimmed)) {
    return 'srt';
  }

  // Check CSV header on first non-empty line
  const firstNonEmpty = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (firstNonEmpty && !firstNonEmpty.includes('|')) {
    const lower = firstNonEmpty.toLowerCase();
    const commaCols = lower.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const semiCols = lower.split(';').map((c) => c.trim().replace(/^"|"$/g, ''));
    const hasCsvCols = (cols: string[]) =>
      cols.length >= 4 &&
      cols.some((c) => ['start', 'startsec', 'start_sec', 'начало'].includes(c)) &&
      cols.some((c) => ['end', 'endsec', 'end_sec', 'конец'].includes(c)) &&
      cols.some((c) => ['text', 'текст', 'uz_text', 'text_uz'].includes(c));
    if (hasCsvCols(commaCols) || hasCsvCols(semiCols)) {
      return 'csv';
    }
  }

  return 'pipe';
}

function validateTurnSequence(
  turns: Array<{ turn: DialogueTurn; line: number }>,
  errors: ReadyScriptValidationError[]
): void {
  let prevEndSec: number | null = null;
  let prevLine: number | null = null;

  for (const item of turns) {
    const startSec = item.turn.startSec;
    const endSec = item.turn.endSec;

    if (typeof startSec !== 'number' || typeof endSec !== 'number' || !Number.isFinite(startSec) || !Number.isFinite(endSec)) {
      errors.push({
        line: item.line,
        message: `Строка ${item.line}: некорректный таймкод начала или конца`,
      });
      continue;
    }

    if (endSec <= startSec) {
      errors.push({
        line: item.line,
        message: `Строка ${item.line}: конец таймкода (${formatSecToTimecode(endSec)}) меньше или равен началу (${formatSecToTimecode(startSec)})`,
      });
    }

    if (prevEndSec !== null && startSec < prevEndSec - 0.001) {
      errors.push({
        line: item.line,
        message: `Строка ${item.line}: перекрытие с предыдущей строкой (строка ${prevLine}: конец ${formatSecToTimecode(prevEndSec)}, начало текущей ${formatSecToTimecode(startSec)})`,
      });
    }

    if (endSec > startSec) {
      prevEndSec = endSec;
      prevLine = item.line;
    }
  }
}

function parsePipeScript(cleanText: string): ReadyScriptParseResult {
  const lines = cleanText.split(/\r?\n/);
  const errors: ReadyScriptValidationError[] = [];
  const noSpeechIntervals: ReadyScriptNoSpeechInterval[] = [];
  const parsedItems: Array<{ turn: DialogueTurn; line: number }> = [];

  let declaredSpeakers: Map<string, ParsedSpeakerInfo> | null = null;
  const inferredSpeakers = new Map<string, ParsedSpeakerInfo>();
  let currentSceneTitle: string | undefined;

  const isTableHeaderRow = (cols: string[]) => {
    const joined = cols.map((c) => c.trim().toLowerCase()).join('|');
    return (
      (joined.includes('таймкод') || joined.includes('timecode') || joined.includes('время')) &&
      (joined.includes('спикер') || joined.includes('speaker'))
    );
  };

  const isMarkdownDividerRow = (line: string) => /^[\s|:-]+$/.test(line) && line.includes('-');

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Ignore markdown horizontal rules or pure divider rows
    if (/^[-_*]{3,}$/.test(trimmed) || isMarkdownDividerRow(trimmed)) continue;

    // Comments
    if (trimmed.startsWith('#') || trimmed.startsWith('//')) continue;

    // Speakers header line: "Спикеры: Азиз (М), Вероника (Ж)"
    if (/^(?:спикеры|speakers|spikerlar)\s*[:—-]/i.test(trimmed)) {
      const parsedMap = parseSpeakersHeaderLine(trimmed, lineNumber, errors);
      if (parsedMap) {
        declaredSpeakers = parsedMap;
      }
      continue;
    }

    // Scene header: "=== N-SAHNA ... ===" (also tolerates optional trailing ===)
    const sceneMatch = trimmed.match(/^={2,}\s*(.+?)\s*(?:={2,})?$/);
    if (sceneMatch) {
      currentSceneTitle = sceneMatch[1].trim() || undefined;
      continue;
    }

    // Standalone non-speech interval: "[ ... ]"
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      const inner = trimmed.slice(1, -1).trim();
      const tcMatch = inner.match(
        /^(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?\s*(?:–|—|-)\s*\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?(?:\s*\([^)]*\))?)\s*(?:[|—–-]\s*)?(.*)$/
      );
      if (tcMatch) {
        const range = parseTimecodeRange(tcMatch[1]);
        if (range) {
          if (range.endSec <= range.startSec) {
            errors.push({
              line: lineNumber,
              message: `Строка ${lineNumber}: в интервале без речи конец (${range.endRaw}) меньше или равен началу (${range.startRaw})`,
            });
          } else {
            noSpeechIntervals.push({
              timecode: `${formatSecToTimecode(range.startSec)}–${formatSecToTimecode(range.endSec)}`,
              startSec: range.startSec,
              endSec: range.endSec,
              durationSec: Math.round((range.endSec - range.startSec) * 1000) / 1000,
              description: tcMatch[2].trim() || 'Без слов',
            });
          }
          continue;
        }
      }
      noSpeechIntervals.push({
        timecode: '',
        startSec: 0,
        endSec: 0,
        durationSec: 0,
        description: inner || 'Без слов',
      });
      continue;
    }

    // Pipe-delimited row
    if (trimmed.includes('|')) {
      // Strip optional leading/trailing markdown table pipes
      let rowContent = trimmed;
      if (rowContent.startsWith('|')) rowContent = rowContent.slice(1);
      if (rowContent.endsWith('|')) rowContent = rowContent.slice(0, -1);

      const cols = rowContent.split('|');
      if (isTableHeaderRow(cols)) continue;

      const col0 = (cols[0] ?? '').trim();
      const col1 = (cols[1] ?? '').trim();

      // Check if this pipe row represents a non-speech interval, e.g.:
      // "00:00–00:05 (5s) | [музыка]" or "00:00–00:05 | — | — | — | [тишина]"
      const bracketedCol = cols.slice(1).find((c) => {
        const t = c.trim();
        return t.startsWith('[') && t.endsWith(']');
      });
      if (bracketedCol && (cols.length <= 2 || col1.startsWith('[') || col1 === '—' || col1 === '-' || col1 === '')) {
        const range = parseTimecodeRange(col0);
        if (range) {
          if (range.endSec <= range.startSec) {
            errors.push({
              line: lineNumber,
              message: `Строка ${lineNumber}: конец таймкода (${range.endRaw}) меньше или равен началу (${range.startRaw})`,
            });
          } else {
            noSpeechIntervals.push({
              timecode: `${formatSecToTimecode(range.startSec)}–${formatSecToTimecode(range.endSec)}`,
              startSec: range.startSec,
              endSec: range.endSec,
              durationSec: Math.round((range.endSec - range.startSec) * 1000) / 1000,
              description: bracketedCol.trim().slice(1, -1).trim() || 'Без слов',
            });
          }
          continue;
        }
      }

      const range = parseTimecodeRange(col0);
      if (!range) {
        errors.push({
          line: lineNumber,
          message: `Строка ${lineNumber}: неверный формат таймкода «${col0}» (ожидается ММ:СС–ММ:СС)`,
        });
        continue;
      }

      // Resolve speaker
      const { name: rawSpeakerName, gender: inlineGender } = splitNameAndInlineGender(col1);
      if (!rawSpeakerName) {
        errors.push({
          line: lineNumber,
          message: `Строка ${lineNumber}: не указан спикер`,
        });
        continue;
      }

      const speakerKey = normalizeSpeakerKey(rawSpeakerName);
      let speakerInfo: ParsedSpeakerInfo | undefined;

      if (declaredSpeakers) {
        speakerInfo = declaredSpeakers.get(speakerKey);
        if (!speakerInfo) {
          errors.push({
            line: lineNumber,
            message: `Строка ${lineNumber}: спикер «${rawSpeakerName}» отсутствует в списке «Спикеры»`,
          });
          continue;
        }
      } else {
        speakerInfo = inferredSpeakers.get(speakerKey);
        if (!speakerInfo) {
          if (!inlineGender) {
            errors.push({
              line: lineNumber,
              message: `Строка ${lineNumber}: у спикера «${rawSpeakerName}» не указан пол (добавьте строку «Спикеры: ${rawSpeakerName} (М/Ж), ...»)`,
            });
            continue;
          }
          if (inferredSpeakers.size >= 2) {
            errors.push({
              line: lineNumber,
              message: `Строка ${lineNumber}: обнаружено больше 2 спикеров («${rawSpeakerName}»)`,
            });
            continue;
          }
          const speakerId: 'HOST_1' | 'HOST_2' = inferredSpeakers.size === 0 ? 'HOST_1' : 'HOST_2';
          speakerInfo = {
            speakerId,
            name: rawSpeakerName,
            gender: inlineGender,
          };
          inferredSpeakers.set(speakerKey, speakerInfo);
        }
      }

      // Columns:
      // 0: timecode
      // 1: speaker
      // 2: rhythm (pace)
      // 3: delivery/style (intonationRu)
      // 4: Uzbek text (VERBATIM)
      // 5: Russian original (optional)
      const pace = parsePaceToken(cols[2]);
      const intonationRu = (cols[3] ?? '').trim() || undefined;
      const uzText = (cols[4] ?? '').trim();
      const originalTextRu = (cols[5] ?? '').trim() || undefined;

      if (!uzText) {
        errors.push({
          line: lineNumber,
          message: `Строка ${lineNumber}: пустой узбекский текст реплики`,
        });
        continue;
      }

      const durationSec = Math.round((range.endSec - range.startSec) * 1000) / 1000;
      const timecode = `${formatSecToTimecode(range.startSec)}–${formatSecToTimecode(range.endSec)}`;

      parsedItems.push({
        line: lineNumber,
        turn: {
          id: `turn-import-${parsedItems.length + 1}`,
          speakerId: speakerInfo.speakerId,
          speakerName: speakerInfo.name,
          speakerGender: speakerInfo.gender,
          text: uzText,
          originalText: originalTextRu,
          originalTextRu,
          intonationRu,
          speechStyle: intonationRu,
          pace,
          sceneTitle: currentSceneTitle,
          chapter: currentSceneTitle,
          timecode,
          startSec: range.startSec,
          endSec: range.endSec,
          durationSec,
        },
      });
      continue;
    }

    // Non-pipe line starting with a timecode-like pattern -> likely malformed row
    if (/^\d{1,2}:\d{2}/.test(trimmed)) {
      errors.push({
        line: lineNumber,
        message: `Строка ${lineNumber}: строка с таймкодом не содержит разделителей «|»`,
      });
    }
  }

  validateTurnSequence(parsedItems, errors);

  const speakersMap = declaredSpeakers ?? inferredSpeakers;
  const speakers = Array.from(speakersMap.values()).sort((a, b) =>
    a.speakerId === 'HOST_1' ? -1 : b.speakerId === 'HOST_1' ? 1 : 0
  );

  if (parsedItems.length === 0 && errors.length === 0) {
    errors.push({
      line: 1,
      message: 'Строка 1: не найдено ни одной реплики в сценарии',
    });
  }

  const turns = parsedItems.map((p) => p.turn);
  const totalDurationSec = Math.max(
    0,
    ...turns.map((t) => Number(t.endSec) || 0),
    ...noSpeechIntervals.map((n) => Number(n.endSec) || 0)
  );

  return {
    ok: errors.length === 0,
    format: 'pipe',
    speakers,
    turns: errors.length === 0 ? turns : [],
    noSpeechIntervals: errors.length === 0 ? noSpeechIntervals : [],
    totalDurationSec: errors.length === 0 ? totalDurationSec : 0,
    errors,
  };
}

function estimateJsonTurnLineNumbers(rawText: string, count: number): number[] {
  const lines = rawText.split(/\r?\n/);
  const turnStartLines: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/"(?:speakerId|speakerName|startSec|timecode|text)"\s*:/.test(lines[i])) {
      // Heuristic: find opening brace above
      let braceLine = i + 1;
      for (let j = i; j >= 0; j--) {
        if (lines[j].includes('{')) {
          braceLine = j + 1;
          break;
        }
      }
      if (turnStartLines.length === 0 || turnStartLines[turnStartLines.length - 1] !== braceLine) {
        turnStartLines.push(braceLine);
      }
    }
  }
  const result: number[] = [];
  for (let idx = 0; idx < count; idx++) {
    result.push(turnStartLines[idx] ?? idx + 1);
  }
  return result;
}

function parseJsonScript(cleanText: string): ReadyScriptParseResult {
  const errors: ReadyScriptValidationError[] = [];
  let parsed: any;
  try {
    parsed = JSON.parse(cleanText);
  } catch (err: any) {
    errors.push({
      line: 1,
      message: `Строка 1: ошибка разбора JSON (${err?.message || 'некорректный JSON'})`,
    });
    return {
      ok: false,
      format: 'json',
      speakers: [],
      turns: [],
      noSpeechIntervals: [],
      totalDurationSec: 0,
      errors,
    };
  }

  const rawTurns: any[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.turns)
    ? parsed.turns
    : [];
  const rawSpeakers: any[] = !Array.isArray(parsed) && Array.isArray(parsed?.speakers) ? parsed.speakers : [];
  const rawNoSpeech: ReadyScriptNoSpeechInterval[] =
    !Array.isArray(parsed) && Array.isArray(parsed?.noSpeechIntervals)
      ? parsed.noSpeechIntervals.map((ns: any) => ({
          timecode: String(ns.timecode || ''),
          startSec: Number(ns.startSec) || 0,
          endSec: Number(ns.endSec) || 0,
          durationSec: Number(ns.durationSec) || 0,
          description: String(ns.description || 'Без слов'),
        }))
      : [];

  if (rawTurns.length === 0) {
    errors.push({
      line: 1,
      message: 'Строка 1: в JSON не найдено ни одной реплики (ожидается массив DialogueTurn или объект { turns: [...] })',
    });
    return {
      ok: false,
      format: 'json',
      speakers: [],
      turns: [],
      noSpeechIntervals: [],
      totalDurationSec: 0,
      errors,
    };
  }

  const declaredByKey = new Map<string, ParsedSpeakerInfo>();
  const declaredById = new Map<'HOST_1' | 'HOST_2', ParsedSpeakerInfo>();
  for (let i = 0; i < rawSpeakers.length; i++) {
    const sp = rawSpeakers[i];
    const name = String(sp?.name || '').trim();
    const gender = parseGenderToken(sp?.gender);
    const spId: 'HOST_1' | 'HOST_2' = sp?.speakerId === 'HOST_2' || i === 1 ? 'HOST_2' : 'HOST_1';
    if (!name || !gender) {
      errors.push({
        line: 1,
        message: `Строка 1: в списке speakers у спикера «${name || spId}» не указан пол (male/female)`,
      });
      continue;
    }
    const baseStyle =
      typeof sp?.baseStyle === 'string' && sp.baseStyle.trim()
        ? sp.baseStyle.trim()
        : undefined;
    const info: ParsedSpeakerInfo = {
      speakerId: spId,
      name,
      gender,
      ...(baseStyle ? { baseStyle } : {}),
    };
    declaredByKey.set(normalizeSpeakerKey(name), info);
    declaredById.set(spId, info);
  }

  const inferredByKey = new Map<string, ParsedSpeakerInfo>();
  const inferredById = new Map<'HOST_1' | 'HOST_2', ParsedSpeakerInfo>();
  const lineNumbers = estimateJsonTurnLineNumbers(cleanText, rawTurns.length);
  const parsedItems: Array<{ turn: DialogueTurn; line: number }> = [];

  for (let idx = 0; idx < rawTurns.length; idx++) {
    const item = rawTurns[idx];
    const lineNumber = lineNumbers[idx] || idx + 1;

    if (!item || typeof item !== 'object') {
      errors.push({
        line: lineNumber,
        message: `Строка ${lineNumber}: элемент #${idx + 1} не является объектом реплики`,
      });
      continue;
    }

    let startSec = parseTimecodeToSec(item.startSec ?? item.start);
    let endSec = parseTimecodeToSec(item.endSec ?? item.end);
    if ((startSec === null || endSec === null) && typeof item.timecode === 'string') {
      const range = parseTimecodeRange(item.timecode);
      if (range) {
        startSec = startSec ?? range.startSec;
        endSec = endSec ?? range.endSec;
      }
    }

    if (startSec === null || endSec === null) {
      errors.push({
        line: lineNumber,
        message: `Строка ${lineNumber}: не указаны или некорректны startSec / endSec`,
      });
      continue;
    }

    const rawText = typeof item.text === 'string' ? item.text : '';
    if (!rawText.trim()) {
      errors.push({
        line: lineNumber,
        message: `Строка ${lineNumber}: пустой текст реплики`,
      });
      continue;
    }

    const rawSpeakerName = String(item.speakerName ?? item.speaker ?? '').trim();
    const rawSpeakerId: 'HOST_1' | 'HOST_2' | null =
      item.speakerId === 'HOST_1' || item.speakerId === 'HOST_2' ? item.speakerId : null;
    const rawGender = parseGenderToken(item.speakerGender ?? item.gender);

    let speakerInfo: ParsedSpeakerInfo | undefined;
    if (declaredByKey.size > 0) {
      speakerInfo =
        (rawSpeakerName ? declaredByKey.get(normalizeSpeakerKey(rawSpeakerName)) : undefined) ||
        (rawSpeakerId ? declaredById.get(rawSpeakerId) : undefined);
      if (!speakerInfo) {
        errors.push({
          line: lineNumber,
          message: `Строка ${lineNumber}: спикер «${rawSpeakerName || rawSpeakerId || '—'}» отсутствует в списке speakers`,
        });
        continue;
      }
    } else {
      const key = rawSpeakerName ? normalizeSpeakerKey(rawSpeakerName) : rawSpeakerId || '';
      speakerInfo =
        (key ? inferredByKey.get(key) : undefined) ||
        (rawSpeakerId ? inferredById.get(rawSpeakerId) : undefined);

      if (!speakerInfo) {
        if (!rawGender) {
          errors.push({
            line: lineNumber,
            message: `Строка ${lineNumber}: у спикера «${rawSpeakerName || rawSpeakerId || '—'}» не указан пол (speakerGender / gender)`,
          });
          continue;
        }
        const assignedId: 'HOST_1' | 'HOST_2' =
          rawSpeakerId || (inferredById.has('HOST_1') ? 'HOST_2' : 'HOST_1');
        if (!rawSpeakerId && inferredByKey.size >= 2) {
          errors.push({
            line: lineNumber,
            message: `Строка ${lineNumber}: обнаружено более 2 спикеров («${rawSpeakerName}»)`,
          });
          continue;
        }
        const resolvedName = rawSpeakerName || (assignedId === 'HOST_1' ? 'Спикер 1' : 'Спикер 2');
        speakerInfo = {
          speakerId: assignedId,
          name: resolvedName,
          gender: rawGender,
        };
        inferredByKey.set(normalizeSpeakerKey(resolvedName), speakerInfo);
        inferredById.set(assignedId, speakerInfo);
      }
    }

    const durationSec = Math.round((endSec - startSec) * 1000) / 1000;
    const timecode =
      typeof item.timecode === 'string' && item.timecode.trim()
        ? item.timecode.trim()
        : `${formatSecToTimecode(startSec)}–${formatSecToTimecode(endSec)}`;

    const syncStatus: DialogueTurn['syncStatus'] =
      item.syncStatus === 'ok' || item.syncStatus === 'adjusted' || item.syncStatus === 'overflow'
        ? item.syncStatus
        : undefined;

    const intonationRu =
      typeof item.intonationRu === 'string' && item.intonationRu.trim()
        ? item.intonationRu.trim()
        : typeof item.style === 'string' && item.style.trim()
        ? item.style.trim()
        : undefined;

    const originalTextRu =
      typeof item.originalTextRu === 'string' && item.originalTextRu.trim()
        ? item.originalTextRu.trim()
        : typeof item.originalText === 'string' && item.originalText.trim()
        ? item.originalText.trim()
        : undefined;

    const sceneTitle =
      typeof item.sceneTitle === 'string' && item.sceneTitle.trim()
        ? item.sceneTitle.trim()
        : typeof item.chapter === 'string' && item.chapter.trim()
        ? item.chapter.trim()
        : undefined;

    parsedItems.push({
      line: lineNumber,
      turn: {
        id: typeof item.id === 'string' && item.id.trim() ? item.id : `turn-import-${idx + 1}`,
        speakerId: speakerInfo.speakerId,
        speakerName: speakerInfo.name,
        speakerGender: rawGender || speakerInfo.gender,
        text: rawText,
        originalText: originalTextRu,
        originalTextRu,
        intonationRu,
        speechStyle: intonationRu,
        pace: parsePaceToken(typeof item.pace === 'string' ? item.pace : undefined),
        sceneTitle,
        chapter: sceneTitle,
        timecode,
        startSec,
        endSec,
        durationSec,
        syncStatus,
      },
    });
  }

  validateTurnSequence(parsedItems, errors);

  const speakersMap = declaredById.size > 0 ? declaredById : inferredById;
  const speakers = Array.from(speakersMap.values()).sort((a, b) =>
    a.speakerId === 'HOST_1' ? -1 : b.speakerId === 'HOST_1' ? 1 : 0
  );

  const turns = parsedItems.map((p) => p.turn);
  const totalDurationSec = Math.max(
    0,
    ...turns.map((t) => Number(t.endSec) || 0),
    ...rawNoSpeech.map((n) => Number(n.endSec) || 0)
  );

  const useDeliveryEmotions =
    !Array.isArray(parsed) && typeof parsed?.useDeliveryEmotions === 'boolean'
      ? parsed.useDeliveryEmotions
      : undefined;
  const pronunciationDictionary =
    !Array.isArray(parsed) && Array.isArray(parsed?.pronunciationDictionary)
      ? normalizePronunciationDictionary(parsed.pronunciationDictionary)
      : undefined;

  return {
    ok: errors.length === 0,
    format: 'json',
    speakers,
    turns: errors.length === 0 ? turns : [],
    noSpeechIntervals: errors.length === 0 ? rawNoSpeech : [],
    totalDurationSec: errors.length === 0 ? totalDurationSec : 0,
    errors,
    ...(useDeliveryEmotions !== undefined ? { useDeliveryEmotions } : {}),
    ...(pronunciationDictionary !== undefined ? { pronunciationDictionary } : {}),
  };
}

function parseCsvScript(cleanText: string): ReadyScriptParseResult {
  const errors: ReadyScriptValidationError[] = [];
  const firstLine =
    cleanText
      .split(/\r?\n/)
      .find((l) => l.trim().length > 0) || '';
  const delimiter: ',' | ';' =
    firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';

  const records = parseCsvRecords(cleanText, delimiter);
  if (records.length < 2) {
    errors.push({
      line: 1,
      message: 'Строка 1: CSV не содержит строк с репликами',
    });
    return {
      ok: false,
      format: 'csv',
      speakers: [],
      turns: [],
      noSpeechIntervals: [],
      totalDurationSec: 0,
      errors,
    };
  }

  const headerCols = records[0].fields.map((h) => h.trim().toLowerCase());
  const findCol = (aliases: string[]) => headerCols.findIndex((h) => aliases.includes(h));

  const idxStart = findCol(['start', 'startsec', 'start_sec', 'начало']);
  const idxEnd = findCol(['end', 'endsec', 'end_sec', 'конец']);
  const idxSpeaker = findCol(['speaker', 'speakername', 'speaker_name', 'спикер']);
  const idxGender = findCol(['gender', 'speakergender', 'speaker_gender', 'пол']);
  const idxText = findCol(['text', 'текст', 'uz_text', 'text_uz']);
  const idxStyle = findCol(['style', 'intonationru', 'intonation_ru', 'подача', 'интонация']);
  const idxSpeakerId = findCol(['speakerid', 'speaker_id']);
  const idxOriginalRu = findCol(['originaltextru', 'original_text_ru', 'original_ru', 'original']);
  const idxSyncStatus = findCol(['syncstatus', 'sync_status']);
  const idxSceneTitle = findCol(['scenetitle', 'scene_title', 'chapter', 'сцена']);
  const idxPace = findCol(['pace', 'rhythm', 'ритм']);

  if (idxStart < 0 || idxEnd < 0 || idxSpeaker < 0 || idxText < 0) {
    errors.push({
      line: records[0].line,
      message: `Строка ${records[0].line}: в заголовке CSV требуются колонки start, end, speaker, gender, text, style`,
    });
    return {
      ok: false,
      format: 'csv',
      speakers: [],
      turns: [],
      noSpeechIntervals: [],
      totalDurationSec: 0,
      errors,
    };
  }

  const speakersByKey = new Map<string, ParsedSpeakerInfo>();
  const speakersById = new Map<'HOST_1' | 'HOST_2', ParsedSpeakerInfo>();
  const parsedItems: Array<{ turn: DialogueTurn; line: number }> = [];

  for (let r = 1; r < records.length; r++) {
    const rec = records[r];
    const lineNumber = rec.line;
    const get = (idx: number) => (idx >= 0 && idx < rec.fields.length ? rec.fields[idx] : '');

    const startRaw = get(idxStart).trim();
    const endRaw = get(idxEnd).trim();
    const startSec = parseTimecodeToSec(startRaw);
    const endSec = parseTimecodeToSec(endRaw);

    if (startSec === null || endSec === null) {
      errors.push({
        line: lineNumber,
        message: `Строка ${lineNumber}: неверный таймкод start=«${startRaw}», end=«${endRaw}»`,
      });
      continue;
    }

    const rawSpeakerField = get(idxSpeaker).trim();
    const { name: speakerName, gender: inlineGender } = splitNameAndInlineGender(rawSpeakerField);
    if (!speakerName) {
      errors.push({
        line: lineNumber,
        message: `Строка ${lineNumber}: не указан спикер`,
      });
      continue;
    }

    const genderCell = idxGender >= 0 ? get(idxGender).trim() : '';
    const gender = parseGenderToken(genderCell) || inlineGender;

    const speakerKey = normalizeSpeakerKey(speakerName);
    let speakerInfo = speakersByKey.get(speakerKey);
    if (!speakerInfo) {
      if (!gender) {
        errors.push({
          line: lineNumber,
          message: `Строка ${lineNumber}: у спикера «${speakerName}» не указан пол (M/F или М/Ж)`,
        });
        continue;
      }
      const explicitId = get(idxSpeakerId).trim().toUpperCase();
      const assignedId: 'HOST_1' | 'HOST_2' =
        explicitId === 'HOST_1' || explicitId === 'HOST_2'
          ? (explicitId as 'HOST_1' | 'HOST_2')
          : speakersByKey.size === 0
          ? 'HOST_1'
          : 'HOST_2';

      if (speakersByKey.size >= 2 && !(explicitId === 'HOST_1' || explicitId === 'HOST_2')) {
        errors.push({
          line: lineNumber,
          message: `Строка ${lineNumber}: обнаружено более 2 спикеров («${speakerName}»)`,
        });
        continue;
      }

      speakerInfo = {
        speakerId: assignedId,
        name: speakerName,
        gender,
      };
      speakersByKey.set(speakerKey, speakerInfo);
      speakersById.set(assignedId, speakerInfo);
    }

    const uzText = get(idxText);
    if (!uzText.trim()) {
      errors.push({
        line: lineNumber,
        message: `Строка ${lineNumber}: пустой текст реплики`,
      });
      continue;
    }

    const style = get(idxStyle).trim() || undefined;
    const originalTextRu = get(idxOriginalRu).trim() || undefined;
    const rawSync = get(idxSyncStatus).trim();
    const syncStatus: DialogueTurn['syncStatus'] =
      rawSync === 'ok' || rawSync === 'adjusted' || rawSync === 'overflow' ? rawSync : undefined;
    const sceneTitle = get(idxSceneTitle).trim() || undefined;
    const pace = parsePaceToken(get(idxPace));

    const durationSec = Math.round((endSec - startSec) * 1000) / 1000;
    const timecode = `${formatSecToTimecode(startSec)}–${formatSecToTimecode(endSec)}`;

    parsedItems.push({
      line: lineNumber,
      turn: {
        id: `turn-import-${parsedItems.length + 1}`,
        speakerId: speakerInfo.speakerId,
        speakerName: speakerInfo.name,
        speakerGender: gender || speakerInfo.gender,
        text: uzText,
        originalText: originalTextRu,
        originalTextRu,
        intonationRu: style,
        speechStyle: style,
        pace,
        sceneTitle,
        chapter: sceneTitle,
        timecode,
        startSec,
        endSec,
        durationSec,
        syncStatus,
      },
    });
  }

  validateTurnSequence(parsedItems, errors);

  const speakers = Array.from(speakersById.values()).sort((a, b) =>
    a.speakerId === 'HOST_1' ? -1 : b.speakerId === 'HOST_1' ? 1 : 0
  );
  const turns = parsedItems.map((p) => p.turn);
  const totalDurationSec = Math.max(0, ...turns.map((t) => Number(t.endSec) || 0));

  return {
    ok: errors.length === 0,
    format: 'csv',
    speakers,
    turns: errors.length === 0 ? turns : [],
    noSpeechIntervals: [],
    totalDurationSec: errors.length === 0 ? totalDurationSec : 0,
    errors,
  };
}

function parseSrtScript(cleanText: string): ReadyScriptParseResult {
  const lines = cleanText.split(/\r?\n/);
  const errors: ReadyScriptValidationError[] = [];
  const parsedItems: Array<{ turn: DialogueTurn; line: number }> = [];

  let declaredSpeakers: Map<string, ParsedSpeakerInfo> | null = null;
  const inferredSpeakers = new Map<string, ParsedSpeakerInfo>();

  let i = 0;
  while (i < lines.length) {
    const lineNumber = i + 1;
    const trimmed = lines[i].trim();
    if (!trimmed) {
      i += 1;
      continue;
    }

    // Optional top header: "Спикеры: Азиз (М), Вероника (Ж)"
    if (/^(?:спикеры|speakers|spikerlar)\s*[:—-]/i.test(trimmed)) {
      const parsedMap = parseSpeakersHeaderLine(trimmed, lineNumber, errors);
      if (parsedMap) {
        declaredSpeakers = parsedMap;
      }
      i += 1;
      continue;
    }

    // Optional numeric cue index before timecode arrow line
    let tcLineIdx = i;
    if (/^\d+$/.test(trimmed) && i + 1 < lines.length && lines[i + 1].includes('-->')) {
      tcLineIdx = i + 1;
    }

    const tcLineNum = tcLineIdx + 1;
    const tcLine = lines[tcLineIdx]?.trim() || '';
    const range = parseSrtTimecodeRange(tcLine);
    if (!range) {
      errors.push({
        line: tcLineNum,
        message: `Строка ${tcLineNum}: неверный SRT-таймкод «${tcLine}»`,
      });
      i = tcLineIdx + 1;
      continue;
    }

    // Collect cue text lines until blank line
    const textLines: string[] = [];
    let nextIdx = tcLineIdx + 1;
    while (nextIdx < lines.length && lines[nextIdx].trim() !== '') {
      textLines.push(lines[nextIdx]);
      nextIdx += 1;
    }

    const combinedText = textLines.join(' ').trim();
    const cueTextLineNum = tcLineIdx + 2;
    const speakerPrefixMatch = combinedText.match(/^([^:]{1,60}):\s*(.*)$/);
    if (!speakerPrefixMatch) {
      errors.push({
        line: cueTextLineNum,
        message: `Строка ${cueTextLineNum}: SRT-текст должен начинаться с «Спикер: текст»`,
      });
      i = nextIdx + 1;
      continue;
    }

    const { name: rawSpeakerName, gender: inlineGender } = splitNameAndInlineGender(speakerPrefixMatch[1]);
    const spokenText = speakerPrefixMatch[2].trim();

    if (!spokenText) {
      errors.push({
        line: cueTextLineNum,
        message: `Строка ${cueTextLineNum}: пустой текст реплики после имени спикера «${rawSpeakerName}»`,
      });
      i = nextIdx + 1;
      continue;
    }

    const speakerKey = normalizeSpeakerKey(rawSpeakerName);
    let speakerInfo: ParsedSpeakerInfo | undefined;

    if (declaredSpeakers) {
      speakerInfo = declaredSpeakers.get(speakerKey);
      if (!speakerInfo) {
        errors.push({
          line: cueTextLineNum,
          message: `Строка ${cueTextLineNum}: спикер «${rawSpeakerName}» отсутствует в списке «Спикеры»`,
        });
        i = nextIdx + 1;
        continue;
      }
    } else {
      speakerInfo = inferredSpeakers.get(speakerKey);
      if (!speakerInfo) {
        if (!inlineGender) {
          errors.push({
            line: cueTextLineNum,
            message: `Строка ${cueTextLineNum}: у спикера «${rawSpeakerName}» не указан пол (добавьте «Спикеры: ${rawSpeakerName} (М/Ж)» в начало файла или укажите «${rawSpeakerName} (М): ...»)`,
          });
          i = nextIdx + 1;
          continue;
        }
        if (inferredSpeakers.size >= 2) {
          errors.push({
            line: cueTextLineNum,
            message: `Строка ${cueTextLineNum}: обнаружено более 2 спикеров («${rawSpeakerName}»)`,
          });
          i = nextIdx + 1;
          continue;
        }
        const speakerId: 'HOST_1' | 'HOST_2' = inferredSpeakers.size === 0 ? 'HOST_1' : 'HOST_2';
        speakerInfo = {
          speakerId,
          name: rawSpeakerName,
          gender: inlineGender,
        };
        inferredSpeakers.set(speakerKey, speakerInfo);
      }
    }

    const durationSec = Math.round((range.endSec - range.startSec) * 1000) / 1000;
    const timecode = `${formatSecToTimecode(range.startSec)}–${formatSecToTimecode(range.endSec)}`;

    parsedItems.push({
      line: tcLineNum,
      turn: {
        id: `turn-import-${parsedItems.length + 1}`,
        speakerId: speakerInfo.speakerId,
        speakerName: speakerInfo.name,
        speakerGender: speakerInfo.gender,
        text: spokenText,
        timecode,
        startSec: range.startSec,
        endSec: range.endSec,
        durationSec,
      },
    });

    i = nextIdx + 1;
  }

  validateTurnSequence(parsedItems, errors);

  const speakersMap = declaredSpeakers ?? inferredSpeakers;
  const speakers = Array.from(speakersMap.values()).sort((a, b) =>
    a.speakerId === 'HOST_1' ? -1 : b.speakerId === 'HOST_1' ? 1 : 0
  );

  if (parsedItems.length === 0 && errors.length === 0) {
    errors.push({
      line: 1,
      message: 'Строка 1: в SRT не найдено ни одной реплики',
    });
  }

  const turns = parsedItems.map((p) => p.turn);
  const totalDurationSec = Math.max(0, ...turns.map((t) => Number(t.endSec) || 0));

  return {
    ok: errors.length === 0,
    format: 'srt',
    speakers,
    turns: errors.length === 0 ? turns : [],
    noSpeechIntervals: [],
    totalDurationSec: errors.length === 0 ? totalDurationSec : 0,
    errors,
  };
}

/**
 * Pure, synchronous, zero-LLM / zero-network parser for ready dubbing scripts.
 * Supports:
 *  a) Pipe-delimited storyboard text ("MM:SS–MM:SS (Ns) | Спикер | ритм | подача | узбекский текст | русский оригинал")
 *  b) JSON array of DialogueTurn or exported object { speakers, turns, noSpeechIntervals }
 *  c) CSV (start,end,speaker,gender,text,style,...)
 *  d) SRT with "Спикер: текст" lines
 */
export function parseReadyScript(text: string): ReadyScriptParseResult {
  const cleanText = (text || '').replace(/^\uFEFF/, '');
  if (!cleanText.trim()) {
    return {
      ok: false,
      speakers: [],
      turns: [],
      noSpeechIntervals: [],
      totalDurationSec: 0,
      errors: [{ line: 1, message: 'Строка 1: текст сценария пуст' }],
    };
  }

  const format = detectFormat(cleanText);
  switch (format) {
    case 'json':
      return parseJsonScript(cleanText);
    case 'csv':
      return parseCsvScript(cleanText);
    case 'srt':
      return parseSrtScript(cleanText);
    case 'pipe':
    default:
      return parsePipeScript(cleanText);
  }
}

function resolveTurnTimeBounds(turn: DialogueTurn): { startSec: number; endSec: number } {
  let startSec = typeof turn.startSec === 'number' && Number.isFinite(turn.startSec) ? turn.startSec : null;
  let endSec = typeof turn.endSec === 'number' && Number.isFinite(turn.endSec) ? turn.endSec : null;
  if ((startSec === null || endSec === null) && turn.timecode) {
    const range = parseTimecodeRange(turn.timecode);
    if (range) {
      startSec = startSec ?? range.startSec;
      endSec = endSec ?? range.endSec;
    }
  }
  const safeStart = startSec ?? 0;
  const safeEnd = endSec ?? safeStart + (typeof turn.durationSec === 'number' && turn.durationSec > 0 ? turn.durationSec : 2);
  return { startSec: safeStart, endSec: safeEnd };
}

function resolveSpeakerGenderForExport(
  turn: DialogueTurn,
  speakers?: ParsedSpeakerInfo[]
): 'male' | 'female' {
  if (turn.speakerGender === 'male' || turn.speakerGender === 'female') {
    return turn.speakerGender;
  }
  const match = speakers?.find((s) => s.speakerId === turn.speakerId);
  if (match) return match.gender;
  return turn.speakerId === 'HOST_2' ? 'male' : 'female';
}

function resolveSpeakerNameForExport(
  turn: DialogueTurn,
  speakers?: ParsedSpeakerInfo[]
): string {
  if (turn.speakerName && turn.speakerName.trim()) return turn.speakerName.trim();
  const match = speakers?.find((s) => s.speakerId === turn.speakerId);
  if (match) return match.name;
  return turn.speakerId === 'HOST_2' ? 'Спикер 2' : 'Спикер 1';
}

/**
 * Export turns table to JSON (preserving edits & syncStatus, strictly WITHOUT audio data).
 */
export interface JsonExportProjectSettings {
  useDeliveryEmotions?: boolean;
  pronunciationDictionary?: PronunciationDictionaryEntry[];
}

export function exportTurnsToJson(
  turns: DialogueTurn[],
  speakers?: ParsedSpeakerInfo[],
  noSpeechIntervals: ReadyScriptNoSpeechInterval[] = [],
  projectSettings?: JsonExportProjectSettings
): string {
  const sanitizedTurns = turns.map((turn, idx) => {
    const { startSec, endSec } = resolveTurnTimeBounds(turn);
    const durationSec = Math.round((endSec - startSec) * 1000) / 1000;
    const speakerName = resolveSpeakerNameForExport(turn, speakers);
    const speakerGender = resolveSpeakerGenderForExport(turn, speakers);
    const out: Record<string, any> = {
      id: turn.id || `turn-${idx + 1}`,
      speakerId: turn.speakerId || 'HOST_1',
      speakerName,
      speakerGender,
      timecode: turn.timecode || `${formatSecToTimecode(startSec)}–${formatSecToTimecode(endSec)}`,
      startSec,
      endSec,
      durationSec,
      text: turn.text ?? '',
    };
    if (turn.intonationRu) out.intonationRu = turn.intonationRu;
    if (turn.originalTextRu || turn.originalText) {
      out.originalTextRu = turn.originalTextRu || turn.originalText;
    }
    if (turn.pace) out.pace = turn.pace;
    if (turn.sceneTitle || turn.chapter) {
      out.sceneTitle = turn.sceneTitle || turn.chapter;
    }
    if (turn.syncStatus) out.syncStatus = turn.syncStatus;
    return out;
  });

  const resolvedSpeakers: ParsedSpeakerInfo[] =
    speakers && speakers.length > 0
      ? speakers.map((s) => ({
          speakerId: s.speakerId,
          name: s.name,
          gender: s.gender,
          ...(s.baseStyle && s.baseStyle.trim() ? { baseStyle: s.baseStyle.trim() } : {}),
        }))
      : Array.from(
          new Map(
            sanitizedTurns.map((t) => [
              t.speakerId,
              {
                speakerId: (t.speakerId === 'HOST_2' ? 'HOST_2' : 'HOST_1') as 'HOST_1' | 'HOST_2',
                name: t.speakerName,
                gender: t.speakerGender as 'male' | 'female',
              },
            ])
          ).values()
        );

  const exportPayload: Record<string, any> = {
    speakers: resolvedSpeakers,
    turns: sanitizedTurns,
    noSpeechIntervals: noSpeechIntervals.map((ns) => ({
      timecode: ns.timecode,
      startSec: ns.startSec,
      endSec: ns.endSec,
      durationSec: ns.durationSec,
      description: ns.description,
    })),
  };

  if (typeof projectSettings?.useDeliveryEmotions === 'boolean') {
    exportPayload.useDeliveryEmotions = projectSettings.useDeliveryEmotions;
  }
  if (Array.isArray(projectSettings?.pronunciationDictionary)) {
    exportPayload.pronunciationDictionary = normalizePronunciationDictionary(
      projectSettings.pronunciationDictionary
    );
  }

  return JSON.stringify(exportPayload, null, 2);
}

function escapeCsvCell(value: string | number | undefined | null): string {
  const str = value === undefined || value === null ? '' : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Export turns table to CSV (start,end,speaker,gender,text,style,...),
 * preserving manual edits and syncStatus, strictly WITHOUT audio data.
 */
export function exportTurnsToCsv(
  turns: DialogueTurn[],
  speakers?: ParsedSpeakerInfo[]
): string {
  const header = [
    'start',
    'end',
    'speaker',
    'gender',
    'text',
    'style',
    'speakerId',
    'originalTextRu',
    'syncStatus',
    'sceneTitle',
    'pace',
  ];

  const rows = [header.join(',')];
  for (const turn of turns) {
    const { startSec, endSec } = resolveTurnTimeBounds(turn);
    const speakerName = resolveSpeakerNameForExport(turn, speakers);
    const speakerGender = resolveSpeakerGenderForExport(turn, speakers);
    const row = [
      formatSecToTimecode(startSec),
      formatSecToTimecode(endSec),
      speakerName,
      speakerGender,
      turn.text ?? '',
      turn.intonationRu ?? turn.speechStyle ?? '',
      turn.speakerId || 'HOST_1',
      turn.originalTextRu ?? turn.originalText ?? '',
      turn.syncStatus ?? '',
      turn.sceneTitle ?? turn.chapter ?? '',
      turn.pace ?? '',
    ];
    rows.push(row.map(escapeCsvCell).join(','));
  }

  return rows.join('\n');
}

export interface VoiceProfileLike {
  id: string;
  voiceId?: string;
  name?: string;
  gender?: string;
  baseVoice?: string;
  isReplicatedVoice?: boolean;
  isUserCustomVoice?: boolean;
  category?: string;
}

/**
 * Detect whether a voice profile is a cloned / custom voice (non-built-in).
 */
export function isClonedVoiceProfile(voice: VoiceProfileLike | null | undefined): boolean {
  if (!voice) return false;
  const id = String(voice.voiceId || voice.id || '').toLowerCase();
  return (
    Boolean(voice.isReplicatedVoice || voice.isUserCustomVoice) ||
    id === 'voice_17raj9ewke3g' ||
    id === 'user-replicated' ||
    id === 'shohrux' ||
    id === 'shokhrukh' ||
    id.startsWith('voice_')
  );
}

/**
 * Determine effective gender ('female' | 'male') of a voice profile.
 */
export function getVoiceProfileGender(voice: VoiceProfileLike | null | undefined): 'female' | 'male' {
  if (!voice) return 'male';
  if (voice.gender === 'female') return 'female';
  if (voice.gender === 'male') return 'male';

  const bv = String(voice.baseVoice || '').toLowerCase();
  const femalePrebuilt = new Set([
    'kore',
    'aoede',
    'zephyr',
    'leda',
    'autonoe',
    'callirrhoe',
    'despina',
    'erinome',
    'gacrux',
    'laomedeia',
    'pulcherrima',
    'sulafat',
    'vindemiatrix',
  ]);
  const malePrebuilt = new Set([
    'charon',
    'puck',
    'fenrir',
    'orus',
    'achird',
    'sadachbia',
    'algenib',
    'algieba',
    'alnilam',
    'enceladus',
    'iapetus',
    'rasalgethi',
    'sadaltager',
    'schedar',
    'umbriel',
    'zubenelgenubi',
  ]);
  if (femalePrebuilt.has(bv)) return 'female';
  if (malePrebuilt.has(bv)) return 'male';

  if (
    /aziza|madina|dilnoza|zarina|nodira|malika|sevara|shahnoza|rayhon|gulzoda|umida|nigora|feruza|ayol/i.test(
      `${voice.name || ''} ${voice.id || ''}`
    )
  ) {
    return 'female';
  }
  return 'male';
}

/**
 * Pick a built-in (strictly non-cloned) voice matching the speaker's gender.
 * Avoids ids listed in excludeIds when another built-in voice of the same gender exists.
 */
export function pickBuiltInVoiceForGender<T extends VoiceProfileLike>(
  voices: T[],
  gender: 'female' | 'male',
  excludeIds: string[] = []
): T | undefined {
  const excludeSet = new Set(excludeIds);
  const builtInMatching = voices.filter(
    (v) =>
      !isClonedVoiceProfile(v) &&
      v.category !== 'cartoon' &&
      getVoiceProfileGender(v) === gender
  );
  if (builtInMatching.length === 0) return undefined;
  return builtInMatching.find((v) => !excludeSet.has(v.id)) || builtInMatching[0];
}

export interface SynthesisVoiceCheckSpeaker {
  speakerId: 'HOST_1' | 'HOST_2';
  name: string;
  gender: 'female' | 'male';
  voice: VoiceProfileLike | null | undefined;
}

/**
 * Returns human-readable Russian warnings before synthesis if:
 * 1) a speaker's selected voice gender does not match the speaker's declared gender, or
 * 2) a cloned voice is selected.
 */
export function checkSynthesisVoiceWarnings(
  speakers: SynthesisVoiceCheckSpeaker[],
  turns: Array<{ speakerId?: string }> = []
): string[] {
  const activeSpeakerIds =
    turns.length > 0 ? new Set(turns.map((t) => t.speakerId || 'HOST_1')) : null;

  const warnings: string[] = [];
  for (const sp of speakers) {
    if (activeSpeakerIds && !activeSpeakerIds.has(sp.speakerId)) continue;
    if (!sp.voice) continue;

    const voiceLabel = sp.voice.name || sp.voice.id;
    const voiceGender = getVoiceProfileGender(sp.voice);

    if (voiceGender !== sp.gender) {
      warnings.push(
        `Спикер «${sp.name}» (${sp.gender === 'female' ? 'Ж' : 'М'}): выбран голос «${voiceLabel}» противоположного пола (${voiceGender === 'female' ? 'Ж' : 'М'}).`
      );
    }
    if (isClonedVoiceProfile(sp.voice)) {
      warnings.push(
        `Спикер «${sp.name}»: выбран клонированный голос («${voiceLabel}»). Озвучка пойдёт в раздельном режиме с повышенным расходом вызовов TTS.`
      );
    }
  }
  return warnings;
}

