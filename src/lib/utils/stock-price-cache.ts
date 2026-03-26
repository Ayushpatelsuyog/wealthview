// Client-side stock price cache — module-level, survives route navigations within a session
const STOCK_CACHE = new Map<string, { price: number; fetchedAt: number }>();
const STOCK_TTL_MS = 15 * 60 * 1000; // 15 minutes

export function stockPriceCacheGet(symbol: string): number | null {
  const entry = STOCK_CACHE.get(symbol);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > STOCK_TTL_MS) { STOCK_CACHE.delete(symbol); return null; }
  return entry.price;
}

export function stockPriceCacheSet(symbol: string, price: number): void {
  STOCK_CACHE.set(symbol, { price, fetchedAt: Date.now() });
}

export function stockPriceCacheDelete(symbol: string): void {
  STOCK_CACHE.delete(symbol);
}

export function stockPriceCacheClearAll(): void {
  STOCK_CACHE.clear();
}
