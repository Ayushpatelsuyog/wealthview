'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import {
  RefreshCw, PlusCircle, Loader2, AlertCircle, TrendingUp, TrendingDown,
  MoreHorizontal, Search, Download, X, ChevronDown, ChevronRight, Globe,
} from 'lucide-react';
import { GlobalStockDetailSheet, type GlobalStockHoldingDetail } from '@/components/portfolio/GlobalStockDetailSheet';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR, formatPercentage } from '@/lib/utils/formatters';
import { calculateXIRR } from '@/lib/utils/calculations';
import { holdingsCacheGet, holdingsCacheSet, holdingsCacheClear, holdingsCacheClearAll } from '@/lib/utils/holdings-cache';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Transaction { id: string; date: string; price: number; quantity: number; type: string; fees: number; notes?: string; metadata?: Record<string, unknown> }

interface RawHolding {
  id: string;
  symbol: string;
  name: string;
  quantity: number;
  avg_buy_price: number;
  metadata: Record<string, unknown>;
  portfolios: { id: string; name: string; type: string; user_id: string } | null;
  brokers:    { id: string; name: string; platform_type: string } | null;
  transactions: Transaction[];
}

interface HoldingRow extends RawHolding {
  currentPrice:     number | null;
  priceLoading:     boolean;
  priceUnavailable: boolean;
  investedValue:    number;
  currentValue:     number | null;
  investedINR:      number;
  currentValueINR:  number | null;
  gainLoss:         number | null;
  gainLossPct:      number | null;
  xirr:             number | null;
  dayChange:        number | null;
  dayChangePct:     number | null;
  memberName:       string;
  country:          string;
  currency:         string;
  fxRate:           number | null;
}

type SortKey = 'value' | 'pnlPct' | 'xirr' | 'name';

// ─── Country / Currency helpers ──────────────────────────────────────────────

const COUNTRY_FLAG: Record<string, string> = {
  US: '🇺🇸', UK: '🇬🇧', DE: '🇩🇪', FR: '🇫🇷',
  JP: '🇯🇵', HK: '🇭🇰', AU: '🇦🇺', SG: '🇸🇬',
  CA: '🇨🇦', CH: '🇨🇭', CN: '🇨🇳', KR: '🇰🇷',
  NL: '🇳🇱', SE: '🇸🇪', IT: '🇮🇹', ES: '🇪🇸',
  IE: '🇮🇪', BR: '🇧🇷', AE: '🇦🇪', IN: '🇮🇳',
};

const CURRENCY_COUNTRY: Record<string, string> = {
  USD: 'US', GBP: 'UK', GBp: 'UK', EUR: 'DE', JPY: 'JP', HKD: 'HK',
  AUD: 'AU', SGD: 'SG', CAD: 'CA', CHF: 'CH', CNY: 'CN', KRW: 'KR',
  SEK: 'SE', BRL: 'BR', AED: 'AE', INR: 'IN',
};

const COUNTRY_REGION: Record<string, string> = {
  US: 'US', CA: 'US',
  UK: 'Europe', DE: 'Europe', FR: 'Europe', NL: 'Europe', SE: 'Europe', IT: 'Europe',
  ES: 'Europe', IE: 'Europe', CH: 'Europe',
  JP: 'Asia', HK: 'Asia', SG: 'Asia', AU: 'Asia', CN: 'Asia', KR: 'Asia', IN: 'Asia',
  BR: 'LatAm', AE: 'Middle East',
};

function resolveCountry(meta: Record<string, unknown>, currency: string): string {
  if (meta?.country) return String(meta.country);
  return CURRENCY_COUNTRY[currency] ?? 'US';
}

function countryFlag(code: string): string {
  return COUNTRY_FLAG[code] ?? '🌍';
}

function regionOf(country: string): string {
  return COUNTRY_REGION[country] ?? 'Other';
}

const REGION_COLORS: Record<string, string> = {
  US: '#1B2A4A', Europe: '#2563EB', Asia: '#059669', LatAm: '#EA580C', 'Middle East': '#D97706', Other: '#6B7280',
};

