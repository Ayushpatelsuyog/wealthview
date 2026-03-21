import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbols = searchParams.get('symbols')?.split(',') ?? [];

  if (!symbols.length) {
    return NextResponse.json({ error: 'No symbols provided' }, { status: 400 });
  }

  const supabase = await createClient();

  // Check cache first
  const { data: cached } = await supabase
    .from('price_cache')
    .select('*')
    .in('symbol', symbols)
    .gt('fetched_at', new Date(Date.now() - 5 * 60 * 1000).toISOString());

  const cachedSymbols = new Set(cached?.map((c) => c.symbol) ?? []);
  const uncachedSymbols = symbols.filter((s) => !cachedSymbols.has(s));

  // For uncached symbols, return placeholder (real implementation would fetch from external API)
  const prices: Record<string, { price: number; currency: string; source: string }> = {};

  for (const item of cached ?? []) {
    prices[item.symbol] = {
      price: item.price,
      currency: item.currency,
      source: item.source ?? 'cache',
    };
  }

  // Stub prices for uncached symbols
  for (const symbol of uncachedSymbols) {
    prices[symbol] = {
      price: 0,
      currency: 'INR',
      source: 'stub',
    };
  }

  return NextResponse.json({ prices, timestamp: new Date().toISOString() });
}
