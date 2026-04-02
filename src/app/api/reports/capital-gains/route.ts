import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import ExcelJS from 'exceljs';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(d: string): string {
  const dt = new Date(d);
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function autoWidth(ws: ExcelJS.Worksheet) {
  ws.columns.forEach((col) => {
    let maxLen = 10;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const len = String(cell.value ?? '').length;
      if (len > maxLen) maxLen = len;
    });
    col.width = Math.min(maxLen + 3, 40);
  });
}

const NAVY: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1B2A4A' },
};

const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: 'FFFFFFFF' },
  size: 10,
};

const AMOUNT_FMT = '[$₹]#,##0.00';

// Equity-like assets where LTCG threshold is 12 months
const EQUITY_TYPES = new Set([
  'indian_stock',
  'global_stock',
  'mutual_fund', // equity MFs; debt MFs post-2023 are taxed at slab
]);

// ─── Route Handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { familyId, memberId, financialYear } = body;

    if (!financialYear) {
      return NextResponse.json(
        { error: 'financialYear is required (e.g., "2025-26")' },
        { status: 400 }
      );
    }

    // Parse FY: "2025-26" means Apr 2025 to Mar 2026
    const fyStartYear = parseInt(financialYear.split('-')[0], 10);
    const fyStart = `${fyStartYear}-04-01`;
    const fyEnd = `${fyStartYear + 1}-03-31`;

    // ── Resolve family ──────────────────────────────────────────────────────
    const { data: profile } = await supabase
      .from('users')
      .select('family_id')
      .eq('id', user.id)
      .single();
    const effectiveFamilyId = familyId || profile?.family_id;
    if (!effectiveFamilyId) {
      return NextResponse.json({ error: 'No family found' }, { status: 400 });
    }

    const { data: family } = await supabase
      .from('families')
      .select('name')
      .eq('id', effectiveFamilyId)
      .single();
    const familyName = family?.name || 'My Family';

    // ── Fetch portfolios ────────────────────────────────────────────────────
    let portfolioQuery = supabase
      .from('portfolios')
      .select('id')
      .eq('family_id', effectiveFamilyId);
    if (memberId) portfolioQuery = portfolioQuery.eq('user_id', memberId);
    const { data: portfolios } = await portfolioQuery;
    const portfolioIds = (portfolios ?? []).map((p) => p.id);

    if (portfolioIds.length === 0) {
      return NextResponse.json({ error: 'No portfolios found' }, { status: 404 });
    }

    // ── Fetch all holdings ──────────────────────────────────────────────────
    const { data: holdingsData } = await supabase
      .from('holdings')
      .select('id, asset_type, symbol, name, metadata')
      .in('portfolio_id', portfolioIds);
    const holdings = holdingsData ?? [];
    const holdingMap = new Map(holdings.map((h) => [h.id, h]));
    const holdingIds = holdings.map((h) => h.id);

    if (holdingIds.length === 0) {
      return NextResponse.json({ error: 'No holdings found' }, { status: 404 });
    }

    // ── Fetch sell transactions in the FY ────────────────────────────────────
    const { data: sellTxns } = await supabase
      .from('transactions')
      .select('id, holding_id, quantity, price, date, fees, notes')
      .in('holding_id', holdingIds)
      .eq('type', 'sell')
      .gte('date', fyStart)
      .lte('date', fyEnd)
      .order('date', { ascending: true });

    if (!sellTxns || sellTxns.length === 0) {
      return NextResponse.json(
        { error: `No sell transactions found in FY ${financialYear}` },
        { status: 404 }
      );
    }

    // ── For each sell, find buy lots (FIFO) to determine holding period ─────
    // Pre-fetch all buy transactions for relevant holdings
    const sellHoldingIds = Array.from(new Set(sellTxns.map((t: Record<string, unknown>) => t.holding_id as string)));
    const { data: buyTxns } = await supabase
      .from('transactions')
      .select('id, holding_id, quantity, price, date, type')
      .in('holding_id', sellHoldingIds)
      .in('type', ['buy', 'sip'])
      .order('date', { ascending: true });

    // Group buys by holding
    const buysByHolding: Record<
      string,
      Array<{ date: string; price: number; qty: number }>
    > = {};
    for (const b of buyTxns ?? []) {
      if (!buysByHolding[b.holding_id]) buysByHolding[b.holding_id] = [];
      buysByHolding[b.holding_id].push({
        date: b.date,
        price: Number(b.price),
        qty: Number(b.quantity),
      });
    }

    // ── Compute gains ───────────────────────────────────────────────────────
    interface GainEntry {
      date: string;
      symbol: string;
      name: string;
      assetType: string;
      sellQty: number;
      sellPrice: number;
      sellValue: number;
      costBasis: number;
      holdingDays: number;
      gain: number;
      gainType: 'STCG' | 'LTCG' | 'SLAB';
      fees: number;
    }

    const gains: GainEntry[] = [];

    // Track consumed buy lots per holding across sell txns
    const consumedByHolding: Record<string, number> = {};

    for (const sell of sellTxns) {
      const holding = holdingMap.get(sell.holding_id);
      if (!holding) continue;

      const isEquity = EQUITY_TYPES.has(holding.asset_type);
      // Debt MFs post-2023: taxed at slab regardless of holding period
      const isDebt =
        holding.asset_type === 'mutual_fund' &&
        ((holding.metadata as Record<string, string>)?.category ?? '')
          .toLowerCase()
          .includes('debt');

      const lots = buysByHolding[sell.holding_id] ?? [];
      let remaining = Number(sell.quantity);
      const sellDate = new Date(sell.date);
      const sellPx = Number(sell.price);

      // Track how many units already consumed by previous sells for this holding
      const consumed = consumedByHolding[sell.holding_id] || 0;
      let lotIdx = 0;
      let skipped = 0;

      // Skip already-consumed lots
      while (lotIdx < lots.length && skipped < consumed) {
        const canSkip = Math.min(lots[lotIdx].qty, consumed - skipped);
        skipped += canSkip;
        if (canSkip >= lots[lotIdx].qty) {
          lotIdx++;
        } else {
          // Partial lot remains
          lots[lotIdx] = {
            ...lots[lotIdx],
            qty: lots[lotIdx].qty - canSkip,
          };
          break;
        }
      }

      while (remaining > 0 && lotIdx < lots.length) {
        const lot = lots[lotIdx];
        const fromLot = Math.min(remaining, lot.qty);
        const buyDate = new Date(lot.date);
        const holdingDays = Math.floor(
          (sellDate.getTime() - buyDate.getTime()) / (24 * 3600 * 1000)
        );
        const isLong = isEquity ? holdingDays >= 365 : holdingDays >= 730;

        let gainType: 'STCG' | 'LTCG' | 'SLAB';
        if (isDebt) {
          gainType = 'SLAB'; // Post-2023 debt MF rules
        } else {
          gainType = isLong ? 'LTCG' : 'STCG';
        }

        const costBasis = fromLot * lot.price;
        const sellValue = fromLot * sellPx;

        gains.push({
          date: sell.date,
          symbol: holding.symbol,
          name: holding.name || holding.symbol,
          assetType: holding.asset_type,
          sellQty: fromLot,
          sellPrice: sellPx,
          sellValue,
          costBasis,
          holdingDays,
          gain: sellValue - costBasis,
          gainType,
          fees: (Number(sell.fees) || 0) * (fromLot / Number(sell.quantity)),
        });

        remaining -= fromLot;
        lot.qty -= fromLot;
        if (lot.qty <= 0) lotIdx++;
      }

      consumedByHolding[sell.holding_id] =
        (consumedByHolding[sell.holding_id] || 0) + Number(sell.quantity);
    }

    // ── Classify ────────────────────────────────────────────────────────────
    const stcg = gains.filter((g) => g.gainType === 'STCG');
    const ltcg = gains.filter((g) => g.gainType === 'LTCG');
    const slab = gains.filter((g) => g.gainType === 'SLAB');

    const stcgTotal = stcg.reduce((s, g) => s + g.gain, 0);
    const ltcgTotal = ltcg.reduce((s, g) => s + g.gain, 0);
    const slabTotal = slab.reduce((s, g) => s + g.gain, 0);

    // Tax estimates (FY 2024-25 onwards)
    const equityStcgTax = Math.max(0, stcgTotal) * 0.2;
    const ltcgExemption = 125000; // ₹1.25L
    const taxableLTCG = Math.max(0, ltcgTotal - ltcgExemption);
    const equityLtcgTax = taxableLTCG * 0.125;

    // ── Generate Excel ──────────────────────────────────────────────────────
    const wb = new ExcelJS.Workbook();
    wb.creator = 'WealthView';
    wb.created = new Date();

    // ── Summary sheet ───────────────────────────────────────────────────────
    const summaryWs = wb.addWorksheet('Summary');
    summaryWs.addRow([`Capital Gains Report — FY ${financialYear}`]);
    summaryWs.getRow(1).font = { bold: true, size: 14, color: { argb: 'FF1B2A4A' } };
    summaryWs.mergeCells('A1:D1');
    summaryWs.addRow([`Family: ${familyName}`]);
    summaryWs.addRow([`Period: ${fmtDate(fyStart)} to ${fmtDate(fyEnd)}`]);
    summaryWs.addRow([]);

    const sHeader = summaryWs.addRow(['Category', 'Gain / Loss', 'Tax Rate', 'Estimated Tax']);
    sHeader.eachCell((c) => { c.fill = NAVY; c.font = HEADER_FONT; });

    const addSummaryRow = (label: string, gain: number, rate: string, tax: number) => {
      const row = summaryWs.addRow([label, gain, rate, tax]);
      row.getCell(2).numFmt = AMOUNT_FMT;
      row.getCell(4).numFmt = AMOUNT_FMT;
      return row;
    };

    addSummaryRow('Equity STCG', stcgTotal, '20%', equityStcgTax);
    addSummaryRow(
      `Equity LTCG (exempt: ₹${(ltcgExemption / 100000).toFixed(2)}L)`,
      ltcgTotal,
      '12.5%',
      equityLtcgTax
    );
    if (slab.length > 0) {
      addSummaryRow('Debt (taxed at slab)', slabTotal, 'As per slab', 0);
    }

    summaryWs.addRow([]);
    const totalRow = summaryWs.addRow([
      'Total Estimated Tax',
      '',
      '',
      equityStcgTax + equityLtcgTax,
    ]);
    totalRow.font = { bold: true };
    totalRow.eachCell((c) => { c.fill = NAVY; c.font = HEADER_FONT; });
    totalRow.getCell(4).numFmt = AMOUNT_FMT;
    autoWidth(summaryWs);

    // ── Detail sheet builder ────────────────────────────────────────────────
    const buildDetailSheet = (name: string, entries: GainEntry[]) => {
      if (entries.length === 0) return;
      const ws = wb.addWorksheet(name);
      const hdr = ws.addRow([
        'Sell Date',
        'Symbol',
        'Name',
        'Qty',
        'Sell Price',
        'Sell Value',
        'Cost Basis',
        'Holding Days',
        'Gain / Loss',
        'Fees',
      ]);
      hdr.eachCell((c) => { c.fill = NAVY; c.font = HEADER_FONT; });

      let totalGain = 0;
      let totalFees = 0;
      let totalSellVal = 0;
      let totalCost = 0;

      for (const g of entries) {
        const row = ws.addRow([
          fmtDate(g.date),
          g.symbol,
          g.name,
          g.sellQty,
          g.sellPrice,
          g.sellValue,
          g.costBasis,
          g.holdingDays,
          g.gain,
          g.fees,
        ]);
        row.getCell(5).numFmt = AMOUNT_FMT;
        row.getCell(6).numFmt = AMOUNT_FMT;
        row.getCell(7).numFmt = AMOUNT_FMT;
        row.getCell(9).numFmt = AMOUNT_FMT;
        row.getCell(10).numFmt = AMOUNT_FMT;
        totalGain += g.gain;
        totalFees += g.fees;
        totalSellVal += g.sellValue;
        totalCost += g.costBasis;
      }

      const foot = ws.addRow([
        '',
        '',
        'TOTAL',
        '',
        '',
        totalSellVal,
        totalCost,
        '',
        totalGain,
        totalFees,
      ]);
      foot.eachCell((c) => { c.fill = NAVY; c.font = HEADER_FONT; });
      foot.getCell(6).numFmt = AMOUNT_FMT;
      foot.getCell(7).numFmt = AMOUNT_FMT;
      foot.getCell(9).numFmt = AMOUNT_FMT;
      foot.getCell(10).numFmt = AMOUNT_FMT;
      autoWidth(ws);
    };

    buildDetailSheet('STCG', stcg);
    buildDetailSheet('LTCG', ltcg);
    if (slab.length > 0) buildDetailSheet('Debt (Slab)', slab);

    // ── Return buffer ───────────────────────────────────────────────────────
    const buf = await wb.xlsx.writeBuffer();
    return new NextResponse(Buffer.from(buf as ArrayBuffer), {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="capital-gains-FY${financialYear}.xlsx"`,
      },
    });
  } catch (err) {
    console.error('[api/reports/capital-gains]', err);
    return NextResponse.json(
      { error: 'Failed to generate capital gains report' },
      { status: 500 }
    );
  }
}
