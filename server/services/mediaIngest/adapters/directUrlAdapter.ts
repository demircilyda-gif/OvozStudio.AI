import fs from "node:fs";
import { BaseMediaAdapter, AdapterResult } from "./baseAdapter.js";
import { MediaPlatform } from "../types.js";

export class DirectUrlAdapter extends BaseMediaAdapter {
  readonly name = "DirectUrlAdapter";

  canHandle(url: string, platform: MediaPlatform): boolean {
    if (platform === "direct") return true;
    return /\.(mp4|webm|mov|m4v|mkv|mp3|wav|m4a|ogg|opus)(\?.*)?$/i.test(url);
  }

  async fetchMedia(url: string, destinationPath: string): Promise<AdapterResult> {
    const val = this.validateUrl(url);
    if (!val.valid) {
      return {
        success: false,
        bytes: 0,
        state: "source_unavailable",
        error: val.reason,
      };
    }

    try {
      let currentUrl = url;
      let hops = 0;
      let response: Response;

      while (true) {
        response = await fetch(currentUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
          },
          redirect: "manual",
        });

        if (response.status >= 300 && response.status < 400) {
          hops++;
          if (hops > 3) {
            return {
              success: false,
              bytes: 0,
              state: "provider_failed",
              error: "Juda ko'p qayta yo'naltirishlar (max 3).",
            };
          }
          const location = response.headers.get("location");
          if (!location) {
            return {
              success: false,
              bytes: 0,
              state: "provider_failed",
              error: "Qayta yo'naltirish manzili topilmadi.",
            };
          }
          const nextUrl = new URL(location, currentUrl).toString();
          const redirectVal = this.validateUrl(nextUrl);
          if (!redirectVal.valid) {
            return {
              success: false,
              bytes: 0,
              state: "source_unavailable",
              error: `Xavfsizlik: Qayta yo'naltirish manzili ruxsat etilmagan (${redirectVal.reason})`,
            };
          }
          currentUrl = nextUrl;
          continue;
        }
        break;
      }

      if (!response.ok) {
        return {
          success: false,
          bytes: 0,
          state: response.status === 404 || response.status === 410 ? "source_unavailable" : "provider_failed",
          error: `To'g'ridan-to'g'ri havola HTTP ${response.status} (${response.statusText}) qaytardi.`,
        };
      }

      const contentLength = response.headers.get("content-length");
      if (contentLength && parseInt(contentLength, 10) > 85 * 1024 * 1024) {
        return {
          success: false,
          bytes: 0,
          state: "provider_failed",
          error: "Fayl hajmi 80 MB limitidan oshib ketdi.",
        };
      }

      const arrayBuf = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);

      if (buffer.length < 500) {
        return {
          success: false,
          bytes: buffer.length,
          state: "provider_failed",
          error: "Yuklab olingan fayl hajmi juda kichik (yaroqsiz media).",
        };
      }

      fs.writeFileSync(destinationPath, buffer);
      return {
        success: true,
        bytes: buffer.length,
        state: "media_ready",
      };
    } catch (err: any) {
      return {
        success: false,
        bytes: 0,
        state: "provider_failed",
        error: `Yuklab olishda tarmoq xatoligi: ${err.message}`,
      };
    }
  }
}
