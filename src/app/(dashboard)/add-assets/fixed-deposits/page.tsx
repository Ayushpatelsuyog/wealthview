'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Landmark, Check, AlertCircle, X, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR } from '@/lib/utils/formatters';

// ─── Types ──────────────────────────────────────────────────────────────────────

interface FamilyMember { id: string; name: string }
interface Toast { type: 'success' | 'error'; message: string }

// ─── Constants ──────────────────────────────────────────────────────────────────

const FD_TYPES = [
  'Regular FD',
  'Tax Saver FD',
  'Senior Citizen FD',
  'Recurring Deposit',
  'Corporate FD',
];

const COMPOUNDING_FREQ = [
  { key: 'monthly',     label: 'Monthly',      n: 12 },
  { key: 'quarterly',   label: 'Quarterly',    n: 4 },
  { key: 'half_yearly', label: 'Half-Yearly',  n: 2 },
  { key: 'annually',    label: 'Annually',     n: 1 },
  { key: 'cumulative',  label: 'Cumulative',   n: 1 },
];

const PAYOUT_OPTIONS = [
  'Cumulative (reinvest)',
  'Monthly Payout',
  'Quarterly Payout',
];

const TENURE_UNITS = ['Years', 'Months', 'Days'];

// ─── Sub-components ─────────────────────────────────────────────────────────────

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

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="text-[10px] mt-0.5" style={{ color: '#DC2626' }}>{msg}</p>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function tenureToYears(value: number, unit: string): number {
  if (unit === 'Years') return value;
  if (unit === 'Months') return value / 12;
  return value / 365; // Days
}

function addTenure(startDate: string, tenureValue: number, tenureUnit: string): string {
  if (!startDate || !tenureValue) return '';
  const d = new Date(startDate);
  if (isNaN(d.getTime())) return '';
  if (tenureUnit === 'Years') {
    d.setFullYear(d.getFullYear() + Math.floor(tenureValue));
    const remainderMonths = Math.round((tenureValue % 1) * 12);
    if (remainderMonths) d.setMonth(d.getMonth() + remainderMonths);
  } else if (tenureUnit === 'Months') {
    d.setMonth(d.getMonth() + Math.floor(tenureValue));
    const remainderDays = Math.round((tenureValue % 1) * 30);
    if (remainderDays) d.setDate(d.getDate() + remainderDays);
  } else {
    d.setDate(d.getDate() + Math.round(tenureValue));
  }
  return d.toISOString().split('T')[0];
}

function daysBetween(a: string, b: string): number {
  const d1 = new Date(a);
  const d2 = new Date(b);
  if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return 0;
  return Math.max(0, Math.ceil((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)));
}

function calcMaturityAmount(principal: number, rate: number, n: number, t: number): number {
  // Maturity = P * (1 + r/n)^(n*t)
  if (!principal || !rate || !n || !t) return 0;
  const r = rate / 100;
  return principal * Math.pow(1 + r / n, n * t);
}

