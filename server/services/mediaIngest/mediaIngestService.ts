import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import {
  IngestJobState,
  IngestResult,
  MediaPlatform,
  AdapterAttemptLog,
  DubbingSegment,
} from "./types.js";
import { inspectMediaStreams, extractDecodedAudio, sanitizeLogOutput } from "./audioVerifier.js";
import { UploadedFileAdapter } from "./adapters/uploadedFileAdapter.js";
import { DirectUrlAdapter } from "./adapters/directUrlAdapter.js";
import { TikWMAdapter } from "./adapters/tikwmAdapter.js";
import { YtDlpAdapter } from "./adapters/ytdlpAdapter.js";
import { CobaltAdapter } from "./adapters/cobaltAdapter.js";
import { GeminiYouTubeAdapter } from "./adapters/geminiYoutubeAdapter.js";

export function detectMediaPlatform(url: string): MediaPlatform {
  const u = url.toLowerCase();
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
  if (u.includes("instagram.com")) return "instagram";
  if (u.includes("tiktok.com")) return "tiktok";
  if (u.includes("twitter.com") || u.includes("x.com")) return "twitter";
  return "direct";
}

export class MediaIngestService {
  private uploadedAdapter = new UploadedFileAdapter();
  private directUrlAdapter = new DirectUrlAdapter();
  private tikwmAdapter = new TikWMAdapter();
  private ytdlpAdapter = new YtDlpAdapter();
  private cobaltAdapter = new CobaltAdapter();
  private geminiYtAdapter = new GeminiYouTubeAdapter();

