/**
 * backend/src/services/audit.ts
 *
 * Append-only audit log service for admin-sensitive actions. Every admin
 * mutation is sealed into a tamper-evident SHA-256 hash chain (see
 * `../lib/tamperChain`) so that deletion, reordering, or content edits are
 * detectable at verification time.
 *
 * Design rules (issue #2273):
 *  - The service owns the chain head; callers never supply hashes.
 *  - Callers supply the timestamp to keep persistence clock-generic; a
 *    default `Date.now()` provider is offered for convenience only.
 *  - Every decision (append / verify / violation) emits metrics + logs.
 *  - The backing store interface is minimal and adapter-agnostic.
 *
 * Usage:
 *   const audit = createAuditLogService({ store: myStore });
 *   await audit.record({
 *     actor: 'admin:42', action: 'role.grant',
 *     resource: 'user:7', timestamp: new Date().toISOString(),
 *   });
 *   const report = await audit.verifyIntegrity();
 *   if (!report.valid) alertSecurity(report.issues);
 */

import {
  type AuditEventInput,
  type ChainVerificationReport,
  type SealedAuditEntry,
  type TamperChainConfig,
  createTamperChain,
  verifyChain,
} from '../lib/tamperChain.ts';

// ?? Types ???????????????????????????????????????????????????????????????

export type AuditAction =
  | 'role.grant'
  | 'role.revoke'
  | 'key.rotate'
  | 'user.suspend'
  | 'user.delete'
  | 'settings.update'
  | 'permission.change'
  | 'export.create'
  | 'webhook.rotate'
  | 'billing.override';

export interface AuditRecordInput extends AuditEventInput {
  /** Strongly typed admin action. Falls back to the free-form `action` for unknown values. */
  kind?: AuditAction;
}

/** Minimal persistence adapter. Implementations decide durability semantics. */
export interface AuditStore {
  /** Persist a sealed entry atomically. */
  append(entry: SealedAuditEntry): Promise<void>;
  /** Load all sealed entries in append order for verification. */
  loadAll(): Promise<readonly SealedAuditEntry[]>;
  /** Load the last N sealed entries (for head checkpointing). Optional. */
  loadLast?(n: number): Promise<readonly SealedAuditEntry[]>;
}

export interface AuditMetrics {
  increment?(name: string, labels?: Record<string, string>): void;
  observe?(name: string, value: number, labels?: Record<string, string>): void;
}

export interface AuditLogger {
  info?(message: string, fields?: Record<string, unknown>): void;
  warn?(message: string, fields?: Record<string, unknown>): void;
  error?(message: string, fields?: Record<string, unknown>): void;
}

export interface AuditServiceConfig {
  store: AuditStore;
  chain?: TamperChainConfig;
  metrics?: AuditMetrics;
  logger?: AuditLogger;
  /** When true, `verifyIntegrity` throws on tampering instead of returning a report. */
  strict?: boolean;
}

export interface RecordResult {
  entry: SealedAuditEntry;
  /** True when the store accepted the append. */
  persisted: boolean;
}

export interface AuditLogService {
  /** Seal and persist an admin action. */
  record(input: AuditRecordInput): Promise<RecordResult>;
  /** Verify the persisted log in full. */
  verifyIntegrity(): Promise<ChainVerificationReport>;
  /** Current in-memory head hash. */
  head(): string;
  /** Number of entries sealed this session. */
  sealedCount(): number;
}

// ?? Service ??????????????????????????????????????????????????????????????

/**
 * Create an audit log service backed by a tamper-evident hash chain.
 * The in-memory chain is rebuilt from the store on first use so the head
 * remains correct across service restarts.
 */
export function createAuditLogService(config: AuditServiceConfig): AuditLogService {
  const { store, strict = false } = config;
  const metrics = config.metrics;
  const logger = config.logger;
  const chain = createTamperChain(config.chain, { metrics, logger });
  let hydrated = false;

  async function hydrate(): Promise<void> {
    if (hydrated) return;
    const existing = await store.loadAll();
    // Re-seal loaded payloads to rebuild the head deterministically from the
    // canonical chain, ignoring any (possibly tampered) stored hashes.
    if (existing.length > 0) {
      for (const e of existing) {
        chain.append({
          actor: e.actor,
          action: e.action,
          resource: e.resource,
          timestamp: e.timestamp,
          metadata: e.metadata,
        });
      }
    }
    hydrated = true;
  }

  return {
    async record(input: AuditRecordInput): Promise<RecordResult> {
      await hydrate();
      const effective: AuditEventInput = {
        actor: input.actor,
        action: input.kind ?? input.action,
        resource: input.resource,
        timestamp: input.timestamp,
        metadata: input.metadata,
      };
      const entry = chain.append(effective);
      await store.append(entry);
      metrics?.increment?.('audit.record.total', { action: entry.action });
      logger?.info?.('audit.record.sealed', { seq: entry.seq, actor: entry.actor, action: entry.action });
      return { entry, persisted: true };
    },

    async verifyIntegrity(): Promise<ChainVerificationReport> {
      await hydrate();
      const persisted = await store.loadAll();
      const report = verifyChain(persisted, config.chain, { metrics, logger });
      metrics?.observe?.('audit.integrity.issues', report.issues.length);
      if (!report.valid) {
        logger?.warn?.('audit.integrity.violation', {
          issues: report.issues.length,
          headHash: report.headHash,
        });
        if (strict) {
          throw new Error(`audit log tampering detected: ${report.issues.length} issue(s)`);
        }
      } else {
        logger?.info?.('audit.integrity.ok', { entries: report.entriesChecked });
      }
      return report;
    },

    head(): string {
      return chain.head();
    },

    sealedCount(): number {
      return chain.length();
    },
  };
}

/** Convenience: a no-op in-memory store for tests and local development. */
export function createInMemoryAuditStore(seed: readonly SealedAuditEntry[] = []): AuditStore {
  const rows: SealedAuditEntry[] = [...seed];
  return {
    async append(entry: SealedAuditEntry): Promise<void> {
      rows.push({ ...entry });
    },
    async loadAll(): Promise<readonly SealedAuditEntry[]> {
      return rows.map((e) => ({ ...e }));
    },
    async loadLast(n: number): Promise<readonly SealedAuditEntry[]> {
      return rows.slice(-n).map((e) => ({ ...e }));
    },
  };
}
