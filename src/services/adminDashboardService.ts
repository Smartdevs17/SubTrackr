import { MonitoringService } from '../../backend/services/monitoring';
import type { DashboardSnapshot, TransactionEvent } from '../../backend/services/types';
import type { AuditEvent } from '../../backend/services/auditTypes';

export type DashboardRole = 'admin' | 'analyst' | 'support';
export type MerchantStatus = 'active' | 'at-risk' | 'suspended';
export type UserRole = 'admin' | 'analyst' | 'support' | 'viewer';

export interface MerchantRecord {
  id: string;
  name: string;
  status: MerchantStatus;
  activePlans: number;
  monthlyRevenue: number;
}

export interface SubscriptionAdminRecord {
  id: string;
  name: string;
  merchantId: string;
  merchantName: string;
  amount: number;
  currency: string;
  status: 'active' | 'paused' | 'draft';
}

export interface AdminUserRecord {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface AdminDashboardData {
  role: DashboardRole;
  analytics: DashboardSnapshot;
  merchants: MerchantRecord[];
  subscriptions: SubscriptionAdminRecord[];
  users: AdminUserRecord[];
  auditLog: AuditEvent[];
}

const monitoring = new MonitoringService();

const sampleTransactions: TransactionEvent[] = [
  {
    id: 'txn_1',
    subscriptionId: 'sub_1',
    amount: 29,
    currency: 'USD',
    status: 'success',
    timestamp: Date.now() - 86_400_000,
    gasUsed: 210_000,
  },
  {
    id: 'txn_2',
    subscriptionId: 'sub_2',
    amount: 59,
    currency: 'USD',
    status: 'failed',
    timestamp: Date.now() - 36_000_000,
    gasUsed: 640_000,
    errorMessage: 'insufficient_allowance',
  },
  {
    id: 'txn_3',
    subscriptionId: 'sub_3',
    amount: 12,
    currency: 'USD',
    status: 'success',
    timestamp: Date.now() - 7_200_000,
    gasUsed: 185_000,
  },
  {
    id: 'txn_4',
    subscriptionId: 'sub_4',
    amount: 99,
    currency: 'USD',
    status: 'success',
    timestamp: Date.now() - 2_400_000,
    gasUsed: 230_000,
  },
];

sampleTransactions.forEach((event) => monitoring.recordTransaction(event));

const merchants: MerchantRecord[] = [
  { id: 'merch_1', name: 'Northstar Studio', status: 'active', activePlans: 12, monthlyRevenue: 4820 },
  { id: 'merch_2', name: 'Ledger Loft', status: 'at-risk', activePlans: 4, monthlyRevenue: 910 },
  { id: 'merch_3', name: 'Orbit Fitness', status: 'suspended', activePlans: 2, monthlyRevenue: 320 },
];

const subscriptions: SubscriptionAdminRecord[] = [
  { id: 'sub_1', name: 'Pro Analytics', merchantId: 'merch_1', merchantName: 'Northstar Studio', amount: 29, currency: 'USD', status: 'active' },
  { id: 'sub_2', name: 'Growth CRM', merchantId: 'merch_2', merchantName: 'Ledger Loft', amount: 59, currency: 'USD', status: 'paused' },
  { id: 'sub_3', name: 'Focus Gym', merchantId: 'merch_3', merchantName: 'Orbit Fitness', amount: 12, currency: 'USD', status: 'draft' },
];

const users: AdminUserRecord[] = [
  { id: 'user_1', name: 'Aisha Bello', email: 'aisha@subtrackr.app', role: 'admin' },
  { id: 'user_2', name: 'Mina Patel', email: 'mina@subtrackr.app', role: 'analyst' },
  { id: 'user_3', name: 'Chris Doe', email: 'support@subtrackr.app', role: 'support' },
];

const auditLog: AuditEvent[] = [
  {
    id: 'audit_1',
    action: 'admin.action',
    actorId: 'user_1',
    resourceId: 'merch_2',
    resourceType: 'merchant',
    metadata: { change: 'status_reviewed' },
    timestamp: Date.now() - 10_800_000,
    hash: 'a1',
    prevHash: '0',
  },
  {
    id: 'audit_2',
    action: 'plan.updated',
    actorId: 'user_2',
    resourceId: 'sub_1',
    resourceType: 'subscription',
    metadata: { field: 'price', previous: 19, next: 29 },
    timestamp: Date.now() - 4_200_000,
    hash: 'a2',
    prevHash: 'a1',
  },
  {
    id: 'audit_3',
    action: 'subscription.paused',
    actorId: 'user_3',
    resourceId: 'sub_2',
    resourceType: 'subscription',
    metadata: { reason: 'merchant_request' },
    timestamp: Date.now() - 1_800_000,
    hash: 'a3',
    prevHash: 'a2',
  },
];

export function getAdminDashboardData(role: DashboardRole): AdminDashboardData {
  return {
    role,
    analytics: monitoring.getDashboard(),
    merchants: merchants.map((merchant) => ({ ...merchant })),
    subscriptions: subscriptions.map((subscription) => ({ ...subscription })),
    users: users.map((user) => ({ ...user })),
    auditLog: auditLog.map((event) => ({ ...event, metadata: { ...event.metadata } })),
  };
}

export function toggleMerchantStatus(
  current: MerchantRecord,
  role: DashboardRole
): MerchantRecord {
  if (role !== 'admin') return current;

  if (current.status === 'active') {
    return { ...current, status: 'suspended' };
  }

  return { ...current, status: 'active' };
}

export function upsertSubscription(
  current: SubscriptionAdminRecord[],
  role: DashboardRole
): SubscriptionAdminRecord[] {
  if (role === 'support') return current;

  const nextId = `sub_${current.length + 1}`;
  return [
    {
      id: nextId,
      name: 'New admin draft',
      merchantId: 'merch_1',
      merchantName: 'Northstar Studio',
      amount: 15,
      currency: 'USD',
      status: 'draft',
    },
    ...current,
  ];
}

export function cycleSubscriptionStatus(
  current: SubscriptionAdminRecord,
  role: DashboardRole
): SubscriptionAdminRecord {
  if (role === 'support') return current;

  const nextStatus =
    current.status === 'draft' ? 'active' : current.status === 'active' ? 'paused' : 'active';

  return { ...current, status: nextStatus };
}

export function deleteSubscription(
  current: SubscriptionAdminRecord[],
  id: string,
  role: DashboardRole
): SubscriptionAdminRecord[] {
  if (role !== 'admin') return current;
  return current.filter((subscription) => subscription.id !== id);
}

export function bulkUpdateSubscriptions(
  current: SubscriptionAdminRecord[],
  selectedIds: string[],
  role: DashboardRole
): SubscriptionAdminRecord[] {
  if (role === 'support') return current;

  return current.map((subscription) =>
    selectedIds.includes(subscription.id) ? { ...subscription, status: 'paused' } : subscription
  );
}

export function updateUserRole(
  current: AdminUserRecord[],
  id: string,
  role: DashboardRole
): AdminUserRecord[] {
  if (role !== 'admin') return current;

  return current.map((user) =>
    user.id === id
      ? { ...user, role: user.role === 'viewer' ? 'analyst' : user.role === 'analyst' ? 'support' : 'viewer' }
      : user
  );
}
