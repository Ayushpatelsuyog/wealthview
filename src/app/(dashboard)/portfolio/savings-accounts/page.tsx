'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Wallet, PlusCircle, Loader2, AlertCircle, Trash2, Pencil,
  IndianRupee, ShieldCheck, Hash, TrendingUp, Check, X,
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

interface SavingsAsset {
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

interface SavingsRow extends SavingsAsset {
  bank: string;
  accountType: string;
  accountNumber: string;
  maskedAccount: string;
  balance: number;
  interestRate: number;
  isEmergencyFund: boolean;
  memberName: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function maskAccount(acct: string): string {
  if (!acct || acct === '—') return '—';
  const cleaned = acct.replace(/\s/g, '');
  if (cleaned.length <= 4) return cleaned;
  return '****' + cleaned.slice(-4);
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

export default function SavingsAccountsPortfolioPage() {
  const router = useRouter();
  const supabase = createClient();

  const [raw, setRaw] = useState<SavingsAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [memberMap, setMemberMap] = useState<Record<string, string>>({});
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<SavingsRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Inline balance editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

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

  // Load savings accounts
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
        .eq('asset_type', 'savings_account');

      if (fetchErr) throw new Error(fetchErr.message);
      setRaw((data as unknown as SavingsAsset[]) || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load savings accounts');
    } finally {
      setLoading(false);
    }
  }

  // Transform raw data into rows
  const rows: SavingsRow[] = useMemo(() => {
    return raw
      .filter((a) => {
        if (selectedMemberIds.length === 0) return true;
        const userId = a.portfolios?.user_id;
        return userId ? selectedMemberIds.includes(userId) : true;
      })
      .map((a) => {
        const meta = a.metadata || {};
        const accountNumber = (meta.account_number as string) || '—';
        const userId = a.portfolios?.user_id || '';

        return {
          ...a,
          bank: (meta.bank as string) || a.name || 'Unknown',
          accountType: (meta.account_type as string) || 'Savings',
          accountNumber,
          maskedAccount: maskAccount(accountNumber),
          balance: Number(a.current_value || 0),
          interestRate: Number(meta.interest_rate || 0),
          isEmergencyFund: Boolean(meta.is_emergency_fund),
          memberName: memberMap[userId] || 'Unknown',
        };
      });
  }, [raw, selectedMemberIds, memberMap]);

  // Summary calculations
  const summary = useMemo(() => {
    const totalBalance = rows.reduce((s, r) => s + r.balance, 0);
    const emergencyTotal = rows.filter((r) => r.isEmergencyFund).reduce((s, r) => s + r.balance, 0);
    const accountCount = rows.length;
    const avgRate = rows.length > 0 ? rows.reduce((s, r) => s + r.interestRate, 0) / rows.length : 0;
    return { totalBalance, emergencyTotal, accountCount, avgRate };
  }, [rows]);

  // Delete handler
  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this savings account?')) return;
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

  // Inline balance update
  async function handleUpdateBalance(id: string) {
    const newValue = parseFloat(editValue);
    if (isNaN(newValue) || newValue < 0) return;
    setSaving(true);
    try {
      const { error: updErr } = await supabase
        .from('manual_assets')
        .update({ current_value: newValue, last_updated: new Date().toISOString().slice(0, 10) })
        .eq('id', id);
      if (updErr) throw new Error(updErr.message);
      setEditingId(null);
      setEditValue('');
      await loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--wv-text)' }} />
        <span className="ml-2 text-sm" style={{ color: 'var(--wv-text-secondary)' }}>Loading savings accounts...</span>
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
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#ecfeff' }}>
            <Wallet className="w-5 h-5" style={{ color: '#0891b2' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--wv-text)' }}>Savings Accounts</h1>
            <p className="text-xs" style={{ color: 'var(--wv-text-muted)' }}>Bank savings and emergency fund accounts</p>
          </div>
        </div>
        <Button
          onClick={() => router.push('/add-assets/savings-accounts')}
          className="text-white text-sm"
          style={{ backgroundColor: '#1B2A4A' }}
        >
          <PlusCircle className="w-4 h-4 mr-1.5" />
          Add Account
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
            <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Total Balance</p>
          </div>
          <p className="text-lg font-bold" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(summary.totalBalance)}</p>
        </div>
        <div className="wv-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck className="w-4 h-4" style={{ color: '#059669' }} />
            <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Emergency Fund</p>
          </div>
          <p className="text-lg font-bold" style={{ color: '#059669' }}>{formatLargeINR(summary.emergencyTotal)}</p>
        </div>
        <div className="wv-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Hash className="w-4 h-4" style={{ color: '#C9A84C' }} />
            <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Accounts</p>
          </div>
          <p className="text-lg font-bold" style={{ color: 'var(--wv-text)' }}>{summary.accountCount}</p>
        </div>
        <div className="wv-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4" style={{ color: '#C9A84C' }} />
            <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Avg Interest Rate</p>
          </div>
          <p className="text-lg font-bold" style={{ color: 'var(--wv-text)' }}>{summary.avgRate.toFixed(2)}%</p>
        </div>
      </div>

      {/* Table */}
      {rows.length === 0 ? (
        <div className="wv-card p-12 text-center">
          <Wallet className="w-10 h-10 mx-auto mb-3" style={{ color: '#D1D5DB' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--wv-text-secondary)' }}>No savings accounts found</p>
          <p className="text-xs mt-1" style={{ color: 'var(--wv-text-muted)' }}>Add your first savings account to start tracking</p>
          <Button
            onClick={() => router.push('/add-assets/savings-accounts')}
            className="mt-4 text-white text-sm"
            style={{ backgroundColor: '#1B2A4A' }}
          >
            <PlusCircle className="w-4 h-4 mr-1.5" />
            Add Savings Account
          </Button>
        </div>
      ) : (
        <div className="wv-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--wv-surface-2)' }}>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Bank</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Type</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Account No.</th>
                  <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Balance</th>
                  <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Interest Rate</th>
                  <th className="text-center px-4 py-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Emergency</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Last Updated</th>
                  <th className="text-center px-4 py-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Quick Update</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => {
                      if (editingId === row.id) return; // don't open sheet while editing
                      setSelectedAsset(row);
                      setSheetOpen(true);
                    }}
                    className="border-t cursor-pointer transition-colors hover:bg-gray-50"
                    style={{ borderColor: '#F3F0E8' }}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-sm" style={{ color: 'var(--wv-text)' }}>{row.bank}</p>
                      <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>{row.memberName}</p>
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: '#374151' }}>{row.accountType}</td>
                    <td className="px-4 py-3 text-sm font-mono" style={{ color: '#374151' }}>{row.maskedAccount}</td>
                    <td className="px-4 py-3 text-right">
                      {editingId === row.id ? (
                        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                          <Input
                            type="number"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="w-28 h-7 text-xs text-right"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleUpdateBalance(row.id);
                              if (e.key === 'Escape') { setEditingId(null); setEditValue(''); }
                            }}
                          />
                          <button
                            onClick={() => handleUpdateBalance(row.id)}
                            disabled={saving}
                            className="p-1 rounded hover:bg-green-50 transition-colors"
                          >
                            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: '#059669' }} /> : <Check className="w-3.5 h-3.5" style={{ color: '#059669' }} />}
                          </button>
                          <button
                            onClick={() => { setEditingId(null); setEditValue(''); }}
                            className="p-1 rounded hover:bg-red-50 transition-colors"
                          >
                            <X className="w-3.5 h-3.5" style={{ color: '#DC2626' }} />
                          </button>
                        </div>
                      ) : (
                        <span className="font-semibold text-sm" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(row.balance)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-right" style={{ color: '#374151' }}>{row.interestRate}%</td>
                    <td className="px-4 py-3 text-center">
                      {row.isEmergencyFund && (
                        <span
                          className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: 'rgba(5,150,105,0.12)', color: '#059669' }}
                        >
                          Emergency
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: 'var(--wv-text-muted)' }}>{fmtDate(row.last_updated)}</td>
                    <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => {
                          setEditingId(row.id);
                          setEditValue(String(row.balance));
                        }}
                        className="text-[10px] font-medium px-2 py-1 rounded-md transition-colors hover:opacity-80"
                        style={{ backgroundColor: 'rgba(201,168,76,0.12)', color: '#C9A84C' }}
                      >
                        Update
                      </button>
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
            <SheetTitle style={{ color: 'var(--wv-text)' }}>Account Details</SheetTitle>
            <SheetDescription>
              {selectedAsset?.bank} — {selectedAsset?.maskedAccount}
            </SheetDescription>
          </SheetHeader>

          {selectedAsset && (
            <div className="mt-6 space-y-4">
              {/* Info grid */}
              <div className="wv-card p-4 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Bank</p>
                  <p className="text-sm font-medium" style={{ color: 'var(--wv-text)' }}>{selectedAsset.bank}</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Account Type</p>
                  <p className="text-sm font-medium" style={{ color: 'var(--wv-text)' }}>{selectedAsset.accountType}</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Account Number</p>
                  <p className="text-sm font-medium font-mono" style={{ color: 'var(--wv-text)' }}>{selectedAsset.accountNumber}</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Member</p>
                  <p className="text-sm font-medium" style={{ color: 'var(--wv-text)' }}>{selectedAsset.memberName}</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Balance</p>
                  <p className="text-sm font-bold" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(selectedAsset.balance)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Interest Rate</p>
                  <p className="text-sm font-medium" style={{ color: 'var(--wv-text)' }}>{selectedAsset.interestRate}%</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Emergency Fund</p>
                  {selectedAsset.isEmergencyFund ? (
                    <span
                      className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: 'rgba(5,150,105,0.12)', color: '#059669' }}
                    >
                      Yes
                    </span>
                  ) : (
                    <p className="text-sm" style={{ color: 'var(--wv-text-muted)' }}>No</p>
                  )}
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Last Updated</p>
                  <p className="text-sm font-medium" style={{ color: 'var(--wv-text)' }}>{fmtDate(selectedAsset.last_updated)}</p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  className="flex-1 text-sm"
                  onClick={() => {
                    setSheetOpen(false);
                    router.push(`/add-assets/savings-accounts?edit=${selectedAsset.id}`);
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
