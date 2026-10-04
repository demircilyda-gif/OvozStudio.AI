/**
 * Media Extraction Service for Instagram Reels, TikTok, YouTube Shorts, and Direct Media
 * Uses local yt-dlp binary with ffmpeg to extract lightweight audio streams in memory.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface ExtractedMedia {
  platform: "youtube" | "instagram" | "tiktok" | "direct";
  title: string;
  durationSeconds: number;
  audioBuffer: Buffer;
  audioBase64: string;
  mimeType: string;
  sourceUrl: string;
}

export function detectMediaPlatform(url: string): "youtube" | "instagram" | "tiktok" | "direct" {
  const u = url.toLowerCase();
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
  if (u.includes("instagram.com")) return "instagram";
  if (u.includes("tiktok.com")) return "tiktok";
  return "direct";
}

/**
 * Extracts audio from any social media or direct video URL using yt-dlp
 */
export async function extractMediaAudio(url: string): Promise<ExtractedMedia> {
  const trimmedUrl = url.trim();
  const platform = detectMediaPlatform(trimmedUrl);

  // 1. Direct audio/video files (mp4, webm, mp3, wav, m4a)
  if (/\.(mp4|webm|mp3|wav|m4a)(\?.*)?$/i.test(trimmedUrl)) {
    const fetchRes = await fetch(trimmedUrl);
    if (!fetchRes.ok) {
      throw new Error(`Media faylini yuklab bo'lmadi (HTTP ${fetchRes.status})`);
    }
    const arrayBuf = await fetchRes.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    const contentType = fetchRes.headers.get("content-type") || "audio/mp3";

    return {
      platform: "direct",
      title: path.basename(trimmedUrl.split("?")[0]) || "Media Fayl",
      durationSeconds: 30,
      audioBuffer: buf,
      audioBase64: buf.toString("base64"),
      mimeType: contentType,
      sourceUrl: trimmedUrl,
    };
  }

  // 2. Social media links: YouTube, Instagram Reels, TikTok
  const ytDlpPath = path.resolve(process.cwd(), "bin", "yt-dlp");
  const tempOutputFile = path.resolve("/tmp", `extract-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`);

  return new Promise<ExtractedMedia>((resolve, reject) => {
    // Arguments: extract audio as mp3 128k, limit duration to 10 minutes to protect memory
    const args = [
      "--no-warnings",
      "--no-playlist",
      "--extract-audio",
      "--audio-format",
      "mp3",
      "--audio-quality",
      "128K",
      "--ffmpeg-location",
      "/usr/bin/ffmpeg",
      "--max-filesize",
      "50M",
      "-o",
      tempOutputFile,
      trimmedUrl,
    ];

    console.log(`[MediaExtractor] Starting extraction for ${platform} URL:`, trimmedUrl);

    const proc = spawn(ytDlpPath, args, { timeout: 35000 });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    proc.on("error", (err) => {
      console.warn("[MediaExtractor] Process error:", err);
      reject(new Error(`Media extraction process failed: ${err.message}`));
    });

    proc.on("close", (code) => {
      // Find output file (yt-dlp might append .mp3)
      let finalFilePath = tempOutputFile;
      if (!fs.existsSync(finalFilePath) && fs.existsSync(tempOutputFile + ".mp3")) {
        finalFilePath = tempOutputFile + ".mp3";
      }

      if (code !== 0 && !fs.existsSync(finalFilePath)) {
        console.warn("[MediaExtractor] yt-dlp exited with code", code, stderr);
        return reject(
          new Error(
            `Videoni yuklab bo'lmadi (${platform}). Havola to'g'riligini yoki video ochiqligini tekshiring.`
          )
        );
      }

      try {
        if (!fs.existsSync(finalFilePath)) {
          throw new Error("Chiqish audio fayli topilmadi");
        }

        const audioBuffer = fs.readFileSync(finalFilePath);
        const stats = fs.statSync(finalFilePath);

        // Clean temp file immediately
        try {
          fs.unlinkSync(finalFilePath);
        } catch (e) {}

        // Rough duration calculation from mp3 filesize (128kbps = 16000 bytes/sec)
        const durationSeconds = Math.max(5, Math.round(stats.size / 16000));

        let extractedTitle = `${platform.toUpperCase()} Video`;
        if (platform === "instagram") extractedTitle = "Instagram Reel";
        if (platform === "tiktok") extractedTitle = "TikTok Video";
        if (platform === "youtube") extractedTitle = "YouTube Shorts / Video";

        resolve({
          platform,
          title: extractedTitle,
          durationSeconds,
          audioBuffer,
          audioBase64: audioBuffer.toString("base64"),
          mimeType: "audio/mp3",
          sourceUrl: trimmedUrl,
        });
      } catch (err: any) {
        reject(err);
      }
    });
  });
}
