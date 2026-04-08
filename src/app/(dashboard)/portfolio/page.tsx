'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR } from '@/lib/utils/formatters';
import { navCacheGet, navCacheSet, navCacheClearAll } from '@/lib/utils/nav-cache';
import { stockPriceCacheGet, stockPriceCacheSet, stockPriceCacheClearAll } from '@/lib/utils/stock-price-cache';
import { holdingsCacheGet, holdingsCacheSet, holdingsCacheClearAll } from '@/lib/utils/holdings-cache';
import { FamilyMemberSelector } from '@/components/shared/FamilyMemberSelector';
import { calcGlobalStockInvestedINR } from '@/lib/utils/global-stock-calc';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawHolding {
  asset_type: string;
  symbol: string;
  quantity: number;
  avg_buy_price: number;
  metadata: Record<string, unknown>;
  portfolios: { user_id: string } | null;
  transactions?: { id: string; type: string; quantity: number; price: number; date: string; fees: number; notes?: string; metadata?: Record<string, unknown> }[];
}

interface AssetClassConfig {
  key: string;             // asset_type value(s) from DB
  label: string;
  detailPath: string;
  addPath: string;
}

// ─── Asset Class Config ───────────────────────────────────────────────────────

const ASSET_CLASSES: AssetClassConfig[] = [
  // EQUITY & FUNDS
  { key: 'indian_stock',   label: 'Indian Stocks',     detailPath: '/portfolio/indian-stocks',   addPath: '/add-assets/indian-stocks' },
  { key: 'global_stock',   label: 'Global Stocks',     detailPath: '/portfolio/global-stocks',   addPath: '/add-assets/global-stocks' },
  { key: 'mutual_fund',    label: 'Mutual Funds',      detailPath: '/portfolio/mutual-funds',    addPath: '/add-assets/mutual-funds' },
  { key: 'sif',            label: 'SIF',               detailPath: '/portfolio/sif',             addPath: '/add-assets/sif' },
  { key: 'pms',            label: 'PMS',               detailPath: '/portfolio/pms',             addPath: '/add-assets/pms' },
  { key: 'aif',            label: 'AIF',               detailPath: '/portfolio/aif',             addPath: '/add-assets/aif' },
  // CRYPTO & FOREX
  { key: 'crypto',         label: 'Crypto',            detailPath: '/portfolio/crypto',          addPath: '/add-assets/crypto' },
  { key: 'forex',          label: 'Forex',             detailPath: '/portfolio/forex',           addPath: '/add-assets/forex' },
  // FIXED INCOME
  { key: 'bond',           label: 'Bonds',             detailPath: '/portfolio/bonds',           addPath: '/add-assets/bonds' },
  { key: 'fd',             label: 'Fixed Deposits',    detailPath: '/portfolio/fixed-deposits',  addPath: '/add-assets/fixed-deposits' },
  { key: 'ppf',            label: 'PPF',               detailPath: '/portfolio/ppf',             addPath: '/add-assets/ppf' },
  { key: 'epf',            label: 'EPF / VPF',         detailPath: '/portfolio/epf-vpf',         addPath: '/add-assets/epf-vpf' },
  { key: 'gratuity',       label: 'Gratuity',          detailPath: '/portfolio/gratuity',        addPath: '/add-assets/gratuity' },
  { key: 'nps',            label: 'NPS',               detailPath: '/portfolio/nps',             addPath: '/add-assets/nps' },
  // INSURANCE
  { key: 'insurance',      label: 'Life & Health',     detailPath: '/portfolio/insurance',       addPath: '/add-assets/insurance' },
  // CASH & SAVINGS
  { key: 'savings_account',label: 'Savings Accounts',  detailPath: '/portfolio/savings-accounts',addPath: '/add-assets/savings-accounts' },
  // PHYSICAL ASSETS
  { key: 'gold',           label: 'Gold & Jewelry',    detailPath: '/portfolio/gold',            addPath: '/add-assets/gold' },
  { key: 'real_estate',    label: 'Real Estate',       detailPath: '/portfolio/real-estate',     addPath: '/add-assets/real-estate' },
];

// ─── Computed row ─────────────────────────────────────────────────────────────

interface AssetRow {
  config: AssetClassConfig;
  holdings: number;
  invested: number;
  currentValue: number;
  pnl: number;
  pnlPct: number;
  hasData: boolean;
}

