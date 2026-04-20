import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

interface PriceData {
  price: number;
  currency: string;
  change?: number;
  changePercent?: number;
  changePct?: number;
  previousClose?: number;
}

async function fetchYahooFinancePrice(symbol: string): Promise<PriceData | null> {
  try {
    // Yahoo Finance API endpoint
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      console.error(`[Yahoo Finance] Failed to fetch ${symbol}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    
    if (!data?.chart?.result?.[0]) {
      console.error(`[Yahoo Finance] No data for ${symbol}`);
      return null;
    }

    const result = data.chart.result[0];
    const meta = result.meta;

    if (!meta?.regularMarketPrice) {
      console.error(`[Yahoo Finance] No price data for ${symbol}`);
      return null;
    }

    const price = meta.regularMarketPrice;
    const currency = meta.currency || 'USD';
    const previousClose = meta.chartPreviousClose || meta.previousClose;
    
    // Calculate change if not provided by Yahoo Finance
    let change = meta.regularMarketChange;
    let changePercent = meta.regularMarketChangePercent;
    
    if ((change === undefined || change === null) && previousClose) {
      change = price - previousClose;
      changePercent = previousClose > 0 ? ((change / previousClose) * 100) : 0;
      console.log(`[Yahoo Finance] ${symbol}: Calculated change=${change}, changePct=${changePercent}% (price=${price}, prevClose=${previousClose})`);
    } else {
      console.log(`[Yahoo Finance] ${symbol}: price=${price}, change=${change}, changePct=${changePercent}%, prevClose=${previousClose}`);
    }

    return {
      price,
      currency,
      change: change ?? undefined,
      changePercent: changePercent ?? undefined,
      changePct: changePercent ?? undefined, // Alias for frontend compatibility
      previousClose: previousClose ?? undefined,
    };
  } catch (error) {
    console.error(`[Yahoo Finance] Error fetching ${symbol}:`, error);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { symbols, nocache } = await req.json();
    if (!symbols || !Array.isArray(symbols)) {
      return NextResponse.json({ error: 'Invalid symbols' }, { status: 400 });
    }

    const results: Record<string, PriceData | null> = {};

    // Check cache first unless nocache is true
    if (!nocache) {
      const { data: cachedPrices } = await supabase
        .from('price_cache')
        .select('symbol, price, currency, metadata')
        .in('symbol', symbols)
        .eq('asset_type', 'global_stock')
        .gte('cached_at', new Date(Date.now() - 15 * 60 * 1000).toISOString()); // 15 min cache

      if (cachedPrices) {
        for (const cached of cachedPrices) {
          const metadata = cached.metadata as Record<string, number> | null;
          results[cached.symbol] = {
            price: cached.price,
            currency: cached.currency || 'USD',
            change: metadata?.change,
            changePercent: metadata?.changePercent,
            changePct: metadata?.changePct,
            previousClose: metadata?.previousClose,
          };
        }
      }
    }

    // Find symbols not in cache
    const uncachedSymbols = symbols.filter(s => !results[s]);

    if (uncachedSymbols.length > 0) {
      console.log(`[Global Stock Batch] Fetching ${uncachedSymbols.length} symbols from Yahoo Finance`);
      
      // Fetch from Yahoo Finance in parallel
      const fetchPromises = uncachedSymbols.map(symbol => 
        fetchYahooFinancePrice(symbol).then(data => ({ symbol, data }))
      );

      const fetchResults = await Promise.all(fetchPromises);

      // Process results and cache them
      const cacheInserts = [];
      for (const { symbol, data } of fetchResults) {
        if (data) {
          results[symbol] = data;
          
          // Prepare cache insert
          cacheInserts.push({
            symbol,
            asset_type: 'global_stock',
            price: data.price,
            currency: data.currency,
            metadata: {
              change: data.change,
              changePercent: data.changePercent,
              changePct: data.changePct,
              previousClose: data.previousClose,
            },
            cached_at: new Date().toISOString(),
          });
        } else {
          results[symbol] = null;
        }
      }

      // Bulk insert into cache
      if (cacheInserts.length > 0) {
        await supabase.from('price_cache').upsert(cacheInserts, {
          onConflict: 'symbol,asset_type',
        });
        console.log(`[Global Stock Batch] Cached ${cacheInserts.length} prices`);
      }
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.error('[Global Stock Batch] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
