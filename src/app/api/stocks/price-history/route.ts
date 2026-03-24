import { NextRequest, NextResponse } from 'next/server';
import { cacheGet, cacheSet } from '@/lib/utils/price-cache';

interface HistoryData {
  timestamps: number[];
  closes: number[];
}

async function fetchYahooHistory(symbol: string): Promise<HistoryData | null> {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
  };

  for (const host of ['query1', 'query2']) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 10_000);
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}.NS?interval=1d&range=2y`;
      const res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(tid);
      if (!res.ok) continue;

      const json = await res.json();
      const result = json?.chart?.result?.[0];
      if (!result) continue;

      const timestamps: number[] = result.timestamp ?? [];
      const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];

      if (timestamps.length === 0 || closes.length === 0) continue;

      console.log(`[Stock History] ✓ ${symbol}: ${timestamps.length} candles from ${host}`);
      return { timestamps, closes };
    } catch (err) {
      console.warn(`[Stock History] Yahoo (${host}) error for ${symbol}:`, (err as Error).message);
    }
  }
  return null;
}

function findClosestPrice(timestamps: number[], closes: number[], targetDate: string): number | null {
  const targetMs = new Date(targetDate).getTime();
  let bestIdx  = -1;
  let bestDiff = Infinity;

  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (close == null || close <= 0) continue;
    const diff = Math.abs(timestamps[i] * 1000 - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx  = i;
    }
  }

  return bestIdx >= 0 ? Math.round(closes[bestIdx] * 100) / 100 : null;
}

export async function GET(req: NextRequest) {
  const symbol  = (req.nextUrl.searchParams.get('symbol') ?? '').toUpperCase().trim();
  const dateStr = req.nextUrl.searchParams.get('date') ?? '';

  if (!symbol || !dateStr) {
    return NextResponse.json({ error: 'symbol and date required' }, { status: 400 });
  }

  const parsed = new Date(dateStr);
  if (isNaN(parsed.getTime())) {
    return NextResponse.json({ error: 'invalid date' }, { status: 400 });
  }

  // Cache full history per symbol (6h TTL — historical data changes rarely)
  const cacheKey = `stock_history_${symbol}`;
  let history = cacheGet<HistoryData>(cacheKey);

  if (!history) {
    history = await fetchYahooHistory(symbol);
    if (history) {
      cacheSet(cacheKey, history, 6 * 60 * 60 * 1000);
    }
  }

  if (!history) {
    return NextResponse.json({
      error:   'history_unavailable',
      message: `Could not fetch price history for ${symbol}. Yahoo Finance may be temporarily unavailable.`,
    });
  }

  const price = findClosestPrice(history.timestamps, history.closes, dateStr);
  if (!price) {
    return NextResponse.json({
      error:   'date_not_found',
      message: `No price data found for ${symbol} on or near ${dateStr}`,
    });
  }

  return NextResponse.json({ symbol, date: dateStr, price });
}
