import { NextRequest, NextResponse } from 'next/server';
import { cacheGet, cacheSet } from '@/lib/utils/price-cache';

interface FxHistoryData {
  timestamps: number[];
  closes: number[];
}

// Hardcoded fallback rates (approximate)
const FALLBACK_RATES: Record<string, number> = {
  USDINR: 85.50,
  EURINR: 93.00,
  GBPINR: 108.00,
  JPYINR: 0.57,
  HKDINR: 10.95,
  AUDINR: 56.00,
  SGDINR: 64.00,
  AEDINR: 23.30,
  CHFINR: 97.00,
  CADINR: 63.00,
  KRWINR: 0.062,
  DKKINR: 12.50,
  SEKINR: 8.20,
  NOKINR: 8.00,
  NZDINR: 51.00,
  ZARINR: 4.60,
  BRLINR: 16.80,
  MXNINR: 5.00,
  TWDINR: 2.70,
  CNYIN: 11.80,
};

async function fetchYahooFxHistory(from: string, to: string): Promise<FxHistoryData | null> {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
  };

  const pair = `${from}${to}=X`;

  for (const host of ['query1', 'query2']) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 10_000);
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${pair}?interval=1d&range=2y`;
      const res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(tid);
      if (!res.ok) continue;

      const json = await res.json();
      const result = json?.chart?.result?.[0];
      if (!result) continue;

      const timestamps: number[] = result.timestamp ?? [];
      const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];

      if (timestamps.length === 0 || closes.length === 0) continue;

      console.log(`[FX History] ${from}/${to}: ${timestamps.length} data points from ${host}`);
      return { timestamps, closes };
    } catch (err) {
      console.warn(`[FX History] Yahoo (${host}) error for ${pair}:`, (err as Error).message);
    }
  }
  return null;
}

function findClosestRate(timestamps: number[], closes: number[], targetDate: string): number | null {
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

  return bestIdx >= 0 ? Math.round(closes[bestIdx] * 10000) / 10000 : null;
}

export async function GET(req: NextRequest) {
  const from    = (req.nextUrl.searchParams.get('from') ?? '').trim().toUpperCase();
  const to      = (req.nextUrl.searchParams.get('to') ?? '').trim().toUpperCase();
  const dateStr = req.nextUrl.searchParams.get('date') ?? '';

  if (!from || !to || !dateStr) {
    return NextResponse.json({ error: 'from, to, and date required' }, { status: 400 });
  }

  // Same currency
  if (from === to) {
    return NextResponse.json({ from, to, date: dateStr, rate: 1 });
  }

  const parsed = new Date(dateStr);
  if (isNaN(parsed.getTime())) {
    return NextResponse.json({ error: 'invalid date' }, { status: 400 });
  }

  // Cache full history per pair (6h TTL)
  const cacheKey = `fx_history_${from}_${to}`;
  let history = cacheGet<FxHistoryData>(cacheKey);

  if (!history) {
    history = await fetchYahooFxHistory(from, to);
    if (history) {
      cacheSet(cacheKey, history, 6 * 60 * 60 * 1000);
    }
  }

  if (!history) {
    // Fallback to hardcoded rate
    const pairKey = `${from}${to}`;
    const fallbackRate = FALLBACK_RATES[pairKey];
    if (fallbackRate) {
      console.warn(`[FX History] Using fallback rate for ${pairKey}: ${fallbackRate}`);
      return NextResponse.json({ from, to, date: dateStr, rate: fallbackRate });
    }

    return NextResponse.json({
      error:   'history_unavailable',
      message: `Could not fetch FX history for ${from}/${to}. Yahoo Finance may be temporarily unavailable.`,
    });
  }

  const rate = findClosestRate(history.timestamps, history.closes, dateStr);
  if (!rate) {
    // Fallback
    const pairKey = `${from}${to}`;
    const fallbackRate = FALLBACK_RATES[pairKey];
    if (fallbackRate) {
      return NextResponse.json({ from, to, date: dateStr, rate: fallbackRate });
    }

    return NextResponse.json({
      error:   'date_not_found',
      message: `No FX rate found for ${from}/${to} on or near ${dateStr}`,
    });
  }

  return NextResponse.json({ from, to, date: dateStr, rate });
}
