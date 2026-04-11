'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Layers, PlusCircle, Loader2, AlertCircle, TrendingUp, TrendingDown,
  Pencil, Trash2, X, Check, RefreshCw,
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

interface ManualAsset {
  id: string;
  portfolio_id: string;
  asset_type: string;
  name: string;
  current_value: number;
  metadata: Record<string, unknown>;
  last_updated: string;
  portfolios: { id: string; name: string; user_id: string; family_id: string } | null;
}

interface PMSRow {
  id: string;
  provider: string;
  strategy: string;
  accountNumber: string;
  invested: number;
  currentValue: number;
  pnl: number;
  pnlPct: number;
  managementFee: number;
  performanceFee: number;
  hurdleRate: number;
  benchmark: string;
  investmentDate: string;
  notes: string;
  memberName: string;
  ownerId: string;
  rawAsset: ManualAsset;
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

function SummaryCard({
  label, value, color,
}: {
  label: string; value: string; color?: string;
}) {
  return (
    <div className="wv-card p-4">
      <p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--wv-text-muted)' }}>{label}</p>
      <p className="text-lg font-bold" style={{ color: color ?? '#1B2A4A' }}>{value}</p>
    </div>
  );
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '--';
  try {
    return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return '--';
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PMSPortfolioPage() {
  const router = useRouter();
  const supabase = createClient();

  const [assets, setAssets] = useState<PMSRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [activeMemberIds, setActiveMemberIds] = useState<string[]>([]);

  // Detail sheet
  const [detailId, setDetailId] = useState<string | null>(null);

  // Inline value update
  const [editValueId, setEditValueId] = useState<string | null>(null);
  const [editValueAmount, setEditValueAmount] = useState('');
  const [updatingValue, setUpdatingValue] = useState(false);

  // ── Load data ─────────────────────────────────────────────────────────────────

  const loadAssets = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/login'); return; }

    // Load member names
    const { data: usersData } = await supabase.from('users').select('id, name');
    const names: Record<string, string> = {};
    (usersData ?? []).forEach(u => { names[u.id] = u.name; });

    // Try asset_type='pms' first
    const pmsQuery = await supabase
      .from('manual_assets')
      .select('id, portfolio_id, asset_type, name, current_value, metadata, last_updated, portfolios(id, name, user_id, family_id)')
      .eq('asset_type', 'pms');

    let data = pmsQuery.data;
    const dbErr = pmsQuery.error;

    // Fallback: check metadata for pms assets
    if ((!data || data.length === 0) && !dbErr) {
      const { data: allAssets } = await supabase
        .from('manual_assets')
        .select('id, portfolio_id, asset_type, name, current_value, metadata, last_updated, portfolios(id, name, user_id, family_id)');
      if (allAssets) {
        data = allAssets.filter(a =>
          (a.metadata as Record<string, unknown>)?.provider_name ||
          (a.metadata as Record<string, unknown>)?.strategy_name
        );
      }
    }

    if (dbErr) { setError(dbErr.message); setLoading(false); return; }
    if (!data || data.length === 0) { setAssets([]); setLoading(false); return; }

    const rows: PMSRow[] = (data as unknown as ManualAsset[]).map(a => {
      const meta = a.metadata ?? {};
      const invested = Number(meta.investment_amount ?? 0);
      const currentValue = Number(a.current_value ?? 0);
      const pnl = currentValue - invested;
      const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;
      const ownerId = a.portfolios?.user_id ?? '';

      return {
        id: a.id,
        provider: String(meta.provider_name ?? ''),
        strategy: String(meta.strategy_name ?? ''),
        accountNumber: String(meta.account_number ?? ''),
        invested,
        currentValue,
        pnl,
        pnlPct,
        managementFee: Number(meta.management_fee ?? 0),
        performanceFee: Number(meta.performance_fee ?? 0),
        hurdleRate: Number(meta.hurdle_rate ?? 0),
        benchmark: String(meta.benchmark ?? ''),
        investmentDate: String(meta.investment_date ?? ''),
        notes: String(meta.notes ?? ''),
        memberName: names[ownerId] ?? '',
        ownerId,
        rawAsset: a,
      };
    });

    setAssets(rows);
    setLoading(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadAssets();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Update Value inline ────────────────────────────────────────────────────────

  async function handleValueUpdate(assetId: string) {
    const newValue = parseFloat(editValueAmount);
    if (!newValue || newValue <= 0) return;

    setUpdatingValue(true);

    const asset = assets.find(a => a.id === assetId);
    if (!asset) { setUpdatingValue(false); return; }

    try {
      const res = await fetch('/api/manual-assets/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: assetId,
          asset_type: 'pms',
          name: asset.rawAsset.name,
          current_value: newValue,
          metadata: asset.rawAsset.metadata,
        }),
      });

      if (!res.ok) throw new Error('Update failed');

      const pnl = newValue - asset.invested;
      const pnlPct = asset.invested > 0 ? (pnl / asset.invested) * 100 : 0;

      setAssets(prev => prev.map(a =>
        a.id === assetId
          ? { ...a, currentValue: newValue, pnl, pnlPct, rawAsset: { ...a.rawAsset, current_value: newValue } }
          : a
      ));
      setToast({ type: 'success', message: 'Value updated successfully' });
    } catch {
      setToast({ type: 'error', message: 'Failed to update value' });
    }

    setEditValueId(null);
    setEditValueAmount('');
    setUpdatingValue(false);
  }

