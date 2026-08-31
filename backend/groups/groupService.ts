/**
 * Group subscription service.
 * Manages group plans, seats, invites, and billing metadata.
 */

export type GroupRole = 'owner' | 'member';
export type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'trialing';
export type BillingInterval = 'monthly' | 'yearly';

export interface GroupMember {
  userId: string;
  role: GroupRole;
  joinedAt: number;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  maxSeats: number;
  pricePerSeat: number;
  billingInterval: BillingInterval;
}

export interface Group {
  id: string;
  ownerId: string;
  name: string;
  maxSeats: number;
  members: GroupMember[];
  billingCycleId: string;
  planId: string;
  subscriptionStatus: SubscriptionStatus;
  nextBillingDate: number;
  createdAt: number;
  updatedAt: number;
}

export interface Invite {
  code: string;
  groupId: string;
  email: string;
  invitedBy: string;
  createdAt: number;
  expiresAt: number;
  used: boolean;
}

export interface BillingInfo {
  groupId: string;
  planId: string;
  maxSeats: number;
  seatsUsed: number;
  amountDue: number;
  billingCycleId: string;
  nextBillingDate: number;
  status: SubscriptionStatus;
}

export class GroupServiceError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'GroupServiceError';
  }
}

export class GroupService {
  private groups: Map<string, Group> = new Map();
  private invites: Map<string, Invite> = new Map();
  private plans: Map<string, SubscriptionPlan> = new Map();

  constructor(plans?: SubscriptionPlan[]) {
    const defaultPlans: SubscriptionPlan[] = [
      { id: 'basic-monthly', name: 'Basic Monthly', maxSeats: 3, pricePerSeat: 10, billingInterval: 'monthly' },
      { id: 'basic-yearly', name: 'Basic Yearly', maxSeats: 3, pricePerSeat: 8, billingInterval: 'yearly' },
      { id: 'pro-monthly', name: 'Pro Monthly', maxSeats: 10, pricePerSeat: 15, billingInterval: 'monthly' },
      { id: 'pro-yearly', name: 'Pro Yearly', maxSeats: 10, pricePerSeat: 12, billingInterval: 'yearly' },
      { id: 'enterprise', name: 'Enterprise', maxSeats: 100, pricePerSeat: 20, billingInterval: 'yearly' },
    ];
    const planList = plans && plans.length > 0 ? plans : defaultPlans;
    planList.forEach(p => this.plans.set(p.id, p));
  }

  createGroup(ownerId: string, name: string, planId: string = 'basic-monthly'): Group {
    if (!name || name.trim().length === 0) {
      throw new GroupServiceError('Group name is required', 'INVALID_NAME');
    }
    const plan = this.plans.get(planId);
    if (!plan) {
      throw new GroupServiceError('Invalid plan', 'INVALID_PLAN');
    }
    const now = Date.now();
    const group: Group = {
      id: `group_${now}`,
      ownerId,
      name: name.trim(),
      maxSeats: plan.maxSeats,
      members: [{ userId: ownerId, role: 'owner', joinedAt: now }],
      billingCycleId: `cycle_${now}`,
      planId: plan.id,
      subscriptionStatus: 'active',
      nextBillingDate: this.calculateNextBillingDate(now, plan.billingInterval),
      createdAt: now,
      updatedAt: now,
    };
    this.groups.set(group.id, group);
    return group;
  }

  getGroup(groupId: string): Group {
    const group = this.groups.get(groupId);
    if (!group) {
      throw new GroupServiceError('Group not found', 'GROUP_NOT_FOUND');
    }
    return group;
  }

  listGroups(): Group[] {
    return Array.from(this.groups.values());
  }

  getPlans(): SubscriptionPlan[] {
    return Array.from(this.plans.values());
  }

  inviteMember(groupId: string, inviterId: string, email: string): string {
    const group = this.getGroup(groupId);
    if (group.ownerId !== inviterId) {
      throw new GroupServiceError('Only owner can invite members', 'UNAUTHORIZED');
    }
    if (group.subscriptionStatus !== 'active' && group.subscriptionStatus !== 'trialing') {
      throw new GroupServiceError('Subscription is not active', 'SUBSCRIPTION_INACTIVE');
    }
    if (group.members.length >= group.maxSeats) {
      throw new GroupServiceError('No seats available', 'NO_SEATS');
    }
    if (!email || !this.isValidEmail(email)) {
      throw new GroupServiceError('Invalid email', 'INVALID_EMAIL');
    }
    const normalizedEmail = email.toLowerCase();
    const pendingInvite = Array.from(this.invites.values()).find(
      i => i.groupId === groupId && i.email === normalizedEmail && !i.used && i.expiresAt > Date.now()
    );
    if (pendingInvite) {
      throw new GroupServiceError('An invite already exists for this email', 'DUPLICATE_INVITE');
    }
    const now = Date.now();
    const invite: Invite = {
      code: `invite_${now}_${Math.random().toString(36).substr(2, 9)}`,
      groupId,
      email: normalizedEmail,
      invitedBy: inviterId,
      createdAt: now,
      expiresAt: now + 7 * 24 * 60 * 60 * 1000, // 7 days
      used: false,
    };
    this.invites.set(invite.code, invite);
    // In a production system, send email with the invite code here.
    return invite.code;
  }

