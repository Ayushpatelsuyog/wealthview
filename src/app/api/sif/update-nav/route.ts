import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { holdingId, currentNav, date } = await req.json();

  if (!holdingId || !currentNav || currentNav <= 0) {
    return NextResponse.json({ error: 'holdingId and valid currentNav are required' }, { status: 400 });
  }

  const navDate = date || new Date().toISOString().split('T')[0];

  // Fetch existing holding
  const { data: holding, error: fetchErr } = await supabase
    .from('holdings')
    .select('id, quantity, avg_buy_price, metadata')
    .eq('id', holdingId)
    .single();

  if (fetchErr || !holding) {
    return NextResponse.json({ error: 'Holding not found' }, { status: 404 });
  }

  const qty = Number(holding.quantity);
  const avgBuy = Number(holding.avg_buy_price);
  const invested = qty * avgBuy;
  const currentValue = qty * currentNav;
  const pnl = currentValue - invested;
  const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;

  // Update metadata with new NAV
  const updatedMetadata = {
    ...(holding.metadata as Record<string, unknown> ?? {}),
    current_nav: currentNav,
    nav_updated_at: new Date().toISOString(),
    nav_date: navDate,
    nav_source: 'manual',
  };

  const { error: updateErr } = await supabase
    .from('holdings')
    .update({ metadata: updatedMetadata })
    .eq('id', holdingId);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({
    holdingId,
    currentNav,
    navDate,
    currentValue,
    pnl,
    pnlPct,
  });
}
