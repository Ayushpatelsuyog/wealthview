'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  UserCheck, PlusCircle, Loader2, AlertCircle, Trash2, Pencil,
  IndianRupee, TrendingUp, Percent, Building2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR, formatCurrency } from '@/lib/utils/formatters';
import { FamilyMemberSelector } from '@/components/shared/FamilyMemberSelector';

// ─── Types ────────────────────────────────────────────────────────────────────

interface EPFAsset {
  id: string;
  name: string;
  current_value: number;
  metadata: Record<string, unknown>;
  last_updated: string;
  portfolios: {
    id: string;
    name: string;
    user_id: string;
    family_id: string;
  } | null;
}

interface EPFRow extends EPFAsset {
  employer: string;
  uan: string;
  balance: number;
  monthlyContribution: number;
  interestRate: number;
  joiningDate: string;
  employeeRate: number;
  employerRate: number;
  vpfMonthly: number;
  monthlyBasic: number;
  monthlyEmployee: number;
  monthlyEmployerEPF: number;
  monthlyEPS: number;
  annualContribution: number;
  annualInterest: number;
  epfAccountNumber: string;
  notes: string;
  memberName: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: string | undefined): string {
  if (!d) return '--';
  try {
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return d;
  }
}

// ─── Page Component ───────────────────────────────────────────────────────────

