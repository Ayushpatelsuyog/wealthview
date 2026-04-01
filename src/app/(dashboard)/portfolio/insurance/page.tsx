'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Shield, PlusCircle, Loader2, Trash2, Calendar, IndianRupee, FileCheck, Clock } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR } from '@/lib/utils/formatters';
import { FamilyMemberSelector } from '@/components/shared/FamilyMemberSelector';

// ─── Types ────────────────────────────────────────────────────────────────────

type InsuranceCategory = 'life_term' | 'life_guaranteed' | 'life_ulip' | 'health' | 'vehicle' | 'property';

interface InsurancePolicy {
  id: string;
  user_id: string;
  family_id: string;
  category: InsuranceCategory;
  provider: string;
  policy_name: string;
  policy_number: string | null;
  sum_assured: number;
  premium: number;
  premium_frequency: string;
  start_date: string;
  maturity_date: string;
  metadata: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
}

interface PolicyRow extends InsurancePolicy {
  status: 'Active' | 'Expiring Soon' | 'Expired';
  nextDue: Date | null;
  nextDueLabel: string;
  memberName: string;
  annualPremium: number;
}

type TabFilter = 'all' | 'life' | 'health' | 'vehicle' | 'property';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCategoryLabel(cat: InsuranceCategory): string {
  const map: Record<InsuranceCategory, string> = {
    life_term: 'Life Term',
    life_guaranteed: 'Life Guaranteed',
    life_ulip: 'Life ULIP',
    health: 'Health',
    vehicle: 'Vehicle',
    property: 'Property',
  };
  return map[cat] || cat;
}

function getCategoryTab(cat: InsuranceCategory): TabFilter {
  if (cat === 'life_term' || cat === 'life_guaranteed' || cat === 'life_ulip') return 'life';
  if (cat === 'health') return 'health';
  if (cat === 'vehicle') return 'vehicle';
  if (cat === 'property') return 'property';
  return 'all';
}

function getPolicyStatus(maturityDate: string): 'Active' | 'Expiring Soon' | 'Expired' {
  if (!maturityDate) return 'Active';
  const now = Date.now();
  const end = new Date(maturityDate).getTime();
  if (end < now) return 'Expired';
  const daysLeft = Math.ceil((end - now) / (24 * 3600 * 1000));
  if (daysLeft <= 30) return 'Expiring Soon';
  return 'Active';
}

function statusStyle(status: string): { bg: string; text: string } {
  switch (status) {
    case 'Active':        return { bg: 'rgba(5,150,105,0.12)', text: '#059669' };
    case 'Expiring Soon': return { bg: 'rgba(217,119,6,0.12)', text: '#D97706' };
    case 'Expired':       return { bg: 'rgba(220,38,38,0.12)', text: '#DC2626' };
    default:              return { bg: '#F3F4F6', text: '#6B7280' };
  }
}

function computeNextDue(startDate: string, frequency: string): Date | null {
  if (!startDate || frequency === 'Single') return null;
  const start = new Date(startDate);
  if (isNaN(start.getTime())) return null;

  const now = new Date();
  let next = new Date(start);

  const incrementMonths = (d: Date, months: number) => {
    const result = new Date(d);
    result.setMonth(result.getMonth() + months);
    return result;
  };

  let monthInterval = 12; // default Annual
  if (frequency === 'Monthly') monthInterval = 1;
  else if (frequency === 'Quarterly') monthInterval = 3;
  else if (frequency === 'Half-Yearly') monthInterval = 6;
  else if (frequency === 'Annual') monthInterval = 12;

  // Walk forward from start date until we find a future due date
  let iterations = 0;
  while (next <= now && iterations < 1200) {
    next = incrementMonths(next, monthInterval);
    iterations++;
  }

  return next;
}

