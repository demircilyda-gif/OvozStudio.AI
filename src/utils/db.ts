/**
 * IndexedDB storage utility for PodkastUz
 * Replaces localStorage to store heavy WAV audio base64 buffers (which easily exceed 5MB limit).
 */
import { CMSPodcastItem } from '../components/PodcastCMS';

const DB_NAME = 'podkast_uz_db';
const DB_VERSION = 1;
const STORE_PODCASTS = 'podcasts';

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
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
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
