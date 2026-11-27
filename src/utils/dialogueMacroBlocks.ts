import { SUB_BLOCK_MAX_SEC, SUB_BLOCK_MAX_TURNS } from './dubbingLimits';

export interface MacroBlockTurnLike {
  id?: string;
  speakerId?: string;
  speakerName?: string;
  text?: string;
  cleanSpeechText?: string;
  style?: string;
  intonationRu?: string;
  sceneTitle?: string;
  chapter?: string;
  startSec?: number;
  endSec?: number;
  gapAfterSec?: number;
  timecode?: string;
}

export interface MacroBlockSplitOptions {
  maxSize?: number;
  targetSize?: number;
  minSize?: number;
  minPauseSec?: number;
  maxInputTokens?: number;
}

export interface MacroBlockBoundaryInfo {
  endOfBlockSec: number;
  startOfNextSec: number;
  endOfBlockTimecode: string;
  startOfNextTimecode: string;
  gapSec: number;
  isSceneBoundary: boolean;
  isMidConversation: boolean;
  reason: 'scene_boundary' | 'long_pause_in_scene' | 'tight_pause_forced';
}

export interface PlannedMacroBlock<T extends MacroBlockTurnLike = MacroBlockTurnLike> {
  blockIndex: number;
  turns: T[];
  startTurnIndex: number;
  endTurnIndex: number;
  startSec: number;
  endSec: number;
  startTimecode: string;
  endTimecode: string;
  sceneTitles: string[];
  boundaryAfter: MacroBlockBoundaryInfo | null;
}

function formatSecMmSs(sec: number): string {
  const safe = Math.max(0, Number.isFinite(sec) ? sec : 0);
  const whole = Math.floor(safe + 1e-6);
  const hrs = Math.floor(whole / 3600);
  const mins = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  const pad2 = (n: number) => String(n).padStart(2, '0');
  return hrs > 0
    ? `${pad2(hrs)}:${pad2(mins)}:${pad2(secs)}`
    : `${pad2(mins)}:${pad2(secs)}`;
}

function getSceneKey(turn: MacroBlockTurnLike | undefined): string {
  return String(turn?.sceneTitle || turn?.chapter || '').trim();
}

export function getPauseBetweenTurns(
  prevTurn: MacroBlockTurnLike | undefined,
  nextTurn: MacroBlockTurnLike | undefined
): number {
  if (!prevTurn) return 0;
  if (
    typeof prevTurn.endSec === 'number' &&
    Number.isFinite(prevTurn.endSec) &&
    typeof nextTurn?.startSec === 'number' &&
    Number.isFinite(nextTurn.startSec)
  ) {
    return Math.max(0, Math.round((nextTurn.startSec - prevTurn.endSec) * 1000) / 1000);
  }
  if (typeof prevTurn.gapAfterSec === 'number' && Number.isFinite(prevTurn.gapAfterSec) && prevTurn.gapAfterSec >= 0) {
    return Math.round(prevTurn.gapAfterSec * 1000) / 1000;
  }
  return 0;
}

function estimateTurnTokens(t: MacroBlockTurnLike): number {
  const chars = (t.cleanSpeechText || t.text || '').length + (t.style || t.intonationRu || '').length + 45;
  return Math.ceil(chars / 3.0);
}

function sumTokens(turns: MacroBlockTurnLike[]): number {
  let total = 0;
  for (const t of turns) total += estimateTurnTokens(t);
  return total;
}

/**
 * Splits a single contiguous slice (either an oversized scene > maxSize, or a script without scene headers)
 * into blocks of at most maxSize turns and maxInputTokens tokens, cutting on the longest pause.
 * NEVER cuts between turns with pause < minPauseSec (default 0.5s) if ANY valid alternative cut exists.
 */
