'use client';

import { TrendingUp, UserPlus } from 'lucide-react';
import { formatLargeINR } from '@/lib/utils/formatters';
import type { DashboardSnapshot } from '@/lib/types/dashboard';

const roleColors: Record<string, { bg: string; text: string }> = {
  admin:   { bg: 'rgba(27,42,74,0.08)',   text: '#1B2A4A' },
  member:  { bg: 'rgba(46,139,139,0.08)', text: '#2E8B8B' },
  advisor: { bg: '#F5EDD6',               text: '#C9A84C' },
  guest:   { bg: '#F3F4F6',               text: '#6B7280' },
};

const roleLabel: Record<string, string> = {
  admin: 'Admin', member: 'Member', advisor: 'Advisor', guest: 'Guest',
};

interface Props { snapshot: DashboardSnapshot }

export function FamilyMembers({ snapshot }: Props) {
  const { members, hasRealData } = snapshot;

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

      {members.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 gap-3">
          <p className="text-xs text-center" style={{ color: '#9CA3AF' }}>No family members yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {members.map((m) => (
            <div
              key={m.id}
              className="p-3 rounded-xl border transition-all cursor-pointer"
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
                  style={{ backgroundColor: roleColors[m.role]?.bg ?? '#F3F4F6', color: roleColors[m.role]?.text ?? '#6B7280' }}
                >
                  {roleLabel[m.role] ?? m.role}
                </span>
              </div>
              <p className="text-xs font-semibold mb-0.5" style={{ color: '#1A1A2E' }}>{m.name}</p>
              {m.role === 'advisor' ? (
                <p className="font-display text-sm" style={{ color: '#9CA3AF' }}>View only</p>
              ) : hasRealData && m.netWorth > 0 ? (
                <>
                  <p className="font-display text-base font-semibold" style={{ color: '#1A1A2E' }}>{formatLargeINR(m.netWorth)}</p>
                  {m.todayChange !== 0 && (
                    <div className="flex items-center gap-1 mt-1">
                      <TrendingUp className="w-3 h-3" style={{ color: '#059669' }} />
                      <span className="text-[11px] font-medium" style={{ color: '#059669' }}>
                        {m.todayChange >= 0 ? '+' : ''}{m.todayChange.toFixed(2)}%
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-xs" style={{ color: '#9CA3AF' }}>No assets yet</p>
              )}
            </div>
          ))}

          {/* Invite CTA if only one member */}
          {members.filter(m => m.role !== 'advisor').length === 1 && (
            <div
              className="p-3 rounded-xl border border-dashed flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors"
              style={{ borderColor: '#E8E5DD' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = '#C9A84C'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = '#E8E5DD'; }}
            >
              <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ backgroundColor: '#F7F5F0' }}>
                <UserPlus className="w-4 h-4" style={{ color: '#9CA3AF' }} />
              </div>
              <p className="text-[11px] text-center" style={{ color: '#9CA3AF' }}>Invite family member</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
