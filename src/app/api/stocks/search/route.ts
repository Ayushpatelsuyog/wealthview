import { NextRequest, NextResponse } from 'next/server';
import { STOCKS_LIST, StockInfo } from '@/lib/data/stocks-list';

export interface StockSearchResult {
  symbol: string;
  companyName: string;
  exchange: 'NSE';
  sector: string;
  industry: string;
  isin: string;
  bseCode: string;
}

function score(stock: StockInfo, q: string, lower: string): number {
  const sym  = stock.symbol.toLowerCase();
  const name = stock.companyName.toLowerCase();

  if (sym === lower)                     return 100;
  if (stock.bseCode === q)               return 95;  // exact BSE code match
  if (sym.startsWith(lower))            return 80;
  if (name.startsWith(lower))           return 70;
  if (sym.includes(lower))              return 60;
  if (name.includes(lower))             return 50;
  return 0;
}

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  if (q.length < 2) return NextResponse.json({ results: [] });

  const lower = q.toLowerCase();
  const isBseCode = /^\d{4,6}$/.test(q);

  const scored = STOCKS_LIST
    .map(s => ({ ...s, _score: score(s, q, lower) }))
    .filter(s => {
      if (s._score > 0) return true;
      if (isBseCode && s.bseCode.startsWith(q)) return true;
      return false;
    })
    .sort((a, b) => b._score - a._score)
    .slice(0, 8)
    .map(({ _score: _, ...s }): StockSearchResult => ({
      symbol: s.symbol,
      companyName: s.companyName,
      exchange: s.exchange,
      sector: s.sector,
      industry: s.industry,
      isin: s.isin,
      bseCode: s.bseCode,
    }));

  return NextResponse.json({ results: scored });
}
