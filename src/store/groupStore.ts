import { create } from 'zustand';

interface GroupState {
  groupId: string | null;
  members: any[];
  maxSeats: number;
  setGroup: (groupId: string, members: any[], maxSeats: number) => void;
  clearGroup: () => void;
}

export const useGroupStore = create<GroupState>((set) => ({
  groupId: null,
  members: [],
  maxSeats: 0,
  setGroup: (groupId, members, maxSeats) => set({ groupId, members, maxSeats }),
  clearGroup: () => set({ groupId: null, members: [], maxSeats: 0 }),
}));
