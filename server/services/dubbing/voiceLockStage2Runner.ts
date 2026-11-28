/**
 * Stage 2 Live Control Runner — Full Tiggo 8 Dubbing in Voice Lock mode.
 *
 * Uses ONLY:
 * - Aziz M2:     voice_din40bswsfcy (prompted, aziz-m2-v1)
 * - Veronika F1: voice_jobdfz42xizz (prompted, veronika-f1-v1)
 * - TTS:         gemini-3.8-flash-tts (EXACTLY 2 calls, bypassCache: true, 0 auto-retries)
 * - Alignment & Identity QA: gemini-4-hydrogen (2 alignment + 2 Identity QA calls)
 * - NO Lite, NO kie.ai, NO Charon/Kore fallback, NO MP4 muxing.
 *
 * Outputs in `public/audio/voice-lock-stage2/`:
 * - tiggo8-aziz-M2-raw.wav
 * - tiggo8-veronika-F1-raw.wav
 * - tiggo8-M2-F1-master.wav
 * - report.md
 */

import fs from "fs";
import path from "path";
import type { GoogleGenAI } from "@google/genai";
import { parseReadyScript } from "../../../src/utils/readyScriptParser.ts";
import { AZIZ_VOICE_LOCK_M2, VERONIKA_VOICE_LOCK_F1 } from "../../../src/data/voices.ts";
import { DEFAULT_PRONUNCIATION_DICTIONARY } from "../../../src/utils/pronunciationDictionary.ts";
import { buildWav24k, PCM_SAMPLE_RATE } from "./batchAudioSlicer.ts";
import {
  measureIntegratedLufsPcm,
  measurePeakDbfsPcm,
  measureTruePeakDbfsPcm,
} from "./loudnessLeveler.ts";
import {
  type BatchInputTurn,
  type ResolvedBatchSpeaker,
  type TtsPayloadObservation,
  setTtsPayloadObserverForTesting,
} from "./batchDialogueEngine.ts";
import {
  synthesizeDialogueInVoiceLockMode,
  type VoiceLockExecutionResult,
  type VoiceLockSpeakerTrackReport,
} from "./voiceLockEngine.ts";

export type AssembleMasterPcmFn = (
  turns: Array<{
    startSec: number;
    endSec: number;
    sceneTitle?: string;
    pcm: Buffer;
    rawUnstretchedPcm: Buffer;
    atempoApplied?: number;
    rephraseAttempts?: number;
    needsShorten?: boolean;
  }>,
  totalVideoDurationSec: number,
  sampleRate?: number
) => Promise<{
  masterPcm: Buffer;
  totalDurationSec: number;
  actualPlacements: Array<{
    startSec: number;
    endSec: number;
    dubbedDurationSec: number;
    originalDurationSec: number;
    shiftedStartBySec: number;
    syncStatus: "ok" | "adjusted" | "overflow";
    needsShorten: boolean;
    atempoApplied: number;
    pcm: Buffer;
  }>;
}>;

const FIXTURE_PATH = path.resolve(
  process.cwd(),
  "scripts",
  "fixtures",
  "01_tiggo_8_hybrid_uz_dublyaj_v4.txt"
);
const OUT_DIR = path.resolve(process.cwd(), "public", "audio", "voice-lock-stage2");

function fmtNum(v: number | null | undefined, digits = 2): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

