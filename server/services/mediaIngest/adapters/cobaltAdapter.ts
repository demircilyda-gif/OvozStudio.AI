import fs from "node:fs";
import { BaseMediaAdapter, AdapterResult } from "./baseAdapter.js";
import { MediaPlatform, IngestJobState } from "../types.js";
import { startCobaltInternalServer } from "../cobaltInternalServer.js";

/**
 * Cobalt Adapter
 * Connects to the isolated internal Cobalt microservice.
 * Adheres to Cobalt API protocol (POST / with downloadMode: "audio", localProcessing: "disabled")
 * Handles response types: 'tunnel', 'redirect', 'picker', 'error'.
 */
export class CobaltAdapter extends BaseMediaAdapter {
  readonly name = "CobaltAdapter (Self-Hosted Internal Instance)";
  private apiUrl = "http://127.0.0.1:9099";

  canHandle(url: string, platform: MediaPlatform): boolean {
    return ["youtube", "instagram", "tiktok", "twitter"].includes(platform);
  }

  async fetchMedia(url: string, destinationPath: string): Promise<AdapterResult> {
    const val = this.validateUrl(url);
    if (!val.valid) {
      return { success: false, bytes: 0, state: "source_unavailable", error: val.reason };
    }

    try {
      // Ensure internal microservice is running
      await startCobaltInternalServer();

      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: url.trim(),
          downloadMode: "audio",
          localProcessing: "disabled",
        }),
      });

      if (!response.ok) {
        return {
          success: false,
          bytes: 0,
          state: "provider_failed",
          error: `Cobalt ichki servisi HTTP ${response.status} qaytardi.`,
        };
      }

      const data: any = await response.json();

      // Case 1: tunnel or redirect
      if (data.status === "tunnel" || data.status === "redirect") {
        const streamUrl = data.url;
        if (!streamUrl) {
          return { success: false, bytes: 0, state: "provider_failed", error: "Cobalt javobida oqim URL manzili yo'q." };
        }

        const streamRes = await fetch(streamUrl);
        if (!streamRes.ok) {
          return {
            success: false,
            bytes: 0,
            state: "provider_failed",
            error: `Cobalt oqimini yuklab bo'lmadi (HTTP ${streamRes.status}).`,
          };
        }

        const ab = await streamRes.arrayBuffer();
        const buf = Buffer.from(ab);
        if (buf.length < 1000) {
          return { success: false, bytes: buf.length, state: "provider_failed", error: "Cobalt orqali olingan audio bo'sh." };
        }

        fs.writeFileSync(destinationPath, buf);
        return {
          success: true,
          bytes: buf.length,
          state: "media_ready",
        };
      }

      // Case 2: picker
      if (data.status === "picker" && Array.isArray(data.picker) && data.picker.length > 0) {
        const item = data.picker.find((p: any) => p.type === "video" || p.type === "audio") || data.picker[0];
        if (item?.url) {
          const pRes = await fetch(item.url);
          if (pRes.ok) {
            const ab = await pRes.arrayBuffer();
            const buf = Buffer.from(ab);
            fs.writeFileSync(destinationPath, buf);
            return {
              success: true,
              bytes: buf.length,
              state: "media_ready",
            };
          }
        }
      }

      // Case 3: error
      if (data.status === "error" || data.error) {
        const code = data.error?.code || "unknown";
        let state: IngestJobState = "platform_blocked";
        let msg = `Cobalt xatosi (${code}).`;

        if (code === "error.youtube.bot_check") {
          state = "platform_blocked";
          msg = "Cobalt YouTube bot tekshiruvidan o'tolmadi ('Sign in to confirm you’re not a bot').";
        } else if (code === "error.instagram.auth_required") {
          state = "platform_blocked";
          msg = "Cobalt Instagram autentifikatsiya chekloviga duch keldi.";
        } else if (code === "error.twitter.guest_token_locked") {
          state = "platform_blocked";
          msg = "Cobalt Twitter/X da video topa olmadi (Guest token yopiq).";
        }

        return {
          success: false,
          bytes: 0,
          state,
          error: msg,
          rawDetails: JSON.stringify(data.error),
        };
      }

      return {
        success: false,
        bytes: 0,
        state: "provider_failed",
        error: "Cobalt kutilmagan javob qaytardi.",
      };
    } catch (e: any) {
      return {
        success: false,
        bytes: 0,
        state: "provider_failed",
        error: `Cobalt ichki servisi bilan bog'lanishda xatolik: ${e.message}`,
      };
    }
  }
}
