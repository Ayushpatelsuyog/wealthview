'use client';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  TrendingUp,
  IndianRupee,
  PieChart,
  Shield,
  Leaf,
  Landmark,
  AlertTriangle,
  RefreshCw,
  Receipt,
  CreditCard,
  Activity,
} from 'lucide-react';

interface StatCard {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  color: string;
  bgColor: string;
  badge?: { text: string; variant: 'default' | 'destructive' | 'secondary' | 'outline' };
}

const stats: StatCard[] = [
  {
    label: 'Portfolio XIRR',
    value: '16.8%',
    sub: 'Annualised returns',
    icon: TrendingUp,
    color: '#16a34a',
    bgColor: '#f0fdf4',
  },
  {
    label: 'Total Invested',
    value: '₹5.92 Cr',
    sub: 'Across all assets',
    icon: IndianRupee,
    color: '#2563eb',
    bgColor: '#eff6ff',
  },
  {
    label: 'Equity : Debt',
    value: '64 : 36',
    sub: 'Asset allocation ratio',
    icon: PieChart,
    color: '#7c3aed',
    bgColor: '#f5f3ff',
  },
  {
    label: 'Emergency Fund',
    value: '14.2 mo',
    sub: 'vs 6 mo recommended',
    icon: Shield,
    color: '#16a34a',
    bgColor: '#f0fdf4',
  },
  {
    label: 'Annual Dividends',
    value: '₹4.82 L',
    sub: 'Last 12 months',
    icon: Leaf,
    color: '#0891b2',
    bgColor: '#ecfeff',
  },
  {
    label: 'Avg FD Yield',
    value: '7.35%',
    sub: 'Weighted average',
    icon: Landmark,
    color: '#d97706',
    bgColor: '#fffbeb',
  },
  {
    label: 'Insurance Cover',
    value: '₹2.5 Cr',
    sub: 'Total sum assured',
    icon: AlertTriangle,
    color: '#dc2626',
    bgColor: '#fef2f2',
    badge: { text: 'Low', variant: 'destructive' },
  },
  {
    label: 'Monthly SIP',
    value: '₹1.25 L',
    sub: 'Active SIPs',
    icon: RefreshCw,
    color: '#7c3aed',
    bgColor: '#f5f3ff',
  },
  {
    label: 'STCG Tax',
    value: '₹3.42 L',
    sub: 'Short-term capital gains',
    icon: Receipt,
    color: '#dc2626',
    bgColor: '#fef2f2',
  },
  {
    label: 'LTCG Tax',
    value: '₹18.65 L',
    sub: 'Long-term capital gains',
    icon: Receipt,
    color: '#d97706',
    bgColor: '#fffbeb',
  },
  {
    label: 'Active Loans',
    value: '₹32 L',
    sub: 'Total outstanding',
    icon: CreditCard,
    color: '#dc2626',
    bgColor: '#fef2f2',
  },
  {
    label: 'Portfolio Drift',
    value: '1.2%',
    sub: 'From target allocation',
    icon: Activity,
    color: '#16a34a',
    bgColor: '#f0fdf4',
  },
];

export function StatCards() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {stats.map((stat) => (
        <Card key={stat.label} className="p-4 border-0 shadow-sm bg-white">
          <div className="flex items-start justify-between mb-3">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: stat.bgColor }}
            >
              <stat.icon className="w-4 h-4" style={{ color: stat.color }} />
            </div>
            {stat.badge && (
              <Badge variant={stat.badge.variant} className="text-xs px-1.5 py-0">
                {stat.badge.text}
              </Badge>
            )}
          </div>
          <p className="text-xl font-bold text-gray-900">{stat.value}</p>
          <p className="text-xs text-gray-500 mt-0.5">{stat.label}</p>
          {stat.sub && <p className="text-[10px] text-gray-400 mt-0.5">{stat.sub}</p>}
        </Card>
      ))}
    </div>
  );
}
