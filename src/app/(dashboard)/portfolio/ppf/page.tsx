'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Leaf, PlusCircle, Loader2, AlertCircle, Trash2, Pencil,
  IndianRupee, Landmark, TrendingUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR } from '@/lib/utils/formatters';
import { FamilyMemberSelector } from '@/components/shared/FamilyMemberSelector';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PPFAsset {
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

interface PPFRow extends PPFAsset {
  bank: string;
  accountNumber: string;
  openingDate: string;
  balance: number;
  interestRate: number;
  totalDeposits: number;
  interestEarned: number;
  maturityDate: string;
  yearsRemaining: number;
  status: 'Active' | 'Matured';
  memberName: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeMaturityDate(openingDate: string): string {
  const d = new Date(openingDate);
  d.setFullYear(d.getFullYear() + 15);
  return d.toISOString().slice(0, 10);
}

function computeYearsRemaining(maturityDate: string): number {
  const now = new Date();
  const mat = new Date(maturityDate);
  const diff = (mat.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
  return Math.max(0, Math.round(diff * 10) / 10);
}

function computeStatus(openingDate: string): 'Active' | 'Matured' {
  const mat = computeMaturityDate(openingDate);
  return new Date(mat) <= new Date() ? 'Matured' : 'Active';
}

function fmtDate(d: string | undefined): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return d;
  }
}

// ─── Page Component ───────────────────────────────────────────────────────────

export default function PPFPortfolioPage() {
  const router = useRouter();
  const supabase = createClient();

  const [raw, setRaw] = useState<PPFAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [memberMap, setMemberMap] = useState<Record<string, string>>({});
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<PPFRow | null>(null);
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

  // Load PPF assets
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
        .eq('asset_type', 'ppf');

      if (fetchErr) throw new Error(fetchErr.message);
      setRaw((data as unknown as PPFAsset[]) || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load PPF data');
    } finally {
      setLoading(false);
    }
  }

  // Transform raw data into rows
  const rows: PPFRow[] = useMemo(() => {
    return raw
      .filter((a) => {
        if (selectedMemberIds.length === 0) return true;
        const userId = a.portfolios?.user_id;
        return userId ? selectedMemberIds.includes(userId) : true;
      })
      .map((a) => {
        const meta = a.metadata || {};
        const openingDate = (meta.opening_date as string) || a.last_updated || '';
        const totalDeposits = Number(meta.total_deposits || meta.invested_amount || 0);
        const balance = Number(a.current_value || 0);
        const interestRate = Number(meta.interest_rate || 7.1);
        const maturityDate = computeMaturityDate(openingDate);
        const yearsRemaining = computeYearsRemaining(maturityDate);
        const status = computeStatus(openingDate);
        const interestEarned = Math.max(0, balance - totalDeposits);
        const userId = a.portfolios?.user_id || '';

        return {
          ...a,
          bank: (meta.bank as string) || a.name || 'Unknown',
          accountNumber: (meta.account_number as string) || '—',
          openingDate,
          balance,
          interestRate,
          totalDeposits,
          interestEarned,
          maturityDate,
          yearsRemaining,
          status,
          memberName: memberMap[userId] || 'Unknown',
        };
      });
  }, [raw, selectedMemberIds, memberMap]);

  // Summary calculations
  const summary = useMemo(() => {
    const totalBalance = rows.reduce((s, r) => s + r.balance, 0);
    const totalDeposits = rows.reduce((s, r) => s + r.totalDeposits, 0);
    const totalInterest = rows.reduce((s, r) => s + r.interestEarned, 0);
    const accountCount = rows.length;
    return { totalBalance, totalDeposits, totalInterest, accountCount };
  }, [rows]);

  // Delete handler
  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this PPF account?')) return;
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
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#1B2A4A' }} />
        <span className="ml-2 text-sm" style={{ color: '#6B7280' }}>Loading PPF accounts...</span>
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
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#ecfdf5' }}>
            <Leaf className="w-5 h-5" style={{ color: '#059669' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: '#1B2A4A' }}>PPF Portfolio</h1>
            <p className="text-xs" style={{ color: '#9CA3AF' }}>Public Provident Fund accounts</p>
          </div>
        </div>
        <Button
          onClick={() => router.push('/add-assets/ppf')}
          className="text-white text-sm"
          style={{ backgroundColor: '#1B2A4A' }}
        >
          <PlusCircle className="w-4 h-4 mr-1.5" />
          Add PPF
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
            <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: '#9CA3AF' }}>Total Balance</p>
          </div>
          <p className="text-lg font-bold" style={{ color: '#1B2A4A' }}>{formatLargeINR(summary.totalBalance)}</p>
        </div>
        <div className="wv-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Landmark className="w-4 h-4" style={{ color: '#C9A84C' }} />
            <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: '#9CA3AF' }}>Total Deposits</p>
          </div>
          <p className="text-lg font-bold" style={{ color: '#1B2A4A' }}>{formatLargeINR(summary.totalDeposits)}</p>
        </div>
        <div className="wv-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4" style={{ color: '#059669' }} />
            <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: '#9CA3AF' }}>Interest Earned</p>
          </div>
          <p className="text-lg font-bold" style={{ color: '#059669' }}>{formatLargeINR(summary.totalInterest)}</p>
        </div>
        <div className="wv-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Leaf className="w-4 h-4" style={{ color: '#C9A84C' }} />
            <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: '#9CA3AF' }}>Accounts</p>
          </div>
          <p className="text-lg font-bold" style={{ color: '#1B2A4A' }}>{summary.accountCount}</p>
        </div>
      </div>

      {/* Table */}
      {rows.length === 0 ? (
        <div className="wv-card p-12 text-center">
          <Leaf className="w-10 h-10 mx-auto mb-3" style={{ color: '#D1D5DB' }} />
          <p className="text-sm font-medium" style={{ color: '#6B7280' }}>No PPF accounts found</p>
          <p className="text-xs mt-1" style={{ color: '#9CA3AF' }}>Add your first PPF account to start tracking</p>
          <Button
            onClick={() => router.push('/add-assets/ppf')}
            className="mt-4 text-white text-sm"
            style={{ backgroundColor: '#1B2A4A' }}
          >
            <PlusCircle className="w-4 h-4 mr-1.5" />
            Add PPF Account
          </Button>
        </div>
      ) : (
        <div className="wv-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: '#F7F5F0' }}>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#9CA3AF' }}>Bank</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#9CA3AF' }}>Account No.</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#9CA3AF' }}>Opening Date</th>
                  <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#9CA3AF' }}>Balance</th>
                  <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#9CA3AF' }}>Interest Rate</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#9CA3AF' }}>Maturity Date</th>
                  <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#9CA3AF' }}>Yrs Remaining</th>
                  <th className="text-center px-4 py-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#9CA3AF' }}>Status</th>
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
                      <p className="font-medium text-sm" style={{ color: '#1B2A4A' }}>{row.bank}</p>
                      <p className="text-[10px]" style={{ color: '#9CA3AF' }}>{row.memberName}</p>
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: '#374151' }}>{row.accountNumber}</td>
                    <td className="px-4 py-3 text-sm" style={{ color: '#374151' }}>{fmtDate(row.openingDate)}</td>
                    <td className="px-4 py-3 text-sm text-right font-semibold" style={{ color: '#1B2A4A' }}>{formatLargeINR(row.balance)}</td>
                    <td className="px-4 py-3 text-sm text-right" style={{ color: '#374151' }}>{row.interestRate}%</td>
                    <td className="px-4 py-3 text-sm" style={{ color: '#374151' }}>{fmtDate(row.maturityDate)}</td>
                    <td className="px-4 py-3 text-sm text-right" style={{ color: '#374151' }}>{row.yearsRemaining} yrs</td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                        style={{
                          backgroundColor: row.status === 'Active' ? 'rgba(5,150,105,0.12)' : 'rgba(234,88,12,0.12)',
                          color: row.status === 'Active' ? '#059669' : '#EA580C',
                        }}
                      >
                        {row.status}
                      </span>
                    </td>
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
            <SheetTitle style={{ color: '#1B2A4A' }}>PPF Account Details</SheetTitle>
            <SheetDescription>
              {selectedAsset?.bank} — {selectedAsset?.accountNumber}
            </SheetDescription>
          </SheetHeader>

          {selectedAsset && (
            <div className="mt-6 space-y-4">
              {/* Info grid */}
              <div className="wv-card p-4 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9CA3AF' }}>Bank</p>
                  <p className="text-sm font-medium" style={{ color: '#1B2A4A' }}>{selectedAsset.bank}</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9CA3AF' }}>Account Number</p>
                  <p className="text-sm font-medium" style={{ color: '#1B2A4A' }}>{selectedAsset.accountNumber}</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9CA3AF' }}>Member</p>
                  <p className="text-sm font-medium" style={{ color: '#1B2A4A' }}>{selectedAsset.memberName}</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9CA3AF' }}>Opening Date</p>
                  <p className="text-sm font-medium" style={{ color: '#1B2A4A' }}>{fmtDate(selectedAsset.openingDate)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9CA3AF' }}>Balance</p>
                  <p className="text-sm font-bold" style={{ color: '#1B2A4A' }}>{formatLargeINR(selectedAsset.balance)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9CA3AF' }}>Interest Rate</p>
                  <p className="text-sm font-medium" style={{ color: '#1B2A4A' }}>{selectedAsset.interestRate}%</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9CA3AF' }}>Total Deposits</p>
                  <p className="text-sm font-medium" style={{ color: '#1B2A4A' }}>{formatLargeINR(selectedAsset.totalDeposits)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9CA3AF' }}>Interest Earned</p>
                  <p className="text-sm font-bold" style={{ color: '#059669' }}>{formatLargeINR(selectedAsset.interestEarned)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9CA3AF' }}>Maturity Date</p>
                  <p className="text-sm font-medium" style={{ color: '#1B2A4A' }}>{fmtDate(selectedAsset.maturityDate)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9CA3AF' }}>Years Remaining</p>
                  <p className="text-sm font-medium" style={{ color: '#1B2A4A' }}>{selectedAsset.yearsRemaining} yrs</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9CA3AF' }}>Status</p>
                  <span
                    className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor: selectedAsset.status === 'Active' ? 'rgba(5,150,105,0.12)' : 'rgba(234,88,12,0.12)',
                      color: selectedAsset.status === 'Active' ? '#059669' : '#EA580C',
                    }}
                  >
                    {selectedAsset.status}
                  </span>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: '#9CA3AF' }}>Last Updated</p>
                  <p className="text-sm font-medium" style={{ color: '#1B2A4A' }}>{fmtDate(selectedAsset.last_updated)}</p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  className="flex-1 text-sm"
                  onClick={() => {
                    setSheetOpen(false);
                    router.push(`/add-assets/ppf?edit=${selectedAsset.id}`);
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
