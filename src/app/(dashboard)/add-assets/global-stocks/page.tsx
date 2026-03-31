'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input }  from '@/components/ui/input';
import { Label }  from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Globe, TrendingUp, TrendingDown, Upload, Link as LinkIcon, Check, ChevronDown,
  Loader2, AlertCircle, X, User, Building2, Search,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR } from '@/lib/utils/formatters';
import { holdingsCacheClearAll } from '@/lib/utils/holdings-cache';
import { BrokerSelector } from '@/components/forms/BrokerSelector';
import { PortfolioSelector } from '@/components/forms/PortfolioSelector';

// ─── Types ────────────────────────────────────────────────────────────────────

interface GlobalStockResult {
  symbol: string;
  companyName: string;
  exchange: string;
  country: string;
  currency: string;
  sector: string;
}

interface GlobalStockPrice {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  dayHigh: number;
  dayLow: number;
  currency: string;
  lastUpdated: string;
}

interface FxRate {
  from: string;
  to: string;
  rate: number;
  date: string;
}

interface FamilyMember { id: string; name: string }
interface Toast        { type: 'success' | 'error'; message: string }

// ─── Constants ────────────────────────────────────────────────────────────────

const TXN_TYPES = [
  { key: 'buy',      label: 'Buy' },
  { key: 'sell',     label: 'Sell' },
  { key: 'dividend', label: 'Dividend' },
];

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', JPY: '¥', HKD: 'HK$',
  AUD: 'A$', KRW: '₩', SGD: 'S$', CHF: 'CHF', CAD: 'C$',
};

const COUNTRY_FLAGS: Record<string, string> = {
  'US': '🇺🇸', 'UK': '🇬🇧', 'Germany': '🇩🇪',
  'Japan': '🇯🇵', 'Hong Kong': '🇭🇰', 'Australia': '🇦🇺',
  'South Korea': '🇰🇷', 'India': '🇮🇳', 'China': '🇨🇳',
  'France': '🇫🇷', 'Netherlands': '🇳🇱', 'Switzerland': '🇨🇭',
  'Denmark': '🇩🇰', 'Singapore': '🇸🇬', 'Brazil': '🇧🇷',
};

const DEFAULT_WITHHOLDING_TAX: Record<string, number> = {
  USD: 25, EUR: 15, GBP: 0, JPY: 15, HKD: 0,
  AUD: 30, KRW: 22, SGD: 0, CHF: 35, CAD: 25,
};

function currencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code] ?? code;
}

