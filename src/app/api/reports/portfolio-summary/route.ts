import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtINR(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
}

function pctStr(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

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
  real_estate: 'Real Estate',
  fd: 'Fixed Deposits',
  ppf: 'PPF',
  epf: 'EPF / VPF',
  gratuity: 'Gratuity',
  nps: 'NPS',
  gold: 'Gold',
  savings_account: 'Savings Accounts',
  insurance: 'Insurance',
};

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
    const { familyId, memberId, asOfDate, holdingsOnly: _holdingsOnly, insuranceOnly } = body;

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
    const reportDate = asOfDate || new Date().toISOString().split('T')[0];

    // ── Fetch portfolios ────────────────────────────────────────────────────
    let portfolioQuery = supabase
      .from('portfolios')
      .select('id, user_id, name')
      .eq('family_id', effectiveFamilyId);
    if (memberId) portfolioQuery = portfolioQuery.eq('user_id', memberId);
    const { data: portfolios } = await portfolioQuery;
    const portfolioIds = (portfolios ?? []).map((p) => p.id);

    // ── Fetch holdings ──────────────────────────────────────────────────────
    type HoldingRow = {
      id: string;
      asset_type: string;
      symbol: string;
      name: string;
      quantity: number;
      avg_buy_price: number;
      currency: string;
      metadata: Record<string, unknown>;
    };
    let holdings: HoldingRow[] = [];
    if (portfolioIds.length > 0) {
      const { data } = await supabase
        .from('holdings')
        .select('id, asset_type, symbol, name, quantity, avg_buy_price, currency, metadata')
        .in('portfolio_id', portfolioIds);
      holdings = (data ?? []) as HoldingRow[];
    }

    // ── Fetch manual assets ─────────────────────────────────────────────────
    type ManualRow = {
      id: string;
      asset_type: string;
      name: string;
      current_value: number;
      metadata: Record<string, unknown>;
    };
    let manualAssets: ManualRow[] = [];
    if (portfolioIds.length > 0) {
      const { data } = await supabase
        .from('manual_assets')
        .select('id, asset_type, name, current_value, metadata')
        .in('portfolio_id', portfolioIds);
      manualAssets = (data ?? []) as ManualRow[];
    }

    // ── Fetch insurance policies ────────────────────────────────────────────
    type InsuranceRow = {
      id: string;
      category: string;
      provider: string;
      policy_name: string;
      sum_assured: number;
      premium: number;
      premium_frequency: string;
      start_date: string;
      maturity_date: string | null;
      is_active: boolean;
    };
    let insuranceQuery = supabase
      .from('insurance_policies')
      .select('id, category, provider, policy_name, sum_assured, premium, premium_frequency, start_date, maturity_date, is_active')
      .eq('family_id', effectiveFamilyId);
    if (memberId) insuranceQuery = insuranceQuery.eq('user_id', memberId);
    const { data: insuranceData } = await insuranceQuery;
    const insurance = (insuranceData ?? []) as InsuranceRow[];

    // ── Group holdings by asset class ───────────────────────────────────────
    interface ClassRow {
      name: string;
      invested: number;
      currentValue: number;
    }
    const classMap: Record<string, ClassRow[]> = {};

    for (const h of holdings) {
      const cls = h.asset_type;
      if (!classMap[cls]) classMap[cls] = [];
      const inv = Number(h.quantity) * Number(h.avg_buy_price);
      const nav =
        (h.metadata as Record<string, number>)?.current_nav ??
        Number(h.avg_buy_price);
      const cur = Number(h.quantity) * nav;
      classMap[cls].push({ name: h.name || h.symbol, invested: inv, currentValue: cur });
    }

    for (const m of manualAssets) {
      const cls = m.asset_type;
      if (!classMap[cls]) classMap[cls] = [];
      const inv =
        (m.metadata as Record<string, number>)?.invested_amount ??
        Number(m.current_value);
      classMap[cls].push({
        name: m.name,
        invested: inv,
        currentValue: Number(m.current_value),
      });
    }

    // Insurance as a class
    if (insurance.length > 0) {
      classMap['insurance'] = insurance.map((p) => ({
        name: `${p.provider} - ${p.policy_name}`,
        invested: Number(p.premium),
        currentValue: Number(p.sum_assured),
      }));
    }

    // ── Build summary rows ──────────────────────────────────────────────────
    const summaryRows: [string, string, string, string, string][] = [];
    let totalInvested = 0;
    let totalCurrent = 0;

    for (const [cls, items] of Object.entries(classMap)) {
      const inv = items.reduce((s, i) => s + i.invested, 0);
      const cur = items.reduce((s, i) => s + i.currentValue, 0);
      const pnl = cur - inv;
      const pnlPct = inv > 0 ? (pnl / inv) * 100 : 0;
      totalInvested += inv;
      totalCurrent += cur;
      summaryRows.push([
        ASSET_LABELS[cls] || cls,
        fmtINR(inv),
        fmtINR(cur),
        fmtINR(pnl),
        pctStr(pnlPct),
      ]);
    }

    const totalPnl = totalCurrent - totalInvested;
    const totalPnlPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

    // ── Generate PDF ────────────────────────────────────────────────────────
    const doc = new jsPDF('p', 'mm', 'a4');

    // Page 1: Cover page
    doc.setFillColor(27, 42, 74);
    doc.rect(0, 0, 210, 297, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(28);
    doc.text('WealthView', 105, 100, { align: 'center' });
    doc.setFontSize(14);
    doc.setTextColor(201, 168, 76);
    doc.text('Portfolio Summary Report', 105, 120, { align: 'center' });
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.text(familyName, 105, 145, { align: 'center' });
    doc.text(`As of ${reportDate}`, 105, 155, { align: 'center' });
    doc.setFontSize(8);
    doc.setTextColor(180, 180, 180);
    doc.text(
      `Generated on ${new Date().toLocaleDateString('en-IN')} at ${new Date().toLocaleTimeString('en-IN')}`,
      105,
      280,
      { align: 'center' }
    );

    // Page 2: Net Worth Summary
    doc.addPage();
    doc.setTextColor(27, 42, 74);
    doc.setFontSize(16);
    doc.text('Net Worth Summary', 14, 20);
    doc.setDrawColor(201, 168, 76);
    doc.setLineWidth(0.5);
    doc.line(14, 23, 80, 23);

    // Headline numbers
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text('Total Invested', 14, 34);
    doc.text('Current Value', 80, 34);
    doc.text('Total P&L', 146, 34);
    doc.setFontSize(13);
    doc.setTextColor(27, 42, 74);
    doc.text(fmtINR(totalInvested), 14, 42);
    doc.text(fmtINR(totalCurrent), 80, 42);
    doc.setTextColor(totalPnl >= 0 ? 5 : 220, totalPnl >= 0 ? 150 : 38, totalPnl >= 0 ? 105 : 38);
    doc.text(`${fmtINR(totalPnl)} (${pctStr(totalPnlPct)})`, 146, 42);

    // Asset allocation table
    autoTable(doc, {
      head: [['Asset Class', 'Invested', 'Current Value', 'P&L', 'P&L %']],
      body: summaryRows,
      startY: 52,
      theme: 'grid',
      headStyles: { fillColor: [27, 42, 74], textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 8 },
      alternateRowStyles: { fillColor: [247, 245, 240] },
      foot: [['Total', fmtINR(totalInvested), fmtINR(totalCurrent), fmtINR(totalPnl), pctStr(totalPnlPct)]],
      footStyles: {
        fillColor: [27, 42, 74],
        textColor: 255,
        fontSize: 9,
        fontStyle: 'bold',
      },
    });

    // Pages 3+: Per-asset-class detail tables
    if (!insuranceOnly) {
      for (const [cls, items] of Object.entries(classMap)) {
        if (cls === 'insurance') continue;
        doc.addPage();
        doc.setTextColor(27, 42, 74);
        doc.setFontSize(14);
        doc.text(ASSET_LABELS[cls] || cls, 14, 20);
        doc.setDrawColor(201, 168, 76);
        doc.line(14, 23, 80, 23);

        const rows: [string, string, string, string, string][] = items.map(
          (i) => {
            const pnl = i.currentValue - i.invested;
            const pnlPct = i.invested > 0 ? (pnl / i.invested) * 100 : 0;
            return [i.name, fmtINR(i.invested), fmtINR(i.currentValue), fmtINR(pnl), pctStr(pnlPct)];
          }
        );

        autoTable(doc, {
          head: [['Name', 'Invested', 'Current Value', 'P&L', 'P&L %']],
          body: rows,
          startY: 30,
          theme: 'grid',
          headStyles: { fillColor: [27, 42, 74], textColor: 255, fontSize: 9 },
          bodyStyles: { fontSize: 8 },
          alternateRowStyles: { fillColor: [247, 245, 240] },
        });
      }
    }

    // Insurance detail page
    if (insurance.length > 0) {
      doc.addPage();
      doc.setTextColor(27, 42, 74);
      doc.setFontSize(14);
      doc.text('Insurance Policies', 14, 20);
      doc.setDrawColor(201, 168, 76);
      doc.line(14, 23, 90, 23);

      const insRows: string[][] = insurance.map((p) => [
        p.policy_name,
        p.provider,
        p.category.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        fmtINR(p.sum_assured),
        fmtINR(p.premium),
        p.premium_frequency,
        p.is_active ? 'Active' : 'Inactive',
      ]);

      autoTable(doc, {
        head: [['Policy', 'Provider', 'Type', 'Sum Assured', 'Premium', 'Frequency', 'Status']],
        body: insRows,
        startY: 30,
        theme: 'grid',
        headStyles: { fillColor: [27, 42, 74], textColor: 255, fontSize: 8 },
        bodyStyles: { fontSize: 7 },
        alternateRowStyles: { fillColor: [247, 245, 240] },
      });
    }

    // Footer on every page
    const totalPages = doc.getNumberOfPages();
    for (let i = 2; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(7);
      doc.setTextColor(160, 160, 160);
      doc.text(`WealthView  |  ${familyName}  |  Page ${i - 1} of ${totalPages - 1}`, 105, 290, {
        align: 'center',
      });
    }

    const buffer = Buffer.from(doc.output('arraybuffer'));
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="portfolio-summary-${reportDate}.pdf"`,
      },
    });
  } catch (err) {
    console.error('[api/reports/portfolio-summary]', err);
    return NextResponse.json(
      { error: 'Failed to generate portfolio summary' },
      { status: 500 }
    );
  }
}
