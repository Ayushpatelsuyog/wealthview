import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { randomUUID } from 'crypto';
import { STT_RATE_EQUITY_MF, isEquityOrientedForSTT } from '@/lib/utils/mf-stt';
import { isSameAmc } from '@/lib/utils/mf-amc';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseDDMMYYYY(s: string): number {
  const [d, m, y] = s.split('-');
  return new Date(`${y}-${m}-${d}T00:00:00Z`).getTime();
}

/** Fetch full NAV history for a scheme. Cached per request. */
async function fetchNavHistory(schemeCode: string): Promise<Array<{ date: string; nav: string }> | null> {
  try {
    const res = await fetch(`https://api.mfapi.in/mf/${schemeCode}`);
    if (!res.ok) return null;
    const json = await res.json();
    if (json.status !== 'SUCCESS' || !json.data?.length) return null;
    return json.data as Array<{ date: string; nav: string }>;
  } catch {
    return null;
  }
}

/** Find the NAV entry closest to targetDate (bidirectional). Used for destination leg. */
function findClosestNav(history: Array<{ date: string; nav: string }>, date: string): { nav: number; navDate: string } | null {
  const targetMs = new Date(`${date}T00:00:00Z`).getTime();
  let best = history[0];
  let bestDiff = Math.abs(parseDDMMYYYY(best.date) - targetMs);
  for (const entry of history) {
    const diff = Math.abs(parseDDMMYYYY(entry.date) - targetMs);
    if (diff < bestDiff) { bestDiff = diff; best = entry; }
  }
  return { nav: parseFloat(best.nav), navDate: best.date };
}

/**
 * Find the latest NAV strictly before targetDate.
 * Skips weekends/holidays automatically because mfapi only has entries for business days.
 * Returns null if no prior NAV exists.
 */
