import { NextRequest, NextResponse } from 'next/server';

// Stamp duty of 0.005% introduced on 1 July 2020
const STAMP_DUTY_RATE      = 0.00005;          // 0.005%
const STAMP_DUTY_CUTOFF    = new Date('2020-07-01');

interface NavEntry { date: string; nav: string }

interface SipInstallment {
  date:            string;
  nav:             number;
  units_purchased: number;
  amount:          number;
  stamp_duty:      number;  // ₹ deducted before unit allotment
  effective_amount: number; // amount after stamp duty
}

// Parse "DD-MM-YYYY" from mfapi
function parseApiDate(s: string): Date {
  const [d, m, y] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Format Date as "DD-MM-YYYY" for lookup
function fmtKey(d: Date): string {
  return `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`;
}

/** Round to N decimal places (simple half-up rounding) */
function round(n: number, dp: number): number {
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

// XIRR via Newton-Raphson
function xirr(cashFlows: number[], dates: Date[]): number {
  const first = dates[0].getTime();
  let rate = 0.1;
  for (let iter = 0; iter < 200; iter++) {
    let npv = 0, dnpv = 0;
    for (let i = 0; i < cashFlows.length; i++) {
      const t = (dates[i].getTime() - first) / (365.25 * 86400000);
      const f = Math.pow(1 + rate, t);
      npv  +=  cashFlows[i] / f;
      dnpv -= (t * cashFlows[i]) / (f * (1 + rate));
    }
    if (Math.abs(dnpv) < 1e-10) break;
    const nr = rate - npv / dnpv;
    if (Math.abs(nr - rate) < 1e-7) return nr;
    rate = nr;
  }
  return rate;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const schemeCode = searchParams.get('scheme_code');
  const sipAmount  = parseFloat(searchParams.get('sip_amount')  ?? '0');
  const sipDateStr = searchParams.get('sip_date')  ?? '1st';
  const startDate  = searchParams.get('start_date') ?? '';
  const endDateStr = searchParams.get('end_date')   ?? '';

  if (!schemeCode || !sipAmount || !startDate) {
    return NextResponse.json(
      { error: 'scheme_code, sip_amount, start_date are required' },
      { status: 400 },
    );
  }

  // Fetch full NAV history
  const mfRes = await fetch(`https://api.mfapi.in/mf/${schemeCode}`, {
    next: { revalidate: 3600 },
  });
  if (!mfRes.ok) {
    return NextResponse.json({ error: 'Failed to fetch NAV history' }, { status: 502 });
  }
  const mfData = await mfRes.json();
  const navHistory: NavEntry[] = mfData.data ?? [];
  const currentNav: number = round(parseFloat(navHistory[0]?.nav ?? '0'), 4);

  // Build lookup: "DD-MM-YYYY" → nav
  const navMap = new Map<string, number>();
  for (const entry of navHistory) {
    navMap.set(entry.date, parseFloat(entry.nav));
  }

  // SIP execution day of month
  const sipDay = parseInt(sipDateStr);

  const start    = new Date(startDate);
  const endLimit = endDateStr ? new Date(endDateStr) : new Date();

  const installments: SipInstallment[] = [];
  const cfFlows: number[] = [];
  const cfDates: Date[]   = [];

  // Iterate month-by-month from start
  const cursor = new Date(start.getFullYear(), start.getMonth(), sipDay);
  // If the SIP date for start month is before the start date, move to next month
  if (cursor < start) cursor.setMonth(cursor.getMonth() + 1);

  while (cursor <= endLimit) {
    // Find NAV on execution date or next available trading day (up to 7 days forward)
    let execDate = new Date(cursor);
    let nav: number | null = null;

    for (let attempt = 0; attempt < 7; attempt++) {
      const key = fmtKey(execDate);
      if (navMap.has(key)) { nav = navMap.get(key)!; break; }
      execDate = new Date(execDate);
      execDate.setDate(execDate.getDate() + 1);
    }

    if (nav !== null && nav > 0) {
      // Stamp duty: only for dates on or after 2020-07-01
      const applyStamp  = execDate >= STAMP_DUTY_CUTOFF;
      const stampDuty   = round(applyStamp ? sipAmount * STAMP_DUTY_RATE : 0, 2);
      const effectiveAmt = round(sipAmount - stampDuty, 4);
      const unitsPurchased = round(effectiveAmt / nav, 4);

      installments.push({
        date:             execDate.toISOString().split('T')[0],
        nav:              round(nav, 4),
        units_purchased:  unitsPurchased,
        amount:           sipAmount,
        stamp_duty:       stampDuty,
        effective_amount: effectiveAmt,
      });
      // XIRR cash flow: full SIP amount is what the investor pays
      cfFlows.push(-sipAmount);
      cfDates.push(new Date(execDate));
    }

    cursor.setMonth(cursor.getMonth() + 1);
  }

  if (installments.length === 0) {
    return NextResponse.json(
      { error: 'No NAV data found for the given date range' },
      { status: 404 },
    );
  }

  const totalUnits    = round(installments.reduce((s, i) => s + i.units_purchased, 0), 4);
  const totalInvested = round(sipAmount * installments.length, 2);
  const totalStampDuty = round(installments.reduce((s, i) => s + i.stamp_duty, 0), 2);
  const averageNav    = round(totalInvested / totalUnits, 4);
  const currentValue  = round(totalUnits * currentNav, 2);
  const pnl           = round(currentValue - totalInvested, 2);

  cfFlows.push(currentValue);
  cfDates.push(new Date());

  let xirrVal: number | null = null;
  try { xirrVal = round(xirr(cfFlows, cfDates), 6); } catch { xirrVal = null; }

  return NextResponse.json({
    installments_completed: installments.length,
    total_units:     totalUnits,
    total_invested:  totalInvested,
    total_stamp_duty: totalStampDuty,
    average_nav:     averageNav,
    current_nav:     currentNav,
    current_value:   currentValue,
    pnl,
    xirr: xirrVal,
    monthly_breakdown: installments,
  });
}
