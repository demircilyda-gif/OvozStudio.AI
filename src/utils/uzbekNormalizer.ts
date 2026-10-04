/**
 * Uzbek Linguistic & Text Normalization Engine for Google Gemini 3.8 TTS
 * Standardizes apostrophes (o', g'), translates numerals/dates/prices/percentages into phonetic Uzbek,
 * and processes inline vocal tags (<laugh>, <short pause>, <sigh>, <whisper>).
 */

const UZ_UNITS = [
  "",
  "bir",
  "ikki",
  "uch",
  "to'rt",
  "besh",
  "olti",
  "yetti",
  "sakkiz",
  "to'qqiz",
];

const UZ_TENS = [
  "",
  "o'n",
  "yigirma",
  "o'ttiz",
  "qirq",
  "ellik",
  "oltmish",
  "yetmish",
  "sakson",
  "to'qson",
];

const UZ_SCALES = [
  "",
  "ming",
  "million",
  "milliard",
  "trillion",
];

/**
 * Converts any non-negative integer into phonetic Uzbek words
 */
export function numberToUzbekWords(n: number): string {
  if (isNaN(n) || n === 0) return "nol";
  if (n < 0) return "minus " + numberToUzbekWords(Math.abs(n));

  const num = Math.floor(n);
  if (num === 0) return "nol";

  let parts: string[] = [];
  let scaleIndex = 0;
  let remaining = num;

  while (remaining > 0) {
    const chunk = remaining % 1000;
    if (chunk > 0) {
      const chunkWords: string[] = [];
      const hundreds = Math.floor(chunk / 100);
      const tensUnits = chunk % 100;
      const tens = Math.floor(tensUnits / 10);
      const units = tensUnits % 10;

      if (hundreds > 0) {
        if (hundreds === 1) {
          chunkWords.push("bir yuz");
        } else {
          chunkWords.push(`${UZ_UNITS[hundreds]} yuz`);
        }
      }

      if (tens > 0) {
        chunkWords.push(UZ_TENS[tens]);
      }

      if (units > 0) {
        chunkWords.push(UZ_UNITS[units]);
      }

      if (scaleIndex > 0) {
        chunkWords.push(UZ_SCALES[scaleIndex]);
      }

      parts.unshift(chunkWords.join(" "));
    }

    remaining = Math.floor(remaining / 1000);
    scaleIndex++;
  }

  return parts.join(" ").trim();
}

/**
 * Converts a number to ordinal Uzbek ("birinchi", "ikkinchi", etc.)
 */
export function numberToUzbekOrdinal(n: number): string {
  const words = numberToUzbekWords(n);
  if (words.endsWith("a") || words.endsWith("i") || words.endsWith("u") || words.endsWith("o")) {
    return words + "nchi";
  }
  return words + "inchi";
}

/**
 * Standardizes all variations of apostrophes to a single clean apostrophe (')
 * Normalizes o‘, o’, o`, O‘, O’, O` -> o', O'
 * Normalizes g‘, g’, g`, G‘, G’, G` -> g', G'
 */
