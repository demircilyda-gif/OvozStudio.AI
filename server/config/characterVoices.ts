export type CharacterVoiceRole = "girl" | "boy" | "creature" | "narrator_kids";

export interface CharacterVoice {
  id: string;
  nameUz: string;
  nameRu: string;
  category: "cartoon";
  role: CharacterVoiceRole;
  temperament: string;
  baseVoice?: string;
  voiceId?: string;
  baseStyle: string;
  pitchSemitones: number; // 0..4
  previewUrl?: string;
  previewTextUz?: string;
}

export interface PublicCharacterVoice {
  id: string;
  nameUz: string;
  nameRu: string;
  category: "cartoon";
  role: CharacterVoiceRole;
  temperament: string;
  baseVoice?: string;
  pitchSemitones: number;
  previewUrl?: string;
}

export const CHARACTER_VOICES: CharacterVoice[] = [
  {
    id: "qizcha_quvnoq",
    nameUz: "Quvnoq qizcha",
    nameRu: "Весёлая девочка",
    category: "cartoon",
    role: "girl",
    temperament: "quvnoq",
    baseVoice: "Leda",
    baseStyle:
      "bright, playful animated cartoon character, high energy, bouncy, delighted",
    pitchSemitones: 3,
    previewUrl: "/audio/previews/characters/qizcha_quvnoq.wav",
    previewTextUz:
      "Salom, do'stlar! <laugh> Bugun bizni ajoyib sarguzashtlar kutmoqda, yur tezroq!",
  },
  {
    id: "qizcha_mayin",
    nameUz: "Mayin qizcha",
    nameRu: "Нежная девочка",
    category: "cartoon",
    role: "girl",
    temperament: "mayin",
    baseVoice: "Achird",
    baseStyle:
      "soft, gentle, shy animated cartoon character, warm and sweet, calm pace",
    pitchSemitones: 3,
    previewUrl: "/audio/previews/characters/qizcha_mayin.wav",
    previewTextUz:
      "Assalomu alaykum... <short pause> Qarang, kichkina kapalak gulga qo'ndi, qanchalar chiroyli!",
  },
  {
    id: "bola_shox",
    nameUz: "Sho'x bola",
    nameRu: "Озорной мальчик",
    category: "cartoon",
    role: "boy",
    temperament: "sho'x",
    baseVoice: "Puck",
    baseStyle:
      "cheeky, mischievous animated cartoon character, fast and lively, playful teasing",
    pitchSemitones: 2,
    previewUrl: "/audio/previews/characters/bola_shox.wav",
    previewTextUz:
      "Hoy, to'xta! <laugh> Kim birinchi bog'ga yugurib boradi? Men baribir sendan tezroqman!",
  },
  {
    id: "bola_jasur",
    nameUz: "Jasur bola",
    nameRu: "Смелый мальчик",
    category: "cartoon",
    role: "boy",
    temperament: "jasur",
    baseVoice: "Fenrir",
    baseStyle:
      "brave, excited animated cartoon hero, energetic, confident, enthusiastic",
    pitchSemitones: 2,
    previewUrl: "/audio/previews/characters/bola_jasur.wav",
    previewTextUz:
      "Qo'rqmanglar, do'stlar! <short pause> Biz birgalikda eng baland tog'ni ham zabt etamiz!",
  },
  {
    id: "mitti_qahramon",
    nameUz: "Mitti qahramon",
    nameRu: "Забавный зверёк",
    category: "cartoon",
    role: "creature",
    temperament: "kulgili",
    baseVoice: "Sadachbia",
    baseStyle:
      "tiny funny cartoon creature, exaggerated squeaky expressive delivery, comedic",
    pitchSemitones: 4,
    previewUrl: "/audio/previews/characters/mitti_qahramon.wav",
    previewTextUz:
      "Voy-voy! <laugh> Mening yong'og'im qayerga dumalab ketdi? To'xta, qochma!",
  },
  {
    id: "ertak_hikoyachi",
    nameUz: "Ertak hikoyachi",
    nameRu: "Добрый сказочник",
    category: "cartoon",
    role: "narrator_kids",
    temperament: "mehribon",
    baseVoice: "Aoede",
    baseStyle:
      "warm, kind fairy-tale narrator for children's stories, gentle, expressive, slow",
    pitchSemitones: 0,
    previewUrl: "/audio/previews/characters/ertak_hikoyachi.wav",
    previewTextUz:
      "Bir bor ekan, bir yo'q ekan... <short pause> Yashil o'rmon chetida kichkina ayiqcha yashar ekan.",
  },
];

export function getCharacterVoiceById(id?: string): CharacterVoice | undefined {
  const clean = String(id || "").trim();
  if (!clean) return undefined;
  return CHARACTER_VOICES.find((v) => v.id === clean);
}

/**
 * Public read-only view of the cartoon character catalog.
 * STRICTLY omits private cloned `voiceId` fields so internal voice IDs are never exposed.
 */
