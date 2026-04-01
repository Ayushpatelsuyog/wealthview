'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileText, Check, AlertCircle, X, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR } from '@/lib/utils/formatters';

// ─── Types ──────────────────────────────────────────────────────────────────────

interface FamilyMember { id: string; name: string }
interface Toast { type: 'success' | 'error'; message: string }

// ─── Constants ──────────────────────────────────────────────────────────────────

const BOND_TYPES = [
  'Government Bond (G-Sec)',
  'Corporate Bond',
  'Sovereign Gold Bond (SGB)',
  'Tax-Free Bond',
  'RBI Bond',
  'NCD',
  'State Development Loan (SDL)',
];

const COUPON_FREQUENCIES = [
  { key: 'annual',      label: 'Annual',      n: 1 },
  { key: 'semi_annual', label: 'Semi-Annual', n: 2 },
  { key: 'quarterly',   label: 'Quarterly',   n: 4 },
  { key: 'monthly',     label: 'Monthly',     n: 12 },
  { key: 'zero_coupon', label: 'Zero Coupon', n: 0 },
];

const CREDIT_RATINGS = [
  'AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'BBB+', 'BBB', 'BB', 'Below BB', 'Unrated', 'Sovereign',
];

const TAX_TREATMENTS = [
  { key: 'Taxable',  label: 'Taxable' },
  { key: 'Tax-Free', label: 'Tax-Free' },
  { key: 'LTCG',     label: 'LTCG' },
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

// ─── Helpers ────────────────────────────────────────────────────────────────────

function daysBetween(a: string, b: string): number {
  const d1 = new Date(a);
  const d2 = new Date(b);
  if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return 0;
  return Math.max(0, Math.ceil((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)));
}

function approximateYTM(faceValue: number, purchasePrice: number, couponRate: number, yearsToMaturity: number): number {
  // Approximate YTM = (C + (F - P) / n) / ((F + P) / 2) * 100
  if (yearsToMaturity <= 0 || purchasePrice <= 0) return 0;
  const C = faceValue * couponRate / 100;
  const numerator = C + (faceValue - purchasePrice) / yearsToMaturity;
  const denominator = (faceValue + purchasePrice) / 2;
  return (numerator / denominator) * 100;
}

// ─── Module-level: survives re-renders, consumed once when members load ─────

let _pendingMember: string | null = null;

// ─── Main Form Content ─────────────────────────────────────────────────────────

function BondFormContent() {
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

  // Bond fields
  const [bondType, setBondType] = useState('Government Bond (G-Sec)');
  const [bondName, setBondName] = useState('');
  const [isin, setIsin] = useState('');
  const [faceValue, setFaceValue] = useState('1000');
  const [purchasePrice, setPurchasePrice] = useState('1000');
  const [units, setUnits] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [couponRate, setCouponRate] = useState('');
  const [couponFrequency, setCouponFrequency] = useState('semi_annual');
  const [maturityDate, setMaturityDate] = useState('');
  const [creditRating, setCreditRating] = useState('Unrated');
  const [taxTreatment, setTaxTreatment] = useState('Taxable');
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

  // ── Auto-set today for purchase date ──────────────────────────────────────────
  useEffect(() => {
    setPurchaseDate(new Date().toISOString().split('T')[0]);
  }, []);

  // ── Sync purchase price to face value when face value changes ────────────────
  useEffect(() => {
    const pp = parseFloat(purchasePrice);
    // Only auto-sync if purchase price equals old face value or is empty
    if (!purchasePrice || pp === 1000 || isNaN(pp)) {
      setPurchasePrice(faceValue);
    }
  }, [faceValue]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Calculations ──────────────────────────────────────────────────────────────
  const faceValueNum = parseFloat(faceValue) || 0;
  const purchasePriceNum = parseFloat(purchasePrice) || 0;
  const unitsNum = parseFloat(units) || 0;
  const couponRateNum = parseFloat(couponRate) || 0;

  const totalInvestment = purchasePriceNum * unitsNum;
  const annualCouponIncome = couponFrequency === 'zero_coupon' ? 0 : (faceValueNum * couponRateNum * unitsNum / 100);
  const today = new Date().toISOString().split('T')[0];
  const daysToMaturity = maturityDate ? daysBetween(today, maturityDate) : 0;
  const yearsToMaturity = daysToMaturity / 365.25;
  const ytm = approximateYTM(faceValueNum, purchasePriceNum, couponRateNum, yearsToMaturity);

  // ── Validate ──────────────────────────────────────────────────────────────────
  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!bondName.trim()) errs.bondName = 'Enter bond name or description';
    if (!faceValue || faceValueNum <= 0) errs.faceValue = 'Enter a valid face value';
    if (!purchasePrice || purchasePriceNum <= 0) errs.purchasePrice = 'Enter a valid purchase price';
    if (!units || unitsNum <= 0) errs.units = 'Enter number of units';
    if (!purchaseDate) errs.purchaseDate = 'Select purchase date';
    if (!couponRate && couponFrequency !== 'zero_coupon') errs.couponRate = 'Enter coupon rate';
    if (!maturityDate) errs.maturityDate = 'Select maturity date';
    if (!portfolioName.trim()) errs.portfolio = 'Enter a portfolio name';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Save ──────────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!validate()) return;
    setSaving(true);

    try {
      const res = await fetch('/api/bonds/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bondName: bondName.trim(),
          bondType,
          isin: isin.trim() || undefined,
          faceValue: faceValueNum,
          purchasePrice: purchasePriceNum,
          units: unitsNum,
          purchaseDate,
          couponRate: couponRateNum,
          couponFrequency,
          maturityDate,
          creditRating,
          taxTreatment,
          notes: notes.trim() || undefined,
          memberId: member,
          familyId: selectedFamily || undefined,
          portfolioName: portfolioName.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed');

      setToast({ type: 'success', message: 'Bond added successfully!' });
      setTimeout(() => router.push('/portfolio/bonds'), 1200);
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
            <FileText className="w-5 h-5" style={{ color: 'var(--wv-text)' }} />
          </div>
          <div>
            <h1 className="text-lg font-bold" style={{ color: 'var(--wv-text)' }}>Add Bond</h1>
            <p className="text-xs" style={{ color: 'var(--wv-text-muted)' }}>Enter your bond details for tracking</p>
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

        {/* Step 2 — Bond Details */}
        <div className="wv-card p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--wv-text-muted)' }}>
            Step 2 — Bond Details
          </p>

          <div className="space-y-4">
            {/* Row: Bond Type + Credit Rating */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Bond Type</Label>
                <Select value={bondType} onValueChange={setBondType}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BOND_TYPES.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Credit Rating</Label>
                <Select value={creditRating} onValueChange={setCreditRating}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CREDIT_RATINGS.map(r => <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Bond Name */}
            <div className="space-y-1.5">
              <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Bond Name / Description <span style={{ color: '#DC2626' }}>*</span></Label>
              <Input
                value={bondName}
                onChange={e => setBondName(e.target.value)}
                placeholder="e.g. GOI 7.26% 2033, Tata Capital NCD"
                className="h-9 text-xs"
              />
              <FieldError msg={errors.bondName} />
            </div>

            {/* ISIN */}
            <div className="space-y-1.5">
              <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>ISIN <span className="text-gray-400">(optional)</span></Label>
              <Input
                value={isin}
                onChange={e => setIsin(e.target.value)}
                placeholder="e.g. IN0020220032"
                className="h-9 text-xs"
              />
            </div>

            {/* Row: Face Value + Purchase Price */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Face Value (₹) <span style={{ color: '#DC2626' }}>*</span></Label>
                <Input
                  type="number"
                  value={faceValue}
                  onChange={e => setFaceValue(e.target.value)}
                  placeholder="1000"
                  step="1"
                  min="0"
                  className="h-9 text-xs"
                />
                <FieldError msg={errors.faceValue} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Purchase Price per Unit (₹) <span style={{ color: '#DC2626' }}>*</span></Label>
                <Input
                  type="number"
                  value={purchasePrice}
                  onChange={e => setPurchasePrice(e.target.value)}
                  placeholder="1000"
                  step="0.01"
                  min="0"
                  className="h-9 text-xs"
                />
                <FieldError msg={errors.purchasePrice} />
              </div>
            </div>

            {/* Row: Number of Units + Purchase Date */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Number of Units / Bonds <span style={{ color: '#DC2626' }}>*</span></Label>
                <Input
                  type="number"
                  value={units}
                  onChange={e => setUnits(e.target.value)}
                  placeholder="0"
                  step="1"
                  min="1"
                  className="h-9 text-xs"
                />
                <FieldError msg={errors.units} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Purchase Date <span style={{ color: '#DC2626' }}>*</span></Label>
                <Input
                  type="date"
                  value={purchaseDate}
                  onChange={e => setPurchaseDate(e.target.value)}
                  className="h-9 text-xs"
                />
                <FieldError msg={errors.purchaseDate} />
              </div>
            </div>

            {/* Row: Coupon Rate + Coupon Frequency */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Coupon Rate (% p.a.) <span style={{ color: '#DC2626' }}>*</span></Label>
                <Input
                  type="number"
                  value={couponRate}
                  onChange={e => setCouponRate(e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  min="0"
                  max="100"
                  className="h-9 text-xs"
                />
                <FieldError msg={errors.couponRate} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Coupon Frequency</Label>
                <Select value={couponFrequency} onValueChange={setCouponFrequency}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COUPON_FREQUENCIES.map(c => <SelectItem key={c.key} value={c.key} className="text-xs">{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Maturity Date */}
            <div className="space-y-1.5">
              <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Maturity Date <span style={{ color: '#DC2626' }}>*</span></Label>
              <Input
                type="date"
                value={maturityDate}
                onChange={e => setMaturityDate(e.target.value)}
                className="h-9 text-xs"
              />
              <FieldError msg={errors.maturityDate} />
            </div>

            {/* Tax Treatment */}
            <div className="space-y-1.5">
              <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Tax Treatment</Label>
              <Select value={taxTreatment} onValueChange={setTaxTreatment}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TAX_TREATMENTS.map(t => <SelectItem key={t.key} value={t.key} className="text-xs">{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
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
        {purchasePriceNum > 0 && unitsNum > 0 && (
          <div className="wv-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#C9A84C' }}>
              Calculated Summary
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'rgba(27,42,74,0.04)' }}>
                <p className="text-[10px] font-medium mb-1" style={{ color: 'var(--wv-text-muted)' }}>Total Investment</p>
                <p className="text-sm font-bold" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(totalInvestment)}</p>
              </div>
              <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'rgba(5,150,105,0.06)' }}>
                <p className="text-[10px] font-medium mb-1" style={{ color: 'var(--wv-text-muted)' }}>Annual Coupon Income</p>
                <p className="text-sm font-bold" style={{ color: '#059669' }}>
                  {couponFrequency === 'zero_coupon' ? 'N/A' : formatLargeINR(Math.round(annualCouponIncome))}
                </p>
              </div>
              <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'rgba(27,42,74,0.04)' }}>
                <p className="text-[10px] font-medium mb-1" style={{ color: 'var(--wv-text-muted)' }}>Days to Maturity</p>
                <p className="text-sm font-bold" style={{ color: 'var(--wv-text)' }}>
                  {daysToMaturity > 0 ? daysToMaturity.toLocaleString('en-IN') : maturityDate ? 'Matured' : '—'}
                </p>
              </div>
              <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'rgba(201,168,76,0.08)' }}>
                <p className="text-[10px] font-medium mb-1" style={{ color: 'var(--wv-text-muted)' }}>Approx. YTM</p>
                <p className="text-sm font-bold" style={{ color: '#C9A84C' }}>
                  {yearsToMaturity > 0 ? `${ytm.toFixed(2)}%` : '—'}
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
              <FileText className="w-4 h-4" />
              Save Bond
            </span>
          )}
        </Button>

      </div>
    </div>
  );
}

// ─── Page wrapper with Suspense ─────────────────────────────────────────────────

export default function AddBondPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#C9A84C' }} />
      </div>
    }>
      <BondFormContent />
    </Suspense>
  );
}
