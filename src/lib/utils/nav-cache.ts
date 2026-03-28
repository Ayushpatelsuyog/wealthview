// Client-side NAV cache — module-level, survives route navigations within a session
const NAV_CACHE = new Map<string, { nav: number; navDate: string; previousNav: number | null; fetchedAt: number }>();
const NAV_TTL_MS = 15 * 60 * 1000; // 15 minutes

export function navCacheGet(schemeCode: string): { nav: number; navDate: string; previousNav: number | null } | null {
  const entry = NAV_CACHE.get(schemeCode);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > NAV_TTL_MS) { NAV_CACHE.delete(schemeCode); return null; }
  return { nav: entry.nav, navDate: entry.navDate, previousNav: entry.previousNav };
}

export function navCacheSet(schemeCode: string, nav: number, navDate: string, previousNav?: number | null): void {
  NAV_CACHE.set(schemeCode, { nav, navDate, previousNav: previousNav ?? null, fetchedAt: Date.now() });
}

export function navCacheDelete(schemeCode: string): void {
  NAV_CACHE.delete(schemeCode);
}

export function navCacheClearAll(): void {
  NAV_CACHE.clear();
}