function buildRows(holdings: RawHolding[], filterUserId: string | null, navMap: Map<string, number>, stockPriceMap: Map<string, number>, globalStockINRMap: Map<string, number>): AssetRow[] {
  const filtered = filterUserId
    ? holdings.filter(h => h.portfolios?.user_id === filterUserId)
    : holdings;

  // aggregate by asset_type
  const byType = new Map<string, { count: number; invested: number; currentValue: number }>();
  for (const h of filtered) {
    const existing = byType.get(h.asset_type) ?? { count: 0, invested: 0, currentValue: 0 };
    const qty = h.quantity ?? 0;
    let invested = qty * (h.avg_buy_price ?? 0);

    // Add buy transaction fees to invested amount
    const txns = h.transactions ?? [];
    const buyFees = txns
      .filter(t => (t.type === 'buy' || t.type === 'sip') && Number(t.quantity) > 0)
      .reduce((s, t) => s + (Number(t.fees) || 0), 0);

    // For global stocks: use shared FIFO/weighted-avg calc (includes fees + per-txn FX)
    if (h.asset_type === 'global_stock') {
      const { investedINR } = calcGlobalStockInvestedINR(h);
      invested = investedINR;
    } else {
      // For Indian stocks and others: add fees to invested
      invested += buyFees;
    }

    // For MF: use live NAV; for Indian Stocks: use live price; otherwise fall back to invested
    let currentValue = invested;
    if (h.asset_type === 'mutual_fund' && navMap.has(h.symbol)) {
      currentValue = qty * navMap.get(h.symbol)!;
    } else if (h.asset_type === 'indian_stock' && stockPriceMap.has(h.symbol)) {
      currentValue = qty * stockPriceMap.get(h.symbol)!;
    } else if (h.asset_type === 'global_stock' && globalStockINRMap.has(h.symbol)) {
      currentValue = globalStockINRMap.get(h.symbol)! * qty;
    }
    existing.count += 1;
    existing.invested += invested;
    existing.currentValue += currentValue;
    byType.set(h.asset_type, existing);
  }

  return ASSET_CLASSES.map(config => {
    const agg = byType.get(config.key);
    const invested = agg?.invested ?? 0;
    const count = agg?.count ?? 0;
    const currentValue = agg?.currentValue ?? 0;
    const pnl = currentValue - invested;
    const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;
    return { config, holdings: count, invested, currentValue, pnl, pnlPct, hasData: count > 0 };
  });
}

// ─── Summary Stats ────────────────────────────────────────────────────────────

interface SummaryStats {
  netWorth: number;
  invested: number;
  pnl: number;
  pnlPct: number;
}

