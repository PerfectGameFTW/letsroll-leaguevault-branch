import { createLogger } from '../logger';
import { isDev } from '../config';

const log = createLogger("Cache");

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    let cleared = 0;
    for (const [key, entry] of store) {
      if (now >= entry.expiresAt) {
        store.delete(key);
        cleared++;
      }
    }
    if (cleared > 0) {
      if (isDev) log.info(`Evicted ${cleared} expired cache entries, ${store.size} remaining`);
    }
  }, 60_000);
  cleanupTimer.unref();
}

export function cacheGet<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() >= entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.data as T;
}

export function cacheSet<T>(key: string, data: T, ttlMs: number): void {
  ensureCleanup();
  store.set(key, { data, expiresAt: Date.now() + ttlMs });
}

export function cacheInvalidate(pattern: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(pattern)) {
      store.delete(key);
    }
  }
}

export async function cacheFetch<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const cached = cacheGet<T>(key);
  if (cached !== undefined) return cached;
  const data = await fetcher();
  cacheSet(key, data, ttlMs);
  return data;
}
