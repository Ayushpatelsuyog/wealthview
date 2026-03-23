import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { parseCSV, parseExcelBuffer, parsePDFBuffer } from '@/lib/services/ecas-parser';
import type { ECASFund } from '@/lib/services/ecas-parser';

// ─── AMFI matching ────────────────────────────────────────────────────────────

interface AMFIScheme { schemeCode: number; schemeName: string; }

let _amfiCache: AMFIScheme[] | null = null;
let _amfiCacheAt = 0;

async function getAMFIList(): Promise<AMFIScheme[]> {
  if (_amfiCache && Date.now() - _amfiCacheAt < 60 * 60 * 1000) return _amfiCache;
  try {
    const res = await fetch('https://api.mfapi.in/mf', { signal: AbortSignal.timeout(8000) });
    const data = await res.json() as AMFIScheme[];
    _amfiCache = data;
    _amfiCacheAt = Date.now();
    return data;
  } catch {
    return _amfiCache ?? [];
  }
}

function normName(s: string): string[] {
  return s.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !/^(the|and|for|fund|plan|direct|regular|growth|option|series)$/.test(w));
}

function matchFund(fund: ECASFund, amfiList: AMFIScheme[]): { schemeCode: number | null; confidence: 'high' | 'low' | 'none'; matchedName?: string } {
  const qWords = new Set(normName(fund.schemeName));
  if (qWords.size === 0) return { schemeCode: null, confidence: 'none' };

  let bestScore = 0;
  let bestScheme: AMFIScheme | null = null;

  for (const scheme of amfiList) {
    const sWords = new Set(normName(scheme.schemeName));
    let hits = 0;
    Array.from(qWords).forEach(w => { if (sWords.has(w)) hits++; });
    const score = hits / qWords.size;
    if (score > bestScore) { bestScore = score; bestScheme = scheme; }
  }

  if (bestScore >= 0.75 && bestScheme) return { schemeCode: bestScheme.schemeCode, confidence: 'high', matchedName: bestScheme.schemeName };
  if (bestScore >= 0.45 && bestScheme) return { schemeCode: bestScheme.schemeCode, confidence: 'low',  matchedName: bestScheme.schemeName };
  return { schemeCode: null, confidence: 'none' };
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let formData: FormData;
  try { formData = await req.formData(); }
  catch { return NextResponse.json({ error: 'Invalid form data' }, { status: 400 }); }

  const file     = formData.get('file') as File | null;
  const password = (formData.get('password') as string | null) || undefined;
  if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

  const name = file.name.toLowerCase();
  const buf  = Buffer.from(await file.arrayBuffer());

  // Parse
  let result;
  if (name.endsWith('.pdf')) {
    result = await parsePDFBuffer(buf, password);
  } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    result = parseExcelBuffer(buf);
  } else {
    result = parseCSV(buf.toString('utf-8'));
  }

  if (result.parseErrors.length > 0 && result.funds.length === 0) {
    return NextResponse.json({ error: result.parseErrors[0], parseErrors: result.parseErrors }, { status: 422 });
  }

  // Enrich with AMFI matches
  const amfiList = await getAMFIList();

  const enriched = result.funds.map(fund => {
    const match = matchFund(fund, amfiList);

    const buyTypes = new Set(['purchase', 'sip', 'switch_in', 'dividend_reinvestment']);
    const buyTxns  = fund.transactions.filter(t => buyTypes.has(t.transactionType));
    const totalBuyUnits = buyTxns.reduce((s, t) => s + Math.abs(t.units), 0);
    const avgNav = totalBuyUnits > 0
      ? buyTxns.reduce((s, t) => s + t.nav * Math.abs(t.units), 0) / totalBuyUnits
      : 0;

    const totalInvested = fund.transactions
      .filter(t => t.transactionType === 'purchase' || t.transactionType === 'sip')
      .reduce((s, t) => s + t.amount, 0);

    const totalUnits = fund.transactions.reduce((s, t) => s + t.units, 0);

    return {
      fundHouse:          fund.fundHouse,
      schemeName:         fund.schemeName,
      folioNumber:        fund.folioNumber,
      isin:               fund.isin,
      transactions:       fund.transactions,
      closingUnits:       fund.closingUnits,
      matchedSchemeCode:  match.schemeCode,
      matchedSchemeName:  match.matchedName,
      matchConfidence:    match.confidence,
      summary: {
        totalUnits:       Math.round(totalUnits * 10000) / 10000,
        totalInvested:    Math.round(totalInvested * 100) / 100,
        avgNav:           Math.round(avgNav * 10000) / 10000,
        transactionCount: fund.transactions.length,
      },
    };
  });

  return NextResponse.json({
    funds:          enriched,
    totalFunds:     enriched.length,
    parseErrors:    result.parseErrors,
    statementDate:  result.statementDate,
    panNumber:      result.panNumber,
    sourceFilename: file.name,
  });
}