function splitSliceByLongestPause<T extends MacroBlockTurnLike>(
  slice: T[],
  opts: Required<MacroBlockSplitOptions>
): T[][] {
  if (slice.length === 0) return [];
  const { maxSize, targetSize, minSize, minPauseSec, maxInputTokens } = opts;

  const blocks: T[][] = [];
  let cursor = 0;

  while (cursor < slice.length) {
    const remaining = slice.length - cursor;

    // Find maximum end index allowed by maxSize and maxInputTokens
    let maxEnd = cursor;
    let tokSum = 0;
    while (maxEnd < slice.length && maxEnd - cursor < maxSize) {
      const tTok = estimateTurnTokens(slice[maxEnd]);
      if (maxEnd > cursor && tokSum + tTok > maxInputTokens) break;
      tokSum += tTok;
      maxEnd++;
    }
    if (maxEnd <= cursor) {
      maxEnd = Math.min(slice.length, cursor + 1);
    }

    // If all remaining turns fit into this block, take them all
    if (maxEnd >= slice.length) {
      blocks.push(slice.slice(cursor, slice.length));
      break;
    }

    // Determine minimal cut index that avoids creating an unnecessary extra block when remaining <= 2 * maxSize
    const canFitInTwo = remaining <= maxSize * 2;
    const minBalancedForTwo = canFitInTwo
      ? Math.max(cursor + 1, slice.length - maxSize)
      : cursor + 1;

    const adaptiveMin = Math.min(minSize, Math.max(1, Math.floor(remaining * 0.4)));
    const preferredMin = Math.min(maxEnd, Math.max(minBalancedForTwo, cursor + adaptiveMin));

    const idealCut = canFitInTwo
      ? Math.min(maxEnd, Math.max(minBalancedForTwo, cursor + Math.round(remaining / 2)))
      : Math.min(maxEnd, cursor + targetSize);

    interface CutCandidate {
      idx: number;
      gap: number;
    }

    const allCandidates: CutCandidate[] = [];
    for (let idx = cursor + 1; idx <= maxEnd; idx++) {
      allCandidates.push({
        idx,
        gap: getPauseBetweenTurns(slice[idx - 1], slice[idx]),
      });
    }

    // Tiered selection:
    // 1. Preferred window with gap >= minPauseSec
    // 2. Balanced two-block window with gap >= minPauseSec
    // 3. ANY cut in [cursor+1 .. maxEnd] with gap >= minPauseSec (strictly avoid < 0.5s if any alternative exists!)
    // 4. Fallback only when EVERY possible cut in [cursor+1 .. maxEnd] has gap < minPauseSec
    const tier1 = allCandidates.filter((c) => c.idx >= preferredMin && c.gap >= minPauseSec);
    const tier2 = allCandidates.filter((c) => c.idx >= minBalancedForTwo && c.gap >= minPauseSec);
    const tier3 = allCandidates.filter((c) => c.gap >= minPauseSec);

    let chosenPool: CutCandidate[];
    if (tier1.length > 0) {
      chosenPool = tier1;
    } else if (tier2.length > 0) {
      chosenPool = tier2;
    } else if (tier3.length > 0) {
      chosenPool = tier3;
    } else {
      // Every cut has gap < minPauseSec: prefer largest gap overall if strictly better than preferred window
      const prefPool = allCandidates.filter((c) => c.idx >= preferredMin);
      const maxPrefGap = prefPool.reduce((m, c) => Math.max(m, c.gap), -1);
      const maxAllGap = allCandidates.reduce((m, c) => Math.max(m, c.gap), -1);
      chosenPool = maxAllGap > maxPrefGap + 0.05 ? allCandidates : prefPool.length > 0 ? prefPool : allCandidates;
    }

    let bestCut = chosenPool[0].idx;
    let bestScore = -Infinity;
    for (const c of chosenPool) {
      const dist = Math.abs(c.idx - idealCut);
      const score = c.gap * 10 - dist * 0.05;
      if (score > bestScore) {
        bestScore = score;
        bestCut = c.idx;
      }
    }

    blocks.push(slice.slice(cursor, bestCut));
    cursor = bestCut;
  }

  return blocks;
}

/**
 * Shared macro-block planner used by BOTH DialogueStudio (client preview & batch dispatch)
 * and batchDialogueEngine (server TTS macro-block execution).
 *
 * Rules:
 * 1. Groups consecutive scenes (from `sceneTitle`) into blocks of at most `maxSize` (default 25) turns.
 * 2. If a single scene has > `maxSize` turns (or > `maxInputTokens`), splits inside that scene on the longest pause.
 * 3. Never cuts between turns with pause < `minPauseSec` (default 0.5s) if any valid alternative exists.
 * 4. Produces full block metadata (time range, turn count, boundary pause & mid-conversation flags) for UI preview.
 */
