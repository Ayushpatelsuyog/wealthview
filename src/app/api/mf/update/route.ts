import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

type BreakdownItem = { date: string; nav: number; units_purchased: number; stamp_duty?: number };
type SipGroup     = { sipNumber: number; sipAmount: number; sipStart: string; sipDate: string; breakdown: BreakdownItem[] };

export async function PUT(req: NextRequest) {
  const supabase = await createClient();

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const {
    holdingId,
    purchaseDate, purchaseNav, investedAmount, units,
    folio, isSIP,
    holderDetails,
    sipMetadata,
    sipMonthlyBreakdown,
  } = body;

  if (!holdingId || !purchaseDate || !purchaseNav || !investedAmount || !units) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // Fetch existing holding — RLS ensures ownership
  const { data: existing, error: fetchErr } = await supabase
    .from('holdings')
    .select('id, metadata')
    .eq('id', holdingId)
    .single();

  if (fetchErr || !existing) {
    return NextResponse.json({ error: 'Holding not found' }, { status: 404 });
  }

  // Build updated metadata — replace sips entirely for edit mode
  const existingMeta = (existing.metadata ?? {}) as Record<string, unknown>;
  const updatedMeta  = {
    ...existingMeta,
    folio:  folio ?? existingMeta.folio ?? null,
    is_sip: isSIP ?? false,
    ...(holderDetails ?? {}),
    ...(sipMetadata   ?? {}),
  };

  // Update holding
  const { error: updateErr } = await supabase
    .from('holdings')
    .update({ quantity: units, avg_buy_price: purchaseNav, metadata: updatedMeta })
    .eq('id', holdingId);

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  // Delete all existing buy/sip transactions
  const { error: delErr } = await supabase
    .from('transactions')
    .delete()
    .eq('holding_id', holdingId)
    .in('type', ['buy', 'sip']);

  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  // Insert new transactions
  const hasBreakdown = isSIP && Array.isArray(sipMonthlyBreakdown) && sipMonthlyBreakdown.length > 0;

  if (hasBreakdown) {
    const isGrouped = !!(sipMonthlyBreakdown[0] as SipGroup)?.breakdown;
    const groups: SipGroup[] = isGrouped
      ? sipMonthlyBreakdown as SipGroup[]
      : [{ sipNumber: 1, sipAmount: Number(body.sipAmount ?? 0), sipStart: purchaseDate, sipDate: '1st', breakdown: sipMonthlyBreakdown as BreakdownItem[] }];

    const rows: object[] = [];
    for (const sip of groups) {
      const label = `SIP #${sip.sipNumber} - ₹${Number(sip.sipAmount).toLocaleString('en-IN')}/month (started ${sip.sipStart})`;
      for (const inst of sip.breakdown) {
        rows.push({ holding_id: holdingId, type: 'sip', quantity: inst.units_purchased, price: inst.nav, date: inst.date, fees: inst.stamp_duty ?? 0, notes: label });
      }
    }
    if (rows.length > 0) {
      const { error: txnErr } = await supabase.from('transactions').insert(rows);
      if (txnErr) return NextResponse.json({ error: txnErr.message }, { status: 500 });
    }
  } else {
    const { error: txnErr } = await supabase
      .from('transactions')
      .insert({
        holding_id: holdingId,
        type:       isSIP ? 'sip' : 'buy',
        quantity:   units,
        price:      purchaseNav,
        date:       purchaseDate,
        fees:       0,
        notes:      folio ? `Folio: ${folio}` : (isSIP ? 'SIP purchase' : 'Lump sum purchase'),
      });
    if (txnErr) return NextResponse.json({ error: txnErr.message }, { status: 500 });
  }

  return NextResponse.json({ holdingId });
}
