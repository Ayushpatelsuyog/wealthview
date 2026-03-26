import { NextRequest, NextResponse } from 'next/server';
import { cacheGet, cacheSet } from '@/lib/utils/price-cache';
import type { MFNavData } from '@/app/api/mf/nav/route';

const NAV_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

async function fetchBatchNavs(codes: string[], nocache: boolean): Promise<Record<string, MFNavData | null>> {
  const results: Record<string, MFNavData | null> = {};
  const uncached: string[] = [];

  for (const code of codes) {
    if (!nocache) {
      const cached = cacheGet<MFNavData>(`mf_nav_${code}`);
      if (cached) { results[code] = cached; continue; }
    }
    uncached.push(code);
  }

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
        cacheSet(`mf_nav_${code}`, data, NAV_CACHE_TTL);
        results[code] = data;
      } catch {
        results[code] = null;
      }
    }));
  }

  return results;
}

export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get('scheme_codes') ?? '').trim();
  if (!raw) return NextResponse.json({ error: 'scheme_codes required' }, { status: 400 });

  const codes = raw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 50);
  if (codes.length === 0) return NextResponse.json({ results: {} });

  const nocache = req.nextUrl.searchParams.get('nocache') === '1';
  const results = await fetchBatchNavs(codes, nocache);
  return NextResponse.json({ results });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const schemeCodes: string[] = body?.scheme_codes ?? [];
    if (!Array.isArray(schemeCodes) || schemeCodes.length === 0) {
      return NextResponse.json({ error: 'scheme_codes array required' }, { status: 400 });
    }

    const codes = schemeCodes.map(s => String(s).trim()).filter(Boolean).slice(0, 50);
    if (codes.length === 0) return NextResponse.json({ results: {} });

    const nocache = body?.nocache === true;
    const results = await fetchBatchNavs(codes, nocache);
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
}
