'use client';

import { Card } from '@/components/ui/card';

const benchmarks = [
  { name: 'Portfolio', value: 18.4, color: '#1B2A4A', isPortfolio: true },
  { name: 'Nifty 50', value: 14.2, color: '#C9A84C', isPortfolio: false },
  { name: 'S&P 500', value: 12.8, color: '#4B6CB7', isPortfolio: false },
  { name: 'Gold', value: 8.5, color: '#D4AF37', isPortfolio: false },
];

const maxValue = Math.max(...benchmarks.map((b) => b.value));

export function BenchmarkComparison() {
  return (
    <Card className="p-5 border-0 shadow-sm bg-white">
      <div className="mb-4">
        <h3 className="font-semibold text-gray-900">Benchmark Comparison</h3>
        <p className="text-xs text-gray-500 mt-0.5">1-year returns</p>
      </div>

      <div className="space-y-4">
        {benchmarks.map((item) => (
          <div key={item.name}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: item.color }}
                />
                <span className={`text-sm ${item.isPortfolio ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
                  {item.name}
                </span>
              </div>
              <span
                className={`text-sm font-semibold ${item.isPortfolio ? '' : 'text-gray-700'}`}
                style={{ color: item.isPortfolio ? '#1B2A4A' : undefined }}
              >
                +{item.value}%
              </span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${(item.value / maxValue) * 100}%`,
                  backgroundColor: item.color,
                }}
              />
            </div>
          </div>
        ))}
      </div>

      <div
        className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between"
      >
        <span className="text-xs text-gray-500">Outperforming Nifty by</span>
        <span className="text-sm font-bold text-green-600">+4.2%</span>
      </div>
    </Card>
  );
}
