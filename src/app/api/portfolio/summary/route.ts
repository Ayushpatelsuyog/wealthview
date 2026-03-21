import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get family_id
  const { data: profile } = await supabase
    .from('users')
    .select('family_id')
    .eq('id', user.id)
    .single();

  // Fetch all MF holdings (RLS scopes to user's family via portfolios)
  const { data: holdings, error: holdingsErr } = await supabase
    .from('holdings')
    .select('quantity, avg_buy_price, metadata')
    .eq('asset_type', 'mutual_fund');

  if (holdingsErr) {
    return NextResponse.json({ error: holdingsErr.message }, { status: 500 });
  }

  const list = holdings ?? [];
  const totalHoldings = list.length;
  const hasHoldings = totalHoldings > 0;

  // invested = quantity × avg_buy_price (the original NAV paid)
  const totalInvested = list.reduce(
    (sum, h) => sum + Number(h.quantity) * Number(h.avg_buy_price),
    0
  );

  // Use stored current_nav from metadata where available for a quick current value estimate
  const totalCurrentEst = list.reduce((sum, h) => {
    const currentNav = (h.metadata as Record<string, number>)?.current_nav;
    const nav = currentNav ?? Number(h.avg_buy_price);
    return sum + Number(h.quantity) * nav;
  }, 0);

  return NextResponse.json({
    hasHoldings,
    totalHoldings,
    totalInvested,
    totalCurrentEst,
    familyId: profile?.family_id ?? null,
  });
}
