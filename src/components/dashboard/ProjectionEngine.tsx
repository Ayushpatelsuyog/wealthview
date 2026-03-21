'use client';

import { useState, useMemo } from 'react';
import { Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';

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

function fmt(v: number) {
  if (v >= 10000000) return `₹${(v / 10000000).toFixed(2)}Cr`;
  if (v >= 100000)   return `₹${(v / 100000).toFixed(2)}L`;
  return `₹${v.toLocaleString('en-IN')}`;
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
        <span className="text-[11px]" style={{ color: '#6B7280' }}>{label}</span>
        <span className="text-[11px] font-semibold" style={{ color: '#1A1A2E' }}>
          {unit === '₹' ? `₹${value}L` : `${value}%`}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ background: `linear-gradient(to right, #C9A84C ${pct}%, #E8E5DD ${pct}%)` }}
        className="w-full"
      />
      <div className="flex justify-between mt-0.5">
        <span className="text-[10px]" style={{ color: '#9CA3AF' }}>{unit === '₹' ? `₹${min}L` : `${min}%`}</span>
        <span className="text-[10px]" style={{ color: '#9CA3AF' }}>{unit === '₹' ? `₹${max}L` : `${max}%`}</span>
      </div>
    </div>
  );
}

interface TTProps { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string | number }
function CustomTooltip({ active, payload, label }: TTProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border rounded-xl p-3 shadow-card-hover text-xs" style={{ borderColor: '#E8E5DD' }}>
      <p className="font-semibold mb-2" style={{ color: '#6B7280' }}>Year {label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 mb-0.5">
          <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: p.color }} />
          <span style={{ color: '#6B7280' }}>
            {p.name === 'portfolio' ? 'Projected NW' : p.name === 'invested' ? 'Invested Capital' : 'FD/Ins Inflows'}:
          </span>
          <span className="font-semibold" style={{ color: '#1A1A2E' }}>{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function ProjectionEngine() {
  const [equity, setEquity] = useState(12);
  const [debt,   setDebt]   = useState(7);
  const [gold,   setGold]   = useState(8);
  const [sip,    setSip]    = useState(15);

  const data = useMemo(() => calcProjection(84732500, equity, debt, gold, sip), [equity, debt, gold, sip]);

  const yr3  = data[3]?.portfolio  ?? 0;
  const yr5  = data[5]?.portfolio  ?? 0;
  const yr10 = data[10]?.portfolio ?? 0;
  const totalInflows = data[10]?.inflows ?? 0;

  return (
    <div className="wv-card p-5">
      <h3 className="section-heading text-sm mb-5">Projection Engine</h3>

      {/* Sliders */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 mb-5">
        <SliderRow label="Equity Return" unit="%" min={6}  max={20} step={0.5} value={equity} onChange={setEquity} />
        <SliderRow label="Debt Return"   unit="%" min={4}  max={10} step={0.5} value={debt}   onChange={setDebt}   />
        <SliderRow label="Gold Return"   unit="%" min={2}  max={14} step={0.5} value={gold}   onChange={setGold}   />
        <SliderRow label="Annual SIP"    unit="₹" min={0}  max={50} step={1}   value={sip}    onChange={setSip}    />
      </div>

      {/* Custom legend */}
      <div className="flex items-center gap-5 mb-3">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#C9A84C' }} />
          <span className="text-[11px]" style={{ color: '#6B7280' }}>Projected NW</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#2E8B8B' }} />
          <span className="text-[11px]" style={{ color: '#6B7280' }}>FD/Insurance inflows</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#F5EDD6' }} />
          <span className="text-[11px]" style={{ color: '#6B7280' }}>Invested capital</span>
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
          <YAxis tickFormatter={(v) => `₹${(v / 10000000).toFixed(1)}Cr`} tick={{ fontSize: 10, fill: '#9CA3AF' }} axisLine={false} tickLine={false} width={58} />
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
          <div key={item.label} className="text-center p-3 rounded-xl" style={{ backgroundColor: '#F7F5F0' }}>
            <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#9CA3AF' }}>{item.label}</p>
            <p className="font-display text-sm font-semibold" style={{ color: '#1B2A4A' }}>{fmt(item.value)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
