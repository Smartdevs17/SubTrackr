/**
 * Integration tests for the DR system.
 *
 * These tests verify the interaction between:
 *  - DrStateManager
 *  - RunbookEngine
 *  - Individual runbooks
 *  - HealthCheckManager
 *
 * They simulate real DR scenarios end-to-end.
 */

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { DrStateManager } from '../DrStateManager';
import { RunbookEngine } from '../RunbookEngine';
import { HealthCheckManager } from '../HealthCheckManager';
import { createBuildFailureRunbook } from '../runbooks/BuildFailureRunbook';
import { createDatabaseRestoreRunbook } from '../runbooks/DatabaseRestoreRunbook';
import { createRollbackRunbook } from '../runbooks/RollbackRunbook';
import { RunbookDefinition, RunbookContext, DeploymentInfo } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempProject(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-integration-'));
  fs.writeFileSync(
    path.join(tmp, 'package.json'),
    JSON.stringify({ name: 'subtrackr-test', version: '2.0.0', scripts: { build: 'echo ok', 'lint:fix': 'echo lint' } })
  );
  fs.writeFileSync(
    path.join(tmp, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { target: 'ES2017', strict: false } })
  );
  fs.mkdirSync(path.join(tmp, 'node_modules'));
  fs.mkdirSync(path.join(tmp, 'node_modules', 'fake-pkg'));
  return tmp;
}

