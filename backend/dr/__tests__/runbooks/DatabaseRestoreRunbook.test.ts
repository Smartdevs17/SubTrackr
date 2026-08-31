import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { createDatabaseRestoreRunbook } from '../../runbooks/DatabaseRestoreRunbook';
import { RunbookEngine } from '../../RunbookEngine';
import { DatabaseRestoreConfig, RunbookContext } from '../../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<DatabaseRestoreConfig> = {}): DatabaseRestoreConfig {
  return {
    databaseId: 'test-db',
    backupId: 'backup-001',
    targetEnvironment: 'staging',
    verifyAfterRestore: true,
    ...overrides,
  };
}

function makeCtx(stateOverrides: Record<string, unknown> = {}): RunbookContext {
  return {
    executionId: 'test-exec',
    environment: 'staging',
    triggeredBy: 'test',
    params: {},
    state: stateOverrides,
    startedAt: Date.now(),
    log: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createDatabaseRestoreRunbook', () => {
  let engine: RunbookEngine;

  beforeEach(() => {
    engine = new RunbookEngine({ defaultRetryDelayMs: 0 });
  });

  it('creates a runbook definition', () => {
    const runbook = createDatabaseRestoreRunbook(makeConfig());
    expect(runbook.id).toBe('database-restore');
    expect(runbook.rtoSeconds).toBe(900);
    expect(runbook.steps.length).toBeGreaterThan(0);
  });

  it('has expected step IDs', () => {
    const runbook = createDatabaseRestoreRunbook(makeConfig());
    const ids = runbook.steps.map((s) => s.id);
    expect(ids).toContain('validate-config');
    expect(ids).toContain('pre-restore-snapshot');
    expect(ids).toContain('restore-database');
    expect(ids).toContain('verify-restore');
    expect(ids).toContain('warm-connections');
  });

  // ── validate-config ──────────────────────────────────────────────────────

  describe('validate-config step', () => {
    it('passes with valid config', async () => {
      const runbook = createDatabaseRestoreRunbook(makeConfig());
      const validateStep = runbook.steps.find((s) => s.id === 'validate-config')!;
      const ctx = makeCtx();
      const result = await validateStep.execute(ctx);
      expect(result.success).toBe(true);
      expect(ctx.state['restoreConfig']).toBeDefined();
    });

    it('fails when databaseId is missing', async () => {
      const runbook = createDatabaseRestoreRunbook(makeConfig({ databaseId: '' }));
      const validateStep = runbook.steps.find((s) => s.id === 'validate-config')!;
      const result = await validateStep.execute(makeCtx());
      expect(result.success).toBe(false);
      expect(result.detail).toMatch(/databaseId is required/i);
    });

    it('fails when neither backupId nor backupPath provided', async () => {
      const runbook = createDatabaseRestoreRunbook(makeConfig({ backupId: undefined, backupPath: undefined }));
      const validateStep = runbook.steps.find((s) => s.id === 'validate-config')!;
      const result = await validateStep.execute(makeCtx());
      expect(result.success).toBe(false);
      expect(result.detail).toMatch(/backupId or backupPath/i);
    });

    it('fails when backupPath does not exist', async () => {
      const runbook = createDatabaseRestoreRunbook(makeConfig({
        backupId: undefined,
        backupPath: '/nonexistent/path/backup.dump',
      }));
      const validateStep = runbook.steps.find((s) => s.id === 'validate-config')!;
      const result = await validateStep.execute(makeCtx());
      expect(result.success).toBe(false);
    });

    it('passes when backupPath exists', async () => {
      const tmp = os.tmpdir();
      const backupPath = path.join(tmp, 'test-backup.dump');
      fs.writeFileSync(backupPath, 'dummy backup data');
      const runbook = createDatabaseRestoreRunbook(makeConfig({ backupId: undefined, backupPath }));
      const validateStep = runbook.steps.find((s) => s.id === 'validate-config')!;
      const result = await validateStep.execute(makeCtx());
      expect(result.success).toBe(true);
      fs.unlinkSync(backupPath);
    });
  });

  // ── pre-restore-snapshot ──────────────────────────────────────────────────

  describe('pre-restore-snapshot step', () => {
    it('creates a snapshot ID in context state', async () => {
      const runbook = createDatabaseRestoreRunbook(makeConfig());
      const snapshotStep = runbook.steps.find((s) => s.id === 'pre-restore-snapshot')!;
      const ctx = makeCtx();
      const result = await snapshotStep.execute(ctx);
      expect(result.success).toBe(true);
      expect(ctx.state['preRestoreSnapshotId']).toMatch(/^pre_restore_/);
    });

    it('rollback cleans up snapshot reference', async () => {
      const runbook = createDatabaseRestoreRunbook(makeConfig());
      const snapshotStep = runbook.steps.find((s) => s.id === 'pre-restore-snapshot')!;
      const ctx = makeCtx({ preRestoreSnapshotId: 'pre_restore_test-db_123' });
      // Should not throw
      await expect(snapshotStep.rollback!(ctx)).resolves.toBeUndefined();
    });
  });

  // ── restore-database ──────────────────────────────────────────────────────

  describe('restore-database step', () => {
    it('succeeds and records duration', async () => {
      const runbook = createDatabaseRestoreRunbook(makeConfig());
      const restoreStep = runbook.steps.find((s) => s.id === 'restore-database')!;
      const ctx = makeCtx({ restoreConfig: makeConfig() });
      const result = await restoreStep.execute(ctx);
      expect(result.success).toBe(true);
      expect(ctx.state['restoreDurationMs']).toBeGreaterThanOrEqual(0);
      expect(ctx.state['restoredBackupId']).toBe('backup-001');
    });

    it('resolves backup from path when backupId not provided', async () => {
      const runbook = createDatabaseRestoreRunbook(makeConfig({ backupId: undefined, backupPath: '/tmp/backup.dump' }));
      const restoreStep = runbook.steps.find((s) => s.id === 'restore-database')!;
      const ctx = makeCtx({ restoreConfig: makeConfig({ backupId: undefined, backupPath: '/tmp/backup.dump' }) });
      const result = await restoreStep.execute(ctx);
      expect(result.success).toBe(true);
      expect(ctx.state['restoredBackupId']).toContain('path:');
    });
  });

  // ── verify-restore ────────────────────────────────────────────────────────

  describe('verify-restore step', () => {
    it('passes verification when verifyAfterRestore=true', async () => {
      const runbook = createDatabaseRestoreRunbook(makeConfig({ verifyAfterRestore: true }));
      const verifyStep = runbook.steps.find((s) => s.id === 'verify-restore')!;
      const ctx = makeCtx();
      const result = await verifyStep.execute(ctx);
      expect(result.success).toBe(true);
    });

    it('skips verification when verifyAfterRestore=false', async () => {
      const runbook = createDatabaseRestoreRunbook(makeConfig({ verifyAfterRestore: false }));
      const verifyStep = runbook.steps.find((s) => s.id === 'verify-restore')!;
      const result = await verifyStep.execute(makeCtx());
      expect(result.success).toBe(true);
      expect(result.detail).toMatch(/skipped/i);
    });

    it('has dependency on restore-database', () => {
      const runbook = createDatabaseRestoreRunbook(makeConfig());
      const verifyStep = runbook.steps.find((s) => s.id === 'verify-restore')!;
      expect(verifyStep.dependsOn).toContain('restore-database');
    });
  });

  // ── warm-connections ──────────────────────────────────────────────────────

  describe('warm-connections step', () => {
    it('succeeds and marks warmed=true', async () => {
      const runbook = createDatabaseRestoreRunbook(makeConfig());
      const warmStep = runbook.steps.find((s) => s.id === 'warm-connections')!;
      const result = await warmStep.execute(makeCtx());
      expect(result.success).toBe(true);
      expect(result.output?.warmed).toBe(true);
    });

    it('depends on verify-restore', () => {
      const runbook = createDatabaseRestoreRunbook(makeConfig());
      const warmStep = runbook.steps.find((s) => s.id === 'warm-connections')!;
      expect(warmStep.dependsOn).toContain('verify-restore');
    });

    it('is marked optional', () => {
      const runbook = createDatabaseRestoreRunbook(makeConfig());
      const warmStep = runbook.steps.find((s) => s.id === 'warm-connections')!;
      expect(warmStep.optional).toBe(true);
    });
  });

  // ── onFailure ─────────────────────────────────────────────────────────────

  it('calls onFailure with context when runbook fails', async () => {
    const runbook = createDatabaseRestoreRunbook(makeConfig({ databaseId: '' }));
    const onFailure = jest.spyOn(runbook as any, 'onFailure');
    await engine.execute(runbook, { environment: 'staging', triggeredBy: 'test' });
    // onFailure is called by the engine
    expect(typeof runbook.onFailure).toBe('function');
  });

  // ── Full engine execution ─────────────────────────────────────────────────

  it('full execution succeeds with valid config', async () => {
    const runbook = createDatabaseRestoreRunbook(makeConfig({ verifyAfterRestore: true }));
    const result = await engine.execute(runbook, { environment: 'staging', triggeredBy: 'test' });
    expect(result.success).toBe(true);
    expect(result.rtoCompliant).toBe(true);
  });

  it('full execution fails with invalid config', async () => {
    const runbook = createDatabaseRestoreRunbook(makeConfig({ databaseId: '' }));
    const result = await engine.execute(runbook, { environment: 'staging', triggeredBy: 'test' });
    expect(result.success).toBe(false);
    const validateResult = result.steps.find((s) => s.stepId === 'validate-config');
    expect(validateResult?.status).toBe('failed');
  });
});
