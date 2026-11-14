import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";

const execFileAsync = promisify(execFile);

export const DOCUMENTED_TTS_TAGS = [
  "laugh",
  "sigh",
  "short pause",
  "breath",
  "cough",
] as const;

export interface ParsedSpeakerProfile {
  id: string; // e.g. "HOST_1", "HOST_2", "HOST_3"
  rawLabel: string; // e.g. "Девушка (Ж)", "Мужчина (М)"
  name: string; // e.g. "Девушка", "Мужчина"
  gender: "female" | "male";
  description: string;
  defaultVoiceStyle: string;
  recommendedVoiceId: string;
  recommendedBaseVoice: string;
}

export interface NoSpeechInterval {
  id: string;
  timecode: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  label: string;
  visualDescription: string;
}

export interface VerbatimTurn {
  id: string;
  index: number;
  timecode: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  speakerId: string;
  speakerName: string;
  speakerGender: "female" | "male";
  sceneTitle?: string;
  visualContext?: string;
  intonationRu?: string;
  originalTextRu: string;
  cleanedRuForTranslation: string;
  text: string; // Translated Uzbek text with documented tags (<laugh>, <sigh>, <short pause>, <breath>, <cough>)
  emotion: string;
  speechStyle: string; // Gemini 3.8 TTS speechMetadata.style
  pace: "slow" | "normal" | "fast";
  inlineTags: string[];
  nonSpeechEvents?: string[];
  maxSyllables: number;
  actualSyllables: number;
  validationPassed: boolean;
  validationNotes?: string;
}

export interface VideoJsonSpeaker {
  id: string;
  gender: "male" | "female";
  description: string;
}

export interface VideoJsonSegment {
  start: string;
  end: string;
  type: "speech" | "no_speech";
  speakerId: string;
  emotion: string;
  text_original: string;
  non_speech_events: string[];
}

export interface VideoJsonStoryboard {
  speakers: VideoJsonSpeaker[];
  segments: VideoJsonSegment[];
}

export interface VerbatimParseResult {
  title: string;
  speakers: ParsedSpeakerProfile[];
  turns: VerbatimTurn[];
  noSpeechIntervals: NoSpeechInterval[];
  totalDurationSec: number;
  generatedStoryboardText?: string;
  estimatedCostUsd: {
    translationUsd: number;
    ttsUsd: number;
    totalUsd: number;
  };
}

/**
 * Probes exact video duration in seconds via /usr/bin/ffprobe (or fallback).
 */
export async function probeVideoDurationSec(
  filePath: string,
  fallbackSec = 60
): Promise<number> {
  if (fs.existsSync("/usr/bin/ffprobe")) {
    try {
      const { stdout } = await execFileAsync("/usr/bin/ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ]);
      const parsed = parseFloat(String(stdout || "").trim());
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.round(parsed * 10) / 10;
      }
    } catch (e: any) {
      console.warn("[probeVideoDurationSec] ffprobe warning:", e?.message);
    }
  }
  return fallbackSec > 0 ? fallbackSec : 60;
}

/**
 * Parse timestamp like "00:12", "01:05", "00:01:25", "00:12,500", "01:14.5" into seconds
 */
export function parseTimecodeToSec(raw: string): number {
  const cleaned = String(raw || "")
    .trim()
    .replace(",", ".");
  const parts = cleaned.split(":").map((p) => parseFloat(p.trim()));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parts[0] || 0;
}

