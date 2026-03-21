'use client';

import { Sparkles, ArrowRight } from 'lucide-react';

export function AICta() {
  return (
    <div
      className="rounded-xl p-5 flex items-center justify-between relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #1B2A4A 0%, #243559 100%)' }}
    >
      <div
        className="absolute -right-6 -top-6 w-32 h-32 rounded-full opacity-10"
        style={{ background: '#C9A84C' }}
      />
      <div className="flex items-center gap-4 relative z-10">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: 'rgba(201,168,76,0.2)' }}
        >
          <Sparkles className="w-5 h-5" style={{ color: '#C9A84C' }} />
        </div>
        <div>
          <p className="text-white font-semibold text-sm">AI Portfolio Advisory</p>
          <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
            Get personalised rebalancing & tax-loss harvesting recommendations
          </p>
        </div>
      </div>
      <button
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold flex-shrink-0 relative z-10 transition-opacity hover:opacity-90"
        style={{ backgroundColor: '#C9A84C', color: '#1B2A4A' }}
      >
        Analyse portfolio
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
}
