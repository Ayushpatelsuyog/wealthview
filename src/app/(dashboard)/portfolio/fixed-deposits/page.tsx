'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Landmark, PlusCircle, Loader2, Trash2, Pencil } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR } from '@/lib/utils/formatters';
import { FamilyMemberSelector } from '@/components/shared/FamilyMemberSelector';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawFD {
  id: string;
  name: string;
  current_value: number;
  metadata: Record<string, unknown>;
  last_updated: string;
  portfolio_id: string;
  portfolios: { id: string; name: string; user_id: string; family_id: string } | null;
}

interface FDRow extends RawFD {
  principal: number;
  rate: number;
  startDate: string;
  maturityDate: string;
  compounding: string;
  bank: string;
  fdType: string;
  currentValue: number;
  interest: number;
  daysToMaturity: number;
  status: 'Active' | 'Maturing Soon' | 'Matured';
  memberName: string;
}

// ─── Compound Interest Helper ─────────────────────────────────────────────────

function calcAccrued(meta: Record<string, unknown>): { currentValue: number; interest: number; daysToMaturity: number } {
  const principal = Number(meta.principal ?? 0);
  const rate = Number(meta.rate ?? 0);
  const startDate = String(meta.start_date ?? '');
  const maturityDate = String(meta.maturity_date ?? '');
  const compounding = String(meta.compounding ?? 'quarterly');
  if (!principal || !rate || !startDate) return { currentValue: principal, interest: 0, daysToMaturity: 0 };
  const n = { monthly: 12, quarterly: 4, half_yearly: 2, annually: 1, cumulative: 1 }[compounding] ?? 4;
  const years = (Date.now() - new Date(startDate).getTime()) / (365.25 * 24 * 3600 * 1000);
  const currentValue = principal * Math.pow(1 + (rate / 100) / n, n * Math.max(0, years));
  const daysToMaturity = maturityDate ? Math.max(0, Math.ceil((new Date(maturityDate).getTime() - Date.now()) / (24 * 3600 * 1000))) : 0;
  return { currentValue, interest: currentValue - principal, daysToMaturity };
}

function getStatus(daysToMaturity: number, maturityDate: string): 'Active' | 'Maturing Soon' | 'Matured' {
  if (!maturityDate) return 'Active';
  if (daysToMaturity === 0) return 'Matured';
  if (daysToMaturity <= 30) return 'Maturing Soon';
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

function formatDate(dateStr: string): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return '—';
  }
}

function formatINRFull(amount: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
}

// ─── Page Component ───────────────────────────────────────────────────────────