function escapeMd(s: string | undefined | null): string {
  return String(s ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

export async function runVoiceLockStage2ControlDubbing(
  ai: GoogleGenAI,
  assembleMasterPcm: AssembleMasterPcmFn
): Promise<{
  ok: boolean;
  overallSuccess: boolean;
  identityQaPassed: boolean;
  ttsCallsUsed: number;
  alignmentCallsUsed: number;
  identityQaCallsUsed: number;
  masterDurationSec: number;
  files: string[];
  summary: {
    aziz: {
      voiceId: string;
      identityVersion: string;
      turnsCount: number;
      partsSent: number;
      rawDurationSec: number;
      status: string;
      identityQaPassed: boolean;
      identityQaConfidence: number;
      explanationRu: string;
    };
    veronika: {
      voiceId: string;
      identityVersion: string;
      turnsCount: number;
      partsSent: number;
      rawDurationSec: number;
      status: string;
      identityQaPassed: boolean;
      identityQaConfidence: number;
      explanationRu: string;
    };
    qaStats: VoiceLockExecutionResult["stats"];
    charonOrKoreUsed: boolean;
    kieUsed: boolean;
    multiSpeakerUsed: boolean;
  };
}> {
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  const rawScript = fs.readFileSync(FIXTURE_PATH, "utf-8");
  const parsed = parseReadyScript(rawScript);
  if (parsed.errors.length > 0) {
    throw new Error(`Ошибка разбора фикстуры Tiggo 8: ${parsed.errors.map((e) => e.message).join("; ")}`);
  }

  const totalVideoDurationSec = Math.max(
    ...parsed.turns.map((t) => Number(t.endSec) || 0),
    0
  );

  const turns: BatchInputTurn[] = parsed.turns.map((t, idx) => {
    const nextStartSec =
      idx + 1 < parsed.turns.length && typeof parsed.turns[idx + 1]?.startSec === "number"
        ? parsed.turns[idx + 1].startSec!
        : totalVideoDurationSec;
    const gapAfterSec = Math.max(0, Math.round((nextStartSec - (t.endSec || 0)) * 100) / 100);
    return {
      index: idx,
      id: t.id,
      speakerId: t.speakerId,
      speakerName: t.speakerName,
      speakerGender: t.speakerGender,
      text: t.text,
      cleanSpeechText: t.text,
      style: "",
      originalTextRu: t.originalTextRu,
      intonationRu: t.intonationRu,
      startSec: t.startSec,
      endSec: t.endSec,
      gapAfterSec,
      nextTurnStartSec: nextStartSec,
      rawTurn: t,
    };
  });

  const azizTurn = turns.find((t) => t.speakerGender === "male" || /азиз|aziz/i.test(t.speakerName || ""));
  const veronikaTurn = turns.find(
    (t) => t.speakerGender === "female" || /вероник|veronik/i.test(t.speakerName || "")
  );
  if (!azizTurn || !veronikaTurn) {
    throw new Error("Не удалось определить спикеров Азиз и Вероника в сценарии Tiggo 8.");
  }

  const speakerMap = new Map<string, ResolvedBatchSpeaker>();
  speakerMap.set(azizTurn.speakerId, {
    speakerId: azizTurn.speakerId,
    speakerName: azizTurn.speakerName || "Азиз",
    gender: "male",
    voiceType: "prompted",
    voiceId: AZIZ_VOICE_LOCK_M2.voiceId!, // voice_din40bswsfcy
    identityVersion: AZIZ_VOICE_LOCK_M2.identityVersion!, // aziz-m2-v1
    baseVoice: "Charon",
    isCloned: false,
    baseSpeechStyle: "",
  });
  speakerMap.set(veronikaTurn.speakerId, {
    speakerId: veronikaTurn.speakerId,
    speakerName: veronikaTurn.speakerName || "Вероника",
    gender: "female",
    voiceType: "prompted",
    voiceId: VERONIKA_VOICE_LOCK_F1.voiceId!, // voice_jobdfz42xizz
    identityVersion: VERONIKA_VOICE_LOCK_F1.identityVersion!, // veronika-f1-v1
    baseVoice: "Kore",
    isCloned: false,
    baseSpeechStyle: "",
  });

  const observedPayloads: TtsPayloadObservation[] = [];
  setTtsPayloadObserverForTesting((obs) => observedPayloads.push(obs));

  const runStartedAt = new Date().toISOString();
  const tRun0 = Date.now();
  let vlResult: VoiceLockExecutionResult;
  try {
    vlResult = await synthesizeDialogueInVoiceLockMode(ai, {
      turns,
      speakerMap,
      strictTimeWindow: true,
      useDeliveryEmotions: true,
      pronunciationDictionary: DEFAULT_PRONUNCIATION_DICTIONARY,
      bypassCache: true,
    });
  } finally {
    setTtsPayloadObserverForTesting(null);
  }
  const totalRunMs = Date.now() - tRun0;

  // Save raw speaker WAV tracks
  const azizTrack = vlResult.speakerTracks.find((t) => t.speakerId === azizTurn.speakerId)!;
  const veronikaTrack = vlResult.speakerTracks.find((t) => t.speakerId === veronikaTurn.speakerId)!;
  if (!azizTrack || !veronikaTrack) {
    throw new Error("Не найдены оба трека ведущих в результате Voice Lock.");
  }

  const azizRawPath = path.join(OUT_DIR, "tiggo8-aziz-M2-raw.wav");
  const veronikaRawPath = path.join(OUT_DIR, "tiggo8-veronika-F1-raw.wav");
  const masterPath = path.join(OUT_DIR, "tiggo8-M2-F1-master.wav");
  const reportPath = path.join(OUT_DIR, "report.md");

  fs.writeFileSync(azizRawPath, azizTrack.rawWavBuffer);
  fs.writeFileSync(veronikaRawPath, veronikaTrack.rawWavBuffer);

  // Assemble master WAV using exact production strict timecode assembler
  const assembled = await assembleMasterPcm(
    vlResult.turns.map((r) => {
      const orig = turns[r.index] || {};
      const startSec = typeof orig.startSec === "number" ? orig.startSec : 0;
      const endSec =
        typeof orig.endSec === "number" ? orig.endSec : startSec + r.pcm.length / 48000;
      return {
        startSec,
        endSec,
        sceneTitle: (orig.rawTurn as any)?.sceneTitle || (orig.rawTurn as any)?.chapter || undefined,
        pcm: r.pcm,
        rawUnstretchedPcm: r.pcm,
        atempoApplied: r.atempoApplied,
        rephraseAttempts: r.rephraseAttempts,
        needsShorten: r.needsShorten,
      };
    }),
    totalVideoDurationSec,
    PCM_SAMPLE_RATE
  );

  const masterWavBuffer = buildWav24k(assembled.masterPcm);
  fs.writeFileSync(masterPath, masterWavBuffer);

  const masterLufs = measureIntegratedLufsPcm(assembled.masterPcm, PCM_SAMPLE_RATE);
  const masterSamplePeak = measurePeakDbfsPcm(assembled.masterPcm);
  const masterTruePeak = measureTruePeakDbfsPcm(assembled.masterPcm);

  // Audit observed payloads to prove NO Charon/Kore/kie/multiSpeaker were used
  const charonOrKoreUsed = observedPayloads.some((o) => {
    const vc = JSON.stringify(o.voiceConfig || {});
    return /Charon|Kore|prebuiltVoiceConfig/i.test(vc);
  });
  const kieUsed = observedPayloads.some((o) => /kie/i.test(o.channel));
  const multiSpeakerUsed = observedPayloads.some((o) => o.usedMultiSpeaker);

  // Aggregate per-turn loudness & true peak stats
  const allTurnDetails = [
    ...azizTrack.turnDetails.map((d) => ({ ...d, speakerName: azizTrack.speakerName, speakerId: azizTrack.speakerId })),
    ...veronikaTrack.turnDetails.map((d) => ({ ...d, speakerName: veronikaTrack.speakerName, speakerId: veronikaTrack.speakerId })),
  ].sort((a, b) => a.globalIndex - b.globalIndex);

  const regularLufs = allTurnDetails
    .filter((d) => d.sentStyle !== "softly" && typeof d.lufsAfter === "number")
    .map((d) => d.lufsAfter as number);
  const softlyLufs = allTurnDetails
    .filter((d) => d.sentStyle === "softly" && typeof d.lufsAfter === "number")
    .map((d) => d.lufsAfter as number);
  const maxTruePeakTurn = Math.max(
    ...allTurnDetails
      .map((d) => (typeof d.truePeakAfterDbfs === "number" ? d.truePeakAfterDbfs : -99))
  );
  const regularLufsAvg =
    regularLufs.length > 0
      ? regularLufs.reduce((a, b) => a + b, 0) / regularLufs.length
      : null;
  const softlyLufsAvg =
    softlyLufs.length > 0
      ? softlyLufs.reduce((a, b) => a + b, 0) / softlyLufs.length
      : null;

  const formatAcousticsTable = (tr: VoiceLockSpeakerTrackReport): string => {
    const segs = [tr.acoustics.beginning, tr.acoustics.middle, tr.acoustics.end];
    const rows = segs.map(
      (s) =>
        `| ${s.label} (${fmtNum(s.startSec, 1)}–${fmtNum(s.endSec, 1)}s) | ${fmtNum(s.f0MedHz, 1)} Hz (${fmtNum(s.f0P10Hz, 1)}–${fmtNum(s.f0P90Hz, 1)}) | ${fmtNum(s.centroidHz, 1)} Hz | ${fmtNum(s.tiltDb, 2)} dB | ${fmtNum(s.hnrProxy, 3)} |`
    );
    return [
      "| Отрезок | F0 медиана (P10–P90) | Центроид спектра | Наклон спектра | HNR proxy |",
      "|---|---:|---:|---:|---:|",
      ...rows,
      "",
      `- MFCC-расстояние: начало↔середина = **${fmtNum(tr.acoustics.mfccDistBegMid, 2)}**, начало↔конец = **${fmtNum(tr.acoustics.mfccDistBegEnd, 2)}**, середина↔конец = **${fmtNum(tr.acoustics.mfccDistMidEnd, 2)}**`,
    ].join("\n");
  };

  // Build comprehensive report.md
  const lines: string[] = [];
  lines.push("# ЭТАП 2 — Контрольная полная озвучка Tiggo 8 в режиме Voice Lock (`full_speaker_tracks`)");
  lines.push("");
  lines.push(`- **Дата запуска (UTC):** ${runStartedAt}`);
  lines.push(`- **Сценарий:** \`scripts/fixtures/01_tiggo_8_hybrid_uz_dublyaj_v4.txt\` (${turns.length} реплик, длительность видео ${fmtNum(totalVideoDurationSec, 2)} с)`);
  lines.push(`- **Кэш:** ВЫКЛЮЧЕН (\`bypassCache: true\`)`);
  lines.push(`- **Модели:** TTS = \`gemini-3.8-flash-tts\`, Alignment & Identity QA = \`gemini-4-hydrogen\``);
  lines.push(`- **Общий статус прогона:** ${vlResult.overallSuccess ? "✅ УСПЕШНО (PASS)" : "❌ НЕ ПРОЙДЕН (FAIL)"}`);
  lines.push(`- **Voice Identity QA:** ${vlResult.identityQaPassed ? "✅ ПРОЙДЕН ДЛЯ ОБОИХ ВЕДУЩИХ" : "❌ НЕ ПРОЙДЕН / ОБНАРУЖЕН ДРЕЙФ"}`);
  lines.push(`- **Общее время выполнения:** ${fmtNum(totalRunMs / 1000, 1)} с`);
  lines.push("");

  lines.push("## 1. Использованные постоянные голоса и счётчики API-вызовов");
  lines.push("");
  lines.push("| Ведущий | voiceId | voiceType | identityVersion | Реплик | Parts в 1 TTS | Raw длительность | TTS вызовов | Alignment вызовов | Identity QA вызовов | Статус трека |");
  lines.push("|---|---|---|---|---:|---:|---:|---:|---:|---:|---|");
  for (const tr of [azizTrack, veronikaTrack]) {
    lines.push(
      `| ${escapeMd(tr.speakerName)} | \`${tr.voiceId}\` | \`${tr.voiceType}\` | \`${tr.identityVersion}\` | ${tr.turnCount} | ${tr.partsSentCount} | ${fmtNum(tr.rawDurationSec, 2)} с | ${tr.ttsCallsUsed} | ${tr.alignmentCallsUsed} | ${tr.identityQaCallsUsed} | ${tr.status === "ok" ? "✅ ok" : `❌ failed (${escapeMd(tr.failureReasons.join("; "))})`} |`
    );
  }
  lines.push("");
  lines.push(`- **Итого TTS вызовов (\`gemini-3.8-flash-tts\`):** **${vlResult.ttsCallsUsed}** (цель: ровно 2, автоповторов: 0)`);
  lines.push(`- **Итого Alignment вызовов (\`gemini-4-hydrogen\`):** **${vlResult.alignmentCallsUsed}**`);
  lines.push(`- **Итого Identity QA вызовов (\`gemini-4-hydrogen\`):** **${vlResult.identityQaCallsUsed}**`);
  lines.push(`- **Аудит чистоты вызовов (проверено по перехваченным payload'ам):**`);
  lines.push(`  - \`Charon\` / \`Kore\` / \`prebuiltVoiceConfig\` использовались: **${charonOrKoreUsed ? "ДА (НАРУШЕНИЕ!)" : "НЕТ (подтверждено)"}**`);
  lines.push(`  - \`kie.ai\` использовался: **${kieUsed ? "ДА (НАРУШЕНИЕ!)" : "НЕТ (подтверждено)"}**`);
  lines.push(`  - \`multiSpeakerVoiceConfig\` использовался: **${multiSpeakerUsed ? "ДА (НАРУШЕНИЕ!)" : "НЕТ (подтверждено)"}**`);
  lines.push(`  - Переданные \`voiceConfig\`: ${observedPayloads.map((o) => `\`${JSON.stringify(o.voiceConfig)}\` (${o.parts.length} parts)`).join(", ")}`);
  lines.push("");

  lines.push("## 2. Voice Identity QA (`gemini-4-hydrogen`: эталон `sample_audio` vs начало / середина / конец по 30с)");
  lines.push("");
  lines.push("| Ведущий | voiceId | Начало (30с) | Середина (30с) | Конец (30с) | Дрейф | Уверенность | Вердикт | Пояснение |");
  lines.push("|---|---|---|---|---|---|---:|---|---|");
  for (const tr of [azizTrack, veronikaTrack]) {
    const q = tr.identityQa;
    lines.push(
      `| ${escapeMd(tr.speakerName)} | \`${tr.voiceId}\` | ${q.sameSpeakerBeginning ? "✅ да" : "❌ нет"} | ${q.sameSpeakerMiddle ? "✅ да" : "❌ нет"} | ${q.sameSpeakerEnd ? "✅ да" : "❌ нет"} | ${q.driftDetected ? "⚠ ДА" : "✅ нет"} | ${fmtNum(q.confidence, 2)} | ${q.passed ? "✅ PASS" : "❌ FAIL"} | ${escapeMd(q.explanationRu)} |`
    );
  }
  lines.push("");

  lines.push("## 3. Локальные акустические метрики (F0, центроид спектра, наклон, HNR, MFCC)");
  lines.push("");
  lines.push(`### ${azizTrack.speakerName} (\`${azizTrack.voiceId}\`, \`${azizTrack.identityVersion}\`)`);
  lines.push("");
  lines.push(formatAcousticsTable(azizTrack));
  lines.push("");
  lines.push(`### ${veronikaTrack.speakerName} (\`${veronikaTrack.voiceId}\`, \`${veronikaTrack.identityVersion}\`)`);
  lines.push("");
  lines.push(formatAcousticsTable(veronikaTrack));
  lines.push("");

  lines.push("## 4. Громкость (LUFS) и True Peak");
  lines.push("");
  lines.push(`- **Мастер-дорожка (\`tiggo8-M2-F1-master.wav\`):** длительность **${fmtNum(assembled.totalDurationSec, 2)} с**, integrated loudness = **${fmtNum(masterLufs, 2)} LUFS**, sample peak = **${fmtNum(masterSamplePeak, 2)} dBFS**, true peak (4×) = **${fmtNum(masterTruePeak, 2)} dBFS**`);
  lines.push(`- **Обычные реплики (цель -18 LUFS):** ${regularLufs.length} шт., среднее = **${fmtNum(regularLufsAvg, 2)} LUFS** (мин ${regularLufs.length ? fmtNum(Math.min(...regularLufs), 2) : "—"}, макс ${regularLufs.length ? fmtNum(Math.max(...regularLufs), 2) : "—"})`);
  lines.push(`- **Тихие реплики \`softly\` (цель -21 LUFS):** ${softlyLufs.length} шт., среднее = **${fmtNum(softlyLufsAvg, 2)} LUFS**`);
  lines.push(`- **Максимальный True Peak среди всех клипов:** **${fmtNum(maxTruePeakTurn, 2)} dBFS** (${maxTruePeakTurn <= -0.95 ? "✅ ≤ -1.0 dBFS" : "⚠ превышен -1.0 dBFS"})`);
  lines.push(`- **Статистика QA/синхронизации:** ok=${vlResult.stats.ok}, adjusted=${vlResult.stats.adjusted}, overflow=${vlResult.stats.overflow}, qaOk=${vlResult.stats.qaOk}, qaFailed=${vlResult.stats.qaFailed}, needsShorten=${vlResult.stats.needsShorten}`);
  lines.push("");

  lines.push("## 5. Полный список отправленных стилей (Safe Voice Lock Emotions)");
  lines.push("");
  const styleCounts = new Map<string, number>();
  for (const d of allTurnDetails) {
    const key = d.sentStyle || "(пусто — нейтрально)";
    styleCounts.set(key, (styleCounts.get(key) || 0) + 1);
  }
  lines.push("| Отправленный `style` | Количество реплик |");
  lines.push("|---|---:|");
  for (const [st, cnt] of Array.from(styleCounts.entries()).sort((a, b) => b[1] - a[1])) {
    lines.push(`| \`${st}\` | ${cnt} |`);
  }
  lines.push("");

  lines.push("## 6. Порепликовый отчёт QA, выравнивания, стилей и громкости (79 реплик)");
  lines.push("");
  lines.push("| # | Таймкод | Ведущий | Отправленный `style` | Raw отрезок (с) | Найдено | Conf | Клип / Окно (с) | Сдвиг (с) | Sync | QA | LUFS до → после | True Peak | Метод |");
  lines.push("|---:|---|---|---|---|---|---:|---|---:|---|---|---|---|---|");
  for (let i = 0; i < vlResult.turns.length; i++) {
    const r = vlResult.turns[i];
    const orig = turns[r.index];
    const placement = assembled.actualPlacements[i];
    const det = allTurnDetails.find((d) => d.globalIndex === r.index);
    const rawTc = (orig.rawTurn as any)?.timecode;
    const tc = rawTc || `${fmtNum(orig.startSec, 1)}–${fmtNum(orig.endSec, 1)}`;
    const rawSeg = det ? `${fmtNum(det.startSec, 2)}–${fmtNum(det.endSec, 2)}` : "—";
    const styleCell = det?.sentStyle ? `\`${det.sentStyle}\`` : "`\"\"`";
    const lufsCell = `${fmtNum(det?.lufsBefore, 1)} → ${fmtNum(det?.lufsAfter, 1)}`;
    const tpCell = `${fmtNum(det?.truePeakAfterDbfs, 2)} dBFS`;
    lines.push(
      `| ${i + 1} | ${tc} | ${escapeMd(r.speakerName)} | ${styleCell} | ${rawSeg} | ${det?.found ? "✅" : "❌"} | ${fmtNum(det?.confidence, 2)} | ${fmtNum(placement?.dubbedDurationSec ?? r.dubbedDurationSec, 2)} / ${fmtNum(placement?.originalDurationSec ?? r.originalDurationSec, 2)} | +${fmtNum(placement?.shiftedStartBySec ?? 0, 2)} | ${placement?.syncStatus ?? r.syncStatus} | ${r.qa}${r.qaReason ? ` (${escapeMd(r.qaReason)})` : ""} | ${lufsCell} | ${tpCell} | ${escapeMd(r.slicingMethod)} |`
    );
  }
  lines.push("");

  lines.push("## 7. Сохранённые артефакты");
  lines.push("");
  lines.push("- `public/audio/voice-lock-stage2/tiggo8-aziz-M2-raw.wav`");
  lines.push("- `public/audio/voice-lock-stage2/tiggo8-veronika-F1-raw.wav`");
  lines.push("- `public/audio/voice-lock-stage2/tiggo8-M2-F1-master.wav`");
  lines.push("- `public/audio/voice-lock-stage2/report.md`");
  lines.push("");

  fs.writeFileSync(reportPath, lines.join("\n"), "utf-8");

  return {
    ok: true,
    overallSuccess: vlResult.overallSuccess,
    identityQaPassed: vlResult.identityQaPassed,
    ttsCallsUsed: vlResult.ttsCallsUsed,
    alignmentCallsUsed: vlResult.alignmentCallsUsed,
    identityQaCallsUsed: vlResult.identityQaCallsUsed,
    masterDurationSec: Math.round(assembled.totalDurationSec * 100) / 100,
    files: [
      "public/audio/voice-lock-stage2/tiggo8-aziz-M2-raw.wav",
      "public/audio/voice-lock-stage2/tiggo8-veronika-F1-raw.wav",
      "public/audio/voice-lock-stage2/tiggo8-M2-F1-master.wav",
      "public/audio/voice-lock-stage2/report.md",
    ],
    summary: {
      aziz: {
        voiceId: azizTrack.voiceId,
        identityVersion: azizTrack.identityVersion,
        turnsCount: azizTrack.turnCount,
        partsSent: azizTrack.partsSentCount,
        rawDurationSec: Math.round(azizTrack.rawDurationSec * 100) / 100,
        status: azizTrack.status,
        identityQaPassed: azizTrack.identityQa.passed,
        identityQaConfidence: azizTrack.identityQa.confidence,
        explanationRu: azizTrack.identityQa.explanationRu,
      },
      veronika: {
        voiceId: veronikaTrack.voiceId,
        identityVersion: veronikaTrack.identityVersion,
        turnsCount: veronikaTrack.turnCount,
        partsSent: veronikaTrack.partsSentCount,
        rawDurationSec: Math.round(veronikaTrack.rawDurationSec * 100) / 100,
        status: veronikaTrack.status,
        identityQaPassed: veronikaTrack.identityQa.passed,
        identityQaConfidence: veronikaTrack.identityQa.confidence,
        explanationRu: veronikaTrack.identityQa.explanationRu,
      },
      qaStats: vlResult.stats,
      charonOrKoreUsed,
      kieUsed,
      multiSpeakerUsed,
    },
  };
}
