'use client';

import { useState, useEffect } from 'react';
import {
  FileText,
  Table2,
  Calculator,
  ClipboardList,
  Shield,
  Calendar,
  Loader2,
  Download,
  X,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createClient } from '@/lib/supabase/client';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Toast {
  type: 'success' | 'error';
  message: string;
}

interface FamilyOption {
  id: string;
  name: string;
}

interface MemberOption {
  id: string;
  name: string;
  email: string;
}

type ReportKey =
  | 'portfolio-summary'
  | 'transaction-history'
  | 'capital-gains'
  | 'holdings-statement'
  | 'insurance-summary'
  | 'monthly-digest';

interface ReportDef {
  key: ReportKey;
  title: string;
  description: string;
  icon: React.ElementType;
  format: 'pdf' | 'excel';
  filters: FilterType[];
}

type FilterType =
  | 'family'
  | 'member'
  | 'asOfDate'
  | 'dateRange'
  | 'financialYear'
  | 'assetClass';

// ─── Constants ───────────────────────────────────────────────────────────────

const REPORTS: ReportDef[] = [
  {
    key: 'portfolio-summary',
    title: 'Portfolio Summary',
    description:
      'Consolidated view of all asset classes with allocation breakdown, P&L, and net worth.',
    icon: FileText,
    format: 'pdf',
    filters: ['family', 'member', 'asOfDate'],
  },
  {
    key: 'transaction-history',
    title: 'Transaction History',
    description:
      'Complete transaction ledger across all holdings — buys, sells, dividends, SIPs.',
    icon: Table2,
    format: 'excel',
    filters: ['family', 'member', 'dateRange', 'assetClass'],
  },
  {
    key: 'capital-gains',
    title: 'Capital Gains',
    description:
      'STCG and LTCG computation for the selected financial year with tax estimates.',
    icon: Calculator,
    format: 'excel',
    filters: ['family', 'member', 'financialYear'],
  },
  {
    key: 'holdings-statement',
    title: 'Holdings Statement',
    description:
      'Current holdings snapshot with quantities, average costs, and market values.',
    icon: ClipboardList,
    format: 'pdf',
    filters: ['family', 'member', 'asOfDate'],
  },
  {
    key: 'insurance-summary',
    title: 'Insurance Summary',
    description:
      'All insurance policies — life, health, vehicle — with premiums and coverage details.',
    icon: Shield,
    format: 'pdf',
    filters: ['family', 'member'],
  },
  {
    key: 'monthly-digest',
    title: 'Monthly Digest',
    description:
      'Month-over-month performance, top movers, upcoming maturities, and cash-flow summary.',
    icon: Calendar,
    format: 'pdf',
    filters: ['family', 'member', 'dateRange'],
  },
];

const ASSET_CLASSES = [
  { value: 'all', label: 'All Asset Classes' },
  { value: 'indian_stock', label: 'Indian Stocks' },
  { value: 'global_stock', label: 'Global Stocks' },
  { value: 'mutual_fund', label: 'Mutual Funds' },
  { value: 'bond', label: 'Bonds' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'gold', label: 'Gold' },
  { value: 'real_estate', label: 'Real Estate' },
  { value: 'fd', label: 'Fixed Deposits' },
  { value: 'ppf', label: 'PPF' },
  { value: 'epf', label: 'EPF / VPF' },
  { value: 'nps', label: 'NPS' },
  { value: 'insurance', label: 'Insurance' },
];

