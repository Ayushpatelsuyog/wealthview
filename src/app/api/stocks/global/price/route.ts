import { NextRequest, NextResponse } from 'next/server';
import { cacheGet, cacheSet, cacheClear } from '@/lib/utils/price-cache';
import { normalizeSubUnit } from '@/lib/utils/currency';

interface GlobalStockPriceData {
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
  const day = now.getUTCDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false;
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  // ET = UTC - 5h = UTC - 300 min
  const etMinutes = ((utcMinutes - 300) % 1440 + 1440) % 1440;
  // 9:30 AM = 570 min, 4:00 PM = 960 min
  return etMinutes >= 570 && etMinutes < 960;
}

function cacheTTL(): number {
  return isUSMarketOpen() ? 15 * 60 * 1000 : 6 * 60 * 60 * 1000;
}

async function fetchGlobalYahooPrice(symbol: string): Promise<GlobalStockPriceData | null> {
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
      if (!res.ok) {
        console.warn(`[Global Stock Price] Yahoo (${host}) HTTP ${res.status} for ${symbol}`);
        continue;
      }

      const json = await res.json();
      const result = json?.chart?.result?.[0];
      if (!result) continue;

      const meta  = result.meta;
      const price = meta?.regularMarketPrice;
      if (!price || price <= 0) continue;

      const rawCurrency = meta?.currency ?? 'USD';
      const { currency: normalizedCurrency, divisor } = normalizeSubUnit(rawCurrency);

      // Convert sub-unit prices (e.g., pence → pounds)
      const adjPrice = price / divisor;
      const prevClose = (meta.chartPreviousClose ?? meta.regularMarketPreviousClose ?? 0) / divisor;
      const change = divisor > 1
        ? (prevClose > 0 ? adjPrice - prevClose : 0)
        : (meta.regularMarketChange ?? (prevClose > 0 ? adjPrice - prevClose : 0));
      const changePct = divisor > 1
        ? (prevClose > 0 ? ((adjPrice - prevClose) / prevClose) * 100 : 0)
        : (meta.regularMarketChangePercent ?? (prevClose > 0 ? ((adjPrice - prevClose) / prevClose) * 100 : 0));
      if (divisor > 1) console.log(`[Global Stock Price] ${symbol}: converted ${rawCurrency} ${price} → ${normalizedCurrency} ${adjPrice.toFixed(2)}`);
      console.log(`[Global Stock Price] ${symbol} from ${host}: ${normalizedCurrency} ${adjPrice.toFixed(2)} (chg: ${change.toFixed(2)})`);
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
    } catch (err) {
      console.warn(`[Global Stock Price] Yahoo (${host}) error for ${symbol}:`, (err as Error).message);
    }
  }
  return null;
}

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get('symbol') ?? '').trim().toUpperCase();
  if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 });

  const nocache = req.nextUrl.searchParams.get('nocache') === '1';
  const cacheKey = `global_stock_price_${symbol}`;

  if (!nocache) {
    const cached = cacheGet<GlobalStockPriceData>(cacheKey);
    if (cached) return NextResponse.json(cached);
  } else {
    cacheClear(cacheKey);
  }

  const data = await fetchGlobalYahooPrice(symbol);

  if (!data) {
    console.error(`[Global Stock Price] All sources failed for ${symbol}`);
    return NextResponse.json({
      error: 'price_unavailable',
      message: `Live price unavailable for ${symbol}. Yahoo Finance may be temporarily unavailable.`,
    });
  }

  cacheSet(cacheKey, data, cacheTTL());
  return NextResponse.json(data);
}
