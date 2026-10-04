/**
 * Production Media Pipeline Service for OvozStudio.AI Video Dublyaj
 * Backed by modular MediaIngestService with independent adapters:
 * - UploadedFileAdapter (Local file processing)
 * - DirectUrlAdapter (Direct HTTP media streams)
 * - TikWMAdapter (3P Dependency: TikWM API)
 * - YtDlpAdapter (Audio-first direct stream downloader)
 * - CobaltAdapter (Isolated internal Cobalt-compatible microservice)
 * - GeminiYouTubeAdapter (Multimodal video understanding for transcript_only mode)
 */

import { GoogleGenAI } from "@google/genai";
import { mediaIngestService } from "./mediaIngest/mediaIngestService.js";
import { IngestJobState, MediaStreamInspection } from "./mediaIngest/types.js";

export interface PipelineAttemptLog {
  id: string;
  timestamp: string;
  platform: "youtube" | "instagram" | "tiktok" | "twitter" | "direct" | "uploaded_file";
  sourceUrl?: string;
  downloaderVersion: string;
  ffmpegVersion: string;
  stage: "init" | "download" | "extract" | "ffprobe" | "transcribe" | "translate" | "complete" | "error";
  videoFileSize: number;
  videoDuration: number;
  audioFileSize: number;
  audioDuration: number;
  durationsMatch: boolean;
  hasSpeech?: boolean;
  detectedLanguage?: string;
  firstOriginalWords?: string;
  uzbekTranslationSample?: string;
  error?: string;
  errorDetails?: string;
  success: boolean;
  state?: IngestJobState;
  adapterUsed?: string;
}

export interface DubbingSegment {
  id: number;
  start: string;
  end: string;
  speaker: string;
  originalText: string;
  uzbekText: string;
}

export interface PipelineResult {
  success: boolean;
  state: IngestJobState;
  stage: "download" | "extract" | "ffprobe" | "transcribe" | "translate" | "complete";
  platform: string;
  videoFileSize: number;
  videoDuration: number;
  audioFileSize: number;
  audioDuration: number;
  durationsMatch: boolean;
  extractedAudioBase64?: string; // Playable MP3 base64 (ONLY when state === 'media_ready')
  hasSpeech: boolean;
  detectedLanguage?: string;
  suggestedTopic?: string;
  segments: DubbingSegment[];
  fullTimedScript?: string;
  cleanUzbekScript?: string;
  error?: string;
  errorDetails?: string;
  attemptLog: PipelineAttemptLog;
  transcriptOnlyNotice?: string;
  streamInspection?: MediaStreamInspection;
}

// In-memory ring buffer of recent pipeline attempts (max 50)
const pipelineLogs: PipelineAttemptLog[] = [];

export function getPipelineLogs(): PipelineAttemptLog[] {
  return [...pipelineLogs].reverse();
}

/**
 * Runs the full end-to-end pipeline using MediaIngestService.
 */
export async function runMediaDubbingPipeline(
  params: {
    url?: string;
    mediaBase64?: string;
    mimeType?: string;
    videoTitle?: string;
  },
  aiClient: GoogleGenAI
): Promise<PipelineResult> {
  const attemptId = `pipe-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const downloaderVersion = "yt-dlp 2026.08.19 + Cobalt 11.7.1";
  const ffmpegVersion = "ffmpeg 4.4.2";

  const ingestRes = await mediaIngestService.processJob(params, aiClient);

  const isSuccess = ingestRes.state === "media_ready" || ingestRes.state === "transcript_only";
  const durationsMatch =
    ingestRes.streamInspection?.isSilentTail ||
    Math.abs(ingestRes.videoDuration - ingestRes.audioDuration) <= 1.5;

  const log: PipelineAttemptLog = {
    id: attemptId,
    timestamp: new Date().toISOString(),
    platform: ingestRes.platform,
    sourceUrl: params.url,
    downloaderVersion,
    ffmpegVersion,
    stage: isSuccess ? "complete" : "error",
    videoFileSize: ingestRes.streamInspection?.containerSize || 0,
    videoDuration: ingestRes.videoDuration,
    audioFileSize: ingestRes.extractedAudioBase64 ? Math.round((ingestRes.extractedAudioBase64.length * 3) / 4) : 0,
    audioDuration: ingestRes.audioDuration,
    durationsMatch,
    hasSpeech: ingestRes.hasSpeech,
    detectedLanguage: ingestRes.detectedLanguage,
    firstOriginalWords: ingestRes.segments[0]?.originalText?.slice(0, 100),
    uzbekTranslationSample: ingestRes.segments[0]?.uzbekText?.slice(0, 100),
    error: ingestRes.userFriendlyReason,
    errorDetails: ingestRes.attemptLogs.map((a) => `${a.adapter} (${a.status}): ${a.error || a.rawDetails || "ok"}`).join(" | "),
    success: isSuccess,
    state: ingestRes.state,
    adapterUsed: ingestRes.adapterUsed,
  };

  pipelineLogs.push({ ...log });
  if (pipelineLogs.length > 50) pipelineLogs.shift();

  return {
    success: isSuccess,
    state: ingestRes.state,
    stage: isSuccess ? "complete" : "download",
    platform: ingestRes.platform,
    videoFileSize: log.videoFileSize,
    videoDuration: ingestRes.videoDuration,
    audioFileSize: log.audioFileSize,
    audioDuration: ingestRes.audioDuration,
    durationsMatch,
    // CRITICAL: extractedAudioBase64 is ONLY provided if media_ready (decodable audio extracted)
    extractedAudioBase64: ingestRes.state === "media_ready" ? ingestRes.extractedAudioBase64 : undefined,
    hasSpeech: ingestRes.hasSpeech,
    detectedLanguage: ingestRes.detectedLanguage,
    suggestedTopic: ingestRes.suggestedTopic || params.videoTitle,
    segments: ingestRes.segments,
    fullTimedScript: ingestRes.fullTimedScript,
    cleanUzbekScript: ingestRes.cleanUzbekScript,
    error: ingestRes.userFriendlyReason,
    errorDetails: log.errorDetails,
    attemptLog: log,
    transcriptOnlyNotice: ingestRes.transcriptOnlyNotice,
    streamInspection: ingestRes.streamInspection,
  };
}
