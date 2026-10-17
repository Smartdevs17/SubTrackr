/**
 * Purge job scheduler (issue #1799).
 *
 * Wires the DataRetentionService with PostgresRetentionStores and the
 * RetentionEnforcementJob into a single coordinator that:
 *   1. Loads persistent policies from the database on startup
 *   2. Registers SQL-backed stores for each data source
 *   3. Starts the periodic enforcement job
 *   4. Logs enforcement results to retention_enforcement_log
 *
 * Usage:
 *   const scheduler = new PurgeJobScheduler(pool);
 *   await scheduler.start();   // begins periodic enforcement
 *   await scheduler.stop();    // stops the scheduler
 */

import type { Pool } from '../shared/db/connectionPool';
import {
  DataRetentionService,
  DEFAULT_RETENTION_POLICIES,
  type DataRetentionPolicy,
  type RetentionEnforcementReport,
} from './dataRetentionService';
import { RetentionEnforcementJob } from './retentionEnforcementJob';
import {
  PostgresRetentionStore,
  createDefaultRetentionStores,
} from './postgresRetentionStore';

export interface PurgeJobSchedulerOptions {
  /** Enforcement interval in ms. Default: 24h */
  intervalMs?: number;
  /** Called after each enforcement run with the report */
  onReport?: (report: RetentionEnforcementReport) => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export class PurgeJobScheduler {
  private service: DataRetentionService;
  private job: RetentionEnforcementJob;
  private stores: Map<string, PostgresRetentionStore>;
  private started = false;

  constructor(
    private pool: Pool,
    opts: PurgeJobSchedulerOptions = {},
  ) {
    this.service = new DataRetentionService(DEFAULT_RETENTION_POLICIES);
    this.stores = createDefaultRetentionStores(pool);

    // Register all stores
    for (const store of this.stores.values()) {
      this.service.registerStore(store);
    }

    const onReport = opts.onReport ?? ((report: RetentionEnforcementReport) => {
      void this.persistReport(report);
    });

    this.job = new RetentionEnforcementJob(this.service, {
      intervalMs: opts.intervalMs ?? DAY_MS,
      onReport,
    });
  }

  /** Load persistent policies from DB, register stores, and start the job. */
  async start(): Promise<void> {
    if (this.started) return;
    await this.loadPoliciesFromDb();
    this.job.start();
    this.started = true;
  }

  /** Stop the periodic enforcement job. */
  stop(): void {
    this.job.stop();
    this.started = false;
  }

  /** True when the scheduler is actively running. */
  isRunning(): boolean {
    return this.started && this.job.isScheduled();
  }

  /** Return the underlying service for manual enforcement / API access. */
  getService(): DataRetentionService {
    return this.service;
  }

  /** Trigger an immediate enforcement run (outside the schedule). */
  async runNow(): Promise<RetentionEnforcementReport | null> {
    return this.job.run();
  }

  /** Load persistent retention policies from the database. */
  private async loadPoliciesFromDb(): Promise<void> {
    try {
      const result = await this.pool.query<{
        id: string; source: string; description: string | null;
        retention_days: number; action: string; enabled: boolean; batch_size: number;
      }>(`SELECT id, source, description, retention_days, action, enabled, batch_size
          FROM retention_policies`);

      for (const row of result.rows) {
        const policy: DataRetentionPolicy = {
          id: row.id,
          source: row.source,
          description: row.description ?? undefined,
          retentionDays: row.retention_days,
          action: row.action as 'delete' | 'anonymize' | 'archive',
          enabled: row.enabled,
          batchSize: row.batch_size,
        };
        try {
          this.service.upsertPolicy(policy);
        } catch {
          // Skip invalid policies — defaults are already loaded
        }
      }
    } catch {
      // Table may not exist yet — defaults are already loaded
    }
  }

  /** Persist an enforcement report to the audit log table. */
  private async persistReport(report: RetentionEnforcementReport): Promise<void> {
    for (const result of report.results) {
      try {
        await this.pool.query(
          `INSERT INTO retention_enforcement_log
             (run_id, policy_id, source, action, cutoff, expired_found,
              skipped_legal_hold, processed, error, dry_run, started_at, completed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            report.runId,
            result.policyId,
            result.source,
            result.action,
            new Date(result.cutoff).toISOString(),
            result.expiredFound,
            result.skippedLegalHold,
            result.processed,
            result.error ?? null,
            report.dryRun,
            new Date(report.startedAt).toISOString(),
            new Date(report.completedAt).toISOString(),
          ],
        );
      } catch {
        // Logging is best-effort — don't fail enforcement
      }
    }
  }
}
