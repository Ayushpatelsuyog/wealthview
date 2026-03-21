'use client';

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { PieLabelRenderProps } from 'recharts';

const allocation = [
  { name: 'Equities',      value: 38, color: '#1B2A4A', amount: 32.11 },
  { name: 'Mutual Funds',  value: 22, color: '#2E8B8B', amount: 18.61 },
  { name: 'Real Estate',   value: 18, color: '#C9A84C', amount: 15.25 },
  { name: 'Gold',          value: 7,  color: '#059669', amount: 5.93  },
  { name: 'Fixed Deposits',value: 5,  color: '#7C3AED', amount: 4.24  },
  { name: 'Crypto',        value: 5,  color: '#F59E0B', amount: 4.24  },
  { name: 'Others',        value: 5,  color: '#DC2626', amount: 4.24  },
];

const RADIAN = Math.PI / 180;

function CustomLabel(props: PieLabelRenderProps) {
  const { cx, cy, midAngle, innerRadius, outerRadius, percent } = props;
  if (
    typeof cx !== 'number' || typeof cy !== 'number' ||
    typeof midAngle !== 'number' || typeof innerRadius !== 'number' ||
    typeof outerRadius !== 'number' || typeof percent !== 'number' || percent < 0.07
  ) return null;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.55;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={700}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

export function AssetAllocationChart() {
  return (
    <div className="wv-card p-5">
      <div className="mb-4">
        <h3 className="section-heading text-sm">Asset Allocation</h3>
      </div>

      <div className="flex items-center gap-5">
        {/* Donut */}
        <div className="flex-shrink-0" style={{ width: 130, height: 130 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={allocation}
                cx="50%"
                cy="50%"
                innerRadius={38}
                outerRadius={62}
                dataKey="value"
                labelLine={false}
                label={CustomLabel}
                strokeWidth={2}
                stroke="#F7F5F0"
              >
                {allocation.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value) => [`${value}%`, '']}
                contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #E8E5DD' }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="flex-1 space-y-2">
          {allocation.map((item) => (
            <div key={item.name} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
                <span className="text-[11px]" style={{ color: '#6B7280' }}>{item.name}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="text-[11px]" style={{ color: '#9CA3AF' }}>{item.value}%</span>
                <span className="text-[11px] font-semibold w-16 text-right" style={{ color: '#1A1A2E' }}>
                  ₹{item.amount}Cr
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
