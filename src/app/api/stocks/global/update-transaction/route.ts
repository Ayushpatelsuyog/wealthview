import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { txn_id, holding_id, quantity, price, date, fees, notes, metadata } = body;

  if (!txn_id || !holding_id) {
    return NextResponse.json({ error: 'txn_id and holding_id required' }, { status: 400 });
  }

  // 1. Update the transaction record
  const updateFields: Record<string, unknown> = {};
  if (quantity !== undefined) updateFields.quantity = parseFloat(String(quantity)) || 0;
  if (price !== undefined)    updateFields.price = parseFloat(String(price)) || 0;
  if (date !== undefined)     updateFields.date = date;
  if (fees !== undefined)     updateFields.fees = parseFloat(String(fees)) || 0;
  if (notes !== undefined)    updateFields.notes = notes;
  if (metadata !== undefined) updateFields.metadata = metadata;

  const { error: updateErr } = await supabase
    .from('transactions')
    .update(updateFields)
    .eq('id', txn_id);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  // 2. Recalculate holding from ALL transactions
  const { data: allTxns, error: txnErr } = await supabase
    .from('transactions')
    .select('id, type, quantity, price, date, fees, notes, metadata')
    .eq('holding_id', holding_id)
    .order('date', { ascending: true });
  if (txnErr) return NextResponse.json({ error: txnErr.message }, { status: 500 });

  // Replay all transactions to compute qty and avg_buy_price
  let totalQty = 0;
  let totalCost = 0; // in local currency

  for (const txn of (allTxns ?? [])) {
    const tQty = Number(txn.quantity) || 0;
    const tPx = Number(txn.price) || 0;

    if (txn.type === 'buy' || txn.type === 'sip') {
      totalCost += tQty * tPx;
      totalQty += tQty;
    } else if (txn.type === 'sell') {
      // Reduce qty, adjust cost proportionally
      if (totalQty > 0) {
        const avgBefore = totalCost / totalQty;
        totalQty = Math.max(0, totalQty - tQty);
        totalCost = totalQty * avgBefore;
      }
    }
    // dividend: no qty/cost change
  }

  const avgBuyPrice = totalQty > 0 ? totalCost / totalQty : 0;

  // 3. Update holding
  const { error: holdingErr } = await supabase
    .from('holdings')
    .update({ quantity: totalQty, avg_buy_price: avgBuyPrice })
    .eq('id', holding_id);
  if (holdingErr) return NextResponse.json({ error: holdingErr.message }, { status: 500 });

  return NextResponse.json({ success: true, quantity: totalQty, avg_buy_price: avgBuyPrice });
}
