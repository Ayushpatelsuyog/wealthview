import { NextRequest, NextResponse } from 'next/server';
import { cacheGet, cacheSet, cacheAge, cacheClear, TTL } from '@/lib/utils/price-cache';

export interface StockPrice {
  symbol: string;
  name: string;
  exchange: 'NSE' | 'NASDAQ' | 'NYSE';
  price: number;
  change: number;
  changePct: number;
  high52w: number;
  low52w: number;
  source: 'simulated';
  cachedAgo: number | null;
}

const INDIAN_STOCKS: Omit<StockPrice, 'change' | 'changePct' | 'cachedAgo' | 'source'>[] = [
  { symbol: 'RELIANCE', name: 'Reliance Industries', exchange: 'NSE', price: 2847.50, high52w: 3217.90, low52w: 2220.30 },
  { symbol: 'TCS',      name: 'Tata Consultancy Services', exchange: 'NSE', price: 3612.00, high52w: 4256.85, low52w: 3311.00 },
  { symbol: 'HDFCBANK', name: 'HDFC Bank', exchange: 'NSE', price: 1721.30, high52w: 1880.00, low52w: 1363.55 },
  { symbol: 'INFY',     name: 'Infosys', exchange: 'NSE', price: 1543.75, high52w: 1953.90, low52w: 1358.35 },
  { symbol: 'ICICIBANK',name: 'ICICI Bank', exchange: 'NSE', price: 1284.60, high52w: 1361.65, low52w: 970.35 },
  { symbol: 'HINDUNILVR',name:'Hindustan Unilever', exchange: 'NSE', price: 2198.40, high52w: 2778.70, low52w: 2172.00 },
  { symbol: 'BAJFINANCE',name:'Bajaj Finance', exchange: 'NSE', price: 6832.00, high52w: 8192.00, low52w: 6187.00 },
  { symbol: 'SBIN',     name: 'State Bank of India', exchange: 'NSE', price: 812.45, high52w: 912.00, low52w: 600.55 },
  { symbol: 'TATAMOTORS',name:'Tata Motors', exchange: 'NSE', price: 718.90, high52w: 1179.00, low52w: 657.35 },
  { symbol: 'WIPRO',    name: 'Wipro', exchange: 'NSE', price: 467.25, high52w: 579.80, low52w: 406.30 },
];

const GLOBAL_STOCKS: Omit<StockPrice, 'change' | 'changePct' | 'cachedAgo' | 'source'>[] = [
  { symbol: 'AAPL',  name: 'Apple Inc.',          exchange: 'NASDAQ', price: 213.50, high52w: 237.23, low52w: 164.07 },
  { symbol: 'MSFT',  name: 'Microsoft Corp.',      exchange: 'NASDAQ', price: 420.55, high52w: 468.35, low52w: 362.90 },
  { symbol: 'GOOGL', name: 'Alphabet Inc.',        exchange: 'NASDAQ', price: 175.98, high52w: 207.05, low52w: 130.67 },
  { symbol: 'AMZN',  name: 'Amazon.com Inc.',      exchange: 'NASDAQ', price: 222.15, high52w: 242.52, low52w: 151.61 },
  { symbol: 'NVDA',  name: 'NVIDIA Corp.',         exchange: 'NASDAQ', price: 138.85, high52w: 153.13, low52w:  47.32 },
  { symbol: 'META',  name: 'Meta Platforms Inc.',  exchange: 'NASDAQ', price: 612.90, high52w: 740.91, low52w: 386.14 },
  { symbol: 'TSLA',  name: 'Tesla Inc.',           exchange: 'NASDAQ', price: 261.30, high52w: 488.54, low52w: 138.80 },
  { symbol: 'BRK-B', name: 'Berkshire Hathaway B', exchange: 'NYSE',   price: 464.00, high52w: 504.26, low52w: 357.00 },
];

function addNoise(base: number): { price: number; change: number; changePct: number } {
  // ±1.5% random daily move, seeded by hour so it stays stable within a cache window
  const seed = Math.floor(Date.now() / TTL.STOCKS);
  const pseudoRandom = Math.sin(seed * base) * 0.015;
  const change = parseFloat((base * pseudoRandom).toFixed(2));
  const price = parseFloat((base + change).toFixed(2));
  const changePct = parseFloat(((change / base) * 100).toFixed(2));
  return { price, change, changePct };
}

const CACHE_KEY = 'stock_prices';

export async function GET(req: NextRequest) {
  const force = req.nextUrl.searchParams.get('force') === '1';
  if (force) cacheClear(CACHE_KEY);

  const cached = cacheGet<{ indian: StockPrice[]; global: StockPrice[] }>(CACHE_KEY);
  if (cached) {
    return NextResponse.json({ ...cached, cachedAgo: cacheAge(CACHE_KEY), fromCache: true });
  }

  const indian: StockPrice[] = INDIAN_STOCKS.map((s) => ({
    ...s, ...addNoise(s.price), source: 'simulated', cachedAgo: null,
  }));
  const global: StockPrice[] = GLOBAL_STOCKS.map((s) => ({
    ...s, ...addNoise(s.price), source: 'simulated', cachedAgo: null,
  }));

  const payload = { indian, global };
  cacheSet(CACHE_KEY, payload, TTL.STOCKS);
  return NextResponse.json({ ...payload, cachedAgo: 0, fromCache: false });
}
