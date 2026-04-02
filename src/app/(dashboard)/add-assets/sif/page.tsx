'use client';

import { useState, useRef, useEffect, useCallback, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { Shield, Loader2, AlertCircle, Check, X, ChevronDown, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR } from '@/lib/utils/formatters';
import { holdingsCacheClearAll } from '@/lib/utils/holdings-cache';
import { PortfolioSelector } from '@/components/forms/PortfolioSelector';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SearchResult { schemeCode: string; schemeName: string; category: string; amc?: string; planType?: string }
interface NavData { nav: number; navDate: string; fundName: string; fundHouse: string; category: string }
interface FamilyMember { id: string; name: string }
interface Toast { type: 'success' | 'error'; message: string }

// ─── Constants ────────────────────────────────────────────────────────────────

const CAT_COLORS: Record<string, { bg: string; text: string }> = {
  Equity:               { bg: 'rgba(27,42,74,0.08)',    text: '#1B2A4A' },
  ELSS:                 { bg: '#F5EDD6',                text: '#C9A84C' },
  Hybrid:               { bg: 'rgba(46,139,139,0.08)',  text: '#2E8B8B' },
  Debt:                 { bg: 'rgba(5,150,105,0.08)',   text: '#059669' },
  Liquid:               { bg: 'rgba(5,150,105,0.08)',   text: '#059669' },
  Gilt:                 { bg: 'rgba(5,150,105,0.08)',   text: '#059669' },
  'Index/ETF':          { bg: 'rgba(27,42,74,0.08)',    text: '#1B2A4A' },
  Commodity:            { bg: 'rgba(201,168,76,0.15)',  text: '#92620A' },
  International:        { bg: 'rgba(99,102,241,0.10)',  text: '#4338CA' },
  'Sectoral/Thematic':  { bg: 'rgba(234,88,12,0.10)',   text: '#C2410C' },
  Arbitrage:            { bg: 'rgba(46,139,139,0.08)',  text: '#2E8B8B' },
  // SIF-specific categories
  'Long-Short Equity':       { bg: 'rgba(27,42,74,0.08)',   text: '#1B2A4A' },
  'Hybrid Long-Short':       { bg: 'rgba(46,139,139,0.08)', text: '#2E8B8B' },
  'Sector Rotation':         { bg: 'rgba(234,88,12,0.10)',  text: '#C2410C' },
  'Tactical Asset Allocation':{ bg: 'rgba(99,102,241,0.10)', text: '#4338CA' },
};

function getCatStyle(cat: string) { return CAT_COLORS[cat] ?? { bg: 'var(--wv-border)', text: '#6B7280' }; }

// ─── detectCategory — same as MF module + SIF-specific ───────────────────────

function detectCategory(schemeName: string, apiCategory: string): string {
  const n = schemeName.toUpperCase();

  // SIF-specific categories
  if (/\bLONG[\s-]*SHORT\s*EQUITY\b/.test(n)) return 'Long-Short Equity';
  if (/\bHYBRID\s*LONG[\s-]*SHORT\b/.test(n)) return 'Hybrid Long-Short';
  if (/\bSECTOR\s*ROTATION\b/.test(n)) return 'Sector Rotation';
  if (/\bTACTICAL\s*ASSET\s*ALLOC/i.test(n)) return 'Tactical Asset Allocation';

  // Tax-saving
  if (/\bELSS\b|TAX\s*SAVER|TAX\s*SAVING|\b80C\b/.test(n)) return 'ELSS';

  // Commodity
  if (/\bGOLD\b|\bSILVER\b|\bCOMMODIT|\bPRECIOUS\s*METAL|\bGOLD\s*BEES\b|\bGOLD\s*ETF\b|\bGOLD\s*FUND\b|\bGOLD\s*SAVINGS\b/.test(n)) return 'Commodity';

  // International
  if (/\bINTERNATIONAL\b|\bGLOBAL\b|\bUS\s*EQUITY\b|\bNASDAQ\b|\bNAVDAQ\b|\bS&P\b|\bFEEDER\b|\bFOF\b|\bFUND\s*OF\s*FUND/.test(n)) return 'International';

  // Index / Passive
  if (/\bINDEX\b|\bNIFTY\b|\bSENSEX\b|\bETF\b/.test(n)) return 'Index/ETF';

  // Sectoral / Thematic
  if (/\bSECTORAL\b|\bTHEMATIC\b|\bINFRASTRUCTUR|\bPHARMA\b|\bHEALTH(CARE)?\b|\bIT\s*FUND\b|\bTECHNOLOG|\bCONSUMPTION\b|\bESG\b|\bPSU\b|\bBSE\s*PSEB|\bENERGY\b|\bAUTO\b|\bBANKING\s*FUND\b|\bINNOVATION\b|\bMANUFACTURING\b/.test(n)) return 'Sectoral/Thematic';

  // Debt sub-types
  if (/\bOVERNIGHT\b/.test(n)) return 'Debt';
  if (/\bLIQUID\b|\bMONEY\s*MARKET\b/.test(n)) return 'Liquid';
  if (/\bGILT\b|\bG-?SEC\b|\bSOVEREIGN\b/.test(n)) return 'Gilt';
  if (/\bDEBT\b|\bBOND\b|\bCREDIT\s*RISK\b|\bDURATION\b|\bINCOME\b|\bCORPORATE\s*BOND\b|\bFIXED\s*INCOME\b|\bBANKING\s*&?\s*PSU\b|\bULTRA\s*SHORT\b|\bLOW\s*DURATION\b|\bSHORT\s*DURATION\b|\bMEDIUM\s*DURATION\b|\bLONG\s*DURATION\b/.test(n)) return 'Debt';

  // Hybrid
  if (/\bHYBRID\b|\bBALANCED\b|\bAGGRESSIVE\b|\bCONSERVATIVE\b|\bARBITRAGE\b|\bBAF\b|\bDAA\b|\bMULTI\s*ASSET\b/.test(n)) return 'Hybrid';

  // Fall back to normalised API category
  const ac = apiCategory.toUpperCase();
  if (ac.includes('GOLD') || ac.includes('SILVER') || ac.includes('COMMODITY') || ac.includes('PRECIOUS METAL')) return 'Commodity';
  if (ac.includes('INTERNATIONAL') || ac.includes('GLOBAL') || ac.includes('OVERSEAS') || ac.includes('FEEDER') || ac.includes('FOF')) return 'International';
  if (ac.includes('ELSS')) return 'ELSS';
  if (ac.includes('INDEX') || ac.includes('ETF')) return 'Index/ETF';
  if (ac.includes('SECTORAL') || ac.includes('THEMATIC')) return 'Sectoral/Thematic';
  if (ac.includes('OVERNIGHT') || ac.includes('LIQUID') || ac.includes('MONEY MARKET')) return 'Liquid';
  if (ac.includes('GILT') || ac.includes('G-SEC') || ac.includes('SOVEREIGN')) return 'Gilt';
  if (ac.includes('DEBT') || ac.includes('BOND') || ac.includes('INCOME') || ac.includes('CREDIT') || ac.includes('DURATION') || ac.includes('CORPORATE') || ac.includes('BANKING AND PSU') || ac.includes('BANKING & PSU')) return 'Debt';
  if (ac.includes('HYBRID') || ac.includes('BALANCED') || ac.includes('ARBITRAGE') || ac.includes('MULTI ASSET')) return 'Hybrid';

  return 'Equity';
}

function fmtNavDate(raw: string): string {
  if (!raw) return '';
  const [d, m, y] = raw.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${parseInt(d)} ${months[parseInt(m)-1]} ${y}`;
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

  // ── Fund search ─────────────────────────────────────────────────────────
  const [query, setQuery] = useState('');
  const [showDrop, setShowDrop] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedFund, setSelectedFund] = useState<SearchResult | null>(null);
  const [navData, setNavData] = useState<NavData | null>(null);
  const [isNavLoading, setIsNavLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const dropRef = useRef<HTMLDivElement>(null);

  // ── Form fields ───────────────────────────────────────────────────────────
  const [portfolio, setPortfolio] = useState('');
  const [txnType, setTxnType] = useState<'lumpsum' | 'sip'>('lumpsum');
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [nav, setNav] = useState('');
  const [navAutoFetched, setNavAutoFetched] = useState(false);
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
    setPortfolio('');
    (async () => {
      const { data: fUsers } = await supabase.from('users').select('id, name').eq('family_id', selectedFamily);
      setMembers(fUsers ?? []);
      if (fUsers?.length) setMember(fUsers[0].id);
    })();
  }, [selectedFamily]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Close dropdown on outside click ─────────────────────────────────────
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setShowDrop(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

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

  // ── Manual entry mode ──────────────────────────────────────────────────
  const [manualMode, setManualMode] = useState(false);
  const [manualFundName, setManualFundName] = useState('');
  const [manualAmc, setManualAmc] = useState('');

  // ── Fund search handler (debounced) — searches SIF registry ───────────
  function handleQueryChange(val: string) {
    setQuery(val);
    setSelectedFund(null);
    setNavData(null);
    setNav('');
    setNavAutoFetched(false);
    setManualMode(false);
    clearTimeout(debounceRef.current);
    if (val.length < 2) { setSearchResults([]); setShowDrop(false); return; }
    setIsSearching(true);
    setShowDrop(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/sif/search?q=${encodeURIComponent(val)}`);
        if (!res.ok) { setIsSearching(false); return; }
        const json = await res.json();
        setSearchResults(json.results ?? []);
      } catch {
        // search failed silently
      } finally { setIsSearching(false); }
    }, 300);
  }

  function enterManualMode() {
    setManualMode(true);
    setShowDrop(false);
    setManualFundName(query);
    setSelectedFund(null);
    setNavData(null);
  }

  // ── Select fund from dropdown ───────────────────────────────────────────
  const selectFund = useCallback(async (fund: SearchResult) => {
    const refinedFund = { ...fund, category: detectCategory(fund.schemeName, fund.category) };
    setSelectedFund(refinedFund);
    setQuery(fund.schemeName);
    setShowDrop(false);
    setManualMode(false);
    setNavData(null);
    setErrors(er => ({ ...er, fund: '' }));

    // SIF NAVs are NOT on mfapi.in — skip auto-fetch for SIF scheme codes (non-numeric)
    const isNumericCode = /^\d+$/.test(String(fund.schemeCode));
    if (isNumericCode) {
      setIsNavLoading(true);
      try {
        const res = await fetch(`/api/mf/nav?scheme_code=${fund.schemeCode}`);
        if (res.ok) {
          const data: NavData = await res.json();
          setNavData(data);
          if (!nav || navAutoFetched) {
            setNav(data.nav.toString());
            setNavAutoFetched(true);
            setUnitsManuallyEdited(false);
          }
        }
      } finally { setIsNavLoading(false); }
    }
    // For non-numeric (SIF registry) codes, NAV must be entered manually
  }, [nav, navAutoFetched]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Computed summary ───────────────────────────────────────────────────────
  const parsedAmount = parseFloat(amount) || 0;
  const parsedStampDuty = parseFloat(stampDuty) || 0;
  const totalInvestment = parsedAmount + parsedStampDuty;
  const parsedUnits = parseFloat(units) || 0;
  const avgNav = parsedUnits > 0 ? parsedAmount / parsedUnits : 0;

  // ── Validation ─────────────────────────────────────────────────────────────
  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!selectedFund && !manualMode) errs.fund = 'Please search and select a fund';
    if (manualMode && !manualFundName.trim()) errs.fund = 'Enter the fund name';
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

    const fundName = manualMode
      ? manualFundName.trim()
      : (navData?.fundName || selectedFund?.schemeName || query.trim());
    const amc = manualMode
      ? manualAmc.trim()
      : (navData?.fundHouse || selectedFund?.amc || '');
    const schemeCode = selectedFund?.schemeCode ? String(selectedFund.schemeCode) : null;

    const payload = {
      fundName,
      amc: amc || null,
      schemeCode,
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
      familyId: familyId || undefined,
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

      setToast({ type: 'success', message: `${fundName} saved successfully!` });
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
          style={{ backgroundColor: 'var(--wv-surface-2)' }}>
          <Shield className="w-5 h-5" style={{ color: 'var(--wv-text)' }} />
        </div>
        <div>
          <h1 className="font-display text-xl font-semibold" style={{ color: 'var(--wv-text)' }}>
            Specialized Investment Fund (SIF)
          </h1>
          <p className="text-xs" style={{ color: 'var(--wv-text-muted)' }}>
            Search SEBI Specialized Investment Funds or enter manually
          </p>
        </div>
      </div>

      {toast && <ToastBanner toast={toast} onClose={() => setToast(null)} />}

      <div className="wv-card p-5 space-y-5">
        {/* ── Family & Member ────────────────────────────────────────────── */}
        {families.length > 1 && (
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Family</Label>
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
            <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Member</Label>
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
        <div className="border-t" style={{ borderColor: 'var(--wv-border)' }} />

        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#C9A84C' }}>
          Fund Search
        </p>

        {/* ── Fund Search (AMFI) ──────────────────────────────────────────── */}
        <div className="space-y-1.5">
          <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>
            Search Fund *
          </Label>
          <FieldError msg={errors.fund} />
          <div className="relative" ref={dropRef}>
            <div className="relative">
              <Input
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
                onFocus={() => { if (searchResults.length > 0) setShowDrop(true); }}
                placeholder="Search SIF (e.g. QSIF, Long Short, ICICI SIF)..."
                className="h-9 text-xs pr-8 pl-8"
                style={errors.fund ? { borderColor: '#DC2626' } : {}}
              />
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: 'var(--wv-text-muted)' }} />
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                {isSearching
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--wv-text-muted)' }} />
                  : <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--wv-text-muted)' }} />}
              </div>
            </div>

            {/* Dropdown results */}
            {showDrop && !isSearching && query.length >= 2 && (
              <div className="absolute top-full mt-1 left-0 right-0 rounded-xl border overflow-hidden bg-white max-h-80 overflow-y-auto"
                style={{ borderColor: 'var(--wv-border)', zIndex: 9999, boxShadow: '0 8px 32px rgba(0,0,0,0.12)' }}>
                {searchResults.map((f) => {
                  const cc = getCatStyle(detectCategory(f.schemeName, f.category));
                  return (
                    <button key={f.schemeCode}
                      className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 text-left border-b last:border-0 transition-colors"
                      style={{ borderColor: '#F0EDE6' }}
                      onMouseDown={(e) => { e.preventDefault(); selectFund(f); }}>
                      <div className="min-w-0 flex-1 mr-3">
                        <p className="text-xs font-medium truncate" style={{ color: 'var(--wv-text)' }}>{f.schemeName}</p>
                        <p className="text-[10px] mt-0.5" style={{ color: 'var(--wv-text-muted)' }}>
                          {f.amc ?? ''}{f.amc ? ' · ' : ''}{f.schemeCode}
                        </p>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0"
                        style={{ backgroundColor: cc.bg, color: cc.text }}>
                        {detectCategory(f.schemeName, f.category)}
                      </span>
                    </button>
                  );
                })}
                {searchResults.length === 0 && (
                  <div className="px-4 py-3 text-center">
                    <p className="text-xs" style={{ color: 'var(--wv-text-muted)' }}>No SIF schemes found for &ldquo;{query}&rdquo;</p>
                  </div>
                )}
                {/* Manual entry fallback */}
                <button
                  className="w-full px-4 py-2.5 text-left border-t transition-colors hover:bg-gray-50"
                  style={{ borderColor: '#F0EDE6' }}
                  onMouseDown={(e) => { e.preventDefault(); enterManualMode(); }}>
                  <p className="text-xs font-medium" style={{ color: '#C9A84C' }}>
                    Can&apos;t find your SIF? Enter details manually &rarr;
                  </p>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Selected Fund Card ────────────────────────────────────────── */}
        {selectedFund && (
          <div className="p-3 rounded-xl flex items-start gap-3"
            style={{ backgroundColor: 'rgba(5,150,105,0.06)', border: '1px solid rgba(5,150,105,0.2)' }}>
            {isNavLoading
              ? <Loader2 className="w-4 h-4 mt-0.5 flex-shrink-0 animate-spin" style={{ color: '#059669' }} />
              : <Check className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: '#059669' }} />}
            <div className="flex-1 min-w-0">
              {navData?.fundName && navData.fundName !== selectedFund.schemeName ? (
                <>
                  <p className="text-xs font-semibold truncate" style={{ color: 'var(--wv-text)' }}>{navData.fundName}</p>
                  <p className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--wv-text-muted)' }}>
                    {selectedFund.schemeName}
                  </p>
                </>
              ) : (
                <p className="text-xs font-semibold truncate" style={{ color: 'var(--wv-text)' }}>{selectedFund.schemeName}</p>
              )}
              <p className="text-[10px] mt-0.5" style={{ color: 'var(--wv-text-muted)' }}>
                {selectedFund.amc ? `${selectedFund.amc} · ` : ''}Code: {selectedFund.schemeCode}
              </p>
              {navData ? (
                <div className="flex items-center gap-3 mt-1">
                  <p className="text-[10px]" style={{ color: 'var(--wv-text-secondary)' }}>
                    Latest NAV: <strong style={{ color: 'var(--wv-text)' }}>{'\u20B9'}{navData.nav.toFixed(4)}</strong>
                    {' \u00B7 '}{fmtNavDate(navData.navDate)}
                  </p>
                </div>
              ) : isNavLoading ? (
                <p className="text-[10px] mt-0.5" style={{ color: 'var(--wv-text-muted)' }}>Fetching live NAV...</p>
              ) : (
                <p className="text-[10px] mt-0.5" style={{ color: '#92620A' }}>
                  Live NAV not available for this SIF yet. Enter NAV manually below.
                </p>
              )}
            </div>
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                style={{ backgroundColor: getCatStyle(selectedFund.category).bg, color: getCatStyle(selectedFund.category).text }}>
                {selectedFund.category}
              </span>
              <button
                onClick={() => { setSelectedFund(null); setQuery(''); setNavData(null); setNav(''); setNavAutoFetched(false); }}
                className="text-[10px] px-1.5 py-0.5 rounded hover:bg-red-50"
                style={{ color: '#DC2626' }}>
                Clear
              </button>
            </div>
          </div>
        )}

        {/* ── Manual Entry Card ──────────────────────────────────────────── */}
        {manualMode && !selectedFund && (
          <div className="p-4 rounded-xl space-y-3"
            style={{ backgroundColor: 'rgba(201,168,76,0.06)', border: '1px solid rgba(201,168,76,0.2)' }}>
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold" style={{ color: '#C9A84C' }}>Manual SIF Entry</p>
              <button
                onClick={() => { setManualMode(false); setQuery(''); }}
                className="text-[10px] px-2 py-0.5 rounded hover:bg-gray-100"
                style={{ color: 'var(--wv-text-muted)' }}>
                Back to search
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2">
                <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Fund Name *</Label>
                <Input
                  value={manualFundName}
                  onChange={e => { setManualFundName(e.target.value); setErrors(er => ({ ...er, fund: '' })); }}
                  placeholder="e.g. QSIF Equity Long Short Fund - Direct Plan"
                  className="h-9 text-xs"
                  style={errors.fund ? { borderColor: '#DC2626' } : {}}
                />
                <FieldError msg={errors.fund} />
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>AMC / Fund House</Label>
                <Input
                  value={manualAmc}
                  onChange={e => setManualAmc(e.target.value)}
                  placeholder="e.g. Quant Mutual Fund"
                  className="h-9 text-xs"
                />
              </div>
            </div>
            <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>
              Enter the SIF NAV manually below. Live NAV is not available for manually entered SIFs.
            </p>
          </div>
        )}

        {/* ── Divider ────────────────────────────────────────────────────── */}
        <div className="border-t" style={{ borderColor: 'var(--wv-border)' }} />

        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#C9A84C' }}>
          Transaction Details
        </p>

        {/* ── Transaction Type ───────────────────────────────────────────── */}
        <div className="space-y-2">
          <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Transaction Type</Label>
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
            <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Purchase Date *</Label>
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
            <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>
              NAV ({'\u20B9'}) *
              {navAutoFetched && navData && (
                <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                  style={{ backgroundColor: 'rgba(5,150,105,0.1)', color: '#059669' }}>
                  auto
                </span>
              )}
            </Label>
            <Input
              type="number"
              value={nav}
              onChange={(e) => {
                setNav(e.target.value);
                setNavAutoFetched(false);
                setErrors(er => ({ ...er, nav: '' }));
                setUnitsManuallyEdited(false);
              }}
              placeholder="0.0000"
              step="0.0001"
              className="h-9 text-xs"
              style={errors.nav ? { borderColor: '#DC2626' } : {}}
            />
            {navData ? (
              <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>
                Live NAV: {'\u20B9'}{navData.nav.toFixed(4)} as of {fmtNavDate(navData.navDate)}
              </p>
            ) : (
              <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>
                {selectedFund ? 'NAV unavailable - enter manually' : 'Select a fund to auto-fetch NAV'}
              </p>
            )}
            <FieldError msg={errors.nav} />
          </div>
        </div>

        {/* ── Amount + Units ──────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Investment Amount ({'\u20B9'}) *</Label>
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
            <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>
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
            <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Folio Number (optional)</Label>
            <Input
              value={folio}
              onChange={(e) => setFolio(e.target.value)}
              placeholder="e.g. 12345678"
              className="h-9 text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Stamp Duty ({'\u20B9'})</Label>
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
          <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Notes (optional)</Label>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add any notes about this SIF investment..."
            className="h-9 text-xs"
          />
        </div>

        {/* ── Divider ────────────────────────────────────────────────────── */}
        <div className="border-t" style={{ borderColor: 'var(--wv-border)' }} />

        {/* ── Summary ────────────────────────────────────────────────────── */}
        {(parsedAmount > 0 || parsedUnits > 0) && (
          <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--wv-surface-2)', border: '1px solid var(--wv-border)' }}>
            <p className="text-xs font-semibold mb-3" style={{ color: 'var(--wv-text)' }}>Investment Summary</p>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: 'var(--wv-text-muted)' }}>Total Investment</p>
                <p className="text-sm font-semibold" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(totalInvestment)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: 'var(--wv-text-muted)' }}>Units Acquired</p>
                <p className="text-sm font-semibold" style={{ color: 'var(--wv-text)' }}>
                  {parsedUnits > 0 ? parsedUnits.toLocaleString('en-IN', { minimumFractionDigits: 4, maximumFractionDigits: 4 }) : '\u2014'}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: 'var(--wv-text-muted)' }}>Avg NAV</p>
                <p className="text-sm font-semibold" style={{ color: 'var(--wv-text)' }}>
                  {avgNav > 0 ? `\u20B9${avgNav.toFixed(4)}` : '\u2014'}
                </p>
              </div>
            </div>
            {navData && parsedUnits > 0 && (
              <div className="grid grid-cols-2 gap-4 mt-3 pt-3 border-t" style={{ borderColor: 'var(--wv-border)' }}>
                <div>
                  <p className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: 'var(--wv-text-muted)' }}>Current Value (Live NAV)</p>
                  <p className="text-sm font-semibold" style={{ color: 'var(--wv-text)' }}>
                    {formatLargeINR(parsedUnits * navData.nav)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: 'var(--wv-text-muted)' }}>Unrealised P&L</p>
                  {(() => {
                    const cv = parsedUnits * navData.nav;
                    const pnl = cv - parsedAmount;
                    const up = pnl >= 0;
                    return (
                      <p className="text-sm font-semibold" style={{ color: up ? '#059669' : '#DC2626' }}>
                        {up ? '+' : ''}{formatLargeINR(pnl)}
                      </p>
                    );
                  })()}
                </div>
              </div>
            )}
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
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--wv-text)' }} />
        </div>
      </div>
    }>
      <SifAddContent />
    </Suspense>
  );
}
