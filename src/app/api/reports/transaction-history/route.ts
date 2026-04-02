import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import ExcelJS from 'exceljs';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ASSET_LABELS: Record<string, string> = {
  indian_stock: 'Indian Stocks',
  global_stock: 'Global Stocks',
  mutual_fund: 'Mutual Funds',
  crypto: 'Crypto',
  forex: 'Forex',
  commodity: 'Commodities',
  bond: 'Bonds',
  pms: 'PMS',
  aif: 'AIF',
};

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
    const { familyId, memberId, dateFrom, dateTo, assetClass } = body;

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

    // Family name
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

    // ── Fetch holdings ──────────────────────────────────────────────────────
    let holdingsQuery = supabase
      .from('holdings')
      .select('id, asset_type, symbol, name')
      .in('portfolio_id', portfolioIds);
    if (assetClass) holdingsQuery = holdingsQuery.eq('asset_type', assetClass);
    const { data: holdingsData } = await holdingsQuery;
    const holdings = holdingsData ?? [];

    if (holdings.length === 0) {
      return NextResponse.json({ error: 'No holdings found for filter' }, { status: 404 });
    }

    const holdingMap = new Map(holdings.map((h) => [h.id, h]));
    const holdingIds = holdings.map((h) => h.id);

    // ── Fetch transactions ──────────────────────────────────────────────────
    let txnQuery = supabase
      .from('transactions')
      .select('id, holding_id, type, quantity, price, date, fees, notes')
      .in('holding_id', holdingIds)
      .order('date', { ascending: true });
    if (dateFrom) txnQuery = txnQuery.gte('date', dateFrom);
    if (dateTo) txnQuery = txnQuery.lte('date', dateTo);
    const { data: txnsData } = await txnQuery;
    const txns = txnsData ?? [];

    // ── Group by asset class ────────────────────────────────────────────────
    const grouped: Record<string, Array<{
      date: string;
      symbol: string;
      name: string;
      type: string;
      quantity: number;
      price: number;
      amount: number;
      fees: number;
      notes: string;
    }>> = {};

    for (const t of txns) {
      const h = holdingMap.get(t.holding_id);
      if (!h) continue;
      const cls = h.asset_type;
      if (!grouped[cls]) grouped[cls] = [];
      const qty = Number(t.quantity);
      const px = Number(t.price);
      grouped[cls].push({
        date: t.date,
        symbol: h.symbol,
        name: h.name || h.symbol,
        type: t.type,
        quantity: qty,
        price: px,
        amount: qty * px,
        fees: Number(t.fees) || 0,
        notes: t.notes || '',
      });
    }

    // ── Generate Excel ──────────────────────────────────────────────────────
    const wb = new ExcelJS.Workbook();
    wb.creator = 'WealthView';
    wb.created = new Date();

    // Summary sheet
    const summaryWs = wb.addWorksheet('Summary');
    summaryWs.addRow(['Transaction History Report']);
    summaryWs.getRow(1).font = { bold: true, size: 14, color: { argb: 'FF1B2A4A' } };
    summaryWs.mergeCells('A1:E1');
    summaryWs.addRow([`Family: ${familyName}`]);
    summaryWs.addRow([
      `Period: ${dateFrom ? fmtDate(dateFrom) : 'All'} to ${dateTo ? fmtDate(dateTo) : 'Present'}`,
    ]);
    summaryWs.addRow([]);

    // Summary table
    const summaryHeader = summaryWs.addRow([
      'Asset Class',
      'Total Transactions',
      'Buy Value',
      'Sell Value',
      'Net Value',
    ]);
    summaryHeader.eachCell((cell) => {
      cell.fill = NAVY;
      cell.font = HEADER_FONT;
    });

    let grandBuy = 0;
    let grandSell = 0;
    let grandCount = 0;

    for (const [cls, items] of Object.entries(grouped)) {
      const buyVal = items
        .filter((t) => t.type === 'buy' || t.type === 'sip')
        .reduce((s, t) => s + t.amount, 0);
      const sellVal = items
        .filter((t) => t.type === 'sell')
        .reduce((s, t) => s + t.amount, 0);
      grandBuy += buyVal;
      grandSell += sellVal;
      grandCount += items.length;

      const row = summaryWs.addRow([
        ASSET_LABELS[cls] || cls,
        items.length,
        buyVal,
        sellVal,
        buyVal - sellVal,
      ]);
      row.getCell(3).numFmt = AMOUNT_FMT;
      row.getCell(4).numFmt = AMOUNT_FMT;
      row.getCell(5).numFmt = AMOUNT_FMT;
    }

    // Totals
    const totalRow = summaryWs.addRow([
      'Total',
      grandCount,
      grandBuy,
      grandSell,
      grandBuy - grandSell,
    ]);
    totalRow.font = { bold: true };
    totalRow.eachCell((cell) => {
      cell.fill = NAVY;
      cell.font = HEADER_FONT;
    });
    totalRow.getCell(3).numFmt = AMOUNT_FMT;
    totalRow.getCell(4).numFmt = AMOUNT_FMT;
    totalRow.getCell(5).numFmt = AMOUNT_FMT;
    autoWidth(summaryWs);

    // Per-asset-class sheets
    for (const [cls, items] of Object.entries(grouped)) {
      const label = ASSET_LABELS[cls] || cls;
      const ws = wb.addWorksheet(label.slice(0, 31)); // Excel 31-char limit

      const header = ws.addRow([
        'Date',
        'Symbol',
        'Name',
        'Type',
        'Quantity',
        'Price',
        'Amount',
        'Fees',
        'Notes',
      ]);
      header.eachCell((cell) => {
        cell.fill = NAVY;
        cell.font = HEADER_FONT;
      });

      let sheetTotal = 0;
      let sheetFees = 0;

      for (const t of items) {
        const row = ws.addRow([
          fmtDate(t.date),
          t.symbol,
          t.name,
          t.type.toUpperCase(),
          t.quantity,
          t.price,
          t.amount,
          t.fees,
          t.notes,
        ]);
        row.getCell(6).numFmt = AMOUNT_FMT;
        row.getCell(7).numFmt = AMOUNT_FMT;
        row.getCell(8).numFmt = AMOUNT_FMT;
        sheetTotal += t.amount;
        sheetFees += t.fees;
      }

      // Totals row
      const footRow = ws.addRow([
        '',
        '',
        '',
        'TOTAL',
        '',
        '',
        sheetTotal,
        sheetFees,
        '',
      ]);
      footRow.eachCell((cell) => {
        cell.fill = NAVY;
        cell.font = HEADER_FONT;
      });
      footRow.getCell(7).numFmt = AMOUNT_FMT;
      footRow.getCell(8).numFmt = AMOUNT_FMT;

      autoWidth(ws);
    }

    // ── Return buffer ───────────────────────────────────────────────────────
    const buf = await wb.xlsx.writeBuffer();
    const dateStr = new Date().toISOString().split('T')[0];

    return new NextResponse(Buffer.from(buf as ArrayBuffer), {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="transaction-history-${dateStr}.xlsx"`,
      },
    });
  } catch (err) {
    console.error('[api/reports/transaction-history]', err);
    return NextResponse.json(
      { error: 'Failed to generate transaction history' },
      { status: 500 }
    );
  }
}
