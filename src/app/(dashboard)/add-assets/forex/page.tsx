'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DollarSign, Check, AlertCircle, X, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR } from '@/lib/utils/formatters';

// ─── Types ──────────────────────────────────────────────────────────────────────

interface FamilyMember { id: string; name: string }
interface Toast { type: 'success' | 'error'; message: string }

// ─── Constants ──────────────────────────────────────────────────────────────────

const CURRENCY_PAIRS = [
  { key: 'USD/INR', label: 'USD/INR' },
  { key: 'EUR/INR', label: 'EUR/INR' },
  { key: 'GBP/INR', label: 'GBP/INR' },
  { key: 'JPY/INR', label: 'JPY/INR' },
  { key: 'AED/INR', label: 'AED/INR' },
  { key: 'SGD/INR', label: 'SGD/INR' },
  { key: 'CHF/INR', label: 'CHF/INR' },
  { key: 'AUD/INR', label: 'AUD/INR' },
  { key: 'CAD/INR', label: 'CAD/INR' },
  { key: 'other', label: 'Other' },
];

const PLATFORMS = [
  { key: 'Wise', label: 'Wise' },
  { key: 'BookMyForex', label: 'BookMyForex' },
  { key: 'Thomas Cook', label: 'Thomas Cook' },
  { key: 'HDFC ForexPlus', label: 'HDFC ForexPlus' },
  { key: 'ICICI Forex', label: 'ICICI Forex' },
  { key: 'SBI Forex', label: 'SBI Forex' },
  { key: 'Other', label: 'Other' },
];

