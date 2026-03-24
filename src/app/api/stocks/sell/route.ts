import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// FIFO sell: sell oldest shares first, compute STCG/LTCG

interface BuyLot {
  txnId: string;
  date: string;
  price: number;
  qty: number;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const {
    holdingId,
    quantity,
    price,    // sell price per share
    date,     // sell date
    brokerage = 0,
    stt       = 0,
    gst       = 0,
    stampDuty = 0,
    exchangeCharges = 0,
    dpCharges = 0,
  } = body;

  if (!holdingId || !quantity || !price || !date) {
    return NextResponse.json({ error: 'holdingId, quantity, price, date are required' }, { status: 400 });
  }

  const sellQty = parseFloat(quantity);
  const sellPx  = parseFloat(price);

  // ── Fetch holding ───────────────────────────────────────────────────────────
  const { data: holding, error: hErr } = await supabase
    .from('holdings')
    .select('id, quantity, avg_buy_price, metadata')
    .eq('id', holdingId)
    .eq('asset_type', 'indian_stock')
    .single();

  if (hErr || !holding) return NextResponse.json({ error: 'Holding not found' }, { status: 404 });

  const currentQty = Number(holding.quantity);
  if (sellQty > currentQty) {
    return NextResponse.json({ error: `Cannot sell ${sellQty} shares — only ${currentQty} held` }, { status: 400 });
  }

  // ── Get all buy transactions (FIFO: oldest first) ───────────────────────────
  const { data: txns } = await supabase
    .from('transactions')
    .select('id, date, price, quantity, type, notes')
    .eq('holding_id', holdingId)
    .in('type', ['buy', 'sip'])
    .order('date', { ascending: true });

  // Build lots — exclude bonus (price=0 marked in notes) for cost basis
  const buyLots: BuyLot[] = (txns ?? [])
    .filter(t => Number(t.quantity) > 0)
    .map(t => ({ txnId: t.id, date: t.date, price: Number(t.price), qty: Number(t.quantity) }));

  // FIFO: track which lots are consumed
  let remaining = sellQty;
  let stcgQty   = 0;
  let ltcgQty   = 0;
  let stcgCost  = 0;
  let ltcgCost  = 0;
  const sellDate = new Date(date);

  for (const lot of buyLots) {
    if (remaining <= 0) break;
    const fromLot = Math.min(remaining, lot.qty);
    const buyDate = new Date(lot.date);
    const msPerYear = 365.25 * 24 * 3600 * 1000;
    const yearsHeld = (sellDate.getTime() - buyDate.getTime()) / msPerYear;
    const isLTCG = yearsHeld >= 1;

    if (isLTCG) {
      ltcgQty  += fromLot;
      ltcgCost += fromLot * lot.price;
    } else {
      stcgQty  += fromLot;
      stcgCost += fromLot * lot.price;
    }
    remaining -= fromLot;
  }

  const totalSellValue = sellQty * sellPx;
  const totalCostBasis = stcgCost + ltcgCost;
  const totalFees      = parseFloat(brokerage) + parseFloat(stt) + parseFloat(gst) +
                         parseFloat(stampDuty) + parseFloat(exchangeCharges) + parseFloat(dpCharges);
  const netProceeds    = totalSellValue - totalFees;
  const pnl            = netProceeds - totalCostBasis;

  // Compute new holding qty and avg price
  const newQty = currentQty - sellQty;
  const currentAvg = Number(holding.avg_buy_price);
  // Keep avg_buy_price unchanged (it represents historical cost for remaining shares)

  // ── Update holding quantity ─────────────────────────────────────────────────
  const { error: updateErr } = await supabase
    .from('holdings')
    .update({ quantity: newQty, avg_buy_price: newQty > 0 ? currentAvg : 0 })
    .eq('id', holdingId);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  // ── Create sell transaction ─────────────────────────────────────────────────
  const stcgPnl = stcgQty > 0 ? (stcgQty * sellPx - stcgCost) : 0;
  const ltcgPnl = ltcgQty > 0 ? (ltcgQty * sellPx - ltcgCost) : 0;
  const notes = [
    `Sell at ₹${sellPx.toFixed(2)}/share`,
    stcgQty > 0 ? `STCG: ${stcgQty} shares (P&L: ₹${stcgPnl.toFixed(0)})` : '',
    ltcgQty > 0 ? `LTCG: ${ltcgQty} shares (P&L: ₹${ltcgPnl.toFixed(0)})` : '',
  ].filter(Boolean).join(' | ');

  const { error: txnErr } = await supabase.from('transactions').insert({
    holding_id: holdingId,
    type:       'sell',
    quantity:   sellQty,
    price:      sellPx,
    date:       date,
    fees:       totalFees,
    notes,
  });
  if (txnErr) return NextResponse.json({ error: txnErr.message }, { status: 500 });

  return NextResponse.json({
    holdingId,
    sellQty,
    sellPrice: sellPx,
    totalSellValue,
    totalCostBasis,
    totalFees,
    pnl,
    stcgQty, stcgCost, stcgPnl,
    ltcgQty, ltcgCost, ltcgPnl,
    remainingQty: newQty,
  });
}
