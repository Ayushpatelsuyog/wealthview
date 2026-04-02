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
  'zerodha', 'groww', 'upstox', 'angel', 'icicidirect',
  'hdfc_securities', 'motilal', 'kotak', 'paytm_money', 'coin',
  'vested', 'indmoney', 'ibkr', 'schwab', 'fidelity', 'revolut', 'etoro',
  'other',
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
    symbol, companyName, exchange, currency = 'USD', country, sector,
    // Transaction
    transactionType = 'buy',  // 'buy' | 'sell' | 'dividend' | 'bonus' | 'split' | 'rights'
    quantity, price, date,
    // FX
    fxRate = 1,
    // Charges
    brokerage = 0, withholdingTax = 0,
    // Corporate action extras
    bonusRatio,
    splitRatio,
    splitFactor: bodySplitFactor,
    rightsRatio,
    rightsPrice: _rightsPrice,
    // Portfolio & broker
    portfolioName = 'Long-term Growth',
    brokerId: passedBrokerId,
    brokerName = 'Vested',
    brokerPlatformId = 'vested',
    // Member override
    memberId,
    // Optional
    notes: userNotes,
  } = body;

  if (!symbol || !companyName || !date) {
    return NextResponse.json({ error: 'symbol, companyName and date are required' }, { status: 400 });
  }
  if (transactionType !== 'dividend' && transactionType !== 'split' && !quantity) {
    return NextResponse.json({ error: 'quantity is required' }, { status: 400 });
  }
  if ((transactionType === 'buy' || transactionType === 'rights') && !price) {
    return NextResponse.json({ error: 'price is required for buy/rights' }, { status: 400 });
  }

  // -- 1. Get user profile --
  const { data: profile } = await supabase.from('users').select('family_id, name').eq('id', user.id).single();
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 500 });

  // -- 2. Ensure family --
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

  // -- 3. Ensure portfolio --
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

  // -- 4. Ensure broker --
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

  // -- 5. Find or create holding --
  // Consolidate: same symbol + same broker + same portfolio
  let holdingQuery = supabase
    .from('holdings')
    .select('id, quantity, avg_buy_price, metadata')
    .eq('portfolio_id', portfolioId)
    .eq('symbol', symbol.toUpperCase())
    .eq('asset_type', 'global_stock');
  if (brokerId) holdingQuery = holdingQuery.eq('broker_id', brokerId);
  const { data: existingHolding } = await holdingQuery.maybeSingle();

  let holdingId: string;
  let consolidated = false;

  const qty       = parseFloat(quantity) || 0;
  const px        = parseFloat(price)    || 0;  // price in LOCAL currency
  const fxRateNum = parseFloat(String(fxRate)) || 1;
  let totalFees = (parseFloat(String(brokerage)) || 0) + (parseFloat(String(withholdingTax)) || 0);

  if (existingHolding) {
    consolidated = true;
    holdingId    = existingHolding.id;

    const oldQty = Number(existingHolding.quantity);
    const oldAvg = Number(existingHolding.avg_buy_price); // in local currency

    let updatedQty: number;
    let updatedAvg: number;

    if (transactionType === 'buy' || transactionType === 'rights') {
      // Weighted average of local currency prices
      updatedQty = oldQty + qty;
      updatedAvg = updatedQty > 0
        ? (oldQty * oldAvg + qty * px) / updatedQty
        : oldAvg;
    } else if (transactionType === 'bonus') {
      // Bonus shares are free: total invested stays same, qty increases
      updatedQty = oldQty + qty;
      updatedAvg = updatedQty > 0 ? (oldQty * oldAvg) / updatedQty : 0;
    } else if (transactionType === 'split') {
      const splitFactor = bodySplitFactor ?? (qty / oldQty);
      updatedQty = oldQty * splitFactor;
      updatedAvg = splitFactor > 0 ? oldAvg / splitFactor : oldAvg;
    } else if (transactionType === 'sell') {
      // Reduce qty, keep avg
      updatedQty = Math.max(0, oldQty - qty);
      updatedAvg = oldAvg;
    } else {
      // dividend: no qty change
      updatedQty = oldQty;
      updatedAvg = oldAvg;
    }

    const existingMeta = (existingHolding.metadata ?? {}) as Record<string, unknown>;
    const updatedMeta = {
      ...existingMeta,
      exchange,
      currency,
      country,
      sector,
      fx_rate: fxRateNum,
    };

    const { error: updateErr } = await supabase
      .from('holdings')
      .update({ quantity: updatedQty, avg_buy_price: updatedAvg, metadata: updatedMeta })
      .eq('id', holdingId);
    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  } else {
    // New holding — avg_buy_price stored in LOCAL currency
    const { data: newHolding, error: holdingErr } = await supabase
      .from('holdings')
      .insert({
        portfolio_id:  portfolioId,
        broker_id:     brokerId,
        asset_type:    'global_stock',
        symbol:        symbol.toUpperCase(),
        name:          companyName,
        quantity:      transactionType === 'dividend' ? 0 : qty,
        avg_buy_price: transactionType === 'dividend' ? 0 : px,
        currency:      currency,
        metadata: {
          exchange,
          currency,
          country,
          sector,
          fx_rate: fxRateNum,
        },
      })
      .select('id').single();

    if (holdingErr || !newHolding) {
      return NextResponse.json({ error: holdingErr?.message ?? 'Holding insert failed' }, { status: 500 });
    }
    holdingId = newHolding.id;
  }

  // -- 6. Create transaction --
  let txnType: string = 'buy';
  let txnNotes = userNotes ?? '';
  let txnPrice = px;
  let txnQty   = qty;

  if (transactionType === 'bonus' || transactionType === 'split') {
    totalFees = 0;
  }

  switch (transactionType) {
    case 'buy':
      txnType  = 'buy';
      if (!txnNotes) txnNotes = `Buy ${symbol} @ ${currency} ${px.toFixed(2)} | FX: ${fxRateNum}`;
      break;
    case 'sell':
      txnType  = 'sell';
      if (!txnNotes) txnNotes = `Sell ${symbol} @ ${currency} ${px.toFixed(2)} | FX: ${fxRateNum}`;
      break;
    case 'bonus':
      txnType  = 'buy';
      txnPrice = 0;
      if (!txnNotes) txnNotes = `Bonus Issue — Ratio: ${bonusRatio ?? ''} | FX: ${fxRateNum}`;
      break;
    case 'split':
      txnType  = 'buy';
      if (!txnNotes) txnNotes = `Stock Split — Ratio: ${splitRatio ?? ''} | FX: ${fxRateNum}`;
      break;
    case 'rights':
      txnType  = 'buy';
      if (!txnNotes) txnNotes = `Rights Issue — Ratio: ${rightsRatio ?? ''} | Price: ${currency} ${px.toFixed(2)} | FX: ${fxRateNum}`;
      break;
    case 'dividend':
      txnType  = 'dividend';
      txnQty   = 0;
      txnPrice = px;
      if (!txnNotes) txnNotes = `Dividend from ${symbol} | ${currency} ${px.toFixed(2)} | FX: ${fxRateNum}`;
      break;
  }

  const { error: txnErr } = await supabase.from('transactions').insert({
    holding_id: holdingId,
    type:       txnType as 'buy' | 'sell' | 'dividend' | 'sip' | 'switch',
    quantity:   txnQty,
    price:      txnPrice,
    date:       date,
    fees:       totalFees,
    notes:      txnNotes,
    metadata: {
      fx_rate: fxRateNum,
      currency,
      price_local: px,
      brokerage: parseFloat(String(brokerage)) || 0,
      withholding_tax: parseFloat(String(withholdingTax)) || 0,
    },
  });

  if (txnErr) return NextResponse.json({ error: txnErr.message }, { status: 500 });

  return NextResponse.json({ holdingId, consolidated });
}