function buildFYOptions(): { value: string; label: string }[] {
  const now = new Date();
  const currentYear = now.getFullYear();
  const month = now.getMonth();
  const startYear = month >= 3 ? currentYear : currentYear - 1;
  const options: { value: string; label: string }[] = [];
  for (let y = startYear; y >= startYear - 5; y--) {
    const fy = `${y}-${String(y + 1).slice(2)}`;
    options.push({ value: fy, label: `FY ${fy}` });
  }
  return options;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ReportsPage() {
  // Data
  const [families, setFamilies] = useState<FamilyOption[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal
  const [activeReport, setActiveReport] = useState<ReportDef | null>(null);
  const [generating, setGenerating] = useState(false);

  // Filters
  const [selectedFamily, setSelectedFamily] = useState('');
  const [selectedMember, setSelectedMember] = useState('all');
  const [asOfDate, setAsOfDate] = useState(
    new Date().toISOString().split('T')[0]
  );
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
  const [financialYear, setFinancialYear] = useState(
    buildFYOptions()[0]?.value ?? ''
  );
  const [assetClass, setAssetClass] = useState('all');

  // Toast
  const [toast, setToast] = useState<Toast | null>(null);

  // ── Load families & members ─────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        const { data: profile } = await supabase
          .from('users')
          .select('family_id')
          .eq('id', user.id)
          .single();
        if (!profile?.family_id) return;

        // Families user can see (typically one, but support multi)
        const { data: familyRows } = await supabase
          .from('families')
          .select('id, name');
        const fams = (familyRows ?? []).map((f) => ({
          id: f.id,
          name: f.name,
        }));
        setFamilies(fams);
        if (fams.length > 0) setSelectedFamily(fams[0].id);

        // Members of the primary family
        const { data: memberRows } = await supabase
          .from('users')
          .select('id, name, email')
          .eq('family_id', profile.family_id);
        setMembers(
          (memberRows ?? []).map((m) => ({
            id: m.id,
            name: m.name || m.email,
            email: m.email,
          }))
        );

        // Default dateFrom = 1 year ago
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        setDateFrom(oneYearAgo.toISOString().split('T')[0]);
      } catch (err) {
        console.error('[ReportsPage] init error:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Toast auto-dismiss ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // ── Download helper ─────────────────────────────────────────────────────────
  async function downloadReport(
    url: string,
    body: Record<string, unknown>,
    filename: string
  ) {
    setGenerating(true);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.error || 'Report generation failed');
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
      setToast({ type: 'success', message: `${filename} downloaded!` });
      setActiveReport(null);
    } catch (e) {
      setToast({ type: 'error', message: (e as Error).message });
    } finally {
      setGenerating(false);
    }
  }

  // ── Generate handler ────────────────────────────────────────────────────────
  function handleGenerate() {
    if (!activeReport) return;
    const key = activeReport.key;
    const ext = activeReport.format === 'pdf' ? 'pdf' : 'xlsx';
    const ts = new Date().toISOString().slice(0, 10);
    const filename = `${key}-${ts}.${ext}`;

    const base: Record<string, unknown> = {
      familyId: selectedFamily,
      memberId: selectedMember === 'all' ? null : selectedMember,
    };

    switch (key) {
      case 'portfolio-summary':
        downloadReport('/api/reports/portfolio-summary', {
          ...base,
          asOfDate,
        }, filename);
        break;

      case 'transaction-history':
        downloadReport('/api/reports/transaction-history', {
          ...base,
          dateFrom,
          dateTo,
          assetClass: assetClass === 'all' ? null : assetClass,
        }, filename);
        break;

      case 'capital-gains':
        downloadReport('/api/reports/capital-gains', {
          ...base,
          financialYear,
        }, filename);
        break;

      case 'holdings-statement':
        downloadReport('/api/reports/portfolio-summary', {
          ...base,
          asOfDate,
          holdingsOnly: true,
        }, filename);
        break;

      case 'insurance-summary':
        downloadReport('/api/reports/portfolio-summary', {
          ...base,
          insuranceOnly: true,
        }, filename);
        break;

      case 'monthly-digest':
        downloadReport('/api/reports/portfolio-summary', {
          ...base,
          dateFrom,
          dateTo,
          digestMode: true,
        }, filename);
        break;
    }
  }

  // ── Reset filters on report change ──────────────────────────────────────────
  function openReport(report: ReportDef) {
    setSelectedMember('all');
    setAsOfDate(new Date().toISOString().split('T')[0]);
    setDateTo(new Date().toISOString().split('T')[0]);
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    setDateFrom(oneYearAgo.toISOString().split('T')[0]);
    setFinancialYear(buildFYOptions()[0]?.value ?? '');
    setAssetClass('all');
    setActiveReport(report);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#C9A84C' }} />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--wv-text)' }}>
          Reports
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--wv-text-muted)' }}>
          Generate and download portfolio reports, transaction history, tax
          computations, and more.
        </p>
      </div>

      {/* Report Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {REPORTS.map((report) => {
          const Icon = report.icon;
          return (
            <div
              key={report.key}
              className="wv-card p-5 flex flex-col justify-between"
              style={{ minHeight: 200 }}
            >
              <div>
                <div className="flex items-center gap-3 mb-3">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: '#1B2A4A' }}
                  >
                    <Icon className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3
                      className="text-sm font-semibold"
                      style={{ color: 'var(--wv-text)' }}
                    >
                      {report.title}
                    </h3>
                    <span
                      className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded"
                      style={{
                        backgroundColor:
                          report.format === 'pdf'
                            ? 'rgba(220, 38, 38, 0.1)'
                            : 'rgba(5, 150, 105, 0.1)',
                        color:
                          report.format === 'pdf' ? '#DC2626' : '#059669',
                      }}
                    >
                      {report.format.toUpperCase()}
                    </span>
                  </div>
                </div>
                <p
                  className="text-xs leading-relaxed"
                  style={{ color: 'var(--wv-text-secondary)' }}
                >
                  {report.description}
                </p>
              </div>
              <Button
                className="mt-4 w-full text-sm font-medium"
                style={{
                  backgroundColor: '#1B2A4A',
                  color: '#FFFFFF',
                }}
                onClick={() => openReport(report)}
              >
                <Download className="w-4 h-4 mr-2" />
                Generate
              </Button>
            </div>
          );
        })}
      </div>

      {/* ── Filter Modal Overlay ──────────────────────────────────────────────── */}
      {activeReport && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !generating)
              setActiveReport(null);
          }}
        >
          <div
            className="w-full max-w-md rounded-xl shadow-2xl p-6 relative"
            style={{
              backgroundColor: 'var(--wv-surface)',
              border: '1px solid var(--wv-border)',
            }}
          >
            {/* Close */}
            <button
              onClick={() => !generating && setActiveReport(null)}
              className="absolute top-4 right-4 p-1 rounded-md hover:opacity-70 transition-opacity"
              style={{ color: 'var(--wv-text-muted)' }}
            >
              <X className="w-4 h-4" />
            </button>

            {/* Title */}
            <div className="flex items-center gap-3 mb-5">
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: '#1B2A4A' }}
              >
                {(() => {
                  const Icon = activeReport.icon;
                  return <Icon className="w-4 h-4 text-white" />;
                })()}
              </div>
              <div>
                <h2
                  className="text-sm font-bold"
                  style={{ color: 'var(--wv-text)' }}
                >
                  {activeReport.title}
                </h2>
                <span
                  className="text-[10px] uppercase tracking-wide"
                  style={{ color: 'var(--wv-text-muted)' }}
                >
                  {activeReport.format === 'pdf'
                    ? 'PDF Document'
                    : 'Excel Spreadsheet'}
                </span>
              </div>
            </div>

            {/* Filters */}
            <div className="space-y-4">
              {/* Family selector */}
              {activeReport.filters.includes('family') &&
                families.length > 1 && (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Family</Label>
                    <Select
                      value={selectedFamily}
                      onValueChange={setSelectedFamily}
                    >
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Select family" />
                      </SelectTrigger>
                      <SelectContent>
                        {families.map((f) => (
                          <SelectItem key={f.id} value={f.id}>
                            {f.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

              {/* Member selector */}
              {activeReport.filters.includes('member') && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Family Member</Label>
                  <Select
                    value={selectedMember}
                    onValueChange={setSelectedMember}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Select member" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Members</SelectItem>
                      {members.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* As-of date */}
              {activeReport.filters.includes('asOfDate') && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">As of Date</Label>
                  <Input
                    type="date"
                    className="h-9 text-sm"
                    value={asOfDate}
                    onChange={(e) => setAsOfDate(e.target.value)}
                    max={new Date().toISOString().split('T')[0]}
                  />
                </div>
              )}

              {/* Date range */}
              {activeReport.filters.includes('dateRange') && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">From Date</Label>
                    <Input
                      type="date"
                      className="h-9 text-sm"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">To Date</Label>
                    <Input
                      type="date"
                      className="h-9 text-sm"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      max={new Date().toISOString().split('T')[0]}
                    />
                  </div>
                </div>
              )}

              {/* Financial Year */}
              {activeReport.filters.includes('financialYear') && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Financial Year</Label>
                  <Select
                    value={financialYear}
                    onValueChange={setFinancialYear}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Select FY" />
                    </SelectTrigger>
                    <SelectContent>
                      {buildFYOptions().map((fy) => (
                        <SelectItem key={fy.value} value={fy.value}>
                          {fy.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Asset Class filter */}
              {activeReport.filters.includes('assetClass') && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Asset Class</Label>
                  <Select value={assetClass} onValueChange={setAssetClass}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Select asset class" />
                    </SelectTrigger>
                    <SelectContent>
                      {ASSET_CLASSES.map((ac) => (
                        <SelectItem key={ac.value} value={ac.value}>
                          {ac.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3 mt-6">
              <Button
                variant="outline"
                className="flex-1 h-10 text-sm"
                disabled={generating}
                onClick={() => setActiveReport(null)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 h-10 text-sm font-semibold"
                style={{ backgroundColor: '#C9A84C', color: '#1B2A4A' }}
                disabled={generating}
                onClick={handleGenerate}
              >
                {generating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 mr-2" />
                    Download{' '}
                    {activeReport.format === 'pdf' ? 'PDF' : 'Excel'}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ─────────────────────────────────────────────────────────────── */}
      {toast && (
        <div
          className="fixed bottom-6 right-6 z-[60] flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium"
          style={{
            backgroundColor:
              toast.type === 'success' ? '#059669' : '#DC2626',
            color: '#FFFFFF',
          }}
        >
          {toast.type === 'success' ? (
            <Check className="w-4 h-4" />
          ) : (
            <X className="w-4 h-4" />
          )}
          {toast.message}
          <button
            onClick={() => setToast(null)}
            className="ml-2 opacity-70 hover:opacity-100"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}
