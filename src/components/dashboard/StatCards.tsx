'use client';

interface StatCard {
  label: string;
  value: string;
  sub: string;
  valueColor?: string;
  badge?: { text: string; color: string; bg: string };
}

const stats: StatCard[] = [
  {
    label: 'XIRR',
    value: '16.8%',
    sub: 'Annualised returns',
    valueColor: '#059669',
  },
  {
    label: 'Total Invested',
    value: '₹5.92 Cr',
    sub: 'Across all assets',
  },
  {
    label: 'Equity : Debt',
    value: '64 : 36',
    sub: 'Asset allocation ratio',
    valueColor: '#2E8B8B',
  },
  {
    label: 'Emergency Fund',
    value: '14.2 mo',
    sub: 'vs 6 mo recommended',
    valueColor: '#059669',
  },
  {
    label: 'Annual Dividends',
    value: '₹4.82 L',
    sub: 'Last 12 months',
    valueColor: '#2E8B8B',
  },
  {
    label: 'Avg FD Yield',
    value: '7.35%',
    sub: 'Weighted average',
    valueColor: '#C9A84C',
  },
  {
    label: 'Insurance Cover',
    value: '₹2.5 Cr',
    sub: 'vs ₹4 Cr ideal',
    badge: { text: 'Low', color: '#D97706', bg: '#FEF3C7' },
  },
  {
    label: 'Monthly SIP',
    value: '₹1.25 L',
    sub: 'Active SIPs running',
    valueColor: '#2E8B8B',
  },
  {
    label: 'STCG Liability',
    value: '₹3.42 L',
    sub: 'Short-term gains',
    valueColor: '#DC2626',
  },
  {
    label: 'LTCG Exempt',
    value: '₹18.65 L',
    sub: 'Long-term gains',
    valueColor: '#059669',
  },
  {
    label: 'Active Loans',
    value: '₹32 L',
    sub: 'Total outstanding',
    valueColor: '#DC2626',
  },
  {
    label: 'Portfolio Drift',
    value: '1.2%',
    sub: 'From target allocation',
    valueColor: '#059669',
  },
];

export function StatCards() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {stats.map((stat) => (
        <div key={stat.label} className="wv-card p-4">
          <div className="flex items-start justify-between mb-2">
            <p className="text-[10px] uppercase tracking-wider font-medium" style={{ color: '#9CA3AF' }}>
              {stat.label}
            </p>
            {stat.badge && (
              <span
                className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ color: stat.badge.color, backgroundColor: stat.badge.bg }}
              >
                {stat.badge.text}
              </span>
            )}
          </div>
          <p
            className="font-display text-xl font-semibold leading-none"
            style={{ color: stat.valueColor ?? '#1A1A2E' }}
          >
            {stat.value}
          </p>
          <p className="text-[11px] mt-1.5" style={{ color: '#9CA3AF' }}>{stat.sub}</p>
        </div>
      ))}
    </div>
  );
}
