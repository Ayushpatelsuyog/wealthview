'use client';

import React from 'react';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface VerifyResultsProps {
  result: any;
  enteredData?: {
    date?: string;
    amount?: string;
    nav?: string;
    folio?: string;
    memberName?: string;
    memberPan?: string;
    memberMobile?: string;
    memberEmail?: string;
    distributorName?: string;
  };
}

const FIELD_LABELS: Record<string, string> = {
  date: 'Purchase Date', grossAmount: 'Gross Amount', stampDuty: 'Stamp Duty',
  netAmount: 'Net Amount', nav: 'NAV', units: 'Units', folio: 'Folio Number',
  balanceUnits: 'Balance Units',
};

function fmtVal(v: any): string {
  if (v === undefined || v === null || v === 'N/A') return '—';
  const n = Number(v);
  if (isNaN(n)) return String(v);
  return n.toLocaleString('en-IN', { maximumFractionDigits: 4 });
}

function fmtAmt(txn: any): string {
  const gross = Number(txn?.grossAmount);
  if (isFinite(gross) && gross > 0) return `₹${gross.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  const net = Number(txn?.netAmount);
  if (isFinite(net) && net > 0) return `₹${net.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  const calc = Number(txn?.units) * Number(txn?.nav);
  if (isFinite(calc) && calc > 0) return `₹${calc.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  return '—';
}

function normalizeDate(d: string): string {
  if (!d) return '';
  const str = String(d).trim();
  // DD-MM-YYYY or DD/MM/YYYY
  const dmy = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  // YYYY-MM-DD or YYYY/MM/DD
  const ymd = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`;
  return str;
}

function normMobile(m: string): string {
  return (m ?? '').replace(/[+\s\-]/g, '').replace(/^91/, '');
}

function matchStr(a: string, b: string, partial = false): string {
  if (!a?.trim() || !b?.trim()) return '';
  const sa = a.toLowerCase().trim(), sb = b.toLowerCase().trim();
  if (sa === sb) return '✅';
  if (partial && (sa.includes(sb) || sb.includes(sa))) return '✅';
  return '⚠️';
}

export function VerifyResults({ result, enteredData }: VerifyResultsProps) {
  if (!result) return null;

  // Debug
  if (typeof window !== 'undefined') {
    console.log('[VerifyResults] enteredData:', JSON.stringify(enteredData));
    console.log('[VerifyResults] funds:', result?.allFundGroups?.length, 'matched:', result?.matchedTransaction?.found);
  }

  const acct = result.accountDetails ?? {};
  const mt = result.matchedTransaction;
  const comp = mt?.comparison ?? {};
  const fundGroups: any[] = result.allFundGroups ?? [];
  const totalTxns = Number(result.totalTransactionsInStatement ?? 0);
  const ed = enteredData ?? {};

  const compEntries = Object.entries(comp);
  const matchCount = compEntries.filter(([, v]: any) => v.match).length;
  const mismatchCount = compEntries.filter(([, v]: any) => !v.match).length;

  const matchedFundGroup = fundGroups.find((g: any) => g.isMatchedFund);
  const otherFunds = fundGroups.filter((g: any) => !g.isMatchedFund && g.transactions?.length > 0);

  // ── Client-side transaction matching ──
  const entAmt = parseFloat(ed.amount ?? '0');
  const entNav = parseFloat(ed.nav ?? '0');
  const entDate = normalizeDate(ed.date ?? '');

  const allTxns: any[] = matchedFundGroup?.transactions ?? [];
  let clientMatchIdx = -1;

  // Debug: log what we're matching
  if (typeof window !== 'undefined' && allTxns.length > 0) {
    console.log('[VerifyResults] Matching: entDate=', ed.date, '→', entDate, ' entAmt=', entAmt, ' entNav=', entNav);
    console.log('[VerifyResults] First txn: date=', allTxns[0]?.date, '→', normalizeDate(allTxns[0]?.date), ' gross=', allTxns[0]?.grossAmount);
  }

  if (entDate || entAmt > 0) {
    clientMatchIdx = allTxns.findIndex((txn: any) => {
      const txnDate = normalizeDate(txn.date ?? '');
      const txnGross = Number(txn.grossAmount ?? 0);
      const txnNet = Number(txn.netAmount ?? 0);
      // Date comparison: exact match or ±3 days
      let dateOk = false;
      if (entDate && txnDate) {
        if (entDate === txnDate) {
          dateOk = true;
        } else {
          const d1 = new Date(entDate).getTime(), d2 = new Date(txnDate).getTime();
          dateOk = isFinite(d1) && isFinite(d2) && Math.abs(d1 - d2) <= 3 * 86400000;
        }
      }
      // Amount comparison (±100)
      const amtOk = entAmt > 0 && (Math.abs(txnGross - entAmt) <= 100 || Math.abs(txnNet - entAmt) <= 100);

      if (dateOk && amtOk) return true;
      if (dateOk) return true;
      if (!entDate && amtOk) return true;
      return false;
    });
  }

  const matchedTxn = clientMatchIdx >= 0 ? allTxns[clientMatchIdx] : null;
  const hasApiMatch = mt?.found;
  const hasMatch = !!matchedTxn || hasApiMatch;

  return (
    <div className="space-y-3">

      {/* 1. Statement Details */}
      <div className="p-3 rounded-lg text-xs" style={{ backgroundColor: 'rgba(27,42,74,0.04)', border: '1px solid rgba(27,42,74,0.08)' }}>
        <p className="font-semibold mb-2" style={{ color: '#1B2A4A' }}>Statement Details</p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
          {[
            { label: 'Fund', value: result.matchedFund?.fundName, icon: '' },
            { label: 'Folio', value: acct.folioNumber, icon: matchStr(acct.folioNumber ?? '', ed.folio ?? '', true) },
            { label: 'Holder', value: acct.holderName, icon: matchStr(acct.holderName ?? '', ed.memberName ?? '', true) },
            { label: 'PAN', value: acct.pan, icon: matchStr(acct.pan ?? '', ed.memberPan ?? '') },
            { label: 'Nominee', value: acct.nominee ? `${acct.nominee}${acct.nomineeShare ? ` (${acct.nomineeShare})` : ''}` : '', icon: acct.nominee ? 'ℹ️' : '' },
            { label: 'Mobile', value: acct.mobile, icon: acct.mobile && ed.memberMobile ? matchStr(normMobile(acct.mobile), normMobile(ed.memberMobile)) : '' },
            { label: 'Bank', value: acct.bankAccount, icon: '' },
            { label: 'Distributor', value: acct.distributorName ? `${acct.distributorName}${acct.arn ? ` (${acct.arn})` : ''}` : '', icon: matchStr(acct.distributorName ?? '', ed.distributorName ?? '', true) },
            { label: 'Total', value: `${totalTxns} transactions, ${fundGroups.length} fund(s)`, icon: '' },
          ].filter(f => f.value).map(f => (
            <div key={f.label} className="min-w-0">
              <p className="text-[9px] uppercase tracking-wider" style={{ color: '#9CA3AF' }}>{f.label}</p>
              <p className="font-medium truncate" title={String(f.value)} style={{ color: '#1A1A2E' }}>
                {f.value}{f.icon ? ` ${f.icon}` : ''}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* 2. Other Funds */}
      {otherFunds.length > 0 && (
        <div className="p-2.5 rounded-lg text-[11px]" style={{ backgroundColor: 'rgba(37,99,235,0.05)', border: '1px solid rgba(37,99,235,0.1)', color: '#3B82F6' }}>
          <strong>Also in statement: </strong>
          {otherFunds.map((f: any, i: number) => (
            <span key={i}>{i > 0 ? ', ' : ''}{f.fundName} ({f.transactions.length} txn{f.transactions.length > 1 ? 's' : ''})</span>
          ))}
        </div>
      )}

      {/* 3. API Transaction Comparison Table */}
      {hasApiMatch && compEntries.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold" style={{ color: '#1B2A4A' }}>Transaction Verification</p>
            <span className="text-[10px] px-2 py-0.5 rounded-full" style={{
              backgroundColor: mismatchCount === 0 ? 'rgba(5,150,105,0.1)' : 'rgba(201,168,76,0.1)',
              color: mismatchCount === 0 ? '#059669' : '#92620A',
            }}>
              {matchCount}/{compEntries.length} matched
            </span>
          </div>
          <table className="w-full text-xs border rounded-lg overflow-hidden">
            <thead>
              <tr style={{ backgroundColor: '#F7F5F0' }}>
                <th className="text-left px-3 py-2 font-medium" style={{ color: '#6B7280' }}>Field</th>
                <th className="text-right px-3 py-2 font-medium" style={{ color: '#6B7280' }}>Your Entry</th>
                <th className="text-right px-3 py-2 font-medium" style={{ color: '#6B7280' }}>Statement</th>
                <th className="text-center px-3 py-2 font-medium" style={{ color: '#6B7280' }}></th>
              </tr>
            </thead>
            <tbody>
              {compEntries.map(([key, val]: any) => (
                <tr key={key} style={{ borderTop: '1px solid #F0EDE6', backgroundColor: val.match ? 'rgba(5,150,105,0.03)' : 'rgba(201,168,76,0.05)' }}>
                  <td className="px-3 py-2 font-medium" style={{ color: '#1A1A2E' }}>{FIELD_LABELS[key] ?? key}</td>
                  <td className="px-3 py-2 text-right" style={{ color: '#6B7280' }}>{fmtVal(val.entered)}</td>
                  <td className="px-3 py-2 text-right font-medium" style={{ color: '#1A1A2E' }}>{fmtVal(val.statement)}</td>
                  <td className="px-3 py-2 text-center">{val.match ? '✅' : `⚠️`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Client-side match indicator if API didn't find one */}
      {!hasApiMatch && matchedTxn && (
        <div className="p-2.5 rounded-lg text-xs" style={{ backgroundColor: 'rgba(5,150,105,0.06)', color: '#059669', border: '1px solid rgba(5,150,105,0.15)' }}>
          ✅ Found matching transaction: {matchedTxn.date} · {fmtAmt(matchedTxn)} · NAV {Number(matchedTxn.nav).toFixed(4)}
        </div>
      )}

      {!hasMatch && (entDate || entAmt > 0) && (
        <div className="p-2.5 rounded-lg text-xs" style={{ backgroundColor: 'rgba(201,168,76,0.06)', color: '#92620A', border: '1px solid rgba(201,168,76,0.15)' }}>
          No matching transaction found for {entDate || '(no date)'} / ₹{entAmt > 0 ? entAmt.toLocaleString('en-IN') : '—'}
        </div>
      )}

      {/* 4. Fund Transactions */}
      {matchedFundGroup && (
        <div>
          <p className="text-xs font-semibold mb-1" style={{ color: '#1B2A4A' }}>
            {matchedFundGroup.fundName} ({allTxns.length} transactions)
            {matchedFundGroup.sipCancelled ? <span style={{ color: '#DC2626' }}> · SIP Cancelled</span> : null}
          </p>
          <div className="border rounded-lg overflow-hidden" style={{ borderColor: '#C9A84C' }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ backgroundColor: '#FAFAF8' }}>
                  <th className="px-2 py-1.5 text-left font-medium" style={{ color: '#9CA3AF' }}>Date</th>
                  <th className="px-2 py-1.5 text-left font-medium" style={{ color: '#9CA3AF' }}>Type</th>
                  <th className="px-2 py-1.5 text-right font-medium" style={{ color: '#9CA3AF' }}>Amount</th>
                  <th className="px-2 py-1.5 text-right font-medium" style={{ color: '#9CA3AF' }}>NAV</th>
                  <th className="px-2 py-1.5 text-right font-medium" style={{ color: '#9CA3AF' }}>Units</th>
                  <th className="px-2 py-1.5 text-right font-medium" style={{ color: '#9CA3AF' }}>Bal</th>
                </tr>
              </thead>
              <tbody>
                {allTxns.map((txn: any, ti: number) => {
                  const isMatch = ti === clientMatchIdx;
                  const txnGross = Number(txn.grossAmount ?? 0);
                  const txnNav = Number(txn.nav ?? 0);
                  const txnUnits = Number(txn.units ?? 0);
                  return (
                    <tr key={ti} style={{
                      borderTop: '1px solid #F0EDE6',
                      backgroundColor: isMatch ? 'rgba(201,168,76,0.12)' : undefined,
                      fontWeight: isMatch ? 600 : undefined,
                    }}>
                      <td className="px-2 py-1.5" style={{ color: '#1A1A2E' }}>
                        {txn.date ?? '—'}
                        {isMatch && entDate && (normalizeDate(txn.date) === entDate ? ' ✅' : ' ⚠️')}
                        {isMatch && <span className="ml-1 text-[9px]" style={{ color: '#C9A84C' }}>← yours</span>}
                      </td>
                      <td className="px-2 py-1.5" style={{ color: '#6B7280' }}>{txn.type ?? '—'}</td>
                      <td className="px-2 py-1.5 text-right" style={{ color: '#1A1A2E' }}>
                        {fmtAmt(txn)}
                        {isMatch && entAmt > 0 && (Math.abs(txnGross - entAmt) <= 1 ? ' ✅' : ' ⚠️')}
                      </td>
                      <td className="px-2 py-1.5 text-right" style={{ color: '#6B7280' }}>
                        {txnNav > 0 ? txnNav.toFixed(4) : '—'}
                        {isMatch && entNav > 0 && txnNav > 0 && (Math.abs(txnNav - entNav) <= 0.05 ? ' ✅' : ' ⚠️')}
                      </td>
                      <td className="px-2 py-1.5 text-right" style={{ color: '#6B7280' }}>
                        {txnUnits > 0 ? txnUnits.toFixed(4) : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right" style={{ color: '#9CA3AF', fontSize: 10 }}>
                        {Number(txn.balanceUnits) > 0 ? Number(txn.balanceUnits).toFixed(1) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 5. Other funds */}
      {otherFunds.map((group: any, gi: number) => (
        <div key={gi}>
          <p className="text-xs font-semibold mb-1" style={{ color: '#1B2A4A' }}>{group.fundName} ({group.transactions?.length} txns)</p>
          <div className="border rounded-lg overflow-hidden" style={{ borderColor: '#E8E5DD' }}>
            <table className="w-full text-xs">
              <thead><tr style={{ backgroundColor: '#FAFAF8' }}>
                <th className="px-2 py-1.5 text-left font-medium" style={{ color: '#9CA3AF' }}>Date</th>
                <th className="px-2 py-1.5 text-right font-medium" style={{ color: '#9CA3AF' }}>Amount</th>
                <th className="px-2 py-1.5 text-right font-medium" style={{ color: '#9CA3AF' }}>NAV</th>
                <th className="px-2 py-1.5 text-right font-medium" style={{ color: '#9CA3AF' }}>Units</th>
              </tr></thead>
              <tbody>
                {(group.transactions ?? []).map((txn: any, ti: number) => (
                  <tr key={ti} style={{ borderTop: '1px solid #F0EDE6' }}>
                    <td className="px-2 py-1.5" style={{ color: '#1A1A2E' }}>{txn.date ?? '—'}</td>
                    <td className="px-2 py-1.5 text-right" style={{ color: '#1A1A2E' }}>{fmtAmt(txn)}</td>
                    <td className="px-2 py-1.5 text-right" style={{ color: '#6B7280' }}>{Number(txn.nav) > 0 ? Number(txn.nav).toFixed(4) : '—'}</td>
                    <td className="px-2 py-1.5 text-right" style={{ color: '#6B7280' }}>{Number(txn.units) > 0 ? Number(txn.units).toFixed(4) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {/* 6. Debug */}
      <details style={{ marginTop: 8 }}>
        <summary className="text-[9px] cursor-pointer" style={{ color: '#9CA3AF' }}>Debug raw text ({Number(result.rawTextLength ?? 0).toLocaleString()} chars)</summary>
        <pre style={{ marginTop: 4, padding: 8, borderRadius: 6, fontSize: 9, maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', backgroundColor: '#1A1A2E', color: '#A0AEC0', fontFamily: 'monospace' }}>
          {result.rawText || 'No text'}
        </pre>
      </details>
      <p className="text-[9px]" style={{ color: '#9CA3AF' }}>
        {totalTxns} txns / {fundGroups.length} fund(s) |
        Match: {hasMatch ? `✅ ${matchedTxn?.date ?? ''}` : (entDate || entAmt > 0 ? '❌' : '—')} |
        Folio: {acct.folioNumber || '—'} | PAN: {acct.pan || '—'}
      </p>
    </div>
  );
}
