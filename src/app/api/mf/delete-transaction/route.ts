import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function recalcHolding(supabase: any, holdingId: string): Promise<{ deleted: boolean }> {
  const { data: buys } = await supabase
    .from('transactions')
    .select('quantity, price')
    .eq('holding_id', holdingId)
    .in('type', ['buy', 'sip']);

  const { data: sells } = await supabase
    .from('transactions')
    .select('quantity')
    .eq('holding_id', holdingId)
    .eq('type', 'sell');

  const totalBuyQty = (buys ?? []).reduce((s: number, t: { quantity: number }) => s + Number(t.quantity), 0);
  const totalBuyAmt = (buys ?? []).reduce((s: number, t: { quantity: number; price: number }) => s + Number(t.quantity) * Number(t.price), 0);
  const totalSellQty = (sells ?? []).reduce((s: number, t: { quantity: number }) => s + Number(t.quantity), 0);

  const netQty = totalBuyQty - totalSellQty;
  const avgPrice = totalBuyQty > 0 ? totalBuyAmt / totalBuyQty : 0;

  if (netQty <= 0 && totalBuyQty === 0) {
    // No buy transactions left — delete the holding
    await supabase.from('holdings').delete().eq('id', holdingId);
    return { deleted: true };
  }

  await supabase.from('holdings').update({ quantity: Math.max(0, netQty), avg_buy_price: avgPrice }).eq('id', holdingId);
  return { deleted: false };
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { transactionId } = await req.json();
  if (!transactionId) return NextResponse.json({ error: 'Missing transactionId' }, { status: 400 });

  // Fetch transaction with metadata for STP detection
  const { data: txn, error: txnErr } = await supabase
    .from('transactions')
    .select('id, holding_id, type, quantity, notes, metadata')
    .eq('id', transactionId)
    .single();

  if (txnErr || !txn) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });

  const meta = (txn.metadata ?? {}) as Record<string, unknown>;
  const stpLinkId = meta.stp_link_id as string | undefined;

  // ── STP cascade delete: delete BOTH sides + recalculate BOTH holdings ──
  if (stpLinkId) {
    // Find all linked STP transactions
    const { data: linkedTxns } = await supabase
      .from('transactions')
      .select('id, holding_id')
      .filter('metadata->>stp_link_id', 'eq', stpLinkId);

    const affectedHoldingIds = Array.from(new Set((linkedTxns ?? []).map((t: { holding_id: string }) => t.holding_id)));
    const linkedTxnIds = (linkedTxns ?? []).map((t: { id: string }) => t.id);

    // Delete all STP-linked transactions
    if (linkedTxnIds.length > 0) {
      const { error: delErr } = await supabase.from('transactions').delete().in('id', linkedTxnIds);
      if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    }

    // Recalculate each affected holding
    const holdingResults: { holdingId: string; deleted: boolean }[] = [];
    for (const hid of affectedHoldingIds) {
      const result = await recalcHolding(supabase, hid);
      holdingResults.push({ holdingId: hid, deleted: result.deleted });
    }

    return NextResponse.json({
      deleted: true,
      stpCascade: true,
      stpLinkId,
      deletedTransactions: linkedTxnIds.length,
      holdings: holdingResults,
    });
  }

  // ── Normal (non-STP) single-transaction delete ──

  const holdingId = txn.holding_id;

  // Delete the transaction
  const { error: delErr } = await supabase.from('transactions').delete().eq('id', transactionId);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  // Recalculate the holding
  const holdingResult = await recalcHolding(supabase, holdingId);

  // Handle dividend reinvestment: remove re-invested units
  if (txn.type === 'dividend' && txn.notes?.includes('Reinvestment')) {
    const match = String(txn.notes).match(/([\d.]+) units/);
    if (match) {
      const reinvestedUnits = parseFloat(match[1]);
      const { data: holding } = await supabase.from('holdings').select('quantity').eq('id', holdingId).single();
      if (holding) {
        const newQty = Math.max(0, Number(holding.quantity) - reinvestedUnits);
        await supabase.from('holdings').update({ quantity: newQty }).eq('id', holdingId);
      }
    }
  }

  return NextResponse.json({
    deleted: true,
    holdingId,
    holdingDeleted: holdingResult.deleted,
    ...(txn.type === 'sell' ? { unitsRestored: Number(txn.quantity) } : {}),
  });
}
