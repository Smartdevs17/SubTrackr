/**
 * Administrator subscription management console (Issue #2199).
 *
 * Framework-agnostic service that powers the admin console's subscription
 * list, lifecycle controls, bulk actions and audit trail. Every mutation is
 * permission-checked and produces an immutable audit record.
 */

import type { AccessControlService } from '../accessControl';

export type ManagedSubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'paused'
  | 'past_due'
  | 'canceled';

export interface ManagedSubscription {
  id: string;
  ownerId: string;
  planId: string;
  status: ManagedSubscriptionStatus;
  amount: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
  pausedAt?: string;
  cancelReason?: string;
}

export interface SubscriptionConsoleFilter {
  status?: ManagedSubscriptionStatus;
  ownerId?: string;
  planId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface SubscriptionConsolePage {
  items: ManagedSubscription[];
  total: number;
  limit: number;
  offset: number;
}

export interface SubscriptionConsoleSummary {
  total: number;
  byStatus: Record<ManagedSubscriptionStatus, number>;
  monthlyRecurringRevenue: number;
  currency: string;
}

export interface AuditRecord {
  id: string;
  actorId: string;
  action: string;
  subscriptionId: string;
  reason?: string;
  before?: Partial<ManagedSubscription>;
  after?: Partial<ManagedSubscription>;
  at: string;
}

export interface AuditFilter {
  subscriptionId?: string;
  actorId?: string;
  limit?: number;
}

export interface BulkActionResult {
  requested: string[];
  succeeded: string[];
  failed: Array<{ id: string; code: string; message: string }>;
}

export type SubscriptionConsoleErrorCode =
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'VALIDATION_ERROR';

export class SubscriptionConsoleError extends Error {
  readonly code: SubscriptionConsoleErrorCode;
  readonly status: number;

  constructor(code: SubscriptionConsoleErrorCode, message: string) {
    super(message);
    this.name = 'SubscriptionConsoleError';
    this.code = code;
    this.status = code === 'FORBIDDEN' ? 403 : code === 'NOT_FOUND' ? 404 : 400;
  }
}

export interface SubscriptionConsoleStore {
  get(id: string): Promise<ManagedSubscription | null>;
  list(): Promise<readonly ManagedSubscription[]>;
  save(subscription: ManagedSubscription): Promise<void>;
  appendAudit(record: AuditRecord): Promise<void>;
  listAudit(): Promise<readonly AuditRecord[]>;
}

export class InMemorySubscriptionConsoleStore implements SubscriptionConsoleStore {
  private readonly subscriptions = new Map<string, ManagedSubscription>();
  private readonly auditRecords: AuditRecord[] = [];

  constructor(seed: readonly ManagedSubscription[] = []) {
    for (const subscription of seed) {
      this.subscriptions.set(subscription.id, { ...subscription });
    }
  }

  async get(id: string): Promise<ManagedSubscription | null> {
    return this.subscriptions.get(id) ?? null;
  }

  async list(): Promise<readonly ManagedSubscription[]> {
    return [...this.subscriptions.values()].map((subscription) => ({ ...subscription }));
  }

  async save(subscription: ManagedSubscription): Promise<void> {
    this.subscriptions.set(subscription.id, { ...subscription });
  }

  async appendAudit(record: AuditRecord): Promise<void> {
    this.auditRecords.push({ ...record });
  }

  async listAudit(): Promise<readonly AuditRecord[]> {
    return [...this.auditRecords];
  }
}

export interface SubscriptionConsoleDeps {
  store: SubscriptionConsoleStore;
  accessControl: Pick<AccessControlService, 'hasPermission'>;
  clock?: () => Date;
  defaultCurrency?: string;
}

const MAX_PAGE_SIZE = 100;
const STATUSES: ManagedSubscriptionStatus[] = [
  'trialing',
  'active',
  'paused',
  'past_due',
  'canceled',
];

function emptyStatusCounts(): Record<ManagedSubscriptionStatus, number> {
  return STATUSES.reduce(
    (counts, status) => {
      counts[status] = 0;
      return counts;
    },
    {} as Record<ManagedSubscriptionStatus, number>
  );
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new SubscriptionConsoleError('VALIDATION_ERROR', `${field} must be a non-empty string`);
  }
  return value.trim();
}

