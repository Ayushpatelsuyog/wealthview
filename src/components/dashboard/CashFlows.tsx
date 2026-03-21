'use client';

import { Card } from '@/components/ui/card';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';

const flows = [
  {
    date: 'Apr 2',
    description: 'HDFC FD Maturity',
    amount: 1250000,
    type: 'inflow' as const,
  },
  {
    date: 'Apr 5',
    description: 'LIC Premium Due',
    amount: -124000,
    type: 'outflow' as const,
  },
  {
    date: 'Apr 15',
    description: 'SBI FD Maturity',
    amount: 800000,
    type: 'inflow' as const,
  },
  {
    date: 'Apr 1',
    description: 'SIP Auto-debit',
    amount: -375000,
    type: 'outflow' as const,
  },
];

function formatINR(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 100000) return `₹${(abs / 100000).toFixed(2)}L`;
  return `₹${abs.toLocaleString('en-IN')}`;
}

export function CashFlows() {
  const netFlow = flows.reduce((sum, f) => sum + f.amount, 0);

  return (
    <Card className="p-5 border-0 shadow-sm bg-white">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-gray-900">Cash Flows</h3>
          <p className="text-xs text-gray-500 mt-0.5">Next 90 days</p>
        </div>
        <div
          className={`text-sm font-bold px-3 py-1 rounded-full ${
            netFlow >= 0
              ? 'text-green-700 bg-green-50'
              : 'text-red-700 bg-red-50'
          }`}
        >
          Net {netFlow >= 0 ? '+' : ''}{formatINR(netFlow)}
        </div>
      </div>

      <div className="space-y-2">
        {flows.map((flow, i) => (
          <div
            key={i}
            className="flex items-center gap-3 p-3 rounded-lg bg-gray-50"
          >
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                flow.type === 'inflow' ? 'bg-green-100' : 'bg-red-100'
              }`}
            >
              {flow.type === 'inflow' ? (
                <ArrowDownLeft className="w-4 h-4 text-green-600" />
              ) : (
                <ArrowUpRight className="w-4 h-4 text-red-600" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800 truncate">{flow.description}</p>
              <p className="text-xs text-gray-400">{flow.date}, 2025</p>
            </div>
            <span
              className={`text-sm font-semibold flex-shrink-0 ${
                flow.type === 'inflow' ? 'text-green-600' : 'text-red-600'
              }`}
            >
              {flow.type === 'inflow' ? '+' : '-'}{formatINR(flow.amount)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
