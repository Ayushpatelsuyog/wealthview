import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { action } = body;

  if (action === 'merger') return handleMerger(supabase, body);
  if (action === 'demerger') return handleDemerger(supabase, body);

  return NextResponse.json({ error: 'Invalid action. Use "merger" or "demerger".' }, { status: 400 });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any;

async function handleMerger(supabase: SB, body: Record<string, unknown>) {
  const {
    sourceHoldingId,
    targetStockSymbol, targetStockName, targetExchange,
    sharesReceived, cashPerShare = 0, recordDate,
    transferCostBasis = true,
    // Global stocks extras
    targetCurrency, targetCountry, targetSector, fxRate,
    assetType = 'indian_stock', // 'indian_stock' | 'global_stock'
  } = body;

  if (!sourceHoldingId || !targetStockSymbol || !targetStockName || !sharesReceived || !recordDate) {
    return NextResponse.json({ error: 'sourceHoldingId, targetStockSymbol, targetStockName, sharesReceived, recordDate are required' }, { status: 400 });
  }

  // 1. Fetch source holding
  const { data: source, error: srcErr } = await supabase
    .from('holdings')
    .select('id, symbol, name, quantity, avg_buy_price, metadata, portfolio_id, broker_id, asset_type')
    .eq('id', sourceHoldingId)
    .single();

  if (srcErr || !source) {
    return NextResponse.json({ error: 'Source holding not found' }, { status: 404 });
  }

  const oldQty = Number(source.quantity);
  const oldAvg = Number(source.avg_buy_price);
  const totalCost = oldQty * oldAvg;
  const received = Number(sharesReceived);
  const cashComp = Number(cashPerShare) * oldQty;

  // Cost basis for new holding
  const transferredCost = transferCostBasis ? totalCost - cashComp : 0;
  const newAvgPrice = received > 0 ? transferredCost / received : 0;

  // 2. Close source holding (set qty to 0)
  const sourceMeta = (source.metadata ?? {}) as Record<string, unknown>;
  const { error: closeErr } = await supabase
    .from('holdings')
    .update({
      quantity: 0,
      metadata: {
        ...sourceMeta,
        merged_into: targetStockName,
        merged_into_symbol: targetStockSymbol,
        merger_date: recordDate,
        merger_shares_received: received,
        corporate_action: 'merged',
      },
    })
    .eq('id', sourceHoldingId);

  if (closeErr) return NextResponse.json({ error: closeErr.message }, { status: 500 });

  // 3. Create merger_out transaction under source
  await supabase.from('transactions').insert({
    holding_id: sourceHoldingId,
    type: 'sell',
    quantity: oldQty,
    price: oldAvg,
    date: recordDate,
    fees: 0,
    notes: `Merger Out — ${oldQty} shares of ${source.name} merged into ${targetStockName}. Received ${received} shares.${cashComp > 0 ? ` Cash: ${cashComp}` : ''}`,
  });

  // 4. Determine asset type and build metadata for new holding
  const resolvedAssetType = source.asset_type || assetType;
  const isGlobal = resolvedAssetType === 'global_stock';

  const newMeta: Record<string, unknown> = {
    corporate_action: 'merger_in',
    from_stock: source.name,
    from_symbol: source.symbol,
    original_qty: oldQty,
    exchange_ratio: received / oldQty,
    merger_date: recordDate,
  };

  if (isGlobal) {
    newMeta.exchange = targetExchange;
    newMeta.currency = targetCurrency;
    newMeta.country = targetCountry;
    newMeta.sector = targetSector;
    newMeta.fx_rate = Number(fxRate) || 1;
  } else {
    if (targetExchange) newMeta.exchange = targetExchange;
    if (targetSector) newMeta.sector = targetSector;
  }

  // 5. Create new holding for acquiring company (same portfolio + broker)
  const symbol = String(targetStockSymbol).toUpperCase();
  const { data: newHolding, error: newErr } = await supabase
    .from('holdings')
    .insert({
      portfolio_id: source.portfolio_id,
      broker_id: source.broker_id,
      asset_type: resolvedAssetType,
      symbol,
      name: targetStockName,
      quantity: received,
      avg_buy_price: newAvgPrice,
      currency: isGlobal ? (targetCurrency || 'USD') : undefined,
      metadata: newMeta,
    })
    .select('id')
    .single();

  if (newErr) return NextResponse.json({ error: newErr.message }, { status: 500 });

  // 6. Create merger_in transaction under new holding
  await supabase.from('transactions').insert({
    holding_id: newHolding.id,
    type: 'buy',
    quantity: received,
    price: newAvgPrice,
    date: recordDate,
    fees: 0,
    notes: `Merger In — Received ${received} shares from merger of ${source.name} (${oldQty} shares). Cost basis transferred.`,
    metadata: isGlobal ? { fx_rate: Number(fxRate) || 1, currency: targetCurrency } : undefined,
  });

  return NextResponse.json({
    sourceHoldingId,
    newHoldingId: newHolding.id,
    oldStock: source.name,
    newStock: targetStockName,
    oldQty,
    sharesReceived: received,
    costBasisTransferred: transferredCost,
    cashReceived: cashComp,
  });
}

