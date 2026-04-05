'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import {
  RefreshCw, PlusCircle, Loader2, AlertCircle, TrendingUp, TrendingDown,
  MoreHorizontal, Search, Download, X, ChevronDown, ChevronRight,
} from 'lucide-react';
import { StockDetailSheet, type StockHoldingDetail } from '@/components/portfolio/StockDetailSheet';
import { MergerDemergerModal } from '@/components/portfolio/MergerDemergerModal';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR, formatPercentage } from '@/lib/utils/formatters';
import { calculateXIRR } from '@/lib/utils/calculations';
import { holdingsCacheGet, holdingsCacheSet, holdingsCacheClear, holdingsCacheClearAll } from '@/lib/utils/holdings-cache';
import { FamilyMemberSelector } from '@/components/shared/FamilyMemberSelector';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Transaction { id: string; date: string; price: number; quantity: number; type: string; fees: number; notes?: string; metadata?: Record<string, unknown> }

interface RawHolding {
  id: string;
  symbol: string;
  name: string;
  quantity: number;
  avg_buy_price: number;
  metadata: Record<string, unknown>;
  portfolios: { id: string; name: string; type: string; user_id: string; family_id: string } | null;
  brokers:    { id: string; name: string; platform_type: string } | null;
  transactions: Transaction[];
}

interface HoldingRow extends RawHolding {
  currentPrice:    number | null;
  priceLoading:    boolean;
  priceUnavailable: boolean;
  manualPrice:     number | null;  // user-entered fallback price (session only)
  investedValue:   number;
  currentValue:    number | null;
  gainLoss:        number | null;
  gainLossPct:     number | null;
  dayChange:       number | null;   // price change today (CMP - prev close)
  dayChangePct:    number | null;   // day change percentage
  xirr:            number | null;
  memberName:      string;
  sector:          string;
}

type SortKey = 'value' | 'pnlPct' | 'xirr' | 'name' | 'recent';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const _SECTORS = ['IT','Banking','Finance','FMCG','Auto','Pharma','Energy','Metals','Infrastructure','Chemicals','Consumer','Healthcare','Cement','Insurance','Telecom','Real Estate','Technology','Defense','Retail','Capital Goods','Other'];

function sectorColor(sector: string): string {
  const COLORS: Record<string, string> = {
    'IT':           '#3B82F6', 'Banking':      '#1B2A4A', 'Finance':     '#5C6BC0',
    'FMCG':         '#059669', 'Auto':         '#EA580C', 'Pharma':      '#DB2777',
    'Energy':       '#D97706', 'Metals':       '#6B7280', 'Infrastructure':'#8B5CF6',
    'Chemicals':    '#14B8A6', 'Consumer':     '#F59E0B', 'Healthcare':  '#EC4899',
    'Cement':       '#9CA3AF', 'Insurance':    '#2E8B8B', 'Telecom':     '#6366F1',
    'Real Estate':  '#C9A84C', 'Technology':   '#2563EB', 'Defense':     '#374151',
    'Retail':       '#7C3AED', 'Capital Goods':'#10B981', 'Other':       '#6B7280',
  };
  return COLORS[sector] ?? '#6B7280';
}

