import { GoogleGenAI, Type } from "@google/genai";
import { TTS_MODELS_CONFIG } from "../../config/ttsModels.ts";
import {
  normalizeUzbekApostrophes,
  canonicalizeTimedPauseTags,
} from "../../../src/utils/uzbekNormalizer.ts";
import type {
  TtsAgentProposal,
  TtsAgentProposeResponse,
  TtsAgentOutputMode,
  TtsAgentWorkflowMode,
  TtsPauseCadence,
} from "../../../src/types/tts.ts";

const TIMED_PAUSE_TAG_EXACT_REGEX = /^\[pauza\s+(\d+(?:\.\d+)?)s\]$/i;
const TIMED_PAUSE_TAG_GLOBAL_REGEX = /\[pauza\s+(\d+(?:\.\d+)?)s\]/gi;

/**
 * Проверяет, является ли выражение в квадратных скобках тегом паузы ([pauza 1s], [пауза 2 сек], [2s]),
 * а НЕ незаполненным плейсхолдером факта ([telefon], [manzil]).
 */
export function isTimedPauseBracketToken(token: string): boolean {
  const clean = canonicalizeTimedPauseTags(token || "").trim();
  return TIMED_PAUSE_TAG_EXACT_REGEX.test(clean);
}

/**
 * Подсчитывает слова, суммарное время пауз ([pauza 1s], [pauza 2s], [pauza 3s])
 * и общую длительность по правилу ~2.2 слова/сек + сумма пауз (без потолка в 60 секунд).
 */
