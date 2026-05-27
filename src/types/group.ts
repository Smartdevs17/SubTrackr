export type GroupId = string;
export type GroupMemberRole = 'owner' | 'admin' | 'member';
export type GroupInviteStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

export interface GroupMember {
  address: string;
  displayName?: string;
  role: GroupMemberRole;
  joinedAt: Date;
  outstandingBalance: number;
  usageUnits: number;
}

export interface GroupInvite {
  id: string;
  groupId: GroupId;
  inviteeAddress: string;
  invitedBy: string;
  status: GroupInviteStatus;
  expiresAt: Date;
  createdAt: Date;
}

export interface GroupPlanSharingRules {
  seatLimit: number;
  usagePoolLimit?: number;
  ownerPaysForMembers: boolean;
  allowMemberOverages: boolean;
}

export interface GroupBillingLineItem {
  memberAddress: string;
  amount: number;
  description: string;
}

export interface GroupChargeResult {
  groupId: GroupId;
  payer: string;
  amount: number;
  breakdown: GroupBillingLineItem[];
  chargedAt: Date;
}

export interface GroupAnalytics {
  groupId: GroupId;
  activeSeats: number;
  seatLimit: number;
  totalUsage: number;
  usagePoolLimit?: number;
  outstandingBalance: number;
}

export interface GroupConfig {
  name: string;
  planSharingRules: GroupPlanSharingRules;
}

export interface SubscriptionGroup {
  groupId: GroupId;
  name: string;
  owner: string;
  members: GroupMember[];
  invites: GroupInvite[];
  planSharingRules: GroupPlanSharingRules;
  charges: GroupChargeResult[];
  createdAt: Date;
  updatedAt: Date;
}
