'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, TrendingUp, TrendingDown } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR } from '@/lib/utils/formatters';
import { navCacheGet, navCacheSet } from '@/lib/utils/nav-cache';
import { cacheGet, cacheSet, TTL } from '@/lib/utils/price-cache';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MemberRow {
  id: string;
  name: string;
  email: string;
}

interface RawHolding {
  asset_type: string;
  symbol: string;
  quantity: number;
  avg_buy_price: number;
  metadata: Record<string, unknown>;
  portfolios: { user_id: string } | null;
}

interface AssetClassConfig {
  key: string;             // asset_type value(s) from DB
  label: string;
  detailPath: string;
  addPath: string;
}

// ─── Asset Class Config ───────────────────────────────────────────────────────

const ASSET_CLASSES: AssetClassConfig[] = [
  { key: 'mutual_fund',    label: 'Mutual Funds',      detailPath: '/portfolio/mutual-funds',    addPath: '/add-assets/mutual-funds' },
  { key: 'indian_stock',   label: 'Indian Stocks',     detailPath: '/portfolio/indian-stocks',   addPath: '/add-assets/indian-stocks' },
  { key: 'global_stock',   label: 'Global Stocks',     detailPath: '/portfolio/global-stocks',   addPath: '/add-assets/global-stocks' },
  { key: 'pms',            label: 'PMS',               detailPath: '/portfolio/pms',             addPath: '/add-assets/pms' },
  { key: 'aif',            label: 'AIF',               detailPath: '/portfolio/aif',             addPath: '/add-assets/aif' },
  { key: 'crypto',         label: 'Crypto',            detailPath: '/portfolio/crypto',          addPath: '/add-assets/crypto' },
  { key: 'forex',          label: 'Forex',             detailPath: '/portfolio/forex',           addPath: '/add-assets/forex' },
  { key: 'bond',           label: 'Bonds',             detailPath: '/portfolio/bonds',           addPath: '/add-assets/bonds' },
  { key: 'fd',             label: 'Fixed Deposits',    detailPath: '/portfolio/fixed-deposits',  addPath: '/add-assets/fixed-deposits' },
  { key: 'ppf',            label: 'PPF',               detailPath: '/portfolio/ppf',             addPath: '/add-assets/ppf' },
  { key: 'epf',            label: 'EPF / VPF',         detailPath: '/portfolio/epf-vpf',         addPath: '/add-assets/epf-vpf' },
  { key: 'gratuity',       label: 'Gratuity',          detailPath: '/portfolio/gratuity',        addPath: '/add-assets/gratuity' },
  { key: 'nps',            label: 'NPS',               detailPath: '/portfolio/nps',             addPath: '/add-assets/nps' },
  { key: 'insurance',      label: 'Insurance',         detailPath: '/portfolio/insurance',       addPath: '/add-assets/insurance' },
  { key: 'savings_account',label: 'Savings Accounts',  detailPath: '/portfolio/savings-accounts',addPath: '/add-assets/savings-accounts' },
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

function buildRows(holdings: RawHolding[], filterUserId: string | null, navMap: Map<string, number>, stockPriceMap: Map<string, number>): AssetRow[] {
  const filtered = filterUserId
    ? holdings.filter(h => h.portfolios?.user_id === filterUserId)
    : holdings;

  // aggregate by asset_type
  const byType = new Map<string, { count: number; invested: number; currentValue: number }>();
  for (const h of filtered) {
    const existing = byType.get(h.asset_type) ?? { count: 0, invested: 0, currentValue: 0 };
    const qty = h.quantity ?? 0;
    const invested = qty * (h.avg_buy_price ?? 0);
    // For MF: use live NAV; for Indian Stocks: use live price; otherwise fall back to invested
    let currentValue = invested;
    if (h.asset_type === 'mutual_fund' && navMap.has(h.symbol)) {
      currentValue = qty * navMap.get(h.symbol)!;
    } else if (h.asset_type === 'indian_stock' && stockPriceMap.has(h.symbol)) {
      currentValue = qty * stockPriceMap.get(h.symbol)!;
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

  const [viewMode, setViewMode] = useState<'family' | 'individual'>('family');
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');
  const [holdings, setHoldings] = useState<RawHolding[]>([]);
  const [loading, setLoading] = useState(true);
  const [navLoading, setNavLoading] = useState(false);
  const [navMap, setNavMap] = useState<Map<string, number>>(new Map());
  const [stockPriceLoading, setStockPriceLoading] = useState(false);
  const [stockPriceMap, setStockPriceMap] = useState<Map<string, number>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      // Get current user's family_id
      let familyId: string | null = null;
      try {
        const { data: userData } = await supabase
          .from('users')
          .select('family_id')
          .eq('id', user.id)
          .single();
        familyId = (userData as { family_id: string | null } | null)?.family_id ?? null;
      } catch { familyId = null; }

      // Load family members
      if (familyId) {
        try {
          const { data: membersData } = await supabase
            .from('users')
            .select('id, name, email')
            .eq('family_id', familyId);
          if (membersData) {
            setMembers(membersData as MemberRow[]);
            if (membersData.length > 0) setSelectedMemberId((membersData as MemberRow[])[0].id);
          }
        } catch { /* ignore */ }
      }

      // Load holdings with portfolio info
      let loadedHoldings: RawHolding[] = [];
      try {
        const { data: holdingsData, error: hErr } = await supabase
          .from('holdings')
          .select('asset_type, symbol, quantity, avg_buy_price, metadata, portfolios(user_id)');
        if (hErr && !holdingsData) {
          setError('Failed to load portfolio data');
        } else if (holdingsData) {
          loadedHoldings = holdingsData as unknown as RawHolding[];
          setHoldings(loadedHoldings);
        }
      } catch {
        setError('Failed to load portfolio data');
      }

      setLoading(false);

      // Auto-fetch live NAVs for MF holdings
      const mfSymbols = Array.from(new Set(
        loadedHoldings.filter(h => h.asset_type === 'mutual_fund' && h.symbol).map(h => h.symbol)
      ));
      if (mfSymbols.length > 0) {
        setNavLoading(true);
        const results = await Promise.allSettled(mfSymbols.map(async sym => {
          const cached = navCacheGet(sym);
          if (cached) return { sym, nav: cached.nav };
          const res = await fetch(`/api/mf/nav?scheme_code=${sym}`);
          if (!res.ok) return { sym, nav: null };
          const { nav, navDate } = await res.json();
          navCacheSet(sym, nav, navDate ?? '');
          return { sym, nav: nav as number };
        }));
        const map = new Map<string, number>();
        results.forEach(r => {
          if (r.status === 'fulfilled' && r.value.nav != null) map.set(r.value.sym, r.value.nav);
        });
        setNavMap(map);
        setNavLoading(false);
      }

      // Auto-fetch live prices for Indian Stock holdings
      const stockSymbols = Array.from(new Set(
        loadedHoldings.filter(h => h.asset_type === 'indian_stock' && h.symbol).map(h => h.symbol)
      ));
      if (stockSymbols.length > 0) {
        setStockPriceLoading(true);
        const results = await Promise.allSettled(stockSymbols.map(async sym => {
          const cacheKey = `stock_price_${sym}`;
          const cached = cacheGet<number>(cacheKey);
          if (cached != null) return { sym, price: cached };
          const res = await fetch(`/api/stocks/price?symbol=${sym}`);
          if (!res.ok) return { sym, price: null };
          const { price } = await res.json();
          cacheSet(cacheKey, price as number, TTL.STOCKS);
          return { sym, price: price as number };
        }));
        const map = new Map<string, number>();
        results.forEach(r => {
          if (r.status === 'fulfilled' && r.value.price != null) map.set(r.value.sym, r.value.price);
        });
        setStockPriceMap(map);
        setStockPriceLoading(false);
      }
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filterUserId = viewMode === 'individual' ? (selectedMemberId || null) : null;
  const rows = buildRows(holdings, filterUserId, navMap, stockPriceMap);
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
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#1B2A4A' }} />
      </div>
    );
  }

  return (
    <div className="p-6" style={{ backgroundColor: '#F7F5F0', minHeight: '100%' }}>
      {/* ─── Header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Portfolio</h1>
          <p className="text-sm text-gray-500">Overview of all asset classes</p>
        </div>

        {/* View Toggle */}
        <div className="flex items-center gap-1 p-1 rounded-full border border-gray-200 bg-white">
          <button
            onClick={() => setViewMode('family')}
            className="px-4 py-1.5 rounded-full text-sm font-medium transition-all"
            style={viewMode === 'family'
              ? { backgroundColor: '#1B2A4A', color: '#fff' }
              : { color: '#6B7280' }}
          >
            Family View
          </button>
          <button
            onClick={() => setViewMode('individual')}
            className="px-4 py-1.5 rounded-full text-sm font-medium transition-all"
            style={viewMode === 'individual'
              ? { backgroundColor: '#1B2A4A', color: '#fff' }
              : { color: '#6B7280' }}
          >
            Individual
          </button>
        </div>
      </div>

      {/* Member selector (Individual mode) */}
      {viewMode === 'individual' && members.length > 0 && (
        <div className="mb-4 flex items-center gap-2">
          <span className="text-sm text-gray-600 font-medium">Member:</span>
          <div className="flex gap-1.5 flex-wrap">
            {members.map(m => (
              <button
                key={m.id}
                onClick={() => setSelectedMemberId(m.id)}
                className="px-3 py-1 rounded-full text-xs font-medium border transition-all"
                style={selectedMemberId === m.id
                  ? { backgroundColor: '#C9A84C', color: '#fff', borderColor: '#C9A84C' }
                  : { backgroundColor: '#fff', color: '#374151', borderColor: '#E5E7EB' }}
              >
                {m.name || m.email}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="mb-4 px-4 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ─── Summary Cards ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <p className="text-xs text-gray-500 mb-1">Total Net Worth</p>
          {navLoading || stockPriceLoading
            ? <div className="h-6 w-24 rounded animate-pulse bg-gray-100 mt-1" />
            : <p className="text-lg font-bold" style={{ color: '#1B2A4A' }}>{formatLargeINR(stats.netWorth)}</p>}
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
          <p className="text-xs text-gray-500 mb-1">Total Invested</p>
          <p className="text-lg font-bold text-gray-800">{formatLargeINR(stats.invested)}</p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
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
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
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
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
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
                      : (navLoading && row.config.key === 'mutual_fund') || (stockPriceLoading && row.config.key === 'indian_stock')
                        ? <span className="inline-block w-16 h-4 rounded animate-pulse bg-gray-100" />
                        : formatLargeINR(row.currentValue)}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {zero ? (
                      <span style={{ color: '#D1D5DB' }}>—</span>
                    ) : (navLoading && row.config.key === 'mutual_fund') || (stockPriceLoading && row.config.key === 'indian_stock') ? (
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
                    ) : (navLoading && row.config.key === 'mutual_fund') || (stockPriceLoading && row.config.key === 'indian_stock') ? (
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
            <tr className="border-t-2 border-gray-200" style={{ backgroundColor: '#F7F5F0' }}>
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
