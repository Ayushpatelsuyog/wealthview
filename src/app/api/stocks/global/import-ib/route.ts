import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { parseIBActivityStatement, ibSymbolToYahoo } from '@/lib/utils/ib-csv-parser';
import type { IBHolding } from '@/lib/utils/ib-csv-parser';

// ─── Parse-only endpoint (POST with CSV text) ───────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const contentType = req.headers.get('content-type') || '';

  // ── Mode 1: Parse CSV (content-type: multipart/form-data or text/plain) ──
  if (contentType.includes('multipart/form-data') || contentType.includes('text/plain')) {
    let csvText = '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file');
      if (!file || !(file instanceof File)) {
        return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
      }
      csvText = await file.text();
    } else {
      csvText = await req.text();
    }

    if (!csvText.trim()) {
      return NextResponse.json({ error: 'Empty CSV file' }, { status: 400 });
    }

    try {
      const result = parseIBActivityStatement(csvText);
      return NextResponse.json({ action: 'parse', ...result });
    } catch (err) {
      console.error('[IB Import] Parse error:', err);
      return NextResponse.json({ error: 'Failed to parse CSV: ' + (err as Error).message }, { status: 400 });
    }
  }

  // ── Mode 2: Import parsed holdings (content-type: application/json) ──
  const body = await req.json();
  const { action } = body;

  if (action !== 'import') {
    return NextResponse.json({ error: 'Invalid action. Use multipart for parse, JSON with action=import for import.' }, { status: 400 });
  }

  const {
    holdings,   // IBHolding[] — selected holdings to import
    familyId,
    memberId,
    brokerId,
    portfolioName = 'Long-term Growth',
    fxRates,    // Record<string, Record<string, number>> — { "USD": { "2025-04-07": 85.50, ... } }
  } = body as {
    holdings: IBHolding[];
    familyId: string;
    memberId: string;
    brokerId: string;
    portfolioName: string;
    fxRates: Record<string, Record<string, number>>;
  };

  if (!holdings || !familyId || !memberId || !brokerId) {
    return NextResponse.json({ error: 'holdings, familyId, memberId, brokerId required' }, { status: 400 });
  }

  // ── Get user profile ──
  const { data: profile } = await supabase.from('users').select('family_id, name').eq('id', user.id).single();
  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 500 });

  // ── Ensure portfolio ──
  const { data: existingPortfolio } = await supabase
    .from('portfolios').select('id').eq('family_id', familyId).eq('name', portfolioName).eq('user_id', memberId).maybeSingle();

  let portfolioId: string;
  if (existingPortfolio) {
    portfolioId = existingPortfolio.id;
  } else {
    const { data: newPortfolio, error: portErr } = await supabase
      .from('portfolios')
      .insert({ user_id: memberId, family_id: familyId, name: portfolioName, type: 'personal' })
      .select('id').single();
    if (portErr) return NextResponse.json({ error: portErr.message }, { status: 500 });
    portfolioId = newPortfolio.id;
  }

  // ── Create import batch ──
  const { data: batch, error: batchErr } = await supabase
    .from('import_batches')
    .insert({
      family_id: familyId,
      user_id: memberId,
      source_filename: 'IB Activity Statement',
      source_type: 'ibkr_activity',
      funds_count: holdings.length,
      total_invested: holdings.reduce((s, h) => s + h.totalInvested, 0),
    })
    .select('id').single();
  if (batchErr) return NextResponse.json({ error: batchErr.message }, { status: 500 });
  const batchId = batch.id;

  // ── Import each holding ──
  const results: { symbol: string; holdingId: string; trades: number; status: string }[] = [];
  const errors: { symbol: string; error: string }[] = [];

  for (const h of holdings as IBHolding[]) {
    try {
      const yahooSymbol = ibSymbolToYahoo(h.symbol, h.currency);
      const fxRateForCurrency = fxRates?.[h.currency] || {};

      // Get the most recent FX rate for the holding metadata
      const sortedTrades = [...h.trades].sort((a, b) => b.date.localeCompare(a.date));
      const latestFx = fxRateForCurrency[sortedTrades[0]?.date] || 1;

      // Check if holding already exists (same symbol, broker, portfolio)
      const { data: existingHolding } = await supabase
        .from('holdings')
        .select('id, quantity, avg_buy_price, metadata')
        .eq('portfolio_id', portfolioId)
        .eq('symbol', yahooSymbol.toUpperCase())
        .eq('asset_type', 'global_stock')
        .eq('broker_id', brokerId)
        .maybeSingle();

      let holdingId: string;

      if (existingHolding) {
        // Update existing holding
        holdingId = existingHolding.id;
        const oldQty = Number(existingHolding.quantity);
        const oldAvg = Number(existingHolding.avg_buy_price);
        const newQty = oldQty + h.netQuantity;
        const newAvg = newQty > 0
          ? (oldQty * oldAvg + h.netQuantity * h.avgBuyPrice) / newQty
          : oldAvg;

        const existingMeta = (existingHolding.metadata ?? {}) as Record<string, unknown>;
        await supabase.from('holdings').update({
          quantity: Math.max(0, newQty),
          avg_buy_price: newAvg,
          metadata: { ...existingMeta, fx_rate: latestFx, currency: h.currency, ib_symbol: h.symbol },
        }).eq('id', holdingId);
      } else {
        // Create new holding
        const { data: newHolding, error: hErr } = await supabase
          .from('holdings')
          .insert({
            portfolio_id: portfolioId,
            broker_id: brokerId,
            asset_type: 'global_stock',
            symbol: yahooSymbol.toUpperCase(),
            name: h.name || h.symbol,
            quantity: Math.max(0, h.netQuantity),
            avg_buy_price: h.avgBuyPrice,
            currency: h.currency,
            import_batch_id: batchId,
            metadata: {
              currency: h.currency,
              fx_rate: latestFx,
              ib_symbol: h.symbol,
              total_commissions: h.totalCommissions,
              import_source: 'ibkr',
            },
          })
          .select('id').single();

        if (hErr || !newHolding) {
          errors.push({ symbol: h.symbol, error: hErr?.message || 'Failed to create holding' });
          continue;
        }
        holdingId = newHolding.id;
      }

      // ── Create transactions ──
      let txnCount = 0;
      for (const trade of h.trades) {
        const tradeFx = fxRateForCurrency[trade.date] || latestFx;
        const txnType = trade.type === 'buy' ? 'buy' : 'sell';

        const notes = `${trade.type === 'buy' ? 'Buy' : 'Sell'} ${trade.quantity} ${h.symbol} @ ${h.currency} ${trade.price.toFixed(2)} | FX: ${tradeFx} | IB Import`;

        const { error: txnErr } = await supabase.from('transactions').insert({
          holding_id: holdingId,
          type: txnType,
          quantity: trade.quantity,
          price: trade.price,
          date: trade.date,
          fees: trade.commission,
          notes,
          metadata: {
            fx_rate: tradeFx,
            currency: h.currency,
            price_local: trade.price,
            brokerage: trade.commission,
            withholding_tax: 0,
            realized_pnl: trade.realizedPnl,
            import_source: 'ibkr',
            import_batch_id: batchId,
          },
        });

        if (txnErr) {
          console.error(`[IB Import] Transaction error for ${h.symbol}:`, txnErr.message);
        } else {
          txnCount++;
        }
      }

      results.push({ symbol: h.symbol, holdingId, trades: txnCount, status: 'ok' });
    } catch (err) {
      errors.push({ symbol: h.symbol, error: (err as Error).message });
    }
  }

  return NextResponse.json({
    action: 'import',
    batchId,
    imported: results.length,
    totalTrades: results.reduce((s, r) => s + r.trades, 0),
    results,
    errors,
  });
}
