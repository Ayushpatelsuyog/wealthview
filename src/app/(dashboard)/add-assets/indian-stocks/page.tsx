'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input }  from '@/components/ui/input';
import { Label }  from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  TrendingUp, TrendingDown, Upload, Link as LinkIcon, Check, ChevronDown,
  Loader2, AlertCircle, X, User, Building2, Search,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR } from '@/lib/utils/formatters';
import { holdingsCacheClearAll } from '@/lib/utils/holdings-cache';
import { BrokerSelector } from '@/components/forms/BrokerSelector';
import { PortfolioSelector } from '@/components/forms/PortfolioSelector';

// ─── Types ────────────────────────────────────────────────────────────────────

interface StockResult {
  symbol: string;
  companyName: string;
  exchange: string;
  sector: string;
  industry: string;
  isin: string;
  bseCode: string;
}

interface StockPrice {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  dayHigh: number;
  dayLow: number;
  lastUpdated: string;
}

interface FamilyMember { id: string; name: string }
interface Toast        { type: 'success' | 'error'; message: string }

// ─── Constants ────────────────────────────────────────────────────────────────

const TXN_TYPES = [
  { key: 'buy',         label: 'Buy' },
  { key: 'sell',        label: 'Sell' },
  { key: 'bonus',       label: 'Bonus' },
  { key: 'split',       label: 'Split' },
  { key: 'rights',      label: 'Rights Issue' },
  { key: 'dividend',    label: 'Dividend' },
  { key: 'buyback',     label: 'Buyback' },
  { key: 'merger_in',   label: 'Received via M&A' },
  { key: 'demerger_in', label: 'Received via Demerger' },
];

const SECTOR_COLORS: Record<string, string> = {
  'IT':            '#3B82F6',
  'Banking':       '#1B2A4A',
  'Finance':       '#5C6BC0',
  'FMCG':          '#059669',
  'Auto':          '#EA580C',
  'Pharma':        '#DB2777',
  'Energy':        '#D97706',
  'Metals':        '#6B7280',
  'Infrastructure':'#8B5CF6',
  'Chemicals':     '#14B8A6',
  'Consumer':      '#F59E0B',
  'Healthcare':    '#EC4899',
  'Cement':        '#9CA3AF',
  'Insurance':     '#2E8B8B',
  'Telecom':       '#6366F1',
  'Real Estate':   '#C9A84C',
  'Technology':    '#3B82F6',
  'Defense':       '#1F2937',
  'Retail':        '#7C3AED',
  'Logistics':     '#78716C',
  'Media':         '#F97316',
  'Capital Goods': '#10B981',
};

function sectorColor(sector: string): string {
  return SECTOR_COLORS[sector] ?? '#6B7280';
}

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

function AutoTag({ label }: { label: string }) {
  return (
    <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium"
      style={{ backgroundColor: 'rgba(5,150,105,0.1)', color: '#059669' }}>
      {label}
    </span>
  );
}

function ChargeRow({ label, value, onChange, autoCalc, onAutoClick }: {
  label: string; value: string; onChange: (v: string) => void;
  autoCalc?: string; onAutoClick?: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Label className="text-xs w-36 flex-shrink-0" style={{ color: 'var(--wv-text-secondary)' }}>{label}</Label>
      <div className="flex-1 relative">
        <Input
          type="number" step="0.01" min="0"
          value={value} onChange={e => onChange(e.target.value)}
          placeholder="0.00" className="h-8 text-xs pr-8"
        />
        {autoCalc !== undefined && (
          <button onClick={onAutoClick}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-medium"
            style={{ color: '#C9A84C' }}>
            auto
          </button>
        )}
      </div>
      {autoCalc !== undefined && (
        <span className="text-[10px] w-20 text-right flex-shrink-0" style={{ color: 'var(--wv-text-muted)' }}>
          calc: ₹{autoCalc}
        </span>
      )}
    </div>
  );
}

// ─── Main Form Content ─────────────────────────────────────────────────────────

// Module-level: survives re-renders, consumed once when members load
let _pendingMember: string | null = null;

