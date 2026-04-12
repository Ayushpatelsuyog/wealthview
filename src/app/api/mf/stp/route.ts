import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { randomUUID } from 'crypto';

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function fetchNavOnDate(schemeCode: string, date: string): Promise<number | null> {
  try {
    const res = await fetch(`https://api.mfapi.in/mf/${schemeCode}`);
    if (!res.ok) return null;
    const json = await res.json();
    if (json.status !== 'SUCCESS' || !json.data?.length) return null;

    const targetMs = new Date(`${date}T00:00:00Z`).getTime();
    const parseDDMMYYYY = (s: string) => {
      const [d, m, y] = s.split('-');
      return new Date(`${y}-${m}-${d}T00:00:00Z`).getTime();
    };

    let best = json.data[0];
    let bestDiff = Math.abs(parseDDMMYYYY(best.date) - targetMs);
    for (const entry of json.data) {
      const diff = Math.abs(parseDDMMYYYY(entry.date) - targetMs);
      if (diff < bestDiff) { bestDiff = diff; best = entry; }
    }
    return parseFloat(best.nav);
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function recalcHolding(supabase: any, holdingId: string) {
  const { data: h } = await supabase
    .from('holdings')
    .select('id, transactions(type, quantity, price, notes)')
    .eq('id', holdingId)
    .single();

  if (!h) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const txns = (h.transactions ?? []) as any[];
  let qty = 0;
  let totalCost = 0;

  // Simple recalc: sum buy units and cost, subtract sell units FIFO
  const buys = txns.filter(t => (t.type === 'buy' || t.type === 'sip')).sort();
  const sells = txns.filter(t => t.type === 'sell');

  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  for (const b of buys) {
    qty += r3(Number(b.quantity));
    totalCost += Number(b.quantity) * Number(b.price);
  }
  for (const s of sells) {
    qty -= r3(Number(s.quantity));
    totalCost -= Number(s.quantity) * Number(s.price);
  }

  const avg = qty > 0 ? totalCost / qty : 0;
  await supabase.from('holdings').update({ quantity: Math.max(0, qty), avg_buy_price: avg }).eq('id', holdingId);
}

// ─── Route ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const {
      sourceHoldingId,
      destinationHoldingId,
      destinationSchemeCode,
      destinationSchemeName,
      destinationFundHouse,
      destinationCategory,
      date,
      amount,
      portfolioName,
      brokerId,
      memberId,
      familyId,
    } = await req.json();

    if (!sourceHoldingId || !date || !amount) {
      return NextResponse.json({ error: 'sourceHoldingId, date, and amount are required' }, { status: 400 });
    }
    if (!destinationHoldingId && !destinationSchemeCode) {
      return NextResponse.json({ error: 'Either destinationHoldingId or destinationSchemeCode required' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ── Fetch source holding ──
    const { data: sourceHolding, error: sHErr } = await supabase
      .from('holdings')
      .select('id, symbol, name, quantity, avg_buy_price, metadata, portfolio_id, broker_id')
      .eq('id', sourceHoldingId)
      .eq('asset_type', 'mutual_fund')
      .single();
    if (sHErr || !sourceHolding) {
      return NextResponse.json({ error: 'Source holding not found' }, { status: 404 });
    }

    const amountNum = Number(amount);

    // ── Fetch source NAV on date ──
    const sourceNav = await fetchNavOnDate(sourceHolding.symbol, date);
    if (!sourceNav || sourceNav <= 0) {
      return NextResponse.json({ error: 'Could not fetch source NAV for the given date' }, { status: 502 });
    }
    const sourceUnits = amountNum / sourceNav;

    if (sourceUnits > Number(sourceHolding.quantity)) {
      return NextResponse.json({
        error: `Insufficient units in source fund. Have ${Number(sourceHolding.quantity).toFixed(3)}, need ${sourceUnits.toFixed(3)}`,
      }, { status: 400 });
    }

    // ── Resolve destination holding (create if not exists) ──
    let destHoldingId = destinationHoldingId;
    let destSchemeCode: string;
    let destSchemeName: string;

    if (destHoldingId) {
      const { data: destHolding } = await supabase
        .from('holdings')
        .select('id, symbol, name')
        .eq('id', destHoldingId)
        .single();
      if (!destHolding) {
        return NextResponse.json({ error: 'Destination holding not found' }, { status: 404 });
      }
      destSchemeCode = destHolding.symbol;
      destSchemeName = destHolding.name;
    } else {
      // Create new destination holding
      destSchemeCode = String(destinationSchemeCode);
      destSchemeName = String(destinationSchemeName ?? 'Unknown Fund');

      // Resolve portfolio
      const targetPortfolioName = portfolioName || 'Long-term Growth';
      let targetPortfolioId: string;
      const { data: existingPort } = await supabase
        .from('portfolios').select('id')
        .eq('family_id', familyId).eq('user_id', memberId).eq('name', targetPortfolioName).maybeSingle();
      if (existingPort) {
        targetPortfolioId = existingPort.id;
      } else {
        const { data: newPort, error: pErr } = await supabase.from('portfolios').insert({
          user_id: memberId, family_id: familyId, name: targetPortfolioName, type: 'personal',
        }).select('id').single();
        if (pErr || !newPort) return NextResponse.json({ error: pErr?.message ?? 'Failed to create portfolio' }, { status: 500 });
        targetPortfolioId = newPort.id;
      }

      const { data: newHolding, error: hErr } = await supabase
        .from('holdings')
        .insert({
          portfolio_id: targetPortfolioId,
          broker_id: brokerId || sourceHolding.broker_id,
          asset_type: 'mutual_fund',
          symbol: destSchemeCode,
          name: destSchemeName,
          quantity: 0,
          avg_buy_price: 0,
          currency: 'INR',
          metadata: {
            fund_house: destinationFundHouse ?? null,
            category: destinationCategory ?? null,
          },
        })
        .select('id').single();

      if (hErr || !newHolding) {
        return NextResponse.json({ error: hErr?.message ?? 'Failed to create destination holding' }, { status: 500 });
      }
      destHoldingId = newHolding.id;
    }

    // ── Fetch destination NAV on date ──
    const destNav = await fetchNavOnDate(destSchemeCode, date);
    if (!destNav || destNav <= 0) {
      return NextResponse.json({ error: 'Could not fetch destination NAV for the given date' }, { status: 502 });
    }
    const destUnits = amountNum / destNav;

    // ── Generate STP link ID ──
    const stpLinkId = randomUUID();

    // ── Create SELL transaction on source ──
    const { data: sellTxn, error: sellErr } = await supabase.from('transactions').insert({
      holding_id: sourceHoldingId,
      type: 'sell',
      quantity: sourceUnits,
      price: sourceNav,
      date,
      fees: 0,
      notes: `STP out to ${destSchemeName} (₹${amountNum.toFixed(0)})`,
      metadata: {
        stp_link_id: stpLinkId,
        stp_role: 'source',
        stp_counterpart_holding_id: destHoldingId,
        stp_counterpart_scheme_name: destSchemeName,
        amount: amountNum,
      },
    }).select('id').single();

    if (sellErr || !sellTxn) {
      return NextResponse.json({ error: sellErr?.message ?? 'Failed to create sell transaction' }, { status: 500 });
    }

    // ── Create BUY transaction on destination ──
    const { data: buyTxn, error: buyErr } = await supabase.from('transactions').insert({
      holding_id: destHoldingId,
      type: 'buy',
      quantity: destUnits,
      price: destNav,
      date,
      fees: 0,
      notes: `STP in from ${sourceHolding.name} (₹${amountNum.toFixed(0)})`,
      metadata: {
        stp_link_id: stpLinkId,
        stp_role: 'destination',
        stp_counterpart_holding_id: sourceHoldingId,
        stp_counterpart_scheme_name: sourceHolding.name,
        amount: amountNum,
      },
    }).select('id').single();

    if (buyErr || !buyTxn) {
      // Rollback sell
      await supabase.from('transactions').delete().eq('id', sellTxn.id);
      return NextResponse.json({ error: buyErr?.message ?? 'Failed to create buy transaction' }, { status: 500 });
    }

    // ── Recalculate holdings ──
    await recalcHolding(supabase, sourceHoldingId);
    await recalcHolding(supabase, destHoldingId);

    return NextResponse.json({
      success: true,
      stpLinkId,
      sellTxnId: sellTxn.id,
      buyTxnId: buyTxn.id,
      sourceHoldingId,
      destHoldingId,
      sourceNav,
      destNav,
      sourceUnits,
      destUnits,
      amount: amountNum,
    });
  } catch (err) {
    console.error('[api/mf/stp]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
