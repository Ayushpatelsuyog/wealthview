'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building, PlusCircle, Loader2, AlertCircle,
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

interface RealEstateRow {
  id: string;
  propertyName: string;
  propertyType: string;
  city: string;
  state: string;
  address: string;
  purchasePrice: number;
  currentValue: number;
  totalCost: number;
  appreciation: number;
  appreciationPercent: number;
  ownership: string;
  carpetArea: number;
  superBuiltUpArea: number;
  purchaseDate: string;
  hasLoan: boolean;
  loanOutstanding: number;
  loanBank: string;
  loanRate: number;
  emi: number;
  hasRental: boolean;
  monthlyRent: number;
  rentalYield: number;
  tenantName: string;
  netEquity: number;
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

export default function RealEstatePortfolioPage() {
  const router = useRouter();
  const supabase = createClient();

  const [assets, setAssets] = useState<RealEstateRow[]>([]);
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

    // Try asset_type='real_estate' first
    const reQuery = await supabase
      .from('manual_assets')
      .select('id, portfolio_id, asset_type, name, current_value, metadata, last_updated, portfolios(id, name, user_id, family_id)')
      .eq('asset_type', 'real_estate');

    let data = reQuery.data;
    const dbErr = reQuery.error;

    // Fallback: check metadata for real_estate assets
    if ((!data || data.length === 0) && !dbErr) {
      const { data: allAssets } = await supabase
        .from('manual_assets')
        .select('id, portfolio_id, asset_type, name, current_value, metadata, last_updated, portfolios(id, name, user_id, family_id)');
      if (allAssets) {
        data = allAssets.filter(a =>
          (a.metadata as Record<string, unknown>)?.property_type ||
          (a.metadata as Record<string, unknown>)?.property_name
        );
      }
    }

    if (dbErr) { setError(dbErr.message); setLoading(false); return; }
    if (!data || data.length === 0) { setAssets([]); setLoading(false); return; }

    const rows: RealEstateRow[] = (data as unknown as ManualAsset[]).map(a => {
      const meta = a.metadata ?? {};
      const addr = (meta.address as Record<string, unknown>) ?? {};
      const loan = (meta.loan as Record<string, unknown>) ?? {};
      const rental = (meta.rental as Record<string, unknown>) ?? {};

      const purchasePrice = Number(meta.purchase_price ?? 0);
      const currentValue = Number(a.current_value ?? 0);
      const totalCost = Number(meta.total_cost ?? purchasePrice);
      const appreciation = Number(meta.appreciation ?? (currentValue - totalCost));
      const appreciationPercent = Number(meta.appreciation_percent ?? (totalCost > 0 ? ((currentValue - totalCost) / totalCost) * 100 : 0));
      const loanOutstanding = Number(loan.outstanding_balance ?? 0);
      const monthlyRent = Number(rental.monthly_rent ?? 0);
      const rentalYield = Number(rental.rental_yield ?? (currentValue > 0 && monthlyRent > 0 ? ((monthlyRent * 12) / currentValue) * 100 : 0));
      const netEquity = Number(meta.net_equity ?? (currentValue - loanOutstanding));
      const ownerId = a.portfolios?.user_id ?? '';

      const streetStr = String(addr.street ?? '');
      const cityStr = String(addr.city ?? '');
      const stateStr = String(addr.state ?? '');
      const pinStr = String(addr.pin ?? '');
      const addressParts = [streetStr, cityStr, stateStr, pinStr].filter(Boolean);

      return {
        id: a.id,
        propertyName: String(meta.property_name ?? a.name ?? ''),
        propertyType: String(meta.property_type ?? ''),
        city: cityStr,
        state: stateStr,
        address: addressParts.join(', '),
        purchasePrice,
        currentValue,
        totalCost,
        appreciation,
        appreciationPercent,
        ownership: String(meta.ownership ?? 'Self'),
        carpetArea: Number(meta.carpet_area ?? 0),
        superBuiltUpArea: Number(meta.super_built_up_area ?? 0),
        purchaseDate: String(meta.purchase_date ?? ''),
        hasLoan: Object.keys(loan).length > 0 && loanOutstanding > 0,
        loanOutstanding,
        loanBank: String(loan.bank ?? ''),
        loanRate: Number(loan.interest_rate ?? 0),
        emi: Number(loan.emi ?? 0),
        hasRental: Object.keys(rental).length > 0 && monthlyRent > 0,
        monthlyRent,
        rentalYield,
        tenantName: String(rental.tenant_name ?? ''),
        netEquity,
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
      const updatedMeta = {
        ...asset.rawAsset.metadata,
        current_value: newValue,
        appreciation: Math.round((newValue - asset.totalCost) * 100) / 100,
        appreciation_percent: asset.totalCost > 0 ? Math.round(((newValue - asset.totalCost) / asset.totalCost) * 10000) / 100 : 0,
        net_equity: newValue - asset.loanOutstanding,
      };

      const res = await fetch('/api/manual-assets/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: assetId,
          asset_type: 'real_estate',
          name: asset.rawAsset.name,
          current_value: newValue,
          metadata: updatedMeta,
        }),
      });

      if (!res.ok) throw new Error('Update failed');

      const newAppreciation = newValue - asset.totalCost;
      const newAppreciationPercent = asset.totalCost > 0 ? (newAppreciation / asset.totalCost) * 100 : 0;
      const newNetEquity = newValue - asset.loanOutstanding;

      setAssets(prev => prev.map(a =>
        a.id === assetId
          ? {
              ...a,
              currentValue: newValue,
              appreciation: newAppreciation,
              appreciationPercent: newAppreciationPercent,
              netEquity: newNetEquity,
              rawAsset: { ...a.rawAsset, current_value: newValue, metadata: updatedMeta },
            }
          : a
      ));
      setToast({ type: 'success', message: 'Property value updated successfully' });
    } catch {
      setToast({ type: 'error', message: 'Failed to update property value' });
    }

