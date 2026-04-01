import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const {
    bondName, bondType, isin,
    faceValue, purchasePrice, units, purchaseDate,
    couponRate, couponFrequency, maturityDate,
    creditRating, isListed, exchange, marketPrice,
    taxTreatment, sgbSeries, goldGrams,
    portfolioName = 'My Portfolio',
    brokerId: passedBrokerId,
    memberId,
    notes: userNotes,
  } = body;

  if (!bondName || !faceValue || !units || !purchaseDate || !maturityDate) {
    return NextResponse.json({ error: 'bondName, faceValue, units, purchaseDate, maturityDate are required' }, { status: 400 });
  }

  const { data: profile } = await supabase.from('users').select('family_id').eq('id', user.id).single();
  if (!profile?.family_id) return NextResponse.json({ error: 'No family found' }, { status: 400 });

  const targetUserId = memberId || user.id;
  const familyId = profile.family_id;

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

  const fv = parseFloat(faceValue);
  const pp = parseFloat(purchasePrice || faceValue);
  const qty = parseFloat(units);
  const cr = parseFloat(couponRate || '0');

  const symbol = (isin || bondName).toUpperCase().replace(/\s+/g, '_').slice(0, 20);

  const { data: newHolding, error: hErr } = await supabase.from('holdings').insert({
    portfolio_id: portfolioId,
    broker_id: passedBrokerId || null,
    symbol,
    name: bondName,
    asset_type: 'bond',
    quantity: qty,
    avg_buy_price: pp,
    metadata: {
      bond_type: bondType, isin, face_value: fv,
      coupon_rate: cr, coupon_frequency: couponFrequency || 'semi_annual',
      maturity_date: maturityDate, credit_rating: creditRating || 'Unrated',
      is_listed: !!isListed, exchange: exchange || null, market_price: marketPrice || null,
      tax_treatment: taxTreatment || 'taxable',
      sgb_series: sgbSeries || null, gold_grams: goldGrams || null,
    },
  }).select('id').single();
  if (hErr) return NextResponse.json({ error: hErr.message }, { status: 500 });

  // Create buy transaction
  const totalInvested = pp * qty;
  const notes = `Buy ${bondName} | ${qty} units @ ₹${pp.toFixed(2)} | Coupon: ${cr}%`;
  await supabase.from('transactions').insert({
    holding_id: newHolding.id, type: 'buy', quantity: qty, price: pp, date: purchaseDate,
    fees: 0, notes: userNotes || notes,
  });

  return NextResponse.json({ holdingId: newHolding.id, totalInvested });
}
