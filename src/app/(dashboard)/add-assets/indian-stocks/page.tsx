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
  Loader2, AlertCircle, X, Plus, User, Building2, Search,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR } from '@/lib/utils/formatters';
import { holdingsCacheClearAll } from '@/lib/utils/holdings-cache';
import { BrokerSelector } from '@/components/forms/BrokerSelector';

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
interface Portfolio    { id: string; name: string; type: string }
interface Toast        { type: 'success' | 'error'; message: string }

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_PORTFOLIOS = ['Long-term Growth', 'Trading', 'Retirement', 'Tax Saving'];

const TXN_TYPES = [
  { key: 'buy',      label: 'Buy' },
  { key: 'sell',     label: 'Sell' },
  { key: 'bonus',    label: 'Bonus' },
  { key: 'split',    label: 'Split' },
  { key: 'rights',   label: 'Rights Issue' },
  { key: 'dividend', label: 'Dividend' },
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
      <Label className="text-xs w-36 flex-shrink-0" style={{ color: '#6B7280' }}>{label}</Label>
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
        <span className="text-[10px] w-20 text-right flex-shrink-0" style={{ color: '#9CA3AF' }}>
          calc: ₹{autoCalc}
        </span>
      )}
    </div>
  );
}

// ─── Main Form Content ─────────────────────────────────────────────────────────

