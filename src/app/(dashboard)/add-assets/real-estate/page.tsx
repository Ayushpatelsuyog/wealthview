'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Building, Check, AlertCircle, X, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR } from '@/lib/utils/formatters';

// ─── Types ──────────────────────────────────────────────────────────────────────

interface FamilyMember { id: string; name: string }
interface Toast { type: 'success' | 'error'; message: string }

// ─── Constants ──────────────────────────────────────────────────────────────────

const PROPERTY_TYPES = ['Residential', 'Commercial', 'Land', 'Under Construction'];
const OWNERSHIP_TYPES = ['Self', 'Joint', 'Company', 'HUF'];

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

function RealEstateFormContent() {
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

  // Property fields
  const [propertyType, setPropertyType] = useState('Residential');
  const [propertyName, setPropertyName] = useState('');
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [pin, setPin] = useState('');
  const [carpetArea, setCarpetArea] = useState('');
  const [superBuiltUp, setSuperBuiltUp] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [currentValue, setCurrentValue] = useState('');
  const [registrationCharges, setRegistrationCharges] = useState('');
  const [stampDuty, setStampDuty] = useState('');
  const [ownership, setOwnership] = useState('Self');

  // Loan section
  const [showLoan, setShowLoan] = useState(false);
  const [loanAmount, setLoanAmount] = useState('');
  const [loanBank, setLoanBank] = useState('');
  const [loanRate, setLoanRate] = useState('');
  const [emi, setEmi] = useState('');
  const [loanStart, setLoanStart] = useState('');
  const [loanTenure, setLoanTenure] = useState('');
  const [outstandingBalance, setOutstandingBalance] = useState('');

  // Rental section
  const [showRental, setShowRental] = useState(false);
  const [monthlyRent, setMonthlyRent] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [leaseStart, setLeaseStart] = useState('');
  const [leaseEnd, setLeaseEnd] = useState('');

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

  // ── Calculations ──────────────────────────────────────────────────────────────
  const purchase = parseFloat(purchasePrice) || 0;
  const regCharges = parseFloat(registrationCharges) || 0;
  const stamp = parseFloat(stampDuty) || 0;
  const curValue = parseFloat(currentValue) || 0;
  const loanOut = parseFloat(outstandingBalance) || 0;
  const rent = parseFloat(monthlyRent) || 0;

  const totalCost = purchase + regCharges + stamp;
  const netEquity = curValue - loanOut;
  const rentalYield = curValue > 0 && rent > 0 ? ((rent * 12) / curValue) * 100 : 0;
  const appreciation = curValue > 0 && totalCost > 0 ? curValue - totalCost : 0;
  const appreciationPercent = totalCost > 0 ? (appreciation / totalCost) * 100 : 0;

  // ── Validate ──────────────────────────────────────────────────────────────────
  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!propertyName.trim()) errs.propertyName = 'Enter property name';
    if (!city.trim()) errs.city = 'Enter city';
    if (!purchasePrice || purchase <= 0) errs.purchasePrice = 'Enter a valid purchase price';
    if (!purchaseDate) errs.purchaseDate = 'Enter purchase date';
    if (!portfolioName.trim()) errs.portfolio = 'Enter a portfolio name';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Save ──────────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!validate()) return;
    setSaving(true);

    try {
      const res = await fetch('/api/manual-assets/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_type: 'real_estate',
          name: propertyName.trim(),
          current_value: curValue > 0 ? curValue : totalCost,
          metadata: {
            property_type: propertyType,
            property_name: propertyName.trim(),
            address: {
              street: street.trim() || undefined,
              city: city.trim(),
              state: state.trim() || undefined,
              pin: pin.trim() || undefined,
            },
            carpet_area: parseFloat(carpetArea) || undefined,
            super_built_up_area: parseFloat(superBuiltUp) || undefined,
            purchase_price: purchase,
            purchase_date: purchaseDate,
            current_value: curValue || undefined,
            registration_charges: regCharges || undefined,
            stamp_duty: stamp || undefined,
            total_cost: totalCost,
            ownership,
            net_equity: netEquity,
            appreciation: Math.round(appreciation * 100) / 100,
            appreciation_percent: Math.round(appreciationPercent * 100) / 100,
            // Loan
            ...(showLoan ? {
              loan: {
                amount: parseFloat(loanAmount) || undefined,
                bank: loanBank.trim() || undefined,
                interest_rate: parseFloat(loanRate) || undefined,
                emi: parseFloat(emi) || undefined,
                start_date: loanStart || undefined,
                tenure_years: parseFloat(loanTenure) || undefined,
                outstanding_balance: loanOut || undefined,
              },
            } : {}),
            // Rental
            ...(showRental ? {
              rental: {
                monthly_rent: rent || undefined,
                tenant_name: tenantName.trim() || undefined,
                lease_start: leaseStart || undefined,
                lease_end: leaseEnd || undefined,
                rental_yield: Math.round(rentalYield * 100) / 100,
              },
            } : {}),
            notes: notes.trim() || undefined,
          },
          memberId: member,
          portfolioName: portfolioName.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed');

      setToast({ type: 'success', message: 'Property added successfully!' });
      setTimeout(() => router.push('/portfolio/real-estate'), 1200);
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
            <Building className="w-5 h-5" style={{ color: '#1B2A4A' }} />
          </div>
          <div>
            <h1 className="text-lg font-bold" style={{ color: '#1B2A4A' }}>Add Real Estate</h1>
            <p className="text-xs" style={{ color: '#9CA3AF' }}>Track your property investments</p>
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

        {/* Step 2 — Property Details */}
        <div className="wv-card p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#9CA3AF' }}>
            Step 2 — Property Details
          </p>

          <div className="space-y-4">
            {/* Property Type + Property Name */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Property Type</Label>
                <Select value={propertyType} onValueChange={setPropertyType}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROPERTY_TYPES.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Property Name <span style={{ color: '#DC2626' }}>*</span></Label>
                <Input
                  value={propertyName}
                  onChange={e => setPropertyName(e.target.value)}
                  placeholder="e.g. Green Valley Apartment"
                  className="h-9 text-xs"
                />
                <FieldError msg={errors.propertyName} />
              </div>
            </div>

            {/* Address */}
            <div className="space-y-1.5">
              <Label className="text-xs" style={{ color: '#6B7280' }}>Street Address</Label>
              <Input
                value={street}
                onChange={e => setStreet(e.target.value)}
                placeholder="e.g. 42, MG Road, Whitefield"
                className="h-9 text-xs"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>City <span style={{ color: '#DC2626' }}>*</span></Label>
                <Input
                  value={city}
                  onChange={e => setCity(e.target.value)}
                  placeholder="e.g. Bangalore"
                  className="h-9 text-xs"
                />
                <FieldError msg={errors.city} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>State</Label>
                <Input
                  value={state}
                  onChange={e => setState(e.target.value)}
                  placeholder="e.g. Karnataka"
                  className="h-9 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Pin Code</Label>
                <Input
                  value={pin}
                  onChange={e => setPin(e.target.value)}
                  placeholder="e.g. 560066"
                  className="h-9 text-xs"
                />
              </div>
            </div>

            {/* Area */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Carpet Area (sq ft)</Label>
                <Input
                  type="number"
                  value={carpetArea}
                  onChange={e => setCarpetArea(e.target.value)}
                  placeholder="0"
                  step="1"
                  min="0"
                  className="h-9 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Super Built-up Area (sq ft)</Label>
                <Input
                  type="number"
                  value={superBuiltUp}
                  onChange={e => setSuperBuiltUp(e.target.value)}
                  placeholder="0"
                  step="1"
                  min="0"
                  className="h-9 text-xs"
                />
              </div>
            </div>

            {/* Purchase Price + Purchase Date */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Purchase Price (₹) <span style={{ color: '#DC2626' }}>*</span></Label>
                <Input
                  type="number"
                  value={purchasePrice}
                  onChange={e => setPurchasePrice(e.target.value)}
                  placeholder="0"
                  step="1"
                  min="0"
                  className="h-9 text-xs"
                />
                <FieldError msg={errors.purchasePrice} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Purchase Date <span style={{ color: '#DC2626' }}>*</span></Label>
                <Input
                  type="date"
                  value={purchaseDate}
                  onChange={e => setPurchaseDate(e.target.value)}
                  className="h-9 text-xs"
                />
                <FieldError msg={errors.purchaseDate} />
              </div>
            </div>

            {/* Current Value */}
            <div className="space-y-1.5">
              <Label className="text-xs" style={{ color: '#6B7280' }}>Current Market Value (₹)</Label>
              <Input
                type="number"
                value={currentValue}
                onChange={e => setCurrentValue(e.target.value)}
                placeholder="Estimated current value"
                step="1"
                min="0"
                className="h-9 text-xs"
              />
            </div>

            {/* Registration + Stamp Duty + Ownership */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Registration Charges (₹)</Label>
                <Input
                  type="number"
                  value={registrationCharges}
                  onChange={e => setRegistrationCharges(e.target.value)}
                  placeholder="0"
                  step="1"
                  min="0"
                  className="h-9 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Stamp Duty (₹)</Label>
                <Input
                  type="number"
                  value={stampDuty}
                  onChange={e => setStampDuty(e.target.value)}
                  placeholder="0"
                  step="1"
                  min="0"
                  className="h-9 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Ownership</Label>
                <Select value={ownership} onValueChange={setOwnership}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {OWNERSHIP_TYPES.map(o => <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Total Cost (auto) */}
            {totalCost > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>
                  Total Cost (₹)
                  <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                    style={{ backgroundColor: 'rgba(5,150,105,0.1)', color: '#059669' }}>
                    auto
                  </span>
                </Label>
                <Input
                  type="text"
                  value={`₹${totalCost.toLocaleString('en-IN')}`}
                  readOnly
                  className="h-9 text-xs bg-gray-50"
                />
                <p className="text-[10px]" style={{ color: '#9CA3AF' }}>Purchase Price + Registration + Stamp Duty</p>
              </div>
            )}
          </div>
        </div>

        {/* Loan Section (collapsible) */}
        <div className="wv-card p-5">
          <button
            onClick={() => setShowLoan(!showLoan)}
            className="flex items-center justify-between w-full"
          >
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#9CA3AF' }}>
              Loan Details
            </p>
            {showLoan ? <ChevronUp className="w-4 h-4" style={{ color: '#9CA3AF' }} /> : <ChevronDown className="w-4 h-4" style={{ color: '#9CA3AF' }} />}
          </button>

          {showLoan && (
            <div className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>Loan Amount (₹)</Label>
                  <Input
                    type="number"
                    value={loanAmount}
                    onChange={e => setLoanAmount(e.target.value)}
                    placeholder="0"
                    step="1"
                    min="0"
                    className="h-9 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>Bank / Lender</Label>
                  <Input
                    value={loanBank}
                    onChange={e => setLoanBank(e.target.value)}
                    placeholder="e.g. SBI, HDFC"
                    className="h-9 text-xs"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>Interest Rate (% p.a.)</Label>
                  <Input
                    type="number"
                    value={loanRate}
                    onChange={e => setLoanRate(e.target.value)}
                    placeholder="0.00"
                    step="0.01"
                    min="0"
                    max="100"
                    className="h-9 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>EMI (₹)</Label>
                  <Input
                    type="number"
                    value={emi}
                    onChange={e => setEmi(e.target.value)}
                    placeholder="0"
                    step="1"
                    min="0"
                    className="h-9 text-xs"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>Loan Start Date</Label>
                  <Input
                    type="date"
                    value={loanStart}
                    onChange={e => setLoanStart(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>Tenure (Years)</Label>
                  <Input
                    type="number"
                    value={loanTenure}
                    onChange={e => setLoanTenure(e.target.value)}
                    placeholder="0"
                    step="1"
                    min="0"
                    className="h-9 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>Outstanding Balance (₹)</Label>
                  <Input
                    type="number"
                    value={outstandingBalance}
                    onChange={e => setOutstandingBalance(e.target.value)}
                    placeholder="0"
                    step="1"
                    min="0"
                    className="h-9 text-xs"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Rental Section (collapsible) */}
        <div className="wv-card p-5">
          <button
            onClick={() => setShowRental(!showRental)}
            className="flex items-center justify-between w-full"
          >
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#9CA3AF' }}>
              Rental Details
            </p>
            {showRental ? <ChevronUp className="w-4 h-4" style={{ color: '#9CA3AF' }} /> : <ChevronDown className="w-4 h-4" style={{ color: '#9CA3AF' }} />}
          </button>

          {showRental && (
            <div className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>Monthly Rent (₹)</Label>
                  <Input
                    type="number"
                    value={monthlyRent}
                    onChange={e => setMonthlyRent(e.target.value)}
                    placeholder="0"
                    step="1"
                    min="0"
                    className="h-9 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>Tenant Name</Label>
                  <Input
                    value={tenantName}
                    onChange={e => setTenantName(e.target.value)}
                    placeholder="Tenant name"
                    className="h-9 text-xs"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>Lease Start Date</Label>
                  <Input
                    type="date"
                    value={leaseStart}
                    onChange={e => setLeaseStart(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>Lease End Date</Label>
                  <Input
                    type="date"
                    value={leaseEnd}
                    onChange={e => setLeaseEnd(e.target.value)}
                    className="h-9 text-xs"
                  />
                </div>
              </div>
              {rentalYield > 0 && (
                <p className="text-xs" style={{ color: '#059669' }}>Rental Yield: {rentalYield.toFixed(2)}% p.a.</p>
              )}
            </div>
          )}
        </div>

        {/* Notes */}
        <div className="wv-card p-5">
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

        {/* Calculated Summary */}
        {purchase > 0 && (
          <div className="wv-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#C9A84C' }}>
              Calculated Summary
            </p>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'rgba(27,42,74,0.04)' }}>
                <p className="text-[10px] font-medium mb-1" style={{ color: '#9CA3AF' }}>Total Cost</p>
                <p className="text-sm font-bold" style={{ color: '#1B2A4A' }}>{formatLargeINR(totalCost)}</p>
              </div>
              {curValue > 0 && (
                <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'rgba(5,150,105,0.06)' }}>
                  <p className="text-[10px] font-medium mb-1" style={{ color: '#9CA3AF' }}>Current Value</p>
                  <p className="text-sm font-bold" style={{ color: '#059669' }}>{formatLargeINR(curValue)}</p>
                </div>
              )}
              {loanOut > 0 && (
                <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'rgba(220,38,38,0.06)' }}>
                  <p className="text-[10px] font-medium mb-1" style={{ color: '#9CA3AF' }}>Loan Outstanding</p>
                  <p className="text-sm font-bold" style={{ color: '#DC2626' }}>{formatLargeINR(loanOut)}</p>
                </div>
              )}
              {curValue > 0 && (
                <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'rgba(27,42,74,0.04)' }}>
                  <p className="text-[10px] font-medium mb-1" style={{ color: '#9CA3AF' }}>Net Equity</p>
                  <p className="text-sm font-bold" style={{ color: '#1B2A4A' }}>{formatLargeINR(netEquity)}</p>
                </div>
              )}
              {rentalYield > 0 && (
                <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'rgba(201,168,76,0.08)' }}>
                  <p className="text-[10px] font-medium mb-1" style={{ color: '#9CA3AF' }}>Rental Yield</p>
                  <p className="text-sm font-bold" style={{ color: '#C9A84C' }}>{rentalYield.toFixed(2)}%</p>
                </div>
              )}
              {curValue > 0 && totalCost > 0 && (
                <div className="text-center p-3 rounded-lg" style={{ backgroundColor: appreciation >= 0 ? 'rgba(5,150,105,0.06)' : 'rgba(220,38,38,0.06)' }}>
                  <p className="text-[10px] font-medium mb-1" style={{ color: '#9CA3AF' }}>Appreciation</p>
                  <p className="text-sm font-bold" style={{ color: appreciation >= 0 ? '#059669' : '#DC2626' }}>
                    {appreciation >= 0 ? '+' : ''}{formatLargeINR(Math.round(appreciation))} ({appreciationPercent >= 0 ? '+' : ''}{appreciationPercent.toFixed(1)}%)
                  </p>
                </div>
              )}
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
              <Building className="w-4 h-4" />
              Save Property
            </span>
          )}
        </Button>

      </div>
    </div>
  );
}

// ─── Page wrapper with Suspense ─────────────────────────────────────────────────

export default function RealEstateAddPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#C9A84C' }} />
      </div>
    }>
      <RealEstateFormContent />
    </Suspense>
  );
}