function fmt(v: number): string {
  if (v >= 10_000_000) return `₹${(v / 10_000_000).toFixed(2)}Cr`;
  if (v >= 100_000)    return `₹${(v / 100_000).toFixed(2)}L`;
  if (v >= 1_000)      return `₹${(v / 1_000).toFixed(1)}K`;
  return `₹${Math.round(v)}`;
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

// ─── Action Menu ──────────────────────────────────────────────────────────────

function ActionMenu({
  holdingId, familyId, memberId, onDelete, onViewDetails, onMerger, onDemerger,
}: {
  holdingId: string;
  familyId?: string;
  memberId?: string;
  onDelete: (id: string) => void;
  onViewDetails: (id: string) => void;
  onMerger?: (id: string) => void;
  onDemerger?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  function navTo(url: string) {
    if (familyId) sessionStorage.setItem('wv_prefill_family', familyId);
    if (memberId) sessionStorage.setItem('wv_prefill_member', memberId);
    if (familyId || memberId) sessionStorage.setItem('wv_prefill_active', 'true');
    router.push(url);
  }
  const actions = [
    { label: 'View details',             action: () => { onViewDetails(holdingId); setOpen(false); } },
    { label: 'Add More Shares',          action: () => { navTo(`/add-assets/indian-stocks?add_to=${holdingId}`); setOpen(false); } },
    { label: 'Sell',                     action: () => { navTo(`/add-assets/indian-stocks?sell=${holdingId}`); setOpen(false); } },
    { label: 'Record Bonus',            action: () => { navTo(`/add-assets/indian-stocks?bonus=${holdingId}`); setOpen(false); } },
    { label: 'Record Stock Split',      action: () => { navTo(`/add-assets/indian-stocks?split=${holdingId}`); setOpen(false); } },
    { label: 'Record Rights Issue',     action: () => { navTo(`/add-assets/indian-stocks?rights=${holdingId}`); setOpen(false); } },
    { label: 'Record Dividend',         action: () => { navTo(`/add-assets/indian-stocks?dividend=${holdingId}`); setOpen(false); } },
    { label: 'Record Buyback',          action: () => { navTo(`/add-assets/indian-stocks?buyback=${holdingId}`); setOpen(false); } },
    { label: 'Record Merger / M&A',     action: () => { onMerger?.(holdingId); setOpen(false); } },
    { label: 'Record Demerger',         action: () => { onDemerger?.(holdingId); setOpen(false); } },
    { label: 'Delete',                   action: () => { onDelete(holdingId); setOpen(false); }, danger: true },
  ];
  return (
    <div className="relative">
      <button onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="p-1 rounded hover:bg-gray-100 transition-colors">
        <MoreHorizontal className="w-3.5 h-3.5" style={{ color: 'var(--wv-text-muted)' }} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0" style={{ zIndex: 9990 }} onClick={() => setOpen(false)} />
          <div className="absolute right-0 bg-white rounded-xl border py-1 min-w-[180px]"
            style={{ borderColor: 'var(--wv-border)', top: '100%', zIndex: 9999, boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}>
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

// ─── Donut Chart ──────────────────────────────────────────────────────────────

interface PieEntry { name: string; value: number }

function DonutChart({ title, data, getColor }: {
  title: string; data: PieEntry[]; getColor: (name: string, index: number) => string;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (data.length === 0) {
    return (
      <div className="wv-card flex flex-col" style={{ padding: 16, minHeight: 220 }}>
        <p className="text-xs font-semibold mb-3" style={{ color: 'var(--wv-text)' }}>
          {title} <span style={{ color: 'var(--wv-text-muted)', fontWeight: 400 }}>(Market Value)</span>
        </p>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs" style={{ color: 'var(--wv-text-muted)' }}>No data</p>
        </div>
      </div>
    );
  }
  return (
    <div className="wv-card" style={{ padding: 16, overflow: 'hidden' }}>
      <p className="text-xs font-semibold mb-3" style={{ color: 'var(--wv-text)' }}>
        {title} <span style={{ color: 'var(--wv-text-muted)', fontWeight: 400 }}>(Market Value)</span>
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
              contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid var(--wv-border)', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
              itemStyle={{ color: 'var(--wv-text)' }}
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
              <span style={{ flex: 1, fontSize: 11, color: 'var(--wv-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {entry.name}
              </span>
              <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, color: 'var(--wv-text)', fontVariantNumeric: 'tabular-nums' }}>
                {fmt(entry.value)}
              </span>
              <span style={{ flexShrink: 0, fontSize: 10, color: 'var(--wv-text-muted)', width: 36, textAlign: 'right' }}>
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

// ─── Pill ─────────────────────────────────────────────────────────────────────

function Pill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="px-3 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors"
      style={{
        backgroundColor: active ? '#1B2A4A' : '#F7F5F0',
        color:           active ? 'white'   : '#6B7280',
        border:          `1px solid ${active ? '#1B2A4A' : 'var(--wv-border)'}`,
      }}>
      {label}
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function IndianStocksPortfolioPage() {
  const router   = useRouter();
  const supabase = createClient();

  const [holdings,       setHoldings]       = useState<HoldingRow[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState<string | null>(null);
  const [priceRefreshing,setPriceRefreshing]= useState(false);
  const [toast,          setToast]          = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [detailId,       setDetailId]       = useState<string | null>(null);
  const [_memberNames,   setMemberNames]    = useState<Record<string, string>>({});
  const [manualPriceInput, setManualPriceInput] = useState<Record<string, string>>({}); // symbol → input string
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set()); // default expanded — populated on first group render

  // Filters
  const [filterBrokers,    setFilterBrokers]    = useState<Set<string>>(new Set());
  const [filterPortfolios, setFilterPortfolios] = useState<Set<string>>(new Set());
  const [filterSectors,    setFilterSectors]    = useState<Set<string>>(new Set());
  const [sortKey,          setSortKey]          = useState<SortKey>('value');
  const [searchQuery,      setSearchQuery]      = useState('');
  const [activeMemberIds,  setActiveMemberIds]  = useState<string[]>([]);

  // M&A / Demerger modal
  const [corpActionHoldingId, setCorpActionHoldingId] = useState<string | null>(null);
  const [corpActionMode, setCorpActionMode] = useState<'merger' | 'demerger'>('merger');

  function toggleSet(set: Set<string>, setFn: (s: Set<string>) => void, val: string) {
    const next = new Set(set);
    if (next.has(val)) next.delete(val); else next.add(val);
    setFn(next);
  }

  function clearFilters() {
    setFilterBrokers(new Set()); setFilterPortfolios(new Set());
    setFilterSectors(new Set()); setSearchQuery('');
  }

  const isFiltered = filterBrokers.size > 0 || filterPortfolios.size > 0 || filterSectors.size > 0 || !!searchQuery;

  // ── Load holdings ────────────────────────────────────────────────────────────

  const loadHoldings = useCallback(async () => {
    setLoading(true); setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/login'); return; }

    const { data: usersData } = await supabase.from('users').select('id, name');
    const names: Record<string, string> = {};
    (usersData ?? []).forEach(u => { names[u.id] = u.name; });
    setMemberNames(names);

    // Check holdings cache first
    const cachedHoldings = holdingsCacheGet<RawHolding[]>('stock_holdings');
    let data: unknown[] | null = cachedHoldings;

    if (!data) {
      const { data: freshData, error: dbErr } = await supabase
        .from('holdings')
        .select(`
          id, symbol, name, quantity, avg_buy_price, metadata,
          portfolios(id, name, type, user_id, family_id),
          brokers(id, name, platform_type),
          transactions(id, date, price, quantity, type, fees, notes, metadata)
        `)
        .eq('asset_type', 'indian_stock')
        .gt('quantity', 0)  // only active holdings
        .order('created_at', { ascending: false });

      if (dbErr) { setError(dbErr.message); setLoading(false); return; }
      data = freshData;
      if (data) holdingsCacheSet('stock_holdings', data as unknown as RawHolding[]);
    }

    if (!data) { setError('Failed to load holdings'); setLoading(false); return; }

    // Merge holdings with same symbol + broker + portfolio into a single row
    const preRows = data as unknown as RawHolding[];
    const mergeMap = new Map<string, RawHolding[]>();
    for (const h of preRows) {
      const key = `${h.symbol}|${h.brokers?.id ?? ''}|${h.portfolios?.id ?? ''}`;
      if (!mergeMap.has(key)) mergeMap.set(key, []);
      mergeMap.get(key)!.push(h);
    }
    const mergedRows: RawHolding[] = [];
    Array.from(mergeMap.values()).forEach(group => {
      if (group.length === 1) { mergedRows.push(group[0]); return; }
      const primary = { ...group[0] };
      primary.quantity = group.reduce((s, h) => s + Number(h.quantity), 0);
      primary.transactions = group.flatMap(h => h.transactions ?? [])
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      const totalCost = group.reduce((s, h) => s + Number(h.quantity) * Number(h.avg_buy_price), 0);
      primary.avg_buy_price = primary.quantity > 0 ? totalCost / primary.quantity : 0;
      mergedRows.push(primary);
    });

    const rows: HoldingRow[] = mergedRows.map(h => {
      const ownerId  = h.portfolios?.user_id ?? '';

      // Compute invested from transactions using FIFO (account for sells)
      const buyTxns = (h.transactions ?? []).filter(t => t.type === 'buy' || t.type === 'sip')
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      const sellTxns = (h.transactions ?? []).filter(t => t.type === 'sell');
      const totalSold = sellTxns.reduce((sum, t) => sum + Number(t.quantity), 0);
      let invested: number;
      if (buyTxns.length > 0) {
        const lots = buyTxns.map(t => {
          const q = Number(t.quantity);
          return { qty: q, origQty: q, price: Number(t.price), fees: Number(t.fees) || 0 };
        });
        let soldRemaining = totalSold;
        for (const lot of lots) {
          if (soldRemaining <= 0) break;
          const consumed = Math.min(soldRemaining, lot.qty);
          lot.qty -= consumed;
          soldRemaining -= consumed;
        }
        invested = 0;
        for (const lot of lots) {
          if (lot.qty <= 0) continue;
          const feePerShare = lot.origQty > 0 ? lot.fees / lot.origQty : 0;
          invested += lot.qty * lot.price + lot.qty * feePerShare;
        }
      } else {
        invested = Number(h.quantity) * Number(h.avg_buy_price);
      }

      return {
        ...h,
        currentPrice: null, priceLoading: true, priceUnavailable: false, manualPrice: null,
        investedValue: invested,
        currentValue: null, gainLoss: null, gainLossPct: null, dayChange: null, dayChangePct: null, xirr: null,
        memberName: names[ownerId] ?? '',
        sector: String(h.metadata?.sector ?? 'Other'),
      };
    });

    setHoldings(rows);
    setLoading(false);

    // Batch-fetch all prices in a single request
    const unique = Array.from(new Set(rows.map(r => r.symbol)));
    await fetchPriceBatch(unique, rows, false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function applyPrice(symbol: string, price: number) {
    setHoldings(prev => prev.map(h => {
      if (h.symbol !== symbol) return h;
      const currentValue = Number(h.quantity) * price;
      const gainLoss     = currentValue - h.investedValue;
      const gainLossPct  = h.investedValue > 0 ? (gainLoss / h.investedValue) * 100 : 0;
      let xirr: number | null = null;
      const buyTxns = (h.transactions ?? []).filter(t => t.type === 'buy' || t.type === 'sip');
      if (buyTxns.length > 0) {
        const earliest = buyTxns.reduce((a, b) => new Date(a.date) < new Date(b.date) ? a : b);
        const d0 = new Date(earliest.date);
        if (new Date() > d0) {
          try {
            const r = calculateXIRR([-h.investedValue, currentValue], [d0, new Date()]);
            if (isFinite(r)) xirr = r * 100;
          } catch { /* skip */ }
        }
      }
      return { ...h, currentPrice: price, priceLoading: false, priceUnavailable: false, currentValue, gainLoss, gainLossPct, dayChange: null, dayChangePct: null, xirr };
    }));
  }

  async function fetchPriceBatch(symbols: string[], baseRows?: HoldingRow[], nocache = false): Promise<number> {
    try {
      const res  = await fetch('/api/stocks/price/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols, nocache }),
      });
      const json = await res.json();
      const batchResults: Record<string, { price: number; change?: number; changePct?: number; previousClose?: number } | null> = json.results ?? {};
      let succeeded = 0;
      setHoldings(prev => {
        const source = baseRows ?? prev;
        return source.map(h => {
          if (!symbols.includes(h.symbol)) return h;
          const result = batchResults[h.symbol];
          if (!result) return { ...h, priceLoading: false, priceUnavailable: true };
          succeeded++;
          const currentValue = Number(h.quantity) * result.price;
          const gainLoss     = currentValue - h.investedValue;
          const gainLossPct  = h.investedValue > 0 ? (gainLoss / h.investedValue) * 100 : 0;
          let xirr: number | null = null;
          const buyTxns = (h.transactions ?? []).filter(t => t.type === 'buy' || t.type === 'sip');
          if (buyTxns.length > 0) {
            const earliest = buyTxns.reduce((a, b) => new Date(a.date) < new Date(b.date) ? a : b);
            const d0 = new Date(earliest.date);
            if (new Date() > d0) {
              try {
                const r = calculateXIRR([-h.investedValue, currentValue], [d0, new Date()]);
                if (isFinite(r)) xirr = r * 100;
              } catch { /* skip */ }
            }
          }
          return { ...h, currentPrice: result.price, priceLoading: false, priceUnavailable: false, currentValue, gainLoss, gainLossPct, dayChange: result.change ?? null, dayChangePct: result.changePct ?? null, xirr };
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
    const count = await fetchPriceBatch([symbol], undefined, bypassCache);
    return count > 0;
  }

  function submitManualPrice(symbol: string) {
    const val = parseFloat(manualPriceInput[symbol] ?? '');
    if (!isNaN(val) && val > 0) applyPrice(symbol, val);
  }

  useEffect(() => { loadHoldings(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function refreshAllPrices() {
    setPriceRefreshing(true);
    holdingsCacheClearAll();
    const unique = Array.from(new Set(holdings.map(h => h.symbol)));
    const succeeded = await fetchPriceBatch(unique, undefined, true);
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
  const sectors    = useMemo(() => Array.from(new Set(holdings.map(h => h.sector).filter(Boolean))), [holdings]);

  // ── Filtered + sorted holdings ─────────────────────────────────────────────

  const filtered = useMemo(() => {
    let rows = activeMemberIds.length > 0
      ? holdings.filter(h => activeMemberIds.includes(h.portfolios?.user_id ?? ''))
      : holdings;
    if (filterBrokers.size > 0)    rows = rows.filter(h => filterBrokers.has(h.brokers?.name ?? '—'));
    if (filterPortfolios.size > 0) rows = rows.filter(h => filterPortfolios.has(h.portfolios?.name ?? 'My Portfolio'));
    if (filterSectors.size > 0)    rows = rows.filter(h => filterSectors.has(h.sector));
    if (searchQuery)               rows = rows.filter(h =>
      h.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      h.symbol.toLowerCase().includes(searchQuery.toLowerCase())
    );
    return [...rows].sort((a, b) => {
      switch (sortKey) {
        case 'value':  return (b.currentValue ?? b.investedValue) - (a.currentValue ?? a.investedValue);
        case 'pnlPct': return (b.gainLossPct ?? 0) - (a.gainLossPct ?? 0);
        case 'xirr':   return (b.xirr ?? -Infinity) - (a.xirr ?? -Infinity);
        case 'name':   return a.name.localeCompare(b.name);
        default:       return 0;
      }
    });
  }, [holdings, activeMemberIds, filterBrokers, filterPortfolios, filterSectors, searchQuery, sortKey]);

  // ── Grouped holdings (multi-broker consolidation) ─────────────────────────

  interface StockGroup {
    symbol: string; name: string; sector: string;
    holdings: HoldingRow[]; isMultiBroker: boolean;
    totalQty: number; totalInvested: number;
    totalCurrentValue: number | null;
    currentPrice: number | null; priceLoading: boolean; priceUnavailable: boolean;
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
      sector: rows[0].sector,
      holdings: rows,
      isMultiBroker: rows.length > 1,
      totalQty: rows.reduce((s, r) => s + Number(r.quantity), 0),
      totalInvested: rows.reduce((s, r) => s + r.investedValue, 0),
      totalCurrentValue: rows.every(r => r.currentValue != null)
        ? rows.reduce((s, r) => s + (r.currentValue ?? 0), 0) : null,
      currentPrice: rows[0].currentPrice,
      priceLoading: rows.some(r => r.priceLoading),
      priceUnavailable: rows.every(r => r.priceUnavailable),
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

  // ── Summary totals ─────────────────────────────────────────────────────────

  const totalInvested     = filtered.reduce((s, h) => s + h.investedValue, 0);
  const totalCurrentValue = filtered.reduce((s, h) => s + (h.currentValue ?? h.investedValue), 0);
  const totalGainLoss     = totalCurrentValue - totalInvested;
  const totalGainLossPct  = totalInvested > 0 ? (totalGainLoss / totalInvested) * 100 : 0;

  let overallXirr: number | null = null;
  {
    const allCfs: { amount: number; date: Date }[] = [];
    holdings.forEach(h => {
      (h.transactions ?? []).filter(t => t.type === 'buy' || t.type === 'sip').forEach(t => {
        allCfs.push({ amount: -(Number(t.quantity) * Number(t.price) + Number(t.fees ?? 0)), date: new Date(t.date) });
      });
    });
    if (allCfs.length && totalCurrentValue > 0) {
      const sorted = [...allCfs, { amount: totalCurrentValue, date: new Date() }]
        .sort((a, b) => a.date.getTime() - b.date.getTime());
      try {
        const r = calculateXIRR(sorted.map(c => c.amount), sorted.map(c => c.date));
        if (isFinite(r) && r > -1 && r < 10) overallXirr = r * 100;
      } catch { /* skip */ }
    }
  }

  // ── Pie data ───────────────────────────────────────────────────────────────

  const BROKER_PALETTE = ['#1B2A4A', '#2E8B8B', '#C9A84C', '#059669', '#7C3AED', '#EA580C', '#2563EB', '#DB2777'];

  const brokerPieData = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach(h => { const k = h.brokers?.name ?? 'Unknown'; map[k] = (map[k] ?? 0) + (h.currentValue ?? h.investedValue); });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filtered]);

  const sectorPieData = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach(h => { const k = h.sector || 'Other'; map[k] = (map[k] ?? 0) + (h.currentValue ?? h.investedValue); });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filtered]);

  const portfolioPieData = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach(h => { const k = h.portfolios?.name ?? 'My Portfolio'; map[k] = (map[k] ?? 0) + (h.currentValue ?? h.investedValue); });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filtered]);

  // ── Export CSV ─────────────────────────────────────────────────────────────

  function exportCsv() {
    const headers = ['Stock', 'Symbol', 'Sector', 'Distributor', 'Portfolio', 'Qty', 'Avg Buy Price', 'Invested', 'CMP', 'Current Value', 'P&L', 'P&L %', 'XIRR'];
    const rows = filtered.map(h => [
      `"${h.name}"`, h.symbol, h.sector, h.brokers?.name ?? '', h.portfolios?.name ?? '',
      Number(h.quantity).toFixed(0), Number(h.avg_buy_price).toFixed(2),
      h.investedValue.toFixed(2),
      h.currentPrice?.toFixed(2) ?? '',
      h.currentValue?.toFixed(2) ?? '',
      h.gainLoss?.toFixed(2) ?? '',
      h.gainLossPct?.toFixed(2) ?? '',
      h.xirr != null ? h.xirr.toFixed(2) : '',
    ].join(','));
    const csv  = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a'); a.href = url; a.download = 'indian-stocks.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  // ── Detail holding ─────────────────────────────────────────────────────────

  const detailHolding: StockHoldingDetail | null = useMemo(() => {
    if (!detailId) return null;
    const h = holdings.find(x => x.id === detailId);
    if (!h) return null;
    return {
      ...h,
      investedValue: h.investedValue,
      currentValue:  h.currentValue,
      gainLoss:      h.gainLoss,
      gainLossPct:   h.gainLossPct,
    };
  }, [detailId, holdings]);

  // ── Row renderer ──────────────────────────────────────────────────────────

  function renderStockRow(h: HoldingRow, extraStyle?: React.CSSProperties) {
    const isGain = (h.gainLoss ?? 0) >= 0;
    return (
      <div key={h.id}
        className="grid items-center px-4 py-3 border-b hover:bg-[#FAFAF8] transition-colors cursor-pointer"
        style={{
          gridTemplateColumns: '2fr 0.6fr 0.6fr 0.6fr 0.9fr 0.9fr 0.7fr 0.7fr 0.9fr 0.9fr 40px',
          borderColor: '#F0EDE6',
          backgroundColor: h.gainLoss != null ? (isGain ? 'rgba(5,150,105,0.01)' : 'rgba(220,38,38,0.01)') : 'transparent',
          ...extraStyle,
        }}
        onClick={() => setDetailId(h.id)}>
        <div className="flex items-center gap-2.5 min-w-0 pr-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0"
            style={{ backgroundColor: sectorColor(h.sector) }}>
            {h.symbol.slice(0, 2)}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold leading-tight" style={{ color: 'var(--wv-text)', wordBreak: 'break-word', whiteSpace: 'normal', lineHeight: 1.3 }}>
              {h.name}
            </p>
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--wv-text-muted)' }}>{h.symbol}</p>
          </div>
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-medium truncate" style={{ color: 'var(--wv-text-secondary)' }}>{h.brokers?.name ?? '—'}</p>
        </div>
        <div>
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded"
            style={{ backgroundColor: sectorColor(h.sector) + '15', color: sectorColor(h.sector) }}>{h.sector}</span>
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-medium truncate" style={{ color: 'var(--wv-text-muted)' }}>{h.portfolios?.name ?? '—'}</p>
        </div>
        <div className="text-right">
          <p className="text-xs" style={{ color: 'var(--wv-text)' }}>{Number(h.quantity).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
          <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>₹{Number(h.avg_buy_price).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p>
        </div>
        <div className="text-right">
          <p className="text-xs" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(h.investedValue)}</p>
        </div>
        <div className="text-right" onClick={e => e.stopPropagation()}>
          {h.priceLoading ? (
            <Loader2 className="w-3 h-3 animate-spin ml-auto" style={{ color: '#C9A84C' }} />
          ) : h.currentPrice !== null ? (
            <p className="text-xs font-medium" style={{ color: 'var(--wv-text)' }}>₹{h.currentPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p>
          ) : h.priceUnavailable ? (
            <div className="flex flex-col items-end gap-1">
              <p className="text-[9px]" style={{ color: 'var(--wv-text-muted)' }}>Unavailable</p>
              <div className="flex items-center gap-1">
                <input type="number" placeholder="Enter"
                  value={manualPriceInput[h.symbol] ?? ''}
                  onChange={e => setManualPriceInput(prev => ({ ...prev, [h.symbol]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') submitManualPrice(h.symbol); }}
                  className="w-16 h-6 text-[10px] text-right border rounded px-1 outline-none"
                  style={{ borderColor: 'var(--wv-border)', color: 'var(--wv-text)' }} />
                <button onClick={() => submitManualPrice(h.symbol)}
                  className="text-[9px] px-1.5 py-0.5 rounded font-medium"
                  style={{ backgroundColor: '#1B2A4A', color: 'white' }}>✓</button>
              </div>
            </div>
          ) : (
            <p className="text-[10px]" style={{ color: '#DC2626' }}>Error</p>
          )}
        </div>
        {/* Day P&L */}
        <div className="text-right">
          {h.dayChange != null ? (
            <div>
              <p className="text-[10px] font-semibold" style={{ color: h.dayChange >= 0 ? '#059669' : '#DC2626' }}>
                {h.dayChange >= 0 ? '+' : ''}{formatLargeINR(Number(h.quantity) * h.dayChange)}
              </p>
              <p className="text-[9px]" style={{ color: h.dayChange >= 0 ? '#059669' : '#DC2626' }}>
                {h.dayChangePct != null && h.dayChangePct >= 0 ? '+' : ''}{(h.dayChangePct ?? 0).toFixed(2)}%
              </p>
            </div>
          ) : (
            <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>—</p>
          )}
        </div>
        <div className="text-right">
          {h.currentValue != null ? (
            <p className="text-xs font-medium" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(h.currentValue)}</p>
          ) : (
            <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>—</p>
          )}
        </div>
        <div className="text-right">
          {h.gainLoss != null && <_PnlBadge value={h.gainLoss} pct={h.gainLossPct ?? 0} />}
        </div>
        <div onClick={e => e.stopPropagation()}>
          <ActionMenu holdingId={h.id} familyId={h.portfolios?.family_id} memberId={h.portfolios?.user_id} onDelete={deleteHolding} onViewDetails={id => setDetailId(id)} onMerger={id => { setCorpActionHoldingId(id); setCorpActionMode('merger'); }} onDemerger={id => { setCorpActionHoldingId(id); setCorpActionMode('demerger'); }} />
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3" style={{ color: '#C9A84C' }} />
          <p className="text-sm" style={{ color: 'var(--wv-text-muted)' }}>Loading your portfolio…</p>
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
            style={{ backgroundColor: 'var(--wv-surface-2)' }}>
            <TrendingUp className="w-4.5 h-4.5" style={{ color: 'var(--wv-text)' }} />
          </div>
          <div>
            <h1 className="font-display text-lg font-semibold" style={{ color: 'var(--wv-text)' }}>Indian Stocks</h1>
            <p className="text-xs" style={{ color: 'var(--wv-text-muted)' }}>{totalUniqueStockCount} stock{totalUniqueStockCount !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={refreshAllPrices} disabled={priceRefreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ backgroundColor: 'var(--wv-surface-2)', color: 'var(--wv-text-secondary)', border: '1px solid var(--wv-border)' }}>
            <RefreshCw className={`w-3.5 h-3.5 ${priceRefreshing ? 'animate-spin' : ''}`} />
            {priceRefreshing ? 'Refreshing…' : 'Refresh Prices'}
          </button>
          <button onClick={exportCsv}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ backgroundColor: 'var(--wv-surface-2)', color: 'var(--wv-text-secondary)', border: '1px solid var(--wv-border)' }}>
            <Download className="w-3.5 h-3.5" />CSV
          </button>
          <button onClick={() => router.push('/add-assets/indian-stocks')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
            style={{ backgroundColor: '#C9A84C' }}>
            <PlusCircle className="w-3.5 h-3.5" />Add Stock
          </button>
        </div>
      </div>

      {holdings.length === 0 ? (
        <div className="wv-card p-16 text-center">
          <TrendingUp className="w-10 h-10 mx-auto mb-4" style={{ color: 'var(--wv-border)' }} />
          <h3 className="font-semibold text-base mb-2" style={{ color: 'var(--wv-text)' }}>No stock holdings yet</h3>
          <p className="text-sm mb-6" style={{ color: 'var(--wv-text-muted)' }}>Add your NSE/BSE equity holdings to get started</p>
          <button onClick={() => router.push('/add-assets/indian-stocks')}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
            style={{ backgroundColor: '#1B2A4A' }}>
            Add First Holding
          </button>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          {(() => {
            const totalDayPnl = filtered.reduce((s, h) => s + (h.dayChange != null ? Number(h.quantity) * h.dayChange : 0), 0);
            const totalDayPnlPct = totalCurrentValue > 0 && totalDayPnl !== 0
              ? (totalDayPnl / (totalCurrentValue - totalDayPnl)) * 100 : 0;
            return (
          <div className="grid grid-cols-3 sm:grid-cols-7 gap-3">
            {[
              { label: 'Total Invested',  value: formatLargeINR(totalInvested),     sub: null },
              { label: 'Current Value',   value: formatLargeINR(totalCurrentValue),  sub: null },
              { label: 'P&L',             value: `${totalGainLoss >= 0 ? '+' : ''}${formatLargeINR(totalGainLoss)}`,
                                          sub: null, color: totalGainLoss >= 0 ? '#059669' : '#DC2626' },
              { label: 'Returns',         value: `${totalGainLossPct >= 0 ? '+' : ''}${totalGainLossPct.toFixed(2)}%`,
                                          sub: null, color: totalGainLossPct >= 0 ? '#059669' : '#DC2626' },
              { label: 'XIRR',            value: overallXirr != null ? `${overallXirr.toFixed(2)}%` : '—',
                                          sub: null, color: overallXirr != null && overallXirr >= 0 ? '#059669' : '#DC2626' },
              { label: 'Day P&L',         value: `${totalDayPnl >= 0 ? '+' : ''}${formatLargeINR(totalDayPnl)}`,
                                          sub: `${totalDayPnlPct >= 0 ? '+' : ''}${totalDayPnlPct.toFixed(2)}%`,
                                          color: totalDayPnl >= 0 ? '#059669' : '#DC2626' },
              { label: 'Stocks',          value: totalUniqueStockCount.toString(), sub: `${uniqueStockCount} shown` },
            ].map(({ label, value, sub, color }) => (
              <div key={label} className="wv-card p-3">
                <p className="text-[10px] font-medium" style={{ color: 'var(--wv-text-muted)' }}>{label}</p>
                <p className="text-sm font-bold mt-1" style={{ color: color ?? '#1A1A2E' }}>{value}</p>
                {sub && <p className="text-[10px] mt-0.5" style={{ color: 'var(--wv-text-muted)' }}>{sub}</p>}
              </div>
            ))}
          </div>
            );
          })()}

          {/* Allocation charts */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <DonutChart
              title="Allocation by Distributor"
              data={brokerPieData}
              getColor={(_, i) => BROKER_PALETTE[i % BROKER_PALETTE.length]}
            />
            <DonutChart
              title="Allocation by Sector"
              data={sectorPieData}
              getColor={(name) => sectorColor(name)}
            />
            <DonutChart
              title="Allocation by Portfolio"
              data={portfolioPieData}
              getColor={(_, i) => PORTFOLIO_PALETTE[i % PORTFOLIO_PALETTE.length]}
            />
          </div>

          {/* Filter bar */}
          <div className="wv-card p-3 space-y-3">
            <FamilyMemberSelector
              onSelectionChange={(ids) => setActiveMemberIds(ids)}
              compact
            />

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: 'var(--wv-text-muted)' }} />
              <input
                value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search by stock name or symbol…"
                className="w-full h-8 pl-9 pr-8 text-xs rounded-lg border bg-white outline-none focus:border-[#C9A84C]"
                style={{ borderColor: 'var(--wv-border)' }}
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2">
                  <X className="w-3 h-3" style={{ color: 'var(--wv-text-muted)' }} />
                </button>
              )}
            </div>

            {/* Filter pills */}
            <div className="space-y-2">
              {brokers.length > 1 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-semibold uppercase tracking-wide flex-shrink-0" style={{ color: 'var(--wv-text-muted)' }}>Distributor:</span>
                  {brokers.map(b => (
                    <Pill key={b} label={b} active={filterBrokers.has(b)} onClick={() => toggleSet(filterBrokers, setFilterBrokers, b)} />
                  ))}
                </div>
              )}
              {sectors.length > 1 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-semibold uppercase tracking-wide flex-shrink-0" style={{ color: 'var(--wv-text-muted)' }}>Sector:</span>
                  {sectors.map(s => (
                    <Pill key={s} label={s} active={filterSectors.has(s)} onClick={() => toggleSet(filterSectors, setFilterSectors, s)} />
                  ))}
                </div>
              )}
              {portfolios.length > 1 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-semibold uppercase tracking-wide flex-shrink-0" style={{ color: 'var(--wv-text-muted)' }}>Portfolio:</span>
                  {portfolios.map(p => (
                    <Pill key={p} label={p} active={filterPortfolios.has(p)} onClick={() => toggleSet(filterPortfolios, setFilterPortfolios, p)} />
                  ))}
                </div>
              )}
            </div>

            {/* Sort + clear */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Sort:</span>
                {(['value','pnlPct','xirr','name'] as SortKey[]).map(k => {
                  const labels: Record<SortKey, string> = { value: 'Value', pnlPct: 'P&L %', xirr: 'XIRR', name: 'Name', recent: 'Recent' };
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
                <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>
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

          {/* Top Gainer / Loser */}
          {filtered.length > 0 && (() => {
            const withDayChange = filtered.filter(h => h.dayChangePct != null);
            if (withDayChange.length === 0) return null;
            const topGainer = withDayChange.reduce((best, h) => (h.dayChangePct ?? 0) > (best.dayChangePct ?? 0) ? h : best);
            const topLoser = withDayChange.reduce((worst, h) => (h.dayChangePct ?? 0) < (worst.dayChangePct ?? 0) ? h : worst);
            return (
              <div className="flex items-center gap-4 text-xs px-1">
                {(topGainer.dayChangePct ?? 0) > 0 && (
                  <span style={{ color: '#059669' }}>
                    <TrendingUp className="w-3 h-3 inline mr-1" />
                    Top Gainer: <strong>{topGainer.name}</strong> +{(topGainer.dayChangePct ?? 0).toFixed(2)}%
                  </span>
                )}
                {(topLoser.dayChangePct ?? 0) < 0 && (
                  <span style={{ color: '#DC2626' }}>
                    <TrendingDown className="w-3 h-3 inline mr-1" />
                    Top Loser: <strong>{topLoser.name}</strong> {(topLoser.dayChangePct ?? 0).toFixed(2)}%
                  </span>
                )}
              </div>
            );
          })()}

          {/* Holdings table */}
          <div className="wv-card overflow-hidden">
            {/* Table header */}
            <div className="grid text-[10px] font-semibold uppercase tracking-wide px-4 py-2 border-b"
              style={{ gridTemplateColumns: '2fr 0.6fr 0.6fr 0.6fr 0.9fr 0.9fr 0.7fr 0.7fr 0.9fr 0.9fr 40px', borderColor: '#F0EDE6', color: 'var(--wv-text-muted)', backgroundColor: 'var(--wv-surface-2)' }}>
              <span>Stock</span>
              <span>Distributor</span>
              <span>Sector</span>
              <span>Portfolio</span>
              <span className="text-right">Qty · Avg</span>
              <span className="text-right">Invested</span>
              <span className="text-right">CMP</span>
              <span className="text-right">Day</span>
              <span className="text-right">Value</span>
              <span className="text-right">P&L</span>
              <span />
            </div>

            {groupedFiltered.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <p className="text-sm" style={{ color: 'var(--wv-text-muted)' }}>No holdings match your filters</p>
              </div>
            ) : (
              groupedFiltered.map(group => {
                if (!group.isMultiBroker) return renderStockRow(group.holdings[0]);
                const isExpanded = expandedGroups.has(group.symbol);
                const tGain = group.totalCurrentValue != null ? group.totalCurrentValue - group.totalInvested : null;
                const tGainPct = tGain != null && group.totalInvested > 0 ? (tGain / group.totalInvested) * 100 : null;
                const wtdAvg = group.totalQty > 0 ? group.totalInvested / group.totalQty : 0;
                const hasDayChange = group.holdings.some(h => h.dayChange != null);
                const groupDayPnl = group.holdings.reduce((s, h) => s + (h.dayChange != null ? Number(h.quantity) * h.dayChange : 0), 0);
                const groupDayPnlPct = group.holdings[0]?.dayChangePct ?? null;
                const uniqueBrokerIds = new Set(group.holdings.map(h => h.brokers?.id).filter(Boolean));
                const uniquePortfolioIds = new Set(group.holdings.map(h => h.portfolios?.id).filter(Boolean));
                const subtitle = uniqueBrokerIds.size > 1 && uniquePortfolioIds.size > 1
                  ? `${group.holdings.length} entries · ${uniqueBrokerIds.size} brokers, ${uniquePortfolioIds.size} portfolios`
                  : uniqueBrokerIds.size > 1 ? `${uniqueBrokerIds.size} brokers`
                  : uniquePortfolioIds.size > 1 ? `${uniquePortfolioIds.size} portfolios`
                  : group.holdings[0]?.brokers?.name ?? '';
                return (
                  <div key={group.symbol}>
                    {/* Consolidated summary row — always on top */}
                    <div
                      className="grid items-center px-4 py-3 border-b cursor-pointer"
                      style={{
                        gridTemplateColumns: '2fr 0.6fr 0.6fr 0.6fr 0.9fr 0.9fr 0.7fr 0.7fr 0.9fr 0.9fr 40px',
                        borderColor: '#F0EDE6',
                        backgroundColor: 'rgba(201,168,76,0.08)',
                        borderLeft: '3px solid #C9A84C',
                      }}
                      onClick={() => setExpandedGroups(prev => { const next = new Set(prev); if (next.has(group.symbol)) next.delete(group.symbol); else next.add(group.symbol); return next; })}>
                      <div className="flex items-center gap-2 min-w-0 pr-2">
                        {isExpanded ? <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#C9A84C' }} /> : <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#C9A84C' }} />}
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0"
                          style={{ backgroundColor: sectorColor(group.sector) }}>
                          {group.symbol.slice(0, 2)}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold leading-tight" style={{ color: 'var(--wv-text)' }}>{group.name} — Total</p>
                          <p className="text-[10px] mt-0.5" style={{ color: 'var(--wv-text-muted)' }}>{subtitle}</p>
                        </div>
                      </div>
                      <div><p className="text-[11px] font-semibold" style={{ color: '#C9A84C' }}>Consolidated</p></div>
                      <div><span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ backgroundColor: sectorColor(group.sector) + '15', color: sectorColor(group.sector) }}>{group.sector}</span></div>
                      <div><p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>—</p></div>
                      <div className="text-right">
                        <p className="text-xs font-semibold" style={{ color: 'var(--wv-text)' }}>{group.totalQty.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
                        <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>₹{wtdAvg.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p>
                      </div>
                      <div className="text-right"><p className="text-xs font-semibold" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(group.totalInvested)}</p></div>
                      <div className="text-right">
                        {group.currentPrice != null ? <p className="text-xs font-medium" style={{ color: 'var(--wv-text)' }}>₹{group.currentPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p>
                          : group.priceLoading ? <Loader2 className="w-3 h-3 animate-spin ml-auto" style={{ color: '#C9A84C' }} /> : <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>—</p>}
                      </div>
                      {/* Day P&L */}
                      <div className="text-right">
                        {hasDayChange ? (
                          <div>
                            <p className="text-[10px] font-semibold" style={{ color: groupDayPnl >= 0 ? '#059669' : '#DC2626' }}>
                              {groupDayPnl >= 0 ? '+' : ''}{formatLargeINR(groupDayPnl)}
                            </p>
                            {groupDayPnlPct != null && (
                              <p className="text-[9px]" style={{ color: groupDayPnlPct >= 0 ? '#059669' : '#DC2626' }}>
                                {groupDayPnlPct >= 0 ? '+' : ''}{groupDayPnlPct.toFixed(2)}%
                              </p>
                            )}
                          </div>
                        ) : <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>—</p>}
                      </div>
                      <div className="text-right">
                        {group.totalCurrentValue != null ? <p className="text-xs font-semibold" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(group.totalCurrentValue)}</p> : <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>—</p>}
                      </div>
                      <div className="text-right">{tGain != null && tGainPct != null ? <_PnlBadge value={tGain} pct={tGainPct} /> : <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>—</p>}</div>
                      <div />
                    </div>
                    {/* Individual entries — expand below consolidated row */}
                    {isExpanded && group.holdings.map(h => renderStockRow(h, { borderLeft: '3px solid #C9A84C', backgroundColor: 'rgba(201,168,76,0.03)', paddingLeft: '1.5rem' }))}
                  </div>
                );
              })
            )}
          </div>

          {/* Past Holdings (qty=0) section — would need separate query */}
        </>
      )}

      {/* Detail sheet */}
      <StockDetailSheet
        holding={detailHolding}
        open={!!detailId}
        onClose={() => setDetailId(null)}
        onDelete={deleteHolding}
        onRefreshPrice={sym => fetchPrice(sym)}
        onHoldingChanged={() => { holdingsCacheClear('stock_holdings'); loadHoldings(); }}
      />

      {/* M&A / Demerger Modal */}
      {corpActionHoldingId && (() => {
        const h = holdings.find(x => x.id === corpActionHoldingId);
        if (!h) return null;
        return (
          <MergerDemergerModal
            holding={{
              id: h.id,
              symbol: h.symbol,
              name: h.name,
              quantity: h.quantity,
              avgBuyPrice: h.avg_buy_price,
              assetType: 'indian_stock',
            }}
            mode={corpActionMode}
            stockType="indian_stock"
            onClose={() => setCorpActionHoldingId(null)}
            onComplete={() => { holdingsCacheClear('stock_holdings'); loadHoldings(); }}
          />
        );
      })()}
    </div>
  );
}