  joinGroup(groupId: string, userId: string, inviteCode: string): Group {
    const group = this.getGroup(groupId);
    if (group.subscriptionStatus !== 'active' && group.subscriptionStatus !== 'trialing') {
      throw new GroupServiceError('Subscription is not active', 'SUBSCRIPTION_INACTIVE');
    }
    const invite = this.invites.get(inviteCode);
    if (!invite || invite.used) {
      throw new GroupServiceError('Invalid or expired invite code', 'INVALID_INVITE');
    }
    if (invite.expiresAt < Date.now()) {
      throw new GroupServiceError('Invite has expired', 'INVITE_EXPIRED');
    }
    if (invite.groupId !== groupId) {
      throw new GroupServiceError('Invite is not for this group', 'INVITE_MISMATCH');
    }
    if (group.members.find(m => m.userId === userId)) {
      throw new GroupServiceError('User is already a member', 'ALREADY_MEMBER');
    }
    if (group.members.length >= group.maxSeats) {
      throw new GroupServiceError('Group is full', 'GROUP_FULL');
    }
    invite.used = true;
    this.invites.set(inviteCode, invite);
    group.members.push({
      userId,
      role: 'member',
      joinedAt: Date.now(),
    });
    group.updatedAt = Date.now();
    this.groups.set(groupId, group);
    return group;
  }

  removeMember(groupId: string, ownerId: string, memberId: string): void {
    const group = this.getGroup(groupId);
    if (group.ownerId !== ownerId) {
      throw new GroupServiceError('Only owner can remove members', 'UNAUTHORIZED');
    }
    if (ownerId === memberId) {
      throw new GroupServiceError('Owner cannot remove themselves', 'OWNER_SELF_REMOVAL');
    }
    const memberExists = group.members.some(m => m.userId === memberId);
    if (!memberExists) {
      throw new GroupServiceError('Member not found', 'MEMBER_NOT_FOUND');
    }
    group.members = group.members.filter(m => m.userId !== memberId);
    group.updatedAt = Date.now();
    this.groups.set(groupId, group);
  }

  updatePlan(groupId: string, ownerId: string, newPlanId: string): Group {
    const group = this.getGroup(groupId);
    if (group.ownerId !== ownerId) {
      throw new GroupServiceError('Only owner can change plan', 'UNAUTHORIZED');
    }
    const newPlan = this.plans.get(newPlanId);
    if (!newPlan) {
      throw new GroupServiceError('Invalid plan', 'INVALID_PLAN');
    }
    if (newPlan.id === group.planId) {
      return group;
    }
    if (group.members.length > newPlan.maxSeats) {
      throw new GroupServiceError('Plan does not have enough seats for current members', 'INSUFFICIENT_SEATS');
    }
    group.planId = newPlan.id;
    group.maxSeats = newPlan.maxSeats;
    group.subscriptionStatus = 'active';
    group.nextBillingDate = this.calculateNextBillingDate(Date.now(), newPlan.billingInterval);
    group.updatedAt = Date.now();
    this.groups.set(groupId, group);
    return group;
  }

  addSeats(groupId: string, ownerId: string, seatsToAdd: number): Group {
    const group = this.getGroup(groupId);
    if (group.ownerId !== ownerId) {
      throw new GroupServiceError('Only owner can add seats', 'UNAUTHORIZED');
    }
    if (seatsToAdd <= 0) {
      throw new GroupServiceError('Seats must be positive', 'INVALID_SEAT_COUNT');
    }
    // In a production system, this would trigger a prorated charge.
    group.maxSeats += seatsToAdd;
    group.updatedAt = Date.now();
    this.groups.set(groupId, group);
    return group;
  }

  getBillingInfo(groupId: string): BillingInfo {
    const group = this.getGroup(groupId);
    const plan = this.plans.get(group.planId);
    if (!plan) {
      throw new GroupServiceError('Plan not found', 'INVALID_PLAN');
    }
    const seatsUsed = group.members.length;
    return {
      groupId: group.id,
      planId: plan.id,
      maxSeats: group.maxSeats,
      seatsUsed,
      amountDue: seatsUsed * plan.pricePerSeat,
      billingCycleId: group.billingCycleId,
      nextBillingDate: group.nextBillingDate,
      status: group.subscriptionStatus,
    };
  }

  cancelSubscription(groupId: string, ownerId: string): Group {
    const group = this.getGroup(groupId);
    if (group.ownerId !== ownerId) {
      throw new GroupServiceError('Only owner can cancel subscription', 'UNAUTHORIZED');
    }
    if (group.subscriptionStatus === 'canceled') {
      throw new GroupServiceError('Subscription already canceled', 'ALREADY_CANCELED');
    }
    group.subscriptionStatus = 'canceled';
    group.updatedAt = Date.now();
    this.groups.set(groupId, group);
    return group;
  }

  private isValidEmail(email: string): boolean {
    return /^[\s]+@[^\s]+\.[^\s]+$/.test(email);
  }

  private calculateNextBillingDate(fromDate: number, interval: BillingInterval): number {
    const date = new Date(fromDate);
    if (interval === 'monthly') {
      date.setMonth(date.getMonth() + 1);
    } else {
      date.setFullYear(date.getFullYear() + 1);
    }
    return date.getTime();
  }
}
