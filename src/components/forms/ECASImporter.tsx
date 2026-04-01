'use client';

/**
 * ECASImporter — Full transaction-level eCAS statement import
 * Supports CAMS / MFCentral PDF, CSV, and Excel formats.
 *
 * Steps:
 *  0 → Upload & parse
 *  1 → Review funds + transactions
 *  2 → Assign metadata (broker / portfolio / member)
 *  3 → Importing / Done
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Upload, FileText, Loader2, Check, AlertCircle, ChevronDown, ChevronUp,
  Search, X, ArrowLeft, ArrowRight,
} from 'lucide-react';
import { Button }  from '@/components/ui/button';
import { Input }   from '@/components/ui/input';
import { Label }   from '@/components/ui/label';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR } from '@/lib/utils/formatters';
import type { ECASTransactionType } from '@/lib/services/ecas-parser';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParsedTransaction {
  transactionDate: string;
  transactionType: ECASTransactionType;
  rawType: string;
  amount: number;
  units: number;
  nav: number;
  unitBalance: number;
}

interface ParsedFund {
  fundHouse: string;
  schemeName: string;
  folioNumber: string;
  isin?: string;
  transactions: ParsedTransaction[];
  closingUnits?: number;
  matchedSchemeCode: number | null;
  matchedSchemeName?: string;
  matchConfidence: 'high' | 'low' | 'none';
  summary: {
    totalUnits: number;
    totalInvested: number;
    avgNav: number;
    transactionCount: number;
  };
}

interface ParseResponse {
  funds: ParsedFund[];
  totalFunds: number;
  parseErrors: string[];
  sourceFilename: string;
}

interface FamilyMember { id: string; name: string }
interface Portfolio    { id: string; name: string; type: string }
interface Broker       { id: string; name: string }

interface ECASImporterProps {
  familyId:   string | null;
  members:    FamilyMember[];
  portfolios: Portfolio[];
  memberId:   string;
  onImported?: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TXN_BADGE: Record<ECASTransactionType, { label: string; bg: string; color: string }> = {
  purchase:              { label: 'Purchase',         bg: '#EFF6FF', color: '#2563EB' },
  sip:                   { label: 'SIP',              bg: '#EFF6FF', color: '#2563EB' },
  redemption:            { label: 'Redemption',       bg: '#FEF2F2', color: '#DC2626' },
  switch_in:             { label: 'Switch In',        bg: '#F0FDFA', color: '#0D9488' },
  switch_out:            { label: 'Switch Out',       bg: '#FFF7ED', color: '#EA580C' },
  dividend_payout:       { label: 'Dividend Payout',  bg: '#F0FDF4', color: '#16A34A' },
  dividend_reinvestment: { label: 'Dividend Reinv.',  bg: '#F0FDF4', color: '#16A34A' },
  other:                 { label: 'Other',            bg: 'var(--wv-border)', color: 'var(--wv-text-secondary)' },
};

const CONFIDENCE_BADGE = {
  high: { label: 'Matched',   bg: 'rgba(5,150,105,0.1)',  color: '#059669' },
  low:  { label: 'Review',    bg: '#FEF3C7',              color: '#D97706' },
  none: { label: 'Not Found', bg: '#FEE2E2',              color: '#DC2626' },
};

const PORTFOLIO_OPTIONS = ['Long-term Growth', 'Retirement', 'Tax Saving', 'Joint', 'Trading'];

// ─── Sub-components ───────────────────────────────────────────────────────────

function StepDot({ n, current }: { n: number; current: number }) {
  const done   = n < current;
  const active = n === current;
  return (
    <div
      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
      style={{
        backgroundColor: done ? '#059669' : active ? '#1B2A4A' : '#E5E7EB',
        color: done || active ? 'white' : '#9CA3AF',
      }}
    >
      {done ? <Check className="w-3.5 h-3.5" /> : n + 1}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ECASImporter({ familyId, members, portfolios: propPortfolios, memberId, onImported }: ECASImporterProps) {
  const supabase = createClient();

  // ── Step & core state
  const [step, setStep]             = useState(0);
  const [parsedData, setParsedData] = useState<ParseResponse | null>(null);
  const [parseErrors, setParseErrors] = useState<string[]>([]);

  // ── Upload state
  const [file, setFile]           = useState<File | null>(null);
  const [password, setPassword]   = useState('');
  const [isPDF, setIsPDF]         = useState(false);
  const [dragOver, setDragOver]   = useState(false);
  const [parsing, setParsing]     = useState(false);
  const [parseErr, setParseErr]   = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Review state
  const [selectedFunds, setSelectedFunds] = useState<Set<number>>(new Set());
  const [selectedTxns,  setSelectedTxns]  = useState<Map<number, Set<number>>>(new Map());
  const [expandedFunds, setExpandedFunds] = useState<Set<number>>(new Set());
  const [schemeOverrides, setSchemeOverrides] = useState<Map<number, { schemeCode: number; schemeName: string }>>(new Map());
  const [fundSearches, setFundSearches] = useState<Map<number, { query: string; results: { schemeCode: number; schemeName: string }[]; searching: boolean }>>(new Map());

  // ── Metadata state
  const [globalBrokerId, setGlobalBrokerId]     = useState('');
  const [globalPortfolio, setGlobalPortfolio]   = useState(propPortfolios[0]?.name ?? 'Imported Portfolio');
  const [globalMemberId, setGlobalMemberId]     = useState(memberId);
  const [brokers, setBrokers] = useState<Broker[]>([]);

  // ── Import state
  const [importing, setImporting]   = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; txns: number; invested: number; errors: string[] } | null>(null);

  // Load brokers on mount
  useEffect(() => {
    if (!familyId) return;
    supabase.from('brokers').select('id,name').eq('family_id', familyId).eq('is_active', true)
      .then(({ data }) => { if (data) setBrokers(data); });
  }, [familyId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── File selection
  const handleFileSelect = useCallback((f: File) => {
    setFile(f);
    setParseErr('');
    setIsPDF(f.name.toLowerCase().endsWith('.pdf'));
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFileSelect(f);
  }, [handleFileSelect]);

  // ── Parse
  const handleParse = async () => {
    if (!file) return;
    setParsing(true); setParseErr('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (password) fd.append('password', password);
      const res = await fetch('/api/mf/parse-ecas', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) { setParseErr(json.error ?? 'Parse failed'); return; }
      setParsedData(json as ParseResponse);
      setParseErrors((json as ParseResponse).parseErrors ?? []);
      // Pre-select all funds + all transactions
      const allFunds = new Set<number>();
      const allTxns  = new Map<number, Set<number>>();
      (json as ParseResponse).funds.forEach((f: ParsedFund, fi: number) => {
        allFunds.add(fi);
        allTxns.set(fi, new Set(f.transactions.map((_, ti) => ti)));
      });
      setSelectedFunds(allFunds);
      setSelectedTxns(allTxns);
      setStep(1);
    } catch (e) {
      setParseErr(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setParsing(false);
    }
  };

  // ── Fund search (for unmatched)
  const searchFund = useCallback(async (fi: number, query: string) => {
    setFundSearches(prev => {
      const next = new Map(prev);
      next.set(fi, { query, results: prev.get(fi)?.results ?? [], searching: true });
      return next;
    });
    try {
      const res = await fetch(`/api/mf/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setFundSearches(prev => {
        const next = new Map(prev);
        next.set(fi, { query, results: data.results ?? [], searching: false });
        return next;
      });
    } catch {
      setFundSearches(prev => {
        const next = new Map(prev);
        const cur = next.get(fi);
        if (cur) next.set(fi, { ...cur, searching: false });
        return next;
      });
    }
  }, []);

  // ── Selection helpers
  const toggleFund = (fi: number) => {
    setSelectedFunds(prev => {
      const next = new Set(prev);
      if (next.has(fi)) next.delete(fi); else next.add(fi);
      return next;
    });
  };

  const toggleTxn = (fi: number, ti: number) => {
    setSelectedTxns(prev => {
      const next = new Map(prev);
      const set = new Set(next.get(fi) ?? []);
      if (set.has(ti)) set.delete(ti); else set.add(ti);
      next.set(fi, set);
      return next;
    });
  };

  const toggleAllTxns = (fi: number, fund: ParsedFund, select: boolean) => {
    setSelectedTxns(prev => {
      const next = new Map(prev);
      next.set(fi, select ? new Set(fund.transactions.map((_, i) => i)) : new Set());
      return next;
    });
  };

  const toggleExpand = (fi: number) => {
    setExpandedFunds(prev => {
      const next = new Set(prev);
      if (next.has(fi)) next.delete(fi); else next.add(fi);
      return next;
    });
  };

  const selectAll   = () => setSelectedFunds(new Set(parsedData?.funds.map((_, i) => i) ?? []));
  const deselectAll = () => setSelectedFunds(new Set());

  // ── Import
  const handleImport = async () => {
    if (!parsedData) return;
    setImporting(true);
    try {
      const funds = parsedData.funds
        .map((fund, fi) => {
          if (!selectedFunds.has(fi)) return null;
          const txIndices = selectedTxns.get(fi) ?? new Set();
          const override  = schemeOverrides.get(fi);
          const transactions = fund.transactions
            .filter((_, ti) => txIndices.has(ti))
            .map(t => ({
              date:   t.transactionDate,
              type:   mapImportType(t.transactionType),
              amount: t.amount,
              units:  Math.abs(t.units),
              nav:    t.nav,
            }));
          if (transactions.length === 0) return null;

          // Calculate totalUnits from closing balance or sum of transactions
          const totalUnits = fund.closingUnits ?? fund.transactions.reduce((s, t) => s + t.units, 0);

          return {
            schemeName:   fund.schemeName,
            schemeCode:   override?.schemeCode ?? fund.matchedSchemeCode,
            folio:        fund.folioNumber,
            totalUnits:   Math.max(0, totalUnits),
            avgNav:       fund.summary.avgNav,
            transactions,
            currentNav:   null,
            brokerId:     globalBrokerId || null,
            portfolioName: globalPortfolio || 'Imported Portfolio',
            userId:        globalMemberId || memberId,
          };
        })
        .filter(Boolean);

      if (funds.length === 0) return;

      const res = await fetch('/api/mf/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          funds,
          sourceFilename: parsedData.sourceFilename,
          sourceType: 'ecas',
        }),
      });

      const json = await res.json();
      const txCount = funds.reduce((s, f) => s + (f?.transactions.length ?? 0), 0);
      const invested = funds.reduce((s, f) => {
        const inv = f?.transactions.filter(t => t.type === 'buy' || t.type === 'sip').reduce((a, t) => a + t.amount, 0) ?? 0;
        return s + inv;
      }, 0);

      setImportResult({
        imported: json.imported ?? 0,
        txns: txCount,
        invested,
        errors: json.errors ?? [],
      });
      setStep(3);
      onImported?.();
    } catch (e) {
      setImportResult({ imported: 0, txns: 0, invested: 0, errors: [e instanceof Error ? e.message : 'Import failed'] });
      setStep(3);
    } finally {
      setImporting(false);
    }
  };

  function mapImportType(t: ECASTransactionType): 'buy' | 'sip' | 'sell' | 'dividend' | 'switch' {
    if (t === 'sip') return 'sip';
    if (t === 'redemption') return 'sell';
    if (t === 'dividend_payout' || t === 'dividend_reinvestment') return 'dividend';
    if (t === 'switch_in' || t === 'switch_out') return 'switch';
    return 'buy';
  }

  // ── Derived
  const readyCount   = parsedData?.funds.filter(f => f.matchConfidence === 'high').length ?? 0;
  const reviewCount  = parsedData?.funds.filter(f => f.matchConfidence === 'low').length ?? 0;
  const noneCount    = parsedData?.funds.filter(f => f.matchConfidence === 'none').length ?? 0;
  const selFundCount = selectedFunds.size;
  const selTxnCount  = Array.from(selectedTxns.entries())
    .filter(([fi]) => selectedFunds.has(fi))
    .reduce((s, [, set]) => s + set.size, 0);

  const STEPS = ['Upload', 'Review', 'Assign', 'Done'];

  // ─────────────────────────────────────────────────────────────────────────────
  // ── Step 0: Upload
  // ─────────────────────────────────────────────────────────────────────────────
  if (step === 0) return (
    <div className="space-y-5">
      {/* Step indicator */}
      <StepIndicator steps={STEPS} current={0} />

      {/* Info banner */}
      <div className="rounded-xl p-4 text-xs space-y-1" style={{ backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE' }}>
        <p className="font-semibold" style={{ color: '#1D4ED8' }}>Import your complete transaction history</p>
        <p style={{ color: '#3B82F6' }}>
          Download your eCAS statement from{' '}
          <a href="https://www.mfcentral.com" target="_blank" rel="noopener noreferrer" className="underline">mfcentral.com</a>
          {' '}or{' '}
          <a href="https://www.camsonline.com" target="_blank" rel="noopener noreferrer" className="underline">camsonline.com</a>.
          Supports CSV, Excel (.xlsx), and PDF formats.
        </p>
      </div>

      {/* Drag-drop zone */}
      <div
        className="relative rounded-xl flex flex-col items-center justify-center gap-3 cursor-pointer transition-colors"
        style={{
          border: `2px dashed ${dragOver ? '#1B2A4A' : '#D1D5DB'}`,
          backgroundColor: dragOver ? 'rgba(27,42,74,0.04)' : '#FAFAF8',
          minHeight: 160,
          padding: 24,
        }}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
      >
        <input
          ref={fileRef} type="file"
          accept=".csv,.xlsx,.xls,.pdf,.txt"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
        />
        {file ? (
          <div className="flex items-center gap-3">
            <FileText className="w-8 h-8" style={{ color: 'var(--wv-text)' }} />
            <div>
              <p className="font-semibold text-sm" style={{ color: 'var(--wv-text)' }}>{file.name}</p>
              <p className="text-xs" style={{ color: 'var(--wv-text-muted)' }}>{(file.size / 1024).toFixed(1)} KB</p>
            </div>
            <button
              onClick={e => { e.stopPropagation(); setFile(null); setIsPDF(false); }}
              className="p-1 rounded hover:bg-gray-100"
            >
              <X className="w-4 h-4" style={{ color: 'var(--wv-text-muted)' }} />
            </button>
          </div>
        ) : (
          <>
            <Upload className="w-8 h-8" style={{ color: 'var(--wv-text-muted)' }} />
            <div className="text-center">
              <p className="font-medium text-sm" style={{ color: 'var(--wv-text)' }}>Drop your eCAS statement here</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--wv-text-muted)' }}>PDF, CSV, or Excel • Click to browse</p>
            </div>
          </>
        )}
      </div>

      {/* PDF password */}
      {isPDF && (
        <div className="space-y-1">
          <Label className="text-xs font-medium" style={{ color: '#374151' }}>
            PDF Password <span style={{ color: 'var(--wv-text-muted)' }}>(usually your PAN number)</span>
          </Label>
          <Input
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="e.g. ABCDE1234F"
            type="text"
            className="text-sm uppercase"
            style={{ letterSpacing: '0.05em' }}
          />
        </div>
      )}

      {parseErr && (
        <div className="flex items-start gap-2 p-3 rounded-lg text-xs" style={{ backgroundColor: '#FEF2F2', color: '#DC2626' }}>
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <p>{parseErr}</p>
        </div>
      )}

      <Button
        disabled={!file || parsing}
        onClick={handleParse}
        className="w-full h-10 text-sm font-semibold"
        style={{ backgroundColor: '#1B2A4A', color: 'white' }}
      >
        {parsing ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Parsing statement&hellip;</> : 'Parse Statement'}
      </Button>
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // ── Step 1: Review Funds + Transactions
  // ─────────────────────────────────────────────────────────────────────────────
  if (step === 1 && parsedData) return (
    <div className="space-y-4">
      <StepIndicator steps={STEPS} current={1} />

      {/* Summary bar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm font-semibold" style={{ color: 'var(--wv-text)' }}>
            {parsedData.totalFunds} fund{parsedData.totalFunds !== 1 ? 's' : ''} found
          </span>
          <span className="text-xs" style={{ color: 'var(--wv-text-muted)' }}>
            {parsedData.funds.reduce((s, f) => s + f.transactions.length, 0)} transactions
          </span>
          {readyCount > 0 && <MatchPill label={`${readyCount} matched`} color="#059669" bg="rgba(5,150,105,0.1)" />}
          {reviewCount > 0 && <MatchPill label={`${reviewCount} review`} color="#D97706" bg="#FEF3C7" />}
          {noneCount > 0 && <MatchPill label={`${noneCount} not found`} color="#DC2626" bg="#FEE2E2" />}
        </div>
        <div className="flex gap-2">
          <button onClick={selectAll}   className="text-xs underline" style={{ color: 'var(--wv-text)' }}>Select all</button>
          <button onClick={deselectAll} className="text-xs underline" style={{ color: 'var(--wv-text-secondary)' }}>Deselect all</button>
        </div>
      </div>

      {parseErrors.length > 0 && (
        <div className="p-3 rounded-lg text-xs" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>
          <p className="font-semibold mb-1">Parse warnings:</p>
          {parseErrors.map((e, i) => <p key={i}>• {e}</p>)}
        </div>
      )}

      {/* Fund list */}
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--wv-border)' }}>
        {parsedData.funds.map((fund, fi) => {
          const isSelected = selectedFunds.has(fi);
          const isExpanded = expandedFunds.has(fi);
          const conf       = fund.matchConfidence;
          const badge      = CONFIDENCE_BADGE[conf];
          const txSet      = selectedTxns.get(fi) ?? new Set<number>();
          const override   = schemeOverrides.get(fi);
          const search     = fundSearches.get(fi);

          return (
            <div key={fi} style={{ borderBottom: fi < parsedData.funds.length - 1 ? '1px solid var(--wv-border)' : undefined }}>
              {/* Fund row */}
              <div
                className="flex items-start gap-3 p-3 hover:bg-[#FAFAF8] transition-colors"
                style={{ opacity: isSelected ? 1 : 0.5 }}
              >
                {/* Checkbox */}
                <button
                  onClick={() => toggleFund(fi)}
                  className="w-4 h-4 mt-0.5 rounded flex-shrink-0 flex items-center justify-center border transition-colors"
                  style={{
                    backgroundColor: isSelected ? '#1B2A4A' : 'white',
                    borderColor: isSelected ? '#1B2A4A' : '#D1D5DB',
                  }}
                >
                  {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                </button>

                {/* Fund info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2 flex-wrap">
                    <p className="text-xs font-semibold leading-snug" style={{ color: 'var(--wv-text)' }}>{fund.schemeName}</p>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: badge.bg, color: badge.color }}>
                      {badge.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    {fund.fundHouse && <span className="text-[11px]" style={{ color: 'var(--wv-text-muted)' }}>{fund.fundHouse}</span>}
                    {fund.folioNumber && <span className="text-[11px]" style={{ color: 'var(--wv-text-muted)' }}>Folio: {fund.folioNumber}</span>}
                    <span className="text-[11px]" style={{ color: 'var(--wv-text-muted)' }}>{fund.summary.transactionCount} txns</span>
                    <span className="text-[11px]" style={{ color: 'var(--wv-text-muted)' }}>{fund.summary.totalUnits.toFixed(4)} units</span>
                    <span className="text-[11px] font-medium" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(fund.summary.totalInvested)} invested</span>
                  </div>

                  {/* Matched scheme name */}
                  {(override ?? (conf !== 'none' && fund.matchedSchemeName)) && (
                    <p className="text-[10px] mt-0.5" style={{ color: '#059669' }}>
                      → {override?.schemeName ?? fund.matchedSchemeName}
                    </p>
                  )}

                  {/* Fund search for unmatched / low-confidence */}
                  {(conf === 'none' || conf === 'low') && isSelected && (
                    <div className="mt-2">
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3" style={{ color: 'var(--wv-text-muted)' }} />
                          <input
                            className="w-full text-[11px] rounded-md pl-6 pr-3 py-1.5 border"
                            style={{ borderColor: '#E5E7EB', outline: 'none' }}
                            placeholder="Search AMFI scheme to link…"
                            value={search?.query ?? ''}
                            onChange={e => searchFund(fi, e.target.value)}
                          />
                        </div>
                        {search?.searching && <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" style={{ color: 'var(--wv-text-muted)' }} />}
                      </div>
                      {search && search.results.length > 0 && (
                        <div className="mt-1 rounded-md border overflow-hidden" style={{ borderColor: '#E5E7EB' }}>
                          {search.results.slice(0, 5).map(r => (
                            <button
                              key={r.schemeCode}
                              className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-[#F7F5F0] transition-colors block"
                              style={{ borderBottom: '1px solid var(--wv-border)', color: 'var(--wv-text)' }}
                              onClick={() => {
                                setSchemeOverrides(prev => { const m = new Map(prev); m.set(fi, r); return m; });
                                setFundSearches(prev => { const m = new Map(prev); m.delete(fi); return m; });
                              }}
                            >
                              <span className="font-medium">{r.schemeName}</span>
                              <span className="ml-2" style={{ color: 'var(--wv-text-muted)' }}>#{r.schemeCode}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Expand button */}
                <button
                  onClick={() => toggleExpand(fi)}
                  className="flex items-center gap-1 text-[11px] flex-shrink-0 mt-0.5 px-2 py-1 rounded transition-colors hover:bg-gray-100"
                  style={{ color: 'var(--wv-text-secondary)' }}
                >
                  {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  {txSet.size}/{fund.transactions.length}
                </button>
              </div>

              {/* Expanded transactions */}
              {isExpanded && (
                <div style={{ backgroundColor: '#FAFAF8', borderTop: '1px solid var(--wv-border)' }}>
                  <div className="px-4 py-2 flex items-center justify-between">
                    <span className="text-[11px] font-medium" style={{ color: 'var(--wv-text-secondary)' }}>Transactions</span>
                    <div className="flex gap-3">
                      <button className="text-[11px] underline" style={{ color: 'var(--wv-text)' }} onClick={() => toggleAllTxns(fi, fund, true)}>Select all</button>
                      <button className="text-[11px] underline" style={{ color: 'var(--wv-text-secondary)' }} onClick={() => toggleAllTxns(fi, fund, false)}>None</button>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px]" style={{ minWidth: 560 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--wv-border)' }}>
                          {['', 'Date', 'Type', 'Amount', 'Units', 'NAV', 'Balance'].map(h => (
                            <th key={h} className="px-3 py-1.5 text-left font-medium" style={{ color: 'var(--wv-text-muted)' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {fund.transactions.map((txn, ti) => {
                          const tSelected = txSet.has(ti);
                          const tBadge = TXN_BADGE[txn.transactionType] ?? TXN_BADGE.other;
                          return (
                            <tr
                              key={ti}
                              style={{ borderBottom: '1px solid var(--wv-border)', opacity: tSelected ? 1 : 0.4 }}
                            >
                              <td className="px-3 py-1.5">
                                <button
                                  onClick={() => toggleTxn(fi, ti)}
                                  className="w-3.5 h-3.5 rounded flex items-center justify-center border"
                                  style={{ backgroundColor: tSelected ? '#1B2A4A' : 'white', borderColor: tSelected ? '#1B2A4A' : '#D1D5DB' }}
                                >
                                  {tSelected && <Check className="w-2 h-2 text-white" />}
                                </button>
                              </td>
                              <td className="px-3 py-1.5 whitespace-nowrap" style={{ color: 'var(--wv-text-secondary)' }}>
                                {txn.transactionDate}
                              </td>
                              <td className="px-3 py-1.5">
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap" style={{ backgroundColor: tBadge.bg, color: tBadge.color }}>
                                  {tBadge.label}
                                </span>
                              </td>
                              <td className="px-3 py-1.5 whitespace-nowrap text-right font-medium" style={{ color: 'var(--wv-text)' }}>
                                {txn.amount > 0 ? `₹${txn.amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—'}
                              </td>
                              <td className="px-3 py-1.5 whitespace-nowrap text-right" style={{ color: txn.units < 0 ? '#DC2626' : '#6B7280' }}>
                                {txn.units >= 0 ? '+' : ''}{txn.units.toFixed(4)}
                              </td>
                              <td className="px-3 py-1.5 whitespace-nowrap text-right" style={{ color: 'var(--wv-text-secondary)' }}>
                                {txn.nav > 0 ? `₹${txn.nav.toFixed(4)}` : '—'}
                              </td>
                              <td className="px-3 py-1.5 whitespace-nowrap text-right" style={{ color: 'var(--wv-text-muted)' }}>
                                {txn.unitBalance.toFixed(4)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Nav */}
      <div className="flex items-center justify-between pt-2">
        <button onClick={() => setStep(0)} className="flex items-center gap-1 text-sm" style={{ color: 'var(--wv-text-secondary)' }}>
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <Button
          disabled={selFundCount === 0}
          onClick={() => setStep(2)}
          className="h-9 px-5 text-sm font-semibold"
          style={{ backgroundColor: '#1B2A4A', color: 'white' }}
        >
          Continue with {selFundCount} fund{selFundCount !== 1 ? 's' : ''}, {selTxnCount} transactions
          <ArrowRight className="w-4 h-4 ml-1.5" />
        </Button>
      </div>
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // ── Step 2: Assign Metadata
  // ─────────────────────────────────────────────────────────────────────────────
  if (step === 2) return (
    <div className="space-y-5">
      <StepIndicator steps={STEPS} current={2} />

      <div>
        <p className="text-sm font-semibold mb-1" style={{ color: 'var(--wv-text)' }}>Assign metadata</p>
        <p className="text-xs" style={{ color: 'var(--wv-text-muted)' }}>Applied to all imported funds. You can change individual funds from the portfolio page later.</p>
      </div>

      {/* Summary card */}
      <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--wv-surface-2)', border: '1px solid var(--wv-border)' }}>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-lg font-bold" style={{ color: 'var(--wv-text)' }}>{selFundCount}</p>
            <p className="text-xs" style={{ color: 'var(--wv-text-muted)' }}>Funds</p>
          </div>
          <div>
            <p className="text-lg font-bold" style={{ color: 'var(--wv-text)' }}>{selTxnCount}</p>
            <p className="text-xs" style={{ color: 'var(--wv-text-muted)' }}>Transactions</p>
          </div>
          <div>
            <p className="text-lg font-bold" style={{ color: 'var(--wv-text)' }}>
              {formatLargeINR(
                parsedData?.funds
                  .filter((_, fi) => selectedFunds.has(fi))
                  .reduce((s, f) => s + f.summary.totalInvested, 0) ?? 0
              )}
            </p>
            <p className="text-xs" style={{ color: 'var(--wv-text-muted)' }}>Invested</p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {/* Broker */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium" style={{ color: '#374151' }}>Distributor / Platform</Label>
          <select
            className="w-full rounded-md border px-3 py-2 text-sm"
            style={{ borderColor: '#E5E7EB', color: 'var(--wv-text)', backgroundColor: 'var(--wv-surface)' }}
            value={globalBrokerId}
            onChange={e => setGlobalBrokerId(e.target.value)}
          >
            <option value="">— None / Unknown —</option>
            {brokers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>

        {/* Portfolio */}
        <div className="space-y-1.5">
          <Label className="text-xs font-medium" style={{ color: '#374151' }}>Portfolio</Label>
          <select
            className="w-full rounded-md border px-3 py-2 text-sm"
            style={{ borderColor: '#E5E7EB', color: 'var(--wv-text)', backgroundColor: 'var(--wv-surface)' }}
            value={globalPortfolio}
            onChange={e => setGlobalPortfolio(e.target.value)}
          >
            {PORTFOLIO_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
            {propPortfolios.filter(p => !PORTFOLIO_OPTIONS.includes(p.name)).map(p => (
              <option key={p.id} value={p.name}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* Family member */}
        {members.length > 1 && (
          <div className="space-y-1.5">
            <Label className="text-xs font-medium" style={{ color: '#374151' }}>Family Member</Label>
            <select
              className="w-full rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: '#E5E7EB', color: 'var(--wv-text)', backgroundColor: 'var(--wv-surface)' }}
              value={globalMemberId}
              onChange={e => setGlobalMemberId(e.target.value)}
            >
              {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Nav */}
      <div className="flex items-center justify-between pt-2">
        <button onClick={() => setStep(1)} className="flex items-center gap-1 text-sm" style={{ color: 'var(--wv-text-secondary)' }}>
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <Button
          disabled={importing}
          onClick={handleImport}
          className="h-10 px-6 text-sm font-semibold"
          style={{ backgroundColor: '#C9A84C', color: 'var(--wv-text)' }}
        >
          {importing
            ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Importing&hellip;</>
            : <>Import {selTxnCount} transactions across {selFundCount} funds</>}
        </Button>
      </div>
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // ── Step 3: Done
  // ─────────────────────────────────────────────────────────────────────────────
  if (step === 3 && importResult) return (
    <div className="space-y-5">
      <StepIndicator steps={STEPS} current={3} />

      <div className="rounded-xl p-6 text-center space-y-3" style={{ backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0' }}>
        <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto" style={{ backgroundColor: '#059669' }}>
          <Check className="w-6 h-6 text-white" />
        </div>
        <p className="font-bold text-lg" style={{ color: '#059669' }}>Import Complete!</p>
        <div className="grid grid-cols-3 gap-4 pt-2">
          <div>
            <p className="text-xl font-bold" style={{ color: 'var(--wv-text)' }}>{importResult.imported}</p>
            <p className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Funds imported</p>
          </div>
          <div>
            <p className="text-xl font-bold" style={{ color: 'var(--wv-text)' }}>{importResult.txns}</p>
            <p className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Transactions</p>
          </div>
          <div>
            <p className="text-xl font-bold" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(importResult.invested)}</p>
            <p className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Total invested</p>
          </div>
        </div>
      </div>

      {importResult.errors.length > 0 && (
        <div className="rounded-lg p-3 text-xs space-y-1" style={{ backgroundColor: '#FEF2F2', color: '#DC2626' }}>
          <p className="font-semibold">Some funds had errors:</p>
          {importResult.errors.map((e, i) => <p key={i}>• {e}</p>)}
        </div>
      )}

      <div className="flex gap-3">
        <Button
          onClick={() => { setStep(0); setFile(null); setParsedData(null); setImportResult(null); }}
          variant="outline" className="flex-1 h-9 text-sm"
        >
          Import Another
        </Button>
        <Button
          onClick={() => window.location.href = '/portfolio/mutual-funds'}
          className="flex-1 h-9 text-sm font-semibold"
          style={{ backgroundColor: '#1B2A4A', color: 'white' }}
        >
          View Portfolio
        </Button>
      </div>
    </div>
  );

  return null;
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function StepIndicator({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="flex items-center gap-0">
      {steps.map((label, i) => (
        <div key={i} className="flex items-center gap-0 flex-1 last:flex-none">
          <div className="flex flex-col items-center gap-1">
            <StepDot n={i} current={current} />
            <span className="text-[10px]" style={{ color: i <= current ? '#1B2A4A' : '#9CA3AF', fontWeight: i === current ? 600 : 400 }}>{label}</span>
          </div>
          {i < steps.length - 1 && (
            <div className="flex-1 h-px mx-1 mb-4" style={{ backgroundColor: i < current ? '#059669' : '#E5E7EB' }} />
          )}
        </div>
      ))}
    </div>
  );
}

function MatchPill({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: bg, color }}>
      {label}
    </span>
  );
}
