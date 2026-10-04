/**
 * Media Ingest Service Types and States
 * Strict contract for multi-platform media ingestion, verification, and dubbing.
 */

export type IngestJobState =
  | "media_ready"          // Decodable audio extracted, verified via FFprobe, playable MP3 available
  | "transcript_only"       // Gemini YouTube video understanding generated transcript without raw media file
  | "source_has_no_audio"   // Media downloaded, but has 0 audio streams or is completely mute
  | "source_unavailable"    // Post deleted, 404, or private
  | "platform_blocked"      // Platform anti-bot (Sign in, Meta auth gate, guest token lock)
  | "provider_failed";      // Internal error or network timeout

export type MediaPlatform =
  | "youtube"
  | "instagram"
  | "tiktok"
  | "twitter"
  | "direct"
  | "uploaded_file";

export interface AdapterAttemptLog {
  adapter: string;
  timestamp: string;
  stage: "init" | "fetch" | "download" | "inspect" | "decode";
  status: "success" | "skipped" | "failed";
  exitCode?: number;
  durationMs: number;
  downloadedBytes?: number;
  error?: string;
  rawDetails?: string;
}

export interface MediaStreamInspection {
  hasVideoStream: boolean;
  hasAudioStream: boolean;
  videoCodec?: string;
  videoDuration: number;
  audioCodec?: string;
  audioChannels?: number;
  audioSampleRate?: number;
  audioDuration: number;
  audioStartTime: number;
  videoStartTime: number;
  durationDelta: number;
  isSilentTail: boolean;
  containerDuration: number;
  containerSize: number;
}

export interface DubbingSegment {
  id: number;
  start: string;
  end: string;
  speaker: string;
  originalText: string;
  uzbekText: string;
}

export interface IngestResult {
  state: IngestJobState;
  platform: MediaPlatform;
  sourceUrl?: string;
  tempVideoPath?: string;
  tempAudioPath?: string;
  extractedAudioBase64?: string; // Playable MP3 base64 (ONLY when state === 'media_ready')
  audioDuration: number;
  videoDuration: number;
  audioStartTimeOffset: number;
  adapterUsed?: string;
  streamInspection?: MediaStreamInspection;
  hasSpeech: boolean;
  detectedLanguage?: string;
  suggestedTopic?: string;
  segments: DubbingSegment[];
  fullTimedScript?: string;
  cleanUzbekScript?: string;
  attemptLogs: AdapterAttemptLog[];
  userFriendlyReason?: string;
  requiresFileUpload: boolean;
  transcriptOnlyNotice?: string;
}
