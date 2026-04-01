'use client';

import { TrendingUp, ArrowUpRight, PlusCircle } from 'lucide-react';
import Link from 'next/link';
import { formatLargeINR } from '@/lib/utils/formatters';
import type { DashboardSnapshot } from '@/lib/types/dashboard';

interface Props { snapshot: DashboardSnapshot }

function XirrBadge({ xirr }: { xirr: number }) {
  const label = xirr >= 18 ? 'Excellent' : xirr >= 12 ? 'Good' : xirr >= 8 ? 'Fair' : 'Low';
  return (
    <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full" style={{ color: '#C9A84C', backgroundColor: '#F5EDD6' }}>
      {label}
    </span>
  );
}

export function NetWorthHero({ snapshot }: Props) {
  const { hasRealData, netWorth, totalInvested, totalGain, overallXirr } = snapshot;

  const gainPct = totalInvested > 0 ? (totalGain / totalInvested) * 100 : 0;

  if (!hasRealData) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div
          className="lg:col-span-2 rounded-xl p-6 relative overflow-hidden"
          style={{ background: 'linear-gradient(135deg, #1B2A4A 0%, #243559 100%)' }}
        >
          <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full opacity-10" style={{ background: '#C9A84C' }} />
          <div className="relative z-10">
            <p className="text-xs font-medium uppercase tracking-widest mb-4" style={{ color: 'rgba(255,255,255,0.45)' }}>
              Welcome to WealthView
            </p>
            <h1 className="font-display text-3xl font-semibold text-white mb-2">
              Start tracking your wealth
            </h1>
            <p className="text-sm mb-6" style={{ color: 'rgba(255,255,255,0.55)' }}>
              Add your investments and assets to see your real net worth, returns, and financial health.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/add-assets/mutual-funds" className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold" style={{ backgroundColor: '#C9A84C', color: 'var(--wv-text)' }}>
                <PlusCircle className="w-4 h-4" />
                Add Mutual Fund
              </Link>
              <Link href="/add-assets/indian-stocks" className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium" style={{ backgroundColor: 'rgba(255,255,255,0.1)', color: 'white' }}>
                <PlusCircle className="w-4 h-4" />
                Add Stocks
              </Link>
              <Link href="/add-assets/fixed-deposits" className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium" style={{ backgroundColor: 'rgba(255,255,255,0.1)', color: 'white' }}>
                <PlusCircle className="w-4 h-4" />
                Add FD / PPF
              </Link>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="wv-card p-5 flex-1 flex items-center justify-center">
            <p className="text-xs text-center" style={{ color: 'var(--wv-text-muted)' }}>Monthly growth appears<br />once you add assets</p>
          </div>
          <div className="wv-card p-5 flex-1 flex items-center justify-center">
            <p className="text-xs text-center" style={{ color: 'var(--wv-text-muted)' }}>XIRR calculated<br />from your transactions</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Main net worth card */}
      <div
        className="lg:col-span-2 rounded-xl p-6 relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #1B2A4A 0%, #243559 100%)' }}
      >
        <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full opacity-10" style={{ background: '#C9A84C' }} />
        <div className="absolute bottom-4 right-24 w-20 h-20 rounded-full opacity-5" style={{ background: '#C9A84C' }} />

        <div className="relative z-10">
          <p className="text-xs font-medium uppercase tracking-widest mb-2" style={{ color: 'rgba(255,255,255,0.45)' }}>
            Total Family Net Worth
          </p>
          <div className="flex items-end gap-3 mb-1">
            <h1 className="font-display text-4xl font-semibold text-white tracking-tight">
              {formatLargeINR(netWorth)}
            </h1>
            {totalGain !== 0 && (
              <div
                className="flex items-center gap-1 mb-1.5 px-2 py-0.5 rounded-full text-xs font-semibold"
                style={{
                  backgroundColor: totalGain >= 0 ? 'rgba(5,150,105,0.2)' : 'rgba(220,38,38,0.2)',
                  color: totalGain >= 0 ? '#34D399' : '#F87171',
                }}
              >
                <TrendingUp className="w-3 h-3" />
                {totalGain >= 0 ? '+' : ''}{gainPct.toFixed(2)}% all time
              </div>
            )}
          </div>

          <div className="flex gap-6 mt-5 pt-5" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            {[
              { label: 'Invested',        value: formatLargeINR(totalInvested) },
              { label: 'Total Gain',      value: `${totalGain >= 0 ? '+' : ''}${formatLargeINR(totalGain)}` },
              { label: 'Abs Return',      value: `${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(1)}%` },
            ].map((item) => (
              <div key={item.label}>
                <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'rgba(255,255,255,0.35)' }}>{item.label}</p>
                <p className="text-sm font-semibold text-white">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Secondary cards */}
      <div className="flex flex-col gap-4">
        <div className="wv-card p-5 flex-1">
          <div className="flex items-start justify-between mb-3">
            <p className="text-[10px] uppercase tracking-wider font-medium" style={{ color: 'var(--wv-text-muted)' }}>Unrealised P&L</p>
            <span
              className="flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded-full"
              style={{
                color: totalGain >= 0 ? '#059669' : '#DC2626',
                backgroundColor: totalGain >= 0 ? 'rgba(5,150,105,0.08)' : 'rgba(220,38,38,0.08)',
              }}
            >
              <ArrowUpRight className="w-3 h-3" />
              {totalGain >= 0 ? '+' : ''}{gainPct.toFixed(1)}%
            </span>
          </div>
          <p className="font-display text-2xl font-semibold" style={{ color: totalGain >= 0 ? '#059669' : '#DC2626' }}>
            {totalGain >= 0 ? '+' : ''}{formatLargeINR(totalGain)}
          </p>
          <p className="text-[11px] mt-1" style={{ color: 'var(--wv-text-muted)' }}>vs {formatLargeINR(totalInvested)} invested</p>
        </div>

        <div className="wv-card p-5 flex-1">
          <div className="flex items-start justify-between mb-3">
            <p className="text-[10px] uppercase tracking-wider font-medium" style={{ color: 'var(--wv-text-muted)' }}>Portfolio XIRR</p>
            {overallXirr > 0 && <XirrBadge xirr={overallXirr} />}
          </div>
          {overallXirr > 0 ? (
            <>
              <p className="font-display text-2xl font-semibold" style={{ color: '#059669' }}>{overallXirr.toFixed(1)}%</p>
              <p className="text-[11px] mt-1" style={{ color: 'var(--wv-text-muted)' }}>Annualised since inception</p>
            </>
          ) : (
            <>
              <p className="font-display text-2xl font-semibold" style={{ color: 'var(--wv-text-muted)' }}>—</p>
              <p className="text-[11px] mt-1" style={{ color: 'var(--wv-text-muted)' }}>Add transactions to calculate</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
