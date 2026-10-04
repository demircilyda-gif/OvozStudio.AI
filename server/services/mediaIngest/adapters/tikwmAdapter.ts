import fs from "node:fs";
import { BaseMediaAdapter, AdapterResult } from "./baseAdapter.js";
import { MediaPlatform } from "../types.js";

/**
 * TikWM API Adapter
 * NOTE: Marked explicitly as a [3P Dependency: TikWM API].
 * Used for direct streaming of TikTok video files.
 */
export class TikWMAdapter extends BaseMediaAdapter {
  readonly name = "TikWMAdapter (3P Dependency: TikWM API)";

  canHandle(url: string, platform: MediaPlatform): boolean {
    return platform === "tiktok" || url.includes("tiktok.com");
  }

  async fetchMedia(url: string, destinationPath: string): Promise<AdapterResult> {
    const val = this.validateUrl(url);
    if (!val.valid) {
      return { success: false, bytes: 0, state: "source_unavailable", error: val.reason };
    }

    try {
      const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url.trim())}`;
      const res = await fetch(apiUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      });

      if (!res.ok) {
        return {
          success: false,
          bytes: 0,
          state: "provider_failed",
          error: `TikWM API so'rovi muvaffaqiyatsiz bo'ldi (HTTP ${res.status}).`,
        };
      }

      const json: any = await res.json();
      if (json.code !== 0 || !json.data) {
        return {
          success: false,
          bytes: 0,
          state: json.msg?.includes("not found") ? "source_unavailable" : "platform_blocked",
          error: `TikWM xabari: ${json.msg || "Video ma'lumotlari topilmadi"}`,
        };
      }

      const streamUrl = json.data.play || json.data.wmplay;
      if (!streamUrl) {
        return {
          success: false,
          bytes: 0,
          state: "source_has_no_audio",
          error: "TikWM javobida video oqimi manzili (play URL) topilmadi.",
        };
      }

      // Download actual stream
      const streamRes = await fetch(streamUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      });

      if (!streamRes.ok) {
        return {
          success: false,
          bytes: 0,
          state: "provider_failed",
          error: `Video oqimini yuklab bo'lmadi (HTTP ${streamRes.status}).`,
        };
      }

      const ab = await streamRes.arrayBuffer();
      const buf = Buffer.from(ab);

      if (buf.length < 5000) {
        return {
          success: false,
          bytes: buf.length,
          state: "provider_failed",
          error: "TikWM orqali olingan video hajmi juda kichik yoki bo'sh.",
        };
      }

      fs.writeFileSync(destinationPath, buf);
      return {
        success: true,
        bytes: buf.length,
        state: "media_ready",
      };
    } catch (err: any) {
      return {
        success: false,
        bytes: 0,
        state: "provider_failed",
        error: `TikWM yuklash xatoligi: ${err.message}`,
      };
    }
  }
}