function IndianStocksFormContent() {
  const router   = useRouter();
  const supabase = createClient();
  const _searchParams = useSearchParams();
  const editTxnId = _searchParams.get('edit_txn');
  const editHoldingId = _searchParams.get('holding_id');
  const isEditMode = !!editTxnId && !!editHoldingId;

  const addToHoldingId = _searchParams.get('add_to');
  const isAddMoreMode = !!addToHoldingId && !isEditMode;

  // Auth / family
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [members,  setMembers]  = useState<FamilyMember[]>([]);
  const [member,   setMember]   = useState('');

  // Portfolio
  const [portfolios,    setPortfolios]    = useState<Portfolio[]>([]);
  const [portfolioName, setPortfolioName] = useState('Long-term Growth');
  const [newPortName,   setNewPortName]   = useState('');
  const [showNewPort,   setShowNewPort]   = useState(false);

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

  // UI state
  const [saving,  setSaving]  = useState(false);
  const [toast,   setToast]   = useState<Toast | null>(null);
  const [errors,  setErrors]  = useState<Record<string, string>>({});

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load user/family ────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { router.push('/login'); return; }
      const { data: profile } = await supabase
        .from('users').select('id, name, family_id').eq('id', user.id).single();
      if (!profile) return;
      setMember(profile.id);

      const fid = profile.family_id;
      if (fid) {
        setFamilyId(fid);
        const { data: fUsers } = await supabase.from('users').select('id, name').eq('family_id', fid);
        const { data: extraMembers } = await supabase.from('family_members').select('id, name').eq('family_id', fid);
        setMembers([...(fUsers ?? [{ id: profile.id, name: profile.name }]), ...(extraMembers ?? [])]);
        const { data: ports } = await supabase.from('portfolios').select('id, name, type').eq('family_id', fid).order('created_at');
        setPortfolios(ports ?? []);
      } else {
        setMembers([{ id: profile.id, name: profile.name }]);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
        .select('symbol, name, metadata, brokers(id, name), portfolios(name)')
        .eq('id', editHoldingId)
        .single();
      if (!holdingData) return;

      const meta = (holdingData.metadata ?? {}) as Record<string, unknown>;

      setSelectedStock({
        symbol: holdingData.symbol,
        companyName: holdingData.name,
        exchange: String(meta.exchange ?? 'NSE'),
        sector: String(meta.sector ?? ''),
        industry: String(meta.industry ?? ''),
        isin: String(meta.isin ?? ''),
        bseCode: String(meta.bse_code ?? ''),
      });
      setQuery(`${holdingData.symbol} — ${holdingData.name}`);

      const notes = txn.notes ?? '';
      if (notes.toLowerCase().includes('bonus')) setTxnType('bonus');
      else if (notes.toLowerCase().includes('split')) setTxnType('split');
      else if (notes.toLowerCase().includes('rights')) setTxnType('rights');
      else if (txn.type === 'dividend') setTxnType('dividend');
      else if (txn.type === 'sell') setTxnType('sell');
      else setTxnType('buy');

      setQuantity(String(txn.quantity || ''));
      setPrice(String(txn.price || ''));
      setDate(txn.date || '');

      if (holdingData.portfolios) {
        const p = holdingData.portfolios as unknown as { name: string };
        setPortfolioName(p.name);
      }
      if (holdingData.brokers) {
        const b = holdingData.brokers as unknown as { id: string };
        setBrokerId(b.id);
      }
    })();
  }, [editTxnId, editHoldingId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load holding data for add-more mode ──────────────────────────────────
  useEffect(() => {
    if (!isAddMoreMode) return;
    (async () => {
      const { data: holdingData } = await supabase
        .from('holdings')
        .select('symbol, name, quantity, avg_buy_price, metadata, brokers(id, name), portfolios(name)')
        .eq('id', addToHoldingId)
        .single();
      if (!holdingData) return;

      const meta = (holdingData.metadata ?? {}) as Record<string, unknown>;
      setSelectedStock({
        symbol: holdingData.symbol,
        companyName: holdingData.name,
        exchange: String(meta.exchange ?? 'NSE'),
        sector: String(meta.sector ?? ''),
        industry: String(meta.industry ?? ''),
        isin: String(meta.isin ?? ''),
        bseCode: String(meta.bse_code ?? ''),
      });
      setQuery(`${holdingData.symbol} — ${holdingData.name}`);
      setTxnType('buy');

      if (holdingData.portfolios) {
        setPortfolioName((holdingData.portfolios as unknown as { name: string }).name);
      }
      if (holdingData.brokers) {
        setBrokerId((holdingData.brokers as unknown as { id: string }).id);
      }
    })();
  }, [addToHoldingId]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!portfolioName && !newPortName) errs.portfolio = 'Select or create a portfolio';

    if (txnType === 'buy' || txnType === 'sell' || txnType === 'rights') {
      if (!quantity || qty <= 0)    errs.quantity = 'Enter a valid quantity';
      if (!price    || px  <= 0)    errs.price    = 'Enter a valid price';
    }
    if (!date) errs.date = 'Enter a date';
    if (txnType === 'bonus'    && !bonusRatio)  errs.bonusRatio  = 'Enter bonus ratio e.g. 1:2';
    if (txnType === 'split'    && !splitRatio)  errs.splitRatio  = 'Enter split ratio e.g. 1:5';
    if (txnType === 'dividend' && !divPerShare) errs.divPerShare = 'Enter dividend per share';

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

      const finalPortfolio = showNewPort && newPortName ? newPortName : portfolioName;

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
        portfolioName:   finalPortfolio,
        brokerId,
        currentPrice: stockPrice?.price ?? null,
        bonusRatio,  splitRatio,  splitFactor,
        rightsRatio, rightsPrice,
        dividendPerShare: divPerShare, dividendType: divType, exDate, paymentDate: payDate,
      };

      let endpoint = '/api/stocks/save';
      if (txnType === 'sell') {
        // For sell we need holdingId — use save route with transactionType='sell'
        // The save route handles it through the existing holding
        endpoint = '/api/stocks/save';
      }

      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed');

      setToast({ type: 'success', message: `${txnType === 'buy' ? 'Holding saved' : txnType.charAt(0).toUpperCase() + txnType.slice(1)} recorded successfully!${data.consolidated ? ' (Consolidated with existing holding)' : ''}` });
      holdingsCacheClearAll();

      if (andAnother) {
        resetForm();
      } else {
        setTimeout(() => router.push('/portfolio/indian-stocks'), 1200);
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
    setSectorOverride(null);
    setErrors({});
    setDate(new Date().toISOString().split('T')[0]);
  }

  // ── Portfolio pills ─────────────────────────────────────────────────────────
  const allPortfolios = Array.from(new Set([
    ...DEFAULT_PORTFOLIOS,
    ...portfolios.map(p => p.name),
  ]));

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-2xl mx-auto">

      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: 'rgba(27,42,74,0.08)' }}>
          <TrendingUp className="w-5 h-5" style={{ color: '#1B2A4A' }} />
        </div>
        <div>
          <h1 className="font-display text-xl font-semibold" style={{ color: '#1A1A2E' }}>{isEditMode ? 'Edit Transaction' : 'Indian Stocks'}</h1>
          <p className="text-xs" style={{ color: '#9CA3AF' }}>{isEditMode ? 'Update the details of this transaction' : 'Track NSE/BSE equity holdings across all transaction types'}</p>
        </div>
      </div>

      {toast && <ToastBanner toast={toast} onClose={() => setToast(null)} />}

      <Tabs defaultValue="manual">
        <TabsList className="mb-5 w-full" style={{ backgroundColor: '#F7F5F0', border: '1px solid #E8E5DD' }}>
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
            <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#9CA3AF' }}>
              Step 1 — Portfolio &amp; Distributor
            </p>

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

            {/* Portfolio pills */}
            <div className="space-y-2 mb-4">
              <Label className="text-xs" style={{ color: '#6B7280' }}>Portfolio</Label>
              <div className="flex flex-wrap gap-2">
                {allPortfolios.map(name => (
                  <button key={name}
                    onClick={() => { setPortfolioName(name); setShowNewPort(false); }}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all border"
                    style={{
                      backgroundColor: portfolioName === name && !showNewPort ? '#1B2A4A' : 'transparent',
                      color:           portfolioName === name && !showNewPort ? 'white' : '#6B7280',
                      borderColor:     portfolioName === name && !showNewPort ? '#1B2A4A' : '#E8E5DD',
                    }}>
                    {name}
                  </button>
                ))}
                <button
                  onClick={() => { setShowNewPort(!showNewPort); setPortfolioName(''); }}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all border flex items-center gap-1"
                  style={{
                    backgroundColor: showNewPort ? 'rgba(201,168,76,0.1)' : 'transparent',
                    color:           showNewPort ? '#C9A84C' : '#6B7280',
                    borderColor:     showNewPort ? '#C9A84C' : '#E8E5DD',
                  }}>
                  <Plus className="w-3 h-3" />New
                </button>
              </div>
              {showNewPort && (
                <Input
                  value={newPortName} onChange={e => setNewPortName(e.target.value)}
                  placeholder="Portfolio name e.g. Children's Education"
                  className="h-9 text-xs mt-2"
                />
              )}
              <FieldError msg={errors.portfolio} />
            </div>

            {/* Broker */}
            <div className="space-y-1.5">
              <Label className="text-xs" style={{ color: '#6B7280' }}>Distributor / Demat Account</Label>
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
            <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#9CA3AF' }}>
              Step 2 — Search Stock
            </p>

            <div className="relative">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: '#9CA3AF' }} />
                <Input
                  value={query}
                  onChange={e => { if (!isEditMode && !isAddMoreMode) { setQuery(e.target.value); setSelectedStock(null); setStockPrice(null); } }}
                  onFocus={() => { if (!isEditMode && !isAddMoreMode && results.length > 0) setShowDrop(true); }}
                  readOnly={isEditMode || isAddMoreMode}
                  placeholder="Search by symbol or company name (min 2 chars)…"
                  className={`h-9 text-xs pl-9 pr-8 ${isEditMode || isAddMoreMode ? 'bg-[#F7F5F0] cursor-not-allowed' : ''}`}
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
                  <div className="absolute top-full mt-1 left-0 right-0 rounded-xl border bg-white"
                    style={{ borderColor: '#E8E5DD', zIndex: 9999, boxShadow: '0 8px 32px rgba(0,0,0,0.12)' }}>
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
                            <p className="text-xs font-bold" style={{ color: '#1A1A2E' }}>{s.symbol}</p>
                            <p className="text-[10px]" style={{ color: '#9CA3AF' }}>{s.companyName}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] font-medium" style={{ color: '#6B7280' }}>{s.exchange}</p>
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
                    <p className="text-sm font-bold" style={{ color: '#1A1A2E' }}>{selectedStock.companyName}</p>
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                      style={{ backgroundColor: sectorColor(selectedStock.sector) + '22', color: sectorColor(selectedStock.sector) }}>
                      {selectedStock.sector}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    <span className="text-[10px]" style={{ color: '#6B7280' }}>
                      {selectedStock.symbol} · {selectedStock.exchange} · {selectedStock.industry}
                    </span>
                    {selectedStock.isin && (
                      <span className="text-[10px]" style={{ color: '#9CA3AF' }}>ISIN: {selectedStock.isin}</span>
                    )}
                  </div>
                  {priceLoading ? (
                    <div className="flex items-center gap-1 mt-1">
                      <Loader2 className="w-3 h-3 animate-spin" style={{ color: '#C9A84C' }} />
                      <span className="text-[10px]" style={{ color: '#9CA3AF' }}>Fetching price…</span>
                    </div>
                  ) : stockPrice ? (
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-sm font-bold" style={{ color: '#1A1A2E' }}>
                        ₹{stockPrice.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                      </span>
                      <span className={`text-xs font-medium flex items-center gap-0.5`}
                        style={{ color: stockPrice.changePct >= 0 ? '#059669' : '#DC2626' }}>
                        {stockPrice.changePct >= 0
                          ? <TrendingUp className="w-3 h-3" />
                          : <TrendingDown className="w-3 h-3" />}
                        {stockPrice.changePct >= 0 ? '+' : ''}{stockPrice.changePct}%
                      </span>
                      <span className="text-[10px]" style={{ color: '#9CA3AF' }}>
                        H: ₹{stockPrice.dayHigh.toLocaleString('en-IN')} · L: ₹{stockPrice.dayLow.toLocaleString('en-IN')}
                      </span>
                    </div>
                  ) : null}
                </div>
                <button className="absolute top-2 right-2 p-1 rounded-full hover:bg-gray-100"
                  onClick={() => { setSelectedStock(null); setQuery(''); setStockPrice(null); }}>
                  <X className="w-3.5 h-3.5" style={{ color: '#9CA3AF' }} />
                </button>
              </div>
            )}

            {/* Editable sector */}
            {selectedStock && (
              <div className="mt-3 space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>
                  Sector {selectedStock.sector && <AutoTag label="from search" />}
                </Label>
                <div className="flex gap-2">
                  <select
                    value={sectorOverride ?? selectedStock.sector ?? ''}
                    onChange={e => setSectorOverride(e.target.value)}
                    className="h-9 text-xs rounded-lg border px-2 flex-1"
                    style={{ borderColor: '#E8E5DD', color: '#1A1A2E', backgroundColor: 'white' }}>
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
              <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#9CA3AF' }}>
                Step 3 — Transaction Details
              </p>
            {isAddMoreMode && selectedStock && (
              <div className="mb-4 p-3 rounded-xl text-xs" style={{ backgroundColor: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.15)', color: '#92620A' }}>
                Adding shares to: <strong>{selectedStock.companyName}</strong>
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
                      borderColor:     txnType === t.key ? '#1B2A4A' : '#E8E5DD',
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
                        type="number" min="1" step="1"
                        value={quantity} onChange={e => setQuantity(e.target.value)}
                        placeholder="100" className="h-9 text-xs"
                      />
                      <FieldError msg={errors.quantity} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: '#6B7280' }}>
                        {txnType === 'sell' ? 'Sell' : txnType === 'rights' ? 'Rights'  : 'Buy'} Price (₹)
                        {priceLoaded && <AutoTag label="auto-filled" />}
                        {stockPrice && (
                          <span className="ml-1 text-[10px]" style={{ color: '#9CA3AF' }}>
                            CMP ₹{stockPrice.price.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                          </span>
                        )}
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
                      <Label className="text-xs" style={{ color: '#6B7280' }}>
                        ISIN <AutoTag label="auto-filled" />
                      </Label>
                      <Input value={selectedStock.isin} readOnly className="h-8 text-xs font-mono bg-[#F7F5F0]" />
                    </div>
                  )}

                  {/* Charges */}
                  <div className="pt-3 border-t space-y-2.5" style={{ borderColor: '#F0EDE6' }}>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#9CA3AF' }}>Charges</p>
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
                      <Label className="text-xs" style={{ color: '#6B7280' }}>Bonus Ratio</Label>
                      <Input value={bonusRatio} onChange={e => setBonusRatio(e.target.value)} placeholder="1:2 (1 bonus per 2 held)" className="h-9 text-xs" />
                      <FieldError msg={errors.bonusRatio} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: '#6B7280' }}>Existing Quantity (your holdings)</Label>
                      <Input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="500" className="h-9 text-xs" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: '#6B7280' }}>Record Date</Label>
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
                      <Label className="text-xs" style={{ color: '#6B7280' }}>Split Ratio (New : Old)</Label>
                      <Input value={splitRatio} onChange={e => setSplitRatio(e.target.value)} placeholder="5:1 (1 share → 5 shares)" className="h-9 text-xs" />
                      <FieldError msg={errors.splitRatio} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: '#6B7280' }}>Existing Quantity</Label>
                      <Input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="100" className="h-9 text-xs" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: '#6B7280' }}>Record Date</Label>
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
                        <p className="text-xs" style={{ color: '#1B2A4A' }}>
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
                    <Label className="text-xs" style={{ color: '#6B7280' }}>Rights Ratio</Label>
                    <Input value={rightsRatio} onChange={e => setRightsRatio(e.target.value)} placeholder="1:5 (1 right per 5 held)" className="h-9 text-xs" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs" style={{ color: '#6B7280' }}>Rights Issue Price (₹)</Label>
                    <Input type="number" step="0.01" value={rightsPrice} onChange={e => setRightsPrice(e.target.value)} placeholder="100.00" className="h-9 text-xs" />
                  </div>
                </div>
              )}

              {/* ── Dividend ────────────────────────────────────────────────── */}
              {txnType === 'dividend' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: '#6B7280' }}>Dividend per Share (₹)</Label>
                      <Input type="number" step="0.01" value={divPerShare} onChange={e => setDivPerShare(e.target.value)} placeholder="5.00" className="h-9 text-xs" />
                      <FieldError msg={errors.divPerShare} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: '#6B7280' }}>Dividend Type</Label>
                      <Select value={divType} onValueChange={setDivType}>
                        <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {['Interim','Final','Special'].map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: '#6B7280' }}>Ex-Dividend Date</Label>
                      <Input type="date" value={exDate} onChange={e => setExDate(e.target.value)} className="h-9 text-xs" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs" style={{ color: '#6B7280' }}>Payment Date</Label>
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

              {/* Summary strip for Buy/Sell */}
              {(txnType === 'buy' || txnType === 'sell') && qty > 0 && px > 0 && (
                <div className="mt-4 p-3 rounded-xl grid grid-cols-4 gap-3"
                  style={{ backgroundColor: 'rgba(27,42,74,0.04)', border: '1px solid rgba(27,42,74,0.08)' }}>
                  <div>
                    <p className="text-[10px]" style={{ color: '#9CA3AF' }}>
                      {txnType === 'buy' ? 'Invested' : 'Sale Value'}
                    </p>
                    <p className="text-xs font-bold" style={{ color: '#1A1A2E' }}>{formatLargeINR(value)}</p>
                  </div>
                  <div>
                    <p className="text-[10px]" style={{ color: '#9CA3AF' }}>Total Charges</p>
                    <p className="text-xs font-bold" style={{ color: '#1A1A2E' }}>₹{totalFees.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-[10px]" style={{ color: '#9CA3AF' }}>
                      {txnType === 'buy' ? 'Total Cost' : 'Net Proceeds'}
                    </p>
                    <p className="text-xs font-bold" style={{ color: '#1A1A2E' }}>{formatLargeINR(txnType === 'buy' ? totalCost : value - totalFees)}</p>
                  </div>
                  {stockPrice && (
                    <div>
                      <p className="text-[10px]" style={{ color: '#9CA3AF' }}>vs CMP</p>
                      {(() => {
                        const diff = txnType === 'buy' ? stockPrice.price - px : px - (Number(price) || 0);
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

          {/* Holder details are managed at the Distributor (broker) level */}
          {selectedStock && (
            <div className="px-4 py-3 rounded-xl flex items-center gap-2 text-xs"
              style={{ backgroundColor: '#F7F5F0', border: '1px solid #E8E5DD' }}>
              <User className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#9CA3AF' }} />
              <span style={{ color: '#6B7280' }}>Holder &amp; demat details are managed per distributor.</span>
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
                style={{ backgroundColor: '#C9A84C', color: '#1B2A4A' }}>
                {saving ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Saving…</> : `Save ${txnType.charAt(0).toUpperCase() + txnType.slice(1)}`}
              </Button>
              <Button onClick={() => handleSave(true)} disabled={saving} className="flex-1 h-10 text-xs font-semibold text-white"
                style={{ backgroundColor: '#1B2A4A' }}>
                Save &amp; Add Another
              </Button>
              <Button variant="outline" className="h-10 text-xs px-4" style={{ borderColor: '#E8E5DD', color: '#6B7280' }}
                onClick={() => router.back()}>
                Cancel
              </Button>
            </div>
          )}
        </TabsContent>

        {/* ── Tab 2: Import ─────────────────────────────────────────────────── */}
        <TabsContent value="import">
          <div className="wv-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#9CA3AF' }}>
              Import Contract Note / Trade Statement
            </p>
            <div className="grid grid-cols-2 gap-3 mb-5">
              {['Zerodha Tradebook CSV','Groww Trade Report','Angel One Report','ICICI Direct CAS','HDFC Securities','Upstox Trade Report'].map(fmt => (
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
                Upload your broker tradebook CSV or contract note PDF.<br />
                We&apos;ll parse and auto-map all your transactions.
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
                { name: 'Zerodha Kite',   color: '#387ED1', letter: 'Z', status: 'Soon' },
                { name: 'Groww',          color: '#00D09C', letter: 'G', status: 'Soon' },
                { name: 'Angel One',      color: '#DC2626', letter: 'A', status: 'Soon' },
                { name: 'ICICI Direct',   color: '#FF6600', letter: 'I', status: 'Soon' },
                { name: 'HDFC Securities',color: '#003087', letter: 'H', status: 'Soon' },
                { name: 'Upstox',         color: '#5D47D4', letter: 'U', status: 'Soon' },
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
