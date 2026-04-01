'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  PiggyBank, PlusCircle, Loader2, AlertCircle, Trash2, Pencil,
  IndianRupee, Briefcase, Clock, Calculator,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR, formatCurrency } from '@/lib/utils/formatters';
import { FamilyMemberSelector } from '@/components/shared/FamilyMemberSelector';

// ─── Types ────────────────────────────────────────────────────────────────────

interface GratuityAsset {
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

interface GratuityRow extends GratuityAsset {
  employer: string;
  joiningDate: string;
  basicSalary: number;
  yearsOfService: number;
  estimatedGratuity: number;
  status: 'estimated' | 'received' | 'pending';
  amountReceived: number;
  dateReceived: string;
  isEligible: boolean;
  yearsToEligibility: number;
  notes: string;
  memberName: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TAX_EXEMPTION_LIMIT = 2000000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeYearsOfService(joiningDate: string): number {
  if (!joiningDate) return 0;
  const join = new Date(joiningDate);
  const now = new Date();
  const diffMs = now.getTime() - join.getTime();
  return Math.max(0, parseFloat((diffMs / (365.25 * 24 * 60 * 60 * 1000)).toFixed(1)));
}

function computeGratuity(basicSalary: number, yearsOfService: number): number {
  return (basicSalary * 15 * yearsOfService) / 26;
}

function fmtDate(d: string | undefined): string {
  if (!d) return '--';
  try {
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return d;
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'estimated': return 'Estimated';
    case 'received': return 'Received';
    case 'pending': return 'Pending';
    default: return status;
  }
}

function statusColors(status: string): { bg: string; color: string } {
  switch (status) {
    case 'estimated': return { bg: 'rgba(37,99,235,0.12)', color: '#2563EB' };
    case 'received': return { bg: 'rgba(5,150,105,0.12)', color: '#059669' };
    case 'pending': return { bg: 'rgba(217,119,6,0.12)', color: '#D97706' };
    default: return { bg: 'rgba(156,163,175,0.15)', color: 'var(--wv-text-secondary)' };
  }
}

// ─── Page Component ───────────────────────────────────────────────────────────

export default function GratuityPortfolioPage() {
  const router = useRouter();
  const supabase = createClient();

  const [raw, setRaw] = useState<GratuityAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [memberMap, setMemberMap] = useState<Record<string, string>>({});
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState<GratuityRow | null>(null);
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

  // Load gratuity assets
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
        .eq('asset_type', 'gratuity');

      if (fetchErr) throw new Error(fetchErr.message);
      setRaw((data as unknown as GratuityAsset[]) || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load gratuity data');
    } finally {
      setLoading(false);
    }
  }

  // Transform raw data into rows
  const rows: GratuityRow[] = useMemo(() => {
    return raw
      .filter((a) => {
        if (selectedMemberIds.length === 0) return true;
        const userId = a.portfolios?.user_id;
        return userId ? selectedMemberIds.includes(userId) : true;
      })
      .map((a) => {
        const meta = a.metadata || {};
        const joiningDate = (meta.joining_date as string) || '';
        const basicSalary = Number(meta.basic_salary || 0);
        const storedYears = Number(meta.years_of_service || 0);
        const yearsOfService = storedYears > 0 ? storedYears : computeYearsOfService(joiningDate);
        const estimatedGratuity = computeGratuity(basicSalary, yearsOfService);
        const status = (meta.status as string) || 'estimated';
        const amountReceived = Number(meta.amount_received || 0);
        const isEligible = yearsOfService >= 5;
        const yearsToEligibility = Math.max(0, Math.ceil((5 - yearsOfService) * 10) / 10);
        const userId = a.portfolios?.user_id || '';

        return {
          ...a,
          employer: (meta.employer as string) || a.name.replace(' - Gratuity', '') || 'Unknown',
          joiningDate,
          basicSalary,
          yearsOfService,
          estimatedGratuity,
          status: status as 'estimated' | 'received' | 'pending',
          amountReceived,
          dateReceived: (meta.date_received as string) || '',
          isEligible,
          yearsToEligibility,
          notes: (meta.notes as string) || '',
          memberName: memberMap[userId] || 'Unknown',
        };
      });
  }, [raw, selectedMemberIds, memberMap]);

