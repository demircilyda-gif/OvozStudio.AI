import { ThinkingLevel } from "@google/genai";
import {
  SUB_BLOCK_MAX_SEC,
  SUB_BLOCK_MAX_TURNS,
} from "../../src/utils/dubbingLimits.ts";

/**
 * Централизованный конфигурационный файл моделей и параметров бюджета длины
 * для конвейера видео-дубляжа 1:1.
 */
export const DUBBING_MODELS_CONFIG = {
  /**
   * Понимание видео, спикеры, эмоции (разбор видео).
   */
  videoUnderstandingModels: [
    process.env.DUBBING_VIDEO_MODEL || "gemini-4-argon",
    "gemini-4-hydrogen",
    "gemini-3.8-flash",
  ],

  /**
   * Специализированная модель дословного распознавания речи (только чистый текст без JSON/таймкодов).
   */
  transcribeModel: process.env.DUBBING_TRANSCRIBE_MODEL || "gemini-3.5-transcribe",

  /**
   * Мультимодальная модель для структурированного выравнивания подблока аудио
   * (JSON responseSchema: index, startSec, endSec, found, voice male/female, spokenText).
   * gemini-3.5-transcribe возвращает только plain-text ASR без колонок и таймкодов, поэтому для
   * выравнивания и верификации голоса используется gemini-4-hydrogen.
   */
  audioAlignmentModel: process.env.DUBBING_ALIGNMENT_MODEL || "gemini-4-hydrogen",

  /**
   * Параметры бюджета слогов при переводе:
   * targetSyllables = round(windowSec * PACE)
   * maxSyllables = round((windowSec + 0.7 * gapAfterSec) * PACE_MAX)
   */
  PACE: Number(process.env.DUBBING_PACE || 5.0),
  PACE_MAX: Number(process.env.DUBBING_PACE_MAX || 5.5),

  /**
   * Основной перевод 1:1: thinkingLevel MEDIUM, temperature 0.5 (Пункт 3).
   */
  translationTemperature: Number(process.env.DUBBING_TRANSLATION_TEMP || 0.5),
  translationModels: [
    {
      model: process.env.DUBBING_TRANSLATION_MODEL || "gemini-4-argon",
      thinkingLevel: ThinkingLevel.MEDIUM,
      temperature: Number(process.env.DUBBING_TRANSLATION_TEMP || 0.5),
    },
    {
      model: "gemini-4-hydrogen",
      thinkingLevel: ThinkingLevel.MEDIUM,
      temperature: Number(process.env.DUBBING_TRANSLATION_TEMP || 0.5),
    },
    {
      model: "gemini-3.8-flash",
      thinkingLevel: undefined,
      temperature: Number(process.env.DUBBING_TRANSLATION_TEMP || 0.5),
    },
  ],

  /**
   * Перефразирование длинных реплик после замера реального звука (Пункт 4):
   * модель перевода с thinkingLevel HIGH.
   */
  rephraseModels: [
    {
      model: process.env.DUBBING_TRANSLATION_MODEL || "gemini-4-argon",
      thinkingLevel: ThinkingLevel.HIGH,
      temperature: 0.4,
    },
    {
      model: "gemini-4-hydrogen",
      thinkingLevel: ThinkingLevel.HIGH,
      temperature: 0.4,
    },
    {
      model: "gemini-3.8-flash",
      thinkingLevel: undefined,
      temperature: 0.4,
    },
  ],

  /**
   * Флагманская модель озвучки диалогов — СТРОГО gemini-3.8-flash-tts.
   * Модель gemini-3.8-flash-lite-tts не используется нигде, в том числе как запасная.
   */
  ttsDubbingModel: process.env.DUBBING_TTS_MODEL || "gemini-3.8-flash-tts",
  ttsDailyQuotaLimit: Number(process.env.GEMINI_TTS_DAILY_LIMIT || 100),

  /**
   * Единые лимиты суб-блока озвучки из src/utils/dubbingLimits.ts (общие для сервера и браузера).
   */
  subBlockMaxTurns: SUB_BLOCK_MAX_TURNS,
  subBlockMaxSec: SUB_BLOCK_MAX_SEC,

  /**
   * Единое предельное ускорение ffmpeg atempo (до 1.10x) при укладке в таймкоды (раздел 2.6).
   */
  maxAtempoSpeedRatio: Number(process.env.DUBBING_MAX_ATEMPO || 1.1),
  maxAtempoFallbackRatio: Number(process.env.DUBBING_MAX_ATEMPO || 1.1),
  maxNextTurnShiftSec: Number(process.env.DUBBING_MAX_SHIFT_SEC || 0.3),
  overflowFadeOutMs: 120,

  /**
   * Порог слогов в секунду для информационной пометки в таблице.
   */
  syllablesPerSecWarningThreshold: Number(process.env.DUBBING_SYLLABLES_WARN_PER_SEC || 5.5),

  /**
   * Вариант чтения десятичных дробей в узбекском нормализаторе:
   * - "butun": 5,2 -> "besh butun ikki"
   * - "u":     5,2 -> "besh-u ikki"
   */
  decimalPronunciationStyle: (process.env.DUBBING_DECIMAL_STYLE === "u" ? "u" : "butun") as
    | "butun"
    | "u",
};