    setEditValueId(null);
    setEditValueAmount('');
    setUpdatingValue(false);
  }

  // ── Delete ─────────────────────────────────────────────────────────────────────

  async function handleDelete(assetId: string) {
    if (!confirm('Are you sure you want to delete this property?')) return;

    const { error: delErr } = await supabase.from('manual_assets').delete().eq('id', assetId);
    if (delErr) {
      setToast({ type: 'error', message: 'Failed to delete property' });
    } else {
      setAssets(prev => prev.filter(a => a.id !== assetId));
      setToast({ type: 'success', message: 'Property deleted' });
      setDetailId(null);
    }
  }

  // ── Filtered data ──────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    if (activeMemberIds.length === 0) return assets;
    return assets.filter(a => activeMemberIds.includes(a.ownerId));
  }, [assets, activeMemberIds]);

  // ── Aggregates ─────────────────────────────────────────────────────────────────

  const totalProperties = filtered.length;
  const totalPortfolioValue = useMemo(() => filtered.reduce((s, a) => s + a.currentValue, 0), [filtered]);
  const totalAppreciation = useMemo(() => filtered.reduce((s, a) => s + a.appreciation, 0), [filtered]);
  const totalRentalIncome = useMemo(() => filtered.reduce((s, a) => s + a.monthlyRent, 0), [filtered]);

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
            <Building className="w-5 h-5" style={{ color: '#1B2A4A' }} />
          </div>
          <div>
            <h1 className="font-display text-xl font-semibold" style={{ color: '#1A1A2E' }}>
              Real Estate Portfolio
            </h1>
            <p className="text-xs" style={{ color: '#9CA3AF' }}>
              Track your properties and real estate investments
            </p>
          </div>
        </div>
        <Button
          onClick={() => router.push('/add-assets/real-estate')}
          className="text-white text-xs h-9 gap-1.5"
          style={{ backgroundColor: '#1B2A4A' }}
        >
          <PlusCircle className="w-3.5 h-3.5" />
          Add Property
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
          <span className="ml-2 text-sm" style={{ color: '#6B7280' }}>Loading properties...</span>
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
          <Building className="w-12 h-12 mx-auto mb-4" style={{ color: '#C9A84C' }} />
          <h3 className="text-lg font-semibold mb-2" style={{ color: '#1B2A4A' }}>
            No Properties Yet
          </h3>
          <p className="text-sm mb-6" style={{ color: '#9CA3AF' }}>
            Add your first property to start tracking your real estate portfolio.
          </p>
          <Button
            onClick={() => router.push('/add-assets/real-estate')}
            className="text-white text-xs"
            style={{ backgroundColor: '#1B2A4A' }}
          >
            <PlusCircle className="w-3.5 h-3.5 mr-1.5" />Add Property
          </Button>
        </div>
      )}

      {/* Holdings view */}
      {!loading && !error && filtered.length > 0 && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <SummaryCard label="Total Properties" value={String(totalProperties)} />
            <SummaryCard label="Portfolio Value" value={formatLargeINR(totalPortfolioValue)} />
            <SummaryCard
              label="Total Appreciation"
              value={`${totalAppreciation >= 0 ? '+' : ''}${formatLargeINR(totalAppreciation)}`}
              color={totalAppreciation >= 0 ? '#059669' : '#DC2626'}
            />
            <SummaryCard
              label="Rental Income"
              value={totalRentalIncome > 0 ? `${formatLargeINR(totalRentalIncome)}/mo` : '--'}
            />
          </div>

          {/* Holdings Table */}
          <div className="wv-card overflow-hidden">
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr style={{ backgroundColor: '#F7F5F0', borderBottom: '1px solid #E8E5DD' }}>
                    {['Property', 'Type', 'City', 'Purchase Price', 'Current Value', 'Appreciation', 'Loan', 'Actions'].map(col => (
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
                        <p className="text-xs font-semibold" style={{ color: '#1A1A2E' }}>{row.propertyName}</p>
                        {row.memberName && <p className="text-[10px]" style={{ color: '#9CA3AF' }}>{row.memberName}</p>}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: '#4B5563' }}>{row.propertyType}</td>
                      <td className="px-4 py-3 text-xs" style={{ color: '#4B5563' }}>{row.city || '--'}</td>
                      <td className="px-4 py-3 text-xs font-medium tabular-nums" style={{ color: '#1A1A2E' }}>
                        {formatLargeINR(row.purchasePrice)}
                      </td>
                      <td className="px-4 py-3 text-xs font-medium tabular-nums" style={{ color: '#1A1A2E' }}>
                        {formatLargeINR(row.currentValue)}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-xs font-semibold tabular-nums" style={{ color: row.appreciation >= 0 ? '#059669' : '#DC2626' }}>
                          {row.appreciation >= 0 ? '+' : ''}{formatLargeINR(row.appreciation)}
                        </p>
                        <p className="text-[10px] tabular-nums" style={{ color: row.appreciationPercent >= 0 ? '#059669' : '#DC2626' }}>
                          {row.appreciationPercent >= 0 ? '+' : ''}{row.appreciationPercent.toFixed(2)}%
                        </p>
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: '#4B5563' }}>
                        {row.hasLoan ? formatLargeINR(row.loanOutstanding) : '--'}
                      </td>
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
            <div className="md:hidden divide-y" style={{ borderColor: '#F3F4F6' }}>
              {filtered.map(row => (
                <div
                  key={row.id}
                  onClick={() => setDetailId(row.id)}
                  className="p-4 cursor-pointer transition-colors hover:bg-gray-50"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="text-sm font-semibold" style={{ color: '#1A1A2E' }}>{row.propertyName}</p>
                      <p className="text-[10px]" style={{ color: '#9CA3AF' }}>
                        {row.propertyType} {row.city ? `· ${row.city}` : ''} {row.memberName ? `· ${row.memberName}` : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-semibold tabular-nums" style={{ color: row.appreciation >= 0 ? '#059669' : '#DC2626' }}>
                        {row.appreciation >= 0 ? '+' : ''}{formatLargeINR(row.appreciation)}
                      </p>
                      <p className="text-[10px]" style={{ color: row.appreciationPercent >= 0 ? '#059669' : '#DC2626' }}>
                        {row.appreciationPercent >= 0 ? '+' : ''}{row.appreciationPercent.toFixed(2)}%
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-[10px] uppercase" style={{ color: '#9CA3AF' }}>Purchase Price</p>
                      <p className="text-xs font-medium tabular-nums" style={{ color: '#1A1A2E' }}>{formatLargeINR(row.purchasePrice)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase" style={{ color: '#9CA3AF' }}>Current Value</p>
                      <p className="text-xs font-semibold tabular-nums" style={{ color: '#1B2A4A' }}>{formatLargeINR(row.currentValue)}</p>
                    </div>
                    {row.hasLoan && (
                      <div>
                        <p className="text-[10px] uppercase" style={{ color: '#9CA3AF' }}>Loan Outstanding</p>
                        <p className="text-xs font-medium tabular-nums" style={{ color: '#DC2626' }}>{formatLargeINR(row.loanOutstanding)}</p>
                      </div>
                    )}
                    {row.hasRental && (
                      <div>
                        <p className="text-[10px] uppercase" style={{ color: '#9CA3AF' }}>Rent/Month</p>
                        <p className="text-xs font-medium tabular-nums" style={{ color: '#059669' }}>{formatLargeINR(row.monthlyRent)}</p>
                      </div>
                    )}
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
            <p className="text-sm font-semibold mb-3" style={{ color: '#1B2A4A' }}>Update Property Value</p>
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
            <SheetTitle style={{ color: '#1B2A4A' }}>
              {detailAsset?.propertyName ?? 'Property Details'}
            </SheetTitle>
            <SheetDescription>
              {detailAsset?.propertyType ? `${detailAsset.propertyType} property` : 'Real estate holding details'}
            </SheetDescription>
          </SheetHeader>

          {detailAsset && (
            <div className="mt-6 space-y-6">
              {/* Property Information */}
              <div className="rounded-xl p-4" style={{ backgroundColor: '#F7F5F0', border: '1px solid #E8E5DD' }}>
                <p className="text-xs font-semibold mb-3" style={{ color: '#1B2A4A' }}>Property Information</p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Property Name', value: detailAsset.propertyName },
                    { label: 'Type', value: detailAsset.propertyType || '--' },
                    { label: 'City / State', value: [detailAsset.city, detailAsset.state].filter(Boolean).join(', ') || '--' },
                    { label: 'Address', value: detailAsset.address || '--' },
                    ...(detailAsset.carpetArea > 0 ? [{ label: 'Carpet Area', value: `${detailAsset.carpetArea} sq.ft` }] : []),
                    ...(detailAsset.superBuiltUpArea > 0 ? [{ label: 'Super Built-up Area', value: `${detailAsset.superBuiltUpArea} sq.ft` }] : []),
                    { label: 'Ownership', value: detailAsset.ownership },
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

              {/* Valuation */}
              <div className="rounded-xl p-4" style={{ backgroundColor: '#F7F5F0', border: '1px solid #E8E5DD' }}>
                <p className="text-xs font-semibold mb-3" style={{ color: '#1B2A4A' }}>Valuation</p>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-xs" style={{ color: '#4B5563' }}>Purchase Price</span>
                    <span className="text-xs font-medium tabular-nums" style={{ color: '#1A1A2E' }}>{formatLargeINR(detailAsset.purchasePrice)}</span>
                  </div>
                  {(() => {
                    const meta = detailAsset.rawAsset.metadata ?? {};
                    const regCharges = Number(meta.registration_charges ?? 0);
                    const stampDuty = Number(meta.stamp_duty ?? 0);
                    const items: { label: string; value: string }[] = [];
                    if (regCharges > 0) items.push({ label: 'Registration Charges', value: formatLargeINR(regCharges) });
                    if (stampDuty > 0) items.push({ label: 'Stamp Duty', value: formatLargeINR(stampDuty) });
                    return items.map(item => (
                      <div key={item.label} className="flex justify-between" style={{ borderTop: '1px solid #F3F4F6', paddingTop: 8 }}>
                        <span className="text-xs" style={{ color: '#4B5563' }}>{item.label}</span>
                        <span className="text-xs font-medium tabular-nums" style={{ color: '#1A1A2E' }}>{item.value}</span>
                      </div>
                    ));
                  })()}
                  <div className="flex justify-between" style={{ borderTop: '1px solid #F3F4F6', paddingTop: 8 }}>
                    <span className="text-xs" style={{ color: '#4B5563' }}>Total Cost</span>
                    <span className="text-xs font-medium tabular-nums" style={{ color: '#1A1A2E' }}>{formatLargeINR(detailAsset.totalCost)}</span>
                  </div>
                  <div className="flex justify-between" style={{ borderTop: '1px solid #F3F4F6', paddingTop: 8 }}>
                    <span className="text-xs" style={{ color: '#4B5563' }}>Current Value</span>
                    <span className="text-xs font-semibold tabular-nums" style={{ color: '#1B2A4A' }}>{formatLargeINR(detailAsset.currentValue)}</span>
                  </div>
                  <div className="flex justify-between" style={{ borderTop: '1px solid #E8E5DD', paddingTop: 8 }}>
                    <span className="text-xs font-semibold" style={{ color: detailAsset.appreciation >= 0 ? '#059669' : '#DC2626' }}>Appreciation</span>
                    <span className="text-xs font-bold tabular-nums" style={{ color: detailAsset.appreciation >= 0 ? '#059669' : '#DC2626' }}>
                      {detailAsset.appreciation >= 0 ? '+' : ''}{formatLargeINR(detailAsset.appreciation)} ({detailAsset.appreciationPercent >= 0 ? '+' : ''}{detailAsset.appreciationPercent.toFixed(2)}%)
                    </span>
                  </div>
                </div>
              </div>

              {/* Loan Details */}
              {detailAsset.hasLoan && (
                <div className="rounded-xl p-4" style={{ border: '1px solid #E8E5DD' }}>
                  <p className="text-xs font-semibold mb-3" style={{ color: '#1B2A4A' }}>Loan Details</p>
                  <div className="space-y-2">
                    {detailAsset.loanBank && (
                      <div className="flex justify-between">
                        <span className="text-xs" style={{ color: '#4B5563' }}>Bank / Lender</span>
                        <span className="text-xs font-medium" style={{ color: '#1A1A2E' }}>{detailAsset.loanBank}</span>
                      </div>
                    )}
                    {(() => {
                      const loanMeta = (detailAsset.rawAsset.metadata?.loan as Record<string, unknown>) ?? {};
                      const loanAmount = Number(loanMeta.amount ?? 0);
                      if (loanAmount <= 0) return null;
                      return (
                        <div className="flex justify-between" style={{ borderTop: '1px solid #F3F4F6', paddingTop: 8 }}>
                          <span className="text-xs" style={{ color: '#4B5563' }}>Loan Amount</span>
                          <span className="text-xs font-medium tabular-nums" style={{ color: '#1A1A2E' }}>{formatLargeINR(loanAmount)}</span>
                        </div>
                      );
                    })()}
                    {detailAsset.loanRate > 0 && (
                      <div className="flex justify-between" style={{ borderTop: '1px solid #F3F4F6', paddingTop: 8 }}>
                        <span className="text-xs" style={{ color: '#4B5563' }}>Interest Rate</span>
                        <span className="text-xs font-medium" style={{ color: '#1A1A2E' }}>{detailAsset.loanRate.toFixed(2)}%</span>
                      </div>
                    )}
                    {detailAsset.emi > 0 && (
                      <div className="flex justify-between" style={{ borderTop: '1px solid #F3F4F6', paddingTop: 8 }}>
                        <span className="text-xs" style={{ color: '#4B5563' }}>EMI</span>
                        <span className="text-xs font-medium tabular-nums" style={{ color: '#1A1A2E' }}>{formatLargeINR(detailAsset.emi)}/mo</span>
                      </div>
                    )}
                    <div className="flex justify-between" style={{ borderTop: '1px solid #F3F4F6', paddingTop: 8 }}>
                      <span className="text-xs" style={{ color: '#4B5563' }}>Outstanding Balance</span>
                      <span className="text-xs font-semibold tabular-nums" style={{ color: '#DC2626' }}>{formatLargeINR(detailAsset.loanOutstanding)}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Rental Details */}
              {detailAsset.hasRental && (
                <div className="rounded-xl p-4" style={{ border: '1px solid #E8E5DD' }}>
                  <p className="text-xs font-semibold mb-3" style={{ color: '#1B2A4A' }}>Rental Details</p>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-xs" style={{ color: '#4B5563' }}>Monthly Rent</span>
                      <span className="text-xs font-medium tabular-nums" style={{ color: '#059669' }}>{formatLargeINR(detailAsset.monthlyRent)}/mo</span>
                    </div>
                    {detailAsset.tenantName && (
                      <div className="flex justify-between" style={{ borderTop: '1px solid #F3F4F6', paddingTop: 8 }}>
                        <span className="text-xs" style={{ color: '#4B5563' }}>Tenant</span>
                        <span className="text-xs font-medium" style={{ color: '#1A1A2E' }}>{detailAsset.tenantName}</span>
                      </div>
                    )}
                    {detailAsset.rentalYield > 0 && (
                      <div className="flex justify-between" style={{ borderTop: '1px solid #F3F4F6', paddingTop: 8 }}>
                        <span className="text-xs" style={{ color: '#4B5563' }}>Rental Yield</span>
                        <span className="text-xs font-medium" style={{ color: '#059669' }}>{detailAsset.rentalYield.toFixed(2)}%</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

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
                    <p className="text-[10px] mb-1" style={{ color: '#9CA3AF' }}>Enter latest market value</p>
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
                  onClick={() => router.push(`/add-assets/real-estate?edit=${detailAsset.id}`)}
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