function calcAccruedValue(principal: number, rate: number, n: number, startDate: string): number {
  // Accrued value as of today
  if (!principal || !rate || !startDate) return principal || 0;
  const start = new Date(startDate);
  const today = new Date();
  if (isNaN(start.getTime()) || today <= start) return principal;
  const elapsedYears = (today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
  const r = rate / 100;
  return principal * Math.pow(1 + r / n, n * elapsedYears);
}

// ─── Module-level: survives re-renders, consumed once when members load ─────

let _pendingMember: string | null = null;

// ─── Main Form Content ─────────────────────────────────────────────────────────

function FixedDepositFormContent() {
  const router = useRouter();
  const supabase = createClient();
  const _searchParams = useSearchParams();

  // Family/member prefill from sessionStorage
  const prefillFamily = typeof window !== 'undefined' ? sessionStorage.getItem('wv_prefill_family') : null;
  const prefillMember = typeof window !== 'undefined' ? sessionStorage.getItem('wv_prefill_member') : null;
  const prefillActive = typeof window !== 'undefined' ? sessionStorage.getItem('wv_prefill_active') === 'true' : false;
  if (prefillActive && typeof window !== 'undefined') {
    sessionStorage.removeItem('wv_prefill_family');
    sessionStorage.removeItem('wv_prefill_member');
    sessionStorage.removeItem('wv_prefill_active');
  }
  _pendingMember = prefillMember;
  const urlFamilyId = _searchParams.get('family_id') || prefillFamily;
  const urlMemberId = _searchParams.get('member_id') || prefillMember;
  const hasPrefill = prefillActive || !!(_searchParams.get('family_id') || _searchParams.get('member_id'));

  // Auth / family
  const [_familyId, setFamilyId] = useState<string | null>(urlFamilyId);
  const [families, setFamilies] = useState<{ id: string; name: string }[]>([]);
  const [selectedFamily, setSelectedFamily] = useState(urlFamilyId || '');
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [member, setMember] = useState(urlMemberId || '');

  // Portfolio
  const [portfolioName, setPortfolioName] = useState('My Portfolio');

  // FD fields
  const [fdType, setFdType] = useState('Regular FD');
  const [bank, setBank] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [principal, setPrincipal] = useState('');
  const [interestRate, setInterestRate] = useState('');
  const [tenureValue, setTenureValue] = useState('');
  const [tenureUnit, setTenureUnit] = useState('Years');
  const [startDate, setStartDate] = useState('');
  const [maturityDate, setMaturityDate] = useState('');
  const [maturityDateManual, setMaturityDateManual] = useState(false);
  const [compounding, setCompounding] = useState('quarterly');
  const [payout, setPayout] = useState('Cumulative (reinvest)');
  const [autoRenew, setAutoRenew] = useState(false);
  const [notes, setNotes] = useState('');

  // UI state
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const prefillLockedRef = useRef(hasPrefill);
  const targetMemberRef = useRef(urlMemberId || '');
  const activeFamilyRef = useRef(selectedFamily);
  activeFamilyRef.current = selectedFamily;

  // ── Load user/family ──────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { router.push('/login'); return; }
      const { data: profile } = await supabase
        .from('users').select('id, name, family_id').eq('id', user.id).single();
      if (!profile) return;

      const hasOverride = prefillLockedRef.current;
      if (!hasOverride) setMember(profile.id);

      const fid = profile.family_id;
      if (fid) {
        if (!hasOverride) {
          setFamilyId(fid);
          setSelectedFamily(fid);
        }
        const activeFamilyId = hasOverride ? (activeFamilyRef.current || urlFamilyId || fid) : fid;
        const { data: fUsers } = await supabase.from('users').select('id, name').eq('family_id', activeFamilyId);
        if (fUsers && fUsers.length > 0) {
          setMembers(fUsers);
          if (_pendingMember && fUsers.find(m => m.id === _pendingMember)) {
            setMember(_pendingMember);
            _pendingMember = null;
          }
        } else {
          setMembers([{ id: profile.id, name: profile.name }]);
        }

        // Load families the user has access to
        try {
          const { data: primaryFam } = await supabase.from('families').select('id, name').eq('id', fid).single();
          const famList = primaryFam ? [primaryFam] : [];
          try {
            const { data: extraFams } = await supabase
              .from('family_memberships')
              .select('families(id, name)')
              .eq('auth_user_id', user.id);
            if (extraFams) {
              for (const m of extraFams) {
                const f = (m as Record<string, unknown>).families as { id: string; name: string } | undefined;
                if (f && !famList.find(x => x.id === f.id)) famList.push(f);
              }
            }
          } catch { /* table may not exist */ }

          if (urlFamilyId && !famList.find(x => x.id === urlFamilyId)) {
            const { data: urlFam } = await supabase.from('families').select('id, name').eq('id', urlFamilyId).single();
            if (urlFam) famList.push(urlFam);
          }
          setFamilies(famList);
        } catch { /* ignore */ }
      } else {
        setMembers([{ id: profile.id, name: profile.name }]);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reload members when family changes ────────────────────────────────────────
  function handleManualFamilyChange(fid: string) {
    prefillLockedRef.current = false;
    setSelectedFamily(fid);
  }

  useEffect(() => {
    if (!selectedFamily) return;
    setFamilyId(selectedFamily);
    const targetFamily = selectedFamily;
    (async () => {
      const { data: fUsers } = await supabase.from('users').select('id, name').eq('family_id', targetFamily);
      if (activeFamilyRef.current !== targetFamily) return;
      setMembers(fUsers ?? []);
      const target = targetMemberRef.current;
      const targetInList = target && fUsers?.find(m => m.id === target);
      if (_pendingMember && fUsers?.find(m => m.id === _pendingMember)) {
        setMember(_pendingMember);
        _pendingMember = null;
      } else if (targetInList) {
        setMember(target);
      } else if (!prefillLockedRef.current && fUsers?.length) {
        setMember(fUsers[0].id);
      }
    })();
  }, [selectedFamily]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-set today for start date ─────────────────────────────────────────────
  useEffect(() => {
    setStartDate(new Date().toISOString().split('T')[0]);
  }, []);

  // ── Auto-calculate maturity date from start + tenure ──────────────────────────
  useEffect(() => {
    if (maturityDateManual) return;
    const tv = parseFloat(tenureValue);
    if (startDate && tv > 0) {
      setMaturityDate(addTenure(startDate, tv, tenureUnit));
    }
  }, [startDate, tenureValue, tenureUnit, maturityDateManual]);

  // ── Calculations ──────────────────────────────────────────────────────────────
  const principalNum = parseFloat(principal) || 0;
  const rateNum = parseFloat(interestRate) || 0;
  const tv = parseFloat(tenureValue) || 0;
  const t = tenureToYears(tv, tenureUnit);
  const compFreq = COMPOUNDING_FREQ.find(c => c.key === compounding);
  const n = compFreq?.n ?? 4;

  const maturityAmount = calcMaturityAmount(principalNum, rateNum, n, t);
  const totalInterest = maturityAmount - principalNum;
  const effectiveYield = principalNum > 0 && t > 0
    ? ((Math.pow(maturityAmount / principalNum, 1 / t) - 1) * 100)
    : 0;
  const daysToMaturity = maturityDate ? daysBetween(new Date().toISOString().split('T')[0], maturityDate) : 0;
  const accruedValue = calcAccruedValue(principalNum, rateNum, n, startDate);

  // ── Validate ──────────────────────────────────────────────────────────────────
  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!bank.trim()) errs.bank = 'Enter bank or institution name';
    if (!principal || principalNum <= 0) errs.principal = 'Enter a valid principal amount';
    if (!interestRate || rateNum <= 0) errs.rate = 'Enter a valid interest rate';
    if (!tenureValue || tv <= 0) errs.tenure = 'Enter a valid tenure';
    if (!startDate) errs.startDate = 'Enter start date';
    if (!portfolioName.trim()) errs.portfolio = 'Enter a portfolio name';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Save ──────────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!validate()) return;
    setSaving(true);

    try {
      const fdName = `${bank.trim()} ${fdType}`;
      const res = await fetch('/api/manual-assets/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_type: 'fd',
          name: fdName,
          current_value: accruedValue,
          metadata: {
            fd_type: fdType,
            account_number: accountNumber.trim() || undefined,
            principal: principalNum,
            rate: rateNum,
            tenure_value: tv,
            tenure_unit: tenureUnit,
            start_date: startDate,
            maturity_date: maturityDate,
            compounding,
            payout,
            auto_renew: autoRenew,
            bank: bank.trim(),
            notes: notes.trim() || undefined,
            maturity_amount: Math.round(maturityAmount * 100) / 100,
            total_interest: Math.round(totalInterest * 100) / 100,
          },
          memberId: member,
          portfolioName: portfolioName.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed');

      setToast({ type: 'success', message: 'Fixed Deposit added successfully!' });
      setTimeout(() => router.push('/portfolio/fixed-deposits'), 1200);
    } catch (err) {
      setToast({ type: 'error', message: err instanceof Error ? err.message : 'Something went wrong' });
    }
    setSaving(false);
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen py-6 px-4" style={{ backgroundColor: '#F7F5F0' }}>
      <div className="max-w-2xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: 'rgba(27,42,74,0.08)' }}>
            <Landmark className="w-5 h-5" style={{ color: '#1B2A4A' }} />
          </div>
          <div>
            <h1 className="text-lg font-bold" style={{ color: '#1B2A4A' }}>Add Fixed Deposit</h1>
            <p className="text-xs" style={{ color: '#9CA3AF' }}>Enter your FD details for tracking</p>
          </div>
        </div>

        {/* Toast */}
        {toast && <ToastBanner toast={toast} onClose={() => setToast(null)} />}

        {/* Step 1 — Family & Portfolio */}
        <div className="wv-card p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#9CA3AF' }}>
            Step 1 — Family &amp; Portfolio
          </p>

          {/* Family selector */}
          {families.length > 1 && (
            <div className="space-y-1.5 mb-4">
              <Label className="text-xs" style={{ color: '#6B7280' }}>Family</Label>
              <div className="flex flex-wrap gap-2">
                {families.map(f => (
                  <button key={f.id}
                    onClick={() => handleManualFamilyChange(f.id)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all border"
                    style={{
                      backgroundColor: selectedFamily === f.id ? '#1B2A4A' : 'transparent',
                      color: selectedFamily === f.id ? 'white' : '#6B7280',
                      borderColor: selectedFamily === f.id ? '#1B2A4A' : '#E8E5DD',
                    }}>
                    {f.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Family member */}
          {members.length > 1 && (
            <div className="space-y-1.5 mb-4">
              <Label className="text-xs" style={{ color: '#6B7280' }}>Family Member</Label>
              <Select value={member} onValueChange={setMember}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {members.map(m => <SelectItem key={m.id} value={m.id} className="text-xs">{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Portfolio name */}
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: '#6B7280' }}>Portfolio Name</Label>
            <Input
              value={portfolioName}
              onChange={e => setPortfolioName(e.target.value)}
              placeholder="e.g. My Portfolio"
              className="h-9 text-xs"
            />
            <FieldError msg={errors.portfolio} />
          </div>
        </div>

        {/* Step 2 — FD Details */}
        <div className="wv-card p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#9CA3AF' }}>
            Step 2 — FD Details
          </p>

          <div className="space-y-4">
            {/* Row: FD Type + Bank */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>FD Type</Label>
                <Select value={fdType} onValueChange={setFdType}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FD_TYPES.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Bank / Institution <span style={{ color: '#DC2626' }}>*</span></Label>
                <Input
                  value={bank}
                  onChange={e => setBank(e.target.value)}
                  placeholder="e.g. SBI, HDFC Bank"
                  className="h-9 text-xs"
                />
                <FieldError msg={errors.bank} />
              </div>
            </div>

            {/* Account number */}
            <div className="space-y-1.5">
              <Label className="text-xs" style={{ color: '#6B7280' }}>FD Account / Certificate Number <span className="text-gray-400">(optional)</span></Label>
              <Input
                value={accountNumber}
                onChange={e => setAccountNumber(e.target.value)}
                placeholder="e.g. FD12345678"
                className="h-9 text-xs"
              />
            </div>

            {/* Row: Principal + Interest Rate */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Principal Amount (₹) <span style={{ color: '#DC2626' }}>*</span></Label>
                <Input
                  type="number"
                  value={principal}
                  onChange={e => setPrincipal(e.target.value)}
                  placeholder="0"
                  step="1"
                  min="0"
                  className="h-9 text-xs"
                />
                <FieldError msg={errors.principal} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Interest Rate (% p.a.) <span style={{ color: '#DC2626' }}>*</span></Label>
                <Input
                  type="number"
                  value={interestRate}
                  onChange={e => setInterestRate(e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  min="0"
                  max="100"
                  className="h-9 text-xs"
                />
                <FieldError msg={errors.rate} />
              </div>
            </div>

            {/* Row: Tenure (value + unit) */}
            <div className="space-y-1.5">
              <Label className="text-xs" style={{ color: '#6B7280' }}>Tenure <span style={{ color: '#DC2626' }}>*</span></Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={tenureValue}
                  onChange={e => { setTenureValue(e.target.value); setMaturityDateManual(false); }}
                  placeholder="0"
                  step="1"
                  min="0"
                  className="h-9 text-xs flex-1"
                />
                <Select value={tenureUnit} onValueChange={v => { setTenureUnit(v); setMaturityDateManual(false); }}>
                  <SelectTrigger className="h-9 text-xs w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TENURE_UNITS.map(u => <SelectItem key={u} value={u} className="text-xs">{u}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <FieldError msg={errors.tenure} />
            </div>

            {/* Row: Start Date + Maturity Date */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Start Date <span style={{ color: '#DC2626' }}>*</span></Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={e => { setStartDate(e.target.value); setMaturityDateManual(false); }}
                  className="h-9 text-xs"
                />
                <FieldError msg={errors.startDate} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>
                  Maturity Date
                  {!maturityDateManual && maturityDate && (
                    <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                      style={{ backgroundColor: 'rgba(5,150,105,0.1)', color: '#059669' }}>
                      auto
                    </span>
                  )}
                </Label>
                <Input
                  type="date"
                  value={maturityDate}
                  onChange={e => { setMaturityDate(e.target.value); setMaturityDateManual(true); }}
                  className="h-9 text-xs"
                />
              </div>
            </div>

            {/* Row: Compounding + Payout */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Compounding Frequency</Label>
                <Select value={compounding} onValueChange={setCompounding}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COMPOUNDING_FREQ.map(c => <SelectItem key={c.key} value={c.key} className="text-xs">{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Interest Payout</Label>
                <Select value={payout} onValueChange={setPayout}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAYOUT_OPTIONS.map(p => <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Auto-Renew */}
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <div
                className="w-4 h-4 rounded border flex items-center justify-center transition-all"
                style={{
                  backgroundColor: autoRenew ? '#1B2A4A' : 'transparent',
                  borderColor: autoRenew ? '#1B2A4A' : '#D1D5DB',
                }}
              >
                {autoRenew && <Check className="w-3 h-3 text-white" />}
              </div>
              <input
                type="checkbox"
                checked={autoRenew}
                onChange={e => setAutoRenew(e.target.checked)}
                className="sr-only"
              />
              <span className="text-xs" style={{ color: '#6B7280' }}>Auto-Renew on Maturity</span>
            </label>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label className="text-xs" style={{ color: '#6B7280' }}>Notes <span className="text-gray-400">(optional)</span></Label>
              <Input
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Any additional notes..."
                className="h-9 text-xs"
              />
            </div>
          </div>
        </div>

        {/* Summary Section */}
        {principalNum > 0 && rateNum > 0 && t > 0 && (
          <div className="wv-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#C9A84C' }}>
              Calculated Summary
            </p>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'rgba(27,42,74,0.04)' }}>
                <p className="text-[10px] font-medium mb-1" style={{ color: '#9CA3AF' }}>Principal</p>
                <p className="text-sm font-bold" style={{ color: '#1B2A4A' }}>{formatLargeINR(principalNum)}</p>
              </div>
              <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'rgba(5,150,105,0.06)' }}>
                <p className="text-[10px] font-medium mb-1" style={{ color: '#9CA3AF' }}>Maturity Amount</p>
                <p className="text-sm font-bold" style={{ color: '#059669' }}>{formatLargeINR(Math.round(maturityAmount))}</p>
              </div>
              <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'rgba(201,168,76,0.08)' }}>
                <p className="text-[10px] font-medium mb-1" style={{ color: '#9CA3AF' }}>Total Interest</p>
                <p className="text-sm font-bold" style={{ color: '#C9A84C' }}>{formatLargeINR(Math.round(totalInterest))}</p>
              </div>
              <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'rgba(27,42,74,0.04)' }}>
                <p className="text-[10px] font-medium mb-1" style={{ color: '#9CA3AF' }}>Effective Yield %</p>
                <p className="text-sm font-bold" style={{ color: '#1B2A4A' }}>{effectiveYield.toFixed(2)}%</p>
              </div>
              <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'rgba(27,42,74,0.04)' }}>
                <p className="text-[10px] font-medium mb-1" style={{ color: '#9CA3AF' }}>Maturity Date</p>
                <p className="text-sm font-bold" style={{ color: '#1B2A4A' }}>
                  {maturityDate ? new Date(maturityDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                </p>
              </div>
              <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'rgba(27,42,74,0.04)' }}>
                <p className="text-[10px] font-medium mb-1" style={{ color: '#9CA3AF' }}>Days to Maturity</p>
                <p className="text-sm font-bold" style={{ color: '#1B2A4A' }}>
                  {daysToMaturity > 0 ? daysToMaturity.toLocaleString('en-IN') : 'Matured'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Save Button */}
        <Button
          onClick={handleSave}
          disabled={saving}
          className="w-full h-11 text-sm font-semibold text-white"
          style={{ backgroundColor: '#1B2A4A' }}
        >
          {saving ? (
            <span className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Saving...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Landmark className="w-4 h-4" />
              Save Fixed Deposit
            </span>
          )}
        </Button>

      </div>
    </div>
  );
}

// ─── Page wrapper with Suspense ─────────────────────────────────────────────────

export default function FixedDepositsPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#C9A84C' }} />
      </div>
    }>
      <FixedDepositFormContent />
    </Suspense>
  );
}