export function formatSecToTimecode(sec: number): string {
  const safe = Math.max(0, Math.round(sec));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function formatSecToSrtTime(sec: number): string {
  const safe = Math.max(0, sec);
  const hours = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const ms = Math.round((safe - Math.floor(safe)) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

/**
 * Count approximate syllables in Uzbek or Russian text (ignoring XML/angle tags)
 */
export function countSyllables(text: string): number {
  const withoutTags = String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .trim();
  if (!withoutTags) return 0;
  // Count Uzbek + Russian vowels (o', a, e, i, o, u, а, е, ё, и, о, у, ы, э, ю, я)
  const matches = withoutTags.match(/[aeiuyo'oʻаеёиоуыэюя]/gi);
  return matches ? matches.length : Math.max(1, Math.ceil(withoutTags.length / 3));
}

export function countSentences(text: string): number {
  const withoutTags = String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\.\.\./g, " ")
    .trim();
  if (!withoutTags) return 0;
  const parts = withoutTags
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return Math.max(1, parts.length);
}

/**
 * Converts Russian inline parenthetical remarks inside spoken text into
 * documented Gemini 3.8 TTS inline tags (<laugh>, <sigh>, <short pause>, <breath>, <cough>)
 * and style modifiers, stripping any unknown/editorial remarks so they are never read aloud.
 */
export function extractAndConvertInlineRemarks(rawSpokenText: string): {
  cleanedText: string;
  inlineTags: string[];
  extraStyleHints: string[];
  nonSpeechEvents: string[];
} {
  let text = String(rawSpokenText || "").trim();
  const inlineTags: string[] = [];
  const extraStyleHints: string[] = [];
  const nonSpeechEvents: string[] = [];

  // 1. If the line has outer quotes «...» or "...", strip any editorial note AFTER the closing quote:
  const guillemetMatch = text.match(/^«([\s\S]*?)»\.?\s*(?:\(([^)]*)\))?\.?$/);
  if (guillemetMatch) {
    text = guillemetMatch[1].trim();
  } else {
    const straightQuoteMatch = text.match(/^"([\s\S]*?)"\.?\s*(?:\(([^)]*)\))?\.?$/);
    if (straightQuoteMatch) {
      text = straightQuoteMatch[1].trim();
    }
  }

  // Also strip surrounding quotes if still present
  text = text.replace(/^[«"„]+|[»"“]+$/g, "").trim();

  // 2. Replace parenthetical remarks inside the spoken text according to documented table
  text = text.replace(/\(([^)]+)\)/g, (_full, innerRaw: string) => {
    const inner = innerRaw.trim().toLowerCase();

    // Editorial notes like (в оригинале...), (оговаривается...), (прим....), (на экране...)
    if (/оригинал|оговар|прим|экран|кадр|таймер|титры|музык|без слов/i.test(inner)) {
      return " ";
    }

    // Chuckle / light laugh: (хе-хе), (усмешка), (смешок), (хихикает), (улыбается)
    if (/хе-хе|хех|усмеш|смешок|хихик|улыбк|улыба/i.test(inner)) {
      inlineTags.push("<laugh>");
      nonSpeechEvents.push("laugh");
      extraStyleHints.push("light short chuckle, warm smiling tone");
      return " <laugh> ";
    }

    // Full laugh: (смеется), (смеётся), (смех), (ха-ха)
    if (/смеет|смеёт|смех|ха-ха|хохоч|ржет|ржёт|laugh/i.test(inner)) {
      inlineTags.push("<laugh>");
      nonSpeechEvents.push("laugh");
      extraStyleHints.push("natural laughing delivery");
      return " <laugh> ";
    }

    // Sigh: (вздыхает), (вздох), (выдох)
    if (/вздых|вздох|выдох|sigh/i.test(inner)) {
      inlineTags.push("<sigh>");
      nonSpeechEvents.push("sigh");
      extraStyleHints.push("audible sigh");
      return " <sigh> ";
    }

    // Pause: (пауза), (короткая пауза), (молчание)
    if (/пауз|молчан|тишин|pause/i.test(inner)) {
      inlineTags.push("<short pause>");
      nonSpeechEvents.push("short pause");
      return " <short pause> ";
    }

    // Breath / gasp: (вдох), (переводит дух), (ах), (удивленный вдох)
    if (/вдох|переводит дух|дыхан|ахнув|задых|breath|gasp/i.test(inner)) {
      inlineTags.push("<breath>");
      nonSpeechEvents.push("breath");
      extraStyleHints.push("audible intake of breath");
      return " <breath> ";
    }

    // Cough / throat clear: (кашляет), (покашливает)
    if (/кашл|покашл|горло|cough/i.test(inner)) {
      inlineTags.push("<cough>");
      nonSpeechEvents.push("cough");
      return " <cough> ";
    }

    // Whisper / quiet: (шёпотом), (шепотом), (тихо) -> style only, no spoken tag
    if (/шёпот|шепот|тихо|полголоса|whisper/i.test(inner)) {
      extraStyleHints.push("whispering, soft quiet voice");
      return " ";
    }

    // Any other unknown remark -> move to style hint if it looks like emotion, and remove from spoken text
    if (inner.length < 40) {
      extraStyleHints.push(innerRaw.trim());
    }
    return " ";
  });

  // 3. Convert ellipsis "..." inside speech into <short pause> if between words
  text = text.replace(/\s*\.\.\.\s*(?=[А-Яа-яЁёA-Za-z0-9])/g, " <short pause> ");

  // 4. Clean up any unsupported angle tags, keeping ONLY documented Gemini 3.8 TTS tags
  text = sanitizeDocumentedTtsTags(text);

  return {
    cleanedText: text.replace(/\s+/g, " ").trim(),
    inlineTags: Array.from(new Set(inlineTags)),
    extraStyleHints: Array.from(new Set(extraStyleHints)),
    nonSpeechEvents: Array.from(new Set(nonSpeechEvents)),
  };
}

/**
 * Ensures ONLY documented Gemini 3.8 TTS tags (<laugh>, <sigh>, <short pause>, <breath>, <cough>) remain in text.
 * Converts legacy <chuckle> / <gasp> to documented equivalents and strips everything else.
 */
export function sanitizeDocumentedTtsTags(input: string): string {
  return String(input || "")
    .replace(/<\s*(?:chuckle|giggle|kulgi)\s*>/gi, " <laugh> ")
    .replace(/<\s*(?:gasp|hansirash|nafas|deep_breath)\s*>/gi, " <breath> ")
    .replace(/<\s*(?:pause|short_pause|pauza)\s*>/gi, " <short pause> ")
    .replace(/<(?!(\/?(?:laugh|sigh|short pause|breath|cough))\b)[^>]+>/gi, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
}

/**
 * Maps Russian intonation description + visual context into Gemini 3.8 TTS speechMetadata.style and emotion key
 */
export function mapRussianIntonationToStyle(
  intonationRu: string,
  visualContext: string,
  extraHints: string[],
  speakerProfile?: ParsedSpeakerProfile
): {
  emotion: string;
  speechStyle: string;
  pace: "slow" | "normal" | "fast";
} {
  const combined = `${intonationRu || ""} ${extraHints.join(" ")}`.toLowerCase();
  const styleParts: string[] = [];

  if (speakerProfile?.defaultVoiceStyle) {
    styleParts.push(speakerProfile.defaultVoiceStyle);
  }

  let emotion = "warm";
  let pace: "slow" | "normal" | "fast" = "normal";

  if (/удивл|недовер|восторг|азарт|бодр|ого|шок|вызов|excited|surpris/i.test(combined)) {
    emotion = "excited";
    styleParts.push("Expressive, surprised and energetic delivery with lively rising pitch");
  } else if (/вопрос|интерес|любопыт|curious|question/i.test(combined)) {
    emotion = "curious";
    styleParts.push("Curious, inquisitive, natural questioning intonation");
  } else if (/иронич|скепсис|ухмыл|улыбк|смеш|смех|дружелюб|довольно|warm|smil/i.test(combined)) {
    emotion = "warm";
    styleParts.push("Warm, smiling, slightly playful and friendly conversational tone");
  } else if (/серьез|серьёз|эксперт|акцент на цифр|резюмир|serious|confident/i.test(combined)) {
    emotion = "serious";
    styleParts.push("Confident, authoritative, clear and grounded delivery");
  } else if (/шёпот|шепот|тихо|whisper/i.test(combined)) {
    emotion = "whisper";
    styleParts.push("Soft, intimate whispering delivery");
  } else if (/спокойн|размерен|уверен|calm/i.test(combined)) {
    emotion = "calm";
    styleParts.push("Calm, composed, steady and natural conversational delivery");
  }

  if (/быстр|бодр|азарт|коротко|fast/i.test(combined)) {
    pace = "fast";
  } else if (/медлен|размерен|протяжн|пауз|slow/i.test(combined)) {
    pace = "slow";
  }

  if (intonationRu && intonationRu.trim()) {
    styleParts.push(`Acting direction: ${intonationRu.trim()}`);
  }
  if (extraHints.length > 0) {
    styleParts.push(`Vocal nuances: ${extraHints.join(", ")}`);
  }
  // Use visual context subtly for mood (without reading it aloud)
  if (visualContext) {
    if (/улыба|смеет|смеёт/i.test(visualContext)) {
      styleParts.push("Audible smile in the voice");
    }
    if (/удивл|брови/i.test(visualContext)) {
      styleParts.push("Wide-eyed surprised inflection");
    }
  }

  styleParts.push(
    "100% authentic native Uzbek pronunciation with zero foreign accent. Interpret inline vocal tags (<laugh>, <sigh>, <short pause>, <breath>, <cough>) as natural human vocalizations."
  );

  return {
    emotion,
    speechStyle: styleParts.join(". "),
    pace,
  };
}

/**
 * Deterministic parser for Gemini Russian storyboards, SRT/VTT subtitles, and timestamped dialogues.
 * Supports N speakers, "Видеоряд:", "Интонация:", "Текст:", and "Без слов" intervals.
 */
export function parseStoryboardDeterministic(rawStoryboardText: string): {
  speakers: ParsedSpeakerProfile[];
  turns: Omit<
    VerbatimTurn,
    "text" | "actualSyllables" | "validationPassed" | "validationNotes"
  >[];
  noSpeechIntervals: NoSpeechInterval[];
  unparsedBlocks: string[];
} {
  const normalized = String(rawStoryboardText || "")
    .replace(/\r\n/g, "\n")
    .trim();

  const speakersMap = new Map<string, ParsedSpeakerProfile>();
  const speakerAliasToId = new Map<string, string>();

  const registerSpeaker = (
    rawName: string,
    genderHint?: "female" | "male",
    description = ""
  ): ParsedSpeakerProfile => {
    const cleanRaw = rawName
      .replace(/^(?:сп)?икер\s*\d*\s*/i, "")
      .replace(/^(?:говорящий|ведущий|гость|участник)\s*\d*\s*/i, "")
      .replace(/[—–\-:]/g, " ")
      .trim();

    const detectedGender: "female" | "male" =
      genderHint ||
      (/\(\s*ж\s*\)|девушк|женщин|ведущая|гостья|она|ayol|qiz|malika|aziza|kore|aoede|female/i.test(
        `${rawName} ${description}`
      )
        ? "female"
        : "male");

    const baseDisplayName =
      cleanRaw
        .replace(/\(\s*[жмmf]\s*\)/gi, "")
        .trim() ||
      (detectedGender === "female" ? "Девушка (Ж)" : "Мужчина (М)");

    const normKey = baseDisplayName.toLowerCase();
    const existingId = speakerAliasToId.get(normKey);
    if (existingId && speakersMap.has(existingId)) {
      const existing = speakersMap.get(existingId)!;
      if (description && !existing.description) {
        existing.description = description;
      }
      return existing;
    }

    const index = speakersMap.size + 1;
    const id = `HOST_${index}`;

    const femaleVoices = [
      { voiceId: "Kore", baseVoice: "Kore" },
      { voiceId: "Aoede", baseVoice: "Aoede" },
      { voiceId: "Zephyr", baseVoice: "Zephyr" },
    ];
    const maleVoices = [
      { voiceId: "voice_17raj9ewke3g", baseVoice: "Charon" },
      { voiceId: "Fenrir", baseVoice: "Fenrir" },
      { voiceId: "Puck", baseVoice: "Puck" },
    ];

    const sameGenderCount = Array.from(speakersMap.values()).filter(
      (s) => s.gender === detectedGender
    ).length;

    const chosenVoice =
      detectedGender === "female"
        ? femaleVoices[sameGenderCount % femaleVoices.length]
        : maleVoices[sameGenderCount % maleVoices.length];

    const profile: ParsedSpeakerProfile = {
      id,
      rawLabel: `${baseDisplayName} (${detectedGender === "female" ? "Ж" : "М"})`,
      name: baseDisplayName,
      gender: detectedGender,
      description: description.trim(),
      defaultVoiceStyle:
        detectedGender === "female"
          ? `Natural expressive female Uzbek speaker (${baseDisplayName}). ${description}`
          : `Natural confident male Uzbek speaker (${baseDisplayName}). ${description}`,
      recommendedVoiceId: chosenVoice.voiceId,
      recommendedBaseVoice: chosenVoice.baseVoice,
    };

    speakersMap.set(id, profile);
    speakerAliasToId.set(normKey, id);
    speakerAliasToId.set(rawName.trim().toLowerCase(), id);
    return profile;
  };

  const lines = normalized.split("\n");
  let currentSceneTitle = "";

  const speakerHeaderRegex =
    /^(?:сп)?икер\s*(\d+)\s*(?:\(\s*([ЖМжмMFmf])\s*\))?\s*[—–\-:]\s*([^:]+):\s*(.+)$/i;
  for (const line of lines) {
    const trimmed = line.trim();
    const m = trimmed.match(speakerHeaderRegex);
    if (m) {
      const genderChar = (m[2] || "").toUpperCase();
      const speakerRoleName = m[3].trim();
      const desc = m[4].trim();
      const gender: "female" | "male" =
        genderChar === "Ж" || genderChar === "F" || /девушк|женщ/i.test(speakerRoleName)
          ? "female"
          : "male";
      const profile = registerSpeaker(speakerRoleName, gender, desc);
      speakerAliasToId.set(`спикер ${m[1]}`, profile.id);
      speakerAliasToId.set(`икер ${m[1]}`, profile.id);
    }
  }

  const turnHeaderRegex =
    /^\[?\s*(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?)\s*(?:[—–\-]|-->)\s*(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?)\s*\]?\s*(?:\||—|–|-|:)?\s*(.+?)\s*:?\s*$/;

  const singleTimeInlineRegex =
    /^\[?\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:[—–\-]\s*(\d{1,2}:\d{2}(?::\d{2})?))?\s*\]?\s*(?:\||—|–|-)?\s*([^:«"]+?)\s*:\s*([«"].+[»"].*)$/;

  interface RawBlock {
    startSec: number;
    endSec: number;
    timecode: string;
    headerLabel: string;
    sceneTitle: string;
    bodyLines: string[];
    inlineSpokenText?: string;
  }

  const rawBlocks: RawBlock[] = [];
  let activeBlock: RawBlock | null = null;
  const unparsedBlocks: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (speakerHeaderRegex.test(line)) continue;

    if (/^(?:сцена|scene|глава|часть|bob)\s*\d+/i.test(line)) {
      currentSceneTitle = line;
      continue;
    }

    const inlineMatch = line.match(singleTimeInlineRegex);
    if (inlineMatch && !/^(?:видеоряд|интонация|текст)\s*:/i.test(line)) {
      if (activeBlock) rawBlocks.push(activeBlock);
      const startSec = parseTimecodeToSec(inlineMatch[1]);
      const endSec = inlineMatch[2]
        ? parseTimecodeToSec(inlineMatch[2])
        : startSec + 3;
      activeBlock = {
        startSec,
        endSec: Math.max(startSec + 1, endSec),
        timecode: `${formatSecToTimecode(startSec)} – ${formatSecToTimecode(Math.max(startSec + 1, endSec))}`,
        headerLabel: inlineMatch[3].trim(),
        sceneTitle: currentSceneTitle,
        bodyLines: [],
        inlineSpokenText: inlineMatch[4].trim(),
      };
      continue;
    }

    const headerMatch = line.match(turnHeaderRegex);
    if (headerMatch) {
      if (activeBlock) rawBlocks.push(activeBlock);
      const startSec = parseTimecodeToSec(headerMatch[1]);
      const endSec = parseTimecodeToSec(headerMatch[2]);
      const safeEnd = endSec > startSec ? endSec : startSec + 2;
      activeBlock = {
        startSec,
        endSec: safeEnd,
        timecode: `${formatSecToTimecode(startSec)} – ${formatSecToTimecode(safeEnd)}`,
        headerLabel: headerMatch[3].trim().replace(/:$/, ""),
        sceneTitle: currentSceneTitle,
        bodyLines: [],
      };
      continue;
    }

    if (activeBlock) {
      activeBlock.bodyLines.push(line);
    }
  }
  if (activeBlock) {
    rawBlocks.push(activeBlock);
  }

  const turns: Omit<
    VerbatimTurn,
    "text" | "actualSyllables" | "validationPassed" | "validationNotes"
  >[] = [];
  const noSpeechIntervals: NoSpeechInterval[] = [];

  for (let idx = 0; idx < rawBlocks.length; idx++) {
    const blk = rawBlocks[idx];
    const durationSec = Math.max(1, Math.round((blk.endSec - blk.startSec) * 10) / 10);

    let visualContext = "";
    let intonationRu = "";
    let spokenTextRu = blk.inlineSpokenText || "";

    for (const bLine of blk.bodyLines) {
      if (/^(?:видеоряд|кадр|видео|экран|visual)\s*:/i.test(bLine)) {
        visualContext +=
          (visualContext ? " " : "") +
          bLine.replace(/^(?:видеоряд|кадр|видео|экран|visual)\s*:\s*/i, "").trim();
      } else if (/^(?:интонация|тон|эмоция|подача|голос|intonation)\s*:/i.test(bLine)) {
        intonationRu +=
          (intonationRu ? " " : "") +
          bLine.replace(/^(?:интонация|тон|эмоция|подача|голос|intonation)\s*:\s*/i, "").trim();
      } else if (/^(?:текст|речь|реплика|слова|озвучка|text)\s*:/i.test(bLine)) {
        spokenTextRu +=
          (spokenTextRu ? " " : "") +
          bLine.replace(/^(?:текст|речь|реплика|слова|озвучка|text)\s*:\s*/i, "").trim();
      } else if (/^[«"].+[»"]/.test(bLine) && !spokenTextRu) {
        spokenTextRu = bLine;
      } else if (!spokenTextRu && blk.bodyLines.length === 1 && !/без слов/i.test(blk.headerLabel)) {
        spokenTextRu = bLine;
      } else {
        visualContext += (visualContext ? " " : "") + bLine;
      }
    }

    const isExplicitNoSpeech =
      /без слов|музыка и графика|проезд с дрона|пауза|перебивка|интро|аутро/i.test(
        blk.headerLabel
      ) ||
      (!spokenTextRu.trim() && !blk.inlineSpokenText);

    if (isExplicitNoSpeech) {
      noSpeechIntervals.push({
        id: `nospeech-${noSpeechIntervals.length + 1}`,
        timecode: blk.timecode,
        startSec: blk.startSec,
        endSec: blk.endSec,
        durationSec,
        label: blk.headerLabel,
        visualDescription: visualContext,
      });
      continue;
    }

    const speakerProfile = registerSpeaker(blk.headerLabel);
    const { cleanedText, inlineTags, extraStyleHints, nonSpeechEvents } =
      extractAndConvertInlineRemarks(spokenTextRu);

    if (!cleanedText) {
      unparsedBlocks.push(`${blk.timecode} | ${blk.headerLabel}: ${blk.bodyLines.join(" ")}`);
      continue;
    }

    const { emotion, speechStyle, pace } = mapRussianIntonationToStyle(
      intonationRu,
      visualContext,
      extraStyleHints,
      speakerProfile
    );

    const maxSyllables = Math.max(4, Math.ceil(durationSec * 4.8));

    turns.push({
      id: `turn-${turns.length + 1}`,
      index: turns.length,
      timecode: blk.timecode,
      startSec: blk.startSec,
      endSec: blk.endSec,
      durationSec,
      speakerId: speakerProfile.id,
      speakerName: speakerProfile.name,
      speakerGender: speakerProfile.gender,
      sceneTitle: blk.sceneTitle || undefined,
      visualContext: visualContext || undefined,
      intonationRu: intonationRu || undefined,
      originalTextRu: spokenTextRu,
      cleanedRuForTranslation: cleanedText,
      emotion,
      speechStyle,
      pace,
      inlineTags,
      nonSpeechEvents,
      maxSyllables,
    });
  }

  return {
    speakers: Array.from(speakersMap.values()),
    turns,
    noSpeechIntervals,
    unparsedBlocks,
  };
}

/**
 * Fallback structured extractor via gemini-4-hydrogen when user pastes free-form storyboard text
 * that did not match standard timestamp headers.
 */
async function fallbackExtractStoryboardViaLlm(
  ai: GoogleGenAI,
  rawText: string
): Promise<{
  speakers: ParsedSpeakerProfile[];
  turns: Omit<
    VerbatimTurn,
    "text" | "actualSyllables" | "validationPassed" | "validationNotes"
  >[];
  noSpeechIntervals: NoSpeechInterval[];
}> {
  const prompt = `Разбери эту раскадровку/транскрипт видео в строгую структуру для дубляжа 1:1.
Правила:
1. Отдели описание видеоряда ("Видеоряд", что происходит в кадре) от прямой речи ("Текст"). Видеоряд НИКОГДА не должен попадать в spokenTextRu.
2. Музыкальные вставки и пролеты камеры "Без слов" помести в массив noSpeechIntervals.
3. В spokenTextRu оставь ТОЛЬКО прямую речь говорящего на языке оригинала. Если внутри речи указан смех "(хе-хе)" или "(смеется)", замени на тег <laugh>; если вздох — на <sigh>; если пауза — на <short pause>.

Текст раскадровки:
"""
${rawText.slice(0, 30000)}
"""`;

  const candidateModels = ["gemini-4-hydrogen", "gemini-3.8-flash"];
  let parsedJson: any = null;

  for (const modelName of candidateModels) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          temperature: 0.1,
          ...(modelName.includes("hydrogen")
            ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
            : {}),
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              turns: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    startSec: { type: Type.NUMBER },
                    endSec: { type: Type.NUMBER },
                    speakerName: { type: Type.STRING },
                    speakerGender: { type: Type.STRING },
                    visualContext: { type: Type.STRING },
                    intonationRu: { type: Type.STRING },
                    spokenTextRu: { type: Type.STRING },
                  },
                  required: ["startSec", "endSec", "speakerName", "spokenTextRu"],
                },
              },
              noSpeechIntervals: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    startSec: { type: Type.NUMBER },
                    endSec: { type: Type.NUMBER },
                    label: { type: Type.STRING },
                  },
                  required: ["startSec", "endSec", "label"],
                },
              },
            },
            required: ["turns"],
          },
        },
      });
      parsedJson = JSON.parse(response.text || "{}");
      if (Array.isArray(parsedJson?.turns) && parsedJson.turns.length > 0) {
        break;
      }
    } catch (e: any) {
      console.warn(`[Fallback Storyboard Extractor] ${modelName} notice:`, e?.message);
    }
  }

  const formattedLines: string[] = [];
  for (const t of parsedJson?.turns || []) {
    const tc = `${formatSecToTimecode(t.startSec || 0)} – ${formatSecToTimecode(
      Math.max((t.startSec || 0) + 1, t.endSec || 2)
    )}`;
    const g = t.speakerGender === "female" ? "(Ж)" : "(М)";
    formattedLines.push(`${tc} | ${t.speakerName || "Спикер"} ${g}:`);
    if (t.visualContext) formattedLines.push(`Видеоряд: ${t.visualContext}`);
    if (t.intonationRu) formattedLines.push(`Интонация: ${t.intonationRu}`);
    formattedLines.push(`Текст: «${t.spokenTextRu}»`);
    formattedLines.push("");
  }
  for (const ns of parsedJson?.noSpeechIntervals || []) {
    const tc = `${formatSecToTimecode(ns.startSec || 0)} – ${formatSecToTimecode(
      Math.max((ns.startSec || 0) + 1, ns.endSec || 2)
    )}`;
    formattedLines.push(`${tc} | ${ns.label || "Музыка"} (Без слов):`);
    formattedLines.push("");
  }

  return parseStoryboardDeterministic(formattedLines.join("\n"));
}