export function computeWordAndDurationStats(text: string): {
  wordCount: number;
  pauseTotalSeconds: number;
  estimatedSeconds: number;
  placeholders: string[];
} {
  const canonical = canonicalizeTimedPauseTags(text || "").trim();

  // Суммируем длительность всех явных пауз [pauza Ns]
  let pauseTotalSeconds = 0;
  let match: RegExpExecArray | null;
  const pauseRegex = new RegExp(TIMED_PAUSE_TAG_GLOBAL_REGEX.source, "gi");
  while ((match = pauseRegex.exec(canonical)) !== null) {
    const sec = parseFloat(match[1]);
    if (!isNaN(sec) && sec > 0) {
      pauseTotalSeconds += sec;
    }
  }
  pauseTotalSeconds = Math.round(pauseTotalSeconds * 10) / 10;

  // Ищем только реальные плейсхолдеры пропущенных фактов ([telefon], [manzil] и т.д.), исключая [pauza Ns]
  const allBrackets = canonical.match(/\[[^\][]{1,40}\]/g) || [];
  const placeholders = Array.from(
    new Set(
      allBrackets
        .map((m) => m.trim())
        .filter((m) => !TIMED_PAUSE_TAG_EXACT_REGEX.test(m))
    )
  );

  // Для подсчёта произносимых слов убираем теги пауз [pauza Ns] и вокальные теги <...>
  const spokenOnly = canonical
    .replace(TIMED_PAUSE_TAG_GLOBAL_REGEX, " ")
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
 * Быстрая проверка: слишком ли пустое задание (нет ни сути, ни объекта, например просто «реклама» или «сделай озвучку»).
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
 * Определяет, просит ли пользователь в тексте задания один большой монолог/рассказ/процедуру или паузы 1-2-3 секунды.
 */
function detectTaskIntentHeuristics(task: string): {
  wantsSingleMonologue: boolean;
  wantsMeasuredPauses: boolean;
  explicitTargetWords: number | null;
} {
  const lower = (task || "").toLowerCase();
  const wantsSingleMonologue =
    /(монолог|рассказ|истори[яю]|процедур[ауы]|регламент|лекци[яю]|сказк[ау]|глав[ау]|повествовани|bitta\s+matn|hikoya|monolog|jarayon|tartib)/i.test(
      lower
    ) || task.trim().split(/\s+/).length > 120;

  const wantsMeasuredPauses =
    /(пауз[аыу]|pauza|pause|1\s*,\s*2\s*,\s*3|секунд[ыу]?|soniya)/i.test(lower);

  const wordMatch = lower.match(/(\d{2,5})\s*(?:слов|so'z|words)/i);
  const explicitTargetWords = wordMatch ? Math.min(10000, Math.max(20, parseInt(wordMatch[1], 10))) : null;

  return { wantsSingleMonologue, wantsMeasuredPauses, explicitTargetWords };
}

/**
 * Возвращает эталонную промпт-инженерную архитектуру AI-Режиссёра OvozStudio
 * (объединяющую лучшие практики ElevenLabs Studio, Hume Octave, Murf AI и Descript).
 */
export function buildAgentSystemPrompt(params: {
  language: "uz" | "ru" | "en";
  outputMode: TtsAgentOutputMode;
  workflowMode: TtsAgentWorkflowMode;
  pauseCadence: TtsPauseCadence;
  durationSec: number; // 0 = без ограничения (по объёму темы/процедуры, до 10 000 слов)
  explicitTargetWords: number | null;
  customSystemRules?: string;
}): string {
  const targetLangDesc =
    params.language === "uz"
      ? "живой разговорный литературно-естественный узбекский язык (латиница, апостроф ' в o' и g', без канцелярита и машинных калек)"
      : params.language === "ru"
        ? "живой естественный русский язык (разговорная дикторская подача, без штампов и канцелярита)"
        : "natural conversational studio English";

  const isUnlimited = params.durationSec <= 0;
  const targetWords = params.explicitTargetWords
    ? params.explicitTargetWords
    : isUnlimited
      ? 0
      : Math.round(params.durationSec * TTS_MODELS_CONFIG.wordsPerSecondEstimate);

  const minWords = targetWords > 0 ? Math.ceil(targetWords * 0.85) : 0;
  const maxWords = targetWords > 0 ? Math.floor(targetWords * 1.18) : 10000;

  const pauseInstruction =
    params.pauseCadence === "1_2_3s"
      ? `ПАРТИТУРА ТОЧНЫХ ПАУЗ (ОБЯЗАТЕЛЬНО):
- Внутри непрерывной речи расставляй точные тайминг-паузы в квадратных скобках: [pauza 1s], [pauza 2s], [pauza 3s].
- Правило чередования пауз:
  • [pauza 1s] — после короткой законченной мысли или перечисления внутри абзаца (чтобы слушатель усвоил деталь).
  • [pauza 2s] — между смысловыми абзацами, шагами процедуры или после риторического вопроса.
  • [pauza 3s] — перед ключевым выводом, сменой главы рассказа, кульминацией или новым этапом процедуры.
- Дополнительно используй микро-дыхание <breath> перед длинными фразами и <short pause> внутри сложных предложений.`
      : params.pauseCadence === "1s"
        ? `ПАРТИТУРА ПАУЗ:
- Между смысловыми блоками и важными фразами ставь точные паузы [pauza 1s] (и [pauza 2s] между крупными абзацами), а также естественное дыхание <breath>.`
        : params.pauseCadence === "none"
          ? `ПАРТИТУРА ПАУЗ:
- Не вставляй теги [pauza Ns], если пользователь явно не попросил об этом в тексте задачи.`
          : `ПАРТИТУРА ПАУЗ (АВТО-РЕЖИССУРА):
- Если пользователь просит паузы (например, 1, 2, 3 секунды) или если это монолог, рассказ, инструкция или процедура — обязательно расставляй точные студийные паузы [pauza 1s], [pauza 2s], [pauza 3s] между смысловыми частями и шагами!
- Аудио-движок синтезирует [pauza 1s], [pauza 2s], [pauza 3s] как настоящую студийную тишину ровно в 1, 2 и 3 секунды.`;

  const workflowInstruction =
    params.workflowMode === "format_procedure"
      ? `РЕЖИМ РАБОТЫ — ПОЛНАЯ ОБРАБОТКА ПРОЦЕДУРЫ / ТЕКСТА ПОЛЬЗОВАТЕЛЯ:
- Пользователь передал процедуру, регламент, сценарий или текст.
- СОХРАНИ 100% смысла, все шаги, все детали и последовательность процедуры! Ничего не выбрасывай и не урезай до 1 минуты.
- Преврати сухой текст в живую дикторскую речь, разбей на удобные для дыхания фразы и расставь точные паузы [pauza 1s], [pauza 2s], [pauza 3s] между шагами и мыслями.`
      : params.workflowMode === "expand_monologue"
        ? `РЕЖИМ РАБОТЫ — РАЗВЁРНУТЫЙ МОНОЛОГ / РАССКАЗ / СТОРИТЕЛЛИНГ:
- Напиши один глубокий, цельный, захватывающий монолог или рассказ с продуманной драматургией (завязка → развитие → кульминация → послевкусие).
- Используй кинематографичную ритмику речи: чередуй темп фраз и обязательно ставь студийные паузы [pauza 1s], [pauza 2s], [pauza 3s] для погружения слушателя.`
        : `РЕЖИМ РАБОТЫ — СЦЕНАРНЫЙ AI-АГЕНТ OVOZSTUDIO:
- Создай готовый к озвучке дикторский сценарий по заданию пользователя.`;

  const outputCountInstruction =
    params.outputMode === "single_monologue"
      ? `ФОРМАТ ВЫДАЧИ — РОВНО 1 ПОЛНЫЙ СЦЕНАРИЙ (proposals.length = 1):
- Верни в массиве proposals РОВНО 1 элемент — полный, глубоко проработанный мастер-текст (монолог, рассказ, процедуру или ролик). Не дроби ответ на 3 мелких варианта!`
      : `ФОРМАТ ВЫДАЧИ — 3 ВАРИАНТА ПОДАЧИ (proposals.length = 3):
- Если тон в задаче НЕ указан — выдай 3 разных тона: 1) Разговорный (conversational), 2) Деловой/уверенный (confident), 3) Энергичный/выразительный (energetic).
- Если тон в задаче УКАЗАН — все 3 варианта должны быть в этом тоне, но с разной композицией и заходом.`;

  const durationInstruction = isUnlimited
    ? `КОНТРОЛЬ ДЛИНЫ И ОБЪЁМА (БЕЗ ОГРАНИЧЕНИЯ В 60 СЕКУНД):
- Ограничения в 60 секунд НЕТ! Длина текста определяется полнотой раскрытия темы, процедуры или рассказа (вплоть до 10 000 слов).
- Если пользователь передал длинную процедуру или просит большой рассказ/монолог — пиши полный, подробный текст без сокращений.`
    : `КОНТРОЛЬ ДЛИНЫ И ТАЙМИНГА:
- Целевая длительность речи: ~${params.durationSec} секунд (скорость речи ~2.2 слова в секунду + время пауз [pauza Ns]).
- Целевой объём каждого сценария: от ${minWords} до ${maxWords} слов (оптимально около ${targetWords} слов).`;

  return `Ты — главный AI-режиссёр озвучки, сценарист и акустический продюсер OvozStudio (Prompt Engineering уровня ElevenLabs Studio / Hume Octave / Descript).
Язык сценария: ${targetLangDesc}.

${workflowInstruction}

${outputCountInstruction}

${pauseInstruction}

${durationInstruction}

ПРАВИЛА ПРОМПТ-ИНЖИНИРИНГА ДЛЯ ЖИВОЙ ОЗВУЧКИ (VOICE-FIRST COPYWRITING):
1. ПИШИ ДЛЯ УХА, А НЕ ДЛЯ БУМАГИ:
   - Каждая фраза должна легко произноситься на одном дыхании (7–15 слов).
   - Избегай канцелярских штампов, скобок, сложных причастных оборотов и табличных сокращений.
   - На узбекском языке используй живые разговорные связки («Bilasizmi», «Tasavvur qiling», «Keling, navbatdagi qadamga o'tamiz», «Eng muhimi shundaki»), правильный порядок слов и чистую латиницу с апострофом ' в o' и g'.
2. ЗАПРЕТ НА ЛИШНИЕ ПЛЕЙСХОЛДЕРЫ И «ТРИ ТЕЛЕФОНА»:
   - НИКОГДА не вставляй [telefon], [manzil], [narx] в рассказы, монологи, процедуры, инструкции, истории или поздравления!
   - Плейсхолдеры вроде [telefon] или [manzil] допустимы ТОЛЬКО в том случае, если пользователь явно заказал коммерческую рекламу услуги/магазина с призывом позвонить/приехать и сам не указал номер или адрес. Никогда не выдумывай фальшивые номера телефонов (+998 90 123-45-67).
3. УТОЧНЯЮЩИЙ ВОПРОС (needsClarification):
   - Задавай ОДИН уточняющий вопрос (needsClarification: true, proposals: []) ТОЛЬКО если в задаче вообще нет ни темы, ни сути, ни текста (например, просто «сделай озвучку»). Во всех остальных случаях сразу выдавай готовый сценарий (needsClarification: false).${
     params.customSystemRules?.trim()
       ? `\n\nДОПОЛНИТЕЛЬНЫЕ АВТОРСКИЕ ПРАВИЛА ПОЛЬЗОВАТЕЛЯ:\n${params.customSystemRules.trim()}`
       : ""
   }`;
}

const PROPOSAL_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    needsClarification: {
      type: Type.BOOLEAN,
      description:
        "True ONLY if the user prompt has zero subject/context (e.g. just 'make a voiceover' without saying for what).",
    },
    clarifyingQuestion: {
      type: Type.STRING,
      description:
        "One short clarifying question if needsClarification is true; otherwise empty string.",
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
              "Ready-to-voice script in the target language. May include acoustic pause tags [pauza 1s], [pauza 2s], [pauza 3s] and vocal tags <breath>, <short pause>, <sigh>, <laugh>.",
          },
          recommendedPreset: {
            type: Type.STRING,
            description: "One of: conversational, confident, energetic, warm",
          },
          recommendedVoiceId: {
            type: Type.STRING,
            description:
              "Recommended voice id, e.g. charon-news, kore-podcast, fenrir-narrator, aoede-story",
          },
          reason: {
            type: Type.STRING,
            description: "One short sentence explaining the director's choice of tone, pacing, and pauses.",
          },
        },
        required: [
          "id",
          "title",
          "badge",
          "text",
          "recommendedPreset",
          "recommendedVoiceId",
          "reason",
        ],
      },
    },
  },
  required: ["needsClarification", "proposals"],
};

