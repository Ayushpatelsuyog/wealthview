import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const PORTFOLIO_TYPE_MAP: Record<string, string> = {
  'Long-term Growth': 'personal',
  'Retirement':       'retirement',
  'Tax Saving':       'tax_saving',
  'Joint':            'joint',
  'Trading':          'trading',
};

const VALID_PLATFORM_TYPES = new Set([
  'zerodha','groww','upstox','angel','icicidirect',
  'hdfc_securities','motilal','kotak','paytm_money','coin','other',
]);

function normalisePlatform(id: string): string {
  return VALID_PLATFORM_TYPES.has(id) ? id : 'other';
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const {
    // Stock identity
    symbol, companyName, exchange = 'NSE', sector, industry, isin, bseCode,
    // Transaction
    transactionType = 'buy',  // 'buy' | 'bonus' | 'split' | 'rights' | 'dividend'
    quantity, price, date,
    // Charges (for buy)
    brokerage = 0, stt = 0, gst = 0, stampDuty = 0, exchangeCharges = 0, dpCharges = 0,
    // Portfolio & broker
    portfolioName = 'Long-term Growth',
    brokerId: passedBrokerId,
    brokerName = 'Zerodha',
    brokerPlatformId = 'zerodha',
    // Member override
    memberId,
    // Optional extras
    demat,
    holderDetails,
    currentPrice,
    // Corporate action extras
    bonusRatio,        // e.g. "1:2" for bonus
    splitRatio,        // e.g. "1:5" for split
    rightsRatio,
    dividendPerShare,
    dividendType,
    exDate,
    paymentDate,
  } = body;

  if (!symbol || !companyName || !date) {
    return NextResponse.json({ error: 'symbol, companyName and date are required' }, { status: 400 });
  }
  if (transactionType !== 'dividend' && !quantity) {
    return NextResponse.json({ error: 'quantity is required' }, { status: 400 });
  }
  if (transactionType === 'buy' && !price) {
    return NextResponse.json({ error: 'price is required for buy' }, { status: 400 });
  }

  // ── 1. Get user profile ─────────────────────────────────────────────────────
  const { data: profile } = await supabase.from('users').select('family_id, name').eq('id', user.id).single();
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 500 });

  // ── 2. Ensure family ────────────────────────────────────────────────────────
  let familyId: string = body.familyId || profile.family_id;
  if (!familyId) {
    const { data: newFamily, error: famErr } = await supabase
      .from('families')
      .insert({ name: `${profile.name ?? 'My'} Family`, created_by: user.id })
      .select('id').single();
    if (famErr) return NextResponse.json({ error: famErr.message }, { status: 500 });
    familyId = newFamily.id;
    await supabase.from('users').update({ family_id: familyId }).eq('id', user.id);
  }

  // ── 3. Ensure portfolio ─────────────────────────────────────────────────────
  const targetUserId = memberId || user.id;
  const { data: existingPortfolio } = await supabase
    .from('portfolios').select('id').eq('family_id', familyId).eq('name', portfolioName).eq('user_id', targetUserId).maybeSingle();

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

  // ── 4. Ensure broker ────────────────────────────────────────────────────────
  let brokerId: string | null = passedBrokerId ?? null;
  if (!brokerId) {
    const platformType = normalisePlatform(brokerPlatformId);
    const { data: existingBroker } = await supabase
      .from('brokers').select('id').eq('family_id', familyId).eq('platform_type', platformType).maybeSingle();
    if (existingBroker) {
      brokerId = existingBroker.id;
    } else {
      const { data: newBroker, error: brokerErr } = await supabase
        .from('brokers')
        .insert({ family_id: familyId, name: brokerName, platform_type: platformType })
        .select('id').single();
      if (brokerErr) return NextResponse.json({ error: brokerErr.message }, { status: 500 });
      brokerId = newBroker.id;
    }
  }

  // ── 5. Find or create holding ───────────────────────────────────────────────
  // Consolidate only when: same symbol + same broker + same portfolio
  let holdingQuery = supabase
    .from('holdings')
    .select('id, quantity, avg_buy_price, metadata')
    .eq('portfolio_id', portfolioId)
    .eq('symbol', symbol.toUpperCase())
    .eq('asset_type', 'indian_stock');
  if (brokerId) holdingQuery = holdingQuery.eq('broker_id', brokerId);
  const { data: existingHolding } = await holdingQuery.maybeSingle();

  let holdingId: string;
  let consolidated = false;

  const qty    = parseFloat(quantity) || 0;
  const px     = parseFloat(price)    || 0;
  const totalFees = parseFloat(brokerage) + parseFloat(stt) + parseFloat(gst) +
                    parseFloat(stampDuty) + parseFloat(exchangeCharges) + parseFloat(dpCharges);

  if (existingHolding) {
    consolidated = true;
    holdingId    = existingHolding.id;

    const oldQty  = Number(existingHolding.quantity);
    const oldAvg  = Number(existingHolding.avg_buy_price);
    const newQty  = transactionType === 'split'
      ? qty - oldQty        // split passes total new qty, not added qty
      : qty;

    let updatedQty: number;
    let updatedAvg: number;

    if (transactionType === 'buy' || transactionType === 'rights') {
      updatedQty = oldQty + newQty;
      updatedAvg = updatedQty > 0
        ? (oldQty * oldAvg + newQty * px) / updatedQty
        : oldAvg;
    } else if (transactionType === 'bonus') {
      // Bonus shares are free: total invested stays same, qty increases
      updatedQty = oldQty + newQty;
      updatedAvg = updatedQty > 0 ? (oldQty * oldAvg) / updatedQty : 0;
    } else if (transactionType === 'split') {
      // Split: total invested stays same, qty changes per ratio
      const splitFactor = body.splitFactor ?? (qty / oldQty);
      updatedQty = oldQty * splitFactor;
      updatedAvg = splitFactor > 0 ? oldAvg / splitFactor : oldAvg;
    } else if (transactionType === 'sell') {
      // Sell: reduce holding quantity
      updatedQty = Math.max(0, oldQty - qty);
      updatedAvg = oldAvg; // avg cost basis stays the same
    } else {
      // dividend: doesn't change holding qty/avg
      updatedQty = oldQty;
      updatedAvg = oldAvg;
    }

    const existingMeta = (existingHolding.metadata ?? {}) as Record<string, unknown>;
    const updatedMeta = {
      ...existingMeta,
      sector:          sector    ?? existingMeta.sector,
      industry:        industry  ?? existingMeta.industry,
      isin:            isin      ?? existingMeta.isin,
      bse_code:        bseCode   ?? existingMeta.bse_code,
      exchange:        exchange  ?? existingMeta.exchange,
      demat:           demat     ?? existingMeta.demat,
      current_price:   currentPrice ?? existingMeta.current_price,
      ...(holderDetails ?? {}),
    };

    const { error: updateErr } = await supabase
      .from('holdings')
      .update({ quantity: updatedQty, avg_buy_price: updatedAvg, metadata: updatedMeta })
      .eq('id', holdingId);
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  } else {
    // New holding
    const { data: newHolding, error: holdingErr } = await supabase
      .from('holdings')
      .insert({
        portfolio_id:  portfolioId,
        broker_id:     brokerId,
        asset_type:    'indian_stock',
        symbol:        symbol.toUpperCase(),
        name:          companyName,
        quantity:      qty,
        avg_buy_price: transactionType === 'bonus' ? 0 : px,
        currency:      'INR',
        metadata: {
          sector, industry, isin, bse_code: bseCode,
          exchange, demat,
          current_price: currentPrice ?? null,
          ...(holderDetails ?? {}),
        },
      })
      .select('id').single();

    if (holdingErr || !newHolding) {
      return NextResponse.json({ error: holdingErr?.message ?? 'Holding insert failed' }, { status: 500 });
    }
    holdingId = newHolding.id;
  }

  // ── 6. Create transaction ───────────────────────────────────────────────────
  let txnType: string = 'buy';
  let txnNotes = '';
  let txnFees  = totalFees;
  let txnPrice = px;
  let txnQty   = qty;

  switch (transactionType) {
    case 'buy':
      txnType  = 'buy';
      txnNotes = demat ? `Demat: ${demat}` : 'Buy';
      break;
    case 'sell':
      txnType  = 'sell';
      txnNotes = 'Sell';
      break;
    case 'bonus':
      txnType  = 'buy';
      txnPrice = 0;
      txnFees  = 0;
      txnNotes = `Bonus Issue — Ratio: ${bonusRatio ?? ''}`;
      break;
    case 'split':
      txnType  = 'buy';
      txnNotes = `Stock Split — Ratio: ${splitRatio ?? ''}`;
      txnFees  = 0;
      break;
    case 'rights':
      txnType  = 'buy';
      txnNotes = `Rights Issue — Ratio: ${rightsRatio ?? ''}`;
      break;
    case 'dividend':
      txnType  = 'dividend';
      txnQty   = 0;
      txnPrice = parseFloat(dividendPerShare) || 0;
      txnFees  = 0;
      txnNotes = `${dividendType ?? 'Dividend'} — ₹${txnPrice}/share${exDate ? ` | Ex-date: ${exDate}` : ''}${paymentDate ? ` | Pay: ${paymentDate}` : ''}`;
      break;
  }

  const { error: txnErr } = await supabase.from('transactions').insert({
    holding_id: holdingId,
    type:       txnType as 'buy' | 'sell' | 'dividend' | 'sip' | 'switch',
    quantity:   txnQty,
    price:      txnPrice,
    date:       date,
    fees:       txnFees,
    notes:      txnNotes,
  });

  if (txnErr) return NextResponse.json({ error: txnErr.message }, { status: 500 });

  return NextResponse.json({ holdingId, consolidated });
}