/**
 * Core 1:1 translator (`gemini-4-hydrogen`, temperature 0.1, ThinkingLevel.LOW)
 * Directly translates `cleanedRuForTranslation` (in ANY source language: Russian, English, etc.)
 * into natural conversational Uzbek 1:1.
 * Verifies in code that the number of segments and their `id`s match the original;
 * if any are missing, automatically repeats translation for the missing segments.
 */
export async function translateTurns1To1WithVerification(
  ai: GoogleGenAI,
  speakers: ParsedSpeakerProfile[],
  rawTurns: Omit<
    VerbatimTurn,
    "text" | "actualSyllables" | "validationPassed" | "validationNotes"
  >[],
  noSpeechIntervals: NoSpeechInterval[],
  generatedStoryboardText?: string
): Promise<VerbatimParseResult> {
  if (rawTurns.length === 0) {
    throw new Error("В видео или тексте не обнаружено речевых реплик для озвучки.");
  }

  const buildInputItem = (
    t: Omit<VerbatimTurn, "text" | "actualSyllables" | "validationPassed" | "validationNotes">
  ) => ({
    id: t.id,
    timeWindowSec: t.durationSec,
    maxSyllables: t.maxSyllables,
    speakerGender: t.speakerGender,
    emotion: t.intonationRu || t.emotion || "",
    text_original: t.cleanedRuForTranslation,
  });

  const translationInput = rawTurns.map(buildInputItem);

  const translationSystemPrompt = `Ты — профессиональный режиссёр узбекского дубляжа (Лип-синк и точный хронометраж 1:1).
Твоя задача — перевести массив реплик (text_original на языке оригинала: русский, английский или другой) напрямую на естественный разговорный узбекский язык (латиница) СТРОГО 1-в-1 для закадрового дубляжа видео, без промежуточного перевода.

ЖЕСТКИЕ ПРАВИЛА (НАРУШЕНИЕ ЗАПРЕЩЕНО):
1. СТРОГО 1-В-1 БЕЗ ОТСЕБЯТИНЫ: Сколько реплик на входе — ровно столько же на выходе с теми же самыми id. Запрещено пропускать реплики, объединять их или добавлять от себя лишние слова, приветствия или предложения.
2. НИКАКИХ РУСИЗМОВ И ДУБЛИРОВАНИЯ:
   - Например, «Давай!» (1 сек) переводится строго одним словом: «Ketdik!» или «Qani!» (ЗАПРЕЩЕНО писать «Davay! Ketdik!»).
   - «Ого-о! Вот это вдавило!» (2 сек) переводится коротко под 2 секунды: «O'ho'-o'! Zo'r tortdi-yu!».
   - «Нет» (1 сек) -> «Yo'q».
   - «Угу. Не веришь?» -> «Aha. Ishonmayapsanmi?».
3. БЕЗ РЕМАРОК В ТЕКСТЕ:
   - НИКОГДА не пиши слова в скобках вроде (kulib), (смеется), (вздыхает) внутри uzbekText.
   - Если в text_original уже есть документированные теги <laugh>, <sigh>, <short pause>, <breath>, <cough>, сохрани их.
4. УКЛАДКА В СЕКУНДЫ И СЛОГИ (Lip-Sync Budget):
   - Каждая узбекская реплика должна укладываться в лимит maxSyllables (~4.8 слога в секунду), чтобы диктор произнёс её естественно за timeWindowSec секунд.`;

  const candidateModels = ["gemini-4-hydrogen", "gemini-3.8-flash"];

  const requestTranslationBatch = async (
    itemsToTranslate: ReturnType<typeof buildInputItem>[]
  ): Promise<Array<{ id: string; uzbekText: string }>> => {
    for (const modelName of candidateModels) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: `${translationSystemPrompt}\n\nВходной массив реплик для перевода 1:1 (${itemsToTranslate.length} шт.):\n${JSON.stringify(
            itemsToTranslate,
            null,
            2
          )}`,
          config: {
            temperature: 0.1,
            ...(modelName.includes("hydrogen")
              ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
              : {}),
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                translations: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      uzbekText: { type: Type.STRING },
                    },
                    required: ["id", "uzbekText"],
                  },
                },
              },
              required: ["translations"],
            },
          },
        });
        const data = JSON.parse(response.text || "{}");
        if (Array.isArray(data?.translations) && data.translations.length > 0) {
          return data.translations;
        }
      } catch (err: any) {
        console.warn(`[Verbatim Translator] ${modelName} fallback notice:`, err?.message);
      }
    }
    return [];
  };

  // Initial translation pass (chunked by 35 turns if very long to ensure zero truncation)
  const CHUNK_SIZE = 35;
  const translationMap = new Map<string, string>();

  for (let i = 0; i < translationInput.length; i += CHUNK_SIZE) {
    const chunk = translationInput.slice(i, i + CHUNK_SIZE);
    const chunkResult = await requestTranslationBatch(chunk);
    chunkResult.forEach((item, idx) => {
      if (item?.id && item?.uzbekText?.trim()) {
        translationMap.set(String(item.id).trim(), item.uzbekText.trim());
      } else if (chunk[idx] && item?.uzbekText?.trim()) {
        translationMap.set(chunk[idx].id, item.uzbekText.trim());
      }
    });
  }

  // Verification in code (Point 6): check that segment count and every segment `id` match the original;
  // otherwise repeat translation for missing segments!
  for (let retryPass = 0; retryPass < 2; retryPass++) {
    const missingTurns = rawTurns.filter(
      (t) => !translationMap.has(t.id) || !translationMap.get(t.id)?.trim()
    );
    if (missingTurns.length === 0 && translationMap.size === rawTurns.length) {
      break;
    }
    if (missingTurns.length === 0) break;

    console.log(
      `[Verbatim Translator] Retry pass ${retryPass + 1}: translating ${missingTurns.length} missing segment(s) by id...`
    );
    const retryItems = missingTurns.map(buildInputItem);
    const retryTranslated = await requestTranslationBatch(retryItems);
    retryTranslated.forEach((item, idx) => {
      if (item?.id && item?.uzbekText?.trim()) {
        translationMap.set(String(item.id).trim(), item.uzbekText.trim());
      } else if (missingTurns[idx] && item?.uzbekText?.trim()) {
        translationMap.set(missingTurns[idx].id, item.uzbekText.trim());
      }
    });
  }

  // Post-Translation Automated Validator (checks syllable budget, sentence count, and tag whitelist)
  const turnsNeedingShortening: Array<{
    id: string;
    originalText: string;
    draftUzbek: string;
    targetMaxSyllables: number;
    timeWindowSec: number;
  }> = [];

  const validatedTurns: VerbatimTurn[] = rawTurns.map((turn) => {
    const rawTranslated =
      translationMap.get(turn.id) || turn.cleanedRuForTranslation;
    let sanitizedUz = sanitizeDocumentedTtsTags(rawTranslated);

    // Ensure inline tags from original (<laugh>, <sigh>, <short pause>, <breath>, <cough>) are preserved
    for (const tag of turn.inlineTags) {
      if (!sanitizedUz.toLowerCase().includes(tag.toLowerCase())) {
        if (tag === "<laugh>" || tag === "<sigh>" || tag === "<breath>" || tag === "<cough>") {
          sanitizedUz = `${sanitizedUz} ${tag}`.trim();
        }
      }
    }

    const actualSyllables = countSyllables(sanitizedUz);
    const origSentences = countSentences(turn.cleanedRuForTranslation);
    const uzSentences = countSentences(sanitizedUz);

    const isTooLong =
      turn.durationSec <= 3
        ? actualSyllables > turn.maxSyllables + 3
        : actualSyllables > Math.ceil(turn.maxSyllables * 1.2);
    const hasExtraSentences = uzSentences > origSentences + 1;

    if (isTooLong || hasExtraSentences) {
      turnsNeedingShortening.push({
        id: turn.id,
        originalText: turn.cleanedRuForTranslation,
        draftUzbek: sanitizedUz,
        targetMaxSyllables: turn.maxSyllables,
        timeWindowSec: turn.durationSec,
      });
    }

    return {
      ...turn,
      text: sanitizedUz,
      actualSyllables,
      validationPassed: !isTooLong && !hasExtraSentences,
      validationNotes: isTooLong
        ? `Слогов: ${actualSyllables} (макс. ${turn.maxSyllables} для ${turn.durationSec}с)`
        : undefined,
    };
  });

  // Automatic Re-Translation for any turns that exceeded syllable budget
  if (turnsNeedingShortening.length > 0) {
    for (const modelName of candidateModels) {
      try {
        const retryRes = await ai.models.generateContent({
          model: modelName,
          contents: `Сократи следующие узбекские переводы так, чтобы каждая фраза СТРОГО укладывалась в targetMaxSyllables слогов (для укладки в timeWindowSec секунд видео) без потери смысла и без добавления лишних слов. Сохрани теги <laugh>, <sigh>, <short pause>, <breath>, <cough>.\n\n${JSON.stringify(
            turnsNeedingShortening,
            null,
            2
          )}`,
          config: {
            temperature: 0.1,
            ...(modelName.includes("hydrogen")
              ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
              : {}),
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                shortened: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING },
                      uzbekText: { type: Type.STRING },
                    },
                    required: ["id", "uzbekText"],
                  },
                },
              },
              required: ["shortened"],
            },
          },
        });
        const retryData = JSON.parse(retryRes.text || "{}");
        if (Array.isArray(retryData?.shortened)) {
          const shortMap = new Map<string, string>();
          for (const item of retryData.shortened) {
            if (item?.id && item?.uzbekText) {
              shortMap.set(item.id, sanitizeDocumentedTtsTags(item.uzbekText));
            }
          }
          for (const vt of validatedTurns) {
            const fixed = shortMap.get(vt.id);
            if (fixed) {
              vt.text = fixed;
              vt.actualSyllables = countSyllables(fixed);
              vt.validationPassed = true;
              vt.validationNotes = `Авто-уложено под ${vt.durationSec}с (${vt.actualSyllables} слогов)`;
            }
          }
        }
        break;
      } catch (e: any) {
        console.warn(`[Verbatim Validator Retry] ${modelName} notice:`, e?.message);
      }
    }
  }

  const maxTurnEnd = Math.max(
    0,
    ...validatedTurns.map((t) => t.endSec),
    ...noSpeechIntervals.map((n) => n.endSec)
  );

  const translationUsd = Math.max(0.01, Math.round(validatedTurns.length * 0.0015 * 100) / 100);
  const ttsUsd = Math.max(0.02, Math.round(validatedTurns.length * 0.01 * 100) / 100);

  return {
    title: validatedTurns[0]?.sceneTitle || "Точный дубляж 1:1 по раскадровке",
    speakers,
    turns: validatedTurns,
    noSpeechIntervals,
    totalDurationSec: maxTurnEnd,
    generatedStoryboardText,
    estimatedCostUsd: {
      translationUsd,
      ttsUsd,
      totalUsd: Math.round((translationUsd + ttsUsd) * 100) / 100,
    },
  };
}

