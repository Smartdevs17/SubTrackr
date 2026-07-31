import type {
  SubscriptionGroup,
  GroupChargeResult,
  GroupBillingLineItem,
  GroupAnalytics,
  GroupMember,
  GroupPlanSharingRules,
  GroupConfig,
} from '../../../src/types/group';

export interface GroupBillingSummary {
  groupId: string;
  totalCharges: number;
  totalAmount: number;
  averageChargeAmount: number;
  lastChargeAt: number | null;
  outstandingBalance: number;
  memberBalances: Record<string, number>;
  billingFrequency: 'monthly' | 'quarterly' | 'annual';
}

export interface GroupInvoice {
  id: string;
  groupId: string;
  period: { start: number; end: number };
  lineItems: GroupBillingLineItem[];
  totalAmount: number;
  taxAmount: number;
  discountAmount: number;
  finalAmount: number;
  currency: string;
  status: 'draft' | 'issued' | 'paid' | 'overdue';
  issuedAt?: number;
  paidAt?: number;
  createdAt: number;
}

export interface GroupAdminAction {
  id: string;
  groupId: string;
  action: 'invite' | 'remove' | 'role_change' | 'billing_override' | 'plan_change' | 'pause_member';
  actorAddress: string;
  targetAddress?: string;
  metadata: Record<string, unknown>;
  timestamp: number;
}

export interface GroupPlanCustomization {
  groupId: string;
  basePlanId: string;
  customName?: string;
  customPrice?: number;
  sharedFeatures: string[];
  memberLimits: Record<string, number>;
  ownerDiscount: number;
  createdAt: number;
  updatedAt: number;
}

