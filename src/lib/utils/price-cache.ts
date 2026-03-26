type CacheEntry<T> = { data: T; fetchedAt: number; ttlMs: number };

const store = new Map<string, CacheEntry<unknown>>();

export const TTL = {
  STOCKS:  15 * 60 * 1000,   // 15 min
  CRYPTO:  60      * 1000,   // 60 s
  MF:      15 * 60 * 1000,   // 15 min
  FOREX:   30 * 60 * 1000,   // 30 min
};

export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > entry.ttlMs) { store.delete(key); return null; }
  return entry.data;
}

export function cacheSet<T>(key: string, data: T, ttlMs: number): void {
  store.set(key, { data, fetchedAt: Date.now(), ttlMs });
}

export function cacheAge(key: string): number | null {
  const entry = store.get(key);
  if (!entry) return null;
  return Math.floor((Date.now() - entry.fetchedAt) / 1000);
}

export function cacheClear(key: string): void {
  store.delete(key);
}
