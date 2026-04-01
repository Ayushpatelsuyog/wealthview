'use client';

import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { formatLargeINR } from '@/lib/utils/formatters';
import Link from 'next/link';
import type { DashboardSnapshot } from '@/lib/types/dashboard';

function fmtAmount(amount: number): string {
  const abs = Math.abs(amount);
  return formatLargeINR(abs);
}

function fmtDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

const typeLabels: Record<string, string> = {
  fd_maturity: 'FD',
  insurance_premium: 'Insurance',
  sip: 'SIP',
  loan_emi: 'Loan',
};

interface Props { snapshot: DashboardSnapshot }

export function CashFlows({ snapshot }: Props) {
  const { cashFlows, hasRealData } = snapshot;

  const net = cashFlows.reduce((s, f) => s + f.amount, 0);

  return (
    <div className="wv-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="section-heading text-sm flex-1">Cash Flows</h3>
        <span className="text-xs ml-4" style={{ color: 'var(--wv-text-muted)' }}>Next 90 days</span>
      </div>

      {!hasRealData || cashFlows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-6 gap-3">
          <p className="text-xs text-center" style={{ color: 'var(--wv-text-muted)' }}>
            No upcoming cash flows
          </p>
          <p className="text-[11px] text-center" style={{ color: '#D1D5DB' }}>
            Add FDs, insurance policies, or SIPs to track upcoming inflows &amp; outflows
          </p>
          <div className="flex gap-2">
            <Link href="/add-assets/fixed-deposits" className="text-xs font-medium px-3 py-1.5 rounded-lg" style={{ backgroundColor: 'var(--wv-surface-2)', color: 'var(--wv-text-secondary)' }}>
              Add FD
            </Link>
            <Link href="/add-assets/insurance" className="text-xs font-medium px-3 py-1.5 rounded-lg" style={{ backgroundColor: 'var(--wv-surface-2)', color: 'var(--wv-text-secondary)' }}>
              Add Insurance
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-2 mb-4">
            {cashFlows.map((f, i) => {
              const isInflow = f.amount >= 0;
              return (
                <div key={i} className="flex items-center gap-3 p-3 rounded-xl" style={{ backgroundColor: 'var(--wv-surface-2)' }}>
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: isInflow ? 'rgba(5,150,105,0.1)' : 'rgba(220,38,38,0.1)' }}
                  >
                    {isInflow
                      ? <ArrowDownLeft className="w-3.5 h-3.5" style={{ color: '#059669' }} />
                      : <ArrowUpRight  className="w-3.5 h-3.5" style={{ color: '#DC2626' }} />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs font-medium truncate" style={{ color: 'var(--wv-text)' }}>{f.description}</p>
                      <span className="text-[9px] px-1 py-0.5 rounded flex-shrink-0" style={{ backgroundColor: 'var(--wv-border)', color: 'var(--wv-text-secondary)' }}>
                        {typeLabels[f.type] ?? f.type}
                      </span>
                    </div>
                    <p className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>{fmtDate(f.date)}</p>
                  </div>
                  <span
                    className="text-xs font-bold flex-shrink-0"
                    style={{ color: isInflow ? '#059669' : '#DC2626' }}
                  >
                    {isInflow ? '+' : '-'}{fmtAmount(f.amount)}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between pt-3" style={{ borderTop: '1px solid var(--wv-border)' }}>
            <span className="text-xs font-medium" style={{ color: 'var(--wv-text-secondary)' }}>Net Cash Flow</span>
            <span className="text-sm font-bold" style={{ color: net >= 0 ? '#059669' : '#DC2626' }}>
              {net >= 0 ? '+' : ''}{fmtAmount(net)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
