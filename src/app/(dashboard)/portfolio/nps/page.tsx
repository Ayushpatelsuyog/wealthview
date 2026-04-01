'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Shield, PlusCircle, Loader2, AlertCircle, Trash2, Pencil,
  IndianRupee, TrendingUp, TrendingDown, Building2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR, formatCurrency } from '@/lib/utils/formatters';
import { FamilyMemberSelector } from '@/components/shared/FamilyMemberSelector';

// ─── Types ────────────────────────────────────────────────────────────────────

interface NPSAsset {
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

interface NPSRow extends NPSAsset {
  pran: string;
  tier: string;
  fundManager: string;
  totalContribution: number;
  value: number;
  employerContribution: number;
  returns: number;
  returnsPercent: number;
  eligible80CCD1: number;
  eligible80CCD1B: number;
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

export default function NPSPortfolioPage() {
  const router = useRouter();
  const supabase = createClient();

  const [raw, setRaw] = useState<NPSAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [memberMap, setMemberMap] = useState<Record<string, string>>({});
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<NPSRow | null>(null);
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

  // Load NPS assets
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
        .eq('asset_type', 'nps');

      if (fetchErr) throw new Error(fetchErr.message);
      setRaw((data as unknown as NPSAsset[]) || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load NPS data');
    } finally {
      setLoading(false);
    }
  }

  // Transform raw data into rows
  const rows: NPSRow[] = useMemo(() => {
    return raw
      .filter((a) => {
        if (selectedMemberIds.length === 0) return true;
        const userId = a.portfolios?.user_id;
        return userId ? selectedMemberIds.includes(userId) : true;
      })
      .map((a) => {
        const meta = a.metadata || {};
        const totalContribution = Number(meta.total_contribution || 0);
        const value = Number(a.current_value || 0);
        const employerContribution = Number(meta.employer_contribution || 0);
        const returns = Number(meta.returns ?? (value - totalContribution));
        const returnsPercent = totalContribution > 0
          ? Number(meta.returns_percent ?? ((returns / totalContribution) * 100))
          : 0;
        const selfContribution = totalContribution - employerContribution;
        const eligible80CCD1 = Number(meta.eligible_80ccd1 ?? Math.min(selfContribution, 150000));
        const eligible80CCD1B = Number(meta.eligible_80ccd1b ?? Math.min(Math.max(selfContribution - 150000, 0), 50000));
        const userId = a.portfolios?.user_id || '';

        return {
          ...a,
          pran: (meta.pran as string) || '--',
          tier: (meta.tier as string) || 'I',
          fundManager: (meta.fund_manager as string) || a.name.replace('NPS - ', '') || 'Unknown',
          totalContribution,
          value,
          employerContribution,
          returns,
          returnsPercent,
          eligible80CCD1,
          eligible80CCD1B,
          notes: (meta.notes as string) || '',
          memberName: memberMap[userId] || 'Unknown',
        };
      });
  }, [raw, selectedMemberIds, memberMap]);

  // Summary calculations
  const summary = useMemo(() => {
    const totalValue = rows.reduce((s, r) => s + r.value, 0);
    const totalContributions = rows.reduce((s, r) => s + r.totalContribution, 0);
    const totalReturns = rows.reduce((s, r) => s + r.returns, 0);
    const accountCount = rows.length;
    return { totalValue, totalContributions, totalReturns, accountCount };
  }, [rows]);

