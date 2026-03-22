'use client';

import { useState, useRef, useCallback } from 'react';
import {
  Upload, FileText, Check, AlertCircle, Loader2, Download,
  X, RefreshCw,
} from 'lucide-react';
import { Button }   from '@/components/ui/button';
import { Input }    from '@/components/ui/input';
import { Label }    from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BrokerSelector } from './BrokerSelector';
import { parseCasFile, TEMPLATE_CSV_CONTENT } from '@/lib/services/cas-parser';
import type { ParsedFund } from '@/lib/services/cas-parser';
import { formatLargeINR } from '@/lib/utils/formatters';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FamilyMember { id: string; name: string }
interface Portfolio    { id: string; name: string; type: string }

interface CASImporterProps {
  familyId:    string | null;
  members:     FamilyMember[];
  portfolios:  Portfolio[];
  memberId:    string;    // currently selected member
}

interface EnrichedFund extends ParsedFund {
  currentNav:   number | null;
  currentValue: number | null;
  // Per-fund overrides
  assignedBrokerId?:   string;
  assignedPortfolio?:  string;
  assignedMemberId?:   string;
  // Inline search state
  showSearch?:   boolean;
  searchQuery?:  string;
  searchResults?: { schemeCode: number; schemeName: string }[];
  isSearching?:  boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: 'ready' | 'needs_review' }) {
  const ok = status === 'ready';
  return (
    <span
      className="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{
        backgroundColor: ok ? 'rgba(5,150,105,0.1)' : '#F5EDD6',
        color:           ok ? '#059669' : '#C9A84C',
      }}
    >
      {ok ? 'Ready' : 'Needs review'}
    </span>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function CASImporter({ familyId, members, portfolios, memberId }: CASImporterProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Step: 1 = upload, 2 = preview+assign, 3 = done ────────────────────────
  const [step,         setStep]         = useState<1 | 2 | 3>(1);

  // ── Parse state ────────────────────────────────────────────────────────────
  const [isDragging,   setIsDragging]   = useState(false);
  const [fileName,     setFileName]     = useState<string | null>(null);
  const [isParsing,    setIsParsing]    = useState(false);
  const [parseError,   setParseError]   = useState<string | null>(null);
  const [funds,        setFunds]        = useState<EnrichedFund[]>([]);
  const [selected,     setSelected]     = useState<Set<string>>(new Set());

  // ── Assign metadata ────────────────────────────────────────────────────────
  const defaultPortfolio = portfolios[0]?.name ?? 'Imported Portfolio';
  const [brokerId,     setBrokerId]     = useState<string>('');
  const [portfolio,    setPortfolio]    = useState(defaultPortfolio);
  const [assignMember, setAssignMember] = useState(memberId);

  // ── Import state ───────────────────────────────────────────────────────────
  const [isImporting,   setIsImporting]   = useState(false);
  const [_importProgress,setImportProgress]= useState({ current: 0, total: 0 });
  const [importResult,  setImportResult]  = useState<{
    imported: number; totalFunds: number;
    totalInvested: number; totalCurrentValue: number; errors: string[];
  } | null>(null);

  // ─── Parse file ─────────────────────────────────────────────────────────────
  const handleFile = useCallback(async (file: File) => {
    setFileName(file.name);
    setParseError(null);
    setIsParsing(true);
    setFunds([]);
    setSelected(new Set());

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'pdf') {
      setParseError('PDF import coming soon. Please download your CAS as CSV/text from mfcentral.com.');
      setIsParsing(false);
      return;
    }

    const text = await file.text();
    const result = parseCasFile(text, file.name);
    setIsParsing(false);

    if (result.errors.length > 0 && result.funds.length === 0) {
      setParseError(result.errors[0]);
      return;
    }

    const enriched: EnrichedFund[] = result.funds.map(f => ({
      ...f,
      currentNav:   null,
      currentValue: null,
    }));
    setFunds(enriched);
    setSelected(new Set(enriched.map(f => f.id)));
    setStep(2);

    // Auto-fetch NAVs for matched funds
    enriched.forEach(async (fund, idx) => {
      if (!fund.matchedSchemeCode) return;
      try {
        const res = await fetch(`/api/mf/nav?scheme_code=${fund.matchedSchemeCode}`);
        if (!res.ok) return;
        const data = await res.json();
        setFunds(prev => prev.map((f, i) => i === idx
          ? { ...f, currentNav: data.nav, currentValue: f.totalUnits * data.nav, status: 'ready' }
          : f
        ));
      } catch { /* ignore */ }
    });

    // Auto-search for unmatched funds (limit to 5 concurrent)
    const unmatched = enriched.filter(f => !f.matchedSchemeCode);
    for (const fund of unmatched.slice(0, 20)) {
      autoMatchFund(fund.id, fund.rawName);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function autoMatchFund(fundId: string, name: string) {
    try {
      const res = await fetch(`/api/mf/search?q=${encodeURIComponent(name.slice(0, 40))}`);
      if (!res.ok) return;
      const data = await res.json();
      const results: { schemeCode: number; schemeName: string }[] = data.results ?? [];
      if (results.length === 0) return;
      // Auto-select first result
      const top = results[0];
      const navRes = await fetch(`/api/mf/nav?scheme_code=${top.schemeCode}`);
      const navData = navRes.ok ? await navRes.json() : null;
      setFunds(prev => prev.map(f => f.id !== fundId ? f : {
        ...f,
        matchedSchemeCode: top.schemeCode,
        matchedSchemeName: top.schemeName,
        currentNav:   navData?.nav ?? null,
        currentValue: navData ? f.totalUnits * navData.nav : null,
        status:       'ready',
      }));
    } catch { /* ignore */ }
  }

  // ─── Search for manual match ─────────────────────────────────────────────
  async function searchForFund(fundId: string, query: string) {
    setFunds(prev => prev.map(f => f.id !== fundId ? f : { ...f, isSearching: true, searchQuery: query }));
    try {
      const res = await fetch(`/api/mf/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setFunds(prev => prev.map(f => f.id !== fundId ? f : {
        ...f,
        isSearching: false,
        searchResults: data.results ?? [],
      }));
    } catch {
      setFunds(prev => prev.map(f => f.id !== fundId ? f : { ...f, isSearching: false }));
    }
  }

  async function selectMatch(fundId: string, schemeCode: number, schemeName: string) {
    setFunds(prev => prev.map(f => f.id !== fundId ? f : {
      ...f,
      matchedSchemeCode: schemeCode,
      matchedSchemeName: schemeName,
      showSearch: false,
      searchResults: [],
    }));
    // Fetch NAV
    try {
      const res = await fetch(`/api/mf/nav?scheme_code=${schemeCode}`);
      if (!res.ok) return;
      const data = await res.json();
      setFunds(prev => prev.map(f => f.id !== fundId ? f : {
        ...f,
        currentNav:   data.nav,
        currentValue: f.totalUnits * data.nav,
        status:       'ready',
      }));
    } catch { /* ignore */ }
  }

  // ─── Toggle selection ─────────────────────────────────────────────────────
  function toggleAll() {
    setSelected(prev => prev.size === funds.length
      ? new Set()
      : new Set(funds.map(f => f.id))
    );
  }

  function toggleFund(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }

  // ─── Import ────────────────────────────────────────────────────────────────
  async function handleImport() {
    const toImport = funds.filter(f => selected.has(f.id));
    if (toImport.length === 0) return;

    setIsImporting(true);
    setImportProgress({ current: 0, total: toImport.length });

    const fundPayloads = toImport.map((f, i) => ({
      schemeName:    f.matchedSchemeName ?? f.rawName,
      schemeCode:    f.matchedSchemeCode ?? null,
      folio:         f.folio,
      totalUnits:    f.totalUnits,
      avgNav:        f.avgNav,
      transactions:  f.transactions,
      currentNav:    f.currentNav ?? null,
      brokerId:      f.assignedBrokerId  ?? brokerId  ?? null,
      portfolioName: f.assignedPortfolio ?? portfolio,
      userId:        f.assignedMemberId  ?? assignMember,
      _idx:          i,
    }));

    try {
      const res = await fetch('/api/mf/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          funds: fundPayloads,
          sourceFilename: fileName ?? 'upload',
          sourceType: funds[0]?.status !== undefined ? 'template_csv' : 'cams_csv',
        }),
      });
      const result = await res.json();
      setImportResult(result);
      setStep(3);
    } catch (e) {
      setImportResult({
        imported: 0, totalFunds: toImport.length,
        totalInvested: 0, totalCurrentValue: 0,
        errors: [String(e)],
      });
      setStep(3);
    } finally {
      setIsImporting(false);
    }
  }

  // ─── Download template ────────────────────────────────────────────────────
  function downloadTemplate() {
    const blob = new Blob([TEMPLATE_CSV_CONTENT], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'wealthview_mf_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─── Drag-and-drop ────────────────────────────────────────────────────────
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  // ─────────────────────────────────────────────────────────────────────────
  const selectedCount = selected.size;
  const readyCount    = funds.filter(f => selected.has(f.id) && f.status === 'ready').length;

  // ── STEP 1: Upload ────────────────────────────────────────────────────────
  if (step === 1) {
    return (
      <div className="space-y-4">
        {/* Drop zone */}
        <label
          className="flex flex-col items-center justify-center w-full rounded-xl border-2 border-dashed cursor-pointer transition-all"
          style={{
            borderColor: isDragging ? '#C9A84C' : '#E8E5DD',
            backgroundColor: isDragging ? 'rgba(201,168,76,0.05)' : 'transparent',
            minHeight: '10rem',
          }}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
        >
          {isParsing ? (
            <>
              <Loader2 className="w-8 h-8 mb-2 animate-spin" style={{ color: '#C9A84C' }} />
              <p className="text-sm font-medium" style={{ color: '#6B7280' }}>Parsing statement…</p>
            </>
          ) : fileName ? (
            <>
              <FileText className="w-8 h-8 mb-2" style={{ color: '#1B2A4A' }} />
              <p className="text-sm font-medium" style={{ color: '#1A1A2E' }}>{fileName}</p>
              <p className="text-xs mt-1" style={{ color: '#9CA3AF' }}>Click to choose a different file</p>
            </>
          ) : (
            <>
              <Upload className="w-8 h-8 mb-2" style={{ color: '#9CA3AF' }} />
              <p className="text-sm font-medium" style={{ color: '#6B7280' }}>Drop your CAS statement here</p>
              <p className="text-xs mt-1" style={{ color: '#9CA3AF' }}>PDF or CSV · CAMS or KFintech</p>
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept=".csv,.txt"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
        </label>

        {parseError && (
          <div className="flex items-start gap-2 p-3 rounded-xl text-xs" style={{ backgroundColor: 'rgba(220,38,38,0.07)', color: '#DC2626' }}>
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            {parseError}
          </div>
        )}

        {/* Info box */}
        <div className="p-3 rounded-xl text-xs space-y-1" style={{ backgroundColor: '#F7F5F0', color: '#6B7280' }}>
          <p>
            Upload your CAMS or KFintech CAS statement (PDF or CSV) — download it from{' '}
            <a href="https://www.mfcentral.com" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: '#1B2A4A' }}>mfcentral.com</a>{' '}
            for free.
          </p>
          <p className="text-[10px]" style={{ color: '#9CA3AF' }}>PDF parsing coming soon — use the text/CSV export for now.</p>
        </div>

        {/* Template download */}
        <button
          type="button"
          onClick={downloadTemplate}
          className="flex items-center gap-2 text-xs hover:underline"
          style={{ color: '#C9A84C' }}
        >
          <Download className="w-3.5 h-3.5" />
          Download sample CSV template — enter data in bulk
        </button>
      </div>
    );
  }

  // ── STEP 2: Preview + Assign ──────────────────────────────────────────────
  if (step === 2) {
    return (
      <div className="space-y-4">
        {/* Header row */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold" style={{ color: '#1A1A2E' }}>
              {funds.length} fund{funds.length !== 1 ? 's' : ''} found
              {fileName && <span className="font-normal ml-1" style={{ color: '#9CA3AF' }}>in {fileName}</span>}
            </p>
            <p className="text-[10px] mt-0.5" style={{ color: '#9CA3AF' }}>
              {readyCount} matched · {funds.length - readyCount} need review
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { setStep(1); setFunds([]); setSelected(new Set()); setParseError(null); setFileName(null); }}
              className="flex items-center gap-1.5 text-xs"
              style={{ color: '#6B7280' }}
            >
              <RefreshCw className="w-3 h-3" />
              Upload different file
            </button>
          </div>
        </div>

        {/* Fund table */}
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: '#E8E5DD' }}>
          {/* Table header */}
          <div
            className="grid gap-3 px-3 py-2 text-[10px] font-bold uppercase tracking-widest"
            style={{ gridTemplateColumns: '1.5rem 1fr 6rem 5rem 6rem 6rem 7rem', backgroundColor: '#F7F5F0', color: '#9CA3AF' }}
          >
            <input
              type="checkbox"
              checked={selectedCount === funds.length}
              onChange={toggleAll}
              className="mt-0.5"
            />
            <span>Fund</span>
            <span>Folio</span>
            <span>Units</span>
            <span>Invested</span>
            <span>Current</span>
            <span>Status</span>
          </div>

          {/* Table rows */}
          {funds.map((fund) => (
            <div key={fund.id} className="border-t" style={{ borderColor: '#F0EDE6' }}>
              <div
                className="grid gap-3 px-3 py-2.5 items-start text-xs"
                style={{ gridTemplateColumns: '1.5rem 1fr 6rem 5rem 6rem 6rem 7rem' }}
              >
                {/* Checkbox */}
                <input
                  type="checkbox"
                  checked={selected.has(fund.id)}
                  onChange={() => toggleFund(fund.id)}
                  className="mt-1"
                />

                {/* Fund name + match */}
                <div className="min-w-0">
                  <p className="font-medium truncate text-[11px]" style={{ color: '#1A1A2E' }} title={fund.rawName}>
                    {fund.rawName}
                  </p>
                  {fund.matchedSchemeName && fund.matchedSchemeName !== fund.rawName ? (
                    <p className="text-[10px] truncate mt-0.5" style={{ color: '#059669' }} title={fund.matchedSchemeName}>
                      ✓ {fund.matchedSchemeName}
                    </p>
                  ) : fund.status === 'needs_review' ? (
                    <div>
                      {fund.showSearch ? (
                        <div className="relative mt-1">
                          <Input
                            value={fund.searchQuery ?? fund.rawName.slice(0, 30)}
                            onChange={e => {
                              const q = e.target.value;
                              setFunds(prev => prev.map(f => f.id !== fund.id ? f : { ...f, searchQuery: q }));
                              if (q.length >= 2) searchForFund(fund.id, q);
                            }}
                            className="h-7 text-[10px] pr-6"
                            placeholder="Search AMFI database…"
                            autoFocus
                          />
                          {fund.isSearching && (
                            <Loader2 className="absolute right-2 top-1.5 w-3 h-3 animate-spin" style={{ color: '#9CA3AF' }} />
                          )}
                          {fund.searchResults && fund.searchResults.length > 0 && (
                            <div
                              className="absolute z-30 top-full mt-1 left-0 right-0 rounded-lg border bg-white shadow-lg overflow-y-auto"
                              style={{ borderColor: '#E8E5DD', maxHeight: '12rem' }}
                            >
                              {fund.searchResults.slice(0, 6).map(r => (
                                <button
                                  key={r.schemeCode}
                                  type="button"
                                  className="w-full text-left px-3 py-2 text-[10px] hover:bg-bg border-b last:border-0"
                                  style={{ borderColor: '#F0EDE6' }}
                                  onMouseDown={e => { e.preventDefault(); selectMatch(fund.id, r.schemeCode, r.schemeName); }}
                                >
                                  {r.schemeName}
                                </button>
                              ))}
                            </div>
                          )}
                          <button
                            type="button"
                            className="mt-1 text-[10px]"
                            style={{ color: '#9CA3AF' }}
                            onClick={() => setFunds(prev => prev.map(f => f.id !== fund.id ? f : { ...f, showSearch: false }))}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="text-[10px] mt-0.5 hover:underline"
                          style={{ color: '#C9A84C' }}
                          onClick={() => setFunds(prev => prev.map(f => f.id !== fund.id ? f : {
                            ...f, showSearch: true, searchQuery: f.rawName.slice(0, 30), searchResults: [],
                          }))}
                        >
                          Not matched — click to search
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>

                {/* Folio */}
                <p className="text-[10px] pt-0.5" style={{ color: '#9CA3AF' }}>{fund.folio || '—'}</p>

                {/* Units */}
                <p className="text-[11px] pt-0.5 font-mono" style={{ color: '#1A1A2E' }}>
                  {fund.totalUnits.toFixed(3)}
                </p>

                {/* Invested */}
                <p className="text-[11px] pt-0.5" style={{ color: '#1A1A2E' }}>
                  {formatLargeINR(fund.investedAmount)}
                </p>

                {/* Current value */}
                <p className="text-[11px] pt-0.5" style={{ color: fund.currentValue ? (fund.currentValue >= fund.investedAmount ? '#059669' : '#DC2626') : '#9CA3AF' }}>
                  {fund.currentValue ? formatLargeINR(fund.currentValue) : '—'}
                </p>

                {/* Status */}
                <StatusBadge status={fund.status} />
              </div>
            </div>
          ))}
        </div>

        {/* Assign metadata */}
        <div className="wv-card p-4 space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#9CA3AF' }}>Assign to</p>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[10px]" style={{ color: '#6B7280' }}>Family Member</Label>
              <Select value={assignMember} onValueChange={setAssignMember}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {members.map(m => <SelectItem key={m.id} value={m.id} className="text-xs">{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[10px]" style={{ color: '#6B7280' }}>Portfolio</Label>
              <Select value={portfolio} onValueChange={setPortfolio}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(portfolios.length > 0 ? portfolios.map(p => p.name) : ['Imported Portfolio', 'Long-term Growth', 'Retirement']).map(p => (
                    <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[10px]" style={{ color: '#6B7280' }}>Broker / Platform</Label>
            <BrokerSelector
              familyId={familyId}
              selectedBrokerId={brokerId}
              onChange={setBrokerId}
            />
          </div>
        </div>

        {/* Import button */}
        <Button
          onClick={handleImport}
          disabled={selectedCount === 0 || isImporting}
          className="w-full h-10 text-sm font-semibold text-white"
          style={{ backgroundColor: selectedCount > 0 ? '#C9A84C' : '#E8E5DD' }}
        >
          {isImporting ? (
            <span className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Importing…
            </span>
          ) : (
            `Import Selected (${selectedCount} fund${selectedCount !== 1 ? 's' : ''})`
          )}
        </Button>
      </div>
    );
  }

  // ── STEP 3: Result ────────────────────────────────────────────────────────
  if (step === 3 && importResult) {
    const success = importResult.imported > 0;
    return (
      <div className="space-y-4">
        <div
          className="p-5 rounded-xl text-center"
          style={{ backgroundColor: success ? 'rgba(5,150,105,0.06)' : 'rgba(220,38,38,0.06)', border: `1px solid ${success ? 'rgba(5,150,105,0.2)' : 'rgba(220,38,38,0.2)'}` }}
        >
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3"
            style={{ backgroundColor: success ? 'rgba(5,150,105,0.1)' : 'rgba(220,38,38,0.1)' }}
          >
            {success
              ? <Check className="w-6 h-6" style={{ color: '#059669' }} />
              : <X className="w-6 h-6" style={{ color: '#DC2626' }} />
            }
          </div>
          <p className="text-sm font-semibold" style={{ color: '#1A1A2E' }}>
            {success
              ? `Successfully imported ${importResult.imported} fund${importResult.imported !== 1 ? 's' : ''}`
              : 'Import failed'
            }
          </p>
          {success && (
            <div className="mt-3 grid grid-cols-2 gap-3 text-left">
              <div className="p-3 rounded-lg" style={{ backgroundColor: 'white' }}>
                <p className="text-[10px]" style={{ color: '#9CA3AF' }}>Total Invested</p>
                <p className="text-sm font-semibold" style={{ color: '#1A1A2E' }}>{formatLargeINR(importResult.totalInvested)}</p>
              </div>
              <div className="p-3 rounded-lg" style={{ backgroundColor: 'white' }}>
                <p className="text-[10px]" style={{ color: '#9CA3AF' }}>Current Value</p>
                <p className="text-sm font-semibold" style={{ color: '#059669' }}>{formatLargeINR(importResult.totalCurrentValue)}</p>
              </div>
            </div>
          )}
        </div>

        {importResult.errors.length > 0 && (
          <div className="p-3 rounded-xl text-xs space-y-1" style={{ backgroundColor: 'rgba(220,38,38,0.05)', color: '#DC2626' }}>
            <p className="font-semibold">Issues during import:</p>
            {importResult.errors.slice(0, 5).map((e, i) => <p key={i}>{e}</p>)}
          </div>
        )}

        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1 h-9 text-xs"
            onClick={() => { setStep(1); setFunds([]); setSelected(new Set()); setFileName(null); setImportResult(null); }}
          >
            Import More
          </Button>
          <Button
            className="flex-1 h-9 text-xs text-white"
            style={{ backgroundColor: '#1B2A4A' }}
            onClick={() => window.location.href = '/portfolio/mutual-funds'}
          >
            View Portfolio
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
