'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { FileText, PlusCircle, Loader2, Trash2, Pencil } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR } from '@/lib/utils/formatters';
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

interface BondRow extends RawHolding {
  bondType: string;
  faceValue: number;
  purchasePrice: number;
  couponRate: number;
  couponFrequency: string;
  maturityDate: string;
  creditRating: string;
  taxTreatment: string;
  isin: string;
  investedValue: number;
  currentValue: number;
  annualCoupon: number;
  daysToMaturity: number;
  status: 'Active' | 'Maturing Soon' | 'Matured';
  memberName: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDaysToMaturity(maturityDate: string): number {
  if (!maturityDate) return 0;
  return Math.max(0, Math.ceil((new Date(maturityDate).getTime() - Date.now()) / (24 * 3600 * 1000)));
}

function getStatus(daysToMaturity: number, maturityDate: string): 'Active' | 'Maturing Soon' | 'Matured' {
  if (!maturityDate) return 'Active';
  if (daysToMaturity === 0) return 'Matured';
  if (daysToMaturity <= 90) return 'Maturing Soon';
  return 'Active';
}

function statusStyle(status: string): { bg: string; text: string } {
  switch (status) {
    case 'Active':        return { bg: 'rgba(5,150,105,0.12)', text: '#059669' };
    case 'Maturing Soon': return { bg: 'rgba(217,119,6,0.12)', text: '#D97706' };
    case 'Matured':       return { bg: 'rgba(220,38,38,0.12)', text: '#DC2626' };
    default:              return { bg: 'var(--wv-border)', text: '#6B7280' };
  }
}

function ratingStyle(rating: string): { bg: string; text: string } {
  if (['AAA', 'AA+', 'Sovereign'].includes(rating)) return { bg: 'rgba(5,150,105,0.10)', text: '#059669' };
  if (['AA', 'AA-', 'A+', 'A'].includes(rating)) return { bg: 'rgba(5,150,105,0.06)', text: '#047857' };
  if (['BBB+', 'BBB'].includes(rating)) return { bg: 'rgba(217,119,6,0.10)', text: '#D97706' };
  if (['BB', 'Below BB'].includes(rating)) return { bg: 'rgba(220,38,38,0.10)', text: '#DC2626' };
  return { bg: 'var(--wv-border)', text: '#6B7280' }; // Unrated
}

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

function frequencyLabel(freq: string): string {
  const map: Record<string, string> = {
    annual: 'Annual',
    semi_annual: 'Semi-Annual',
    quarterly: 'Quarterly',
    monthly: 'Monthly',
    zero_coupon: 'Zero Coupon',
  };
  return map[freq] || freq.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Page Component ───────────────────────────────────────────────────────────

export default function BondsPortfolioPage() {
  const router = useRouter();
  const supabase = createClient();

  const [bonds, setBonds] = useState<BondRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeMemberIds, setActiveMemberIds] = useState<string[]>([]);
  const [selectedBond, setSelectedBond] = useState<BondRow | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // ── Data fetch ──────────────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data } = await supabase
          .from('holdings')
          .select('id, symbol, name, quantity, avg_buy_price, metadata, portfolios(id, name, user_id, family_id), brokers(id, name), transactions(id, date, price, quantity, type, fees, notes)')
          .eq('asset_type', 'bond');

        if (!data || data.length === 0) {
          setBonds([]);
          setLoading(false);
          return;
        }

        // Resolve member names
        const userIds = Array.from(new Set((data as unknown as RawHolding[]).map(d => d.portfolios?.user_id).filter(Boolean) as string[]));
        let nameMap: Record<string, string> = {};
        if (userIds.length > 0) {
          const { data: users } = await supabase.from('users').select('id, name').in('id', userIds);
          if (users) nameMap = Object.fromEntries(users.map(u => [u.id, u.name || u.id.slice(0, 8)]));
        }

        const rows: BondRow[] = (data as unknown as RawHolding[]).map((h) => {
          const meta = h.metadata ?? {};
          const faceValue = Number(meta.face_value ?? 1000);
          const couponRate = Number(meta.coupon_rate ?? 0);
          const maturityDate = String(meta.maturity_date ?? '');
          const daysToMaturity = getDaysToMaturity(maturityDate);
          const status = getStatus(daysToMaturity, maturityDate);
          const marketPrice = meta.market_price ? Number(meta.market_price) : null;
          const currentValue = h.quantity * (marketPrice ?? faceValue);
          const couponFreq = String(meta.coupon_frequency ?? 'semi_annual');
          const annualCoupon = couponFreq === 'zero_coupon' ? 0 : (faceValue * couponRate / 100 * h.quantity);

          return {
            ...h,
            bondType: String(meta.bond_type ?? 'Bond'),
            faceValue,
            purchasePrice: h.avg_buy_price,
            couponRate,
            couponFrequency: couponFreq,
            maturityDate,
            creditRating: String(meta.credit_rating ?? 'Unrated'),
            taxTreatment: String(meta.tax_treatment ?? 'Taxable'),
            isin: String(meta.isin ?? ''),
            investedValue: h.avg_buy_price * h.quantity,
            currentValue,
            annualCoupon,
            daysToMaturity,
            status,
            memberName: nameMap[h.portfolios?.user_id ?? ''] ?? '',
          };
        });

        setBonds(rows);
      } catch (err) {
        console.error('Failed to load bonds:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Filtered data ───────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    if (activeMemberIds.length === 0) return bonds;
    return bonds.filter(b => activeMemberIds.includes(b.portfolios?.user_id ?? ''));
  }, [bonds, activeMemberIds]);

