import { NextRequest, NextResponse } from 'next/server';
import { STOCKS_MAP } from '@/lib/data/stocks-list';

// Simulate historical price for a given date.
// We use a deterministic formula so the same date always returns the same price.
// Price grows roughly 14% per year (good equity assumption) going backwards in time.

function historicalPrice(basePrice: number, symbol: string, dateStr: string): number {
  const today = new Date();
  const date  = new Date(dateStr);
  const msPerYear = 365.25 * 24 * 3600 * 1000;
  const yearsAgo = (today.getTime() - date.getTime()) / msPerYear;

  // Reverse compound: if current price = base, then historical = base / (1.14 ^ yearsAgo)
  const annualReturn = 0.14;
  const decayed = basePrice / Math.pow(1 + annualReturn, Math.max(0, yearsAgo));

  // Add deterministic daily noise: hash of (symbol + date)
  const seed = (symbol + dateStr).split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 0);
  const noise = Math.sin(seed * 0.001) * 0.02 * decayed;
  const price  = Math.max(1, decayed + noise);

  return parseFloat(price.toFixed(2));
}

export async function GET(req: NextRequest) {
  const symbol  = (req.nextUrl.searchParams.get('symbol') ?? '').toUpperCase().trim();
  const dateStr = req.nextUrl.searchParams.get('date') ?? '';

  if (!symbol || !dateStr) {
    return NextResponse.json({ error: 'symbol and date required' }, { status: 400 });
  }

  const parsed = new Date(dateStr);
  if (isNaN(parsed.getTime())) {
    return NextResponse.json({ error: 'invalid date' }, { status: 400 });
  }

  const stock = STOCKS_MAP.get(symbol);
  const basePrice = stock?.basePrice ?? 500;
  const price = historicalPrice(basePrice, symbol, dateStr);

  return NextResponse.json({ symbol, date: dateStr, price });
}
