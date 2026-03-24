import { NextRequest, NextResponse } from 'next/server';
import { cacheGet, cacheSet } from '@/lib/utils/price-cache';
import type { StockPriceData } from '@/app/api/stocks/price/route';

function isMarketOpen(): boolean {
  const now = new Date();
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const istMinutes = (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) % 1440;
  return istMinutes >= 9 * 60 + 15 && istMinutes < 15 * 60 + 30;
}

async function fetchYahooPrice(symbol: string): Promise<StockPriceData | null> {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json',
  };
  for (const host of ['query1', 'query2']) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 8_000);
      const res = await fetch(
        `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}.NS?interval=1d&range=1d`,
        { headers, signal: controller.signal },
      );
      clearTimeout(tid);
      if (!res.ok) continue;
      const json = await res.json();
      const meta = json?.chart?.result?.[0]?.meta;
      const price = meta?.regularMarketPrice;
      if (!price || price <= 0) continue;
      return {
        symbol,
        price:     Math.round(price * 100) / 100,
        change:    Math.round((meta.regularMarketChange ?? 0) * 100) / 100,
        changePct: Math.round((meta.regularMarketChangePercent ?? 0) * 100) / 100,
        dayHigh:   Math.round((meta.regularMarketDayHigh  ?? price) * 100) / 100,
        dayLow:    Math.round((meta.regularMarketDayLow   ?? price) * 100) / 100,
        volume:    meta.regularMarketVolume ?? 0,
        lastUpdated: new Date().toISOString(),
      };
    } catch { /* try next */ }
  }
  return null;
}

export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get('symbols') ?? '').trim();
  if (!raw) return NextResponse.json({ error: 'symbols required' }, { status: 400 });

  const symbols = raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 30);
  if (symbols.length === 0) return NextResponse.json({ results: {} });

  const nocache = req.nextUrl.searchParams.get('nocache') === '1';
  const ttl = isMarketOpen() ? 5 * 60 * 1000 : 6 * 60 * 60 * 1000;
  const results: Record<string, StockPriceData | null> = {};
  const uncached: string[] = [];

  for (const sym of symbols) {
    if (!nocache) {
      const cached = cacheGet<StockPriceData>(`stock_price_${sym}`);
      if (cached) { results[sym] = cached; continue; }
    }
    uncached.push(sym);
  }

  if (uncached.length > 0) {
    await Promise.allSettled(uncached.map(async (sym) => {
      const data = await fetchYahooPrice(sym);
      if (data) cacheSet(`stock_price_${sym}`, data, ttl);
      results[sym] = data;
    }));
  }

  return NextResponse.json({ results });
}