/**
 * Генерация сценария (1 полного монолога/процедуры или 3 вариантов подачи) по задаче пользователя.
 * Поддерживает любую длительность (от 15 сек до 10 000 слов без потолка в 60 секунд) и точные паузы [pauza 1s], [pauza 2s], [pauza 3s].
 */
export async function generateTtsAgentProposals(
  ai: GoogleGenAI,
  params: {
    task: string;
    durationSec?: number; // 0 = Авто / Без ограничений (до 10 000 слов)
    language: "uz" | "ru" | "en";
    voiceId?: string;
    outputMode?: TtsAgentOutputMode;
    workflowMode?: TtsAgentWorkflowMode;
    pauseCadence?: TtsPauseCadence;
    customSystemRules?: string;
  }
): Promise<TtsAgentProposeResponse> {
  const cleanTask = (params.task || "").trim().slice(0, TTS_MODELS_CONFIG.maxAgentTaskChars);
  const rawDuration = Number(params.durationSec);
  const targetSec = isNaN(rawDuration) ? 30 : Math.max(0, Math.min(7200, rawDuration));

  if (isTaskTooVagueHeuristic(cleanTask)) {
    return {
      needsClarification: true,
      clarifyingQuestion:
        params.language === "uz"
          ? "Qaysi mavzu, hikoya, jarayon yoki mahsulot uchun ovozli ssenariy tayyorlash kerak?"
          : "Уточните, пожалуйста: для какого рассказа, процедуры, темы или продукта нужно подготовить озвучку?",
      proposals: [],
    };
  }

  const intent = detectTaskIntentHeuristics(cleanTask);

  const effectiveOutputMode: TtsAgentOutputMode =
    params.outputMode ||
    (intent.wantsSingleMonologue ||
    targetSec === 0 ||
    targetSec > 90 ||
    params.workflowMode === "format_procedure" ||
    params.workflowMode === "expand_monologue"
      ? "single_monologue"
      : "three_variants");

  const effectiveWorkflowMode: TtsAgentWorkflowMode =
    params.workflowMode ||
    (cleanTask.split(/\s+/).length > 140
      ? "format_procedure"
      : intent.wantsSingleMonologue
        ? "expand_monologue"
        : "create");

  const effectivePauseCadence: TtsPauseCadence =
    params.pauseCadence || (intent.wantsMeasuredPauses ? "1_2_3s" : "auto");

  const systemInstruction = buildAgentSystemPrompt({
    language: params.language,
    outputMode: effectiveOutputMode,
    workflowMode: effectiveWorkflowMode,
    pauseCadence: effectivePauseCadence,
    durationSec: targetSec,
    explicitTargetWords: intent.explicitTargetWords,
    customSystemRules: params.customSystemRules,
  });

  const targetWords = intent.explicitTargetWords
    ? intent.explicitTargetWords
    : targetSec > 0
      ? Math.round(targetSec * TTS_MODELS_CONFIG.wordsPerSecondEstimate)
      : 0;
  const minWords = targetWords > 0 ? Math.ceil(targetWords * 0.82) : 0;
  const maxWords = targetWords > 0 ? Math.floor(targetWords * 1.18) : 10000;

  const userPrompt =
    targetSec > 0 && effectiveOutputMode === "three_variants"
      ? `Задача пользователя:\n"""\n${cleanTask}\n"""\nЦелевая длительность каждого из 3 вариантов: ~${targetSec} сек (${minWords}–${maxWords} слов).`
      : targetSec > 0 && effectiveOutputMode === "single_monologue"
        ? `Задача пользователя:\n"""\n${cleanTask}\n"""\nПодготовь 1 полный сценарий/монолог длительностью ~${targetSec} сек (около ${targetWords} слов).`
        : `Задача / процедура пользователя:\n"""\n${cleanTask}\n"""\nПодготовь полный, детальный сценарий без ограничения в 60 секунд, сохранив все этапы и расставив естественные паузы [pauza 1s], [pauza 2s], [pauza 3s].`;

  const response = await ai.models.generateContent({
    model: TTS_MODELS_CONFIG.textModel,
    contents: userPrompt,
    config: {
      systemInstruction,
      thinkingConfig: { thinkingLevel: TTS_MODELS_CONFIG.textThinkingLevel },
      responseMimeType: "application/json",
      responseSchema: PROPOSAL_SCHEMA,
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
        "Уточните, пожалуйста, о каком продукте, процедуре или событии должна быть озвучка?",
      proposals: [],
    };
  }

  const maxSlice = effectiveOutputMode === "single_monologue" ? 1 : 3;
  const rawProposals: any[] = Array.isArray(parsed.proposals)
    ? parsed.proposals.slice(0, maxSlice)
    : [];

  // Авто-коррекция длины применяется ТОЛЬКО для коротких фиксированных роликов (15–90 сек) без ручных пауз,
  // чтобы никогда не обрезать длинные монологи, рассказы и процедуры пользователя!
  if (
    targetSec > 0 &&
    targetSec <= 90 &&
    !intent.wantsSingleMonologue &&
    effectiveWorkflowMode === "create"
  ) {
    const minAllowedSec = targetSec * 0.8;
    const maxAllowedSec = targetSec * 1.22;

    const indicesToRewrite: number[] = [];
    rawProposals.forEach((p, idx) => {
      const txt = String(p?.text || "").trim();
      const { wordCount, estimatedSeconds } = computeWordAndDurationStats(txt);
      if (
        estimatedSeconds < minAllowedSec ||
        estimatedSeconds > maxAllowedSec ||
        wordCount < minWords ||
        wordCount > maxWords
      ) {
        indicesToRewrite.push(idx);
      }
    });

    if (indicesToRewrite.length > 0 && rawProposals.length > 0) {
      try {
        const rewritePrompt = indicesToRewrite
          .map((i) => {
            const p = rawProposals[i];
            const { wordCount } = computeWordAndDurationStats(String(p?.text || ""));
            return `Вариант #${i + 1} (${p?.badge || p?.title}, сейчас ${wordCount} слов): "${p?.text}"`;
          })
          .join("\n\n");

        const rewriteResp = await ai.models.generateContent({
          model: TTS_MODELS_CONFIG.textModel,
          contents: `Скорректируй объём указанных вариантов для задачи "${cleanTask.slice(0, 500)}", чтобы в КАЖДОМ было от ${minWords} до ${maxWords} слов (около ${targetWords} слов = ${targetSec} сек при 2.2 слова/сек).
Сохрани тон варианта, паузы [pauza Ns], все факты из задачи и не добавляй лишних [telefon]:\n\n${rewritePrompt}`,
          config: {
            thinkingConfig: { thinkingLevel: TTS_MODELS_CONFIG.textThinkingLevel },
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                rewrittenTexts: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.STRING,
                  },
                },
              },
              required: ["rewrittenTexts"],
            },
          },
        });

        const rewriteParsed = JSON.parse((rewriteResp.text || "{}").trim());
        if (Array.isArray(rewriteParsed.rewrittenTexts)) {
          indicesToRewrite.forEach((propIdx, arrIdx) => {
            const candidate = String(rewriteParsed.rewrittenTexts[arrIdx] || "").trim();
            if (candidate) {
              rawProposals[propIdx].text = candidate;
            }
          });
        }
      } catch (e) {
        // В случае сбоя оставляем исходный вариант
      }
    }
  }

  const validPresets = new Set(["conversational", "confident", "energetic", "warm"]);

  const proposals: TtsAgentProposal[] = rawProposals.map((p, idx) => {
    const rawText = canonicalizeTimedPauseTags(String(p?.text || "").trim());
    const cleanText =
      params.language === "uz" ? normalizeUzbekApostrophes(rawText) : rawText;
    const { wordCount, pauseTotalSeconds, estimatedSeconds, placeholders } =
      computeWordAndDurationStats(cleanText);
    const presetRaw = String(p?.recommendedPreset || "conversational").toLowerCase();
    const recommendedPreset = (
      validPresets.has(presetRaw)
        ? presetRaw
        : idx === 1
          ? "confident"
          : idx === 2
            ? "energetic"
            : "conversational"
    ) as TtsAgentProposal["recommendedPreset"];

    return {
      id: String(p?.id || `prop-${idx + 1}`),
      title: String(
        p?.title ||
          (effectiveOutputMode === "single_monologue"
            ? "Полный режиссёрский сценарий"
            : `Вариант ${idx + 1}`)
      ).trim(),
      badge: String(
        p?.badge ||
          (effectiveOutputMode === "single_monologue"
            ? "Мастер-монолог"
            : idx === 0
              ? "Разговорный"
              : idx === 1
                ? "Деловой"
                : "Энергичный")
      ).trim(),
      text: cleanText,
      recommendedPreset,
      recommendedVoiceId: String(params.voiceId || p?.recommendedVoiceId || "charon-news"),
      reason: String(p?.reason || "Оптимальная режиссёрская подача и ритмика пауз").trim(),
      estimatedSeconds,
      wordCount,
      pauseTotalSeconds,
      placeholders,
    };
  });

  return {
    needsClarification: false,
    proposals,
    appliedPromptArchitecture: systemInstruction,
  };
}