  // ── Delete ─────────────────────────────────────────────────────────────────────

  async function handleDelete(assetId: string) {
    if (!confirm('Are you sure you want to delete this PMS holding?')) return;

    const { error: delErr } = await supabase.from('manual_assets').delete().eq('id', assetId);
    if (delErr) {
      setToast({ type: 'error', message: 'Failed to delete holding' });
    } else {
      setAssets(prev => prev.filter(a => a.id !== assetId));
      setToast({ type: 'success', message: 'PMS holding deleted' });
      setDetailId(null);
    }
  }

  // ── Filtered data ──────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    if (activeMemberIds.length === 0) return assets;
    return assets.filter(a => activeMemberIds.includes(a.ownerId));
  }, [assets, activeMemberIds]);

  // ── Aggregates ─────────────────────────────────────────────────────────────────

  const totalInvested = useMemo(() => filtered.reduce((s, a) => s + a.invested, 0), [filtered]);
  const totalCurrentValue = useMemo(() => filtered.reduce((s, a) => s + a.currentValue, 0), [filtered]);
  const totalPnl = totalCurrentValue - totalInvested;
  const strategyCount = filtered.length;

  // ── Detail ─────────────────────────────────────────────────────────────────────

  const detailAsset = detailId ? assets.find(a => a.id === detailId) ?? null : null;

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: 'var(--wv-surface-2)' }}>
            <Layers className="w-5 h-5" style={{ color: 'var(--wv-text)' }} />
          </div>
          <div>
            <h1 className="font-display text-xl font-semibold" style={{ color: 'var(--wv-text)' }}>
              PMS Portfolio
            </h1>
            <p className="text-xs" style={{ color: 'var(--wv-text-muted)' }}>
              Portfolio Management Services
            </p>
          </div>
        </div>
        <Button
          onClick={() => router.push('/add-assets/pms')}
          className="text-white text-xs h-9 gap-1.5"
          style={{ backgroundColor: '#1B2A4A' }}
        >
          <PlusCircle className="w-3.5 h-3.5" />
          Add PMS
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
          <span className="ml-2 text-sm" style={{ color: 'var(--wv-text-secondary)' }}>Loading PMS holdings...</span>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl mb-4 text-sm"
          style={{ backgroundColor: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)', color: '#DC2626' }}>
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
          <button onClick={loadAssets} className="ml-auto underline text-xs">Retry</button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && filtered.length === 0 && (
        <div className="wv-card p-12 text-center">
          <Layers className="w-12 h-12 mx-auto mb-4" style={{ color: '#C9A84C' }} />
          <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--wv-text)' }}>
            No PMS Holdings Yet
          </h3>
          <p className="text-sm mb-6" style={{ color: 'var(--wv-text-muted)' }}>
            Add your first Portfolio Management Service holding to start tracking.
          </p>
          <Button
            onClick={() => router.push('/add-assets/pms')}
            className="text-white text-xs"
            style={{ backgroundColor: '#1B2A4A' }}
          >
            <PlusCircle className="w-3.5 h-3.5 mr-1.5" />Add PMS
          </Button>
        </div>
      )}

      {/* Holdings view */}
      {!loading && !error && filtered.length > 0 && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <SummaryCard label="Total Invested" value={formatLargeINR(totalInvested)} />
            <SummaryCard label="Current Value" value={formatLargeINR(totalCurrentValue)} />
            <SummaryCard
              label="P&L"
              value={`${totalPnl >= 0 ? '+' : ''}${formatLargeINR(totalPnl)}`}
              color={totalPnl >= 0 ? '#059669' : '#DC2626'}
            />
            <SummaryCard label="Number of Strategies" value={String(strategyCount)} />
          </div>

          {/* Holdings Table */}
          <div className="wv-card overflow-hidden">
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr style={{ backgroundColor: 'var(--wv-surface-2)', borderBottom: '1px solid var(--wv-border)' }}>
                    {['Provider', 'Strategy', 'Invested', 'Current Value', 'P&L', 'P&L%', 'Mgmt Fee', 'Benchmark', 'Actions'].map(col => (
                      <th key={col} className="text-left px-4 py-3 text-[10px] uppercase tracking-wide font-semibold"
                        style={{ color: 'var(--wv-text-muted)' }}>
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(row => (
                    <tr
                      key={row.id}
                      onClick={() => setDetailId(row.id)}
                      className="cursor-pointer transition-colors hover:bg-gray-50"
                      style={{ borderBottom: '1px solid var(--wv-border)' }}
                    >
                      <td className="px-4 py-3">
                        <p className="text-xs font-semibold" style={{ color: 'var(--wv-text)' }}>{row.provider}</p>
                        {row.memberName && <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>{row.memberName}</p>}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--wv-text-secondary)' }}>{row.strategy}</td>
                      <td className="px-4 py-3 text-xs font-medium tabular-nums" style={{ color: 'var(--wv-text)' }}>
                        {formatLargeINR(row.invested)}
                      </td>
                      <td className="px-4 py-3 text-xs font-medium tabular-nums" style={{ color: 'var(--wv-text)' }}>
                        {formatLargeINR(row.currentValue)}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-xs font-semibold tabular-nums" style={{ color: row.pnl >= 0 ? '#059669' : '#DC2626' }}>
                          {row.pnl >= 0 ? '+' : ''}{formatLargeINR(row.pnl)}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {row.pnlPct >= 0
                            ? <TrendingUp className="w-3 h-3" style={{ color: '#059669' }} />
                            : <TrendingDown className="w-3 h-3" style={{ color: '#DC2626' }} />}
                          <span className="text-xs font-medium tabular-nums" style={{ color: row.pnlPct >= 0 ? '#059669' : '#DC2626' }}>
                            {formatPercentage(row.pnlPct)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs tabular-nums" style={{ color: 'var(--wv-text-secondary)' }}>
                        {row.managementFee > 0 ? `${row.managementFee.toFixed(2)}%` : '--'}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--wv-text-secondary)' }}>{row.benchmark || '--'}</td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => {
                              setEditValueId(row.id);
                              setEditValueAmount(String(row.currentValue));
                            }}
                            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                            title="Update Value"
                          >
                            <RefreshCw className="w-3.5 h-3.5" style={{ color: '#C9A84C' }} />
                          </button>
                          <button
                            onClick={() => handleDelete(row.id)}
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

            {/* Total footer */}
            {filtered.length > 0 && (() => {
              const totalGainLossPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;
              return (
                <div className="hidden md:flex px-5 py-3 items-center justify-between" style={{ borderTop: '2px solid var(--wv-border)', backgroundColor: 'var(--wv-surface-2)' }}>
                  <span className="text-xs font-semibold" style={{ color: 'var(--wv-text)' }}>{filtered.length} holding{filtered.length === 1 ? '' : 's'} · Total</span>
                  <div className="flex items-center gap-6 text-xs">
                    <span style={{ color: 'var(--wv-text-secondary)' }}>Invested: <strong style={{ color: 'var(--wv-text)' }}>{formatLargeINR(totalInvested)}</strong></span>
                    <span style={{ color: 'var(--wv-text-secondary)' }}>Current: <strong style={{ color: 'var(--wv-text)' }}>{formatLargeINR(totalCurrentValue)}</strong></span>
                    <span style={{ color: totalPnl >= 0 ? '#059669' : '#DC2626' }}>P&L: <strong>{totalPnl >= 0 ? '+' : ''}{formatLargeINR(totalPnl)} ({totalGainLossPct >= 0 ? '+' : ''}{totalGainLossPct.toFixed(2)}%)</strong></span>
                  </div>
                </div>
              );
            })()}

            {/* Mobile card layout */}
            <div className="md:hidden divide-y" style={{ borderColor: 'var(--wv-border)' }}>
              {filtered.map(row => (
                <div
                  key={row.id}
                  onClick={() => setDetailId(row.id)}
                  className="p-4 cursor-pointer transition-colors hover:bg-gray-50"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="text-sm font-semibold" style={{ color: 'var(--wv-text)' }}>{row.provider}</p>
                      <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>
                        {row.strategy} {row.memberName ? `· ${row.memberName}` : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-semibold tabular-nums" style={{ color: row.pnl >= 0 ? '#059669' : '#DC2626' }}>
                        {row.pnl >= 0 ? '+' : ''}{formatLargeINR(row.pnl)}
                      </p>
                      <p className="text-[10px]" style={{ color: row.pnlPct >= 0 ? '#059669' : '#DC2626' }}>
                        {formatPercentage(row.pnlPct)}
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-[10px] uppercase" style={{ color: 'var(--wv-text-muted)' }}>Invested</p>
                      <p className="text-xs font-medium tabular-nums" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(row.invested)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase" style={{ color: 'var(--wv-text-muted)' }}>Current Value</p>
                      <p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(row.currentValue)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── Inline Value Update Modal ──────────────────────────────────────────── */}
      {editValueId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => { setEditValueId(null); setEditValueAmount(''); }}>
          <div className="rounded-xl p-6 w-80 shadow-xl" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-semibold mb-3" style={{ color: 'var(--wv-text)' }}>Update Current Value</p>
            <Input
              type="number"
              value={editValueAmount}
              onChange={e => setEditValueAmount(e.target.value)}
              placeholder="Enter new value"
              step="1"
              min="0"
              className="h-9 text-xs mb-3"
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') handleValueUpdate(editValueId);
                if (e.key === 'Escape') { setEditValueId(null); setEditValueAmount(''); }
              }}
            />
            <div className="flex gap-2">
              <Button
                onClick={() => handleValueUpdate(editValueId)}
                disabled={updatingValue}
                className="flex-1 h-9 text-xs text-white"
                style={{ backgroundColor: '#1B2A4A' }}
              >
                {updatingValue ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Update'}
              </Button>
              <Button
                onClick={() => { setEditValueId(null); setEditValueAmount(''); }}
                variant="outline"
                className="flex-1 h-9 text-xs"
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Detail Sheet ──────────────────────────────────────────────────────── */}
      <Sheet open={!!detailId} onOpenChange={(open) => { if (!open) setDetailId(null); }}>
        <SheetContent className="overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle style={{ color: 'var(--wv-text)' }}>
              {detailAsset?.provider ?? 'PMS Details'}
            </SheetTitle>
            <SheetDescription>
              {detailAsset?.strategy || 'PMS holding details'}
            </SheetDescription>
          </SheetHeader>

          {detailAsset && (
            <div className="mt-6 space-y-6">
              {/* PMS Info */}
              <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--wv-surface-2)', border: '1px solid var(--wv-border)' }}>
                <p className="text-xs font-semibold mb-3" style={{ color: 'var(--wv-text)' }}>PMS Information</p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Provider', value: detailAsset.provider },
                    { label: 'Strategy', value: detailAsset.strategy },
                    { label: 'Account No.', value: detailAsset.accountNumber || '--' },
                    { label: 'Investment Date', value: formatDate(detailAsset.investmentDate) },
                    { label: 'Benchmark', value: detailAsset.benchmark || '--' },
                    { label: 'Member', value: detailAsset.memberName || '--' },
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
                    <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Invested</p>
                    <p className="text-xs font-medium" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(detailAsset.invested)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Current Value</p>
                    <p className="text-xs font-medium" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(detailAsset.currentValue)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>P&amp;L</p>
                    <p className="text-xs font-semibold" style={{ color: detailAsset.pnl >= 0 ? '#059669' : '#DC2626' }}>
                      {detailAsset.pnl >= 0 ? '+' : ''}{formatLargeINR(detailAsset.pnl)} ({formatPercentage(detailAsset.pnlPct)})
                    </p>
                  </div>
                </div>
              </div>

              {/* Fee Structure */}
              <div className="rounded-xl p-4" style={{ border: '1px solid var(--wv-border)' }}>
                <p className="text-xs font-semibold mb-3" style={{ color: 'var(--wv-text)' }}>Fee Structure</p>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Management Fee</span>
                    <span className="text-xs font-medium" style={{ color: 'var(--wv-text)' }}>
                      {detailAsset.managementFee > 0 ? `${detailAsset.managementFee.toFixed(2)}%` : '--'}
                    </span>
                  </div>
                  <div className="flex justify-between" style={{ borderTop: '1px solid var(--wv-border)', paddingTop: 8 }}>
                    <span className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Performance Fee</span>
                    <span className="text-xs font-medium" style={{ color: 'var(--wv-text)' }}>
                      {detailAsset.performanceFee > 0 ? `${detailAsset.performanceFee.toFixed(2)}%` : '--'}
                    </span>
                  </div>
                  <div className="flex justify-between" style={{ borderTop: '1px solid var(--wv-border)', paddingTop: 8 }}>
                    <span className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Hurdle Rate</span>
                    <span className="text-xs font-medium" style={{ color: 'var(--wv-text)' }}>
                      {detailAsset.hurdleRate > 0 ? `${detailAsset.hurdleRate.toFixed(2)}%` : '--'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Notes */}
              {detailAsset.notes && (
                <div className="rounded-xl p-4" style={{ border: '1px solid var(--wv-border)' }}>
                  <p className="text-xs font-semibold mb-2" style={{ color: 'var(--wv-text)' }}>Notes</p>
                  <p className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>{detailAsset.notes}</p>
                </div>
              )}

              {/* Update Value */}
              <div className="rounded-xl p-4" style={{ border: '1px solid var(--wv-border)' }}>
                <p className="text-xs font-semibold mb-3" style={{ color: 'var(--wv-text)' }}>Update Value</p>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <p className="text-[10px] mb-1" style={{ color: 'var(--wv-text-muted)' }}>Enter latest value</p>
                    <Input
                      type="number"
                      value={editValueId === detailAsset.id ? editValueAmount : ''}
                      onChange={e => { setEditValueId(detailAsset.id); setEditValueAmount(e.target.value); }}
                      placeholder={String(detailAsset.currentValue)}
                      step="1"
                      className="h-9 text-xs"
                      onFocus={() => {
                        if (editValueId !== detailAsset.id) {
                          setEditValueId(detailAsset.id);
                          setEditValueAmount(String(detailAsset.currentValue));
                        }
                      }}
                    />
                  </div>
                  <Button
                    onClick={() => handleValueUpdate(detailAsset.id)}
                    disabled={updatingValue || !editValueAmount}
                    className="h-9 text-xs text-white"
                    style={{ backgroundColor: '#C9A84C' }}
                  >
                    {updatingValue ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Update'}
                  </Button>
                </div>
              </div>

              {/* Sheet Actions */}
              <div className="flex gap-2 pt-2">
                <Button
                  onClick={() => router.push(`/add-assets/pms?edit=${detailAsset.id}`)}
                  variant="outline"
                  className="flex-1 text-xs h-9"
                  style={{ borderColor: 'var(--wv-border)', color: 'var(--wv-text)' }}
                >
                  <Pencil className="w-3 h-3 mr-1.5" />Edit
                </Button>
                <Button
                  onClick={() => handleDelete(detailAsset.id)}
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
