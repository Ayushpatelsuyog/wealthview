'use client';

import type { DashboardSnapshot } from '@/lib/types/dashboard';

// Simulated 1-year benchmark returns (can be replaced with live data later)
const BENCHMARKS = [
  { name: 'Nifty 50',  value: 14.2, color: '#1B2A4A', bg: 'rgba(27,42,74,0.08)' },
  { name: 'S&P 500',   value: 12.8, color: '#2E8B8B', bg: 'rgba(46,139,139,0.08)' },
  { name: 'Gold',      value: 8.5,  color: '#C9A84C', bg: '#F5EDD6' },
];

interface Props { snapshot: DashboardSnapshot }

export function BenchmarkComparison({ snapshot }: Props) {
  const { hasRealData, overallXirr } = snapshot;

  // Show empty state when no real XIRR to compare
  if (!hasRealData || overallXirr === 0) {
    return (
      <div className="wv-card p-5">
        <h3 className="section-heading text-sm mb-4">Benchmark Comparison</h3>
        <div className="space-y-3 mb-4">
          {BENCHMARKS.map((b) => (
            <div key={b.name}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs" style={{ color: '#6B7280' }}>{b.name}</span>
                <span className="text-sm font-bold" style={{ color: b.color }}>+{b.value}%</span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: '#F0EDE6' }}>
                <div className="h-full rounded-full" style={{ width: `${(b.value / 20) * 100}%`, backgroundColor: b.color }} />
              </div>
            </div>
          ))}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold" style={{ color: '#1A1A2E' }}>Your Portfolio</span>
              <span className="text-sm font-bold" style={{ color: '#9CA3AF' }}>—</span>
            </div>
            <div className="h-2 rounded-full" style={{ backgroundColor: '#F0EDE6', border: '1.5px dashed #D1D5DB' }} />
          </div>
        </div>
        <p className="text-[11px]" style={{ color: '#9CA3AF' }}>
          Add investments with transaction dates to see how your portfolio compares to benchmarks.
        </p>
      </div>
    );
  }

  const portfolioReturn = overallXirr;
  const items = [
    { name: 'Your Portfolio', value: portfolioReturn, color: '#059669', bg: 'rgba(5,150,105,0.12)', isPortfolio: true },
    ...BENCHMARKS.map(b => ({ ...b, isPortfolio: false })),
  ];
  const max = Math.max(...items.map(b => b.value));
  const outperformance = portfolioReturn - BENCHMARKS[0].value;

  return (
    <div className="wv-card p-5">
      <h3 className="section-heading text-sm mb-1">Benchmark Comparison</h3>
      <p className="text-[11px] mb-4" style={{ color: '#9CA3AF' }}>1-year annualised returns vs market</p>

      <div className="space-y-4">
        {items.map((item) => (
          <div key={item.name}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium" style={{ color: item.isPortfolio ? '#1A1A2E' : '#6B7280', fontWeight: item.isPortfolio ? 600 : 400 }}>
                {item.name}
              </span>
              <span className="text-sm font-bold" style={{ color: item.color }}>+{item.value.toFixed(1)}%</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: '#F0EDE6' }}>
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${(item.value / max) * 100}%`, backgroundColor: item.color }} />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-4 flex items-center justify-between" style={{ borderTop: '1px solid #E8E5DD' }}>
        <span className="text-xs" style={{ color: '#9CA3AF' }}>
          {outperformance >= 0 ? 'Outperforming' : 'Underperforming'} Nifty 50 by
        </span>
        <span className="text-sm font-bold" style={{ color: outperformance >= 0 ? '#059669' : '#DC2626' }}>
          {outperformance >= 0 ? '+' : ''}{outperformance.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}