/**
 * Extracts structured JSON storyboard directly from an ACTIVE Gemini Files API video using `gemini-3.8-flash`
 * and `responseSchema` (Point 5):
 * {
 *   speakers: [{ id, gender: "male"|"female", description }],
 *   segments: [{
 *     start: "MM:SS.s", end: "MM:SS.s",
 *     type: "speech" | "no_speech",
 *     speakerId, emotion, text_original, non_speech_events: ["laugh","sigh",...]
 *   }]
 * }
 */
export async function extractVideoJsonStoryboardViaGemini(
  ai: GoogleGenAI,
  fileUri: string,
  mimeType: string
): Promise<VideoJsonStoryboard> {
  const prompt = `Проанализируй это видео от начала и до конца и создай точную посекундную раскадровку в формате JSON для профессионального дубляжа 1:1.

СТРОГИЕ ПРАВИЛА:
1. speakers: перечисли всех говорящих в видео:
   - id: "HOST_1", "HOST_2" (и далее, если спикеров больше)
   - gender: строго "female" (женский голос) или "male" (мужской голос)
   - description: краткое описание роли, внешности и характера голоса на русском языке (например: "Девушка на пассажирском сиденье, живой эмоциональный голос" или "Мужчина-водитель, спокойный уверенный голос").
2. segments: разбей видео хронологически по таймкодам start и end в формате "MM:SS.s" (например "00:00.0", "00:02.5", "01:14.2").
3. type:
   - "speech" — когда звучит речь спикера. Каждую отдельную реплику или смену спикера выделяй в отдельный сегмент.
   - "no_speech" — когда речи нет (играет только музыка, проезд камеры, графика или пауза более 2 секунд).
4. text_original:
   - Записывай ДОСЛОВНО на языке оригинала видео (русский, английский или другой).
   - НЕ переводи text_original на этом шаге!
   - НИЧЕГО не добавляй от себя, не додумывай и не пересказывай. Сколько фраз реально произнесено в видео — ровно столько и должно быть.
   - Для сегментов type="no_speech" оставляй text_original пустой строкой "".
5. non_speech_events:
   - Если говорящий смеётся, усмехается, вздыхает, делает заметный вдох или покашливает, выноси это СТРОГО в массив non_speech_events (допустимые значения: "laugh", "sigh", "short pause", "breath", "cough"), А НЕ ВНУТРЬ text_original! Внутри text_original не должно быть слов в скобках вроде "(смеется)" или "(вздыхает)".
6. emotion:
   - Укажи точную интонацию и эмоцию реплики на русском языке (например: "С интересом, вопросительно", "Спокойно, уверенно", "Восторженно, с удивлением", "С легкой улыбкой"). Для "no_speech" укажи краткое описание музыки/кадра (например: "Динамичная музыка, кадры автомобиля").`;

  const response = await ai.models.generateContent({
    model: "gemini-3.8-flash",
    contents: [
      {
        role: "user",
        parts: [
          {
            fileData: {
              fileUri,
              mimeType: mimeType || "video/mp4",
            },
          },
          {
            text: prompt,
          },
        ],
      },
    ],
    config: {
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          speakers: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                gender: { type: Type.STRING, enum: ["male", "female"] },
                description: { type: Type.STRING },
              },
              required: ["id", "gender", "description"],
            },
          },
          segments: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                start: { type: Type.STRING },
                end: { type: Type.STRING },
                type: { type: Type.STRING, enum: ["speech", "no_speech"] },
                speakerId: { type: Type.STRING },
                emotion: { type: Type.STRING },
                text_original: { type: Type.STRING },
                non_speech_events: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
              required: [
                "start",
                "end",
                "type",
                "speakerId",
                "emotion",
                "text_original",
                "non_speech_events",
              ],
            },
          },
        },
        required: ["speakers", "segments"],
      },
    },
  });

  const parsed: VideoJsonStoryboard = JSON.parse(response.text || "{}");
  if (!parsed || !Array.isArray(parsed.segments) || parsed.segments.length === 0) {
    throw new Error("Модель не вернула сегменты раскадровки из видео.");
  }
  return {
    speakers: Array.isArray(parsed.speakers) ? parsed.speakers : [],
    segments: parsed.segments,
  };
}

