import { NextRequest, NextResponse } from 'next/server';
import { GLOBAL_STOCKS_LIST, GlobalStockInfo } from '@/lib/data/global-stocks-list';

// ─── Exchange → country/currency mapping ─────────────────────────────────────

const EXCHANGE_MAP: Record<string, { country: string; currency: string; name: string }> = {
  // US
  NMS:     { country: 'US', currency: 'USD', name: 'NASDAQ' },
  NGM:     { country: 'US', currency: 'USD', name: 'NASDAQ' },
  NCM:     { country: 'US', currency: 'USD', name: 'NASDAQ' },
  NYQ:     { country: 'US', currency: 'USD', name: 'NYSE' },
  NYS:     { country: 'US', currency: 'USD', name: 'NYSE' },
  NYSE:    { country: 'US', currency: 'USD', name: 'NYSE' },
  NASDAQ:  { country: 'US', currency: 'USD', name: 'NASDAQ' },
  PCX:     { country: 'US', currency: 'USD', name: 'NYSE Arca' },
  BTS:     { country: 'US', currency: 'USD', name: 'NYSE Arca' },
  ASE:     { country: 'US', currency: 'USD', name: 'NYSE MKT' },
  // UK
  LSE:     { country: 'UK', currency: 'GBP', name: 'London' },
  LON:     { country: 'UK', currency: 'GBP', name: 'London' },
  IOB:     { country: 'UK', currency: 'GBP', name: 'London IOB' },
  // Canada
  TOR:     { country: 'Canada', currency: 'CAD', name: 'Toronto' },
  TSX:     { country: 'Canada', currency: 'CAD', name: 'TSX' },
  VAN:     { country: 'Canada', currency: 'CAD', name: 'TSX Venture' },
  CNQ:     { country: 'Canada', currency: 'CAD', name: 'CSE' },
  NEO:     { country: 'Canada', currency: 'CAD', name: 'NEO' },
  // Australia
  ASX:     { country: 'Australia', currency: 'AUD', name: 'ASX' },
  AX:      { country: 'Australia', currency: 'AUD', name: 'ASX' },
  CXA:     { country: 'Australia', currency: 'AUD', name: 'ASX' },  // Chi-X Australia
  // Germany
  GER:     { country: 'Germany', currency: 'EUR', name: 'Xetra' },
  FRA:     { country: 'Germany', currency: 'EUR', name: 'Frankfurt' },
  ETR:     { country: 'Germany', currency: 'EUR', name: 'Xetra' },
  BER:     { country: 'Germany', currency: 'EUR', name: 'Berlin' },
  DUS:     { country: 'Germany', currency: 'EUR', name: 'Dusseldorf' },
  MUN:     { country: 'Germany', currency: 'EUR', name: 'Munich' },
  STU:     { country: 'Germany', currency: 'EUR', name: 'Stuttgart' },
  // France
  PAR:     { country: 'France', currency: 'EUR', name: 'Euronext Paris' },
  ENX:     { country: 'France', currency: 'EUR', name: 'Euronext' },
  // Netherlands
  AMS:     { country: 'Netherlands', currency: 'EUR', name: 'Euronext Amsterdam' },
  // Spain
  MCE:     { country: 'Spain', currency: 'EUR', name: 'Madrid' },
  // Italy
  MIL:     { country: 'Italy', currency: 'EUR', name: 'Milan' },
  // Switzerland
  EBS:     { country: 'Switzerland', currency: 'CHF', name: 'SIX Swiss' },
  // Denmark
  CPH:     { country: 'Denmark', currency: 'DKK', name: 'Copenhagen' },
  // Sweden
  STO:     { country: 'Sweden', currency: 'SEK', name: 'Stockholm' },
  // Norway
  OSL:     { country: 'Norway', currency: 'NOK', name: 'Oslo' },
  // Finland
  HEL:     { country: 'Finland', currency: 'EUR', name: 'Helsinki' },
  // Japan
  JPX:     { country: 'Japan', currency: 'JPY', name: 'Tokyo' },
  TYO:     { country: 'Japan', currency: 'JPY', name: 'Tokyo' },
  TSE:     { country: 'Japan', currency: 'JPY', name: 'Tokyo' },
  // Hong Kong
  HKG:     { country: 'Hong Kong', currency: 'HKD', name: 'HKEX' },
  HKSE:    { country: 'Hong Kong', currency: 'HKD', name: 'HKEX' },
  // South Korea
  KSC:     { country: 'South Korea', currency: 'KRW', name: 'Korea' },
  KOE:     { country: 'South Korea', currency: 'KRW', name: 'Korea' },
  // Singapore
  SES:     { country: 'Singapore', currency: 'SGD', name: 'SGX' },
  SGX:     { country: 'Singapore', currency: 'SGD', name: 'SGX' },
  // China
  SHH:     { country: 'China', currency: 'CNY', name: 'Shanghai' },
  SHZ:     { country: 'China', currency: 'CNY', name: 'Shenzhen' },
  // Taiwan
  TAI:     { country: 'Taiwan', currency: 'TWD', name: 'Taiwan' },
  TWO:     { country: 'Taiwan', currency: 'TWD', name: 'Taiwan OTC' },
  // Brazil
  SAO:     { country: 'Brazil', currency: 'BRL', name: 'B3' },
  // Mexico
  MEX:     { country: 'Mexico', currency: 'MXN', name: 'BMV' },
  // India — skip these since we have a dedicated Indian Stocks module
  NSI:     { country: 'India', currency: 'INR', name: 'NSE' },
  BSE:     { country: 'India', currency: 'INR', name: 'BSE' },
  BOM:     { country: 'India', currency: 'INR', name: 'BSE' },
  // Israel
  TLV:     { country: 'Israel', currency: 'ILS', name: 'Tel Aviv' },
  // South Africa
  JNB:     { country: 'South Africa', currency: 'ZAR', name: 'JSE' },
  // New Zealand
  NZE:     { country: 'New Zealand', currency: 'NZD', name: 'NZX' },
};