/**
 * Доработка выбранного сценария по любой команде пользователя:
 * - «расставь паузы 1, 2, 3 секунды между абзацами и фразами»
 * - «разверни в большой подробный монолог на 3 минуты»
 * - «сделай живым разговорным»
 * - «добавь дыхание и эмоции»
 */
export async function refineTtsAgentProposal(
  ai: GoogleGenAI,
  params: {
    proposalText: string;
    instruction: string;
    language: "uz" | "ru" | "en";
    customSystemRules?: string;
  }
): Promise<{
  refinedText: string;
  wordCount: number;
  pauseTotalSeconds: number;
  estimatedSeconds: number;
  placeholders: string[];
}> {
  const baseText = (params.proposalText || "").trim().slice(0, TTS_MODELS_CONFIG.maxTextChars);
  const instruction = (params.instruction || "").trim().slice(0, 2000);

  const targetLangDesc =
    params.language === "uz"
      ? "живой разговорный узбекский язык (латиница, апостроф ' в o' и g')"
      : params.language === "ru"
        ? "естественный живой русский язык"
        : "natural conversational English";

  const response = await ai.models.generateContent({
    model: TTS_MODELS_CONFIG.textModel,
    contents: `Исходный текст сценария:\n"""\n${baseText}\n"""\n\nКоманда режиссёру на доработку: "${instruction}"`,
    config: {
      systemInstruction: `Ты — главный AI-режиссёр голосовых сценариев и монологов OvozStudio (${targetLangDesc}).
Выполни команду пользователя над исходным текстом.

СТРОГИЕ ПРАВИЛА ПРОМПТ-ИНЖИНИРИНГА:
1. ТОЧНЫЕ ПАУЗЫ:
   - Если пользователь просит расставить паузы (например, 1, 2, 3 секунды или паузы по смыслу), используй точные теги: [pauza 1s], [pauza 2s], [pauza 3s] (а также <breath>, <short pause>, <sigh>, <laugh>).
   - Аудио-движок синтезирует [pauza 1s], [pauza 2s], [pauza 3s] как реальную студийную тишину ровно в 1, 2 и 3 секунды.
2. ОБЪЁМ И ПРОДОЛЖИТЕЛЬНОСТЬ:
   - Ограничения в 60 секунд НЕТ! Если пользователь просит расширить монолог, добавить детали или сохранить всю процедуру — пиши полный текст любой нужной длины (до 10 000 слов).
3. БЕЗ НАВЯЗАННЫХ ТЕЛЕФОНОВ:
   - Не вставляй [telefon] или [manzil], если пользователь сам об этом не попросил, и никогда не выдумывай номера телефонов.${
     params.customSystemRules?.trim()
       ? `\n4. АВТОРСКИЕ ПРАВИЛА ПОЛЬЗОВАТЕЛЯ:\n${params.customSystemRules.trim()}`
       : ""
   }`,
      thinkingConfig: { thinkingLevel: TTS_MODELS_CONFIG.textThinkingLevel },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          refinedText: {
            type: Type.STRING,
            description:
              "Обновлённый текст для озвучки с учётом команды (может содержать [pauza 1s], [pauza 2s], [pauza 3s], <breath>, <short pause>).",
          },
        },
        required: ["refinedText"],
      },
    },
  });

  const parsed = JSON.parse((response.text || "{}").trim());
  const rawOut = canonicalizeTimedPauseTags(String(parsed.refinedText || baseText).trim());
  const refinedText =
    params.language === "uz" ? normalizeUzbekApostrophes(rawOut) : rawOut;
  const stats = computeWordAndDurationStats(refinedText);

  return {
    refinedText,
    ...stats,
  };
}
