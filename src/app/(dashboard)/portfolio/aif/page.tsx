'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2, PlusCircle, Loader2, AlertCircle, TrendingUp, TrendingDown,
  Pencil, Trash2, X, Check, RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR } from '@/lib/utils/formatters';
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

interface AIFRow {
  id: string;
  fundName: string;
  category: string;
  categoryLabel: string;
  fundManager: string;
  commitmentAmount: number;
  calledAmount: number;
  distributions: number;
  currentValue: number;
  uncalled: number;
  tvpi: number;
  dpi: number;
  rvpi: number;
  vintageYear: string;
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

export default function AIFPortfolioPage() {
  const router = useRouter();
  const supabase = createClient();

  const [assets, setAssets] = useState<AIFRow[]>([]);
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

    // Try asset_type='aif' first
    const aifQuery = await supabase
      .from('manual_assets')
      .select('id, portfolio_id, asset_type, name, current_value, metadata, last_updated, portfolios(id, name, user_id, family_id)')
      .eq('asset_type', 'aif');

    let data = aifQuery.data;
    const dbErr = aifQuery.error;

    // Fallback: check metadata for aif assets
    if ((!data || data.length === 0) && !dbErr) {
      const { data: allAssets } = await supabase
        .from('manual_assets')
        .select('id, portfolio_id, asset_type, name, current_value, metadata, last_updated, portfolios(id, name, user_id, family_id)');
      if (allAssets) {
        data = allAssets.filter(a =>
          (a.metadata as Record<string, unknown>)?.commitment_amount ||
          (a.metadata as Record<string, unknown>)?.fund_manager
        );
      }
    }

    if (dbErr) { setError(dbErr.message); setLoading(false); return; }
    if (!data || data.length === 0) { setAssets([]); setLoading(false); return; }

    const rows: AIFRow[] = (data as unknown as ManualAsset[]).map(a => {
      const meta = a.metadata ?? {};
      const commitmentAmount = Number(meta.commitment_amount ?? 0);
      const calledAmount = Number(meta.called_amount ?? 0);
      const distributions = Number(meta.distributions ?? 0);
      const currentValue = Number(a.current_value ?? 0);
      const uncalled = Number(meta.uncalled ?? Math.max(0, commitmentAmount - calledAmount));
      const tvpi = Number(meta.tvpi ?? (calledAmount > 0 ? (distributions + currentValue) / calledAmount : 0));
      const dpi = Number(meta.dpi ?? (calledAmount > 0 ? distributions / calledAmount : 0));
      const rvpi = Number(meta.rvpi ?? (calledAmount > 0 ? currentValue / calledAmount : 0));
      const ownerId = a.portfolios?.user_id ?? '';

      return {
        id: a.id,
        fundName: String(a.name ?? ''),
        category: String(meta.category ?? ''),
        categoryLabel: String(meta.category_label ?? ''),
        fundManager: String(meta.fund_manager ?? ''),
        commitmentAmount,
        calledAmount,
        distributions,
        currentValue,
        uncalled,
        tvpi,
        dpi,
        rvpi,
        vintageYear: String(meta.vintage_year ?? ''),
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
      // Recalculate metrics with new value
      const newTvpi = asset.calledAmount > 0 ? (asset.distributions + newValue) / asset.calledAmount : 0;
      const newRvpi = asset.calledAmount > 0 ? newValue / asset.calledAmount : 0;

      const updatedMetadata = {
        ...asset.rawAsset.metadata,
        tvpi: newTvpi,
        rvpi: newRvpi,
      };

      const res = await fetch('/api/manual-assets/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: assetId,
          asset_type: 'aif',
          name: asset.rawAsset.name,
          current_value: newValue,
          metadata: updatedMetadata,
        }),
      });

      if (!res.ok) throw new Error('Update failed');

      setAssets(prev => prev.map(a =>
        a.id === assetId
          ? { ...a, currentValue: newValue, tvpi: newTvpi, rvpi: newRvpi, rawAsset: { ...a.rawAsset, current_value: newValue, metadata: updatedMetadata } }
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
    if (!confirm('Are you sure you want to delete this AIF holding?')) return;

    const { error: delErr } = await supabase.from('manual_assets').delete().eq('id', assetId);
    if (delErr) {
      setToast({ type: 'error', message: 'Failed to delete holding' });
    } else {
      setAssets(prev => prev.filter(a => a.id !== assetId));
      setToast({ type: 'success', message: 'AIF holding deleted' });
      setDetailId(null);
    }
  }

  // ── Filtered data ──────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    if (activeMemberIds.length === 0) return assets;
    return assets.filter(a => activeMemberIds.includes(a.ownerId));
  }, [assets, activeMemberIds]);

