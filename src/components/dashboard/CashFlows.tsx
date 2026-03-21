'use client';

import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';

const flows = [
  { date: 'Apr 2',  description: 'HDFC FD Maturity', amount:  1250000, type: 'inflow'  as const },
  { date: 'Apr 5',  description: 'LIC Premium Due',   amount: -124000,  type: 'outflow' as const },
  { date: 'Apr 15', description: 'SBI FD Maturity',   amount:  800000,  type: 'inflow'  as const },
  { date: 'Apr 1',  description: 'SIP Auto-debit',    amount: -375000,  type: 'outflow' as const },
];

function fmt(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 100000) return `₹${(abs / 100000).toFixed(2)}L`;
  return `₹${abs.toLocaleString('en-IN')}`;
}

export function CashFlows() {
  const net = flows.reduce((s, f) => s + f.amount, 0);

  return (
    <div className="wv-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="section-heading text-sm flex-1">Cash Flows</h3>
        <span className="text-xs ml-4" style={{ color: '#9CA3AF' }}>Next 90 days</span>
      </div>

      <div className="space-y-2 mb-4">
        {flows.map((f, i) => (
          <div key={i} className="flex items-center gap-3 p-3 rounded-xl" style={{ backgroundColor: '#F7F5F0' }}>
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
              style={{
                backgroundColor: f.type === 'inflow' ? 'rgba(5,150,105,0.1)' : 'rgba(220,38,38,0.1)',
              }}
            >
              {f.type === 'inflow'
                ? <ArrowDownLeft className="w-3.5 h-3.5" style={{ color: '#059669' }} />
                : <ArrowUpRight  className="w-3.5 h-3.5" style={{ color: '#DC2626' }} />
              }
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate" style={{ color: '#1A1A2E' }}>{f.description}</p>
              <p className="text-[10px]" style={{ color: '#9CA3AF' }}>{f.date}, 2025</p>
            </div>
            <span
              className="text-xs font-bold flex-shrink-0"
              style={{ color: f.type === 'inflow' ? '#059669' : '#DC2626' }}
            >
              {f.type === 'inflow' ? '+' : '-'}{fmt(f.amount)}
            </span>
          </div>
        ))}
      </div>

      <div
        className="flex items-center justify-between pt-3"
        style={{ borderTop: '1px solid #E8E5DD' }}
      >
        <span className="text-xs font-medium" style={{ color: '#6B7280' }}>Net Cash Flow</span>
        <span className="text-sm font-bold" style={{ color: net >= 0 ? '#059669' : '#DC2626' }}>
          {net >= 0 ? '+' : ''}{fmt(net)}
        </span>
      </div>
    </div>
  );
}
