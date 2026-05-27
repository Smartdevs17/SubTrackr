import { create } from 'zustand';
import {
  chargeGroup,
  createSubscriptionGroup,
  getGroupAnalytics,
  inviteGroupMember,
  joinGroupWithInvite,
  removeGroupMember,
} from '../services/groupService';
import { GroupAnalytics, GroupConfig, GroupId, SubscriptionGroup } from '../types/group';

interface GroupState {
  groups: SubscriptionGroup[];
  selectedGroupId?: GroupId;
  isLoading: boolean;
  error: string | null;
  createGroup: (owner: string, config: GroupConfig) => SubscriptionGroup;
  inviteMember: (groupId: GroupId, inviteeAddress: string, invitedBy: string) => void;
  joinGroup: (groupId: GroupId, inviteId: string, displayName?: string) => void;
  removeMember: (groupId: GroupId, memberAddress: string) => void;
  chargeGroup: (groupId: GroupId, amount: number) => void;
  getAnalytics: (groupId: GroupId) => GroupAnalytics | undefined;
  selectGroup: (groupId?: GroupId) => void;
}

const updateGroup = (
  groups: SubscriptionGroup[],
  groupId: GroupId,
  updater: (group: SubscriptionGroup) => SubscriptionGroup
): SubscriptionGroup[] => groups.map((group) => (group.groupId === groupId ? updater(group) : group));

export const useGroupStore = create<GroupState>((set, get) => ({
  groups: [],
  selectedGroupId: undefined,
  isLoading: false,
  error: null,

  createGroup: (owner, config) => {
    const group = createSubscriptionGroup(owner, config);
    set((state) => ({ groups: [...state.groups, group], selectedGroupId: group.groupId }));
    return group;
  },

  inviteMember: (groupId, inviteeAddress, invitedBy) => {
    try {
      set((state) => ({
        groups: updateGroup(state.groups, groupId, (group) =>
          inviteGroupMember(group, inviteeAddress, invitedBy)
        ),
        error: null,
      }));
    } catch (error) {
      set({ error: (error as Error).message });
    }
  },

  joinGroup: (groupId, inviteId, displayName) => {
    try {
      set((state) => ({
        groups: updateGroup(state.groups, groupId, (group) =>
          joinGroupWithInvite(group, inviteId, displayName)
        ),
        error: null,
      }));
    } catch (error) {
      set({ error: (error as Error).message });
    }
  },

  removeMember: (groupId, memberAddress) => {
    try {
      set((state) => ({
        groups: updateGroup(state.groups, groupId, (group) => removeGroupMember(group, memberAddress)),
        error: null,
      }));
    } catch (error) {
      set({ error: (error as Error).message });
    }
  },

  chargeGroup: (groupId, amount) => {
    try {
      set((state) => ({
        groups: updateGroup(state.groups, groupId, (group) => ({
          ...group,
          charges: [...group.charges, chargeGroup(group, amount)],
          updatedAt: new Date(),
        })),
        error: null,
      }));
    } catch (error) {
      set({ error: (error as Error).message });
    }
  },

  getAnalytics: (groupId) => {
    const group = get().groups.find((entry) => entry.groupId === groupId);
    return group ? getGroupAnalytics(group) : undefined;
  },

  selectGroup: (groupId) => set({ selectedGroupId: groupId }),
}));