export function getPublicCharacterVoices(): PublicCharacterVoice[] {
  return CHARACTER_VOICES.map((v) => ({
    id: v.id,
    nameUz: v.nameUz,
    nameRu: v.nameRu,
    category: v.category,
    role: v.role,
    temperament: v.temperament,
    ...(v.baseVoice ? { baseVoice: v.baseVoice } : {}),
    pitchSemitones: Math.max(0, Math.min(4, Number(v.pitchSemitones) || 0)),
    ...(v.previewUrl ? { previewUrl: v.previewUrl } : {}),
  }));
}

/**
 * Compact catalog passed into the AI Agent system prompt (no baseStyle or technical internals).
 */
export function getCompactCharacterCatalogForAgent(): Array<{
  id: string;
  role: CharacterVoiceRole;
  temperament: string;
  nameUz: string;
}> {
  return CHARACTER_VOICES.map((v) => ({
    id: v.id,
    role: v.role,
    temperament: v.temperament,
    nameUz: v.nameUz,
  }));
}

export function clampPitchSemitones(semitones?: number): number {
  const n = Number(semitones);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(4, Math.round(n * 10) / 10));
}

/**
 * Word-boundary-safe patterns matching child-age descriptors in Gemini STYLE strings ONLY.
 * NEVER run this sanitizer on spoken script text!
 *
 * Uses Unicode-aware boundaries `(?<![\p{L}\p{N}_])` and `(?![\p{L}\p{N}_])` so:
 * - "лет" does NOT match inside "полёт" or "летом"
 * - "kid" does NOT match inside "kidney"
 */
const DISALLOWED_STYLE_PATTERNS: RegExp[] = [
  // Explicit age patterns: "8 лет", "5 года", "7 yosh", "8 years old", "8-year-old"
  /(?<![\p{L}\p{N}_])\d{1,2}\s*[-–]?\s*(?:лет|года?|год|yosh(?:li|da)?|years?\s*old|yo)(?![\p{L}\p{N}_])/giu,
  // Multi-word phrases first so clean single replacement occurs
  /(?<![\p{L}\p{N}_])(?:child(?:'s)?|kid(?:'s)?|kids)\s+(?:voice|actor|speaker|tone|character)(?![\p{L}\p{N}_])/giu,
  /(?<![\p{L}\p{N}_])years?\s+old(?![\p{L}\p{N}_])/giu,
  /(?<![\p{L}\p{N}_])yosh\s+bola(?:ning|lar)?(?:\s+ovozi)?(?![\p{L}\p{N}_])/giu,
  /(?<![\p{L}\p{N}_])bola(?:ning|lar)?\s+ovozi(?![\p{L}\p{N}_])/giu,
  /(?<![\p{L}\p{N}_])детск(?:ий|им|ого|ому|ом|ая|ую|ой)\s+голос(?:а|ом|у|е)?(?![\p{L}\p{N}_])/giu,
  // Single disallowed age/child words with strict word boundaries
  /(?<![\p{L}\p{N}_])(?:child|kid|kids|toddler|baby)(?![\p{L}\p{N}_])/giu,
  /(?<![\p{L}\p{N}_])реб[её]н(?:ок|ка|ку|ком|ке)(?![\p{L}\p{N}_])/giu,
];

/**
 * Sanitizes ONLY Gemini style/delivery strings so zero child-age descriptors are ever sent.
 * Replaces matched terms with "animated cartoon character".
 * NEVER call this on the spoken script text!
 */
export function sanitizeStyleForGooglePolicy(rawStyle: string): string {
  let out = String(rawStyle || "");
  if (!out.trim()) return "";

  for (const rx of DISALLOWED_STYLE_PATTERNS) {
    out = out.replace(rx, "animated cartoon character");
  }

  // Collapse duplicate consecutive replacements and tidy spacing/punctuation
  out = out
    .replace(
      /(animated cartoon character)(?:[\s,]+animated cartoon character)+/gi,
      "animated cartoon character"
    )
    .replace(/\s{2,}/g, " ")
    .replace(/\s+,/g, ",")
    .trim();

  return out;
}

/**
 * Audit helper: returns any remaining disallowed child-age matches in a Gemini style string.
 */
export function findDisallowedChildAgeTermsInStyle(style: string): string[] {
  const s = String(style || "");
  const matches: string[] = [];
  for (const rx of DISALLOWED_STYLE_PATTERNS) {
    const found = s.match(rx);
    if (found) {
      matches.push(...found);
    }
  }
  return Array.from(new Set(matches));
}

/**
 * Detects whether an error returned by Google Gemini is a safety/policy refusal.
 * Policy rule: NEVER attempt to bypass or rephrase on safety refusals — surface clearly to user.
 */
export function isGoogleSafetyOrPolicyError(err: any): boolean {
  const msg = String(err?.message || err || "").toLowerCase();
  const code = String(err?.code || err?.status || "").toLowerCase();
  return (
    code.includes("safety") ||
    msg.includes("safety") ||
    msg.includes("prohibited_content") ||
    msg.includes("prohibited content") ||
    msg.includes("blocked by") ||
    msg.includes("policy violation") ||
    msg.includes("harm_category") ||
    msg.includes("recitation") ||
    msg.includes("child safety") ||
    msg.includes("not allowed") ||
    msg.includes("rejected by google")
  );
}
