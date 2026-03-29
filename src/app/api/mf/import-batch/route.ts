import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const PORTFOLIO_TYPE_MAP: Record<string, string> = {
  'Long-term Growth': 'personal',
  'Retirement': 'retirement',
  'Tax Saving': 'tax_saving',
  'Joint': 'joint',
  'Trading': 'trading',
};

const VALID_PLATFORM_TYPES = new Set([
  'zerodha', 'groww', 'upstox', 'angel', 'icicidirect',
  'hdfc_securities', 'motilal', 'kotak', 'paytm_money', 'coin', 'other',
]);

interface ImportTransaction {
  date: string;
  type: string; // sip, buy, sell, dividend
  amount: number;
  nav: number;
  units: number;
  stampDuty?: number;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const {
    memberId,
    schemeCode,
    schemeName,
    portfolioName = 'Long-term Growth',
    brokerId: passedBrokerId,
    brokerName,
    brokerPlatformId,
    folioNumber,
    transactions,
  } = body as {
    memberId?: string;
    schemeCode: string;
    schemeName: string;
    portfolioName?: string;
    brokerId?: string;
    brokerName?: string;
    brokerPlatformId?: string;
    folioNumber?: string;
    transactions: ImportTransaction[];
  };

  if (!schemeCode || !schemeName || !transactions?.length) {
    return NextResponse.json({ error: 'schemeCode, schemeName, and transactions are required' }, { status: 400 });
  }

  // 1. Get profile
  const { data: profile } = await supabase.from('users').select('family_id, name').eq('id', user.id).single();
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 500 });

  // 2. Ensure family
  let familyId: string = profile.family_id;
  if (!familyId) {
    const { data: newFamily, error: famErr } = await supabase
      .from('families')
      .insert({ name: `${profile.name ?? 'My'} Family`, created_by: user.id })
      .select('id').single();
    if (famErr) return NextResponse.json({ error: famErr.message }, { status: 500 });
    familyId = newFamily.id;
    await supabase.from('users').update({ family_id: familyId }).eq('id', user.id);
  }

  // 3. Ensure portfolio
  const targetUserId = memberId || user.id;
  const { data: existingPortfolio } = await supabase
    .from('portfolios').select('id')
    .eq('family_id', familyId).eq('name', portfolioName).eq('user_id', targetUserId)
    .maybeSingle();

  let portfolioId: string;
  if (existingPortfolio) {
    portfolioId = existingPortfolio.id;
  } else {
    const pType = PORTFOLIO_TYPE_MAP[portfolioName] ?? 'personal';
    const { data: newPortfolio, error: portErr } = await supabase
      .from('portfolios')
      .insert({ user_id: targetUserId, family_id: familyId, name: portfolioName, type: pType })
      .select('id').single();
    if (portErr) return NextResponse.json({ error: portErr.message }, { status: 500 });
    portfolioId = newPortfolio.id;
  }

  // 4. Ensure broker
  let brokerId: string | null = passedBrokerId ?? null;
  if (!brokerId && (brokerName || brokerPlatformId)) {
    const platformType = VALID_PLATFORM_TYPES.has(brokerPlatformId ?? '') ? brokerPlatformId! : 'other';
    const { data: existingBroker } = await supabase
      .from('brokers').select('id').eq('family_id', familyId).eq('platform_type', platformType).maybeSingle();
    if (existingBroker) {
      brokerId = existingBroker.id;
    } else {
      const { data: newBroker, error: brokerErr } = await supabase
        .from('brokers')
        .insert({ family_id: familyId, name: brokerName || 'Other', platform_type: platformType })
        .select('id').single();
      if (brokerErr) return NextResponse.json({ error: brokerErr.message }, { status: 500 });
      brokerId = newBroker.id;
    }
  }

  // 5. Find or create holding
  let holdingQuery = supabase
    .from('holdings')
    .select('id, quantity, avg_buy_price, metadata')
    .eq('portfolio_id', portfolioId)
    .eq('symbol', schemeCode)
    .eq('asset_type', 'mutual_fund');
  if (brokerId) holdingQuery = holdingQuery.eq('broker_id', brokerId);
  const { data: existingHolding } = await holdingQuery.maybeSingle();

  let holdingId: string;
  let totalQty = 0;
  let totalCost = 0;

  if (existingHolding) {
    holdingId = existingHolding.id;
    totalQty = Number(existingHolding.quantity);
    totalCost = totalQty * Number(existingHolding.avg_buy_price);
  } else {
    const { data: newHolding, error: holdingErr } = await supabase
      .from('holdings')
      .insert({
        portfolio_id: portfolioId,
        broker_id: brokerId,
        asset_type: 'mutual_fund',
        symbol: schemeCode,
        name: schemeName,
        quantity: 0,
        avg_buy_price: 0,
        currency: 'INR',
        metadata: {
          folio: folioNumber,
          is_import: true,
        },
      })
      .select('id').single();
    if (holdingErr) return NextResponse.json({ error: holdingErr.message }, { status: 500 });
    holdingId = newHolding.id;
  }

  // 6. Insert all transactions and update holding totals
  let savedCount = 0;
  const errors: string[] = [];

  for (const txn of transactions) {
    const amt = Number(txn.amount) || 0;
    const nav = Number(txn.nav) || 0;
    const units = Number(txn.units) || (nav > 0 ? amt / nav : 0);
    const stampDuty = Number(txn.stampDuty) || 0;
    const txnType = txn.type === 'sip' ? 'sip' : txn.type === 'sell' ? 'sell' : txn.type === 'dividend' ? 'dividend' : 'buy';

    if (!txn.date || amt <= 0) continue;

    // Update running totals
    if (txnType === 'buy' || txnType === 'sip') {
      totalCost += amt - stampDuty;
      totalQty += units;
    } else if (txnType === 'sell') {
      const avgBefore = totalQty > 0 ? totalCost / totalQty : 0;
      totalQty = Math.max(0, totalQty - units);
      totalCost = totalQty * avgBefore;
    }

    const { error: txnErr } = await supabase.from('transactions').insert({
      holding_id: holdingId,
      type: txnType as 'buy' | 'sell' | 'dividend' | 'sip' | 'switch',
      quantity: units,
      price: nav,
      date: txn.date,
      fees: stampDuty,
      notes: `Import: ${txnType} ₹${amt} @ NAV ${nav}`,
    });

    if (txnErr) {
      errors.push(`${txn.date}: ${txnErr.message}`);
    } else {
      savedCount++;
    }
  }

  // 7. Update holding totals
  const avgBuyPrice = totalQty > 0 ? totalCost / totalQty : 0;
  await supabase
    .from('holdings')
    .update({ quantity: totalQty, avg_buy_price: avgBuyPrice })
    .eq('id', holdingId);

  return NextResponse.json({
    holdingId,
    savedTransactions: savedCount,
    totalTransactions: transactions.length,
    errors: errors.length > 0 ? errors : undefined,
    quantity: totalQty,
    avgBuyPrice,
  });
}
