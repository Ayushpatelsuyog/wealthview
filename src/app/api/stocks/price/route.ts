import { NextRequest, NextResponse } from 'next/server';
import { cacheGet, cacheSet, TTL } from '@/lib/utils/price-cache';
import { STOCKS_MAP } from '@/lib/data/stocks-list';

export interface StockPriceData {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  dayHigh: number;
  dayLow: number;
  volume: number;
  lastUpdated: string;
}

function addNoise(base: number, seed: number): { price: number; change: number; changePct: number; dayHigh: number; dayLow: number } {
  const hourSeed = Math.floor(Date.now() / TTL.STOCKS);
  const s1 = Math.sin((hourSeed * 31337 + seed) * 0.001) * 0.015;
  const s2 = Math.sin((hourSeed * 13421 + seed) * 0.0017) * 0.008;
  const change = parseFloat((base * s1).toFixed(2));
  const price  = parseFloat((base + change).toFixed(2));
  const changePct = parseFloat(((change / base) * 100).toFixed(2));
  const dayHigh   = parseFloat((price + Math.abs(base * s2 * 0.5)).toFixed(2));
  const dayLow    = parseFloat((price - Math.abs(base * s2 * 0.6)).toFixed(2));
  return { price, change, changePct, dayHigh, dayLow };
}

function pseudoVolume(base: number, seed: number): number {
  const v = Math.abs(Math.sin(seed * 0.0031)) * 5_000_000;
  return Math.round((v * (base / 1000)) + 100_000);
}

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get('symbol') ?? '').toUpperCase().trim();
  if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 });

  const cacheKey = `stock_price_${symbol}`;
  const cached = cacheGet<StockPriceData>(cacheKey);
  if (cached) return NextResponse.json(cached);

  const stock = STOCKS_MAP.get(symbol);
  if (!stock) {
    // Return a generic simulated price for unknown symbols
    const seed = symbol.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const basePrice = 500 + (seed % 2000);
    const noise = addNoise(basePrice, seed);
    const data: StockPriceData = {
      symbol,
      price: noise.price,
      change: noise.change,
      changePct: noise.changePct,
      dayHigh: noise.dayHigh,
      dayLow: noise.dayLow,
      volume: pseudoVolume(basePrice, seed),
      lastUpdated: new Date().toISOString(),
    };
    cacheSet(cacheKey, data, TTL.STOCKS);
    return NextResponse.json(data);
  }

  const seed = stock.symbol.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const noise = addNoise(stock.basePrice, seed);
  const data: StockPriceData = {
    symbol: stock.symbol,
    price: noise.price,
    change: noise.change,
    changePct: noise.changePct,
    dayHigh: noise.dayHigh,
    dayLow: noise.dayLow,
    volume: pseudoVolume(stock.basePrice, seed),
    lastUpdated: new Date().toISOString(),
  };

  cacheSet(cacheKey, data, TTL.STOCKS);
  return NextResponse.json(data);
}
