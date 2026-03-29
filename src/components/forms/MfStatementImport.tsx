'use client';

import { useState, useEffect } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, Loader2, ChevronDown, ChevronUp, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
/* eslint-disable @typescript-eslint/no-explicit-any */

interface Distributor {
  id: string;
  name: string;
}

interface MfStatementImportProps {
  members: Array<{ id: string; name: string }>;
  defaultMemberId: string;
  portfolios: string[];
  distributors?: Distributor[];
  familyId?: string;
}

interface ParsedFund {
  fundName: string;
  fundCode: string;
  isin: string;
  transactions: any[];
  closingUnits: number;
  closingNav: number;
  closingValue: number;
  sipCancelled: boolean;
  // Assignment fields
  memberId: string;
  brokerId: string;        // distributor ID
  distributorName: string;
  portfolioName: string;
  schemeCode: string;      // AMFI scheme code (matched or manual)
  schemeName: string;      // matched AMFI name
  matched: boolean;        // whether auto-matched to AMFI
  selected: boolean;       // whether to import this fund
  expanded: boolean;       // UI expand state
  autoCalc: any[];         // auto-calculated SIP installments
  editingScheme: boolean;  // whether scheme search is open
}

interface ParseResult {
  accountDetails: any;
  allFundGroups: any[];
  rawText: string;
  rawTextLength: number;
  totalTransactionsInStatement: number;
}

