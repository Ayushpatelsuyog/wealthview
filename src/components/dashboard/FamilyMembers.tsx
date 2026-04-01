'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TrendingUp, UserPlus, Settings } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatLargeINR } from '@/lib/utils/formatters';
import { useFamilyStore } from '@/lib/stores/familyStore';
import type { DashboardSnapshot, DashboardMember } from '@/lib/types/dashboard';

const roleColors: Record<string, { bg: string; text: string }> = {
  admin:   { bg: 'rgba(27,42,74,0.08)',   text: '#1B2A4A' },
  member:  { bg: 'rgba(46,139,139,0.08)', text: '#2E8B8B' },
  advisor: { bg: '#F5EDD6',               text: '#C9A84C' },
  guest:   { bg: 'var(--wv-border)',               text: '#6B7280' },
};

const roleLabel: Record<string, string> = {
  admin: 'Admin', member: 'Member', advisor: 'Advisor', guest: 'Guest',
};

const MEMBER_COLORS = ['#1B2A4A', '#2E8B8B', '#C9A84C', '#059669', '#7C3AED', '#DC2626'];

function getInitials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(n => n[0]).join('').toUpperCase();
}

interface Props { snapshot: DashboardSnapshot }

export function FamilyMembers({ snapshot }: Props) {
  const router = useRouter();
  const supabase = createClient();
  const { selectedFamilyId, families } = useFamilyStore();
  const [displayMembers, setDisplayMembers] = useState<DashboardMember[]>(snapshot.members ?? []);

  // When family selection changes, fetch members for that family
  useEffect(() => {
    if (!selectedFamilyId) {
      // "All Families" — use snapshot members (primary family) + fetch others
      if (families.length <= 1) {
        setDisplayMembers(snapshot.members ?? []);
        return;
      }
      // Fetch members from all families
      (async () => {
        const famIds = families.map(f => f.id);
        const { data } = await supabase.from('users').select('id, name, role, family_id').in('family_id', famIds);
        if (data) {
          setDisplayMembers(data.map((m, i) => ({
            id: m.id,
            name: m.name || 'Unknown',
            role: m.role || 'member',
            netWorth: snapshot.members?.find(sm => sm.id === m.id)?.netWorth ?? 0,
            todayChange: 0,
            initials: getInitials(m.name || '?'),
            color: MEMBER_COLORS[i % MEMBER_COLORS.length],
          })));
        }
      })();
    } else {
      // Specific family selected — fetch its members
      (async () => {
        const { data } = await supabase.from('users').select('id, name, role').eq('family_id', selectedFamilyId);
        if (data) {
          setDisplayMembers(data.map((m, i) => ({
            id: m.id,
            name: m.name || 'Unknown',
            role: m.role || 'member',
            netWorth: snapshot.members?.find(sm => sm.id === m.id)?.netWorth ?? 0,
            todayChange: 0,
            initials: getInitials(m.name || '?'),
            color: MEMBER_COLORS[i % MEMBER_COLORS.length],
          })));
        }
      })();
    }
  }, [selectedFamilyId, families, snapshot.members]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedFamilyName = selectedFamilyId
    ? families.find(f => f.id === selectedFamilyId)?.name ?? 'Family'
    : 'All Families';

  const manageUrl = selectedFamilyId
    ? `/settings?tab=family&family_id=${selectedFamilyId}`
    : '/settings?tab=family';

  return (
    <div className="wv-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="section-heading text-sm">Family Members</h3>
          {families.length > 1 && (
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--wv-text-muted)' }}>{selectedFamilyName}</p>
          )}
        </div>
        <button
          onClick={() => router.push(manageUrl)}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg ml-4 flex items-center gap-1.5"
          style={{ backgroundColor: '#1B2A4A', color: 'white' }}
        >
          <Settings className="w-3 h-3" />
          Manage
        </button>
      </div>

      {displayMembers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 gap-3">
          <p className="text-xs text-center" style={{ color: 'var(--wv-text-muted)' }}>No family members yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {displayMembers.map((m) => (
            <div
              key={m.id}
              className="p-3 rounded-xl border transition-all cursor-pointer"
              style={{ borderColor: 'var(--wv-border)' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = '#C9A84C'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--wv-border)'; }}
              onClick={() => {
                // Navigate to portfolio filtered to this member
                const memberFamilyId = selectedFamilyId || (families.length > 0 ? families[0].id : '');
                if (memberFamilyId) useFamilyStore.getState().setSelectedFamilyId(memberFamilyId);
                useFamilyStore.getState().setSelectedMemberIds([m.id]);
                router.push('/portfolio');
              }}
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
                  style={{ backgroundColor: roleColors[m.role]?.bg ?? 'var(--wv-border)', color: roleColors[m.role]?.text ?? '#6B7280' }}
                >
                  {roleLabel[m.role] ?? m.role}
                </span>
              </div>
              <p className="text-xs font-semibold mb-0.5" style={{ color: 'var(--wv-text)' }}>{m.name}</p>
              {m.role === 'advisor' ? (
                <p className="font-display text-sm" style={{ color: 'var(--wv-text-muted)' }}>View only</p>
              ) : snapshot.hasRealData && m.netWorth > 0 ? (
                <>
                  <p className="font-display text-base font-semibold" style={{ color: 'var(--wv-text)' }}>{formatLargeINR(m.netWorth)}</p>
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
                <p className="text-xs" style={{ color: 'var(--wv-text-muted)' }}>No assets yet</p>
              )}
              <p className="text-[9px] mt-1" style={{ color: '#C9A84C' }}>View Portfolio →</p>
            </div>
          ))}

          {/* Invite CTA if only one member */}
          {displayMembers.filter(m => m.role !== 'advisor').length === 1 && (
            <div
              onClick={() => router.push(manageUrl)}
              className="p-3 rounded-xl border border-dashed flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors"
              style={{ borderColor: 'var(--wv-border)' }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = '#C9A84C'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--wv-border)'; }}
            >
              <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--wv-surface-2)' }}>
                <UserPlus className="w-4 h-4" style={{ color: 'var(--wv-text-muted)' }} />
              </div>
              <p className="text-[11px] text-center" style={{ color: 'var(--wv-text-muted)' }}>Add family member</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