function makeSuccessRunbook(id: string, rtoSeconds = 30): RunbookDefinition {
  return {
    id,
    name: `Test Runbook ${id}`,
    description: 'Integration test runbook',
    rtoSeconds,
    steps: [
      {
        id: 'step-1',
        name: 'Step 1',
        execute: jest.fn().mockResolvedValue({ success: true, detail: 'step 1 done' }),
      },
      {
        id: 'step-2',
        name: 'Step 2',
        dependsOn: ['step-1'],
        execute: jest.fn().mockResolvedValue({ success: true, detail: 'step 2 done' }),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Integration Tests
// ---------------------------------------------------------------------------

describe('DR System Integration', () => {
  let stateManager: DrStateManager;
  let engine: RunbookEngine;
  let tmp: string;

  beforeEach(() => {
    stateManager = new DrStateManager();
    engine = new RunbookEngine({ defaultRetryDelayMs: 0 });
    tmp = makeTempProject();
  });

  afterEach(() => {
    stateManager.reset('cleanup');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  // ── Scenario 1: Build Failure Detection → Recovery → Resolution ───────────

  describe('Scenario 1: Build failure detection and recovery', () => {
    it('transitions state machine through full build failure recovery cycle', async () => {
      // 1. System detects a build failure
      stateManager.transition('detecting', { trigger: 'build-ci-failure' });
      expect(stateManager.getPhase()).toBe('detecting');

      // 2. Start recovery with build failure runbook
      stateManager.transition('recovering', {
        trigger: 'build-failure-runbook',
        activeRunbook: 'build-failure',
      });
      expect(stateManager.isRecovering()).toBe(true);

      // 3. Execute runbook
      const runbook = createBuildFailureRunbook({
        buildId: 'ci-build-001',
        branch: 'main',
        commit: 'abc1234',
        failureCategory: 'unknown',
        environment: 'ci',
      }, tmp);

      // Mock retry-build to succeed
      const retryStep = runbook.steps.find((s) => s.id === 'retry-build')!;
      retryStep.execute = jest.fn().mockResolvedValue({ success: true, detail: 'build ok' });

      const result = await engine.execute(runbook, {
        environment: 'ci',
        triggeredBy: 'dr-automation',
        buildId: 'ci-build-001',
      });

      // 4. Resolve based on result
      if (result.success) {
        stateManager.transition('resolved', { trigger: 'runbook-completed' });
      } else {
        stateManager.transition('failed', { trigger: 'runbook-failed', errorMessage: result.error });
      }

      expect(stateManager.getPhase()).toBe('resolved');
      expect(result.success).toBe(true);
      expect(result.rtoCompliant).toBe(true);
    });

    it('transitions to failed when runbook cannot recover', async () => {
      stateManager.transition('detecting', { trigger: 'build-failure' });
      stateManager.transition('recovering');

      const runbook = makeSuccessRunbook('test');
      runbook.steps[0].execute = jest.fn().mockResolvedValue({ success: false });

      const result = await engine.execute(runbook, { environment: 'ci', triggeredBy: 'test' });

      stateManager.transition('failed', { errorMessage: result.error });
      expect(stateManager.getPhase()).toBe('failed');
      expect(result.success).toBe(false);
    });

    it('allows retry after failure (detecting → recovering again)', async () => {
      stateManager.transition('detecting');
      stateManager.transition('recovering');
      stateManager.transition('failed');

      // Retry
      stateManager.transition('detecting', { trigger: 'retry-attempt' });
      stateManager.transition('recovering');

      expect(stateManager.getState().attempt).toBe(2);
      expect(stateManager.getPhase()).toBe('recovering');
    });
  });

  // ── Scenario 2: Database Restore ──────────────────────────────────────────

  describe('Scenario 2: Database restore with state tracking', () => {
    it('executes database restore runbook and resolves state', async () => {
      const stateChanges: string[] = [];
      stateManager.onStateChange((s) => stateChanges.push(s.phase));

      stateManager.transition('detecting', { trigger: 'db-corruption-detected' });
      stateManager.transition('recovering', { activeRunbook: 'database-restore' });

      const runbook = createDatabaseRestoreRunbook({
        databaseId: 'subtrackr-primary',
        backupId: 'backup-20240826',
        targetEnvironment: 'production',
        verifyAfterRestore: true,
      });

      const result = await engine.execute(runbook, {
        environment: 'production',
        triggeredBy: 'dr-automation',
      });

      stateManager.transition(result.success ? 'resolved' : 'failed');

      expect(result.success).toBe(true);
      expect(stateChanges).toContain('detecting');
      expect(stateChanges).toContain('recovering');
      expect(stateChanges).toContain('resolved');
    });

    it('all steps are executed in order', async () => {
      const runbook = createDatabaseRestoreRunbook({
        databaseId: 'test-db',
        backupId: 'backup-001',
        targetEnvironment: 'staging',
        verifyAfterRestore: true,
      });

      const result = await engine.execute(runbook, {
        environment: 'staging',
        triggeredBy: 'test',
      });

      const stepOrder = result.steps.map((s) => s.stepId);
      expect(stepOrder.indexOf('validate-config')).toBeLessThan(stepOrder.indexOf('restore-database'));
      expect(stepOrder.indexOf('restore-database')).toBeLessThan(stepOrder.indexOf('verify-restore'));
    });
  });

  // ── Scenario 3: Rollback on Bad Deployment ────────────────────────────────

  describe('Scenario 3: Rollback triggered by deployment failure', () => {
    it('executes rollback runbook and updates state', async () => {
      const deployment: DeploymentInfo = {
        deploymentId: 'deploy-v2-001',
        version: '2.1.0',
        previousVersion: '2.0.0',
        environment: 'production',
        deployedAt: Date.now() - 300_000,
        services: ['api', 'worker'],
      };

      stateManager.transition('detecting', { trigger: 'deployment-health-check-failed' });
      stateManager.transition('recovering', {
        activeRunbook: 'rollback',
        trigger: 'auto-rollback',
      });

      const runbook = createRollbackRunbook(deployment, tmp);
      const result = await engine.execute(runbook, {
        environment: 'production',
        triggeredBy: 'deployment-watchdog',
      });

      expect(result.success).toBe(true);
      expect(result.steps.find((s) => s.stepId === 'execute-rollback')?.status).toBe('succeeded');

      stateManager.transition('resolved', { trigger: 'rollback-completed' });
      expect(stateManager.getPhase()).toBe('resolved');
    });

    it('captures history of the full DR lifecycle', async () => {
      stateManager.transition('detecting');
      stateManager.transition('recovering');
      stateManager.transition('resolved');
      stateManager.transition('idle' as any); // reset

      const history = stateManager.getHistory();
      expect(history.length).toBeGreaterThanOrEqual(4);

      const phases = history.map((h) => h.to);
      expect(phases).toContain('detecting');
      expect(phases).toContain('recovering');
      expect(phases).toContain('resolved');
    });
  });

  // ── Scenario 4: Health Check → Automated DR Trigger ───────────────────────

  describe('Scenario 4: Health check driving DR flow', () => {
    it('health check failure drives state to detecting', async () => {
      const healthMgr = new HealthCheckManager({ projectRoot: tmp });
      const summary = await healthMgr.runAll();

      if (!summary.allHealthy) {
        stateManager.transition('detecting', {
          trigger: `health-check:${summary.overall}`,
        });
        expect(stateManager.isActive()).toBe(true);
      } else {
        // System is healthy – stays idle
        expect(stateManager.getPhase()).toBe('idle');
      }
    });

    it('health check summary correctly aggregates check statuses', async () => {
      const healthMgr = new HealthCheckManager({ projectRoot: tmp });
      const summary = await healthMgr.runAll();
      expect(summary.checks.length).toBeGreaterThan(0);
      expect(['healthy', 'degraded', 'critical']).toContain(summary.overall);
      expect(typeof summary.allHealthy).toBe('boolean');
    });
  });

  // ── Scenario 5: Manual Intervention Escape Hatch ──────────────────────────

  describe('Scenario 5: Manual intervention state', () => {
    it('can transition to manual-intervention from detecting', () => {
      stateManager.transition('detecting', { trigger: 'automated-failure' });
      stateManager.transition('manual-intervention', { trigger: 'escalated-to-oncall' });
      expect(stateManager.getPhase()).toBe('manual-intervention');
    });

    it('can recover from manual-intervention to recovering', () => {
      stateManager.transition('detecting');
      stateManager.transition('manual-intervention');
      stateManager.transition('recovering');
      expect(stateManager.getPhase()).toBe('recovering');
    });

    it('can reset from manual-intervention', () => {
      stateManager.transition('detecting');
      stateManager.transition('manual-intervention');
      stateManager.reset('incident-resolved');
      expect(stateManager.getPhase()).toBe('idle');
    });
  });

  // ── Scenario 6: Multiple Concurrent Runbooks via State Tracking ───────────

  describe('Scenario 6: Sequential runbook executions tracked in state', () => {
    it('tracks multiple recovery attempts in history', async () => {
      // First attempt fails
      stateManager.transition('detecting', { trigger: 'alert-1' });
      stateManager.transition('recovering', { activeRunbook: 'build-failure' });

      const runbook1 = makeSuccessRunbook('test-1');
      runbook1.steps[0].execute = jest.fn().mockResolvedValue({ success: false });
      await engine.execute(runbook1);

      stateManager.transition('failed');
      expect(stateManager.getState().attempt).toBe(1);

      // Second attempt succeeds
      stateManager.transition('detecting', { trigger: 'retry' });
      stateManager.transition('recovering', { activeRunbook: 'build-failure-v2' });

      const runbook2 = makeSuccessRunbook('test-2');
      const result2 = await engine.execute(runbook2);

      stateManager.transition('resolved');

      expect(result2.success).toBe(true);
      expect(stateManager.getState().attempt).toBe(2);
      expect(stateManager.getHistory().length).toBeGreaterThanOrEqual(6);
    });
  });

  // ── Scenario 7: RTO/RPO Compliance Validation ─────────────────────────────

  describe('Scenario 7: RTO compliance', () => {
    it('runbook execution completes within its RTO', async () => {
      const runbook = createRollbackRunbook({
        deploymentId: 'test',
        version: '2.0.0',
        previousVersion: '1.9.0',
        environment: 'staging',
        deployedAt: Date.now(),
      }, tmp);

      const start = Date.now();
      const result = await engine.execute(runbook, {
        environment: 'staging',
        triggeredBy: 'test',
      });
      const elapsed = Date.now() - start;

      expect(result.success).toBe(true);
      expect(elapsed).toBeLessThan(runbook.rtoSeconds * 1000);
      expect(result.rtoCompliant).toBe(true);
    });

    it('build failure runbook has 10 minute RTO', () => {
      const runbook = createBuildFailureRunbook({
        buildId: 'test',
        branch: 'main',
        commit: 'abc',
        failureCategory: 'unknown',
      }, tmp);
      expect(runbook.rtoSeconds).toBe(600);
    });

    it('database restore runbook has 15 minute RTO', () => {
      const runbook = createDatabaseRestoreRunbook({
        databaseId: 'test-db',
        backupId: 'backup-001',
        targetEnvironment: 'production',
        verifyAfterRestore: true,
      });
      expect(runbook.rtoSeconds).toBe(900);
    });

    it('rollback runbook has 10 minute RTO', () => {
      const runbook = createRollbackRunbook({
        deploymentId: 'test',
        version: '2.0.0',
        previousVersion: '1.9.0',
        environment: 'production',
        deployedAt: Date.now(),
      }, tmp);
      expect(runbook.rtoSeconds).toBe(600);
    });
  });
});
