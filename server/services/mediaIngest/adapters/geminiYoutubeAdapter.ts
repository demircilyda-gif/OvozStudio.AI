import { GoogleGenAI } from "@google/genai";
import { DubbingSegment, IngestJobState } from "../types.js";

export interface GeminiTranscriptResult {
  success: boolean;
  state: IngestJobState;
  hasSpeech: boolean;
  detectedLanguage?: string;
  suggestedTopic?: string;
  segments: DubbingSegment[];
  fullTimedScript?: string;
  cleanUzbekScript?: string;
  transcriptOnlyNotice?: string;
  error?: string;
}

export class GeminiYouTubeAdapter {
  readonly name = "GeminiYouTubeAdapter (Direct YouTube Video Analysis)";

  async analyzeYouTubeVideo(
    youtubeUrl: string,
    aiClient: GoogleGenAI
  ): Promise<GeminiTranscriptResult> {
    try {
      const prompt = `You are a professional video translator and dubbing director.
Analyze this public YouTube video: ${youtubeUrl}

CRITICAL RULES:
1. Does this video contain actual spoken human dialogue?
   - If NO speech (only background music, sound effects, or silence): return "hasSpeech": false, "segments": [].
2. If YES, human speech is present:
   - Perform VERBATIM speech-to-text in original language with start/end timestamps ([00:00 - 00:05]).
   - Perform SPEAKER DIARIZATION ("Speaker 1", "Speaker 2", etc.).
   - Perform SYNCHRONOUS UZBEK TRANSLATION for each sentence.
   - Do NOT invent or hallucinate dialogue not spoken in the video.

Return STRICT JSON:
{
  "hasSpeech": true,
  "detectedLanguage": "English",
  "suggestedTopic": "Topic",
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

      const res = await aiClient.models.generateContent({
        model: "gemini-3.8-flash",
        contents: [
          {
            role: "user",
            parts: [
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

      const text = res.text || "{}";
      const parsed: any = JSON.parse(text);

      const segments: DubbingSegment[] = Array.isArray(parsed.segments)
        ? parsed.segments.map((s: any, idx: number) => ({
            id: s.id || idx + 1,
            start: s.start || "00:00",
            end: s.end || "00:00",
            speaker: s.speaker || "Speaker 1",
            originalText: s.originalText || s.original || "",
            uzbekText: s.uzbekText || s.uzbek || "",
          }))
        : [];

      return {
        success: true,
        state: "transcript_only",
        hasSpeech: !!parsed.hasSpeech && segments.length > 0,
        detectedLanguage: parsed.detectedLanguage || "Aniqlanmadi",
        suggestedTopic: parsed.suggestedTopic || "YouTube Video",
        segments,
        fullTimedScript: parsed.fullTimedScript || "",
        cleanUzbekScript: parsed.cleanUzbekScript || "",
        transcriptOnlyNotice:
          "Ushbu transkripsiya va o'zbekcha tarjima Gemini multimodal video tahlili orqali bevosita YouTube havolasidan olindi (transcript_only rejimi). Asl audio faylini eshitish yoki tayyor sinxron video dublyajni montaj qilish uchun, iltimos, MP4 faylni qurilmangizdan yuklang.",
      };
    } catch (err: any) {
      return {
        success: false,
        state: "provider_failed",
        hasSpeech: false,
        segments: [],
        error: `Gemini YouTube tahlilida xatolik: ${err.message}`,
      };
    }
  }
}