export default function EPFPortfolioPage() {
  const router = useRouter();
  const supabase = createClient();

  const [raw, setRaw] = useState<EPFAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [memberMap, setMemberMap] = useState<Record<string, string>>({});
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<EPFRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Load member names
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase.from('users').select('family_id').eq('id', user.id).single();
      if (!profile?.family_id) return;
      const { data: members } = await supabase.from('users').select('id, name').eq('family_id', profile.family_id);
      if (members) {
        const map: Record<string, string> = {};
        for (const m of members) map[m.id] = m.name || m.id.slice(0, 8);
        setMemberMap(map);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load EPF assets
  useEffect(() => {
    loadData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchErr } = await supabase
        .from('manual_assets')
        .select('id, name, current_value, metadata, last_updated, portfolios(id, name, user_id, family_id)')
        .eq('asset_type', 'epf');

      if (fetchErr) throw new Error(fetchErr.message);
      setRaw((data as unknown as EPFAsset[]) || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load EPF data');
    } finally {
      setLoading(false);
    }
  }

  // Transform raw data into rows
  const rows: EPFRow[] = useMemo(() => {
    return raw
      .filter((a) => {
        if (selectedMemberIds.length === 0) return true;
        const userId = a.portfolios?.user_id;
        return userId ? selectedMemberIds.includes(userId) : true;
      })
      .map((a) => {
        const meta = a.metadata || {};
        const balance = Number(a.current_value || 0);
        const monthlyBasic = Number(meta.monthly_basic || 0);
        const employeeRate = Number(meta.employee_rate || 12);
        const employerRate = Number(meta.employer_rate || 12);
        const vpfMonthly = Number(meta.vpf_monthly || 0);
        const interestRate = Number(meta.interest_rate || 8.25);
        const monthlyEmployee = Number(meta.monthly_employee || monthlyBasic * (employeeRate / 100));
        const monthlyEmployerEPF = Number(meta.monthly_employer_epf || monthlyBasic * 0.0367);
        const monthlyEPS = Number(meta.monthly_eps || Math.min(monthlyBasic, 15000) * 0.0833);
        const totalMonthly = monthlyEmployee + monthlyEmployerEPF + vpfMonthly;
        const annualContribution = Number(meta.annual_contribution || totalMonthly * 12);
        const annualInterest = Number(meta.annual_interest || balance * (interestRate / 100));
        const userId = a.portfolios?.user_id || '';

        return {
          ...a,
          employer: (meta.employer as string) || a.name.replace(' EPF', '') || 'Unknown',
          uan: (meta.uan as string) || '--',
          balance,
          monthlyContribution: totalMonthly,
          interestRate,
          joiningDate: (meta.joining_date as string) || '',
          employeeRate,
          employerRate,
          vpfMonthly,
          monthlyBasic,
          monthlyEmployee,
          monthlyEmployerEPF,
          monthlyEPS,
          annualContribution,
          annualInterest,
          epfAccountNumber: (meta.epf_account_number as string) || '--',
          notes: (meta.notes as string) || '',
          memberName: memberMap[userId] || 'Unknown',
        };
      });
  }, [raw, selectedMemberIds, memberMap]);

  // Summary calculations
  const summary = useMemo(() => {
    const totalBalance = rows.reduce((s, r) => s + r.balance, 0);
    const totalAnnualContribution = rows.reduce((s, r) => s + r.annualContribution, 0);
    const avgInterestRate = rows.length > 0
      ? parseFloat((rows.reduce((s, r) => s + r.interestRate, 0) / rows.length).toFixed(2))
      : 0;
    const accountCount = rows.length;
    return { totalBalance, totalAnnualContribution, avgInterestRate, accountCount };
  }, [rows]);

  // Delete handler
  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this EPF account?')) return;
    setDeleting(true);
    try {
      const { error: delErr } = await supabase.from('manual_assets').delete().eq('id', id);
      if (delErr) throw new Error(delErr.message);
      setSheetOpen(false);
      setSelectedAsset(null);
      await loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--wv-text)' }} />
        <span className="ml-2 text-sm" style={{ color: 'var(--wv-text-secondary)' }}>Loading EPF accounts...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-3">
        <AlertCircle className="w-8 h-8" style={{ color: '#DC2626' }} />
        <p className="text-sm" style={{ color: '#DC2626' }}>{error}</p>
        <Button variant="outline" onClick={loadData}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#eff6ff' }}>
            <UserCheck className="w-5 h-5" style={{ color: '#2563eb' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--wv-text)' }}>EPF Portfolio</h1>
            <p className="text-xs" style={{ color: 'var(--wv-text-muted)' }}>Employees&apos; Provident Fund accounts</p>
          </div>
        </div>
        <Button
          onClick={() => router.push('/add-assets/epf-vpf')}
          className="text-white text-sm"
          style={{ backgroundColor: '#1B2A4A' }}
        >
          <PlusCircle className="w-4 h-4 mr-1.5" />
          Add EPF
        </Button>
      </div>

      {/* Family Member Selector */}
      <FamilyMemberSelector
        onSelectionChange={(memberIds) => setSelectedMemberIds(memberIds)}
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="wv-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <IndianRupee className="w-4 h-4" style={{ color: '#C9A84C' }} />
            <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Total EPF Balance</p>
          </div>
          <p className="text-lg font-bold" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(summary.totalBalance)}</p>
        </div>
        <div className="wv-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4" style={{ color: '#C9A84C' }} />
            <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Annual Contribution</p>
          </div>
          <p className="text-lg font-bold" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(summary.totalAnnualContribution)}</p>
        </div>
        <div className="wv-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Percent className="w-4 h-4" style={{ color: '#C9A84C' }} />
            <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Interest Rate</p>
          </div>
          <p className="text-lg font-bold" style={{ color: 'var(--wv-text)' }}>{summary.avgInterestRate}%</p>
        </div>
        <div className="wv-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Building2 className="w-4 h-4" style={{ color: '#C9A84C' }} />
            <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Accounts</p>
          </div>
          <p className="text-lg font-bold" style={{ color: 'var(--wv-text)' }}>{summary.accountCount}</p>
        </div>
      </div>

      {/* Table */}
      {rows.length === 0 ? (
        <div className="wv-card p-12 text-center">
          <UserCheck className="w-10 h-10 mx-auto mb-3" style={{ color: '#D1D5DB' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--wv-text-secondary)' }}>No EPF accounts found</p>
          <p className="text-xs mt-1" style={{ color: 'var(--wv-text-muted)' }}>Add your first EPF account to start tracking</p>
          <Button
            onClick={() => router.push('/add-assets/epf-vpf')}
            className="mt-4 text-white text-sm"
            style={{ backgroundColor: '#1B2A4A' }}
          >
            <PlusCircle className="w-4 h-4 mr-1.5" />
            Add EPF Account
          </Button>
        </div>
      ) : (
        <div className="wv-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--wv-surface-2)' }}>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Employer</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>UAN</th>
                  <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Balance</th>
                  <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Monthly Contribution</th>
                  <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Interest Rate</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Joining Date</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => { setSelectedAsset(row); setSheetOpen(true); }}
                    className="border-t cursor-pointer transition-colors hover:bg-gray-50"
                    style={{ borderColor: '#F3F0E8' }}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-sm" style={{ color: 'var(--wv-text)' }}>{row.employer}</p>
                      <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>{row.memberName}</p>
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: '#374151' }}>{row.uan}</td>
                    <td className="px-4 py-3 text-sm text-right font-semibold" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(row.balance)}</td>
                    <td className="px-4 py-3 text-sm text-right" style={{ color: '#374151' }}>{formatLargeINR(row.monthlyContribution)}</td>
                    <td className="px-4 py-3 text-sm text-right" style={{ color: '#374151' }}>{row.interestRate}%</td>
                    <td className="px-4 py-3 text-sm" style={{ color: '#374151' }}>{fmtDate(row.joiningDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detail Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="overflow-y-auto w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle style={{ color: 'var(--wv-text)' }}>EPF Account Details</SheetTitle>
            <SheetDescription>
              {selectedAsset?.employer} — {selectedAsset?.uan}
            </SheetDescription>
          </SheetHeader>

          {selectedAsset && (
            <div className="mt-6 space-y-4">
              {/* Info grid */}
              <div className="wv-card p-4 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Employer</p>
                  <p className="text-sm font-medium" style={{ color: 'var(--wv-text)' }}>{selectedAsset.employer}</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Member</p>
                  <p className="text-sm font-medium" style={{ color: 'var(--wv-text)' }}>{selectedAsset.memberName}</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>UAN</p>
                  <p className="text-sm font-medium" style={{ color: 'var(--wv-text)' }}>{selectedAsset.uan}</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>EPF Account No.</p>
                  <p className="text-sm font-medium" style={{ color: 'var(--wv-text)' }}>{selectedAsset.epfAccountNumber}</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Joining Date</p>
                  <p className="text-sm font-medium" style={{ color: 'var(--wv-text)' }}>{fmtDate(selectedAsset.joiningDate)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>EPF Balance</p>
                  <p className="text-sm font-bold" style={{ color: 'var(--wv-text)' }}>{formatCurrency(selectedAsset.balance)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Monthly Basic</p>
                  <p className="text-sm font-medium" style={{ color: 'var(--wv-text)' }}>{formatCurrency(selectedAsset.monthlyBasic)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Interest Rate</p>
                  <p className="text-sm font-medium" style={{ color: 'var(--wv-text)' }}>{selectedAsset.interestRate}% p.a.</p>
                </div>
              </div>

              {/* Contribution breakdown */}
              <div className="rounded-xl p-4 space-y-3" style={{ backgroundColor: 'var(--wv-surface-2)', border: '1px solid var(--wv-border)' }}>
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--wv-text-secondary)' }}>
                  Contribution Breakdown
                </span>
                <div className="grid grid-cols-2 gap-y-2 gap-x-6 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Employee ({selectedAsset.employeeRate}%)</span>
                    <span className="font-medium" style={{ color: 'var(--wv-text)' }}>{formatCurrency(selectedAsset.monthlyEmployee)}/mo</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Employer EPF (3.67%)</span>
                    <span className="font-medium" style={{ color: 'var(--wv-text)' }}>{formatCurrency(selectedAsset.monthlyEmployerEPF)}/mo</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">EPS (8.33%)</span>
                    <span className="font-medium" style={{ color: 'var(--wv-text)' }}>{formatCurrency(selectedAsset.monthlyEPS)}/mo</span>
                  </div>
                  {selectedAsset.vpfMonthly > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">VPF</span>
                      <span className="font-medium" style={{ color: '#C9A84C' }}>{formatCurrency(selectedAsset.vpfMonthly)}/mo</span>
                    </div>
                  )}
                  <div className="flex justify-between col-span-2 pt-1" style={{ borderTop: '1px solid var(--wv-border)' }}>
                    <span className="text-gray-500 font-medium">Total Monthly</span>
                    <span className="font-bold" style={{ color: 'var(--wv-text)' }}>{formatCurrency(selectedAsset.monthlyContribution)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Annual Contribution</span>
                    <span className="font-bold" style={{ color: 'var(--wv-text)' }}>{formatCurrency(selectedAsset.annualContribution)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Annual Interest</span>
                    <span className="font-bold" style={{ color: '#059669' }}>{formatCurrency(selectedAsset.annualInterest)}</span>
                  </div>
                </div>
              </div>

              {/* Notes */}
              {selectedAsset.notes && (
                <div className="wv-card p-4">
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Notes</p>
                  <p className="text-sm mt-1" style={{ color: '#374151' }}>{selectedAsset.notes}</p>
                </div>
              )}

              <div className="wv-card p-4">
                <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Last Updated</p>
                <p className="text-sm font-medium mt-1" style={{ color: 'var(--wv-text)' }}>{fmtDate(selectedAsset.last_updated)}</p>
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  className="flex-1 text-sm"
                  onClick={() => {
                    setSheetOpen(false);
                    router.push(`/add-assets/epf-vpf?edit=${selectedAsset.id}`);
                  }}
                >
                  <Pencil className="w-3.5 h-3.5 mr-1.5" />
                  Edit
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 text-sm"
                  style={{ borderColor: '#FCA5A5', color: '#DC2626' }}
                  disabled={deleting}
                  onClick={() => handleDelete(selectedAsset.id)}
                >
                  {deleting ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5 mr-1.5" />}
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