export function normalizeUzbekApostrophes(text: string): string {
  return text
    // Normalize unicode single quotes, backticks, modifiers
    .replace(/[‘`‛’′']/g, "'")
    // Explicitly unify Uzbek letter combinations
    .replace(/o[']/gi, (m) => (m[0] === "O" ? "O'" : "o'"))
    .replace(/g[']/gi, (m) => (m[0] === "G" ? "G'" : "g'"));
}

/**
 * Normalizes numbers, times, currencies, percentages, and dates in Uzbek text
 */
export function normalizeNumbersAndDates(text: string): string {
  let normalized = text;

  // 1. Time formats: e.g. "12:30", "12:00", "09:45"
  // "soat 12:30 da" -> "soat o'n ikki yarimda"
  normalized = normalized.replace(/\bsoat\s+(\d{1,2}):(\d{2})\s*(da)?\b/gi, (_, hStr, mStr, suffix) => {
    const h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);
    const hWords = numberToUzbekWords(h);
    let timeStr = "";

    if (m === 30) {
      timeStr = `soat ${hWords} yarim`;
    } else if (m === 0) {
      timeStr = `soat ${hWords}`;
    } else {
      const mWords = numberToUzbekWords(m);
      timeStr = `soat ${hWords} ${mWords}`;
    }

    if (suffix) {
      timeStr += "da";
    }
    return timeStr;
  });

  // Plain standalone time: e.g. "12:30"
  normalized = normalized.replace(/\b(\d{1,2}):(\d{2})\b/g, (_, hStr, mStr) => {
    const h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);
    const hWords = numberToUzbekWords(h);
    if (m === 30) {
      return `soat ${hWords} yarim`;
    }
    if (m === 0) {
      return `soat ${hWords}`;
    }
    return `soat ${hWords} ${numberToUzbekWords(m)}`;
  });

  // 2. Year ranges and dates: e.g. "1991-yil", "2026-yilda"
  normalized = normalized.replace(/\b(\d{4})-yil(da|gi|dan|gacha)?\b/gi, (_, yearStr, suffix) => {
    const y = parseInt(yearStr, 10);
    const yWords = numberToUzbekOrdinal(y);
    return `${yWords} yil${suffix || ""}`;
  });

  // 3. Currency: "$150", "150$", "$50,000", "$1,600/m²"
  normalized = normalized.replace(/\$(\d+(?:[.,]\d+)*)/g, (_, valStr) => {
    const cleanNum = parseInt(valStr.replace(/[,.\s]/g, ""), 10);
    return `${numberToUzbekWords(cleanNum)} dollar`;
  });
  normalized = normalized.replace(/(\d+(?:[.,]\d+)*)\s*\$/g, (_, valStr) => {
    const cleanNum = parseInt(valStr.replace(/[,.\s]/g, ""), 10);
    return `${numberToUzbekWords(cleanNum)} dollar`;
  });
  normalized = normalized.replace(/(\d+(?:[.,]\d+)*)\s*(?:so'm|som)\b/gi, (_, valStr) => {
    const cleanNum = parseInt(valStr.replace(/[,.\s]/g, ""), 10);
    return `${numberToUzbekWords(cleanNum)} so'm`;
  });

  // 4. Percentage: "25%", "0%", "15-25%"
  normalized = normalized.replace(/\b(\d+)\s*-\s*(\d+)%/g, (_, n1, n2) => {
    const w1 = numberToUzbekWords(parseInt(n1, 10));
    const w2 = numberToUzbekWords(parseInt(n2, 10));
    return `${w1} dan ${w2} foizgacha`;
  });
  normalized = normalized.replace(/(\d+)%/g, (_, valStr) => {
    const num = parseInt(valStr, 10);
    return `${numberToUzbekWords(num)} foiz`;
  });

  // 5. Ordinal numbers and room counts: e.g. "1-xonali", "2 xonali", "3-qavat"
  normalized = normalized.replace(/\b(\d+)-?xonali\b/gi, (_, nStr) => {
    const num = parseInt(nStr, 10);
    return `${numberToUzbekWords(num)} xonali`;
  });
  normalized = normalized.replace(/\b(\d+)-?qavat(da|ga)?\b/gi, (_, nStr, suffix) => {
    const num = parseInt(nStr, 10);
    return `${numberToUzbekOrdinal(num)} qavat${suffix || ""}`;
  });
  normalized = normalized.replace(/\b(\d+)-?bosqich\b/gi, (_, nStr) => {
    const num = parseInt(nStr, 10);
    return `${numberToUzbekOrdinal(num)} bosqich`;
  });

  // 6. Generic numbers (e.g. "50000", "200")
  normalized = normalized.replace(/\b\d{1,7}\b/g, (match) => {
    const num = parseInt(match, 10);
    if (!isNaN(num) && num < 10000000) {
      return numberToUzbekWords(num);
    }
    return match;
  });

  return normalized;
}

/**
 * Validates and preserves inline vocal tags supported by modern TTS:
 * <laugh>, <short pause>, <sigh>, <whisper>
 */
export function preserveVocalTags(text: string): string {
  // Normalize whitespace around known vocal tags
  return text
    .replace(/<\s*laugh\s*>/gi, " <laugh> ")
    .replace(/<\s*short\s+pause\s*>/gi, " <short pause> ")
    .replace(/<\s*sigh\s*>/gi, " <sigh> ")
    .replace(/<\s*whisper\s*>/gi, " <whisper> ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Master Uzbek Speech Normalization function
 * Run before sending any script to Gemini 3.8 Flash TTS
 */
export function normalizeUzbekSpeech(text: string): string {
  if (!text || typeof text !== "string") return "";

  // 1. Unify apostrophes (o', g')
  let result = normalizeUzbekApostrophes(text);

  // 2. Expand numbers, times, percentages, and currencies into natural words
  result = normalizeNumbersAndDates(result);

  // 3. Format and preserve vocal tags
  result = preserveVocalTags(result);

  // 4. Clean stray punctuation spaces
  result = result
    .replace(/\s+([.,!?;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();

  return result;
}
