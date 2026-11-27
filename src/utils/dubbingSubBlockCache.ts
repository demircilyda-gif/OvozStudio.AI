import {
  planDialogueSubBlocks,
  type MacroBlockTurnLike,
  type PlannedSubBlock,
} from './dialogueMacroBlocks';
import { SUB_BLOCK_MAX_SEC, SUB_BLOCK_MAX_TURNS } from './dubbingLimits';

export const DUBBING_CACHE_VERSION = 'v3' as const;
export const DEFAULT_DUBBING_TTS_MODEL = 'gemini-3.8-flash-tts';

export interface CachedSubBlockTurnRecord {
  turnId: string;
  audioBase64: string;
  durationSeconds?: number;
  originalDurationSec?: number;
  dubbedDurationSec?: number;
  atempoApplied?: number;
  rephraseAttempts?: number;
  fitStepApplied?: string;
  syncStatus?: 'ok' | 'adjusted' | 'overflow';
  qa?: 'ok' | 'retried' | 'failed';
  qaReason?: string;
  slicingMethod?: string;
  generationMode?: 'mode_a' | 'mode_b';
  lufsBefore?: number | null;
  lufsAfter?: number | null;
  shiftedStartBySec?: number;
  needsShorten?: boolean;
  subBlockIndex?: number;
  startTime?: number;
  endTime?: number;
}

export interface CachedDialogueSubBlock {
  cacheKey: string;
  cacheVersion: string;
  projectKey: string;
  subBlockIndex: number;
  subBlockHash: string;
  qa: 'ok' | 'retried';
  turnIds: string[];
  turns: CachedSubBlockTurnRecord[];
  savedAt: number;
}

export interface SubBlockCacheKeyTurnLike extends MacroBlockTurnLike {
  id: string;
  speakerId: string;
  text: string;
}

function dualFnv1a64Hex(payload: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < payload.length; i++) {
    const ch = payload.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch + (i & 0xff);
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `${part1}${part2}`;
}

/**
 * Computes a deterministic v3 sub-block hash from what ACTUALLY goes to TTS:
 * - DUBBING_CACHE_VERSION ('v3')
 * - ttsModel (e.g. 'gemini-3.8-flash-tts')
 * - voices of ALL speakers participating in the sub-block
 * - post-dictionary TTS text (with <laugh> if any), final resolved style, speakerId, and turnId of every turn
 */
export function computeSubBlockClientHash<T extends SubBlockCacheKeyTurnLike>(params: {
  subBlockTurns: T[];
  getSpeakerVoiceKey: (turn: T) => string;
  getTurnStyleKey: (turn: T) => string;
  getTurnTtsText?: (turn: T) => string;
  ttsModel?: string;
}): string {
  const {
    subBlockTurns,
    getSpeakerVoiceKey,
    getTurnStyleKey,
    getTurnTtsText,
    ttsModel = DEFAULT_DUBBING_TTS_MODEL,
  } = params;

  const speakerVoiceMap = new Map<string, string>();
  for (const t of subBlockTurns) {
    const spId = String(t.speakerId || 'HOST_1').trim();
    if (!speakerVoiceMap.has(spId)) {
      speakerVoiceMap.set(spId, String(getSpeakerVoiceKey(t) || '').trim());
    }
  }
  const sortedSpeakers = Array.from(speakerVoiceMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([speakerId, voiceKey]) => ({ speakerId, voiceKey }));

  const payload = JSON.stringify({
    v: DUBBING_CACHE_VERSION,
    model: String(ttsModel || DEFAULT_DUBBING_TTS_MODEL).trim(),
    speakers: sortedSpeakers,
    turns: subBlockTurns.map((t) => ({
      id: t.id,
      speakerId: String(t.speakerId || 'HOST_1').trim(),
      text: String(getTurnTtsText ? getTurnTtsText(t) : t.text || '').trim(),
      style: String(getTurnStyleKey(t) || '').trim(),
      voice: String(getSpeakerVoiceKey(t) || '').trim(),
    })),
  });

  return dualFnv1a64Hex(payload);
}

export function buildSubBlockCacheKey(projectKey: string, subBlockHash: string): string {
  return `${projectKey}::${DUBBING_CACHE_VERSION}::sb_${subBlockHash}`;
}

/**
 * Strictly validates that a cached sub-block entry is version v3, complete,
 * matches turnIds in order, and every turn passed QA (ok or retried).
 * Any legacy entry (missing cacheVersion or cacheVersion !== 'v3') is rejected.
 */
export function isValidCachedSubBlockV3<T extends SubBlockCacheKeyTurnLike>(
  entry: Partial<CachedDialogueSubBlock> | null | undefined,
  expectedTurns: T[]
): entry is CachedDialogueSubBlock {
  if (!entry || entry.cacheVersion !== DUBBING_CACHE_VERSION) return false;
  if (entry.qa !== 'ok' && entry.qa !== 'retried') return false;
  if (!Array.isArray(entry.turns) || entry.turns.length !== expectedTurns.length) return false;

  for (let i = 0; i < expectedTurns.length; i++) {
    const cachedTurn = entry.turns[i];
    if (!cachedTurn || cachedTurn.turnId !== expectedTurns[i].id) return false;
    if (typeof cachedTurn.audioBase64 !== 'string' || cachedTurn.audioBase64.length < 16) return false;
    if (cachedTurn.qa !== 'ok' && cachedTurn.qa !== 'retried') return false;
  }
  return true;
}