/**
 * Converts structured `VideoJsonStoryboard` from `gemini-3.8-flash` into `ParsedSpeakerProfile[]`,
 * `turns`, and `noSpeechIntervals`, then translates 1:1 into Uzbek via `gemini-4-hydrogen`
 * (temperature 0.1, ThinkingLevel.LOW) with segment count & id verification.
 */
export async function convertAndTranslateVideoJsonStoryboard(
  ai: GoogleGenAI,
  jsonStoryboard: VideoJsonStoryboard
): Promise<VerbatimParseResult & { rawJsonStoryboard: VideoJsonStoryboard }> {
  const femaleVoices = [
    { voiceId: "Kore", baseVoice: "Kore" },
    { voiceId: "Aoede", baseVoice: "Aoede" },
    { voiceId: "Zephyr", baseVoice: "Zephyr" },
  ];
  const maleVoices = [
    { voiceId: "voice_17raj9ewke3g", baseVoice: "Charon" },
    { voiceId: "Fenrir", baseVoice: "Fenrir" },
    { voiceId: "Puck", baseVoice: "Puck" },
  ];

  const speakerMap = new Map<string, ParsedSpeakerProfile>();
  const rawSpeakers =
    jsonStoryboard.speakers.length > 0
      ? jsonStoryboard.speakers
      : [{ id: "HOST_1", gender: "male" as const, description: "Спикер 1" }];

  let femCount = 0;
  let maleCount = 0;

  rawSpeakers.forEach((sp, idx) => {
    const normalizedId = `HOST_${idx + 1}`;
    const gender: "female" | "male" = sp.gender === "female" ? "female" : "male";
    const chosenVoice =
      gender === "female"
        ? femaleVoices[femCount++ % femaleVoices.length]
        : maleVoices[maleCount++ % maleVoices.length];

    const roleName =
      gender === "female"
        ? `Девушка (Ж)`
        : `Мужчина (М)`;

    const profile: ParsedSpeakerProfile = {
      id: normalizedId,
      rawLabel: roleName,
      name: roleName,
      gender,
      description: (sp.description || "").trim(),
      defaultVoiceStyle:
        gender === "female"
          ? `Natural expressive female Uzbek speaker. ${sp.description || ""}`
          : `Natural confident male Uzbek speaker. ${sp.description || ""}`,
      recommendedVoiceId: chosenVoice.voiceId,
      recommendedBaseVoice: chosenVoice.baseVoice,
    };

    speakerMap.set(sp.id, profile);
    speakerMap.set(normalizedId, profile);
  });

  const resolveSpeaker = (rawSpeakerId: string): ParsedSpeakerProfile => {
    if (speakerMap.has(rawSpeakerId)) return speakerMap.get(rawSpeakerId)!;
    const upper = String(rawSpeakerId || "").toUpperCase();
    if (speakerMap.has(upper)) return speakerMap.get(upper)!;
    // Match by number e.g. "S1" / "1" / "SPEAKER_1" -> "HOST_1"
    const numMatch = upper.match(/(\d+)/);
    if (numMatch) {
      const candidate = `HOST_${numMatch[1]}`;
      if (speakerMap.has(candidate)) return speakerMap.get(candidate)!;
    }
    return Array.from(speakerMap.values())[0];
  };

  const uniqueSpeakers = Array.from(
    new Map(Array.from(speakerMap.values()).map((s) => [s.id, s])).values()
  );

  const rawTurns: Omit<
    VerbatimTurn,
    "text" | "actualSyllables" | "validationPassed" | "validationNotes"
  >[] = [];
  const noSpeechIntervals: NoSpeechInterval[] = [];
  const humanStoryboardLines: string[] = [];

  uniqueSpeakers.forEach((sp, i) => {
    humanStoryboardLines.push(
      `Спикер ${i + 1} (${sp.gender === "female" ? "Ж" : "М"}) — ${sp.name}: ${
        sp.description || "Голос дубляжа"
      }`
    );
  });
  humanStoryboardLines.push("");

  for (const seg of jsonStoryboard.segments) {
    const startSec = parseTimecodeToSec(seg.start);
    const parsedEnd = parseTimecodeToSec(seg.end);
    const endSec = parsedEnd > startSec ? parsedEnd : Math.round((startSec + 2) * 10) / 10;
    const durationSec = Math.max(0.8, Math.round((endSec - startSec) * 10) / 10);
    const timecodeStr = `${seg.start || formatSecToTimecode(startSec)} – ${
      seg.end || formatSecToTimecode(endSec)
    }`;

    const rawTextOriginal = String(seg.text_original || "").trim();
    const isNoSpeech = seg.type === "no_speech" || !rawTextOriginal;

    if (isNoSpeech) {
      noSpeechIntervals.push({
        id: `nospeech-${noSpeechIntervals.length + 1}`,
        timecode: timecodeStr,
        startSec,
        endSec,
        durationSec,
        label: "Без слов",
        visualDescription: seg.emotion || "Музыка / Видеоряд без речи",
      });
      humanStoryboardLines.push(`${timecodeStr} | Музыка и кадр (Без слов):`);
      if (seg.emotion) humanStoryboardLines.push(`Видеоряд: ${seg.emotion}`);
      humanStoryboardLines.push("");
      continue;
    }

    const spProfile = resolveSpeaker(seg.speakerId);
    const extracted = extractAndConvertInlineRemarks(rawTextOriginal);
    // Strip any inline <laugh>/<sigh> from text_original display so text_original is pure spoken words
    const pureOriginalText = extracted.cleanedText
      .replace(/<(?:laugh|sigh|short pause|breath|cough)>/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!pureOriginalText) continue;

    // Combine non_speech_events from schema + any extracted from parentheticals
    const normalizedEvents = Array.from(
      new Set([
        ...(Array.isArray(seg.non_speech_events) ? seg.non_speech_events : [])
          .map((ev) => String(ev || "").trim().toLowerCase())
          .filter(Boolean),
        ...extracted.nonSpeechEvents,
      ])
    );

    const eventToTagMap: Record<string, string> = {
      laugh: "<laugh>",
      chuckle: "<laugh>",
      giggle: "<laugh>",
      sigh: "<sigh>",
      "short pause": "<short pause>",
      pause: "<short pause>",
      breath: "<breath>",
      gasp: "<breath>",
      cough: "<cough>",
    };

    const inlineTags = Array.from(
      new Set(
        normalizedEvents
          .map((ev) => eventToTagMap[ev])
          .filter((t): t is string => Boolean(t))
      )
    );

    const { emotion, speechStyle, pace } = mapRussianIntonationToStyle(
      seg.emotion || "",
      "",
      [...extracted.extraStyleHints, ...normalizedEvents],
      spProfile
    );

    const maxSyllables = Math.max(4, Math.ceil(durationSec * 4.8));

    const turnId = `turn-${rawTurns.length + 1}`;
    rawTurns.push({
      id: turnId,
      index: rawTurns.length,
      timecode: timecodeStr,
      startSec,
      endSec,
      durationSec,
      speakerId: spProfile.id,
      speakerName: spProfile.name,
      speakerGender: spProfile.gender,
      intonationRu: seg.emotion || undefined,
      originalTextRu: pureOriginalText,
      cleanedRuForTranslation: pureOriginalText,
      emotion,
      speechStyle,
      pace,
      inlineTags,
      nonSpeechEvents: normalizedEvents,
      maxSyllables,
    });

    humanStoryboardLines.push(`${timecodeStr} | ${spProfile.name}:`);
    if (seg.emotion) humanStoryboardLines.push(`Интонация: ${seg.emotion}`);
    if (normalizedEvents.length > 0) {
      humanStoryboardLines.push(`Неречевые реакции: ${normalizedEvents.join(", ")}`);
    }
    humanStoryboardLines.push(`Текст: «${pureOriginalText}»`);
    humanStoryboardLines.push("");
  }

  if (rawTurns.length === 0) {
    throw new Error("В видео не обнаружено речевых реплик (получено 0 сегментов речи).");
  }

  const translatedResult = await translateTurns1To1WithVerification(
    ai,
    uniqueSpeakers,
    rawTurns,
    noSpeechIntervals,
    humanStoryboardLines.join("\n").trim()
  );

  return {
    ...translatedResult,
    rawJsonStoryboard: jsonStoryboard,
  };
}