export class SubscriptionConsoleService {
  private readonly store: SubscriptionConsoleStore;
  private readonly accessControl: Pick<AccessControlService, 'hasPermission'>;
  private readonly clock: () => Date;
  private readonly defaultCurrency: string;

  constructor(deps: SubscriptionConsoleDeps) {
    this.store = deps.store;
    this.accessControl = deps.accessControl;
    this.clock = deps.clock ?? (() => new Date());
    this.defaultCurrency = deps.defaultCurrency ?? 'USD';
  }

  async listSubscriptions(
    actorId: string,
    filter: SubscriptionConsoleFilter = {}
  ): Promise<SubscriptionConsolePage> {
    this.authorize(actorId, 'read');
    const rows = await this.store.list();
    const search = filter.search?.trim().toLowerCase();
    const filtered = rows
      .filter((row) => (filter.status ? row.status === filter.status : true))
      .filter((row) => (filter.ownerId ? row.ownerId === filter.ownerId : true))
      .filter((row) => (filter.planId ? row.planId === filter.planId : true))
      .filter((row) =>
        search
          ? row.id.toLowerCase().includes(search) ||
            row.ownerId.toLowerCase().includes(search) ||
            row.planId.toLowerCase().includes(search)
          : true
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

    const limit = Math.min(Math.max(Math.floor(filter.limit ?? 20), 1), MAX_PAGE_SIZE);
    const offset = Math.max(Math.floor(filter.offset ?? 0), 0);
    return {
      items: filtered.slice(offset, offset + limit).map((row) => ({ ...row })),
      total: filtered.length,
      limit,
      offset,
    };
  }

  async getSubscription(actorId: string, id: string): Promise<ManagedSubscription> {
    this.authorize(actorId, 'read');
    return this.requireSubscription(id);
  }

  async getSummary(actorId: string): Promise<SubscriptionConsoleSummary> {
    this.authorize(actorId, 'read');
    const rows = await this.store.list();
    const byStatus = emptyStatusCounts();
    let monthlyRecurringRevenue = 0;

    for (const row of rows) {
      byStatus[row.status] += 1;
      if (row.status === 'active' || row.status === 'trialing' || row.status === 'past_due') {
        monthlyRecurringRevenue += row.amount;
      }
    }

    return {
      total: rows.length,
      byStatus,
      monthlyRecurringRevenue: Number(monthlyRecurringRevenue.toFixed(2)),
      currency: this.defaultCurrency,
    };
  }

  async pauseSubscription(
    actorId: string,
    id: string,
    reason: string
  ): Promise<ManagedSubscription> {
    this.authorize(actorId, 'update');
    const before = await this.requireSubscription(id);
    this.assertTransition(before, ['active', 'trialing'], 'paused');
    const after = this.withTimestamp(before, {
      status: 'paused',
      pausedAt: this.nowIso(),
    });
    await this.commit(actorId, 'pause_subscription', before, after, nonEmptyString(reason, 'reason'));
    return after;
  }

  async resumeSubscription(actorId: string, id: string): Promise<ManagedSubscription> {
    this.authorize(actorId, 'update');
    const before = await this.requireSubscription(id);
    this.assertTransition(before, ['paused'], 'active');
    const after = this.withTimestamp(before, { status: 'active', pausedAt: undefined });
    await this.commit(actorId, 'resume_subscription', before, after);
    return after;
  }

  async cancelSubscription(
    actorId: string,
    id: string,
    reason: string
  ): Promise<ManagedSubscription> {
    this.authorize(actorId, 'delete');
    const before = await this.requireSubscription(id);
    this.assertTransition(before, ['active', 'trialing', 'paused', 'past_due'], 'canceled');
    const after = this.withTimestamp(before, {
      status: 'canceled',
      cancelReason: nonEmptyString(reason, 'reason'),
    });
    await this.commit(actorId, 'cancel_subscription', before, after, reason);
    return after;
  }

  async changePlan(actorId: string, id: string, planId: string): Promise<ManagedSubscription> {
    this.authorize(actorId, 'update');
    const before = await this.requireSubscription(id);
    this.assertTransition(before, ['active', 'trialing', 'paused'], before.status);
    const after = this.withTimestamp(before, {
      planId: nonEmptyString(planId, 'planId'),
    });
    await this.commit(actorId, 'change_plan', before, after);
    return after;
  }

  async bulkPause(
    actorId: string,
    ids: readonly string[],
    reason: string
  ): Promise<BulkActionResult> {
    this.authorize(actorId, 'update');
    nonEmptyString(reason, 'reason');
    const uniqueIds = [...new Set(ids.map((id) => nonEmptyString(id, 'id')))];
    const succeeded: string[] = [];
    const failed: BulkActionResult['failed'] = [];

    for (const id of uniqueIds) {
      try {
        const before = await this.requireSubscription(id);
        this.assertTransition(before, ['active', 'trialing'], 'paused');
        const after = this.withTimestamp(before, {
          status: 'paused',
          pausedAt: this.nowIso(),
        });
        await this.commit(actorId, 'bulk_pause_subscription', before, after, reason);
        succeeded.push(id);
      } catch (error) {
        const consoleError =
          error instanceof SubscriptionConsoleError
            ? error
            : new SubscriptionConsoleError('VALIDATION_ERROR', 'Unable to pause subscription');
        failed.push({ id, code: consoleError.code, message: consoleError.message });
      }
    }

    return { requested: uniqueIds, succeeded, failed };
  }

  async getAuditLog(actorId: string, filter: AuditFilter = {}): Promise<AuditRecord[]> {
    this.authorize(actorId, 'read', 'audit_logs');
    const records = await this.store.listAudit();
    return records
      .filter((record) =>
        filter.subscriptionId ? record.subscriptionId === filter.subscriptionId : true
      )
      .filter((record) => (filter.actorId ? record.actorId === filter.actorId : true))
      .slice()
      .reverse()
      .slice(0, Math.min(Math.max(filter.limit ?? 50, 1), 500));
  }

  private authorize(actorId: string, action: 'read' | 'update' | 'delete', resource: 'subscriptions' | 'audit_logs' = 'subscriptions'): void {
    const actor = nonEmptyString(actorId, 'actorId');
    if (!this.accessControl.hasPermission(actor, resource, action)) {
      throw new SubscriptionConsoleError('FORBIDDEN', `Actor ${actor} cannot ${action} ${resource}`);
    }
  }

  private async requireSubscription(id: string): Promise<ManagedSubscription> {
    const subscription = await this.store.get(nonEmptyString(id, 'id'));
    if (!subscription) {
      throw new SubscriptionConsoleError('NOT_FOUND', `Subscription ${id} was not found`);
    }
    return subscription;
  }

  private assertTransition(
    subscription: ManagedSubscription,
    allowed: readonly ManagedSubscriptionStatus[],
    target: ManagedSubscriptionStatus
  ): void {
    if (!allowed.includes(subscription.status)) {
      throw new SubscriptionConsoleError(
        'INVALID_TRANSITION',
        `Cannot move subscription ${subscription.id} from ${subscription.status} to ${target}`
      );
    }
  }

  private withTimestamp(
    before: ManagedSubscription,
    patch: Partial<ManagedSubscription>
  ): ManagedSubscription {
    const next: ManagedSubscription = { ...before, ...patch, updatedAt: this.nowIso() };
    if (patch.pausedAt === undefined) {
      delete next.pausedAt;
    }
    return next;
  }

  private async commit(
    actorId: string,
    action: string,
    before: ManagedSubscription,
    after: ManagedSubscription,
    reason?: string
  ): Promise<void> {
    await this.store.save(after);
    await this.store.appendAudit({
      id: `audit_${this.clock().getTime().toString(36)}_${action}`,
      actorId,
      action,
      subscriptionId: after.id,
      reason,
      before: { status: before.status, planId: before.planId },
      after: { status: after.status, planId: after.planId },
      at: this.nowIso(),
    });
  }

  private nowIso(): string {
    return this.clock().toISOString();
  }
}
