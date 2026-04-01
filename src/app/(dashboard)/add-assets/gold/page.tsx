'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Gem, Check, AlertCircle, X, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR } from '@/lib/utils/formatters';

// ─── Types ──────────────────────────────────────────────────────────────────────

interface FamilyMember { id: string; name: string }
interface Toast { type: 'success' | 'error'; message: string }

// ─── Constants ──────────────────────────────────────────────────────────────────

const GOLD_TYPES = ['Physical Gold (Coins/Bars)', 'Jewelry', 'Digital Gold'];

const PURITY_OPTIONS = [
  { label: '24K (999)', value: '999' },
  { label: '22K (916)', value: '916' },
  { label: '18K (750)', value: '750' },
];

const DIGITAL_PLATFORMS = ['PhonePe', 'Paytm', 'MMTC-PAMP', 'Augmont'];

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

function GoldFormContent() {
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

  // Gold fields
  const [goldType, setGoldType] = useState('Physical Gold (Coins/Bars)');
  const [description, setDescription] = useState('');
  const [weightGrams, setWeightGrams] = useState('');
  const [purchasePricePerGram, setPurchasePricePerGram] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [purity, setPurity] = useState('999');
  const [makingCharges, setMakingCharges] = useState('');
  const [digitalPlatform, setDigitalPlatform] = useState('PhonePe');
  const [currentGoldPrice, setCurrentGoldPrice] = useState('');
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
  const weight = parseFloat(weightGrams) || 0;
  const pricePerGram = parseFloat(purchasePricePerGram) || 0;
  const making = parseFloat(makingCharges) || 0;
  const currentPrice = parseFloat(currentGoldPrice) || 0;
  const purityFactor = parseInt(purity) / 999;

  const totalPurchaseCost = weight * pricePerGram;
  const totalCostWithMaking = goldType === 'Jewelry' ? totalPurchaseCost + making : totalPurchaseCost;
  const currentValue = weight * currentPrice * purityFactor;
  const pnl = currentValue - totalCostWithMaking;
  const pnlPercent = totalCostWithMaking > 0 ? (pnl / totalCostWithMaking) * 100 : 0;

  // ── Validate ──────────────────────────────────────────────────────────────────
  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!description.trim()) errs.description = 'Enter a description';
    if (!weightGrams || weight <= 0) errs.weight = 'Enter weight in grams';
    if (!purchasePricePerGram || pricePerGram <= 0) errs.pricePerGram = 'Enter purchase price per gram';
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
          asset_type: 'gold',
          name: description.trim(),
          current_value: currentPrice > 0 ? currentValue : totalCostWithMaking,
          metadata: {
            gold_type: goldType,
            description: description.trim(),
            weight_grams: weight,
            purchase_price_per_gram: pricePerGram,
            purchase_date: purchaseDate,
            total_purchase_cost: totalPurchaseCost,
            total_cost: totalCostWithMaking,
            purity: parseInt(purity),
            purity_label: PURITY_OPTIONS.find(p => p.value === purity)?.label || purity,
            ...(goldType === 'Jewelry' ? { making_charges: making } : {}),
            ...(goldType === 'Digital Gold' ? { platform: digitalPlatform } : {}),
            ...(currentPrice > 0 ? {
              current_gold_price: currentPrice,
              current_value: currentValue,
              pnl: Math.round(pnl * 100) / 100,
              pnl_percent: Math.round(pnlPercent * 100) / 100,
            } : {}),
            notes: notes.trim() || undefined,
          },
          memberId: member,
          portfolioName: portfolioName.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed');

      setToast({ type: 'success', message: 'Gold holding added successfully!' });
      setTimeout(() => router.push('/portfolio/gold'), 1200);
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
            style={{ backgroundColor: 'rgba(217,119,6,0.1)' }}>
            <Gem className="w-5 h-5" style={{ color: '#d97706' }} />
          </div>
          <div>
            <h1 className="text-lg font-bold" style={{ color: '#1B2A4A' }}>Add Gold & Jewelry</h1>
            <p className="text-xs" style={{ color: '#9CA3AF' }}>Track your gold, jewelry and digital gold holdings</p>
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

        {/* Step 2 — Gold Details */}
        <div className="wv-card p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#9CA3AF' }}>
            Step 2 — Gold Details
          </p>

          <div className="space-y-4">
            {/* Gold Type */}
            <div className="space-y-1.5">
              <Label className="text-xs" style={{ color: '#6B7280' }}>Gold Type</Label>
              <Select value={goldType} onValueChange={setGoldType}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GOLD_TYPES.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label className="text-xs" style={{ color: '#6B7280' }}>Description <span style={{ color: '#DC2626' }}>*</span></Label>
              <Input
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder={goldType === 'Jewelry' ? 'e.g. Gold Necklace, Wedding Ring' : goldType === 'Digital Gold' ? 'e.g. Digital Gold Savings' : 'e.g. Gold Bar 10g, Gold Coin'}
                className="h-9 text-xs"
              />
              <FieldError msg={errors.description} />
            </div>

            {/* Weight + Purchase Price per Gram */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Weight in Grams <span style={{ color: '#DC2626' }}>*</span></Label>
                <Input
                  type="number"
                  value={weightGrams}
                  onChange={e => setWeightGrams(e.target.value)}
                  placeholder="0.000"
                  step="0.001"
                  min="0"
                  className="h-9 text-xs"
                />
                <FieldError msg={errors.weight} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Purchase Price per Gram (₹) <span style={{ color: '#DC2626' }}>*</span></Label>
                <Input
                  type="number"
                  value={purchasePricePerGram}
                  onChange={e => setPurchasePricePerGram(e.target.value)}
                  placeholder="0"
                  step="1"
                  min="0"
                  className="h-9 text-xs"
                />
                <FieldError msg={errors.pricePerGram} />
              </div>
            </div>

            {/* Purchase Date + Purity */}
            <div className="grid grid-cols-2 gap-4">
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
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Purity</Label>
                <Select value={purity} onValueChange={setPurity}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PURITY_OPTIONS.map(p => <SelectItem key={p.value} value={p.value} className="text-xs">{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Total Purchase Cost (auto) */}
            <div className="space-y-1.5">
              <Label className="text-xs" style={{ color: '#6B7280' }}>
                Total Purchase Cost (₹)
                {weight > 0 && pricePerGram > 0 && (
                  <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                    style={{ backgroundColor: 'rgba(5,150,105,0.1)', color: '#059669' }}>
                    auto
                  </span>
                )}
              </Label>
              <Input
                type="text"
                value={totalPurchaseCost > 0 ? `₹${totalPurchaseCost.toLocaleString('en-IN')}` : ''}
                readOnly
                className="h-9 text-xs bg-gray-50"
              />
            </div>

            {/* Jewelry: Making Charges */}
            {goldType === 'Jewelry' && (
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Making Charges (₹)</Label>
                <Input
                  type="number"
                  value={makingCharges}
                  onChange={e => setMakingCharges(e.target.value)}
                  placeholder="0"
                  step="1"
                  min="0"
                  className="h-9 text-xs"
                />
                {totalCostWithMaking > totalPurchaseCost && (
                  <p className="text-[10px]" style={{ color: '#6B7280' }}>
                    Total Cost (incl. making): ₹{totalCostWithMaking.toLocaleString('en-IN')}
                  </p>
                )}
              </div>
            )}

            {/* Digital Gold: Platform */}
            {goldType === 'Digital Gold' && (
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Platform</Label>
                <Select value={digitalPlatform} onValueChange={setDigitalPlatform}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DIGITAL_PLATFORMS.map(p => <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Current Gold Price per Gram */}
            <div className="space-y-1.5">
              <Label className="text-xs" style={{ color: '#6B7280' }}>Current Gold Price per Gram (₹) <span className="text-gray-400">(manual)</span></Label>
              <Input
                type="number"
                value={currentGoldPrice}
                onChange={e => setCurrentGoldPrice(e.target.value)}
                placeholder="e.g. 7500"
                step="1"
                min="0"
                className="h-9 text-xs"
              />
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
        {weight > 0 && pricePerGram > 0 && (
          <div className="wv-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#C9A84C' }}>
              Calculated Summary
            </p>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'rgba(27,42,74,0.04)' }}>
                <p className="text-[10px] font-medium mb-1" style={{ color: '#9CA3AF' }}>Weight</p>
                <p className="text-sm font-bold" style={{ color: '#1B2A4A' }}>{weight.toFixed(3)}g</p>
              </div>
              <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'rgba(27,42,74,0.04)' }}>
                <p className="text-[10px] font-medium mb-1" style={{ color: '#9CA3AF' }}>Total Invested</p>
                <p className="text-sm font-bold" style={{ color: '#1B2A4A' }}>{formatLargeINR(totalCostWithMaking)}</p>
              </div>
              {currentPrice > 0 ? (
                <>
                  <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'rgba(5,150,105,0.06)' }}>
                    <p className="text-[10px] font-medium mb-1" style={{ color: '#9CA3AF' }}>Current Value</p>
                    <p className="text-sm font-bold" style={{ color: '#059669' }}>{formatLargeINR(Math.round(currentValue))}</p>
                  </div>
                  <div className="text-center p-3 rounded-lg col-span-3" style={{ backgroundColor: pnl >= 0 ? 'rgba(5,150,105,0.06)' : 'rgba(220,38,38,0.06)' }}>
                    <p className="text-[10px] font-medium mb-1" style={{ color: '#9CA3AF' }}>P&L</p>
                    <p className="text-sm font-bold" style={{ color: pnl >= 0 ? '#059669' : '#DC2626' }}>
                      {pnl >= 0 ? '+' : ''}{formatLargeINR(Math.round(pnl))} ({pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%)
                    </p>
                  </div>
                </>
              ) : (
                <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'rgba(201,168,76,0.08)' }}>
                  <p className="text-[10px] font-medium mb-1" style={{ color: '#9CA3AF' }}>Purity</p>
                  <p className="text-sm font-bold" style={{ color: '#C9A84C' }}>{PURITY_OPTIONS.find(p => p.value === purity)?.label}</p>
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
              <Gem className="w-4 h-4" />
              Save Gold Holding
            </span>
          )}
        </Button>

      </div>
    </div>
  );
}

// ─── Page wrapper with Suspense ─────────────────────────────────────────────────

export default function GoldAddPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#C9A84C' }} />
      </div>
    }>
      <GoldFormContent />
    </Suspense>
  );
}
