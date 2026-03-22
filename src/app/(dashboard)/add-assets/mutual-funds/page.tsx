'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input }    from '@/components/ui/input';
import { Label }    from '@/components/ui/label';
import { Button }   from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BarChart3, Upload, Link as LinkIcon, Check, ChevronDown, Loader2, AlertCircle, X, TrendingUp, TrendingDown } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR } from '@/lib/utils/formatters';
import { BrokerSelector } from '@/components/forms/BrokerSelector';
import { CASImporter }    from '@/components/forms/CASImporter';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SearchResult {
  schemeCode: number;
  schemeName: string;
  category: string;
}

interface NavData {
  nav: number;
  navDate: string;   // DD-MM-YYYY
  fundName: string;
  fundHouse: string;
  category: string;
}

interface FamilyMember { id: string; name: string }
interface Portfolio    { id: string; name: string; type: string }

interface Toast { type: 'success' | 'error'; message: string }

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_PORTFOLIOS = ['Long-term Growth', 'Retirement', 'Tax Saving'];

const CAT_COLORS: Record<string, { bg: string; text: string }> = {
  Equity:     { bg: 'rgba(27,42,74,0.08)',   text: '#1B2A4A' },
  ELSS:       { bg: '#F5EDD6',               text: '#C9A84C' },
  Hybrid:     { bg: 'rgba(46,139,139,0.08)', text: '#2E8B8B' },
  Debt:       { bg: 'rgba(5,150,105,0.08)',  text: '#059669' },
  Liquid:     { bg: 'rgba(5,150,105,0.08)',  text: '#059669' },
  Gilt:       { bg: 'rgba(5,150,105,0.08)',  text: '#059669' },
  'Index/ETF':{ bg: 'rgba(27,42,74,0.08)',   text: '#1B2A4A' },
};

function getCatStyle(cat: string) {
  return CAT_COLORS[cat] ?? { bg: '#F3F4F6', text: '#6B7280' };
}