export function planDialogueMacroBlocks<T extends MacroBlockTurnLike>(
  turns: T[],
  options: MacroBlockSplitOptions = {}
): PlannedMacroBlock<T>[] {
  if (!Array.isArray(turns) || turns.length === 0) return [];

  const opts: Required<MacroBlockSplitOptions> = {
    maxSize: options.maxSize ?? 25,
    targetSize: options.targetSize ?? 22,
    minSize: options.minSize ?? 12,
    minPauseSec: options.minPauseSec ?? 0.5,
    maxInputTokens: options.maxInputTokens ?? 5800,
  };

  const hasAnySceneTitle = turns.some((t) => getSceneKey(t).length > 0);

  let rawBlocks: T[][] = [];

  if (!hasAnySceneTitle) {
    rawBlocks = splitSliceByLongestPause(turns, opts);
  } else {
    // Partition into contiguous scene segments
    interface SceneSegment {
      sceneTitle: string;
      turns: T[];
      tokens: number;
    }
    const sceneSegments: SceneSegment[] = [];
    for (const turn of turns) {
      const key = getSceneKey(turn);
      const lastSeg = sceneSegments[sceneSegments.length - 1];
      if (lastSeg && lastSeg.sceneTitle === key) {
        lastSeg.turns.push(turn);
        lastSeg.tokens += estimateTurnTokens(turn);
      } else {
        sceneSegments.push({
          sceneTitle: key,
          turns: [turn],
          tokens: estimateTurnTokens(turn),
        });
      }
    }

    let accSegments: SceneSegment[] = [];
    let accCount = 0;
    let accTokens = 0;

    const flushAcc = () => {
      if (accSegments.length === 0) return;
      rawBlocks.push(accSegments.flatMap((s) => s.turns));
      accSegments = [];
      accCount = 0;
      accTokens = 0;
    };

    for (const seg of sceneSegments) {
      const segExceedsLimit = seg.turns.length > opts.maxSize || seg.tokens > opts.maxInputTokens;

      if (segExceedsLimit) {
        // Large single scene: close previous accumulated scenes cleanly on scene boundary
        flushAcc();
        const subChunks = splitSliceByLongestPause(seg.turns, opts);
        for (let c = 0; c < subChunks.length - 1; c++) {
          rawBlocks.push(subChunks[c]);
        }
        const lastChunk = subChunks[subChunks.length - 1];
        if (lastChunk && lastChunk.length > 0) {
          accSegments = [{ sceneTitle: seg.sceneTitle, turns: lastChunk, tokens: sumTokens(lastChunk) }];
          accCount = lastChunk.length;
          accTokens = accSegments[0].tokens;
        }
        continue;
      }

      if (accSegments.length === 0) {
        accSegments = [seg];
        accCount = seg.turns.length;
        accTokens = seg.tokens;
        continue;
      }

      if (accCount + seg.turns.length <= opts.maxSize && accTokens + seg.tokens <= opts.maxInputTokens) {
        accSegments.push(seg);
        accCount += seg.turns.length;
        accTokens += seg.tokens;
        continue;
      }

      // Adding `seg` exceeds block limit -> check if boundary pause is < minPauseSec and an earlier scene boundary in accSegments has >= minPauseSec
      const lastAccSeg = accSegments[accSegments.length - 1];
      const proposedGap = getPauseBetweenTurns(
        lastAccSeg.turns[lastAccSeg.turns.length - 1],
        seg.turns[0]
      );

      if (proposedGap < opts.minPauseSec && accSegments.length >= 2) {
        let bestSplitSegIdx = -1;
        let bestSplitGap = -1;
        for (let k = accSegments.length - 1; k >= 1; k--) {
          const tailSegs = [...accSegments.slice(k), seg];
          const tailCount = tailSegs.reduce((s, x) => s + x.turns.length, 0);
          const tailTokens = tailSegs.reduce((s, x) => s + x.tokens, 0);
          if (tailCount > opts.maxSize || tailTokens > opts.maxInputTokens) break;

          const prevEndTurn = accSegments[k - 1].turns[accSegments[k - 1].turns.length - 1];
          const nextStartTurn = accSegments[k].turns[0];
          const gapAtK = getPauseBetweenTurns(prevEndTurn, nextStartTurn);
          if (gapAtK >= opts.minPauseSec && gapAtK > bestSplitGap) {
            bestSplitGap = gapAtK;
            bestSplitSegIdx = k;
          }
        }

        if (bestSplitSegIdx >= 1) {
          const headSegs = accSegments.slice(0, bestSplitSegIdx);
          const tailSegs = [...accSegments.slice(bestSplitSegIdx), seg];
          rawBlocks.push(headSegs.flatMap((s) => s.turns));
          accSegments = tailSegs;
          accCount = tailSegs.reduce((s, x) => s + x.turns.length, 0);
          accTokens = tailSegs.reduce((s, x) => s + x.tokens, 0);
          continue;
        }
      }

      flushAcc();
      accSegments = [seg];
      accCount = seg.turns.length;
      accTokens = seg.tokens;
    }

    flushAcc();
  }

  // Build PlannedMacroBlock metadata
  const planned: PlannedMacroBlock<T>[] = [];
  let runningTurnIdx = 0;

  for (let b = 0; b < rawBlocks.length; b++) {
    const blockTurns = rawBlocks[b];
    const startTurnIndex = runningTurnIdx;
    const endTurnIndex = runningTurnIdx + blockTurns.length - 1;
    runningTurnIdx += blockTurns.length;

    const firstTurn = blockTurns[0];
    const lastTurn = blockTurns[blockTurns.length - 1];

    const startSec = typeof firstTurn?.startSec === 'number' ? firstTurn.startSec : 0;
    const endSec = typeof lastTurn?.endSec === 'number' ? lastTurn.endSec : startSec;

    const sceneTitles: string[] = [];
    for (const t of blockTurns) {
      const st = getSceneKey(t);
      if (st && !sceneTitles.includes(st)) {
        sceneTitles.push(st);
      }
    }

    let boundaryAfter: MacroBlockBoundaryInfo | null = null;
    if (b + 1 < rawBlocks.length) {
      const nextFirstTurn = rawBlocks[b + 1][0];
      const endOfBlockSec = endSec;
      const startOfNextSec =
        typeof nextFirstTurn?.startSec === 'number' ? nextFirstTurn.startSec : endOfBlockSec;
      const gapSec = getPauseBetweenTurns(lastTurn, nextFirstTurn);

      const prevScene = getSceneKey(lastTurn);
      const nextScene = getSceneKey(nextFirstTurn);
      const isSceneBoundary = Boolean(prevScene && nextScene && prevScene !== nextScene);

      let reason: MacroBlockBoundaryInfo['reason'];
      let isMidConversation: boolean;

      if (gapSec < opts.minPauseSec) {
        reason = 'tight_pause_forced';
        isMidConversation = true;
      } else if (hasAnySceneTitle && !isSceneBoundary) {
        reason = 'long_pause_in_scene';
        isMidConversation = true;
      } else {
        reason = 'scene_boundary';
        isMidConversation = false;
      }

      boundaryAfter = {
        endOfBlockSec,
        startOfNextSec,
        endOfBlockTimecode: formatSecMmSs(endOfBlockSec),
        startOfNextTimecode: formatSecMmSs(startOfNextSec),
        gapSec,
        isSceneBoundary,
        isMidConversation,
        reason,
      };
    }

    planned.push({
      blockIndex: b,
      turns: blockTurns,
      startTurnIndex,
      endTurnIndex,
      startSec,
      endSec,
      startTimecode: formatSecMmSs(startSec),
      endTimecode: formatSecMmSs(endSec),
      sceneTitles,
      boundaryAfter,
    });
  }

  return planned;
}