function IndianStocksFormContent() {
  const router   = useRouter();
  const supabase = createClient();
  const _searchParams = useSearchParams();
  const editTxnId = _searchParams.get('edit_txn');
  const editHoldingId = _searchParams.get('holding_id');
  const isEditMode = !!editTxnId && !!editHoldingId;

  const addToHoldingId = _searchParams.get('add_to');
  const sellHoldingId = _searchParams.get('sell');
  const dividendHoldingId = _searchParams.get('dividend');
  const buybackHoldingId = _searchParams.get('buyback');
  const bonusHoldingId = _searchParams.get('bonus');
  const splitHoldingId = _searchParams.get('split');
  const rightsHoldingId = _searchParams.get('rights');
  const _isAddMoreMode = !!addToHoldingId && !isEditMode;
  const isSellMode = !!sellHoldingId;
  const isDividendMode = !!dividendHoldingId;
  const isBuybackMode = !!buybackHoldingId;
  const isBonusMode = !!bonusHoldingId;
  const isSplitMode = !!splitHoldingId;
  const isRightsMode = !!rightsHoldingId;
  const preloadHoldingId = addToHoldingId || sellHoldingId || dividendHoldingId || buybackHoldingId || bonusHoldingId || splitHoldingId || rightsHoldingId;

  // Family/member prefill from sessionStorage (set by portfolio page before navigation)
  const prefillFamily = typeof window !== 'undefined' ? sessionStorage.getItem('wv_prefill_family') : null;
  const prefillMember = typeof window !== 'undefined' ? sessionStorage.getItem('wv_prefill_member') : null;
  const prefillActive = typeof window !== 'undefined' ? sessionStorage.getItem('wv_prefill_active') === 'true' : false;
  if (prefillActive && typeof window !== 'undefined') {
    sessionStorage.removeItem('wv_prefill_family');
    sessionStorage.removeItem('wv_prefill_member');
    sessionStorage.removeItem('wv_prefill_active');
  }
  _pendingMember = prefillMember;
  console.log('=== ADD PAGE INIT ===', { prefillFamily, prefillMember, prefillActive, _pendingMember });
  const urlFamilyId = _searchParams.get('family_id') || prefillFamily;
  const urlMemberId = _searchParams.get('member_id') || prefillMember;
  const hasPrefill = prefillActive || !!(_searchParams.get('family_id') || _searchParams.get('member_id'));

  // Auth / family
  const [familyId, setFamilyId] = useState<string | null>(urlFamilyId);
  const [families, setFamilies] = useState<{id: string; name: string}[]>([]);
  const [selectedFamily, setSelectedFamily] = useState(urlFamilyId || '');
  const [members,  setMembers]  = useState<FamilyMember[]>([]);
  const [member,   setMember]   = useState(urlMemberId || '');

  // Portfolio
  const [portfolioName, setPortfolioName] = useState('');

  // Broker
  const [brokerId, setBrokerId] = useState<string | null>(null);

  // Stock search
  const [query,       setQuery]       = useState('');
  const [searching,   setSearching]   = useState(false);
  const [results,     setResults]     = useState<StockResult[]>([]);
  const [showDrop,    setShowDrop]    = useState(false);
  const [selectedStock, setSelectedStock] = useState<StockResult | null>(null);
  const [stockPrice,  setStockPrice]  = useState<StockPrice | null>(null);
  const [priceLoading,setPriceLoading]= useState(false);
  const [sectorOverride, setSectorOverride] = useState<string | null>(null);

  // Transaction type
  const [txnType, setTxnType] = useState<string>('buy');

  // Buy / Sell fields
  const [quantity,    setQuantity]    = useState('');
  const [price,       setPrice]       = useState('');
  const [date,        setDate]        = useState('');
  const [priceLoaded, setPriceLoaded] = useState(false); // for auto-fill indicator
  const [priceManuallyEdited, setPriceManuallyEdited] = useState(false); // blocks auto-fetch overwrite

  // Charges
  const [brokerage,       setBrokerage]       = useState('0');
  const [stt,             setStt]             = useState('');
  const [gst,             setGst]             = useState('');
  const [stampDuty,       setStampDuty]       = useState('');
  const [exchangeCharges, setExchangeCharges] = useState('0');
  const [dpCharges,       setDpCharges]       = useState('0');
  // Bonus
  const [bonusRatio,  setBonusRatio]  = useState('');
  // Split
  const [splitRatio,  setSplitRatio]  = useState('');
  // Rights
  const [rightsRatio, setRightsRatio] = useState('');
  const [rightsPrice, setRightsPrice] = useState('');
  // Dividend
  const [divPerShare, setDivPerShare] = useState('');
  const [divType,     setDivType]     = useState('Interim');
  const [exDate,      setExDate]      = useState('');
  const [payDate,     setPayDate]     = useState('');
  // Buyback
  const [buybackPrice, setBuybackPrice] = useState('');
  const [sharesAccepted, setSharesAccepted] = useState('');
  // Merger In (Received via M&A)
  const [originalCompany, setOriginalCompany] = useState('');
  const [originalShares, setOriginalShares] = useState('');
  const [originalCostBasis, setOriginalCostBasis] = useState('');
  const [mergerCashComponent, setMergerCashComponent] = useState('');
  // Demerger In (Received via Demerger)
  const [parentCompany, setParentCompany] = useState('');
  const [costBasisAllocated, setCostBasisAllocated] = useState('');

  // UI state
  const [saving,  setSaving]  = useState(false);
  const [toast,   setToast]   = useState<Toast | null>(null);
  const [errors,  setErrors]  = useState<Record<string, string>>({});

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stays TRUE permanently when prefill specified family/member — prevents any overwrite
  const prefillLockedRef = useRef(hasPrefill);
  // Store the target member ID permanently so it can be re-applied when members list loads
  const targetMemberRef = useRef(urlMemberId || '');
  // Always-current family ref to avoid stale closures in async member fetches
  const activeFamilyRef = useRef(selectedFamily);
  activeFamilyRef.current = selectedFamily;

  // ── Load holding for add-more / sell / dividend modes ──
  useEffect(() => {
    if (!preloadHoldingId) return;
    (async () => {
      const { data: holdingData } = await supabase
        .from('holdings')
        .select('symbol, name, quantity, avg_buy_price, metadata, brokers(id, name), portfolios(name, family_id, user_id)')
        .eq('id', preloadHoldingId)
        .single();
      if (!holdingData) return;

      const meta = (holdingData.metadata ?? {}) as Record<string, unknown>;
      const holdingSector = String(meta.sector ?? '');
      setSelectedStock({
        symbol: holdingData.symbol,
        companyName: holdingData.name,
        exchange: String(meta.exchange ?? 'NSE'),
        sector: holdingSector,
        industry: String(meta.industry ?? ''),
        isin: String(meta.isin ?? ''),
        bseCode: String(meta.bse_code ?? ''),
      });
      setQuery(`${holdingData.symbol} — ${holdingData.name}`);

      // Pre-fill sector from holding metadata
      if (holdingSector) {
        setSectorOverride(holdingSector);
        console.log('Preloaded sector:', holdingSector);
      }

      // Set transaction type based on mode
      if (isSellMode) setTxnType('sell');
      else if (isDividendMode) setTxnType('dividend');
      else if (isBuybackMode) setTxnType('buyback');
      else if (isBonusMode) setTxnType('bonus');
      else if (isSplitMode) setTxnType('split');
      else if (isRightsMode) setTxnType('rights');
      else setTxnType('buy');

      // Pre-select family/member from holding's portfolio (fallback if not already prefilled)
      if (holdingData.portfolios) {
        const p = holdingData.portfolios as unknown as { name: string; family_id: string; user_id: string };
        setPortfolioName(p.name);
        if (p.family_id) {
          setSelectedFamily(p.family_id);
          setFamilyId(p.family_id);
        }
        if (p.user_id) {
          setMember(p.user_id);
          targetMemberRef.current = p.user_id;
          _pendingMember = p.user_id;
        }
        prefillLockedRef.current = true; // lock — database values are the definitive source
      }
      if (holdingData.brokers) {
        setBrokerId((holdingData.brokers as unknown as { id: string }).id);
      }
    })();
  }, [preloadHoldingId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load user/family ────────────────────────────────────────────────────────
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
        console.log('Fetching members for family (init):', activeFamilyId);
        const { data: fUsers } = await supabase.from('users').select('id, name').eq('family_id', activeFamilyId);
        if (fUsers && fUsers.length > 0) {
          setMembers(fUsers);
          console.log('=== MEMBERS LOADED (init) ===', {
            selectedFamily: activeFamilyRef.current,
            membersCount: fUsers.length,
            members: fUsers.map(m => ({ id: m.id, name: m.name })),
            _pendingMember,
            currentMember: member,
          });
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
                const f = (m as Record<string, unknown>).families as {id: string; name: string} | undefined;
                if (f && !famList.find(x => x.id === f.id)) famList.push(f);
              }
            }
          } catch { /* table may not exist */ }

          // If urlFamilyId is set but not in the list, add it
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

  // ── Reload members when family changes ──────────────────────────────────
  function handleManualFamilyChange(fid: string) {
    prefillLockedRef.current = false;
    setSelectedFamily(fid);
  }
  useEffect(() => {
    if (!selectedFamily) return;
    setFamilyId(selectedFamily);
    setPortfolioName('');
    setBrokerId(null);
    const targetFamily = selectedFamily;
    (async () => {
      console.log('Fetching members for family:', targetFamily);
      const { data: fUsers } = await supabase.from('users').select('id, name').eq('family_id', targetFamily);
      // Bail if family changed while fetching (stale result)
      if (activeFamilyRef.current !== targetFamily) return;
      setMembers(fUsers ?? []);
      const target = targetMemberRef.current;
      const targetInList = target && fUsers?.find(m => m.id === target);
      console.log('=== MEMBERS LOADED ===', {
        selectedFamily: targetFamily,
        membersCount: fUsers?.length,
        members: fUsers?.map(m => ({ id: m.id, name: m.name })),
        _pendingMember,
        targetMemberRef: target,
        currentMember: member,
      });
      // Apply pending member from module-level variable (survives async load)
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

  // ── Auto-set today for date ─────────────────────────────────────────────────
  useEffect(() => {
    if (!editTxnId) setDate(new Date().toISOString().split('T')[0]);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load transaction for edit mode ────────────────────────────────────────
  useEffect(() => {
    if (!isEditMode) return;
    (async () => {
      const { data: txn } = await supabase
        .from('transactions')
        .select('id, type, quantity, price, date, fees, notes')
        .eq('id', editTxnId)
        .single();
      if (!txn) return;

      const { data: holdingData } = await supabase
        .from('holdings')
        .select('symbol, name, metadata, brokers(id, name), portfolios(name, family_id, user_id)')
        .eq('id', editHoldingId)
        .single();
      if (!holdingData) return;

      const meta = (holdingData.metadata ?? {}) as Record<string, unknown>;
      const editSector = String(meta.sector ?? '');

      setSelectedStock({
        symbol: holdingData.symbol,
        companyName: holdingData.name,
        exchange: String(meta.exchange ?? 'NSE'),
        sector: editSector,
        industry: String(meta.industry ?? ''),
        isin: String(meta.isin ?? ''),
        bseCode: String(meta.bse_code ?? ''),
      });
      setQuery(`${holdingData.symbol} — ${holdingData.name}`);

      // Pre-fill sector from holding metadata
      if (editSector) {
        setSectorOverride(editSector);
      }

      const notes = txn.notes ?? '';
      if (notes.toLowerCase().includes('bonus')) setTxnType('bonus');
      else if (notes.toLowerCase().includes('split')) setTxnType('split');
      else if (notes.toLowerCase().includes('rights')) setTxnType('rights');
      else if (notes.toLowerCase().includes('buyback')) setTxnType('buyback');
      else if (notes.toLowerCase().includes('merger')) setTxnType('merger_in');
      else if (notes.toLowerCase().includes('demerger')) setTxnType('demerger_in');
      else if (txn.type === 'dividend') setTxnType('dividend');
      else if (txn.type === 'sell') setTxnType('sell');
      else setTxnType('buy');

      setQuantity(String(txn.quantity || ''));
      setPrice(String(txn.price || ''));
      setDate(txn.date || '');

      // Set portfolio, family, member from holding's portfolio record
      if (holdingData.portfolios) {
        const p = holdingData.portfolios as unknown as { name: string; family_id: string; user_id: string };
        setPortfolioName(p.name);
        if (p.family_id) {
          setSelectedFamily(p.family_id);
          setFamilyId(p.family_id);
        }
        if (p.user_id) {
          setMember(p.user_id);
          targetMemberRef.current = p.user_id;
          _pendingMember = p.user_id;
        }
        prefillLockedRef.current = true;
      }
      if (holdingData.brokers) {
        const b = holdingData.brokers as unknown as { id: string };
        setBrokerId(b.id);
      }
    })();
  }, [editTxnId, editHoldingId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Search with debounce ────────────────────────────────────────────────────
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 2) { setResults([]); setShowDrop(false); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/stocks/search?q=${encodeURIComponent(query)}`);
        if (!res.ok) { console.error('[Stocks Search] HTTP', res.status, res.url); setSearching(false); return; }
        const { results: r } = await res.json();
        setResults(r ?? []);
        setShowDrop(true);
      } catch (err) { console.error('[Stocks Search] fetch error:', err); setResults([]); }
      setSearching(false);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  // ── Auto-fetch price on date change ────────────────────────────────────────
  // Only auto-fill if user hasn't manually edited the price field
  useEffect(() => {
    if (!selectedStock || !date) return;
    if (priceManuallyEdited) return; // user already typed a price — don't overwrite
    if (isEditMode) return; // in edit mode, price comes from the saved transaction
    setPriceLoaded(false);
    fetch(`/api/stocks/price-history?symbol=${selectedStock.symbol}&date=${date}`)
      .then(r => r.json())
      .then(d => {
        if (d.price) {
          setPrice(d.price.toFixed(2));
          setPriceLoaded(true);
        }
      })
      .catch(() => {/* silent */});
  }, [selectedStock, date, priceManuallyEdited, isEditMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-calculate charges ──────────────────────────────────────────────────
  const qty   = parseFloat(quantity) || 0;
  const px    = parseFloat(price)    || 0;
  const value = qty * px;

  const autoSTT       = parseFloat((value * 0.001).toFixed(2));          // 0.1%
  const autoGST       = parseFloat((parseFloat(brokerage || '0') * 0.18).toFixed(2)); // 18% of brokerage
  const autoStamp     = parseFloat((value * 0.00015).toFixed(2));         // 0.015% for delivery

  function applyAutoCharges() {
    if (!stt)       setStt(autoSTT.toString());
    if (!gst)       setGst(autoGST.toString());
    if (!stampDuty) setStampDuty(autoStamp.toString());
  }

  const totalFees = (parseFloat(brokerage || '0') + parseFloat(stt || '0') +
                     parseFloat(gst || '0') + parseFloat(stampDuty || '0') +
                     parseFloat(exchangeCharges || '0') + parseFloat(dpCharges || '0'));

  const totalCost = value + totalFees;

  // For sell — P&L preview vs current price
  const _currentPx = stockPrice?.price ?? 0;
  const _sellPnl   = txnType === 'sell' && qty && px ? (px - (stockPrice ? parseFloat(price) : 0)) * qty : null;

  // ── Select stock ────────────────────────────────────────────────────────────
  async function selectStock(stock: StockResult) {
    setSelectedStock(stock);
    setQuery(`${stock.symbol} — ${stock.companyName}`);
    setShowDrop(false);
    setPriceLoading(true);
    try {
      const res = await fetch(`/api/stocks/price?symbol=${stock.symbol}`);
      const data = await res.json();
      setStockPrice(data);
    } catch { setStockPrice(null); }
    setPriceLoading(false);
  }

  // ── Validate ────────────────────────────────────────────────────────────────
  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!selectedStock) errs.stock    = 'Select a stock';
    if (!portfolioName) errs.portfolio = 'Select or create a portfolio';

    if (txnType === 'buy' || txnType === 'sell' || txnType === 'rights') {
      if (!quantity || qty <= 0)    errs.quantity = 'Enter a valid quantity';
      if (!price    || px  <= 0)    errs.price    = 'Enter a valid price';
    }
    if (!date) errs.date = 'Enter a date';
    if (txnType === 'bonus'    && !bonusRatio)  errs.bonusRatio  = 'Enter bonus ratio e.g. 1:2';
    if (txnType === 'split'    && !splitRatio)  errs.splitRatio  = 'Enter split ratio e.g. 1:5';
    if (txnType === 'dividend' && !divPerShare) errs.divPerShare = 'Enter dividend per share';
    if (txnType === 'buyback') {
      if (!quantity || qty <= 0) errs.quantity = 'Enter shares tendered';
      if (!buybackPrice || parseFloat(buybackPrice) <= 0) errs.buybackPrice = 'Enter buyback price';
      if (!date) errs.date = 'Enter record date';
    }
    if (txnType === 'merger_in') {
      if (!quantity || qty <= 0) errs.quantity = 'Enter shares received';
      if (!originalCompany.trim()) errs.originalCompany = 'Enter original company name';
      if (!originalCostBasis || parseFloat(originalCostBasis) <= 0) errs.originalCostBasis = 'Enter original cost basis';
      if (!date) errs.date = 'Enter the merger date';
    }
    if (txnType === 'demerger_in') {
      if (!quantity || qty <= 0) errs.quantity = 'Enter shares received';
      if (!parentCompany.trim()) errs.parentCompany = 'Enter parent company name';
      if (!costBasisAllocated || parseFloat(costBasisAllocated) <= 0) errs.costBasisAllocated = 'Enter cost basis allocated';
      if (!date) errs.date = 'Enter the demerger date';
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Save ────────────────────────────────────────────────────────────────────
  async function handleSave(andAnother = false) {
    if (!validate()) return;
    setSaving(true);

    try {
      // Edit mode: update existing transaction
      if (isEditMode) {
        const totalFees = (parseFloat(brokerage || '0') + parseFloat(stt || '0') +
          parseFloat(gst || '0') + parseFloat(stampDuty || '0') +
          parseFloat(exchangeCharges || '0') + parseFloat(dpCharges || '0'));
        const res = await fetch('/api/stocks/update-transaction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            txn_id: editTxnId,
            holding_id: editHoldingId,
            quantity: qty,
            price: px,
            date,
            fees: totalFees,
            notes: txnType === 'dividend' ? `${divType} — ₹${divPerShare}/share${exDate ? ` | Ex-date: ${exDate}` : ''}` : undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Update failed');
        setToast({ type: 'success', message: 'Transaction updated successfully!' });
        holdingsCacheClearAll();
        setTimeout(() => router.push('/portfolio/indian-stocks'), 1200);
        setSaving(false);
        return;
      }

      // For split: compute new total quantity
      let splitFactor = 1;
      if (txnType === 'split' && splitRatio) {
        const [num, den] = splitRatio.split(':').map(Number);
        if (den > 0) splitFactor = num / den;
      }

      // For bonus: compute bonus shares
      let bonusQty = 0;
      if (txnType === 'bonus' && bonusRatio && quantity) {
        const [num, den] = bonusRatio.split(':').map(Number);
        if (den > 0) bonusQty = Math.floor((qty / den) * num);
      }

      const body: Record<string, unknown> = {
        symbol:          selectedStock!.symbol,
        companyName:     selectedStock!.companyName,
        exchange:        selectedStock!.exchange,
        sector:          sectorOverride || selectedStock!.sector,
        industry:        selectedStock!.industry,
        isin:            selectedStock!.isin,
        bseCode:         selectedStock!.bseCode,
        transactionType: txnType,
        quantity:        txnType === 'bonus' ? bonusQty : qty,
        price:           px,
        date,
        brokerage, stt, gst, stampDuty, exchangeCharges, dpCharges,
        portfolioName:   portfolioName,
        brokerId,
        memberId:        member,
        familyId:        familyId || undefined,
        currentPrice: stockPrice?.price ?? null,
        bonusRatio,  splitRatio,  splitFactor,
        rightsRatio, rightsPrice,
        dividendPerShare: divPerShare, dividendType: divType, exDate, paymentDate: payDate,
        buybackPrice: txnType === 'buyback' ? parseFloat(buybackPrice) : undefined,
        sharesAccepted: txnType === 'buyback' ? (parseFloat(sharesAccepted) || parseFloat(quantity)) : undefined,
        // Merger In extras
        originalCompany: txnType === 'merger_in' ? originalCompany : undefined,
        originalShares: txnType === 'merger_in' ? originalShares : undefined,
        originalCostBasis: txnType === 'merger_in' ? parseFloat(originalCostBasis) : undefined,
        mergerCashComponent: txnType === 'merger_in' ? parseFloat(mergerCashComponent || '0') : undefined,
        // Demerger In extras
        parentCompany: txnType === 'demerger_in' ? parentCompany : undefined,
        costBasisAllocated: txnType === 'demerger_in' ? parseFloat(costBasisAllocated) : undefined,
      };

      if (txnType === 'buyback') body.transactionType = 'buyback';

      if (txnType === 'sell' && sellHoldingId) {
        // Sell mode: use dedicated sell API to reduce existing holding
        const res = await fetch('/api/stocks/sell', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            holdingId: sellHoldingId,
            quantity: qty,
            price: px,
            date,
            brokerage, stt, gst, stampDuty, exchangeCharges, dpCharges,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Sell failed');

        const pnlSign = (data.pnl ?? 0) >= 0 ? '+' : '';
        setToast({
          type: 'success',
          message: `Sell recorded! Realized P&L: ${pnlSign}₹${Math.abs(data.pnl ?? 0).toFixed(0)}`,
        });
        holdingsCacheClearAll();
        setTimeout(() => router.push('/portfolio/indian-stocks'), 1200);
      } else {
        // Normal mode: buy, dividend, bonus, split, rights, or sell without holdingId
        const res = await fetch('/api/stocks/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Save failed');

        setToast({ type: 'success', message: `${txnType === 'buy' ? 'Holding saved' : txnType.charAt(0).toUpperCase() + txnType.slice(1)} recorded successfully!${data.consolidated ? ' (Consolidated with existing holding)' : ''}` });
        holdingsCacheClearAll();

        if (andAnother) {
          resetForm();
        } else {
          setTimeout(() => router.push('/portfolio/indian-stocks'), 1200);
        }
      }
    } catch (e) {
      setToast({ type: 'error', message: (e as Error).message });
    }
    setSaving(false);
  }

  function resetForm() {
    setSelectedStock(null); setQuery(''); setStockPrice(null);
    setQuantity(''); setPrice(''); setPriceLoaded(false); setPriceManuallyEdited(false);
    setBrokerage('0'); setStt(''); setGst(''); setStampDuty(''); setExchangeCharges('0'); setDpCharges('0');
    setBonusRatio(''); setSplitRatio(''); setRightsRatio(''); setRightsPrice('');
    setDivPerShare(''); setExDate(''); setPayDate('');
    setBuybackPrice(''); setSharesAccepted('');
    setOriginalCompany(''); setOriginalShares(''); setOriginalCostBasis(''); setMergerCashComponent('');
    setParentCompany(''); setCostBasisAllocated('');
    setSectorOverride(null);
    setErrors({});
    setDate(new Date().toISOString().split('T')[0]);
  }


  // ── Save button label ─────────────────────────────────────────────────────
  const TXN_LABELS: Record<string, string> = {
    buy: 'Buy', sell: 'Sell', bonus: 'Bonus', split: 'Split',
    rights: 'Rights Issue', dividend: 'Dividend', buyback: 'Buyback',
    merger_in: 'M&A Entry', demerger_in: 'Demerger Entry',
  };
  const saveLabel = TXN_LABELS[txnType] ?? 'Entry';

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-2xl mx-auto">

      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: 'var(--wv-surface-2)' }}>
          <TrendingUp className="w-5 h-5" style={{ color: 'var(--wv-text)' }} />
        </div>
        <div>
          <h1 className="font-display text-xl font-semibold" style={{ color: 'var(--wv-text)' }}>{isEditMode ? 'Edit Transaction' : 'Indian Stocks'}</h1>
          <p className="text-xs" style={{ color: 'var(--wv-text-muted)' }}>{isEditMode ? 'Update the details of this transaction' : 'Track NSE/BSE equity holdings across all transaction types'}</p>
        </div>
      </div>

      {toast && <ToastBanner toast={toast} onClose={() => setToast(null)} />}

      <Tabs defaultValue="manual">
        <TabsList className="mb-5 w-full" style={{ backgroundColor: 'var(--wv-surface-2)', border: '1px solid var(--wv-border)' }}>
          <TabsTrigger value="manual" className="flex-1 gap-1.5 text-xs data-[state=active]:bg-white">
            <TrendingUp className="w-3.5 h-3.5" />Manual Entry
          </TabsTrigger>
          <TabsTrigger value="import" className="flex-1 gap-1.5 text-xs data-[state=active]:bg-white">
            <Upload className="w-3.5 h-3.5" />Contract Note Import
          </TabsTrigger>
          <TabsTrigger value="sync" className="flex-1 gap-1.5 text-xs data-[state=active]:bg-white">
            <LinkIcon className="w-3.5 h-3.5" />Broker Sync
          </TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Manual Entry ──────────────────────────────────────────── */}
        <TabsContent value="manual" className="space-y-4">

          {/* Step 1 — Portfolio & Broker */}
          <div className="wv-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--wv-text-muted)' }}>
              Step 1 — Portfolio &amp; Distributor
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

            {/* Portfolio */}
            <div className="space-y-1.5 mb-4">
              <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Portfolio</Label>
              <PortfolioSelector
                familyId={familyId}
                memberId={member}
                selectedPortfolioName={portfolioName}
                onChange={setPortfolioName}
                error={errors.portfolio}
              />
            </div>

            {/* Broker */}
            <div className="space-y-1.5">
              <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Distributor / Demat Account</Label>
              <BrokerSelector
                familyId={familyId}
                selectedBrokerId={brokerId}
                onChange={setBrokerId}
                error={errors.broker}
              />
            </div>
          </div>

          {/* Step 2 — Stock Search */}
          <div className="wv-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--wv-text-muted)' }}>
              Step 2 — Search Stock
            </p>

            <div className="relative">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: 'var(--wv-text-muted)' }} />
                <Input
                  value={query}
                  onChange={e => { if (!isEditMode && !preloadHoldingId) { setQuery(e.target.value); setSelectedStock(null); setStockPrice(null); } }}
                  onFocus={() => { if (!isEditMode && !preloadHoldingId && results.length > 0) setShowDrop(true); }}
                  readOnly={!!(isEditMode || preloadHoldingId)}
                  placeholder="Search by symbol or company name (min 2 chars)…"
                  className={`h-9 text-xs pl-9 pr-8 ${isEditMode || preloadHoldingId ? 'bg-[#F7F5F0] cursor-not-allowed' : ''}`}
                />
                {searching
                  ? <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin" style={{ color: 'var(--wv-text-muted)' }} />
                  : <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: 'var(--wv-text-muted)' }} />
                }
              </div>

              {/* Dropdown */}
              {showDrop && results.length > 0 && (
                <>
                  <div className="fixed inset-0" style={{ zIndex: 9990 }} onClick={() => setShowDrop(false)} />
                  <div className="absolute top-full mt-1 left-0 right-0 rounded-xl border bg-white"
                    style={{ borderColor: 'var(--wv-border)', zIndex: 9999, boxShadow: '0 8px 32px rgba(0,0,0,0.12)' }}>
                    {results.map((s) => (
                      <button key={s.symbol}
                        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[#F7F5F0] text-left border-b last:border-0 transition-colors"
                        style={{ borderColor: '#F0EDE6' }}
                        onClick={() => selectStock(s)}>
                        <div className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0"
                            style={{ backgroundColor: sectorColor(s.sector) }}>
                            {s.symbol.slice(0, 2)}
                          </div>
                          <div>
                            <p className="text-xs font-bold" style={{ color: 'var(--wv-text)' }}>{s.symbol}</p>
                            <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>{s.companyName}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] font-medium" style={{ color: 'var(--wv-text-secondary)' }}>{s.exchange}</p>
                          <p className="text-[10px]" style={{ color: sectorColor(s.sector) }}>{s.sector}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <FieldError msg={errors.stock} />

            {/* Selected stock info strip */}
            {selectedStock && (
              <div className="mt-3 p-3 rounded-xl flex items-center gap-3 relative"
                style={{ backgroundColor: 'rgba(27,42,74,0.04)', border: '1px solid rgba(27,42,74,0.10)' }}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                  style={{ backgroundColor: sectorColor(selectedStock.sector) }}>
                  {selectedStock.symbol.slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-bold" style={{ color: 'var(--wv-text)' }}>{selectedStock.companyName}</p>
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                      style={{ backgroundColor: sectorColor(selectedStock.sector) + '22', color: sectorColor(selectedStock.sector) }}>
                      {selectedStock.sector}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    <span className="text-[10px]" style={{ color: 'var(--wv-text-secondary)' }}>
                      {selectedStock.symbol} · {selectedStock.exchange} · {selectedStock.industry}
                    </span>
                    {selectedStock.isin && (
                      <span className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>ISIN: {selectedStock.isin}</span>
                    )}
                  </div>
                  {priceLoading ? (
                    <div className="flex items-center gap-1 mt-1">
                      <Loader2 className="w-3 h-3 animate-spin" style={{ color: '#C9A84C' }} />
                      <span className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>Fetching price…</span>
                    </div>
                  ) : stockPrice ? (
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-sm font-bold" style={{ color: 'var(--wv-text)' }}>
                        ₹{stockPrice.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                      </span>
                      <span className={`text-xs font-medium flex items-center gap-0.5`}
                        style={{ color: stockPrice.changePct >= 0 ? '#059669' : '#DC2626' }}>
                        {stockPrice.changePct >= 0
                          ? <TrendingUp className="w-3 h-3" />
                          : <TrendingDown className="w-3 h-3" />}
                        {stockPrice.changePct >= 0 ? '+' : ''}{stockPrice.changePct}%
                      </span>
                      <span className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>
                        H: ₹{stockPrice.dayHigh.toLocaleString('en-IN')} · L: ₹{stockPrice.dayLow.toLocaleString('en-IN')}
                      </span>
                    </div>
                  ) : null}
                </div>
                <button className="absolute top-2 right-2 p-1 rounded-full hover:bg-gray-100"
                  onClick={() => { setSelectedStock(null); setQuery(''); setStockPrice(null); }}>
                  <X className="w-3.5 h-3.5" style={{ color: 'var(--wv-text-muted)' }} />
                </button>
              </div>
            )}

            {/* Editable sector */}
            {selectedStock && (
              <div className="mt-3 space-y-1.5">
                <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>
                  Sector {selectedStock.sector && <AutoTag label="from search" />}
                </Label>
                <div className="flex gap-2">
                  <select
                    value={sectorOverride ?? selectedStock.sector ?? ''}
                    onChange={e => setSectorOverride(e.target.value)}
                    className="h-9 text-xs rounded-lg border px-2 flex-1"
                    style={{ borderColor: 'var(--wv-border)', color: 'var(--wv-text)', backgroundColor: 'var(--wv-surface)' }}>
                    <option value="">Select sector...</option>
                    {['IT', 'Banking', 'Pharma', 'Auto', 'FMCG', 'Energy', 'Metals', 'Chemicals',
                      'Industrials', 'Infrastructure', 'Real Estate', 'Media', 'Telecom', 'Textiles',
                      'Healthcare', 'Consumer Durables', 'Financial Services', 'Insurance', 'Cement',
                      'Capital Goods', 'Defense', 'Retail', 'Logistics', 'Other'].map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <Input
                    value={sectorOverride ?? selectedStock.sector ?? ''}
                    onChange={e => setSectorOverride(e.target.value)}
                    placeholder="Or type custom sector"
                    className="h-9 text-xs flex-1"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Step 3 — Transaction Details */}
          {selectedStock && (
            <div className="wv-card p-5">
              <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--wv-text-muted)' }}>
                Step 3 — Transaction Details
              </p>
            {preloadHoldingId && selectedStock && (
              <div className="mb-4 p-3 rounded-xl text-xs" style={{ backgroundColor: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.15)', color: '#92620A' }}>
                {isSellMode ? 'Selling shares of' : isDividendMode ? 'Recording dividend for' : isBuybackMode ? 'Recording buyback for' : 'Adding shares to'}: <strong>{selectedStock.companyName}</strong>
              </div>
            )}

              {/* Transaction type pills */}
              <div className="flex flex-wrap gap-2 mb-5">
                {TXN_TYPES.map(t => (
                  <button key={t.key}
                    onClick={() => { setTxnType(t.key); setErrors({}); }}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border"
                    style={{
                      backgroundColor: txnType === t.key ? '#1B2A4A' : 'transparent',
                      color:           txnType === t.key ? 'white'   : '#6B7280',
                      borderColor:     txnType === t.key ? '#1B2A4A' : 'var(--wv-border)',
                    }}>
                    {t.label}
                  </button>
                ))}
              </div>

              {/* ── Buy / Sell / Rights ─────────────────────────────────────── */}
              {(txnType === 'buy' || txnType === 'sell' || txnType === 'rights') && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Date</Label>
                      <Input
                        type="date" value={date} onChange={e => setDate(e.target.value)}
                        className="h-9 text-xs"
                      />
                      <FieldError msg={errors.date} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>
                        Quantity (shares)
                      </Label>
                      <Input
                        type="number" min="1" step="1"
                        value={quantity} onChange={e => setQuantity(e.target.value)}
                        placeholder="100" className="h-9 text-xs"
                      />
                      <FieldError msg={errors.quantity} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>
                        {txnType === 'sell' ? 'Sell' : txnType === 'rights' ? 'Rights'  : 'Buy'} Price (₹)
                        {priceLoaded && <AutoTag label="auto-fetched" />}
                      </Label>
                      <Input
                        type="number" step="0.01" min="0.01"
                        value={price} onChange={e => { setPrice(e.target.value); setPriceLoaded(false); setPriceManuallyEdited(true); }}
                        placeholder="e.g. 2850.00" className="h-9 text-xs"
                      />
                      <FieldError msg={errors.price} />
                    </div>
                  </div>

                  {/* ISIN auto-filled */}
                  {selectedStock.isin && (
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>
                        ISIN <AutoTag label="auto-filled" />
                      </Label>
                      <Input value={selectedStock.isin} readOnly className="h-8 text-xs font-mono bg-[#F7F5F0]" />
                    </div>
                  )}

                  {/* Charges */}
                  <div className="pt-3 border-t space-y-2.5" style={{ borderColor: '#F0EDE6' }}>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--wv-text-muted)' }}>Charges</p>
                      {value > 0 && (
                        <button onClick={applyAutoCharges}
                          className="text-[10px] px-2 py-0.5 rounded font-medium"
                          style={{ backgroundColor: 'rgba(201,168,76,0.1)', color: '#C9A84C' }}>
                          Auto-fill all charges
                        </button>
                      )}
                    </div>
                    <ChargeRow label="Brokerage (₹)" value={brokerage} onChange={setBrokerage} />
                    <ChargeRow label="STT (₹)" value={stt} onChange={setStt}
                      autoCalc={autoSTT.toFixed(2)} onAutoClick={() => setStt(autoSTT.toString())} />
                    <ChargeRow label="GST (₹)" value={gst} onChange={setGst}
                      autoCalc={autoGST.toFixed(2)} onAutoClick={() => setGst(autoGST.toString())} />
                    <ChargeRow label="Stamp Duty (₹)" value={stampDuty} onChange={setStampDuty}
                      autoCalc={autoStamp.toFixed(2)} onAutoClick={() => setStampDuty(autoStamp.toString())} />
                    <ChargeRow label="Exchange Charges (₹)" value={exchangeCharges} onChange={setExchangeCharges} />
                    <ChargeRow label="DP Charges (₹)" value={dpCharges} onChange={setDpCharges} />
                  </div>
                </div>
              )}

              {/* ── Bonus ──────────────────────────────────────────────────── */}
              {txnType === 'bonus' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Bonus Ratio</Label>
                      <Input value={bonusRatio} onChange={e => setBonusRatio(e.target.value)} placeholder="1:2 (1 bonus per 2 held)" className="h-9 text-xs" />
                      <FieldError msg={errors.bonusRatio} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Existing Quantity (your holdings)</Label>
                      <Input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="500" className="h-9 text-xs" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Record Date</Label>
                      <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-9 text-xs" />
                      <FieldError msg={errors.date} />
                    </div>
                  </div>
                  {bonusRatio && quantity && (() => {
                    const [num, den] = bonusRatio.split(':').map(Number);
                    const bonus = den > 0 ? Math.floor((parseFloat(quantity) / den) * num) : 0;
                    return bonus > 0 ? (
                      <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(5,150,105,0.06)', border: '1px solid rgba(5,150,105,0.15)' }}>
                        <p className="text-xs" style={{ color: '#059669' }}>
                          You will receive <strong>{bonus} bonus shares</strong> · Cost = ₹0 (lowers avg buy price)
                        </p>
                      </div>
                    ) : null;
                  })()}
                </div>
              )}

              {/* ── Split ──────────────────────────────────────────────────── */}
              {txnType === 'split' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Split Ratio (New : Old)</Label>
                      <Input value={splitRatio} onChange={e => setSplitRatio(e.target.value)} placeholder="5:1 (1 share → 5 shares)" className="h-9 text-xs" />
                      <FieldError msg={errors.splitRatio} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Existing Quantity</Label>
                      <Input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="100" className="h-9 text-xs" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Record Date</Label>
                      <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-9 text-xs" />
                      <FieldError msg={errors.date} />
                    </div>
                  </div>
                  {splitRatio && quantity && (() => {
                    const [num, den] = splitRatio.split(':').map(Number);
                    const factor = den > 0 ? num / den : 1;
                    const newQty = Math.round(parseFloat(quantity) * factor);
                    return (
                      <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(27,42,74,0.04)', border: '1px solid rgba(27,42,74,0.08)' }}>
                        <p className="text-xs" style={{ color: 'var(--wv-text)' }}>
                          {quantity} shares → <strong>{newQty} shares</strong> · Avg price adjusted by ÷{factor.toFixed(2)}
                        </p>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* ── Rights Issue ────────────────────────────────────────────── */}
              {txnType === 'rights' && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Rights Ratio</Label>
                    <Input value={rightsRatio} onChange={e => setRightsRatio(e.target.value)} placeholder="1:5 (1 right per 5 held)" className="h-9 text-xs" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Rights Issue Price (₹)</Label>
                    <Input type="number" step="0.01" value={rightsPrice} onChange={e => setRightsPrice(e.target.value)} placeholder="100.00" className="h-9 text-xs" />
                  </div>
                </div>
              )}

              {/* ── Dividend ────────────────────────────────────────────────── */}
              {txnType === 'dividend' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Dividend per Share (₹)</Label>
                      <Input type="number" step="0.01" value={divPerShare} onChange={e => setDivPerShare(e.target.value)} placeholder="5.00" className="h-9 text-xs" />
                      <FieldError msg={errors.divPerShare} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Dividend Type</Label>
                      <Select value={divType} onValueChange={setDivType}>
                        <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {['Interim','Final','Special'].map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Ex-Dividend Date</Label>
                      <Input type="date" value={exDate} onChange={e => setExDate(e.target.value)} className="h-9 text-xs" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Payment Date</Label>
                      <Input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} className="h-9 text-xs" />
                    </div>
                  </div>
                  {divPerShare && (
                    <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(5,150,105,0.06)', border: '1px solid rgba(5,150,105,0.15)' }}>
                      <p className="text-xs" style={{ color: '#059669' }}>
                        {divType} dividend of ₹{divPerShare}/share
                        {stockPrice ? ` · Yield ≈ ${((parseFloat(divPerShare) / stockPrice.price) * 100).toFixed(2)}%` : ''}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* ── Buyback ──────────────────────────────────────────────── */}
              {txnType === 'buyback' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Shares Tendered</Label>
                      <Input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="100" className="h-9 text-xs" />
                      <FieldError msg={errors.quantity} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Shares Accepted</Label>
                      <Input type="number" value={sharesAccepted} onChange={e => setSharesAccepted(e.target.value)} placeholder="Same as tendered if full acceptance" className="h-9 text-xs" />
                      <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>Leave blank if fully accepted</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Buyback Price ({'\u20B9'})</Label>
                      <Input type="number" step="0.01" value={buybackPrice} onChange={e => setBuybackPrice(e.target.value)} placeholder="500.00" className="h-9 text-xs" />
                      <FieldError msg={errors.buybackPrice} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Record Date</Label>
                      <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-9 text-xs" />
                      <FieldError msg={errors.date} />
                    </div>
                  </div>
                  {buybackPrice && quantity && (() => {
                    const accepted = parseFloat(sharesAccepted) || parseFloat(quantity);
                    const bp = parseFloat(buybackPrice);
                    const proceeds = accepted * bp;
                    return (
                      <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(5,150,105,0.06)', border: '1px solid rgba(5,150,105,0.15)' }}>
                        <p className="text-xs" style={{ color: '#059669' }}>
                          Buyback proceeds: <strong>{'\u20B9'}{proceeds.toLocaleString('en-IN')}</strong> ({accepted} shares @ {'\u20B9'}{bp})
                          {stockPrice ? ` \u00B7 vs CMP \u20B9${stockPrice.price}: ${bp > stockPrice.price ? 'Premium' : 'Discount'} of ${Math.abs(((bp - stockPrice.price) / stockPrice.price) * 100).toFixed(1)}%` : ''}
                        </p>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* ── Received via Merger/Acquisition ─────────────────────── */}
              {txnType === 'merger_in' && (
                <div className="space-y-4">
                  <div className="p-3 rounded-xl text-xs" style={{ backgroundColor: 'rgba(147,51,234,0.06)', border: '1px solid rgba(147,51,234,0.15)', color: '#7C3AED' }}>
                    Use this when the acquired company is delisted and you received shares of the acquiring company.
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5 col-span-2">
                      <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Shares Received (new stock) *</Label>
                      <Input type="number" step="0.0001" min="0.0001" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="e.g. 80.11" className="h-9 text-xs" />
                      <FieldError msg={errors.quantity} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Date Received *</Label>
                      <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-9 text-xs" />
                      <FieldError msg={errors.date} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Original Company Name *</Label>
                      <Input value={originalCompany} onChange={e => setOriginalCompany(e.target.value)} placeholder="e.g. SilverCrest Metals" className="h-9 text-xs" />
                      <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>May be delisted — just type the name</p>
                      <FieldError msg={errors.originalCompany} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Original Shares Held</Label>
                      <Input type="number" step="0.0001" min="0" value={originalShares} onChange={e => setOriginalShares(e.target.value)} placeholder="e.g. 50" className="h-9 text-xs" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Original Cost Basis (₹) *</Label>
                      <Input type="number" step="0.01" min="0.01" value={originalCostBasis} onChange={e => setOriginalCostBasis(e.target.value)} placeholder="e.g. 150000" className="h-9 text-xs" />
                      <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>Total amount originally invested</p>
                      <FieldError msg={errors.originalCostBasis} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Cash Component per Share (₹)</Label>
                      <Input type="number" step="0.01" min="0" value={mergerCashComponent} onChange={e => setMergerCashComponent(e.target.value)} placeholder="0.00" className="h-9 text-xs" />
                      <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>If M&A includes cash + shares</p>
                    </div>
                  </div>
                  {/* Preview */}
                  {quantity && originalCostBasis && (() => {
                    const sharesRec = parseFloat(quantity) || 0;
                    const cost = parseFloat(originalCostBasis) || 0;
                    const cashPerSh = parseFloat(mergerCashComponent || '0');
                    const origSh = parseFloat(originalShares || '0');
                    const cashTotal = cashPerSh * origSh;
                    const transferred = cost - cashTotal;
                    const avgPx = sharesRec > 0 ? transferred / sharesRec : 0;
                    return transferred > 0 ? (
                      <div className="p-3 rounded-xl space-y-1" style={{ backgroundColor: 'rgba(147,51,234,0.06)', border: '1px solid rgba(147,51,234,0.12)' }}>
                        <p className="text-xs" style={{ color: '#7C3AED' }}>
                          {origSh > 0 ? `${origSh} shares of ${originalCompany || '?'} → ` : ''}<strong>{sharesRec} shares</strong> of {selectedStock?.companyName}
                        </p>
                        <p className="text-[10px]" style={{ color: 'var(--wv-text-secondary)' }}>
                          Cost basis transferred: ₹{transferred.toLocaleString('en-IN')} · Avg price: ₹{avgPx.toFixed(2)}/share
                          {cashTotal > 0 ? ` · Cash received: ₹${cashTotal.toLocaleString('en-IN')}` : ''}
                        </p>
                      </div>
                    ) : null;
                  })()}
                </div>
              )}

              {/* ── Received via Demerger/Spin-off ────────────────────────── */}
              {txnType === 'demerger_in' && (
                <div className="space-y-4">
                  <div className="p-3 rounded-xl text-xs" style={{ backgroundColor: 'rgba(147,51,234,0.06)', border: '1px solid rgba(147,51,234,0.15)', color: '#7C3AED' }}>
                    Use this when you received shares from a demerger/spin-off. The parent company may or may not still be listed.
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5 col-span-2">
                      <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Shares Received (new/spun-off stock) *</Label>
                      <Input type="number" step="0.0001" min="0.0001" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="e.g. 50" className="h-9 text-xs" />
                      <FieldError msg={errors.quantity} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Date *</Label>
                      <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-9 text-xs" />
                      <FieldError msg={errors.date} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Parent Company Name *</Label>
                      <Input value={parentCompany} onChange={e => setParentCompany(e.target.value)} placeholder="e.g. Reliance Industries" className="h-9 text-xs" />
                      <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>May or may not still be listed</p>
                      <FieldError msg={errors.parentCompany} />
                    </div>
                    <div className="space-y-1.5 col-span-2">
                      <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Cost Basis Allocated (₹) *</Label>
                      <Input type="number" step="0.01" min="0.01" value={costBasisAllocated} onChange={e => setCostBasisAllocated(e.target.value)} placeholder="e.g. 50000" className="h-9 text-xs" />
                      <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>Portion of original cost allocated to this demerger (per company announcement)</p>
                      <FieldError msg={errors.costBasisAllocated} />
                    </div>
                  </div>
                  {/* Preview */}
                  {quantity && costBasisAllocated && (() => {
                    const sharesRec = parseFloat(quantity) || 0;
                    const allocated = parseFloat(costBasisAllocated) || 0;
                    const avgPx = sharesRec > 0 ? allocated / sharesRec : 0;
                    return allocated > 0 ? (
                      <div className="p-3 rounded-xl space-y-1" style={{ backgroundColor: 'rgba(147,51,234,0.06)', border: '1px solid rgba(147,51,234,0.12)' }}>
                        <p className="text-xs" style={{ color: '#7C3AED' }}>
                          <strong>{sharesRec} shares</strong> of {selectedStock?.companyName} from demerger of {parentCompany || '?'}
                        </p>
                        <p className="text-[10px]" style={{ color: 'var(--wv-text-secondary)' }}>
                          Cost basis allocated: ₹{allocated.toLocaleString('en-IN')} · Avg price: ₹{avgPx.toFixed(2)}/share
                        </p>
                      </div>
                    ) : null;
                  })()}
                </div>
              )}

              {/* Summary strip for Buy/Sell */}
              {(txnType === 'buy' || txnType === 'sell') && qty > 0 && px > 0 && (
                <div className="mt-4 p-3 rounded-xl grid grid-cols-4 gap-3"
                  style={{ backgroundColor: 'rgba(27,42,74,0.04)', border: '1px solid rgba(27,42,74,0.08)' }}>
                  <div>
                    <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>
                      {txnType === 'buy' ? 'Invested' : 'Sale Value'}
                    </p>
                    <p className="text-xs font-bold" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(value)}</p>
                  </div>
                  <div>
                    <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>Total Charges</p>
                    <p className="text-xs font-bold" style={{ color: 'var(--wv-text)' }}>₹{totalFees.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>
                      {txnType === 'buy' ? 'Total Cost' : 'Net Proceeds'}
                    </p>
                    <p className="text-xs font-bold" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(txnType === 'buy' ? totalCost : value - totalFees)}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Holder details are managed at the Distributor (broker) level */}
          {selectedStock && (
            <div className="px-4 py-3 rounded-xl flex items-center gap-2 text-xs"
              style={{ backgroundColor: 'var(--wv-surface-2)', border: '1px solid var(--wv-border)' }}>
              <User className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--wv-text-muted)' }} />
              <span style={{ color: 'var(--wv-text-secondary)' }}>Holder &amp; demat details are managed per distributor.</span>
              <button
                type="button"
                onClick={() => router.push('/settings?tab=distributors')}
                className="ml-1 text-[11px] font-semibold underline-offset-2 hover:underline"
                style={{ color: '#C9A84C' }}>
                Edit in Settings →
              </button>
            </div>
          )}

          {/* Action buttons */}
          {selectedStock && (
            <div className="flex gap-3">
              <Button onClick={() => handleSave(false)} disabled={saving} className="flex-1 h-10 text-xs font-semibold"
                style={{ backgroundColor: '#C9A84C', color: 'var(--wv-text)' }}>
                {saving ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Saving…</> : `Save ${saveLabel}`}
              </Button>
              <Button onClick={() => handleSave(true)} disabled={saving} className="flex-1 h-10 text-xs font-semibold text-white"
                style={{ backgroundColor: '#1B2A4A' }}>
                Save &amp; Add Another
              </Button>
              <Button variant="outline" className="h-10 text-xs px-4" style={{ borderColor: 'var(--wv-border)', color: 'var(--wv-text-secondary)' }}
                onClick={() => router.back()}>
                Cancel
              </Button>
            </div>
          )}
        </TabsContent>

        {/* ── Tab 2: Import ─────────────────────────────────────────────────── */}
        <TabsContent value="import">
          <div className="wv-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--wv-text-muted)' }}>
              Import Contract Note / Trade Statement
            </p>
            <div className="grid grid-cols-2 gap-3 mb-5">
              {['Zerodha Tradebook CSV','Groww Trade Report','Angel One Report','ICICI Direct CAS','HDFC Securities','Upstox Trade Report'].map(fmt => (
                <div key={fmt} className="p-3 rounded-xl border flex items-center gap-2" style={{ borderColor: 'var(--wv-border)' }}>
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: '#C9A84C' }} />
                  <span className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>{fmt}</span>
                </div>
              ))}
            </div>
            <div className="p-4 rounded-xl border flex flex-col items-center gap-2 mb-4"
              style={{ borderColor: 'rgba(201,168,76,0.3)', backgroundColor: 'rgba(201,168,76,0.04)' }}>
              <Building2 className="w-8 h-8" style={{ color: '#C9A84C' }} />
              <p className="text-sm font-semibold" style={{ color: '#C9A84C' }}>Coming Soon</p>
              <p className="text-xs text-center" style={{ color: 'var(--wv-text-muted)' }}>
                Upload your broker tradebook CSV or contract note PDF.<br />
                We&apos;ll parse and auto-map all your transactions.
              </p>
            </div>
            <label className="flex flex-col items-center justify-center w-full h-32 rounded-xl border-2 border-dashed cursor-not-allowed opacity-50"
              style={{ borderColor: 'var(--wv-border)' }}>
              <Upload className="w-7 h-7 mb-2" style={{ color: 'var(--wv-text-muted)' }} />
              <p className="text-sm font-medium" style={{ color: 'var(--wv-text-secondary)' }}>Upload statement</p>
              <p className="text-xs mt-1" style={{ color: 'var(--wv-text-muted)' }}>.xlsx, .csv, .pdf</p>
            </label>
          </div>
        </TabsContent>

        {/* ── Tab 3: Broker Sync ─────────────────────────────────────────────── */}
        <TabsContent value="sync">
          <div className="wv-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--wv-text-muted)' }}>
              Broker API Sync
            </p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { name: 'Zerodha Kite',   color: '#387ED1', letter: 'Z', status: 'Soon' },
                { name: 'Groww',          color: '#00D09C', letter: 'G', status: 'Soon' },
                { name: 'Angel One',      color: '#DC2626', letter: 'A', status: 'Soon' },
                { name: 'ICICI Direct',   color: '#FF6600', letter: 'I', status: 'Soon' },
                { name: 'HDFC Securities',color: '#003087', letter: 'H', status: 'Soon' },
                { name: 'Upstox',         color: '#5D47D4', letter: 'U', status: 'Soon' },
              ].map(api => (
                <div key={api.name} className="p-4 rounded-xl border" style={{ borderColor: 'var(--wv-border)' }}>
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
                      style={{ backgroundColor: api.color }}>
                      {api.letter}
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: '#F5EDD6', color: '#C9A84C' }}>
                      Coming Soon
                    </span>
                  </div>
                  <p className="text-xs font-semibold mb-3" style={{ color: 'var(--wv-text)' }}>{api.name}</p>
                  <Button disabled className="w-full h-7 text-[11px]"
                    style={{ backgroundColor: 'var(--wv-surface-2)', color: 'var(--wv-text-muted)' }}>
                    Connect
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Page wrapper with Suspense ────────────────────────────────────────────────

export default function IndianStocksPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#C9A84C' }} />
      </div>
    }>
      <IndianStocksFormContent />
    </Suspense>
  );
}
