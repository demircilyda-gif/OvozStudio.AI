import { GoogleGenAI, Type } from "@google/genai";
import { TTS_MODELS_CONFIG } from "../../config/ttsModels.ts";
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
} from "../../../src/types/tts.ts";

const TIMED_PAUSE_TAG_EXACT_REGEX = /^\[pauza\s+([1-3])s\]$/i;
const TIMED_PAUSE_TAG_ANY_REGEX = /\[pauza\s+(\d+(?:\.\d+)?)s\]/gi;

export function isTimedPauseBracketToken(token: string): boolean {
  const clean = canonicalizeTimedPauseTags(token || "").trim();
  return /^\[pauza\s+(\d+(?:\.\d+)?)s\]$/i.test(clean);
}

/**
 * Раздел 1.3 (п.1): Канонизирует паузы строго в [pauza 1s], [pauza 2s], [pauza 3s] (N от 1 до 3)
 * и оставляет только разрешённые английские вокальные теги (<short pause>, <breath>, <sigh>, <laugh>).
 */
export function enforceAllowedPauseAndVocalTags(text: string): string {
  const withCanonicalPauses = canonicalizeTimedPauseTags(text || "")
    .replace(/([oOgG])[\u02BB\u02BC\u2018\u2019`´]/g, "$1'")
    .replace(
      TIMED_PAUSE_TAG_ANY_REGEX,
      (_m, numStr) => {
        const n = Math.max(1, Math.min(3, Math.round(parseFloat(numStr) || 1)));
        return `[pauza ${n}s]`;
      }
    );
  return sanitizeAllowedAutoTags(withCanonicalPauses);
}

/**
 * Раздел 1.3 (п.4): Проверяет отсутствие выдуманных телефонов, адресов/ссылок и цен, которых не было в задании.
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

  return cleaned.replace(/\s{2,}/g, " ").trim();
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
 * Раздел 1.3: Вычисляет Jaccard-сходство двух текстов (0..1) для проверки разнообразия 3 вариантов.
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
            "Detected genre (e.g. 'Реклама', 'Приветствие / IVR', 'Поздравление', 'Рассказ / Монолог', 'Инструкция / Процедура', 'Reels').",
        },
        workflow: {
          type: Type.STRING,
          description: "Exactly one of: 'create', 'format', 'expand'.",
        },
        variantsCount: {
          type: Type.INTEGER,
          description: "Number of variants returned: 1, 2, or 3.",
        },
        targetSeconds: {
          type: Type.INTEGER,
          description:
            "Target audio duration in seconds (from prompt, genre default, or full natural length for long texts; 0 if purely determined by pasted text).",
        },
        reasonShort: {
          type: Type.STRING,
          description:
            "One short human-readable summary in the UI/task language, e.g. 'Рекламный текст для Instagram, ~20 с, 3 варианта' or 'Готовая процедура с паузами 1–3 с, 1 вариант'.",
        },
      },
      required: ["genre", "workflow", "variantsCount", "targetSeconds", "reasonShort"],
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
          title: { type: Type.STRING },
          badge: { type: Type.STRING },
          text: {
            type: Type.STRING,
            description:
              "Ready-to-voice script. Short intra-phrase pauses: ONLY <short pause> and <breath>. Exact pauses: ONLY [pauza 1s], [pauza 2s], [pauza 3s] where needed by meaning or requested.",
          },
          preset: {
            type: Type.STRING,
            description: "One of: conversational, confident, energetic, warm",
          },
          recommendedVoiceId: {
            type: Type.STRING,
            description:
              "Recommended voice id from catalog, e.g. ulugbek-history, aziza-ai, jasur-business, dilnoza-blogger, shahnoza-speech, rayhon-art.",
          },
          reason: {
            type: Type.STRING,
            description: "One short sentence explaining the choice of tone, pacing, and pauses.",
          },
        },
        required: ["id", "title", "badge", "text", "preset", "recommendedVoiceId", "reason"],
      },
    },
  },
  required: ["decision", "needsClarification", "proposals"],
};

/**
 * Разделы 1.2 и 1.3: Полностью автономный AI-Агент (1 вызов gemini-4-hydrogen с responseSchema)
 * + детерминированная самопроверка кодом (без лишних вызовов модели).
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

  // Раздел 1.1: Лимит поля 3 000 слов (~20 минут речи)
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
          ? "Qaysi mahsulot, mavzu, jarayon yoki tadbir uchun ovozli matn tayyorlash kerak?"
          : "Уточните, пожалуйста: для какого продукта, темы, события или текста нужно подготовить озвучку?",
      proposals: [],
    };
  }

  const targetLangDesc =
    params.language === "uz"
      ? "живой естественный узбекский язык (латиница, строго единый апостроф ' в o' и g', без канцелярита)"
      : params.language === "ru"
        ? "живой естественный русский язык (разговорная дикторская подача, без канцелярита)"
        : "natural conversational studio English";

  const systemInstruction = `Ты — автономный AI-режиссёр озвучки OvozStudio. Пользователь дал тебе обычное задание в одном поле ввода без дополнительных настроек. ТЫ САМ принимаешь все режиссёрские решения.

Целевой язык озвучки: ${targetLangDesc}.

ПРАВИЛА АВТОНОМНОГО ПРИНЯТИЯ РЕШЕНИЙ (заполни объект decision):
1. ТИП ЗАДАНИЯ (decision.workflow):
   - "format": если пользователь вставил готовый текст/процедуру/объявление/рассказ и просит его озвучить, оформить или расставить паузы — ТОЛЬКО расставь теги пауз и дыхания, НЕ МЕНЯЙ, НЕ ДОБАВЛЯЙ И НЕ УДАЛЯЙ НИ ОДНОГО СЛОВА исходного текста!
   - "expand": если пользователь дал короткий текст/тезисы и явно просит «подробнее», «разверни», «дополни», «сделай большой рассказ».
   - "create": если пользователь описал тему или задачу своими словами.
2. ЧИСЛО ВАРИАНТОВ (decision.variantsCount и длина массива proposals):
   - Открытая задача (реклама, приветствие, Reels, объявление, поздравление) -> 3 принципиально разных варианта с разной подачей, заходом и структурой (НЕ копируй один текст трижды!).
   - Готовый текст ("format"), длинная процедура, инструкция или явный запрос на «один монолог/рассказ» -> 1 цельный мастер-вариант.
   - Если пользователь сам назвал число вариантов («дай 2 варианта», «сделай 1 вариант») -> верни ровно столько.
3. ДЛИТЕЛЬНОСТЬ (decision.targetSeconds):
   - Бери из задания («20 секунд», «на 2 минуты»).
   - Если не указана — подбирай по жанру: реклама 15–30 с, приветствие/автоответчик 10–15 с, поздравление 20–40 с, инструкция/процедура/рассказ — по полному естественному объёму (ПОТОЛКА В 60 СЕКУНД НЕТ!). Скорость речи ~2.2 слова/сек + паузы.
4. ПАУЗЫ И ТЕГИ (СТРОГО АНГЛИЙСКИЕ ТЕГИ):
   - Короткие паузы и дыхание внутри фраз: ТОЛЬКО английские теги <short pause> и <breath> (допустимы также <sigh>, <laugh> если уместно). НИКОГДА не пиши русские теги в угловых скобках!
   - Точные длинные паузы: ТОЛЬКО [pauza 1s], [pauza 2s], [pauza 3s] (N от 1 до 3) — ставь только там, где они нужны по смыслу (между шагами процедуры, абзацами, сменой темы) или если пользователь сам просит паузы.
5. ЧЕГО НЕ ХВАТАЕТ И ЗАПРЕТ НА ВЫДУМКУ:
   - Если задачу невозможно выполнить без сути/названия (например, «сделай рекламу» без предмета) -> needsClarification: true, один короткий вопрос, proposals: [].
   - НИКОГДА не выдумывай номера телефонов (+998 90 123-45-67), адреса или цены! Если это коммерческая реклама и в задании нет контакта/цены — поставь строго [telefon], [manzil], [narx]. В некоммерческие тексты (рассказы, процедуры, поздравления, монологи) [telefon]/[manzil]/[narx] НЕ вставляй!
6. reasonShort:
   - Одна короткая понятная строка о твоём решении, например: «Рекламный текст для Instagram, ~20 с, 3 варианта» или «Готовая процедура с паузами 1–3 с, 1 вариант».`;

  const response = await ai.models.generateContent({
    model: TTS_MODELS_CONFIG.textModel,
    contents: `Задание пользователя:\n"""\n${cleanTask}\n"""`,
    config: {
      systemInstruction,
      thinkingConfig: { thinkingLevel: TTS_MODELS_CONFIG.textThinkingLevel },
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
        "Уточните, пожалуйста, о каком продукте, теме или событии должна быть озвучка?",
      proposals: [],
    };
  }

  const rawDecision = parsed.decision || {};
  const workflow: TtsAgentWorkflow =
    rawDecision.workflow === "format" || rawDecision.workflow === "expand"
      ? rawDecision.workflow
      : "create";
  const targetSeconds = Math.max(0, Math.round(Number(rawDecision.targetSeconds) || 0));
  const decision: TtsAgentDecision = {
    genre: String(rawDecision.genre || "Озвучка").trim(),
    workflow,
    variantsCount: Math.max(1, Math.min(3, Number(rawDecision.variantsCount) || (Array.isArray(parsed.proposals) ? parsed.proposals.length : 1))),
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
  // Раздел 1.3: САМОПРОВЕРКА КОДОМ (без лишних вызовов модели)
  // =========================================================================

  // 1.3 (п.1, 2, 3, 4): нормализация тегов, апострофов, проверка format (0 изменённых слов) и запрет выдуманных телефонов
  const sanitizeProposalText = (rawTxt: string): string => {
    let txt = enforceAllowedPauseAndVocalTags(String(rawTxt || "").trim());
    if (params.language === "uz") {
      txt = normalizeUzbekApostrophes(txt);
    }
    txt = stripHallucinatedContacts(txt, cleanTask, isCommercialAd);

    // Для типа format: текст без тегов ДОЛЖЕН 1:1 совпадать с исходным. Если не совпал — разметка отбрасывается!
    if (workflow === "format") {
      if (!verifyWordsUnchanged(cleanTask, txt)) {
        return params.language === "uz" ? normalizeUzbekApostrophes(cleanTask) : cleanTask;
      }
    }
    return txt;
  };

  rawProposals = rawProposals.map((p) => ({
    ...p,
    text: sanitizeProposalText(p?.text || ""),
  }));

  // 1.3 (п.5): Длительность отличается от targetSeconds > 20% -> ровно 1 автоматическая переделка (только для create)
  if (workflow === "create" && targetSeconds >= 10 && targetSeconds <= 180 && rawProposals.length > 0) {
    const minSec = targetSeconds * 0.8;
    const maxSec = targetSeconds * 1.2;
    const targetWords = Math.max(8, Math.round(targetSeconds * TTS_MODELS_CONFIG.wordsPerSecondEstimate));
    const outOfRangeIdx: number[] = [];

    rawProposals.forEach((p, idx) => {
      const { estimatedSeconds } = computeWordAndDurationStats(p.text);
      if (estimatedSeconds < minSec || estimatedSeconds > maxSec) {
        outOfRangeIdx.push(idx);
      }
    });

    if (outOfRangeIdx.length > 0) {
      try {
        const listStr = outOfRangeIdx
          .map((i) => `Вариант #${i + 1} (${rawProposals[i]?.title}): "${rawProposals[i]?.text}"`)
          .join("\n\n");

        const rewriteResp = await ai.models.generateContent({
          model: TTS_MODELS_CONFIG.textModel,
          contents: `Скорректируй объём указанных вариантов для задачи "${cleanTask.slice(0, 600)}", чтобы каждый звучал около ${targetSeconds} сек (~${targetWords} слов при 2.2 слова/сек, допуск ±15%). Сохрани язык, теги (<short pause>, <breath>, [pauza 1s/2s/3s]), смысл и уникальную подачу каждого варианта:\n\n${listStr}`,
          config: {
            thinkingConfig: { thinkingLevel: TTS_MODELS_CONFIG.textThinkingLevel },
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                rewrittenTexts: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
              required: ["rewrittenTexts"],
            },
          },
        });
        const rewritten = JSON.parse((rewriteResp.text || "{}").trim());
        if (Array.isArray(rewritten.rewrittenTexts)) {
          outOfRangeIdx.forEach((propIdx, k) => {
            const cand = String(rewritten.rewrittenTexts[k] || "").trim();
            if (cand) {
              rawProposals[propIdx].text = sanitizeProposalText(cand);
            }
          });
        }
      } catch {}
    }
  }

  // 1.3 (п.6): Второй вызов модели ТОЛЬКО для create и ТОЛЬКО если 3 варианта похожи > 70%
  if (workflow === "create" && rawProposals.length >= 2) {
    let maxSim = 0;
    for (let i = 0; i < rawProposals.length; i++) {
      for (let j = i + 1; j < rawProposals.length; j++) {
        maxSim = Math.max(maxSim, computeTextSimilarity(rawProposals[i].text, rawProposals[j].text));
      }
    }

    if (maxSim > 0.7) {
      try {
        const diffResp = await ai.models.generateContent({
          model: TTS_MODELS_CONFIG.textModel,
          contents: `Варианты получились слишком похожими друг на друга (сходство ${Math.round(maxSim * 100)}%). Перепиши варианты #2${rawProposals.length >= 3 ? " и #3" : ""} для задачи "${cleanTask.slice(0, 600)}" так, чтобы у каждого был принципиально другой заход, ритм и угол подачи (вариант #1 оставь как ориентир: "${rawProposals[0].text}"). Язык: ${targetLangDesc}.`,
          config: {
            thinkingConfig: { thinkingLevel: TTS_MODELS_CONFIG.textThinkingLevel },
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                distinctTexts: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
              required: ["distinctTexts"],
            },
          },
        });
        const diffParsed = JSON.parse((diffResp.text || "{}").trim());
        if (Array.isArray(diffParsed.distinctTexts)) {
          for (let i = 1; i < rawProposals.length; i++) {
            const alt = String(diffParsed.distinctTexts[i - 1] || "").trim();
            if (alt) {
              rawProposals[i].text = sanitizeProposalText(alt);
            }
          }
        }
      } catch {}
    }
  }

  const validPresets = new Set(["conversational", "confident", "energetic", "warm"]);

  const proposals: TtsAgentProposal[] = rawProposals.map((p, idx) => {
    const cleanText = p.text;
    const { wordCount, pauseTotalSeconds, estimatedSeconds, placeholders } =
      computeWordAndDurationStats(cleanText);
    const presetRaw = String(p?.preset || p?.recommendedPreset || "conversational").toLowerCase();
    const resolvedPreset = (
      validPresets.has(presetRaw)
        ? presetRaw
        : idx === 1
          ? "confident"
          : idx === 2
            ? "energetic"
            : "conversational"
    ) as TtsAgentProposal["preset"];

    return {
      id: String(p?.id || `prop-${idx + 1}`),
      title: String(p?.title || (rawProposals.length === 1 ? "Готовый сценарий" : `Вариант ${idx + 1}`)).trim(),
      badge: String(
        p?.badge ||
          (rawProposals.length === 1
            ? decision.genre
            : idx === 0
              ? "Разговорный"
              : idx === 1
                ? "Деловой"
                : "Энергичный")
      ).trim(),
      text: cleanText,
      preset: resolvedPreset,
      recommendedPreset: resolvedPreset,
      recommendedVoiceId: String(params.voiceId || p?.recommendedVoiceId || "ulugbek-history"),
      reason: String(p?.reason || "Оптимальная подача и ритмика").trim(),
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
 * Раздел 1.4: Доработка выбранной карточки по короткой фразе («короче», «спокойнее», «паузы по 2 секунды»).
 */
export async function refineTtsAgentProposal(
  ai: GoogleGenAI,
  params: {
    proposalText: string;
    instruction: string;
    language: "uz" | "ru" | "en";
  }
): Promise<{
  refinedText: string;
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
    contents: `Исходный текст:\n"""\n${baseText}\n"""\n\nКоманда на доработку: "${instruction}"`,
    config: {
      systemInstruction: `Ты — AI-режиссёр озвучки OvozStudio (${targetLangDesc}).
Выполни команду пользователя над исходным текстом.
Правила:
- Короткие паузы: только английские теги <short pause> и <breath> (также допустимы <sigh>, <laugh>).
- Точные паузы: только [pauza 1s], [pauza 2s], [pauza 3s].
- Потолка в 60 секунд нет.
- Не выдумывай телефоны, адреса и цены; не вставляй [telefon] если его не просили.`,
      thinkingConfig: { thinkingLevel: TTS_MODELS_CONFIG.textThinkingLevel },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          refinedText: { type: Type.STRING },
        },
        required: ["refinedText"],
      },
    },
  });

  const parsed = JSON.parse((response.text || "{}").trim());
  const rawOut = enforceAllowedPauseAndVocalTags(String(parsed.refinedText || baseText).trim());
  const refinedText =
    params.language === "uz" ? normalizeUzbekApostrophes(rawOut) : rawOut;
  const stats = computeWordAndDurationStats(refinedText);

  return {
    refinedText,
    ...stats,
  };
}
