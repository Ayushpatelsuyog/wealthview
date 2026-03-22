'use client';

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { PieLabelRenderProps } from 'recharts';
import { formatLargeINR } from '@/lib/utils/formatters';
import Link from 'next/link';
import { PlusCircle } from 'lucide-react';
import type { DashboardSnapshot } from '@/lib/types/dashboard';

const COLORS = {
  equities:      '#1B2A4A',
  mutualFunds:   '#2E8B8B',
  realEstate:    '#C9A84C',
  gold:          '#059669',
  fixedDeposits: '#7C3AED',
  crypto:        '#F59E0B',
  others:        '#DC2626',
};

const LABELS: Record<string, string> = {
  equities:      'Equities',
  mutualFunds:   'Mutual Funds',
  realEstate:    'Real Estate',
  gold:          'Gold',
  fixedDeposits: 'Fixed Deposits',
  crypto:        'Crypto',
  others:        'Others',
};

const RADIAN = Math.PI / 180;

function CustomLabel(props: PieLabelRenderProps) {
  const { cx, cy, midAngle, innerRadius, outerRadius, percent } = props;
  if (
    typeof cx !== 'number' || typeof cy !== 'number' || typeof midAngle !== 'number' ||
    typeof innerRadius !== 'number' || typeof outerRadius !== 'number' ||
    typeof percent !== 'number' || percent < 0.06
  ) return null;
  const r = innerRadius + (outerRadius - innerRadius) * 0.55;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={700}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

interface Props { snapshot: DashboardSnapshot }

export function AssetAllocationChart({ snapshot }: Props) {
  const { allocation, hasRealData } = snapshot;

  const entries = Object.entries(allocation)
    .map(([key, bucket]) => ({
      key,
      name: LABELS[key] ?? key,
      value: bucket.pct,
      amount: bucket.value,
      color: COLORS[key as keyof typeof COLORS] ?? '#999',
    }))
    .filter(e => e.value > 0);

  return (
    <div className="wv-card p-5">
      <div className="mb-4">
        <h3 className="section-heading text-sm">Asset Allocation</h3>
      </div>

      {!hasRealData || entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 gap-3">
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center"
            style={{ backgroundColor: '#F7F5F0', border: '2px dashed #E8E5DD' }}
          >
            <div className="w-10 h-10 rounded-full" style={{ backgroundColor: '#E8E5DD' }} />
          </div>
          <p className="text-xs text-center" style={{ color: '#9CA3AF' }}>
            Add investments to see your asset allocation
          </p>
          <Link
            href="/add-assets/mutual-funds"
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg"
            style={{ backgroundColor: '#1B2A4A', color: 'white' }}
          >
            <PlusCircle className="w-3.5 h-3.5" />
            Add Investment
          </Link>
        </div>
      ) : (
        <div className="flex items-center gap-5">
          {/* Donut */}
          <div className="flex-shrink-0" style={{ width: 130, height: 130 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={entries}
                  cx="50%" cy="50%"
                  innerRadius={38} outerRadius={62}
                  dataKey="value"
                  labelLine={false}
                  label={CustomLabel}
                  strokeWidth={2}
                  stroke="#F7F5F0"
                >
                  {entries.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip
                  formatter={(value) => [`${Number(value).toFixed(1)}%`, '']}
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #E8E5DD' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Legend */}
          <div className="flex-1 space-y-2">
            {entries.map((item) => (
              <div key={item.key} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
                  <span className="text-[11px]" style={{ color: '#6B7280' }}>{item.name}</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="text-[11px]" style={{ color: '#9CA3AF' }}>{item.value.toFixed(1)}%</span>
                  <span className="text-[11px] font-semibold w-16 text-right" style={{ color: '#1A1A2E' }}>
                    {formatLargeINR(item.amount)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
