import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import { TTS_MODELS_CONFIG } from "../../config/ttsModels.ts";
import {
  getCompactCharacterCatalogForAgent,
  getCharacterVoiceById,
  sanitizeStyleForGooglePolicy,
} from "../../config/characterVoices.ts";
import {
  normalizeUzbekApostrophes,
  canonicalizeTimedPauseTags,
} from "../../../src/utils/uzbekNormalizer.ts";
import {
  verifyWordsUnchanged,
  sanitizeAllowedAutoTags,
} from "./ttsAutoStyle.ts";
import type {
  TtsAgentDecision,
  TtsAgentProposal,
  TtsAgentProposeResponse,
  TtsAgentWorkflow,
  TtsAudience,
  TtsDirectorSegment,
} from "../../../src/types/tts.ts";

const TIMED_PAUSE_TAG_EXACT_REGEX = /^\[pauza\s+([1-3])s\]$/i;
const TIMED_PAUSE_TAG_ANY_REGEX = /\[pauza\s+(\d+(?:\.\d+)?)s\]/gi;

export function isTimedPauseBracketToken(token: string): boolean {
  const clean = canonicalizeTimedPauseTags(token || "").trim();
  return /^\[pauza\s+(\d+(?:\.\d+)?)s\]$/i.test(clean);
}

/**
 * Канонизирует паузы строго в [pauza 1s], [pauza 2s], [pauza 3s] (N от 1 до 3)
 * и оставляет только разрешённые английские вокальные теги (<short pause>, <breath>, <sigh>, <laugh>).
 */
