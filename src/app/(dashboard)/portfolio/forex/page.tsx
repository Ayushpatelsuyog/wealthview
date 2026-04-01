'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  DollarSign, PlusCircle, Loader2, AlertCircle, TrendingUp, TrendingDown,
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

interface ForexRow {
  id: string;
  currencyPair: string;
  platform: string;
  amountForeign: number;
  exchangeRatePurchase: number;
  exchangeRateCurrent: number;
  inrValuePurchase: number;
  inrValueCurrent: number;
  pnl: number;
  pnlPercent: number;
  purchaseDate: string;
  purpose: string;
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
      <p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: '#9CA3AF' }}>{label}</p>
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

export default function ForexPortfolioPage() {
  const router = useRouter();
  const supabase = createClient();

  const [assets, setAssets] = useState<ForexRow[]>([]);
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

    // Try asset_type='forex' first
    const fxQuery = await supabase
      .from('manual_assets')
      .select('id, portfolio_id, asset_type, name, current_value, metadata, last_updated, portfolios(id, name, user_id, family_id)')
      .eq('asset_type', 'forex');

    let data = fxQuery.data;
    const dbErr = fxQuery.error;

    // Fallback: check metadata for forex assets
    if ((!data || data.length === 0) && !dbErr) {
      const { data: allAssets } = await supabase
        .from('manual_assets')
        .select('id, portfolio_id, asset_type, name, current_value, metadata, last_updated, portfolios(id, name, user_id, family_id)');
      if (allAssets) {
        data = allAssets.filter(a =>
          (a.metadata as Record<string, unknown>)?.currency_pair ||
          (a.metadata as Record<string, unknown>)?.exchange_rate_purchase
        );
      }
    }

    if (dbErr) { setError(dbErr.message); setLoading(false); return; }
    if (!data || data.length === 0) { setAssets([]); setLoading(false); return; }

    const rows: ForexRow[] = (data as unknown as ManualAsset[]).map(a => {
      const meta = a.metadata ?? {};
      const amountForeign = Number(meta.amount_foreign ?? 0);
      const exchangeRatePurchase = Number(meta.exchange_rate_purchase ?? 0);
      const exchangeRateCurrent = Number(meta.exchange_rate_current ?? 0);
      const inrValuePurchase = Number(meta.inr_value_purchase ?? amountForeign * exchangeRatePurchase);
      const inrValueCurrent = exchangeRateCurrent > 0
        ? Number(meta.inr_value_current ?? amountForeign * exchangeRateCurrent)
        : Number(a.current_value ?? inrValuePurchase);
      const pnl = inrValueCurrent - inrValuePurchase;
      const pnlPercent = inrValuePurchase > 0 ? (pnl / inrValuePurchase) * 100 : 0;
      const ownerId = a.portfolios?.user_id ?? '';

      return {
        id: a.id,
        currencyPair: String(meta.currency_pair ?? ''),
        platform: String(meta.platform ?? ''),
        amountForeign,
        exchangeRatePurchase,
        exchangeRateCurrent,
        inrValuePurchase,
        inrValueCurrent,
        pnl,
        pnlPercent,
        purchaseDate: String(meta.purchase_date ?? ''),
        purpose: String(meta.purpose ?? ''),
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
          asset_type: 'forex',
          name: asset.rawAsset.name,
          current_value: newValue,
          metadata: asset.rawAsset.metadata,
        }),
      });

      if (!res.ok) throw new Error('Update failed');

      const pnl = newValue - asset.inrValuePurchase;
      const pnlPercent = asset.inrValuePurchase > 0 ? (pnl / asset.inrValuePurchase) * 100 : 0;

      setAssets(prev => prev.map(a =>
        a.id === assetId
          ? { ...a, inrValueCurrent: newValue, pnl, pnlPercent, rawAsset: { ...a.rawAsset, current_value: newValue } }
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
    if (!confirm('Are you sure you want to delete this forex holding?')) return;

    const { error: delErr } = await supabase.from('manual_assets').delete().eq('id', assetId);
    if (delErr) {
      setToast({ type: 'error', message: 'Failed to delete holding' });
    } else {
      setAssets(prev => prev.filter(a => a.id !== assetId));
      setToast({ type: 'success', message: 'Forex holding deleted' });
      setDetailId(null);
    }
  }

  // ── Filtered data ──────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    if (activeMemberIds.length === 0) return assets;
    return assets.filter(a => activeMemberIds.includes(a.ownerId));
  }, [assets, activeMemberIds]);

  // ── Aggregates ─────────────────────────────────────────────────────────────────

  const totalInvested = useMemo(() => filtered.reduce((s, a) => s + a.inrValuePurchase, 0), [filtered]);
  const totalCurrentValue = useMemo(() => filtered.reduce((s, a) => s + a.inrValueCurrent, 0), [filtered]);
  const totalPnl = totalCurrentValue - totalInvested;
  const holdingCount = filtered.length;

  // ── Detail ─────────────────────────────────────────────────────────────────────

  const detailAsset = detailId ? assets.find(a => a.id === detailId) ?? null : null;

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: 'rgba(27,42,74,0.08)' }}>
            <DollarSign className="w-5 h-5" style={{ color: '#1B2A4A' }} />
          </div>
          <div>
            <h1 className="font-display text-xl font-semibold" style={{ color: '#1A1A2E' }}>
              Forex Portfolio
            </h1>
            <p className="text-xs" style={{ color: '#9CA3AF' }}>
              Foreign Currency Holdings
            </p>
          </div>
        </div>
        <Button
          onClick={() => router.push('/add-assets/forex')}
          className="text-white text-xs h-9 gap-1.5"
          style={{ backgroundColor: '#1B2A4A' }}
        >
          <PlusCircle className="w-3.5 h-3.5" />
          Add Forex
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
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#1B2A4A' }} />
          <span className="ml-2 text-sm" style={{ color: '#6B7280' }}>Loading forex holdings...</span>
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
          <DollarSign className="w-12 h-12 mx-auto mb-4" style={{ color: '#C9A84C' }} />
          <h3 className="text-lg font-semibold mb-2" style={{ color: '#1B2A4A' }}>
            No Forex Holdings Yet
          </h3>
          <p className="text-sm mb-6" style={{ color: '#9CA3AF' }}>
            Add your first foreign currency holding to start tracking.
          </p>
          <Button
            onClick={() => router.push('/add-assets/forex')}
            className="text-white text-xs"
            style={{ backgroundColor: '#1B2A4A' }}
          >
            <PlusCircle className="w-3.5 h-3.5 mr-1.5" />Add Forex
          </Button>
        </div>
      )}

      {/* Holdings view */}
      {!loading && !error && filtered.length > 0 && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <SummaryCard label="Total Invested (INR)" value={formatLargeINR(totalInvested)} />
            <SummaryCard label="Current Value (INR)" value={formatLargeINR(totalCurrentValue)} />
            <SummaryCard
              label="Total P&L"
              value={`${totalPnl >= 0 ? '+' : ''}${formatLargeINR(totalPnl)}`}
              color={totalPnl >= 0 ? '#059669' : '#DC2626'}
            />
            <SummaryCard label="Number of Holdings" value={String(holdingCount)} />
          </div>

          {/* Holdings Table */}
          <div className="wv-card overflow-hidden">
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr style={{ backgroundColor: '#F7F5F0', borderBottom: '1px solid #E8E5DD' }}>
                    {['Currency Pair', 'Platform', 'Foreign Amt', 'Buy Rate', 'Current Rate', 'INR Value', 'P&L', 'Actions'].map(col => (
                      <th key={col} className="text-left px-4 py-3 text-[10px] uppercase tracking-wide font-semibold"
                        style={{ color: '#9CA3AF' }}>
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
                      style={{ borderBottom: '1px solid #F3F4F6' }}
                    >
                      <td className="px-4 py-3">
                        <p className="text-xs font-semibold" style={{ color: '#1A1A2E' }}>{row.currencyPair}</p>
                        {row.memberName && <p className="text-[10px]" style={{ color: '#9CA3AF' }}>{row.memberName}</p>}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: '#4B5563' }}>{row.platform || '--'}</td>
                      <td className="px-4 py-3 text-xs font-medium tabular-nums" style={{ color: '#1A1A2E' }}>
                        {row.amountForeign.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3 text-xs tabular-nums" style={{ color: '#4B5563' }}>
                        {row.exchangeRatePurchase > 0 ? row.exchangeRatePurchase.toFixed(2) : '--'}
                      </td>
                      <td className="px-4 py-3 text-xs tabular-nums" style={{ color: '#4B5563' }}>
                        {row.exchangeRateCurrent > 0 ? row.exchangeRateCurrent.toFixed(2) : '--'}
                      </td>
                      <td className="px-4 py-3 text-xs font-medium tabular-nums" style={{ color: '#1A1A2E' }}>
                        {formatLargeINR(row.inrValueCurrent)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {row.pnl >= 0
                            ? <TrendingUp className="w-3 h-3" style={{ color: '#059669' }} />
                            : <TrendingDown className="w-3 h-3" style={{ color: '#DC2626' }} />}
                          <span className="text-xs font-semibold tabular-nums" style={{ color: row.pnl >= 0 ? '#059669' : '#DC2626' }}>
                            {row.pnl >= 0 ? '+' : ''}{formatLargeINR(row.pnl)}
                          </span>
                          <span className="text-[10px] tabular-nums" style={{ color: row.pnlPercent >= 0 ? '#059669' : '#DC2626' }}>
                            ({row.pnlPercent >= 0 ? '+' : ''}{row.pnlPercent.toFixed(2)}%)
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => {
                              setEditValueId(row.id);
                              setEditValueAmount(String(row.inrValueCurrent));
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
            <div className="md:hidden divide-y" style={{ borderColor: '#F3F4F6' }}>
              {filtered.map(row => (
                <div
                  key={row.id}
                  onClick={() => setDetailId(row.id)}
                  className="p-4 cursor-pointer transition-colors hover:bg-gray-50"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="text-sm font-semibold" style={{ color: '#1A1A2E' }}>{row.currencyPair}</p>
                      <p className="text-[10px]" style={{ color: '#9CA3AF' }}>
                        {row.platform} {row.memberName ? `· ${row.memberName}` : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-semibold tabular-nums" style={{ color: row.pnl >= 0 ? '#059669' : '#DC2626' }}>
                        {row.pnl >= 0 ? '+' : ''}{formatLargeINR(row.pnl)}
                      </p>
                      <p className="text-[10px]" style={{ color: row.pnlPercent >= 0 ? '#059669' : '#DC2626' }}>
                        {row.pnlPercent >= 0 ? '+' : ''}{row.pnlPercent.toFixed(2)}%
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-[10px] uppercase" style={{ color: '#9CA3AF' }}>Foreign Amount</p>
                      <p className="text-xs font-medium tabular-nums" style={{ color: '#1A1A2E' }}>
                        {row.amountForeign.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase" style={{ color: '#9CA3AF' }}>INR Value</p>
                      <p className="text-xs font-semibold tabular-nums" style={{ color: '#1B2A4A' }}>{formatLargeINR(row.inrValueCurrent)}</p>
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
          <div className="bg-white rounded-xl p-6 w-80 shadow-xl" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-semibold mb-3" style={{ color: '#1B2A4A' }}>Update Current Value (INR)</p>
            <Input
              type="number"
              value={editValueAmount}
              onChange={e => setEditValueAmount(e.target.value)}
              placeholder="Enter new INR value"
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
            <SheetTitle style={{ color: '#1B2A4A' }}>
              {detailAsset?.currencyPair ?? 'Forex Details'}
            </SheetTitle>
            <SheetDescription>
              {detailAsset?.platform || 'Forex holding details'}
            </SheetDescription>
          </SheetHeader>

          {detailAsset && (
            <div className="mt-6 space-y-6">
              {/* Forex Info */}
              <div className="rounded-xl p-4" style={{ backgroundColor: '#F7F5F0', border: '1px solid #E8E5DD' }}>
                <p className="text-xs font-semibold mb-3" style={{ color: '#1B2A4A' }}>Forex Details</p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Currency Pair', value: detailAsset.currencyPair },
                    { label: 'Platform', value: detailAsset.platform || '--' },
                    { label: 'Purpose', value: detailAsset.purpose || '--' },
                    { label: 'Purchase Date', value: formatDate(detailAsset.purchaseDate) },
                    { label: 'Member', value: detailAsset.memberName || '--' },
                  ].map(item => (
                    <div key={item.label}>
                      <p className="text-[10px] uppercase tracking-wide" style={{ color: '#9CA3AF' }}>{item.label}</p>
                      <p className="text-xs font-medium" style={{ color: '#1A1A2E' }}>{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Amounts */}
              <div className="rounded-xl p-4" style={{ backgroundColor: '#F7F5F0', border: '1px solid #E8E5DD' }}>
                <p className="text-xs font-semibold mb-3" style={{ color: '#1B2A4A' }}>Amounts</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide" style={{ color: '#9CA3AF' }}>Foreign Amount</p>
                    <p className="text-xs font-medium" style={{ color: '#1A1A2E' }}>
                      {detailAsset.amountForeign.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide" style={{ color: '#9CA3AF' }}>Buy Rate</p>
                    <p className="text-xs font-medium" style={{ color: '#1A1A2E' }}>
                      {detailAsset.exchangeRatePurchase > 0 ? detailAsset.exchangeRatePurchase.toFixed(4) : '--'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide" style={{ color: '#9CA3AF' }}>Current Rate</p>
                    <p className="text-xs font-medium" style={{ color: '#1A1A2E' }}>
                      {detailAsset.exchangeRateCurrent > 0 ? detailAsset.exchangeRateCurrent.toFixed(4) : '--'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide" style={{ color: '#9CA3AF' }}>INR Purchase Value</p>
                    <p className="text-xs font-medium" style={{ color: '#1A1A2E' }}>{formatLargeINR(detailAsset.inrValuePurchase)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide" style={{ color: '#9CA3AF' }}>INR Current Value</p>
                    <p className="text-xs font-medium" style={{ color: '#1A1A2E' }}>{formatLargeINR(detailAsset.inrValueCurrent)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide" style={{ color: '#9CA3AF' }}>P&amp;L</p>
                    <p className="text-xs font-semibold" style={{ color: detailAsset.pnl >= 0 ? '#059669' : '#DC2626' }}>
                      {detailAsset.pnl >= 0 ? '+' : ''}{formatLargeINR(detailAsset.pnl)} ({detailAsset.pnlPercent >= 0 ? '+' : ''}{detailAsset.pnlPercent.toFixed(2)}%)
                    </p>
                  </div>
                </div>
              </div>

              {/* Notes */}
              {detailAsset.notes && (
                <div className="rounded-xl p-4" style={{ border: '1px solid #E8E5DD' }}>
                  <p className="text-xs font-semibold mb-2" style={{ color: '#1B2A4A' }}>Notes</p>
                  <p className="text-xs" style={{ color: '#4B5563' }}>{detailAsset.notes}</p>
                </div>
              )}

              {/* Update Value */}
              <div className="rounded-xl p-4" style={{ border: '1px solid #E8E5DD' }}>
                <p className="text-xs font-semibold mb-3" style={{ color: '#1B2A4A' }}>Update Value</p>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <p className="text-[10px] mb-1" style={{ color: '#9CA3AF' }}>Enter latest INR value</p>
                    <Input
                      type="number"
                      value={editValueId === detailAsset.id ? editValueAmount : ''}
                      onChange={e => { setEditValueId(detailAsset.id); setEditValueAmount(e.target.value); }}
                      placeholder={String(detailAsset.inrValueCurrent)}
                      step="1"
                      className="h-9 text-xs"
                      onFocus={() => {
                        if (editValueId !== detailAsset.id) {
                          setEditValueId(detailAsset.id);
                          setEditValueAmount(String(detailAsset.inrValueCurrent));
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
                  onClick={() => router.push(`/add-assets/forex?edit=${detailAsset.id}`)}
                  variant="outline"
                  className="flex-1 text-xs h-9"
                  style={{ borderColor: '#E8E5DD', color: '#1B2A4A' }}
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