  /**
   * Main entry point for ingesting media and running speech extraction + translation.
   */
  async processJob(
    params: {
      url?: string;
      mediaBase64?: string;
      videoTitle?: string;
    },
    aiClient: GoogleGenAI
  ): Promise<IngestResult> {
    const jobId = `ingest-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const attemptLogs: AdapterAttemptLog[] = [];
    const tempDir = "/tmp";
    const tempMediaFile = path.resolve(tempDir, `${jobId}-media.mp4`);
    const tempAudioFile = path.resolve(tempDir, `${jobId}-audio.mp3`);

    const cleanup = () => {
      try {
        if (fs.existsSync(tempMediaFile)) fs.unlinkSync(tempMediaFile);
        if (fs.existsSync(tempAudioFile)) fs.unlinkSync(tempAudioFile);
      } catch (e) {}
    };

    let platform: MediaPlatform = "uploaded_file";
    if (params.url) {
      platform = detectMediaPlatform(params.url);
    }

    console.log(`[MediaIngestService ${jobId}] Starting job for platform: ${platform}`);

    // =========================================================================
    // CASE A: Direct File Upload
    // =========================================================================
    if (params.mediaBase64) {
      const startT = Date.now();
      const res = await this.uploadedAdapter.processUpload(params.mediaBase64, tempMediaFile);
      attemptLogs.push({
        adapter: this.uploadedAdapter.name,
        timestamp: new Date().toISOString(),
        stage: "download",
        status: res.success ? "success" : "failed",
        durationMs: Date.now() - startT,
        downloadedBytes: res.bytes,
        error: res.error,
      });

      if (!res.success) {
        cleanup();
        return {
          state: res.state,
          platform: "uploaded_file",
          audioDuration: 0,
          videoDuration: 0,
          audioStartTimeOffset: 0,
          hasSpeech: false,
          segments: [],
          attemptLogs,
          userFriendlyReason: res.error,
          requiresFileUpload: true,
        };
      }

      return await this.verifyAndProcessAudio(tempMediaFile, tempAudioFile, platform, this.uploadedAdapter.name, attemptLogs, aiClient);
    }

    // =========================================================================
    // CASE B: URL Processing
    // =========================================================================
    const rawUrl = (params.url || "").trim();
    if (!rawUrl) {
      return {
        state: "source_unavailable",
        platform: "direct",
        audioDuration: 0,
        videoDuration: 0,
        audioStartTimeOffset: 0,
        hasSpeech: false,
        segments: [],
        attemptLogs,
        userFriendlyReason: "Bo'sh havola kiritildi.",
        requiresFileUpload: true,
      };
    }

    let mediaDownloaded = false;
    let successfulAdapter = "";

    // 1. Direct URL Adapter (if file URL)
    if (this.directUrlAdapter.canHandle(rawUrl, platform)) {
      const startT = Date.now();
      const res = await this.directUrlAdapter.fetchMedia(rawUrl, tempMediaFile);
      attemptLogs.push({
        adapter: this.directUrlAdapter.name,
        timestamp: new Date().toISOString(),
        stage: "download",
        status: res.success ? "success" : "failed",
        durationMs: Date.now() - startT,
        downloadedBytes: res.bytes,
        error: res.error,
      });

      if (res.success) {
        mediaDownloaded = true;
        successfulAdapter = this.directUrlAdapter.name;
      }
    }

    // 2. TikTok Strategy: Primary TikWM, Secondary yt-dlp, Tertiary Cobalt
    if (!mediaDownloaded && platform === "tiktok") {
      // Primary: TikWM
      const startT = Date.now();
      console.log(`[MediaIngestService ${jobId}] Trying TikWM for TikTok...`);
      const tikRes = await this.tikwmAdapter.fetchMedia(rawUrl, tempMediaFile);
      attemptLogs.push({
        adapter: this.tikwmAdapter.name,
        timestamp: new Date().toISOString(),
        stage: "download",
        status: tikRes.success ? "success" : "failed",
        durationMs: Date.now() - startT,
        downloadedBytes: tikRes.bytes,
        error: tikRes.error,
      });

      if (tikRes.success) {
        mediaDownloaded = true;
        successfulAdapter = this.tikwmAdapter.name;
      } else {
        // Secondary: yt-dlp
        console.log(`[MediaIngestService ${jobId}] TikWM failed, trying yt-dlp for TikTok...`);
        const ytStart = Date.now();
        const ytRes = await this.ytdlpAdapter.fetchMedia(rawUrl, tempMediaFile);
        attemptLogs.push({
          adapter: this.ytdlpAdapter.name,
          timestamp: new Date().toISOString(),
          stage: "download",
          status: ytRes.success ? "success" : "failed",
          durationMs: Date.now() - ytStart,
          downloadedBytes: ytRes.bytes,
          error: ytRes.error,
        });

        if (ytRes.success) {
          mediaDownloaded = true;
          successfulAdapter = this.ytdlpAdapter.name;
        }
      }
    }

    // 3. YouTube Strategy: Primary yt-dlp, Secondary Cobalt, Tertiary Gemini transcript_only
    if (!mediaDownloaded && platform === "youtube") {
      // Primary: yt-dlp
      console.log(`[MediaIngestService ${jobId}] Trying yt-dlp for YouTube...`);
      const ytStart = Date.now();
      const ytRes = await this.ytdlpAdapter.fetchMedia(rawUrl, tempMediaFile);
      attemptLogs.push({
        adapter: this.ytdlpAdapter.name,
        timestamp: new Date().toISOString(),
        stage: "download",
        status: ytRes.success ? "success" : "failed",
        durationMs: Date.now() - ytStart,
        downloadedBytes: ytRes.bytes,
        error: ytRes.error,
        rawDetails: ytRes.rawDetails,
      });

      if (ytRes.success) {
        mediaDownloaded = true;
        successfulAdapter = this.ytdlpAdapter.name;
      } else {
        // Secondary: Cobalt
        console.log(`[MediaIngestService ${jobId}] yt-dlp failed, trying internal Cobalt for YouTube...`);
        const cobStart = Date.now();
        const cobRes = await this.cobaltAdapter.fetchMedia(rawUrl, tempMediaFile);
        attemptLogs.push({
          adapter: this.cobaltAdapter.name,
          timestamp: new Date().toISOString(),
          stage: "download",
          status: cobRes.success ? "success" : "failed",
          durationMs: Date.now() - cobStart,
          downloadedBytes: cobRes.bytes,
          error: cobRes.error,
          rawDetails: cobRes.rawDetails,
        });

        if (cobRes.success) {
          mediaDownloaded = true;
          successfulAdapter = this.cobaltAdapter.name;
        } else {
          // Tertiary: Gemini YouTube Direct Analysis (returns transcript_only)
          console.log(`[MediaIngestService ${jobId}] Downloads blocked on Cloud Run. Trying Gemini multimodal analysis...`);
          const gemStart = Date.now();
          const gemRes = await this.geminiYtAdapter.analyzeYouTubeVideo(rawUrl, aiClient);
          attemptLogs.push({
            adapter: this.geminiYtAdapter.name,
            timestamp: new Date().toISOString(),
            stage: "inspect",
            status: gemRes.success ? "success" : "failed",
            durationMs: Date.now() - gemStart,
            error: gemRes.error,
          });

          if (gemRes.success && gemRes.segments.length > 0) {
            cleanup();
            return {
              state: "transcript_only",
              platform: "youtube",
              sourceUrl: rawUrl,
              audioDuration: 0,
              videoDuration: 0,
              audioStartTimeOffset: 0,
              adapterUsed: this.geminiYtAdapter.name,
              hasSpeech: gemRes.hasSpeech,
              detectedLanguage: gemRes.detectedLanguage,
              suggestedTopic: gemRes.suggestedTopic,
              segments: gemRes.segments,
              fullTimedScript: gemRes.fullTimedScript,
              cleanUzbekScript: gemRes.cleanUzbekScript,
              attemptLogs,
              userFriendlyReason: "YouTube to'g'ridan-to'g'ri oqimni chekladi. Matn Gemini video tahlili orqali olindi.",
              requiresFileUpload: true,
              transcriptOnlyNotice: gemRes.transcriptOnlyNotice,
            };
          }
        }
      }
    }

    // 4. Instagram Strategy: Primary yt-dlp, Secondary Cobalt
    if (!mediaDownloaded && platform === "instagram") {
      const ytStart = Date.now();
      const ytRes = await this.ytdlpAdapter.fetchMedia(rawUrl, tempMediaFile);
      attemptLogs.push({
        adapter: this.ytdlpAdapter.name,
        timestamp: new Date().toISOString(),
        stage: "download",
        status: ytRes.success ? "success" : "failed",
        durationMs: Date.now() - ytStart,
        downloadedBytes: ytRes.bytes,
        error: ytRes.error,
        rawDetails: ytRes.rawDetails,
      });

      if (ytRes.success) {
        mediaDownloaded = true;
        successfulAdapter = this.ytdlpAdapter.name;
      } else {
        const cobStart = Date.now();
        const cobRes = await this.cobaltAdapter.fetchMedia(rawUrl, tempMediaFile);
        attemptLogs.push({
          adapter: this.cobaltAdapter.name,
          timestamp: new Date().toISOString(),
          stage: "download",
          status: cobRes.success ? "success" : "failed",
          durationMs: Date.now() - cobStart,
          downloadedBytes: cobRes.bytes,
          error: cobRes.error,
        });

        if (cobRes.success) {
          mediaDownloaded = true;
          successfulAdapter = this.cobaltAdapter.name;
        }
      }
    }

    // 5. X / Twitter Strategy: Primary yt-dlp, Secondary Cobalt
    if (!mediaDownloaded && platform === "twitter") {
      const ytStart = Date.now();
      const ytRes = await this.ytdlpAdapter.fetchMedia(rawUrl, tempMediaFile);
      attemptLogs.push({
        adapter: this.ytdlpAdapter.name,
        timestamp: new Date().toISOString(),
        stage: "download",
        status: ytRes.success ? "success" : "failed",
        durationMs: Date.now() - ytStart,
        downloadedBytes: ytRes.bytes,
        error: ytRes.error,
        rawDetails: ytRes.rawDetails,
      });

      if (ytRes.success) {
        mediaDownloaded = true;
        successfulAdapter = this.ytdlpAdapter.name;
      } else {
        const cobStart = Date.now();
        const cobRes = await this.cobaltAdapter.fetchMedia(rawUrl, tempMediaFile);
        attemptLogs.push({
          adapter: this.cobaltAdapter.name,
          timestamp: new Date().toISOString(),
          stage: "download",
          status: cobRes.success ? "success" : "failed",
          durationMs: Date.now() - cobStart,
          downloadedBytes: cobRes.bytes,
          error: cobRes.error,
        });

        if (cobRes.success) {
          mediaDownloaded = true;
          successfulAdapter = this.cobaltAdapter.name;
        }
      }
    }

    // If all adapters failed to obtain media
    if (!mediaDownloaded || !fs.existsSync(tempMediaFile) || fs.statSync(tempMediaFile).size === 0) {
      cleanup();
      const lastFailedLog = attemptLogs.find((l) => l.status === "failed");
      const errorMsg = lastFailedLog?.error || "Ushbu havoladan media oqimini yuklab bo'lmadi.";

      let state: IngestJobState = "platform_blocked";
      if (/404|not found|mavjud emas/i.test(errorMsg)) {
        state = "source_unavailable";
      }

      return {
        state,
        platform,
        sourceUrl: rawUrl,
        audioDuration: 0,
        videoDuration: 0,
        audioStartTimeOffset: 0,
        hasSpeech: false,
        segments: [],
        attemptLogs,
        userFriendlyReason: errorMsg,
        requiresFileUpload: true,
      };
    }

    // =========================================================================
    // STEP 2: Media Inspection & Decoded Audio Verification via FFprobe & FFmpeg
    // =========================================================================
    return await this.verifyAndProcessAudio(tempMediaFile, tempAudioFile, platform, successfulAdapter, attemptLogs, aiClient, rawUrl);
  }

  private async verifyAndProcessAudio(
    mediaFile: string,
    outputAudioFile: string,
    platform: MediaPlatform,
    adapterName: string,
    attemptLogs: AdapterAttemptLog[],
    aiClient: GoogleGenAI,
    sourceUrl?: string
  ): Promise<IngestResult> {
    const inspectStart = Date.now();
    const streamInspection = await inspectMediaStreams(mediaFile);

    attemptLogs.push({
      adapter: "FFprobeStreamInspector",
      timestamp: new Date().toISOString(),
      stage: "inspect",
      status: streamInspection.hasAudioStream ? "success" : "failed",
      durationMs: Date.now() - inspectStart,
      rawDetails: `Video: ${streamInspection.videoCodec || "none"} (${streamInspection.videoDuration}s), Audio: ${streamInspection.audioCodec || "none"} (${streamInspection.audioDuration}s), SilentTail: ${streamInspection.isSilentTail}`,
    });

    if (!streamInspection.hasAudioStream) {
      return {
        state: "source_has_no_audio",
        platform,
        sourceUrl,
        audioDuration: 0,
        videoDuration: streamInspection.videoDuration,
        audioStartTimeOffset: 0,
        adapterUsed: adapterName,
        streamInspection,
        hasSpeech: false,
        segments: [],
        attemptLogs,
        userFriendlyReason: "Ushbu videoda audio yo'l (ovoz) mavjud emas yoki u butunlay soqov (mute).",
        requiresFileUpload: true,
      };
    }

    // Extract decoded audio via FFmpeg
    const extractStart = Date.now();
    const extRes = await extractDecodedAudio(mediaFile, outputAudioFile);

    attemptLogs.push({
      adapter: "FFmpegAudioDecoder",
      timestamp: new Date().toISOString(),
      stage: "decode",
      status: extRes.success ? "success" : "failed",
      durationMs: Date.now() - extractStart,
      downloadedBytes: extRes.fileSize,
      error: extRes.error,
    });

    if (!extRes.success || extRes.audioDuration <= 0) {
      return {
        state: "provider_failed",
        platform,
        sourceUrl,
        audioDuration: 0,
        videoDuration: streamInspection.videoDuration,
        audioStartTimeOffset: 0,
        adapterUsed: adapterName,
        streamInspection,
        hasSpeech: false,
        segments: [],
        attemptLogs,
        userFriendlyReason: "FFmpeg orqali audio oqimini dekodlashda xatolik yuz berdi.",
        requiresFileUpload: true,
      };
    }

    const audioBuf = fs.readFileSync(outputAudioFile);
    const audioBase64 = audioBuf.toString("base64");

    // =========================================================================
    // STEP 3: Verbatim Speech-to-Text & Diarization via Gemini 3.8 Flash
    // =========================================================================
    const prompt = `Siz professional dublyaj rejissyorisiz.
Ushbu audio faylni tinglang va inson nutqini aniqlang.

TALABLAR:
1. Audioda inson nutqi bormi?
   - Agar faqat musiqa, tabiat tovushlari yoki shovqin bo'lsa -> "hasSpeech": false, "segments": [].
2. Agar inson nutqi bo'lsa -> "hasSpeech": true:
   - SO'ZMA-SO'Z TO'LIQ TRANSSKRIPSIYA (Verbatim): Audioda aytilgan so'zlarni aynan o'z tilida yozing.
   - GAPIRUVCHILARNI AJRATISH: "Speaker 1", "Speaker 2".
   - ANIQ TAYMKODLAR: [00:00 - 00:05].
   - SINXRON O'ZBEKCHA TARJIMA: Har bir replikani jonli, jarangdor o'zbek tiliga aniq tarjima qiling.
   - Audioda yo'q gaplarni MUTLAQO TO'QIMANG.

Qat'iy JSON formatida qaytaring:
{
  "hasSpeech": true,
  "detectedLanguage": "O'zbek tili (yoki Rus, Ingliz)",
  "suggestedTopic": "Mavzu",
  "segments": [
    {
      "id": 1,
      "start": "00:00",
      "end": "00:05",
      "speaker": "Speaker 1",
      "originalText": "...",
      "uzbekText": "..."
    }
  ],
  "fullTimedScript": "[00:00 - 00:05] [Speaker 1]: ...",
  "cleanUzbekScript": "..."
}`;

    let segments: DubbingSegment[] = [];
    let hasSpeech = false;
    let detectedLanguage = "Aniqlanmadi";
    let suggestedTopic = "Audio Dublyaj";
    let fullTimedScript = "";
    let cleanUzbekScript = "";

    try {
      const gemRes = await aiClient.models.generateContent({
        model: "gemini-3.8-flash",
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType: "audio/mp3",
                  data: audioBase64,
                },
              },
              {
                text: prompt,
              },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
        },
      });

      const parsed: any = JSON.parse(gemRes.text || "{}");
      hasSpeech = !!parsed.hasSpeech && Array.isArray(parsed.segments) && parsed.segments.length > 0;
      detectedLanguage = parsed.detectedLanguage || "Aniqlanmadi";
      suggestedTopic = parsed.suggestedTopic || "Audio Dublyaj";
      fullTimedScript = parsed.fullTimedScript || "";
      cleanUzbekScript = parsed.cleanUzbekScript || "";

      if (hasSpeech && Array.isArray(parsed.segments)) {
        segments = parsed.segments.map((s: any, idx: number) => ({
          id: s.id || idx + 1,
          start: s.start || "00:00",
          end: s.end || "00:00",
          speaker: s.speaker || "Speaker 1",
          originalText: s.originalText || s.original || "",
          uzbekText: s.uzbekText || s.uzbek || "",
        }));
      }
    } catch (e: any) {
      console.warn(`[MediaIngestService] Gemini STT warning:`, e.message);
    }

    return {
      state: "media_ready",
      platform,
      sourceUrl,
      extractedAudioBase64: audioBase64,
      audioDuration: extRes.audioDuration,
      videoDuration: streamInspection.videoDuration,
      audioStartTimeOffset: streamInspection.audioStartTime,
      adapterUsed: adapterName,
      streamInspection,
      hasSpeech,
      detectedLanguage,
      suggestedTopic,
      segments,
      fullTimedScript,
      cleanUzbekScript,
      attemptLogs,
      requiresFileUpload: false,
    };
  }
}

export const mediaIngestService = new MediaIngestService();
