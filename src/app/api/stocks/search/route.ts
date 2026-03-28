import { NextRequest, NextResponse } from 'next/server';
import { STOCKS_LIST, StockInfo } from '@/lib/data/stocks-list';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StockSearchResult {
  symbol: string;
  companyName: string;
  exchange: 'NSE';
  sector: string;
  industry: string;
  isin: string;
  bseCode: string;
}

interface NseStock {
  symbol: string;
  companyName: string;
  isin: string;
  series: string;
}

// ─── Dynamic NSE stock list (module-level cache) ─────────────────────────────

let nseStockList: NseStock[] | null = null;
let nseLastFetched = 0;
const NSE_TTL = 24 * 60 * 60 * 1000; // 24 hours
let nseFetchInProgress: Promise<NseStock[]> | null = null;

const NSE_CSV_URLS = [
  'https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv',
  'https://www1.nseindia.com/content/equities/EQUITY_L.csv',
];

const NSE_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Referer': 'https://www.nseindia.com/',
};

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { fields.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  fields.push(current.trim());
  return fields;
}

async function fetchNseEquityList(): Promise<NseStock[]> {
  for (const url of NSE_CSV_URLS) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 15_000);
      const res = await fetch(url, { headers: NSE_HEADERS, signal: controller.signal });
      clearTimeout(tid);
      if (!res.ok) continue;

      const text = await res.text();
      const lines = text.split('\n').map(l => l.replace(/\r$/, ''));
      if (lines.length < 2) continue;

      // Parse header to find column indices
      const header = parseCsvLine(lines[0]).map(h => h.toUpperCase().trim());
      const symbolIdx  = header.findIndex(h => h === 'SYMBOL');
      const nameIdx    = header.findIndex(h => h.includes('NAME'));
      const seriesIdx  = header.findIndex(h => h === 'SERIES');
      const isinIdx    = header.findIndex(h => h.includes('ISIN'));

      if (symbolIdx === -1 || nameIdx === -1) continue;

      const stocks: NseStock[] = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const fields = parseCsvLine(line);
        const symbol = fields[symbolIdx]?.trim();
        const name = fields[nameIdx]?.trim();
        const series = seriesIdx >= 0 ? fields[seriesIdx]?.trim() : 'EQ';
        const isin = isinIdx >= 0 ? fields[isinIdx]?.trim() : '';

        if (!symbol || !name) continue;
        // Only include equity series (EQ, BE, BZ) — skip bonds/debentures
        if (series && !['EQ', 'BE', 'BZ', 'SM', 'ST', ''].includes(series)) continue;

        stocks.push({ symbol, companyName: name, isin, series });
      }

      if (stocks.length > 100) {
        console.log(`[NSE Stock List] ✓ ${stocks.length} stocks loaded from ${url}`);
        return stocks;
      }
    } catch (err) {
      console.warn(`[NSE Stock List] Failed to fetch from ${url}:`, (err as Error).message);
    }
  }

  console.warn('[NSE Stock List] All NSE sources failed, using hardcoded fallback');
  return [];
}

async function getNseStocks(): Promise<NseStock[]> {
  // Return cached if fresh
  if (nseStockList && Date.now() - nseLastFetched < NSE_TTL) {
    return nseStockList;
  }

  // Deduplicate concurrent fetches
  if (nseFetchInProgress) return nseFetchInProgress;

  nseFetchInProgress = (async () => {
    try {
      const stocks = await fetchNseEquityList();
      if (stocks.length > 0) {
        nseStockList = stocks;
        nseLastFetched = Date.now();
        return stocks;
      }
    } catch { /* fallback below */ }
    // If fetch failed but we have stale data, keep using it
    if (nseStockList) return nseStockList;
    return [];
  })();

  try {
    return await nseFetchInProgress;
  } finally {
    nseFetchInProgress = null;
  }
}

// ─── Sector lookup from hardcoded list ───────────────────────────────────────