// Parse "DD-MM-YYYY" from mfapi into a display string
function fmtNavDate(raw: string): string {
  if (!raw) return '';
  const [d, m, y] = raw.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`;
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function ToastBanner({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const isSuccess = toast.type === 'success';
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-xl mb-4 text-sm font-medium"
      style={{
        backgroundColor: isSuccess ? 'rgba(5,150,105,0.08)' : 'rgba(220,38,38,0.08)',
        border: `1px solid ${isSuccess ? 'rgba(5,150,105,0.2)' : 'rgba(220,38,38,0.2)'}`,
        color: isSuccess ? '#059669' : '#DC2626',
      }}
    >
      {isSuccess ? <Check className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
      <span className="flex-1">{toast.message}</span>
      <button onClick={onClose}><X className="w-3.5 h-3.5" /></button>
    </div>
  );
}

// ─── Field error ──────────────────────────────────────────────────────────────

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="text-[10px] mt-0.5" style={{ color: '#DC2626' }}>{msg}</p>;
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MutualFundsPage() {
  const router = useRouter();
  const supabase = createClient();

  // ── Auth & DB data ─────────────────────────────────────────────────────────
  const [familyId,   setFamilyId]   = useState<string | null>(null);
  const [members,    setMembers]    = useState<FamilyMember[]>([]);
  const [dbPortfolios, setDbPortfolios] = useState<Portfolio[]>([]);
  const [member,     setMember]     = useState('');

  // ── Step 1 ─────────────────────────────────────────────────────────────────
  const [portfolio,  setPortfolio]  = useState('Long-term Growth');
  const [broker,     setBroker]     = useState('');

  // ── Step 2 — fund search ───────────────────────────────────────────────────
  const [query,       setQuery]      = useState('');
  const [showDrop,    setShowDrop]   = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedFund, setSelectedFund] = useState<SearchResult | null>(null);
  const [navData,     setNavData]    = useState<NavData | null>(null);
  const [isNavLoading, setIsNavLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const dropRef     = useRef<HTMLDivElement>(null);

  // ── Step 3 — transaction ───────────────────────────────────────────────────
  const [isSIP,     setIsSIP]     = useState(false);
  const [amount,    setAmount]    = useState('');
  const [nav,       setNav]       = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [histNavHint, setHistNavHint]   = useState<{ nav: number; date: string } | null>(null);
  const [isHistLoading, setIsHistLoading] = useState(false);
  const [folio,     setFolio]     = useState('');
  const [plan,      setPlan]      = useState('Direct Growth');
  const [sipAmount, setSipAmount] = useState('');
  const [sipDate,   setSipDate]   = useState('');
  const [sipStart,  setSipStart]  = useState('');
  const [sipCount,  setSipCount]  = useState('');

  // ── UI state ───────────────────────────────────────────────────────────────
  const [errors,    setErrors]    = useState<Record<string, string>>({});
  const [isSaving,  setIsSaving]  = useState(false);
  const [toast,     setToast]     = useState<Toast | null>(null);

  // ── Load user and family members ───────────────────────────────────────────
  useEffect(() => {
    async function loadUser() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }

      // Load family members
      const { data: profile } = await supabase
        .from('users')
        .select('id, name, family_id')
        .eq('id', user.id)
        .single();

      if (!profile) return;
      setMember(profile.id);
      if (profile.family_id) setFamilyId(profile.family_id);

      if (profile.family_id) {
        const { data: familyUsers } = await supabase
          .from('users')
          .select('id, name')
          .eq('family_id', profile.family_id);
        setMembers(familyUsers ?? [{ id: profile.id, name: profile.name }]);
      } else {
        setMembers([{ id: profile.id, name: profile.name }]);
      }

      // Load user's existing portfolios
      const { data: portfolios } = await supabase
        .from('portfolios')
        .select('id, name, type')
        .eq('user_id', user.id);
      if (portfolios?.length) {
        setDbPortfolios(portfolios);
        setPortfolio(portfolios[0].name);
      }
    }
    loadUser();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Close dropdown on outside click ───────────────────────────────────────
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setShowDrop(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Debounced search ───────────────────────────────────────────────────────
  function handleQueryChange(val: string) {
    setQuery(val);
    setSelectedFund(null);
    setNavData(null);
    clearTimeout(debounceRef.current);
    if (val.length < 2) { setSearchResults([]); setShowDrop(false); return; }
    setIsSearching(true);
    setShowDrop(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/mf/search?q=${encodeURIComponent(val)}`);
        const json = await res.json();
        setSearchResults(json.results ?? []);
      } finally {
        setIsSearching(false);
      }
    }, 300);
  }

  // ── Select fund → fetch current NAV ───────────────────────────────────────
  const selectFund = useCallback(async (fund: SearchResult) => {
    setSelectedFund(fund);
    setQuery(fund.schemeName);
    setShowDrop(false);
    setNavData(null);
    setIsNavLoading(true);
    try {
      const res = await fetch(`/api/mf/nav?scheme_code=${fund.schemeCode}`);
      if (res.ok) {
        const data: NavData = await res.json();
        setNavData(data);
        // Pre-fill nav field with today's NAV (user can override)
        if (!nav) setNav(data.nav.toString());
      }
    } finally {
      setIsNavLoading(false);
    }
  }, [nav]);

  // ── Purchase date change → fetch historical NAV ────────────────────────────
  async function handleDateChange(date: string) {
    setPurchaseDate(date);
    setHistNavHint(null);
    if (!selectedFund || !date) return;
    setIsHistLoading(true);
    try {
      const res = await fetch(`/api/mf/nav-history?scheme_code=${selectedFund.schemeCode}&date=${date}`);
      if (res.ok) {
        const data = await res.json();
        setHistNavHint({ nav: data.nav, date: data.actualDate });
        // Auto-fill nav with historical NAV
        setNav(data.nav.toString());
      }
    } finally {
      setIsHistLoading(false);
    }
  }

  // ── Calculations ───────────────────────────────────────────────────────────
  const units   = amount && nav ? (parseFloat(amount) / parseFloat(nav)).toFixed(3) : '';
  const currVal = navData && units
    ? (parseFloat(units) * navData.nav).toFixed(2)
    : '';
  const returns = currVal && amount
    ? ((parseFloat(currVal) - parseFloat(amount)) / parseFloat(amount) * 100).toFixed(2)
    : '';
  const stampDuty = amount ? (parseFloat(amount) * 0.00005).toFixed(2) : '';
  const canCalc   = !!(amount && nav && selectedFund && navData);

  // ── Validation ─────────────────────────────────────────────────────────────
  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!selectedFund) errs.fund = 'Please select a fund';
    if (isSIP) {
      if (!sipAmount || parseFloat(sipAmount) <= 0) errs.sipAmount = 'Enter SIP amount';
      if (!sipDate) errs.sipDate = 'Select SIP date';
      if (!sipStart) errs.sipStart = 'Enter SIP start date';
    } else {
      if (!amount || parseFloat(amount) <= 0) errs.amount = 'Enter invested amount';
      if (!nav || parseFloat(nav) <= 0) errs.nav = 'Enter NAV at purchase';
      if (!purchaseDate) errs.purchaseDate = 'Enter purchase date';
    }
    if (!broker) errs.broker = 'Select a platform';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Save entry ─────────────────────────────────────────────────────────────
  async function handleSave(andAnother = false) {
    if (!validate()) return;
    setIsSaving(true);
    setToast(null);

    const totalUnits = isSIP && sipAmount && sipCount
      ? (parseFloat(sipAmount) * parseInt(sipCount) / parseFloat(nav)).toFixed(3)
      : units;
    const totalAmount = isSIP && sipAmount && sipCount
      ? parseFloat(sipAmount) * parseInt(sipCount)
      : parseFloat(amount);

    try {
      const res = await fetch('/api/mf/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schemeCode:     selectedFund!.schemeCode,
          schemeName:     selectedFund!.schemeName,
          category:       selectedFund!.category,
          fundHouse:      navData?.fundHouse,
          purchaseDate:   isSIP ? sipStart : purchaseDate,
          purchaseNav:    parseFloat(nav),
          investedAmount: totalAmount,
          units:          parseFloat(totalUnits || '0'),
          folio,
          planType:       plan,
          isSIP,
          sipAmount:      isSIP ? parseFloat(sipAmount) : undefined,
          portfolioName:  portfolio,
          brokerId:       broker || undefined,
          currentNav:     navData?.nav,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        setToast({ type: 'error', message: json.error ?? 'Save failed' });
        return;
      }

      setToast({ type: 'success', message: `${selectedFund!.schemeName.split(' - ')[0]} saved successfully!` });

      if (andAnother) {
        // Reset fund-specific fields, keep member/portfolio/broker
        setQuery(''); setSelectedFund(null); setNavData(null);
        setAmount(''); setNav(''); setPurchaseDate(''); setHistNavHint(null);
        setFolio(''); setSipAmount(''); setSipDate(''); setSipStart(''); setSipCount('');
        setErrors({});
      } else {
        setTimeout(() => router.push('/portfolio/mutual-funds'), 1200);
      }
    } catch (e) {
      setToast({ type: 'error', message: String(e) });
    } finally {
      setIsSaving(false);
    }
  }

  // ─── All portfolio names to show (merge DB + defaults) ────────────────────
  const allPortfolios = dbPortfolios.length > 0
    ? dbPortfolios.map((p) => p.name)
    : DEFAULT_PORTFOLIOS;

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'rgba(46,139,139,0.1)' }}>
          <BarChart3 className="w-5 h-5" style={{ color: '#2E8B8B' }} />
        </div>
        <div>
          <h1 className="font-display text-xl font-semibold" style={{ color: '#1A1A2E' }}>Mutual Funds</h1>
          <p className="text-xs" style={{ color: '#9CA3AF' }}>Add and manage your mutual fund holdings</p>
        </div>
      </div>

      {toast && <ToastBanner toast={toast} onClose={() => setToast(null)} />}

      <Tabs defaultValue="manual">
        <TabsList className="mb-5 w-full" style={{ backgroundColor: '#F7F5F0', border: '1px solid #E8E5DD' }}>
          <TabsTrigger value="manual"  className="flex-1 gap-1.5 text-xs data-[state=active]:bg-white"><BarChart3 className="w-3.5 h-3.5" />Manual Entry</TabsTrigger>
          <TabsTrigger value="import"  className="flex-1 gap-1.5 text-xs data-[state=active]:bg-white"><Upload   className="w-3.5 h-3.5" />CSV / Statement</TabsTrigger>
          <TabsTrigger value="api"     className="flex-1 gap-1.5 text-xs data-[state=active]:bg-white"><LinkIcon className="w-3.5 h-3.5" />API Fetch</TabsTrigger>
        </TabsList>

        {/* ─── Tab 1: Manual Entry ─── */}
        <TabsContent value="manual" className="space-y-4">

          {/* Step 1 — Portfolio & Broker */}
          <div className="wv-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#9CA3AF' }}>Step 1 — Portfolio & Broker</p>
            <div className="space-y-4">

              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Family Member</Label>
                <Select value={member} onValueChange={setMember}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Loading…" /></SelectTrigger>
                  <SelectContent>
                    {members.length > 0
                      ? members.map((m) => <SelectItem key={m.id} value={m.id} className="text-xs">{m.name}</SelectItem>)
                      : <SelectItem value="loading" className="text-xs" disabled>Loading members…</SelectItem>
                    }
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Portfolio</Label>
                <div className="flex flex-wrap gap-2">
                  {allPortfolios.map((p) => (
                    <button
                      key={p} onClick={() => setPortfolio(p)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-all"
                      style={{ backgroundColor: portfolio === p ? '#1B2A4A' : 'transparent', color: portfolio === p ? 'white' : '#6B7280', borderColor: portfolio === p ? '#1B2A4A' : '#E8E5DD' }}
                    >{p}</button>
                  ))}
                  <button
                    onClick={() => {
                      const name = prompt('Portfolio name:');
                      if (name?.trim()) setPortfolio(name.trim());
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium border-dashed border transition-colors"
                    style={{ color: '#C9A84C', borderColor: '#C9A84C' }}
                  >+ New</button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs" style={{ color: '#6B7280' }}>Platform / Broker</Label>
                <BrokerSelector
                  familyId={familyId}
                  selectedBrokerId={broker}
                  onChange={(id) => { setBroker(id); setErrors((e) => ({ ...e, broker: '' })); }}
                  error={errors.broker}
                />
              </div>
            </div>
          </div>

          {/* Step 2 — Fund Search */}
          <div className="wv-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#9CA3AF' }}>Step 2 — Fund Search</p>
            <FieldError msg={errors.fund} />
            <div className="relative" ref={dropRef}>
              <div className="relative">
                <Input
                  value={query}
                  onChange={(e) => handleQueryChange(e.target.value)}
                  onFocus={() => { if (searchResults.length > 0) setShowDrop(true); }}
                  placeholder="Type fund name (min 2 chars)…"
                  className="h-9 text-xs pr-8"
                  style={errors.fund ? { borderColor: '#DC2626' } : {}}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {isSearching
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: '#9CA3AF' }} />
                    : <ChevronDown className="w-3.5 h-3.5" style={{ color: '#9CA3AF' }} />
                  }
                </div>
              </div>

              {showDrop && searchResults.length > 0 && (
                <div className="absolute z-50 top-full mt-1 left-0 right-0 rounded-xl border shadow-card-hover overflow-hidden bg-white" style={{ borderColor: '#E8E5DD' }}>
                  {searchResults.map((f) => {
                    const cc = getCatStyle(f.category);
                    return (
                      <button
                        key={f.schemeCode}
                        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-bg text-left border-b last:border-0 transition-colors"
                        style={{ borderColor: '#F0EDE6' }}
                        onMouseDown={(e) => { e.preventDefault(); selectFund(f); }}
                      >
                        <div className="min-w-0 flex-1 mr-3">
                          <p className="text-xs font-medium truncate" style={{ color: '#1A1A2E' }}>{f.schemeName}</p>
                          <p className="text-[10px] mt-0.5" style={{ color: '#9CA3AF' }}>AMFI {f.schemeCode}</p>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0" style={{ backgroundColor: cc.bg, color: cc.text }}>{f.category}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Fund selected + NAV strip */}
            {selectedFund && (
              <div className="mt-3 p-3 rounded-xl flex items-start gap-3" style={{ backgroundColor: 'rgba(5,150,105,0.06)', border: '1px solid rgba(5,150,105,0.2)' }}>
                {isNavLoading
                  ? <Loader2 className="w-4 h-4 mt-0.5 flex-shrink-0 animate-spin" style={{ color: '#059669' }} />
                  : <Check className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#059669' }} />
                }
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate" style={{ color: '#1A1A2E' }}>{selectedFund.schemeName}</p>
                  {navData ? (
                    <div className="flex items-center gap-3 mt-1">
                      <p className="text-[10px]" style={{ color: '#6B7280' }}>
                        Latest NAV: <strong style={{ color: '#1A1A2E' }}>₹{navData.nav.toFixed(4)}</strong>
                        {' · '}{fmtNavDate(navData.navDate)}
                      </p>
                      {navData.fundHouse && (
                        <p className="text-[10px]" style={{ color: '#9CA3AF' }}>{navData.fundHouse}</p>
                      )}
                    </div>
                  ) : isNavLoading ? (
                    <p className="text-[10px] mt-0.5" style={{ color: '#9CA3AF' }}>Fetching live NAV…</p>
                  ) : (
                    <p className="text-[10px] mt-0.5" style={{ color: '#DC2626' }}>NAV unavailable — enter manually</p>
                  )}
                </div>
                {navData && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0" style={{ backgroundColor: getCatStyle(selectedFund.category).bg, color: getCatStyle(selectedFund.category).text }}>{selectedFund.category}</span>
                )}
              </div>
            )}
          </div>

          {/* Step 3 — Transaction Details */}
          <div className="wv-card p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#9CA3AF' }}>Step 3 — Transaction Details</p>
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: '#6B7280' }}>SIP</span>
                <button
                  onClick={() => setIsSIP(!isSIP)}
                  className="relative w-10 h-5 rounded-full transition-colors"
                  style={{ backgroundColor: isSIP ? '#C9A84C' : '#E8E5DD' }}
                >
                  <div className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform" style={{ transform: isSIP ? 'translateX(22px)' : 'translateX(2px)' }} />
                </button>
                <span className="text-xs font-semibold" style={{ color: isSIP ? '#C9A84C' : '#9CA3AF' }}>{isSIP ? 'ON' : 'OFF'}</span>
              </div>
            </div>

            {isSIP ? (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>SIP Amount (₹)</Label>
                  <Input value={sipAmount} onChange={(e) => { setSipAmount(e.target.value); setErrors((er) => ({ ...er, sipAmount: '' })); }} placeholder="5000" className="h-9 text-xs" type="number" style={errors.sipAmount ? { borderColor: '#DC2626' } : {}} />
                  <FieldError msg={errors.sipAmount} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>Monthly SIP Date</Label>
                  <Select value={sipDate} onValueChange={(v) => { setSipDate(v); setErrors((er) => ({ ...er, sipDate: '' })); }}>
                    <SelectTrigger className="h-9 text-xs" style={errors.sipDate ? { borderColor: '#DC2626' } : {}}><SelectValue placeholder="Select date" /></SelectTrigger>
                    <SelectContent>{['1st','5th','10th','15th','20th','25th','28th'].map((d) => <SelectItem key={d} value={d} className="text-xs">{d} of month</SelectItem>)}</SelectContent>
                  </Select>
                  <FieldError msg={errors.sipDate} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>SIP Start Date</Label>
                  <Input type="date" value={sipStart} onChange={(e) => { setSipStart(e.target.value); setErrors((er) => ({ ...er, sipStart: '' })); }} className="h-9 text-xs" style={errors.sipStart ? { borderColor: '#DC2626' } : {}} />
                  <FieldError msg={errors.sipStart} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>Instalments Completed</Label>
                  <Input value={sipCount} onChange={(e) => setSipCount(e.target.value)} placeholder="12" className="h-9 text-xs" type="number" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>
                    NAV (latest){navData && <span className="ml-1 text-[10px]" style={{ color: '#C9A84C' }}>₹{navData.nav.toFixed(4)}</span>}
                  </Label>
                  <Input value={nav} onChange={(e) => setNav(e.target.value)} placeholder="54.1200" className="h-9 text-xs" type="number" step="0.0001" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>Folio Number</Label>
                  <Input value={folio} onChange={(e) => setFolio(e.target.value)} placeholder="123456789" className="h-9 text-xs" />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>Invested Amount (₹)</Label>
                  <Input value={amount} onChange={(e) => { setAmount(e.target.value); setErrors((er) => ({ ...er, amount: '' })); }} placeholder="50000" className="h-9 text-xs" type="number" style={errors.amount ? { borderColor: '#DC2626' } : {}} />
                  <FieldError msg={errors.amount} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>
                    Purchase Date
                    {isHistLoading && <Loader2 className="w-2.5 h-2.5 inline ml-1 animate-spin" style={{ color: '#9CA3AF' }} />}
                  </Label>
                  <Input type="date" value={purchaseDate} onChange={(e) => { handleDateChange(e.target.value); setErrors((er) => ({ ...er, purchaseDate: '' })); }} className="h-9 text-xs" max={new Date().toISOString().split('T')[0]} style={errors.purchaseDate ? { borderColor: '#DC2626' } : {}} />
                  <FieldError msg={errors.purchaseDate} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>
                    NAV at Purchase
                    {navData && <span className="text-[10px] ml-1" style={{ color: '#C9A84C' }}>Today: ₹{navData.nav.toFixed(4)}</span>}
                  </Label>
                  {histNavHint && (
                    <p className="text-[10px]" style={{ color: '#059669' }}>
                      NAV on {fmtNavDate(histNavHint.date)}: ₹{histNavHint.nav.toFixed(4)} (auto-filled)
                    </p>
                  )}
                  <Input value={nav} onChange={(e) => { setNav(e.target.value); setErrors((er) => ({ ...er, nav: '' })); }} placeholder="54.1200" className="h-9 text-xs" type="number" step="0.0001" style={errors.nav ? { borderColor: '#DC2626' } : {}} />
                  <FieldError msg={errors.nav} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>Units Allotted (auto)</Label>
                  <Input value={units} readOnly placeholder="= Amount ÷ NAV" className="h-9 text-xs" style={{ backgroundColor: units ? 'rgba(5,150,105,0.04)' : undefined }} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>Folio Number</Label>
                  <Input value={folio} onChange={(e) => setFolio(e.target.value)} placeholder="123456789" className="h-9 text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>Plan Type</Label>
                  <Select value={plan} onValueChange={setPlan}>
                    <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{['Direct Growth','Direct IDCW','Regular Growth','Regular IDCW'].map((p) => <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs" style={{ color: '#6B7280' }}>Stamp Duty (₹) — 0.005% auto</Label>
                  <Input value={stampDuty} readOnly placeholder="0.00" className="h-9 text-xs" style={{ backgroundColor: '#F7F5F0' }} />
                </div>
              </div>
            )}

            {/* Summary strip */}
            {canCalc && (
              <div className="mt-4 p-3 rounded-xl grid grid-cols-4 gap-3" style={{ backgroundColor: 'rgba(27,42,74,0.04)', border: '1px solid rgba(27,42,74,0.08)' }}>
                <div>
                  <p className="text-[10px]" style={{ color: '#9CA3AF' }}>Invested</p>
                  <p className="text-xs font-bold" style={{ color: '#1A1A2E' }}>{formatLargeINR(parseFloat(amount))}</p>
                </div>
                <div>
                  <p className="text-[10px]" style={{ color: '#9CA3AF' }}>Current Est.</p>
                  <p className="text-xs font-bold" style={{ color: '#1A1A2E' }}>{formatLargeINR(parseFloat(currVal!))}</p>
                </div>
                <div>
                  <p className="text-[10px]" style={{ color: '#9CA3AF' }}>Returns</p>
                  <p className="text-xs font-bold flex items-center gap-0.5" style={{ color: parseFloat(returns!) >= 0 ? '#059669' : '#DC2626' }}>
                    {parseFloat(returns!) >= 0
                      ? <TrendingUp className="w-3 h-3" />
                      : <TrendingDown className="w-3 h-3" />
                    }
                    {parseFloat(returns!) >= 0 ? '+' : ''}{returns}%
                  </p>
                </div>
                <div>
                  <p className="text-[10px]" style={{ color: '#9CA3AF' }}>Units</p>
                  <p className="text-xs font-bold" style={{ color: '#1A1A2E' }}>{units}</p>
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex items-center gap-3 mt-5">
              <Button
                onClick={() => handleSave(false)}
                disabled={isSaving}
                className="flex-1 h-9 text-xs font-semibold"
                style={{ backgroundColor: '#C9A84C', color: '#1B2A4A' }}
              >
                {isSaving ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Saving…</> : 'Save entry'}
              </Button>
              <Button
                onClick={() => handleSave(true)}
                disabled={isSaving}
                className="flex-1 h-9 text-xs font-semibold text-white"
                style={{ backgroundColor: '#1B2A4A' }}
              >
                Save &amp; add another
              </Button>
              <Button
                variant="outline"
                className="h-9 text-xs"
                style={{ borderColor: '#E8E5DD', color: '#6B7280' }}
                onClick={() => router.push('/portfolio/mutual-funds')}
              >
                Cancel
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* ─── Tab 2: CSV Import ─── */}
        <TabsContent value="import">
          <div className="wv-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#9CA3AF' }}>Import CAS Statement</p>
            <CASImporter
              familyId={familyId}
              members={members}
              portfolios={dbPortfolios}
              memberId={member}
            />
          </div>
        </TabsContent>

        {/* ─── Tab 3: API Fetch ─── */}
        <TabsContent value="api">
          <div className="wv-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: '#9CA3AF' }}>Connect Platform APIs</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { name: 'MFCentral',       color: '#1B2A4A', letter: 'M', desc: 'Fetch from MFCentral portal' },
                { name: 'Kuvera',          color: '#5C6BC0', letter: 'K', desc: 'Import via Kuvera account'   },
                { name: 'Coin by Zerodha', color: '#2E8B8B', letter: 'C', desc: 'Zerodha Coin integration'    },
                { name: 'Groww',           color: '#00D09C', letter: 'G', desc: 'Groww mutual funds sync'     },
              ].map((api) => (
                <div key={api.name} className="p-4 rounded-xl border" style={{ borderColor: '#E8E5DD' }}>
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-sm font-bold" style={{ backgroundColor: api.color }}>{api.letter}</div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: '#F5EDD6', color: '#C9A84C' }}>Coming Soon</span>
                  </div>
                  <p className="text-xs font-semibold mb-0.5" style={{ color: '#1A1A2E' }}>{api.name}</p>
                  <p className="text-[11px] mb-1" style={{ color: '#9CA3AF' }}>{api.desc}</p>
                  <p className="text-[10px] mb-3" style={{ color: '#D1D5DB' }}>Requires licensed AA integration</p>
                  <Button disabled className="w-full h-7 text-[11px]" style={{ backgroundColor: '#F7F5F0', color: '#9CA3AF' }}>
                    Coming Soon
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
