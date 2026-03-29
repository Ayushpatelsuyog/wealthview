'use client';

import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useFamilyStore, type FamilyInfo, type MemberInfo } from '@/lib/stores/familyStore';

/**
 * Shared two-level family + member selector.
 * Reads/writes to the Zustand familyStore so selection persists across pages.
 *
 * Props:
 * - onSelectionChange: called whenever the resolved member IDs change
 *   signature: (memberIds: string[], familyIds: string[]) => void
 * - compact: if true, renders a more compact layout
 */
interface FamilyMemberSelectorProps {
  onSelectionChange?: (memberIds: string[], familyIds: string[]) => void;
  compact?: boolean;
}

export function FamilyMemberSelector({ onSelectionChange, compact }: FamilyMemberSelectorProps) {
  const supabase = createClient();
  const {
    families, allMembers, selectedFamilyId, selectedMemberIds,
    setFamilies, setAllMembers, setSelectedFamilyId, toggleMember, selectAllMembers,
    getVisibleMembers, getSelectedMemberIds,
  } = useFamilyStore();

  const [loaded, setLoaded] = useState(false);

  // Load families and members on mount (only once)
  useEffect(() => {
    if (loaded && families.length > 0) return;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get user's primary family
      const { data: profile } = await supabase.from('users').select('family_id').eq('id', user.id).single();
      const primaryFamilyId = profile?.family_id;

      // Get all families: primary + via family_memberships + created_by
      const famSet = new Map<string, FamilyInfo>();

      if (primaryFamilyId) {
        const { data: pf } = await supabase.from('families').select('id, name').eq('id', primaryFamilyId).single();
        if (pf) famSet.set(pf.id, { id: pf.id, name: pf.name });
      }

      // Families via memberships
      try {
        const { data: memberships } = await supabase
          .from('family_memberships')
          .select('family_id, families(id, name)')
          .eq('auth_user_id', user.id);
        if (memberships) {
          for (const m of memberships) {
            const f = (m as Record<string, unknown>).families as { id: string; name: string } | undefined;
            if (f) famSet.set(f.id, { id: f.id, name: f.name });
          }
        }
      } catch { /* table may not exist */ }

      // Families created by user
      const { data: createdFams } = await supabase.from('families').select('id, name').eq('created_by', user.id);
      if (createdFams) {
        for (const f of createdFams) famSet.set(f.id, { id: f.id, name: f.name });
      }

      const famList = Array.from(famSet.values());
      setFamilies(famList);

      // Get all members across all families
      if (famList.length > 0) {
        const famIds = famList.map(f => f.id);
        const { data: membersData } = await supabase
          .from('users')
          .select('id, name, role, family_id')
          .in('family_id', famIds);

        if (membersData) {
          const members: MemberInfo[] = membersData.map(m => ({
            id: m.id,
            name: m.name || m.id.slice(0, 8),
            role: m.role || 'member',
            familyId: m.family_id,
          }));
          setAllMembers(members);
        }
      }

      setLoaded(true);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Notify parent when selection changes
  useEffect(() => {
    if (!loaded || families.length === 0) return;
    const memberIds = getSelectedMemberIds();
    const familyIds = selectedFamilyId ? [selectedFamilyId] : families.map(f => f.id);
    onSelectionChange?.(memberIds, familyIds);
  }, [selectedFamilyId, selectedMemberIds, loaded, families.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Don't render if only 1 family with 1 member
  if (families.length <= 1 && allMembers.length <= 1) return null;

  const visibleMembers = getVisibleMembers();
  const resolvedIds = getSelectedMemberIds();
  const allSelected = selectedMemberIds.length === 0;

  const pillBase = 'px-3 py-1 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors cursor-pointer';

  return (
    <div className={`flex flex-col gap-2 ${compact ? '' : 'mb-3'}`}>
      {/* Level 1: Family selector — only if 2+ families */}
      {families.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <Users className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#9CA3AF' }} />
          <span className="text-[10px] font-semibold uppercase tracking-wide flex-shrink-0" style={{ color: '#9CA3AF' }}>Family:</span>
          <button
            onClick={() => setSelectedFamilyId('')}
            className={pillBase}
            style={{
              backgroundColor: !selectedFamilyId ? '#1B2A4A' : '#F7F5F0',
              color: !selectedFamilyId ? 'white' : '#6B7280',
              border: `1px solid ${!selectedFamilyId ? '#1B2A4A' : '#E8E5DD'}`,
            }}>
            All Families
          </button>
          {families.map(f => (
            <button key={f.id}
              onClick={() => setSelectedFamilyId(f.id)}
              className={pillBase}
              style={{
                backgroundColor: selectedFamilyId === f.id ? '#1B2A4A' : '#F7F5F0',
                color: selectedFamilyId === f.id ? 'white' : '#6B7280',
                border: `1px solid ${selectedFamilyId === f.id ? '#1B2A4A' : '#E8E5DD'}`,
              }}>
              {f.name}
            </button>
          ))}
        </div>
      )}

      {/* Level 2: Member selector — only if 2+ visible members */}
      {visibleMembers.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-semibold uppercase tracking-wide flex-shrink-0" style={{ color: '#9CA3AF' }}>
            {families.length > 1 ? 'Member:' : 'Family:'}
          </span>
          <button
            onClick={selectAllMembers}
            className={pillBase}
            style={{
              backgroundColor: allSelected ? '#C9A84C' : '#F7F5F0',
              color: allSelected ? 'white' : '#6B7280',
              border: `1px solid ${allSelected ? '#C9A84C' : '#E8E5DD'}`,
            }}>
            All Members
          </button>
          {visibleMembers.map(m => {
            const selected = allSelected || resolvedIds.includes(m.id);
            return (
              <button key={m.id}
                onClick={() => {
                  if (allSelected) {
                    // Switch from "all" to selecting ONLY this member
                    useFamilyStore.getState().setSelectedMemberIds([m.id]);
                  } else {
                    toggleMember(m.id);
                  }
                }}
                className={pillBase}
                style={{
                  backgroundColor: selected && !allSelected ? '#C9A84C' : '#F7F5F0',
                  color: selected && !allSelected ? 'white' : '#6B7280',
                  border: `1px solid ${selected && !allSelected ? '#C9A84C' : '#E8E5DD'}`,
                }}>
                {m.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