/**
 * Translates parsed storyboard turns 1:1 into natural conversational Uzbek using gemini-4-hydrogen (ThinkingLevel.LOW, temp 0.1)
 * and runs the Post-Translation Validator (checking 1:1 count & ids, sentence count, documented tags, and syllable budget).
 */
export async function parseAndTranslateVerbatimStoryboard(
  ai: GoogleGenAI,
  rawStoryboardText: string
): Promise<VerbatimParseResult> {
  let parsed = parseStoryboardDeterministic(rawStoryboardText);

  if (parsed.turns.length === 0 && rawStoryboardText.trim().length > 10) {
    parsed = {
      ...(await fallbackExtractStoryboardViaLlm(ai, rawStoryboardText)),
      unparsedBlocks: [],
    };
  }

  if (parsed.turns.length === 0) {
    throw new Error(
      "В отправленном тексте не найдено реплик для озвучки. Убедитесь, что в раскадровке есть строки «Текст: ...» или таймкоды «00:00 – 00:05»."
    );
  }

  return translateTurns1To1WithVerification(
    ai,
    parsed.speakers,
    parsed.turns,
    parsed.noSpeechIntervals,
    rawStoryboardText
  );
}

/**
 * Applies pitch-preserving ffmpeg atempo filter strictly bounded to [1.00, 1.15] on 24kHz 16-bit mono PCM.
 */