function computeAnnualPremium(premium: number, frequency: string): number {
  if (frequency === 'Monthly') return premium * 12;
  if (frequency === 'Quarterly') return premium * 4;
  if (frequency === 'Half-Yearly') return premium * 2;
  if (frequency === 'Single') return 0;
  return premium; // Annual
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '--';
  try {
    return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return '--';
  }
}

function formatDateShort(date: Date | null): string {
  if (!date) return '--';
  try {
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return '--';
  }
}

function formatINRFull(amount: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
}

// ─── Page Component ───────────────────────────────────────────────────────────

export default function InsurancePortfolioPage() {
  const router = useRouter();
  const supabase = createClient();

  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeMemberIds, setActiveMemberIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<TabFilter>('all');
  const [selectedPolicy, setSelectedPolicy] = useState<PolicyRow | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // ── Data fetch ──────────────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('insurance_policies')
          .select('*')
          .eq('is_active', true)
          .order('created_at', { ascending: false });

        if (error) throw error;
        if (!data || data.length === 0) {
          setPolicies([]);
          setLoading(false);
          return;
        }

        // Resolve member names
        const userIds = Array.from(new Set(data.map((d: InsurancePolicy) => d.user_id).filter(Boolean)));
        let nameMap: Record<string, string> = {};
        if (userIds.length > 0) {
          const { data: users } = await supabase.from('users').select('id, name').in('id', userIds);
          if (users) nameMap = Object.fromEntries(users.map(u => [u.id, u.name || u.id.slice(0, 8)]));
        }

        const rows: PolicyRow[] = (data as InsurancePolicy[]).map((p) => {
          const status = getPolicyStatus(p.maturity_date);
          const nextDue = status !== 'Expired' ? computeNextDue(p.start_date, p.premium_frequency) : null;
          const annualPremium = computeAnnualPremium(p.premium, p.premium_frequency);

          return {
            ...p,
            status,
            nextDue,
            nextDueLabel: nextDue ? formatDateShort(nextDue) : (p.premium_frequency === 'Single' ? 'Paid' : '--'),
            memberName: nameMap[p.user_id] ?? '',
            annualPremium,
          };
        });

        setPolicies(rows);
      } catch (err) {
        console.error('Failed to load insurance policies:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Filtered data ───────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let result = policies;

    // Filter by member
    if (activeMemberIds.length > 0) {
      result = result.filter(p => activeMemberIds.includes(p.user_id));
    }

    // Filter by tab
    if (activeTab !== 'all') {
      result = result.filter(p => getCategoryTab(p.category) === activeTab);
    }

    return result;
  }, [policies, activeMemberIds, activeTab]);

  // ── Aggregates ──────────────────────────────────────────────────────────────

  const totalCoverage = useMemo(() => filtered.reduce((s, p) => s + p.sum_assured, 0), [filtered]);
  const annualPremiumOutflow = useMemo(() => filtered.reduce((s, p) => s + p.annualPremium, 0), [filtered]);
  const activePolicies = useMemo(() => filtered.filter(p => p.status === 'Active' || p.status === 'Expiring Soon').length, [filtered]);
  const nextPremiumDue = useMemo(() => {
    const futureDues = filtered
      .filter(p => p.nextDue && p.status !== 'Expired')
      .map(p => p.nextDue!)
      .sort((a, b) => a.getTime() - b.getTime());
    return futureDues.length > 0 ? futureDues[0] : null;
  }, [filtered]);

  // ── Delete handler (soft delete) ──────────────────────────────────────────

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to remove this policy?')) return;
    setDeleting(true);
    try {
      const { error } = await supabase
        .from('insurance_policies')
        .update({ is_active: false })
        .eq('id', id);
      if (error) throw error;
      setPolicies(prev => prev.filter(p => p.id !== id));
      setSheetOpen(false);
      setSelectedPolicy(null);
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Failed to remove policy. Please try again.');
    } finally {
      setDeleting(false);
    }
  }

  // ── Row click ───────────────────────────────────────────────────────────────

  function openDetail(policy: PolicyRow) {
    setSelectedPolicy(policy);
    setSheetOpen(true);
  }

  // ── Build metadata display items ──────────────────────────────────────────

  function getMetadataItems(policy: PolicyRow): { label: string; value: string }[] {
    const items: { label: string; value: string }[] = [];
    const meta = policy.metadata ?? {};

    // Nominee info
    if (meta.nominee_name) items.push({ label: 'Nominee', value: String(meta.nominee_name) });
    if (meta.nominee_relationship) items.push({ label: 'Nominee Relationship', value: String(meta.nominee_relationship) });

    // Life Term
    if (meta.term_years) items.push({ label: 'Term (Years)', value: String(meta.term_years) });
    if (meta.riders && Array.isArray(meta.riders) && meta.riders.length > 0) {
      items.push({ label: 'Riders', value: (meta.riders as string[]).join(', ') });
    }

    // Life ULIP
    if (meta.fund_value) items.push({ label: 'Fund Value', value: formatINRFull(Number(meta.fund_value)) });
    if (meta.fund_options) items.push({ label: 'Fund Options', value: String(meta.fund_options) });

    // Health
    if (meta.plan_type) items.push({ label: 'Plan Type', value: String(meta.plan_type) });
    if (meta.room_rent_limit) items.push({ label: 'Room Rent Limit', value: String(meta.room_rent_limit) });
    if (meta.co_pay_percent !== undefined && meta.co_pay_percent !== null) items.push({ label: 'Co-pay', value: `${meta.co_pay_percent}%` });
    if (meta.ncb_percent !== undefined && meta.ncb_percent !== null) items.push({ label: 'No Claim Bonus', value: `${meta.ncb_percent}%` });

    // Vehicle
    if (meta.vehicle_type) items.push({ label: 'Vehicle Type', value: String(meta.vehicle_type) });
    if (meta.make) items.push({ label: 'Make', value: String(meta.make) });
    if (meta.model) items.push({ label: 'Model', value: String(meta.model) });
    if (meta.year) items.push({ label: 'Year', value: String(meta.year) });
    if (meta.reg_number) items.push({ label: 'Reg. Number', value: String(meta.reg_number) });
    if (meta.idv) items.push({ label: 'IDV', value: formatINRFull(Number(meta.idv)) });
    if (meta.insurance_type) items.push({ label: 'Insurance Type', value: String(meta.insurance_type) });

    // Property
    if (meta.cover_type) items.push({ label: 'Cover Type', value: String(meta.cover_type) });
    if (meta.structure_value) items.push({ label: 'Structure Value', value: formatINRFull(Number(meta.structure_value)) });
    if (meta.contents_value) items.push({ label: 'Contents Value', value: formatINRFull(Number(meta.contents_value)) });

    return items;
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: '#1B2A4A' }}>
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold" style={{ color: '#1B2A4A' }}>Insurance</h1>
            <p className="text-xs" style={{ color: '#9CA3AF' }}>Track all your insurance policies in one place</p>
          </div>
        </div>
        <Button
          onClick={() => router.push('/add-assets/insurance')}
          className="gap-2 text-sm font-medium"
          style={{ backgroundColor: '#1B2A4A', color: 'white' }}
        >
          <PlusCircle className="w-4 h-4" />
          Add Policy
        </Button>
      </div>

      {/* Family Member Selector */}
      <div className="wv-card p-4">
        <FamilyMemberSelector
          onSelectionChange={(ids) => setActiveMemberIds(ids)}
          compact
        />
      </div>

      {/* Tab Filters */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabFilter)}>
        <TabsList className="w-full justify-start bg-transparent gap-1 p-0">
          {[
            { key: 'all' as TabFilter, label: 'All' },
            { key: 'life' as TabFilter, label: 'Life' },
            { key: 'health' as TabFilter, label: 'Health' },
            { key: 'vehicle' as TabFilter, label: 'Vehicle' },
            { key: 'property' as TabFilter, label: 'Property' },
          ].map(tab => (
            <TabsTrigger
              key={tab.key}
              value={tab.key}
              className="px-4 py-2 rounded-full text-xs font-semibold border data-[state=active]:border-transparent data-[state=inactive]:border-gray-200"
              style={{
                backgroundColor: activeTab === tab.key ? '#1B2A4A' : 'transparent',
                color: activeTab === tab.key ? 'white' : '#6B7280',
              }}
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#C9A84C' }} />
          <span className="ml-3 text-sm" style={{ color: '#9CA3AF' }}>Loading policies...</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && policies.length === 0 && (
        <div className="wv-card p-12 text-center">
          <Shield className="w-12 h-12 mx-auto mb-4" style={{ color: '#C9A84C' }} />
          <h3 className="text-lg font-semibold mb-2" style={{ color: '#1B2A4A' }}>No Insurance Policies Yet</h3>
          <p className="text-sm mb-6" style={{ color: '#9CA3AF' }}>Start tracking your insurance by adding your first policy.</p>
          <Button
            onClick={() => router.push('/add-assets/insurance')}
            className="gap-2"
            style={{ backgroundColor: '#1B2A4A', color: 'white' }}
          >
            <PlusCircle className="w-4 h-4" />
            Add Policy
          </Button>
        </div>
      )}

      {/* No results for filter */}
      {!loading && policies.length > 0 && filtered.length === 0 && (
        <div className="wv-card p-8 text-center">
          <p className="text-sm" style={{ color: '#9CA3AF' }}>No policies found for this filter.</p>
        </div>
      )}

      {/* Summary Cards + Table */}
      {!loading && filtered.length > 0 && (
        <>
          {/* ── Summary Cards ──────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="wv-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <Shield className="w-3.5 h-3.5" style={{ color: '#9CA3AF' }} />
                <p className="text-[10px] uppercase tracking-wider" style={{ color: '#9CA3AF' }}>Total Coverage</p>
              </div>
              <p className="font-display text-lg font-semibold" style={{ color: '#1B2A4A' }}>{formatLargeINR(totalCoverage)}</p>
            </div>
            <div className="wv-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <IndianRupee className="w-3.5 h-3.5" style={{ color: '#9CA3AF' }} />
                <p className="text-[10px] uppercase tracking-wider" style={{ color: '#9CA3AF' }}>Annual Premium</p>
              </div>
              <p className="font-display text-lg font-semibold" style={{ color: '#DC2626' }}>-{formatLargeINR(annualPremiumOutflow)}</p>
            </div>
            <div className="wv-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <FileCheck className="w-3.5 h-3.5" style={{ color: '#9CA3AF' }} />
                <p className="text-[10px] uppercase tracking-wider" style={{ color: '#9CA3AF' }}>Active Policies</p>
              </div>
              <p className="font-display text-lg font-semibold" style={{ color: '#1B2A4A' }}>{activePolicies}</p>
            </div>
            <div className="wv-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-3.5 h-3.5" style={{ color: '#9CA3AF' }} />
                <p className="text-[10px] uppercase tracking-wider" style={{ color: '#9CA3AF' }}>Next Premium Due</p>
              </div>
              <p className="font-display text-sm font-semibold" style={{ color: nextPremiumDue ? '#D97706' : '#1B2A4A' }}>
                {nextPremiumDue ? formatDateShort(nextPremiumDue) : '--'}
              </p>
            </div>
          </div>

          {/* ── Policies Table ─────────────────────────────────────────────────── */}
          <div className="wv-card overflow-hidden">
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr style={{ borderBottom: '1px solid #E8E5DD' }}>
                    {['Policy Name', 'Provider', 'Type', 'Cover Amount', 'Premium', 'Frequency', 'Next Due', 'Status'].map((h) => (
                      <th key={h} className="px-4 py-3 text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap" style={{ color: '#9CA3AF' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((policy) => {
                    const st = statusStyle(policy.status);
                    return (
                      <tr
                        key={policy.id}
                        onClick={() => openDetail(policy)}
                        className="cursor-pointer transition-colors hover:bg-gray-50"
                        style={{ borderBottom: '1px solid #F3F4F6' }}
                      >
                        <td className="px-4 py-3">
                          <p className="text-xs font-semibold" style={{ color: '#1A1A2E' }}>{policy.policy_name}</p>
                          {policy.memberName && <p className="text-[10px]" style={{ color: '#9CA3AF' }}>{policy.memberName}</p>}
                        </td>
                        <td className="px-4 py-3 text-xs" style={{ color: '#4B5563' }}>{policy.provider}</td>
                        <td className="px-4 py-3">
                          <span
                            className="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
                            style={{ backgroundColor: 'rgba(27,42,74,0.08)', color: '#1B2A4A' }}
                          >
                            {getCategoryLabel(policy.category)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs font-medium tabular-nums" style={{ color: '#1A1A2E' }}>{formatLargeINR(policy.sum_assured)}</td>
                        <td className="px-4 py-3 text-xs font-medium tabular-nums" style={{ color: '#1A1A2E' }}>{formatLargeINR(policy.premium)}</td>
                        <td className="px-4 py-3 text-xs" style={{ color: '#4B5563' }}>{policy.premium_frequency}</td>
                        <td className="px-4 py-3 text-xs tabular-nums" style={{ color: policy.nextDue ? '#D97706' : '#4B5563' }}>
                          {policy.nextDueLabel}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className="text-[10px] font-semibold px-2 py-1 rounded-full whitespace-nowrap"
                            style={{ backgroundColor: st.bg, color: st.text }}
                          >
                            {policy.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile card layout */}
            <div className="md:hidden divide-y" style={{ borderColor: '#F3F4F6' }}>
              {filtered.map((policy) => {
                const st = statusStyle(policy.status);
                return (
                  <div
                    key={policy.id}
                    onClick={() => openDetail(policy)}
                    className="p-4 cursor-pointer transition-colors hover:bg-gray-50"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="text-sm font-semibold" style={{ color: '#1A1A2E' }}>{policy.policy_name}</p>
                        <p className="text-[10px]" style={{ color: '#9CA3AF' }}>
                          {policy.provider} {policy.memberName ? `· ${policy.memberName}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span
                          className="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
                          style={{ backgroundColor: 'rgba(27,42,74,0.08)', color: '#1B2A4A' }}
                        >
                          {getCategoryLabel(policy.category)}
                        </span>
                        <span
                          className="text-[10px] font-semibold px-2 py-1 rounded-full whitespace-nowrap"
                          style={{ backgroundColor: st.bg, color: st.text }}
                        >
                          {policy.status}
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-[10px] uppercase" style={{ color: '#9CA3AF' }}>Cover</p>
                        <p className="text-xs font-semibold tabular-nums" style={{ color: '#1B2A4A' }}>{formatLargeINR(policy.sum_assured)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase" style={{ color: '#9CA3AF' }}>Premium</p>
                        <p className="text-xs font-medium tabular-nums" style={{ color: '#1A1A2E' }}>{formatLargeINR(policy.premium)} / {policy.premium_frequency}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase" style={{ color: '#9CA3AF' }}>Next Due</p>
                        <p className="text-xs tabular-nums" style={{ color: '#D97706' }}>{policy.nextDueLabel}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase" style={{ color: '#9CA3AF' }}>End Date</p>
                        <p className="text-xs tabular-nums" style={{ color: '#4B5563' }}>{formatDate(policy.maturity_date)}</p>
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
          {selectedPolicy && (
            <div className="space-y-6 pt-2">
              {/* Header */}
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#1B2A4A' }}>
                    <Shield className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold" style={{ color: '#1B2A4A' }}>{selectedPolicy.policy_name}</h2>
                    <p className="text-xs" style={{ color: '#9CA3AF' }}>{selectedPolicy.provider}</p>
                  </div>
                </div>
                {selectedPolicy.memberName && (
                  <p className="text-xs mt-1" style={{ color: '#9CA3AF' }}>Held by: {selectedPolicy.memberName}</p>
                )}
              </div>

              {/* Status & Category */}
              <div className="flex items-center gap-2">
                {(() => {
                  const st = statusStyle(selectedPolicy.status);
                  return (
                    <span
                      className="text-[11px] font-semibold px-3 py-1 rounded-full"
                      style={{ backgroundColor: st.bg, color: st.text }}
                    >
                      {selectedPolicy.status}
                    </span>
                  );
                })()}
                <span
                  className="text-[11px] font-semibold px-3 py-1 rounded-full"
                  style={{ backgroundColor: 'rgba(27,42,74,0.08)', color: '#1B2A4A' }}
                >
                  {getCategoryLabel(selectedPolicy.category)}
                </span>
              </div>

              {/* Policy Details */}
              <div className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#9CA3AF' }}>Policy Details</h3>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Policy Number', value: selectedPolicy.policy_number || '--' },
                    { label: 'Category', value: getCategoryLabel(selectedPolicy.category) },
                    { label: 'Sum Assured', value: formatINRFull(selectedPolicy.sum_assured) },
                    { label: 'Premium', value: formatINRFull(selectedPolicy.premium) },
                    { label: 'Frequency', value: selectedPolicy.premium_frequency },
                    { label: 'Annual Premium', value: formatINRFull(selectedPolicy.annualPremium) },
                    { label: 'Start Date', value: formatDate(selectedPolicy.start_date) },
                    { label: 'End Date', value: formatDate(selectedPolicy.maturity_date) },
                  ].map((item) => (
                    <div key={item.label}>
                      <p className="text-[10px] uppercase tracking-wider" style={{ color: '#9CA3AF' }}>{item.label}</p>
                      <p className="text-sm font-medium" style={{ color: '#1A1A2E' }}>{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Next Premium Due */}
              {selectedPolicy.nextDue && selectedPolicy.status !== 'Expired' && (
                <div className="wv-card p-4">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4" style={{ color: '#D97706' }} />
                      <span className="text-xs font-medium" style={{ color: '#4B5563' }}>Next Premium Due</span>
                    </div>
                    <span className="text-sm font-semibold" style={{ color: '#D97706' }}>
                      {formatDateShort(selectedPolicy.nextDue)}
                    </span>
                  </div>
                </div>
              )}

              {/* Type-Specific Details */}
              {(() => {
                const items = getMetadataItems(selectedPolicy);
                if (items.length === 0) return null;
                return (
                  <div className="space-y-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#9CA3AF' }}>
                      {getCategoryLabel(selectedPolicy.category)} Details
                    </h3>
                    <div className="space-y-2">
                      {items.map((item) => (
                        <div key={item.label} className="flex justify-between items-center p-2 rounded-lg" style={{ backgroundColor: 'rgba(27,42,74,0.03)' }}>
                          <span className="text-xs" style={{ color: '#9CA3AF' }}>{item.label}</span>
                          <span className="text-xs font-medium text-right max-w-[60%]" style={{ color: '#1A1A2E' }}>{item.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Actions */}
              <div className="flex gap-3 pt-2" style={{ borderTop: '1px solid #E8E5DD' }}>
                <Button
                  onClick={() => handleDelete(selectedPolicy.id)}
                  variant="outline"
                  className="flex-1 gap-2 text-sm"
                  style={{ borderColor: '#DC2626', color: '#DC2626' }}
                  disabled={deleting}
                >
                  {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  Remove Policy
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
