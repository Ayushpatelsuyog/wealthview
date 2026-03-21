import { NextRequest, NextResponse } from 'next/server';
import { cacheGet, cacheSet, cacheAge, cacheClear, TTL } from '@/lib/utils/price-cache';

export interface ForexRate {
  pair: string;
  base: string;
  quote: string;
  rate: number;
  change24h: number;
  changePct24h: number;
  source: 'simulated';
}

const BASE_RATES: Array<{ pair: string; base: string; quote: string; rate: number }> = [
  { pair: 'USD/INR', base: 'USD', quote: 'INR', rate: 83.87 },
  { pair: 'EUR/INR', base: 'EUR', quote: 'INR', rate: 91.42 },
  { pair: 'GBP/INR', base: 'GBP', quote: 'INR', rate: 106.85 },
  { pair: 'JPY/INR', base: 'JPY', quote: 'INR', rate:  0.5621 },
  { pair: 'AED/INR', base: 'AED', quote: 'INR', rate: 22.84 },
  { pair: 'SGD/INR', base: 'SGD', quote: 'INR', rate: 63.27 },
  { pair: 'CAD/INR', base: 'CAD', quote: 'INR', rate: 61.54 },
  { pair: 'AUD/INR', base: 'AUD', quote: 'INR', rate: 54.18 },
];

const CACHE_KEY = 'forex_rates';

function addForexNoise(base: number): { rate: number; change24h: number; changePct24h: number } {
  const seed = Math.floor(Date.now() / TTL.FOREX);
  const pseudoRandom = Math.sin(seed * base) * 0.004; // ±0.4%
  const change24h = parseFloat((base * pseudoRandom).toFixed(4));
  const rate = parseFloat((base + change24h).toFixed(4));
  const changePct24h = parseFloat(((change24h / base) * 100).toFixed(3));
  return { rate, change24h, changePct24h };
}

export async function GET(req: NextRequest) {
  const force = req.nextUrl.searchParams.get('force') === '1';
  if (force) cacheClear(CACHE_KEY);

  const cached = cacheGet<ForexRate[]>(CACHE_KEY);
  if (cached) {
    return NextResponse.json({ rates: cached, cachedAgo: cacheAge(CACHE_KEY), fromCache: true });
  }

  const rates: ForexRate[] = BASE_RATES.map((r) => ({
    ...r, ...addForexNoise(r.rate), source: 'simulated',
  }));

  cacheSet(CACHE_KEY, rates, TTL.FOREX);
  return NextResponse.json({ rates, cachedAgo: 0, fromCache: false });
}
