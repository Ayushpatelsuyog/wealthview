'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { formatLargeINR } from '@/lib/utils/formatters';
import type { DashboardSnapshot } from '@/lib/types/dashboard';

function RealTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border rounded-xl p-3 shadow-card-hover text-xs" style={{ borderColor: 'var(--wv-border)' }}>
      <p className="font-semibold mb-2" style={{ color: 'var(--wv-text-secondary)' }}>{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 mb-0.5">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span style={{ color: 'var(--wv-text-secondary)' }}>Net Worth:</span>
          <span className="font-semibold" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

interface Props { snapshot: DashboardSnapshot }

export function NetWorthTimeline({ snapshot }: Props) {

  // Real data mode: single data point (today's net worth)
  if (snapshot.hasRealData) {
    const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const realData = [{ label: today, value: snapshot.netWorth }];

    return (
      <div className="wv-card p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="section-heading text-sm">Net Worth Timeline</h3>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--wv-text-muted)' }}>
              Timeline builds as you track over time — check back daily
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 mb-3">
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-0.5 rounded" style={{ backgroundColor: '#C9A84C' }} />
            <span className="text-[11px]" style={{ color: 'var(--wv-text-secondary)' }}>Portfolio</span>
          </div>
        </div>

        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={realData} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F0EDE6" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
            <YAxis
              tickFormatter={(v) => formatLargeINR(v)}
              tick={{ fontSize: 10, fill: '#9CA3AF' }}
              axisLine={false} tickLine={false} width={70}
            />
            <Tooltip content={<RealTooltip />} />
            <Line type="monotone" dataKey="value" stroke="#C9A84C" strokeWidth={2.5} dot={{ r: 6, fill: '#C9A84C', stroke: '#F7F5F0', strokeWidth: 2 }} activeDot={{ r: 6, fill: '#C9A84C' }} />
          </LineChart>
        </ResponsiveContainer>

        <p className="text-center text-[10px] mt-2" style={{ color: '#D1D5DB' }}>
          More data points accumulate as you use WealthView daily
        </p>
      </div>
    );
  }

  // Empty state — clean, no demo data
  return (
    <div className="wv-card p-5">
      <h3 className="section-heading text-sm mb-4">Net Worth Timeline</h3>
      <div className="flex flex-col items-center justify-center py-10 gap-3">
        <div
          className="w-full h-24 rounded-xl flex items-end gap-1 px-4 pb-3"
          style={{ backgroundColor: 'var(--wv-surface-2)' }}
        >
          {[20, 35, 28, 45, 40, 60, 55, 72, 68, 85, 80, 100].map((h, i) => (
            <div key={i} className="flex-1 rounded-t" style={{ height: `${h}%`, backgroundColor: 'var(--wv-border)' }} />
          ))}
        </div>
        <p className="text-sm font-medium" style={{ color: 'var(--wv-text)' }}>Your wealth journey starts here</p>
        <p className="text-xs text-center max-w-xs" style={{ color: 'var(--wv-text-muted)' }}>
          Add investments and assets to begin tracking your net worth over time
        </p>
      </div>
    </div>
  );
}
