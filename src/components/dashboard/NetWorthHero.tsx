'use client';

import { TrendingUp, TrendingDown } from 'lucide-react';

export function NetWorthHero() {
  const netWorth = 84732500;
  const todayChange = 1.24;
  const todayChangeAmt = netWorth * (todayChange / 100);

  function formatINR(amount: number): string {
    if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)} Cr`;
    if (amount >= 100000) return `₹${(amount / 100000).toFixed(2)} L`;
    return `₹${amount.toLocaleString('en-IN')}`;
  }

  return (
    <div
      className="rounded-xl p-6 text-white relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #1B2A4A 0%, #2A3F6F 100%)' }}
    >
      {/* Background decoration */}
      <div
        className="absolute top-0 right-0 w-64 h-64 rounded-full opacity-5"
        style={{ background: '#C9A84C', transform: 'translate(30%, -30%)' }}
      />
      <div
        className="absolute bottom-0 left-1/2 w-32 h-32 rounded-full opacity-5"
        style={{ background: '#C9A84C', transform: 'translate(-50%, 50%)' }}
      />

      <div className="relative z-10">
        <p className="text-white/60 text-sm font-medium uppercase tracking-wider">Total Family Net Worth</p>
        <div className="flex items-end gap-4 mt-2">
          <h1 className="text-4xl font-bold tracking-tight">
            {formatINR(netWorth)}
          </h1>
          <div
            className={`flex items-center gap-1 mb-1 px-2.5 py-1 rounded-full text-sm font-medium ${
              todayChange >= 0 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
            }`}
          >
            {todayChange >= 0 ? (
              <TrendingUp className="w-3.5 h-3.5" />
            ) : (
              <TrendingDown className="w-3.5 h-3.5" />
            )}
            +{todayChange}% today
          </div>
        </div>
        <p className="text-white/40 text-sm mt-1">
          +{formatINR(todayChangeAmt)} since yesterday &nbsp;·&nbsp; As of today, 9:45 AM IST
        </p>

        <div className="flex gap-6 mt-5 pt-5 border-t border-white/10">
          {[
            { label: 'Invested', value: '₹5.92 Cr' },
            { label: 'Unrealised Gain', value: '+₹2.55 Cr' },
            { label: 'Today\'s P&L', value: '+₹1.05 L' },
          ].map((item) => (
            <div key={item.label}>
              <p className="text-white/50 text-xs">{item.label}</p>
              <p className="text-white font-semibold mt-0.5">{item.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
