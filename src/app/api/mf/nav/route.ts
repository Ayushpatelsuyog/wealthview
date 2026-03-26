import { NextRequest, NextResponse } from 'next/server';
import { cacheGet, cacheSet, cacheClear } from '@/lib/utils/price-cache';

export interface MFNavData {
  schemeCode: number;
  fundName: string;
  fundHouse: string;
  category: string;
  nav: number;
  navDate: string;   // raw "DD-MM-YYYY" from mfapi.in
}

export async function GET(req: NextRequest) {
  const sc = req.nextUrl.searchParams.get('scheme_code');
  if (!sc) return NextResponse.json({ error: 'scheme_code required' }, { status: 400 });

  const nocache = req.nextUrl.searchParams.get('nocache') === '1';
  const cacheKey = `mf_nav_${sc}`;
  if (!nocache) {
    const cached = cacheGet<MFNavData>(cacheKey);
    if (cached) return NextResponse.json(cached);
  } else {
    cacheClear(cacheKey);
  }

  try {
    const res = await fetch(`https://api.mfapi.in/mf/${sc}/latest`, {
      next: { revalidate: 86400 },
    });
    if (!res.ok) throw new Error(`mfapi.in HTTP ${res.status}`);
    const json = await res.json();
    if (json.status !== 'SUCCESS' || !json.data?.length) {
      return NextResponse.json({ error: 'Scheme not found or no NAV data' }, { status: 404 });
    }

    const result: MFNavData = {
      schemeCode: parseInt(sc),
      fundName: json.meta?.scheme_name ?? '',
      fundHouse: json.meta?.fund_house ?? '',
      category: json.meta?.scheme_category ?? '',
      nav: parseFloat(json.data[0].nav),
      navDate: json.data[0].date,
    };

    cacheSet(cacheKey, result, 15 * 60 * 1000); // 15 minutes
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
