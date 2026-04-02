import { NextRequest, NextResponse } from 'next/server';

// ─── Known SIF Schemes (SEBI Specialized Investment Funds) ───────────────────
// SIFs launched under SEBI circular Feb 2025. NOT on mfapi.in or AMFI NAVAll.txt.
// AMFI publishes SIF NAVs only on their SIF portal (client-rendered, no public API).
// Scheme codes below are WealthView internal IDs — NOT AMFI scheme codes.
// Live NAV is NOT available for SIFs — users must enter NAV manually.
// Update this list as new SIFs are launched.
// Source: AMFI SIF Latest NAV page (https://www.amfiindia.com/sif/latest-nav)

interface SifScheme {
  schemeCode: string;
  schemeName: string;
  amc: string;
  category: string;
  planType: 'Direct' | 'Regular';
}

const SIF_SCHEMES: SifScheme[] = [
  // ── Quant SIF ──────────────────────────────────────────────────────────────
  { schemeCode: 'QSIF-ELS-DG', schemeName: 'Quant SIF Equity Long Short Fund - Direct Plan - Growth', amc: 'Quant Mutual Fund', category: 'Long-Short Equity', planType: 'Direct' },
  { schemeCode: 'QSIF-ELS-RG', schemeName: 'Quant SIF Equity Long Short Fund - Regular Plan - Growth', amc: 'Quant Mutual Fund', category: 'Long-Short Equity', planType: 'Regular' },
  { schemeCode: 'QSIF-ELS-DI', schemeName: 'Quant SIF Equity Long Short Fund - Direct Plan - IDCW', amc: 'Quant Mutual Fund', category: 'Long-Short Equity', planType: 'Direct' },
  { schemeCode: 'QSIF-ELS-RI', schemeName: 'Quant SIF Equity Long Short Fund - Regular Plan - IDCW', amc: 'Quant Mutual Fund', category: 'Long-Short Equity', planType: 'Regular' },
  { schemeCode: 'QSIF-HLS-DG', schemeName: 'Quant SIF Hybrid Long Short Fund - Direct Plan - Growth', amc: 'Quant Mutual Fund', category: 'Hybrid Long-Short', planType: 'Direct' },
  { schemeCode: 'QSIF-HLS-RG', schemeName: 'Quant SIF Hybrid Long Short Fund - Regular Plan - Growth', amc: 'Quant Mutual Fund', category: 'Hybrid Long-Short', planType: 'Regular' },
  { schemeCode: 'QSIF-HLS-DI', schemeName: 'Quant SIF Hybrid Long Short Fund - Direct Plan - IDCW', amc: 'Quant Mutual Fund', category: 'Hybrid Long-Short', planType: 'Direct' },
  { schemeCode: 'QSIF-HLS-RI', schemeName: 'Quant SIF Hybrid Long Short Fund - Regular Plan - IDCW', amc: 'Quant Mutual Fund', category: 'Hybrid Long-Short', planType: 'Regular' },
  { schemeCode: 'QSIF-EXT-DG', schemeName: 'Quant SIF Equity Ex-Top 100 Long Short Fund - Direct Plan - Growth', amc: 'Quant Mutual Fund', category: 'Long-Short Equity', planType: 'Direct' },
  { schemeCode: 'QSIF-EXT-RG', schemeName: 'Quant SIF Equity Ex-Top 100 Long Short Fund - Regular Plan - Growth', amc: 'Quant Mutual Fund', category: 'Long-Short Equity', planType: 'Regular' },
  { schemeCode: 'QSIF-EXT-DI', schemeName: 'Quant SIF Equity Ex-Top 100 Long Short Fund - Direct Plan - IDCW', amc: 'Quant Mutual Fund', category: 'Long-Short Equity', planType: 'Direct' },
  { schemeCode: 'QSIF-EXT-RI', schemeName: 'Quant SIF Equity Ex-Top 100 Long Short Fund - Regular Plan - IDCW', amc: 'Quant Mutual Fund', category: 'Long-Short Equity', planType: 'Regular' },
  { schemeCode: 'QSIF-AAA-DG', schemeName: 'Quant SIF Active Asset Allocator Long Short Fund - Direct Plan - Growth', amc: 'Quant Mutual Fund', category: 'Tactical Asset Allocation', planType: 'Direct' },
  { schemeCode: 'QSIF-AAA-RG', schemeName: 'Quant SIF Active Asset Allocator Long Short Fund - Regular Plan - Growth', amc: 'Quant Mutual Fund', category: 'Tactical Asset Allocation', planType: 'Regular' },
  { schemeCode: 'QSIF-AAA-DI', schemeName: 'Quant SIF Active Asset Allocator Long Short Fund - Direct Plan - IDCW', amc: 'Quant Mutual Fund', category: 'Tactical Asset Allocation', planType: 'Direct' },
  { schemeCode: 'QSIF-AAA-RI', schemeName: 'Quant SIF Active Asset Allocator Long Short Fund - Regular Plan - IDCW', amc: 'Quant Mutual Fund', category: 'Tactical Asset Allocation', planType: 'Regular' },

  // ── ICICI Prudential SIF ───────────────────────────────────────────────────
  { schemeCode: 'ICISIF-ELS-DG', schemeName: 'ICICI Prudential SIF Equity Long Short Fund - Direct Plan - Growth', amc: 'ICICI Prudential Mutual Fund', category: 'Long-Short Equity', planType: 'Direct' },
  { schemeCode: 'ICISIF-ELS-RG', schemeName: 'ICICI Prudential SIF Equity Long Short Fund - Regular Plan - Growth', amc: 'ICICI Prudential Mutual Fund', category: 'Long-Short Equity', planType: 'Regular' },
  { schemeCode: 'ICISIF-HLS-DG', schemeName: 'ICICI Prudential SIF Hybrid Long Short Fund - Direct Plan - Growth', amc: 'ICICI Prudential Mutual Fund', category: 'Hybrid Long-Short', planType: 'Direct' },
  { schemeCode: 'ICISIF-HLS-RG', schemeName: 'ICICI Prudential SIF Hybrid Long Short Fund - Regular Plan - Growth', amc: 'ICICI Prudential Mutual Fund', category: 'Hybrid Long-Short', planType: 'Regular' },

  // ── SBI SIF ────────────────────────────────────────────────────────────────
  { schemeCode: 'SBISIF-ELS-DG', schemeName: 'SBI SIF Equity Long Short Fund - Direct Plan - Growth', amc: 'SBI Mutual Fund', category: 'Long-Short Equity', planType: 'Direct' },
  { schemeCode: 'SBISIF-ELS-RG', schemeName: 'SBI SIF Equity Long Short Fund - Regular Plan - Growth', amc: 'SBI Mutual Fund', category: 'Long-Short Equity', planType: 'Regular' },

  // ── HDFC SIF ───────────────────────────────────────────────────────────────
  { schemeCode: 'HDFCSIF-ELS-DG', schemeName: 'HDFC SIF Equity Long Short Fund - Direct Plan - Growth', amc: 'HDFC Mutual Fund', category: 'Long-Short Equity', planType: 'Direct' },
  { schemeCode: 'HDFCSIF-ELS-RG', schemeName: 'HDFC SIF Equity Long Short Fund - Regular Plan - Growth', amc: 'HDFC Mutual Fund', category: 'Long-Short Equity', planType: 'Regular' },

  // ── Edelweiss SIF ──────────────────────────────────────────────────────────
  { schemeCode: 'EDLSIF-HLS-DG', schemeName: 'Edelweiss SIF Hybrid Long Short Fund - Direct Plan - Growth', amc: 'Edelweiss Mutual Fund', category: 'Hybrid Long-Short', planType: 'Direct' },
  { schemeCode: 'EDLSIF-HLS-RG', schemeName: 'Edelweiss SIF Hybrid Long Short Fund - Regular Plan - Growth', amc: 'Edelweiss Mutual Fund', category: 'Hybrid Long-Short', planType: 'Regular' },

  // ── Motilal Oswal SIF ──────────────────────────────────────────────────────
  { schemeCode: 'MOSIF-ELS-DG', schemeName: 'Motilal Oswal SIF Equity Long Short Fund - Direct Plan - Growth', amc: 'Motilal Oswal Mutual Fund', category: 'Long-Short Equity', planType: 'Direct' },
  { schemeCode: 'MOSIF-ELS-RG', schemeName: 'Motilal Oswal SIF Equity Long Short Fund - Regular Plan - Growth', amc: 'Motilal Oswal Mutual Fund', category: 'Long-Short Equity', planType: 'Regular' },

  // ── DSP SIF ────────────────────────────────────────────────────────────────
  { schemeCode: 'DSPSIF-ELS-DG', schemeName: 'DSP SIF Equity Long Short Fund - Direct Plan - Growth', amc: 'DSP Mutual Fund', category: 'Long-Short Equity', planType: 'Direct' },
  { schemeCode: 'DSPSIF-ELS-RG', schemeName: 'DSP SIF Equity Long Short Fund - Regular Plan - Growth', amc: 'DSP Mutual Fund', category: 'Long-Short Equity', planType: 'Regular' },

  // ── Kotak SIF ──────────────────────────────────────────────────────────────
  { schemeCode: 'KTSIF-ELS-DG', schemeName: 'Kotak SIF Equity Long Short Fund - Direct Plan - Growth', amc: 'Kotak Mahindra Mutual Fund', category: 'Long-Short Equity', planType: 'Direct' },
  { schemeCode: 'KTSIF-ELS-RG', schemeName: 'Kotak SIF Equity Long Short Fund - Regular Plan - Growth', amc: 'Kotak Mahindra Mutual Fund', category: 'Long-Short Equity', planType: 'Regular' },

  // ── Nippon India SIF ───────────────────────────────────────────────────────
  { schemeCode: 'NISIF-ELS-DG', schemeName: 'Nippon India SIF Equity Long Short Fund - Direct Plan - Growth', amc: 'Nippon India Mutual Fund', category: 'Long-Short Equity', planType: 'Direct' },
  { schemeCode: 'NISIF-ELS-RG', schemeName: 'Nippon India SIF Equity Long Short Fund - Regular Plan - Growth', amc: 'Nippon India Mutual Fund', category: 'Long-Short Equity', planType: 'Regular' },

  // ── Axis SIF ───────────────────────────────────────────────────────────────
  { schemeCode: 'AXSIF-ELS-DG', schemeName: 'Axis SIF Equity Long Short Fund - Direct Plan - Growth', amc: 'Axis Mutual Fund', category: 'Long-Short Equity', planType: 'Direct' },
  { schemeCode: 'AXSIF-ELS-RG', schemeName: 'Axis SIF Equity Long Short Fund - Regular Plan - Growth', amc: 'Axis Mutual Fund', category: 'Long-Short Equity', planType: 'Regular' },

  // ── Bandhan SIF ────────────────────────────────────────────────────────────
  { schemeCode: 'BDSIF-ELS-DG', schemeName: 'Bandhan SIF Equity Long Short Fund - Direct Plan - Growth', amc: 'Bandhan Mutual Fund', category: 'Long-Short Equity', planType: 'Direct' },
  { schemeCode: 'BDSIF-ELS-RG', schemeName: 'Bandhan SIF Equity Long Short Fund - Regular Plan - Growth', amc: 'Bandhan Mutual Fund', category: 'Long-Short Equity', planType: 'Regular' },

  // ── WhiteOak Capital SIF ───────────────────────────────────────────────────
  { schemeCode: 'WOSIF-ELS-DG', schemeName: 'WhiteOak Capital SIF Equity Long Short Fund - Direct Plan - Growth', amc: 'WhiteOak Capital Mutual Fund', category: 'Long-Short Equity', planType: 'Direct' },
  { schemeCode: 'WOSIF-ELS-RG', schemeName: 'WhiteOak Capital SIF Equity Long Short Fund - Regular Plan - Growth', amc: 'WhiteOak Capital Mutual Fund', category: 'Long-Short Equity', planType: 'Regular' },

  // ── 360 ONE SIF ────────────────────────────────────────────────────────────
  { schemeCode: '360SIF-ELS-DG', schemeName: '360 ONE SIF Equity Long Short Fund - Direct Plan - Growth', amc: '360 ONE Mutual Fund', category: 'Long-Short Equity', planType: 'Direct' },
  { schemeCode: '360SIF-ELS-RG', schemeName: '360 ONE SIF Equity Long Short Fund - Regular Plan - Growth', amc: '360 ONE Mutual Fund', category: 'Long-Short Equity', planType: 'Regular' },
];

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const normalizedQuery = normalize(q);
  const queryWords = normalizedQuery.split(' ').filter(Boolean);

  // Score-based matching with multiple strategies
  const scored: { scheme: SifScheme; score: number }[] = [];

  for (const scheme of SIF_SCHEMES) {
    // Build search target from scheme name + AMC + scheme code
    const target = normalize(scheme.schemeName + ' ' + scheme.amc + ' ' + scheme.schemeCode);
    let score = 0;
    let matched = false;

    // Strategy 1: Full query as substring (handles "qsif", "long short", etc.)
    if (target.includes(normalizedQuery)) {
      score += 30 + normalizedQuery.length;
      matched = true;
    }

    // Strategy 2: All query words appear individually (handles "quant equity direct")
    if (!matched) {
      let allMatch = true;
      for (const word of queryWords) {
        const idx = target.indexOf(word);
        if (idx === -1) { allMatch = false; break; }
        score += word.length;
        if (idx === 0 || target[idx - 1] === ' ') score += 5;
      }
      if (allMatch) matched = true;
    }

    // Strategy 3: Query initials match scheme code prefix (e.g. "qsif" matches "QSIF-...")
    if (!matched) {
      const codeNorm = normalize(scheme.schemeCode);
      if (codeNorm.startsWith(normalizedQuery) || normalizedQuery.startsWith(codeNorm.split(' ')[0])) {
        score += 25;
        matched = true;
      }
    }

    if (matched) {
      // Bonus for Direct plan (usually preferred)
      if (scheme.planType === 'Direct') score += 2;
      scored.push({ scheme, score });
    }
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  const results = scored.slice(0, 20).map(s => ({
    schemeCode: s.scheme.schemeCode,
    schemeName: s.scheme.schemeName,
    category: s.scheme.category,
    amc: s.scheme.amc,
    planType: s.scheme.planType,
  }));

  return NextResponse.json({ results, source: 'sif_registry' });
}
