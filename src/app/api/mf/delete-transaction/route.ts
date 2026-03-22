import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { transactionId } = await req.json();
  if (!transactionId) return NextResponse.json({ error: 'Missing transactionId' }, { status: 400 });

  // Fetch transaction to get holding_id — RLS ensures ownership
  const { data: txn, error: txnErr } = await supabase
    .from('transactions')
    .select('id, holding_id')
    .eq('id', transactionId)
    .single();

  if (txnErr || !txn) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });

  const holdingId = txn.holding_id;

  // Delete the transaction
  const { error: delErr } = await supabase
    .from('transactions')
    .delete()
    .eq('id', transactionId);

  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  // Count remaining buy/sip transactions for this holding
  const { data: remaining, error: countErr } = await supabase
    .from('transactions')
    .select('quantity, price')
    .eq('holding_id', holdingId)
    .in('type', ['buy', 'sip']);

  if (countErr) return NextResponse.json({ error: countErr.message }, { status: 500 });

  if (!remaining || remaining.length === 0) {
    // Last purchase transaction — delete the holding itself
    await supabase.from('holdings').delete().eq('id', holdingId);
    return NextResponse.json({ deleted: true, holdingDeleted: true });
  }

  // Recalculate holding totals
  const totalQty = remaining.reduce((s, t) => s + Number(t.quantity), 0);
  const totalAmt = remaining.reduce((s, t) => s + Number(t.quantity) * Number(t.price), 0);
  const avgPrice = totalQty > 0 ? totalAmt / totalQty : 0;

  const { error: updateErr } = await supabase
    .from('holdings')
    .update({ quantity: totalQty, avg_buy_price: avgPrice })
    .eq('id', holdingId);

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  return NextResponse.json({ deleted: true, holdingId });
}
