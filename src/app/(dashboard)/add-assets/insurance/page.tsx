'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Shield, Check, AlertCircle, X, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR } from '@/lib/utils/formatters';

// ─── Types ──────────────────────────────────────────────────────────────────────

interface FamilyMember { id: string; name: string }
interface Toast { type: 'success' | 'error'; message: string }

type InsuranceCategory = 'life_term' | 'life_guaranteed' | 'life_ulip' | 'health' | 'vehicle' | 'property';

// ─── Constants ──────────────────────────────────────────────────────────────────

const CATEGORIES: { key: InsuranceCategory; label: string }[] = [
  { key: 'life_term', label: 'Life Term' },
  { key: 'life_guaranteed', label: 'Life Guaranteed' },
  { key: 'life_ulip', label: 'Life ULIP' },
  { key: 'health', label: 'Health' },
  { key: 'vehicle', label: 'Vehicle' },
  { key: 'property', label: 'Property' },
];

const PREMIUM_FREQUENCIES = ['Monthly', 'Quarterly', 'Half-Yearly', 'Annual', 'Single'];

const NOMINEE_RELATIONSHIPS = ['Spouse', 'Child', 'Parent', 'Sibling', 'Other'];

const HEALTH_PLAN_TYPES = ['Individual', 'Family Floater', 'Group'];

const VEHICLE_TYPES = ['Car', 'Two-Wheeler'];

const VEHICLE_INSURANCE_TYPES = ['Comprehensive', 'Third Party'];

const COVER_TYPES = ['Structure', 'Contents', 'Both'];

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

// ─── Main Form Content ──────────────────────────────────────────────────────────

