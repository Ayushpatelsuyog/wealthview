'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Shield, PlusCircle, Loader2, AlertCircle, TrendingUp, TrendingDown,
  RefreshCw, Pencil, Trash2, X, Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR, formatPercentage } from '@/lib/utils/formatters';
import { FamilyMemberSelector } from '@/components/shared/FamilyMemberSelector';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Transaction {
  id: string;
  date: string;
  price: number;
  quantity: number;
  type: string;
  fees: number;
  notes?: string;
}

interface RawHolding {
  id: string;
  symbol: string;
  name: string;
  quantity: number;
  avg_buy_price: number;
  metadata: Record<string, unknown>;
  portfolios: { id: string; name: string; user_id: string; family_id: string } | null;
  brokers: { id: string; name: string } | null;
  transactions: Transaction[];
}

interface HoldingRow extends RawHolding {
  investedValue: number;
  currentNav: number;
  currentValue: number;
  pnl: number;
  pnlPct: number;
  amc: string;
  memberName: string;
  navStale: boolean;
}

interface Toast {
  type: 'success' | 'error';
  message: string;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ToastBanner({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const ok = toast.type === 'success';
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl mb-4 text-sm font-medium"
      style={{
        backgroundColor: ok ? 'rgba(5,150,105,0.08)' : 'rgba(220,38,38,0.08)',
        border: `1px solid ${ok ? 'rgba(5,150,105,0.2)' : 'rgba(220,38,38,0.2)'}`,
        color: ok ? '#059669' : '#DC2626',
      }}>
      {ok ? <Check className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
      <span className="flex-1">{toast.message}</span>
      <button onClick={onClose}><X className="w-3.5 h-3.5" /></button>
    </div>
  );
}

function PnlBadge({ value, pct }: { value: number; pct: number }) {
  const up = value >= 0;
  return (
    <div>
      <p className="text-xs font-semibold" style={{ color: up ? '#059669' : '#DC2626' }}>
        {up ? '+' : ''}{formatLargeINR(value)}
      </p>
      <p className="text-[10px]" style={{ color: up ? '#059669' : '#DC2626' }}>
        {up
          ? <TrendingUp className="w-2.5 h-2.5 inline mr-0.5" />
          : <TrendingDown className="w-2.5 h-2.5 inline mr-0.5" />}
        {formatPercentage(pct)}
      </p>
    </div>
  );
}

function SummaryCard({
  label, value, subtext, color,
}: {
  label: string; value: string; subtext?: string; color?: string;
}) {
  return (
    <div className="wv-card p-4">
      <p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--wv-text-muted)' }}>{label}</p>
      <p className="text-lg font-bold" style={{ color: color ?? '#1B2A4A' }}>{value}</p>
      {subtext && <p className="text-[10px] mt-0.5" style={{ color: 'var(--wv-text-muted)' }}>{subtext}</p>}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SifPortfolioPage() {
  const router = useRouter();
  const supabase = createClient();

  const [holdings, setHoldings] = useState<HoldingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [_memberNames, _setMemberNames] = useState<Record<string, string>>({});
  const [activeMemberIds, setActiveMemberIds] = useState<string[]>([]);

  // Detail sheet
  const [detailId, setDetailId] = useState<string | null>(null);

  // Inline NAV update
  const [editNavId, setEditNavId] = useState<string | null>(null);
  const [editNavValue, setEditNavValue] = useState('');
  const [updatingNav, setUpdatingNav] = useState(false);

  // ── Load holdings ──────────────────────────────────────────────────────────

  const loadHoldings = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/login'); return; }

    // Load member names
    const { data: usersData } = await supabase.from('users').select('id, name');
    const names: Record<string, string> = {};
    (usersData ?? []).forEach(u => { names[u.id] = u.name; });
    _setMemberNames(names);

    // Load all mutual_fund holdings, then filter for SIF client-side
    const { data, error: dbErr } = await supabase
      .from('holdings')
      .select(`
        id, symbol, name, quantity, avg_buy_price, metadata,
        portfolios(id, name, user_id, family_id),
        brokers(id, name),
        transactions(id, date, price, quantity, type, fees, notes)
      `)
      .eq('asset_type', 'mutual_fund')
      .gt('quantity', 0);

    if (dbErr) { setError(dbErr.message); setLoading(false); return; }
    if (!data) { setError('Failed to load holdings'); setLoading(false); return; }

    // Filter for SIF-flagged holdings
    const sifData = (data as unknown as RawHolding[]).filter(
      h => h.metadata?.is_sif || h.metadata?.category === 'SIF'
    );

    const rows: HoldingRow[] = sifData.map(h => {
      const invested = Number(h.quantity) * Number(h.avg_buy_price);
      const currentNav = (h.metadata?.current_nav as number) ?? Number(h.avg_buy_price);
      const currentValue = Number(h.quantity) * currentNav;
      const pnl = currentValue - invested;
      const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;
      const ownerId = h.portfolios?.user_id ?? '';

      // Check if NAV is stale (older than 7 days or never updated)
      const navUpdatedAt = h.metadata?.nav_updated_at as string | undefined;
      const navStale = !navUpdatedAt ||
        (Date.now() - new Date(navUpdatedAt).getTime()) > 7 * 24 * 60 * 60 * 1000;

      return {
        ...h,
        investedValue: invested,
        currentNav,
        currentValue,
        pnl,
        pnlPct,
        amc: (h.metadata?.amc as string) ?? (h.metadata?.fund_house as string) ?? '',
        memberName: names[ownerId] ?? '',
        navStale,
      };
    });

    setHoldings(rows);
    setLoading(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadHoldings();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Update NAV inline ──────────────────────────────────────────────────────

  async function handleNavUpdate(holdingId: string) {
    const newNav = parseFloat(editNavValue);
    if (!newNav || newNav <= 0) return;

    setUpdatingNav(true);

    const holding = holdings.find(h => h.id === holdingId);
    if (!holding) { setUpdatingNav(false); return; }

    const updatedMetadata = {
      ...holding.metadata,
      current_nav: newNav,
      nav_updated_at: new Date().toISOString(),
    };

    const { error: updateErr } = await supabase
      .from('holdings')
      .update({ metadata: updatedMetadata })
      .eq('id', holdingId);

    if (updateErr) {
      setToast({ type: 'error', message: 'Failed to update NAV' });
    } else {
      const currentValue = Number(holding.quantity) * newNav;
      const pnl = currentValue - holding.investedValue;
      const pnlPct = holding.investedValue > 0 ? (pnl / holding.investedValue) * 100 : 0;

      setHoldings(prev => prev.map(h =>
        h.id === holdingId
          ? { ...h, currentNav: newNav, currentValue, pnl, pnlPct, navStale: false, metadata: updatedMetadata }
          : h
      ));
      setToast({ type: 'success', message: 'NAV updated successfully' });
    }

    setEditNavId(null);
    setEditNavValue('');
    setUpdatingNav(false);
  }

  // ── Delete holding ─────────────────────────────────────────────────────────

  async function handleDelete(holdingId: string) {
    if (!confirm('Are you sure you want to delete this SIF holding?')) return;

    const { error: delErr } = await supabase.from('holdings').delete().eq('id', holdingId);
    if (delErr) {
      setToast({ type: 'error', message: 'Failed to delete holding' });
    } else {
      setHoldings(prev => prev.filter(h => h.id !== holdingId));
      setToast({ type: 'success', message: 'Holding deleted' });
      setDetailId(null);
    }
  }

  // ── Filter by selected members ─────────────────────────────────────────────

  const filteredHoldings = activeMemberIds.length > 0
    ? holdings.filter(h => {
        const ownerId = h.portfolios?.user_id ?? '';
        return activeMemberIds.includes(ownerId);
      })
    : holdings;

  // ── Summary calculations ───────────────────────────────────────────────────

  const totalInvested = filteredHoldings.reduce((s, h) => s + h.investedValue, 0);
  const totalCurrentValue = filteredHoldings.reduce((s, h) => s + h.currentValue, 0);
  const totalPnl = totalCurrentValue - totalInvested;
  const totalPnlPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;
  const staleCount = filteredHoldings.filter(h => h.navStale).length;

  // ── Detail sheet holding ───────────────────────────────────────────────────

  const detailHolding = detailId ? holdings.find(h => h.id === detailId) ?? null : null;

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: 'var(--wv-surface-2)' }}>
            <Shield className="w-5 h-5" style={{ color: 'var(--wv-text)' }} />
          </div>
          <div>
            <h1 className="font-display text-xl font-semibold" style={{ color: 'var(--wv-text)' }}>
              SIF Portfolio
            </h1>
            <p className="text-xs" style={{ color: 'var(--wv-text-muted)' }}>
              Specialized Investment Funds
            </p>
          </div>
        </div>
        <Button
          onClick={() => router.push('/add-assets/sif')}
          className="text-white text-xs h-9 gap-1.5"
          style={{ backgroundColor: '#1B2A4A' }}
        >
          <PlusCircle className="w-3.5 h-3.5" />
          Add SIF
        </Button>
      </div>

      {toast && <ToastBanner toast={toast} onClose={() => setToast(null)} />}

      {/* Family / Member Selector */}
      <FamilyMemberSelector
        onSelectionChange={(memberIds) => setActiveMemberIds(memberIds)}
      />

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--wv-text)' }} />
          <span className="ml-2 text-sm" style={{ color: 'var(--wv-text-secondary)' }}>Loading SIF holdings...</span>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl mb-4 text-sm"
          style={{ backgroundColor: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)', color: '#DC2626' }}>
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
          <button onClick={loadHoldings} className="ml-auto underline text-xs">Retry</button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && filteredHoldings.length === 0 && (
        <div className="wv-card p-12 text-center">
          <Shield className="w-12 h-12 mx-auto mb-4" style={{ color: '#C9A84C' }} />
          <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--wv-text)' }}>
            No SIF Holdings Yet
          </h3>
          <p className="text-sm mb-6" style={{ color: 'var(--wv-text-muted)' }}>
            Add your first Specialized Investment Fund holding to start tracking.
          </p>
          <Button
            onClick={() => router.push('/add-assets/sif')}
            className="text-white text-xs"
            style={{ backgroundColor: '#1B2A4A' }}
          >
            <PlusCircle className="w-3.5 h-3.5 mr-1.5" />Add SIF
          </Button>
        </div>
      )}

