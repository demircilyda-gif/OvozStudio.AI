import { ThinkingLevel } from "@google/genai";

/**
 * Централизованный конфигурационный файл моделей для конвейера видео-дубляжа 1:1.
 * Позволяет менять модели через переменные окружения без правки кода.
 */
export const DUBBING_MODELS_CONFIG = {
  /**
   * Понимание видео, спикеры, эмоции (Этап 2.1 «Режиссёр» и раскадровка из видео).
   * Основная: gemini-4-argon; запасные: gemini-4-hydrogen, gemini-3.8-flash.
   */
  videoUnderstandingModels: [
    process.env.DUBBING_VIDEO_MODEL || "gemini-4-argon",
    "gemini-4-hydrogen",
    "gemini-3.8-flash",
  ],

  /**
   * Специализированная модель дословного распознавания речи (Этап 2.2 «Стенографист»).
   */
  transcribeModel: process.env.DUBBING_TRANSCRIBE_MODEL || "gemini-3.5-transcribe",

  /**
   * Живая разговорная адаптация и самопроверка перевода 1:1 (Этап 3 «Автор дубляжа» + «Редактор»).
   * Основная: gemini-4-argon; запасная: gemini-4-hydrogen с ThinkingLevel.HIGH.
   */
  translationModels: [
    {
      model: process.env.DUBBING_TRANSLATION_MODEL || "gemini-4-argon",
      thinkingLevel: ThinkingLevel.HIGH,
    },
    {
      model: "gemini-4-hydrogen",
      thinkingLevel: ThinkingLevel.HIGH,
    },
    {
      model: "gemini-3.8-flash",
      thinkingLevel: undefined,
    },
  ],

  /**
   * Флагманская модель озвучки диалогов и актёрской игры (Этап 1.4 и Этап 4).
   * СТРОГО gemini-3.8-flash-tts (никогда не использовать Lite для дубляжа).
   */
  ttsDubbingModel: process.env.DUBBING_TTS_MODEL || "gemini-3.8-flash-tts",

  /**
   * Максимальное допустимое ускорение реплики (atempo) при выходе за окно таймкода (Этап 1.3).
   * Остаток реплики уходит в естественную паузу перед следующей репликой.
   */
  maxAtempoSpeedRatio: Number(process.env.DUBBING_MAX_ATEMPO || 1.1),

  /**
   * Порог слогов в секунду для информационной пометки «Длинновато» в таблице (Этап 1.2).
   * Текст НИКОГДА не обрезается автоматически.
   */
  syllablesPerSecWarningThreshold: Number(process.env.DUBBING_SYLLABLES_WARN_PER_SEC || 6.0),

  /**
   * Вариант чтения десятичных дробей в узбекском нормализаторе (Этап 1.8):
   * - "butun": 5,2 -> "besh butun ikki"
   * - "u":     5,2 -> "besh-u ikki"
   */
  decimalPronunciationStyle: (process.env.DUBBING_DECIMAL_STYLE === "u" ? "u" : "butun") as
    | "butun"
    | "u",
};
