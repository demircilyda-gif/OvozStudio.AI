import { MediaPlatform, IngestJobState } from "../types.js";

export interface AdapterResult {
  success: boolean;
  bytes: number;
  state: IngestJobState;
  error?: string;
  rawDetails?: string;
  isStreamOnly?: boolean;
}

export abstract class BaseMediaAdapter {
  abstract readonly name: string;

  /**
   * Validates if the given URL belongs to a supported domain and is safe (no SSRF).
   */
  protected validateUrl(url: string): { valid: boolean; reason?: string } {
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return { valid: false, reason: "Faqat HTTP/HTTPS protokollar qo'llab-quvvatlanadi." };
      }

      const hostname = parsed.hostname.toLowerCase();
      // Block local/private IPs and internal metadata endpoints
      if (
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname.startsWith("10.") ||
        hostname.startsWith("192.168.") ||
        hostname.startsWith("172.16.") ||
        hostname.endsWith(".internal") ||
        hostname === "169.254.169.254" || // GCP metadata
        hostname === "metadata.google.internal"
      ) {
        return { valid: false, reason: "Xavfsizlik: Ichki tarmoq manzillariga ruxsat berilmaydi." };
      }

      return { valid: true };
    } catch {
      return { valid: false, reason: "Noto'g'ri URL formati." };
    }
  }

  abstract canHandle(url: string, platform: MediaPlatform): boolean;

  abstract fetchMedia(
    url: string,
    destinationPath: string
  ): Promise<AdapterResult>;
}
