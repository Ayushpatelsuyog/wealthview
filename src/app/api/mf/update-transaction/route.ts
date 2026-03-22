import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function PUT(req: NextRequest) {
  const supabase = await createClient();

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { transactionId, price, quantity, date, fees } = body;

  if (!transactionId || !price || !quantity || !date) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // Fetch the transaction to verify ownership (RLS) and get holding_id
  const { data: txn, error: txnErr } = await supabase
    .from('transactions')
    .select('id, holding_id')
    .eq('id', transactionId)
    .single();

  if (txnErr || !txn) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });

  const holdingId = txn.holding_id;

  // Update the transaction
  const { error: updateTxnErr } = await supabase
    .from('transactions')
    .update({ price, quantity, date, fees: fees ?? 0 })
    .eq('id', transactionId);

  if (updateTxnErr) return NextResponse.json({ error: updateTxnErr.message }, { status: 500 });

  // Recalculate holding totals from all remaining buy/sip transactions
  const { data: allTxns, error: txnsErr } = await supabase
    .from('transactions')
    .select('quantity, price')
    .eq('holding_id', holdingId)
    .in('type', ['buy', 'sip']);

  if (txnsErr) return NextResponse.json({ error: txnsErr.message }, { status: 500 });

  const totalQty = (allTxns ?? []).reduce((s, t) => s + Number(t.quantity), 0);
  const totalAmt = (allTxns ?? []).reduce((s, t) => s + Number(t.quantity) * Number(t.price), 0);
  const avgPrice = totalQty > 0 ? totalAmt / totalQty : 0;

  const { error: updateHoldingErr } = await supabase
    .from('holdings')
    .update({ quantity: totalQty, avg_buy_price: avgPrice })
    .eq('id', holdingId);

  if (updateHoldingErr) return NextResponse.json({ error: updateHoldingErr.message }, { status: 500 });

  return NextResponse.json({ updated: true, holdingId });
}
