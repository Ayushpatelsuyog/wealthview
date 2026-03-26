import { NextRequest, NextResponse } from 'next/server';
import { POPULAR_MF_LIST } from '@/lib/data/mf-list';

interface MFScheme { schemeCode: number; schemeName: string }

function deriveCategory(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('elss') || n.includes('tax saver') || n.includes('tax saving')) return 'ELSS';
  if (n.includes('liquid') || n.includes('overnight') || n.includes('money market')) return 'Liquid';
  if (n.includes('gilt') || n.includes('g-sec') || n.includes('gsec')) return 'Gilt';
  if (n.includes('index') || n.includes('nifty') || n.includes('sensex') || n.includes(' etf')) return 'Index/ETF';
  if (n.includes('debt') || n.includes(' bond') || n.includes('corporate bond') || n.includes('credit risk') || n.includes('banking and psu') || n.includes('banking & psu') || n.includes('income fund')) return 'Debt';
  if (n.includes('hybrid') || n.includes('balanced') || n.includes('multi asset') || n.includes('arbitrage') || n.includes('aggressive hybrid')) return 'Hybrid';
  return 'Equity';
}

/**
 * Match a scheme name against a query.
 * Strategy:
 *   1. If name contains the full query as a substring → best match (score 2)
 *   2. If name contains ALL individual words of the query → good match (score 1)
 * Case-insensitive throughout.
 */
function matchScore(schemeName: string, lower: string, words: string[]): number {
  const n = schemeName.toLowerCase();
  if (n.includes(lower)) return 2;
  if (words.length > 1 && words.every(w => n.includes(w))) return 1;
  return 0;
}

function searchList(list: MFScheme[], lower: string, words: string[]): MFScheme[] {
  return list
    .map(f => ({ f, s: matchScore(f.schemeName, lower, words) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 10)
    .map(x => x.f);
}

// ── Module-level persistent cache ──────────────────────────────────────────────
const AMFI_REFRESH_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
let amfiList: MFScheme[] = [];
let fetchState: 'idle' | 'fetching' | 'done' | 'failed' = 'idle';
let fetchPromise: Promise<void> | null = null;
let lastFetchedAt = 0;

async function fetchAmfiWithRetry(): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`[MF Search] Attempt ${attempt}/3: Fetching full AMFI scheme list from mfapi.in…`);
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 30_000); // 30s timeout
    try {
      const res = await fetch('https://api.mfapi.in/mf', { signal: controller.signal });
      clearTimeout(tid);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: unknown = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        amfiList = data as MFScheme[];
        fetchState = 'done';
        lastFetchedAt = Date.now();
        console.log(`AMFI cache: ${amfiList.length} schemes loaded`);
        console.log(`[MF Search] ✓ Cached ${amfiList.length} AMFI schemes (attempt ${attempt})`);
        return;
      }
      throw new Error('Empty or invalid response');
    } catch (err) {
      clearTimeout(tid);
      console.error(`[MF Search] Attempt ${attempt}/3 failed:`, (err as Error).message);
      if (attempt < 3) {
        console.log('[MF Search] Retrying in 5 seconds…');
        await new Promise(r => setTimeout(r, 5_000));
      }
    }
  }
  // All retries exhausted
  fetchState = 'failed';
  fetchPromise = null;
  console.error(`[MF Search] ✗ All 3 attempts failed — falling back to local list (${POPULAR_MF_LIST.length} schemes)`);
}

function ensureListFetched(): Promise<void> {
  // Refresh after 24h even if previously succeeded
  if (fetchState === 'done' && Date.now() - lastFetchedAt > AMFI_REFRESH_INTERVAL) {
    console.log('[MF Search] AMFI cache is 24h old — scheduling background refresh…');
    fetchState = 'idle';
    fetchPromise = null;
  }
  if (fetchState === 'done') return Promise.resolve();
  if (fetchState === 'fetching' && fetchPromise) return fetchPromise;
  fetchState = 'fetching';
  fetchPromise = fetchAmfiWithRetry().finally(() => { fetchPromise = null; });
  return fetchPromise;
}

// Kick off background fetch immediately on module load
ensureListFetched();

// ── Route handler ──────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  if (q.length < 2) return NextResponse.json({ results: [] });

  const lower = q.toLowerCase();
  const words = lower.split(/\s+/).filter(w => w.length >= 2);

  // ── 1. If AMFI list already in memory, search immediately ─────────────────
  if (amfiList.length > 0) {
    const results = searchList(amfiList, lower, words)
      .map(f => ({ schemeCode: f.schemeCode, schemeName: f.schemeName, category: deriveCategory(f.schemeName) }));
    console.log(`[MF Search] AMFI (${amfiList.length} schemes): "${q}" → ${results.length} results`);
    return NextResponse.json({ results });
  }

  // ── 2. List not ready — wait up to 8 s for the background fetch ───────────
  try {
    await Promise.race([
      ensureListFetched(),
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error('timeout')), 8_000)),
    ]);
  } catch { /* fall through */ }

  if (amfiList.length > 0) {
    const results = searchList(amfiList, lower, words)
      .map(f => ({ schemeCode: f.schemeCode, schemeName: f.schemeName, category: deriveCategory(f.schemeName) }));
    console.log(`[MF Search] AMFI (after wait): "${q}" → ${results.length} results`);
    return NextResponse.json({ results });
  }

  // ── 3. Try dedicated mfapi search endpoint ────────────────────────────────
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 6_000);
    const res = await fetch(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
    clearTimeout(tid);
    if (res.ok) {
      const data: unknown = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const results = (data as MFScheme[]).slice(0, 10).map(f => ({
          schemeCode: f.schemeCode,
          schemeName: f.schemeName,
          category: deriveCategory(f.schemeName),
        }));
        console.log(`[MF Search] mfapi search endpoint: "${q}" → ${results.length} results`);
        return NextResponse.json({ results });
      }
    }
  } catch (err) {
    console.error('[MF Search] mfapi search endpoint failed:', (err as Error).message);
  }

  // ── 4. Final fallback: bundled local popular funds list ───────────────────
  const localResults = searchList(POPULAR_MF_LIST, lower, words)
    .map(f => ({ schemeCode: f.schemeCode, schemeName: f.schemeName, category: deriveCategory(f.schemeName) }));
  console.log(`[MF Search] Local list (offline): "${q}" → ${localResults.length} results`);
  return NextResponse.json({ results: localResults, offline: localResults.length === 0 || undefined });
}