  // Delete handler
  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this NPS account?')) return;
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
        <span className="ml-2 text-sm" style={{ color: 'var(--wv-text-secondary)' }}>Loading NPS accounts...</span>
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
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#fef2f2' }}>
            <Shield className="w-5 h-5" style={{ color: '#dc2626' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--wv-text)' }}>NPS Portfolio</h1>
            <p className="text-xs" style={{ color: 'var(--wv-text-muted)' }}>National Pension System accounts</p>
          </div>
        </div>
        <Button
          onClick={() => router.push('/add-assets/nps')}
          className="text-white text-sm"
          style={{ backgroundColor: '#1B2A4A' }}
        >
          <PlusCircle className="w-4 h-4 mr-1.5" />
          Add NPS
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
            <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Total Value</p>
          </div>
          <p className="text-lg font-bold" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(summary.totalValue)}</p>
        </div>
        <div className="wv-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <IndianRupee className="w-4 h-4" style={{ color: '#C9A84C' }} />
            <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Contributions</p>
          </div>
          <p className="text-lg font-bold" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(summary.totalContributions)}</p>
        </div>
        <div className="wv-card p-4">
          <div className="flex items-center gap-2 mb-2">
            {summary.totalReturns >= 0
              ? <TrendingUp className="w-4 h-4" style={{ color: '#059669' }} />
              : <TrendingDown className="w-4 h-4" style={{ color: '#DC2626' }} />
            }
            <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Returns</p>
          </div>
          <p className="text-lg font-bold" style={{ color: summary.totalReturns >= 0 ? '#059669' : '#DC2626' }}>
            {formatLargeINR(summary.totalReturns)}
          </p>
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
          <Shield className="w-10 h-10 mx-auto mb-3" style={{ color: '#D1D5DB' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--wv-text-secondary)' }}>No NPS accounts found</p>
          <p className="text-xs mt-1" style={{ color: 'var(--wv-text-muted)' }}>Add your first NPS account to start tracking</p>
          <Button
            onClick={() => router.push('/add-assets/nps')}
            className="mt-4 text-white text-sm"
            style={{ backgroundColor: '#1B2A4A' }}
          >
            <PlusCircle className="w-4 h-4 mr-1.5" />
            Add NPS Account
          </Button>
        </div>
      ) : (
        <div className="wv-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ backgroundColor: 'var(--wv-surface-2)' }}>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>PRAN</th>
                  <th className="text-center px-4 py-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Tier</th>
                  <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Fund Manager</th>
                  <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Contribution</th>
                  <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Current Value</th>
                  <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Returns</th>
                  <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Returns %</th>
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
                      <p className="font-medium text-sm" style={{ color: 'var(--wv-text)' }}>{row.pran}</p>
                      <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>{row.memberName}</p>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                        style={{
                          backgroundColor: row.tier === 'I' ? 'rgba(37,99,235,0.12)' : 'rgba(124,58,237,0.12)',
                          color: row.tier === 'I' ? '#2563EB' : '#7C3AED',
                        }}
                      >
                        Tier {row.tier}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm" style={{ color: '#374151' }}>{row.fundManager}</td>
                    <td className="px-4 py-3 text-sm text-right" style={{ color: '#374151' }}>{formatLargeINR(row.totalContribution)}</td>
                    <td className="px-4 py-3 text-sm text-right font-semibold" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(row.value)}</td>
                    <td className="px-4 py-3 text-sm text-right font-semibold" style={{ color: row.returns >= 0 ? '#059669' : '#DC2626' }}>
                      {formatLargeINR(row.returns)}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-semibold" style={{ color: row.returnsPercent >= 0 ? '#059669' : '#DC2626' }}>
                      {row.returnsPercent >= 0 ? '+' : ''}{row.returnsPercent.toFixed(2)}%
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
            <SheetTitle style={{ color: 'var(--wv-text)' }}>NPS Account Details</SheetTitle>
            <SheetDescription>
              {selectedAsset?.fundManager} — Tier {selectedAsset?.tier}
            </SheetDescription>
          </SheetHeader>

          {selectedAsset && (
            <div className="mt-6 space-y-4">
              {/* Info grid */}
              <div className="wv-card p-4 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>PRAN</p>
                  <p className="text-sm font-medium" style={{ color: 'var(--wv-text)' }}>{selectedAsset.pran}</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Member</p>
                  <p className="text-sm font-medium" style={{ color: 'var(--wv-text)' }}>{selectedAsset.memberName}</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>NPS Tier</p>
                  <span
                    className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor: selectedAsset.tier === 'I' ? 'rgba(37,99,235,0.12)' : 'rgba(124,58,237,0.12)',
                      color: selectedAsset.tier === 'I' ? '#2563EB' : '#7C3AED',
                    }}
                  >
                    Tier {selectedAsset.tier}
                  </span>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Fund Manager</p>
                  <p className="text-sm font-medium" style={{ color: 'var(--wv-text)' }}>{selectedAsset.fundManager}</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Total Contribution</p>
                  <p className="text-sm font-medium" style={{ color: 'var(--wv-text)' }}>{formatCurrency(selectedAsset.totalContribution)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Current Value</p>
                  <p className="text-sm font-bold" style={{ color: 'var(--wv-text)' }}>{formatCurrency(selectedAsset.value)}</p>
                </div>
                {selectedAsset.employerContribution > 0 && (
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Employer Contribution</p>
                    <p className="text-sm font-medium" style={{ color: 'var(--wv-text)' }}>{formatCurrency(selectedAsset.employerContribution)}</p>
                  </div>
                )}
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Returns</p>
                  <p className="text-sm font-bold" style={{ color: selectedAsset.returns >= 0 ? '#059669' : '#DC2626' }}>
                    {formatCurrency(selectedAsset.returns)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Returns %</p>
                  <p className="text-sm font-bold" style={{ color: selectedAsset.returnsPercent >= 0 ? '#059669' : '#DC2626' }}>
                    {selectedAsset.returnsPercent >= 0 ? '+' : ''}{selectedAsset.returnsPercent.toFixed(2)}%
                  </p>
                </div>
              </div>

              {/* Tax benefits breakdown */}
              <div className="rounded-xl p-4 space-y-3" style={{ backgroundColor: 'var(--wv-surface-2)', border: '1px solid var(--wv-border)' }}>
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--wv-text-secondary)' }}>
                  Tax Benefits
                </span>
                <div className="grid grid-cols-1 gap-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Sec 80CCD(1) — up to &#8377;1.5L</span>
                    <span className="font-medium" style={{ color: '#C9A84C' }}>{formatCurrency(selectedAsset.eligible80CCD1)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Sec 80CCD(1B) — extra &#8377;50K</span>
                    <span className="font-medium" style={{ color: '#C9A84C' }}>{formatCurrency(selectedAsset.eligible80CCD1B)}</span>
                  </div>
                  <div className="flex justify-between pt-1" style={{ borderTop: '1px solid var(--wv-border)' }}>
                    <span className="text-gray-500 font-medium">Total Tax Benefit</span>
                    <span className="font-bold" style={{ color: '#C9A84C' }}>
                      {formatCurrency(selectedAsset.eligible80CCD1 + selectedAsset.eligible80CCD1B)}
                    </span>
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
                    router.push(`/add-assets/nps?edit=${selectedAsset.id}`);
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
