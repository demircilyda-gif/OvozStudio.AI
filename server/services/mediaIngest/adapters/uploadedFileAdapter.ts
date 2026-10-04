import fs from "node:fs";
import { IngestJobState } from "../types.js";

export class UploadedFileAdapter {
  readonly name = "UploadedFileAdapter";

  async processUpload(
    base64Data: string,
    destinationPath: string
  ): Promise<{ success: boolean; bytes: number; state: IngestJobState; error?: string }> {
    try {
      const buffer = Buffer.from(base64Data, "base64");
      if (buffer.length < 500) {
        return {
          success: false,
          bytes: buffer.length,
          state: "provider_failed",
          error: "Yuklangan fayl bo'sh yoki shikastlangan (hajmi 0 bayt).",
        };
      }

      if (buffer.length > 85 * 1024 * 1024) {
        return {
          success: false,
          bytes: buffer.length,
          state: "provider_failed",
          error: "Yuklangan fayl hajmi 80 MB limitidan oshib ketdi.",
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
        error: `Faylni saqlashda xatolik: ${err.message}`,
      };
    }
  }
}
