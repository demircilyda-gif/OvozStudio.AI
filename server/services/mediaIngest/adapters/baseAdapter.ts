import { MediaPlatform, IngestJobState } from "../types.js";

export interface AdapterResult {
  success: boolean;
  bytes: number;
  state: IngestJobState;
  error?: string;
  rawDetails?: string;
  isStreamOnly?: boolean;
}

/**
 * Checks if a given hostname belongs to a private network, loopback, or cloud metadata endpoint.
 */
export function isPrivateOrInternalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    host === "metadata.google.internal" ||
    host === "metadata" ||
    host === "instance-data"
  ) {
    return true;
  }

  // IPv4 checks
  if (host === "0.0.0.0" || host.startsWith("127.")) {
    return true;
  }
  if (host.startsWith("10.") || host.startsWith("192.168.") || host.startsWith("169.254.")) {
    return true;
  }
  // 172.16.0.0/12 check (172.16.0.0 - 172.31.255.255)
  const match172 = host.match(/^172\.(\d{1,3})\./);
  if (match172) {
    const secondOctet = parseInt(match172[1], 10);
    if (secondOctet >= 16 && secondOctet <= 31) {
      return true;
    }
  }

  // IPv6 checks
  if (
    host === "::1" ||
    host === "::" ||
    host.startsWith("fe80:") ||
    host.startsWith("fc00:") ||
    host.startsWith("fd") ||
    host.startsWith("::ffff:127.") ||
    host.startsWith("::ffff:10.") ||
    host.startsWith("::ffff:192.168.")
  ) {
    return true;
  }

  return false;
}

/**
 * Validates if the given URL is a safe external HTTP/HTTPS URL (SSRF prevention).
 */
export function validateSafeUrl(url: string): { valid: boolean; reason?: string } {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { valid: false, reason: "Faqat HTTP/HTTPS protokollar qo'llab-quvvatlanadi." };
    }

    if (isPrivateOrInternalHost(parsed.hostname)) {
      return { valid: false, reason: "Xavfsizlik: Ichki tarmoq manzillariga ruxsat berilmaydi." };
    }

    return { valid: true };
  } catch {
    return { valid: false, reason: "Noto'g'ri URL formati." };
  }
}

export abstract class BaseMediaAdapter {
  abstract readonly name: string;

  /**
   * Validates if the given URL belongs to a supported domain and is safe (no SSRF).
   */
  protected validateUrl(url: string): { valid: boolean; reason?: string } {
    return validateSafeUrl(url);
  }

  abstract canHandle(url: string, platform: MediaPlatform): boolean;

  abstract fetchMedia(
    url: string,
    destinationPath: string
  ): Promise<AdapterResult>;
}
