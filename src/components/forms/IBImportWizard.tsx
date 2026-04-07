'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Upload, Check, AlertCircle, Loader2, ChevronDown, ChevronRight,
  FileText, ArrowRight, X, CheckCircle2, XCircle, RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { createClient } from '@/lib/supabase/client';
import { BrokerSelector } from '@/components/forms/BrokerSelector';
import { PortfolioSelector } from '@/components/forms/PortfolioSelector';
import { ibSymbolToYahoo } from '@/lib/utils/ib-csv-parser';
import type { IBParseResult } from '@/lib/utils/ib-csv-parser';
import { getCurrencySymbol } from '@/lib/utils/currency';

// ─── Types ───────────────────────────────────────────────────────────────────

interface FamilyMember { id: string; name: string }
interface Toast { type: 'success' | 'error'; message: string }

// ─── Sub-components ──────────────────────────────────────────────────────────

function StepIndicator({ step, totalSteps }: { step: number; totalSteps: number }) {
  const steps = ['Upload', 'Review', 'Assign', 'Import', 'Done'];
  return (
    <div className="flex items-center gap-1 mb-5">
      {steps.slice(0, totalSteps).map((label, i) => {
        const stepNum = i + 1;
        const isActive = stepNum === step;
        const isDone = stepNum < step;
        return (
          <div key={label} className="flex items-center gap-1">
            {i > 0 && <div className="w-6 h-px" style={{ backgroundColor: isDone ? '#059669' : 'var(--wv-border)' }} />}
            <div className="flex items-center gap-1.5">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
                style={{
                  backgroundColor: isDone ? '#059669' : isActive ? '#1B2A4A' : 'var(--wv-surface-2)',
                  color: isDone || isActive ? '#fff' : 'var(--wv-text-muted)',
                }}
              >
                {isDone ? <Check className="w-3 h-3" /> : stepNum}
              </div>
              <span
                className="text-[10px] font-medium hidden sm:inline"
                style={{ color: isActive ? 'var(--wv-text)' : 'var(--wv-text-muted)' }}
              >
                {label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ToastBanner({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const ok = toast.type === 'success';
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl mb-4 text-sm font-medium"
      style={{
        backgroundColor: ok ? 'rgba(5,150,105,0.08)' : 'rgba(220,38,38,0.08)',
        border: `1px solid ${ok ? 'rgba(5,150,105,0.2)' : 'rgba(220,38,38,0.2)'}`,
        color: ok ? '#059669' : '#DC2626',
      }}>
      {ok ? <Check className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
      <span className="flex-1">{toast.message}</span>
      <button onClick={onClose}><X className="w-3.5 h-3.5" /></button>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface IBImportWizardProps {
  initialFamilyId?: string | null;
  initialMemberId?: string;
}

export function IBImportWizard({ initialFamilyId, initialMemberId }: IBImportWizardProps) {
  const supabase = createClient();

  // ── Wizard State ──
  const [step, setStep] = useState(1);
  const [toast, setToast] = useState<Toast | null>(null);

  // ── Step 1: Upload ──
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseResult, setParseResult] = useState<IBParseResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Step 2: Review ──
  const [selectedSymbols, setSelectedSymbols] = useState<Set<string>>(new Set());
  const [expandedSymbols, setExpandedSymbols] = useState<Set<string>>(new Set());
  const [symbolMatches, setSymbolMatches] = useState<Record<string, { matched: boolean; yahooSymbol: string; name: string }>>({});
  const [matchLoading, setMatchLoading] = useState(false);

  // ── Step 3: Assign ──
  const [families, setFamilies] = useState<{ id: string; name: string }[]>([]);
  const [selectedFamily, setSelectedFamily] = useState(initialFamilyId || '');
  const [familyId, setFamilyId] = useState<string | null>(initialFamilyId || null);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [member, setMember] = useState(initialMemberId || '');
  const [brokerId, setBrokerId] = useState<string | null>(null);
  const [portfolioName, setPortfolioName] = useState('');

  // ── Step 4: Import ──
  const [importing, setImporting] = useState(false);
  const [_importProgress, setImportProgress] = useState({ current: 0, total: 0, currentSymbol: '' });
  const [fxRates, setFxRates] = useState<Record<string, Record<string, number>>>({});
  const [fxFetching, setFxFetching] = useState(false);

  // ── Step 5: Complete ──
  const [importResult, setImportResult] = useState<{
    imported: number; totalTrades: number; errors: { symbol: string; error: string }[];
  } | null>(null);

  // ── Load user/family on mount ──
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data: profile } = await supabase.from('users').select('id, name, family_id').eq('id', user.id).single();
      if (!profile) return;

      if (!initialMemberId) setMember(profile.id);
      const fid = profile.family_id;
      if (fid) {
        if (!initialFamilyId) { setFamilyId(fid); setSelectedFamily(fid); }
        const activeFid = initialFamilyId || fid;

        const { data: fUsers } = await supabase.from('users').select('id, name').eq('family_id', activeFid);
        if (fUsers && fUsers.length > 0) {
          setMembers(fUsers);
          if (initialMemberId && fUsers.find(m => m.id === initialMemberId)) setMember(initialMemberId);
        } else {
          setMembers([{ id: profile.id, name: profile.name }]);
        }

        // Load families
        const { data: primaryFam } = await supabase.from('families').select('id, name').eq('id', fid).single();
        const famList = primaryFam ? [primaryFam] : [];
        try {
          const { data: extraFams } = await supabase.from('family_memberships').select('families(id, name)').eq('auth_user_id', user.id);
          if (extraFams) {
            for (const m of extraFams) {
              const f = (m as Record<string, unknown>).families as { id: string; name: string } | undefined;
              if (f && !famList.find(x => x.id === f.id)) famList.push(f);
            }
          }
        } catch { /* table may not exist */ }
        setFamilies(famList);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Reload members on family change ──
  useEffect(() => {
    if (!selectedFamily) return;
    setFamilyId(selectedFamily);
    (async () => {
      const { data: fUsers } = await supabase.from('users').select('id, name').eq('family_id', selectedFamily);
      setMembers(fUsers ?? []);
      if (fUsers && fUsers.length > 0 && !fUsers.find(m => m.id === member)) {
        setMember(fUsers[0].id);
      }
    })();
  }, [selectedFamily]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── File handling ──
  const handleFile = useCallback((file: File) => {
    if (!file.name.endsWith('.csv')) {
      setToast({ type: 'error', message: 'Please upload a .csv file' });
      return;
    }
    setCsvFile(file);
    setParseResult(null);
    setSelectedSymbols(new Set());
    setSymbolMatches({});
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  // ── Parse CSV ──
  const handleParse = async () => {
    if (!csvFile) return;
    setParsing(true);
    setToast(null);

    try {
      const formData = new FormData();
      formData.append('file', csvFile);

      const res = await fetch('/api/stocks/global/import-ib', { method: 'POST', body: formData });
      const data = await res.json();

      if (!res.ok || data.error) {
        setToast({ type: 'error', message: data.error || 'Failed to parse CSV' });
        setParsing(false);
        return;
      }

      setParseResult(data as IBParseResult);

      // Auto-select all holdings with net quantity > 0
      const activeSymbols = new Set<string>();
      for (const h of (data as IBParseResult).holdings) {
        if (h.netQuantity > 0) activeSymbols.add(`${h.symbol}__${h.currency}`);
      }
      setSelectedSymbols(activeSymbols);

      setToast({ type: 'success', message: `Parsed ${data.summary.totalStockTrades} trades across ${data.summary.uniqueSymbols} symbols` });
      setStep(2);
    } catch (err) {
      setToast({ type: 'error', message: 'Failed to parse: ' + (err as Error).message });
    } finally {
      setParsing(false);
    }
  };

  // ── Symbol matching ──
  const matchSymbols = async () => {
    if (!parseResult) return;
    setMatchLoading(true);

    const matches: Record<string, { matched: boolean; yahooSymbol: string; name: string }> = {};

    // Batch check: for each holding, try to look up the Yahoo symbol
    for (const h of parseResult.holdings) {
      const key = `${h.symbol}__${h.currency}`;
      const yahooSym = ibSymbolToYahoo(h.symbol, h.currency);

      try {
        const res = await fetch(`/api/stocks/global/search?q=${encodeURIComponent(yahooSym)}&limit=1`);
        const data = await res.json();
        if (data.results && data.results.length > 0) {
          const match = data.results[0];
          matches[key] = { matched: true, yahooSymbol: match.symbol, name: match.companyName || match.name || h.symbol };
        } else {
          matches[key] = { matched: false, yahooSymbol: yahooSym, name: h.symbol };
        }
      } catch {
        matches[key] = { matched: false, yahooSymbol: yahooSym, name: h.symbol };
      }

      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 200));
    }

    setSymbolMatches(matches);
    setMatchLoading(false);
  };

  // Auto-match when step 2 is entered
  useEffect(() => {
    if (step === 2 && parseResult && Object.keys(symbolMatches).length === 0) {
      matchSymbols();
    }
  }, [step, parseResult]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── FX Rate Fetching ──
  const fetchFxRates = async () => {
    if (!parseResult) return;
    setFxFetching(true);

    const selectedHoldings = parseResult.holdings.filter(h => selectedSymbols.has(`${h.symbol}__${h.currency}`));

    // Collect unique (currency, date) pairs
    const pairs = new Map<string, Set<string>>();
    for (const h of selectedHoldings) {
      for (const t of h.trades) {
        if (t.currency === 'INR') continue;
        if (!pairs.has(t.currency)) pairs.set(t.currency, new Set());
        pairs.get(t.currency)!.add(t.date);
      }
    }

    const rates: Record<string, Record<string, number>> = {};

    for (const [currency, dates] of Array.from(pairs.entries())) {
      rates[currency] = {};
      const sortedDates = Array.from(dates).sort();

      // Fetch rates in batches
      for (const date of sortedDates) {
        try {
          const res = await fetch(`/api/fx/rate/history?from=${currency}&to=INR&date=${date}`);
          const data = await res.json();
          if (data.rate) {
            rates[currency][date] = data.rate;
          }
        } catch {
          // Will use fallback
        }
        // Small delay
        await new Promise(r => setTimeout(r, 100));
      }
    }

    setFxRates(rates);
    setFxFetching(false);
  };

  // ── Import ──
  const handleImport = async () => {
    if (!parseResult || !familyId || !member || !brokerId) {
      setToast({ type: 'error', message: 'Please complete all assignment fields' });
      return;
    }

    const selectedHoldings = parseResult.holdings.filter(h => selectedSymbols.has(`${h.symbol}__${h.currency}`));
    if (selectedHoldings.length === 0) {
      setToast({ type: 'error', message: 'No holdings selected' });
      return;
    }

    setImporting(true);
    setStep(4);
    setImportProgress({ current: 0, total: selectedHoldings.length, currentSymbol: '' });

    // Update holding names with matched names
    const holdingsWithNames = selectedHoldings.map(h => {
      const key = `${h.symbol}__${h.currency}`;
      const match = symbolMatches[key];
      return { ...h, name: match?.name || h.symbol };
    });

    try {
      const res = await fetch('/api/stocks/global/import-ib', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'import',
          holdings: holdingsWithNames,
          familyId,
          memberId: member,
          brokerId,
          portfolioName: portfolioName || 'Long-term Growth',
          fxRates,
        }),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        setToast({ type: 'error', message: data.error || 'Import failed' });
        setImporting(false);
        return;
      }

      setImportResult({
        imported: data.imported,
        totalTrades: data.totalTrades,
        errors: data.errors || [],
      });
      setStep(5);
    } catch (err) {
      setToast({ type: 'error', message: 'Import failed: ' + (err as Error).message });
    } finally {
      setImporting(false);
    }
  };

  // ── Selection helpers ──
  const toggleSymbol = (key: string) => {
    setSelectedSymbols(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (!parseResult) return;
    const allKeys = parseResult.holdings.map(h => `${h.symbol}__${h.currency}`);
    if (selectedSymbols.size === allKeys.length) {
      setSelectedSymbols(new Set());
    } else {
      setSelectedSymbols(new Set(allKeys));
    }
  };

  const toggleExpand = (key: string) => {
    setExpandedSymbols(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // ── Reset ──
  const handleReset = () => {
    setStep(1);
    setCsvFile(null);
    setParseResult(null);
    setSelectedSymbols(new Set());
    setExpandedSymbols(new Set());
    setSymbolMatches({});
    setImportResult(null);
    setFxRates({});
    setToast(null);
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="wv-card p-5">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--wv-text-muted)' }}>
          IB Activity Statement Import
        </p>
        {step > 1 && step < 5 && (
          <button onClick={handleReset} className="flex items-center gap-1 text-[10px] font-medium" style={{ color: '#DC2626' }}>
            <RotateCcw className="w-3 h-3" /> Start Over
          </button>
        )}
      </div>

      <StepIndicator step={step} totalSteps={5} />

      {toast && <ToastBanner toast={toast} onClose={() => setToast(null)} />}

      {/* ── Step 1: Upload ──────────────────────────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="p-3 rounded-xl text-xs" style={{ backgroundColor: 'rgba(27,42,74,0.04)', border: '1px solid rgba(27,42,74,0.08)' }}>
            <p style={{ color: 'var(--wv-text-secondary)' }}>
              Upload your <strong>Interactive Brokers Activity Statement</strong> in CSV format.
            </p>
            <p className="mt-1" style={{ color: 'var(--wv-text-muted)' }}>
              In IBKR: Reports → Statements → Activity → CSV format → Download
            </p>
          </div>

          {/* Drop zone */}
          <label
            className="flex flex-col items-center justify-center w-full h-40 rounded-xl border-2 border-dashed cursor-pointer transition-colors"
            style={{
              borderColor: dragOver ? '#C9A84C' : csvFile ? '#059669' : 'var(--wv-border)',
              backgroundColor: dragOver ? 'rgba(201,168,76,0.04)' : csvFile ? 'rgba(5,150,105,0.04)' : 'transparent',
            }}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            {csvFile ? (
              <>
                <FileText className="w-8 h-8 mb-2" style={{ color: '#059669' }} />
                <p className="text-sm font-medium" style={{ color: '#059669' }}>{csvFile.name}</p>
                <p className="text-xs mt-1" style={{ color: 'var(--wv-text-muted)' }}>
                  {(csvFile.size / 1024).toFixed(1)} KB — Click or drop to replace
                </p>
              </>
            ) : (
              <>
                <Upload className="w-8 h-8 mb-2" style={{ color: 'var(--wv-text-muted)' }} />
                <p className="text-sm font-medium" style={{ color: 'var(--wv-text-secondary)' }}>
                  Drop CSV file here or click to browse
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--wv-text-muted)' }}>.csv files only</p>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </label>

          {csvFile && (
            <Button
              onClick={handleParse}
              disabled={parsing}
              className="w-full h-10 text-xs font-semibold text-white"
              style={{ backgroundColor: '#1B2A4A' }}
            >
              {parsing ? (
                <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Parsing Statement...</>
              ) : (
                <><FileText className="w-3.5 h-3.5 mr-1.5" />Parse Statement</>
              )}
            </Button>
          )}
        </div>
      )}

      {/* ── Step 2: Review Holdings ─────────────────────────────────────────── */}
      {step === 2 && parseResult && (
        <div className="space-y-4">
          {/* Account info banner */}
          {parseResult.account.account && (
            <div className="p-3 rounded-xl flex items-center gap-3" style={{ backgroundColor: 'rgba(5,150,105,0.06)', border: '1px solid rgba(5,150,105,0.15)' }}>
              <CheckCircle2 className="w-5 h-5 flex-shrink-0" style={{ color: '#059669' }} />
              <div>
                <p className="text-xs font-semibold" style={{ color: '#059669' }}>
                  IB Activity Statement detected
                </p>
                <p className="text-[10px]" style={{ color: 'var(--wv-text-secondary)' }}>
                  Account: {parseResult.account.account} — {parseResult.account.name} — Base: {parseResult.account.baseCurrency}
                </p>
              </div>
            </div>
          )}

          {/* Summary stats */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Trades', value: parseResult.summary.totalStockTrades },
              { label: 'Symbols', value: parseResult.summary.uniqueSymbols },
              { label: 'Dividends', value: `${getCurrencySymbol('USD')}${parseResult.summary.totalDividends.toFixed(0)}` },
              { label: 'Currencies', value: parseResult.summary.currencies.join(', ') },
            ].map(s => (
              <div key={s.label} className="p-2 rounded-lg text-center" style={{ backgroundColor: 'var(--wv-surface-2)' }}>
                <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>{s.label}</p>
                <p className="text-sm font-bold" style={{ color: 'var(--wv-text)' }}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* Match status */}
          {matchLoading && (
            <div className="flex items-center gap-2 text-xs" style={{ color: '#C9A84C' }}>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Matching symbols to Yahoo Finance...
            </div>
          )}

          {/* Select all */}
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedSymbols.size === parseResult.holdings.length}
                onChange={toggleAll}
                className="w-3.5 h-3.5 rounded"
              />
              <span className="text-xs font-medium" style={{ color: 'var(--wv-text-secondary)' }}>
                Select All ({selectedSymbols.size}/{parseResult.holdings.length})
              </span>
            </label>
            <span className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>
              Active: {parseResult.holdings.filter(h => h.netQuantity > 0).length} ·
              Closed: {parseResult.holdings.filter(h => h.netQuantity <= 0).length}
            </span>
          </div>

          {/* Holdings table */}
          <div className="space-y-1 max-h-[400px] overflow-y-auto">
            {parseResult.holdings.map(h => {
              const key = `${h.symbol}__${h.currency}`;
              const isSelected = selectedSymbols.has(key);
              const isExpanded = expandedSymbols.has(key);
              const match = symbolMatches[key];
              const isActive = h.netQuantity > 0;
              const curSym = getCurrencySymbol(h.currency);

              return (
                <div key={key}>
                  <div
                    className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors"
                    style={{
                      backgroundColor: isSelected ? 'rgba(27,42,74,0.04)' : 'transparent',
                      border: `1px solid ${isSelected ? 'rgba(27,42,74,0.12)' : 'var(--wv-border)'}`,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSymbol(key)}
                      className="w-3.5 h-3.5 rounded flex-shrink-0"
                    />

                    <button onClick={() => toggleExpand(key)} className="flex-shrink-0">
                      {isExpanded ? <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--wv-text-muted)' }} /> :
                        <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--wv-text-muted)' }} />}
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold" style={{ color: 'var(--wv-text)' }}>{h.symbol}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                          style={{
                            backgroundColor: isActive ? 'rgba(5,150,105,0.1)' : 'rgba(107,114,128,0.1)',
                            color: isActive ? '#059669' : '#6B7280',
                          }}>
                          {isActive ? 'Active' : 'Closed'}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: 'rgba(201,168,76,0.1)', color: '#C9A84C' }}>
                          {h.currency}
                        </span>
                        {match && !matchLoading && (
                          match.matched ? (
                            <span className="text-[10px] flex items-center gap-0.5" style={{ color: '#059669' }}>
                              <Check className="w-3 h-3" /> {match.name !== h.symbol ? match.name : 'Matched'}
                            </span>
                          ) : (
                            <span className="text-[10px] flex items-center gap-0.5" style={{ color: '#F59E0B' }}>
                              <AlertCircle className="w-3 h-3" /> {match.yahooSymbol}
                            </span>
                          )
                        )}
                      </div>
                      {match?.name && match.name !== h.symbol && (
                        <p className="text-[10px] truncate" style={{ color: 'var(--wv-text-muted)' }}>{match.name}</p>
                      )}
                    </div>

                    <div className="text-right flex-shrink-0">
                      <p className="text-xs font-medium" style={{ color: 'var(--wv-text)' }}>
                        {h.netQuantity > 0 ? h.netQuantity.toFixed(h.netQuantity % 1 !== 0 ? 4 : 0) : '0'} shares
                      </p>
                      <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>
                        Avg: {curSym}{h.avgBuyPrice.toFixed(2)}
                      </p>
                    </div>

                    <div className="text-right flex-shrink-0 w-20">
                      <p className="text-xs font-medium" style={{ color: 'var(--wv-text)' }}>
                        {curSym}{h.totalInvested.toFixed(0)}
                      </p>
                      <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>
                        {h.trades.length} trades
                      </p>
                    </div>
                  </div>

                  {/* Expanded trades */}
                  {isExpanded && (
                    <div className="ml-10 mr-2 mb-2 rounded-lg overflow-hidden" style={{ border: '1px solid var(--wv-border)' }}>
                      <table className="w-full text-[10px]">
                        <thead>
                          <tr style={{ backgroundColor: 'var(--wv-surface-2)' }}>
                            <th className="px-2 py-1.5 text-left font-medium" style={{ color: 'var(--wv-text-muted)' }}>Date</th>
                            <th className="px-2 py-1.5 text-left font-medium" style={{ color: 'var(--wv-text-muted)' }}>Type</th>
                            <th className="px-2 py-1.5 text-right font-medium" style={{ color: 'var(--wv-text-muted)' }}>Qty</th>
                            <th className="px-2 py-1.5 text-right font-medium" style={{ color: 'var(--wv-text-muted)' }}>Price</th>
                            <th className="px-2 py-1.5 text-right font-medium" style={{ color: 'var(--wv-text-muted)' }}>Fee</th>
                            <th className="px-2 py-1.5 text-right font-medium" style={{ color: 'var(--wv-text-muted)' }}>P&L</th>
                          </tr>
                        </thead>
                        <tbody>
                          {h.trades.map((t, i) => (
                            <tr key={i} style={{ borderTop: '1px solid var(--wv-border)' }}>
                              <td className="px-2 py-1" style={{ color: 'var(--wv-text-secondary)' }}>{t.date}</td>
                              <td className="px-2 py-1">
                                <span className="font-bold" style={{ color: t.type === 'buy' ? '#059669' : '#DC2626' }}>
                                  {t.type.toUpperCase()}
                                </span>
                              </td>
                              <td className="px-2 py-1 text-right" style={{ color: 'var(--wv-text)' }}>
                                {t.quantity.toFixed(t.quantity % 1 !== 0 ? 4 : 0)}
                              </td>
                              <td className="px-2 py-1 text-right" style={{ color: 'var(--wv-text)' }}>
                                {curSym}{t.price.toFixed(2)}
                              </td>
                              <td className="px-2 py-1 text-right" style={{ color: '#DC2626' }}>
                                {t.commission > 0 ? `-${curSym}${t.commission.toFixed(2)}` : '-'}
                              </td>
                              <td className="px-2 py-1 text-right" style={{ color: t.realizedPnl >= 0 ? '#059669' : '#DC2626' }}>
                                {t.type === 'sell' ? `${t.realizedPnl >= 0 ? '+' : ''}${curSym}${t.realizedPnl.toFixed(2)}` : '-'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {/* Holding summary row */}
                      <div className="px-3 py-2 flex items-center justify-between" style={{ backgroundColor: 'var(--wv-surface-2)', borderTop: '1px solid var(--wv-border)' }}>
                        <span className="text-[10px] font-medium" style={{ color: 'var(--wv-text-muted)' }}>
                          Bought: {h.totalBought.toFixed(h.totalBought % 1 !== 0 ? 4 : 0)} · Sold: {h.totalSold.toFixed(h.totalSold % 1 !== 0 ? 4 : 0)} · Net: {h.netQuantity.toFixed(h.netQuantity % 1 !== 0 ? 4 : 0)}
                        </span>
                        <span className="text-[10px] font-medium" style={{ color: 'var(--wv-text-muted)' }}>
                          Commissions: {curSym}{h.totalCommissions.toFixed(2)}
                          {h.totalRealizedPnl !== 0 && (
                            <> · Realized P&L: <span style={{ color: h.totalRealizedPnl >= 0 ? '#059669' : '#DC2626' }}>
                              {h.totalRealizedPnl >= 0 ? '+' : ''}{curSym}{h.totalRealizedPnl.toFixed(2)}
                            </span></>
                          )}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Dividends & WHT summary */}
          {(parseResult.dividends.length > 0 || parseResult.withholdingTax.length > 0) && (
            <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(201,168,76,0.04)', border: '1px solid rgba(201,168,76,0.15)' }}>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: '#C9A84C' }}>
                Also found in statement
              </p>
              <div className="flex gap-4 text-xs" style={{ color: 'var(--wv-text-secondary)' }}>
                {parseResult.dividends.length > 0 && (
                  <span>{parseResult.dividends.length} dividend entries (${parseResult.summary.totalDividends.toFixed(2)})</span>
                )}
                {parseResult.withholdingTax.length > 0 && (
                  <span>{parseResult.withholdingTax.length} withholding tax entries (${Math.abs(parseResult.summary.totalWithholdingTax).toFixed(2)})</span>
                )}
                {parseResult.corporateActions.length > 0 && (
                  <span>{parseResult.corporateActions.length} corporate actions</span>
                )}
              </div>
              <p className="text-[10px] mt-1" style={{ color: 'var(--wv-text-muted)' }}>
                Dividends and corporate actions can be added manually after import.
              </p>
            </div>
          )}

          {/* Navigation */}
          <div className="flex gap-3">
            <Button onClick={() => setStep(1)} variant="outline" className="h-9 text-xs px-4"
              style={{ borderColor: 'var(--wv-border)', color: 'var(--wv-text-secondary)' }}>
              Back
            </Button>
            <Button
              onClick={() => setStep(3)}
              disabled={selectedSymbols.size === 0}
              className="flex-1 h-9 text-xs font-semibold text-white"
              style={{ backgroundColor: '#1B2A4A' }}
            >
              Continue with {selectedSymbols.size} holdings <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 3: Assign ──────────────────────────────────────────────────── */}
      {step === 3 && parseResult && (
        <div className="space-y-4">
          <div className="p-3 rounded-xl text-xs" style={{ backgroundColor: 'rgba(27,42,74,0.04)', border: '1px solid rgba(27,42,74,0.08)' }}>
            <p style={{ color: 'var(--wv-text-secondary)' }}>
              Assign the imported holdings to a family member, broker, and portfolio.
            </p>
          </div>

          {/* Account name hint */}
          {parseResult.account.name && (
            <div className="p-2 rounded-lg flex items-center gap-2" style={{ backgroundColor: 'rgba(5,150,105,0.04)', border: '1px solid rgba(5,150,105,0.1)' }}>
              <CheckCircle2 className="w-3.5 h-3.5" style={{ color: '#059669' }} />
              <span className="text-[10px]" style={{ color: '#059669' }}>
                IB Account holder: <strong>{parseResult.account.name}</strong> — Select the matching family member below
              </span>
            </div>
          )}

          {/* Family selector */}
          {families.length > 1 && (
            <div className="space-y-1.5">
              <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Family</Label>
              <Select value={selectedFamily} onValueChange={v => { setSelectedFamily(v); setFamilyId(v); }}>
                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Select family" /></SelectTrigger>
                <SelectContent>
                  {families.map(f => <SelectItem key={f.id} value={f.id} className="text-xs">{f.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Member selector */}
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Family Member *</Label>
            <Select value={member} onValueChange={setMember}>
              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Select member" /></SelectTrigger>
              <SelectContent>
                {members.map(m => <SelectItem key={m.id} value={m.id} className="text-xs">{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Broker selector */}
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Broker *</Label>
            <BrokerSelector
              familyId={familyId}
              memberId={member}
              selectedBrokerId={brokerId}
              onChange={setBrokerId}
            />
          </div>

          {/* Portfolio selector */}
          <div className="space-y-1.5">
            <Label className="text-xs" style={{ color: 'var(--wv-text-secondary)' }}>Portfolio *</Label>
            <PortfolioSelector
              familyId={familyId}
              memberId={member}
              selectedPortfolioName={portfolioName}
              onChange={setPortfolioName}
            />
          </div>

          {/* Navigation */}
          <div className="flex gap-3">
            <Button onClick={() => setStep(2)} variant="outline" className="h-9 text-xs px-4"
              style={{ borderColor: 'var(--wv-border)', color: 'var(--wv-text-secondary)' }}>
              Back
            </Button>
            <Button
              onClick={async () => {
                if (!brokerId) {
                  setToast({ type: 'error', message: 'Please select a broker' });
                  return;
                }
                if (!portfolioName) {
                  setToast({ type: 'error', message: 'Please select a portfolio' });
                  return;
                }
                // Fetch FX rates then import
                await fetchFxRates();
                handleImport();
              }}
              disabled={!member || !brokerId || !portfolioName || fxFetching || importing}
              className="flex-1 h-9 text-xs font-semibold text-white"
              style={{ backgroundColor: '#1B2A4A' }}
            >
              {fxFetching ? (
                <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Fetching FX Rates...</>
              ) : importing ? (
                <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Importing...</>
              ) : (
                <>Import {selectedSymbols.size} Holdings</>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 4: Importing ───────────────────────────────────────────────── */}
      {step === 4 && importing && (
        <div className="space-y-4 py-8">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-10 h-10 animate-spin" style={{ color: '#C9A84C' }} />
            <div className="text-center">
              <p className="text-sm font-semibold" style={{ color: 'var(--wv-text)' }}>
                Importing Holdings...
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--wv-text-muted)' }}>
                This may take a moment. Please don&apos;t close this page.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Step 5: Complete ─────────────────────────────────────────────────── */}
      {step === 5 && importResult && (
        <div className="space-y-4 py-4">
          <div className="flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(5,150,105,0.1)' }}>
              <CheckCircle2 className="w-8 h-8" style={{ color: '#059669' }} />
            </div>
            <div className="text-center">
              <p className="text-lg font-bold" style={{ color: '#059669' }}>Import Complete!</p>
              <p className="text-sm mt-1" style={{ color: 'var(--wv-text-secondary)' }}>
                Successfully imported <strong>{importResult.imported}</strong> holdings with <strong>{importResult.totalTrades}</strong> trades
              </p>
            </div>
          </div>

          {/* Error list */}
          {importResult.errors.length > 0 && (
            <div className="p-3 rounded-xl" style={{ backgroundColor: 'rgba(220,38,38,0.04)', border: '1px solid rgba(220,38,38,0.15)' }}>
              <p className="text-xs font-semibold mb-1" style={{ color: '#DC2626' }}>
                {importResult.errors.length} errors during import:
              </p>
              {importResult.errors.map((e, i) => (
                <p key={i} className="text-[10px]" style={{ color: '#DC2626' }}>
                  <XCircle className="w-3 h-3 inline mr-1" />{e.symbol}: {e.error}
                </p>
              ))}
            </div>
          )}

          {/* Summary */}
          {parseResult && (
            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 rounded-xl text-center" style={{ backgroundColor: 'var(--wv-surface-2)' }}>
                <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>Holdings</p>
                <p className="text-lg font-bold" style={{ color: 'var(--wv-text)' }}>{importResult.imported}</p>
              </div>
              <div className="p-3 rounded-xl text-center" style={{ backgroundColor: 'var(--wv-surface-2)' }}>
                <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>Trades</p>
                <p className="text-lg font-bold" style={{ color: 'var(--wv-text)' }}>{importResult.totalTrades}</p>
              </div>
              <div className="p-3 rounded-xl text-center" style={{ backgroundColor: 'var(--wv-surface-2)' }}>
                <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>Currencies</p>
                <p className="text-lg font-bold" style={{ color: 'var(--wv-text)' }}>{parseResult.summary.currencies.length}</p>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <Button
              onClick={() => window.location.href = '/portfolio/global-stocks'}
              className="flex-1 h-10 text-xs font-semibold text-white"
              style={{ backgroundColor: '#1B2A4A' }}
            >
              View Portfolio
            </Button>
            <Button
              onClick={handleReset}
              variant="outline"
              className="h-10 text-xs px-6"
              style={{ borderColor: 'var(--wv-border)', color: 'var(--wv-text-secondary)' }}
            >
              Import Another
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
