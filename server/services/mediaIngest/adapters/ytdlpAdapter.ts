import fs from "node:fs";
import path from "node:path";
import { BaseMediaAdapter, AdapterResult } from "./baseAdapter.js";
import { MediaPlatform, IngestJobState } from "../types.js";
import { execAsync, sanitizeLogOutput } from "../audioVerifier.js";

export class YtDlpAdapter extends BaseMediaAdapter {
  readonly name = "YtDlpAdapter";
  private binaryPath: string;

  constructor() {
    super();
    this.binaryPath = path.resolve(process.cwd(), "bin", "yt-dlp");
  }

  canHandle(url: string, platform: MediaPlatform): boolean {
    return ["youtube", "instagram", "tiktok", "twitter"].includes(platform);
  }

  async fetchMedia(url: string, destinationPath: string): Promise<AdapterResult> {
    const val = this.validateUrl(url);
    if (!val.valid) {
      return { success: false, bytes: 0, state: "source_unavailable", error: val.reason };
    }

    if (!fs.existsSync(this.binaryPath)) {
      return {
        success: false,
        bytes: 0,
        state: "provider_failed",
        error: "yt-dlp binary fayli serverda topilmadi.",
      };
    }

    // Use yt-dlp with node js-runtime, audio-first selector, direct file output
    const args = [
      "--no-warnings",
      "--no-playlist",
      "--js-runtimes", "node:/usr/local/bin/node",
      "-f", "ba/b/bestaudio/best",
      "--ffmpeg-location", "/usr/bin/ffmpeg",
      "--max-filesize", "80M",
      "-o", destinationPath,
      url.trim(),
    ];

    const { stdout, stderr, code } = await execAsync(this.binaryPath, args, 35000);
    const combinedOutput = sanitizeLogOutput(`${stderr}\n${stdout}`);

    // Check if the destination file exists and is non-empty
    let actualFilePath = destinationPath;
    if (!fs.existsSync(actualFilePath) || fs.statSync(actualFilePath).size === 0) {
      // Sometimes yt-dlp appends .mp4, .webm, or .m4a to the output
      const dir = path.dirname(destinationPath);
      const baseName = path.basename(destinationPath, path.extname(destinationPath));
      const candidates = fs.readdirSync(dir).filter((f) => f.startsWith(baseName) && !f.endsWith(".mp3"));
      if (candidates.length > 0) {
        const found = path.resolve(dir, candidates[0]);
        if (fs.statSync(found).size > 0) {
          fs.copyFileSync(found, destinationPath);
          try { fs.unlinkSync(found); } catch (e) {}
          actualFilePath = destinationPath;
        }
      }
    }

    const fileExists = fs.existsSync(actualFilePath) && fs.statSync(actualFilePath).size > 0;

    if (!fileExists) {
      const { state, humanReason } = this.classifyYtDlpError(combinedOutput);
      return {
        success: false,
        bytes: 0,
        state,
        error: humanReason,
        rawDetails: combinedOutput.slice(0, 350),
      };
    }

    const bytes = fs.statSync(actualFilePath).size;
    return {
      success: true,
      bytes,
      state: "media_ready",
      rawDetails: "yt-dlp direct media download succeeded",
    };
  }

  private classifyYtDlpError(output: string): { state: IngestJobState; humanReason: string } {
    if (/Sign in to confirm you’re not a bot/i.test(output)) {
      return {
        state: "platform_blocked",
        humanReason:
          "YouTube ushbu videoni to'g'ridan-to'g'ri yuklashni chekladi (Google Cloud IP anti-bot 'Sign in to confirm you’re not a bot' cheklovi). Diktorning asl ovozini so'zma-so'z o'zbekchaga o'girish uchun, iltimos, MP4 yoki MP3 faylni yuklang.",
      };
    }

    if (/empty media response|is not granting access/i.test(output)) {
      return {
        state: "platform_blocked",
        humanReason:
          "Instagram ushbu Reel videosini server orqali yuklashni chekladi (Meta avtorizatsiya talabi). Diktorning asl ovozini so'zma-so'z o'zbekchaga o'girish uchun MP4 faylni yuklang.",
      };
    }

    if (/No video could be found in this tweet/i.test(output)) {
      return {
        state: "platform_blocked",
        humanReason:
          "X / Twitter ushbu postida video topilmadi yoki Twitter guest-token API cheklangan. Video mavjud bo'lgan post havolasini kiriting yoki MP4 faylni yuklang.",
      };
    }

    if (/Video unavailable|Private video|This video has been removed/i.test(output)) {
      return {
        state: "source_unavailable",
        humanReason: "Ushbu video o'chirilgan, yopiq (private) yoki mavjud emas.",
      };
    }

    if (/Unexpected response from webpage request/i.test(output)) {
      return {
        state: "platform_blocked",
        humanReason: "Platforma server so'rovlarini chekladi (Anti-scraping challenge). MP4 faylni yuklang.",
      };
    }

    return {
      state: "provider_failed",
      humanReason: "Yuklab olishda noma'lum xatolik yuz berdi. Iltimos, MP4 yoki MP3 faylni to'g'ridan-to'g'ri yuklang.",
    };
  }
}
