'use client';

import { useState, useEffect } from 'react';
import { TrendingUp, ArrowUpRight, PlusCircle } from 'lucide-react';
import Link from 'next/link';
import { formatLargeINR } from '@/lib/utils/formatters';

interface Summary {
  hasHoldings: boolean;
  totalHoldings: number;
  totalInvested: number;
  totalCurrentEst: number;
}

export function NetWorthHero() {
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    fetch('/api/portfolio/summary')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d && !d.error) setSummary(d); })
      .catch(() => {});
  }, []);

  const hasReal = summary?.hasHoldings ?? false;

  // When real data exists, use it; otherwise fall back to demo values
  const totalInvested    = hasReal ? summary!.totalInvested    : 59200000;
  const totalCurrentEst  = hasReal ? summary!.totalCurrentEst  : 84732500;
  const unrealisedGain   = totalCurrentEst - totalInvested;
  const unrealisedPct    = totalInvested > 0 ? (unrealisedGain / totalInvested * 100) : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Main net worth card */}
      <div
        className="lg:col-span-2 rounded-xl p-6 relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #1B2A4A 0%, #243559 100%)' }}
      >
        {/* Decorative gold circles */}
        <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full opacity-10" style={{ background: '#C9A84C' }} />
        <div className="absolute bottom-4 right-24 w-20 h-20 rounded-full opacity-5" style={{ background: '#C9A84C' }} />

        <div className="relative z-10">
          <p className="text-xs font-medium uppercase tracking-widest mb-2" style={{ color: 'rgba(255,255,255,0.45)' }}>
            Total Family Net Worth {!hasReal && <span className="normal-case font-normal">(demo)</span>}
          </p>
          <div className="flex items-end gap-3 mb-1">
            <h1 className="font-display text-4xl font-semibold text-white tracking-tight">
              {formatLargeINR(totalCurrentEst)}
            </h1>
            {!hasReal && (
              <div
                className="flex items-center gap-1 mb-1.5 px-2 py-0.5 rounded-full text-xs font-semibold"
                style={{ backgroundColor: 'rgba(5,150,105,0.2)', color: '#34D399' }}
              >
                <TrendingUp className="w-3 h-3" />
                +1.24% today
              </div>
            )}
          </div>
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
            {hasReal
              ? `${summary!.totalHoldings} mutual fund holding${summary!.totalHoldings === 1 ? '' : 's'} tracked`
              : '+₹1,05,000 since yesterday · 21 Mar 2026, 9:45 AM IST'
            }
          </p>

          {/* No-holdings banner */}
          {summary && !hasReal && (
            <Link
              href="/add-assets/mutual-funds"
              className="flex items-center gap-2 mt-4 px-3 py-2 rounded-lg text-xs font-medium w-fit"
              style={{ backgroundColor: 'rgba(201,168,76,0.15)', color: '#C9A84C' }}
            >
              <PlusCircle className="w-3.5 h-3.5" />
              Add your first investment to see real data
            </Link>
          )}

          <div className="flex gap-6 mt-5 pt-5" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            {[
              { label: 'Invested',        value: formatLargeINR(totalInvested) },
              { label: 'Unrealised Gain', value: `${unrealisedGain >= 0 ? '+' : ''}${formatLargeINR(unrealisedGain)}` },
              { label: hasReal ? 'Abs Return' : "Today's P&L",
                value: hasReal ? `${unrealisedPct >= 0 ? '+' : ''}${unrealisedPct.toFixed(1)}%` : '+₹1.05 L' },
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
            <p className="text-[10px] uppercase tracking-wider font-medium" style={{ color: '#9CA3AF' }}>Monthly Growth</p>
            <span
              className="flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded-full"
              style={{ color: '#059669', backgroundColor: 'rgba(5,150,105,0.08)' }}
            >
              <ArrowUpRight className="w-3 h-3" />
              +3.2%
            </span>
          </div>
          <p className="font-display text-2xl font-semibold" style={{ color: '#1A1A2E' }}>₹24,56,800</p>
          <p className="text-[11px] mt-1" style={{ color: '#9CA3AF' }}>vs ₹23,80,000 last month</p>
        </div>

        <div className="wv-card p-5 flex-1">
          <div className="flex items-start justify-between mb-3">
            <p className="text-[10px] uppercase tracking-wider font-medium" style={{ color: '#9CA3AF' }}>Portfolio XIRR</p>
            <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full" style={{ color: '#C9A84C', backgroundColor: '#F5EDD6' }}>
              Excellent
            </span>
          </div>
          <p className="font-display text-2xl font-semibold" style={{ color: '#059669' }}>16.8%</p>
          <p className="text-[11px] mt-1" style={{ color: '#9CA3AF' }}>Annualised since inception</p>
        </div>
      </div>
    </div>
  );
}
