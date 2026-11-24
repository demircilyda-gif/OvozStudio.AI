import { ThinkingLevel } from "@google/genai";

/**
 * Централизованный конфиг моделей и лимитов для вкладки «TTS Ovozlash»
 * (Обычный режим и AI Агент).
 * Все модели переопределяются через переменные окружения.
 */
export const TTS_MODELS_CONFIG = {
  /**
   * Озвучка: строго gemini-3.8-flash-tts (Lite не использовать).
   */
  ttsModel: process.env.TTS_OVOZLASH_MODEL || "gemini-3.8-flash-tts",

  /**
   * Агент, перевод, автоэмоция: gemini-4-hydrogen, thinking LOW, строгий JSON по responseSchema.
   */
  textModel: process.env.TTS_OVOZLASH_TEXT_MODEL || "gemini-4-hydrogen",
  textThinkingLevel: ThinkingLevel.LOW,

  /**
   * Запасной канал озвучки: kie.ai (google/gemini-3-8-flash-tts).
   * Вызывается только при 429/402 от Google и только для встроенных голосов.
   */
  kieModel: process.env.KIE_TTS_MODEL || "google/gemini-3-8-flash-tts",
  kieApiBaseUrl: process.env.KIE_API_BASE_URL || "https://api.kie.ai",
  getKieApiKey: (): string => (process.env.KIE_API_KEY || "").trim(),

  /**
   * Ограничения и параметры расчёта длительности:
   * - Агент: лимит 3 000 слов (~20 минут речи)
   * - Порог нарезки длинного текста на вызовы TTS: ~3 000 знаков (паузы [pauza] НЕ режут вызовы!)
   * - Пауза между склеенными кусками по умолчанию: 250 мс
   * - Скорость речи для оценки длительности: ~2.2 слова/сек
   * - Допустимый диапазон темпа: 0.9x – 1.15x (по умолчанию 1.0x)
   * - Срок хранения несохранённых в Медиатеку файлов: 7 дней
   */
  maxTextChars: Number(process.env.TTS_MAX_TEXT_CHARS || 30000),
  maxAgentTaskChars: Number(process.env.TTS_MAX_AGENT_TASK_CHARS || 30000),
  maxAgentWords: Number(process.env.TTS_MAX_AGENT_WORDS || 3000),
  chunkSplitThresholdChars: Number(process.env.TTS_CHUNK_THRESHOLD_CHARS || 3000),
  interChunkSilenceMs: Number(process.env.TTS_CHUNK_SILENCE_MS || 250),
  wordsPerSecondEstimate: Number(process.env.TTS_WORDS_PER_SEC || 2.2),
  minSpeed: 0.9,
  maxSpeed: 1.15,
  defaultSpeed: 1.0,
  fileRetentionDays: 7,
};

/**
 * Фиксированные пресеты подачи (когда выбран не «auto», автоэмоция не вызывается).
 */
export const TTS_PRESET_STYLES: Record<
  "conversational" | "confident" | "energetic" | "warm",
  string
> = {
  conversational:
    "Authentic live human conversation, relaxed natural breathing, organic everyday intonation with subtle pitch variation, speaking directly to a friend — never stiff or robotic",
  confident:
    "Grounded, charismatic human speaker with calm authority, natural resonant voice, unhurried emphasis on key words and organic micro-pauses — never flat announcer monotony",
  energetic:
    "Lively, genuinely excited human delivery with bright vocal smile, dynamic rhythm, natural breath lifts and engaging emphasis — expressive and real, never forced or synthetic",
  warm:
    "Warm, intimate, heartfelt human voice with gentle warmth and sincerity, soft natural cadence, subtle emotional presence and effortless phrasing",
};

/**
 * Словесное описание темпа для добавления в style.
 */
export function describeSpeedForStyle(speed: number): string {
  if (speed <= 0.93) return "slightly slower, measured pace";
  if (speed <= 0.97) return "calm, slightly relaxed pace";
  if (speed >= 1.11) return "brisk, noticeably faster pace";
  if (speed >= 1.04) return "slightly faster pace";
  return "natural medium pace";
}
