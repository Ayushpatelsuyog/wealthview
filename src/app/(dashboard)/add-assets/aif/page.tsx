'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Building2, Check, AlertCircle, X, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR } from '@/lib/utils/formatters';

// ─── Types ──────────────────────────────────────────────────────────────────────

interface FamilyMember { id: string; name: string }
interface Toast { type: 'success' | 'error'; message: string }

// ─── Constants ──────────────────────────────────────────────────────────────────

const AIF_CATEGORIES = [
  { key: 'cat1_venture', label: 'Cat I - Venture Capital' },
  { key: 'cat1_sme', label: 'Cat I - SME Fund' },
  { key: 'cat1_social', label: 'Cat I - Social Venture' },
  { key: 'cat1_infra', label: 'Cat I - Infrastructure' },
  { key: 'cat2_pe', label: 'Cat II - Private Equity' },
  { key: 'cat2_debt', label: 'Cat II - Debt Fund' },
  { key: 'cat2_fof', label: 'Cat II - Fund of Funds' },
  { key: 'cat3_hedge', label: 'Cat III - Hedge Fund' },
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

function AIFFormContent() {
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

  // AIF fields
  const [aifName, setAifName] = useState('');
  const [category, setCategory] = useState('cat2_pe');
  const [fundManager, setFundManager] = useState('');
  const [commitmentAmount, setCommitmentAmount] = useState('');
  const [calledAmount, setCalledAmount] = useState('');
  const [distributions, setDistributions] = useState('');
  const [currentValue, setCurrentValue] = useState('');
  const [vintageYear, setVintageYear] = useState('');
  const [investmentDate, setInvestmentDate] = useState('');
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
    setVintageYear(String(new Date().getFullYear()));
  }, []);

  // ── Calculations ──────────────────────────────────────────────────────────────
  const commitmentNum = parseFloat(commitmentAmount) || 0;
  const calledNum = parseFloat(calledAmount) || 0;
  const distributionsNum = parseFloat(distributions) || 0;
  const currentNum = parseFloat(currentValue) || 0;

  const uncalled = commitmentNum - calledNum;
  const tvpi = calledNum > 0 ? (distributionsNum + currentNum) / calledNum : 0;
  const dpi = calledNum > 0 ? distributionsNum / calledNum : 0;
  const rvpi = calledNum > 0 ? currentNum / calledNum : 0;

  // ── Validate ──────────────────────────────────────────────────────────────────
  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!aifName.trim()) errs.aifName = 'Enter AIF name';
    if (!commitmentAmount || commitmentNum <= 0) errs.commitmentAmount = 'Enter a valid commitment amount';
    if (!calledAmount || calledNum < 0) errs.calledAmount = 'Enter a valid called amount';
    if (!currentValue || currentNum < 0) errs.currentValue = 'Enter current NAV/valuation';
    if (!investmentDate) errs.investmentDate = 'Select investment date';
    if (!portfolioName.trim()) errs.portfolio = 'Enter a portfolio name';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Save ──────────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!validate()) return;
    setSaving(true);

    try {
      const categoryLabel = AIF_CATEGORIES.find(c => c.key === category)?.label ?? category;
      const res = await fetch('/api/manual-assets/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_type: 'aif',
          name: aifName.trim(),
          current_value: currentNum,
          metadata: {
            category,
            category_label: categoryLabel,
            fund_manager: fundManager.trim() || undefined,
            commitment_amount: commitmentNum,
            called_amount: calledNum,
            distributions: distributionsNum,
            vintage_year: vintageYear.trim() || undefined,
            investment_date: investmentDate,
            uncalled,
            tvpi,
            dpi,
            rvpi,
            notes: notes.trim() || undefined,
          },
          memberId: member,
          familyId: selectedFamily || undefined,
          portfolioName: portfolioName.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed');

      setToast({ type: 'success', message: 'AIF holding added successfully!' });
      setTimeout(() => router.push('/portfolio/aif'), 1200);
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
            <Building2 className="w-5 h-5" style={{ color: 'var(--wv-text)' }} />
          </div>
          <div>
            <h1 className="text-lg font-bold" style={{ color: 'var(--wv-text)' }}>Add AIF</h1>
            <p className="text-xs" style={{ color: 'var(--wv-text-muted)' }}>Enter your Alternative Investment Fund details</p>
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

        {/* Step 2 — AIF Details */}
        <div className="wv-card p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--wv-text-muted)' }}>
            Step 2 — AIF Details
          </p>

          <div className="space-y-4">
            {/* AIF Name */}
            <div className="space-y-1.5">
              <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>AIF Name <span style={{ color: '#DC2626' }}>*</span></Label>
              <Input
                value={aifName}
                onChange={e => setAifName(e.target.value)}
                placeholder="e.g. ICICI Prudential Long Short Fund"
                className="h-9 text-xs"
              />
              <FieldError msg={errors.aifName} />
            </div>

            {/* Row: Category + Fund Manager */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {AIF_CATEGORIES.map(c => <SelectItem key={c.key} value={c.key} className="text-xs">{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Fund Manager</Label>
                <Input
                  value={fundManager}
                  onChange={e => setFundManager(e.target.value)}
                  placeholder="e.g. ICICI Prudential AMC"
                  className="h-9 text-xs"
                />
              </div>
            </div>

            {/* Commitment Amount */}
            <div className="space-y-1.5">
              <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Commitment Amount (₹) <span style={{ color: '#DC2626' }}>*</span></Label>
              <Input
                type="number"
                value={commitmentAmount}
                onChange={e => setCommitmentAmount(e.target.value)}
                placeholder="10000000"
                step="1"
                min="0"
                className="h-9 text-xs"
              />
              <FieldError msg={errors.commitmentAmount} />
            </div>

            {/* Row: Called Amount + Distributions */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Called Amount (₹) <span style={{ color: '#DC2626' }}>*</span></Label>
                <Input
                  type="number"
                  value={calledAmount}
                  onChange={e => setCalledAmount(e.target.value)}
                  placeholder="7000000"
                  step="1"
                  min="0"
                  className="h-9 text-xs"
                />
                <FieldError msg={errors.calledAmount} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Distributions Received (₹)</Label>
                <Input
                  type="number"
                  value={distributions}
                  onChange={e => setDistributions(e.target.value)}
                  placeholder="0"
                  step="1"
                  min="0"
                  className="h-9 text-xs"
                />
              </div>
            </div>

            {/* Current NAV/Valuation */}
            <div className="space-y-1.5">
              <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Current NAV/Valuation (₹) <span style={{ color: '#DC2626' }}>*</span></Label>
              <Input
                type="number"
                value={currentValue}
                onChange={e => setCurrentValue(e.target.value)}
                placeholder="8500000"
                step="1"
                min="0"
                className="h-9 text-xs"
              />
              <FieldError msg={errors.currentValue} />
            </div>

            {/* Row: Vintage Year + Investment Date */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Vintage Year</Label>
                <Input
                  type="number"
                  value={vintageYear}
                  onChange={e => setVintageYear(e.target.value)}
                  placeholder="2024"
                  min="2000"
                  max="2100"
                  className="h-9 text-xs"
                />
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
        {calledNum > 0 && (
          <div className="wv-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#C9A84C' }}>
              Calculated Summary
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'rgba(27,42,74,0.04)' }}>
                <p className="text-[10px] font-medium mb-1" style={{ color: 'var(--wv-text-muted)' }}>Uncalled</p>
                <p className="text-sm font-bold" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(Math.max(0, uncalled))}</p>
              </div>
              <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'rgba(201,168,76,0.08)' }}>
                <p className="text-[10px] font-medium mb-1" style={{ color: 'var(--wv-text-muted)' }}>TVPI</p>
                <p className="text-sm font-bold" style={{ color: '#C9A84C' }}>{tvpi.toFixed(2)}x</p>
              </div>
              <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'rgba(5,150,105,0.06)' }}>
                <p className="text-[10px] font-medium mb-1" style={{ color: 'var(--wv-text-muted)' }}>DPI</p>
                <p className="text-sm font-bold" style={{ color: '#059669' }}>{dpi.toFixed(2)}x</p>
              </div>
              <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'rgba(27,42,74,0.04)' }}>
                <p className="text-[10px] font-medium mb-1" style={{ color: 'var(--wv-text-muted)' }}>RVPI</p>
                <p className="text-sm font-bold" style={{ color: 'var(--wv-text)' }}>{rvpi.toFixed(2)}x</p>
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
              <Building2 className="w-4 h-4" />
              Save AIF
            </span>
          )}
        </Button>

      </div>
    </div>
  );
}

// ─── Page wrapper with Suspense ─────────────────────────────────────────────────

export default function AddAIFPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#C9A84C' }} />
      </div>
    }>
      <AIFFormContent />
    </Suspense>
  );
}
