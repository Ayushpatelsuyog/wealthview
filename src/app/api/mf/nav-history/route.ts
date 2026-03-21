import { NextRequest, NextResponse } from 'next/server';

// mfapi.in dates are "DD-MM-YYYY" — parse manually to avoid locale issues
function parseDDMMYYYY(s: string): number {
  const [d, m, y] = s.split('-');
  return new Date(`${y}-${m}-${d}T00:00:00Z`).getTime();
}

export async function GET(req: NextRequest) {
  const sc   = req.nextUrl.searchParams.get('scheme_code');
  const date = req.nextUrl.searchParams.get('date'); // YYYY-MM-DD from <input type="date">

  if (!sc || !date) {
    return NextResponse.json({ error: 'scheme_code and date required' }, { status: 400 });
  }

  try {
    const res = await fetch(`https://api.mfapi.in/mf/${sc}`, {
      next: { revalidate: 86400 },
    });
    if (!res.ok) throw new Error(`mfapi.in HTTP ${res.status}`);
    const json = await res.json();
    if (json.status !== 'SUCCESS' || !json.data?.length) {
      return NextResponse.json({ error: 'No NAV history found' }, { status: 404 });
    }

    // Convert target date to ms (input is YYYY-MM-DD)
    const targetMs = new Date(`${date}T00:00:00Z`).getTime();

    // Find the closest entry; data is newest-first
    let best = json.data[0];
    let bestDiff = Math.abs(parseDDMMYYYY(best.date) - targetMs);

    for (const entry of json.data) {
      const diff = Math.abs(parseDDMMYYYY(entry.date) - targetMs);
      if (diff < bestDiff) { bestDiff = diff; best = entry; }
      // Once entries go older than target, they only get further away
      if (parseDDMMYYYY(entry.date) < targetMs && diff > bestDiff) break;
    }

    return NextResponse.json({
      nav: parseFloat(best.nav),
      actualDate: best.date, // "DD-MM-YYYY"
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
