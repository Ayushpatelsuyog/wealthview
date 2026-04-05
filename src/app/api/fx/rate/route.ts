import { NextRequest, NextResponse } from 'next/server';
import { cacheGet, cacheSet } from '@/lib/utils/price-cache';

export interface FxRateData {
  from: string;
  to: string;
  rate: number;
  lastUpdated: string;
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

async function fetchYahooFxRate(from: string, to: string): Promise<number | null> {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
  };

  const pair = `${from}${to}=X`;

  for (const host of ['query1', 'query2']) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 8_000);
      const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${pair}?interval=1d&range=1d`;
      const res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(tid);
      if (!res.ok) {
        console.warn(`[FX Rate] Yahoo (${host}) HTTP ${res.status} for ${pair}`);
        continue;
      }

      const json = await res.json();
      const result = json?.chart?.result?.[0];
      if (!result) continue;

      const rate = result.meta?.regularMarketPrice;
      if (!rate || rate <= 0) continue;

      console.log(`[FX Rate] ${from}/${to} from ${host}: ${rate}`);
      return Math.round(rate * 10000) / 10000;
    } catch (err) {
      console.warn(`[FX Rate] Yahoo (${host}) error for ${pair}:`, (err as Error).message);
    }
  }
  return null;
}

export async function GET(req: NextRequest) {
  const from = (req.nextUrl.searchParams.get('from') ?? '').trim().toUpperCase();
  const to   = (req.nextUrl.searchParams.get('to') ?? '').trim().toUpperCase();

  if (!from || !to) {
    return NextResponse.json({ error: 'from and to currency codes required' }, { status: 400 });
  }

  // Same currency — rate is 1
  if (from === to) {
    return NextResponse.json({ from, to, rate: 1, lastUpdated: new Date().toISOString() });
  }

  const cacheKey = `fx_rate_${from}_${to}`;
  const cached = cacheGet<FxRateData>(cacheKey);
  if (cached) return NextResponse.json(cached);

  let rate = await fetchYahooFxRate(from, to);

  // Try reverse pair (inverted) if direct pair not available
  if (!rate) {
    const reverse = await fetchYahooFxRate(to, from);
    if (reverse && reverse > 0) {
      rate = Math.round((1 / reverse) * 10000) / 10000;
      console.log(`[FX Rate] Using inverted ${to}/${from} for ${from}/${to}: 1/${reverse} = ${rate}`);
    }
  }

  // Cross-rate via USD if still not available
  if (!rate && from !== 'USD' && to !== 'USD') {
    // Try both directions for each leg
    const fromToUsd = await fetchYahooFxRate(from, 'USD') ?? await (async () => {
      const inv = await fetchYahooFxRate('USD', from);
      return inv && inv > 0 ? Math.round((1 / inv) * 10000) / 10000 : null;
    })();
    const usdToTarget = await fetchYahooFxRate('USD', to);
    if (fromToUsd && usdToTarget) {
      rate = Math.round(fromToUsd * usdToTarget * 10000) / 10000;
      console.log(`[FX Rate] Cross-rate ${from}→USD→${to}: ${fromToUsd} × ${usdToTarget} = ${rate}`);
    }
  }

  if (rate) {
    const data: FxRateData = { from, to, rate, lastUpdated: new Date().toISOString() };
    cacheSet(cacheKey, data, 30 * 60 * 1000); // 30 min cache
    return NextResponse.json(data);
  }

  // Fallback to hardcoded rates
  const pairKey = `${from}${to}`;
  const fallbackRate = FALLBACK_RATES[pairKey];
  if (fallbackRate) {
    console.warn(`[FX Rate] Using fallback rate for ${pairKey}: ${fallbackRate}`);
    const data: FxRateData = { from, to, rate: fallbackRate, lastUpdated: new Date().toISOString() };
    // Cache fallback for a shorter period (5 min) to retry sooner
    cacheSet(cacheKey, data, 5 * 60 * 1000);
    return NextResponse.json(data);
  }

  return NextResponse.json({
    error: 'rate_unavailable',
    message: `Exchange rate unavailable for ${from}/${to}. Yahoo Finance may be temporarily unavailable.`,
  });
}
