import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const PORTFOLIO_TYPE_MAP: Record<string, string> = {
  'Long-term Growth': 'personal',
  'Retirement':       'retirement',
  'Tax Saving':       'tax_saving',
  'Joint':            'joint',
  'Trading':          'trading',
};

// platform_type enum allowed values
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
  if (authErr || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const {
    schemeCode, schemeName, category, fundHouse,
    purchaseDate, purchaseNav, investedAmount, units,
    folio, planType, fees, isSIP, sipAmount, isNFO,
    portfolioName = 'My Portfolio',
    brokerId: passedBrokerId,
    brokerName = 'Other',
    brokerPlatformId = 'other',
    currentNav,
    holderDetails,
    sipMetadata,
    sipMonthlyBreakdown,
    memberId,
  } = body;

  // ── 1. Validate required fields ───────────────────────────────────────────
  if (!schemeCode || !schemeName || !purchaseDate || !purchaseNav || !investedAmount || !units) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // ── 2. Get user's profile ─────────────────────────────────────────────────
  const { data: profile, error: profileErr } = await supabase
    .from('users')
    .select('family_id, name')
    .eq('id', user.id)
    .single();
  if (profileErr) return NextResponse.json({ error: profileErr.message }, { status: 500 });

  // ── 3. Ensure family exists ───────────────────────────────────────────────
  let familyId: string = body.familyId || profile.family_id;
  if (!familyId) {
    const { data: newFamily, error: famErr } = await supabase
      .from('families')
      .insert({ name: `${profile.name ?? 'My'} Family`, created_by: user.id })
      .select('id')
      .single();
    if (famErr) return NextResponse.json({ error: famErr.message }, { status: 500 });
    familyId = newFamily.id;
    await supabase.from('users').update({ family_id: familyId }).eq('id', user.id);
  }

  // ── 4. Ensure portfolio exists ────────────────────────────────────────────
  const targetUserId = memberId || user.id;
  const { data: existingPortfolio } = await supabase
    .from('portfolios')
    .select('id')
    .eq('family_id', familyId)
    .eq('name', portfolioName)
    .eq('user_id', targetUserId)
    .maybeSingle();

  let portfolioId: string;
  if (existingPortfolio) {
    portfolioId = existingPortfolio.id;
  } else {
    const pType = PORTFOLIO_TYPE_MAP[portfolioName] ?? 'personal';
    const { data: newPortfolio, error: portErr } = await supabase
      .from('portfolios')
      .insert({ user_id: targetUserId, family_id: familyId, name: portfolioName, type: pType })
      .select('id')
      .single();
    if (portErr) return NextResponse.json({ error: portErr.message }, { status: 500 });
    portfolioId = newPortfolio.id;
  }

  // ── 5. Ensure broker exists ───────────────────────────────────────────────
  let brokerId: string | null = passedBrokerId ?? null;
  if (!brokerId) {
    const platformType = normalisePlatform(brokerPlatformId);
    const { data: existingBroker } = await supabase
      .from('brokers')
      .select('id')
      .eq('family_id', familyId)
      .eq('platform_type', platformType)
      .maybeSingle();

    if (existingBroker) {
      brokerId = existingBroker.id;
    } else {
      const { data: newBroker, error: brokerErr } = await supabase
        .from('brokers')
        .insert({ family_id: familyId, name: brokerName, platform_type: platformType })
        .select('id')
        .single();
      if (brokerErr) return NextResponse.json({ error: brokerErr.message }, { status: 500 });
      brokerId = newBroker.id;
    }
  }

  // ── 6. Find or create holding (dedup by portfolio + symbol + broker) ───────
  // Same fund + same distributor + same portfolio = consolidate
  // Same fund + different distributor = separate holdings
  let holdingQuery = supabase
    .from('holdings')
    .select('id, quantity, avg_buy_price, metadata')
    .eq('portfolio_id', portfolioId)
    .eq('symbol', schemeCode.toString())
    .eq('asset_type', 'mutual_fund');
  if (brokerId) holdingQuery = holdingQuery.eq('broker_id', brokerId);
  const { data: existingHolding } = await holdingQuery.maybeSingle();

  let holdingId: string;
  let consolidated = false;

  if (existingHolding) {
    // ── Consolidate into existing holding ──────────────────────────────────
    consolidated = true;
    holdingId    = existingHolding.id;

    const oldQty    = Number(existingHolding.quantity);
    const oldAvg    = Number(existingHolding.avg_buy_price);
    const newQty    = Number(units);
    const totalQty  = oldQty + newQty;
    const weightedAvg = totalQty > 0 ? (oldQty * oldAvg + newQty * Number(purchaseNav)) / totalQty : Number(purchaseNav);

    const existingMeta = (existingHolding.metadata ?? {}) as Record<string, unknown>;
    const existingSips = Array.isArray(existingMeta.sips) ? existingMeta.sips : [];
    const updatedMeta  = {
      ...existingMeta,
      folio:       folio       ?? existingMeta.folio       ?? null,
      current_nav: currentNav  ?? existingMeta.current_nav ?? null,
      ...(holderDetails ?? {}),
      ...(sipMetadata ? {
        ...sipMetadata,
        sips: sipMetadata.sips ? [...existingSips, ...sipMetadata.sips] : existingSips,
      } : {}),
    };

    const { error: updateErr } = await supabase
      .from('holdings')
      .update({ quantity: totalQty, avg_buy_price: weightedAvg, metadata: updatedMeta })
      .eq('id', holdingId);

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
  } else {
    // ── Create new holding ─────────────────────────────────────────────────
    const { data: newHolding, error: holdingErr } = await supabase
      .from('holdings')
      .insert({
        portfolio_id:   portfolioId,
        broker_id:      brokerId,
        asset_type:     'mutual_fund',
        symbol:         schemeCode.toString(),
        name:           schemeName,
        quantity:       units,
        avg_buy_price:  purchaseNav,
        currency:       'INR',
        metadata: {
          category,
          fund_house:  fundHouse ?? null,
          plan_type:   planType  ?? null,
          folio:       folio     ?? null,
          is_sip:      isSIP     ?? false,
          is_nfo:      isNFO     ?? false,
          sip_amount:  sipAmount ?? null,
          current_nav: currentNav ?? null,
          amfi_code:   schemeCode,
          ...(holderDetails ?? {}),
          ...(sipMetadata   ?? {}),
        },
      })
      .select('id')
      .single();

    if (holdingErr || !newHolding) {
      return NextResponse.json({ error: holdingErr?.message ?? 'Holding insert failed (RLS?)' }, { status: 500 });
    }
    holdingId = newHolding.id;
  }

  // ── 7. Create transaction(s) ──────────────────────────────────────────────
  // For SIPs with a monthly breakdown, insert one row per installment
  const hasBreakdown = isSIP && Array.isArray(sipMonthlyBreakdown) && sipMonthlyBreakdown.length > 0;

  if (hasBreakdown) {
    type BreakdownItem = { date: string; nav: number; units_purchased: number; stamp_duty?: number };
    type SipGroup = { sipNumber: number; sipAmount: number; sipStart: string; sipDate: string; breakdown: BreakdownItem[] };

    // Accept either per-SIP array of groups, or flat array (legacy)
    const isGrouped = !!(sipMonthlyBreakdown[0] as SipGroup)?.breakdown;
    const groups: SipGroup[] = isGrouped
      ? sipMonthlyBreakdown as SipGroup[]
      : [{ sipNumber: 1, sipAmount: parseFloat(sipAmount ?? 0), sipStart: purchaseDate, sipDate: '1st', breakdown: sipMonthlyBreakdown as BreakdownItem[] }];

    const allTxnRows: object[] = [];
    for (const sip of groups) {
      const amtFmt = Number(sip.sipAmount).toLocaleString('en-IN');
      const label  = `SIP #${sip.sipNumber} - ₹${amtFmt}/month (started ${sip.sipStart})`;
      for (const inst of sip.breakdown) {
        allTxnRows.push({
          holding_id: holdingId,
          type:       'sip',
          quantity:   inst.units_purchased,
          price:      inst.nav,
          date:       inst.date,
          fees:       inst.stamp_duty ?? 0,
          notes:      label,
        });
      }
    }

    if (allTxnRows.length > 0) {
      const { error: txnErr } = await supabase.from('transactions').insert(allTxnRows);
      if (txnErr) return NextResponse.json({ error: txnErr.message }, { status: 500 });
    }
  } else {
    // Single summary transaction (lump sum, or SIP without breakdown)
    const txnMeta: Record<string, unknown> = {};
    if (!isSIP && isNFO) txnMeta.is_nfo = true;

    const { error: txnErr } = await supabase
      .from('transactions')
      .insert({
        holding_id: holdingId,
        type:       isSIP ? 'sip' : 'buy',
        quantity:   units,
        price:      purchaseNav,
        date:       purchaseDate,
        fees:       fees ?? parseFloat((investedAmount * 0.00005).toFixed(2)),
        notes:      folio ? `Folio: ${folio}` : (isSIP ? 'SIP purchase' : 'Lump sum purchase'),
        metadata:   txnMeta,
      });

    if (txnErr) {
      return NextResponse.json({ error: txnErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ holdingId, consolidated });
}
