/**
 * GDPR Data Retention Policy Enforcement (Storage Limitation — Article 5(1)(e))
 *
 * Defines how long each category of data may be kept and enforces those limits
 * across all registered data stores. Expired records are deleted, anonymized or
 * archived according to their policy. Records under a legal hold are never touched.
 */

export type RetentionAction = 'delete' | 'anonymize' | 'archive';

export interface DataRetentionPolicy {
  id: string;
  /** Data store this policy applies to (matches RetentionDataStore.sourceName) */
  source: string;
  /** Human-readable description of what the policy covers */
  description?: string;
  /** Records older than this many days are considered expired */
  retentionDays: number;
  /** What happens to expired records */
  action: RetentionAction;
  /** Disabled policies are skipped during enforcement */
  enabled: boolean;
  /** Maximum records processed per enforcement run (bounds work per run) */
  batchSize?: number;
}

export interface RetentionRecord {
  id: string;
  /** Owner of the record, used for user-level legal holds */
  userId?: string;
  /** Epoch ms timestamp the retention period is measured from */
  timestamp: number;
}

export interface RetentionDataStore {
  sourceName: string;
  /** Return records with timestamp <= cutoff, at most `limit` of them */
  findExpired(cutoff: number, limit: number): Promise<RetentionRecord[]>;
  deleteRecords(ids: string[]): Promise<number>;
  anonymizeRecords?(ids: string[]): Promise<number>;
  archiveRecords?(ids: string[]): Promise<number>;
}

export type LegalHoldScope = 'user' | 'record';

export interface LegalHold {
  id: string;
  scope: LegalHoldScope;
  /** userId for 'user' scope, record id for 'record' scope */
  targetId: string;
  /** Restrict the hold to one source; applies to all sources when omitted */
  source?: string;
  reason: string;
  placedAt: number;
  releasedAt?: number;
}

export interface PolicyEnforcementResult {
  policyId: string;
  source: string;
  action: RetentionAction;
  cutoff: number;
  expiredFound: number;
  skippedLegalHold: number;
  processed: number;
  error?: string;
}

export interface RetentionEnforcementReport {
  runId: string;
  startedAt: number;
  completedAt: number;
  dryRun: boolean;
  results: PolicyEnforcementResult[];
  totalProcessed: number;
  totalSkippedLegalHold: number;
  failedPolicies: string[];
}

export interface EnforceOptions {
  dryRun?: boolean;
  /** Override the current time (epoch ms) */
  now?: number;
  /** Only enforce these policy ids */
  policyIds?: string[];
}

export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 3650;
export const DEFAULT_BATCH_SIZE = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_REPORT_HISTORY = 50;

/** Defaults aligned with the retention commitments in docs/gdpr.md */
export const DEFAULT_RETENTION_POLICIES: DataRetentionPolicy[] = [
  {
    id: 'deactivated-account-logs',
    source: 'activity_logs',
    description: 'Activity logs of deactivated accounts',
    retentionDays: 90,
    action: 'delete',
    enabled: true,
  },
  {
    id: 'notification-history',
    source: 'notifications',
    description: 'Delivered notification history',
    retentionDays: 180,
    action: 'delete',
    enabled: true,
  },
  {
    id: 'billing-records',
    source: 'billing_records',
    description: 'Invoices and payment records (kept for tax and accounting)',
    retentionDays: 7 * 365,
    action: 'anonymize',
    enabled: true,
  },
  {
    id: 'audit-logs',
    source: 'audit_logs',
    description: 'Security and compliance audit trail',
    retentionDays: 7 * 365,
    action: 'archive',
    enabled: true,
  },
];

export class RetentionPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetentionPolicyError';
  }
}