const PURPOSES = [
  { key: 'Travel', label: 'Travel' },
  { key: 'Investment', label: 'Investment' },
  { key: 'Remittance', label: 'Remittance' },
  { key: 'Business', label: 'Business' },
  { key: 'Other', label: 'Other' },
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

function ForexFormContent() {
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

  // Forex fields
  const [currencyPair, setCurrencyPair] = useState('USD/INR');
  const [customCurrencyPair, setCustomCurrencyPair] = useState('');
  const [platform, setPlatform] = useState('Wise');
  const [amountForeign, setAmountForeign] = useState('');
  const [exchangeRatePurchase, setExchangeRatePurchase] = useState('');
  const [exchangeRateCurrent, setExchangeRateCurrent] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [purpose, setPurpose] = useState('Travel');
  const [notes, setNotes] = useState('');

  // UI state
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const prefillLockedRef = useRef(hasPrefill);
  const targetMemberRef = useRef(urlMemberId || '');
  const activeFamilyRef = useRef(selectedFamily);
  activeFamilyRef.current = selectedFamily;

  // suppress unused warnings
  void _familyId;

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
  const amountNum = parseFloat(amountForeign) || 0;
  const buyRateNum = parseFloat(exchangeRatePurchase) || 0;
  const currentRateNum = parseFloat(exchangeRateCurrent) || 0;

  const inrValuePurchase = amountNum * buyRateNum;
  const inrValueCurrent = currentRateNum > 0 ? amountNum * currentRateNum : 0;
  const pnl = inrValueCurrent > 0 ? inrValueCurrent - inrValuePurchase : 0;
  const pnlPercent = inrValuePurchase > 0 && inrValueCurrent > 0
    ? ((inrValueCurrent - inrValuePurchase) / inrValuePurchase) * 100
    : 0;

  const effectivePair = currencyPair === 'other' ? customCurrencyPair.trim() : currencyPair;

  // ── Validate ──────────────────────────────────────────────────────────────────
  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!effectivePair) errs.currencyPair = 'Select or enter a currency pair';
    if (!amountForeign || amountNum <= 0) errs.amountForeign = 'Enter a valid foreign currency amount';
    if (!exchangeRatePurchase || buyRateNum <= 0) errs.exchangeRatePurchase = 'Enter a valid exchange rate';
    if (!purchaseDate) errs.purchaseDate = 'Select purchase date';
    if (!portfolioName.trim()) errs.portfolio = 'Enter a portfolio name';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Reset form ────────────────────────────────────────────────────────────────
  function resetForm() {
    setCurrencyPair('USD/INR');
    setCustomCurrencyPair('');
    setPlatform('Wise');
    setAmountForeign('');
    setExchangeRatePurchase('');
    setExchangeRateCurrent('');
    setPurchaseDate(new Date().toISOString().split('T')[0]);
    setPurpose('Travel');
    setNotes('');
    setErrors({});
    setSaved(false);
  }

  // ── Save ──────────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!validate()) return;
    setSaving(true);

    try {
      const currentINRValue = inrValueCurrent > 0 ? inrValueCurrent : inrValuePurchase;

      const res = await fetch('/api/manual-assets/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_type: 'forex',
          name: `${effectivePair} - ${platform}`,
          current_value: currentINRValue,
          metadata: {
            currency_pair: effectivePair,
            platform,
            amount_foreign: amountNum,
            exchange_rate_purchase: buyRateNum,
            exchange_rate_current: currentRateNum > 0 ? currentRateNum : undefined,
            purchase_date: purchaseDate,
            purpose,
            inr_value_purchase: inrValuePurchase,
            inr_value_current: inrValueCurrent > 0 ? inrValueCurrent : undefined,
            pnl: inrValueCurrent > 0 ? pnl : undefined,
            pnl_percent: inrValueCurrent > 0 ? pnlPercent : undefined,
            notes: notes.trim() || undefined,
          },
          memberId: member,
          portfolioName: portfolioName.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed');

      setToast({ type: 'success', message: 'Forex holding added successfully!' });
      setSaved(true);
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
            <DollarSign className="w-5 h-5" style={{ color: '#1B2A4A' }} />
          </div>
          <div>
            <h1 className="text-lg font-bold" style={{ color: '#1B2A4A' }}>Add Forex</h1>
            <p className="text-xs" style={{ color: '#9CA3AF' }}>Enter your foreign currency holding details</p>
          </div>
        </div>

        {/* Toast */}
        {toast && <ToastBanner toast={toast} onClose={() => setToast(null)} />}

        {/* Success state with View Portfolio */}
        {saved && (
          <div className="wv-card p-6 text-center">
            <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3"
              style={{ backgroundColor: 'rgba(5,150,105,0.1)' }}>
              <Check className="w-6 h-6" style={{ color: '#059669' }} />
            </div>
            <p className="text-sm font-semibold mb-1" style={{ color: '#1B2A4A' }}>Forex holding saved!</p>
            <p className="text-xs mb-4" style={{ color: '#9CA3AF' }}>Your foreign currency holding has been recorded.</p>
            <div className="flex gap-3 justify-center">
              <Button
                onClick={() => router.push('/portfolio/forex')}
                className="text-white text-xs h-9"
                style={{ backgroundColor: '#1B2A4A' }}
              >
                View Portfolio
              </Button>
              <Button
                onClick={resetForm}
                variant="outline"
                className="text-xs h-9"
                style={{ borderColor: '#E8E5DD', color: '#1B2A4A' }}
              >
                Add Another
              </Button>
            </div>
          </div>
        )}

        {!saved && (
          <>
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

            {/* Step 2 — Forex Details */}
            <div className="wv-card p-5">
              <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#9CA3AF' }}>
                Step 2 — Forex Details
              </p>

              <div className="space-y-4">
                {/* Currency Pair + Platform */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs" style={{ color: '#6B7280' }}>Currency Pair <span style={{ color: '#DC2626' }}>*</span></Label>
                    <Select value={currencyPair} onValueChange={setCurrencyPair}>
                      <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CURRENCY_PAIRS.map(c => <SelectItem key={c.key} value={c.key} className="text-xs">{c.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FieldError msg={errors.currencyPair} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs" style={{ color: '#6B7280' }}>Platform / Broker</Label>
                    <Select value={platform} onValueChange={setPlatform}>
                      <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PLATFORMS.map(p => <SelectItem key={p.key} value={p.key} className="text-xs">{p.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Custom Currency Pair (shown when Other) */}
                {currencyPair === 'other' && (
                  <div className="space-y-1.5">
                    <Label className="text-xs" style={{ color: '#6B7280' }}>Custom Currency Pair <span style={{ color: '#DC2626' }}>*</span></Label>
                    <Input
                      value={customCurrencyPair}
                      onChange={e => setCustomCurrencyPair(e.target.value)}
                      placeholder="e.g. THB/INR"
                      className="h-9 text-xs"
                    />
                  </div>
                )}

                {/* Amount in Foreign Currency */}
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>Amount in Foreign Currency <span style={{ color: '#DC2626' }}>*</span></Label>
                  <Input
                    type="number"
                    value={amountForeign}
                    onChange={e => setAmountForeign(e.target.value)}
                    placeholder="e.g. 5000"
                    step="0.01"
                    min="0"
                    className="h-9 text-xs"
                  />
                  <FieldError msg={errors.amountForeign} />
                </div>

                {/* Exchange Rate at Purchase + Purchase Date */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs" style={{ color: '#6B7280' }}>Exchange Rate at Purchase <span style={{ color: '#DC2626' }}>*</span></Label>
                    <Input
                      type="number"
                      value={exchangeRatePurchase}
                      onChange={e => setExchangeRatePurchase(e.target.value)}
                      placeholder="e.g. 83.50"
                      step="0.01"
                      min="0"
                      className="h-9 text-xs"
                    />
                    <FieldError msg={errors.exchangeRatePurchase} />
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

                {/* Current Exchange Rate */}
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>Current Exchange Rate <span className="text-gray-400">(optional)</span></Label>
                  <Input
                    type="number"
                    value={exchangeRateCurrent}
                    onChange={e => setExchangeRateCurrent(e.target.value)}
                    placeholder="e.g. 84.20"
                    step="0.01"
                    min="0"
                    className="h-9 text-xs"
                  />
                </div>

                {/* Purpose */}
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>Purpose</Label>
                  <Select value={purpose} onValueChange={setPurpose}>
                    <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PURPOSES.map(p => <SelectItem key={p.key} value={p.key} className="text-xs">{p.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

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

            {/* Calculated Summary */}
            {inrValuePurchase > 0 && (
              <div className="wv-card p-5">
                <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#C9A84C' }}>
                  Calculated Summary
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'rgba(27,42,74,0.04)' }}>
                    <p className="text-[10px] font-medium mb-1" style={{ color: '#9CA3AF' }}>Foreign Amt</p>
                    <p className="text-sm font-bold" style={{ color: '#1B2A4A' }}>
                      {amountNum.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'rgba(201,168,76,0.08)' }}>
                    <p className="text-[10px] font-medium mb-1" style={{ color: '#9CA3AF' }}>INR at Purchase</p>
                    <p className="text-sm font-bold" style={{ color: '#C9A84C' }}>{formatLargeINR(inrValuePurchase)}</p>
                  </div>
                  {inrValueCurrent > 0 && (
                    <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'rgba(5,150,105,0.06)' }}>
                      <p className="text-[10px] font-medium mb-1" style={{ color: '#9CA3AF' }}>Current INR Value</p>
                      <p className="text-sm font-bold" style={{ color: '#059669' }}>{formatLargeINR(inrValueCurrent)}</p>
                    </div>
                  )}
                  {inrValueCurrent > 0 && (
                    <div className="text-center p-3 rounded-lg"
                      style={{ backgroundColor: pnl >= 0 ? 'rgba(5,150,105,0.06)' : 'rgba(220,38,38,0.06)' }}>
                      <p className="text-[10px] font-medium mb-1" style={{ color: '#9CA3AF' }}>P&amp;L</p>
                      <p className="text-sm font-bold" style={{ color: pnl >= 0 ? '#059669' : '#DC2626' }}>
                        {pnl >= 0 ? '+' : ''}{formatLargeINR(pnl)}
                        <span className="text-[10px] ml-1">({pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%)</span>
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
                  <DollarSign className="w-4 h-4" />
                  Save Forex Holding
                </span>
              )}
            </Button>
          </>
        )}

      </div>
    </div>
  );
}

// ─── Page wrapper with Suspense ─────────────────────────────────────────────────

export default function AddForexPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#C9A84C' }} />
      </div>
    }>
      <ForexFormContent />
    </Suspense>
  );
}
