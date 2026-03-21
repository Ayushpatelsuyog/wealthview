'use client';

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { Card } from '@/components/ui/card';
import { PieLabelRenderProps } from 'recharts';

const allocation = [
  { name: 'Equities', value: 38, color: '#1B2A4A' },
  { name: 'Mutual Funds', value: 22, color: '#C9A84C' },
  { name: 'Real Estate', value: 18, color: '#2A3F6F' },
  { name: 'Gold', value: 7, color: '#D4AF37' },
  { name: 'Fixed Deposits', value: 5, color: '#4B6CB7' },
  { name: 'Crypto', value: 5, color: '#7B68EE' },
  { name: 'Others', value: 5, color: '#94A3B8' },
];

const RADIAN = Math.PI / 180;

function CustomLabel(props: PieLabelRenderProps) {
  const { cx, cy, midAngle, innerRadius, outerRadius, percent } = props;
  if (typeof cx !== 'number' || typeof cy !== 'number' || typeof midAngle !== 'number' ||
      typeof innerRadius !== 'number' || typeof outerRadius !== 'number' || typeof percent !== 'number') return null;
  if (percent < 0.06) return null;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={600}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

export function AssetAllocationChart() {
  const totalValue = 84732500;

  return (
    <Card className="p-5 border-0 shadow-sm bg-white">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-gray-900">Asset Allocation</h3>
          <p className="text-xs text-gray-500 mt-0.5">By category</p>
        </div>
      </div>

      <div className="flex items-center gap-6">
        <div className="w-48 h-48 flex-shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={allocation}
                cx="50%"
                cy="50%"
                innerRadius={45}
                outerRadius={85}
                dataKey="value"
                labelLine={false}
                label={CustomLabel}
              >
                {allocation.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value) => [`${value}%`, '']}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="flex-1 space-y-2">
          {allocation.map((item) => {
            const value = (totalValue * item.value) / 100;
            const formattedValue = value >= 10000000
              ? `₹${(value / 10000000).toFixed(2)}Cr`
              : `₹${(value / 100000).toFixed(2)}L`;

            return (
              <div key={item.name} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: item.color }} />
                  <span className="text-xs text-gray-600">{item.name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400">{item.value}%</span>
                  <span className="text-xs font-medium text-gray-700 w-20 text-right">{formattedValue}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
