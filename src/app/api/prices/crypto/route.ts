import { NextRequest, NextResponse } from 'next/server';
import { cacheGet, cacheSet, cacheAge, cacheClear, TTL } from '@/lib/utils/price-cache';

const COINS = ['bitcoin', 'ethereum', 'binancecoin', 'solana', 'ripple', 'cardano', 'polkadot', 'dogecoin'];
const CACHE_KEY = 'crypto_prices';

interface CoinGeckoItem {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  price_change_percentage_24h: number;
  market_cap: number;
  total_volume: number;
  image: string;
}

export interface CryptoPrice {
  id: string;
  symbol: string;
  name: string;
  priceInr: number;
  change24h: number;
  marketCap: number;
  volume24h: number;
  image: string;
  source: 'coingecko';
  cachedAgo: number | null;
}

export async function GET(req: NextRequest) {
  const force = req.nextUrl.searchParams.get('force') === '1';
  if (force) cacheClear(CACHE_KEY);

  const cached = cacheGet<CryptoPrice[]>(CACHE_KEY);
  if (cached) {
    return NextResponse.json({ prices: cached, cachedAgo: cacheAge(CACHE_KEY), fromCache: true });
  }

  try {
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=inr&ids=${COINS.join(',')}&order=market_cap_desc&per_page=20&page=1&sparkline=false&price_change_percentage=24h`;
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);

    const json: CoinGeckoItem[] = await res.json();
    const prices: CryptoPrice[] = json.map((c) => ({
      id: c.id,
      symbol: c.symbol.toUpperCase(),
      name: c.name,
      priceInr: c.current_price,
      change24h: c.price_change_percentage_24h ?? 0,
      marketCap: c.market_cap,
      volume24h: c.total_volume,
      image: c.image,
      source: 'coingecko',
      cachedAgo: null,
    }));

    cacheSet(CACHE_KEY, prices, TTL.CRYPTO);
    return NextResponse.json({ prices, cachedAgo: 0, fromCache: false });
  } catch (err) {
    return NextResponse.json({ error: String(err), prices: [] }, { status: 502 });
  }
}
