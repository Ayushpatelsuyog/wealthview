'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import {
  RefreshCw, PlusCircle, Loader2, AlertCircle, TrendingUp, TrendingDown,
  MoreHorizontal, Search, Download, ChevronDown, ChevronRight,
} from 'lucide-react';
import { HoldingDetailSheet } from '@/components/portfolio/HoldingDetailSheet';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR, formatPercentage } from '@/lib/utils/formatters';
import { calculateXIRR } from '@/lib/utils/calculations';
import { navCacheGet, navCacheSet, navCacheClearAll } from '@/lib/utils/nav-cache';
import { holdingsCacheGet, holdingsCacheSet, holdingsCacheClearAll } from '@/lib/utils/holdings-cache';

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
  currentNav:    number | null;
  navDate:       string | null;
  navLoading:    boolean;
  investedValue: number;
  currentValue:  number | null;
  gainLoss:      number | null;
  gainLossPct:   number | null;
  xirr:          number | null;
  memberName:    string;
}

type SortKey = 'value' | 'pnlPct' | 'xirr' | 'name' | 'recent';

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

const CAT_COLORS: Record<string, { bg: string; text: string }> = {
  Equity:               { bg: 'rgba(27,42,74,0.08)',    text: '#1B2A4A' },
  ELSS:                 { bg: '#F5EDD6',                text: '#C9A84C' },
  Hybrid:               { bg: 'rgba(46,139,139,0.08)',  text: '#2E8B8B' },
  Debt:                 { bg: 'rgba(5,150,105,0.08)',   text: '#059669' },
  Liquid:               { bg: 'rgba(5,150,105,0.08)',   text: '#059669' },
  Gilt:                 { bg: 'rgba(5,150,105,0.08)',   text: '#059669' },
  'Index/ETF':          { bg: 'rgba(27,42,74,0.08)',    text: '#1B2A4A' },
  Commodity:            { bg: 'rgba(201,168,76,0.15)',  text: '#92620A' },
  International:        { bg: 'rgba(99,102,241,0.10)',  text: '#4338CA' },
  'Sectoral/Thematic':  { bg: 'rgba(234,88,12,0.10)',   text: '#C2410C' },
  Arbitrage:            { bg: 'rgba(46,139,139,0.08)',  text: '#2E8B8B' },
};
function catStyle(cat: string) { return CAT_COLORS[cat] ?? { bg: '#F3F4F6', text: '#6B7280' }; }

