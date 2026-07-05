import {
  GroupAnalytics,
  GroupChargeResult,
  GroupConfig,
  GroupInvite,
  GroupMember,
  GroupMemberRole,
  GroupPlanSharingRules,
  SubscriptionGroup,
} from '../types/group';

const createId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const defaultRules: GroupPlanSharingRules = {
  seatLimit: 5,
  ownerPaysForMembers: true,
  allowMemberOverages: false,
};

export const createSubscriptionGroup = (owner: string, config: GroupConfig): SubscriptionGroup => {
  const now = new Date();
  const ownerMember: GroupMember = {
    address: owner,
    role: 'owner',
    permissions: ['invite', 'remove', 'billing', 'analytics'],
    joinedAt: now,
    outstandingBalance: 0,
    usageUnits: 0,
  };

  return {
    groupId: createId('grp'),
    name: config.name,
    owner,
    members: [ownerMember],
    invites: [],
    planSharingRules: { ...defaultRules, ...config.planSharingRules },
    charges: [],
    createdAt: now,
    updatedAt: now,
  };
};

export const inviteGroupMember = (
  group: SubscriptionGroup,
  inviteeAddress: string,
  invitedBy: string
): SubscriptionGroup => {
  if (group.members.length >= group.planSharingRules.seatLimit) {
    throw new Error('Member limit reached');
  }

  if (group.members.some((member) => member.address === inviteeAddress)) {
    throw new Error('Member already belongs to this group');
  }

  const invite: GroupInvite = {
    id: createId('inv'),
    groupId: group.groupId,
    inviteeAddress,
    invitedBy,
    status: 'pending',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
  };

  return {
    ...group,
    invites: [...group.invites, invite],
    updatedAt: new Date(),
  };
};

export const joinGroupWithInvite = (
  group: SubscriptionGroup,
  inviteId: string,
  displayName?: string
): SubscriptionGroup => {
  const invite = group.invites.find((entry) => entry.id === inviteId);
  if (!invite || invite.status !== 'pending') throw new Error('Invite is not available');
  if (invite.expiresAt.getTime() < Date.now()) throw new Error('Invite has expired');
  if (group.members.length >= group.planSharingRules.seatLimit)
    throw new Error('Member limit reached');

  const member: GroupMember = {
    address: invite.inviteeAddress,
    displayName,
    role: 'member',
    permissions: ['view'],
    joinedAt: new Date(),
    outstandingBalance: 0,
    usageUnits: 0,
  };

  return {
    ...group,
    members: [...group.members, member],
    invites: group.invites.map((entry) =>
      entry.id === inviteId ? { ...entry, status: 'accepted' } : entry
    ),
    updatedAt: new Date(),
  };
};

export const removeGroupMember = (
  group: SubscriptionGroup,
  memberAddress: string
): SubscriptionGroup => {
  if (memberAddress === group.owner)
    throw new Error('Transfer ownership before removing the owner');

  const member = group.members.find((entry) => entry.address === memberAddress);
  if (!member) return group;
  if (member.outstandingBalance > 0) throw new Error('Member has an outstanding balance');

  return {
    ...group,
    members: group.members.filter((entry) => entry.address !== memberAddress),
    updatedAt: new Date(),
  };
};

export const chargeGroup = (group: SubscriptionGroup, amount: number): GroupChargeResult => {
  if (amount <= 0) throw new Error('Charge amount must be greater than zero');

  const billableAmount = group.planSharingRules.familyPlanPrice ?? amount;
  const payer = group.planSharingRules.ownerPaysForMembers ? group.owner : 'members';
  const memberShare = billableAmount / Math.max(group.members.length, 1);
  const breakdown = group.members.map((member) => ({
    memberAddress: member.address,
    amount: group.planSharingRules.ownerPaysForMembers ? 0 : Number(memberShare.toFixed(2)),
    description:
      member.address === group.owner
        ? 'Owner share of consolidated subscription bill'
        : 'Member share of consolidated subscription bill',
  }));

  return {
    groupId: group.groupId,
    payer,
    amount: billableAmount,
    breakdown,
    chargedAt: new Date(),
  };
};

export const getGroupAnalytics = (group: SubscriptionGroup): GroupAnalytics => ({
  groupId: group.groupId,
  activeSeats: group.members.length,
  seatLimit: group.planSharingRules.seatLimit,
  totalUsage: group.members.reduce((sum, member) => sum + member.usageUnits, 0),
  usagePoolLimit: group.planSharingRules.usagePoolLimit,
  outstandingBalance: group.members.reduce((sum, member) => sum + member.outstandingBalance, 0),
  totalSpend: group.charges.reduce((sum, charge) => sum + charge.amount, 0),
  memberActivity: group.members.reduce(
    (activity, member) => ({ ...activity, [member.address]: member.usageUnits }),
    {}
  ),
});

export const updateGroupMemberRole = (
  group: SubscriptionGroup,
  memberAddress: string,
  role: GroupMemberRole
): SubscriptionGroup => ({
  ...group,
  members: group.members.map((member) =>
    member.address === memberAddress
      ? {
          ...member,
          role,
          permissions:
            role === 'admin'
              ? ['invite', 'remove', 'analytics']
              : role === 'owner'
                ? ['invite', 'remove', 'billing', 'analytics']
                : ['view'],
        }
      : member
  ),
  updatedAt: new Date(),
});
