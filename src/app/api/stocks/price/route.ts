import { NextRequest, NextResponse } from 'next/server';
import { cacheGet, cacheSet, cacheClear } from '@/lib/utils/price-cache';

export interface StockPriceData {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  dayHigh: number;
  dayLow: number;
  volume: number;
  lastUpdated: string;
}

// NSE market hours: 9:15 AM – 3:30 PM IST (Mon–Fri)
// IST = UTC+5:30 = UTC+330 minutes
function isMarketOpen(): boolean {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false;
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const istMinutes = (utcMinutes + 330) % 1440;
  return istMinutes >= 9 * 60 + 15 && istMinutes < 15 * 60 + 30;
}

function cacheTTL(): number {
  return isMarketOpen() ? 15 * 60 * 1000 : 6 * 60 * 60 * 1000; // 15 min market hours, 6h after
}

async function fetchFromYahoo(symbol: string): Promise<StockPriceData | null> {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
  };

  for (const host of ['query1', 'query2']) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 8_000);
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}.NS?interval=1d&range=1d`;
      const res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(tid);
      if (!res.ok) {
        console.warn(`[Stock Price] Yahoo (${host}) HTTP ${res.status} for ${symbol}`);
        continue;
      }

      const json = await res.json();
      const result = json?.chart?.result?.[0];
      if (!result) continue;

      const meta  = result.meta;
      const price = meta?.regularMarketPrice;
      if (!price || price <= 0) continue;

      console.log(`[Stock Price] ✓ ${symbol} from ${host}: ₹${price}`);
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
    } catch (err) {
      console.warn(`[Stock Price] Yahoo (${host}) error for ${symbol}:`, (err as Error).message);
    }
  }
  return null;
}

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get('symbol') ?? '').toUpperCase().trim();
  if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 });

  const nocache = req.nextUrl.searchParams.get('nocache') === '1';
  const cacheKey = `stock_price_${symbol}`;

  if (!nocache) {
    const cached = cacheGet<StockPriceData>(cacheKey);
    if (cached) return NextResponse.json(cached);
  } else {
    cacheClear(cacheKey);
  }

  const data = await fetchFromYahoo(symbol);

  if (!data) {
    console.error(`[Stock Price] ✗ All sources failed for ${symbol}`);
    return NextResponse.json({
      error: 'price_unavailable',
      message: `Live price unavailable for ${symbol}. Yahoo Finance may be temporarily unavailable.`,
    });
  }

  cacheSet(cacheKey, data, cacheTTL());
  return NextResponse.json(data);
}
