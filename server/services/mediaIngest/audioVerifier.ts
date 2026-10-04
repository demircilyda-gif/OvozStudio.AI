import { spawn } from "node:child_process";
import fs from "node:fs";
import { MediaStreamInspection } from "./types.js";

/**
 * Sanitizes command output and error logs by masking tokens, cookies, auth headers, and sigs.
 */
export function sanitizeLogOutput(text: string): string {
  if (!text) return "";
  return text
    .replace(/(sig|signature|token|key|cookie|sessionid|auth|bearer)=[^&\s]+/gi, "$1=[REDACTED]")
    .replace(/(--cookies|--cookies-from-browser)\s+[^\s]+/gi, "$1 [REDACTED]")
    .replace(/authorization:\s*bearer\s+[^\s\n]+/gi, "authorization: Bearer [REDACTED]");
}

/**
 * Runs an external command safely with timeout and output capture.
 */
export function execAsync(
  cmd: string,
  args: string[],
  timeoutMs = 40000
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const proc = spawn(cmd, args, { timeout: timeoutMs });

    proc.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    proc.on("error", (err) => {
      stderr += ` Process error: ${err.message}`;
      resolve({ stdout, stderr, code: -1 });
    });

    proc.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? -1 });
    });
  });
}

/**
 * Uses ffprobe to deeply inspect streams in a media file.
 */
export async function inspectMediaStreams(filePath: string): Promise<MediaStreamInspection> {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
    return {
      hasVideoStream: false,
      hasAudioStream: false,
      videoDuration: 0,
      audioDuration: 0,
      audioStartTime: 0,
      videoStartTime: 0,
      durationDelta: 0,
      isSilentTail: false,
      containerDuration: 0,
      containerSize: 0,
    };
  }

  const { stdout, code } = await execAsync("/usr/bin/ffprobe", [
    "-v", "error",
    "-show_entries", "stream=index,codec_type,codec_name,channels,sample_rate,start_time,duration:format=duration,size",
    "-of", "json",
    filePath,
  ]);

  if (code !== 0 || !stdout.trim()) {
    const size = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
    return {
      hasVideoStream: false,
      hasAudioStream: false,
      videoDuration: 0,
      audioDuration: 0,
      audioStartTime: 0,
      videoStartTime: 0,
      durationDelta: 0,
      isSilentTail: false,
      containerDuration: 0,
      containerSize: size,
    };
  }

  try {
    const data = JSON.parse(stdout);
    const streams = data.streams || [];
    const format = data.format || {};

    const videoStream = streams.find((s: any) => s.codec_type === "video");
    const audioStream = streams.find((s: any) => s.codec_type === "audio");

    const containerDuration = parseFloat(format.duration || "0") || 0;
    const containerSize = parseInt(format.size || "0", 10) || fs.statSync(filePath).size;

    const videoDuration = videoStream ? parseFloat(videoStream.duration || format.duration || "0") || 0 : 0;
    const audioDuration = audioStream ? parseFloat(audioStream.duration || format.duration || "0") || 0 : 0;

    const audioStartTime = audioStream ? parseFloat(audioStream.start_time || "0") || 0 : 0;
    const videoStartTime = videoStream ? parseFloat(videoStream.start_time || "0") || 0 : 0;

    const durationDelta = Math.abs(videoDuration - audioDuration);
    // Silent tail check: if video is longer than audio by > 0.4s
    const isSilentTail = videoDuration > audioDuration + 0.4;

    return {
      hasVideoStream: !!videoStream,
      hasAudioStream: !!audioStream,
      videoCodec: videoStream?.codec_name,
      videoDuration: Math.round(videoDuration * 1000) / 1000,
      audioCodec: audioStream?.codec_name,
      audioChannels: audioStream?.channels,
      audioSampleRate: audioStream?.sample_rate ? parseInt(audioStream.sample_rate, 10) : undefined,
      audioDuration: Math.round(audioDuration * 1000) / 1000,
      audioStartTime: Math.round(audioStartTime * 1000) / 1000,
      videoStartTime: Math.round(videoStartTime * 1000) / 1000,
      durationDelta: Math.round(durationDelta * 1000) / 1000,
      isSilentTail,
      containerDuration: Math.round(containerDuration * 1000) / 1000,
      containerSize,
    };
  } catch (e) {
    return {
      hasVideoStream: false,
      hasAudioStream: false,
      videoDuration: 0,
      audioDuration: 0,
      audioStartTime: 0,
      videoStartTime: 0,
      durationDelta: 0,
      isSilentTail: false,
      containerDuration: 0,
      containerSize: fs.statSync(filePath).size,
    };
  }
}

/**
 * Extracts a high-quality playable MP3 (128 kbps) for UI and STT processing via FFmpeg.
 */
export async function extractDecodedAudio(
  inputFilePath: string,
  outputMp3Path: string
): Promise<{ success: boolean; audioDuration: number; fileSize: number; error?: string }> {
  const res = await execAsync("/usr/bin/ffmpeg", [
    "-y",
    "-i", inputFilePath,
    "-vn",
    "-acodec", "libmp3lame",
    "-b:a", "128k",
    outputMp3Path,
  ]);

  if (!fs.existsSync(outputMp3Path) || fs.statSync(outputMp3Path).size === 0) {
    return {
      success: false,
      audioDuration: 0,
      fileSize: 0,
      error: sanitizeLogOutput(res.stderr || res.stdout).slice(0, 300),
    };
  }

  const inspection = await inspectMediaStreams(outputMp3Path);
  return {
    success: inspection.hasAudioStream,
    audioDuration: inspection.audioDuration || inspection.containerDuration,
    fileSize: inspection.containerSize,
  };
}
