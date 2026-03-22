'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  RefreshCw, PlusCircle, Loader2, AlertCircle, TrendingUp, TrendingDown,
  MoreHorizontal, Search, Download, History,
} from 'lucide-react';
import { ImportHistory } from '@/components/portfolio/ImportHistory';
import { HoldingDetailSheet } from '@/components/portfolio/HoldingDetailSheet';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR, formatPercentage } from '@/lib/utils/formatters';
import { calculateXIRR } from '@/lib/utils/calculations';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Transaction { id: string; date: string; price: number; quantity: number; type: string; fees: number; notes?: string }

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
  Equity:     { bg: 'rgba(27,42,74,0.08)',   text: '#1B2A4A' },
  ELSS:       { bg: '#F5EDD6',               text: '#C9A84C' },
  Hybrid:     { bg: 'rgba(46,139,139,0.08)', text: '#2E8B8B' },
  Debt:       { bg: 'rgba(5,150,105,0.08)',  text: '#059669' },
  Liquid:     { bg: 'rgba(5,150,105,0.08)',  text: '#059669' },
  Gilt:       { bg: 'rgba(5,150,105,0.08)',  text: '#059669' },
  'Index/ETF':{ bg: 'rgba(27,42,74,0.08)',   text: '#1B2A4A' },
};
function catStyle(cat: string) { return CAT_COLORS[cat] ?? { bg: '#F3F4F6', text: '#6B7280' }; }

