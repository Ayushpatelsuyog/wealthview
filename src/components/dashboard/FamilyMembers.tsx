'use client';

import { TrendingUp } from 'lucide-react';

const members = [
  { name: 'Rajesh Shah',  initials: 'RS', role: 'Admin',  netWorth: '₹4.13 Cr', change: '+1.42%', color: '#1B2A4A', positive: true },
  { name: 'Priya Shah',   initials: 'PS', role: 'Member', netWorth: '₹2.18 Cr', change: '+0.98%', color: '#2E8B8B', positive: true },
  { name: 'Arjun Shah',   initials: 'AS', role: 'Member', netWorth: '₹1.57 Cr', change: '+1.65%', color: '#C9A84C', positive: true },
  { name: 'Mehul Joshi',  initials: 'MJ', role: 'Advisor', netWorth: 'View only', change: null,    color: '#6B7280', positive: null },
];

const roleColors: Record<string, { bg: string; text: string }> = {
  Admin:   { bg: 'rgba(27,42,74,0.08)',  text: '#1B2A4A' },
  Member:  { bg: 'rgba(46,139,139,0.08)',text: '#2E8B8B' },
  Advisor: { bg: '#F5EDD6',              text: '#C9A84C' },
};

export function FamilyMembers() {
  return (
    <div className="wv-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="section-heading text-sm flex-1">Family Members</h3>
        <button
          className="text-xs font-semibold px-3 py-1.5 rounded-lg ml-4"
          style={{ backgroundColor: '#1B2A4A', color: 'white' }}
        >
          Manage
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {members.map((m) => (
          <div
            key={m.name}
            className="p-3 rounded-xl border transition-all cursor-pointer group"
            style={{ borderColor: '#E8E5DD' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = '#C9A84C'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = '#E8E5DD'; }}
          >
            <div className="flex items-start justify-between mb-2">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                style={{ backgroundColor: m.color }}
              >
                {m.initials}
              </div>
              <span
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: roleColors[m.role]?.bg, color: roleColors[m.role]?.text }}
              >
                {m.role}
              </span>
            </div>
            <p className="text-xs font-semibold mb-0.5" style={{ color: '#1A1A2E' }}>{m.name}</p>
            <p className="font-display text-base font-semibold" style={{ color: '#1A1A2E' }}>{m.netWorth}</p>
            {m.change && (
              <div className="flex items-center gap-1 mt-1">
                <TrendingUp className="w-3 h-3" style={{ color: '#059669' }} />
                <span className="text-[11px] font-medium" style={{ color: '#059669' }}>{m.change}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
