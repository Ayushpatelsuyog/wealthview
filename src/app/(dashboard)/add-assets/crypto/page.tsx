'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Bitcoin, Check, AlertCircle, X, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR } from '@/lib/utils/formatters';

// ─── Types ──────────────────────────────────────────────────────────────────────

interface FamilyMember { id: string; name: string }
interface Toast { type: 'success' | 'error'; message: string }

// ─── Constants ──────────────────────────────────────────────────────────────────

const EXCHANGES = ['WazirX', 'CoinDCX', 'CoinSwitch', 'Binance', 'Coinbase', 'Kraken', 'Other'];

const COINS = [
  { symbol: 'BTC',   name: 'Bitcoin' },
  { symbol: 'ETH',   name: 'Ethereum' },
  { symbol: 'BNB',   name: 'BNB' },
  { symbol: 'SOL',   name: 'Solana' },
  { symbol: 'XRP',   name: 'Ripple' },
  { symbol: 'ADA',   name: 'Cardano' },
  { symbol: 'DOGE',  name: 'Dogecoin' },
  { symbol: 'DOT',   name: 'Polkadot' },
  { symbol: 'AVAX',  name: 'Avalanche' },
  { symbol: 'MATIC', name: 'Polygon' },
  { symbol: 'LINK',  name: 'Chainlink' },
  { symbol: 'UNI',   name: 'Uniswap' },
  { symbol: 'OTHER', name: 'Other' },
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

function CryptoFormContent() {
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

  // Crypto fields
  const [exchange, setExchange] = useState('WazirX');
  const [coinSelect, setCoinSelect] = useState('BTC');
  const [customCoinSymbol, setCustomCoinSymbol] = useState('');
  const [customCoinName, setCustomCoinName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [buyPrice, setBuyPrice] = useState('');
  const [buyDate, setBuyDate] = useState('');
  const [walletAddress, setWalletAddress] = useState('');
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

  // ── Auto-set today for buy date ───────────────────────────────────────────────
  useEffect(() => {
    setBuyDate(new Date().toISOString().split('T')[0]);
  }, []);

  // ── Calculations ──────────────────────────────────────────────────────────────
  const quantityNum = parseFloat(quantity) || 0;
  const buyPriceNum = parseFloat(buyPrice) || 0;
  const totalInvestment = quantityNum * buyPriceNum;

  // Resolve coin symbol and name
  const isOtherCoin = coinSelect === 'OTHER';
  const resolvedSymbol = isOtherCoin ? customCoinSymbol.trim().toUpperCase() : coinSelect;
  const resolvedName = isOtherCoin ? customCoinName.trim() : (COINS.find(c => c.symbol === coinSelect)?.name ?? coinSelect);

  // ── Validate ──────────────────────────────────────────────────────────────────
  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (isOtherCoin && !customCoinSymbol.trim()) errs.coinSymbol = 'Enter coin symbol';
    if (isOtherCoin && !customCoinName.trim()) errs.coinName = 'Enter coin name';
    if (!quantity || quantityNum <= 0) errs.quantity = 'Enter a valid quantity';
    if (!buyPrice || buyPriceNum <= 0) errs.buyPrice = 'Enter a valid buy price';
    if (!buyDate) errs.buyDate = 'Select buy date';
    if (!portfolioName.trim()) errs.portfolio = 'Enter a portfolio name';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Save to holdings table directly via supabase client ───────────────────────
  async function handleSave() {
    if (!validate()) return;
    setSaving(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: profile } = await supabase
        .from('users').select('family_id').eq('id', user.id).single();
      if (!profile?.family_id) throw new Error('No family found');

      const targetUserId = member || user.id;
      const familyId = profile.family_id;

      // Find or create portfolio
      const { data: existingPortfolio } = await supabase
        .from('portfolios').select('id')
        .eq('family_id', familyId).eq('name', portfolioName.trim()).eq('user_id', targetUserId)
        .maybeSingle();

      let portfolioId: string;
      if (existingPortfolio) {
        portfolioId = existingPortfolio.id;
      } else {
        const { data: newPortfolio, error: portErr } = await supabase
          .from('portfolios')
          .insert({ user_id: targetUserId, family_id: familyId, name: portfolioName.trim(), type: 'personal' })
          .select('id').single();
        if (portErr) throw new Error(portErr.message);
        portfolioId = newPortfolio.id;
      }

      // Insert into holdings table
      const { data: newHolding, error: hErr } = await supabase.from('holdings').insert({
        portfolio_id: portfolioId,
        asset_type: 'crypto',
        symbol: resolvedSymbol,
        name: resolvedName,
        quantity: quantityNum,
        avg_buy_price: buyPriceNum,
        metadata: {
          exchange,
          wallet_address: walletAddress.trim() || null,
        },
      }).select('id').single();
      if (hErr) throw new Error(hErr.message);

      // Insert buy transaction
      const txNotes = notes.trim() || `Buy ${resolvedName} (${resolvedSymbol}) | ${quantityNum} @ ₹${buyPriceNum.toFixed(2)} on ${exchange}`;
      await supabase.from('transactions').insert({
        holding_id: newHolding.id,
        type: 'buy',
        quantity: quantityNum,
        price: buyPriceNum,
        date: buyDate,
        fees: 0,
        notes: txNotes,
      });

      setToast({ type: 'success', message: 'Crypto holding added successfully!' });
      setTimeout(() => router.push('/portfolio/crypto'), 1200);
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
            style={{ backgroundColor: 'rgba(245,158,11,0.12)' }}>
            <Bitcoin className="w-5 h-5" style={{ color: '#f59e0b' }} />
          </div>
          <div>
            <h1 className="text-lg font-bold" style={{ color: '#1B2A4A' }}>Add Cryptocurrency</h1>
            <p className="text-xs" style={{ color: '#9CA3AF' }}>Track your crypto holdings across exchanges</p>
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

        {/* Step 2 — Crypto Details */}
        <div className="wv-card p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#9CA3AF' }}>
            Step 2 — Crypto Details
          </p>

          <div className="space-y-4">
            {/* Row: Exchange + Coin */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Exchange <span style={{ color: '#DC2626' }}>*</span></Label>
                <Select value={exchange} onValueChange={setExchange}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EXCHANGES.map(e => <SelectItem key={e} value={e} className="text-xs">{e}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Coin <span style={{ color: '#DC2626' }}>*</span></Label>
                <Select value={coinSelect} onValueChange={setCoinSelect}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COINS.map(c => (
                      <SelectItem key={c.symbol} value={c.symbol} className="text-xs">
                        {c.symbol} — {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Custom coin fields if Other is selected */}
            {isOtherCoin && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>Coin Symbol <span style={{ color: '#DC2626' }}>*</span></Label>
                  <Input
                    value={customCoinSymbol}
                    onChange={e => setCustomCoinSymbol(e.target.value)}
                    placeholder="e.g. SHIB"
                    className="h-9 text-xs"
                  />
                  <FieldError msg={errors.coinSymbol} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>Coin Name <span style={{ color: '#DC2626' }}>*</span></Label>
                  <Input
                    value={customCoinName}
                    onChange={e => setCustomCoinName(e.target.value)}
                    placeholder="e.g. Shiba Inu"
                    className="h-9 text-xs"
                  />
                  <FieldError msg={errors.coinName} />
                </div>
              </div>
            )}

            {/* Row: Quantity + Buy Price */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Quantity <span style={{ color: '#DC2626' }}>*</span></Label>
                <Input
                  type="number"
                  value={quantity}
                  onChange={e => setQuantity(e.target.value)}
                  placeholder="0.00000001"
                  step="0.00000001"
                  min="0"
                  className="h-9 text-xs"
                />
                <FieldError msg={errors.quantity} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Buy Price per Coin (INR) <span style={{ color: '#DC2626' }}>*</span></Label>
                <Input
                  type="number"
                  value={buyPrice}
                  onChange={e => setBuyPrice(e.target.value)}
                  placeholder="0.00"
                  step="0.01"
                  min="0"
                  className="h-9 text-xs"
                />
                <FieldError msg={errors.buyPrice} />
              </div>
            </div>

            {/* Buy Date */}
            <div className="space-y-1.5">
              <Label className="text-xs" style={{ color: '#6B7280' }}>Buy Date <span style={{ color: '#DC2626' }}>*</span></Label>
              <Input
                type="date"
                value={buyDate}
                onChange={e => setBuyDate(e.target.value)}
                className="h-9 text-xs"
              />
              <FieldError msg={errors.buyDate} />
            </div>

            {/* Wallet Address */}
            <div className="space-y-1.5">
              <Label className="text-xs" style={{ color: '#6B7280' }}>Wallet Address <span className="text-gray-400">(optional)</span></Label>
              <Input
                value={walletAddress}
                onChange={e => setWalletAddress(e.target.value)}
                placeholder="e.g. 0x1a2b3c..."
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
        {quantityNum > 0 && buyPriceNum > 0 && (
          <div className="wv-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#C9A84C' }}>
              Calculated Summary
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'rgba(27,42,74,0.04)' }}>
                <p className="text-[10px] font-medium mb-1" style={{ color: '#9CA3AF' }}>Quantity</p>
                <p className="text-sm font-bold" style={{ color: '#1B2A4A' }}>{quantityNum.toLocaleString('en-IN', { maximumFractionDigits: 8 })}</p>
              </div>
              <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'rgba(27,42,74,0.04)' }}>
                <p className="text-[10px] font-medium mb-1" style={{ color: '#9CA3AF' }}>Buy Price / Coin</p>
                <p className="text-sm font-bold" style={{ color: '#1B2A4A' }}>{formatLargeINR(buyPriceNum)}</p>
              </div>
              <div className="text-center p-3 rounded-lg" style={{ backgroundColor: 'rgba(201,168,76,0.08)' }}>
                <p className="text-[10px] font-medium mb-1" style={{ color: '#9CA3AF' }}>Total Investment</p>
                <p className="text-sm font-bold" style={{ color: '#C9A84C' }}>{formatLargeINR(totalInvestment)}</p>
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
              <Bitcoin className="w-4 h-4" />
              Save Crypto Holding
            </span>
          )}
        </Button>

      </div>
    </div>
  );
}

// ─── Page wrapper with Suspense ─────────────────────────────────────────────────

export default function AddCryptoPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#C9A84C' }} />
      </div>
    }>
      <CryptoFormContent />
    </Suspense>
  );
}
