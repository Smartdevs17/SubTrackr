export type GroupId = string;
export type GroupMemberRole = 'owner' | 'admin' | 'member';
export type GroupInviteStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

export interface GroupMember {
  address: string;
  displayName?: string;
  role: GroupMemberRole;
  permissions?: string[];
  paymentMethodId?: string;
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
  familyPlanPrice?: number;
}

export interface GroupBillingLineItem {
  memberAddress: string;
  amount: number;
  description: string;
}

/** Strategies for splitting a group charge across members. */
export type BillingAllocationStrategy =
  | 'equal'
  | 'usage_weighted'
  | 'custom_weights'
  | 'owner_pays';

/** Optional per-member weight map used by `custom_weights`. */
export type CustomBillingWeights = Record<string, number>;

export interface MemberBillingAllocationItem {
  memberAddress: string;
  amount: number;
  weight: number;
  sharePercent: number;
  description: string;
}

export interface MemberBillingAllocation {
  groupId: GroupId;
  strategy: BillingAllocationStrategy;
  totalAmount: number;
  items: MemberBillingAllocationItem[];
  allocatedAt: Date;
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
  totalSpend: number;
  memberActivity: Record<string, number>;
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
  billingAddress?: string;
  charges: GroupChargeResult[];
  createdAt: Date;
  updatedAt: Date;
}
