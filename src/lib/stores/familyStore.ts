import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface FamilyInfo {
  id: string;
  name: string;
  memberCount: number;
}

interface MemberInfo {
  id: string;
  name: string;
  role: string;
}

interface FamilyStore {
  families: FamilyInfo[];
  selectedFamilyId: string;
  selectedMemberId: string; // '' = all members
  members: MemberInfo[];

  setFamilies: (families: FamilyInfo[]) => void;
  setSelectedFamilyId: (id: string) => void;
  setSelectedMemberId: (id: string) => void;
  setMembers: (members: MemberInfo[]) => void;
}

export const useFamilyStore = create<FamilyStore>()(
  persist(
    (set) => ({
      families: [],
      selectedFamilyId: '',
      selectedMemberId: '',
      members: [],

      setFamilies: (families) => set({ families }),
      setSelectedFamilyId: (id) => set({ selectedFamilyId: id, selectedMemberId: '' }),
      setSelectedMemberId: (id) => set({ selectedMemberId: id }),
      setMembers: (members) => set({ members }),
    }),
    {
      name: 'wv-family-context',
    }
  )
);