function countryFlag(country: string): string {
  return COUNTRY_FLAGS[country] ?? '';
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

// ─── Main Form Content ─────────────────────────────────────────────────────────

function GlobalStocksFormContent() {
  const router   = useRouter();
  const supabase = createClient();
  const _searchParams = useSearchParams();

  // Mode detection from URL params
  const editTxnId = _searchParams.get('edit_txn');
  const editHoldingId = _searchParams.get('holding_id');
  const isEditMode = !!editTxnId && !!editHoldingId;
  const addToHoldingId = _searchParams.get('add_to');
  const sellHoldingId = _searchParams.get('sell');
  const dividendHoldingId = _searchParams.get('dividend');
  const _isAddMoreMode = !!addToHoldingId && !isEditMode;
  const isSellMode = !!sellHoldingId;
  const isDividendMode = !!dividendHoldingId;
  const preloadHoldingId = addToHoldingId || sellHoldingId || dividendHoldingId;

  // Family/member prefill from sessionStorage (set by portfolio page before navigation)
  const prefillFamily = typeof window !== 'undefined' ? sessionStorage.getItem('wv_prefill_family') : null;
  const prefillMember = typeof window !== 'undefined' ? sessionStorage.getItem('wv_prefill_member') : null;
  const prefillActive = typeof window !== 'undefined' ? sessionStorage.getItem('wv_prefill_active') === 'true' : false;
  if (typeof window !== 'undefined') {
    // Always clear so future visits aren't affected
    sessionStorage.removeItem('wv_prefill_family');
    sessionStorage.removeItem('wv_prefill_member');
    sessionStorage.removeItem('wv_prefill_active');
  }
  console.log('=== ADD PAGE INIT ===', { prefillFamily, prefillMember, prefillActive });
  // Also check URL params as fallback
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
  const [query,         setQuery]         = useState('');
  const [searching,     setSearching]     = useState(false);
  const [results,       setResults]       = useState<GlobalStockResult[]>([]);
  const [showDrop,      setShowDrop]      = useState(false);
  const [selectedStock, setSelectedStock] = useState<GlobalStockResult | null>(null);
  const [stockPrice,    setStockPrice]    = useState<GlobalStockPrice | null>(null);
  const [priceLoading,  setPriceLoading]  = useState(false);
  const [sectorOverride, setSectorOverride] = useState<string | null>(null);
  const [fxRate,        setFxRate]        = useState<FxRate | null>(null);
  const [fxLoading,     setFxLoading]     = useState(false);

  // Transaction type
  const [txnType, setTxnType] = useState<string>('buy');

  // Buy / Sell fields
  const [quantity,    setQuantity]    = useState('');
  const [price,       setPrice]       = useState('');
  const [date,        setDate]        = useState('');
  const [priceLoaded, setPriceLoaded] = useState(false);
  const [priceManuallyEdited, setPriceManuallyEdited] = useState(false);
  const [fxRateValue, setFxRateValue] = useState('');
  const [fxRateLoaded, setFxRateLoaded] = useState(false);

  // Charges
  const [brokerage, setBrokerage] = useState('0');
  const [notes,     setNotes]     = useState('');

  // Dividend fields
  const [exDate,          setExDate]          = useState('');
  const [payDate,         setPayDate]         = useState('');
  const [divPerShare,     setDivPerShare]     = useState('');
  const [withholdingTax,  setWithholdingTax]  = useState('25');
  const [divFxRate,       setDivFxRate]       = useState('');
  const [divFxRateLoaded, setDivFxRateLoaded] = useState(false);

  // UI state
  const [saving,  setSaving]  = useState(false);
  const [toast,   setToast]   = useState<Toast | null>(null);
  const [errors,  setErrors]  = useState<Record<string, string>>({});

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stays TRUE permanently when prefill/URL params specified family/member — prevents any overwrite
  const prefillLockedRef = useRef(hasPrefill);
  // Store the target member ID permanently so it can be re-applied when members list loads
  const targetMemberRef = useRef(urlMemberId || '');

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
      setSelectedStock({
        symbol: holdingData.symbol,
        companyName: holdingData.name,
        exchange: String(meta.exchange ?? ''),
        currency: String(meta.currency ?? 'USD'),
        sector: String(meta.sector ?? ''),
        country: String(meta.country ?? ''),
      });
      setQuery(`${holdingData.symbol} — ${holdingData.name}`);

      // Set transaction type based on mode
      if (isSellMode) setTxnType('sell');
      else if (isDividendMode) setTxnType('dividend');
      else setTxnType('buy');

      // ALWAYS set family/member from the holding's portfolio record (database truth)
      if (holdingData.portfolios) {
        const p = holdingData.portfolios as unknown as { name: string; family_id: string; user_id: string };
        console.log('=== HOLDING PRELOAD ===', { family_id: p.family_id, user_id: p.user_id, portfolio: p.name });
        setPortfolioName(p.name);
        if (p.family_id) {
          setSelectedFamily(p.family_id);
          setFamilyId(p.family_id);
        }
        if (p.user_id) {
          setMember(p.user_id);
          targetMemberRef.current = p.user_id;
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

      const hasUrlOverride = prefillLockedRef.current;
      const fid = profile.family_id;
      console.log('=== LOAD USER/FAMILY ===', { hasUrlOverride, profileId: profile.id, profileFamilyId: fid });

      // Only set member default if no prefill/holding override active
      if (!hasUrlOverride) setMember(profile.id);
      if (fid) {
        if (!hasUrlOverride) {
          setFamilyId(fid);
          setSelectedFamily(fid);
        }

        // Load members for the active family (URL override or default)
        const activeFamilyId = hasUrlOverride ? (urlFamilyId || fid) : fid;
        const { data: fUsers } = await supabase.from('users').select('id, name').eq('family_id', activeFamilyId);
        if (fUsers && fUsers.length > 0) {
          setMembers(fUsers);
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

          // If URL override family is set but not in the list, add it
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
    prefillLockedRef.current = false; // user is manually changing — unlock
    setSelectedFamily(fid);
  }
  useEffect(() => {
    if (!selectedFamily) return;
    setFamilyId(selectedFamily);
    (async () => {
      const { data: fUsers } = await supabase.from('users').select('id, name').eq('family_id', selectedFamily);
      setMembers(fUsers ?? []);
      const target = targetMemberRef.current;
      const targetInList = target && fUsers?.find(m => m.id === target);
      console.log('=== FAMILY CHANGE EFFECT ===', { selectedFamily, locked: prefillLockedRef.current, target, targetInList: !!targetInList, membersLoaded: fUsers?.length });
      if (targetInList) {
        // Re-apply the target member (from sessionStorage/holding preload)
        setMember(target);
      } else if (!prefillLockedRef.current && fUsers?.length) {
        // User manually changed family — pick first member
        setMember(fUsers[0].id);
      }
    })();
  }, [selectedFamily]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-set today for date ─────────────────────────────────────────────────
  useEffect(() => {
    if (!isEditMode) {
      setDate(new Date().toISOString().split('T')[0]);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load existing transaction for edit mode ───────────────────────────────
  useEffect(() => {
    if (!isEditMode) return;
    (async () => {
      const supabase = createClient();
      // Load the transaction
      const { data: txn } = await supabase
        .from('transactions')
        .select('id, type, quantity, price, date, fees, notes, metadata')
        .eq('id', editTxnId)
        .single();
      if (!txn) return;

      // Load the holding for stock info
      const { data: holdingData } = await supabase
        .from('holdings')
        .select('symbol, name, metadata, brokers(id, name), portfolios(name)')
        .eq('id', editHoldingId)
        .single();
      if (!holdingData) return;

      // Pre-fill form fields
      const meta = (txn.metadata ?? {}) as Record<string, unknown>;
      const holdingMeta = (holdingData.metadata ?? {}) as Record<string, unknown>;

      // Set stock info
      setSelectedStock({
        symbol: holdingData.symbol,
        companyName: holdingData.name,
        exchange: String(holdingMeta.exchange ?? ''),
        currency: String(holdingMeta.currency ?? 'USD'),
        sector: String(holdingMeta.sector ?? ''),
        country: String(holdingMeta.country ?? ''),
      });
      setQuery(holdingData.name);

      // Set transaction type
      setTxnType(txn.type === 'dividend' ? 'dividend' : txn.type === 'sell' ? 'sell' : 'buy');

      // Set transaction fields
      setQuantity(String(txn.quantity || ''));
      setPrice(String(txn.price || ''));
      setDate(txn.date || '');
      setFxRateValue(String(meta.fx_rate || ''));
      setBrokerage(String(meta.brokerage || txn.fees || '0'));
      setNotes(txn.notes || '');

      // Set portfolio
      if (holdingData.portfolios) {
        const portfolio = holdingData.portfolios as unknown as { name: string };
        setPortfolioName(portfolio.name);
      }

      // Set broker
      if (holdingData.brokers) {
        const broker = holdingData.brokers as unknown as { id: string };
        setBrokerId(broker.id);
      }

      // For dividend fields
      if (txn.type === 'dividend') {
        if (meta.ex_date) setExDate(String(meta.ex_date));
        if (meta.payment_date) setPayDate(String(meta.payment_date));
        if (meta.dividend_per_share) setDivPerShare(String(meta.dividend_per_share));
        if (meta.withholding_tax) setWithholdingTax(String(meta.withholding_tax));
        if (meta.div_fx_rate) setDivFxRate(String(meta.div_fx_rate));
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
        const res = await fetch(`/api/stocks/global/search?q=${encodeURIComponent(query)}`);
        if (!res.ok) { console.error('[Global Stocks Search] HTTP', res.status, res.url); setSearching(false); return; }
        const { results: r } = await res.json();
        setResults(r ?? []);
        setShowDrop(true);
      } catch (err) { console.error('[Global Stocks Search] fetch error:', err); setResults([]); }
      setSearching(false);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  // ── Auto-fetch historical price + FX rate on date change ──────────────────
  // Only auto-fill price if user hasn't manually edited it
  useEffect(() => {
    if (!selectedStock || !date) return;
    if (isEditMode) return; // in edit mode, price comes from saved transaction

    if (!priceManuallyEdited) {
      setPriceLoaded(false);
      fetch(`/api/stocks/global/price-history?symbol=${encodeURIComponent(selectedStock.symbol)}&date=${date}`)
        .then(r => r.json())
        .then(d => {
          if (d.price) {
            setPrice(d.price.toFixed(2));
            setPriceLoaded(true);
          }
        })
        .catch(() => {/* silent */});
    }

    // FX rate auto-fetch is always OK (less likely to be manually edited)
    if (selectedStock.currency && selectedStock.currency !== 'INR') {
      setFxRateLoaded(false);
      fetch(`/api/fx/rate/history?from=${selectedStock.currency}&to=INR&date=${date}`)
        .then(r => r.json())
        .then(d => {
          if (d.rate) {
            setFxRateValue(d.rate.toFixed(4));
            setFxRateLoaded(true);
          }
        })
        .catch(() => {/* silent */});
    }
  }, [selectedStock, date, priceManuallyEdited, isEditMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-fetch FX rate on dividend payment date change ─────────────────────
  useEffect(() => {
    if (!selectedStock || !payDate || txnType !== 'dividend') return;
    if (selectedStock.currency && selectedStock.currency !== 'INR') {
      setDivFxRateLoaded(false);
      fetch(`/api/fx/rate/history?from=${selectedStock.currency}&to=INR&date=${payDate}`)
        .then(r => r.json())
        .then(d => {
          if (d.rate) {
            setDivFxRate(d.rate.toFixed(2));
            setDivFxRateLoaded(true);
          }
        })
        .catch(() => {/* silent */});
    }
  }, [selectedStock, payDate, txnType]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Set default withholding tax when stock is selected ─────────────────────
  useEffect(() => {
    if (selectedStock?.currency) {
      const defaultTax = DEFAULT_WITHHOLDING_TAX[selectedStock.currency] ?? 25;
      setWithholdingTax(defaultTax.toString());
    }
  }, [selectedStock?.currency]);

  // ── Auto-calculations ─────────────────────────────────────────────────────
  const qty       = parseFloat(quantity)    || 0;
  const px        = parseFloat(price)       || 0;
  const fx        = parseFloat(fxRateValue) || 0;
  const valueLocal = qty * px;
  const brokerageNum = parseFloat(brokerage || '0') || 0;
  const totalLocalCost = valueLocal + brokerageNum; // local amount including all charges
  const valueINR   = totalLocalCost * fx; // INR invested = (qty × price + charges) × FX rate

  // Dividend calculations
  const divPS       = parseFloat(divPerShare)    || 0;
  const divTaxPct   = parseFloat(withholdingTax) || 0;
  const divFx       = parseFloat(divFxRate)      || 0;
  const grossDiv    = qty * divPS;
  const netDivLocal = grossDiv * (1 - divTaxPct / 100);
  const netDivINR   = netDivLocal * divFx;

  // ── Select stock ────────────────────────────────────────────────────────────
  async function selectStock(stock: GlobalStockResult) {
    setSelectedStock(stock);
    setQuery(`${stock.symbol} — ${stock.companyName}`);
    setShowDrop(false);

    // Fetch live price
    setPriceLoading(true);
    try {
      const res = await fetch(`/api/stocks/global/price?symbol=${encodeURIComponent(stock.symbol)}`);
      const data = await res.json();
      setStockPrice(data);
    } catch { setStockPrice(null); }
    setPriceLoading(false);

    // Fetch live FX rate
    if (stock.currency && stock.currency !== 'INR') {
      setFxLoading(true);
      try {
        const res = await fetch(`/api/fx/rate?from=${stock.currency}&to=INR`);
        const data = await res.json();
        setFxRate(data);
        if (data.rate) {
          setFxRateValue(data.rate.toFixed(4));
        }
      } catch { setFxRate(null); }
      setFxLoading(false);
    }
  }

  // ── Validate ────────────────────────────────────────────────────────────────
  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!selectedStock) errs.stock    = 'Select a stock';
    if (!portfolioName) errs.portfolio = 'Select or create a portfolio';

    if (txnType === 'buy' || txnType === 'sell') {
      if (!quantity || qty <= 0) errs.quantity = 'Enter a valid quantity';
      if (!price    || px  <= 0) errs.price    = 'Enter a valid price';
      if (!fxRateValue || fx <= 0) errs.fxRate = 'Enter a valid FX rate';
      if (!date) errs.date = 'Enter a date';
    }

    if (txnType === 'dividend') {
      if (!divPerShare || divPS <= 0) errs.divPerShare = 'Enter dividend per share';
      if (!exDate) errs.exDate = 'Enter ex-dividend date';
      if (!payDate) errs.payDate = 'Enter payment date';
      if (!divFxRate || divFx <= 0) errs.divFxRate = 'Enter FX rate on payment date';
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Save ────────────────────────────────────────────────────────────────────
  async function handleSave(andAnother = false) {
    if (!validate()) return;
    setSaving(true);

    try {

      const body: Record<string, unknown> = {
        symbol:          selectedStock!.symbol,
        companyName:     selectedStock!.companyName,
        exchange:        selectedStock!.exchange,
        country:         selectedStock!.country,
        currency:        selectedStock!.currency,
        sector:          (sectorOverride && sectorOverride !== '__other__') ? sectorOverride : selectedStock!.sector,
        transactionType: txnType,
        quantity:        qty,
        price:           px,
        date,
        fxRate:          fx,
        valueLocal:      valueLocal,
        valueINR:        valueINR,
        brokerage:       brokerageNum,
        notes,
        portfolioName:   portfolioName,
        brokerId,
        memberId:        member,
        currentPrice:    stockPrice?.price ?? null,
        currentFxRate:   fxRate?.rate ?? null,
      };

      // Add dividend-specific fields
      if (txnType === 'dividend') {
        body.exDate           = exDate;
        body.paymentDate      = payDate;
        body.dividendPerShare = divPS;
        body.withholdingTaxPct = divTaxPct;
        body.grossDividend    = grossDiv;
        body.netDividendLocal = netDivLocal;
        body.netDividendINR   = netDivINR;
        body.divFxRate        = divFx;
      }

      if (isEditMode) {
        // Edit mode: update existing transaction
        const updateBody: Record<string, unknown> = {
          txn_id: editTxnId,
          holding_id: editHoldingId,
          quantity: qty,
          price: px,
          date,
          fees: brokerageNum,
          notes,
          metadata: {
            fx_rate: fx,
            currency: selectedStock!.currency,
            price_local: valueLocal,
            brokerage: brokerageNum,
          },
        };

        // Add dividend-specific metadata
        if (txnType === 'dividend') {
          (updateBody.metadata as Record<string, unknown>).ex_date = exDate;
          (updateBody.metadata as Record<string, unknown>).payment_date = payDate;
          (updateBody.metadata as Record<string, unknown>).dividend_per_share = divPS;
          (updateBody.metadata as Record<string, unknown>).withholding_tax = divTaxPct;
          (updateBody.metadata as Record<string, unknown>).gross_dividend = grossDiv;
          (updateBody.metadata as Record<string, unknown>).net_dividend_local = netDivLocal;
          (updateBody.metadata as Record<string, unknown>).net_dividend_inr = netDivINR;
          (updateBody.metadata as Record<string, unknown>).div_fx_rate = divFx;
        }

        const res = await fetch('/api/stocks/global/update-transaction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updateBody),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Update failed');

        setToast({ type: 'success', message: 'Transaction updated successfully!' });
        holdingsCacheClearAll();
        setTimeout(() => router.back(), 1200);
      } else {
        // Normal mode: create new transaction
        const res = await fetch('/api/stocks/global/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Save failed');

        setToast({
          type: 'success',
          message: `Stock saved successfully!${data.consolidated ? ' (Consolidated with existing holding)' : ''}`,
        });
        holdingsCacheClearAll();

        if (andAnother) {
          resetForm();
        } else {
          setTimeout(() => router.push('/portfolio/global-stocks'), 1200);
        }
      }
    } catch (e) {
      setToast({ type: 'error', message: (e as Error).message });
    }
    setSaving(false);
  }

  function resetForm() {
    setSelectedStock(null); setQuery(''); setStockPrice(null);
    setFxRate(null); setFxRateValue(''); setFxRateLoaded(false);
    setQuantity(''); setPrice(''); setPriceLoaded(false); setPriceManuallyEdited(false);
    setBrokerage('0'); setNotes('');
    setDivPerShare(''); setExDate(''); setPayDate('');
    setWithholdingTax('25'); setDivFxRate(''); setDivFxRateLoaded(false);
    setSectorOverride(null);
    setErrors({});
    setDate(new Date().toISOString().split('T')[0]);
  }


  // ── Helper: format local currency ─────────────────────────────────────────
  const stockCurrency = selectedStock?.currency ?? 'USD';
  const cSymbol = currencySymbol(stockCurrency);

  function fmtLocal(amount: number): string {
    return `${cSymbol}${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function fmtINR(amount: number): string {
    return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  }

  function formatDateLabel(dateStr: string): string {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-2xl mx-auto">

      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: 'rgba(37,99,235,0.08)' }}>
          <Globe className="w-5 h-5" style={{ color: '#2563eb' }} />
        </div>
        <div>
          <h1 className="font-display text-xl font-semibold" style={{ color: '#1A1A2E' }}>{isEditMode ? 'Edit Transaction' : 'Add Global Stocks'}</h1>
          <p className="text-xs" style={{ color: '#9CA3AF' }}>{isEditMode ? 'Update the details of this transaction' : 'Track international equity & ETF holdings across all exchanges'}</p>
        </div>
      </div>

      {toast && <ToastBanner toast={toast} onClose={() => setToast(null)} />}

      <Tabs defaultValue="manual">
        <TabsList className="mb-5 w-full" style={{ backgroundColor: '#F7F5F0', border: '1px solid #E8E5DD' }}>
          <TabsTrigger value="manual" className="flex-1 gap-1.5 text-xs data-[state=active]:bg-white">
            <Globe className="w-3.5 h-3.5" />Manual Entry
          </TabsTrigger>
          <TabsTrigger value="import" className="flex-1 gap-1.5 text-xs data-[state=active]:bg-white">
            <Upload className="w-3.5 h-3.5" />CSV Import
          </TabsTrigger>
          <TabsTrigger value="sync" className="flex-1 gap-1.5 text-xs data-[state=active]:bg-white">
            <LinkIcon className="w-3.5 h-3.5" />Broker Sync
          </TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Manual Entry ──────────────────────────────────────────── */}
        <TabsContent value="manual" className="space-y-4">

          {/* Step 1 — Portfolio & Broker */}
          <div className="wv-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#9CA3AF' }}>
              Step 1 &mdash; Portfolio &amp; Distributor
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

            {/* Portfolio */}
            <div className="space-y-1.5 mb-4">
              <Label className="text-xs" style={{ color: '#6B7280' }}>Portfolio</Label>
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
              <Label className="text-xs" style={{ color: '#6B7280' }}>Distributor / Broker</Label>
              <BrokerSelector
                familyId={familyId}
                selectedBrokerId={brokerId}
                onChange={setBrokerId}
                error={errors.broker}
              />
            </div>
          </div>

          {/* Step 2 — Stock/ETF Search */}
          <div className="wv-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#9CA3AF' }}>
              Step 2 &mdash; Search Stock / ETF
            </p>

            <div className="relative">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: '#9CA3AF' }} />
                <Input
                  value={query}
                  onChange={e => { if (!isEditMode && !preloadHoldingId) { setQuery(e.target.value); setSelectedStock(null); setStockPrice(null); setFxRate(null); } }}
                  onFocus={() => { if (!isEditMode && !preloadHoldingId && results.length > 0) setShowDrop(true); }}
                  placeholder="Search by symbol or company name (min 2 chars)..."
                  className={`h-9 text-xs pl-9 pr-8${isEditMode || preloadHoldingId ? ' bg-[#F7F5F0] cursor-not-allowed' : ''}`}
                  readOnly={!!(isEditMode || preloadHoldingId)}
                />
                {searching
                  ? <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin" style={{ color: '#9CA3AF' }} />
                  : <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: '#9CA3AF' }} />
                }
              </div>

              {/* Dropdown */}
              {showDrop && results.length > 0 && (
                <>
                  <div className="fixed inset-0" style={{ zIndex: 9990 }} onClick={() => setShowDrop(false)} />
                  <div className="absolute top-full mt-1 left-0 right-0 rounded-xl border bg-white max-h-72 overflow-y-auto"
                    style={{ borderColor: '#E8E5DD', zIndex: 9999, boxShadow: '0 8px 32px rgba(0,0,0,0.12)' }}>
                    {results.map((s) => (
                      <button key={`${s.symbol}-${s.exchange}`}
                        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-[#F7F5F0] text-left border-b last:border-0 transition-colors"
                        style={{ borderColor: '#F0EDE6' }}
                        onClick={() => selectStock(s)}>
                        <div className="flex items-center gap-3">
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0"
                            style={{ backgroundColor: '#1B2A4A' }}>
                            {s.symbol.slice(0, 2)}
                          </div>
                          <div>
                            <p className="text-xs font-bold" style={{ color: '#1A1A2E' }}>{s.symbol}</p>
                            <p className="text-[10px]" style={{ color: '#9CA3AF' }}>{s.companyName}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] font-medium" style={{ color: '#6B7280' }}>{s.exchange}</p>
                          <p className="text-[10px]" style={{ color: '#9CA3AF' }}>
                            {countryFlag(s.country)} {s.country} &middot; {s.currency}
                          </p>
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
                  style={{ backgroundColor: '#1B2A4A' }}>
                  {selectedStock.symbol.slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-bold" style={{ color: '#1A1A2E' }}>{selectedStock.companyName}</p>
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                      style={{ backgroundColor: 'rgba(37,99,235,0.1)', color: '#2563eb' }}>
                      {countryFlag(selectedStock.country)} {selectedStock.country}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    <span className="text-[10px]" style={{ color: '#6B7280' }}>
                      {selectedStock.symbol} &middot; {selectedStock.exchange} &middot; {selectedStock.currency}
                    </span>
                  </div>

                  {/* Live price */}
                  {priceLoading ? (
                    <div className="flex items-center gap-1 mt-1">
                      <Loader2 className="w-3 h-3 animate-spin" style={{ color: '#C9A84C' }} />
                      <span className="text-[10px]" style={{ color: '#9CA3AF' }}>Fetching price...</span>
                    </div>
                  ) : stockPrice ? (
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className="text-sm font-bold" style={{ color: '#1A1A2E' }}>
                        {cSymbol}{stockPrice.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                      </span>
                      <span className="text-xs font-medium flex items-center gap-0.5"
                        style={{ color: stockPrice.changePct >= 0 ? '#059669' : '#DC2626' }}>
                        {stockPrice.changePct >= 0
                          ? <TrendingUp className="w-3 h-3" />
                          : <TrendingDown className="w-3 h-3" />}
                        {stockPrice.changePct >= 0 ? '+' : ''}{stockPrice.changePct.toFixed(2)}%
                      </span>
                      {fxRate && (
                        <span className="text-[10px]" style={{ color: '#9CA3AF' }}>
                          ({fmtINR(stockPrice.price * fxRate.rate)} @ {fmtINR(fxRate.rate)}/{stockCurrency})
                        </span>
                      )}
                    </div>
                  ) : null}

                  {/* FX rate info */}
                  {fxLoading ? (
                    <div className="flex items-center gap-1 mt-0.5">
                      <Loader2 className="w-3 h-3 animate-spin" style={{ color: '#C9A84C' }} />
                      <span className="text-[10px]" style={{ color: '#9CA3AF' }}>Fetching FX rate...</span>
                    </div>
                  ) : fxRate ? (
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="text-[10px] font-medium" style={{ color: '#6B7280' }}>
                        FX: {fmtINR(fxRate.rate)} per {stockCurrency}
                      </span>
                    </div>
                  ) : null}
                </div>
                {!isEditMode && (
                  <button className="absolute top-2 right-2 p-1 rounded-full hover:bg-gray-100"
                    onClick={() => { setSelectedStock(null); setQuery(''); setStockPrice(null); setFxRate(null); setFxRateValue(''); }}>
                    <X className="w-3.5 h-3.5" style={{ color: '#9CA3AF' }} />
                  </button>
                )}
              </div>
            )}

            {selectedStock && (() => {
              const STANDARD_SECTORS = ['Technology', 'Healthcare', 'Finance', 'Consumer', 'Energy', 'Materials',
                'Industrials', 'Communication', 'Real Estate', 'Utilities', 'ETF'];
              const currentSector = sectorOverride ?? selectedStock.sector ?? '';
              const isOtherMode = sectorOverride === '__other__' || (sectorOverride != null && !STANDARD_SECTORS.includes(sectorOverride) && sectorOverride !== '');
              const isStandard = STANDARD_SECTORS.includes(currentSector);
              const dropdownValue = isOtherMode ? 'Other' : (isStandard ? currentSector : (currentSector ? 'Other' : ''));
              const customText = isOtherMode && sectorOverride !== '__other__' ? sectorOverride : '';
              return (
                <div className="mt-3 space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>
                    Sector {selectedStock.sector && <AutoTag label="from search" />}
                  </Label>
                  <select
                    value={dropdownValue}
                    onChange={e => {
                      const v = e.target.value;
                      setSectorOverride(v === 'Other' ? '__other__' : v);
                    }}
                    className="h-9 text-xs rounded-lg border px-2 w-full"
                    style={{ borderColor: '#E8E5DD', color: '#1A1A2E', backgroundColor: 'white' }}>
                    <option value="">Select sector...</option>
                    {[...STANDARD_SECTORS, 'Other'].map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  {dropdownValue === 'Other' && (
                    <Input
                      value={customText}
                      onChange={e => setSectorOverride(e.target.value || '__other__')}
                      placeholder="Enter custom sector"
                      className="h-9 text-xs"
                    />
                  )}
                </div>
              );
            })()}
          </div>

          {/* Step 3 — Transaction Details */}
          {selectedStock && (
            <div className="wv-card p-5">
              <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#9CA3AF' }}>
                Step 3 &mdash; Transaction Details
              </p>

              {/* Transaction type pills */}
              <div className="flex flex-wrap gap-2 mb-5">
                {TXN_TYPES.map(t => (
                  <button key={t.key}
                    onClick={() => { setTxnType(t.key); setErrors({}); }}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border"
                    style={{
                      backgroundColor: txnType === t.key ? '#1B2A4A' : 'transparent',
                      color:           txnType === t.key ? 'white'   : '#6B7280',
                      borderColor:     txnType === t.key ? '#1B2A4A' : '#E8E5DD',
                    }}>
                    {t.label}
                  </button>
                ))}
              </div>

              {/* ── Buy / Sell ─────────────────────────────────────────────── */}
              {(txnType === 'buy' || txnType === 'sell') && (
                <div className="space-y-4">
                  {/* Date */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: '#6B7280' }}>Date</Label>
                      <Input
                        type="date" value={date} onChange={e => setDate(e.target.value)}
                        className="h-9 text-xs"
                      />
                      <FieldError msg={errors.date} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: '#6B7280' }}>
                        Quantity (shares)
                      </Label>
                      <Input
                        type="number" min="0.001" step="0.001"
                        value={quantity} onChange={e => setQuantity(e.target.value)}
                        placeholder="e.g. 10.5" className="h-9 text-xs"
                      />
                      <FieldError msg={errors.quantity} />
                    </div>
                  </div>

                  {/* Price & Currency */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: '#6B7280' }}>
                        {txnType === 'sell' ? 'Sell' : 'Buy'} Price ({cSymbol})
                        {priceLoaded && <AutoTag label="auto-fetched" />}
                      </Label>
                      <Input
                        type="number" step="0.01" min="0.01"
                        value={price} onChange={e => { setPrice(e.target.value); setPriceLoaded(false); setPriceManuallyEdited(true); }}
                        placeholder={`e.g. 218.45`} className="h-9 text-xs"
                      />
                      <FieldError msg={errors.price} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: '#6B7280' }}>Currency</Label>
                      <Input
                        value={`${stockCurrency} (${cSymbol})`}
                        readOnly
                        className="h-9 text-xs bg-[#F7F5F0]"
                      />
                    </div>
                  </div>

                  {/* Brokerage / Charges — before FX rate so it's included in Invested INR */}
                  <div className="pt-3 border-t space-y-2.5" style={{ borderColor: '#F0EDE6' }}>
                    <p className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: '#9CA3AF' }}>Charges</p>
                    <div className="flex items-center gap-2">
                      <Label className="text-xs w-44 flex-shrink-0" style={{ color: '#6B7280' }}>Brokerage / Charges ({cSymbol})</Label>
                      <Input
                        type="number" step="0.01" min="0"
                        value={brokerage} onChange={e => setBrokerage(e.target.value)}
                        placeholder="0.00" className="h-8 text-xs flex-1"
                      />
                    </div>
                  </div>

                  {/* FX Rate */}
                  <div className="space-y-1.5">
                    <Label className="text-xs" style={{ color: '#6B7280' }}>
                      FX Rate ({stockCurrency} to INR)
                      {fxRateLoaded && <AutoTag label="auto-fetched" />}
                    </Label>
                    <Input
                      type="number" step="0.0001" min="0.0001"
                      value={fxRateValue}
                      onChange={e => { setFxRateValue(e.target.value); setFxRateLoaded(false); }}
                      placeholder="e.g. 83.9200"
                      className="h-9 text-xs"
                    />
                    {fxRateLoaded && fxRateValue && date && (
                      <p className="text-[10px] mt-0.5" style={{ color: '#059669' }}>
                        ₹{parseFloat(fxRateValue).toFixed(4)} per {stockCurrency} on {formatDateLabel(date)} (auto-fetched)
                      </p>
                    )}
                    <FieldError msg={errors.fxRate} />
                  </div>

                  {/* Invested / Sale Value in INR */}
                  {qty > 0 && px > 0 && fx > 0 && (
                    <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(27,42,74,0.04)', border: '1px solid rgba(27,42,74,0.08)' }}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium" style={{ color: '#6B7280' }}>
                          {txnType === 'buy' ? 'Total Invested' : 'Sale Value'} in INR
                        </span>
                        <span className="text-xs font-bold" style={{ color: '#1A1A2E' }}>
                          {formatLargeINR(valueINR)}
                        </span>
                      </div>
                      <p className="text-[10px] mt-0.5 text-right" style={{ color: '#9CA3AF' }}>
                        ({cSymbol}{valueLocal.toFixed(2)}{brokerageNum > 0 ? ` + ${cSymbol}${brokerageNum.toFixed(2)} charges` : ''}) &times; ₹{fx.toFixed(4)}/{stockCurrency} = ₹{valueINR.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      </p>
                    </div>
                  )}

                  {/* Notes */}
                  <div className="space-y-1.5">
                    <Label className="text-xs" style={{ color: '#6B7280' }}>Notes (optional)</Label>
                    <textarea
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                      placeholder="Any additional notes about this transaction..."
                      className="w-full rounded-lg border px-3 py-2 text-xs min-h-[60px] resize-y focus:outline-none focus:ring-2 focus:ring-offset-0"
                      style={{ borderColor: '#E8E5DD', color: '#1A1A2E' }}
                    />
                  </div>
                </div>
              )}

              {/* ── Dividend ──────────────────────────────────────────────── */}
              {txnType === 'dividend' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: '#6B7280' }}>Ex-Dividend Date</Label>
                      <Input type="date" value={exDate} onChange={e => setExDate(e.target.value)} className="h-9 text-xs" />
                      <FieldError msg={errors.exDate} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: '#6B7280' }}>Payment Date</Label>
                      <Input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} className="h-9 text-xs" />
                      <FieldError msg={errors.payDate} />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: '#6B7280' }}>Dividend per Share ({cSymbol})</Label>
                      <Input
                        type="number" step="0.01" min="0.01"
                        value={divPerShare} onChange={e => setDivPerShare(e.target.value)}
                        placeholder="e.g. 0.96" className="h-9 text-xs"
                      />
                      <FieldError msg={errors.divPerShare} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: '#6B7280' }}>
                        Withholding Tax (%)
                      </Label>
                      <Input
                        type="number" step="0.1" min="0" max="100"
                        value={withholdingTax} onChange={e => setWithholdingTax(e.target.value)}
                        placeholder="25" className="h-9 text-xs"
                      />
                      <p className="text-[10px]" style={{ color: '#9CA3AF' }}>
                        Default: {DEFAULT_WITHHOLDING_TAX[stockCurrency] ?? 25}% for {stockCurrency} stocks
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: '#6B7280' }}>
                        Quantity (shares held)
                      </Label>
                      <Input
                        type="number" min="0.001" step="0.001"
                        value={quantity} onChange={e => setQuantity(e.target.value)}
                        placeholder="e.g. 10" className="h-9 text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: '#6B7280' }}>
                        FX Rate on Payment Date ({stockCurrency} to INR)
                        {divFxRateLoaded && <AutoTag label="auto-fetched" />}
                      </Label>
                      <Input
                        type="number" step="0.01" min="0.01"
                        value={divFxRate}
                        onChange={e => { setDivFxRate(e.target.value); setDivFxRateLoaded(false); }}
                        placeholder="e.g. 83.92" className="h-9 text-xs"
                      />
                      <FieldError msg={errors.divFxRate} />
                    </div>
                  </div>

                  {/* Dividend calculation summary */}
                  {divPS > 0 && qty > 0 && (
                    <div className="p-3 rounded-xl space-y-1.5" style={{ backgroundColor: 'rgba(5,150,105,0.06)', border: '1px solid rgba(5,150,105,0.15)' }}>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px]" style={{ color: '#6B7280' }}>Gross Dividend</span>
                        <span className="text-xs font-medium" style={{ color: '#1A1A2E' }}>
                          {qty} &times; {cSymbol}{divPS.toFixed(2)} = {fmtLocal(grossDiv)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px]" style={{ color: '#6B7280' }}>Withholding Tax ({divTaxPct}%)</span>
                        <span className="text-xs font-medium" style={{ color: '#DC2626' }}>
                          &minus;{fmtLocal(grossDiv * divTaxPct / 100)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between pt-1.5 border-t" style={{ borderColor: 'rgba(5,150,105,0.15)' }}>
                        <span className="text-[10px] font-semibold" style={{ color: '#059669' }}>Net Dividend</span>
                        <span className="text-xs font-bold" style={{ color: '#059669' }}>
                          {fmtLocal(netDivLocal)}
                          {divFx > 0 && (
                            <span className="ml-1 text-[10px] font-normal" style={{ color: '#6B7280' }}>
                              ({fmtINR(netDivINR)})
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Notes */}
                  <div className="space-y-1.5">
                    <Label className="text-xs" style={{ color: '#6B7280' }}>Notes (optional)</Label>
                    <textarea
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                      placeholder="Any additional notes about this dividend..."
                      className="w-full rounded-lg border px-3 py-2 text-xs min-h-[60px] resize-y focus:outline-none focus:ring-2 focus:ring-offset-0"
                      style={{ borderColor: '#E8E5DD', color: '#1A1A2E' }}
                    />
                  </div>
                </div>
              )}

              {/* Summary strip for Buy/Sell */}
              {(txnType === 'buy' || txnType === 'sell') && qty > 0 && px > 0 && fx > 0 && (
                <div className="mt-4 p-3 rounded-xl grid grid-cols-3 gap-3"
                  style={{ backgroundColor: 'rgba(27,42,74,0.04)', border: '1px solid rgba(27,42,74,0.08)' }}>
                  <div>
                    <p className="text-[10px]" style={{ color: '#9CA3AF' }}>
                      {txnType === 'buy' ? 'Invested' : 'Sale Value'}
                    </p>
                    <p className="text-xs font-bold" style={{ color: '#1A1A2E' }}>
                      {fmtLocal(valueLocal)} ({formatLargeINR(valueINR)})
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px]" style={{ color: '#9CA3AF' }}>FX Rate</p>
                    <p className="text-xs font-bold" style={{ color: '#1A1A2E' }}>
                      {fmtINR(fx)}/{stockCurrency}
                    </p>
                  </div>
                  {stockPrice && (
                    <div>
                      <p className="text-[10px]" style={{ color: '#9CA3AF' }}>vs CMP</p>
                      {(() => {
                        const diff = txnType === 'buy' ? stockPrice.price - px : px - stockPrice.price;
                        const diffPct = px > 0 ? (diff / px) * 100 : 0;
                        return (
                          <p className="text-xs font-bold" style={{ color: diff >= 0 ? '#059669' : '#DC2626' }}>
                            {diff >= 0 ? '+' : ''}{diffPct.toFixed(1)}%
                          </p>
                        );
                      })()}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Holder info */}
          {selectedStock && (
            <div className="px-4 py-3 rounded-xl flex items-center gap-2 text-xs"
              style={{ backgroundColor: '#F7F5F0', border: '1px solid #E8E5DD' }}>
              <User className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#9CA3AF' }} />
              <span style={{ color: '#6B7280' }}>Holder &amp; account details are managed per distributor.</span>
              <button
                type="button"
                onClick={() => router.push('/settings?tab=distributors')}
                className="ml-1 text-[11px] font-semibold underline-offset-2 hover:underline"
                style={{ color: '#C9A84C' }}>
                Edit in Settings &rarr;
              </button>
            </div>
          )}

          {/* Action buttons */}
          {selectedStock && (
            <div className="flex gap-3">
              <Button onClick={() => handleSave(false)} disabled={saving} className="flex-1 h-10 text-xs font-semibold"
                style={{ backgroundColor: '#C9A84C', color: '#1B2A4A' }}>
                {saving
                  ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />{isEditMode ? 'Updating...' : 'Saving...'}</>
                  : isEditMode ? 'Update Transaction' : `Save ${txnType.charAt(0).toUpperCase() + txnType.slice(1)}`}
              </Button>
              {!isEditMode && (
                <Button onClick={() => handleSave(true)} disabled={saving} className="flex-1 h-10 text-xs font-semibold text-white"
                  style={{ backgroundColor: '#1B2A4A' }}>
                  Save &amp; Add Another
                </Button>
              )}
              <Button variant="outline" className="h-10 text-xs px-4" style={{ borderColor: '#E8E5DD', color: '#6B7280' }}
                onClick={() => router.back()}>
                Cancel
              </Button>
            </div>
          )}
        </TabsContent>

        {/* ── Tab 2: CSV Import ───────────────────────────────────────────────── */}
        <TabsContent value="import">
          <div className="wv-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#9CA3AF' }}>
              CSV Import
            </p>
            <div className="grid grid-cols-2 gap-3 mb-5">
              {['Vested CSV Export', 'IBKR Activity Statement', 'Charles Schwab CSV', 'INDmoney Export', 'Groww US Stocks CSV', 'Custom CSV'].map(fmt => (
                <div key={fmt} className="p-3 rounded-xl border flex items-center gap-2" style={{ borderColor: '#E8E5DD' }}>
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: '#C9A84C' }} />
                  <span className="text-xs" style={{ color: '#6B7280' }}>{fmt}</span>
                </div>
              ))}
            </div>
            <div className="p-4 rounded-xl border flex flex-col items-center gap-2 mb-4"
              style={{ borderColor: 'rgba(201,168,76,0.3)', backgroundColor: 'rgba(201,168,76,0.04)' }}>
              <Building2 className="w-8 h-8" style={{ color: '#C9A84C' }} />
              <p className="text-sm font-semibold" style={{ color: '#C9A84C' }}>Coming Soon</p>
              <p className="text-xs text-center" style={{ color: '#9CA3AF' }}>
                Support for Vested CSV, IBKR Activity Statement, Schwab CSV.<br />
                Upload your broker export and we&apos;ll auto-map all your transactions.
              </p>
            </div>
            <label className="flex flex-col items-center justify-center w-full h-32 rounded-xl border-2 border-dashed cursor-not-allowed opacity-50"
              style={{ borderColor: '#E8E5DD' }}>
              <Upload className="w-7 h-7 mb-2" style={{ color: '#9CA3AF' }} />
              <p className="text-sm font-medium" style={{ color: '#6B7280' }}>Upload statement</p>
              <p className="text-xs mt-1" style={{ color: '#9CA3AF' }}>.xlsx, .csv, .pdf</p>
            </label>
          </div>
        </TabsContent>

        {/* ── Tab 3: Broker Sync ─────────────────────────────────────────────── */}
        <TabsContent value="sync">
          <div className="wv-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#9CA3AF' }}>
              Broker API Sync
            </p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { name: 'Vested',       color: '#6C63FF', letter: 'V', status: 'Soon' },
                { name: 'INDmoney',     color: '#00C9A7', letter: 'I', status: 'Soon' },
                { name: 'IBKR',         color: '#DC2626', letter: 'IB', status: 'Soon' },
                { name: 'Charles Schwab', color: '#0072CE', letter: 'CS', status: 'Soon' },
              ].map(api => (
                <div key={api.name} className="p-4 rounded-xl border" style={{ borderColor: '#E8E5DD' }}>
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
                  <p className="text-xs font-semibold mb-3" style={{ color: '#1A1A2E' }}>{api.name}</p>
                  <Button disabled className="w-full h-7 text-[11px]"
                    style={{ backgroundColor: '#F7F5F0', color: '#9CA3AF' }}>
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

export default function GlobalStocksAddPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#C9A84C' }} />
      </div>
    }>
      <GlobalStocksFormContent />
    </Suspense>
  );
}
