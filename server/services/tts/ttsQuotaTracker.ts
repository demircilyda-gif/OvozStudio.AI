import fs from "fs";
import path from "path";

const DATA_DIR = path.resolve(process.cwd(), "data");
const QUOTA_FILE = path.join(DATA_DIR, "tts-quota.json");
const DAILY_LIMIT = Number(process.env.GEMINI_TTS_DAILY_LIMIT || 100);

interface QuotaStore {
  /** Pacific Time date key (YYYY-MM-DD), resets at 00:00 PT = 12:00/13:00 Tashkent */
  dayKey: string;
  used: number;
  lastUpdatedAt: string;
}

/**
 * Google AI Studio daily quotas reset at midnight Pacific Time (~13:00 Tashkent winter / 12:00 summer).
 */
function getCurrentQuotaDayKey(): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function readQuotaStore(): QuotaStore {
  const today = getCurrentQuotaDayKey();
  try {
    if (fs.existsSync(QUOTA_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(QUOTA_FILE, "utf8"));
      if (parsed && parsed.dayKey === today && typeof parsed.used === "number") {
        return {
          dayKey: today,
          used: Math.max(0, Math.floor(parsed.used)),
          lastUpdatedAt: parsed.lastUpdatedAt || new Date().toISOString(),
        };
      }
    }
  } catch {}
  return { dayKey: today, used: 0, lastUpdatedAt: new Date().toISOString() };
}

function writeQuotaStore(store: QuotaStore): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(QUOTA_FILE, JSON.stringify(store, null, 2), "utf8");
  } catch {}
}

export function getTtsQuotaStatus(): {
  limit: number;
  used: number;
  remaining: number;
  dayKey: string;
  resetLabelRu: string;
  resetLabelUz: string;
} {
  const store = readQuotaStore();
  const remaining = Math.max(0, DAILY_LIMIT - store.used);
  return {
    limit: DAILY_LIMIT,
    used: store.used,
    remaining,
    dayKey: store.dayKey,
    resetLabelRu: "после 13:00 по Ташкенту",
    resetLabelUz: "Toshkent vaqti bilan 13:00 dan keyin",
  };
}

export function recordGoogleTtsCalls(count: number = 1): {
  limit: number;
  used: number;
  remaining: number;
} {
  const safeAdd = Math.max(0, Math.floor(count));
  const store = readQuotaStore();
  store.used += safeAdd;
  store.lastUpdatedAt = new Date().toISOString();
  writeQuotaStore(store);
  return {
    limit: DAILY_LIMIT,
    used: store.used,
    remaining: Math.max(0, DAILY_LIMIT - store.used),
  };
}

export function markGoogleTtsQuotaExhaustedToday(): void {
  const store = readQuotaStore();
  store.used = Math.max(store.used, DAILY_LIMIT);
  store.lastUpdatedAt = new Date().toISOString();
  writeQuotaStore(store);
}