export function validateRetentionPolicy(policy: DataRetentionPolicy): string[] {
  const errors: string[] = [];
  if (!policy.id || typeof policy.id !== 'string') errors.push('id is required');
  if (!policy.source || typeof policy.source !== 'string') errors.push('source is required');
  if (
    typeof policy.retentionDays !== 'number' ||
    !Number.isInteger(policy.retentionDays) ||
    policy.retentionDays < MIN_RETENTION_DAYS ||
    policy.retentionDays > MAX_RETENTION_DAYS
  ) {
    errors.push(
      `retentionDays must be an integer between ${MIN_RETENTION_DAYS} and ${MAX_RETENTION_DAYS}`
    );
  }
  if (!['delete', 'anonymize', 'archive'].includes(policy.action)) {
    errors.push('action must be one of: delete, anonymize, archive');
  }
  if (typeof policy.enabled !== 'boolean') errors.push('enabled must be a boolean');
  if (
    policy.batchSize !== undefined &&
    (!Number.isInteger(policy.batchSize) || policy.batchSize < 1)
  ) {
    errors.push('batchSize must be a positive integer');
  }
  return errors;
}

export class DataRetentionService {
  private policies: Map<string, DataRetentionPolicy> = new Map();
  private stores: Map<string, RetentionDataStore> = new Map();
  private holds: Map<string, LegalHold> = new Map();
  private reports: RetentionEnforcementReport[] = [];
  private running = false;

  constructor(policies: DataRetentionPolicy[] = []) {
    for (const policy of policies) this.upsertPolicy(policy);
  }

  // ── Stores ────────────────────────────────────────────────────────────────

  registerStore(store: RetentionDataStore): void {
    if (this.stores.has(store.sourceName)) {
      throw new RetentionPolicyError(`Store already registered: ${store.sourceName}`);
    }
    this.stores.set(store.sourceName, store);
  }

  listStores(): string[] {
    return [...this.stores.keys()];
  }

  // ── Policies ──────────────────────────────────────────────────────────────

  upsertPolicy(policy: DataRetentionPolicy): DataRetentionPolicy {
    const errors = validateRetentionPolicy(policy);
    if (errors.length > 0) {
      throw new RetentionPolicyError(`Invalid retention policy: ${errors.join('; ')}`);
    }
    const duplicate = [...this.policies.values()].find(
      (p) => p.source === policy.source && p.id !== policy.id
    );
    if (duplicate) {
      throw new RetentionPolicyError(
        `Source ${policy.source} is already governed by policy ${duplicate.id}`
      );
    }
    const stored = { ...policy };
    this.policies.set(policy.id, stored);
    return { ...stored };
  }

  removePolicy(policyId: string): boolean {
    return this.policies.delete(policyId);
  }

  getPolicy(policyId: string): DataRetentionPolicy | null {
    const policy = this.policies.get(policyId);
    return policy ? { ...policy } : null;
  }

  listPolicies(): DataRetentionPolicy[] {
    return [...this.policies.values()].map((p) => ({ ...p }));
  }

  // ── Legal holds ───────────────────────────────────────────────────────────

  placeLegalHold(input: {
    scope: LegalHoldScope;
    targetId: string;
    reason: string;
    source?: string;
  }): LegalHold {
    if (!input.targetId) throw new RetentionPolicyError('targetId is required');
    if (!input.reason) throw new RetentionPolicyError('reason is required');
    if (input.scope !== 'user' && input.scope !== 'record') {
      throw new RetentionPolicyError('scope must be user or record');
    }
    const hold: LegalHold = {
      id: crypto.randomUUID(),
      scope: input.scope,
      targetId: input.targetId,
      source: input.source,
      reason: input.reason,
      placedAt: Date.now(),
    };
    this.holds.set(hold.id, hold);
    return { ...hold };
  }

  releaseLegalHold(holdId: string): LegalHold | null {
    const hold = this.holds.get(holdId);
    if (!hold || hold.releasedAt !== undefined) return null;
    hold.releasedAt = Date.now();
    return { ...hold };
  }

  listLegalHolds(activeOnly = true): LegalHold[] {
    return [...this.holds.values()]
      .filter((h) => !activeOnly || h.releasedAt === undefined)
      .map((h) => ({ ...h }));
  }