export async function applyMildAtempoPcm(
  pcmBuffer: Buffer,
  speedRatio: number,
  sampleRate = 24000
): Promise<Buffer> {
  const clampedRatio = Math.min(1.15, Math.max(1.0, Math.round(speedRatio * 1000) / 1000));
  if (clampedRatio <= 1.01 || !fs.existsSync("/usr/bin/ffmpeg")) {
    return pcmBuffer;
  }

  const tmpId = `atempo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const inRawPath = path.join("/tmp", `${tmpId}_in.pcm`);
  const outRawPath = path.join("/tmp", `${tmpId}_out.pcm`);

  try {
    await fs.promises.writeFile(inRawPath, pcmBuffer);
    await execFileAsync("/usr/bin/ffmpeg", [
      "-y",
      "-f",
      "s16le",
      "-ar",
      String(sampleRate),
      "-ac",
      "1",
      "-i",
      inRawPath,
      "-filter:a",
      `atempo=${clampedRatio}`,
      "-f",
      "s16le",
      "-ar",
      String(sampleRate),
      "-ac",
      "1",
      outRawPath,
    ]);
    const outBuf = await fs.promises.readFile(outRawPath);
    return outBuf.length > 0 ? outBuf : pcmBuffer;
  } catch (err: any) {
    console.warn("[applyMildAtempoPcm] ffmpeg atempo warning:", err?.message);
    return pcmBuffer;
  } finally {
    fs.promises.unlink(inRawPath).catch(() => {});
    fs.promises.unlink(outRawPath).catch(() => {});
  }
}

/**
 * Assembles individual turn PCM buffers onto an exact second-by-second master timeline buffer
 * (24000 Hz, 16-bit mono = 48000 bytes per second).
 * - Places each turn strictly at its `startSec`.
 * - Leaves `Без слов` musical intervals untouched (pure silence on the voice track).
 * - Never overlaps consecutive turns.
 */
export function assembleStrictTimecodeMasterPcm(
  turnsWithPcm: Array<{
    startSec: number;
    endSec: number;
    pcm: Buffer;
  }>,
  totalTimelineSec?: number,
  sampleRate = 24000
): {
  masterPcm: Buffer;
  totalDurationSec: number;
  actualPlacements: Array<{ startSec: number; endSec: number; durationSec: number }>;
} {
  const bytesPerSample = 2;
  const bytesPerSec = sampleRate * bytesPerSample;

  let maxEndSec = totalTimelineSec || 0;
  for (const t of turnsWithPcm) {
    const durSec = t.pcm.length / bytesPerSec;
    maxEndSec = Math.max(maxEndSec, (t.startSec || 0) + durSec, t.endSec || 0);
  }

  const totalSamples = Math.max(sampleRate, Math.ceil((maxEndSec + 0.5) * sampleRate));
  const masterPcm = Buffer.alloc(totalSamples * bytesPerSample, 0);
  const actualPlacements: Array<{ startSec: number; endSec: number; durationSec: number }> = [];

  for (let i = 0; i < turnsWithPcm.length; i++) {
    const current = turnsWithPcm[i];
    const nextStartSec =
      i + 1 < turnsWithPcm.length && typeof turnsWithPcm[i + 1].startSec === "number"
        ? turnsWithPcm[i + 1].startSec
        : maxEndSec + 5;

    const targetStartSec = Math.max(0, current.startSec || 0);
    const startSample = Math.floor(targetStartSec * sampleRate);
    const startByte = startSample * bytesPerSample;

    // Prevent overlapping into the next turn's startSec (leave at least 40ms breathing room if tight)
    const maxAllowedEndSec = Math.max(targetStartSec + 0.3, nextStartSec - 0.04);
    const maxAllowedBytes =
      Math.floor((maxAllowedEndSec - targetStartSec) * sampleRate) * bytesPerSample;

    const bytesToCopy = Math.min(
      current.pcm.length - (current.pcm.length % 2),
      maxAllowedBytes,
      masterPcm.length - startByte
    );

    if (bytesToCopy > 0 && startByte >= 0 && startByte < masterPcm.length) {
      current.pcm.copy(masterPcm, startByte, 0, bytesToCopy);
    }

    const actualDurSec = Math.round((Math.max(0, bytesToCopy) / bytesPerSec) * 100) / 100;
    actualPlacements.push({
      startSec: targetStartSec,
      endSec: Math.round((targetStartSec + actualDurSec) * 100) / 100,
      durationSec: actualDurSec,
    });
  }

  const finalDurationSec = Math.round((masterPcm.length / bytesPerSec) * 10) / 10;
  return {
    masterPcm,
    totalDurationSec: finalDurationSec,
    actualPlacements,
  };
}

/**
 * Generates clean .SRT subtitle file content from the dubbed turns
 */
export function generateSrtFromTurns(
  turns: Array<{
    startSec?: number;
    endSec?: number;
    startTime?: number;
    endTime?: number;
    speakerName?: string;
    text: string;
  }>
): string {
  const blocks: string[] = [];
  let counter = 1;

  for (const t of turns) {
    const start = typeof t.startSec === "number" ? t.startSec : t.startTime || 0;
    const end =
      typeof t.endSec === "number" && t.endSec > start
        ? t.endSec
        : typeof t.endTime === "number" && t.endTime > start
          ? t.endTime
          : start + 2.5;

    const cleanSubText = sanitizeDocumentedTtsTags(t.text || "")
      .replace(/<(?:laugh|sigh|short pause|breath|cough)>/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleanSubText) continue;

    blocks.push(
      `${counter}\n${formatSecToSrtTime(start)} --> ${formatSecToSrtTime(end)}\n${cleanSubText}`
    );
    counter++;
  }

  return blocks.join("\n\n") + "\n";
}

/**
 * Muxes the time-aligned Uzbek WAV track onto an uploaded video file (up to 15 min) using /usr/bin/ffmpeg.
 * Supports 3 background modes:
 * - "smart_ducking": 15% original video volume during spoken turns, 100% volume during "Без слов" musical intervals
 * - "mute_speech_keep_music": 0% original video volume during spoken turns (no Russian speech bleed), 100% during "Без слов"
 * - "voice_only": 0% original video audio everywhere, 100% Uzbek dubbing track
 */
export async function muxDubbedAudioWithVideoFile({
  videoFilePath,
  dubbedWavBuffer,
  spokenIntervals,
  backgroundMode = "smart_ducking",
}: {
  videoFilePath: string;
  dubbedWavBuffer: Buffer;
  spokenIntervals: Array<{ startSec: number; endSec: number }>;
  backgroundMode: "smart_ducking" | "mute_speech_keep_music" | "voice_only";
}): Promise<string> {
  if (!fs.existsSync("/usr/bin/ffmpeg")) {
    throw new Error("ffmpeg не найден на сервере для сборки видео.");
  }

  const jobId = `dubmux_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const wavPath = path.join("/tmp", `${jobId}_dub.wav`);
  const outMp4Path = path.join("/tmp", `${jobId}_dubbed.mp4`);

  await fs.promises.writeFile(wavPath, dubbedWavBuffer);

  try {
    if (backgroundMode === "voice_only" || spokenIntervals.length === 0) {
      await execFileAsync("/usr/bin/ffmpeg", [
        "-y",
        "-i",
        videoFilePath,
        "-i",
        wavPath,
        "-c:v",
        "copy",
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        outMp4Path,
      ]);
      return outMp4Path;
    }

    // Build ffmpeg volume enable expression for spoken intervals
    // Merge nearby spoken intervals separated by <0.6s so volume doesn't pump between rapid back-and-forth turns
    const sorted = [...spokenIntervals]
      .filter((iv) => iv.endSec > iv.startSec)
      .sort((a, b) => a.startSec - b.startSec);

    const merged: Array<{ startSec: number; endSec: number }> = [];
    for (const iv of sorted) {
      if (merged.length === 0) {
        merged.push({ ...iv });
      } else {
        const prev = merged[merged.length - 1];
        if (iv.startSec - prev.endSec <= 0.6) {
          prev.endSec = Math.max(prev.endSec, iv.endSec);
        } else {
          merged.push({ ...iv });
        }
      }
    }

    const duckGain = backgroundMode === "mute_speech_keep_music" ? "0.0" : "0.15";
    const betweenClauses = merged
      .slice(0, 80) // keep expression compact for ffmpeg filter parser
      .map((iv) => `between(t,${Math.max(0, iv.startSec - 0.1).toFixed(2)},${(iv.endSec + 0.15).toFixed(2)})`)
      .join("+");

    const filterComplex = `[0:a]volume=${duckGain}:enable='${betweenClauses}'[orig_ducked];[1:a]volume=1.15[dub_voice];[orig_ducked][dub_voice]amix=inputs=2:duration=first:dropout_transition=0,alimiter=limit=0.95[aout]`;

    try {
      await execFileAsync("/usr/bin/ffmpeg", [
        "-y",
        "-i",
        videoFilePath,
        "-i",
        wavPath,
        "-filter_complex",
        filterComplex,
        "-map",
        "0:v:0",
        "-map",
        "[aout]",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        outMp4Path,
      ]);
    } catch {
      // Fallback if source video has no audio stream at all
      await execFileAsync("/usr/bin/ffmpeg", [
        "-y",
        "-i",
        videoFilePath,
        "-i",
        wavPath,
        "-c:v",
        "copy",
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        outMp4Path,
      ]);
    }

    return outMp4Path;
  } finally {
    fs.promises.unlink(wavPath).catch(() => {});
  }
}