function ActionMenu({
  holdingId, onDelete, onViewDetails, onAddMore,
}: {
  holdingId: string;
  onDelete: (id: string) => void;
  onViewDetails: (id: string) => void;
  onAddMore: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const actions = [
    { label: 'View details', action: () => { onViewDetails(holdingId); setOpen(false); } },
    { label: 'Edit',         action: () => { router.push(`/add-assets/mutual-funds?edit=${holdingId}`); setOpen(false); } },
    { label: 'Add units',    action: () => { onAddMore(holdingId); setOpen(false); } },
    { label: 'Sell / Redeem', action: () => { onViewDetails(holdingId); setOpen(false); } },
    { label: 'Delete',       action: () => { onDelete(holdingId); setOpen(false); }, danger: true },
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MutualFundsPortfolioPage() {
  const router   = useRouter();
  const supabase = createClient();

  const [holdings, setHoldings]     = useState<HoldingRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [navRefreshing, setNavRefreshing] = useState(false);
  const [memberNames, setMemberNames] = useState<Record<string, string>>({});
  const [detailId, setDetailId]     = useState<string | null>(null);

  // Filter + sort state
  const [filterBroker,   setFilterBroker]   = useState('All');
  const [filterPortfolio,setFilterPortfolio] = useState('All');
  const [filterCategory, setFilterCategory]  = useState('All');
  const [filterMember,   setFilterMember]    = useState('All');
  const [sortKey,        setSortKey]         = useState<SortKey>('value');
  const [searchQuery,    setSearchQuery]     = useState('');

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

    const { data, error: dbErr } = await supabase
      .from('holdings')
      .select(`
        id, symbol, name, quantity, avg_buy_price, metadata,
        portfolios(id, name, type, user_id),
        brokers(id, name, platform_type),
        transactions(id, date, price, quantity, type, fees, notes)
      `)
      .eq('asset_type', 'mutual_fund')
      .order('created_at', { ascending: false });

    if (dbErr) { setError(dbErr.message); setLoading(false); return; }

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

    // Fetch NAVs
    const unique = Array.from(new Set(rows.map(r => r.symbol)));
    await Promise.allSettled(unique.map(sym => fetchNav(sym, rows)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchNav(symbol: string, base?: HoldingRow[]) {
    try {
      const res = await fetch(`/api/mf/nav?scheme_code=${symbol}`);
      if (!res.ok) throw new Error();
      const { nav: currentNav, navDate } = await res.json();

      setHoldings(prev => {
        const src = base ?? prev;
        return src.map(h => {
          if (h.symbol !== symbol) return { ...h, navLoading: false };
          const currentValue = Number(h.quantity) * currentNav;
          const gainLoss     = currentValue - h.investedValue;
          const gainLossPct  = h.investedValue > 0 ? (gainLoss / h.investedValue) * 100 : 0;
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
    } catch {
      setHoldings(prev => prev.map(h => h.symbol === symbol ? { ...h, navLoading: false } : h));
    }
  }

  useEffect(() => { loadHoldings(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function refreshAllNavs() {
    setNavRefreshing(true);
    await Promise.allSettled(Array.from(new Set(holdings.map(h => h.symbol))).map(s => fetchNav(s)));
    setNavRefreshing(false);
  }

  async function deleteHolding(id: string) {
    if (!confirm('Delete this holding and all its transactions?')) return;
    await supabase.from('transactions').delete().eq('holding_id', id);
    await supabase.from('holdings').delete().eq('id', id);
    setHoldings(prev => prev.filter(h => h.id !== id));
  }

  // ── Derived filter options ────────────────────────────────────────────────

  const brokers    = useMemo(() => ['All', ...Array.from(new Set(holdings.map(h => h.brokers?.name ?? '—').filter(Boolean)))], [holdings]);
  const portfolios = useMemo(() => ['All', ...Array.from(new Set(holdings.map(h => h.portfolios?.name ?? 'My Portfolio').filter(Boolean)))], [holdings]);
  const categories = useMemo(() => ['All', ...Array.from(new Set(holdings.map(h => String(h.metadata?.category ?? '')).filter(Boolean)))], [holdings]);
  const members    = useMemo(() => ['All', ...Array.from(new Set(holdings.map(h => h.memberName).filter(Boolean)))], [holdings]);

  // ── Filtered + sorted holdings ────────────────────────────────────────────

  const filtered = useMemo(() => {
    let rows = holdings;
    if (filterBroker    !== 'All') rows = rows.filter(h => (h.brokers?.name ?? '—') === filterBroker);
    if (filterPortfolio !== 'All') rows = rows.filter(h => (h.portfolios?.name ?? 'My Portfolio') === filterPortfolio);
    if (filterCategory  !== 'All') rows = rows.filter(h => String(h.metadata?.category ?? '') === filterCategory);
    if (filterMember    !== 'All') rows = rows.filter(h => h.memberName === filterMember);
    if (searchQuery)               rows = rows.filter(h => h.name.toLowerCase().includes(searchQuery.toLowerCase()));

    return [...rows].sort((a, b) => {
      switch (sortKey) {
        case 'value':   return (b.currentValue ?? b.investedValue) - (a.currentValue ?? a.investedValue);
        case 'pnlPct':  return (b.gainLossPct ?? 0) - (a.gainLossPct ?? 0);
        case 'xirr':    return (b.xirr ?? -Infinity) - (a.xirr ?? -Infinity);
        case 'name':    return a.name.localeCompare(b.name);
        case 'recent':  return 0; // already sorted by created_at desc from DB
        default:        return 0;
      }
    });
  }, [holdings, filterBroker, filterPortfolio, filterCategory, filterMember, searchQuery, sortKey]);

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

      {/* ── Page header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold" style={{ color: '#1B2A4A' }}>Mutual Funds</h1>
          <p className="text-sm mt-0.5" style={{ color: '#9CA3AF' }}>Live NAVs from mfapi.in · {holdings.length} fund{holdings.length === 1 ? '' : 's'} tracked</p>
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
            </div>

            {/* Broker pills */}
            {brokers.length > 2 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] uppercase tracking-wider mr-1" style={{ color: '#9CA3AF' }}>Broker</span>
                {brokers.map(b => <Pill key={b} label={b} active={filterBroker === b} onClick={() => setFilterBroker(b)} />)}
              </div>
            )}

            {/* Portfolio pills */}
            {portfolios.length > 2 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] uppercase tracking-wider mr-1" style={{ color: '#9CA3AF' }}>Portfolio</span>
                {portfolios.map(p => <Pill key={p} label={p} active={filterPortfolio === p} onClick={() => setFilterPortfolio(p)} />)}
              </div>
            )}

            {/* Category pills */}
            {categories.length > 2 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] uppercase tracking-wider mr-1" style={{ color: '#9CA3AF' }}>Category</span>
                {categories.map(c => <Pill key={c} label={c} active={filterCategory === c} onClick={() => setFilterCategory(c)} />)}
              </div>
            )}

            {/* Member pills */}
            {members.length > 2 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] uppercase tracking-wider mr-1" style={{ color: '#9CA3AF' }}>Member</span>
                {members.map(m => <Pill key={m} label={m} active={filterMember === m} onClick={() => setFilterMember(m)} />)}
              </div>
            )}
          </div>

          {/* ── Holdings table ──────────────────────────────────────────────────────── */}
          <div className="wv-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ borderBottom: '1px solid #E8E5DD', backgroundColor: '#F7F5F0' }}>
                    {['Fund', 'Broker', 'Units', 'Avg NAV', 'Invested', 'Current NAV', 'Current Value', 'P&L', 'P&L %', 'XIRR', 'Portfolio', ''].map((h) => (
                      <th key={h} className="text-left px-4 py-2.5 font-medium whitespace-nowrap" style={{ color: '#9CA3AF' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={12} className="px-4 py-8 text-center text-xs" style={{ color: '#9CA3AF' }}>No funds match the current filters</td></tr>
                  ) : filtered.map((h) => {
                    const rowBg = h.gainLoss != null
                      ? h.gainLoss > 0 ? 'rgba(5,150,105,0.02)' : h.gainLoss < 0 ? 'rgba(220,38,38,0.02)' : 'transparent'
                      : 'transparent';
                    const cat = String(h.metadata?.category ?? '');

                    return (
                      <>
                        <tr
                          key={h.id}
                          style={{ borderBottom: '1px solid #F7F5F0', backgroundColor: rowBg, cursor: 'pointer' }}
                          className="hover:bg-[#FAFAF8] transition-colors"
                          onClick={() => setDetailId(h.id)}
                        >
                          {/* Fund name */}
                          <td className="px-4 py-3" style={{ maxWidth: 260 }}>
                            <div>
                              <p className="font-medium leading-tight" style={{ color: '#1A1A2E', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.name}</p>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                {cat && (
                                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: catStyle(cat).bg, color: catStyle(cat).text }}>{cat}</span>
                                )}
                                {h.metadata?.folio ? <span className="text-[10px]" style={{ color: '#D1D5DB' }}>Folio: {String(h.metadata.folio)}</span> : null}
                              </div>
                            </div>
                          </td>
                          {/* Broker */}
                          <td className="px-4 py-3 whitespace-nowrap" style={{ color: '#6B7280' }}>{h.brokers?.name ?? '—'}</td>
                          {/* Units */}
                          <td className="px-4 py-3 whitespace-nowrap" style={{ color: '#6B7280' }}>{Number(h.quantity).toFixed(4)}</td>
                          {/* Avg NAV */}
                          <td className="px-4 py-3 whitespace-nowrap" style={{ color: '#6B7280' }}>₹{Number(h.avg_buy_price).toFixed(4)}</td>
                          {/* Invested */}
                          <td className="px-4 py-3 font-medium whitespace-nowrap" style={{ color: '#1A1A2E' }}>{formatLargeINR(h.investedValue)}</td>
                          {/* Current NAV */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            {h.navLoading
                              ? <Loader2 className="w-3 h-3 animate-spin" style={{ color: '#9CA3AF' }} />
                              : h.currentNav ? <span style={{ color: '#1A1A2E' }}>₹{h.currentNav.toFixed(4)}</span> : <span style={{ color: '#9CA3AF' }}>—</span>
                            }
                          </td>
                          {/* Current value */}
                          <td className="px-4 py-3 font-medium whitespace-nowrap" style={{ color: '#1A1A2E' }}>
                            {h.currentValue ? formatLargeINR(h.currentValue) : '—'}
                          </td>
                          {/* P&L */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            {h.gainLoss != null ? (
                              <span className="font-semibold text-xs" style={{ color: h.gainLoss >= 0 ? '#059669' : '#DC2626' }}>
                                {h.gainLoss >= 0 ? '+' : ''}{formatLargeINR(h.gainLoss)}
                              </span>
                            ) : '—'}
                          </td>
                          {/* P&L % */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            {h.gainLossPct != null ? (
                              <span className="font-semibold text-xs" style={{ color: h.gainLossPct >= 0 ? '#059669' : '#DC2626' }}>
                                {h.gainLossPct >= 0 ? '+' : ''}{h.gainLossPct.toFixed(2)}%
                              </span>
                            ) : '—'}
                          </td>
                          {/* XIRR */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            {h.xirr != null ? (
                              <span style={{ color: h.xirr >= 0 ? '#059669' : '#DC2626' }}>{formatPercentage(h.xirr * 100)}</span>
                            ) : <span style={{ color: '#9CA3AF' }}>—</span>}
                          </td>
                          {/* Portfolio */}
                          <td className="px-4 py-3 whitespace-nowrap text-[11px]" style={{ color: '#9CA3AF' }}>{h.portfolios?.name ?? '—'}</td>
                          {/* Actions */}
                          <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                            <ActionMenu
                              holdingId={h.id}
                              onDelete={deleteHolding}
                              onViewDetails={(id) => setDetailId(id)}
                              onAddMore={(id) => router.push(`/add-assets/mutual-funds?fund=${holdings.find(x=>x.id===id)?.symbol}`)}
                            />
                          </td>
                        </tr>

                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Table footer */}
            {filtered.length > 0 && (
              <div className="px-5 py-3 flex items-center justify-between" style={{ borderTop: '2px solid #E8E5DD', backgroundColor: '#F7F5F0' }}>
                <span className="text-xs font-semibold" style={{ color: '#1B2A4A' }}>
                  {filtered.length} fund{filtered.length === 1 ? '' : 's'} · Total
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
              <h3 className="section-heading text-sm mb-4">Broker Performance</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ borderBottom: '1px solid #E8E5DD' }}>
                      {['Broker', 'Funds', 'Invested', 'Current Value', 'P&L', 'P&L %'].map(h => (
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

      {/* ── Import History ──────────────────────────────────────────────────────── */}
      <div className="wv-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <History className="w-4 h-4" style={{ color: '#9CA3AF' }} />
          <h3 className="text-sm font-semibold" style={{ color: '#1B2A4A' }}>Import History</h3>
          <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ backgroundColor: '#F7F5F0', color: '#9CA3AF' }}>
            CAS bulk imports only
          </span>
        </div>
        <ImportHistory
          memberNames={memberNames}
          onHoldingsChanged={loadHoldings}
        />
      </div>

      {/* ── Holding detail sheet ────────────────────────────────────────────────── */}
      <HoldingDetailSheet
        holding={detailId ? (holdings.find(h => h.id === detailId) ?? null) : null}
        open={!!detailId}
        onClose={() => setDetailId(null)}
        onDeleted={(id) => { setHoldings(prev => prev.filter(h => h.id !== id)); setDetailId(null); }}
        onHoldingChanged={loadHoldings}
      />
    </div>
  );
}