/**
 * Convenience wrapper returning T[][] directly (drop-in replacement for batchDialogueEngine.splitTurnsIntoMacroBlocks).
 */
export function splitTurnsIntoMacroBlocks<T extends MacroBlockTurnLike>(
  turns: T[],
  options: MacroBlockSplitOptions = {}
): T[][] {
  return planDialogueMacroBlocks(turns, options).map((b) => b.turns);
}

// =========================================================================
// STAGE 1: SUB-BLOCK PLANNER (defaults from src/utils/dubbingLimits.ts)
// =========================================================================

export interface SubBlockSplitOptions {
  maxTurns?: number; // default SUB_BLOCK_MAX_TURNS (20)
  maxWindowSec?: number; // default SUB_BLOCK_MAX_SEC (110)
  macroBlockOptions?: MacroBlockSplitOptions;
}

export interface PlannedSubBlock<T extends MacroBlockTurnLike = MacroBlockTurnLike> {
  subBlockIndex: number;
  macroBlockIndex: number;
  turns: T[];
  startTurnIndex: number;
  endTurnIndex: number;
  startSec: number;
  endSec: number;
  windowSumSec: number;
  startTimecode: string;
  endTimecode: string;
  sceneTitles: string[];
}

function getTurnWindowSec(t: MacroBlockTurnLike): number {
  if (
    typeof t.startSec === 'number' &&
    Number.isFinite(t.startSec) &&
    typeof t.endSec === 'number' &&
    Number.isFinite(t.endSec) &&
    t.endSec > t.startSec
  ) {
    return Math.max(0.5, Math.round((t.endSec - t.startSec) * 100) / 100);
  }
  const clean = String(t.cleanSpeechText || t.text || '')
    .replace(/<[^>]+>/g, ' ')
    .trim();
  // Approximate speech window from character length (~14 chars/sec) if no timecodes
  return Math.max(1.0, Math.round((clean.length / 14) * 10) / 10);
}

