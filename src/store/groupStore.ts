import { create } from 'zustand';
import type { SubscriptionGroup, GroupConfig, GroupAnalytics } from '../types/group';

interface GroupState {
  groupId: string | null;
  members: any[];
  maxSeats: number;
  groups: SubscriptionGroup[];
  error: string | null;
  setGroup: (groupId: string, members: any[], maxSeats: number) => void;
  clearGroup: () => void;
  createGroup: (owner: string, config: GroupConfig) => void;
  inviteMember: (groupId: string, inviteeAddress: string, invitedBy: string) => void;
  chargeGroup: (groupId: string, amount: number) => void;
  getAnalytics: (groupId: string) => GroupAnalytics | undefined;
}

export const useGroupStore = create<GroupState>((set, get) => ({
  groupId: null,
  members: [],
  maxSeats: 0,
  groups: [],
  error: null,
  setGroup: (groupId, members, maxSeats) => set({ groupId, members, maxSeats }),
  clearGroup: () => set({ groupId: null, members: [], maxSeats: 0 }),

  createGroup: (owner, config) => {
    const newGroup: SubscriptionGroup = {
      groupId: `group_${Date.now()}`,
      name: config.name,
      owner,
      members: [],
      invites: [],
      planSharingRules: config.planSharingRules,
      charges: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    set((s) => ({ groups: [...s.groups, newGroup] }));
  },

  inviteMember: (groupId, inviteeAddress, invitedBy) => {
    set((s) => ({
      groups: s.groups.map((g) =>
        g.groupId === groupId
          ? {
              ...g,
              invites: [
                ...g.invites,
                {
                  id: `inv_${Date.now()}`,
                  groupId,
                  inviteeAddress,
                  invitedBy,
                  status: 'pending' as const,
                  expiresAt: new Date(Date.now() + 7 * 86400000),
                  createdAt: new Date(),
                },
              ],
            }
          : g
      ),
    }));
  },

  chargeGroup: (groupId, amount) => {
    set((s) => ({
      groups: s.groups.map((g) =>
        g.groupId === groupId
          ? {
              ...g,
              charges: [
                ...g.charges,
                {
                  groupId,
                  payer: g.owner,
                  amount,
                  breakdown: [],
                  chargedAt: new Date(),
                },
              ],
            }
          : g
      ),
    }));
  },

  getAnalytics: (groupId) => {
    const group = get().groups.find((g) => g.groupId === groupId);
    if (!group) return undefined;
    return {
      groupId,
      activeSeats: group.members.length,
      seatLimit: group.planSharingRules.seatLimit,
      totalUsage: group.members.reduce((sum, m) => sum + (m.usageUnits ?? 0), 0),
      usagePoolLimit: group.planSharingRules.usagePoolLimit,
      outstandingBalance: group.members.reduce((sum, m) => sum + m.outstandingBalance, 0),
      totalSpend: group.charges.reduce((sum, c) => sum + c.amount, 0),
      memberActivity: {},
    };
  },
}));
