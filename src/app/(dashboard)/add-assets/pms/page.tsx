'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Layers, Check, AlertCircle, X, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR } from '@/lib/utils/formatters';

// ─── Types ──────────────────────────────────────────────────────────────────────

interface FamilyMember { id: string; name: string }
interface Toast { type: 'success' | 'error'; message: string }

// ─── Constants ──────────────────────────────────────────────────────────────────

const BENCHMARKS = [
  'Nifty 50',
  'Nifty 500',
  'BSE 500',
  'Custom',
];

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

// ─── Module-level: survives re-renders, consumed once when members load ─────

let _pendingMember: string | null = null;

// ─── Main Form Content ─────────────────────────────────────────────────────────

function PMSFormContent() {
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

  // PMS fields
  const [providerName, setProviderName] = useState('');
  const [strategyName, setStrategyName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [investmentAmount, setInvestmentAmount] = useState('');
  const [investmentDate, setInvestmentDate] = useState('');
  const [currentValue, setCurrentValue] = useState('');
  const [managementFee, setManagementFee] = useState('');
  const [performanceFee, setPerformanceFee] = useState('');
  const [hurdleRate, setHurdleRate] = useState('');
  const [benchmark, setBenchmark] = useState('Nifty 50');
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

  // ── Auto-set today for investment date ────────────────────────────────────────
  useEffect(() => {
    setInvestmentDate(new Date().toISOString().split('T')[0]);
  }, []);

  // ── Calculations ──────────────────────────────────────────────────────────────
  const investedNum = parseFloat(investmentAmount) || 0;
  const currentNum = parseFloat(currentValue) || 0;
  const pnl = currentNum - investedNum;
  const returnPct = investedNum > 0 ? (pnl / investedNum) * 100 : 0;

  // ── Validate ──────────────────────────────────────────────────────────────────
  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!providerName.trim()) errs.providerName = 'Enter PMS provider name';
    if (!strategyName.trim()) errs.strategyName = 'Enter strategy name';
    if (!investmentAmount || investedNum <= 0) errs.investmentAmount = 'Enter a valid investment amount';
    if (!investmentDate) errs.investmentDate = 'Select investment date';
    if (!currentValue || currentNum <= 0) errs.currentValue = 'Enter current value';
    if (!portfolioName.trim()) errs.portfolio = 'Enter a portfolio name';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Save ──────────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!validate()) return;
    setSaving(true);

    try {
      const assetName = `${providerName.trim()} - ${strategyName.trim()}`;
      const res = await fetch('/api/manual-assets/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_type: 'pms',
          name: assetName,
          current_value: currentNum,
          metadata: {
            provider_name: providerName.trim(),
            strategy_name: strategyName.trim(),
            account_number: accountNumber.trim() || undefined,
            investment_amount: investedNum,
            investment_date: investmentDate,
            management_fee: parseFloat(managementFee) || 0,
            performance_fee: parseFloat(performanceFee) || 0,
            hurdle_rate: parseFloat(hurdleRate) || 0,
            benchmark,
            notes: notes.trim() || undefined,
          },
          memberId: member,
          familyId: selectedFamily || undefined,
          portfolioName: portfolioName.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed');

      setToast({ type: 'success', message: 'PMS holding added successfully!' });
      setTimeout(() => router.push('/portfolio/pms'), 1200);
    } catch (err) {
      setToast({ type: 'error', message: err instanceof Error ? err.message : 'Something went wrong' });
    }
    setSaving(false);
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen py-6 px-4" style={{ backgroundColor: 'var(--wv-surface-2)' }}>
      <div className="max-w-2xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: 'var(--wv-surface-2)' }}>
            <Layers className="w-5 h-5" style={{ color: 'var(--wv-text)' }} />
          </div>
          <div>
            <h1 className="text-lg font-bold" style={{ color: 'var(--wv-text)' }}>Add PMS</h1>
            <p className="text-xs" style={{ color: 'var(--wv-text-muted)' }}>Enter your Portfolio Management Service details</p>
          </div>
        </div>

        {/* Toast */}
        {toast && <ToastBanner toast={toast} onClose={() => setToast(null)} />}

        {/* Step 1 — Family & Portfolio */}
        <div className="wv-card p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--wv-text-muted)' }}>
            Step 1 — Family &amp; Portfolio
          </p>

          {/* Family selector */}
          {families.length > 1 && (
            <div className="space-y-1.5 mb-4">
              <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Family</Label>
              <div className="flex flex-wrap gap-2">
                {families.map(f => (
                  <button key={f.id}
                    onClick={() => handleManualFamilyChange(f.id)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all border"
                    style={{
                      backgroundColor: selectedFamily === f.id ? '#1B2A4A' : 'transparent',
                      color: selectedFamily === f.id ? 'white' : '#6B7280',
                      borderColor: selectedFamily === f.id ? '#1B2A4A' : 'var(--wv-border)',
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
              <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Family Member</Label>
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
            <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Portfolio Name</Label>
            <Input
              value={portfolioName}
              onChange={e => setPortfolioName(e.target.value)}
              placeholder="e.g. My Portfolio"
              className="h-9 text-xs"
            />
            <FieldError msg={errors.portfolio} />
          </div>
        </div>

        {/* Step 2 — PMS Details */}
        <div className="wv-card p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--wv-text-muted)' }}>
            Step 2 — PMS Details
          </p>

          <div className="space-y-4">
            {/* Provider Name */}
            <div className="space-y-1.5">
              <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>PMS Provider Name <span style={{ color: '#DC2626' }}>*</span></Label>
              <Input
                value={providerName}
                onChange={e => setProviderName(e.target.value)}
                placeholder="e.g. Motilal Oswal, ASK Investment"
                className="h-9 text-xs"
              />
              <FieldError msg={errors.providerName} />
            </div>

            {/* Strategy Name */}
            <div className="space-y-1.5">
              <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Strategy Name <span style={{ color: '#DC2626' }}>*</span></Label>
              <Input
                value={strategyName}
                onChange={e => setStrategyName(e.target.value)}
                placeholder="e.g. Next Trillion Dollar Opportunity, India Select"
                className="h-9 text-xs"
              />
              <FieldError msg={errors.strategyName} />
            </div>

            {/* Account Number */}
            <div className="space-y-1.5">
              <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Account Number <span className="text-gray-400">(optional)</span></Label>
              <Input
                value={accountNumber}
                onChange={e => setAccountNumber(e.target.value)}
                placeholder="e.g. PMS-12345"
                className="h-9 text-xs"
              />
            </div>

            {/* Row: Investment Amount + Investment Date */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Investment Amount (₹) <span style={{ color: '#DC2626' }}>*</span></Label>
                <Input
                  type="number"
                  value={investmentAmount}
                  onChange={e => setInvestmentAmount(e.target.value)}
                  placeholder="5000000"
                  step="1"
                  min="0"
                  className="h-9 text-xs"
                />
                <FieldError msg={errors.investmentAmount} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Investment Date <span style={{ color: '#DC2626' }}>*</span></Label>
                <Input
                  type="date"
                  value={investmentDate}
                  onChange={e => setInvestmentDate(e.target.value)}
                  className="h-9 text-xs"
                />
                <FieldError msg={errors.investmentDate} />
              </div>
            </div>

            {/* Current Value */}
            <div className="space-y-1.5">
              <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Current Value (₹) <span style={{ color: '#DC2626' }}>*</span></Label>
              <Input
                type="number"
                value={currentValue}
                onChange={e => setCurrentValue(e.target.value)}
                placeholder="5500000"
                step="1"
                min="0"
                className="h-9 text-xs"
              />
              <FieldError msg={errors.currentValue} />
            </div>

            {/* Row: Management Fee + Performance Fee */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Management Fee (%)</Label>
                <Input
                  type="number"
                  value={managementFee}
                  onChange={e => setManagementFee(e.target.value)}
                  placeholder="1.5"
                  step="0.01"
                  min="0"
                  max="100"
                  className="h-9 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Performance Fee (%)</Label>
                <Input
                  type="number"
                  value={performanceFee}
                  onChange={e => setPerformanceFee(e.target.value)}
                  placeholder="20"
                  step="0.01"
                  min="0"
                  max="100"
                  className="h-9 text-xs"
                />
              </div>
            </div>

            {/* Row: Hurdle Rate + Benchmark */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Hurdle Rate (%)</Label>
                <Input
                  type="number"
                  value={hurdleRate}
                  onChange={e => setHurdleRate(e.target.value)}
                  placeholder="8"
                  step="0.01"
                  min="0"
                  max="100"
                  className="h-9 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Benchmark</Label>
                <Select value={benchmark} onValueChange={setBenchmark}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BENCHMARKS.map(b => <SelectItem key={b} value={b} className="text-xs">{b}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Notes <span className="text-gray-400">(optional)</span></Label>
              <Input
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Any additional notes..."
                className="h-9 text-xs"
              />
            </div>
          </div>
        </div>

        {/* Calculated Summary */}
        {investedNum > 0 && currentNum > 0 && (
          <div className="wv-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#C9A84C' }}>
              Calculated Summary
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'rgba(27,42,74,0.04)' }}>
                <p className="text-[10px] font-medium mb-1" style={{ color: 'var(--wv-text-muted)' }}>Investment</p>
                <p className="text-sm font-bold" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(investedNum)}</p>
              </div>
              <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'rgba(27,42,74,0.04)' }}>
                <p className="text-[10px] font-medium mb-1" style={{ color: 'var(--wv-text-muted)' }}>Current Value</p>
                <p className="text-sm font-bold" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(currentNum)}</p>
              </div>
              <div className="text-center p-3 rounded-lg" style={{ backgroundColor: pnl >= 0 ? 'rgba(5,150,105,0.06)' : 'rgba(220,38,38,0.06)' }}>
                <p className="text-[10px] font-medium mb-1" style={{ color: 'var(--wv-text-muted)' }}>P&amp;L</p>
                <p className="text-sm font-bold" style={{ color: pnl >= 0 ? '#059669' : '#DC2626' }}>
                  {pnl >= 0 ? '+' : ''}{formatLargeINR(pnl)}
                </p>
              </div>
              <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'rgba(201,168,76,0.08)' }}>
                <p className="text-[10px] font-medium mb-1" style={{ color: 'var(--wv-text-muted)' }}>Return %</p>
                <p className="text-sm font-bold" style={{ color: returnPct >= 0 ? '#059669' : '#DC2626' }}>
                  {returnPct >= 0 ? '+' : ''}{returnPct.toFixed(2)}%
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
              <Layers className="w-4 h-4" />
              Save PMS
            </span>
          )}
        </Button>

      </div>
    </div>
  );
}

// ─── Page wrapper with Suspense ─────────────────────────────────────────────────

export default function AddPMSPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#C9A84C' }} />
      </div>
    }>
      <PMSFormContent />
    </Suspense>
  );
}
