'use client';

import { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const PERIODS = ['1M', '3M', '6M', '1Y', '3Y', 'All'] as const;
type Period = typeof PERIODS[number];

function genData(months: number) {
  const labels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let p = 6800, n = 6800;
  return Array.from({ length: months }, (_, i) => {
    p = Math.round(p * (1 + (Math.random() * 0.05 - 0.005)));
    n = Math.round(n * (1 + (Math.random() * 0.035 - 0.003)));
    return { label: labels[i % 12], portfolio: p, nifty: n };
  });
}

const dataMap: Record<Period, ReturnType<typeof genData>> = {
  '1M':  genData(4),
  '3M':  genData(12),
  '6M':  genData(24),
  '1Y':  genData(13),
  '3Y':  genData(36),
  'All': genData(48),
};

interface TooltipProps { active?: boolean; payload?: Array<{ color: string; name: string; value: number }>; label?: string }

function CustomTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border rounded-xl p-3 shadow-card-hover text-xs" style={{ borderColor: '#E8E5DD' }}>
      <p className="font-semibold mb-2" style={{ color: '#6B7280' }}>{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 mb-0.5">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span style={{ color: '#6B7280' }}>{p.name === 'portfolio' ? 'Portfolio' : 'Nifty 50'}:</span>
          <span className="font-semibold" style={{ color: '#1A1A2E' }}>₹{(p.value / 100).toFixed(2)}Cr</span>
        </div>
      ))}
    </div>
  );
}

export function NetWorthTimeline() {
  const [period, setPeriod] = useState<Period>('1Y');
  const data = dataMap[period];

  return (
    <div className="wv-card p-5">
      <div className="flex items-center justify-between mb-5">
        <h3 className="section-heading text-sm flex-1">Net Worth Timeline</h3>
        <div className="flex gap-1 ml-4">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className="text-[11px] px-2.5 py-1 rounded-lg font-medium transition-colors"
              style={{
                backgroundColor: period === p ? '#1B2A4A' : 'transparent',
                color: period === p ? 'white' : '#9CA3AF',
              }}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-3">
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-0.5 rounded" style={{ backgroundColor: '#C9A84C' }} />
          <span className="text-[11px]" style={{ color: '#6B7280' }}>Portfolio</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-0 border-t-2 border-dashed" style={{ borderColor: '#1B2A4A' }} />
          <span className="text-[11px]" style={{ color: '#6B7280' }}>Nifty 50</span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#F0EDE6" />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
          <YAxis
            tickFormatter={(v) => `₹${(v / 100).toFixed(1)}Cr`}
            tick={{ fontSize: 10, fill: '#9CA3AF' }}
            axisLine={false}
            tickLine={false}
            width={58}
          />
          <Tooltip content={<CustomTooltip />} />
          <Line type="monotone" dataKey="portfolio" stroke="#C9A84C" strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: '#C9A84C' }} />
          <Line type="monotone" dataKey="nifty" stroke="#1B2A4A" strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
