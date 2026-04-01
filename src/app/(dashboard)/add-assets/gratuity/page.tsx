'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AssetPageShell } from '@/components/forms/AssetPageShell';
import { PiggyBank, Check, AlertCircle, X, Loader2, Calculator } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatCurrency } from '@/lib/utils/formatters';

// ─── Types ──────────────────────────────────────────────────────────────────

interface FamilyMember { id: string; name: string }
interface Toast { type: 'success' | 'error'; message: string }

type GratuityStatus = 'estimated' | 'received' | 'pending';

// ─── Toast banner ───────────────────────────────────────────────────────────

function ToastBanner({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const ok = toast.type === 'success';
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl mb-4 text-sm font-medium"
      style={{ backgroundColor: ok ? 'rgba(5,150,105,0.08)' : 'rgba(220,38,38,0.08)',
               border: `1px solid ${ok ? 'rgba(5,150,105,0.2)' : 'rgba(220,38,38,0.2)'}`,
               color: ok ? '#059669' : '#DC2626' }}>
      {ok ? <Check className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
      <span className="flex-1">{toast.message}</span>
      <button onClick={onClose}><X className="w-3.5 h-3.5" /></button>
    </div>
  );
}

// ─── Constants ──────────────────────────────────────────────────────────────

const TAX_EXEMPTION_LIMIT = 2000000; // ₹20 lakh

// ─── Helpers ────────────────────────────────────────────────────────────────

function computeYearsOfService(joiningDate: string): number {
  if (!joiningDate) return 0;
  const join = new Date(joiningDate);
  const now = new Date();
  const diffMs = now.getTime() - join.getTime();
  return Math.max(0, parseFloat((diffMs / (365.25 * 24 * 60 * 60 * 1000)).toFixed(1)));
}

function computeGratuity(basicSalary: number, yearsOfService: number): number {
  // Gratuity = (Basic + DA) × 15 × Years of Service / 26
  return (basicSalary * 15 * yearsOfService) / 26;
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function Page() {
  const supabase = createClient();
  const router = useRouter();

  // UI state
  const [toast, setToast] = useState<Toast | null>(null);
  const [saving, setSaving] = useState(false);

  // Members
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [member, setMember] = useState('');

  // Form fields
  const [employer, setEmployer] = useState('');
  const [joiningDate, setJoiningDate] = useState('');
  const [basicSalary, setBasicSalary] = useState('');
  const [yearsOverride, setYearsOverride] = useState('');
  const [status, setStatus] = useState<GratuityStatus>('estimated');
  const [amountReceived, setAmountReceived] = useState('');
  const [dateReceived, setDateReceived] = useState('');
  const [notes, setNotes] = useState('');

  // ── Load user & family members ──────────────────────────────────────────

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { router.push('/login'); return; }
      const { data: profile } = await supabase
        .from('users').select('id, name, family_id').eq('id', user.id).single();
      if (!profile) return;
      setMember(profile.id);

      const fid = profile.family_id;
      if (fid) {
        const { data: fUsers } = await supabase
          .from('users').select('id, name').eq('family_id', fid);
        if (fUsers && fUsers.length > 0) {
          setMembers(fUsers);
        } else {
          setMembers([{ id: profile.id, name: profile.name }]);
        }
      } else {
        setMembers([{ id: profile.id, name: profile.name }]);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-calculations ─────────────────────────────────────────────────────

  const autoYears = useMemo(() => computeYearsOfService(joiningDate), [joiningDate]);

  const yearsOfService = useMemo(() => {
    if (yearsOverride && parseFloat(yearsOverride) >= 0) return parseFloat(yearsOverride);
    return autoYears;
  }, [yearsOverride, autoYears]);

  const salary = parseFloat(basicSalary) || 0;
  const estimatedGratuity = useMemo(() => computeGratuity(salary, yearsOfService), [salary, yearsOfService]);
  const isEligible = yearsOfService >= 5;
  const yearsToEligibility = Math.max(0, Math.ceil((5 - yearsOfService) * 10) / 10);

  const currentValue = status === 'received' ? (parseFloat(amountReceived) || 0) : estimatedGratuity;

  // ── Submit ────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!employer || !joiningDate || !basicSalary) return;

    setSaving(true);
    setToast(null);

    try {
      const res = await fetch('/api/manual-assets/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_type: 'gratuity',
          name: `${employer} - Gratuity`,
          current_value: currentValue,
          memberId: member,
          metadata: {
            employer,
            joining_date: joiningDate,
            basic_salary: salary,
            years_of_service: yearsOfService,
            status,
            amount_received: status === 'received' ? (parseFloat(amountReceived) || 0) : null,
            date_received: status === 'received' ? dateReceived : null,
            notes,
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');

      setToast({ type: 'success', message: 'Gratuity estimate saved successfully!' });
      setTimeout(() => router.push('/portfolio/gratuity'), 1200);
    } catch (err) {
      setToast({ type: 'error', message: err instanceof Error ? err.message : 'Something went wrong' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <AssetPageShell
      title="Gratuity"
      description="Add gratuity estimate for an employment"
      icon={PiggyBank}
      iconColor="#7c3aed"
      iconBg="#f5f3ff"
    >
      {toast && <ToastBanner toast={toast} onClose={() => setToast(null)} />}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Family member selector */}
        {members.length > 1 && (
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Family Member</Label>
            <Select value={member} onValueChange={setMember}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {members.map(m => <SelectItem key={m.id} value={m.id} className="text-xs">{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Employment & Gratuity Details */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5 col-span-2">
            <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Employer Name *</Label>
            <Input
              placeholder="e.g. Tata Consultancy Services"
              required
              value={employer}
              onChange={e => setEmployer(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Date of Joining *</Label>
            <Input
              type="date"
              required
              value={joiningDate}
              onChange={e => setJoiningDate(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Current Basic Salary + DA (&#8377;/month) *</Label>
            <Input
              type="number"
              required
              min="0"
              step="1"
              placeholder="e.g. 75000"
              value={basicSalary}
              onChange={e => setBasicSalary(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>
              Years of Service
              {joiningDate && (
                <span className="ml-1 font-normal" style={{ color: 'var(--wv-text-muted)' }}>(auto: {autoYears} yrs)</span>
              )}
            </Label>
            <Input
              type="number"
              min="0"
              step="0.1"
              placeholder={joiningDate ? String(autoYears) : 'Enter joining date first'}
              value={yearsOverride}
              onChange={e => setYearsOverride(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Gratuity Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as GratuityStatus)}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="estimated" className="text-xs">Estimated (still employed)</SelectItem>
                <SelectItem value="received" className="text-xs">Received (after leaving)</SelectItem>
                <SelectItem value="pending" className="text-xs">Pending (left but not received)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Conditional fields for Received status */}
        {status === 'received' && (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Amount Received (&#8377;) *</Label>
              <Input
                type="number"
                required
                min="0"
                step="0.01"
                placeholder="0.00"
                value={amountReceived}
                onChange={e => setAmountReceived(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Date Received</Label>
              <Input
                type="date"
                value={dateReceived}
                onChange={e => setDateReceived(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
          </div>
        )}

        {/* Notes */}
        <div className="space-y-1.5">
          <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Notes (optional)</Label>
          <Input
            placeholder="Add any notes..."
            value={notes}
            onChange={e => setNotes(e.target.value)}
            className="h-9 text-sm"
          />
        </div>

        {/* Auto-calculated summary */}
        {joiningDate && salary > 0 && (
          <div className="rounded-xl p-4 space-y-3"
            style={{ backgroundColor: 'var(--wv-surface-2)', border: '1px solid var(--wv-border)' }}>
            <div className="flex items-center gap-2 mb-1">
              <Calculator className="w-4 h-4" style={{ color: '#C9A84C' }} />
              <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--wv-text-secondary)' }}>
                Gratuity Calculation
              </span>
            </div>

            {/* Eligibility */}
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Eligibility:</span>
              <span
                className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: isEligible ? 'rgba(5,150,105,0.12)' : 'rgba(156,163,175,0.15)',
                  color: isEligible ? '#059669' : '#6B7280',
                }}
              >
                {isEligible ? 'Eligible' : `Not yet eligible (${yearsToEligibility} more years)`}
              </span>
            </div>

            {/* Formula breakdown */}
            <div className="text-xs rounded-lg p-3" style={{ backgroundColor: 'white', border: '1px solid var(--wv-border)' }}>
              <p className="font-medium mb-1" style={{ color: 'var(--wv-text)' }}>Formula: (Basic + DA) x 15 x Years / 26</p>
              <p style={{ color: 'var(--wv-text-secondary)' }}>
                {formatCurrency(salary)} x 15 x {yearsOfService} yrs / 26 = <span className="font-bold" style={{ color: 'var(--wv-text)' }}>{formatCurrency(Math.round(estimatedGratuity))}</span>
              </p>
            </div>

            {/* Summary grid */}
            <div className="grid grid-cols-2 gap-y-2 gap-x-6 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Estimated Gratuity</span>
                <span className="font-bold" style={{ color: 'var(--wv-text)' }}>{formatCurrency(Math.round(estimatedGratuity))}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Years of Service</span>
                <span className="font-medium" style={{ color: 'var(--wv-text)' }}>{yearsOfService} yrs</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Tax Exemption</span>
                <span className="font-medium" style={{ color: '#C9A84C' }}>
                  Up to {formatCurrency(TAX_EXEMPTION_LIMIT)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Taxable Portion</span>
                <span className="font-medium" style={{ color: estimatedGratuity > TAX_EXEMPTION_LIMIT ? '#DC2626' : '#059669' }}>
                  {estimatedGratuity > TAX_EXEMPTION_LIMIT
                    ? formatCurrency(Math.round(estimatedGratuity - TAX_EXEMPTION_LIMIT))
                    : 'Nil'}
                </span>
              </div>
            </div>

            {status === 'received' && parseFloat(amountReceived) > 0 && (
              <div className="flex justify-between text-sm pt-1" style={{ borderTop: '1px solid var(--wv-border)' }}>
                <span className="text-gray-500">Amount Received</span>
                <span className="font-bold" style={{ color: '#059669' }}>{formatCurrency(parseFloat(amountReceived))}</span>
              </div>
            )}
          </div>
        )}

        <Button
          type="submit"
          disabled={saving}
          className="w-full text-white"
          style={{ backgroundColor: '#1B2A4A' }}
        >
          {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : 'Save Gratuity'}
        </Button>
      </form>
    </AssetPageShell>
  );
}