  // Summary calculations
  const summary = useMemo(() => {
    const estimated = rows.filter(r => r.status !== 'received');
    const received = rows.filter(r => r.status === 'received');
    const active = rows.filter(r => r.status === 'estimated');

    const totalEstimated = estimated.reduce((s, r) => s + r.estimatedGratuity, 0);
    const totalReceived = received.reduce((s, r) => s + r.amountReceived, 0);
    const activeCount = active.length;
    const avgYears = rows.length > 0
      ? parseFloat((rows.reduce((s, r) => s + r.yearsOfService, 0) / rows.length).toFixed(1))
      : 0;

    return { totalEstimated, totalReceived, activeCount, avgYears };
  }, [rows]);

  // Delete handler
  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this gratuity entry?')) return;
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
        <span className="ml-2 text-sm" style={{ color: 'var(--wv-text-secondary)' }}>Loading gratuity data...</span>
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
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#f5f3ff' }}>
            <PiggyBank className="w-5 h-5" style={{ color: '#7c3aed' }} />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--wv-text)' }}>Gratuity Portfolio</h1>
            <p className="text-xs" style={{ color: 'var(--wv-text-muted)' }}>Employment gratuity estimates and received amounts</p>
          </div>
        </div>
        <Button
          onClick={() => router.push('/add-assets/gratuity')}
          className="text-white text-sm"
          style={{ backgroundColor: '#1B2A4A' }}
        >
          <PlusCircle className="w-4 h-4 mr-1.5" />
          Add Gratuity
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
            <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Total Estimated</p>
          </div>
          <p className="text-lg font-bold" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(summary.totalEstimated)}</p>
        </div>
        <div className="wv-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <IndianRupee className="w-4 h-4" style={{ color: '#059669' }} />
            <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Total Received</p>
          </div>
          <p className="text-lg font-bold" style={{ color: '#059669' }}>{formatLargeINR(summary.totalReceived)}</p>
        </div>
        <div className="wv-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Briefcase className="w-4 h-4" style={{ color: '#C9A84C' }} />
            <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Active Employments</p>
          </div>
          <p className="text-lg font-bold" style={{ color: 'var(--wv-text)' }}>{summary.activeCount}</p>
        </div>
        <div className="wv-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4" style={{ color: '#C9A84C' }} />
            <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Avg Years of Service</p>
          </div>
          <p className="text-lg font-bold" style={{ color: 'var(--wv-text)' }}>{summary.avgYears} yrs</p>
        </div>
      </div>

      {/* Holdings - card-style layout */}
      {rows.length === 0 ? (
        <div className="wv-card p-12 text-center">
          <PiggyBank className="w-10 h-10 mx-auto mb-3" style={{ color: '#D1D5DB' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--wv-text-secondary)' }}>No gratuity entries found</p>
          <p className="text-xs mt-1" style={{ color: 'var(--wv-text-muted)' }}>Add your first gratuity estimate to start tracking</p>
          <Button
            onClick={() => router.push('/add-assets/gratuity')}
            className="mt-4 text-white text-sm"
            style={{ backgroundColor: '#1B2A4A' }}
          >
            <PlusCircle className="w-4 h-4 mr-1.5" />
            Add Gratuity
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {rows.map((row) => {
            const sc = statusColors(row.status);
            return (
              <div
                key={row.id}
                onClick={() => { setSelectedAsset(row); setSheetOpen(true); }}
                className="wv-card p-5 cursor-pointer transition-all hover:shadow-md"
                style={{ borderLeft: `4px solid ${sc.color}` }}
              >
                {/* Card header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate" style={{ color: 'var(--wv-text)' }}>{row.employer}</p>
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--wv-text-muted)' }}>{row.memberName}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                    <span
                      className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: sc.bg, color: sc.color }}
                    >
                      {statusLabel(row.status)}
                    </span>
                    <span
                      className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                      style={{
                        backgroundColor: row.isEligible ? 'rgba(5,150,105,0.12)' : 'rgba(156,163,175,0.15)',
                        color: row.isEligible ? '#059669' : '#6B7280',
                      }}
                    >
                      {row.isEligible ? 'Eligible' : `${row.yearsToEligibility} more yrs`}
                    </span>
                  </div>
                </div>

                {/* Card body */}
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Years of Service</p>
                    <p className="text-sm font-semibold mt-0.5" style={{ color: 'var(--wv-text)' }}>{row.yearsOfService} yrs</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Basic + DA/mo</p>
                    <p className="text-sm font-semibold mt-0.5" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(row.basicSalary)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>
                      {row.status === 'received' ? 'Received' : 'Est. Gratuity'}
                    </p>
                    <p className="text-sm font-bold mt-0.5" style={{ color: row.status === 'received' ? '#059669' : '#1B2A4A' }}>
                      {formatLargeINR(row.status === 'received' ? row.amountReceived : row.estimatedGratuity)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="overflow-y-auto w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle style={{ color: 'var(--wv-text)' }}>Gratuity Details</SheetTitle>
            <SheetDescription>
              {selectedAsset?.employer}
            </SheetDescription>
          </SheetHeader>

          {selectedAsset && (
            <div className="mt-6 space-y-4">
              {/* Employment info grid */}
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
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Date of Joining</p>
                  <p className="text-sm font-medium" style={{ color: 'var(--wv-text)' }}>{fmtDate(selectedAsset.joiningDate)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Years of Service</p>
                  <p className="text-sm font-medium" style={{ color: 'var(--wv-text)' }}>{selectedAsset.yearsOfService} yrs</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Basic + DA / month</p>
                  <p className="text-sm font-medium" style={{ color: 'var(--wv-text)' }}>{formatCurrency(selectedAsset.basicSalary)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Status</p>
                  <span
                    className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor: statusColors(selectedAsset.status).bg,
                      color: statusColors(selectedAsset.status).color,
                    }}
                  >
                    {statusLabel(selectedAsset.status)}
                  </span>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Eligibility</p>
                  <span
                    className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor: selectedAsset.isEligible ? 'rgba(5,150,105,0.12)' : 'rgba(156,163,175,0.15)',
                      color: selectedAsset.isEligible ? '#059669' : '#6B7280',
                    }}
                  >
                    {selectedAsset.isEligible ? 'Eligible' : `Not yet eligible (${selectedAsset.yearsToEligibility} more years)`}
                  </span>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Last Updated</p>
                  <p className="text-sm font-medium" style={{ color: 'var(--wv-text)' }}>{fmtDate(selectedAsset.last_updated)}</p>
                </div>
                {selectedAsset.status === 'received' && (
                  <>
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Amount Received</p>
                      <p className="text-sm font-bold" style={{ color: '#059669' }}>{formatCurrency(selectedAsset.amountReceived)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Date Received</p>
                      <p className="text-sm font-medium" style={{ color: 'var(--wv-text)' }}>{fmtDate(selectedAsset.dateReceived)}</p>
                    </div>
                  </>
                )}
                {selectedAsset.notes && (
                  <div className="col-span-2">
                    <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--wv-text-muted)' }}>Notes</p>
                    <p className="text-sm" style={{ color: '#374151' }}>{selectedAsset.notes}</p>
                  </div>
                )}
              </div>

              {/* Gratuity calculation breakdown */}
              <div className="rounded-xl p-4 space-y-3" style={{ backgroundColor: 'var(--wv-surface-2)', border: '1px solid var(--wv-border)' }}>
                <div className="flex items-center gap-2">
                  <Calculator className="w-4 h-4" style={{ color: '#C9A84C' }} />
                  <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--wv-text-secondary)' }}>
                    Gratuity Calculation
                  </span>
                </div>

                <div className="text-xs rounded-lg p-3" style={{ backgroundColor: 'var(--wv-surface)', border: '1px solid var(--wv-border)' }}>
                  <p className="font-medium mb-1" style={{ color: 'var(--wv-text)' }}>Formula: (Basic + DA) x 15 x Years / 26</p>
                  <p style={{ color: 'var(--wv-text-secondary)' }}>
                    {formatCurrency(selectedAsset.basicSalary)} x 15 x {selectedAsset.yearsOfService} yrs / 26 ={' '}
                    <span className="font-bold" style={{ color: 'var(--wv-text)' }}>
                      {formatCurrency(Math.round(selectedAsset.estimatedGratuity))}
                    </span>
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-y-2 gap-x-6 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Estimated</span>
                    <span className="font-bold" style={{ color: 'var(--wv-text)' }}>{formatCurrency(Math.round(selectedAsset.estimatedGratuity))}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Tax Exemption</span>
                    <span className="font-medium" style={{ color: '#C9A84C' }}>Up to {formatLargeINR(TAX_EXEMPTION_LIMIT)}</span>
                  </div>
                  <div className="flex justify-between col-span-2">
                    <span className="text-gray-500">Taxable Portion</span>
                    <span className="font-medium" style={{ color: selectedAsset.estimatedGratuity > TAX_EXEMPTION_LIMIT ? '#DC2626' : '#059669' }}>
                      {selectedAsset.estimatedGratuity > TAX_EXEMPTION_LIMIT
                        ? formatCurrency(Math.round(selectedAsset.estimatedGratuity - TAX_EXEMPTION_LIMIT))
                        : 'Nil'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  className="flex-1 text-sm"
                  onClick={() => {
                    setSheetOpen(false);
                    router.push(`/add-assets/gratuity?edit=${selectedAsset.id}`);
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