async function handleDemerger(supabase: SB, body: Record<string, unknown>) {
  const {
    sourceHoldingId,
    newStockSymbol, newStockName, newExchange,
    sharesReceived, costSplitRatio, recordDate,
    // Global stocks extras
    newCurrency, newCountry, newSector, fxRate,
    assetType = 'indian_stock',
  } = body;

  if (!sourceHoldingId || !newStockSymbol || !newStockName || !sharesReceived || costSplitRatio == null || !recordDate) {
    return NextResponse.json({ error: 'sourceHoldingId, newStockSymbol, newStockName, sharesReceived, costSplitRatio, recordDate are required' }, { status: 400 });
  }

  const ratio = Number(costSplitRatio); // fraction going to new company (0.30 = 30%)
  if (ratio <= 0 || ratio >= 1) {
    return NextResponse.json({ error: 'costSplitRatio must be between 0 and 1 (exclusive)' }, { status: 400 });
  }

  // 1. Fetch source holding
  const { data: source, error: srcErr } = await supabase
    .from('holdings')
    .select('id, symbol, name, quantity, avg_buy_price, metadata, portfolio_id, broker_id, asset_type')
    .eq('id', sourceHoldingId)
    .single();

  if (srcErr || !source) {
    return NextResponse.json({ error: 'Source holding not found' }, { status: 404 });
  }

  const oldQty = Number(source.quantity);
  const oldAvg = Number(source.avg_buy_price);
  const totalCost = oldQty * oldAvg;
  const received = Number(sharesReceived);

  // Cost split
  const costToNew = totalCost * ratio;
  const costRemaining = totalCost * (1 - ratio);
  const newParentAvg = oldQty > 0 ? costRemaining / oldQty : 0;
  const newChildAvg = received > 0 ? costToNew / received : 0;

  // 2. Adjust parent holding cost basis
  const sourceMeta = (source.metadata ?? {}) as Record<string, unknown>;
  const { error: parentErr } = await supabase
    .from('holdings')
    .update({
      avg_buy_price: newParentAvg,
      metadata: {
        ...sourceMeta,
        demerger_child: newStockName,
        demerger_child_symbol: newStockSymbol,
        demerger_date: recordDate,
        demerger_cost_split: ratio,
        original_avg_price: oldAvg,
      },
    })
    .eq('id', sourceHoldingId);

  if (parentErr) return NextResponse.json({ error: parentErr.message }, { status: 500 });

  // 3. Create demerger_out transaction (informational)
  await supabase.from('transactions').insert({
    holding_id: sourceHoldingId,
    type: 'buy',
    quantity: 0,
    price: 0,
    date: recordDate,
    fees: 0,
    notes: `Demerger Out — ${newStockName} spun off. Cost basis split: ${((1 - ratio) * 100).toFixed(0)}% retained, ${(ratio * 100).toFixed(0)}% transferred. Avg price adjusted from ₹${oldAvg.toFixed(2)} to ₹${newParentAvg.toFixed(2)}.`,
  });

  // 4. Build metadata for new holding
  const resolvedAssetType = source.asset_type || assetType;
  const isGlobal = resolvedAssetType === 'global_stock';

  const newMeta: Record<string, unknown> = {
    corporate_action: 'demerger_in',
    parent_stock: source.name,
    parent_symbol: source.symbol,
    cost_split_ratio: ratio,
    demerger_date: recordDate,
  };

  if (isGlobal) {
    newMeta.exchange = newExchange;
    newMeta.currency = newCurrency;
    newMeta.country = newCountry;
    newMeta.sector = newSector;
    newMeta.fx_rate = Number(fxRate) || 1;
  } else {
    if (newExchange) newMeta.exchange = newExchange;
    if (newSector) newMeta.sector = newSector;
  }

  // 5. Create new holding for demerged company
  const symbol = String(newStockSymbol).toUpperCase();
  const { data: newHolding, error: newErr } = await supabase
    .from('holdings')
    .insert({
      portfolio_id: source.portfolio_id,
      broker_id: source.broker_id,
      asset_type: resolvedAssetType,
      symbol,
      name: newStockName,
      quantity: received,
      avg_buy_price: newChildAvg,
      currency: isGlobal ? (newCurrency || 'USD') : undefined,
      metadata: newMeta,
    })
    .select('id')
    .single();

  if (newErr) return NextResponse.json({ error: newErr.message }, { status: 500 });

  // 6. Create demerger_in transaction
  await supabase.from('transactions').insert({
    holding_id: newHolding.id,
    type: 'buy',
    quantity: received,
    price: newChildAvg,
    date: recordDate,
    fees: 0,
    notes: `Demerger In — ${received} shares received from demerger of ${source.name}. Cost basis: ${(ratio * 100).toFixed(0)}% of original (₹${costToNew.toFixed(2)}).`,
    metadata: isGlobal ? { fx_rate: Number(fxRate) || 1, currency: newCurrency } : undefined,
  });

  return NextResponse.json({
    sourceHoldingId,
    newHoldingId: newHolding.id,
    parentStock: source.name,
    childStock: newStockName,
    parentQty: oldQty,
    childQty: received,
    parentNewAvg: newParentAvg,
    childAvg: newChildAvg,
    costRetained: costRemaining,
    costTransferred: costToNew,
  });
}