function findNavStrictlyBefore(history: Array<{ date: string; nav: string }>, date: string): { nav: number; navDate: string } | null {
  const targetMs = new Date(`${date}T00:00:00Z`).getTime();
  let best: { date: string; nav: string } | null = null;
  let bestMs = -Infinity;

  for (const entry of history) {
    const entryMs = parseDDMMYYYY(entry.date);
    if (entryMs < targetMs && entryMs > bestMs) {
      bestMs = entryMs;
      best = entry;
    }
  }

  if (!best) return null;
  return { nav: parseFloat(best.nav), navDate: best.date };
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

  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const buys = txns.filter(t => (t.type === 'buy' || t.type === 'sip')).sort();
  const sells = txns.filter(t => t.type === 'sell');

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
    const body = await req.json();
    const {
      sourceHoldingId,
      destinationHoldingId,
      destinationSchemeCode,
      destinationSchemeName,
      destinationFundHouse: _destinationFundHouse,
      destinationCategory,
      date,
      amount,
      portfolioName,
      brokerId,
      memberId,
      familyId,
      preview, // if true, return computed values without writing
    } = body;

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

    // ── Fetch source NAV: strictly before STP date (T-1 business day) ──
    const sourceHistory = await fetchNavHistory(sourceHolding.symbol);
    if (!sourceHistory) {
      return NextResponse.json({ error: 'Could not fetch source fund NAV history' }, { status: 502 });
    }
    const sourceResult = findNavStrictlyBefore(sourceHistory, date);
    if (!sourceResult || sourceResult.nav <= 0) {
      return NextResponse.json({ error: `No NAV available before ${date} for source fund. The prior business day\'s NAV may not yet be published.` }, { status: 502 });
    }
    const sourceNav = sourceResult.nav;
    const sourceNavDate = sourceResult.navDate; // DD-MM-YYYY format
    const sourceNavDateISO = (() => { const [d, m, y] = sourceNavDate.split('-'); return `${y}-${m}-${d}`; })();
    const sourceUnits = Math.round((amountNum / sourceNav) * 1000) / 1000;

    if (sourceUnits > Number(sourceHolding.quantity)) {
      return NextResponse.json({
        error: `Insufficient units in source fund. Have ${Number(sourceHolding.quantity).toFixed(3)}, need ${sourceUnits.toFixed(3)}`,
      }, { status: 400 });
    }

    // ── Resolve destination scheme code + fund house ──
    let destSchemeCode: string;
    let destSchemeName: string;
    let destFundHouse: string | null = null;

    if (destinationHoldingId) {
      const { data: destHolding } = await supabase
        .from('holdings').select('id, symbol, name, metadata').eq('id', destinationHoldingId).single();
      if (!destHolding) return NextResponse.json({ error: 'Destination holding not found' }, { status: 404 });
      destSchemeCode = destHolding.symbol;
      destSchemeName = destHolding.name;
      destFundHouse = String((destHolding.metadata as Record<string, unknown>)?.fund_house ?? '') || null;
    } else {
      destSchemeCode = String(destinationSchemeCode);
      destSchemeName = String(destinationSchemeName ?? 'Unknown Fund');
    }

    // ── Fetch destination NAV: closest to STP date (same-day preferred) ──
    // Also extract fund_house from the NAV response for new holdings
    const destHistory = await fetchNavHistory(destSchemeCode);
    if (!destHistory) {
      return NextResponse.json({ error: 'Could not fetch destination fund NAV history' }, { status: 502 });
    }
    const destResult = findClosestNav(destHistory, date);
    if (!destResult || destResult.nav <= 0) {
      return NextResponse.json({ error: 'Could not fetch destination NAV for the given date' }, { status: 502 });
    }
    const destNav = destResult.nav;
    const destNavDate = destResult.navDate;

    // For new funds, fetch fund_house from NAV API (fixes the bug where source fund_house was used)
    if (!destFundHouse) {
      try {
        const navRes = await fetch(`https://api.mfapi.in/mf/${destSchemeCode}/latest`);
        if (navRes.ok) {
          const navJson = await navRes.json();
          destFundHouse = navJson?.meta?.fund_house ?? null;
        }
      } catch { /* proceed without — AMC check will handle */ }
    }

    // ── Cross-AMC check (authoritative server-side gate) ──
    const sourceMeta = (sourceHolding.metadata ?? {}) as Record<string, unknown>;
    const sourceFundHouse = String(sourceMeta.fund_house ?? '') || null;
    const amcCheck = isSameAmc(sourceFundHouse, destFundHouse);
    if (!amcCheck.match) {
      return NextResponse.json({
        error: `Cross-AMC STPs are not permitted. Source: ${sourceFundHouse || 'Unknown AMC'}. Destination: ${destFundHouse || 'Unknown AMC'}. (${amcCheck.reason})`,
      }, { status: 400 });
    }

    // ── Stamp duty on destination (buy) side ──
    const STAMP_DUTY_CUTOFF = '2020-07-01';
    const applyStampDuty = date >= STAMP_DUTY_CUTOFF;
    const destStampDuty = applyStampDuty ? Math.round(amountNum * 0.00005 * 100) / 100 : 0;
    const destEffectiveAmount = amountNum - destStampDuty;
    const destUnits = Math.round((destEffectiveAmount / destNav) * 1000) / 1000;

    // ── STT on source sell (equity funds only) ──
    const sourceCategory = String(sourceMeta.category ?? '');
    const sourceIsEquity = isEquityOrientedForSTT(sourceCategory);
    const sourceStpStt = sourceIsEquity ? Math.round(amountNum * STT_RATE_EQUITY_MF * 100) / 100 : 0;

    // ── Preview mode: return computed values without writing ──
    if (preview) {
      return NextResponse.json({
        preview: true,
        source: {
          holdingId: sourceHoldingId,
          schemeName: sourceHolding.name,
          date: sourceNavDateISO,
          navDate: sourceNavDate,
          nav: sourceNav,
          units: sourceUnits,
          stt: sourceStpStt,
          isEquityFund: sourceIsEquity,
          category: sourceCategory,
        },
        destination: {
          schemeName: destSchemeName,
          date,
          navDate: destNavDate,
          nav: destNav,
          units: destUnits,
          stampDuty: destStampDuty,
          effectiveAmount: destEffectiveAmount,
        },
        amount: amountNum,
      });
    }

    // ── Write mode: create holdings and transactions ──

    // Resolve or create destination holding
    let destHoldingId = destinationHoldingId;
    if (!destHoldingId) {
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
          metadata: { fund_house: destFundHouse ?? null, category: destinationCategory ?? null },
        })
        .select('id').single();
      if (hErr || !newHolding) return NextResponse.json({ error: hErr?.message ?? 'Failed to create destination holding' }, { status: 500 });
      destHoldingId = newHolding.id;
    }

    const stpLinkId = randomUUID();

    // ── Create SELL transaction on source (date = T-1 NAV date) ──
    const { data: sellTxn, error: sellErr } = await supabase.from('transactions').insert({
      holding_id: sourceHoldingId,
      type: 'sell',
      quantity: sourceUnits,
      price: sourceNav,
      date: sourceNavDateISO, // T-1 business day
      fees: sourceStpStt,
      notes: `STP out to ${destSchemeName} (₹${amountNum.toFixed(0)})`,
      metadata: {
        stp_link_id: stpLinkId,
        stp_role: 'source',
        stp_counterpart_holding_id: destHoldingId,
        stp_counterpart_scheme_name: destSchemeName,
        amount: amountNum,
        stt: sourceStpStt,
        is_equity_fund: sourceIsEquity,
        nav_date: sourceNavDate,
      },
    }).select('id').single();

    if (sellErr || !sellTxn) {
      return NextResponse.json({ error: sellErr?.message ?? 'Failed to create sell transaction' }, { status: 500 });
    }

    // ── Create BUY transaction on destination (date = STP date) ──
    const { data: buyTxn, error: buyErr } = await supabase.from('transactions').insert({
      holding_id: destHoldingId,
      type: 'buy',
      quantity: destUnits,
      price: destNav,
      date,
      fees: destStampDuty,
      notes: `STP in from ${sourceHolding.name} (₹${amountNum.toFixed(0)})`,
      metadata: {
        stp_link_id: stpLinkId,
        stp_role: 'destination',
        stp_counterpart_holding_id: sourceHoldingId,
        stp_counterpart_scheme_name: sourceHolding.name,
        amount: amountNum,
        stamp_duty: destStampDuty,
        nav_date: destNavDate,
      },
    }).select('id').single();

    if (buyErr || !buyTxn) {
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
      source: { nav: sourceNav, navDate: sourceNavDate, date: sourceNavDateISO, units: sourceUnits, stt: sourceStpStt },
      destination: { nav: destNav, navDate: destNavDate, date, units: destUnits, stampDuty: destStampDuty },
      amount: amountNum,
    });
  } catch (err) {
    console.error('[api/mf/stp]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
