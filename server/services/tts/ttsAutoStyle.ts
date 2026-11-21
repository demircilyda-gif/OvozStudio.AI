import { GoogleGenAI, Type } from "@google/genai";
import {
  TTS_MODELS_CONFIG,
  TTS_PRESET_STYLES,
  describeSpeedForStyle,
} from "../../config/ttsModels.ts";
import {
  normalizeUzbekApostrophes,
  canonicalizeTimedPauseTags,
} from "../../../src/utils/uzbekNormalizer.ts";
import type { TtsPreset } from "../../../src/types/tts.ts";

const ANY_ANGLE_TAG_REGEX = /<[^>]+>/g;
const TIMED_PAUSE_TAG_REGEX = /\[pauza\s+\d+(?:\.\d+)?s\]/gi;

/**
 * Очищает текст от всех вокальных тегов (<...>) и маркеров пауз ([pauza Ns])
 * и нормализует пробелы/апострофы для строгой пословной проверки.
 */
export function stripTagsForWordVerification(text: string): string {
  return normalizeUzbekApostrophes(canonicalizeTimedPauseTags(text || ""))
    .replace(TIMED_PAUSE_TAG_REGEX, " ")
    .replace(ANY_ANGLE_TAG_REGEX, " ")
    .replace(/[«»""„‟]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Извлекает массив слов (без тегов и пунктуации) для 1:1 сравнения.
 */
export function extractWordsForVerification(text: string): string[] {
  const cleaned = stripTagsForWordVerification(text)
    .replace(/[.,!?;:()[\]{}"—–\-…]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? cleaned.split(" ") : [];
}

/**
 * Проверяет, что после расстановки тегов (<short pause>, <breath>, <laugh>, <sigh>, [pauza Ns])
 * ни одно слово исходного текста не было изменено, добавлено или удалено.
 */
export function verifyWordsUnchanged(originalText: string, taggedText: string): boolean {
  const origWords = extractWordsForVerification(originalText);
  const taggedWords = extractWordsForVerification(taggedText);

  if (origWords.length !== taggedWords.length) {
    return false;
  }

  for (let i = 0; i < origWords.length; i++) {
    if (origWords[i] !== taggedWords[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Оставляет в размеченном тексте ТОЛЬКО 4 разрешённых тега (<short pause>, <breath>, <laugh>, <sigh>)
 * и канонические маркеры точных пауз ([pauza 1s], [pauza 2s], [pauza 3s] и т.д.).
 */
export function sanitizeAllowedAutoTags(taggedText: string): string {
  return canonicalizeTimedPauseTags(taggedText || "")
    .replace(/<[^>]+>/g, (match) => {
      const lower = match.toLowerCase().replace(/\s+/g, " ").trim();
      if (
        lower === "<short pause>" ||
        lower === "<breath>" ||
        lower === "<laugh>" ||
        lower === "<sigh>"
      ) {
        return lower;
      }
      return "";
    })
    .replace(/\s{2,}/g, " ")
    .trim();
}

export interface AnnotatedParagraph {
  originalText: string;
  taggedText: string;
  style: string;
  verifiedUnchanged: boolean;
}

export interface AutoStyleResult {
  paragraphs: AnnotatedParagraph[];
  combinedTaggedText: string;
  overallStyle: string;
  wordsUnchangedVerified: boolean;
}

/**
 * Формирует стиль и разметку:
 * - Если выбран готовый пресет (conversational | confident | energetic | warm), автоэмоция НЕ вызывается.
 * - Если выбран «auto», вызывается gemini-4-hydrogen (thinking LOW, responseSchema),
 *   текст размечается по абзацам, и каждый абзац проходит жёсткую пословную проверку.
 *   Для сверхдлинных текстов (до 10 000 слов) анализируются первые 10 абзацев, чтобы не превышать лимит токенов.
 */
export async function buildTtsStyleAndAnnotatedText(
  ai: GoogleGenAI,
  params: {
    text: string;
    preset: TtsPreset;
    speed: number;
    language: "uz" | "ru" | "en";
  }
): Promise<AutoStyleResult> {
  const rawParagraphs = (params.text || "")
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const speedPhrase = describeSpeedForStyle(params.speed);
  const langLabel =
    params.language === "uz"
      ? "Native authentic Uzbek pronunciation (zero foreign accent)"
      : params.language === "ru"
        ? "Native authentic Russian pronunciation"
        : "Native natural English pronunciation";

  // Если выбран фиксированный пресет подачи — автоэмоция не вызывается
  if (params.preset !== "auto") {
    const basePresetStyle = TTS_PRESET_STYLES[params.preset] || TTS_PRESET_STYLES.conversational;
    const fixedStyle = `${basePresetStyle}, ${speedPhrase}. ${langLabel}`;
    return {
      paragraphs: rawParagraphs.map((p) => ({
        originalText: p,
        taggedText: p,
        style: fixedStyle,
        verifiedUnchanged: true,
      })),
      combinedTaggedText: rawParagraphs.join("\n\n"),
      overallStyle: fixedStyle,
      wordsUnchangedVerified: true,
    };
  }

  // Режим «auto»: вызываем gemini-4-hydrogen (thinking LOW, responseSchema)
  try {
    const MAX_AUTO_PARAGRAPHS = 10;
    const sampleParagraphs = rawParagraphs.slice(0, MAX_AUTO_PARAGRAPHS);
    const numberedInput = sampleParagraphs
      .map((p, idx) => `[Paragraph ${idx + 1}]: ${p.slice(0, 1200)}`)
      .join("\n\n");

    const systemInstruction = `You are a speech director for Gemini 3.8 TTS.
Analyze the user's text paragraph by paragraph and return:
1. A short vocal delivery style in English for each paragraph (e.g., "warm, slight smile, relaxed pace" or "clear, confident announcement tone").
2. The exact paragraph text with ONLY these four inline vocal tags inserted sparingly where natural: <short pause>, <breath>, <laugh>, <sigh>. Keep any existing timed pause tags like [pauza 1s], [pauza 2s], [pauza 3s] intact in their exact positions.

CRITICAL INVARIANT:
- DO NOT change, add, delete, translate, or respell ANY word, number, or punctuation mark of the original text.
- If you strip <short pause>, <breath>, <laugh>, <sigh> from your taggedText, it MUST be 100% character-for-character identical to the input paragraph.`;

    const response = await ai.models.generateContent({
      model: TTS_MODELS_CONFIG.textModel,
      contents: numberedInput,
      config: {
        systemInstruction,
        thinkingConfig: { thinkingLevel: TTS_MODELS_CONFIG.textThinkingLevel },
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            overallStyleSummary: {
              type: Type.STRING,
              description: "Short English summary of the overall vocal style (6-12 words).",
            },
            paragraphs: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  style: {
                    type: Type.STRING,
                    description: "Short English delivery style for this paragraph.",
                  },
                  taggedText: {
                    type: Type.STRING,
                    description:
                      "Exact paragraph text with only <short pause>, <breath>, <laugh>, <sigh> inserted and any [pauza Ns] preserved.",
                  },
                },
                required: ["style", "taggedText"],
              },
            },
          },
          required: ["overallStyleSummary", "paragraphs"],
        },
      },
    });

    const parsed = JSON.parse((response.text || "{}").trim());
    const aiParagraphs: Array<{ style?: string; taggedText?: string }> = Array.isArray(
      parsed.paragraphs
    )
      ? parsed.paragraphs
      : [];

    const overallSummary = `${String(parsed.overallStyleSummary || "Natural expressive delivery").trim()}, ${speedPhrase}. ${langLabel}`;

    const resultParagraphs: AnnotatedParagraph[] = rawParagraphs.map((origP, idx) => {
      const candidate = idx < MAX_AUTO_PARAGRAPHS && origP.length <= 1200 ? aiParagraphs[idx] : undefined;
      const rawStyle = String(
        candidate?.style || parsed.overallStyleSummary || "natural expressive delivery"
      ).trim();
      const fullStyle = `${rawStyle}, ${speedPhrase}. ${langLabel}`;

      if (!candidate?.taggedText) {
        return {
          originalText: origP,
          taggedText: origP,
          style: fullStyle,
          verifiedUnchanged: true,
        };
      }

      const sanitized = sanitizeAllowedAutoTags(candidate.taggedText);
      const isUnchanged = verifyWordsUnchanged(origP, sanitized);

      // Если хотя бы одно слово не совпало — разметка отбрасывается и озвучивается исходный текст
      return {
        originalText: origP,
        taggedText: isUnchanged ? sanitized : origP,
        style: fullStyle,
        verifiedUnchanged: true,
      };
    });

    return {
      paragraphs: resultParagraphs,
      combinedTaggedText: resultParagraphs.map((p) => p.taggedText).join("\n\n"),
      overallStyle: overallSummary,
      wordsUnchangedVerified: resultParagraphs.every((p) =>
        verifyWordsUnchanged(p.originalText, p.taggedText)
      ),
    };
  } catch (err) {
    // Fallback при ошибке LLM: исходный текст без изменений
    const fallbackStyle = `${TTS_PRESET_STYLES.conversational}, ${speedPhrase}. ${langLabel}`;
    return {
      paragraphs: rawParagraphs.map((p) => ({
        originalText: p,
        taggedText: p,
        style: fallbackStyle,
        verifiedUnchanged: true,
      })),
      combinedTaggedText: rawParagraphs.join("\n\n"),
      overallStyle: fallbackStyle,
      wordsUnchangedVerified: true,
    };
  }
}