export function MfStatementImport({ members, defaultMemberId, portfolios, distributors: propDistributors, familyId: _familyId }: MfStatementImportProps) {
  const [step, setStep] = useState(1);
  const [distributors, setDistributors] = useState<Distributor[]>(propDistributors ?? []);
  const [schemeSearchResults, setSchemeSearchResults] = useState<Record<number, any[]>>({});
  const [schemeSearchQuery, setSchemeSearchQuery] = useState<Record<number, string>>({});

  // Load distributors from database
  useEffect(() => {
    if (propDistributors?.length) return;
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase.from('users').select('family_id').eq('id', user.id).single();
      if (!profile?.family_id) return;
      const { data: brokers } = await supabase.from('brokers').select('id, name').eq('family_id', profile.family_id);
      if (brokers) setDistributors(brokers.map(b => ({ id: b.id, name: b.name })));
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Step 1: Upload
  const [files, setFiles] = useState<File[]>([]);
  const [password, setPassword] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState('');
  const [parseError, setParseError] = useState('');

  // Step 2: Review
  const [parsedFunds, setParsedFunds] = useState<ParsedFund[]>([]);
  const [accountDetails, setAccountDetails] = useState<any>(null);
  const [totalTxns, setTotalTxns] = useState(0);

  // Step 3-4: Import
  const [_importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [importResult, setImportResult] = useState<{ funds: number; txns: number } | null>(null);
  const [importError, setImportError] = useState('');

  // ── Step 1: Parse all uploaded PDFs ──
  async function handleParse() {
    if (files.length === 0) return;
    setParsing(true);
    setParseError('');
    const allFunds: ParsedFund[] = [];
    let acctDetails: any = null;
    let totalTx = 0;

    for (let i = 0; i < files.length; i++) {
      setParseProgress(`Parsing statement ${i + 1} of ${files.length}...`);
      try {
        const fd = new FormData();
        fd.append('file', files[i]);
        fd.append('password', password);
        fd.append('date', '');
        fd.append('amount', '0');
        fd.append('nav', '0');
        fd.append('units', '0');
        fd.append('folio', '');
        fd.append('fundName', '');

        const res = await fetch('/api/mf/verify-statement', { method: 'POST', body: fd });
        const data: ParseResult = await res.json();

        if (!data.allFundGroups || data.allFundGroups.length === 0) {
          if (!data.rawText) {
            setParseError(`Failed to parse ${files[i].name}: ${(data as any).error || 'No text extracted'}`);
            continue;
          }
        }

        if (!acctDetails && data.accountDetails) acctDetails = data.accountDetails;
        totalTx += data.totalTransactionsInStatement || 0;

        // Convert each fund group to ParsedFund
        for (const fg of (data.allFundGroups || [])) {
          // Try to auto-match to AMFI scheme
          let schemeCode = '';
          let schemeName = fg.fundName;
          let matched = false;

          try {
            const searchRes = await fetch(`/api/mf/search?q=${encodeURIComponent(fg.fundName.substring(0, 30))}`);
            if (searchRes.ok) {
              const searchData = await searchRes.json();
              const results = searchData.results || [];
              if (results.length > 0) {
                schemeCode = String(results[0].schemeCode);
                schemeName = results[0].schemeName;
                matched = true;
              }
            }
          } catch { /* search failed */ }

          // Try to match distributor from statement to existing distributors
          const stmtDist = (acctDetails?.distributorName || '').toLowerCase();
          const matchedDist = distributors.find(d => stmtDist && d.name.toLowerCase().includes(stmtDist.substring(0, 8)));

          allFunds.push({
            fundName: fg.fundName,
            fundCode: fg.fundCode || '',
            isin: fg.isin || '',
            transactions: fg.transactions || [],
            closingUnits: fg.closingUnits || 0,
            closingNav: fg.closingNav || 0,
            closingValue: fg.closingValue || 0,
            sipCancelled: fg.sipCancelled || false,
            memberId: defaultMemberId,
            brokerId: matchedDist?.id || '',
            distributorName: acctDetails?.distributorName || '',
            portfolioName: portfolios[0] || 'Long-term Growth',
            schemeCode,
            schemeName,
            matched,
            selected: true,
            expanded: false,
            autoCalc: [],
            editingScheme: false,
          });
        }
      } catch (err) {
        setParseError(`Error parsing ${files[i].name}: ${(err as Error).message}`);
      }
    }

    setParsedFunds(allFunds);
    setAccountDetails(acctDetails);
    setTotalTxns(totalTx);
    setParsing(false);
    setParseProgress('');
    if (allFunds.length > 0) setStep(2);
  }

  // ── Step 3: Import all selected funds ──
  async function handleImport() {
    const selected = parsedFunds.filter(f => f.selected && f.schemeCode && (f.brokerId || distributors.length === 0));
    if (selected.length === 0) return;

    setStep(3); // Show importing step
    setImporting(true);
    setImportError('');
    let importedFunds = 0;
    let importedTxns = 0;

    console.log(`[Import] Starting batch import for ${selected.length} funds`);

    for (let i = 0; i < selected.length; i++) {
      const fund = selected[i];
      setImportProgress(`Importing ${fund.schemeName || fund.fundName} (${i + 1}/${selected.length})...`);

      // Build transactions array for batch import
      const txnList = fund.transactions
        .filter((txn: any) => txn.date && (Number(txn.grossAmount || txn.netAmount || 0) > 0))
        .map((txn: any) => {
          const t = (txn.type || '').toLowerCase();
          return {
            date: txn.date,
            type: t.includes('sip') ? 'sip' : t.includes('redeem') ? 'sell' : 'buy',
            amount: Number(txn.grossAmount || txn.netAmount || 0),
            nav: Number(txn.nav || 0),
            units: Number(txn.units || 0),
            stampDuty: Number(txn.stampDuty || 0),
          };
        });

      console.log(`[Import] Fund ${i + 1}/${selected.length}: "${fund.schemeName}" scheme=${fund.schemeCode} broker=${fund.brokerId} txns=${txnList.length}`);

      try {
        const payload = {
          memberId: fund.memberId,
          schemeCode: fund.schemeCode,
          schemeName: fund.schemeName || fund.fundName,
          portfolioName: fund.portfolioName,
          brokerId: fund.brokerId || undefined,
          folioNumber: accountDetails?.folioNumber || '',
          transactions: txnList,
        };

        console.log(`[Import] Batch payload:`, JSON.stringify(payload).substring(0, 300));

        const res = await fetch('/api/mf/import-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();

        if (res.ok) {
          importedFunds++;
          importedTxns += data.savedTransactions || 0;
          console.log(`[Import] ✓ Fund saved: holdingId=${data.holdingId} txns=${data.savedTransactions}/${data.totalTransactions} qty=${data.quantity}`);
          if (data.errors) console.warn(`[Import] Warnings:`, data.errors);
        } else {
          console.error(`[Import] ✗ Failed:`, data.error || data);
          setImportError(`Failed to import ${fund.schemeName}: ${data.error || 'Unknown error'}`);
        }
      } catch (err) {
        console.error(`[Import] ✗ Error:`, err);
      }
    }

    console.log(`[Import] Complete: ${importedFunds} funds, ${importedTxns} transactions`);
    setImporting(false);
    setImportProgress('');
    setImportResult({ funds: importedFunds, txns: importedTxns });
    setStep(4);
  }

  function updateFund(idx: number, updates: Partial<ParsedFund>) {
    setParsedFunds(prev => prev.map((f, i) => i === idx ? { ...f, ...updates } : f));
  }

  function removeFile(idx: number) {
    setFiles(prev => prev.filter((_, i) => i !== idx));
  }

  // ── Render ──
  return (
    <div className="space-y-4">

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-4">
        {[1, 2, 3, 4].map(s => (
          <div key={s} className="flex items-center gap-1">
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
              style={{
                backgroundColor: step >= s ? '#1B2A4A' : '#E8E5DD',
                color: step >= s ? 'white' : '#9CA3AF',
              }}>
              {step > s ? '\u2713' : s}
            </div>
            {s < 4 && <div className="w-8 h-0.5" style={{ backgroundColor: step > s ? '#1B2A4A' : '#E8E5DD' }} />}
          </div>
        ))}
        <span className="text-[10px] ml-2" style={{ color: '#9CA3AF' }}>
          {step === 1 ? 'Upload' : step === 2 ? 'Review & Assign' : step === 3 ? 'Importing...' : 'Complete'}
        </span>
      </div>

      {/* ── Step 1: Upload ── */}
      {step === 1 && (
        <div className="space-y-3">
          <div className="border-2 border-dashed rounded-xl p-6 text-center transition-colors"
            style={{ borderColor: files.length > 0 ? '#C9A84C' : '#E8E5DD' }}>
            {files.length > 0 ? (
              <div className="space-y-2">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-1.5 rounded-lg" style={{ backgroundColor: '#F7F5F0' }}>
                    <div className="flex items-center gap-2">
                      <FileText className="w-3.5 h-3.5" style={{ color: '#C9A84C' }} />
                      <span className="text-xs font-medium" style={{ color: '#1A1A2E' }}>{f.name}</span>
                      <span className="text-[10px]" style={{ color: '#9CA3AF' }}>({Math.round(f.size / 1024)}KB)</span>
                    </div>
                    <button onClick={() => removeFile(i)}><X className="w-3 h-3" style={{ color: '#9CA3AF' }} /></button>
                  </div>
                ))}
                <label className="cursor-pointer text-xs" style={{ color: '#C9A84C' }}>
                  <input type="file" accept=".pdf" multiple className="hidden"
                    onChange={e => { if (e.target.files) setFiles(prev => [...prev, ...Array.from(e.target.files!)]); }} />
                  + Add more statements
                </label>
              </div>
            ) : (
              <label className="cursor-pointer">
                <input type="file" accept=".pdf" multiple className="hidden"
                  onChange={e => { if (e.target.files) setFiles(Array.from(e.target.files)); }} />
                <Upload className="w-8 h-8 mx-auto mb-2" style={{ color: '#9CA3AF' }} />
                <p className="text-xs" style={{ color: '#6B7280' }}>
                  Drop AMC statement PDFs here or <span style={{ color: '#C9A84C' }}>click to browse</span>
                </p>
                <p className="text-[10px] mt-1" style={{ color: '#9CA3AF' }}>Supports HDFC, SBI, ICICI, Axis, Mirae, and other AMC formats</p>
              </label>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1">
              <Label className="text-xs" style={{ color: '#6B7280' }}>Statement password (usually your PAN)</Label>
              <Input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="e.g. ABCDE1234F" className="h-8 text-xs mt-1" />
            </div>
            <Button onClick={handleParse} disabled={files.length === 0 || parsing}
              className="h-8 text-xs mt-5 gap-1.5"
              style={{ backgroundColor: '#C9A84C', color: '#1B2A4A' }}>
              {parsing ? <><Loader2 className="w-3 h-3 animate-spin" />{parseProgress}</> : 'Parse Statements'}
            </Button>
          </div>

          {parseError && (
            <div className="p-3 rounded-lg text-xs flex items-start gap-2" style={{ backgroundColor: 'rgba(220,38,38,0.06)', color: '#DC2626' }}>
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              {parseError}
            </div>
          )}
        </div>
      )}

      {/* ── Step 2: Review & Assign ── */}
      {step === 2 && (
        <div className="space-y-3">
          {/* Summary */}
          <div className="p-3 rounded-lg text-xs" style={{ backgroundColor: 'rgba(27,42,74,0.04)', border: '1px solid rgba(27,42,74,0.08)' }}>
            <p className="font-semibold mb-1" style={{ color: '#1B2A4A' }}>
              Found {parsedFunds.length} fund(s) with {totalTxns} transactions
            </p>
            {accountDetails && (
              <p style={{ color: '#6B7280' }}>
                {accountDetails.holderName && <>{accountDetails.holderName} &middot; </>}
                {accountDetails.pan && <>PAN: {accountDetails.pan} &middot; </>}
                {accountDetails.folioNumber && <>Folio: {accountDetails.folioNumber}</>}
              </p>
            )}
          </div>

          {/* Fund cards */}
          {parsedFunds.map((fund, fi) => (
            <div key={fi} className="border rounded-lg" style={{ borderColor: fund.selected ? '#C9A84C' : '#E8E5DD', opacity: fund.selected ? 1 : 0.6, position: 'relative' }}>
              {/* Fund header */}
              <div className="px-3 py-2" style={{ backgroundColor: fund.selected ? 'rgba(201,168,76,0.06)' : '#F7F5F0' }}>
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={fund.selected}
                    onChange={e => updateFund(fi, { selected: e.target.checked })}
                    className="flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate" style={{ color: '#1A1A2E' }}>{fund.fundName}</p>
                    <p className="text-[10px]" style={{ color: '#9CA3AF' }}>
                      {fund.transactions.length} txns{fund.closingUnits > 0 ? ` \u00b7 ${fund.closingUnits.toFixed(3)} units` : ''}
                      {fund.matched ? ' \u00b7 AMFI matched' : ' \u00b7 Not matched'}
                    </p>
                  </div>
                  <button onClick={() => updateFund(fi, { expanded: !fund.expanded })} className="flex-shrink-0">
                    {fund.expanded ? <ChevronUp className="w-4 h-4" style={{ color: '#9CA3AF' }} /> : <ChevronDown className="w-4 h-4" style={{ color: '#9CA3AF' }} />}
                  </button>
                </div>

                {/* Assignment fields */}
                {fund.selected && (
                  <div className="space-y-2 mt-2">
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <Label className="text-[9px]" style={{ color: '#9CA3AF' }}>Member</Label>
                        <Select value={fund.memberId} onValueChange={v => updateFund(fi, { memberId: v })}>
                          <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {members.map(m => <SelectItem key={m.id} value={m.id} className="text-[10px]">{m.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-[9px]" style={{ color: '#9CA3AF' }}>Portfolio</Label>
                        <Select value={fund.portfolioName} onValueChange={v => updateFund(fi, { portfolioName: v })}>
                          <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {portfolios.map(p => <SelectItem key={p} value={p} className="text-[10px]">{p}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label className="text-[9px]" style={{ color: '#9CA3AF' }}>Distributor {!fund.brokerId && <span style={{ color: '#DC2626' }}>*</span>}</Label>
                        {distributors.length > 0 ? (
                          <Select value={fund.brokerId} onValueChange={v => updateFund(fi, { brokerId: v })}>
                            <SelectTrigger className="h-7 text-[10px]"><SelectValue placeholder="Select..." /></SelectTrigger>
                            <SelectContent>
                              {distributors.map(d => <SelectItem key={d.id} value={d.id} className="text-[10px]">{d.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        ) : (
                          <p className="text-[10px] mt-1" style={{ color: '#9CA3AF' }}>
                            {fund.distributorName || 'No distributors found'}
                          </p>
                        )}
                      </div>
                    </div>
                    {/* AMFI Scheme — editable */}
                    <div>
                      <Label className="text-[9px]" style={{ color: '#9CA3AF' }}>AMFI Scheme</Label>
                      {fund.matched && !fund.editingScheme ? (
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-[10px] font-medium truncate flex-1" title={fund.schemeName}>
                            ✅ {fund.schemeName}
                          </p>
                          <button onClick={() => updateFund(fi, { editingScheme: true })}
                            className="text-[9px] px-2 py-0.5 rounded" style={{ color: '#C9A84C', backgroundColor: 'rgba(201,168,76,0.1)' }}>
                            Change
                          </button>
                        </div>
                      ) : (
                        <div className="relative">
                          <Input className="h-7 text-[10px] mt-0.5"
                            placeholder="Type to search AMFI schemes..."
                            value={schemeSearchQuery[fi] ?? fund.fundName.substring(0, 20)}
                            onChange={async (e) => {
                              const q = e.target.value;
                              setSchemeSearchQuery(prev => ({ ...prev, [fi]: q }));
                              if (q.length < 3) { setSchemeSearchResults(prev => ({ ...prev, [fi]: [] })); return; }
                              try {
                                const res = await fetch(`/api/mf/search?q=${encodeURIComponent(q)}`);
                                const data = await res.json();
                                setSchemeSearchResults(prev => ({ ...prev, [fi]: data.results || [] }));
                              } catch { /* ignore */ }
                            }}
                            onFocus={() => {
                              if (!schemeSearchQuery[fi]) setSchemeSearchQuery(prev => ({ ...prev, [fi]: fund.fundName.substring(0, 20) }));
                            }}
                          />
                          {(schemeSearchResults[fi] || []).length > 0 && (
                            <div className="absolute top-full left-0 right-0 mt-1 border rounded-lg bg-white shadow-lg max-h-40 overflow-y-auto" style={{ borderColor: '#E8E5DD', zIndex: 9999 }}>
                              {(schemeSearchResults[fi] || []).map((r: any, ri: number) => (
                                <button key={ri}
                                  className="w-full text-left px-3 py-1.5 text-[10px] hover:bg-[#F7F5F0] border-b last:border-0"
                                  style={{ borderColor: '#F0EDE6' }}
                                  onClick={() => {
                                    updateFund(fi, { schemeCode: String(r.schemeCode), schemeName: r.schemeName, matched: true, editingScheme: false });
                                    setSchemeSearchResults(prev => ({ ...prev, [fi]: [] }));
                                    setSchemeSearchQuery(prev => ({ ...prev, [fi]: '' }));
                                  }}>
                                  <p className="font-medium" style={{ color: '#1A1A2E' }}>{r.schemeName}</p>
                                  <p style={{ color: '#9CA3AF' }}>Code: {r.schemeCode}</p>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    {/* Validation warning */}
                    {!fund.schemeCode && <p className="text-[9px]" style={{ color: '#DC2626' }}>Select an AMFI scheme to enable import</p>}
                    {!fund.brokerId && distributors.length > 0 && <p className="text-[9px]" style={{ color: '#DC2626' }}>Select a distributor</p>}
                  </div>
                )}
              </div>

              {/* Expanded transactions */}
              {fund.expanded && (
                <div className="px-3 py-2 border-t" style={{ borderColor: '#F0EDE6' }}>
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ backgroundColor: '#FAFAF8' }}>
                        <th className="px-2 py-1 text-left font-medium" style={{ color: '#9CA3AF' }}>Date</th>
                        <th className="px-2 py-1 text-left font-medium" style={{ color: '#9CA3AF' }}>Type</th>
                        <th className="px-2 py-1 text-right font-medium" style={{ color: '#9CA3AF' }}>Amount</th>
                        <th className="px-2 py-1 text-right font-medium" style={{ color: '#9CA3AF' }}>NAV</th>
                        <th className="px-2 py-1 text-right font-medium" style={{ color: '#9CA3AF' }}>Units</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fund.transactions.map((txn: any, ti: number) => {
                        const amt = Number(txn.grossAmount ?? txn.netAmount ?? 0);
                        return (
                          <tr key={ti} style={{ borderTop: '1px solid #F0EDE6' }}>
                            <td className="px-2 py-1" style={{ color: '#1A1A2E' }}>{txn.date ?? '\u2014'}</td>
                            <td className="px-2 py-1" style={{ color: '#6B7280' }}>{txn.type ?? '\u2014'}</td>
                            <td className="px-2 py-1 text-right" style={{ color: '#1A1A2E' }}>
                              {amt > 0 ? `\u20b9${amt.toLocaleString('en-IN')}` : '\u2014'}
                            </td>
                            <td className="px-2 py-1 text-right" style={{ color: '#6B7280' }}>
                              {Number(txn.nav) > 0 ? Number(txn.nav).toFixed(4) : '\u2014'}
                            </td>
                            <td className="px-2 py-1 text-right" style={{ color: '#6B7280' }}>
                              {Number(txn.units) > 0 ? Number(txn.units).toFixed(4) : '\u2014'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}

          {/* Actions */}
          <div className="flex items-center gap-3">
            <Button onClick={() => setStep(1)} variant="outline" className="h-9 text-xs">Back</Button>
            <Button onClick={handleImport}
              disabled={parsedFunds.filter(f => f.selected && f.schemeCode && (f.brokerId || distributors.length === 0)).length === 0}
              className="flex-1 h-9 text-xs font-semibold"
              style={{ backgroundColor: '#C9A84C', color: '#1B2A4A' }}>
              Import {parsedFunds.filter(f => f.selected).length} Fund(s) ({totalTxns} transactions)
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 3: Importing ── */}
      {step === 3 && (
        <div className="p-8 text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" style={{ color: '#C9A84C' }} />
          <p className="text-sm font-medium" style={{ color: '#1B2A4A' }}>{importProgress || 'Importing...'}</p>
        </div>
      )}

      {/* ── Step 4: Complete ── */}
      {step === 4 && importResult && (
        <div className="p-6 text-center">
          <CheckCircle className="w-10 h-10 mx-auto mb-3" style={{ color: '#059669' }} />
          <p className="text-lg font-semibold mb-1" style={{ color: '#1B2A4A' }}>Import Complete</p>
          <p className="text-sm mb-4" style={{ color: '#6B7280' }}>
            Successfully imported {importResult.funds} fund(s) with {importResult.txns} transactions
          </p>
          <div className="flex items-center justify-center gap-3">
            <Button onClick={() => window.location.href = '/portfolio/mutual-funds'}
              className="h-9 text-xs font-semibold"
              style={{ backgroundColor: '#1B2A4A', color: 'white' }}>
              View Portfolio
            </Button>
            <Button onClick={() => { setStep(1); setFiles([]); setParsedFunds([]); setImportResult(null); }}
              variant="outline" className="h-9 text-xs">
              Import More
            </Button>
          </div>
        </div>
      )}

      {importError && (
        <div className="p-3 rounded-lg text-xs" style={{ backgroundColor: 'rgba(220,38,38,0.06)', color: '#DC2626' }}>
          {importError}
        </div>
      )}
    </div>
  );
}
