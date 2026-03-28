import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface FamilyInfo {
  id: string;
  name: string;
}

export interface MemberInfo {
  id: string;
  name: string;
  role: string;
  familyId: string;
}

interface FamilyStore {
  // Data
  families: FamilyInfo[];
  allMembers: MemberInfo[]; // all members across all families

  // Selection (persisted)
  selectedFamilyId: string; // '' = all families consolidated
  selectedMemberIds: string[]; // empty = all members

  // Actions
  setFamilies: (families: FamilyInfo[]) => void;
  setAllMembers: (members: MemberInfo[]) => void;
  setSelectedFamilyId: (id: string) => void;
  setSelectedMemberIds: (ids: string[]) => void;
  toggleMember: (id: string) => void;
  selectAllMembers: () => void;

  // Derived helpers
  getVisibleMembers: () => MemberInfo[];
  getSelectedMemberIds: () => string[]; // resolved: if empty → all visible member IDs
}

export const useFamilyStore = create<FamilyStore>()(
  persist(
    (set, get) => ({
      families: [],
      allMembers: [],
      selectedFamilyId: '',
      selectedMemberIds: [],

      setFamilies: (families) => set({ families }),
      setAllMembers: (members) => set({ allMembers: members }),
      setSelectedFamilyId: (id) => set({ selectedFamilyId: id, selectedMemberIds: [] }),
      setSelectedMemberIds: (ids) => set({ selectedMemberIds: ids }),
      toggleMember: (id) => {
        const current = get().selectedMemberIds;
        if (current.includes(id)) {
          set({ selectedMemberIds: current.filter(x => x !== id) });
        } else {
          set({ selectedMemberIds: [...current, id] });
        }
      },
      selectAllMembers: () => set({ selectedMemberIds: [] }), // empty = all

      getVisibleMembers: () => {
        const { allMembers, selectedFamilyId } = get();
        if (!selectedFamilyId) return allMembers; // all families
        return allMembers.filter(m => m.familyId === selectedFamilyId);
      },

      getSelectedMemberIds: () => {
        const { selectedMemberIds, allMembers, selectedFamilyId } = get();
        const visible = selectedFamilyId
          ? allMembers.filter(m => m.familyId === selectedFamilyId)
          : allMembers;
        if (selectedMemberIds.length === 0) return visible.map(m => m.id);
        return selectedMemberIds;
      },
    }),
    {
      name: 'wv-family-context',
      partialize: (state) => ({
        selectedFamilyId: state.selectedFamilyId,
        selectedMemberIds: state.selectedMemberIds,
      }),
    }
  )
);