function countryColor(country: string): string {
  return REGION_COLORS[regionOf(country)] ?? '#6B7280';
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(v: number): string {
  if (v >= 10_000_000) return `₹${(v / 10_000_000).toFixed(2)}Cr`;
  if (v >= 100_000)    return `₹${(v / 100_000).toFixed(2)}L`;
  if (v >= 1_000)      return `₹${(v / 1_000).toFixed(1)}K`;
  return `₹${Math.round(v)}`;
}

function fmtLocal(v: number, currency: string): string {
  const sym = currency === 'GBP' || currency === 'GBp' ? '£' : currency === 'EUR' ? '€' : currency === 'JPY' ? '¥' : '$';
  const divisor = currency === 'GBp' ? 100 : 1;
  const val = v / divisor;
  return `${sym}${val.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function _PnlBadge({ value, pct }: { value: number; pct: number }) {
  const up = value >= 0;
  return (
    <div>
      <p className="text-xs font-semibold" style={{ color: up ? '#059669' : '#DC2626' }}>
        {up ? '+' : ''}{formatLargeINR(value)}
      </p>
      <p className="text-[10px]" style={{ color: up ? '#059669' : '#DC2626' }}>
        {up ? <TrendingUp className="w-2.5 h-2.5 inline mr-0.5" /> : <TrendingDown className="w-2.5 h-2.5 inline mr-0.5" />}
        {formatPercentage(pct)}
      </p>
    </div>
  );
}

// ─── Action Menu ─────────────────────────────────────────────────────────────

function ActionMenu({
  holdingId, onDelete, onViewDetails,
}: {
  holdingId: string;
  onDelete: (id: string) => void;
  onViewDetails: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const actions = [
    { label: 'View details',    action: () => { onViewDetails(holdingId); setOpen(false); } },
    { label: 'Edit',            action: () => { router.push(`/add-assets/global-stocks`); setOpen(false); } },
    { label: 'Add More Shares', action: () => { router.push(`/add-assets/global-stocks`); setOpen(false); } },
    { label: 'Sell',            action: () => { router.push(`/add-assets/global-stocks`); setOpen(false); } },
    { label: 'Record Dividend', action: () => { router.push(`/add-assets/global-stocks`); setOpen(false); } },
    { label: 'Delete',          action: () => { onDelete(holdingId); setOpen(false); }, danger: true },
  ];
  return (
    <div className="relative">
      <button onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="p-1 rounded hover:bg-gray-100 transition-colors">
        <MoreHorizontal className="w-3.5 h-3.5" style={{ color: '#9CA3AF' }} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0" style={{ zIndex: 9990 }} onClick={() => setOpen(false)} />
          <div className="absolute right-0 bg-white rounded-xl border py-1 min-w-[180px]"
            style={{ borderColor: '#E8E5DD', top: '100%', zIndex: 9999, boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}>
            {actions.map(({ label, action, danger }) => (
              <button key={label} onClick={(e) => { e.stopPropagation(); action(); }}
                className="w-full text-left px-4 py-2 text-xs hover:bg-gray-50 transition-colors"
                style={{ color: danger ? '#DC2626' : '#1A1A2E' }}>
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Donut Chart ─────────────────────────────────────────────────────────────

interface PieEntry { name: string; value: number }

function DonutChart({ title, data, getColor }: {
  title: string; data: PieEntry[]; getColor: (name: string, index: number) => string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (data.length === 0) {
    return (
      <div className="wv-card flex flex-col" style={{ padding: 16, minHeight: 220 }}>
        <p className="text-xs font-semibold mb-3" style={{ color: '#1B2A4A' }}>
          {title} <span style={{ color: '#9CA3AF', fontWeight: 400 }}>(Market Value)</span>
        </p>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs" style={{ color: '#9CA3AF' }}>No data</p>
        </div>
      </div>
    );
  }
  return (
    <div className="wv-card" style={{ padding: 16, overflow: 'hidden' }}>
      <p className="text-xs font-semibold mb-3" style={{ color: '#1B2A4A' }}>
        {title} <span style={{ color: '#9CA3AF', fontWeight: 400 }}>(Market Value)</span>
      </p>
      <div style={{ width: 150, height: 150, margin: '0 auto 12px' }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius={46} outerRadius={70}
              paddingAngle={data.length > 1 ? 2 : 0} dataKey="value" strokeWidth={0}>
              {data.map((entry, i) => (
                <Cell key={entry.name} fill={getColor(entry.name, i)} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) => [fmt(Number(value)), '']}
              contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #E8E5DD', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
              itemStyle={{ color: '#1A1A2E' }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {data.map((entry, i) => {
          const pct   = total > 0 ? (entry.value / total * 100).toFixed(1) : '0';
          const color = getColor(entry.name, i);
          return (
            <div key={entry.name} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span style={{ flexShrink: 0, width: 8, height: 8, borderRadius: 2, backgroundColor: color, display: 'inline-block' }} />
              <span style={{ flex: 1, fontSize: 11, color: '#4B5563', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {entry.name}
              </span>
              <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, color: '#1A1A2E', fontVariantNumeric: 'tabular-nums' }}>
                {fmt(entry.value)}
              </span>
              <span style={{ flexShrink: 0, fontSize: 10, color: '#9CA3AF', width: 36, textAlign: 'right' }}>
                {pct}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const BROKER_PALETTE   = ['#1B2A4A', '#2E8B8B', '#C9A84C', '#059669', '#7C3AED', '#EA580C', '#2563EB', '#DB2777'];
const PORTFOLIO_PALETTE = ['#7C3AED', '#2563EB', '#059669', '#EA580C', '#DB2777', '#D97706', '#0891B2'];

// ─── Pill ────────────────────────────────────────────────────────────────────

function Pill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="px-3 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors"
      style={{
        backgroundColor: active ? '#1B2A4A' : '#F7F5F0',
        color:           active ? 'white'   : '#6B7280',
        border:          `1px solid ${active ? '#1B2A4A' : '#E8E5DD'}`,
      }}>
      {label}
    </button>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function GlobalStocksPortfolioPage() {
  const router   = useRouter();
  const supabase = createClient();

  const [holdings,       setHoldings]       = useState<HoldingRow[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState<string | null>(null);
  const [priceRefreshing,setPriceRefreshing]= useState(false);
  const [toast,          setToast]          = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [detailId,       setDetailId]       = useState<string | null>(null);
  const [_memberNames,   setMemberNames]    = useState<Record<string, string>>({});
  const [fxRates,        setFxRates]        = useState<Record<string, number>>({});
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Filters
  const [filterBrokers,    setFilterBrokers]    = useState<Set<string>>(new Set());
  const [filterPortfolios, setFilterPortfolios] = useState<Set<string>>(new Set());
  const [filterCountries,  setFilterCountries]  = useState<Set<string>>(new Set());
  const [sortKey,          setSortKey]          = useState<SortKey>('value');
  const [searchQuery,      setSearchQuery]      = useState('');

  function toggleSet(set: Set<string>, setFn: (s: Set<string>) => void, val: string) {
    const next = new Set(set);
    if (next.has(val)) next.delete(val); else next.add(val);
    setFn(next);
  }

  function clearFilters() {
    setFilterBrokers(new Set()); setFilterPortfolios(new Set());
    setFilterCountries(new Set()); setSearchQuery('');
  }

  const isFiltered = filterBrokers.size > 0 || filterPortfolios.size > 0 || filterCountries.size > 0 || !!searchQuery;

  // ── Fetch FX rates ──────────────────────────────────────────────────────────

  async function fetchFxRates(currencies: string[]): Promise<Record<string, number>> {
    const unique = Array.from(new Set(currencies.filter(c => c !== 'INR')));
    const rates: Record<string, number> = { INR: 1 };
    await Promise.allSettled(unique.map(async (cur) => {
      try {
        const res = await fetch(`/api/fx/rate?from=${cur}&to=INR`);
        const json = await res.json();
        if (json.rate) rates[cur] = json.rate;
      } catch { /* use fallback if available later */ }
    }));
    return rates;
  }

  // ── Load holdings ──────────────────────────────────────────────────────────

  const loadHoldings = useCallback(async () => {
    setLoading(true); setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/login'); return; }

    const { data: usersData } = await supabase.from('users').select('id, name');
    const names: Record<string, string> = {};
    (usersData ?? []).forEach(u => { names[u.id] = u.name; });
    setMemberNames(names);

    // Check holdings cache first
    const cachedHoldings = holdingsCacheGet<RawHolding[]>('global_stock_holdings');
    let data: unknown[] | null = cachedHoldings;

    if (!data) {
      const { data: freshData, error: dbErr } = await supabase
        .from('holdings')
        .select(`
          id, symbol, name, quantity, avg_buy_price, metadata,
          portfolios(id, name, type, user_id),
          brokers(id, name, platform_type),
          transactions(id, date, price, quantity, type, fees, notes, metadata)
        `)
        .eq('asset_type', 'global_stock')
        .gt('quantity', 0)
        .order('created_at', { ascending: false });

      if (dbErr) { setError(dbErr.message); setLoading(false); return; }
      data = freshData;
      if (data) holdingsCacheSet('global_stock_holdings', data as unknown as RawHolding[]);
    }

    if (!data) { setError('Failed to load holdings'); setLoading(false); return; }

    const rawRows = data as unknown as RawHolding[];

    // Determine currencies from metadata
    const currencySet = new Set<string>();
    rawRows.forEach(h => {
      const cur = String(h.metadata?.currency ?? 'USD');
      currencySet.add(cur);
    });

    // Fetch FX rates for all currencies
    const rates = await fetchFxRates(Array.from(currencySet));
    setFxRates(rates);

    const rows: HoldingRow[] = rawRows.map(h => {
      const cur        = String(h.metadata?.currency ?? 'USD');
      const country    = resolveCountry(h.metadata, cur);
      const rate       = rates[cur] ?? null;
      const invested   = Number(h.quantity) * Number(h.avg_buy_price);
      const investedINR = rate != null ? invested * rate : invested;
      const ownerId    = h.portfolios?.user_id ?? '';
      return {
        ...h,
        currentPrice: null, priceLoading: true, priceUnavailable: false,
        investedValue: invested,
        currentValue: null,
        investedINR,
        currentValueINR: null,
        gainLoss: null, gainLossPct: null, xirr: null,
        dayChange: null, dayChangePct: null,
        memberName: names[ownerId] ?? '',
        country,
        currency: cur,
        fxRate: rate,
      };
    });

    setHoldings(rows);
    setLoading(false);

    // Batch-fetch all prices in a single request
    const uniqueSymbols = Array.from(new Set(rows.map(r => r.symbol)));
    await fetchPriceBatch(uniqueSymbols, rows, rates, false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function computeRow(h: HoldingRow, price: number, rates: Record<string, number>): HoldingRow {
    const rate = rates[h.currency] ?? h.fxRate ?? 1;
    const currentValue = Number(h.quantity) * price;
    const currentValueINR = currentValue * rate;
    const investedINR = h.investedValue * rate;
    const gainLoss = currentValueINR - investedINR;
    const gainLossPct = investedINR > 0 ? (gainLoss / investedINR) * 100 : 0;
    let xirr: number | null = null;
    const buyTxns = (h.transactions ?? []).filter(t => t.type === 'buy' || t.type === 'sip');
    if (buyTxns.length > 0) {
      const earliest = buyTxns.reduce((a, b) => new Date(a.date) < new Date(b.date) ? a : b);
      const d0 = new Date(earliest.date);
      if (new Date() > d0) {
        try {
          const r = calculateXIRR([-investedINR, currentValueINR], [d0, new Date()]);
          if (isFinite(r)) xirr = r * 100;
        } catch { /* skip */ }
      }
    }
    return {
      ...h,
      currentPrice: price, priceLoading: false, priceUnavailable: false,
      currentValue, currentValueINR, investedINR,
      gainLoss, gainLossPct, xirr, fxRate: rate,
    };
  }

  async function fetchPriceBatch(
    symbols: string[], baseRows?: HoldingRow[], rates?: Record<string, number>, nocache = false
  ): Promise<number> {
    const rateMap = rates ?? fxRates;
    try {
      const res = await fetch('/api/stocks/global/price/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols, nocache }),
      });
      const json = await res.json();
      const batchResults: Record<string, { price: number; currency?: string; change?: number; changePct?: number; previousClose?: number } | null> = json.results ?? {};
      let succeeded = 0;
      setHoldings(prev => {
        const source = baseRows ?? prev;
        return source.map(h => {
          if (!symbols.includes(h.symbol)) return h;
          const result = batchResults[h.symbol];
          if (!result) return { ...h, priceLoading: false, priceUnavailable: true };
          succeeded++;
          const updated = computeRow(h, result.price, rateMap);
          return {
            ...updated,
            dayChange: result.change ?? null,
            dayChangePct: result.changePct ?? null,
          };
        });
      });
      return succeeded;
    } catch {
      setHoldings(prev => prev.map(h => symbols.includes(h.symbol) ? { ...h, priceLoading: false, priceUnavailable: true } : h));
      return 0;
    }
  }

  async function fetchPrice(symbol: string, bypassCache = false): Promise<boolean> {
    if (bypassCache) {
      setHoldings(prev => prev.map(h => h.symbol === symbol ? { ...h, priceLoading: true, priceUnavailable: false } : h));
    }
    const count = await fetchPriceBatch([symbol], undefined, undefined, bypassCache);
    return count > 0;
  }

  useEffect(() => { loadHoldings(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function refreshAllPrices() {
    setPriceRefreshing(true);
    holdingsCacheClearAll();
    // Refresh FX rates too
    const currencySet = new Set(holdings.map(h => h.currency));
    const freshRates = await fetchFxRates(Array.from(currencySet));
    setFxRates(freshRates);
    const unique = Array.from(new Set(holdings.map(h => h.symbol)));
    const succeeded = await fetchPriceBatch(unique, undefined, freshRates, true);
    const total = unique.length;
    setPriceRefreshing(false);
    setToast({ type: succeeded === total ? 'success' : 'error',
      message: `Prices updated for ${succeeded} of ${total} stock${total !== 1 ? 's' : ''}` });
    setTimeout(() => setToast(null), 4000);
  }

  async function deleteHolding(id: string) {
    if (!confirm('Delete this holding and all its transactions?')) return;
    await supabase.from('transactions').delete().eq('holding_id', id);
    await supabase.from('holdings').delete().eq('id', id);
    setHoldings(prev => prev.filter(h => h.id !== id));
  }

  // ── Filter options ─────────────────────────────────────────────────────────

  const brokers    = useMemo(() => Array.from(new Set(holdings.map(h => h.brokers?.name ?? '—').filter(Boolean))), [holdings]);
  const portfolios = useMemo(() => Array.from(new Set(holdings.map(h => h.portfolios?.name ?? 'My Portfolio').filter(Boolean))), [holdings]);
  const countries  = useMemo(() => Array.from(new Set(holdings.map(h => h.country).filter(Boolean))).sort(), [holdings]);

  // ── Filtered + sorted holdings ────────────────────────────────────────────

  const filtered = useMemo(() => {
    let rows = holdings;
    if (filterBrokers.size > 0)    rows = rows.filter(h => filterBrokers.has(h.brokers?.name ?? '—'));
    if (filterPortfolios.size > 0) rows = rows.filter(h => filterPortfolios.has(h.portfolios?.name ?? 'My Portfolio'));
    if (filterCountries.size > 0)  rows = rows.filter(h => filterCountries.has(h.country));
    if (searchQuery)               rows = rows.filter(h =>
      h.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      h.symbol.toLowerCase().includes(searchQuery.toLowerCase())
    );
    return [...rows].sort((a, b) => {
      switch (sortKey) {
        case 'value':  return (b.currentValueINR ?? b.investedINR) - (a.currentValueINR ?? a.investedINR);
        case 'pnlPct': return (b.gainLossPct ?? 0) - (a.gainLossPct ?? 0);
        case 'xirr':   return (b.xirr ?? -Infinity) - (a.xirr ?? -Infinity);
        case 'name':   return a.name.localeCompare(b.name);
        default:       return 0;
      }
    });
  }, [holdings, filterBrokers, filterPortfolios, filterCountries, searchQuery, sortKey]);

  // ── Grouped holdings (multi-distributor consolidation) ────────────────────

  interface StockGroup {
    symbol: string; name: string; country: string; currency: string;
    holdings: HoldingRow[]; isMultiBroker: boolean;
    totalQty: number; totalInvestedINR: number;
    totalCurrentValueINR: number | null;
    currentPrice: number | null; priceLoading: boolean; priceUnavailable: boolean;
    fxRate: number | null;
  }

  const groupedFiltered: StockGroup[] = useMemo(() => {
    const map = new Map<string, HoldingRow[]>();
    for (const h of filtered) {
      const key = h.symbol;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(h);
    }
    return Array.from(map.entries()).map(([symbol, rows]) => ({
      symbol,
      name: rows[0].name,
      country: rows[0].country,
      currency: rows[0].currency,
      holdings: rows,
      isMultiBroker: rows.length > 1,
      totalQty: rows.reduce((s, r) => s + Number(r.quantity), 0),
      totalInvestedINR: rows.reduce((s, r) => s + r.investedINR, 0),
      totalCurrentValueINR: rows.every(r => r.currentValueINR != null)
        ? rows.reduce((s, r) => s + (r.currentValueINR ?? 0), 0) : null,
      currentPrice: rows[0].currentPrice,
      priceLoading: rows.some(r => r.priceLoading),
      priceUnavailable: rows.every(r => r.priceUnavailable),
      fxRate: rows[0].fxRate,
    }));
  }, [filtered]);

  // Auto-expand new multi-broker groups
  useEffect(() => {
    const multiBrokerSymbols = groupedFiltered.filter(g => g.isMultiBroker).map(g => g.symbol);
    setExpandedGroups(prev => {
      const next = new Set(prev);
      multiBrokerSymbols.forEach(s => { if (!next.has(s)) next.add(s); });
      return next.size !== prev.size ? next : prev;
    });
  }, [groupedFiltered]);

  const uniqueStockCount = groupedFiltered.length;
  const totalUniqueStockCount = useMemo(() => new Set(holdings.map(h => h.symbol)).size, [holdings]);

  // ── Summary totals ────────────────────────────────────────────────────────

  const totalInvestedINR     = filtered.reduce((s, h) => s + h.investedINR, 0);
  const totalCurrentValueINR = filtered.reduce((s, h) => s + (h.currentValueINR ?? h.investedINR), 0);
  const totalGainLoss        = totalCurrentValueINR - totalInvestedINR;
  const totalGainLossPct     = totalInvestedINR > 0 ? (totalGainLoss / totalInvestedINR) * 100 : 0;

  const totalDayPnl = filtered.reduce((s, h) => {
    if (h.dayChange == null || h.fxRate == null) return s;
    return s + Number(h.quantity) * h.dayChange * h.fxRate;
  }, 0);
  const totalDayPnlPct = totalCurrentValueINR > 0 && totalDayPnl !== 0
    ? (totalDayPnl / (totalCurrentValueINR - totalDayPnl)) * 100 : 0;

  let overallXirr: number | null = null;
  {
    const allCfs: { amount: number; date: Date }[] = [];
    holdings.forEach(h => {
      const rate = h.fxRate ?? 1;
      (h.transactions ?? []).filter(t => t.type === 'buy' || t.type === 'sip').forEach(t => {
        const costLocal = Number(t.quantity) * Number(t.price) + Number(t.fees ?? 0);
        allCfs.push({ amount: -(costLocal * rate), date: new Date(t.date) });
      });
    });
    if (allCfs.length && totalCurrentValueINR > 0) {
      const sorted = [...allCfs, { amount: totalCurrentValueINR, date: new Date() }]
        .sort((a, b) => a.date.getTime() - b.date.getTime());
      try {
        const r = calculateXIRR(sorted.map(c => c.amount), sorted.map(c => c.date));
        if (isFinite(r) && r > -1 && r < 10) overallXirr = r * 100;
      } catch { /* skip */ }
    }
  }

  // ── Pie data ──────────────────────────────────────────────────────────────

  const brokerPieData = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach(h => { const k = h.brokers?.name ?? 'Unknown'; map[k] = (map[k] ?? 0) + (h.currentValueINR ?? h.investedINR); });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filtered]);

  const countryPieData = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach(h => { const k = `${countryFlag(h.country)} ${h.country}`; map[k] = (map[k] ?? 0) + (h.currentValueINR ?? h.investedINR); });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filtered]);

  const portfolioPieData = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach(h => { const k = h.portfolios?.name ?? 'My Portfolio'; map[k] = (map[k] ?? 0) + (h.currentValueINR ?? h.investedINR); });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filtered]);

  // ── Export CSV ─────────────────────────────────────────────────────────────

  function exportCsv() {
    const headers = ['Stock', 'Symbol', 'Country', 'Currency', 'Distributor', 'Portfolio', 'Qty', 'Avg Buy Price', 'Invested (Local)', 'CMP', 'Value (Local)', 'FX Rate', 'Invested (INR)', 'Value (INR)', 'P&L (INR)', 'P&L %', 'XIRR'];
    const rows = filtered.map(h => [
      `"${h.name}"`, h.symbol, h.country, h.currency, h.brokers?.name ?? '', h.portfolios?.name ?? '',
      Number(h.quantity).toFixed(0), Number(h.avg_buy_price).toFixed(2),
      h.investedValue.toFixed(2),
      h.currentPrice?.toFixed(2) ?? '',
      h.currentValue?.toFixed(2) ?? '',
      h.fxRate?.toFixed(4) ?? '',
      h.investedINR.toFixed(2),
      h.currentValueINR?.toFixed(2) ?? '',
      h.gainLoss?.toFixed(2) ?? '',
      h.gainLossPct?.toFixed(2) ?? '',
      h.xirr != null ? h.xirr.toFixed(2) : '',
    ].join(','));
    const csv  = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a'); a.href = url; a.download = 'global-stocks.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  // ── Detail holding ────────────────────────────────────────────────────────

  const detailHolding: GlobalStockHoldingDetail | null = useMemo(() => {
    if (!detailId) return null;
    const h = holdings.find(x => x.id === detailId);
    if (!h) return null;
    return {
      ...h,
      investedValue: h.investedValue,
      currentValue:  h.currentValue,
      gainLoss:      h.gainLoss,
      gainLossPct:   h.gainLossPct,
      currentPrice:  h.currentPrice,
      currency:      h.currency,
      country:       h.country,
      fxRate:        h.fxRate,
      investedINR:   h.investedINR,
      currentValueINR: h.currentValueINR,
    };
  }, [detailId, holdings]);

  // ── Row renderer ──────────────────────────────────────────────────────────

  function renderStockRow(h: HoldingRow, extraStyle?: React.CSSProperties) {
    const isGain = (h.gainLoss ?? 0) >= 0;
    return (
      <div key={h.id}
        className="grid items-center px-4 py-3 border-b hover:bg-[#FAFAF8] transition-colors cursor-pointer"
        style={{
          gridTemplateColumns: '2fr 0.5fr 0.5fr 0.5fr 0.7fr 0.7fr 0.7fr 0.6fr 0.7fr 0.7fr 40px',
          borderColor: '#F0EDE6',
          backgroundColor: h.gainLoss != null ? (isGain ? 'rgba(5,150,105,0.01)' : 'rgba(220,38,38,0.01)') : 'transparent',
          ...extraStyle,
        }}
        onClick={() => setDetailId(h.id)}>
        {/* Stock */}
        <div className="flex items-center gap-2.5 min-w-0 pr-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0"
            style={{ backgroundColor: countryColor(h.country) }}>
            {h.symbol.slice(0, 2)}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold leading-tight" style={{ color: '#1A1A2E', wordBreak: 'break-word', whiteSpace: 'normal', lineHeight: 1.3 }}>
              {h.name}
            </p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px]" style={{ color: '#9CA3AF' }}>{h.symbol}</span>
              <span className="text-[9px] px-1 py-0.5 rounded font-medium" style={{ backgroundColor: 'rgba(37,99,235,0.08)', color: '#2563EB' }}>
                {h.currency}
              </span>
            </div>
          </div>
        </div>
        {/* Country */}
        <div className="min-w-0">
          <span className="text-[11px] font-medium" style={{ color: '#4B5563' }}>
            {countryFlag(h.country)} {h.country}
          </span>
        </div>
        {/* Distributor */}
        <div className="min-w-0">
          <p className="text-[11px] font-medium truncate" style={{ color: '#4B5563' }}>{h.brokers?.name ?? '—'}</p>
        </div>
        {/* Portfolio */}
        <div className="min-w-0">
          <p className="text-[10px] font-medium truncate" style={{ color: '#9CA3AF' }}>{h.portfolios?.name ?? '—'}</p>
        </div>
        {/* Qty + Avg */}
        <div className="text-right">
          <p className="text-xs" style={{ color: '#1A1A2E' }}>{Number(h.quantity).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
          <p className="text-[10px]" style={{ color: '#9CA3AF' }}>{fmtLocal(Number(h.avg_buy_price), h.currency)}</p>
        </div>
        {/* Invested (INR) */}
        <div className="text-right">
          <p className="text-xs" style={{ color: '#1A1A2E' }}>{formatLargeINR(h.investedINR)}</p>
        </div>
        {/* CMP */}
        <div className="text-right" onClick={e => e.stopPropagation()}>
          {h.priceLoading ? (
            <Loader2 className="w-3 h-3 animate-spin ml-auto" style={{ color: '#C9A84C' }} />
          ) : h.currentPrice !== null ? (
            <div>
              <p className="text-xs font-medium" style={{ color: '#1A1A2E' }}>{fmtLocal(h.currentPrice, h.currency)}</p>
              {h.fxRate != null && (
                <p className="text-[9px]" style={{ color: '#9CA3AF' }}>₹{(h.currentPrice * h.fxRate).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p>
              )}
            </div>
          ) : h.priceUnavailable ? (
            <p className="text-[9px]" style={{ color: '#9CA3AF' }}>Unavailable</p>
          ) : (
            <p className="text-[10px]" style={{ color: '#DC2626' }}>Error</p>
          )}
        </div>
        {/* Day P&L */}
        <div className="text-right">
          {h.dayChange != null && h.fxRate != null ? (
            <div>
              <p className="text-[10px] font-semibold" style={{ color: h.dayChange >= 0 ? '#059669' : '#DC2626' }}>
                {h.dayChange >= 0 ? '+' : ''}{formatLargeINR(Number(h.quantity) * h.dayChange * h.fxRate)}
              </p>
              <p className="text-[9px]" style={{ color: h.dayChange >= 0 ? '#059669' : '#DC2626' }}>
                {(h.dayChangePct ?? 0) >= 0 ? '+' : ''}{(h.dayChangePct ?? 0).toFixed(2)}%
              </p>
            </div>
          ) : (
            <p className="text-[10px]" style={{ color: '#9CA3AF' }}>—</p>
          )}
        </div>
        {/* Value (INR) */}
        <div className="text-right">
          {h.currentValueINR != null ? (
            <p className="text-xs font-medium" style={{ color: '#1A1A2E' }}>{formatLargeINR(h.currentValueINR)}</p>
          ) : (
            <p className="text-[10px]" style={{ color: '#9CA3AF' }}>—</p>
          )}
        </div>
        {/* P&L */}
        <div className="text-right">
          {h.gainLoss != null && <_PnlBadge value={h.gainLoss} pct={h.gainLossPct ?? 0} />}
        </div>
        {/* Actions */}
        <div onClick={e => e.stopPropagation()}>
          <ActionMenu holdingId={h.id} onDelete={deleteHolding} onViewDetails={id => setDetailId(id)} />
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3" style={{ color: '#C9A84C' }} />
          <p className="text-sm" style={{ color: '#9CA3AF' }}>Loading your global portfolio…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 flex items-center justify-center h-96">
        <div className="text-center">
          <AlertCircle className="w-8 h-8 mx-auto mb-3" style={{ color: '#DC2626' }} />
          <p className="text-sm font-medium mb-4" style={{ color: '#DC2626' }}>{error}</p>
          <button onClick={loadHoldings} className="text-xs px-4 py-2 rounded-lg"
            style={{ backgroundColor: '#1B2A4A', color: 'white' }}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-xl flex items-center gap-2 text-xs font-semibold"
          style={{ backgroundColor: toast.type === 'success' ? '#059669' : '#DC2626', color: 'white' }}>
          {toast.message}
        </div>
      )}

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: 'rgba(27,42,74,0.08)' }}>
            <Globe className="w-4.5 h-4.5" style={{ color: '#1B2A4A' }} />
          </div>
          <div>
            <h1 className="font-display text-lg font-semibold" style={{ color: '#1A1A2E' }}>Global Stocks</h1>
            <p className="text-xs" style={{ color: '#9CA3AF' }}>{totalUniqueStockCount} stock{totalUniqueStockCount !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={refreshAllPrices} disabled={priceRefreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ backgroundColor: '#F7F5F0', color: '#6B7280', border: '1px solid #E8E5DD' }}>
            <RefreshCw className={`w-3.5 h-3.5 ${priceRefreshing ? 'animate-spin' : ''}`} />
            {priceRefreshing ? 'Refreshing…' : 'Refresh Prices'}
          </button>
          <button onClick={exportCsv}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ backgroundColor: '#F7F5F0', color: '#6B7280', border: '1px solid #E8E5DD' }}>
            <Download className="w-3.5 h-3.5" />CSV
          </button>
          <button onClick={() => router.push('/add-assets/global-stocks')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
            style={{ backgroundColor: '#C9A84C' }}>
            <PlusCircle className="w-3.5 h-3.5" />Add Stock
          </button>
        </div>
      </div>

      {holdings.length === 0 ? (
        <div className="wv-card p-16 text-center">
          <Globe className="w-10 h-10 mx-auto mb-4" style={{ color: '#E8E5DD' }} />
          <h3 className="font-semibold text-base mb-2" style={{ color: '#1A1A2E' }}>No global stock holdings yet</h3>
          <p className="text-sm mb-6" style={{ color: '#9CA3AF' }}>Add your international equity holdings to get started</p>
          <button onClick={() => router.push('/add-assets/global-stocks')}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
            style={{ backgroundColor: '#1B2A4A' }}>
            Add First Holding
          </button>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-3 sm:grid-cols-7 gap-3">
            {[
              { label: 'Total Invested (INR)',  value: formatLargeINR(totalInvestedINR), sub: null },
              { label: 'Current Value (INR)',   value: formatLargeINR(totalCurrentValueINR), sub: null },
              { label: 'P&L (INR)',             value: `${totalGainLoss >= 0 ? '+' : ''}${formatLargeINR(totalGainLoss)}`,
                                                sub: null, color: totalGainLoss >= 0 ? '#059669' : '#DC2626' },
              { label: 'Day P&L',               value: `${totalDayPnl >= 0 ? '+' : ''}${formatLargeINR(totalDayPnl)}`,
                                                sub: `${totalDayPnlPct >= 0 ? '+' : ''}${totalDayPnlPct.toFixed(2)}%`,
                                                color: totalDayPnl >= 0 ? '#059669' : '#DC2626' },
              { label: 'Returns',               value: `${totalGainLossPct >= 0 ? '+' : ''}${totalGainLossPct.toFixed(2)}%`,
                                                sub: null, color: totalGainLossPct >= 0 ? '#059669' : '#DC2626' },
              { label: 'XIRR',                  value: overallXirr != null ? `${overallXirr.toFixed(2)}%` : '—',
                                                sub: null, color: overallXirr != null && overallXirr >= 0 ? '#059669' : '#DC2626' },
              { label: 'Stocks',                value: totalUniqueStockCount.toString(), sub: `${uniqueStockCount} shown` },
            ].map(({ label, value, sub, color }) => (
              <div key={label} className="wv-card p-3">
                <p className="text-[10px] font-medium" style={{ color: '#9CA3AF' }}>{label}</p>
                <p className="text-sm font-bold mt-1" style={{ color: color ?? '#1A1A2E' }}>{value}</p>
                {sub && <p className="text-[10px] mt-0.5" style={{ color: '#9CA3AF' }}>{sub}</p>}
              </div>
            ))}
          </div>

          {/* Allocation charts */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <DonutChart
              title="Allocation by Distributor"
              data={brokerPieData}
              getColor={(_, i) => BROKER_PALETTE[i % BROKER_PALETTE.length]}
            />
            <DonutChart
              title="Allocation by Country / Region"
              data={countryPieData}
              getColor={(name) => {
                const code = name.split(' ').pop() ?? '';
                return countryColor(code);
              }}
            />
            <DonutChart
              title="Allocation by Portfolio"
              data={portfolioPieData}
              getColor={(_, i) => PORTFOLIO_PALETTE[i % PORTFOLIO_PALETTE.length]}
            />
          </div>

          {/* Filter bar */}
          <div className="wv-card p-3 space-y-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: '#9CA3AF' }} />
              <input
                value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search by stock name or symbol…"
                className="w-full h-8 pl-9 pr-8 text-xs rounded-lg border bg-white outline-none focus:border-[#C9A84C]"
                style={{ borderColor: '#E8E5DD' }}
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2">
                  <X className="w-3 h-3" style={{ color: '#9CA3AF' }} />
                </button>
              )}
            </div>

            {/* Filter pills */}
            <div className="space-y-2">
              {brokers.length > 1 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-semibold uppercase tracking-wide flex-shrink-0" style={{ color: '#9CA3AF' }}>Distributor:</span>
                  {brokers.map(b => (
                    <Pill key={b} label={b} active={filterBrokers.has(b)} onClick={() => toggleSet(filterBrokers, setFilterBrokers, b)} />
                  ))}
                </div>
              )}
              {countries.length > 1 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-semibold uppercase tracking-wide flex-shrink-0" style={{ color: '#9CA3AF' }}>Country:</span>
                  {countries.map(c => (
                    <Pill key={c} label={`${countryFlag(c)} ${c}`} active={filterCountries.has(c)} onClick={() => toggleSet(filterCountries, setFilterCountries, c)} />
                  ))}
                </div>
              )}
              {portfolios.length > 1 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-semibold uppercase tracking-wide flex-shrink-0" style={{ color: '#9CA3AF' }}>Portfolio:</span>
                  {portfolios.map(p => (
                    <Pill key={p} label={p} active={filterPortfolios.has(p)} onClick={() => toggleSet(filterPortfolios, setFilterPortfolios, p)} />
                  ))}
                </div>
              )}
            </div>

            {/* Sort + clear */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: '#9CA3AF' }}>Sort:</span>
                {(['value','pnlPct','xirr','name'] as SortKey[]).map(k => {
                  const labels: Record<SortKey, string> = { value: 'Value', pnlPct: 'P&L %', xirr: 'XIRR', name: 'Name' };
                  return (
                    <button key={k} onClick={() => setSortKey(k)}
                      className="px-2.5 py-0.5 rounded-full text-[10px] font-medium transition-colors"
                      style={{
                        backgroundColor: sortKey === k ? '#1B2A4A' : '#F7F5F0',
                        color:           sortKey === k ? 'white'   : '#6B7280',
                      }}>
                      {labels[k]}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2">
                <p className="text-[10px]" style={{ color: '#9CA3AF' }}>
                  Showing {uniqueStockCount} of {totalUniqueStockCount} stocks
                </p>
                {isFiltered && (
                  <button onClick={clearFilters}
                    className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                    style={{ backgroundColor: 'rgba(220,38,38,0.08)', color: '#DC2626' }}>
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Top Gainer / Top Loser strip */}
          {(() => {
            const withDay = filtered.filter(h => h.dayChangePct != null);
            if (withDay.length === 0) return null;
            const topGainer = withDay.reduce((best, h) => (h.dayChangePct! > (best.dayChangePct ?? -Infinity) ? h : best), withDay[0]);
            const topLoser  = withDay.reduce((best, h) => (h.dayChangePct! < (best.dayChangePct ?? Infinity) ? h : best), withDay[0]);
            return (
              <div className="flex gap-3">
                {topGainer.dayChangePct != null && topGainer.dayChangePct > 0 && (
                  <div className="flex-1 wv-card px-4 py-2.5 flex items-center justify-between" style={{ borderLeft: '3px solid #059669' }}>
                    <div className="flex items-center gap-2 min-w-0">
                      <TrendingUp className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#059669' }} />
                      <p className="text-[11px] font-medium truncate" style={{ color: '#1A1A2E' }}>
                        <span style={{ color: '#9CA3AF' }}>Top Gainer:</span> {topGainer.name}
                      </p>
                    </div>
                    <p className="text-[11px] font-bold flex-shrink-0 ml-2" style={{ color: '#059669' }}>
                      +{(topGainer.dayChangePct ?? 0).toFixed(2)}%
                    </p>
                  </div>
                )}
                {topLoser.dayChangePct != null && topLoser.dayChangePct < 0 && (
                  <div className="flex-1 wv-card px-4 py-2.5 flex items-center justify-between" style={{ borderLeft: '3px solid #DC2626' }}>
                    <div className="flex items-center gap-2 min-w-0">
                      <TrendingDown className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#DC2626' }} />
                      <p className="text-[11px] font-medium truncate" style={{ color: '#1A1A2E' }}>
                        <span style={{ color: '#9CA3AF' }}>Top Loser:</span> {topLoser.name}
                      </p>
                    </div>
                    <p className="text-[11px] font-bold flex-shrink-0 ml-2" style={{ color: '#DC2626' }}>
                      {(topLoser.dayChangePct ?? 0).toFixed(2)}%
                    </p>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Holdings table */}
          <div className="wv-card overflow-hidden">
            {/* Table header */}
            <div className="grid text-[10px] font-semibold uppercase tracking-wide px-4 py-2 border-b"
              style={{ gridTemplateColumns: '2fr 0.5fr 0.5fr 0.5fr 0.7fr 0.7fr 0.7fr 0.6fr 0.7fr 0.7fr 40px', borderColor: '#F0EDE6', color: '#9CA3AF', backgroundColor: '#F7F5F0' }}>
              <span>Stock</span>
              <span>Country</span>
              <span>Distributor</span>
              <span>Portfolio</span>
              <span className="text-right">Qty &middot; Avg</span>
              <span className="text-right">Invested (INR)</span>
              <span className="text-right">CMP</span>
              <span className="text-right">Day</span>
              <span className="text-right">Value (INR)</span>
              <span className="text-right">P&amp;L</span>
              <span />
            </div>

            {groupedFiltered.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <p className="text-sm" style={{ color: '#9CA3AF' }}>No holdings match your filters</p>
              </div>
            ) : (
              groupedFiltered.map(group => {
                if (!group.isMultiBroker) return renderStockRow(group.holdings[0]);
                const isExpanded = expandedGroups.has(group.symbol);
                const tGain = group.totalCurrentValueINR != null ? group.totalCurrentValueINR - group.totalInvestedINR : null;
                const tGainPct = tGain != null && group.totalInvestedINR > 0 ? (tGain / group.totalInvestedINR) * 100 : null;
                const wtdAvgLocal = group.totalQty > 0 ? (group.totalInvestedINR / group.totalQty) / (group.fxRate ?? 1) : 0;
                return (
                  <div key={group.symbol}>
                    {isExpanded && group.holdings.map(h => renderStockRow(h, { borderLeft: '3px solid #C9A84C' }))}
                    {/* Consolidated summary row */}
                    <div
                      className="grid items-center px-4 py-3 border-b cursor-pointer"
                      style={{
                        gridTemplateColumns: '2fr 0.5fr 0.5fr 0.5fr 0.7fr 0.7fr 0.7fr 0.6fr 0.7fr 0.7fr 40px',
                        borderColor: '#F0EDE6',
                        backgroundColor: 'rgba(201,168,76,0.08)',
                        borderLeft: '3px solid #C9A84C',
                      }}
                      onClick={() => setExpandedGroups(prev => { const next = new Set(prev); if (next.has(group.symbol)) next.delete(group.symbol); else next.add(group.symbol); return next; })}>
                      <div className="flex items-center gap-2 min-w-0 pr-2">
                        {isExpanded ? <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#C9A84C' }} /> : <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#C9A84C' }} />}
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0"
                          style={{ backgroundColor: countryColor(group.country) }}>
                          {group.symbol.slice(0, 2)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold leading-tight" style={{ color: '#1A1A2E' }}>{group.name} — Total</p>
                          <p className="text-[10px] mt-0.5" style={{ color: '#9CA3AF' }}>{group.holdings.length} brokers</p>
                        </div>
                      </div>
                      <div><span className="text-[11px] font-medium" style={{ color: '#4B5563' }}>{countryFlag(group.country)} {group.country}</span></div>
                      <div><p className="text-[11px] font-semibold" style={{ color: '#C9A84C' }}>Consolidated</p></div>
                      <div><p className="text-[10px]" style={{ color: '#9CA3AF' }}>—</p></div>
                      <div className="text-right">
                        <p className="text-xs font-semibold" style={{ color: '#1A1A2E' }}>{group.totalQty.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
                        <p className="text-[10px]" style={{ color: '#9CA3AF' }}>{fmtLocal(wtdAvgLocal, group.currency)}</p>
                      </div>
                      <div className="text-right"><p className="text-xs font-semibold" style={{ color: '#1A1A2E' }}>{formatLargeINR(group.totalInvestedINR)}</p></div>
                      <div className="text-right">
                        {group.currentPrice != null ? (
                          <div>
                            <p className="text-xs font-medium" style={{ color: '#1A1A2E' }}>{fmtLocal(group.currentPrice, group.currency)}</p>
                            {group.fxRate != null && (
                              <p className="text-[9px]" style={{ color: '#9CA3AF' }}>₹{(group.currentPrice * group.fxRate).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p>
                            )}
                          </div>
                        ) : group.priceLoading ? <Loader2 className="w-3 h-3 animate-spin ml-auto" style={{ color: '#C9A84C' }} /> : <p className="text-[10px]" style={{ color: '#9CA3AF' }}>—</p>}
                      </div>
                      <div className="text-right">
                        {(() => {
                          const gDayPnl = group.holdings.reduce((s, h) => s + (h.dayChange != null && h.fxRate != null ? Number(h.quantity) * h.dayChange * h.fxRate : 0), 0);
                          return gDayPnl !== 0 ? (
                            <p className="text-[10px] font-semibold" style={{ color: gDayPnl >= 0 ? '#059669' : '#DC2626' }}>
                              {gDayPnl >= 0 ? '+' : ''}{formatLargeINR(gDayPnl)}
                            </p>
                          ) : <p className="text-[10px]" style={{ color: '#9CA3AF' }}>—</p>;
                        })()}
                      </div>
                      <div className="text-right">
                        {group.totalCurrentValueINR != null ? <p className="text-xs font-semibold" style={{ color: '#1A1A2E' }}>{formatLargeINR(group.totalCurrentValueINR)}</p> : <p className="text-[10px]" style={{ color: '#9CA3AF' }}>—</p>}
                      </div>
                      <div className="text-right">{tGain != null && tGainPct != null && <_PnlBadge value={tGain} pct={tGainPct} />}</div>
                      <div />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {/* Detail sheet */}
      <GlobalStockDetailSheet
        holding={detailHolding}
        open={!!detailId}
        onClose={() => setDetailId(null)}
        onDelete={deleteHolding}
        onRefreshPrice={sym => fetchPrice(sym)}
        onHoldingChanged={() => { holdingsCacheClear('global_stock_holdings'); loadHoldings(); }}
      />
    </div>
  );
}