// Exchanges to exclude (Indian stocks have their own module)
const EXCLUDED_EXCHANGES = new Set(['NSI', 'BSE', 'BOM']);

// ─── Yahoo Finance search API ────────────────────────────────────────────────

interface YahooQuote {
  symbol: string;
  shortname?: string;
  longname?: string;
  exchange?: string;
  exchDisp?: string;
  quoteType?: string;
  typeDisp?: string;
  score?: number;
}

interface SearchResult {
  symbol: string;
  companyName: string;
  exchange: string;
  currency: string;
  sector: string;
  country: string;
  quoteType: string;
}

const ALLOWED_QUOTE_TYPES = new Set(['EQUITY', 'ETF']);

async function yahooSearch(query: string): Promise<SearchResult[]> {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
  };

  for (const host of ['query2', 'query1']) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 8_000);
      const url = `https://${host}.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&lang=en-US&region=US&quotesCount=20&newsCount=0&enableFuzzyQuery=true&quotesQueryId=tss_match_phrase_query`;
      const res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(tid);
      if (!res.ok) continue;

      const json = await res.json();
      const quotes: YahooQuote[] = json?.quotes ?? [];

      const results: SearchResult[] = [];
      for (const q of quotes) {
        if (!q.symbol || !q.quoteType) continue;
        if (!ALLOWED_QUOTE_TYPES.has(q.quoteType)) continue;

        const exchCode = q.exchange ?? '';
        if (EXCLUDED_EXCHANGES.has(exchCode)) continue;

        const exchInfo = EXCHANGE_MAP[exchCode];
        // Infer currency from symbol suffix if exchange unknown
        let inferredCurrency = 'USD';
        const symSuffix = q.symbol.split('.').pop()?.toUpperCase() ?? '';
        const suffixCurrencyMap: Record<string, string> = {
          AX: 'AUD', TO: 'CAD', L: 'GBP', T: 'JPY', HK: 'HKD', DE: 'EUR', PA: 'EUR',
          AS: 'EUR', SW: 'CHF', ST: 'SEK', OL: 'NOK', CO: 'DKK', HE: 'EUR',
          KS: 'KRW', KQ: 'KRW', SI: 'SGD', SS: 'CNY', SZ: 'CNY', TW: 'TWD',
          SA: 'BRL', MX: 'MXN', JO: 'ZAR', NZ: 'NZD', XA: 'AUD',
        };
        if (suffixCurrencyMap[symSuffix]) inferredCurrency = suffixCurrencyMap[symSuffix];

        const country = exchInfo?.country ?? q.exchDisp ?? '';
        const currency = exchInfo?.currency ?? inferredCurrency;
        const exchangeName = exchInfo?.name ?? q.exchDisp ?? exchCode;

        results.push({
          symbol: q.symbol,
          companyName: q.longname || q.shortname || q.symbol,
          exchange: exchangeName,
          currency,
          sector: '',
          country,
          quoteType: q.typeDisp || q.quoteType,
        });
      }

      if (results.length > 0) return results;
    } catch (err) {
      console.warn(`[Global Search] Yahoo (${host}) error:`, (err as Error).message);
    }
  }
  return [];
}

// ─── Hardcoded fallback search ───────────────────────────────────────────────

function fallbackSearch(q: string): SearchResult[] {
  const lower = q.toLowerCase();
  const words = lower.split(/\s+/).filter(w => w.length >= 1);

  function score(stock: GlobalStockInfo): number {
    const sym = stock.symbol.toLowerCase();
    const name = stock.companyName.toLowerCase();
    if (sym === lower) return 100;
    if (sym.startsWith(lower)) return 80;
    if (name.includes(lower)) return 50;
    if (words.length > 1 && words.every(w => name.includes(w) || sym.includes(w))) return 40;
    if (words.length === 1 && name.split(/\s+/).some(part => part.startsWith(lower))) return 35;
    if (sym.includes(lower)) return 30;
    return 0;
  }

  return GLOBAL_STOCKS_LIST
    .map(s => ({ ...s, _score: score(s) }))
    .filter(s => s._score > 0)
    .sort((a, b) => b._score - a._score)
    .slice(0, 15)
    .map(({ _score: _, ...s }) => ({
      symbol: s.symbol,
      companyName: s.companyName,
      exchange: s.exchange,
      currency: s.currency,
      sector: s.sector,
      country: s.country,
      quoteType: 'Equity',
    }));
}

// ─── Enrich with hardcoded sector data if available ──────────────────────────

const hardcodedMap = new Map<string, GlobalStockInfo>();
for (const s of GLOBAL_STOCKS_LIST) hardcodedMap.set(s.symbol, s);

function enrichResults(results: SearchResult[]): SearchResult[] {
  return results.map(r => {
    const hc = hardcodedMap.get(r.symbol);
    if (hc) {
      return { ...r, sector: hc.sector || r.sector, country: r.country || hc.country };
    }
    return r;
  });
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  if (q.length < 1) return NextResponse.json({ results: [] });

  // Try Yahoo Finance live search first
  let results = await yahooSearch(q);

  // Fallback to hardcoded list if Yahoo fails
  if (results.length === 0) {
    console.warn(`[Global Search] Yahoo returned 0 results for "${q}", using fallback`);
    results = fallbackSearch(q);
  }

  // Enrich with sector data from hardcoded list
  results = enrichResults(results);

  return NextResponse.json({ results: results.slice(0, 15) });
}
