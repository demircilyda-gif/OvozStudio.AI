import { GoogleGenAI, Type } from "@google/genai";
import { TTS_MODELS_CONFIG } from "../../config/ttsModels.ts";
import { normalizeUzbekApostrophes } from "../../../src/utils/uzbekNormalizer.ts";

export type DetectedSourceLang = "uz_latn" | "uz_cyrl" | "ru" | "en" | "mixed";

/**
 * Точная таблица транслитерации узбекской кириллицы в стандартную узбекскую латиницу (с единым апострофом ').
 */
export function transliterateUzbekCyrillicToLatin(text: string): string {
  if (!text) return "";

  let res = text;

  // Контекстные правила для Е/е, Ё/ё, Ю/ю, Я/я, Ц/ц
  // В начале слова, после гласных, ъ и ь -> ye / yo / yu / ya / s
  const cyrVowels = "аеёиоуўэюяАЕЁИОУЎЭЮЯъЪьЬ";
  res = res.replace(
    new RegExp(`(^|[^а-яёўқғҳА-ЯЁЎҚҒҲ]|[${cyrVowels}])([Ее])`, "g"),
    (_, prefix, ch) => prefix + (ch === "Е" ? "Ye" : "ye")
  );
  res = res.replace(
    new RegExp(`(^|[^а-яёўқғҳА-ЯЁЎҚҒҲ]|[${cyrVowels}])([Цц])`, "g"),
    (_, prefix, ch) => prefix + (ch === "Ц" ? "S" : "s")
  );
  res = res.replace(/([аеёиоуўэюяАЕЁИОУЎЭЮЯ])([Цц])/g, (_, v, ch) => v + (ch === "Ц" ? "Ts" : "ts"));

  const map: Record<string, string> = {
    А: "A",
    а: "a",
    Б: "B",
    б: "b",
    В: "V",
    в: "v",
    Г: "G",
    г: "g",
    Д: "D",
    д: "d",
    Е: "E",
    е: "e",
    Ё: "Yo",
    ё: "yo",
    Ж: "J",
    ж: "j",
    З: "Z",
    з: "z",
    И: "I",
    и: "i",
    Й: "Y",
    й: "y",
    К: "K",
    к: "k",
    Л: "L",
    л: "l",
    М: "M",
    м: "m",
    Н: "N",
    н: "n",
    О: "O",
    о: "o",
    П: "P",
    п: "p",
    Р: "R",
    р: "r",
    С: "S",
    с: "s",
    Т: "T",
    т: "t",
    У: "U",
    у: "u",
    Ф: "F",
    ф: "f",
    Х: "X",
    х: "x",
    Ц: "S",
    ц: "s",
    Ч: "Ch",
    ч: "ch",
    Ш: "Sh",
    ш: "sh",
    Щ: "Sh",
    щ: "sh",
    Ъ: "'",
    ъ: "'",
    Ы: "I",
    ы: "i",
    Ь: "",
    ь: "",
    Э: "E",
    э: "e",
    Ю: "Yu",
    ю: "yu",
    Я: "Ya",
    я: "ya",
    Ў: "O'",
    ў: "o'",
    Қ: "Q",
    қ: "q",
    Ғ: "G'",
    ғ: "g'",
    Ҳ: "H",
    ҳ: "h",
  };

  let out = "";
  for (const ch of res) {
    out += map[ch] !== undefined ? map[ch] : ch;
  }

  return normalizeUzbekApostrophes(out);
}

/**
 * Быстрая и точная эвристика определения языка входного текста:
 * - uz_cyrl: узбекская кириллица (транслитерируется без перевода)
 * - uz_latn: узбекская латиница
 * - ru: русский язык
 * - en: английский язык
 * - mixed: смешанный русско-узбекский текст
 */
