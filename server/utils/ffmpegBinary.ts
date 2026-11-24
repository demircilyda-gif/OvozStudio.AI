import fs from "fs";
import { execFileSync } from "child_process";
import ffmpegStatic from "ffmpeg-static";

let cachedFfmpegPath: string | null | undefined = undefined;
let cachedRubberbandSupport: Map<string, boolean> = new Map();

function ensureExecutable(candidate: string): boolean {
  try {
    if (!fs.existsSync(candidate)) return false;
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
    } catch {
      try {
        fs.chmodSync(candidate, 0o755);
      } catch {}
    }
    return true;
  } catch {
    return false;
  }
}

function probeRubberbandForBinary(binPath: string): boolean {
  if (cachedRubberbandSupport.has(binPath)) {
    return cachedRubberbandSupport.get(binPath)!;
  }
  try {
    const out = execFileSync(binPath, ["-hide_banner", "-filters"], {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const supported = /\brubberband\b/.test(out);
    cachedRubberbandSupport.set(binPath, supported);
    return supported;
  } catch {
    cachedRubberbandSupport.set(binPath, false);
    return false;
  }
}

/**
 * Resolves a working ffmpeg executable path across both local dev containers
 * and minimal Cloud Run production images (where /usr/bin/ffmpeg may not be installed).
 *
 * Priority:
 * 1. FFMPEG_PATH env override
 * 2. Bundled `ffmpeg-static` binary from node_modules (travels with every deployment)
 * 3. System /usr/bin/ffmpeg
 * 4. System /usr/local/bin/ffmpeg
 */
export function resolveFfmpegPath(): string | null {
  if (cachedFfmpegPath !== undefined) {
    return cachedFfmpegPath;
  }

  const candidates = [
    process.env.FFMPEG_PATH,
    typeof ffmpegStatic === "string" ? ffmpegStatic : null,
    "/usr/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
  ].filter((p): p is string => Boolean(p && p.trim()));

  for (const candidate of candidates) {
    if (ensureExecutable(candidate)) {
      cachedFfmpegPath = candidate;
      return cachedFfmpegPath;
    }
  }

  cachedFfmpegPath = null;
  return null;
}

/**
 * Resolves the best available ffmpeg binary for pitch shifting:
 * prefers a binary with `rubberband` support (avoids chipmunk formants),
 * and cleanly falls back to the standard resolved binary (ffmpeg-static / system ffmpeg).
 */
export function resolvePitchShiftFfmpeg(): {
  binPath: string | null;
  hasRubberband: boolean;
} {
  const candidates = [
    process.env.FFMPEG_PATH,
    "/usr/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    typeof ffmpegStatic === "string" ? ffmpegStatic : null,
  ].filter((p): p is string => Boolean(p && p.trim()));

  const existing: string[] = [];
  for (const c of candidates) {
    if (!existing.includes(c) && ensureExecutable(c)) {
      existing.push(c);
    }
  }

  for (const bin of existing) {
    if (probeRubberbandForBinary(bin)) {
      return { binPath: bin, hasRubberband: true };
    }
  }

  const fallback = resolveFfmpegPath();
  return {
    binPath: fallback,
    hasRubberband: fallback ? probeRubberbandForBinary(fallback) : false,
  };
}

export function isFfmpegAvailable(): boolean {
  return Boolean(resolveFfmpegPath());
}
