import { NextRequest, NextResponse } from 'next/server';
import { cacheGet, cacheSet } from '@/lib/utils/price-cache';
import { normalizeSubUnit } from '@/lib/utils/currency';

export interface GlobalStockPriceData {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  previousClose: number;
  currency: string;
  dayHigh: number;
  dayLow: number;
  volume: number;
  lastUpdated: string;
}

// US market hours: 9:30 AM - 4:00 PM ET (Mon-Fri)
// Simplify: ET = UTC-5 always
function isUSMarketOpen(): boolean {
  const now = new Date();
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const etMinutes = ((utcMinutes - 300) % 1440 + 1440) % 1440;
  return etMinutes >= 570 && etMinutes < 960;
}

function cacheTTL(): number {
  return isUSMarketOpen() ? 15 * 60 * 1000 : 6 * 60 * 60 * 1000;
}

async function fetchYahooPrice(symbol: string): Promise<GlobalStockPriceData | null> {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
  };

  for (const host of ['query1', 'query2']) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 8_000);
      // Global stocks: do NOT append .NS — symbols are already in Yahoo format
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
      const res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(tid);
      if (!res.ok) continue;

      const json = await res.json();
      const result = json?.chart?.result?.[0];
      if (!result) continue;

      const meta  = result.meta;
      const price = meta?.regularMarketPrice;
      if (!price || price <= 0) continue;

      const rawCurrency = meta?.currency ?? 'USD';
      const { currency: normalizedCurrency, divisor } = normalizeSubUnit(rawCurrency);

      const adjPrice = price / divisor;
      const prevClose = (meta.chartPreviousClose ?? meta.regularMarketPreviousClose ?? 0) / divisor;
      const change = divisor > 1
        ? (prevClose > 0 ? adjPrice - prevClose : 0)
        : (meta.regularMarketChange ?? (prevClose > 0 ? adjPrice - prevClose : 0));
      const changePct = divisor > 1
        ? (prevClose > 0 ? ((adjPrice - prevClose) / prevClose) * 100 : 0)
        : (meta.regularMarketChangePercent ?? (prevClose > 0 ? ((adjPrice - prevClose) / prevClose) * 100 : 0));

      return {
        symbol,
        price:         Math.round(adjPrice * 100) / 100,
        change:        Math.round(change * 100) / 100,
        changePct:     Math.round(changePct * 100) / 100,
        previousClose: Math.round((prevClose || adjPrice) * 100) / 100,
        currency: normalizedCurrency,
        dayHigh:       Math.round((meta.regularMarketDayHigh  ?? price) * 100) / 100,
        dayLow:        Math.round((meta.regularMarketDayLow   ?? price) * 100) / 100,
        volume:        meta.regularMarketVolume ?? 0,
        lastUpdated:   new Date().toISOString(),
      };
    } catch { /* try next host */ }
  }
  return null;
}

async function fetchBatchPrices(symbols: string[], nocache: boolean): Promise<Record<string, GlobalStockPriceData | null>> {
  const ttl = cacheTTL();
  const results: Record<string, GlobalStockPriceData | null> = {};
  const uncached: string[] = [];

  for (const sym of symbols) {
    if (!nocache) {
      const cached = cacheGet<GlobalStockPriceData>(`global_stock_price_${sym}`);
      if (cached) { results[sym] = cached; continue; }
    }
    uncached.push(sym);
  }

  if (uncached.length > 0) {
    await Promise.allSettled(uncached.map(async (sym) => {
      const data = await fetchYahooPrice(sym);
      if (data) cacheSet(`global_stock_price_${sym}`, data, ttl);
      results[sym] = data;
    }));
  }

  return results;
}

export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get('symbols') ?? '').trim();
  if (!raw) return NextResponse.json({ error: 'symbols required' }, { status: 400 });

  const symbols = raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 50);
  if (symbols.length === 0) return NextResponse.json({ results: {} });

  const nocache = req.nextUrl.searchParams.get('nocache') === '1';
  const results = await fetchBatchPrices(symbols, nocache);
  return NextResponse.json({ results });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rawSymbols: string[] = body?.symbols ?? [];
    if (!Array.isArray(rawSymbols) || rawSymbols.length === 0) {
      return NextResponse.json({ error: 'symbols array required' }, { status: 400 });
    }

    const symbols = rawSymbols.map(s => String(s).trim().toUpperCase()).filter(Boolean).slice(0, 50);
    if (symbols.length === 0) return NextResponse.json({ results: {} });

    const nocache = body?.nocache === true;
    const results = await fetchBatchPrices(symbols, nocache);
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
}
