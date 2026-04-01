'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AssetPageShell } from '@/components/forms/AssetPageShell';
import { UserCheck, Check, AlertCircle, X, Loader2, Calculator } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatCurrency } from '@/lib/utils/formatters';

// ─── Types ──────────────────────────────────────────────────────────────────

interface FamilyMember { id: string; name: string }
interface Toast { type: 'success' | 'error'; message: string }

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

const DEFAULT_EMPLOYEE_RATE = 12;
const DEFAULT_EMPLOYER_RATE = 12;
const DEFAULT_INTEREST_RATE = 8.25;
const EPF_EMPLOYER_SHARE = 3.67;
const EPS_SHARE = 8.33;
const EPS_BASIC_CAP = 15000;

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
  const [uan, setUan] = useState('');
  const [epfAccountNumber, setEpfAccountNumber] = useState('');
  const [joiningDate, setJoiningDate] = useState('');
  const [currentBalance, setCurrentBalance] = useState('');
  const [employeeRate, setEmployeeRate] = useState(String(DEFAULT_EMPLOYEE_RATE));
  const [employerRate, setEmployerRate] = useState(String(DEFAULT_EMPLOYER_RATE));
  const [vpfMonthly, setVpfMonthly] = useState('');
  const [monthlyBasic, setMonthlyBasic] = useState('');
  const [interestRate, setInterestRate] = useState(String(DEFAULT_INTEREST_RATE));
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

  const basic = parseFloat(monthlyBasic) || 0;
  const empRate = parseFloat(employeeRate) || DEFAULT_EMPLOYEE_RATE;
  const erRate = parseFloat(employerRate) || DEFAULT_EMPLOYER_RATE;
  const vpf = parseFloat(vpfMonthly) || 0;
  const intRate = parseFloat(interestRate) || DEFAULT_INTEREST_RATE;
  const balance = parseFloat(currentBalance) || 0;

  const calcs = useMemo(() => {
    const monthlyEmployee = basic * (empRate / 100);
    const monthlyEmployerEPF = basic * (EPF_EMPLOYER_SHARE / 100);
    const epsBasic = Math.min(basic, EPS_BASIC_CAP);
    const monthlyEPS = epsBasic * (EPS_SHARE / 100);
    const totalMonthlyContribution = monthlyEmployee + monthlyEmployerEPF + vpf;
    const annualContribution = totalMonthlyContribution * 12;
    const annualInterest = balance * (intRate / 100);

    return {
      monthlyEmployee,
      monthlyEmployerEPF,
      monthlyEPS,
      totalMonthlyContribution,
      annualContribution,
      annualInterest,
    };
  }, [basic, empRate, vpf, intRate, balance]);

  // ── Submit ────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!employer || !currentBalance) return;

    setSaving(true);
    setToast(null);

    try {
      const res = await fetch('/api/manual-assets/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_type: 'epf',
          name: `${employer} EPF`,
          current_value: balance,
          memberId: member,
          metadata: {
            employer,
            uan,
            epf_account_number: epfAccountNumber,
            joining_date: joiningDate,
            current_balance: balance,
            employee_rate: empRate,
            employer_rate: erRate,
            vpf_monthly: vpf,
            monthly_basic: basic,
            interest_rate: intRate,
            monthly_employee: calcs.monthlyEmployee,
            monthly_employer_epf: calcs.monthlyEmployerEPF,
            monthly_eps: calcs.monthlyEPS,
            annual_contribution: calcs.annualContribution,
            annual_interest: calcs.annualInterest,
            notes,
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');

      setToast({ type: 'success', message: 'EPF/VPF account saved successfully!' });
      setTimeout(() => router.push('/portfolio/epf'), 1200);
    } catch (err) {
      setToast({ type: 'error', message: err instanceof Error ? err.message : 'Something went wrong' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <AssetPageShell
      title="EPF / VPF"
      description="Add Employees' Provident Fund details"
      icon={UserCheck}
      iconColor="#2563eb"
      iconBg="#eff6ff"
    >
      {toast && <ToastBanner toast={toast} onClose={() => setToast(null)} />}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Family member selector */}
        {members.length > 1 && (
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: '#6B7280' }}>Family Member</Label>
            <Select value={member} onValueChange={setMember}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {members.map(m => <SelectItem key={m.id} value={m.id} className="text-xs">{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Employer & Account Details */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5 col-span-2">
            <Label className="text-xs" style={{ color: '#6B7280' }}>Employer Name *</Label>
            <Input
              placeholder="e.g. Tata Consultancy Services"
              required
              value={employer}
              onChange={e => setEmployer(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: '#6B7280' }}>UAN</Label>
            <Input
              placeholder="e.g. 100012345678"
              value={uan}
              onChange={e => setUan(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: '#6B7280' }}>EPF Account Number</Label>
            <Input
              placeholder="e.g. MH/BAN/12345/000/0012345"
              value={epfAccountNumber}
              onChange={e => setEpfAccountNumber(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: '#6B7280' }}>Date of Joining</Label>
            <Input
              type="date"
              value={joiningDate}
              onChange={e => setJoiningDate(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: '#6B7280' }}>Current EPF Balance (&#8377;) *</Label>
            <Input
              type="number"
              required
              min="0"
              step="0.01"
              placeholder="0.00"
              value={currentBalance}
              onChange={e => setCurrentBalance(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
        </div>

        {/* Contribution Rates */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: '#6B7280' }}>Employee Contribution Rate (%)</Label>
            <Input
              type="number"
              min="0"
              max="100"
              step="0.01"
              placeholder="12"
              value={employeeRate}
              onChange={e => setEmployeeRate(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: '#6B7280' }}>Employer Contribution Rate (%)</Label>
            <Input
              type="number"
              min="0"
              max="100"
              step="0.01"
              placeholder="12"
              value={employerRate}
              onChange={e => setEmployerRate(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: '#6B7280' }}>VPF Monthly (&#8377;, optional)</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={vpfMonthly}
              onChange={e => setVpfMonthly(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: '#6B7280' }}>Monthly Basic Salary (&#8377;)</Label>
            <Input
              type="number"
              min="0"
              step="1"
              placeholder="e.g. 75000"
              value={monthlyBasic}
              onChange={e => setMonthlyBasic(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: '#6B7280' }}>Interest Rate (% p.a.)</Label>
            <Input
              type="number"
              min="0"
              max="20"
              step="0.01"
              placeholder="8.25"
              value={interestRate}
              onChange={e => setInterestRate(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
        </div>

        {/* Notes */}
        <div className="space-y-1.5">
          <Label className="text-xs" style={{ color: '#6B7280' }}>Notes (optional)</Label>
          <Input
            placeholder="Add any notes..."
            value={notes}
            onChange={e => setNotes(e.target.value)}
            className="h-9 text-sm"
          />
        </div>

        {/* Auto-calculated summary */}
        {basic > 0 && (
          <div className="rounded-xl p-4 space-y-2"
            style={{ backgroundColor: '#F7F5F0', border: '1px solid #E8E5DD' }}>
            <div className="flex items-center gap-2 mb-2">
              <Calculator className="w-4 h-4" style={{ color: '#C9A84C' }} />
              <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#6B7280' }}>
                Auto-calculated Summary
              </span>
            </div>
            <div className="grid grid-cols-2 gap-y-2 gap-x-6 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Monthly Employee ({empRate}%)</span>
                <span className="font-medium" style={{ color: '#1B2A4A' }}>{formatCurrency(calcs.monthlyEmployee)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Monthly Employer EPF ({EPF_EMPLOYER_SHARE}%)</span>
                <span className="font-medium" style={{ color: '#1B2A4A' }}>{formatCurrency(calcs.monthlyEmployerEPF)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Monthly EPS ({EPS_SHARE}%)</span>
                <span className="font-medium" style={{ color: '#1B2A4A' }}>
                  {formatCurrency(calcs.monthlyEPS)}
                  {basic > EPS_BASIC_CAP && (
                    <span className="text-[10px] ml-1 text-gray-400">(capped at &#8377;15K basic)</span>
                  )}
                </span>
              </div>
              {vpf > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-500">VPF Monthly</span>
                  <span className="font-medium" style={{ color: '#C9A84C' }}>{formatCurrency(vpf)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500">Total Monthly</span>
                <span className="font-bold" style={{ color: '#1B2A4A' }}>{formatCurrency(calcs.totalMonthlyContribution)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Annual Contribution</span>
                <span className="font-bold" style={{ color: '#1B2A4A' }}>{formatCurrency(calcs.annualContribution)}</span>
              </div>
              {balance > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Annual Interest ({intRate}%)</span>
                  <span className="font-bold" style={{ color: '#059669' }}>{formatCurrency(calcs.annualInterest)}</span>
                </div>
              )}
            </div>
          </div>
        )}

        <Button
          type="submit"
          disabled={saving}
          className="w-full text-white"
          style={{ backgroundColor: '#1B2A4A' }}
        >
          {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</> : 'Save EPF Account'}
        </Button>
      </form>
    </AssetPageShell>
  );
}
