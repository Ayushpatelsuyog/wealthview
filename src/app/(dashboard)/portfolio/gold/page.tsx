'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Gem, PlusCircle, Loader2, Trash2, Pencil, RefreshCw } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR } from '@/lib/utils/formatters';
import { FamilyMemberSelector } from '@/components/shared/FamilyMemberSelector';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawGold {
  id: string;
  name: string;
  current_value: number;
  metadata: Record<string, unknown>;
  last_updated: string;
  portfolio_id: string;
  portfolios: { id: string; name: string; user_id: string; family_id: string } | null;
}

interface GoldRow extends RawGold {
  description: string;
  goldType: string;
  purity: number;
  purityLabel: string;
  weightGrams: number;
  totalCost: number;
  currentValue: number;
  pnl: number;
  pnlPercent: number;
  makingCharges: number;
  platform: string;
  purchaseDate: string;
  memberName: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  if (!dateStr) return '--';
  try {
    return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return '--';
  }
}

function formatINRFull(amount: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
}

// ─── Page Component ───────────────────────────────────────────────────────────

export default function GoldPortfolioPage() {
  const router = useRouter();
  const supabase = createClient();

  const [holdings, setHoldings] = useState<GoldRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeMemberIds, setActiveMemberIds] = useState<string[]>([]);
  const [selectedHolding, setSelectedHolding] = useState<GoldRow | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Update gold price state
  const [showPriceUpdate, setShowPriceUpdate] = useState(false);
  const [newGoldPrice, setNewGoldPrice] = useState('');
  const [updatingPrice, setUpdatingPrice] = useState(false);

  // ── Data fetch ──────────────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data } = await supabase
          .from('manual_assets')
          .select('id, name, current_value, metadata, last_updated, portfolio_id, portfolios(id, name, user_id, family_id)')
          .eq('asset_type', 'gold');

        if (!data || data.length === 0) {
          setHoldings([]);
          setLoading(false);
          return;
        }

        // Resolve member names
        const userIds = Array.from(new Set((data as unknown as RawGold[]).map(d => d.portfolios?.user_id).filter(Boolean) as string[]));
        let nameMap: Record<string, string> = {};
        if (userIds.length > 0) {
          const { data: users } = await supabase.from('users').select('id, name').in('id', userIds);
          if (users) nameMap = Object.fromEntries(users.map(u => [u.id, u.name || u.id.slice(0, 8)]));
        }

        const rows: GoldRow[] = (data as unknown as RawGold[]).map((item) => {
          const meta = item.metadata ?? {};
          const weightGrams = Number(meta.weight_grams ?? 0);
          const totalCost = Number(meta.total_cost ?? meta.total_purchase_cost ?? item.current_value ?? 0);
          const purity = Number(meta.purity ?? 999);
          const currentGoldPrice = Number(meta.current_gold_price ?? 0);
          const currentValue = currentGoldPrice > 0 ? weightGrams * currentGoldPrice * (purity / 999) : totalCost;
          const pnl = currentValue - totalCost;
          const pnlPercent = totalCost > 0 ? (pnl / totalCost) * 100 : 0;

          return {
            ...item,
            description: String(meta.description ?? item.name ?? ''),
            goldType: String(meta.gold_type ?? 'Physical Gold'),
            purity,
            purityLabel: String(meta.purity_label ?? `${purity}`),
            weightGrams,
            totalCost,
            currentValue,
            pnl,
            pnlPercent,
            makingCharges: Number(meta.making_charges ?? 0),
            platform: String(meta.platform ?? ''),
            purchaseDate: String(meta.purchase_date ?? ''),
            memberName: nameMap[item.portfolios?.user_id ?? ''] ?? '',
          };
        });

        setHoldings(rows);
      } catch (err) {
        console.error('Failed to load gold holdings:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Filtered data ───────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    if (activeMemberIds.length === 0) return holdings;
    return holdings.filter(h => activeMemberIds.includes(h.portfolios?.user_id ?? ''));
  }, [holdings, activeMemberIds]);

  // ── Aggregates ──────────────────────────────────────────────────────────────

  const totalWeight = useMemo(() => filtered.reduce((s, h) => s + h.weightGrams, 0), [filtered]);
  const totalInvested = useMemo(() => filtered.reduce((s, h) => s + h.totalCost, 0), [filtered]);
  const totalCurrentValue = useMemo(() => filtered.reduce((s, h) => s + h.currentValue, 0), [filtered]);
  const totalPnl = useMemo(() => totalCurrentValue - totalInvested, [totalCurrentValue, totalInvested]);

  // ── Update Gold Price ───────────────────────────────────────────────────────

  async function handleUpdateGoldPrice() {
    const price = parseFloat(newGoldPrice);
    if (!price || price <= 0) return;
    setUpdatingPrice(true);
    try {
      // Update each holding's metadata and current_value with new gold price
      const updated = holdings.map(h => {
        const purity = h.purity || 999;
        const newCurrentValue = h.weightGrams * price * (purity / 999);
        return { ...h, currentValue: newCurrentValue, pnl: newCurrentValue - h.totalCost, pnlPercent: h.totalCost > 0 ? ((newCurrentValue - h.totalCost) / h.totalCost) * 100 : 0 };
      });

      // Persist to DB
      for (const h of holdings) {
        const purity = h.purity || 999;
        const newVal = h.weightGrams * price * (purity / 999);
        const updatedMeta = { ...(h.metadata ?? {}), current_gold_price: price, current_value: newVal, pnl: Math.round((newVal - h.totalCost) * 100) / 100, pnl_percent: h.totalCost > 0 ? Math.round(((newVal - h.totalCost) / h.totalCost) * 10000) / 100 : 0 };
        await supabase
          .from('manual_assets')
          .update({ current_value: newVal, metadata: updatedMeta })
          .eq('id', h.id);
      }

      setHoldings(updated);
      setShowPriceUpdate(false);
      setNewGoldPrice('');
    } catch (err) {
      console.error('Failed to update gold price:', err);
      alert('Failed to update price. Please try again.');
    } finally {
      setUpdatingPrice(false);
    }
  }

  // ── Delete handler ──────────────────────────────────────────────────────────

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this gold holding?')) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from('manual_assets').delete().eq('id', id);
      if (error) throw error;
      setHoldings(prev => prev.filter(h => h.id !== id));
      setSheetOpen(false);
      setSelectedHolding(null);
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Failed to delete. Please try again.');
    } finally {
      setDeleting(false);
    }
  }

  // ── Row click ───────────────────────────────────────────────────────────────

  function openDetail(h: GoldRow) {
    setSelectedHolding(h);
    setSheetOpen(true);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#d97706' }}>
            <Gem className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: '#1B2A4A' }}>Gold & Jewelry</h1>
            <p className="text-xs" style={{ color: '#9CA3AF' }}>Track your gold, jewelry and digital gold holdings</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setShowPriceUpdate(!showPriceUpdate)}
            variant="outline"
            className="gap-2 text-sm font-medium"
            style={{ borderColor: '#C9A84C', color: '#C9A84C' }}
          >
            <RefreshCw className="w-4 h-4" />
            Update Gold Price
          </Button>
          <Button
            onClick={() => router.push('/add-assets/gold')}
            className="gap-2 text-sm font-medium"
            style={{ backgroundColor: '#1B2A4A', color: 'white' }}
          >
            <PlusCircle className="w-4 h-4" />
            Add Gold
          </Button>
        </div>
      </div>

      {/* Update Gold Price Panel */}
      {showPriceUpdate && (
        <div className="wv-card p-4">
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1.5">
              <Label className="text-xs" style={{ color: '#6B7280' }}>Current Gold Price per Gram (₹)</Label>
              <Input
                type="number"
                value={newGoldPrice}
                onChange={e => setNewGoldPrice(e.target.value)}
                placeholder="e.g. 7500"
                step="1"
                min="0"
                className="h-9 text-xs"
              />
            </div>
            <Button
              onClick={handleUpdateGoldPrice}
              disabled={updatingPrice || !newGoldPrice}
              className="h-9 gap-2 text-xs font-medium text-white"
              style={{ backgroundColor: '#C9A84C' }}
            >
              {updatingPrice ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Update All
            </Button>
          </div>
          <p className="text-[10px] mt-2" style={{ color: '#9CA3AF' }}>This will update the current value of all gold holdings using this price (adjusted for purity).</p>
        </div>
      )}

      {/* Family Member Selector */}
      <div className="wv-card p-4">
        <FamilyMemberSelector
          onSelectionChange={(ids) => setActiveMemberIds(ids)}
          compact
        />
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#C9A84C' }} />
          <span className="ml-3 text-sm" style={{ color: '#9CA3AF' }}>Loading gold holdings...</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && holdings.length === 0 && (
        <div className="wv-card p-12 text-center">
          <Gem className="w-12 h-12 mx-auto mb-4" style={{ color: '#C9A84C' }} />
          <h3 className="text-lg font-semibold mb-2" style={{ color: '#1B2A4A' }}>No Gold Holdings Yet</h3>
          <p className="text-sm mb-6" style={{ color: '#9CA3AF' }}>Start tracking your gold investments by adding your first holding.</p>
          <Button
            onClick={() => router.push('/add-assets/gold')}
            className="gap-2"
            style={{ backgroundColor: '#1B2A4A', color: 'white' }}
          >
            <PlusCircle className="w-4 h-4" />
            Add Gold
          </Button>
        </div>
      )}

      {/* Summary Cards + Table */}
      {!loading && filtered.length > 0 && (
        <>
          {/* ── Summary Cards ──────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Total Weight', value: `${totalWeight.toFixed(3)}g`, color: undefined },
              { label: 'Total Invested', value: formatLargeINR(totalInvested), color: undefined },
              { label: 'Current Value', value: formatLargeINR(totalCurrentValue), color: undefined },
              { label: 'Total P&L', value: `${totalPnl >= 0 ? '+' : ''}${formatLargeINR(totalPnl)}`, color: totalPnl >= 0 ? '#059669' : '#DC2626' },
            ].map((c) => (
              <div key={c.label} className="wv-card p-4">
                <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#9CA3AF' }}>{c.label}</p>
                <p className="font-display text-lg font-semibold" style={{ color: c.color ?? '#1B2A4A' }}>{c.value}</p>
              </div>
            ))}
          </div>

          {/* ── Holdings Table ─────────────────────────────────────────────────── */}
          <div className="wv-card overflow-hidden">
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr style={{ borderBottom: '1px solid #E8E5DD' }}>
                    {['Description', 'Type', 'Purity', 'Weight (g)', 'Invested (₹)', 'Current Value (₹)', 'P&L'].map((h) => (
                      <th key={h} className="px-4 py-3 text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap" style={{ color: '#9CA3AF' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((h) => (
                    <tr
                      key={h.id}
                      onClick={() => openDetail(h)}
                      className="cursor-pointer transition-colors hover:bg-gray-50"
                      style={{ borderBottom: '1px solid #F3F4F6' }}
                    >
                      <td className="px-4 py-3">
                        <p className="text-xs font-semibold" style={{ color: '#1A1A2E' }}>{h.description}</p>
                        {h.memberName && <p className="text-[10px]" style={{ color: '#9CA3AF' }}>{h.memberName}</p>}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: '#4B5563' }}>{h.goldType}</td>
                      <td className="px-4 py-3 text-xs font-medium" style={{ color: '#C9A84C' }}>{h.purityLabel}</td>
                      <td className="px-4 py-3 text-xs font-medium tabular-nums" style={{ color: '#1A1A2E' }}>{h.weightGrams.toFixed(3)}</td>
                      <td className="px-4 py-3 text-xs font-medium tabular-nums" style={{ color: '#1A1A2E' }}>{formatINRFull(h.totalCost)}</td>
                      <td className="px-4 py-3 text-xs font-semibold tabular-nums" style={{ color: '#1B2A4A' }}>{formatINRFull(h.currentValue)}</td>
                      <td className="px-4 py-3">
                        <p className="text-xs font-medium tabular-nums" style={{ color: h.pnl >= 0 ? '#059669' : '#DC2626' }}>
                          {h.pnl >= 0 ? '+' : ''}{formatINRFull(h.pnl)}
                        </p>
                        <p className="text-[10px] tabular-nums" style={{ color: h.pnlPercent >= 0 ? '#059669' : '#DC2626' }}>
                          {h.pnlPercent >= 0 ? '+' : ''}{h.pnlPercent.toFixed(2)}%
                        </p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile card layout */}
            <div className="md:hidden divide-y" style={{ borderColor: '#F3F4F6' }}>
              {filtered.map((h) => (
                <div
                  key={h.id}
                  onClick={() => openDetail(h)}
                  className="p-4 cursor-pointer transition-colors hover:bg-gray-50"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="text-sm font-semibold" style={{ color: '#1A1A2E' }}>{h.description}</p>
                      <p className="text-[10px]" style={{ color: '#9CA3AF' }}>
                        {h.goldType} {h.memberName ? ` . ${h.memberName}` : ''}
                      </p>
                    </div>
                    <span className="text-[10px] font-semibold px-2 py-1 rounded-full whitespace-nowrap"
                      style={{ backgroundColor: 'rgba(201,168,76,0.12)', color: '#C9A84C' }}>
                      {h.purityLabel}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-[10px] uppercase" style={{ color: '#9CA3AF' }}>Weight</p>
                      <p className="text-xs font-medium tabular-nums" style={{ color: '#1A1A2E' }}>{h.weightGrams.toFixed(3)}g</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase" style={{ color: '#9CA3AF' }}>Invested</p>
                      <p className="text-xs font-medium tabular-nums" style={{ color: '#1A1A2E' }}>{formatLargeINR(h.totalCost)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase" style={{ color: '#9CA3AF' }}>Current Value</p>
                      <p className="text-xs font-semibold tabular-nums" style={{ color: '#1B2A4A' }}>{formatLargeINR(h.currentValue)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase" style={{ color: '#9CA3AF' }}>P&L</p>
                      <p className="text-xs font-medium tabular-nums" style={{ color: h.pnl >= 0 ? '#059669' : '#DC2626' }}>
                        {h.pnl >= 0 ? '+' : ''}{formatLargeINR(h.pnl)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── Detail Sheet ─────────────────────────────────────────────────────── */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          {selectedHolding && (
            <div className="space-y-6 pt-2">
              {/* Header */}
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#d97706' }}>
                    <Gem className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold" style={{ color: '#1B2A4A' }}>{selectedHolding.description}</h2>
                    <p className="text-xs" style={{ color: '#9CA3AF' }}>{selectedHolding.goldType}</p>
                  </div>
                </div>
                {selectedHolding.memberName && (
                  <p className="text-xs mt-1" style={{ color: '#9CA3AF' }}>Held by: {selectedHolding.memberName}</p>
                )}
              </div>

              {/* Purity Badge */}
              <span className="text-[11px] font-semibold px-3 py-1 rounded-full"
                style={{ backgroundColor: 'rgba(201,168,76,0.12)', color: '#C9A84C' }}>
                {selectedHolding.purityLabel}
              </span>

              {/* Gold Details */}
              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#9CA3AF' }}>Holding Details</h3>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Weight', value: `${selectedHolding.weightGrams.toFixed(3)}g` },
                    { label: 'Purity', value: selectedHolding.purityLabel },
                    { label: 'Purchase Date', value: formatDate(selectedHolding.purchaseDate) },
                    { label: 'Type', value: selectedHolding.goldType },
                    ...(selectedHolding.makingCharges > 0 ? [{ label: 'Making Charges', value: formatINRFull(selectedHolding.makingCharges) }] : []),
                    ...(selectedHolding.platform ? [{ label: 'Platform', value: selectedHolding.platform }] : []),
                  ].map((item) => (
                    <div key={item.label}>
                      <p className="text-[10px] uppercase tracking-wider" style={{ color: '#9CA3AF' }}>{item.label}</p>
                      <p className="text-sm font-medium" style={{ color: '#1A1A2E' }}>{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Value Summary */}
              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#9CA3AF' }}>Valuation</h3>
                <div className="wv-card p-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-xs" style={{ color: '#4B5563' }}>Total Invested</span>
                    <span className="text-sm font-semibold tabular-nums" style={{ color: '#1A1A2E' }}>{formatINRFull(selectedHolding.totalCost)}</span>
                  </div>
                  <div className="flex justify-between items-center" style={{ borderTop: '1px solid #F3F4F6', paddingTop: 12 }}>
                    <span className="text-xs" style={{ color: '#4B5563' }}>Current Value</span>
                    <span className="text-sm font-semibold tabular-nums" style={{ color: '#1B2A4A' }}>{formatINRFull(selectedHolding.currentValue)}</span>
                  </div>
                  <div className="flex justify-between items-center" style={{ borderTop: '1px solid #E8E5DD', paddingTop: 12 }}>
                    <span className="text-xs font-semibold" style={{ color: selectedHolding.pnl >= 0 ? '#059669' : '#DC2626' }}>P&L</span>
                    <span className="text-base font-bold tabular-nums" style={{ color: selectedHolding.pnl >= 0 ? '#059669' : '#DC2626' }}>
                      {selectedHolding.pnl >= 0 ? '+' : ''}{formatINRFull(selectedHolding.pnl)} ({selectedHolding.pnlPercent >= 0 ? '+' : ''}{selectedHolding.pnlPercent.toFixed(2)}%)
                    </span>
                  </div>
                </div>
              </div>

              {/* Additional metadata */}
              {(() => {
                const meta = selectedHolding.metadata ?? {};
                const extras: { label: string; value: string }[] = [];
                if (meta.current_gold_price) extras.push({ label: 'Gold Price/g', value: formatINRFull(Number(meta.current_gold_price)) });
                if (meta.purchase_price_per_gram) extras.push({ label: 'Purchase Price/g', value: formatINRFull(Number(meta.purchase_price_per_gram)) });
                if (meta.notes) extras.push({ label: 'Notes', value: String(meta.notes) });

                if (extras.length === 0) return null;
                return (
                  <div className="space-y-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#9CA3AF' }}>Additional Details</h3>
                    <div className="space-y-2">
                      {extras.map((item) => (
                        <div key={item.label} className="flex justify-between">
                          <span className="text-xs" style={{ color: '#9CA3AF' }}>{item.label}</span>
                          <span className="text-xs font-medium text-right max-w-[60%]" style={{ color: '#1A1A2E' }}>{item.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Last Updated */}
              <p className="text-[10px]" style={{ color: '#9CA3AF' }}>
                Last updated: {formatDate(selectedHolding.last_updated)}
              </p>

              {/* Actions */}
              <div className="flex gap-3 pt-2" style={{ borderTop: '1px solid #E8E5DD' }}>
                <Button
                  onClick={() => {
                    router.push(`/add-assets/gold?edit=${selectedHolding.id}`);
                  }}
                  className="flex-1 gap-2 text-sm"
                  style={{ backgroundColor: '#1B2A4A', color: 'white' }}
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Edit
                </Button>
                <Button
                  onClick={() => handleDelete(selectedHolding.id)}
                  variant="outline"
                  className="flex-1 gap-2 text-sm"
                  style={{ borderColor: '#DC2626', color: '#DC2626' }}
                  disabled={deleting}
                >
                  {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  Delete
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
