// Client-side holdings cache — module-level, survives route navigations within a session
interface CacheEntry<T> { data: T; fetchedAt: number }

const HOLDINGS_TTL_MS = 2 * 60 * 1000; // 2 minutes

const holdingsStore = new Map<string, CacheEntry<unknown>>();

export function holdingsCacheGet<T>(key: string): T | null {
  const entry = holdingsStore.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > HOLDINGS_TTL_MS) { holdingsStore.delete(key); return null; }
  return entry.data;
}

export function holdingsCacheSet<T>(key: string, data: T): void {
  holdingsStore.set(key, { data, fetchedAt: Date.now() });
}

export function holdingsCacheClear(key: string): void {
  holdingsStore.delete(key);
}

export function holdingsCacheClearAll(): void {
  holdingsStore.clear();
}
