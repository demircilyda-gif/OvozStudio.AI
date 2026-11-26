/**
 * IndexedDB storage utility for PodkastUz
 * Replaces localStorage to store heavy WAV audio base64 buffers (which easily exceed 5MB limit).
 */
import { CMSPodcastItem } from '../components/PodcastCMS';

const DB_NAME = 'podkast_uz_db';
const DB_VERSION = 2;
const STORE_PODCASTS = 'podcasts';
const STORE_TURN_AUDIO = 'dialogue_turn_audio';

export interface CachedDialogueTurnAudio {
  cacheKey: string;
  projectKey: string;
  turnId: string;
  contentHash: string;
  audioBase64: string;
  durationSeconds?: number;
  originalDurationSec?: number;
  dubbedDurationSec?: number;
  atempoApplied?: number;
  rephraseAttempts?: number;
  fitStepApplied?: string;
  syncStatus?: 'ok' | 'adjusted' | 'overflow';
  qa?: 'ok' | 'retried' | 'failed';
  qaReason?: string;
  slicingMethod?: string;
  shiftedStartBySec?: number;
  needsShorten?: boolean;
  subBlockIndex?: number;
  startTime?: number;
  endTime?: number;
  savedAt: number;
}

/**
 * Deterministic 64-bit dual FNV-1a hash for turn cache invalidation
 * keyed by (text, voice, style). Works in both browser and Node tests.
 */
export function computeTurnAudioHash(params: {
  text: string;
  voiceKey: string;
  styleKey: string;
}): string {
  const payload = `${params.text.trim()}\u001f${params.voiceKey.trim()}\u001f${params.styleKey.trim()}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < payload.length; i++) {
    const ch = payload.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch + (i & 0xff);
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const part2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `${part1}${part2}`;
}

export function buildTurnAudioCacheKey(
  projectKey: string,
  turnId: string,
  contentHash: string
): string {
  return `${projectKey}::${turnId}::${contentHash}`;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB not supported in this environment'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_PODCASTS)) {
        db.createObjectStore(STORE_PODCASTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_TURN_AUDIO)) {
        const turnStore = db.createObjectStore(STORE_TURN_AUDIO, { keyPath: 'cacheKey' });
        turnStore.createIndex('by_project', 'projectKey', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveDialogueTurnAudioBatch(
  entries: CachedDialogueTurnAudio[]
): Promise<void> {
  if (!entries || entries.length === 0) return;
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_TURN_AUDIO, 'readwrite');
      const store = tx.objectStore(STORE_TURN_AUDIO);
      for (const entry of entries) {
        if (entry.cacheKey && entry.audioBase64) {
          store.put(entry);
        }
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    });
  } catch (err) {
    console.warn('Failed to persist dialogue turn audio batch to IndexedDB:', err);
  }
}

export async function getDialogueTurnAudioByKeys(
  cacheKeys: string[]
): Promise<Map<string, CachedDialogueTurnAudio>> {
  const result = new Map<string, CachedDialogueTurnAudio>();
  if (!cacheKeys || cacheKeys.length === 0) return result;
  try {
    const db = await openDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_TURN_AUDIO, 'readonly');
      const store = tx.objectStore(STORE_TURN_AUDIO);
      let pending = cacheKeys.length;

      const finish = () => {
        pending -= 1;
        if (pending <= 0) resolve(result);
      };

      for (const key of cacheKeys) {
        const req = store.get(key);
        req.onsuccess = () => {
          if (req.result && req.result.audioBase64) {
            result.set(key, req.result as CachedDialogueTurnAudio);
          }
          finish();
        };
        req.onerror = () => finish();
      }

      tx.onerror = () => resolve(result);
      tx.onabort = () => resolve(result);
    });
  } catch (err) {
    console.warn('Failed to load dialogue turn audio from IndexedDB:', err);
    return result;
  }
}

export async function clearProjectTurnAudioFromDb(projectKey: string): Promise<void> {
  if (!projectKey) return;
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_TURN_AUDIO, 'readwrite');
      const store = tx.objectStore(STORE_TURN_AUDIO);
      const index = store.index('by_project');
      const range = IDBKeyRange.only(projectKey);
      const cursorReq = index.openCursor(range);
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('Failed to clear project turn audio from IndexedDB:', err);
  }
}

export async function getAllPodcastsFromDb(): Promise<CMSPodcastItem[]> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PODCASTS, 'readonly');
      const store = tx.objectStore(STORE_PODCASTS);
      const request = store.getAll();

      request.onsuccess = () => {
        resolve(request.result || []);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.warn('Falling back from IndexedDB to localStorage:', err);
    try {
      const fallback = localStorage.getItem('podkast_uz_library_v2');
      return fallback ? JSON.parse(fallback) : [];
    } catch {
      return [];
    }
  }
}

export async function savePodcastToDb(item: CMSPodcastItem): Promise<void> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PODCASTS, 'readwrite');
      const store = tx.objectStore(STORE_PODCASTS);
      const request = store.put(item);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('Failed to save podcast to IndexedDB:', err);
  }
}

export async function deletePodcastFromDb(id: string): Promise<void> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PODCASTS, 'readwrite');
      const store = tx.objectStore(STORE_PODCASTS);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('Failed to delete podcast from IndexedDB:', err);
  }
}