function getTurnWordCount(t: MacroBlockTurnLike): number {
  const clean = String(t.cleanSpeechText || t.text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[«»"“”„()[\]{}.,!?;:—–-]+/g, ' ')
    .trim();
  if (!clean) return 0;
  return clean.split(/\s+/).filter(Boolean).length;
}

function isQuestionTurn(t: MacroBlockTurnLike): boolean {
  const raw = String(t.text || t.cleanSpeechText || '').trim();
  return /\?[\s"'»”’)]*$/.test(raw);
}

function getTurnSpeakerKey(t: MacroBlockTurnLike): string {
  return String(t.speakerId || t.speakerName || '').trim().toLowerCase();
}

/**
 * Splits a single macro-block slice into the minimum number of sub-blocks such that EVERY sub-block has:
 * - turns.length <= maxTurns (default 8)
 * - sum(turnWindowSec) <= maxWindowSec (default 40s), unless a single turn itself > maxWindowSec
 *
 * Among minimum-count partitions, DP chooses the highest boundary score:
 * - strongly prefers cutting on a speaker change + longest pause (+ scene boundary)
 * - strongly avoids separating a question (?) from its immediate answer
 * - strongly avoids leaving a 1–2 word turn at the start or end edge of a sub-block
 */
function splitMacroSliceIntoSubBlocksDp<T extends MacroBlockTurnLike>(
  slice: T[],
  maxTurns: number,
  maxWindowSec: number
): T[][] {
  const n = slice.length;
  if (n === 0) return [];

  const windows = slice.map(getTurnWindowSec);
  const wordCounts = slice.map(getTurnWordCount);
  const questions = slice.map(isQuestionTurn);
  const speakers = slice.map(getTurnSpeakerKey);
  const scenes = slice.map((t) => getSceneKey(t));

  // Prefix sums of window durations for O(1) range sum
  const prefixWin = new Array<number>(n + 1).fill(0);
  for (let i = 0; i < n; i++) {
    prefixWin[i + 1] = prefixWin[i] + windows[i];
  }

  // Score for placing a cut between turn (cutIdx - 1) and turn (cutIdx)
  // Positive bonuses sum to at most +120 (< SUB_BLOCK_COST = 200), so extra sub-blocks are
  // NEVER created just to chase pauses — ONLY to prevent Q->A splits (-350) or 1-2 word edges (-260).
  const cutBoundaryScore = (cutIdx: number): number => {
    const prevIdx = cutIdx - 1;
    const nextIdx = cutIdx;
    let score = 0;

    // Scene transition is an ideal natural cut
    if (scenes[prevIdx] && scenes[nextIdx] && scenes[prevIdx] !== scenes[nextIdx]) {
      score += 35;
    }

    // Speaker change preference
    if (speakers[prevIdx] && speakers[nextIdx] && speakers[prevIdx] !== speakers[nextIdx]) {
      score += 25;
    } else {
      score -= 12;
    }

    // Longest pause preference (capped so it never creates unnecessary sub-blocks)
    const gap = getPauseBetweenTurns(slice[prevIdx], slice[nextIdx]);
    score += Math.min(10, gap) * 6;
    if (gap < 0.5 && speakers[prevIdx] === speakers[nextIdx]) {
      score -= 18;
    }

    // Do NOT separate an answer from a question (strictly outweighs adding +1 sub-block)
    if (questions[prevIdx]) {
      score -= 350;
    }

    // Do NOT leave a 1–2 word turn on either edge of a sub-block
    if (wordCounts[prevIdx] > 0 && wordCounts[prevIdx] <= 2) {
      score -= 260;
    }
    if (wordCounts[nextIdx] > 0 && wordCounts[nextIdx] <= 2) {
      score -= 260;
    }

    return score;
  };

  const SUB_BLOCK_COST = 200;
  const dpScore = new Array<number>(n + 1).fill(-Infinity);
  const parent = new Array<number>(n + 1).fill(-1);

  dpScore[0] = 0;

  for (let j = 1; j <= n; j++) {
    const minI = Math.max(0, j - maxTurns);
    for (let i = minI; i < j; i++) {
      if (!Number.isFinite(dpScore[i])) continue;
      const chunkCount = j - i;
      const chunkWin = prefixWin[j] - prefixWin[i];

      // Hard constraints: <= maxTurns AND <= maxWindowSec (allow 1-turn sub-block if single turn > maxWindowSec)
      if (chunkCount > maxTurns) continue;
      if (chunkCount > 1 && chunkWin > maxWindowSec + 1e-6) continue;

      let candScore = dpScore[i] - SUB_BLOCK_COST;
      if (i > 0) {
        candScore += cutBoundaryScore(i);
      }

      // Slight penalty against 1-turn chunks when avoidable
      if (chunkCount === 1 && n > 1) {
        candScore -= 30;
      }
      // Slight balance bonus favoring fuller sub-blocks (~4–7 turns)
      candScore += Math.min(chunkCount, 6) * 2.0;

      if (candScore > dpScore[j]) {
        dpScore[j] = candScore;
        parent[j] = i;
      }
    }
  }

  // Reconstruct optimal partition
  const subBlocks: T[][] = [];
  let cur = n;
  while (cur > 0) {
    const prev = parent[cur];
    if (prev < 0) {
      subBlocks.push(slice.slice(0, cur));
      break;
    }
    subBlocks.push(slice.slice(prev, cur));
    cur = prev;
  }
  subBlocks.reverse();
  return subBlocks;
}

/**
 * Stage 1 shared sub-block planner used by BOTH server (`batchDialogueEngine.ts`)
 * and UI (`DialogueStudio.tsx` quota forecast & sub-block regenerate).
 *
 * Groups turns into macro-blocks first (respecting scene boundaries), then splits each
 * macro-block into optimal sub-blocks of <= 8 turns AND <= 40s cumulative turn window duration.
 */
export function planDialogueSubBlocks<T extends MacroBlockTurnLike>(
  turns: T[],
  options: SubBlockSplitOptions = {}
): PlannedSubBlock<T>[] {
  if (!Array.isArray(turns) || turns.length === 0) return [];

  const maxTurns = Math.max(1, options.maxTurns ?? SUB_BLOCK_MAX_TURNS);
  const maxWindowSec = Math.max(5, options.maxWindowSec ?? SUB_BLOCK_MAX_SEC);

  const macroBlocks = planDialogueMacroBlocks(turns, options.macroBlockOptions);
  const result: PlannedSubBlock<T>[] = [];
  let runningSubIdx = 0;

  for (const mb of macroBlocks) {
    const subSlices = splitMacroSliceIntoSubBlocksDp(mb.turns, maxTurns, maxWindowSec);
    let localTurnOffset = mb.startTurnIndex;

    for (const subTurns of subSlices) {
      const first = subTurns[0];
      const last = subTurns[subTurns.length - 1];
      const startSec = typeof first?.startSec === 'number' ? first.startSec : 0;
      const endSec = typeof last?.endSec === 'number' ? last.endSec : startSec;
      const windowSumSec =
        Math.round(subTurns.reduce((acc, t) => acc + getTurnWindowSec(t), 0) * 100) / 100;

      const sceneTitles: string[] = [];
      for (const t of subTurns) {
        const st = getSceneKey(t);
        if (st && !sceneTitles.includes(st)) sceneTitles.push(st);
      }

      result.push({
        subBlockIndex: runningSubIdx,
        macroBlockIndex: mb.blockIndex,
        turns: subTurns,
        startTurnIndex: localTurnOffset,
        endTurnIndex: localTurnOffset + subTurns.length - 1,
        startSec,
        endSec,
        windowSumSec,
        startTimecode: formatSecMmSs(startSec),
        endTimecode: formatSecMmSs(endSec),
        sceneTitles,
      });

      localTurnOffset += subTurns.length;
      runningSubIdx += 1;
    }
  }

  return result;
}

export function splitTurnsIntoSubBlocks<T extends MacroBlockTurnLike>(
  turns: T[],
  options: SubBlockSplitOptions = {}
): T[][] {
  return planDialogueSubBlocks(turns, options).map((sb) => sb.turns);
}

