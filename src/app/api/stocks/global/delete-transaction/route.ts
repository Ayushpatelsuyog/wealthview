import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

function parseTxnMetadata(notes: string | null): { fx_rate: number; currency: string; price_local: number } | null {
  if (!notes) return null;
  const metaMatch = notes.match(/meta:(\{[^}]+\})/);
  if (!metaMatch) return null;
  try {
    return JSON.parse(metaMatch[1]);
  } catch {
    return null;
  }
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const txnId     = req.nextUrl.searchParams.get('txn_id');
  const holdingId = req.nextUrl.searchParams.get('holding_id');
  if (!txnId || !holdingId) return NextResponse.json({ error: 'txn_id and holding_id required' }, { status: 400 });

  // Get the transaction
  const { data: txn } = await supabase
    .from('transactions')
    .select('id, type, quantity, price, fees, date, notes')
    .eq('id', txnId)
    .single();
  if (!txn) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });

  // Get holding
  const { data: holding } = await supabase
    .from('holdings')
    .select('id, quantity, avg_buy_price')
    .eq('id', holdingId)
    .eq('asset_type', 'global_stock')
    .single();
  if (!holding) return NextResponse.json({ error: 'Holding not found' }, { status: 404 });

  // Recompute holding after removing this transaction
  const txnQty = Number(txn.quantity);
  const curQty = Number(holding.quantity);
  const curAvg = Number(holding.avg_buy_price); // in local currency

  // Get local price from metadata if available, fall back to txn price
  const meta = parseTxnMetadata(txn.notes);
  const txnPx = meta?.price_local ?? Number(txn.price);

  let newQty = curQty;
  let newAvg = curAvg;

  if (txn.type === 'buy') {
    // Reverse buy: subtract qty, recalculate weighted avg
    newQty = curQty - txnQty;
    const oldInvested = curQty * curAvg;
    const txnInvested = txnQty * txnPx;
    newAvg = newQty > 0 ? (oldInvested - txnInvested) / newQty : 0;
  } else if (txn.type === 'sell') {
    // Reverse sell: restore qty
    newQty = curQty + txnQty;
    // avg_buy_price stays same (we don't reverse the cost basis calculation)
  }
  // dividend: no change to qty or avg

  // Delete the transaction
  const { error: delErr } = await supabase.from('transactions').delete().eq('id', txnId);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  // Update holding
  if (newQty <= 0) {
    // Delete holding if no units remain
    await supabase.from('holdings').delete().eq('id', holdingId);
    return NextResponse.json({ deleted: true, holdingDeleted: true });
  }

  const { error: updErr } = await supabase
    .from('holdings')
    .update({ quantity: newQty, avg_buy_price: Math.max(0, newAvg) })
    .eq('id', holdingId);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ deleted: true, holdingDeleted: false, newQty, newAvg });
}
