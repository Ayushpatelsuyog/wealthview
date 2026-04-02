import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const {
    fundName, amc, schemeCode,
    nav, units, amount, date,
    folio, stampDuty = 0,
    portfolioName = 'My Portfolio',
    brokerId: passedBrokerId,
    memberId,
  } = body;

  if (!fundName || !nav || !units || !amount || !date) {
    return NextResponse.json({ error: 'fundName, nav, units, amount, date are required' }, { status: 400 });
  }

  const { data: profile } = await supabase.from('users').select('family_id').eq('id', user.id).single();
  if (!profile?.family_id) return NextResponse.json({ error: 'No family found' }, { status: 400 });

  const targetUserId = memberId || user.id;
  const familyId = body.familyId || profile.family_id;

  // Find or create portfolio
  const { data: existingPortfolio } = await supabase
    .from('portfolios').select('id').eq('family_id', familyId).eq('name', portfolioName).eq('user_id', targetUserId).maybeSingle();

  let portfolioId: string;
  if (existingPortfolio) {
    portfolioId = existingPortfolio.id;
  } else {
    const { data: newPortfolio, error: portErr } = await supabase
      .from('portfolios').insert({ user_id: targetUserId, family_id: familyId, name: portfolioName, type: 'personal' }).select('id').single();
    if (portErr) return NextResponse.json({ error: portErr.message }, { status: 500 });
    portfolioId = newPortfolio.id;
  }

  const navNum = parseFloat(nav);
  const unitsNum = parseFloat(units);
  const _amountNum = parseFloat(amount);
  const feesNum = parseFloat(String(stampDuty)) || 0;

  // Find existing SIF holding by fund name + portfolio
  const symbol = (schemeCode || fundName).toUpperCase().replace(/\s+/g, '_').slice(0, 20);
  const { data: existingHolding } = await supabase
    .from('holdings').select('id, quantity, avg_buy_price')
    .eq('portfolio_id', portfolioId).eq('symbol', symbol).eq('asset_type', 'mutual_fund')
    .maybeSingle();

  let holdingId: string;
  let consolidated = false;

  if (existingHolding) {
    consolidated = true;
    holdingId = existingHolding.id;
    const oldQty = Number(existingHolding.quantity);
    const oldAvg = Number(existingHolding.avg_buy_price);
    const newQty = oldQty + unitsNum;
    const newAvg = newQty > 0 ? (oldQty * oldAvg + unitsNum * navNum) / newQty : navNum;
    await supabase.from('holdings').update({ quantity: newQty, avg_buy_price: newAvg }).eq('id', holdingId);
  } else {
    const { data: newHolding, error: hErr } = await supabase.from('holdings').insert({
      portfolio_id: portfolioId,
      broker_id: passedBrokerId || null,
      symbol,
      name: fundName,
      asset_type: 'mutual_fund',
      quantity: unitsNum,
      avg_buy_price: navNum,
      metadata: {
        amc, scheme_code: schemeCode, category: 'SIF', is_sif: true, folio,
        current_nav: navNum,
        nav_updated_at: new Date().toISOString(),
        nav_source: 'manual',
      },
    }).select('id').single();
    if (hErr) return NextResponse.json({ error: hErr.message }, { status: 500 });
    holdingId = newHolding.id;
  }

  // Create transaction
  const notes = `Buy ${fundName} @ NAV ${navNum.toFixed(4)} | ${unitsNum.toFixed(4)} units`;
  await supabase.from('transactions').insert({
    holding_id: holdingId, type: 'buy', quantity: unitsNum, price: navNum, date, fees: feesNum, notes,
  });

  return NextResponse.json({ holdingId, consolidated });
}