function InsuranceFormContent() {
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

  // Category
  const [category, setCategory] = useState<InsuranceCategory>('life_term');

  // Common fields
  const [provider, setProvider] = useState('');
  const [policyName, setPolicyName] = useState('');
  const [policyNumber, setPolicyNumber] = useState('');
  const [sumAssured, setSumAssured] = useState('');
  const [premium, setPremium] = useState('');
  const [premiumFrequency, setPremiumFrequency] = useState('Annual');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [nomineeName, setNomineeName] = useState('');
  const [nomineeRelationship, setNomineeRelationship] = useState('');

  // Life Term fields
  const [termYears, setTermYears] = useState('');
  const [riderCriticalIllness, setRiderCriticalIllness] = useState(false);
  const [riderAccidentalDeath, setRiderAccidentalDeath] = useState(false);

  // Life ULIP fields
  const [fundValue, setFundValue] = useState('');
  const [fundOptions, setFundOptions] = useState('');

  // Health fields
  const [healthPlanType, setHealthPlanType] = useState('Individual');
  const [roomRentLimit, setRoomRentLimit] = useState('');
  const [coPayPercent, setCoPayPercent] = useState('');
  const [ncbPercent, setNcbPercent] = useState('');

  // Vehicle fields
  const [vehicleType, setVehicleType] = useState('Car');
  const [vehicleMake, setVehicleMake] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleYear, setVehicleYear] = useState('');
  const [regNumber, setRegNumber] = useState('');
  const [idv, setIdv] = useState('');
  const [vehicleInsuranceType, setVehicleInsuranceType] = useState('Comprehensive');

  // Property fields
  const [coverType, setCoverType] = useState('Both');
  const [structureValue, setStructureValue] = useState('');
  const [contentsValue, setContentsValue] = useState('');

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

  // ── Build metadata from type-specific fields ──────────────────────────────────
  function buildMetadata(): Record<string, unknown> {
    const meta: Record<string, unknown> = {};

    if (category === 'life_term') {
      if (termYears) meta.term_years = parseInt(termYears, 10);
      const riders: string[] = [];
      if (riderCriticalIllness) riders.push('Critical Illness');
      if (riderAccidentalDeath) riders.push('Accidental Death');
      if (riders.length > 0) meta.riders = riders;
    }

    if (category === 'life_ulip') {
      if (fundValue) meta.fund_value = parseFloat(fundValue);
      if (fundOptions.trim()) meta.fund_options = fundOptions.trim();
    }

    if (category === 'health') {
      meta.plan_type = healthPlanType;
      if (roomRentLimit.trim()) meta.room_rent_limit = roomRentLimit.trim();
      if (coPayPercent) meta.co_pay_percent = parseFloat(coPayPercent);
      if (ncbPercent) meta.ncb_percent = parseFloat(ncbPercent);
    }

    if (category === 'vehicle') {
      meta.vehicle_type = vehicleType;
      if (vehicleMake.trim()) meta.make = vehicleMake.trim();
      if (vehicleModel.trim()) meta.model = vehicleModel.trim();
      if (vehicleYear) meta.year = parseInt(vehicleYear, 10);
      if (regNumber.trim()) meta.reg_number = regNumber.trim();
      if (idv) meta.idv = parseFloat(idv);
      meta.insurance_type = vehicleInsuranceType;
    }

    if (category === 'property') {
      meta.cover_type = coverType;
      if (structureValue) meta.structure_value = parseFloat(structureValue);
      if (contentsValue) meta.contents_value = parseFloat(contentsValue);
    }

    if (nomineeName.trim()) meta.nominee_name = nomineeName.trim();
    if (nomineeRelationship) meta.nominee_relationship = nomineeRelationship;

    return meta;
  }

  // ── Validate ──────────────────────────────────────────────────────────────────
  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!provider.trim()) errs.provider = 'Enter provider/insurer name';
    if (!policyName.trim()) errs.policyName = 'Enter policy name';
    if (!sumAssured || parseFloat(sumAssured) <= 0) errs.sumAssured = 'Enter a valid sum assured';
    if (!premium || parseFloat(premium) <= 0) errs.premium = 'Enter a valid premium amount';
    if (!startDate) errs.startDate = 'Select start date';
    if (!endDate) errs.endDate = 'Select end date';
    if (!member) errs.member = 'Select a family member';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Save ──────────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!validate()) return;
    setSaving(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Resolve family_id from selected member
      const { data: memberProfile } = await supabase
        .from('users').select('family_id').eq('id', member).single();
      const familyId = _familyId || memberProfile?.family_id;
      if (!familyId) throw new Error('No family associated');

      const { error } = await supabase.from('insurance_policies').insert({
        user_id: member,
        family_id: familyId,
        category,
        provider: provider.trim(),
        policy_name: policyName.trim(),
        policy_number: policyNumber.trim() || null,
        sum_assured: parseFloat(sumAssured),
        premium: parseFloat(premium),
        premium_frequency: premiumFrequency,
        start_date: startDate,
        maturity_date: endDate,
        metadata: buildMetadata(),
        is_active: true,
      });

      if (error) throw error;

      setToast({ type: 'success', message: 'Insurance policy added successfully!' });
      setTimeout(() => router.push('/portfolio/insurance'), 1200);
    } catch (err) {
      setToast({ type: 'error', message: err instanceof Error ? err.message : 'Something went wrong' });
    }
    setSaving(false);
  }

  // ── Computed values ───────────────────────────────────────────────────────────
  const sumAssuredNum = parseFloat(sumAssured) || 0;
  const premiumNum = parseFloat(premium) || 0;
  const annualPremium = premiumFrequency === 'Monthly' ? premiumNum * 12
    : premiumFrequency === 'Quarterly' ? premiumNum * 4
    : premiumFrequency === 'Half-Yearly' ? premiumNum * 2
    : premiumNum;

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen py-6 px-4" style={{ backgroundColor: '#F7F5F0' }}>
      <div className="max-w-2xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: 'rgba(27,42,74,0.08)' }}>
            <Shield className="w-5 h-5" style={{ color: '#1B2A4A' }} />
          </div>
          <div>
            <h1 className="text-lg font-bold" style={{ color: '#1B2A4A' }}>Add Insurance Policy</h1>
            <p className="text-xs" style={{ color: '#9CA3AF' }}>Add life, health, vehicle, or property insurance</p>
          </div>
        </div>

        {/* Toast */}
        {toast && <ToastBanner toast={toast} onClose={() => setToast(null)} />}

        {/* Step 1 — Family & Member */}
        <div className="wv-card p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#9CA3AF' }}>
            Step 1 — Family &amp; Member
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
              <FieldError msg={errors.member} />
            </div>
          )}
        </div>

        {/* Step 2 — Policy Category */}
        <div className="wv-card p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#9CA3AF' }}>
            Step 2 — Policy Category
          </p>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map(c => (
              <button
                key={c.key}
                onClick={() => setCategory(c.key)}
                className="px-4 py-2 rounded-full text-xs font-semibold transition-all border"
                style={{
                  backgroundColor: category === c.key ? '#1B2A4A' : 'transparent',
                  color: category === c.key ? 'white' : '#6B7280',
                  borderColor: category === c.key ? '#1B2A4A' : '#E8E5DD',
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Step 3 — Policy Details */}
        <div className="wv-card p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#9CA3AF' }}>
            Step 3 — Policy Details
          </p>

          <div className="space-y-4">
            {/* Provider + Policy Name */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Provider / Insurer <span style={{ color: '#DC2626' }}>*</span></Label>
                <Input
                  value={provider}
                  onChange={e => setProvider(e.target.value)}
                  placeholder="e.g. LIC, HDFC Life, ICICI Lombard"
                  className="h-9 text-xs"
                />
                <FieldError msg={errors.provider} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Policy Name <span style={{ color: '#DC2626' }}>*</span></Label>
                <Input
                  value={policyName}
                  onChange={e => setPolicyName(e.target.value)}
                  placeholder="e.g. HDFC Click 2 Protect"
                  className="h-9 text-xs"
                />
                <FieldError msg={errors.policyName} />
              </div>
            </div>

            {/* Policy Number */}
            <div className="space-y-1.5">
              <Label className="text-xs" style={{ color: '#6B7280' }}>Policy Number <span className="text-gray-400">(optional)</span></Label>
              <Input
                value={policyNumber}
                onChange={e => setPolicyNumber(e.target.value)}
                placeholder="e.g. POL-12345678"
                className="h-9 text-xs"
              />
            </div>

            {/* Sum Assured + Premium */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Sum Assured (₹) <span style={{ color: '#DC2626' }}>*</span></Label>
                <Input
                  type="number"
                  value={sumAssured}
                  onChange={e => setSumAssured(e.target.value)}
                  placeholder="e.g. 10000000"
                  step="1"
                  min="0"
                  className="h-9 text-xs"
                />
                {sumAssuredNum > 0 && (
                  <p className="text-[10px]" style={{ color: '#C9A84C' }}>{formatLargeINR(sumAssuredNum)}</p>
                )}
                <FieldError msg={errors.sumAssured} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Premium (₹) <span style={{ color: '#DC2626' }}>*</span></Label>
                <Input
                  type="number"
                  value={premium}
                  onChange={e => setPremium(e.target.value)}
                  placeholder="e.g. 15000"
                  step="1"
                  min="0"
                  className="h-9 text-xs"
                />
                {premiumNum > 0 && (
                  <p className="text-[10px]" style={{ color: '#C9A84C' }}>{formatLargeINR(premiumNum)}</p>
                )}
                <FieldError msg={errors.premium} />
              </div>
            </div>

            {/* Premium Frequency */}
            <div className="space-y-1.5">
              <Label className="text-xs" style={{ color: '#6B7280' }}>Premium Frequency</Label>
              <Select value={premiumFrequency} onValueChange={setPremiumFrequency}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PREMIUM_FREQUENCIES.map(f => <SelectItem key={f} value={f} className="text-xs">{f}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Start Date + End Date */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Start Date <span style={{ color: '#DC2626' }}>*</span></Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="h-9 text-xs"
                />
                <FieldError msg={errors.startDate} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>End Date <span style={{ color: '#DC2626' }}>*</span></Label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  className="h-9 text-xs"
                />
                <FieldError msg={errors.endDate} />
              </div>
            </div>

            {/* Nominee Name + Relationship */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Nominee Name</Label>
                <Input
                  value={nomineeName}
                  onChange={e => setNomineeName(e.target.value)}
                  placeholder="e.g. Priya Sharma"
                  className="h-9 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Nominee Relationship</Label>
                <Select value={nomineeRelationship} onValueChange={setNomineeRelationship}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    {NOMINEE_RELATIONSHIPS.map(r => <SelectItem key={r} value={r} className="text-xs">{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>

        {/* Step 4 — Type-specific Fields */}
        {(category === 'life_term' || category === 'life_ulip' || category === 'health' || category === 'vehicle' || category === 'property') && (
          <div className="wv-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#C9A84C' }}>
              {category === 'life_term' ? 'Term Life Details' :
               category === 'life_ulip' ? 'ULIP Details' :
               category === 'health' ? 'Health Insurance Details' :
               category === 'vehicle' ? 'Vehicle Insurance Details' :
               'Property Insurance Details'}
            </p>

            <div className="space-y-4">
              {/* ── Life Term ────────────────────────────────────────────────────── */}
              {category === 'life_term' && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs" style={{ color: '#6B7280' }}>Term (Years)</Label>
                    <Input
                      type="number"
                      value={termYears}
                      onChange={e => setTermYears(e.target.value)}
                      placeholder="e.g. 30"
                      min="1"
                      max="99"
                      className="h-9 text-xs"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs" style={{ color: '#6B7280' }}>Riders</Label>
                    <div className="flex flex-wrap gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={riderCriticalIllness}
                          onChange={e => setRiderCriticalIllness(e.target.checked)}
                          className="rounded border-gray-300"
                          style={{ accentColor: '#1B2A4A' }}
                        />
                        <span className="text-xs" style={{ color: '#4B5563' }}>Critical Illness</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={riderAccidentalDeath}
                          onChange={e => setRiderAccidentalDeath(e.target.checked)}
                          className="rounded border-gray-300"
                          style={{ accentColor: '#1B2A4A' }}
                        />
                        <span className="text-xs" style={{ color: '#4B5563' }}>Accidental Death</span>
                      </label>
                    </div>
                  </div>
                </>
              )}

              {/* ── Life ULIP ────────────────────────────────────────────────────── */}
              {category === 'life_ulip' && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs" style={{ color: '#6B7280' }}>Fund Value (₹)</Label>
                    <Input
                      type="number"
                      value={fundValue}
                      onChange={e => setFundValue(e.target.value)}
                      placeholder="Current fund value"
                      step="0.01"
                      min="0"
                      className="h-9 text-xs"
                    />
                    {parseFloat(fundValue) > 0 && (
                      <p className="text-[10px]" style={{ color: '#C9A84C' }}>{formatLargeINR(parseFloat(fundValue))}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs" style={{ color: '#6B7280' }}>Fund Options</Label>
                    <Input
                      value={fundOptions}
                      onChange={e => setFundOptions(e.target.value)}
                      placeholder="e.g. Equity Fund, Balanced Fund"
                      className="h-9 text-xs"
                    />
                  </div>
                </>
              )}

              {/* ── Health ───────────────────────────────────────────────────────── */}
              {category === 'health' && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs" style={{ color: '#6B7280' }}>Plan Type</Label>
                    <Select value={healthPlanType} onValueChange={setHealthPlanType}>
                      <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {HEALTH_PLAN_TYPES.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs" style={{ color: '#6B7280' }}>Room Rent Limit</Label>
                    <Input
                      value={roomRentLimit}
                      onChange={e => setRoomRentLimit(e.target.value)}
                      placeholder="e.g. Single Private AC, No Limit"
                      className="h-9 text-xs"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: '#6B7280' }}>Co-pay %</Label>
                      <Input
                        type="number"
                        value={coPayPercent}
                        onChange={e => setCoPayPercent(e.target.value)}
                        placeholder="0"
                        step="1"
                        min="0"
                        max="100"
                        className="h-9 text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: '#6B7280' }}>No Claim Bonus %</Label>
                      <Input
                        type="number"
                        value={ncbPercent}
                        onChange={e => setNcbPercent(e.target.value)}
                        placeholder="0"
                        step="1"
                        min="0"
                        max="100"
                        className="h-9 text-xs"
                      />
                    </div>
                  </div>
                </>
              )}

              {/* ── Vehicle ──────────────────────────────────────────────────────── */}
              {category === 'vehicle' && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: '#6B7280' }}>Vehicle Type</Label>
                      <Select value={vehicleType} onValueChange={setVehicleType}>
                        <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {VEHICLE_TYPES.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: '#6B7280' }}>Insurance Type</Label>
                      <Select value={vehicleInsuranceType} onValueChange={setVehicleInsuranceType}>
                        <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {VEHICLE_INSURANCE_TYPES.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: '#6B7280' }}>Make</Label>
                      <Input
                        value={vehicleMake}
                        onChange={e => setVehicleMake(e.target.value)}
                        placeholder="e.g. Maruti, Honda"
                        className="h-9 text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: '#6B7280' }}>Model</Label>
                      <Input
                        value={vehicleModel}
                        onChange={e => setVehicleModel(e.target.value)}
                        placeholder="e.g. Swift, City"
                        className="h-9 text-xs"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: '#6B7280' }}>Year</Label>
                      <Input
                        type="number"
                        value={vehicleYear}
                        onChange={e => setVehicleYear(e.target.value)}
                        placeholder="e.g. 2023"
                        min="1990"
                        max="2030"
                        className="h-9 text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: '#6B7280' }}>Registration Number</Label>
                      <Input
                        value={regNumber}
                        onChange={e => setRegNumber(e.target.value)}
                        placeholder="e.g. MH02AB1234"
                        className="h-9 text-xs"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs" style={{ color: '#6B7280' }}>IDV - Insured Declared Value (₹)</Label>
                    <Input
                      type="number"
                      value={idv}
                      onChange={e => setIdv(e.target.value)}
                      placeholder="e.g. 500000"
                      step="1"
                      min="0"
                      className="h-9 text-xs"
                    />
                    {parseFloat(idv) > 0 && (
                      <p className="text-[10px]" style={{ color: '#C9A84C' }}>{formatLargeINR(parseFloat(idv))}</p>
                    )}
                  </div>
                </>
              )}

              {/* ── Property ─────────────────────────────────────────────────────── */}
              {category === 'property' && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs" style={{ color: '#6B7280' }}>Cover Type</Label>
                    <Select value={coverType} onValueChange={setCoverType}>
                      <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {COVER_TYPES.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    {(coverType === 'Structure' || coverType === 'Both') && (
                      <div className="space-y-1.5">
                        <Label className="text-xs" style={{ color: '#6B7280' }}>Structure Value (₹)</Label>
                        <Input
                          type="number"
                          value={structureValue}
                          onChange={e => setStructureValue(e.target.value)}
                          placeholder="e.g. 5000000"
                          step="1"
                          min="0"
                          className="h-9 text-xs"
                        />
                        {parseFloat(structureValue) > 0 && (
                          <p className="text-[10px]" style={{ color: '#C9A84C' }}>{formatLargeINR(parseFloat(structureValue))}</p>
                        )}
                      </div>
                    )}
                    {(coverType === 'Contents' || coverType === 'Both') && (
                      <div className="space-y-1.5">
                        <Label className="text-xs" style={{ color: '#6B7280' }}>Contents Value (₹)</Label>
                        <Input
                          type="number"
                          value={contentsValue}
                          onChange={e => setContentsValue(e.target.value)}
                          placeholder="e.g. 1000000"
                          step="1"
                          min="0"
                          className="h-9 text-xs"
                        />
                        {parseFloat(contentsValue) > 0 && (
                          <p className="text-[10px]" style={{ color: '#C9A84C' }}>{formatLargeINR(parseFloat(contentsValue))}</p>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Calculated Summary */}
        {sumAssuredNum > 0 && premiumNum > 0 && (
          <div className="wv-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#C9A84C' }}>
              Summary
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'rgba(27,42,74,0.04)' }}>
                <p className="text-[10px] font-medium mb-1" style={{ color: '#9CA3AF' }}>Sum Assured</p>
                <p className="text-sm font-bold" style={{ color: '#1B2A4A' }}>{formatLargeINR(sumAssuredNum)}</p>
              </div>
              <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'rgba(5,150,105,0.06)' }}>
                <p className="text-[10px] font-medium mb-1" style={{ color: '#9CA3AF' }}>Premium ({premiumFrequency})</p>
                <p className="text-sm font-bold" style={{ color: '#059669' }}>{formatLargeINR(premiumNum)}</p>
              </div>
              <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'rgba(27,42,74,0.04)' }}>
                <p className="text-[10px] font-medium mb-1" style={{ color: '#9CA3AF' }}>Annual Premium</p>
                <p className="text-sm font-bold" style={{ color: '#1B2A4A' }}>{formatLargeINR(annualPremium)}</p>
              </div>
              <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'rgba(201,168,76,0.08)' }}>
                <p className="text-[10px] font-medium mb-1" style={{ color: '#9CA3AF' }}>Category</p>
                <p className="text-sm font-bold" style={{ color: '#C9A84C' }}>
                  {CATEGORIES.find(c => c.key === category)?.label}
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
              <Shield className="w-4 h-4" />
              Save Insurance Policy
            </span>
          )}
        </Button>

      </div>
    </div>
  );
}

// ─── Page wrapper with Suspense ─────────────────────────────────────────────────

export default function AddInsurancePage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#C9A84C' }} />
      </div>
    }>
      <InsuranceFormContent />
    </Suspense>
  );
}