const hardcodedMap = new Map<string, StockInfo>();
for (const s of STOCKS_LIST) {
  hardcodedMap.set(s.symbol, s);
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

interface Candidate {
  symbol: string;
  companyName: string;
  isin: string;
  sector: string;
  industry: string;
  bseCode: string;
}

function buildCandidates(nseStocks: NseStock[]): Candidate[] {
  const seen = new Set<string>();
  const candidates: Candidate[] = [];

  // NSE dynamic list first
  for (const s of nseStocks) {
    seen.add(s.symbol);
    const hc = hardcodedMap.get(s.symbol);
    candidates.push({
      symbol: s.symbol,
      companyName: s.companyName,
      isin: s.isin || hc?.isin || '',
      sector: hc?.sector || '',
      industry: hc?.industry || '',
      bseCode: hc?.bseCode || '',
    });
  }

  // Add any hardcoded stocks not in NSE list (shouldn't happen, but safety)
  for (const s of STOCKS_LIST) {
    if (!seen.has(s.symbol)) {
      seen.add(s.symbol);
      candidates.push({
        symbol: s.symbol,
        companyName: s.companyName,
        isin: s.isin,
        sector: s.sector,
        industry: s.industry,
        bseCode: s.bseCode,
      });
    }
  }

  return candidates;
}

function score(stock: Candidate, q: string, lower: string, words: string[]): number {
  const sym  = stock.symbol.toLowerCase();
  const name = stock.companyName.toLowerCase();

  if (sym === lower)                         return 100;
  if (stock.bseCode === q)                   return 95;
  if (sym.startsWith(lower))                 return 80;
  if (name.startsWith(lower))                return 70;
  if (sym.includes(lower))                   return 60;
  if (name.includes(lower))                  return 50;
  // Multi-word: all words must appear in name or symbol
  if (words.length > 1 && words.every(w => name.includes(w) || sym.includes(w))) return 40;
  // Single word partial match in company name words
  if (words.length === 1 && name.split(/\s+/).some(part => part.startsWith(lower))) return 35;
  return 0;
}

// ─── Yahoo Finance fallback search (catches ETFs, new IPOs, etc.) ────────────

async function yahooSearchNSE(query: string): Promise<StockSearchResult[]> {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
  };
  for (const host of ['query2', 'query1']) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 6_000);
      const url = `https://${host}.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&lang=en-US&region=IN&quotesCount=10&newsCount=0&enableFuzzyQuery=true`;
      const res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(tid);
      if (!res.ok) continue;
      const json = await res.json();
      const quotes = json?.quotes ?? [];
      const results: StockSearchResult[] = [];
      for (const q of quotes) {
        if (!q.symbol || !q.quoteType) continue;
        if (q.quoteType !== 'EQUITY' && q.quoteType !== 'ETF') continue;
        // Only NSE/BSE — skip international
        if (q.exchange !== 'NSI' && q.exchange !== 'BSE' && q.exchange !== 'BOM') continue;
        // Strip .NS / .BO suffix for the symbol we store
        const sym = q.symbol.replace(/\.(NS|BO)$/, '');
        results.push({
          symbol: sym,
          companyName: q.longname || q.shortname || sym,
          exchange: 'NSE',
          sector: q.sectorDisp ?? '',
          industry: q.industryDisp ?? '',
          isin: '',
          bseCode: '',
        });
      }
      if (results.length > 0) return results;
    } catch { /* try next host */ }
  }
  return [];
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  if (q.length < 1) return NextResponse.json({ results: [] });

  const nseStocks = await getNseStocks();
  const candidates = buildCandidates(nseStocks);

  const lower = q.toLowerCase();
  const words = lower.split(/\s+/).filter(w => w.length >= 1);
  const isBseCode = /^\d{4,6}$/.test(q);

  const scored = candidates
    .map(s => ({ ...s, _score: score(s, q, lower, words) }))
    .filter(s => {
      if (s._score > 0) return true;
      if (isBseCode && s.bseCode.startsWith(q)) return true;
      return false;
    })
    .sort((a, b) => b._score - a._score)
    .slice(0, 10)
    .map(({ _score: _, ...s }): StockSearchResult => ({
      symbol: s.symbol,
      companyName: s.companyName,
      exchange: 'NSE',
      sector: s.sector,
      industry: s.industry,
      isin: s.isin,
      bseCode: s.bseCode,
    }));

  // If local list has few/no results, try Yahoo Finance as fallback (catches ETFs, new IPOs)
  if (scored.length < 3) {
    try {
      const yahooResults = await yahooSearchNSE(q);
      // Merge: add Yahoo results that aren't already in scored
      const seenSymbols = new Set(scored.map(s => s.symbol));
      for (const yr of yahooResults) {
        if (!seenSymbols.has(yr.symbol)) {
          scored.push(yr);
          seenSymbols.add(yr.symbol);
        }
      }
    } catch { /* Yahoo fallback failed, return what we have */ }
  }

  return NextResponse.json({ results: scored.slice(0, 10) });
}