function ActionMenu({
  holdingId, onDelete, onViewDetails, onAddMore, onSellRedeem,
}: {
  holdingId: string;
  onDelete: (id: string) => void;
  onViewDetails: (id: string) => void;
  onAddMore: (id: string) => void;
  onSellRedeem: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const actions = [
    { label: 'View details',  action: () => { onViewDetails(holdingId);  setOpen(false); } },
    { label: 'Edit',          action: () => { router.push(`/add-assets/mutual-funds?edit=${holdingId}`); setOpen(false); } },
    { label: 'Add units',     action: () => { onAddMore(holdingId);      setOpen(false); } },
    { label: 'Sell / Redeem', action: () => { onSellRedeem(holdingId);   setOpen(false); } },
    { label: 'Delete',        action: () => { onDelete(holdingId);       setOpen(false); }, danger: true },
  ];
  return (
    <div className="relative">
      <button onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="p-1 rounded hover:bg-gray-100 transition-colors">
        <MoreHorizontal className="w-3.5 h-3.5" style={{ color: '#9CA3AF' }} />
      </button>
      {open && (
        <>
          {/* backdrop */}
          <div className="fixed inset-0" style={{ zIndex: 9990 }} onClick={() => setOpen(false)} />
          <div className="absolute right-0 bg-white rounded-xl border py-1 min-w-[150px]"
            style={{ borderColor: '#E8E5DD', top: '100%', zIndex: 9999,
                     boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}>
            {actions.map(({ label, action, danger }) => (
              <button key={label}
                onClick={(e) => { e.stopPropagation(); action(); }}
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

// ─── SIP Badge ─────────────────────────────────────────────────────────────────

function SipBadge({ metadata }: { metadata: Record<string, unknown> }) {
  if (!metadata.is_sip) return null;

  const sips = Array.isArray(metadata.sips)
    ? (metadata.sips as Array<{ status?: string }>)
    : [];

  if (sips.length === 0) {
    return (
      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
        style={{ backgroundColor: 'rgba(5,150,105,0.12)', color: '#059669' }}>
        SIP
      </span>
    );
  }

  const activeCount   = sips.filter(s => s.status !== 'inactive').length;
  const inactiveCount = sips.length - activeCount;

  if (activeCount === 0) {
    return (
      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
        style={{ backgroundColor: '#F3F4F6', color: '#9CA3AF', textDecoration: 'line-through' }}>
        SIP
      </span>
    );
  }

  if (inactiveCount === 0) {
    const label = activeCount > 1 ? `${activeCount} SIPs` : 'SIP';
    return (
      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
        style={{ backgroundColor: 'rgba(5,150,105,0.12)', color: '#059669' }}>
        {label}
      </span>
    );
  }

  return (
    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
      style={{ backgroundColor: 'rgba(201,168,76,0.15)', color: '#92620A' }}>
      {activeCount} active · {inactiveCount} stopped
    </span>
  );
}

// ─── Allocation Charts ─────────────────────────────────────────────────────────

interface PieEntry { name: string; value: number }

function fmt(v: number): string {
  if (v >= 10_000_000) return `₹${(v / 10_000_000).toFixed(2)}Cr`;
  if (v >= 100_000)    return `₹${(v / 100_000).toFixed(2)}L`;
  if (v >= 1_000)      return `₹${(v / 1_000).toFixed(1)}K`;
  return `₹${Math.round(v)}`;
}

function DonutChart({
  title,
  data,
  getColor,
  modeLabel,
}: {
  title: string;
  data: PieEntry[];
  getColor: (name: string, index: number) => string;
  modeLabel: string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);

  if (data.length === 0) {
    return (
      <div className="wv-card flex flex-col" style={{ padding: 16, overflow: 'hidden', minHeight: 220 }}>
        <p className="text-xs font-semibold mb-3" style={{ color: '#1B2A4A' }}>
          {title} <span style={{ color: '#9CA3AF', fontWeight: 400 }}>({modeLabel})</span>
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
        {title} <span style={{ color: '#9CA3AF', fontWeight: 400 }}>({modeLabel})</span>
      </p>

      {/* Donut — fixed 150×150, centered */}
      <div style={{ width: 150, height: 150, margin: '0 auto 12px' }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={46}
              outerRadius={70}
              paddingAngle={data.length > 1 ? 2 : 0}
              dataKey="value"
              strokeWidth={0}
            >
              {data.map((entry, i) => (
                <Cell key={entry.name} fill={getColor(entry.name, i)} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) => [fmt(Number(value)), '']}
              contentStyle={{
                fontSize: 11, borderRadius: 8,
                border: '1px solid #E8E5DD',
                boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
              }}
              itemStyle={{ color: '#1A1A2E' }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Legend — stacked vertically, fully contained */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {data.map((entry, i) => {
          const pct = total > 0 ? (entry.value / total * 100).toFixed(1) : '0';
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

const PORTFOLIO_PALETTE = ['#7C3AED', '#2563EB', '#059669', '#EA580C', '#DB2777', '#D97706', '#0891B2'];

function AllocationCharts({
  brokerDataMarket,
  brokerDataInvested,
  categoryDataMarket,
  categoryDataInvested,
  portfolioDataMarket,
  portfolioDataInvested,
  brokerPalette,
}: {
  brokerDataMarket: PieEntry[];
  brokerDataInvested: PieEntry[];
  categoryDataMarket: PieEntry[];
  categoryDataInvested: PieEntry[];
  portfolioDataMarket: PieEntry[];
  portfolioDataInvested: PieEntry[];
  brokerPalette: string[];
}) {
  const [mode, setMode] = useState<'market' | 'invested'>('market');
  const modeLabel = mode === 'market' ? 'Market Value' : 'Invested';

  const catSolid: Record<string, string> = {
    Equity:              '#1B2A4A',
    ELSS:                '#C9A84C',
    Hybrid:              '#2E8B8B',
    Debt:                '#059669',
    Liquid:              '#10B981',
    Gilt:                '#34D399',
    'Index/ETF':         '#3B82F6',
    Commodity:           '#D97706',
    International:       '#6366F1',
    'Sectoral/Thematic': '#EA580C',
    Arbitrage:           '#14B8A6',
  };

  return (
    <div>
      {/* Toggle */}
      <div className="flex items-center gap-1 mb-3 p-1 rounded-full border border-gray-200 bg-white w-fit">
        <button
          onClick={() => setMode('market')}
          className="px-3 py-1 rounded-full text-[11px] font-medium transition-all"
          style={mode === 'market'
            ? { backgroundColor: '#1B2A4A', color: '#fff' }
            : { color: '#6B7280' }}
        >
          Market Value
        </button>
        <button
          onClick={() => setMode('invested')}
          className="px-3 py-1 rounded-full text-[11px] font-medium transition-all"
          style={mode === 'invested'
            ? { backgroundColor: '#1B2A4A', color: '#fff' }
            : { color: '#6B7280' }}
        >
          Invested
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <DonutChart
          title="Allocation by Distributor"
          data={mode === 'market' ? brokerDataMarket : brokerDataInvested}
          getColor={(_, i) => brokerPalette[i % brokerPalette.length]}
          modeLabel={modeLabel}
        />
        <DonutChart
          title="Allocation by Category"
          data={mode === 'market' ? categoryDataMarket : categoryDataInvested}
          getColor={(name) => catSolid[name] ?? '#6B7280'}
          modeLabel={modeLabel}
        />
        <DonutChart
          title="Allocation by Portfolio"
          data={mode === 'market' ? portfolioDataMarket : portfolioDataInvested}
          getColor={(_, i) => PORTFOLIO_PALETTE[i % PORTFOLIO_PALETTE.length]}
          modeLabel={modeLabel}
        />
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MutualFundsPortfolioPage() {
  const router   = useRouter();
  const supabase = createClient();

  const [holdings, setHoldings]     = useState<HoldingRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [navRefreshing, setNavRefreshing] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [_memberNames, setMemberNames] = useState<Record<string, string>>({});
  const [detailId, setDetailId]     = useState<string | null>(null);
  const [openAsRedeem, setOpenAsRedeem] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Filter + sort state — multi-select sets
  const [filterBrokers,    setFilterBrokers]    = useState<Set<string>>(new Set());
  const [filterPortfolios, setFilterPortfolios] = useState<Set<string>>(new Set());
  const [filterCategories, setFilterCategories] = useState<Set<string>>(new Set());
  const [filterMembers,    setFilterMembers]    = useState<Set<string>>(new Set());
  const [sortKey,          setSortKey]          = useState<SortKey>('value');
  const [searchQuery,      setSearchQuery]      = useState('');

  function toggleSet(set: Set<string>, setFn: (s: Set<string>) => void, val: string) {
    const next = new Set(set);
    if (next.has(val)) next.delete(val); else next.add(val);
    setFn(next);
  }

  function clearFilters() {
    setFilterBrokers(new Set()); setFilterPortfolios(new Set());
    setFilterCategories(new Set()); setFilterMembers(new Set());
    setSearchQuery('');
  }

  const isFiltered = filterBrokers.size > 0 || filterPortfolios.size > 0 || filterCategories.size > 0 || filterMembers.size > 0 || !!searchQuery;

  // ── Load holdings ──────────────────────────────────────────────────────────

  const loadHoldings = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/login'); return; }

    // Load family member names
    const { data: usersData } = await supabase.from('users').select('id, name');
    const names: Record<string, string> = {};
    (usersData ?? []).forEach(u => { names[u.id] = u.name; });
    setMemberNames(names);

    // Check holdings cache first
    const cachedHoldings = holdingsCacheGet<RawHolding[]>('mf_holdings');
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
        .eq('asset_type', 'mutual_fund')
        .order('created_at', { ascending: false });

      if (dbErr) { setError(dbErr.message); setLoading(false); return; }
      data = freshData;
      if (data) holdingsCacheSet('mf_holdings', data as unknown as RawHolding[]);
    }

    if (!data) { setError('Failed to load holdings'); setLoading(false); return; }

    const rows: HoldingRow[] = (data as unknown as RawHolding[]).map((h) => {
      const invested = Number(h.quantity) * Number(h.avg_buy_price);
      const ownerId = h.portfolios?.user_id ?? '';
      return {
        ...h,
        currentNav: null, navDate: null, navLoading: true,
        investedValue: invested,
        currentValue: null, gainLoss: null, gainLossPct: null, xirr: null,
        memberName: names[ownerId] ?? '',
      };
    });

    setHoldings(rows);
    setLoading(false);

    // Batch-fetch NAVs for all unique symbols in a single request
    const unique = Array.from(new Set(rows.map(r => r.symbol)));
    await fetchNavBatch(unique, rows, false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function applyNavResults(
    navMap: Record<string, { nav: number; navDate: string } | null>,
    baseRows?: HoldingRow[],
  ) {
    setHoldings(prev => {
      const source = baseRows ?? prev;
      return source.map(h => {
        const navResult = navMap[h.symbol];
        if (!navResult) return { ...h, navLoading: false };
        const currentNav  = navResult.nav;
        const navDate     = navResult.navDate;
        const currentValue = Number(h.quantity) * currentNav;
        const gainLoss    = currentValue - h.investedValue;
        const gainLossPct = h.investedValue > 0 ? (gainLoss / h.investedValue) * 100 : 0;
        let xirr: number | null = null;
        const buyTxns = (h.transactions ?? []).filter(t => t.type === 'buy' || t.type === 'sip');
        if (buyTxns.length) {
          const earliest = buyTxns.reduce((a, b) => new Date(a.date) < new Date(b.date) ? a : b);
          const d0 = new Date(earliest.date);
          if (new Date() > d0) {
            try {
              const r = calculateXIRR([-h.investedValue, currentValue], [d0, new Date()]);
              if (isFinite(r)) xirr = r;
            } catch { /* skip */ }
          }
        }
        return { ...h, currentNav, navDate, navLoading: false, currentValue, gainLoss, gainLossPct, xirr };
      });
    });
  }

  async function fetchNavBatch(symbols: string[], baseRows?: HoldingRow[], nocache = false): Promise<number> {
    // Check client cache first for non-refresh fetches
    const navMap: Record<string, { nav: number; navDate: string } | null> = {};
    const toFetch: string[] = [];

    if (!nocache) {
      for (const sym of symbols) {
        const cached = navCacheGet(sym);
        if (cached) { navMap[sym] = cached; }
        else { toFetch.push(sym); }
      }
    } else {
      toFetch.push(...symbols);
    }

    if (toFetch.length > 0) {
      try {
        const res = await fetch('/api/mf/nav/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scheme_codes: toFetch, nocache }),
        });
        if (res.ok) {
          const json = await res.json();
          const batchResults: Record<string, { nav: number; navDate: string; fundName: string; fundHouse: string } | null> = json.results ?? {};
          for (const [sym, data] of Object.entries(batchResults)) {
            if (data) {
              navCacheSet(sym, data.nav, data.navDate);
              navMap[sym] = { nav: data.nav, navDate: data.navDate };
            } else {
              navMap[sym] = null;
            }
          }
        }
      } catch { /* batch failed, navMap entries for toFetch remain missing */ }
    }

    applyNavResults(navMap, baseRows);
    return Object.values(navMap).filter(v => v !== null).length;
  }

  useEffect(() => { loadHoldings(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function refreshAllNavs() {
    setNavRefreshing(true);
    navCacheClearAll();
    holdingsCacheClearAll();
    setHoldings(prev => prev.map(h => ({ ...h, navLoading: true })));
    const unique = Array.from(new Set(holdings.map(h => h.symbol)));
    const succeeded = await fetchNavBatch(unique, undefined, true);
    const total = unique.length;
    setNavRefreshing(false);
    setToast({ type: succeeded === total ? 'success' : 'error',
      message: `NAVs updated for ${succeeded} of ${total} holding${total !== 1 ? 's' : ''}` });
    setTimeout(() => setToast(null), 4000);
  }

  async function deleteHolding(id: string) {
    if (!confirm('Delete this holding and all its transactions?')) return;
    await supabase.from('transactions').delete().eq('holding_id', id);
    await supabase.from('holdings').delete().eq('id', id);
    setHoldings(prev => prev.filter(h => h.id !== id));
  }

  // ── Derived filter options ────────────────────────────────────────────────

  const brokers    = useMemo(() => Array.from(new Set(holdings.map(h => h.brokers?.name ?? '—').filter(Boolean))), [holdings]);
  const portfolios = useMemo(() => Array.from(new Set(holdings.map(h => h.portfolios?.name ?? 'My Portfolio').filter(Boolean))), [holdings]);
  const categories = useMemo(() => Array.from(new Set(holdings.map(h => String(h.metadata?.category ?? '')).filter(Boolean))), [holdings]);
  const members    = useMemo(() => Array.from(new Set(holdings.map(h => h.memberName).filter(Boolean))), [holdings]);

  // ── Filtered + sorted holdings ────────────────────────────────────────────

  const filtered = useMemo(() => {
    let rows = holdings;
    if (filterBrokers.size > 0)    rows = rows.filter(h => filterBrokers.has(h.brokers?.name ?? '—'));
    if (filterPortfolios.size > 0) rows = rows.filter(h => filterPortfolios.has(h.portfolios?.name ?? 'My Portfolio'));
    if (filterCategories.size > 0) rows = rows.filter(h => filterCategories.has(String(h.metadata?.category ?? '')));
    if (filterMembers.size > 0)    rows = rows.filter(h => filterMembers.has(h.memberName));
    if (searchQuery)               rows = rows.filter(h => h.name.toLowerCase().includes(searchQuery.toLowerCase()));

    return [...rows].sort((a, b) => {
      switch (sortKey) {
        case 'value':   return (b.currentValue ?? b.investedValue) - (a.currentValue ?? a.investedValue);
        case 'pnlPct':  return (b.gainLossPct ?? 0) - (a.gainLossPct ?? 0);
        case 'xirr':    return (b.xirr ?? -Infinity) - (a.xirr ?? -Infinity);
        case 'name':    return a.name.localeCompare(b.name);
        case 'recent':  return 0;
        default:        return 0;
      }
    });
  }, [holdings, filterBrokers, filterPortfolios, filterCategories, filterMembers, searchQuery, sortKey]);

  // ── Grouped holdings (multi-distributor consolidation) ────────────────────

  interface FundGroup {
    symbol: string; name: string; category: string;
    holdings: HoldingRow[]; isMultiDistributor: boolean;
    totalUnits: number; totalInvested: number;
    totalCurrentValue: number | null;
    currentNav: number | null; navLoading: boolean;
  }

  const groupedFiltered: FundGroup[] = useMemo(() => {
    const map = new Map<string, HoldingRow[]>();
    for (const h of filtered) {
      const key = h.symbol;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(h);
    }
    return Array.from(map.entries()).map(([symbol, rows]) => ({
      symbol,
      name: rows[0].name,
      category: String(rows[0].metadata?.category ?? ''),
      holdings: rows,
      isMultiDistributor: rows.length > 1,
      totalUnits: rows.reduce((s, r) => s + Number(r.quantity), 0),
      totalInvested: rows.reduce((s, r) => s + r.investedValue, 0),
      totalCurrentValue: rows.every(r => r.currentValue != null)
        ? rows.reduce((s, r) => s + (r.currentValue ?? 0), 0) : null,
      currentNav: rows[0].currentNav,
      navLoading: rows.some(r => r.navLoading),
    }));
  }, [filtered]);

  useEffect(() => {
    const multiSymbols = groupedFiltered.filter(g => g.isMultiDistributor).map(g => g.symbol);
    setExpandedGroups(prev => {
      const next = new Set(prev);
      multiSymbols.forEach(s => { if (!next.has(s)) next.add(s); });
      return next.size !== prev.size ? next : prev;
    });
  }, [groupedFiltered]);

  const uniqueFundCount = groupedFiltered.length;
  const totalUniqueFundCount = useMemo(() => new Set(holdings.map(h => h.symbol)).size, [holdings]);

  // ── Summary totals ────────────────────────────────────────────────────────

  const totalInvested     = filtered.reduce((s, h) => s + h.investedValue, 0);
  const totalCurrentValue = filtered.reduce((s, h) => s + (h.currentValue ?? h.investedValue), 0);
  const totalGainLoss     = totalCurrentValue - totalInvested;
  const totalGainLossPct  = totalInvested > 0 ? (totalGainLoss / totalInvested) * 100 : 0;

  // Overall XIRR from all buy txns + current value
  let overallXirr: number | null = null;
  {
    const allCfs: { amount: number; date: Date }[] = [];
    holdings.forEach(h => {
      (h.transactions ?? []).filter(t => t.type === 'buy' || t.type === 'sip').forEach(t => {
        allCfs.push({ amount: -(Number(t.quantity) * Number(t.price) + Number(t.fees ?? 0)), date: new Date(t.date) });
      });
    });
    if (allCfs.length && totalCurrentValue > 0) {
      const sorted = [...allCfs, { amount: totalCurrentValue, date: new Date() }].sort((a, b) => a.date.getTime() - b.date.getTime());
      try {
        const r = calculateXIRR(sorted.map(c => c.amount), sorted.map(c => c.date));
        if (isFinite(r) && r > -1 && r < 10) overallXirr = r * 100;
      } catch { /* skip */ }
    }
  }

  // ── Broker comparison ────────────────────────────────────────────────────

  const brokerStats = useMemo(() => {
    const map: Record<string, { count: number; invested: number; current: number }> = {};
    holdings.forEach(h => {
      const key = h.brokers?.name ?? '—';
      if (!map[key]) map[key] = { count: 0, invested: 0, current: 0 };
      map[key].count++;
      map[key].invested += h.investedValue;
      map[key].current  += h.currentValue ?? h.investedValue;
    });
    return Object.entries(map).map(([name, s]) => ({
      name, count: s.count, invested: s.invested, current: s.current,
      pnl: s.current - s.invested,
      pnlPct: s.invested > 0 ? ((s.current - s.invested) / s.invested) * 100 : 0,
    })).sort((a, b) => b.current - a.current);
  }, [holdings]);

  const showBrokerComparison = brokerStats.length >= 2;

  // ── Pie chart data (from filtered, uses live current value) ─────────────

  const BROKER_PALETTE = ['#1B2A4A', '#2E8B8B', '#C9A84C', '#059669', '#7C3AED', '#EA580C', '#2563EB', '#DB2777'];

  const brokerPieData = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach(h => {
      const key = h.brokers?.name ?? 'Unknown';
      map[key] = (map[key] ?? 0) + (h.currentValue ?? h.investedValue);
    });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filtered]);

  const brokerPieDataInvested = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach(h => { const key = h.brokers?.name ?? 'Unknown'; map[key] = (map[key] ?? 0) + h.investedValue; });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filtered]);

  const categoryPieData = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach(h => {
      const key = String(h.metadata?.category ?? 'Equity');
      map[key] = (map[key] ?? 0) + (h.currentValue ?? h.investedValue);
    });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filtered]);

  const categoryPieDataInvested = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach(h => { const key = String(h.metadata?.category ?? 'Equity'); map[key] = (map[key] ?? 0) + h.investedValue; });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filtered]);

  const portfolioPieData = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach(h => {
      const key = h.portfolios?.name ?? 'My Portfolio';
      map[key] = (map[key] ?? 0) + (h.currentValue ?? h.investedValue);
    });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filtered]);

  const portfolioPieDataInvested = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach(h => { const key = h.portfolios?.name ?? 'My Portfolio'; map[key] = (map[key] ?? 0) + h.investedValue; });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filtered]);

  // ── Export CSV ───────────────────────────────────────────────────────────

  function exportCsv() {
    const headers = ['Fund Name', 'Broker', 'Portfolio', 'Units', 'Avg NAV', 'Invested', 'Current NAV', 'Current Value', 'P&L', 'P&L %', 'XIRR'];
    const rows = filtered.map(h => [
      `"${h.name}"`,
      h.brokers?.name ?? '',
      h.portfolios?.name ?? '',
      Number(h.quantity).toFixed(4),
      Number(h.avg_buy_price).toFixed(4),
      h.investedValue.toFixed(2),
      h.currentNav?.toFixed(4) ?? '',
      h.currentValue?.toFixed(2) ?? '',
      h.gainLoss?.toFixed(2) ?? '',
      h.gainLossPct?.toFixed(2) ?? '',
      h.xirr != null ? (h.xirr * 100).toFixed(2) : '',
    ].join(','));
    const csv  = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'mutual-funds.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  // ── Pill filter component ────────────────────────────────────────────────

  function Pill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return (
      <button
        onClick={onClick}
        className="px-3 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors"
        style={{
          backgroundColor: active ? '#1B2A4A' : '#F7F5F0',
          color: active ? 'white' : '#6B7280',
          border: '1px solid ' + (active ? '#1B2A4A' : '#E8E5DD'),
        }}
      >
        {label}
      </button>
    );
  }

  const filteredCount = uniqueFundCount;
  const totalCount    = totalUniqueFundCount;

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#C9A84C' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="wv-card p-6 flex items-center gap-3 text-sm" style={{ color: '#DC2626' }}>
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 max-w-screen-xl mx-auto">

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-xl flex items-center gap-2 text-xs font-semibold transition-all"
          style={{ backgroundColor: toast.type === 'success' ? '#059669' : '#DC2626', color: 'white' }}>
          {toast.message}
        </div>
      )}

      {/* ── Page header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold" style={{ color: '#1B2A4A' }}>Mutual Funds</h1>
          <p className="text-sm mt-0.5" style={{ color: '#9CA3AF' }}>Live NAVs from mfapi.in · {totalUniqueFundCount} fund{totalUniqueFundCount === 1 ? '' : 's'} tracked</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors" style={{ borderColor: '#E8E5DD', color: '#6B7280', backgroundColor: 'white' }}>
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
          <button onClick={refreshAllNavs} disabled={navRefreshing} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium" style={{ backgroundColor: '#F7F5F0', color: '#6B7280' }}>
            <RefreshCw className={`w-3.5 h-3.5 ${navRefreshing ? 'animate-spin' : ''}`} /> Refresh NAVs
          </button>
          <button onClick={() => router.push('/add-assets/mutual-funds')} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white" style={{ backgroundColor: '#C9A84C', color: '#1B2A4A' }}>
            <PlusCircle className="w-3.5 h-3.5" /> Add Fund
          </button>
        </div>
      </div>

      {/* ── Empty state ──────────────────────────────────────────────────────────── */}
      {holdings.length === 0 && (
        <div className="wv-card p-16 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center" style={{ backgroundColor: '#F7F5F0' }}>
            <TrendingUp className="w-8 h-8" style={{ color: '#C9A84C' }} />
          </div>
          <p className="font-semibold text-lg mb-1" style={{ color: '#1B2A4A' }}>No mutual fund holdings yet</p>
          <p className="text-sm mb-6" style={{ color: '#9CA3AF' }}>Add your first fund to start tracking your portfolio with live NAVs and XIRR</p>
          <button onClick={() => router.push('/add-assets/mutual-funds')} className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold" style={{ backgroundColor: '#C9A84C', color: '#1B2A4A' }}>
            <PlusCircle className="w-4 h-4" /> Add First Fund
          </button>
        </div>
      )}

      {holdings.length > 0 && (
        <>
          {/* ── Summary bar ────────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: 'Total Invested',  value: formatLargeINR(totalInvested),     color: undefined },
              { label: 'Current Value',   value: formatLargeINR(totalCurrentValue), color: undefined },
              { label: 'Total P&L',       value: (totalGainLoss >= 0 ? '+' : '') + formatLargeINR(totalGainLoss), color: totalGainLoss >= 0 ? '#059669' : '#DC2626' },
              { label: 'Absolute Return', value: (totalGainLossPct >= 0 ? '+' : '') + totalGainLossPct.toFixed(2) + '%', color: totalGainLossPct >= 0 ? '#059669' : '#DC2626' },
              { label: 'Overall XIRR',    value: overallXirr != null ? `${overallXirr >= 0 ? '+' : ''}${overallXirr.toFixed(1)}%` : '—', color: overallXirr != null ? (overallXirr >= 0 ? '#059669' : '#DC2626') : '#9CA3AF' },
            ].map((c) => (
              <div key={c.label} className="wv-card p-4">
                <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#9CA3AF' }}>{c.label}</p>
                <p className="font-display text-lg font-semibold" style={{ color: c.color ?? '#1B2A4A' }}>{c.value}</p>
              </div>
            ))}
          </div>

          {/* ── Filter bar ─────────────────────────────────────────────────────────── */}
          <div className="wv-card p-4 space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              {/* Search */}
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: '#9CA3AF' }} />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search funds…"
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg text-xs outline-none"
                  style={{ border: '1px solid #E8E5DD', backgroundColor: '#F7F5F0', color: '#1A1A2E' }}
                />
              </div>
              {/* Sort */}
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="px-3 py-1.5 rounded-lg text-xs outline-none"
                style={{ border: '1px solid #E8E5DD', backgroundColor: '#F7F5F0', color: '#6B7280' }}
              >
                <option value="value">Sort: Value ↓</option>
                <option value="pnlPct">Sort: P&L% ↓</option>
                <option value="xirr">Sort: XIRR ↓</option>
                <option value="name">Sort: Name A-Z</option>
                <option value="recent">Sort: Recent first</option>
              </select>
              {/* Filter count + clear */}
              <div className="flex items-center gap-2">
                <span className="text-[11px]" style={{ color: '#9CA3AF' }}>
                  Showing <strong style={{ color: '#1A1A2E' }}>{filteredCount}</strong> of {totalCount}
                </span>
                {isFiltered && (
                  <button onClick={clearFilters}
                    className="text-[11px] px-2 py-0.5 rounded-full font-medium transition-colors"
                    style={{ backgroundColor: 'rgba(220,38,38,0.08)', color: '#DC2626', border: '1px solid rgba(220,38,38,0.2)' }}>
                    Clear filters ✕
                  </button>
                )}
              </div>
            </div>

            {/* Broker pills — always show if >1 broker */}
            {brokers.length > 1 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] uppercase tracking-wider mr-1" style={{ color: '#9CA3AF' }}>Distributor</span>
                {brokers.filter(b => b !== 'All').map(b => (
                  <Pill key={b} label={b} active={filterBrokers.has(b)}
                    onClick={() => toggleSet(filterBrokers, setFilterBrokers, b)} />
                ))}
              </div>
            )}

            {/* Portfolio pills */}
            {portfolios.length > 1 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] uppercase tracking-wider mr-1" style={{ color: '#9CA3AF' }}>Portfolio</span>
                {portfolios.filter(p => p !== 'All').map(p => (
                  <Pill key={p} label={p} active={filterPortfolios.has(p)}
                    onClick={() => toggleSet(filterPortfolios, setFilterPortfolios, p)} />
                ))}
              </div>
            )}

            {/* Category pills — always show if any categories exist */}
            {categories.length > 1 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] uppercase tracking-wider mr-1" style={{ color: '#9CA3AF' }}>Category</span>
                {categories.filter(c => c !== 'All').map(c => (
                  <Pill key={c} label={c} active={filterCategories.has(c)}
                    onClick={() => toggleSet(filterCategories, setFilterCategories, c)} />
                ))}
              </div>
            )}

            {/* Member pills */}
            {members.length > 1 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] uppercase tracking-wider mr-1" style={{ color: '#9CA3AF' }}>Member</span>
                {members.filter(m => m !== 'All').map(m => (
                  <Pill key={m} label={m} active={filterMembers.has(m)}
                    onClick={() => toggleSet(filterMembers, setFilterMembers, m)} />
                ))}
              </div>
            )}
          </div>

          {/* ── Allocation charts ───────────────────────────────────────────────────── */}
          <AllocationCharts
            brokerDataMarket={brokerPieData}
            brokerDataInvested={brokerPieDataInvested}
            categoryDataMarket={categoryPieData}
            categoryDataInvested={categoryPieDataInvested}
            portfolioDataMarket={portfolioPieData}
            portfolioDataInvested={portfolioPieDataInvested}
            brokerPalette={BROKER_PALETTE}
          />

          {/* ── Holdings table ──────────────────────────────────────────────────────── */}
          <div className="wv-card overflow-hidden">
            <div className="overflow-x-auto">
              {/* min-width forces horizontal scroll rather than column overflow */}
              <table className="text-xs" style={{ tableLayout: 'fixed', width: '100%', minWidth: 960 }}>
                <colgroup>
                  <col style={{ width: '26%' }} /> {/* Fund — widest, wraps */}
                  <col style={{ width: '9%'  }} /> {/* Broker — wraps to 2 lines */}
                  <col style={{ width: '7%'  }} /> {/* Units */}
                  <col style={{ width: '7%'  }} /> {/* Avg NAV */}
                  <col style={{ width: '8%'  }} /> {/* Invested */}
                  <col style={{ width: '7%'  }} /> {/* Current NAV */}
                  <col style={{ width: '8%'  }} /> {/* Current Value */}
                  <col style={{ width: '8%'  }} /> {/* P&L */}
                  <col style={{ width: '5%'  }} /> {/* P&L % */}
                  <col style={{ width: '5%'  }} /> {/* XIRR */}
                  <col style={{ width: '7%'  }} /> {/* Portfolio */}
                  <col style={{ width: '3%'  }} /> {/* Actions */}
                </colgroup>
                <thead>
                  <tr style={{ borderBottom: '1px solid #E8E5DD', backgroundColor: '#F7F5F0' }}>
                    {[
                      { label: 'Fund',          align: 'left'  },
                      { label: 'Distributor',   align: 'left'  },
                      { label: 'Units',         align: 'right' },
                      { label: 'Avg NAV',       align: 'right' },
                      { label: 'Invested',      align: 'right' },
                      { label: 'Current NAV',   align: 'right' },
                      { label: 'Current Value', align: 'right' },
                      { label: 'P&L',           align: 'right' },
                      { label: 'P&L %',         align: 'right' },
                      { label: 'XIRR',          align: 'right' },
                      { label: 'Portfolio',     align: 'left'  },
                      { label: '',              align: 'left'  },
                    ].map(({ label, align }) => (
                      <th key={label} className="py-2.5 font-medium whitespace-nowrap"
                        style={{ color: '#9CA3AF', paddingLeft: 8, paddingRight: 8, textAlign: align as 'left' | 'right' }}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groupedFiltered.length === 0 ? (
                    <tr><td colSpan={12} className="px-4 py-8 text-center text-xs" style={{ color: '#9CA3AF' }}>No funds match the current filters</td></tr>
                  ) : groupedFiltered.map((group) => {
                    const renderFundRow = (h: HoldingRow, extraStyle?: React.CSSProperties) => {
                      const rowBg = h.gainLoss != null
                        ? h.gainLoss > 0 ? 'rgba(5,150,105,0.02)' : h.gainLoss < 0 ? 'rgba(220,38,38,0.02)' : 'transparent'
                        : 'transparent';
                      const cat = String(h.metadata?.category ?? '');
                      return (
                        <tr key={h.id}
                          style={{ borderBottom: '1px solid #F7F5F0', backgroundColor: rowBg, cursor: 'pointer', ...extraStyle }}
                          className="hover:bg-[#FAFAF8] transition-colors"
                          onClick={() => setDetailId(h.id)}>
                          <td style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 12, paddingBottom: 12 }}>
                            <p className="leading-snug" style={{ color: '#1A1A2E', fontWeight: 500, whiteSpace: 'normal', wordBreak: 'break-word' }}>{h.name}</p>
                            {h.metadata?.fund_house != null && (
                              <p className="text-[10px] mt-0.5 leading-tight" style={{ color: '#9CA3AF' }}>{String(h.metadata.fund_house)}</p>
                            )}
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              {cat && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: catStyle(cat).bg, color: catStyle(cat).text }}>{cat}</span>}
                              <SipBadge metadata={h.metadata} />
                              {h.metadata?.folio != null && <span className="text-[10px]" style={{ color: '#D1D5DB' }}>Folio: {String(h.metadata.folio)}</span>}
                            </div>
                          </td>
                          <td style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 12, paddingBottom: 12, color: '#6B7280', whiteSpace: 'normal', wordBreak: 'break-word' }}>{h.brokers?.name ?? '—'}</td>
                          <td style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 12, paddingBottom: 12, color: '#6B7280', whiteSpace: 'nowrap', textAlign: 'right' }}>{Number(h.quantity).toFixed(4)}</td>
                          <td style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 12, paddingBottom: 12, color: '#6B7280', whiteSpace: 'nowrap', textAlign: 'right' }}>₹{Number(h.avg_buy_price).toFixed(4)}</td>
                          <td style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 12, paddingBottom: 12, color: '#1A1A2E', fontWeight: 500, whiteSpace: 'nowrap', textAlign: 'right' }}>{formatLargeINR(h.investedValue)}</td>
                          <td style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 12, paddingBottom: 12, whiteSpace: 'nowrap', textAlign: 'right' }}>
                            {h.navLoading ? <Loader2 className="w-3 h-3 animate-spin" style={{ color: '#9CA3AF' }} /> : h.currentNav ? <span style={{ color: '#1A1A2E' }}>₹{h.currentNav.toFixed(4)}</span> : <span style={{ color: '#9CA3AF' }}>—</span>}
                          </td>
                          <td style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 12, paddingBottom: 12, color: '#1A1A2E', fontWeight: 500, whiteSpace: 'nowrap', textAlign: 'right' }}>{h.currentValue ? formatLargeINR(h.currentValue) : '—'}</td>
                          <td style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 12, paddingBottom: 12, whiteSpace: 'nowrap', textAlign: 'right' }}>
                            {h.gainLoss != null ? <span className="font-semibold" style={{ color: h.gainLoss >= 0 ? '#059669' : '#DC2626' }}>{h.gainLoss >= 0 ? '+' : ''}{formatLargeINR(h.gainLoss)}</span> : '—'}
                          </td>
                          <td style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 12, paddingBottom: 12, whiteSpace: 'nowrap', textAlign: 'right' }}>
                            {h.gainLossPct != null ? <span className="font-semibold" style={{ color: h.gainLossPct >= 0 ? '#059669' : '#DC2626' }}>{h.gainLossPct >= 0 ? '+' : ''}{h.gainLossPct.toFixed(2)}%</span> : '—'}
                          </td>
                          <td style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 12, paddingBottom: 12, whiteSpace: 'nowrap', textAlign: 'right' }}>
                            {h.xirr != null ? <span style={{ color: h.xirr >= 0 ? '#059669' : '#DC2626' }}>{formatPercentage(h.xirr * 100)}</span> : <span style={{ color: '#9CA3AF' }}>—</span>}
                          </td>
                          <td className="text-[11px]" style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 12, paddingBottom: 12, color: '#9CA3AF', whiteSpace: 'nowrap' }}>{h.portfolios?.name ?? '—'}</td>
                          <td style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 12, paddingBottom: 12 }} onClick={e => e.stopPropagation()}>
                            <ActionMenu holdingId={h.id} onDelete={deleteHolding}
                              onViewDetails={(id) => { setOpenAsRedeem(false); setDetailId(id); }}
                              onAddMore={(id) => router.push(`/add-assets/mutual-funds?add_to=${id}`)}
                              onSellRedeem={(id) => { setOpenAsRedeem(true); setDetailId(id); }} />
                          </td>
                        </tr>
                      );
                    };

                    if (!group.isMultiDistributor) return renderFundRow(group.holdings[0]);

                    const isExpanded = expandedGroups.has(group.symbol);
                    const tGain = group.totalCurrentValue != null ? group.totalCurrentValue - group.totalInvested : null;
                    const tGainPct = tGain != null && group.totalInvested > 0 ? (tGain / group.totalInvested) * 100 : null;
                    const wtdAvg = group.totalUnits > 0 ? group.totalInvested / group.totalUnits : 0;
                    const cat = group.category;

                    return (
                      <React.Fragment key={group.symbol}>
                        {isExpanded && group.holdings.map(h => renderFundRow(h, { borderLeft: '3px solid #C9A84C' }))}
                        {/* Consolidated summary row */}
                        <tr
                          style={{ borderBottom: '1px solid #F7F5F0', backgroundColor: 'rgba(201,168,76,0.08)', borderLeft: '3px solid #C9A84C', cursor: 'pointer' }}
                          onClick={() => setExpandedGroups(prev => { const next = new Set(prev); if (next.has(group.symbol)) next.delete(group.symbol); else next.add(group.symbol); return next; })}>
                          <td style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 12, paddingBottom: 12 }}>
                            <div className="flex items-center gap-2">
                              {isExpanded ? <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#C9A84C' }} /> : <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#C9A84C' }} />}
                              <div>
                                <p className="leading-snug font-semibold" style={{ color: '#1A1A2E', whiteSpace: 'normal', wordBreak: 'break-word' }}>{group.name} — Total</p>
                                <p className="text-[10px] mt-0.5" style={{ color: '#9CA3AF' }}>{group.holdings.length} distributors</p>
                                {cat && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full mt-1 inline-block" style={{ backgroundColor: catStyle(cat).bg, color: catStyle(cat).text }}>{cat}</span>}
                              </div>
                            </div>
                          </td>
                          <td style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 12, paddingBottom: 12 }}><span className="font-semibold" style={{ color: '#C9A84C' }}>Consolidated</span></td>
                          <td style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 12, paddingBottom: 12, fontWeight: 600, whiteSpace: 'nowrap', textAlign: 'right', color: '#1A1A2E' }}>{group.totalUnits.toFixed(4)}</td>
                          <td style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 12, paddingBottom: 12, color: '#6B7280', whiteSpace: 'nowrap', textAlign: 'right' }}>₹{wtdAvg.toFixed(4)}</td>
                          <td style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 12, paddingBottom: 12, fontWeight: 600, whiteSpace: 'nowrap', textAlign: 'right', color: '#1A1A2E' }}>{formatLargeINR(group.totalInvested)}</td>
                          <td style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 12, paddingBottom: 12, whiteSpace: 'nowrap', textAlign: 'right' }}>
                            {group.navLoading ? <Loader2 className="w-3 h-3 animate-spin" style={{ color: '#9CA3AF' }} /> : group.currentNav ? <span style={{ color: '#1A1A2E' }}>₹{group.currentNav.toFixed(4)}</span> : <span style={{ color: '#9CA3AF' }}>—</span>}
                          </td>
                          <td style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 12, paddingBottom: 12, fontWeight: 600, whiteSpace: 'nowrap', textAlign: 'right', color: '#1A1A2E' }}>{group.totalCurrentValue != null ? formatLargeINR(group.totalCurrentValue) : '—'}</td>
                          <td style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 12, paddingBottom: 12, whiteSpace: 'nowrap', textAlign: 'right' }}>
                            {tGain != null ? <span className="font-semibold" style={{ color: tGain >= 0 ? '#059669' : '#DC2626' }}>{tGain >= 0 ? '+' : ''}{formatLargeINR(tGain)}</span> : '—'}
                          </td>
                          <td style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 12, paddingBottom: 12, whiteSpace: 'nowrap', textAlign: 'right' }}>
                            {tGainPct != null ? <span className="font-semibold" style={{ color: tGainPct >= 0 ? '#059669' : '#DC2626' }}>{tGainPct >= 0 ? '+' : ''}{tGainPct.toFixed(2)}%</span> : '—'}
                          </td>
                          <td style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 12, paddingBottom: 12, color: '#9CA3AF' }}>—</td>
                          <td style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 12, paddingBottom: 12, color: '#9CA3AF' }}>—</td>
                          <td />
                        </tr>
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Table footer */}
            {filtered.length > 0 && (
              <div className="px-5 py-3 flex items-center justify-between" style={{ borderTop: '2px solid #E8E5DD', backgroundColor: '#F7F5F0' }}>
                <span className="text-xs font-semibold" style={{ color: '#1B2A4A' }}>
                  {uniqueFundCount} fund{uniqueFundCount === 1 ? '' : 's'} · Total
                </span>
                <div className="flex items-center gap-6 text-xs">
                  <span style={{ color: '#6B7280' }}>Invested: <strong style={{ color: '#1B2A4A' }}>{formatLargeINR(totalInvested)}</strong></span>
                  <span style={{ color: '#6B7280' }}>Current: <strong style={{ color: '#1B2A4A' }}>{formatLargeINR(totalCurrentValue)}</strong></span>
                  <span style={{ color: totalGainLoss >= 0 ? '#059669' : '#DC2626' }}>P&L: <strong>{totalGainLoss >= 0 ? '+' : ''}{formatLargeINR(totalGainLoss)} ({totalGainLossPct >= 0 ? '+' : ''}{totalGainLossPct.toFixed(2)}%)</strong></span>
                </div>
              </div>
            )}
          </div>

          {/* ── Broker comparison ───────────────────────────────────────────────────── */}
          {showBrokerComparison && (
            <div className="wv-card p-5">
              <h3 className="section-heading text-sm mb-4">Distributor Performance</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ borderBottom: '1px solid #E8E5DD' }}>
                      {['Distributor', 'Funds', 'Invested', 'Current Value', 'P&L', 'P&L %'].map(h => (
                        <th key={h} className="text-left px-3 py-2 font-medium" style={{ color: '#9CA3AF' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {brokerStats.map(b => (
                      <tr key={b.name} style={{ borderBottom: '1px solid #F7F5F0' }}>
                        <td className="px-3 py-2.5 font-medium" style={{ color: '#1A1A2E' }}>{b.name}</td>
                        <td className="px-3 py-2.5" style={{ color: '#6B7280' }}>{b.count}</td>
                        <td className="px-3 py-2.5" style={{ color: '#6B7280' }}>{formatLargeINR(b.invested)}</td>
                        <td className="px-3 py-2.5 font-medium" style={{ color: '#1A1A2E' }}>{formatLargeINR(b.current)}</td>
                        <td className="px-3 py-2.5 font-semibold" style={{ color: b.pnl >= 0 ? '#059669' : '#DC2626' }}>
                          {b.pnl >= 0 ? '+' : ''}{formatLargeINR(b.pnl)}
                        </td>
                        <td className="px-3 py-2.5 font-semibold" style={{ color: b.pnlPct >= 0 ? '#059669' : '#DC2626' }}>
                          {b.pnlPct >= 0 ? '+' : ''}{b.pnlPct.toFixed(2)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Holding detail sheet ────────────────────────────────────────────────── */}
      <HoldingDetailSheet
        holding={detailId ? (holdings.find(h => h.id === detailId) ?? null) : null}
        open={!!detailId}
        initialView={openAsRedeem ? 'redeem' : undefined}
        onClose={() => { setDetailId(null); setOpenAsRedeem(false); }}
        onDeleted={(id) => { setHoldings(prev => prev.filter(h => h.id !== id)); setDetailId(null); setOpenAsRedeem(false); }}
        onHoldingChanged={loadHoldings}
      />
    </div>
  );
}
