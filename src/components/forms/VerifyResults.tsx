'use client';

import React from 'react';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface VerifyResultsProps {
  result: any;
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
  // Robust amount extraction with multiple fallbacks
  const gross = Number(txn?.grossAmount);
  if (isFinite(gross) && gross > 0) return `₹${gross.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  const net = Number(txn?.netAmount);
  if (isFinite(net) && net > 0) return `₹${net.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  const calc = Number(txn?.units) * Number(txn?.nav);
  if (isFinite(calc) && calc > 0) return `₹${calc.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  return '—';
}

export function VerifyResults({ result }: VerifyResultsProps) {
  if (!result) return null;

  const acct = result.accountDetails ?? {};
  const mf = result.matchedFund;
  const mt = result.matchedTransaction;
  const comp = mt?.comparison ?? {};
  const fundGroups: any[] = result.allFundGroups ?? [];
  const totalTxns = Number(result.totalTransactionsInStatement ?? 0);

  const compEntries = Object.entries(comp);
  const matchCount = compEntries.filter(([, v]: any) => v.match).length;
  const mismatchCount = compEntries.filter(([, v]: any) => !v.match).length;

  return (
    <div className="space-y-3">

      {/* 1. Account Details */}
      <div className="p-3 rounded-lg text-xs" style={{ backgroundColor: 'rgba(27,42,74,0.04)', border: '1px solid rgba(27,42,74,0.08)' }}>
        <p className="font-semibold mb-2" style={{ color: '#1B2A4A' }}>Statement Details</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          {mf?.fundName && <div><span style={{ color: '#9CA3AF' }}>Fund:</span> <strong>{mf.fundName}</strong></div>}
          {acct.folioNumber && <div><span style={{ color: '#9CA3AF' }}>Folio:</span> <strong>{acct.folioNumber}</strong></div>}
          {acct.pan && <div><span style={{ color: '#9CA3AF' }}>PAN:</span> <strong>{acct.pan}</strong></div>}
          {acct.nominee && <div><span style={{ color: '#9CA3AF' }}>Nominee:</span> <strong>{acct.nominee}</strong></div>}
          {acct.email && <div><span style={{ color: '#9CA3AF' }}>Email:</span> <strong>{acct.email}</strong></div>}
          {acct.mobile && <div><span style={{ color: '#9CA3AF' }}>Mobile:</span> <strong>{acct.mobile}</strong></div>}
          {acct.bankAccount && <div><span style={{ color: '#9CA3AF' }}>Bank:</span> <strong>{acct.bankAccount}</strong></div>}
          {acct.distributorName && <div><span style={{ color: '#9CA3AF' }}>Distributor:</span> <strong>{acct.distributorName}</strong></div>}
          <div><span style={{ color: '#9CA3AF' }}>Total:</span> <strong>{totalTxns} transactions across {fundGroups.length} fund(s)</strong></div>
        </div>
      </div>

      {/* 2. Transaction Comparison (entered vs statement) */}
      {mt && mt.found && compEntries.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold" style={{ color: '#1B2A4A' }}>Transaction Verification</p>
            <span className="text-[10px] px-2 py-0.5 rounded-full" style={{
              backgroundColor: mismatchCount === 0 ? 'rgba(5,150,105,0.1)' : 'rgba(201,168,76,0.1)',
              color: mismatchCount === 0 ? '#059669' : '#92620A',
            }}>
              {matchCount} matched{mismatchCount > 0 ? `, ${mismatchCount} mismatched` : ''}
            </span>
          </div>
          <table className="w-full text-xs border rounded-lg overflow-hidden">
            <thead>
              <tr style={{ backgroundColor: '#F7F5F0' }}>
                <th className="text-left px-3 py-2 font-medium" style={{ color: '#6B7280' }}>Field</th>
                <th className="text-right px-3 py-2 font-medium" style={{ color: '#6B7280' }}>Your Entry</th>
                <th className="text-right px-3 py-2 font-medium" style={{ color: '#6B7280' }}>AMC Statement</th>
                <th className="text-center px-3 py-2 font-medium" style={{ color: '#6B7280' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {compEntries.map(([key, val]: any) => (
                <tr key={key} style={{ borderTop: '1px solid #F0EDE6', backgroundColor: val.match ? 'rgba(5,150,105,0.03)' : 'rgba(201,168,76,0.05)' }}>
                  <td className="px-3 py-2 font-medium" style={{ color: '#1A1A2E' }}>{FIELD_LABELS[key] ?? key}</td>
                  <td className="px-3 py-2 text-right" style={{ color: '#6B7280' }}>{fmtVal(val.entered)}</td>
                  <td className="px-3 py-2 text-right font-medium" style={{ color: '#1A1A2E' }}>{fmtVal(val.statement)}</td>
                  <td className="px-3 py-2 text-center">
                    {val.match
                      ? <span style={{ color: '#059669' }}>✓ Match</span>
                      : <span style={{ color: '#D97706' }}>⚠ {val.diff !== undefined ? `Diff: ${fmtVal(val.diff)}` : 'Mismatch'}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="p-2.5 rounded-lg text-xs mt-2" style={{
            backgroundColor: mismatchCount === 0 ? 'rgba(5,150,105,0.06)' : 'rgba(201,168,76,0.06)',
            color: mismatchCount === 0 ? '#059669' : '#92620A',
            border: `1px solid ${mismatchCount === 0 ? 'rgba(5,150,105,0.15)' : 'rgba(201,168,76,0.15)'}`,
          }}>
            {mismatchCount === 0
              ? '✓ All values verified — your entry matches the AMC statement perfectly'
              : `⚠ ${mismatchCount} mismatch(es) found — review above`}
          </div>
        </div>
      )}

      {mt && !mt.found && (
        <div className="p-3 rounded-lg text-xs" style={{ backgroundColor: 'rgba(201,168,76,0.06)', color: '#92620A', border: '1px solid rgba(201,168,76,0.15)' }}>
          No matching transaction found in the statement for the entered date/amount. The statement may cover a different period.
        </div>
      )}

      {/* 3. All Fund Groups with Transactions */}
      {fundGroups.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold" style={{ color: '#1B2A4A' }}>
            All Transactions in Statement ({totalTxns} total across {fundGroups.length} fund{fundGroups.length > 1 ? 's' : ''})
          </p>
          {fundGroups.map((group: any, gi: number) => {
            const txns: any[] = group.transactions ?? [];
            if (txns.length === 0) return null;
            return (
              <div key={gi} className="border rounded-lg overflow-hidden" style={{ borderColor: group.isMatchedFund ? '#C9A84C' : '#E8E5DD' }}>
                {/* Fund header */}
                <div className="px-3 py-2 flex items-center justify-between" style={{ backgroundColor: group.isMatchedFund ? 'rgba(201,168,76,0.06)' : '#F7F5F0' }}>
                  <div>
                    <p className="text-xs font-semibold" style={{ color: '#1B2A4A' }}>{group.fundName || 'Unknown Fund'}</p>
                    <p className="text-[10px]" style={{ color: '#9CA3AF' }}>
                      {txns.length} transaction{txns.length !== 1 ? 's' : ''}
                      {group.isMatchedFund ? ' (current fund)' : ''}
                      {group.sipCancelled ? <span style={{ color: '#DC2626' }}> · SIP Cancelled</span> : null}
                    </p>
                  </div>
                  {Number(group.closingUnits) > 0 && (
                    <span className="text-[10px]" style={{ color: '#6B7280' }}>Balance: {Number(group.closingUnits).toFixed(3)} units</span>
                  )}
                </div>
                {/* Transactions table */}
                <table className="w-full text-xs">
                  <thead>
                    <tr style={{ borderTop: '1px solid #F0EDE6', backgroundColor: '#FAFAF8' }}>
                      <th className="px-3 py-1.5 text-left font-medium" style={{ color: '#9CA3AF' }}>Date</th>
                      <th className="px-3 py-1.5 text-left font-medium" style={{ color: '#9CA3AF' }}>Type</th>
                      <th className="px-3 py-1.5 text-right font-medium" style={{ color: '#9CA3AF' }}>Amount</th>
                      <th className="px-3 py-1.5 text-right font-medium" style={{ color: '#9CA3AF' }}>NAV</th>
                      <th className="px-3 py-1.5 text-right font-medium" style={{ color: '#9CA3AF' }}>Units</th>
                      <th className="px-3 py-1.5 text-right font-medium" style={{ color: '#9CA3AF' }}>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {txns.map((txn: any, ti: number) => (
                      <tr key={ti} style={{ borderTop: '1px solid #F0EDE6' }}>
                        <td className="px-3 py-1.5" style={{ color: '#1A1A2E' }}>{txn.date ?? '—'}</td>
                        <td className="px-3 py-1.5" style={{ color: '#6B7280' }}>{txn.type ?? '—'}</td>
                        <td className="px-3 py-1.5 text-right font-medium" style={{ color: '#1A1A2E' }}>{fmtAmt(txn)}</td>
                        <td className="px-3 py-1.5 text-right" style={{ color: '#6B7280' }}>
                          {Number(txn.nav) > 0 ? Number(txn.nav).toFixed(4) : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right" style={{ color: '#6B7280' }}>
                          {Number(txn.units) > 0 ? Number(txn.units).toFixed(4) : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right" style={{ color: '#9CA3AF' }}>
                          {Number(txn.balanceUnits) > 0 ? Number(txn.balanceUnits).toFixed(3) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}

      {/* 4. Debug: raw text */}
      <details style={{ marginTop: 16 }}>
        <summary className="text-[10px] cursor-pointer" style={{ color: '#9CA3AF' }}>
          Debug: Raw extracted text ({Number(result.rawTextLength ?? 0).toLocaleString()} chars)
        </summary>
        <pre style={{ marginTop: 4, padding: 12, borderRadius: 8, fontSize: 10, lineHeight: 1.5, maxHeight: 400, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', backgroundColor: '#1A1A2E', color: '#A0AEC0', fontFamily: 'ui-monospace, monospace' }}>
          {result.rawText || 'No text extracted'}
        </pre>
      </details>
      <p className="text-[9px]" style={{ color: '#9CA3AF' }}>
        Parsed: {totalTxns} txns across {fundGroups.length} fund(s) |
        Match: {mt ? (mt.found ? 'Yes' : 'No match') : 'Not attempted'} |
        Folio: {acct.folioNumber || '—'} | PAN: {acct.pan || '—'}
      </p>
    </div>
  );
}