  // ── Aggregates ─────────────────────────────────────────────────────────────────

  const totalCommitted = useMemo(() => filtered.reduce((s, a) => s + a.commitmentAmount, 0), [filtered]);
  const totalCalled = useMemo(() => filtered.reduce((s, a) => s + a.calledAmount, 0), [filtered]);
  const totalCurrentValue = useMemo(() => filtered.reduce((s, a) => s + a.currentValue, 0), [filtered]);
  const fundCount = filtered.length;

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
            <Building2 className="w-5 h-5" style={{ color: 'var(--wv-text)' }} />
          </div>
          <div>
            <h1 className="font-display text-xl font-semibold" style={{ color: 'var(--wv-text)' }}>
              AIF Portfolio
            </h1>
            <p className="text-xs" style={{ color: 'var(--wv-text-muted)' }}>
              Alternative Investment Funds
            </p>
          </div>
        </div>
        <Button
          onClick={() => router.push('/add-assets/aif')}
          className="text-white text-xs h-9 gap-1.5"
          style={{ backgroundColor: '#1B2A4A' }}
        >
          <PlusCircle className="w-3.5 h-3.5" />
          Add AIF
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
          <span className="ml-2 text-sm" style={{ color: 'var(--wv-text-secondary)' }}>Loading AIF holdings...</span>
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
          <Building2 className="w-12 h-12 mx-auto mb-4" style={{ color: '#C9A84C' }} />
          <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--wv-text)' }}>
            No AIF Holdings Yet
          </h3>
          <p className="text-sm mb-6" style={{ color: 'var(--wv-text-muted)' }}>
            Add your first Alternative Investment Fund holding to start tracking.
          </p>
          <Button
            onClick={() => router.push('/add-assets/aif')}
            className="text-white text-xs"
            style={{ backgroundColor: '#1B2A4A' }}
          >
            <PlusCircle className="w-3.5 h-3.5 mr-1.5" />Add AIF
          </Button>
        </div>
      )}

      {/* Holdings view */}
      {!loading && !error && filtered.length > 0 && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <SummaryCard label="Total Committed" value={formatLargeINR(totalCommitted)} />
            <SummaryCard label="Total Called" value={formatLargeINR(totalCalled)} />
            <SummaryCard label="Current Value" value={formatLargeINR(totalCurrentValue)} />
            <SummaryCard label="Number of Funds" value={String(fundCount)} />
          </div>

          {/* Holdings Table */}
          <div className="wv-card overflow-hidden">
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr style={{ backgroundColor: 'var(--wv-surface-2)', borderBottom: '1px solid var(--wv-border)' }}>
                    {['Fund Name', 'Category', 'Called', 'Current Value', 'TVPI', 'DPI', 'Vintage', 'Actions'].map(col => (
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
                        <p className="text-xs font-semibold" style={{ color: 'var(--wv-text)' }}>{row.fundName}</p>
                        {row.memberName && <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>{row.memberName}</p>}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--wv-text-secondary)' }}>{row.categoryLabel || row.category || '--'}</td>
                      <td className="px-4 py-3 text-xs font-medium tabular-nums" style={{ color: 'var(--wv-text)' }}>
                        {formatLargeINR(row.calledAmount)}
                      </td>
                      <td className="px-4 py-3 text-xs font-medium tabular-nums" style={{ color: 'var(--wv-text)' }}>
                        {formatLargeINR(row.currentValue)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {row.tvpi >= 1
                            ? <TrendingUp className="w-3 h-3" style={{ color: '#059669' }} />
                            : <TrendingDown className="w-3 h-3" style={{ color: '#DC2626' }} />}
                          <span className="text-xs font-medium tabular-nums" style={{ color: row.tvpi >= 1 ? '#059669' : '#DC2626' }}>
                            {row.tvpi.toFixed(2)}x
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs font-medium tabular-nums" style={{ color: 'var(--wv-text-secondary)' }}>
                        {row.dpi.toFixed(2)}x
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--wv-text-secondary)' }}>{row.vintageYear || '--'}</td>
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
                      <p className="text-sm font-semibold" style={{ color: 'var(--wv-text)' }}>{row.fundName}</p>
                      <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>
                        {row.categoryLabel || row.category || ''} {row.memberName ? `· ${row.memberName}` : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-semibold tabular-nums" style={{ color: row.tvpi >= 1 ? '#059669' : '#DC2626' }}>
                        {row.tvpi.toFixed(2)}x TVPI
                      </p>
                      <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>
                        {row.dpi.toFixed(2)}x DPI
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-[10px] uppercase" style={{ color: 'var(--wv-text-muted)' }}>Called</p>
                      <p className="text-xs font-medium tabular-nums" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(row.calledAmount)}</p>
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
              {detailAsset?.fundName ?? 'AIF Details'}
            </SheetTitle>
            <SheetDescription>
              {detailAsset?.categoryLabel || detailAsset?.category || 'AIF holding details'}
            </SheetDescription>
          </SheetHeader>

          {detailAsset && (
            <div className="mt-6 space-y-6">
              {/* Fund Information */}
              <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--wv-surface-2)', border: '1px solid var(--wv-border)' }}>
                <p className="text-xs font-semibold mb-3" style={{ color: 'var(--wv-text)' }}>Fund Information</p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Fund Name', value: detailAsset.fundName },
                    { label: 'Category', value: detailAsset.categoryLabel || detailAsset.category || '--' },
                    { label: 'Fund Manager', value: detailAsset.fundManager || '--' },
                    { label: 'Vintage Year', value: detailAsset.vintageYear || '--' },
                    { label: 'Investment Date', value: formatDate(detailAsset.investmentDate) },
                    { label: 'Member', value: detailAsset.memberName || '--' },
                  ].map(item => (
                    <div key={item.label}>
                      <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>{item.label}</p>
                      <p className="text-xs font-medium" style={{ color: 'var(--wv-text)' }}>{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Capital Account */}
              <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--wv-surface-2)', border: '1px solid var(--wv-border)' }}>
                <p className="text-xs font-semibold mb-3" style={{ color: 'var(--wv-text)' }}>Capital Account</p>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Commitment</span>
                    <span className="text-xs font-medium" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(detailAsset.commitmentAmount)}</span>
                  </div>
                  <div className="flex justify-between" style={{ borderTop: '1px solid var(--wv-border)', paddingTop: 8 }}>
                    <span className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Called</span>
                    <span className="text-xs font-medium" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(detailAsset.calledAmount)}</span>
                  </div>
                  <div className="flex justify-between" style={{ borderTop: '1px solid var(--wv-border)', paddingTop: 8 }}>
                    <span className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Uncalled</span>
                    <span className="text-xs font-medium" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(detailAsset.uncalled)}</span>
                  </div>
                  <div className="flex justify-between" style={{ borderTop: '1px solid var(--wv-border)', paddingTop: 8 }}>
                    <span className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Distributions</span>
                    <span className="text-xs font-medium" style={{ color: '#059669' }}>{formatLargeINR(detailAsset.distributions)}</span>
                  </div>
                  <div className="flex justify-between" style={{ borderTop: '1px solid var(--wv-border)', paddingTop: 8 }}>
                    <span className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Current Value</span>
                    <span className="text-xs font-semibold" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(detailAsset.currentValue)}</span>
                  </div>
                </div>
              </div>

              {/* Performance Metrics */}
              <div className="rounded-xl p-4" style={{ border: '1px solid var(--wv-border)' }}>
                <p className="text-xs font-semibold mb-3" style={{ color: 'var(--wv-text)' }}>Performance Metrics</p>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>TVPI (Total Value to Paid-In)</span>
                    <span className="text-xs font-semibold" style={{ color: detailAsset.tvpi >= 1 ? '#059669' : '#DC2626' }}>
                      {detailAsset.tvpi.toFixed(2)}x
                    </span>
                  </div>
                  <div className="flex justify-between" style={{ borderTop: '1px solid var(--wv-border)', paddingTop: 8 }}>
                    <span className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>DPI (Distributions to Paid-In)</span>
                    <span className="text-xs font-medium" style={{ color: 'var(--wv-text)' }}>
                      {detailAsset.dpi.toFixed(2)}x
                    </span>
                  </div>
                  <div className="flex justify-between" style={{ borderTop: '1px solid var(--wv-border)', paddingTop: 8 }}>
                    <span className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>RVPI (Residual Value to Paid-In)</span>
                    <span className="text-xs font-medium" style={{ color: 'var(--wv-text)' }}>
                      {detailAsset.rvpi.toFixed(2)}x
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
                    <p className="text-[10px] mb-1" style={{ color: 'var(--wv-text-muted)' }}>Enter latest NAV/valuation</p>
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
                  onClick={() => router.push(`/add-assets/aif?edit=${detailAsset.id}`)}
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
