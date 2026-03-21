import { NextRequest, NextResponse } from 'next/server';
import { cacheGet, cacheSet, cacheAge, cacheClear, TTL } from '@/lib/utils/price-cache';

const DEFAULT_SCHEMES = [
  { schemeCode: 120503, name: 'Mirae Asset Large Cap Fund - Direct Growth' },
  { schemeCode: 119598, name: 'Axis Bluechip Fund - Direct Growth' },
  { schemeCode: 120716, name: 'Parag Parikh Flexi Cap Fund - Direct Growth' },
  { schemeCode: 118989, name: 'HDFC Mid-Cap Opportunities Fund - Direct Growth' },
  { schemeCode: 120828, name: 'SBI Small Cap Fund - Direct Growth' },
  { schemeCode: 119775, name: 'ICICI Prudential Equity & Debt Fund - Direct Growth' },
  { schemeCode: 101206, name: 'HDFC Short Term Debt Fund - Direct Growth' },
  { schemeCode: 120837, name: 'Nippon India Liquid Fund - Direct Growth' },
];

interface MFApiResponse {
  meta: { scheme_name: string; scheme_category: string; scheme_type: string };
  data: Array<{ date: string; nav: string }>;
  status: string;
}

interface MFPrice {
  schemeCode: number;
  name: string;
  nav: number;
  date: string;
  category: string;
  source: 'mfapi.in';
  cachedAgo: number | null;
}

const CACHE_KEY = 'mf_prices';

export async function GET(req: NextRequest) {
  const force = req.nextUrl.searchParams.get('force') === '1';
  if (force) cacheClear(CACHE_KEY);

  const cached = cacheGet<MFPrice[]>(CACHE_KEY);
  if (cached) {
    return NextResponse.json({ prices: cached, cachedAgo: cacheAge(CACHE_KEY), fromCache: true });
  }

  const results: MFPrice[] = [];

  await Promise.allSettled(
    DEFAULT_SCHEMES.map(async ({ schemeCode, name }) => {
      try {
        const res = await fetch(`https://api.mfapi.in/mf/${schemeCode}/latest`, {
          next: { revalidate: 86400 },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: MFApiResponse = await res.json();
        const nav = parseFloat(json.data[0]?.nav ?? '0');
        results.push({
          schemeCode,
          name: json.meta?.scheme_name ?? name,
          nav,
          date: json.data[0]?.date ?? '',
          category: json.meta?.scheme_category ?? '',
          source: 'mfapi.in',
          cachedAgo: null,
        });
      } catch {
        results.push({ schemeCode, name, nav: 0, date: '', category: '', source: 'mfapi.in', cachedAgo: null });
      }
    })
  );

  cacheSet(CACHE_KEY, results, TTL.MF);
  return NextResponse.json({ prices: results, cachedAgo: 0, fromCache: false });
}
