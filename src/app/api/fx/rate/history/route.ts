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
  THBINR: 2.50,
  MYRINR: 19.50,
  CNYINR: 11.80,
  CNHINR: 11.80,
};

async function fetchYahooFxHistory(from: string, to: string, range = '2y'): Promise<FxHistoryData | null> {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
  };

  const pair = `${from}${to}=X`;

  for (const host of ['query1', 'query2']) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 10_000);
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${pair}?interval=1d&range=${range}`;
      const res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(tid);
      if (!res.ok) continue;

      const json = await res.json();
      const result = json?.chart?.result?.[0];
      if (!result) continue;

      const timestamps: number[] = result.timestamp ?? [];
      const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];

      if (timestamps.length === 0 || closes.length === 0) continue;

      console.log(`[FX History] ${from}/${to}: ${timestamps.length} data points from ${host} (range=${range})`);
      return { timestamps, closes };
    } catch (err) {
      console.warn(`[FX History] Yahoo (${host}) error for ${pair}:`, (err as Error).message);
    }
  }
  return null;
}

/**
 * Fetch FX history for a specific date window using period1/period2 (for dates beyond 2y range).
 */
async function fetchYahooFxHistoryForDate(from: string, to: string, targetDate: Date): Promise<FxHistoryData | null> {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
  };

  const pair = `${from}${to}=X`;
  // 7-day window around the target date (handles weekends/holidays)
  const period1 = Math.floor(targetDate.getTime() / 1000) - (7 * 86400);
  const period2 = Math.floor(targetDate.getTime() / 1000) + (7 * 86400);

  for (const host of ['query1', 'query2']) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 10_000);
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${pair}?interval=1d&period1=${period1}&period2=${period2}`;
      const res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(tid);
      if (!res.ok) continue;

      const json = await res.json();
      const result = json?.chart?.result?.[0];
      if (!result) continue;

      const timestamps: number[] = result.timestamp ?? [];
      const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];

      if (timestamps.length === 0 || closes.length === 0) continue;

      console.log(`[FX History] ${from}/${to}: ${timestamps.length} data points for date ${targetDate.toISOString().split('T')[0]} from ${host}`);
      return { timestamps, closes };
    } catch (err) {
      console.warn(`[FX History] Yahoo (${host}) error for ${pair} date-specific:`, (err as Error).message);
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

  const targetMs = parsed.getTime();
  const nowMs = Date.now();
  const twoYearsMs = 2 * 365 * 24 * 60 * 60 * 1000;
  const isWithin2y = (nowMs - targetMs) < twoYearsMs;

  let rate: number | null = null;

  if (isWithin2y) {
    // Use cached 2y history for recent dates
    const cacheKey = `fx_history_${from}_${to}`;
    let history = cacheGet<FxHistoryData>(cacheKey);

    if (!history) {
      history = await fetchYahooFxHistory(from, to);
      if (history) {
        cacheSet(cacheKey, history, 6 * 60 * 60 * 1000);
      }
    }

    if (history) {
      rate = findClosestRate(history.timestamps, history.closes, dateStr);
    }
  }

  if (rate == null) {
    // Date beyond 2y range or not found in cached data — fetch specific date window
    const dateCacheKey = `fx_date_${from}_${to}_${dateStr}`;
    const cachedRate = cacheGet<number>(dateCacheKey);

    if (cachedRate != null) {
      rate = cachedRate;
    } else {
      const dateHistory = await fetchYahooFxHistoryForDate(from, to, parsed);
      if (dateHistory) {
        rate = findClosestRate(dateHistory.timestamps, dateHistory.closes, dateStr);
        if (rate != null) {
          // Cache date-specific result for 24h
          cacheSet(dateCacheKey, rate, 24 * 60 * 60 * 1000);
        }
      }
    }
  }

  // Cross-rate via USD if direct pair not available
  if (rate == null && from !== 'USD' && to !== 'USD') {
    const [fromHistory, toHistory] = await Promise.all([
      isWithin2y ? fetchYahooFxHistory(from, 'USD') : fetchYahooFxHistoryForDate(from, 'USD', parsed),
      isWithin2y ? fetchYahooFxHistory('USD', to) : fetchYahooFxHistoryForDate('USD', to, parsed),
    ]);
    if (fromHistory && toHistory) {
      const fromRate = findClosestRate(fromHistory.timestamps, fromHistory.closes, dateStr);
      const toRate = findClosestRate(toHistory.timestamps, toHistory.closes, dateStr);
      if (fromRate && toRate) {
        rate = Math.round(fromRate * toRate * 10000) / 10000;
        console.log(`[FX History] Cross-rate ${from}→USD→${to} on ${dateStr}: ${fromRate} × ${toRate} = ${rate}`);
      }
    }
  }

  if (rate != null) {
    return NextResponse.json({ from, to, date: dateStr, rate });
  }

  // Fallback to hardcoded rate
  const pairKey = `${from}${to}`;
  const fallbackRate = FALLBACK_RATES[pairKey];
  if (fallbackRate) {
    console.warn(`[FX History] Using fallback rate for ${pairKey} on ${dateStr}: ${fallbackRate}`);
    return NextResponse.json({ from, to, date: dateStr, rate: fallbackRate });
  }

  return NextResponse.json({
    error:   'rate_unavailable',
    message: `No FX rate found for ${from}/${to} on or near ${dateStr}`,
  });
}
