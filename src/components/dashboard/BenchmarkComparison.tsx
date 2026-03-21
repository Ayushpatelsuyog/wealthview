'use client';

const benchmarks = [
  { name: 'Your Portfolio', value: 18.4, color: '#059669', bg: 'rgba(5,150,105,0.12)', isPortfolio: true },
  { name: 'Nifty 50',       value: 14.2, color: '#1B2A4A', bg: 'rgba(27,42,74,0.08)',  isPortfolio: false },
  { name: 'S&P 500',        value: 12.8, color: '#2E8B8B', bg: 'rgba(46,139,139,0.08)',isPortfolio: false },
  { name: 'Gold',           value: 8.5,  color: '#C9A84C', bg: '#F5EDD6',              isPortfolio: false },
];

const max = Math.max(...benchmarks.map((b) => b.value));

export function BenchmarkComparison() {
  return (
    <div className="wv-card p-5">
      <h3 className="section-heading text-sm mb-4">Benchmark Comparison</h3>
      <p className="text-[11px] mb-4" style={{ color: '#9CA3AF' }}>1-year annualised returns</p>

      <div className="space-y-4">
        {benchmarks.map((item) => (
          <div key={item.name}>
            <div className="flex items-center justify-between mb-1.5">
              <span
                className="text-xs font-medium"
                style={{ color: item.isPortfolio ? '#1A1A2E' : '#6B7280', fontWeight: item.isPortfolio ? 600 : 400 }}
              >
                {item.name}
              </span>
              <span className="text-sm font-bold" style={{ color: item.color }}>
                +{item.value}%
              </span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: '#F0EDE6' }}>
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${(item.value / max) * 100}%`, backgroundColor: item.color }}
              />
            </div>
          </div>
        ))}
      </div>

      <div
        className="mt-4 pt-4 flex items-center justify-between"
        style={{ borderTop: '1px solid #E8E5DD' }}
      >
        <span className="text-xs" style={{ color: '#9CA3AF' }}>Outperforming Nifty 50 by</span>
        <span className="text-sm font-bold" style={{ color: '#059669' }}>+4.2%</span>
      </div>
    </div>
  );
}
