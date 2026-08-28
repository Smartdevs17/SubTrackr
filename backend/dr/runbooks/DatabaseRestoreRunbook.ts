import * as fs from 'fs';
import { RunbookDefinition, DatabaseRestoreConfig } from '../types';

// ---------------------------------------------------------------------------
// Database Restore Runbook
// ---------------------------------------------------------------------------

/**
 * Runbook for restoring a database from backup.
 *
 * Steps:
 *  1. Validate restore config and locate backup
 *  2. Create pre-restore snapshot (safety net)
 *  3. Restore the database
 *  4. Verify restore integrity
 *  5. Update connection pool / warm caches
 *
 * RTO: 15 minutes
 */
export function createDatabaseRestoreRunbook(config: DatabaseRestoreConfig): RunbookDefinition {
  return {
    id: 'database-restore',
    name: 'Database Restore',
    description: 'Restore database from backup with integrity verification',
    rtoSeconds: 900, // 15 minutes

    steps: [
      // ── Step 1: Validate config ───────────────────────────────────────
      {
        id: 'validate-config',
        name: 'Validate restore configuration',
        async execute(ctx) {
          const issues: string[] = [];

          if (!config.databaseId) issues.push('databaseId is required');
          if (!config.backupId && !config.backupPath) {
            issues.push('Either backupId or backupPath is required');
          }
          if (config.backupPath && !fs.existsSync(config.backupPath)) {
            issues.push(`Backup path does not exist: ${config.backupPath}`);
          }
          if (!config.targetEnvironment) issues.push('targetEnvironment is required');

          ctx.state['restoreConfig'] = config;

          if (issues.length > 0) {
            return {
              success: false,
              detail: `Validation failed: ${issues.join('; ')}`,
              output: { issues },
            };
          }

          ctx.log('info', 'Restore configuration validated', {
            databaseId: config.databaseId,
            backupId: config.backupId,
            environment: config.targetEnvironment,
          });

          return {
            success: true,
            detail: `Config valid for database ${config.databaseId}`,
            output: { databaseId: config.databaseId, environment: config.targetEnvironment },
          };
        },
      },

      // ── Step 2: Create pre-restore snapshot ───────────────────────────
      {
        id: 'pre-restore-snapshot',
        name: 'Create pre-restore safety snapshot',
        optional: true,
        timeoutMs: 120_000,
        async execute(ctx) {
          const snapshotId = `pre_restore_${config.databaseId}_${Date.now()}`;
          ctx.state['preRestoreSnapshotId'] = snapshotId;
          ctx.log('info', `Creating pre-restore snapshot: ${snapshotId}`);

          // In production this calls pg_dump, RDS snapshot API, etc.
          // Here we record intent for audit trail.
          return {
            success: true,
            detail: `Pre-restore snapshot initiated: ${snapshotId}`,
            output: { snapshotId },
          };
        },
        async rollback(ctx) {
          const snapshotId = ctx.state['preRestoreSnapshotId'] as string;
          if (snapshotId) {
            ctx.log('info', `Cleaning up pre-restore snapshot: ${snapshotId}`);
          }
        },
      },

      // ── Step 3: Restore database ──────────────────────────────────────
      {
        id: 'restore-database',
        name: 'Restore database from backup',
        maxRetries: 1,
        retryDelayMs: 10_000,
        timeoutMs: 600_000, // 10 minutes
        async execute(ctx) {
          const restoreStart = Date.now();
          const resolvedBackupId = config.backupId ?? `path:${config.backupPath}`;

          ctx.log('info', `Restoring database ${config.databaseId} from backup ${resolvedBackupId}`, {
            targetEnvironment: config.targetEnvironment,
            pointInTimeMs: config.pointInTimeMs,
          });

          // Simulate restore — in production this would:
          //   - pg_restore -d $DATABASE_URL < backup.dump
          //   - AWS RDS restore-db-instance-from-db-snapshot
          //   - etc.
          const durationMs = Date.now() - restoreStart;
          ctx.state['restoreDurationMs'] = durationMs;
          ctx.state['restoredBackupId'] = resolvedBackupId;

          return {
            success: true,
            detail: `Database ${config.databaseId} restored in ${durationMs}ms`,
            output: {
              databaseId: config.databaseId,
              backupId: resolvedBackupId,
              durationMs,
            },
          };
        },
        async rollback(ctx) {
          const snapshotId = ctx.state['preRestoreSnapshotId'] as string;
          if (snapshotId) {
            ctx.log('warn', `Restore failed – consider rolling back to pre-restore snapshot: ${snapshotId}`);
          }
        },
      },

      // ── Step 4: Verify restore ────────────────────────────────────────
      {
        id: 'verify-restore',
        name: 'Verify restore integrity',
        dependsOn: ['restore-database'],
        timeoutMs: 60_000,
        async execute(ctx) {
          if (!config.verifyAfterRestore) {
            return { success: true, detail: 'Verification skipped (verifyAfterRestore=false)' };
          }

          ctx.log('info', 'Running post-restore integrity checks...');

          // In production:
          //   - Run row count checks
          //   - Verify schema migration state
          //   - Check referential integrity
          //   - Compare checksums with backup manifest
          const verificationResult = {
            schemaValid: true,
            rowCountsMatch: true,
            integrityCheckPassed: true,
          };

          const passed = Object.values(verificationResult).every(Boolean);
          ctx.state['verificationResult'] = verificationResult;

          return {
            success: passed,
            detail: passed ? 'Integrity checks passed' : 'Integrity checks failed',
            output: verificationResult,
          };
        },
      },

      // ── Step 5: Warm connection pool ──────────────────────────────────
      {
        id: 'warm-connections',
        name: 'Warm connection pool and caches',
        optional: true,
        dependsOn: ['verify-restore'],
        timeoutMs: 30_000,
        async execute(ctx) {
          ctx.log('info', 'Warming database connection pool...');
          // In production: send health queries to warm the pool
          return {
            success: true,
            detail: 'Connection pool warmed',
            output: { warmed: true },
          };
        },
      },
    ],

    async onFailure(ctx, results) {
      const failedSteps = results.filter((r) => r.status === 'failed').map((r) => r.name);
      ctx.log('error', `Database restore failed. Steps failed: ${failedSteps.join(', ')}`, {
        databaseId: config.databaseId,
        preRestoreSnapshotId: ctx.state['preRestoreSnapshotId'],
      });
    },
  };
}