export interface PlannedSubBlockWithCache<T extends SubBlockCacheKeyTurnLike> {
  subBlock: PlannedSubBlock<T>;
  subBlockHash: string;
  cacheKey: string;
  cachedEntry: CachedDialogueSubBlock | null;
  isCached: boolean;
}

export interface SubBlockExecutionBatch<T extends SubBlockCacheKeyTurnLike> {
  batchIndex: number;
  macroBlockIndex: number;
  subBlocks: PlannedSubBlockWithCache<T>[];
  turns: T[];
  startTimecode: string;
  endTimecode: string;
}

export interface SubBlockCacheExecutionPlan<T extends SubBlockCacheKeyTurnLike> {
  allSubBlocks: PlannedSubBlockWithCache<T>[];
  cachedSubBlocks: PlannedSubBlockWithCache<T>[];
  uncachedSubBlocks: PlannedSubBlockWithCache<T>[];
  requestBatches: SubBlockExecutionBatch<T>[];
  cachedTurnCount: number;
  totalTurnCount: number;
}

/**
 * Plans sub-blocks ALWAYS over the FULL script (`planDialogueSubBlocks` with shared limits),
 * resolves whole-sub-block v3 cache hits, and emits STRICTLY 1 HTTP request batch per uncached sub-block.
 *
 * Guarantees:
 * - 1 sub-block = 1 HTTP request (no merging adjacent sub-blocks into a larger request).
 * - A sub-block is either taken 100% from v3 cache (all turns ok/retried) or sent 100% whole
 *   with all turns of BOTH speakers to the server.
 * - Never sends a cherry-picked subset of turns from inside a sub-block.
 */
export function planSubBlockCacheExecution<T extends SubBlockCacheKeyTurnLike>(params: {
  fullTurns: T[];
  projectKey: string;
  getSpeakerVoiceKey: (turn: T) => string;
  getTurnStyleKey: (turn: T) => string;
  getTurnTtsText?: (turn: T) => string;
  ttsModel?: string;
  cachedSubBlocksByKey: Map<string, Partial<CachedDialogueSubBlock>>;
  ignoreCache?: boolean;
}): SubBlockCacheExecutionPlan<T> {
  const {
    fullTurns,
    projectKey,
    getSpeakerVoiceKey,
    getTurnStyleKey,
    getTurnTtsText,
    ttsModel = DEFAULT_DUBBING_TTS_MODEL,
    cachedSubBlocksByKey,
    ignoreCache = false,
  } = params;

  const plannedSubBlocks = planDialogueSubBlocks(fullTurns, {
    maxTurns: SUB_BLOCK_MAX_TURNS,
    maxWindowSec: SUB_BLOCK_MAX_SEC,
    macroBlockOptions: { maxSize: 25, minPauseSec: 0.5 },
  });

  const allSubBlocks: PlannedSubBlockWithCache<T>[] = plannedSubBlocks.map((subBlock) => {
    const subBlockHash = computeSubBlockClientHash({
      subBlockTurns: subBlock.turns,
      getSpeakerVoiceKey,
      getTurnStyleKey,
      getTurnTtsText,
      ttsModel,
    });
    const cacheKey = buildSubBlockCacheKey(projectKey, subBlockHash);
    const rawEntry = ignoreCache ? undefined : cachedSubBlocksByKey.get(cacheKey);
    const validEntry = isValidCachedSubBlockV3(rawEntry, subBlock.turns) ? rawEntry : null;

    return {
      subBlock,
      subBlockHash,
      cacheKey,
      cachedEntry: validEntry,
      isCached: Boolean(validEntry),
    };
  });

  const cachedSubBlocks = allSubBlocks.filter((item) => item.isCached);
  const uncachedSubBlocks = allSubBlocks.filter((item) => !item.isCached);

  // 1 sub-block = 1 HTTP request (never merge adjacent uncached sub-blocks)
  const requestBatches: SubBlockExecutionBatch<T>[] = uncachedSubBlocks.map((item, idx) => ({
    batchIndex: idx,
    macroBlockIndex: item.subBlock.macroBlockIndex,
    subBlocks: [item],
    turns: item.subBlock.turns,
    startTimecode: item.subBlock.startTimecode,
    endTimecode: item.subBlock.endTimecode,
  }));

  const cachedTurnCount = cachedSubBlocks.reduce((acc, item) => acc + item.subBlock.turns.length, 0);

  return {
    allSubBlocks,
    cachedSubBlocks,
    uncachedSubBlocks,
    requestBatches,
    cachedTurnCount,
    totalTurnCount: fullTurns.length,
  };
}