export default function FixedDepositsPage() {
  const router = useRouter();
  const supabase = createClient();

  const [fds, setFds] = useState<FDRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeMemberIds, setActiveMemberIds] = useState<string[]>([]);
  const [selectedFD, setSelectedFD] = useState<FDRow | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // ── Data fetch ──────────────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data } = await supabase
          .from('manual_assets')
          .select('id, name, current_value, metadata, last_updated, portfolio_id, portfolios(id, name, user_id, family_id)')
          .eq('asset_type', 'fd');

        if (!data || data.length === 0) {
          setFds([]);
          setLoading(false);
          return;
        }

        // Resolve member names
        const userIds = Array.from(new Set((data as unknown as RawFD[]).map(d => d.portfolios?.user_id).filter(Boolean) as string[]));
        let nameMap: Record<string, string> = {};
        if (userIds.length > 0) {
          const { data: users } = await supabase.from('users').select('id, name').in('id', userIds);
          if (users) nameMap = Object.fromEntries(users.map(u => [u.id, u.name || u.id.slice(0, 8)]));
        }

        const rows: FDRow[] = (data as unknown as RawFD[]).map((fd) => {
          const meta = fd.metadata ?? {};
          const { currentValue, interest, daysToMaturity } = calcAccrued(meta);
          const maturityDate = String(meta.maturity_date ?? '');
          const status = getStatus(daysToMaturity, maturityDate);

          return {
            ...fd,
            principal: Number(meta.principal ?? fd.current_value ?? 0),
            rate: Number(meta.rate ?? 0),
            startDate: String(meta.start_date ?? ''),
            maturityDate,
            compounding: String(meta.compounding ?? 'quarterly'),
            bank: String(meta.bank ?? meta.institution ?? fd.name ?? ''),
            fdType: String(meta.fd_type ?? meta.type ?? 'Regular'),
            currentValue,
            interest,
            daysToMaturity,
            status,
            memberName: nameMap[fd.portfolios?.user_id ?? ''] ?? '',
          };
        });

        setFds(rows);
      } catch (err) {
        console.error('Failed to load FDs:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Filtered data ───────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    if (activeMemberIds.length === 0) return fds;
    return fds.filter(fd => activeMemberIds.includes(fd.portfolios?.user_id ?? ''));
  }, [fds, activeMemberIds]);

  // ── Aggregates ──────────────────────────────────────────────────────────────

  const totalPrincipal = useMemo(() => filtered.reduce((s, fd) => s + fd.principal, 0), [filtered]);
  const totalCurrentValue = useMemo(() => filtered.reduce((s, fd) => s + fd.currentValue, 0), [filtered]);
  const totalInterest = useMemo(() => filtered.reduce((s, fd) => s + fd.interest, 0), [filtered]);
  const fdCount = filtered.length;

  // ── Delete handler ──────────────────────────────────────────────────────────

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this Fixed Deposit?')) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from('manual_assets').delete().eq('id', id);
      if (error) throw error;
      setFds(prev => prev.filter(fd => fd.id !== id));
      setSheetOpen(false);
      setSelectedFD(null);
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Failed to delete. Please try again.');
    } finally {
      setDeleting(false);
    }
  }

  // ── Row click ───────────────────────────────────────────────────────────────

  function openDetail(fd: FDRow) {
    setSelectedFD(fd);
    setSheetOpen(true);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#1B2A4A' }}>
            <Landmark className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--wv-text)' }}>Fixed Deposits</h1>
            <p className="text-xs" style={{ color: 'var(--wv-text-muted)' }}>Track your FD investments and interest accrual</p>
          </div>
        </div>
        <Button
          onClick={() => router.push('/add-assets/fixed-deposits')}
          className="gap-2 text-sm font-medium"
          style={{ backgroundColor: '#1B2A4A', color: 'white' }}
        >
          <PlusCircle className="w-4 h-4" />
          Add FD
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
          <span className="ml-3 text-sm" style={{ color: 'var(--wv-text-muted)' }}>Loading fixed deposits...</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && fds.length === 0 && (
        <div className="wv-card p-12 text-center">
          <Landmark className="w-12 h-12 mx-auto mb-4" style={{ color: '#C9A84C' }} />
          <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--wv-text)' }}>No Fixed Deposits Yet</h3>
          <p className="text-sm mb-6" style={{ color: 'var(--wv-text-muted)' }}>Start tracking your FDs by adding your first deposit.</p>
          <Button
            onClick={() => router.push('/add-assets/fixed-deposits')}
            className="gap-2"
            style={{ backgroundColor: '#1B2A4A', color: 'white' }}
          >
            <PlusCircle className="w-4 h-4" />
            Add Fixed Deposit
          </Button>
        </div>
      )}

      {/* Summary Cards + Table */}
      {!loading && filtered.length > 0 && (
        <>
          {/* ── Summary Cards ──────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Total Principal', value: formatLargeINR(totalPrincipal), color: undefined },
              { label: 'Current Value', value: formatLargeINR(totalCurrentValue), color: undefined },
              { label: 'Interest Earned', value: '+' + formatLargeINR(totalInterest), color: '#059669' },
              { label: 'Number of FDs', value: String(fdCount), color: undefined },
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
                    {['Bank', 'FD Type', 'Principal (₹)', 'Rate (%)', 'Start Date', 'Maturity Date', 'Days to Maturity', 'Accrued Interest', 'Current Value', 'Status'].map((h) => (
                      <th key={h} className="px-4 py-3 text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap" style={{ color: 'var(--wv-text-muted)' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((fd) => {
                    const st = statusStyle(fd.status);
                    return (
                      <tr
                        key={fd.id}
                        onClick={() => openDetail(fd)}
                        className="cursor-pointer transition-colors hover:bg-gray-50"
                        style={{ borderBottom: '1px solid var(--wv-border)' }}
                      >
                        <td className="px-4 py-3">
                          <p className="text-xs font-semibold" style={{ color: 'var(--wv-text)' }}>{fd.bank}</p>
                          {fd.memberName && <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>{fd.memberName}</p>}
                        </td>
                        <td className="px-4 py-3 text-xs" style={{ color: 'var(--wv-text-secondary)' }}>{fd.fdType}</td>
                        <td className="px-4 py-3 text-xs font-medium tabular-nums" style={{ color: 'var(--wv-text)' }}>{formatINRFull(fd.principal)}</td>
                        <td className="px-4 py-3 text-xs font-semibold tabular-nums" style={{ color: 'var(--wv-text)' }}>{fd.rate.toFixed(2)}%</td>
                        <td className="px-4 py-3 text-xs tabular-nums" style={{ color: 'var(--wv-text-secondary)' }}>{formatDate(fd.startDate)}</td>
                        <td className="px-4 py-3 text-xs tabular-nums" style={{ color: 'var(--wv-text-secondary)' }}>{formatDate(fd.maturityDate)}</td>
                        <td className="px-4 py-3 text-xs tabular-nums" style={{ color: fd.daysToMaturity <= 30 ? '#D97706' : '#4B5563' }}>
                          {fd.maturityDate ? `${fd.daysToMaturity} days` : '—'}
                        </td>
                        <td className="px-4 py-3 text-xs font-medium tabular-nums" style={{ color: '#059669' }}>
                          +{formatINRFull(fd.interest)}
                        </td>
                        <td className="px-4 py-3 text-xs font-semibold tabular-nums" style={{ color: 'var(--wv-text)' }}>{formatINRFull(fd.currentValue)}</td>
                        <td className="px-4 py-3">
                          <span
                            className="text-[10px] font-semibold px-2 py-1 rounded-full whitespace-nowrap"
                            style={{ backgroundColor: st.bg, color: st.text }}
                          >
                            {fd.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile card layout */}
            <div className="md:hidden divide-y" style={{ borderColor: 'var(--wv-border)' }}>
              {filtered.map((fd) => {
                const st = statusStyle(fd.status);
                return (
                  <div
                    key={fd.id}
                    onClick={() => openDetail(fd)}
                    className="p-4 cursor-pointer transition-colors hover:bg-gray-50"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="text-sm font-semibold" style={{ color: 'var(--wv-text)' }}>{fd.bank}</p>
                        <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>
                          {fd.fdType} {fd.memberName ? `· ${fd.memberName}` : ''}
                        </p>
                      </div>
                      <span
                        className="text-[10px] font-semibold px-2 py-1 rounded-full whitespace-nowrap"
                        style={{ backgroundColor: st.bg, color: st.text }}
                      >
                        {fd.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-[10px] uppercase" style={{ color: 'var(--wv-text-muted)' }}>Principal</p>
                        <p className="text-xs font-medium tabular-nums" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(fd.principal)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase" style={{ color: 'var(--wv-text-muted)' }}>Current Value</p>
                        <p className="text-xs font-semibold tabular-nums" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(fd.currentValue)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase" style={{ color: 'var(--wv-text-muted)' }}>Rate</p>
                        <p className="text-xs font-medium tabular-nums" style={{ color: 'var(--wv-text)' }}>{fd.rate.toFixed(2)}%</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase" style={{ color: 'var(--wv-text-muted)' }}>Interest</p>
                        <p className="text-xs font-medium tabular-nums" style={{ color: '#059669' }}>+{formatLargeINR(fd.interest)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase" style={{ color: 'var(--wv-text-muted)' }}>Maturity</p>
                        <p className="text-xs tabular-nums" style={{ color: 'var(--wv-text-secondary)' }}>{formatDate(fd.maturityDate)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase" style={{ color: 'var(--wv-text-muted)' }}>Days Left</p>
                        <p className="text-xs tabular-nums" style={{ color: fd.daysToMaturity <= 30 ? '#D97706' : '#4B5563' }}>
                          {fd.maturityDate ? `${fd.daysToMaturity} days` : '—'}
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
          {selectedFD && (
            <div className="space-y-6 pt-2">
              {/* Header */}
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#1B2A4A' }}>
                    <Landmark className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold" style={{ color: 'var(--wv-text)' }}>{selectedFD.bank}</h2>
                    <p className="text-xs" style={{ color: 'var(--wv-text-muted)' }}>{selectedFD.fdType} Fixed Deposit</p>
                  </div>
                </div>
                {selectedFD.memberName && (
                  <p className="text-xs mt-1" style={{ color: 'var(--wv-text-muted)' }}>Held by: {selectedFD.memberName}</p>
                )}
              </div>

              {/* Status */}
              {(() => {
                const st = statusStyle(selectedFD.status);
                return (
                  <span
                    className="text-[11px] font-semibold px-3 py-1 rounded-full"
                    style={{ backgroundColor: st.bg, color: st.text }}
                  >
                    {selectedFD.status}
                  </span>
                );
              })()}

              {/* FD Details */}
              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--wv-text-muted)' }}>Deposit Details</h3>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Principal', value: formatINRFull(selectedFD.principal) },
                    { label: 'Interest Rate', value: `${selectedFD.rate.toFixed(2)}%` },
                    { label: 'Compounding', value: selectedFD.compounding.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) },
                    { label: 'Start Date', value: formatDate(selectedFD.startDate) },
                    { label: 'Maturity Date', value: formatDate(selectedFD.maturityDate) },
                    { label: 'Days to Maturity', value: selectedFD.maturityDate ? `${selectedFD.daysToMaturity} days` : '—' },
                  ].map((item) => (
                    <div key={item.label}>
                      <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--wv-text-muted)' }}>{item.label}</p>
                      <p className="text-sm font-medium" style={{ color: 'var(--wv-text)' }}>{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Interest Accrual Summary */}
              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--wv-text-muted)' }}>Interest Accrual</h3>
                <div className="wv-card p-4 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Principal Amount</span>
                    <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--wv-text)' }}>{formatINRFull(selectedFD.principal)}</span>
                  </div>
                  <div className="flex justify-between items-center" style={{ borderTop: '1px solid var(--wv-border)', paddingTop: 12 }}>
                    <span className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Accrued Interest</span>
                    <span className="text-sm font-semibold tabular-nums" style={{ color: '#059669' }}>+{formatINRFull(selectedFD.interest)}</span>
                  </div>
                  <div className="flex justify-between items-center" style={{ borderTop: '1px solid var(--wv-border)', paddingTop: 12 }}>
                    <span className="text-xs font-semibold" style={{ color: 'var(--wv-text)' }}>Current Value</span>
                    <span className="text-base font-bold tabular-nums" style={{ color: 'var(--wv-text)' }}>{formatINRFull(selectedFD.currentValue)}</span>
                  </div>
                  {selectedFD.principal > 0 && (
                    <div className="flex justify-between items-center">
                      <span className="text-xs" style={{ color: 'var(--wv-text-muted)' }}>Effective Return</span>
                      <span className="text-xs font-medium tabular-nums" style={{ color: '#059669' }}>
                        +{((selectedFD.interest / selectedFD.principal) * 100).toFixed(2)}%
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Additional metadata */}
              {(() => {
                const meta = selectedFD.metadata ?? {};
                const extras: { label: string; value: string }[] = [];
                if (meta.account_number) extras.push({ label: 'Account/FD Number', value: String(meta.account_number) });
                if (meta.fd_number) extras.push({ label: 'FD Number', value: String(meta.fd_number) });
                if (meta.nominee) extras.push({ label: 'Nominee', value: String(meta.nominee) });
                if (meta.auto_renew !== undefined) extras.push({ label: 'Auto Renewal', value: meta.auto_renew ? 'Yes' : 'No' });
                if (meta.tax_saver) extras.push({ label: 'Tax Saver', value: 'Yes' });
                if (meta.notes) extras.push({ label: 'Notes', value: String(meta.notes) });

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

              {/* Last Updated */}
              <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>
                Last updated: {formatDate(selectedFD.last_updated)}
              </p>

              {/* Actions */}
              <div className="flex gap-3 pt-2" style={{ borderTop: '1px solid var(--wv-border)' }}>
                <Button
                  onClick={() => {
                    router.push(`/add-assets/fixed-deposits?edit=${selectedFD.id}`);
                  }}
                  className="flex-1 gap-2 text-sm"
                  style={{ backgroundColor: '#1B2A4A', color: 'white' }}
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Edit
                </Button>
                <Button
                  onClick={() => handleDelete(selectedFD.id)}
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
