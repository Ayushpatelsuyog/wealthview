import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getDashboardSnapshot } from '@/lib/services/portfolio-service';
import { cacheGet, cacheSet, cacheClear } from '@/lib/utils/price-cache';
import type { DashboardSnapshot } from '@/lib/types/dashboard';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();

    if (authErr || !user) {
      return NextResponse.json({ hasRealData: false, error: 'Unauthorized' }, { status: 401 });
    }

    const forceRefresh = req.nextUrl.searchParams.get('force') === '1';
    const cacheKey = `dashboard:${user.id}`;

    if (forceRefresh) cacheClear(cacheKey);

    const cached = cacheGet<DashboardSnapshot>(cacheKey);
    if (cached) return NextResponse.json(cached);

    const snapshot = await getDashboardSnapshot();
    cacheSet(cacheKey, snapshot, CACHE_TTL_MS);

    return NextResponse.json(snapshot);
  } catch (err) {
    console.error('[api/dashboard]', err);
    return NextResponse.json({ hasRealData: false, error: 'Internal server error' }, { status: 500 });
  }
}
