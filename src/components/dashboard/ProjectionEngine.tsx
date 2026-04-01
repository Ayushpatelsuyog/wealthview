'use client';

import { useState, useMemo } from 'react';
import { Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';
import { formatLargeINR } from '@/lib/utils/formatters';
import type { DashboardSnapshot } from '@/lib/types/dashboard';

function calcProjection(current: number, equity: number, debt: number, gold: number, sipL: number) {
  const sip = sipL * 100000;
  const blended = 0.6 * (equity / 100) + 0.2 * (debt / 100) + 0.1 * (gold / 100) + 0.1 * 0.07;
  let portfolio = current;
  let invested = current;
  const points = [{ year: 0, portfolio: Math.round(current), invested: Math.round(current), inflows: 0 }];
  for (let y = 1; y <= 10; y++) {
    portfolio = portfolio * (1 + blended) + sip;
    invested += sip;
    points.push({ year: y, portfolio: Math.round(portfolio), invested: Math.round(invested), inflows: Math.round(sip * y) });
  }
  return points;
}

interface SliderRowProps {
  label: string; unit: string;
  min: number; max: number; step: number; value: number;
  onChange: (v: number) => void;
}
function SliderRow({ label, unit, min, max, step, value, onChange }: SliderRowProps) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="flex justify-between mb-1">
        <span className="text-[11px]" style={{ color: 'var(--wv-text-secondary)' }}>{label}</span>
        <span className="text-[11px] font-semibold" style={{ color: 'var(--wv-text)' }}>
          {unit === '₹' ? `₹${value}L` : `${value}%`}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ background: `linear-gradient(to right, #C9A84C ${pct}%, var(--wv-border) ${pct}%)` }}
        className="w-full"
      />
      <div className="flex justify-between mt-0.5">
        <span className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>{unit === '₹' ? `₹${min}L` : `${min}%`}</span>
        <span className="text-[10px]" style={{ color: 'var(--wv-text-muted)' }}>{unit === '₹' ? `₹${max}L` : `${max}%`}</span>
      </div>
    </div>
  );
}

interface TTProps { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string | number }
function CustomTooltip({ active, payload, label }: TTProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border rounded-xl p-3 shadow-card-hover text-xs" style={{ borderColor: 'var(--wv-border)' }}>
      <p className="font-semibold mb-2" style={{ color: 'var(--wv-text-secondary)' }}>Year {label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 mb-0.5">
          <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: p.color }} />
          <span style={{ color: 'var(--wv-text-secondary)' }}>
            {p.name === 'portfolio' ? 'Projected NW' : p.name === 'invested' ? 'Invested Capital' : 'FD/Ins Inflows'}:
          </span>
          <span className="font-semibold" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

interface Props { snapshot: DashboardSnapshot }

export function ProjectionEngine({ snapshot }: Props) {
  const startingNetWorth = snapshot.netWorth;
  const hasData = snapshot.hasRealData;

  const [equity, setEquity] = useState(12);
  const [debt,   setDebt]   = useState(7);
  const [gold,   setGold]   = useState(8);
  const [sip,    setSip]    = useState(hasData ? Math.round((snapshot.monthlySipOutflow || 0) / 100000) || 5 : 15);

  const data = useMemo(() => calcProjection(startingNetWorth, equity, debt, gold, sip), [startingNetWorth, equity, debt, gold, sip]);

  const yr3  = data[3]?.portfolio  ?? 0;
  const yr5  = data[5]?.portfolio  ?? 0;
  const yr10 = data[10]?.portfolio ?? 0;
  const totalInflows = data[10]?.inflows ?? 0;

  return (
    <div className="wv-card p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="section-heading text-sm">Projection Engine</h3>
        {hasData && startingNetWorth > 0 && (
          <span className="text-[11px]" style={{ color: 'var(--wv-text-muted)' }}>
            Starting from {formatLargeINR(startingNetWorth)}
          </span>
        )}
      </div>
      {!hasData && (
        <p className="text-[11px] mb-4" style={{ color: 'var(--wv-text-muted)' }}>
          Add investments to project from your actual net worth. Currently projecting from ₹0.
        </p>
      )}

      {/* Sliders */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 mb-5 mt-4">
        <SliderRow label="Equity Return" unit="%" min={6}  max={20} step={0.5} value={equity} onChange={setEquity} />
        <SliderRow label="Debt Return"   unit="%" min={4}  max={10} step={0.5} value={debt}   onChange={setDebt}   />
        <SliderRow label="Gold Return"   unit="%" min={2}  max={14} step={0.5} value={gold}   onChange={setGold}   />
        <SliderRow label="Annual SIP"    unit="₹" min={0}  max={50} step={1}   value={sip}    onChange={setSip}    />
      </div>

      {/* Legend */}
      <div className="flex items-center gap-5 mb-3">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#C9A84C' }} />
          <span className="text-[11px]" style={{ color: 'var(--wv-text-secondary)' }}>Projected NW</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#2E8B8B' }} />
          <span className="text-[11px]" style={{ color: 'var(--wv-text-secondary)' }}>FD/Insurance inflows</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#F5EDD6' }} />
          <span className="text-[11px]" style={{ color: 'var(--wv-text-secondary)' }}>Invested capital</span>
        </div>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: 5 }}>
          <defs>
            <linearGradient id="goldGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#C9A84C" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#C9A84C" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#F0EDE6" />
          <XAxis dataKey="year" tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} label={{ value: 'Years', position: 'insideBottom', offset: -2, fontSize: 10, fill: '#9CA3AF' }} />
          <YAxis tickFormatter={(v) => formatLargeINR(v)} tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} width={70} />
          <Tooltip content={<CustomTooltip />} />
          <Area type="monotone" dataKey="invested" stroke="#F5EDD6" strokeWidth={1} fill="#F5EDD6" fillOpacity={1} />
          <Line type="monotone" dataKey="inflows"   stroke="#2E8B8B" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
          <Area type="monotone" dataKey="portfolio" stroke="#C9A84C" strokeWidth={2.5} fill="url(#goldGrad)" dot={false} activeDot={{ r: 4, fill: '#C9A84C' }} />
        </AreaChart>
      </ResponsiveContainer>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3 mt-4">
        {[
          { label: '3 Years',   value: yr3 },
          { label: '5 Years',   value: yr5 },
          { label: '10 Years',  value: yr10 },
          { label: 'FD/Ins In', value: totalInflows },
        ].map((item) => (
          <div key={item.label} className="text-center p-3 rounded-xl" style={{ backgroundColor: 'var(--wv-surface-2)' }}>
            <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--wv-text-muted)' }}>{item.label}</p>
            <p className="font-display text-sm font-semibold" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(item.value)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