  isUnderLegalHold(source: string, record: RetentionRecord): boolean {
    for (const hold of this.holds.values()) {
      if (hold.releasedAt !== undefined) continue;
      if (hold.source && hold.source !== source) continue;
      if (hold.scope === 'record' && hold.targetId === record.id) return true;
      if (hold.scope === 'user' && record.userId && hold.targetId === record.userId) return true;
    }
    return false;
  }

  // ── Enforcement ───────────────────────────────────────────────────────────

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Enforce all enabled policies. A failure in one policy is recorded in the
   * report and does not stop the remaining policies from being enforced.
   */
  async enforce(options: EnforceOptions = {}): Promise<RetentionEnforcementReport> {
    if (this.running) {
      throw new RetentionPolicyError('Retention enforcement is already running');
    }
    this.running = true;
    const dryRun = options.dryRun ?? false;
    const now = options.now ?? Date.now();
    const startedAt = Date.now();

    try {
      const policies = [...this.policies.values()].filter(
        (p) => p.enabled && (!options.policyIds || options.policyIds.includes(p.id))
      );

      const results: PolicyEnforcementResult[] = [];
      for (const policy of policies) {
        results.push(await this.enforcePolicy(policy, now, dryRun));
      }

      const report: RetentionEnforcementReport = {
        runId: crypto.randomUUID(),
        startedAt,
        completedAt: Date.now(),
        dryRun,
        results,
        totalProcessed: results.reduce((sum, r) => sum + r.processed, 0),
        totalSkippedLegalHold: results.reduce((sum, r) => sum + r.skippedLegalHold, 0),
        failedPolicies: results.filter((r) => r.error).map((r) => r.policyId),
      };
      this.reports.unshift(report);
      if (this.reports.length > MAX_REPORT_HISTORY) this.reports.length = MAX_REPORT_HISTORY;
      return report;
    } finally {
      this.running = false;
    }
  }

  getLastReport(): RetentionEnforcementReport | null {
    return this.reports[0] ?? null;
  }

  listReports(limit = 10): RetentionEnforcementReport[] {
    return this.reports.slice(0, limit);
  }

  private async enforcePolicy(
    policy: DataRetentionPolicy,
    now: number,
    dryRun: boolean
  ): Promise<PolicyEnforcementResult> {
    const cutoff = now - policy.retentionDays * DAY_MS;
    const result: PolicyEnforcementResult = {
      policyId: policy.id,
      source: policy.source,
      action: policy.action,
      cutoff,
      expiredFound: 0,
      skippedLegalHold: 0,
      processed: 0,
    };

    const store = this.stores.get(policy.source);
    if (!store) {
      result.error = `No data store registered for source: ${policy.source}`;
      return result;
    }

    try {
      const expired = await store.findExpired(cutoff, policy.batchSize ?? DEFAULT_BATCH_SIZE);
      // Guard against stores that ignore the cutoff — never act on unexpired data.
      const eligible = expired.filter((r) => r.timestamp <= cutoff);
      result.expiredFound = eligible.length;

      const actionable = eligible.filter((r) => !this.isUnderLegalHold(policy.source, r));
      result.skippedLegalHold = eligible.length - actionable.length;

      if (actionable.length === 0) return result;
      const ids = actionable.map((r) => r.id);

      if (dryRun) {
        result.processed = ids.length;
        return result;
      }

      result.processed = await this.applyAction(store, policy.action, ids);
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
    }
    return result;
  }

  private async applyAction(
    store: RetentionDataStore,
    action: RetentionAction,
    ids: string[]
  ): Promise<number> {
    switch (action) {
      case 'delete':
        return store.deleteRecords(ids);
      case 'anonymize':
        if (!store.anonymizeRecords) {
          throw new RetentionPolicyError(`Store ${store.sourceName} does not support anonymize`);
        }
        return store.anonymizeRecords(ids);
      case 'archive':
        if (!store.archiveRecords) {
          throw new RetentionPolicyError(`Store ${store.sourceName} does not support archive`);
        }
        return store.archiveRecords(ids);
    }
  }
}