function computeStats(rows: AssetRow[]): SummaryStats {
  const invested = rows.reduce((s, r) => s + r.invested, 0);
  const currentValue = rows.reduce((s, r) => s + r.currentValue, 0);
  const pnl = currentValue - invested;
  const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;
  return { netWorth: currentValue, invested, pnl, pnlPct };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const router = useRouter();
  const supabase = createClient();

  const [holdings, setHoldings] = useState<RawHolding[]>([]);
  const [loading, setLoading] = useState(true);
  const [navLoading, setNavLoading] = useState(false);
  const [navMap, setNavMap] = useState<Map<string, number>>(new Map());
  const [stockPriceLoading, setStockPriceLoading] = useState(false);
  const [stockPriceMap, setStockPriceMap] = useState<Map<string, number>>(new Map());
  const [globalStockLoading, setGlobalStockLoading] = useState(false);
  const [globalStockINRMap, setGlobalStockINRMap] = useState<Map<string, number>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [activeMemberIds, setActiveMemberIds] = useState<string[]>([]);
  const handleSelectionChange = useCallback((memberIds: string[]) => {
    setActiveMemberIds(memberIds);
  }, []);

  const loadData = useCallback(async (forceRefresh = false) => {
    setError(null);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    // Load holdings — check client cache first
    let loadedHoldings: RawHolding[] = [];
    if (!forceRefresh) {
      const cached = holdingsCacheGet<RawHolding[]>('portfolio_holdings');
      if (cached) { loadedHoldings = cached; }
    }

    if (loadedHoldings.length === 0) {
      try {
        const { data: holdingsData, error: hErr } = await supabase
          .from('holdings')
          .select('asset_type, symbol, quantity, avg_buy_price, metadata, portfolios(user_id), transactions(id, type, quantity, price, date, fees, notes, metadata)');
        if (hErr && !holdingsData) {
          setError('Failed to load portfolio data');
        } else if (holdingsData) {
          loadedHoldings = holdingsData as unknown as RawHolding[];
          holdingsCacheSet('portfolio_holdings', loadedHoldings);
        }
      } catch {
        setError('Failed to load portfolio data');
      }
    }

    setHoldings(loadedHoldings);
    setLoading(false); // Show table immediately with invested values

    // Collect unique symbols for batch calls
    const mfSymbols = Array.from(new Set(
      loadedHoldings.filter(h => h.asset_type === 'mutual_fund' && h.symbol).map(h => h.symbol)
    ));
    const stockSymbols = Array.from(new Set(
      loadedHoldings.filter(h => h.asset_type === 'indian_stock' && h.symbol).map(h => h.symbol)
    ));
    const globalStockHoldings = loadedHoldings.filter(h => h.asset_type === 'global_stock' && h.symbol);
    const globalStockSymbols = Array.from(new Set(globalStockHoldings.map(h => h.symbol)));

    // Check client-side caches first (skip if force refresh)
    const navMapFromCache = new Map<string, number>();
    const stockMapFromCache = new Map<string, number>();
    const mfToFetch: string[] = [];
    const stocksToFetch: string[] = [];

    if (!forceRefresh) {
      for (const sym of mfSymbols) {
        const cached = navCacheGet(sym);
        if (cached) navMapFromCache.set(sym, cached.nav);
        else mfToFetch.push(sym);
      }
      for (const sym of stockSymbols) {
        const cached = stockPriceCacheGet(sym);
        if (cached != null) stockMapFromCache.set(sym, cached);
        else stocksToFetch.push(sym);
      }
    } else {
      mfToFetch.push(...mfSymbols);
      stocksToFetch.push(...stockSymbols);
    }

    // Apply cached values immediately
    if (navMapFromCache.size > 0) setNavMap(new Map(navMapFromCache));
    if (stockMapFromCache.size > 0) setStockPriceMap(new Map(stockMapFromCache));

    // Fetch uncached NAVs and stock prices in PARALLEL using batch POST endpoints
    const promises: Promise<void>[] = [];

    if (mfToFetch.length > 0) {
      setNavLoading(true);
      promises.push((async () => {
        try {
          const res = await fetch('/api/mf/nav/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scheme_codes: mfToFetch, nocache: forceRefresh }),
          });
          if (res.ok) {
            const { results } = await res.json();
            const map = new Map(navMapFromCache);
            for (const [sym, data] of Object.entries(results)) {
              if (data && (data as { nav: number }).nav) {
                const d = data as { nav: number; navDate: string };
                map.set(sym, d.nav);
                navCacheSet(sym, d.nav, d.navDate);
              }
            }
            setNavMap(map);
          }
        } catch { /* batch failed */ }
        setNavLoading(false);
      })());
    }

    if (stocksToFetch.length > 0) {
      setStockPriceLoading(true);
      promises.push((async () => {
        try {
          const res = await fetch('/api/stocks/price/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbols: stocksToFetch, nocache: forceRefresh }),
          });
          if (res.ok) {
            const { results } = await res.json();
            const map = new Map(stockMapFromCache);
            for (const [sym, data] of Object.entries(results)) {
              if (data && (data as { price: number }).price) {
                const d = data as { price: number };
                map.set(sym, d.price);
                stockPriceCacheSet(sym, d.price);
              }
            }
            setStockPriceMap(map);
          }
        } catch { /* batch failed */ }
        setStockPriceLoading(false);
      })());
    }

    // Fetch global stock prices + FX rates for INR conversion
    if (globalStockSymbols.length > 0) {
      setGlobalStockLoading(true);
      promises.push((async () => {
        try {
          // Fetch prices
          const priceRes = await fetch('/api/stocks/global/price/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbols: globalStockSymbols, nocache: forceRefresh }),
          });
          if (!priceRes.ok) { setGlobalStockLoading(false); return; }
          const { results: priceResults } = await priceRes.json();

          // Collect unique currencies needing FX rates
          const currenciesNeeded = new Set<string>();
          for (const h of globalStockHoldings) {
            const cur = String(h.metadata?.currency ?? 'USD');
            if (cur !== 'INR') currenciesNeeded.add(cur);
          }

          // Fetch FX rates
          const fxMap: Record<string, number> = {};
          await Promise.allSettled(Array.from(currenciesNeeded).map(async (cur) => {
            try {
              const fxRes = await fetch(`/api/fx/rate?from=${cur}&to=INR`);
              if (fxRes.ok) {
                const fxData = await fxRes.json();
                if (fxData.rate) fxMap[cur] = fxData.rate;
              }
            } catch { /* skip */ }
          }));

          // Build INR value map: symbol → priceInINR (local price × FX rate)
          const inrMap = new Map<string, number>();
          for (const h of globalStockHoldings) {
            const priceData = priceResults[h.symbol];
            if (!priceData?.price) continue;
            const cur = String(h.metadata?.currency ?? 'USD');
            const fxRate = fxMap[cur] ?? 1;
            inrMap.set(h.symbol, priceData.price * fxRate);
          }
          setGlobalStockINRMap(inrMap);
        } catch { /* batch failed */ }
        setGlobalStockLoading(false);
      })());
    }

    await Promise.all(promises);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = useCallback(async () => {
    // Clear all client caches and force re-fetch
    navCacheClearAll();
    stockPriceCacheClearAll();
    holdingsCacheClearAll();
    setNavLoading(true);
    setStockPriceLoading(true);
    await loadData(true);
  }, [loadData]);

  // Filter holdings by selected family/members from FamilyMemberSelector
  const memberFilteredHoldings = activeMemberIds.length > 0
    ? holdings.filter(h => activeMemberIds.includes(h.portfolios?.user_id ?? ''))
    : holdings;
  const rows = buildRows(memberFilteredHoldings, null, navMap, stockPriceMap, globalStockINRMap);
  const stats = computeStats(rows);

  const totalHoldings = rows.reduce((s, r) => s + r.holdings, 0);
  const totalInvested = rows.reduce((s, r) => s + r.invested, 0);
  const totalCurrent = rows.reduce((s, r) => s + r.currentValue, 0);
  const totalPnl = totalCurrent - totalInvested;
  const totalPnlPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

  const pnlPositive = stats.pnl >= 0;

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--wv-text)' }} />
      </div>
    );
  }

  return (
    <div className="p-6" style={{ backgroundColor: 'var(--wv-surface-2)', minHeight: '100%' }}>
      {/* ─── Header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Portfolio</h1>
          <p className="text-sm text-gray-500">Overview of all asset classes</p>
        </div>

        <div className="flex items-center gap-3">
        {/* Refresh button */}
        <button
          onClick={handleRefresh}
          disabled={navLoading || stockPriceLoading || globalStockLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
          style={{ backgroundColor: 'var(--wv-surface-2)', color: 'var(--wv-text-secondary)', border: '1px solid var(--wv-border)' }}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${navLoading || stockPriceLoading ? 'animate-spin' : ''}`} />
          {navLoading || stockPriceLoading || globalStockLoading ? 'Refreshing…' : 'Refresh'}
        </button>
        </div>
      </div>

      <FamilyMemberSelector onSelectionChange={handleSelectionChange} />

      {/* Error banner */}
      {error && (
        <div className="mb-4 px-4 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ─── Summary Cards ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className="rounded-xl p-4 shadow-sm border border-gray-100">
          <p className="text-xs text-gray-500 mb-1">Total Net Worth</p>
          {navLoading || stockPriceLoading
            ? <div className="h-6 w-24 rounded animate-pulse bg-gray-100 mt-1" />
            : <p className="text-lg font-bold" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(stats.netWorth)}</p>}
        </div>
        <div className="rounded-xl p-4 shadow-sm border border-gray-100">
          <p className="text-xs text-gray-500 mb-1">Total Invested</p>
          <p className="text-lg font-bold text-gray-800">{formatLargeINR(stats.invested)}</p>
        </div>
        <div className="rounded-xl p-4 shadow-sm border border-gray-100">
          <p className="text-xs text-gray-500 mb-1">Total P&amp;L</p>
          {navLoading || stockPriceLoading
            ? <div className="h-6 w-24 rounded animate-pulse bg-gray-100 mt-1" />
            : <div className="flex items-center gap-1">
                {pnlPositive
                  ? <TrendingUp className="w-4 h-4" style={{ color: '#059669' }} />
                  : <TrendingDown className="w-4 h-4" style={{ color: '#DC2626' }} />}
                <p className="text-lg font-bold" style={{ color: pnlPositive ? '#059669' : '#DC2626' }}>
                  {pnlPositive ? '+' : ''}{formatLargeINR(stats.pnl)}
                </p>
              </div>}
        </div>
        <div className="rounded-xl p-4 shadow-sm border border-gray-100">
          <p className="text-xs text-gray-500 mb-1">Overall P&amp;L %</p>
          {navLoading || stockPriceLoading
            ? <div className="h-6 w-20 rounded animate-pulse bg-gray-100 mt-1" />
            : <>
                <p className="text-lg font-bold" style={{ color: pnlPositive ? '#059669' : '#DC2626' }}>
                  {pnlPositive ? '+' : ''}{stats.pnlPct.toFixed(2)}%
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5">XIRR: N/A</p>
              </>}
        </div>
      </div>

      {/* ─── Asset Class Table ───────────────────────────────────── */}
      <div className="rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ backgroundColor: '#1B2A4A' }}>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-300 w-6/12">Asset Class</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-gray-300">Holdings</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-gray-300">Invested</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-gray-300">Current Value</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-gray-300">P&amp;L (₹)</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-gray-300">P&amp;L %</th>
              <th className="px-3 py-3 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const zero = !row.hasData;
              const rowPnlPos = row.pnl >= 0;
              return (
                <tr
                  key={row.config.key}
                  className="border-b border-gray-50 last:border-0 cursor-pointer transition-colors hover:bg-gray-50"
                  style={zero ? { backgroundColor: '#FAFAF8' } : {}}
                  onClick={() => router.push(row.config.detailPath)}
                >
                  {/* Asset class name */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: zero ? '#D1D5DB' : '#C9A84C' }}
                      />
                      <span
                        className="font-medium"
                        style={{ color: zero ? '#9CA3AF' : '#111827' }}
                      >
                        {row.config.label}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right" style={{ color: zero ? '#D1D5DB' : '#374151' }}>
                    {zero ? '—' : row.holdings}
                  </td>
                  <td className="px-3 py-3 text-right" style={{ color: zero ? '#D1D5DB' : '#374151' }}>
                    {zero ? '—' : formatLargeINR(row.invested)}
                  </td>
                  <td className="px-3 py-3 text-right" style={{ color: zero ? '#D1D5DB' : '#374151' }}>
                    {zero ? '—'
                      : (navLoading && row.config.key === 'mutual_fund') || (stockPriceLoading && row.config.key === 'indian_stock') || (globalStockLoading && row.config.key === 'global_stock')
                        ? <span className="inline-block w-16 h-4 rounded animate-pulse bg-gray-100" />
                        : formatLargeINR(row.currentValue)}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {zero ? (
                      <span style={{ color: '#D1D5DB' }}>—</span>
                    ) : (navLoading && row.config.key === 'mutual_fund') || (stockPriceLoading && row.config.key === 'indian_stock') || (globalStockLoading && row.config.key === 'global_stock') ? (
                      <span className="inline-block w-12 h-4 rounded animate-pulse bg-gray-100" />
                    ) : (
                      <span style={{ color: rowPnlPos ? '#059669' : '#DC2626' }}>
                        {rowPnlPos ? '+' : ''}{formatLargeINR(row.pnl)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {zero ? (
                      <span style={{ color: '#D1D5DB' }}>—</span>
                    ) : (navLoading && row.config.key === 'mutual_fund') || (stockPriceLoading && row.config.key === 'indian_stock') || (globalStockLoading && row.config.key === 'global_stock') ? (
                      <span className="inline-block w-10 h-4 rounded animate-pulse bg-gray-100" />
                    ) : (
                      <span style={{ color: rowPnlPos ? '#059669' : '#DC2626' }}>
                        {rowPnlPos ? '+' : ''}{row.pnlPct.toFixed(2)}%
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <button
                      onClick={e => { e.stopPropagation(); router.push(row.config.addPath); }}
                      className="w-6 h-6 rounded-full flex items-center justify-center transition-colors hover:opacity-80"
                      style={{ backgroundColor: '#1B2A4A' }}
                      title={`Add ${row.config.label}`}
                    >
                      <Plus className="w-3.5 h-3.5 text-white" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>

          {/* Totals Row */}
          <tfoot>
            <tr className="border-t-2 border-gray-200" style={{ backgroundColor: 'var(--wv-surface-2)' }}>
              <td className="px-4 py-3 font-bold text-gray-900">Total</td>
              <td className="px-3 py-3 text-right font-bold text-gray-900">{totalHoldings}</td>
              <td className="px-3 py-3 text-right font-bold text-gray-900">{formatLargeINR(totalInvested)}</td>
              <td className="px-3 py-3 text-right font-bold text-gray-900">{formatLargeINR(totalCurrent)}</td>
              <td className="px-3 py-3 text-right font-bold" style={{ color: totalPnl >= 0 ? '#059669' : '#DC2626' }}>
                {totalPnl >= 0 ? '+' : ''}{formatLargeINR(totalPnl)}
              </td>
              <td className="px-3 py-3 text-right font-bold" style={{ color: totalPnlPct >= 0 ? '#059669' : '#DC2626' }}>
                {totalPnlPct >= 0 ? '+' : ''}{totalPnlPct.toFixed(2)}%
              </td>
              <td className="px-3 py-3"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
