'use client';

import { formatLargeINR } from '@/lib/utils/formatters';
import type { DashboardSnapshot } from '@/lib/types/dashboard';

interface Props { snapshot: DashboardSnapshot }

function noData() { return { value: '—', sub: 'Add data to see', valueColor: '#D1D5DB' as string | undefined, badge: undefined }; }

function buildStats(s: DashboardSnapshot) {
  const has = s.hasRealData;

  const fmt = (n: number) => formatLargeINR(n);
  const pct = (n: number, d = 1) => `${n >= 0 ? '+' : ''}${n.toFixed(d)}%`;

  return [
    has && s.overallXirr > 0
      ? { label: 'XIRR', value: `${s.overallXirr.toFixed(1)}%`, sub: 'Annualised returns', valueColor: s.overallXirr >= 12 ? '#059669' : '#DC2626' }
      : { label: 'XIRR', ...noData() },

    has
      ? { label: 'Total Invested', value: fmt(s.totalInvested), sub: 'Across all assets', valueColor: undefined }
      : { label: 'Total Invested', ...noData() },

    has && (s.equityDebtRatio.equity + s.equityDebtRatio.debt) > 0
      ? { label: 'Equity : Debt', value: `${s.equityDebtRatio.equity} : ${s.equityDebtRatio.debt}`, sub: 'Asset allocation ratio', valueColor: '#2E8B8B' }
      : { label: 'Equity : Debt', ...noData() },

    has && s.emergencyFundMonths > 0
      ? {
          label: 'Emergency Fund',
          value: `${s.emergencyFundMonths.toFixed(1)} mo`,
          sub: 'vs 6 mo recommended',
          valueColor: s.emergencyFundMonths >= 6 ? '#059669' : '#DC2626',
        }
      : { label: 'Emergency Fund', ...noData() },

    has && s.annualDividendIncome > 0
      ? { label: 'Annual Dividends', value: fmt(s.annualDividendIncome), sub: 'Last 12 months', valueColor: '#2E8B8B' }
      : { label: 'Annual Dividends', ...noData() },

    has && s.avgFdYield > 0
      ? { label: 'Avg FD Yield', value: pct(s.avgFdYield), sub: 'Weighted average', valueColor: '#C9A84C' }
      : { label: 'Avg FD Yield', ...noData() },

    has && s.insuranceCoverage > 0
      ? {
          label: 'Insurance Cover',
          value: fmt(s.insuranceCoverage),
          sub: 'Life + health coverage',
          valueColor: undefined,
          badge: s.insuranceCoverage < 10000000
            ? { text: 'Low', color: '#D97706', bg: '#FEF3C7' }
            : { text: 'Good', color: '#059669', bg: 'rgba(5,150,105,0.08)' },
        }
      : { label: 'Insurance Cover', ...noData() },

    has && s.monthlySipOutflow > 0
      ? { label: 'Monthly SIP', value: fmt(s.monthlySipOutflow), sub: 'Active SIPs running', valueColor: '#2E8B8B' }
      : { label: 'Monthly SIP', ...noData() },

    has && s.unrealizedStcg > 0
      ? { label: 'STCG Liability', value: fmt(s.unrealizedStcg), sub: 'Short-term gains (<1yr)', valueColor: '#DC2626' }
      : { label: 'STCG Liability', ...noData() },

    has && s.unrealizedLtcg > 0
      ? { label: 'LTCG Exempt', value: fmt(s.unrealizedLtcg), sub: 'Long-term gains (>1yr)', valueColor: '#059669' }
      : { label: 'LTCG Exempt', ...noData() },

    has && s.loanExposure > 0
      ? { label: 'Active Loans', value: fmt(s.loanExposure), sub: 'Total outstanding', valueColor: '#DC2626' }
      : { label: 'Active Loans', ...noData() },

    has
      ? {
          label: 'Portfolio Drift',
          value: `${s.rebalancingDrift.toFixed(1)}%`,
          sub: 'From 60:40 target',
          valueColor: s.rebalancingDrift < 5 ? '#059669' : '#DC2626',
        }
      : { label: 'Portfolio Drift', ...noData() },
  ];
}

export function StatCards({ snapshot }: Props) {
  const stats = buildStats(snapshot);

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
          <p className="font-display text-xl font-semibold leading-none" style={{ color: stat.valueColor ?? '#1A1A2E' }}>
            {stat.value}
          </p>
          <p className="text-[11px] mt-1.5" style={{ color: '#9CA3AF' }}>{stat.sub}</p>
        </div>
      ))}
    </div>
  );
}
