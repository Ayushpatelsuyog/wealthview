import { NextRequest, NextResponse } from 'next/server';
import { cacheGet, cacheSet, TTL } from '@/lib/utils/price-cache';

interface MFScheme { schemeCode: number; schemeName: string }

const LIST_KEY = 'amfi_full_list';

function deriveCategory(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('elss') || n.includes('tax saver') || n.includes('tax saving')) return 'ELSS';
  if (n.includes('liquid') || n.includes('overnight') || n.includes('money market')) return 'Liquid';
  if (n.includes('gilt') || n.includes('g-sec') || n.includes('gsec')) return 'Gilt';
  if (n.includes('index') || n.includes('nifty') || n.includes('sensex') || n.includes(' etf')) return 'Index/ETF';
  if (n.includes('debt') || n.includes(' bond') || n.includes('corporate bond') || n.includes('credit risk') || n.includes('banking and psu') || n.includes('banking & psu') || n.includes('income fund')) return 'Debt';
  if (n.includes('hybrid') || n.includes('balanced') || n.includes('multi asset') || n.includes('arbitrage') || n.includes('aggressive hybrid')) return 'Hybrid';
  return 'Equity';
}

async function getAmfiList(): Promise<MFScheme[]> {
  const cached = cacheGet<MFScheme[]>(LIST_KEY);
  if (cached) return cached;

  const res = await fetch('https://api.mfapi.in/mf', { next: { revalidate: 86400 } });
  if (!res.ok) throw new Error(`mfapi.in list HTTP ${res.status}`);
  const data: MFScheme[] = await res.json();
  cacheSet(LIST_KEY, data, TTL.MF);
  return data;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') ?? '';
  if (q.length < 2) return NextResponse.json({ results: [] });

  try {
    const list = await getAmfiList();
    const lower = q.toLowerCase();
    const results = list
      .filter((f) => f.schemeName.toLowerCase().includes(lower))
      .slice(0, 8)
      .map((f) => ({
        schemeCode: f.schemeCode,
        schemeName: f.schemeName,
        category: deriveCategory(f.schemeName),
      }));
    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json({ error: String(err), results: [] }, { status: 502 });
  }
}
