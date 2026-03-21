'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { calculateProjection } from '@/lib/utils/calculations';

function formatINR(amount: number): string {
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)}Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(2)}L`;
  return `₹${amount.toLocaleString('en-IN')}`;
}

interface SliderProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit: string;
  onChange: (v: number) => void;
}

function Slider({ label, min, max, step, value, unit, onChange }: SliderProps) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs text-gray-600">{label}</span>
        <span className="text-xs font-semibold text-gray-800">
          {unit === '₹' ? `₹${value}L` : `${value}%`}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, #1B2A4A ${((value - min) / (max - min)) * 100}%, #E5E7EB ${((value - min) / (max - min)) * 100}%)`,
          outline: 'none',
        }}
      />
      <div className="flex justify-between mt-0.5">
        <span className="text-[10px] text-gray-400">{unit === '₹' ? `₹${min}L` : `${min}%`}</span>
        <span className="text-[10px] text-gray-400">{unit === '₹' ? `₹${max}L` : `${max}%`}</span>
      </div>
    </div>
  );
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string | number;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-100 rounded-lg shadow-lg p-3 text-xs">
      <p className="text-gray-500 mb-1">Year {label}</p>
      <p className="font-semibold text-gray-900">{formatINR(payload[0].value)}</p>
    </div>
  );
}

export function ProjectionEngine() {
  const [equityReturn, setEquityReturn] = useState(12);
  const [debtReturn, setDebtReturn] = useState(7);
  const [goldReturn, setGoldReturn] = useState(8);
  const [annualSIP, setAnnualSIP] = useState(15);

  const currentNetWorth = 84732500;
  const data = calculateProjection(
    currentNetWorth,
    { equityReturn, debtReturn, goldReturn, annualSIP },
    10
  );

  const yr3 = data[3]?.value ?? 0;
  const yr5 = data[5]?.value ?? 0;
  const yr10 = data[10]?.value ?? 0;

  return (
    <Card className="p-5 border-0 shadow-sm bg-white">
      <div className="mb-4">
        <h3 className="font-semibold text-gray-900">Projection Engine</h3>
        <p className="text-xs text-gray-500 mt-0.5">Adjust assumptions to see future wealth</p>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-4 mb-5">
        <Slider
          label="Equity Return"
          min={6}
          max={20}
          step={0.5}
          value={equityReturn}
          unit="%"
          onChange={setEquityReturn}
        />
        <Slider
          label="Debt Return"
          min={4}
          max={10}
          step={0.5}
          value={debtReturn}
          unit="%"
          onChange={setDebtReturn}
        />
        <Slider
          label="Gold Return"
          min={2}
          max={14}
          step={0.5}
          value={goldReturn}
          unit="%"
          onChange={setGoldReturn}
        />
        <Slider
          label="Annual SIP"
          min={0}
          max={50}
          step={1}
          value={annualSIP}
          unit="₹"
          onChange={setAnnualSIP}
        />
      </div>

      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey="year"
            tick={{ fontSize: 11, fill: '#9CA3AF' }}
            axisLine={false}
            tickLine={false}
            label={{ value: 'Years', position: 'insideBottom', offset: -2, fontSize: 10, fill: '#9CA3AF' }}
          />
          <YAxis
            tickFormatter={(v) => `₹${(v / 10000000).toFixed(1)}Cr`}
            tick={{ fontSize: 10, fill: '#9CA3AF' }}
            axisLine={false}
            tickLine={false}
            width={55}
          />
          <Tooltip content={<CustomTooltip />} />
          <Line
            type="monotone"
            dataKey="value"
            stroke="#C9A84C"
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 4, fill: '#C9A84C' }}
          />
        </LineChart>
      </ResponsiveContainer>

      <div className="grid grid-cols-3 gap-3 mt-4">
        {[
          { label: '3 Years', value: yr3 },
          { label: '5 Years', value: yr5 },
          { label: '10 Years', value: yr10 },
        ].map((item) => (
          <div
            key={item.label}
            className="text-center p-3 rounded-lg"
            style={{ backgroundColor: '#F7F5F0' }}
          >
            <p className="text-xs text-gray-500">{item.label}</p>
            <p className="text-sm font-bold mt-0.5" style={{ color: '#1B2A4A' }}>
              {formatINR(item.value)}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}
