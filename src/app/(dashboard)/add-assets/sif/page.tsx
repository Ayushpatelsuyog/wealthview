'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { Shield, Loader2, AlertCircle, Check, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR } from '@/lib/utils/formatters';
import { holdingsCacheClearAll } from '@/lib/utils/holdings-cache';
import { PortfolioSelector } from '@/components/forms/PortfolioSelector';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FamilyMember { id: string; name: string }
interface Toast { type: 'success' | 'error'; message: string }

// ─── Sub-components ───────────────────────────────────────────────────────────

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

// ─── Inner Content ────────────────────────────────────────────────────────────

function SifAddContent() {
  const router = useRouter();
  const supabase = createClient();

  // ── Auth & family ─────────────────────────────────────────────────────────
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [families, setFamilies] = useState<{ id: string; name: string }[]>([]);
  const [selectedFamily, setSelectedFamily] = useState('');
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [member, setMember] = useState('');

  // ── Form fields ───────────────────────────────────────────────────────────
  const [portfolio, setPortfolio] = useState('');
  const [fundName, setFundName] = useState('');
  const [amc, setAmc] = useState('');
  const [schemeCode, setSchemeCode] = useState('');
  const [txnType, setTxnType] = useState<'lumpsum' | 'sip'>('lumpsum');
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [nav, setNav] = useState('');
  const [amount, setAmount] = useState('');
  const [units, setUnits] = useState('');
  const [unitsManuallyEdited, setUnitsManuallyEdited] = useState(false);
  const [folio, setFolio] = useState('');
  const [stampDuty, setStampDuty] = useState('0');
  const [notes, setNotes] = useState('');

  // ── UI ─────────────────────────────────────────────────────────────────────
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  // ── Load user + family ─────────────────────────────────────────────────────
  useEffect(() => {
    async function loadUser() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }

      const { data: profile } = await supabase
        .from('users').select('id, name, family_id').eq('id', user.id).single();
      if (!profile) return;
      setMember(profile.id);

      const fid = profile.family_id;
      if (fid) {
        setFamilyId(fid);
        setSelectedFamily(fid);
        const { data: familyUsers } = await supabase
          .from('users').select('id, name').eq('family_id', fid);
        setMembers(familyUsers ?? [{ id: profile.id, name: profile.name }]);

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

          setFamilies(famList);
        } catch { /* ignore */ }
      } else {
        setMembers([{ id: profile.id, name: profile.name }]);
      }
    }
    loadUser();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reload members when family changes ──────────────────────────────────
  useEffect(() => {
    if (!selectedFamily) return;
    setFamilyId(selectedFamily);
    (async () => {
      const { data: fUsers } = await supabase.from('users').select('id, name').eq('family_id', selectedFamily);
      setMembers(fUsers ?? []);
      if (fUsers?.length) setMember(fUsers[0].id);
    })();
  }, [selectedFamily]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-calculate units ───────────────────────────────────────────────────
  useEffect(() => {
    if (unitsManuallyEdited) return;
    const a = parseFloat(amount);
    const n = parseFloat(nav);
    if (a > 0 && n > 0) {
      setUnits((a / n).toFixed(4));
    } else {
      setUnits('');
    }
  }, [amount, nav, unitsManuallyEdited]);

  // ── Computed summary ───────────────────────────────────────────────────────
  const parsedAmount = parseFloat(amount) || 0;
  const parsedStampDuty = parseFloat(stampDuty) || 0;
  const totalInvestment = parsedAmount + parsedStampDuty;
  const parsedUnits = parseFloat(units) || 0;
  const avgNav = parsedUnits > 0 ? parsedAmount / parsedUnits : 0;

  // ── Validation ─────────────────────────────────────────────────────────────
  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!fundName.trim()) errs.fundName = 'Fund name is required';
    if (!purchaseDate) errs.purchaseDate = 'Purchase date is required';
    if (!nav || parseFloat(nav) <= 0) errs.nav = 'Enter a valid NAV';
    if (!amount || parseFloat(amount) <= 0) errs.amount = 'Enter investment amount';
    if (!units || parseFloat(units) <= 0) errs.units = 'Units must be greater than 0';
    if (!member) errs.member = 'Select a family member';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!validate()) return;
    setIsSaving(true);
    setToast(null);

    const payload = {
      fundName: fundName.trim(),
      amc: amc.trim() || null,
      schemeCode: schemeCode.trim() || null,
      transactionType: txnType,
      nav: parseFloat(nav),
      units: parseFloat(units),
      amount: parseFloat(amount),
      date: purchaseDate,
      folio: folio.trim() || null,
      stampDuty: parsedStampDuty,
      portfolioName: portfolio,
      brokerId: null,
      memberId: member,
      notes: notes.trim() || null,
    };

    try {
      const res = await fetch('/api/sif/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        setToast({ type: 'error', message: json.error ?? 'Save failed' });
        return;
      }

      setToast({ type: 'success', message: `${fundName.trim()} saved successfully!` });
      holdingsCacheClearAll();
      setTimeout(() => router.push('/portfolio/sif'), 1200);
    } catch (e) {
      setToast({ type: 'error', message: String(e) });
    } finally {
      setIsSaving(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: 'rgba(27,42,74,0.08)' }}>
          <Shield className="w-5 h-5" style={{ color: '#1B2A4A' }} />
        </div>
        <div>
          <h1 className="font-display text-xl font-semibold" style={{ color: '#1A1A2E' }}>
            Specialized Investment Fund (SIF)
          </h1>
          <p className="text-xs" style={{ color: '#9CA3AF' }}>
            Add SIF holdings with manual NAV entry
          </p>
        </div>
      </div>

      {toast && <ToastBanner toast={toast} onClose={() => setToast(null)} />}

      <div className="wv-card p-5 space-y-5">
        {/* ── Family & Member ────────────────────────────────────────────── */}
        {families.length > 1 && (
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: '#6B7280' }}>Family</Label>
            <Select value={selectedFamily} onValueChange={setSelectedFamily}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Select family" />
              </SelectTrigger>
              <SelectContent>
                {families.map(f => (
                  <SelectItem key={f.id} value={f.id} className="text-xs">{f.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {members.length > 1 && (
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: '#6B7280' }}>Member</Label>
            <Select value={member} onValueChange={setMember}>
              <SelectTrigger className="h-9 text-xs"
                style={errors.member ? { borderColor: '#DC2626' } : {}}>
                <SelectValue placeholder="Select member" />
              </SelectTrigger>
              <SelectContent>
                {members.map(m => (
                  <SelectItem key={m.id} value={m.id} className="text-xs">{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError msg={errors.member} />
          </div>
        )}

        {/* ── Portfolio ──────────────────────────────────────────────────── */}
        <PortfolioSelector
          familyId={familyId}
          memberId={member}
          selectedPortfolioName={portfolio}
          onChange={setPortfolio}
        />

        {/* ── Divider ────────────────────────────────────────────────────── */}
        <div className="border-t" style={{ borderColor: '#E8E5DD' }} />

        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#C9A84C' }}>
          Fund Details
        </p>

        {/* ── Fund Name + AMC ────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: '#6B7280' }}>Fund Name *</Label>
            <Input
              value={fundName}
              onChange={(e) => { setFundName(e.target.value); setErrors(er => ({ ...er, fundName: '' })); }}
              placeholder="e.g. HDFC Balanced SIF"
              className="h-9 text-xs"
              style={errors.fundName ? { borderColor: '#DC2626' } : {}}
            />
            <FieldError msg={errors.fundName} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: '#6B7280' }}>AMC / Fund House</Label>
            <Input
              value={amc}
              onChange={(e) => setAmc(e.target.value)}
              placeholder="e.g. HDFC AMC"
              className="h-9 text-xs"
            />
          </div>
        </div>

        {/* ── Scheme Code ────────────────────────────────────────────────── */}
        <div className="space-y-1.5">
          <Label className="text-xs" style={{ color: '#6B7280' }}>Scheme Code (optional)</Label>
          <Input
            value={schemeCode}
            onChange={(e) => setSchemeCode(e.target.value)}
            placeholder="e.g. SIF001"
            className="h-9 text-xs w-1/2"
          />
        </div>

        {/* ── Transaction Type ───────────────────────────────────────────── */}
        <div className="space-y-2">
          <Label className="text-xs" style={{ color: '#6B7280' }}>Transaction Type</Label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="txnType"
                checked={txnType === 'lumpsum'}
                onChange={() => setTxnType('lumpsum')}
                className="w-3.5 h-3.5"
                style={{ accentColor: '#1B2A4A' }}
              />
              <span className="text-xs" style={{ color: txnType === 'lumpsum' ? '#1B2A4A' : '#6B7280' }}>
                Lump Sum
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="txnType"
                checked={txnType === 'sip'}
                onChange={() => setTxnType('sip')}
                className="w-3.5 h-3.5"
                style={{ accentColor: '#1B2A4A' }}
              />
              <span className="text-xs" style={{ color: txnType === 'sip' ? '#1B2A4A' : '#6B7280' }}>
                SIP
              </span>
            </label>
          </div>
        </div>

        {/* ── Date + NAV ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: '#6B7280' }}>Purchase Date *</Label>
            <Input
              type="date"
              value={purchaseDate}
              onChange={(e) => { setPurchaseDate(e.target.value); setErrors(er => ({ ...er, purchaseDate: '' })); }}
              className="h-9 text-xs"
              max={new Date().toISOString().split('T')[0]}
              style={errors.purchaseDate ? { borderColor: '#DC2626' } : {}}
            />
            <FieldError msg={errors.purchaseDate} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: '#6B7280' }}>NAV ({'\u20B9'}) *</Label>
            <Input
              type="number"
              value={nav}
              onChange={(e) => { setNav(e.target.value); setErrors(er => ({ ...er, nav: '' })); setUnitsManuallyEdited(false); }}
              placeholder="0.0000"
              step="0.0001"
              className="h-9 text-xs"
              style={errors.nav ? { borderColor: '#DC2626' } : {}}
            />
            <p className="text-[10px]" style={{ color: '#9CA3AF' }}>Enter latest NAV manually</p>
            <FieldError msg={errors.nav} />
          </div>
        </div>

        {/* ── Amount + Units ──────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: '#6B7280' }}>Investment Amount ({'\u20B9'}) *</Label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setErrors(er => ({ ...er, amount: '' })); setUnitsManuallyEdited(false); }}
              placeholder="50000"
              step="0.01"
              className="h-9 text-xs"
              style={errors.amount ? { borderColor: '#DC2626' } : {}}
            />
            <FieldError msg={errors.amount} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: '#6B7280' }}>
              Units
              {!unitsManuallyEdited && parsedUnits > 0 && (
                <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                  style={{ backgroundColor: 'rgba(5,150,105,0.1)', color: '#059669' }}>
                  auto
                </span>
              )}
            </Label>
            <Input
              type="number"
              value={units}
              onChange={(e) => { setUnits(e.target.value); setUnitsManuallyEdited(true); setErrors(er => ({ ...er, units: '' })); }}
              placeholder="0.0000"
              step="0.0001"
              className="h-9 text-xs"
              style={errors.units ? { borderColor: '#DC2626' } : {}}
            />
            <FieldError msg={errors.units} />
          </div>
        </div>

        {/* ── Folio + Stamp Duty ──────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: '#6B7280' }}>Folio Number (optional)</Label>
            <Input
              value={folio}
              onChange={(e) => setFolio(e.target.value)}
              placeholder="e.g. 12345678"
              className="h-9 text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: '#6B7280' }}>Stamp Duty ({'\u20B9'})</Label>
            <Input
              type="number"
              value={stampDuty}
              onChange={(e) => setStampDuty(e.target.value)}
              placeholder="0"
              step="0.01"
              className="h-9 text-xs"
            />
          </div>
        </div>

        {/* ── Notes ──────────────────────────────────────────────────────── */}
        <div className="space-y-1.5">
          <Label className="text-xs" style={{ color: '#6B7280' }}>Notes (optional)</Label>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add any notes about this SIF investment..."
            className="h-9 text-xs"
          />
        </div>

        {/* ── Divider ────────────────────────────────────────────────────── */}
        <div className="border-t" style={{ borderColor: '#E8E5DD' }} />

        {/* ── Summary ────────────────────────────────────────────────────── */}
        {(parsedAmount > 0 || parsedUnits > 0) && (
          <div className="rounded-xl p-4" style={{ backgroundColor: '#F7F5F0', border: '1px solid #E8E5DD' }}>
            <p className="text-xs font-semibold mb-3" style={{ color: '#1B2A4A' }}>Investment Summary</p>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: '#9CA3AF' }}>Total Investment</p>
                <p className="text-sm font-semibold" style={{ color: '#1B2A4A' }}>{formatLargeINR(totalInvestment)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: '#9CA3AF' }}>Units Acquired</p>
                <p className="text-sm font-semibold" style={{ color: '#1B2A4A' }}>
                  {parsedUnits > 0 ? parsedUnits.toLocaleString('en-IN', { minimumFractionDigits: 4, maximumFractionDigits: 4 }) : '—'}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: '#9CA3AF' }}>Avg NAV</p>
                <p className="text-sm font-semibold" style={{ color: '#1B2A4A' }}>
                  {avgNav > 0 ? `\u20B9${avgNav.toFixed(4)}` : '—'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── Save Button ────────────────────────────────────────────────── */}
        <Button
          onClick={handleSave}
          disabled={isSaving}
          className="w-full text-white h-10 text-sm font-medium"
          style={{ backgroundColor: '#1B2A4A' }}
        >
          {isSaving ? (
            <><Loader2 className="w-4 h-4 animate-spin mr-2" />Saving...</>
          ) : (
            'Save SIF Holding'
          )}
        </Button>
      </div>
    </div>
  );
}

// ─── Page (default export with Suspense) ──────────────────────────────────────

export default function SifAddPage() {
  return (
    <Suspense fallback={
      <div className="p-6 max-w-2xl mx-auto">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#1B2A4A' }} />
        </div>
      </div>
    }>
      <SifAddContent />
    </Suspense>
  );
}