export function enforceAllowedPauseAndVocalTags(text: string): string {
  const withCanonicalPauses = canonicalizeTimedPauseTags(text || "")
    .replace(/([oOgG])[\u02BB\u02BC\u2018\u2019`´]/g, "$1'")
    .replace(TIMED_PAUSE_TAG_ANY_REGEX, (_m, numStr) => {
      const n = Math.max(1, Math.min(3, Math.round(parseFloat(numStr) || 1)));
      return `[pauza ${n}s]`;
    });
  return sanitizeAllowedAutoTags(withCanonicalPauses);
}

/**
 * Детектор того, содержит ли исходный ввод пользователя режиссёрские инструкции,
 * таймкоды (0:00-0:05, на 5-й секунде), пометки тона или мета-команды,
 * которые НИ В КОЕМ СЛУЧАЕ нельзя озвучивать вслух.
 */
function inputContainsDirectorInstructions(input: string): boolean {
  const s = input || "";
  return (
    /\b\d{1,2}:\d{2}\s*(?:[-–—]\s*\d{1,2}:\d{2})?/.test(s) ||
    /\b\d+\s*[-–—]\s*\d+\s*(?:сек|с\b|sec|soniya|s\b)/i.test(s) ||
    /(?:на\s+\d+[-ойей]?\s*секунд|с\s+\d+\s+по\s+\d+\s*сек|таймкод|интонаци|подач[аиуе]|голосом|как\s+живой\s+человек|говори(?:ть|те)?\s+(?:тихо|громко|спокойно|быстро|медленно|энергично|тепло|с\s+улыбкой|уверенно)|озвуч(?:ь|ить|те)|сцена\s*\d+|диктор\s*:|режисс|инструкци|дубляж|персонаж|роль\s*:|ohangda|tovushda|soniyada|ovozlashtir)/i.test(
      s
    )
  );
}

/**
 * Страховочная чистка случайных утечек таймкодов и сценических ремарок из произносимого текста.
 * Превращает ремарки вроде (пауза 2 сек) в [pauza 2s], а таймкоды/метки вроде "0:00-0:05:" удаляет.
 */
export function stripLeakedStageDirections(text: string): string {
  let out = String(text || "");

  // 1. Превращаем словесные паузы в скобках: (пауза 2 сек), (2 секунды пауза), (pause 2s) -> [pauza 2s]
  out = out.replace(
    /\(\s*(?:пауза|pauza|pause)\s*(\d+(?:[.,]\d+)?)\s*(?:с|сек|секунд[аы]?|s|sec|soniya)?\s*\)/gi,
    (_m, num) => {
      const n = Math.max(1, Math.min(3, Math.round(parseFloat(String(num).replace(",", ".")) || 1)));
      return `[pauza ${n}s]`;
    }
  );

  // 2. Убираем таймкоды в начале строк или в квадратных/круглых скобках: [0:00-0:05], (00:05), 0:00–0:08:
  out = out
    .replace(/[\[(]\s*\d{1,2}:\d{2}(?:\s*[-–—]\s*\d{1,2}:\d{2})?\s*[\])]\s*:?/g, " ")
    .replace(/(?:^|\n)\s*\d{1,2}:\d{2}(?:\s*[-–—]\s*\d{1,2}:\d{2})?\s*[:\-–—]?\s*/g, "\n")
    .replace(/(?:^|\n)\s*\d+\s*[-–—]\s*\d+\s*(?:сек|с\.|sec|soniya)\s*[:\-–—]?\s*/gi, "\n");

  // 3. Убираем технические префиксы строк вроде "Сцена 1:", "Диктор:", "Интонация: ...", "Таймкод: ..."
  out = out
    .replace(
      /(?:^|\n)\s*(?:сцена|кадр|блок|таймкод|интонация|подача|тон|темп|голос|ремарка|диктор|спикер|ведущий|narrator|voiceover|tone|style|note|sahna|ovoz|ohang)\s*\d*\s*:\s*/gi,
      "\n"
    )
    // Убираем скобочные режиссёрские ремарки (тихим голосом), (с улыбкой), (энергично), (calm tone)
    .replace(
      /\(\s*(?:тихо|тихим|громко|громче|спокойно|уверенно|энергично|бодро|тепло|мягко|с\s+улыбкой|шёпотом|шепотом|медленно|быстрее|драматично|живо|как\s+человек|интригующе|вдох|выдох|улыбаясь|calm|warm|soft|whisper|energetic|smiling|slowly|faster|emphatic|sekin|baland|iliq|tabassum\s+bilan|jonli)[^()]{0,80}\)/gi,
      " "
    );

  // Чистим множественные пробелы и пустые переводы строк
  out = out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return out;
}

/**
 * Проверяет отсутствие выдуманных телефонов, адресов/ссылок и цен, которых не было в задании.
 */
function stripHallucinatedContacts(
  proposalText: string,
  originalTask: string,
  isCommercialAd: boolean
): string {
  const taskDigits = (originalTask.match(/\d{4,}/g) || []).join(" ");
  let cleaned = proposalText;

  // Выдуманные телефонные номера (например +998 90 123-45-67), которых нет в задании
  cleaned = cleaned.replace(
    /(?:\+?\s*998|8\s*\(\d{3}\)|\+\d{1,3})[\s\-()]*\d{2,3}[\s\-()]*\d{3}[\s\-()]*\d{2}[\s\-()]*\d{2}/g,
    (match) => {
      const digitsOnly = match.replace(/\D/g, "");
      if (digitsOnly.length >= 6 && taskDigits.includes(digitsOnly.slice(-6))) {
        return match;
      }
      return isCommercialAd ? "[telefon]" : "";
    }
  );

  // В некоммерческих жанрах убираем навязанные [telefon], [manzil], [narx], если их не было в задаче
  if (!isCommercialAd) {
    cleaned = cleaned.replace(/\[(telefon|manzil|narx)\]/gi, "");
  }

  return cleaned.replace(/[ \t]{2,}/g, " ").trim();
}

/**
 * Подсчитывает слова, суммарное время пауз ([pauza 1s/2s/3s]), длительность и плейсхолдеры.
 */
export function computeWordAndDurationStats(text: string): {
  wordCount: number;
  pauseTotalSeconds: number;
  estimatedSeconds: number;
  placeholders: string[];
} {
  const canonical = enforceAllowedPauseAndVocalTags(text || "").trim();

  let pauseTotalSeconds = 0;
  let match: RegExpExecArray | null;
  const pauseRegex = new RegExp(TIMED_PAUSE_TAG_ANY_REGEX.source, "gi");
  while ((match = pauseRegex.exec(canonical)) !== null) {
    const sec = parseFloat(match[1]);
    if (!isNaN(sec) && sec > 0) {
      pauseTotalSeconds += sec;
    }
  }
  pauseTotalSeconds = Math.round(pauseTotalSeconds * 10) / 10;

  const allBrackets = canonical.match(/\[[^\][]{1,40}\]/g) || [];
  const placeholders = Array.from(
    new Set(
      allBrackets
        .map((m) => m.trim())
        .filter((m) => !TIMED_PAUSE_TAG_EXACT_REGEX.test(m))
    )
  );

  const spokenOnly = canonical
    .replace(TIMED_PAUSE_TAG_ANY_REGEX, " ")
    .replace(/<[^>]+>/g, " ")
    .trim();

  const words = spokenOnly ? spokenOnly.split(/\s+/).filter(Boolean) : [];
  const wordCount = words.length;
  const speechSeconds = wordCount / TTS_MODELS_CONFIG.wordsPerSecondEstimate;
  const estimatedSeconds =
    wordCount === 0 && pauseTotalSeconds === 0
      ? 0
      : Math.max(1, Math.round(speechSeconds + pauseTotalSeconds));

  return { wordCount, pauseTotalSeconds, estimatedSeconds, placeholders };
}

/**
 * Быстрая проверка: слишком пустое задание (нет ни темы, ни названия, ни текста).
 */
function isTaskTooVagueHeuristic(task: string): boolean {
  const trimmed = (task || "").trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length <= 3) {
    const genericOnly =
      /^(сделай|напиши|создай|нужна|нужен|хочу)?\s*(классную|хорошую|крутую|живую)?\s*(реклама|рекламу|объявление|текст|поздравление|инструкция|автоответчик|пост|озвучку|озвучка|монолог|рассказ|reklama|e'lon|tabrik|matn|ovoz|audio|приветствие)[.,!?]*$/i.test(
        trimmed
      );
    if (genericOnly) return true;
  }
  return false;
}

/**
 * Вычисляет Jaccard-сходство двух текстов (0..1) для проверки разнообразия вариантов.
 */
function computeTextSimilarity(a: string, b: string): number {
  const toSet = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/\[pauza\s+\d+s\]|<[^>]+>/gi, " ")
        .replace(/[^a-zа-яё0-9o'g'\s]/gi, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2)
    );
  const setA = toSet(a);
  const setB = toSet(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  for (const w of setA) {
    if (setB.has(w)) inter++;
  }
  const union = setA.size + setB.size - inter;
  return union > 0 ? inter / union : 0;
}

const AUTONOMOUS_AGENT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    decision: {
      type: Type.OBJECT,
      properties: {
        genre: {
          type: Type.STRING,
          description:
            "Free-form detected category/genre across ANY domain (e.g. 'Реклама для Reels', 'Сцена для мультфильма', 'Детская сказка на ночь', 'Дубляж персонажа', 'Тайминг-сценарий для видео', 'Документальный рассказ', 'Подкаст-интро', etc.).",
        },
        audience: {
          type: Type.STRING,
          description:
            "STRICTLY either 'general' (ads, business, news, adult monologues, instructions) OR 'kids_cartoon' (cartoons, animated characters, fairy tales, bedtime stories, funny animated animals/creatures).",
        },
        workflow: {
          type: Type.STRING,
          description:
            "One of: 'direct' (user gave instructions/timecodes/acting cues + script or brief to direct), 'create' (open-ended brief to create scripts), 'expand' (expand short points), 'format' (pure ready-made verbatim text with ZERO meta-instructions).",
        },
        variantsCount: {
          type: Type.INTEGER,
          description: "Number of creative directorial variants returned: usually 3 (or 1-2 only if explicitly requested or huge verbatim doc).",
        },
        targetSeconds: {
          type: Type.INTEGER,
          description:
            "Target audio duration in seconds (from prompt/timecodes, genre default, or natural full length).",
        },
        reasonShort: {
          type: Type.STRING,
          description:
            "One clear summary in the user's language explaining what instructions were extracted (NOT spoken aloud), what variants are proposed, and — when audience='kids_cartoon' — why the cartoon character(s) were chosen (e.g. 'Весёлая девочка-героиня → qizcha_quvnoq').",
        },
      },
      required: ["genre", "audience", "workflow", "variantsCount", "targetSeconds", "reasonShort"],
    },
    needsClarification: {
      type: Type.BOOLEAN,
      description:
        "True ONLY if the prompt has zero essence/subject/name (e.g. just 'сделай рекламу').",
    },
    clarifyingQuestion: {
      type: Type.STRING,
      description: "One short clarifying question if needsClarification is true; otherwise empty string.",
    },
    proposals: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          title: {
            type: Type.STRING,
            description: "Clear label of this creative take/angle (e.g. 'Точно по вашей режиссуре', 'Живая разговорная подача', 'Кинематографичный / эмоциональный вариант').",
          },
          badge: {
            type: Type.STRING,
            description: "Short 1-3 word tag describing the delivery vibe (e.g. 'По ТЗ · Живой', 'Разговорный', 'Мультфильм').",
          },
          text: {
            type: Type.STRING,
            description:
              "STRICTLY ONLY the pure spoken words that the voice actor speaks aloud into the microphone! ZERO meta-instructions, ZERO timecodes (no 0:00-0:05), ZERO stage directions like '(тихо)' or 'Диктор:'. Allowed inline cues ONLY: <short pause>, <breath>, <sigh>, <laugh>, [pauza 1s], [pauza 2s], [pauza 3s].",
          },
          characterVoiceId: {
            type: Type.STRING,
            description:
              "ONLY when decision.audience === 'kids_cartoon': exact character id from the provided cartoon character catalog (e.g. 'qizcha_quvnoq', 'qizcha_mayin', 'bola_shox', 'bola_jasur', 'mitti_qahramon', 'ertak_hikoyachi'). Leave empty string '' when decision.audience === 'general'.",
          },
          deliveryStyle: {
            type: Type.STRING,
            description:
              "Rich, vivid English voice-acting delivery direction for Gemini 3.8 TTS (15-40 words). NEVER include child-age words (NO 'child', 'kid', 'kids', 'toddler', 'baby', 'years old', 'yosh bola', 'bola ovozi', 'ребёнок', 'детский голос', 'N лет', 'N yosh'). For cartoon characters always describe acting as 'animated cartoon character voice' performed by an actor.",
          },
          directorStyle: {
            type: Type.STRING,
            description:
              "Same English voice-acting direction as deliveryStyle (15-40 words), strictly free of any child-age terms, capturing natural rhythm, warmth, breathing and emotional arc.",
          },
          segments: {
            type: Type.ARRAY,
            description:
              "Optional ordered acting beats when the script has timecodes (0:00-0:05, etc.) or shifting emotions/pacing between sections. Each segment contains ONLY spoken words in 'text' and specific English acting direction in 'style'.",
            items: {
              type: Type.OBJECT,
              properties: {
                timecode: {
                  type: Type.STRING,
                  description: "Optional time range or beat label for UI display ONLY (never spoken aloud), e.g. '0:00–0:05' or 'Кульминация'.",
                },
                style: {
                  type: Type.STRING,
                  description: "Specific English voice-acting direction for this exact beat/segment (strictly NO child-age words; use 'animated cartoon character' for cartoon roles).",
                },
                text: {
                  type: Type.STRING,
                  description: "ONLY the spoken words for this segment (plus allowed <short pause>, <breath>, <sigh>, <laugh>, [pauza 1s/2s/3s]). NO timecodes, NO instructions!",
                },
              },
              required: ["style", "text"],
            },
          },
          preset: {
            type: Type.STRING,
            description: "Closest fallback preset: conversational, confident, energetic, or warm.",
          },
          recommendedVoiceId: {
            type: Type.STRING,
            description:
              "Best matching adult voice id from catalog: ulugbek-history, aziza-ai, jasur-business, madina-journalist, otabek-comedy, malika-tech, nodira-analyst, sevara-science, sherzod-investigation, javohir-media, sanjar-radio, bobur-coach, eldor-fintech, farrux-tech, dilnoza-blogger, gulzoda-edu, rayhon-art, shahnoza-speech, zarina-culture.",
          },
          reason: {
            type: Type.STRING,
            description:
              "Short human explanation in the user's language of how this take is acted, why this character/pauses/emotions work, and how it differs from the other variants.",
          },
        },
        required: [
          "id",
          "title",
          "badge",
          "text",
          "deliveryStyle",
          "directorStyle",
          "preset",
          "recommendedVoiceId",
          "reason",
        ],
      },
    },
  },
  required: ["decision", "needsClarification", "proposals"],
};

/**
 * Универсальный автономный AI-Режиссёр озвучки (для любых 100 000+ категорий задач).
 * Разделяет инструкции/таймкоды/ремарки и чистый произносимый текст, переводит режиссуру в
 * живую актёрскую подачу (directorStyle + segments) и предлагает разноплановые творческие варианты.
 */
export async function generateTtsAgentProposals(
  ai: GoogleGenAI,
  params: {
    task: string;
    language: "uz" | "ru" | "en";
    voiceId?: string;
  }
): Promise<TtsAgentProposeResponse> {
  const cleanTask = (params.task || "").trim();
  const inputWords = cleanTask ? cleanTask.split(/\s+/).filter(Boolean).length : 0;

  if (inputWords > TTS_MODELS_CONFIG.maxAgentWords) {
    const err: any = new Error("Разбейте текст на части (лимит поля — 3 000 слов)");
    err.status = 400;
    err.code = "TEXT_TOO_LONG";
    throw err;
  }

  if (isTaskTooVagueHeuristic(cleanTask)) {
    return {
      needsClarification: true,
      clarifyingQuestion:
        params.language === "uz"
          ? "Qaysi mahsulot, mavzu, obraz yoki vazifa uchun ovozli ssenariy tayyorlash kerak?"
          : "Уточните, пожалуйста: для какого продукта, персонажа, темы или задачи нужно подготовить озвучку?",
      proposals: [],
    };
  }

  const hasInstructionsInInput = inputContainsDirectorInstructions(cleanTask);
  const userAskedForSingle = /(?:только\s+1\s+вариант|один\s+вариант|1\s+вариант|faqat\s+1\s+variant|bitta\s+variant|one\s+variant\s+only)/i.test(
    cleanTask
  );

  const targetLangDesc =
    params.language === "uz"
      ? "живой, естественный, разговорный узбекский язык (латиница, строго единый апостроф ' в o' и g', без канцелярита и машинного перевода)"
      : params.language === "ru"
        ? "живой, естественный, образный русский язык (как говорит живой человек/актёр, без канцелярита и шаблонов)"
        : "natural, authentic, living human English";

  const compactCharacterCatalogJson = JSON.stringify(getCompactCharacterCatalogForAgent());

  const systemInstruction = `Ты — профессиональный автономный AI-режиссёр озвучки и саунд-директор мирового уровня в OvozStudio.
Ты умеешь работать с ЛЮБОЙ из 100 000+ категорий аудиозадач: реклама, дубляж мультфильмов и сказок, озвучка анимационных персонажей, тайминг-сценарии по секундам (Reels/Shorts/TikTok/YouTube), документалистика, аудиокниги, подкасты, медитации, стендап, сторителлинг, обучение, IVR, презентации и всё остальное.

Целевой язык озвучки: ${targetLangDesc}.

=== КАТАЛОГ ПЕРСОНАЖЕЙ МУЛЬТФИЛЬМОВ (ТОЛЬКО для audience = "kids_cartoon") ===
${compactCharacterCatalogJson}

=== ГЛАВНЫЙ ЗАКОН №0: ОПРЕДЕЛЕНИЕ АУДИТОРИИ И ПОДБОР ПЕРСОНАЖА МУЛЬТФИЛЬМА ===
1. Определи decision.audience:
   - "kids_cartoon" — если задача про мультфильм (multfilm), сказку (ertak), сказку на ночь (uxlashdan oldin), мультяшного героя, зверька/зайчика/медвежонка, весёлую/нежную девочку-героиню, озорного/смелого мальчика-героя или детскую сценку.
   - "general" — для всего остального (реклама ресторана/магазина/услуг, новости, бизнес, подкаст, взрослая история, инструкция). При audience = "general" НЕ заполняй characterVoiceId (оставь пустой строкой "").
2. Правила выбора characterVoiceId при audience = "kids_cartoon":
   - Сопоставляй пол/роль и темперамент строго по каталогу выше:
     * весёлая/радостная девочка-героиня (quvnoq qizcha) → "qizcha_quvnoq"
     * застенчивая/мягкая/нежная девочка (mayin qizcha) → "qizcha_mayin"
     * озорной/шаловливый мальчик (sho'x bola) → "bola_shox"
     * смелый/отважный мальчик-герой (jasur bola) → "bola_jasur"
     * смешной зверёк/зайчик/маленькое существо (mitti qahramon / kulgili) → "mitti_qahramon"
     * сказка / сказка на ночь / рассказчик сказок (ertak / uxlashdan oldin) → "ertak_hikoyachi"
   - Если конкретный персонаж/пол УКАЗАН в задании (например, «quvnoq qizcha», «sho'x bola», «ertak uxlashdan oldin») — ВСЕ 3 варианта используют этого персонажа (один и тот же characterVoiceId), но с разной актёрской подачей, ритмом и сюжетным углом!
   - Если персонаж и пол НЕ указаны (например, просто «придумай короткую сценку для мультфильма») — предложи 3 варианта с РАЗНЫМИ персонажами из каталога (например, девочка / мальчик / сказочник или зверёк).
   - В decision.reasonShort обязательно коротко поясни выбор персонажа, например: «Весёлая девочка-героиня → qizcha_quvnoq» или «Сказка на ночь → ertak_hikoyachi».
   - Стиль текста для audience = "kids_cartoon": короткие живые фразы, добрый светлый тон, естественные <laugh>, <short pause>, [pauza 1s].
3. СТРОГАЯ ПОЛИТИКА GOOGLE (НИКОГДА НЕ НАРУШАТЬ):
   - В полях deliveryStyle, directorStyle и segments[].style НИКОГДА не пиши возраст и детские ярлыки голоса: ЗАПРЕЩЕНЫ слова "child", "kid", "kids", "toddler", "baby", "years old", "8 yosh", "yosh bola", "bola ovozi", "ребёнок", "ребенка", "детский голос", "N лет", "N yosh"!
   - Персонажей мультфильмов озвучивают взрослые актёры дубляжа: всегда описывай подачу на английском как "animated cartoon character voice" / "animated cartoon character" с нужными эмоциями и ритмом!

=== ГЛАВНЫЙ ЗАКОН №1: ЖЁСТКОЕ РАЗДЕЛЕНИЕ «ИНСТРУКЦИЯ» VS «ПРОИЗНОСИМЫЙ ТЕКСТ» ===
Пользователь может прислать что угодно:
- подробное ТЗ с таймкодами («0:00–0:05 говори тихо и загадочно: ...», «на 10-й секунде ускорься и улыбнись...»),
- список указаний («говори как живой человек, не как робот, сделай паузу 2 секунды, интонация тёплая...»),
- сценарий дубляжа с описанием персонажа/эмоций/голоса,
- обычное описание идеи своими словами,
- или просто чистый готовый текст.

ТВОЯ ПЕРВАЯ МЫСЛИТЕЛЬНАЯ ЗАДАЧА: отделить ВСЁ, что является указанием, описанием, таймкодом, сценической ремаркой или мета-текстом, от того, что диктор РЕАЛЬНО произнесёт вслух в микрофон!
- В поле "text" (и в "segments[].text") НИКОГДА НЕ ДОЛЖНО БЫТЬ:
  * инструкций пользователя («на 5 секунде говори спокойнее», «озвучь как живой человек», «сделай рекламу...»),
  * таймкодов («0:00-0:05», «00:12», «0-5 сек»),
  * меток и ремарок («Сцена 1:», «Диктор:», «Интонация:», «(тихим голосом)», «(с улыбкой)», «(пауза 2 сек)»).
- Вместо этого ВСЕ указания пользователя о том, КАК говорить, с какой эмоцией, в каком темпе, каким характером голоса и на какой секунде менять подачу, ТЫ ПЕРЕВОДИШЬ В:
  1. "deliveryStyle" и "directorStyle" — подробную, живую актёрскую установку на английском для модели Gemini 3.8 TTS (характер, теплота, дыхание, интонационная дуга, динамика — чтобы звучало 100% живо, без роботизированности!).
  2. "segments" — массив актёрских битов [{ timecode, style, text }], ЕСЛИ в задании есть таймкоды (секунды), смены настроения/темпа или несколько смысловых этапов! Каждому сегменту задай свой конкретный "style" и чистый произносимый "text".
  3. Вокальные и временные теги ВНУТРИ произносимого текста (СТРОГО АНГЛИЙСКИЕ для дыхания/эмоций и строго [pauza Ns] для длинных пауз):
     - <short pause> и <breath> — естественные микропаузы и живое дыхание;
     - <sigh> и <laugh> — лёгкий вздох или живая улыбка/смешок, если уместно по смыслу;
     - [pauza 1s], [pauza 2s], [pauza 3s] — точные студийные паузы 1–3 секунды между мыслями/этапами/таймкодами.

=== ГЛАВНЫЙ ЗАКОН №2: ВСЕГДА ПРЕДЛАГАЙ РАЗНЫЕ РЕЖИССЁРСКИЕ ВАРИАНТЫ («МОЖЕМ СДЕЛАТЬ ТАК, ТАК ИЛИ ТАК») ===
Пользователь приходит к AI-Режиссёру за МЫШЛЕНИЕМ и ВЫБОРОМ, а не за слепым копированием.
- По умолчанию ВСЕГДА предлагай 3 принципиально разных режиссёрских варианта (variantsCount = 3):
  * ЕСЛИ пользователь прислал подробную инструкцию, тайминг-сценарий или реплики с указаниями (workflow = "direct"):
    - Вариант 1 («Точно по вашей режиссуре»): бережно сохраняет смысл, ключевые реплики и тайминг пользователя, полностью очищая текст от инструкций/таймкодов и переводя КАЖДОЕ его указание по секундам/эмоциям в живой "deliveryStyle"/"directorStyle", "segments" и паузы.
    - Вариант 2 («Живая человеческая подача»): адаптирует фразировку так, чтобы она звучала максимально органично, как спонтанная живая речь (с естественным дыханием <breath>, ритмом и вовлечением).
    - Вариант 3 («Выразительный / креативный угол»): предлагает смелую альтернативную трактовку (другой эмоциональный акцент, более сильный хук или характерная актёрская подача).
  * ЕСЛИ пользователь дал открытую задачу (workflow = "create" или "expand") в ЛЮБОЙ категории (реклама, мультфильм, сказка, дубляж, история, обучение, подкаст и т.д.):
    - Создай 3 по-настоящему разных варианта с разными заходами, композицией, ритмом и актёрской подачей.
  * ИСКЛЮЧЕНИЕ (variantsCount = 1): возвращай 1 вариант ТОЛЬКО если:
    1) пользователь сам явно написал «дай только 1 вариант» / «сделай один вариант», ИЛИ
    2) пользователь вставил большой (>250 слов) полностью готовый чистый текст/процедуру БЕЗ каких-либо режиссёрских инструкций и просит лишь расставить паузы (workflow = "format").

=== ГЛАВНЫЙ ЗАКОН №3: КАК ЗВУЧАТЬ ЖИВО, А НЕ КАК РОБОТ ===
- Пиши тексты ДЛЯ УХА, а не для бумаги: короткие живые фразы, естественные интонационные перепады, разговорный ритм, уместные <breath> и <short pause>.
- Потолка в 60 секунд НЕТ — соблюдай длительность из задания/таймкодов или естественный объём задачи (~2.2 слова/сек + паузы).
- НИКОГДА не выдумывай номера телефонов (+998 90 ...), адреса или цены! В коммерческой рекламе при отсутствии контактов ставь [telefon], [manzil], [narx]; в некоммерческих жанрах (включая мультфильмы и сказки) эти теги НЕ вставляй.
- Если в задании вообще нет сути (например, просто два слова «сделай рекламу») -> needsClarification: true, один короткий вопрос, proposals: [].`;

  const response = await ai.models.generateContent({
    model: TTS_MODELS_CONFIG.textModel,
    contents: `Ввод пользователя (внимательно отдели инструкции/таймкоды/пожелания от произносимого текста и предложи режиссёрские варианты):\n"""\n${cleanTask}\n"""`,
    config: {
      systemInstruction,
      thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
      responseMimeType: "application/json",
      responseSchema: AUTONOMOUS_AGENT_SCHEMA,
    },
  });

  const parsed = JSON.parse((response.text || "{}").trim());

  if (
    parsed.needsClarification &&
    (!Array.isArray(parsed.proposals) || parsed.proposals.length === 0)
  ) {
    return {
      needsClarification: true,
      clarifyingQuestion:
        String(parsed.clarifyingQuestion || "").trim() ||
        "Уточните, пожалуйста, для какого продукта, персонажа, темы или задачи нужна озвучка?",
      proposals: [],
    };
  }

  const rawDecision = parsed.decision || {};
  const audience: TtsAudience =
    rawDecision.audience === "kids_cartoon" ? "kids_cartoon" : "general";
  let workflow: TtsAgentWorkflow =
    rawDecision.workflow === "direct" ||
    rawDecision.workflow === "format" ||
    rawDecision.workflow === "expand"
      ? rawDecision.workflow
      : "create";

  // Если во входе явно были режиссёрские инструкции/таймкоды — это никогда не слепой verbatim "format"
  if (workflow === "format" && hasInstructionsInInput) {
    workflow = "direct";
  }

  const targetSeconds = Math.max(0, Math.round(Number(rawDecision.targetSeconds) || 0));
  const decision: TtsAgentDecision = {
    genre: String(rawDecision.genre || "Озвучка").trim(),
    audience,
    workflow,
    variantsCount: Math.max(
      1,
      Math.min(
        3,
        Number(rawDecision.variantsCount) ||
          (Array.isArray(parsed.proposals) ? parsed.proposals.length : 1)
      )
    ),
    targetSeconds,
    reasonShort: String(rawDecision.reasonShort || "").trim(),
  };

  let rawProposals: any[] = Array.isArray(parsed.proposals)
    ? parsed.proposals.slice(0, 3)
    : [];

  const isCommercialAd = /(реклам|промо|акци|скидк|магазин|услуг|instagram|reels|reklama|sotuv|aksiya)/i.test(
    `${decision.genre} ${cleanTask}`
  );

  // =========================================================================
  // ДЕТЕКТОР И ЧИСТКА (БЕЗ разрушительного возврата сырых инструкций!)
  // =========================================================================
  const sanitizeSpokenText = (rawTxt: string): string => {
    let txt = stripLeakedStageDirections(String(rawTxt || "").trim());
    txt = enforceAllowedPauseAndVocalTags(txt);
    if (params.language === "uz") {
      txt = normalizeUzbekApostrophes(txt);
    }
    txt = stripHallucinatedContacts(txt, cleanTask, isCommercialAd);

    // Строгое 1:1 совпадение с cleanTask применяем ТОЛЬКО если это чистый текст без инструкций (workflow === "format" && !hasInstructionsInInput)
    if (workflow === "format" && !hasInstructionsInInput && inputWords >= 30) {
      if (!verifyWordsUnchanged(cleanTask, txt)) {
        // Не ломаем текст, но сохраняем хотя бы чистую основу
        return params.language === "uz" ? normalizeUzbekApostrophes(cleanTask) : cleanTask;
      }
    }
    return txt;
  };

  const invalidCharacterWarnings: string[] = [];

  rawProposals = rawProposals.map((p) => {
    const rawSegments: any[] = Array.isArray(p?.segments) ? p.segments : [];
    const rawStyle = String(p?.deliveryStyle || p?.directorStyle || "").trim();
    const safeStyle = sanitizeStyleForGooglePolicy(rawStyle);

    const cleanedSegments: TtsDirectorSegment[] = rawSegments
      .map((seg) => {
        const segText = sanitizeSpokenText(seg?.text || "");
        const segStyle = sanitizeStyleForGooglePolicy(
          String(seg?.style || safeStyle || "").trim()
        );
        const timecode = seg?.timecode ? String(seg.timecode).trim() : undefined;
        return {
          ...(timecode ? { timecode } : {}),
          style: segStyle,
          text: segText,
        };
      })
      .filter((seg) => seg.text.length > 0);

    // Если есть валидные сегменты, синхронизируем полный текст карточки с ними, чтобы на экране и в TTS было 1:1
    const baseText =
      cleanedSegments.length > 0
        ? cleanedSegments.map((s) => s.text).join("\n\n")
        : sanitizeSpokenText(p?.text || "");

    // Код-гвард: проверяем characterVoiceId по каталогу (только при audience === "kids_cartoon")
    let validatedCharacterVoiceId: string | undefined = undefined;
    const rawCharId = String(p?.characterVoiceId || "").trim();
    if (audience === "kids_cartoon" && rawCharId) {
      const found = getCharacterVoiceById(rawCharId);
      if (found) {
        validatedCharacterVoiceId = found.id;
      } else {
        invalidCharacterWarnings.push(rawCharId);
      }
    }

    return {
      ...p,
      text: baseText,
      deliveryStyle: safeStyle,
      directorStyle: safeStyle,
      characterVoiceId: validatedCharacterVoiceId,
      segments: cleanedSegments.length > 0 ? cleanedSegments : undefined,
    };
  });

  if (invalidCharacterWarnings.length > 0) {
    const uniq = Array.from(new Set(invalidCharacterWarnings)).join(", ");
    const warnNote =
      params.language === "uz"
        ? `Diqqat: "${uniq}" qahramon katalogda topilmadi — standart ovoz tanlandi.`
        : `Внимание: персонаж "${uniq}" не найден в каталоге — выбран стандартный взрослый голос.`;
    decision.reasonShort = decision.reasonShort
      ? `${decision.reasonShort} (${warnNote})`
      : warnNote;
  }

  // Если пользователь не просил 1 вариант и задача не огромный чистый verbatim-текст,
  // а модель вернула 2–3 слишком похожих варианта (>75% Jaccard) — один раз усиливаем разнообразие
  if (
    !userAskedForSingle &&
    workflow !== "format" &&
    rawProposals.length >= 2
  ) {
    let maxSim = 0;
    for (let i = 0; i < rawProposals.length; i++) {
      for (let j = i + 1; j < rawProposals.length; j++) {
        maxSim = Math.max(
          maxSim,
          computeTextSimilarity(rawProposals[i].text, rawProposals[j].text)
        );
      }
    }

    // Для "direct" допускаем умеренное сходство (т.к. Вариант 1 следует точным репликам ТЗ),
    // но если варианты почти клоны (>85%) или в "create" (>72%), переписываем #2/#3 для живого выбора
    const simThreshold = workflow === "direct" ? 0.85 : 0.72;
    if (maxSim > simThreshold) {
      try {
        const diffResp = await ai.models.generateContent({
          model: TTS_MODELS_CONFIG.textModel,
          contents: `Варианты #2${rawProposals.length >= 3 ? " и #3" : ""} получились слишком похожими на вариант #1 (сходство ${Math.round(maxSim * 100)}%).
Перепиши их так, чтобы пользователь действительно получил выбор «можно сделать так, так или так» — с разными интонациями, формулировками, живым ритмом и разными актёрскими подачами (directorStyle).
Важно: в тексте ТОЛЬКО произносимые вслух слова (никаких таймкодов и инструкций!). В directorStyle (на английском) НЕ используй слова про возраст ребёнка (используй "animated cartoon character" для мультфильмов).
Исходное задание: "${cleanTask.slice(0, 1200)}"
Вариант #1 (оставь как ориентир): "${rawProposals[0].text.slice(0, 900)}"
Язык: ${targetLangDesc}.`,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                alternatives: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      text: { type: Type.STRING },
                      directorStyle: { type: Type.STRING },
                    },
                    required: ["text", "directorStyle"],
                  },
                },
              },
              required: ["alternatives"],
            },
          },
        });
        const diffParsed = JSON.parse((diffResp.text || "{}").trim());
        if (Array.isArray(diffParsed.alternatives)) {
          for (let i = 1; i < rawProposals.length; i++) {
            const alt = diffParsed.alternatives[i - 1];
            const altText = sanitizeSpokenText(alt?.text || "");
            if (altText) {
              rawProposals[i].text = altText;
              rawProposals[i].segments = undefined; // сбросить старые сегменты, чтобы не расходились с новым текстом
              if (alt?.directorStyle) {
                const safeAltStyle = sanitizeStyleForGooglePolicy(
                  String(alt.directorStyle).trim()
                );
                rawProposals[i].directorStyle = safeAltStyle;
                rawProposals[i].deliveryStyle = safeAltStyle;
              }
            }
          }
        }
      } catch {}
    }
  }

  const validPresets = new Set(["conversational", "confident", "energetic", "warm"]);

  const proposals: TtsAgentProposal[] = rawProposals
    .filter((p) => String(p?.text || "").trim().length > 0)
    .map((p, idx) => {
      const cleanText = p.text;
      const { wordCount, pauseTotalSeconds, estimatedSeconds, placeholders } =
        computeWordAndDurationStats(cleanText);
      const presetRaw = String(p?.preset || p?.recommendedPreset || "conversational").toLowerCase();
      const resolvedPreset = (
        validPresets.has(presetRaw)
          ? presetRaw
          : idx === 1
            ? "conversational"
            : idx === 2
              ? "energetic"
              : "warm"
      ) as TtsAgentProposal["preset"];

      const fallbackDirectorStyle =
        audience === "kids_cartoon"
          ? "Expressive animated cartoon character delivery, warm, playful, lively natural phrasing"
          : "Authentic, natural living human speaker with organic breathing, warm emotional presence, subtle pitch dynamics and effortless phrasing — never flat or robotic";

      const finalDeliveryStyle = sanitizeStyleForGooglePolicy(
        String(p?.deliveryStyle || p?.directorStyle || fallbackDirectorStyle).trim()
      );

      return {
        id: String(p?.id || `prop-${idx + 1}`),
        title: String(
          p?.title ||
            (rawProposals.length === 1
              ? "Режиссёрский сценарий"
              : idx === 0
                ? "Вариант 1 · По вашей режиссуре"
                : idx === 1
                  ? "Вариант 2 · Живая разговорная подача"
                  : "Вариант 3 · Выразительный угол")
        ).trim(),
        badge: String(
          p?.badge ||
            (idx === 0
              ? "По ТЗ"
              : idx === 1
                ? "Живой"
                : "Креативный")
        ).trim(),
        text: cleanText,
        directorStyle: finalDeliveryStyle,
        deliveryStyle: finalDeliveryStyle,
        ...(p?.characterVoiceId ? { characterVoiceId: p.characterVoiceId } : {}),
        ...(Array.isArray(p?.segments) && p.segments.length > 0
          ? { segments: p.segments }
          : {}),
        preset: resolvedPreset,
        recommendedPreset: resolvedPreset,
        recommendedVoiceId: String(p?.recommendedVoiceId || params.voiceId || "ulugbek-history"),
        reason: String(p?.reason || "Живая естественная подача и продуманный ритм").trim(),
        estimatedSeconds,
        wordCount,
        pauseTotalSeconds,
        placeholders,
      };
    });

  decision.variantsCount = proposals.length;
  if (!decision.reasonShort) {
    const avgSec =
      proposals.length > 0
        ? Math.round(proposals.reduce((a, b) => a + b.estimatedSeconds, 0) / proposals.length)
        : targetSeconds;
    decision.reasonShort = `${decision.genre}, ~${avgSec} с, ${proposals.length} ${
      proposals.length === 1 ? "вариант" : "варианта"
    }`;
  }

  return {
    decision,
    needsClarification: false,
    proposals,
  };
}

/**
 * Доработка выбранной карточки по короткой фразе («короче», «живее как человек», «паузы по 2 секунды», «сделай мягче»).
 * Обновляет как произносимый текст (без утечек инструкций), так и актёрскую режиссуру directorStyle.
 */
export async function refineTtsAgentProposal(
  ai: GoogleGenAI,
  params: {
    proposalText: string;
    directorStyle?: string;
    instruction: string;
    language: "uz" | "ru" | "en";
  }
): Promise<{
  refinedText: string;
  directorStyle?: string;
  wordCount: number;
  pauseTotalSeconds: number;
  estimatedSeconds: number;
  placeholders: string[];
}> {
  const baseText = (params.proposalText || "").trim().slice(0, TTS_MODELS_CONFIG.maxTextChars);
  const instruction = (params.instruction || "").trim().slice(0, 1000);

  const targetLangDesc =
    params.language === "uz"
      ? "живой разговорный узбекский язык (латиница, апостроф ' в o' и g')"
      : params.language === "ru"
        ? "естественный живой русский язык"
        : "natural conversational English";

  const response = await ai.models.generateContent({
    model: TTS_MODELS_CONFIG.textModel,
    contents: `Исходный произносимый текст:\n"""\n${baseText}\n"""\n${
      params.directorStyle ? `\nТекущая режиссура подачи (directorStyle): "${params.directorStyle}"\n` : ""
    }\nКоманда пользователя на доработку: "${instruction}"`,
    config: {
      systemInstruction: `Ты — AI-режиссёр озвучки OvozStudio (${targetLangDesc}).
Выполни команду пользователя над исходным текстом и режиссурой подачи.
Правила:
- В refinedText пиши СТРОГО ТОЛЬКО произносимые вслух слова — НИКАКИХ инструкций, таймкодов и ремарок в скобках!
- В directorStyle (на английском) обнови актёрскую подачу так, чтобы голос звучал как живой человек с учётом новой команды.
- Короткие паузы и дыхание: только английские теги <short pause>, <breath>, <sigh>, <laugh>.
- Точные длинные паузы: только [pauza 1s], [pauza 2s], [pauza 3s].
- Потолка в 60 секунд нет.
- Не выдумывай телефоны, адреса и цены.`,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          refinedText: { type: Type.STRING },
          directorStyle: { type: Type.STRING },
        },
        required: ["refinedText", "directorStyle"],
      },
    },
  });

  const parsed = JSON.parse((response.text || "{}").trim());
  const cleaned = stripLeakedStageDirections(String(parsed.refinedText || baseText).trim());
  const rawOut = enforceAllowedPauseAndVocalTags(cleaned);
  const refinedText =
    params.language === "uz" ? normalizeUzbekApostrophes(rawOut) : rawOut;
  const directorStyle =
    sanitizeStyleForGooglePolicy(
      String(parsed.directorStyle || params.directorStyle || "").trim()
    ) || undefined;
  const stats = computeWordAndDurationStats(refinedText);

  return {
    refinedText,
    directorStyle,
    ...stats,
  };
}