const createId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export class GroupBillingService {
  private invoices = new Map<string, GroupInvoice[]>();
  private adminActions: GroupAdminAction[] = [];
  private planCustomizations = new Map<string, GroupPlanCustomization>();

  // ── Billing Aggregation ─────────────────────────────────────────────────

  generateBillingSummary(group: SubscriptionGroup): GroupBillingSummary {
    const charges = group.charges;
    const totalCharges = charges.length;
    const totalAmount = charges.reduce((sum, c) => sum + c.amount, 0);
    const averageChargeAmount = totalCharges > 0 ? totalAmount / totalCharges : 0;
    const lastChargeAt = charges.length > 0
      ? Math.max(...charges.map((c) => c.chargedAt.getTime()))
      : null;

    const memberBalances: Record<string, number> = {};
    for (const member of group.members) {
      memberBalances[member.address] = member.outstandingBalance;
    }
    const outstandingBalance = group.members.reduce(
      (sum, m) => sum + m.outstandingBalance,
      0
    );

    return {
      groupId: group.groupId,
      totalCharges,
      totalAmount,
      averageChargeAmount,
      lastChargeAt,
      outstandingBalance,
      memberBalances,
      billingFrequency: group.planSharingRules.familyPlanPrice ? 'monthly' : 'monthly',
    };
  }

  aggregateCharges(group: SubscriptionGroup, periodDays = 30): GroupBillingLineItem[] {
    const cutoff = Date.now() - periodDays * 24 * 60 * 60 * 1000;
    const recentCharges = group.charges.filter(
      (c) => c.chargedAt.getTime() >= cutoff
    );

    const memberCharges = new Map<string, number>();
    for (const member of group.members) {
      memberCharges.set(member.address, 0);
    }

    for (const charge of recentCharges) {
      for (const item of charge.breakdown) {
        const current = memberCharges.get(item.memberAddress) ?? 0;
        memberCharges.set(item.memberAddress, current + item.amount);
      }
    }

    return Array.from(memberCharges.entries()).map(([address, amount]) => ({
      memberAddress: address,
      amount,
      description: `Aggregated charges over last ${periodDays} days`,
    }));
  }

  // ── Group Invoice Generation ────────────────────────────────────────────

  generateInvoice(
    group: SubscriptionGroup,
    periodStart: number,
    periodEnd: number,
    currency = 'USD'
  ): GroupInvoice {
    const aggregated = this.aggregateCharges(group, Math.ceil((periodEnd - periodStart) / (24 * 60 * 60 * 1000)));
    const totalAmount = aggregated.reduce((sum, item) => sum + item.amount, 0);

    const customization = this.planCustomizations.get(group.groupId);
    const discountAmount = customization?.ownerDiscount
      ? (totalAmount * customization.ownerDiscount) / 100
      : 0;
    const taxAmount = 0;
    const finalAmount = totalAmount - discountAmount + taxAmount;

    const invoice: GroupInvoice = {
      id: createId('ginv'),
      groupId: group.groupId,
      period: { start: periodStart, end: periodEnd },
      lineItems: aggregated,
      totalAmount,
      taxAmount,
      discountAmount,
      finalAmount,
      currency,
      status: 'draft',
      createdAt: Date.now(),
    };

    const existing = this.invoices.get(group.groupId) ?? [];
    existing.push(invoice);
    this.invoices.set(group.groupId, existing);

    return invoice;
  }

  issueInvoice(invoiceId: string, groupId: string): GroupInvoice | null {
    const invoices = this.invoices.get(groupId);
    if (!invoices) return null;

    const idx = invoices.findIndex((inv) => inv.id === invoiceId);
    if (idx === -1) return null;

    invoices[idx] = {
      ...invoices[idx],
      status: 'issued',
      issuedAt: Date.now(),
    };

    return invoices[idx];
  }

  markInvoicePaid(invoiceId: string, groupId: string): GroupInvoice | null {
    const invoices = this.invoices.get(groupId);
    if (!invoices) return null;

    const idx = invoices.findIndex((inv) => inv.id === invoiceId);
    if (idx === -1) return null;

    invoices[idx] = {
      ...invoices[idx],
      status: 'paid',
      paidAt: Date.now(),
    };

    return invoices[idx];
  }

  getGroupInvoices(groupId: string): GroupInvoice[] {
    return this.invoices.get(groupId) ?? [];
  }

  // ── Group Analytics ─────────────────────────────────────────────────────

  calculateGroupAnalytics(group: SubscriptionGroup): GroupAnalytics & {
    billingSummary: GroupBillingSummary;
    memberUtilization: Array<{
      address: string;
      usagePercent: number;
      costShare: number;
      isActive: boolean;
    }>;
  } {
    const billingSummary = this.generateBillingSummary(group);
    const seatUtilization = (group.members.length / group.planSharingRules.seatLimit) * 100;
    const totalUsage = group.members.reduce((sum, m) => sum + m.usageUnits, 0);
    const usagePoolLimit = group.planSharingRules.usagePoolLimit ?? 1;
    const usageUtilization = (totalUsage / usagePoolLimit) * 100;

    const costShare = billingSummary.totalAmount / Math.max(group.members.length, 1);

    const memberUtilization = group.members.map((member) => ({
      address: member.address,
      usagePercent: totalUsage > 0 ? (member.usageUnits / totalUsage) * 100 : 0,
      costShare,
      isActive: member.outstandingBalance === 0,
    }));

    return {
      groupId: group.groupId,
      activeSeats: group.members.length,
      seatLimit: group.planSharingRules.seatLimit,
      totalUsage,
      usagePoolLimit: group.planSharingRules.usagePoolLimit,
      outstandingBalance: billingSummary.outstandingBalance,
      totalSpend: billingSummary.totalAmount,
      memberActivity: group.members.reduce(
        (activity, member) => ({ ...activity, [member.address]: member.usageUnits }),
        {} as Record<string, number>
      ),
      billingSummary,
      memberUtilization,
    };
  }

  // ── Group Admin Controls ────────────────────────────────────────────────

  recordAdminAction(
    groupId: string,
    action: GroupAdminAction['action'],
    actorAddress: string,
    targetAddress?: string,
    metadata: Record<string, unknown> = {}
  ): GroupAdminAction {
    const adminAction: GroupAdminAction = {
      id: createId('adm'),
      groupId,
      action,
      actorAddress,
      targetAddress,
      metadata,
      timestamp: Date.now(),
    };

    this.adminActions.push(adminAction);
    return adminAction;
  }

  getAdminActions(groupId: string, limit = 50): GroupAdminAction[] {
    return this.adminActions
      .filter((a) => a.groupId === groupId)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  canPerformAction(
    group: SubscriptionGroup,
    actorAddress: string,
    action: GroupAdminAction['action']
  ): { allowed: boolean; reason?: string } {
    const member = group.members.find((m) => m.address === actorAddress);
    if (!member) {
      return { allowed: false, reason: 'Actor is not a group member' };
    }

    const rolePermissions: Record<string, string[]> = {
      owner: ['invite', 'remove', 'role_change', 'billing_override', 'plan_change', 'pause_member'],
      admin: ['invite', 'remove', 'pause_member'],
      member: [],
    };

    const allowedActions = rolePermissions[member.role] ?? [];
    if (!allowedActions.includes(action)) {
      return { allowed: false, reason: `Role "${member.role}" cannot perform "${action}"` };
    }

    return { allowed: true };
  }

  // ── Group Plan Customization ────────────────────────────────────────────

  customizeGroupPlan(groupId: string, customization: Omit<GroupPlanCustomization, 'groupId' | 'createdAt' | 'updatedAt'>): GroupPlanCustomization {
    const existing = this.planCustomizations.get(groupId);
    const now = Date.now();

    const plan: GroupPlanCustomization = {
      ...customization,
      groupId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.planCustomizations.set(groupId, plan);
    return plan;
  }

  getGroupPlanCustomization(groupId: string): GroupPlanCustomization | undefined {
    return this.planCustomizations.get(groupId);
  }

  // ── Billing Override ────────────────────────────────────────────────────

  overrideMemberBalance(
    group: SubscriptionGroup,
    memberAddress: string,
    newBalance: number,
    actorAddress: string
  ): GroupMember | null {
    const permission = this.canPerformAction(group, actorAddress, 'billing_override');
    if (!permission.allowed) return null;

    const member = group.members.find((m) => m.address === memberAddress);
    if (!member) return null;

    this.recordAdminAction(group.groupId, 'billing_override', actorAddress, memberAddress, {
      previousBalance: member.outstandingBalance,
      newBalance,
    });

    return {
      ...member,
      outstandingBalance: newBalance,
    };
  }
}

export const groupBillingService = new GroupBillingService();
