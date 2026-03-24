import { NextRequest, NextResponse } from 'next/server';
import { cacheGet, cacheSet, TTL } from '@/lib/utils/price-cache';
import type { MFNavData } from '@/app/api/mf/nav/route';

export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get('scheme_codes') ?? '').trim();
  if (!raw) return NextResponse.json({ error: 'scheme_codes required' }, { status: 400 });

  const codes = raw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 50);
  if (codes.length === 0) return NextResponse.json({ results: {} });

  // Split into cached vs uncached
  const results: Record<string, MFNavData | null> = {};
  const uncached: string[] = [];

  for (const code of codes) {
    const cached = cacheGet<MFNavData>(`mf_nav_${code}`);
    if (cached) { results[code] = cached; } else { uncached.push(code); }
  }

  // Fetch uncached in parallel
  if (uncached.length > 0) {
    await Promise.allSettled(uncached.map(async (code) => {
      try {
        const res = await fetch(`https://api.mfapi.in/mf/${code}/latest`, {
          next: { revalidate: 86400 },
        });
        if (!res.ok) { results[code] = null; return; }
        const json = await res.json();
        if (json.status !== 'SUCCESS' || !json.data?.length) { results[code] = null; return; }
        const data: MFNavData = {
          schemeCode: parseInt(code),
          fundName:   json.meta?.scheme_name ?? '',
          fundHouse:  json.meta?.fund_house   ?? '',
          category:   json.meta?.scheme_category ?? '',
          nav:        parseFloat(json.data[0].nav),
          navDate:    json.data[0].date,
        };
        cacheSet(`mf_nav_${code}`, data, TTL.MF);
        results[code] = data;
      } catch {
        results[code] = null;
      }
    }));
  }

  return NextResponse.json({ results });
}