      {/* Holdings view */}
      {!loading && !error && filteredHoldings.length > 0 && (
        <>
          {/* Stale NAV warning */}
          {staleCount > 0 && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl mb-4 text-xs"
              style={{
                backgroundColor: 'rgba(201,168,76,0.1)',
                border: '1px solid rgba(201,168,76,0.3)',
                color: '#92620A',
              }}>
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{staleCount} fund{staleCount > 1 ? 's have' : ' has'} stale NAV. Click &quot;Update NAV&quot; to enter the latest value.</span>
            </div>
          )}

          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <SummaryCard label="Total Invested" value={formatLargeINR(totalInvested)} />
            <SummaryCard
              label="Current Value"
              value={formatLargeINR(totalCurrentValue)}
              subtext={staleCount > 0 ? 'Based on last known NAV' : undefined}
            />
            <SummaryCard
              label="P&L"
              value={`${totalPnl >= 0 ? '+' : ''}${formatLargeINR(totalPnl)}`}
              subtext={formatPercentage(totalPnlPct)}
              color={totalPnl >= 0 ? '#059669' : '#DC2626'}
            />
            <SummaryCard
              label="Number of Funds"
              value={String(filteredHoldings.length)}
            />
          </div>

          {/* Holdings Table */}
          <div className="wv-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr style={{ backgroundColor: 'var(--wv-surface-2)', borderBottom: '1px solid var(--wv-border)' }}>
                    {['Fund Name', 'AMC', 'Units', 'Avg NAV', 'Invested', 'Current NAV', 'Current Value', 'P&L', 'P&L%', 'Actions'].map(col => (
                      <th key={col} className="text-left px-4 py-3 text-[10px] uppercase tracking-wide font-semibold"
                        style={{ color: 'var(--wv-text-muted)' }}>
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredHoldings.map(h => (
                    <tr
                      key={h.id}
                      onClick={() => setDetailId(h.id)}
                      className="cursor-pointer transition-colors hover:bg-gray-50"
                      style={{ borderBottom: '1px solid var(--wv-border)' }}
                    >
                      <td className="px-4 py-3">
                        <p className="text-xs font-semibold" style={{ color: 'var(--wv-text)' }}>{h.name}</p>
                        {h.memberName && (
                          <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>{h.memberName}</p>
                        )}
                        {h.navStale && (
                          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
                            style={{ backgroundColor: 'rgba(201,168,76,0.15)', color: '#92620A' }}>
                            NAV stale
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--wv-text-secondary)' }}>{h.amc || '—'}</td>
                      <td className="px-4 py-3 text-xs font-medium" style={{ color: 'var(--wv-text)' }}>
                        {h.quantity.toLocaleString('en-IN', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--wv-text-secondary)' }}>
                        {'\u20B9'}{h.avg_buy_price.toFixed(4)}
                      </td>
                      <td className="px-4 py-3 text-xs font-medium" style={{ color: 'var(--wv-text)' }}>
                        {formatLargeINR(h.investedValue)}
                      </td>
                      <td className="px-4 py-3">
                        {editNavId === h.id ? (
                          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                            <Input
                              type="number"
                              value={editNavValue}
                              onChange={e => setEditNavValue(e.target.value)}
                              placeholder={h.currentNav.toFixed(4)}
                              step="0.0001"
                              className="h-7 text-xs w-24"
                              autoFocus
                              onKeyDown={e => {
                                if (e.key === 'Enter') handleNavUpdate(h.id);
                                if (e.key === 'Escape') { setEditNavId(null); setEditNavValue(''); }
                              }}
                            />
                            <button
                              onClick={() => handleNavUpdate(h.id)}
                              disabled={updatingNav}
                              className="p-1 rounded hover:bg-green-50"
                            >
                              {updatingNav
                                ? <Loader2 className="w-3 h-3 animate-spin" style={{ color: '#059669' }} />
                                : <Check className="w-3 h-3" style={{ color: '#059669' }} />}
                            </button>
                            <button
                              onClick={() => { setEditNavId(null); setEditNavValue(''); }}
                              className="p-1 rounded hover:bg-red-50"
                            >
                              <X className="w-3 h-3" style={{ color: '#DC2626' }} />
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>
                            {'\u20B9'}{h.currentNav.toFixed(4)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs font-medium" style={{ color: 'var(--wv-text)' }}>
                        {formatLargeINR(h.currentValue)}
                      </td>
                      <td className="px-4 py-3">
                        <PnlBadge value={h.pnl} pct={h.pnlPct} />
                      </td>
                      <td className="px-4 py-3 text-xs font-medium" style={{ color: h.pnlPct >= 0 ? '#059669' : '#DC2626' }}>
                        {formatPercentage(h.pnlPct)}
                      </td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => {
                              setEditNavId(h.id);
                              setEditNavValue(h.currentNav.toFixed(4));
                            }}
                            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                            title="Update NAV"
                          >
                            <RefreshCw className="w-3.5 h-3.5" style={{ color: '#C9A84C' }} />
                          </button>
                          <button
                            onClick={() => setDetailId(h.id)}
                            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                            title="View details"
                          >
                            <Pencil className="w-3.5 h-3.5" style={{ color: 'var(--wv-text-secondary)' }} />
                          </button>
                          <button
                            onClick={() => handleDelete(h.id)}
                            className="p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" style={{ color: '#DC2626' }} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── Detail Sheet ──────────────────────────────────────────────────────── */}
      <Sheet open={!!detailId} onOpenChange={(open) => { if (!open) setDetailId(null); }}>
        <SheetContent className="overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle style={{ color: 'var(--wv-text)' }}>
              {detailHolding?.name ?? 'Fund Details'}
            </SheetTitle>
            <SheetDescription>
              {detailHolding?.amc || 'SIF holding details and transaction history'}
            </SheetDescription>
          </SheetHeader>

          {detailHolding && (
            <div className="mt-6 space-y-6">
              {/* Fund Info */}
              <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--wv-surface-2)', border: '1px solid var(--wv-border)' }}>
                <p className="text-xs font-semibold mb-3" style={{ color: 'var(--wv-text)' }}>Fund Information</p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Fund Name', value: detailHolding.name },
                    { label: 'AMC', value: detailHolding.amc || '—' },
                    { label: 'Scheme Code', value: (detailHolding.metadata?.scheme_code as string) || detailHolding.symbol || '—' },
                    { label: 'Folio', value: (detailHolding.metadata?.folio as string) || '—' },
                    { label: 'Portfolio', value: detailHolding.portfolios?.name || '—' },
                    { label: 'Member', value: detailHolding.memberName || '—' },
                  ].map(item => (
                    <div key={item.label}>
                      <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>{item.label}</p>
                      <p className="text-xs font-medium" style={{ color: 'var(--wv-text)' }}>{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Performance */}
              <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--wv-surface-2)', border: '1px solid var(--wv-border)' }}>
                <p className="text-xs font-semibold mb-3" style={{ color: 'var(--wv-text)' }}>Performance</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Units</p>
                    <p className="text-xs font-medium" style={{ color: 'var(--wv-text)' }}>
                      {detailHolding.quantity.toLocaleString('en-IN', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Avg NAV</p>
                    <p className="text-xs font-medium" style={{ color: 'var(--wv-text)' }}>
                      {'\u20B9'}{detailHolding.avg_buy_price.toFixed(4)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Invested</p>
                    <p className="text-xs font-medium" style={{ color: 'var(--wv-text)' }}>
                      {formatLargeINR(detailHolding.investedValue)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Current NAV</p>
                    <p className="text-xs font-medium" style={{ color: 'var(--wv-text)' }}>
                      {'\u20B9'}{detailHolding.currentNav.toFixed(4)}
                      {detailHolding.navStale && (
                        <span className="ml-1 text-[9px] px-1 py-0.5 rounded-full"
                          style={{ backgroundColor: 'rgba(201,168,76,0.15)', color: '#92620A' }}>
                          stale
                        </span>
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Current Value</p>
                    <p className="text-xs font-medium" style={{ color: 'var(--wv-text)' }}>
                      {formatLargeINR(detailHolding.currentValue)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>P&L</p>
                    <p className="text-xs font-semibold" style={{ color: detailHolding.pnl >= 0 ? '#059669' : '#DC2626' }}>
                      {detailHolding.pnl >= 0 ? '+' : ''}{formatLargeINR(detailHolding.pnl)} ({formatPercentage(detailHolding.pnlPct)})
                    </p>
                  </div>
                </div>
              </div>

              {/* Update NAV in sheet */}
              <div className="rounded-xl p-4" style={{ border: '1px solid var(--wv-border)' }}>
                <p className="text-xs font-semibold mb-3" style={{ color: 'var(--wv-text)' }}>Update NAV</p>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <p className="text-[10px] mb-1" style={{ color: 'var(--wv-text-muted)' }}>Enter latest NAV</p>
                    <Input
                      type="number"
                      value={editNavId === detailHolding.id ? editNavValue : ''}
                      onChange={e => { setEditNavId(detailHolding.id); setEditNavValue(e.target.value); }}
                      placeholder={detailHolding.currentNav.toFixed(4)}
                      step="0.0001"
                      className="h-9 text-xs"
                      onFocus={() => {
                        if (editNavId !== detailHolding.id) {
                          setEditNavId(detailHolding.id);
                          setEditNavValue(detailHolding.currentNav.toFixed(4));
                        }
                      }}
                    />
                  </div>
                  <Button
                    onClick={() => handleNavUpdate(detailHolding.id)}
                    disabled={updatingNav || !editNavValue}
                    className="h-9 text-xs text-white"
                    style={{ backgroundColor: '#C9A84C' }}
                  >
                    {updatingNav ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Update'}
                  </Button>
                </div>
              </div>

              {/* Transaction History */}
              <div>
                <p className="text-xs font-semibold mb-3" style={{ color: 'var(--wv-text)' }}>Transaction History</p>
                {detailHolding.transactions.length === 0 ? (
                  <p className="text-xs py-4 text-center" style={{ color: 'var(--wv-text-muted)' }}>No transactions recorded</p>
                ) : (
                  <div className="space-y-2">
                    {detailHolding.transactions
                      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                      .map(txn => (
                        <div key={txn.id} className="flex items-center justify-between px-3 py-2.5 rounded-lg"
                          style={{ backgroundColor: 'var(--wv-surface-2)', border: '1px solid var(--wv-border)' }}>
                          <div>
                            <p className="text-xs font-medium" style={{ color: 'var(--wv-text)' }}>
                              {txn.type === 'buy' ? 'Purchase' : txn.type === 'sip' ? 'SIP' : txn.type}
                            </p>
                            <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>
                              {new Date(txn.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-medium" style={{ color: 'var(--wv-text)' }}>
                              {txn.quantity.toLocaleString('en-IN', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} units
                            </p>
                            <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>
                              @ {'\u20B9'}{txn.price.toFixed(4)}
                            </p>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              {/* Sheet Actions */}
              <div className="flex gap-2 pt-2">
                <Button
                  onClick={() => router.push(`/add-assets/sif?edit=${detailHolding.id}`)}
                  variant="outline"
                  className="flex-1 text-xs h-9"
                  style={{ borderColor: 'var(--wv-border)', color: 'var(--wv-text)' }}
                >
                  <Pencil className="w-3 h-3 mr-1.5" />Edit
                </Button>
                <Button
                  onClick={() => handleDelete(detailHolding.id)}
                  variant="outline"
                  className="flex-1 text-xs h-9"
                  style={{ borderColor: 'rgba(220,38,38,0.3)', color: '#DC2626' }}
                >
                  <Trash2 className="w-3 h-3 mr-1.5" />Delete
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