  // ── Aggregates ──────────────────────────────────────────────────────────────

  const totalInvested = useMemo(() => filtered.reduce((s, b) => s + b.investedValue, 0), [filtered]);
  const totalCurrentValue = useMemo(() => filtered.reduce((s, b) => s + b.currentValue, 0), [filtered]);
  const totalAnnualCoupon = useMemo(() => filtered.reduce((s, b) => s + b.annualCoupon, 0), [filtered]);
  const bondCount = useMemo(() => filtered.reduce((s, b) => s + b.quantity, 0), [filtered]);

  // ── Delete handler ──────────────────────────────────────────────────────────

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this bond holding?')) return;
    setDeleting(true);
    try {
      // Delete transactions first, then the holding
      await supabase.from('transactions').delete().eq('holding_id', id);
      const { error } = await supabase.from('holdings').delete().eq('id', id);
      if (error) throw error;
      setBonds(prev => prev.filter(b => b.id !== id));
      setSheetOpen(false);
      setSelectedBond(null);
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Failed to delete. Please try again.');
    } finally {
      setDeleting(false);
    }
  }

  // ── Row click ───────────────────────────────────────────────────────────────

  function openDetail(bond: BondRow) {
    setSelectedBond(bond);
    setSheetOpen(true);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#1B2A4A' }}>
            <FileText className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--wv-text)' }}>Bonds</h1>
            <p className="text-xs" style={{ color: 'var(--wv-text-muted)' }}>Track your bond investments, coupons &amp; maturities</p>
          </div>
        </div>
        <Button
          onClick={() => router.push('/add-assets/bonds')}
          className="gap-2 text-sm font-medium"
          style={{ backgroundColor: '#1B2A4A', color: 'white' }}
        >
          <PlusCircle className="w-4 h-4" />
          Add Bond
        </Button>
      </div>

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
          <span className="ml-3 text-sm" style={{ color: 'var(--wv-text-muted)' }}>Loading bonds...</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && bonds.length === 0 && (
        <div className="wv-card p-12 text-center">
          <FileText className="w-12 h-12 mx-auto mb-4" style={{ color: '#C9A84C' }} />
          <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--wv-text)' }}>No Bonds Yet</h3>
          <p className="text-sm mb-6" style={{ color: 'var(--wv-text-muted)' }}>Start tracking your bond holdings by adding your first bond.</p>
          <Button
            onClick={() => router.push('/add-assets/bonds')}
            className="gap-2"
            style={{ backgroundColor: '#1B2A4A', color: 'white' }}
          >
            <PlusCircle className="w-4 h-4" />
            Add Bond
          </Button>
        </div>
      )}

      {/* Summary Cards + Table */}
      {!loading && filtered.length > 0 && (
        <>
          {/* ── Summary Cards ──────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Total Invested', value: formatLargeINR(totalInvested), color: undefined },
              { label: 'Current Value', value: formatLargeINR(totalCurrentValue), color: undefined },
              { label: 'Annual Coupon Income', value: '+' + formatLargeINR(totalAnnualCoupon), color: '#059669' },
              { label: 'Number of Bonds', value: String(bondCount), color: undefined },
            ].map((c) => (
              <div key={c.label} className="wv-card p-4">
                <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--wv-text-muted)' }}>{c.label}</p>
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
                  <tr style={{ borderBottom: '1px solid var(--wv-border)' }}>
                    {['Bond Name', 'Type', 'Rating', 'Units', 'Invested (₹)', 'Coupon Rate', 'Frequency', 'Maturity Date', 'Days to Maturity', 'Status'].map((h) => (
                      <th key={h} className="px-4 py-3 text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap" style={{ color: 'var(--wv-text-muted)' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((bond) => {
                    const st = statusStyle(bond.status);
                    const rt = ratingStyle(bond.creditRating);
                    return (
                      <tr
                        key={bond.id}
                        onClick={() => openDetail(bond)}
                        className="cursor-pointer transition-colors hover:bg-gray-50"
                        style={{ borderBottom: '1px solid var(--wv-border)' }}
                      >
                        <td className="px-4 py-3">
                          <p className="text-xs font-semibold" style={{ color: 'var(--wv-text)' }}>{bond.name}</p>
                          {bond.memberName && <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>{bond.memberName}</p>}
                        </td>
                        <td className="px-4 py-3 text-xs" style={{ color: 'var(--wv-text-secondary)' }}>{bond.bondType}</td>
                        <td className="px-4 py-3">
                          <span
                            className="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
                            style={{ backgroundColor: rt.bg, color: rt.text }}
                          >
                            {bond.creditRating}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs font-medium tabular-nums" style={{ color: 'var(--wv-text)' }}>{bond.quantity}</td>
                        <td className="px-4 py-3 text-xs font-medium tabular-nums" style={{ color: 'var(--wv-text)' }}>{formatINRFull(bond.investedValue)}</td>
                        <td className="px-4 py-3 text-xs font-semibold tabular-nums" style={{ color: 'var(--wv-text)' }}>{bond.couponRate.toFixed(2)}%</td>
                        <td className="px-4 py-3 text-xs" style={{ color: 'var(--wv-text-secondary)' }}>{frequencyLabel(bond.couponFrequency)}</td>
                        <td className="px-4 py-3 text-xs tabular-nums" style={{ color: 'var(--wv-text-secondary)' }}>{formatDate(bond.maturityDate)}</td>
                        <td className="px-4 py-3 text-xs tabular-nums" style={{ color: bond.daysToMaturity <= 90 ? '#D97706' : '#4B5563' }}>
                          {bond.maturityDate ? `${bond.daysToMaturity} days` : '--'}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className="text-[10px] font-semibold px-2 py-1 rounded-full whitespace-nowrap"
                            style={{ backgroundColor: st.bg, color: st.text }}
                          >
                            {bond.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Total footer */}
            {filtered.length > 0 && (() => {
              const totalGainLoss = totalCurrentValue - totalInvested;
              const totalGainLossPct = totalInvested > 0 ? (totalGainLoss / totalInvested) * 100 : 0;
              return (
                <div className="hidden md:flex px-5 py-3 items-center justify-between" style={{ borderTop: '2px solid var(--wv-border)', backgroundColor: 'var(--wv-surface-2)' }}>
                  <span className="text-xs font-semibold" style={{ color: 'var(--wv-text)' }}>{filtered.length} bond{filtered.length === 1 ? '' : 's'} · Total</span>
                  <div className="flex items-center gap-6 text-xs">
                    <span style={{ color: 'var(--wv-text-secondary)' }}>Invested: <strong style={{ color: 'var(--wv-text)' }}>{formatLargeINR(totalInvested)}</strong></span>
                    <span style={{ color: 'var(--wv-text-secondary)' }}>Current: <strong style={{ color: 'var(--wv-text)' }}>{formatLargeINR(totalCurrentValue)}</strong></span>
                    <span style={{ color: 'var(--wv-text-secondary)' }}>Annual Coupon: <strong style={{ color: '#059669' }}>+{formatLargeINR(totalAnnualCoupon)}</strong></span>
                    <span style={{ color: totalGainLoss >= 0 ? '#059669' : '#DC2626' }}>P&L: <strong>{totalGainLoss >= 0 ? '+' : ''}{formatLargeINR(totalGainLoss)} ({totalGainLossPct >= 0 ? '+' : ''}{totalGainLossPct.toFixed(2)}%)</strong></span>
                  </div>
                </div>
              );
            })()}

            {/* Mobile card layout */}
            <div className="md:hidden divide-y" style={{ borderColor: 'var(--wv-border)' }}>
              {filtered.map((bond) => {
                const st = statusStyle(bond.status);
                const rt = ratingStyle(bond.creditRating);
                return (
                  <div
                    key={bond.id}
                    onClick={() => openDetail(bond)}
                    className="p-4 cursor-pointer transition-colors hover:bg-gray-50"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="text-sm font-semibold" style={{ color: 'var(--wv-text)' }}>{bond.name}</p>
                        <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>
                          {bond.bondType} {bond.memberName ? `· ${bond.memberName}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span
                          className="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
                          style={{ backgroundColor: rt.bg, color: rt.text }}
                        >
                          {bond.creditRating}
                        </span>
                        <span
                          className="text-[10px] font-semibold px-2 py-1 rounded-full whitespace-nowrap"
                          style={{ backgroundColor: st.bg, color: st.text }}
                        >
                          {bond.status}
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-[10px] uppercase" style={{ color: 'var(--wv-text-muted)' }}>Invested</p>
                        <p className="text-xs font-medium tabular-nums" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(bond.investedValue)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase" style={{ color: 'var(--wv-text-muted)' }}>Current Value</p>
                        <p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(bond.currentValue)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase" style={{ color: 'var(--wv-text-muted)' }}>Coupon</p>
                        <p className="text-xs font-medium tabular-nums" style={{ color: 'var(--wv-text)' }}>{bond.couponRate.toFixed(2)}% ({frequencyLabel(bond.couponFrequency)})</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase" style={{ color: 'var(--wv-text-muted)' }}>Units</p>
                        <p className="text-xs font-medium tabular-nums" style={{ color: 'var(--wv-text)' }}>{bond.quantity}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase" style={{ color: 'var(--wv-text-muted)' }}>Maturity</p>
                        <p className="text-xs tabular-nums" style={{ color: 'var(--wv-text-secondary)' }}>{formatDate(bond.maturityDate)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase" style={{ color: 'var(--wv-text-muted)' }}>Days Left</p>
                        <p className="text-xs tabular-nums" style={{ color: bond.daysToMaturity <= 90 ? '#D97706' : '#4B5563' }}>
                          {bond.maturityDate ? `${bond.daysToMaturity} days` : '--'}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* ── Detail Sheet ─────────────────────────────────────────────────────── */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          {selectedBond && (
            <div className="space-y-6 pt-2">
              {/* Header */}
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#1B2A4A' }}>
                    <FileText className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold" style={{ color: 'var(--wv-text)' }}>{selectedBond.name}</h2>
                    <p className="text-xs" style={{ color: 'var(--wv-text-muted)' }}>{selectedBond.bondType}</p>
                  </div>
                </div>
                {selectedBond.memberName && (
                  <p className="text-xs mt-1" style={{ color: 'var(--wv-text-muted)' }}>Held by: {selectedBond.memberName}</p>
                )}
              </div>

              {/* Status & Rating */}
              <div className="flex items-center gap-2">
                {(() => {
                  const st = statusStyle(selectedBond.status);
                  return (
                    <span
                      className="text-[11px] font-semibold px-3 py-1 rounded-full"
                      style={{ backgroundColor: st.bg, color: st.text }}
                    >
                      {selectedBond.status}
                    </span>
                  );
                })()}
                {(() => {
                  const rt = ratingStyle(selectedBond.creditRating);
                  return (
                    <span
                      className="text-[11px] font-semibold px-3 py-1 rounded-full"
                      style={{ backgroundColor: rt.bg, color: rt.text }}
                    >
                      {selectedBond.creditRating}
                    </span>
                  );
                })()}
              </div>

              {/* Bond Details */}
              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--wv-text-muted)' }}>Bond Details</h3>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Bond Type', value: selectedBond.bondType },
                    { label: 'Credit Rating', value: selectedBond.creditRating },
                    { label: 'Face Value', value: formatINRFull(selectedBond.faceValue) },
                    { label: 'Purchase Price', value: formatINRFull(selectedBond.purchasePrice) },
                    { label: 'Units', value: String(selectedBond.quantity) },
                    { label: 'Total Invested', value: formatINRFull(selectedBond.investedValue) },
                    { label: 'Current Value', value: formatINRFull(selectedBond.currentValue) },
                    { label: 'Tax Treatment', value: selectedBond.taxTreatment },
                  ].map((item) => (
                    <div key={item.label}>
                      <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--wv-text-muted)' }}>{item.label}</p>
                      <p className="text-sm font-medium" style={{ color: 'var(--wv-text)' }}>{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Coupon Info */}
              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--wv-text-muted)' }}>Coupon Information</h3>
                <div className="wv-card p-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Coupon Rate</span>
                    <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--wv-text)' }}>{selectedBond.couponRate.toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between items-center" style={{ borderTop: '1px solid var(--wv-border)', paddingTop: 12 }}>
                    <span className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Frequency</span>
                    <span className="text-sm font-medium" style={{ color: 'var(--wv-text)' }}>{frequencyLabel(selectedBond.couponFrequency)}</span>
                  </div>
                  <div className="flex justify-between items-center" style={{ borderTop: '1px solid var(--wv-border)', paddingTop: 12 }}>
                    <span className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Annual Coupon Income</span>
                    <span className="text-sm font-semibold tabular-nums" style={{ color: '#059669' }}>
                      {selectedBond.couponFrequency === 'zero_coupon' ? 'N/A (Zero Coupon)' : `+${formatINRFull(selectedBond.annualCoupon)}`}
                    </span>
                  </div>
                  <div className="flex justify-between items-center" style={{ borderTop: '1px solid var(--wv-border)', paddingTop: 12 }}>
                    <span className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Maturity Date</span>
                    <span className="text-sm font-medium" style={{ color: 'var(--wv-text)' }}>{formatDate(selectedBond.maturityDate)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Days to Maturity</span>
                    <span className="text-sm font-medium tabular-nums" style={{ color: selectedBond.daysToMaturity <= 90 ? '#D97706' : '#1A1A2E' }}>
                      {selectedBond.maturityDate ? `${selectedBond.daysToMaturity} days` : '--'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Additional Details */}
              {(() => {
                const extras: { label: string; value: string }[] = [];
                if (selectedBond.isin) extras.push({ label: 'ISIN', value: selectedBond.isin });
                if (selectedBond.symbol) extras.push({ label: 'Symbol', value: selectedBond.symbol });
                const meta = selectedBond.metadata ?? {};
                if (meta.sgb_series) extras.push({ label: 'SGB Series', value: String(meta.sgb_series) });
                if (meta.gold_grams) extras.push({ label: 'Gold Grams', value: String(meta.gold_grams) });
                if (meta.exchange) extras.push({ label: 'Exchange', value: String(meta.exchange) });
                if (meta.is_listed) extras.push({ label: 'Listed', value: 'Yes' });

                // Notes from transactions
                const buyTx = selectedBond.transactions?.find(t => t.type === 'buy');
                if (buyTx?.notes) extras.push({ label: 'Notes', value: buyTx.notes });

                if (extras.length === 0) return null;
                return (
                  <div className="space-y-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--wv-text-muted)' }}>Additional Details</h3>
                    <div className="space-y-2">
                      {extras.map((item) => (
                        <div key={item.label} className="flex justify-between">
                          <span className="text-xs" style={{ color: 'var(--wv-text-muted)' }}>{item.label}</span>
                          <span className="text-xs font-medium text-right max-w-[60%]" style={{ color: 'var(--wv-text)' }}>{item.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Transaction History */}
              {selectedBond.transactions && selectedBond.transactions.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--wv-text-muted)' }}>Transactions</h3>
                  <div className="space-y-2">
                    {selectedBond.transactions.map((tx) => (
                      <div key={tx.id} className="flex justify-between items-center p-2 rounded-lg" style={{ backgroundColor: 'rgba(27,42,74,0.03)' }}>
                        <div>
                          <p className="text-xs font-medium capitalize" style={{ color: 'var(--wv-text)' }}>{tx.type}</p>
                          <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>{formatDate(tx.date)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--wv-text)' }}>{tx.quantity} units</p>
                          <p className="text-[10px] tabular-nums" style={{ color: 'var(--wv-text-muted)' }}>@ {formatINRFull(tx.price)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-2" style={{ borderTop: '1px solid var(--wv-border)' }}>
                <Button
                  onClick={() => {
                    router.push(`/add-assets/bonds?edit=${selectedBond.id}`);
                  }}
                  className="flex-1 gap-2 text-sm"
                  style={{ backgroundColor: '#1B2A4A', color: 'white' }}
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Edit
                </Button>
                <Button
                  onClick={() => handleDelete(selectedBond.id)}
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
