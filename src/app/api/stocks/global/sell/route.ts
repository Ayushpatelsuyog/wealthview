import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

interface BuyLot {
  txnId: string;
  date: string;
  price: number;       // local currency price
  qty: number;
  fxRate: number;      // FX rate at time of purchase
}

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

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const {
    holdingId,
    quantity,
    price,        // sell price in local currency
    date,         // sell date
    fxRate = 1,   // current FX rate to INR
    brokerage = 0,
    notes: userNotes,
  } = body;

  if (!holdingId || !quantity || !price || !date) {
    return NextResponse.json({ error: 'holdingId, quantity, price, date are required' }, { status: 400 });
  }

  const sellQty    = parseFloat(quantity);
  const sellPx     = parseFloat(price);      // local currency
  const sellFxRate = parseFloat(String(fxRate)) || 1;
  const totalFees  = parseFloat(String(brokerage)) || 0;

  // -- Fetch holding --
  const { data: holding, error: hErr } = await supabase
    .from('holdings')
    .select('id, quantity, avg_buy_price, metadata, currency')
    .eq('id', holdingId)
    .eq('asset_type', 'global_stock')
    .single();

  if (hErr || !holding) return NextResponse.json({ error: 'Holding not found' }, { status: 404 });

  const currentQty = Number(holding.quantity);
  if (sellQty > currentQty) {
    return NextResponse.json({ error: `Cannot sell ${sellQty} shares - only ${currentQty} held` }, { status: 400 });
  }

  const holdingCurrency = holding.currency ?? (holding.metadata as Record<string, unknown>)?.currency ?? 'USD';

  // -- Get all buy transactions (FIFO: oldest first) --
  const { data: txns } = await supabase
    .from('transactions')
    .select('id, date, price, quantity, type, notes')
    .eq('holding_id', holdingId)
    .in('type', ['buy', 'sip'])
    .order('date', { ascending: true });

  // Build lots with FX rate info
  const buyLots: BuyLot[] = (txns ?? [])
    .filter(t => Number(t.quantity) > 0)
    .map(t => {
      const meta = parseTxnMetadata(t.notes);
      return {
        txnId: t.id,
        date: t.date,
        price: meta?.price_local ?? Number(t.price),  // local currency
        qty: Number(t.quantity),
        fxRate: meta?.fx_rate ?? 1,
      };
    });

  // FIFO: sell oldest shares first
  let remaining   = sellQty;
  let stcgQty     = 0;
  let ltcgQty     = 0;
  let stcgCostLocal = 0;
  let ltcgCostLocal = 0;
  let weightedBuyFxRate = 0;  // weighted avg FX rate of sold lots
  const sellDate  = new Date(date);

  for (const lot of buyLots) {
    if (remaining <= 0) break;
    const fromLot = Math.min(remaining, lot.qty);
    const buyDate = new Date(lot.date);
    const msPerYear = 365.25 * 24 * 3600 * 1000;
    const yearsHeld = (sellDate.getTime() - buyDate.getTime()) / msPerYear;
    const isLTCG = yearsHeld >= 1;

    if (isLTCG) {
      ltcgQty      += fromLot;
      ltcgCostLocal += fromLot * lot.price;
    } else {
      stcgQty      += fromLot;
      stcgCostLocal += fromLot * lot.price;
    }
    weightedBuyFxRate += fromLot * lot.fxRate;
    remaining -= fromLot;
  }

  const avgBuyFxRate = sellQty > 0 ? weightedBuyFxRate / sellQty : 1;
  const avgBuyPriceLocal = Number(holding.avg_buy_price);

  // P&L in local currency
  const totalSellValueLocal = sellQty * sellPx;
  const totalCostBasisLocal = stcgCostLocal + ltcgCostLocal;
  const pnlLocal            = totalSellValueLocal - totalCostBasisLocal - totalFees;

  // P&L in INR
  const totalSellValueINR  = totalSellValueLocal * sellFxRate;
  const totalCostBasisINR  = (stcgCostLocal * avgBuyFxRate) + (ltcgCostLocal * avgBuyFxRate);
  const pnlINR             = totalSellValueINR - totalCostBasisINR - (totalFees * sellFxRate);

  // FX gain/loss: impact of currency movement on the investment
  const fxImpact = (sellFxRate - avgBuyFxRate) * sellQty * avgBuyPriceLocal;

  // -- Update holding quantity & recalculate avg_buy_price (FIFO) --
  const newQty    = currentQty - sellQty;

  // Compute FIFO cost basis of remaining shares
  const totalBuyQty = buyLots.reduce((s, l) => s + l.qty, 0);
  const totalConsumed = totalBuyQty - newQty;
  let tempConsumed = 0;
  let remainingCostLocal = 0;
  let remainingQty = 0;
  for (const lot of buyLots) {
    const toConsume = Math.min(lot.qty, Math.max(0, totalConsumed - tempConsumed));
    const kept = lot.qty - toConsume;
    if (kept > 0) {
      remainingCostLocal += kept * lot.price;
      remainingQty += kept;
    }
    tempConsumed += toConsume;
  }
  const newAvgPrice = remainingQty > 0 ? remainingCostLocal / remainingQty : 0;

  const { error: updateErr } = await supabase
    .from('holdings')
    .update({ quantity: newQty, avg_buy_price: newQty > 0 ? newAvgPrice : 0 })
    .eq('id', holdingId);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  // -- Create sell transaction --
  const stcgPnlLocal = stcgQty > 0 ? (stcgQty * sellPx - stcgCostLocal) : 0;
  const ltcgPnlLocal = ltcgQty > 0 ? (ltcgQty * sellPx - ltcgCostLocal) : 0;

  const noteParts = [
    `Sell ${sellQty} @ ${holdingCurrency} ${sellPx.toFixed(2)}`,
    stcgQty > 0 ? `STCG: ${stcgQty} shares (P&L: ${holdingCurrency} ${stcgPnlLocal.toFixed(0)})` : '',
    ltcgQty > 0 ? `LTCG: ${ltcgQty} shares (P&L: ${holdingCurrency} ${ltcgPnlLocal.toFixed(0)})` : '',
    userNotes ?? '',
  ].filter(Boolean).join(' | ');

  const metadataJson = JSON.stringify({
    fx_rate: sellFxRate,
    currency: holdingCurrency,
    price_local: sellPx,
    pnl_local: Math.round(pnlLocal * 100) / 100,
    pnl_inr: Math.round(pnlINR * 100) / 100,
    fx_impact: Math.round(fxImpact * 100) / 100,
  });
  const fullNotes = noteParts + ` | meta:${metadataJson}`;

  const { error: txnErr } = await supabase.from('transactions').insert({
    holding_id: holdingId,
    type:       'sell',
    quantity:   sellQty,
    price:      sellPx,
    date:       date,
    fees:       totalFees,
    notes:      fullNotes,
  });
  if (txnErr) return NextResponse.json({ error: txnErr.message }, { status: 500 });

  return NextResponse.json({
    holdingId,
    sellQty,
    sellPrice: sellPx,
    currency: holdingCurrency,
    totalSellValueLocal,
    totalCostBasisLocal,
    pnlLocal: Math.round(pnlLocal * 100) / 100,
    totalSellValueINR: Math.round(totalSellValueINR * 100) / 100,
    totalCostBasisINR: Math.round(totalCostBasisINR * 100) / 100,
    pnlINR: Math.round(pnlINR * 100) / 100,
    fxImpact: Math.round(fxImpact * 100) / 100,
    avgBuyFxRate: Math.round(avgBuyFxRate * 10000) / 10000,
    sellFxRate,
    totalFees,
    stcgQty, stcgCostLocal, stcgPnlLocal: Math.round(stcgPnlLocal * 100) / 100,
    ltcgQty, ltcgCostLocal, ltcgPnlLocal: Math.round(ltcgPnlLocal * 100) / 100,
    remainingQty: newQty,
  });
}