export function detectInputLanguageHeuristic(text: string): DetectedSourceLang {
  const clean = (text || "").trim();
  if (!clean) return "uz_latn";

  const hasUzCyrlSpecific = /[ўқғҳЎҚҒҲ]/.test(clean);
  const cyrillicChars = (clean.match(/[а-яёўқғҳА-ЯЁЎҚҒҲ]/g) || []).length;
  const latinChars = (clean.match(/[a-zA-Z]/g) || []).length;
  const totalLetters = cyrillicChars + latinChars;

  if (totalLetters === 0) return "uz_latn";

  const uzCyrlWordRegex =
    /\b(учун|билан|бўлади|чегирма|дўкон|хуш|келибсиз|сўм|фоиз|манзил|хизмат|бугун|фақат|бизнинг|сизга|янги|нарх|сотиб|олинг|мурожаат|қилинг|бепул|етказиб|бериш|акция|табриклаймиз|байрам)\b/i;
  const ruSpecificRegex =
    /[ыщЫЩ]|\b(для|или|если|только|сегодня|скидка|магазин|доставка|поздравляем|инструкция|пожалуйста|здравствуйте|компания|наш|ваш|который|будет|можно|через|после|очень|просто)\b/i;
  const uzLatnWordRegex =
    /\b(uchun|bilan|bo'ladi|chegirma|do'kon|xush|kelibsiz|so'm|foiz|manzil|xizmat|bugun|faqat|bizning|sizga|yangi|narx|sotib|oling|murojaat|qiling|bepul|yetkazib|berish|tabriklaymiz|assalomu|alaykum|va|ham|esa|shu|bu|kuni|soat)\b/i;
  const enWordRegex =
    /\b(the|and|for|with|your|from|this|that|have|will|welcome|discount|today|please|order|delivery|service|available|contact|call)\b/i;

  // Смешанный текст (например, русские и узбекские слова/предложения вместе)
  if (cyrillicChars > 4 && latinChars > 4 && (uzLatnWordRegex.test(clean) || ruSpecificRegex.test(clean))) {
    return "mixed";
  }

  if (cyrillicChars > latinChars) {
    // Если есть специфичные узбекские кириллические буквы и нет чисто русских слов
    if ((hasUzCyrlSpecific || uzCyrlWordRegex.test(clean)) && !ruSpecificRegex.test(clean)) {
      return "uz_cyrl";
    }
    if ((hasUzCyrlSpecific || uzCyrlWordRegex.test(clean)) && ruSpecificRegex.test(clean)) {
      return "mixed";
    }
    return "ru";
  }

  // Латиница: проверяем английский против узбекского (апострофы o' и g' характерны только для узбекского)
  const hasUzApostrophes = /[oOgG]['‘’`ʻʼ]/i.test(clean);
  if (enWordRegex.test(clean) && !uzLatnWordRegex.test(clean) && !hasUzApostrophes) {
    return "en";
  }

  return "uz_latn";
}

/**
 * Проверяет, нужен ли перевод (или транслитерация) для заданного целевого языка.
 */
export function needsTranslationOrTransliteration(
  sourceLang: DetectedSourceLang,
  targetLanguage: "uz" | "ru" | "en"
): { needsTransliteration: boolean; needsTranslation: boolean } {
  if (targetLanguage === "uz") {
    if (sourceLang === "uz_cyrl") {
      return { needsTransliteration: true, needsTranslation: false };
    }
    if (sourceLang === "uz_latn") {
      return { needsTransliteration: false, needsTranslation: false };
    }
    return { needsTransliteration: false, needsTranslation: true };
  }

  if (targetLanguage === "ru") {
    if (sourceLang === "ru") {
      return { needsTransliteration: false, needsTranslation: false };
    }
    return { needsTransliteration: false, needsTranslation: true };
  }

  if (targetLanguage === "en") {
    if (sourceLang === "en") {
      return { needsTransliteration: false, needsTranslation: false };
    }
    return { needsTransliteration: false, needsTranslation: true };
  }

  return { needsTransliteration: false, needsTranslation: false };
}

/**
 * Перевод (или транслитерация узбекской кириллицы) через gemini-4-hydrogen (thinking LOW, строгий JSON).
 */
export async function translateOrTransliterateTtsText(
  ai: GoogleGenAI,
  params: {
    text: string;
    targetLanguage: "uz" | "ru" | "en";
  }
): Promise<{
  translatedText: string;
  sourceLanguage: DetectedSourceLang;
  wasTransliterated: boolean;
  wasTranslated: boolean;
}> {
  const rawText = (params.text || "").trim().slice(0, TTS_MODELS_CONFIG.maxTextChars);
  if (!rawText) {
    return {
      translatedText: "",
      sourceLanguage: "uz_latn",
      wasTransliterated: false,
      wasTranslated: false,
    };
  }

  const sourceLanguage = detectInputLanguageHeuristic(rawText);
  const { needsTransliteration, needsTranslation } = needsTranslationOrTransliteration(
    sourceLanguage,
    params.targetLanguage
  );

  // 1. Узбекская кириллица -> прямая транслитерация в латиницу без перевода
  if (needsTransliteration) {
    const transliterated = transliterateUzbekCyrillicToLatin(rawText);
    return {
      translatedText: transliterated,
      sourceLanguage: "uz_cyrl",
      wasTransliterated: true,
      wasTranslated: false,
    };
  }

  // 2. Язык уже совпадает с языком озвучки -> возвращаем как есть
  if (!needsTranslation) {
    return {
      translatedText:
        params.targetLanguage === "uz" ? normalizeUzbekApostrophes(rawText) : rawText,
      sourceLanguage,
      wasTransliterated: false,
      wasTranslated: false,
    };
  }

  // 3. Перевод через gemini-4-hydrogen (thinking LOW, responseSchema)
  const targetLangName =
    params.targetLanguage === "uz"
      ? "живой разговорный узбекский язык (строго латиница, единый апостроф ' в o' и g')"
      : params.targetLanguage === "ru"
        ? "естественный живой русский язык"
        : "natural conversational English";

  const systemInstruction = `Ты — профессиональный переводчик-адаптатор текстов для голосовой озвучки (TTS).
Переведи входной текст на ${targetLangName}.
СТРОГИЕ ПРАВИЛА:
1. Передай 100% смысла оригинала живым разговорным языком, как говорят в жизни (без канцелярита и буквальных калек).
2. Ничего не добавляй от себя и ничего не выбрасывай.
3. Все цифры, цены, даты, телефоны и имена собственные сохрани в точности как в оригинале.
4. Сохрани деление на абзацы. Для узбекского языка используй только стандартную латиницу и прямой апостроф ' (o', g').`;

  const response = await ai.models.generateContent({
    model: TTS_MODELS_CONFIG.textModel,
    contents: `Переведи текст для озвучки:\n\n${rawText}`,
    config: {
      systemInstruction,
      thinkingConfig: { thinkingLevel: TTS_MODELS_CONFIG.textThinkingLevel },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          translatedText: {
            type: Type.STRING,
            description: "Переведённый текст на целевом языке с сохранением абзацев и всех цифр.",
          },
          detectedSourceLanguage: {
            type: Type.STRING,
            description: "Код языка оригинала: ru, en, uz_latn, uz_cyrl или mixed.",
          },
        },
        required: ["translatedText", "detectedSourceLanguage"],
      },
    },
  });

  const parsed = JSON.parse((response.text || "{}").trim());
  const outText = String(parsed.translatedText || rawText).trim();

  return {
    translatedText:
      params.targetLanguage === "uz" ? normalizeUzbekApostrophes(outText) : outText,
    sourceLanguage,
    wasTransliterated: false,
    wasTranslated: true,
  };
}
