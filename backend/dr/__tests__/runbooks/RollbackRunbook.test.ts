import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { createRollbackRunbook } from '../../runbooks/RollbackRunbook';
import { RunbookEngine } from '../../RunbookEngine';
import { DeploymentInfo, RunbookContext } from '../../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeployment(overrides: Partial<DeploymentInfo> = {}): DeploymentInfo {
  return {
    deploymentId: 'deploy-001',
    version: '2.0.0',
    previousVersion: '1.9.0',
    environment: 'production',
    deployedAt: Date.now() - 60_000,
    services: ['api', 'worker'],
    ...overrides,
  };
}

function makeCtx(stateOverrides: Record<string, unknown> = {}): RunbookContext {
  return {
    executionId: 'test-exec',
    environment: 'production',
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

describe('createRollbackRunbook', () => {
  let engine: RunbookEngine;
  let tmp: string;

  beforeEach(() => {
    engine = new RunbookEngine({ defaultRetryDelayMs: 0 });
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-rollback-test-'));
    // Mock git
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'test', version: '2.0.0' }));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('creates a runbook definition', () => {
    const runbook = createRollbackRunbook(makeDeployment(), tmp);
    expect(runbook.id).toBe('rollback');
    expect(runbook.rtoSeconds).toBe(600);
    expect(runbook.steps.length).toBeGreaterThan(0);
  });

  it('has expected step IDs', () => {
    const runbook = createRollbackRunbook(makeDeployment(), tmp);
    const ids = runbook.steps.map((s) => s.id);
    expect(ids).toContain('validate-rollback-target');
    expect(ids).toContain('notify-rollback-start');
    expect(ids).toContain('execute-rollback');
    expect(ids).toContain('verify-post-rollback');
    expect(ids).toContain('archive-artefacts');
  });

  // ── validate-rollback-target ──────────────────────────────────────────────

  describe('validate-rollback-target step', () => {
    it('passes with valid deployment info', async () => {
      const runbook = createRollbackRunbook(makeDeployment(), tmp);
      const validateStep = runbook.steps.find((s) => s.id === 'validate-rollback-target')!;
      const ctx = makeCtx();
      const result = await validateStep.execute(ctx);
      expect(result.success).toBe(true);
      expect(ctx.state['rollbackTarget']).toBe('1.9.0');
      expect(ctx.state['rollbackSource']).toBe('2.0.0');
    });

    it('fails when deploymentId is missing', async () => {
      const runbook = createRollbackRunbook(makeDeployment({ deploymentId: '' }), tmp);
      const validateStep = runbook.steps.find((s) => s.id === 'validate-rollback-target')!;
      const result = await validateStep.execute(makeCtx());
      expect(result.success).toBe(false);
    });

    it('fails when current and previous versions are the same', async () => {
      const runbook = createRollbackRunbook(makeDeployment({ version: '1.0.0', previousVersion: '1.0.0' }), tmp);
      const validateStep = runbook.steps.find((s) => s.id === 'validate-rollback-target')!;
      const result = await validateStep.execute(makeCtx());
      expect(result.success).toBe(false);
      expect(result.detail).toMatch(/same/i);
    });

    it('fails when previousVersion is missing', async () => {
      const runbook = createRollbackRunbook(makeDeployment({ previousVersion: '' }), tmp);
      const validateStep = runbook.steps.find((s) => s.id === 'validate-rollback-target')!;
      const result = await validateStep.execute(makeCtx());
      expect(result.success).toBe(false);
    });

    it('stores projectRoot in context state', async () => {
      const runbook = createRollbackRunbook(makeDeployment(), tmp);
      const validateStep = runbook.steps.find((s) => s.id === 'validate-rollback-target')!;
      const ctx = makeCtx();
      await validateStep.execute(ctx);
      expect(ctx.state['projectRoot']).toBe(tmp);
    });
  });

  // ── notify-rollback-start ─────────────────────────────────────────────────

  describe('notify-rollback-start step', () => {
    it('always succeeds (optional notification)', async () => {
      const runbook = createRollbackRunbook(makeDeployment(), tmp);
      const notifyStep = runbook.steps.find((s) => s.id === 'notify-rollback-start')!;
      const result = await notifyStep.execute(makeCtx());
      expect(result.success).toBe(true);
      expect(result.output?.notified).toBe(true);
    });

    it('is marked optional', () => {
      const runbook = createRollbackRunbook(makeDeployment(), tmp);
      const notifyStep = runbook.steps.find((s) => s.id === 'notify-rollback-start')!;
      expect(notifyStep.optional).toBe(true);
    });
  });

  // ── execute-rollback ──────────────────────────────────────────────────────

  describe('execute-rollback step', () => {
    it('succeeds and records rollback method', async () => {
      const runbook = createRollbackRunbook(makeDeployment(), tmp);
      const executeStep = runbook.steps.find((s) => s.id === 'execute-rollback')!;
      const ctx = makeCtx({
        rollbackTarget: '1.9.0',
        rollbackSource: '2.0.0',
        projectRoot: tmp,
      });
      const result = await executeStep.execute(ctx);
      expect(result.success).toBe(true);
      expect(ctx.state['rollbackMethod']).toBeDefined();
    });

    it('uses contract rollback method for contract services', async () => {
      const runbook = createRollbackRunbook(makeDeployment({ services: ['contract-subscription'] }), tmp);
      const executeStep = runbook.steps.find((s) => s.id === 'execute-rollback')!;
      const ctx = makeCtx({
        rollbackTarget: '1.9.0',
        rollbackSource: '2.0.0',
        projectRoot: tmp,
      });
      const result = await executeStep.execute(ctx);
      expect(result.success).toBe(true);
      expect(ctx.state['rollbackMethod']).toBe('contract-scheduled');
    });

    it('rollback of execute-rollback logs warning', async () => {
      const runbook = createRollbackRunbook(makeDeployment(), tmp);
      const executeStep = runbook.steps.find((s) => s.id === 'execute-rollback')!;
      const ctx = makeCtx({ rollbackTarget: '1.9.0' });
      await expect(executeStep.rollback!(ctx)).resolves.toBeUndefined();
      expect(ctx.log).toHaveBeenCalledWith(
        'warn',
        expect.stringContaining('Rollback execution failed'),
      );
    });
  });

  // ── verify-post-rollback ──────────────────────────────────────────────────

  describe('verify-post-rollback step', () => {
    it('succeeds and marks postRollbackHealthy', async () => {
      const runbook = createRollbackRunbook(makeDeployment(), tmp);
      const verifyStep = runbook.steps.find((s) => s.id === 'verify-post-rollback')!;
      const ctx = makeCtx();
      const result = await verifyStep.execute(ctx);
      expect(result.success).toBe(true);
      expect(ctx.state['postRollbackHealthy']).toBe(true);
    });

    it('has dependsOn execute-rollback', () => {
      const runbook = createRollbackRunbook(makeDeployment(), tmp);
      const verifyStep = runbook.steps.find((s) => s.id === 'verify-post-rollback')!;
      expect(verifyStep.dependsOn).toContain('execute-rollback');
    });
  });

  // ── archive-artefacts ─────────────────────────────────────────────────────

  describe('archive-artefacts step', () => {
    it('archives rollback info', async () => {
      const runbook = createRollbackRunbook(makeDeployment(), tmp);
      const archiveStep = runbook.steps.find((s) => s.id === 'archive-artefacts')!;
      const ctx = makeCtx({ rollbackMethod: 'ci-trigger', postRollbackHealthy: true });
      const result = await archiveStep.execute(ctx);
      expect(result.success).toBe(true);
      expect(result.output?.artefact).toHaveProperty('deploymentId', 'deploy-001');
    });

    it('is optional and depends on verify-post-rollback', () => {
      const runbook = createRollbackRunbook(makeDeployment(), tmp);
      const archiveStep = runbook.steps.find((s) => s.id === 'archive-artefacts')!;
      expect(archiveStep.optional).toBe(true);
      expect(archiveStep.dependsOn).toContain('verify-post-rollback');
    });
  });

  // ── onFailure ─────────────────────────────────────────────────────────────

  it('has onFailure handler', () => {
    const runbook = createRollbackRunbook(makeDeployment(), tmp);
    expect(typeof runbook.onFailure).toBe('function');
  });

  // ── Full execution ────────────────────────────────────────────────────────

  it('full execution succeeds for valid deployment', async () => {
    const runbook = createRollbackRunbook(makeDeployment(), tmp);
    const result = await engine.execute(runbook, { environment: 'production', triggeredBy: 'test' });
    expect(result.success).toBe(true);
    expect(result.rtoCompliant).toBe(true);
  });

  it('full execution fails for invalid deployment (same version)', async () => {
    const runbook = createRollbackRunbook(makeDeployment({ version: '1.0.0', previousVersion: '1.0.0' }), tmp);
    const result = await engine.execute(runbook, { environment: 'production', triggeredBy: 'test' });
    expect(result.success).toBe(false);
    const validateResult = result.steps.find((s) => s.stepId === 'validate-rollback-target');
    expect(validateResult?.status).toBe('failed');
  });

  it('execution description mentions versions', () => {
    const runbook = createRollbackRunbook(makeDeployment(), tmp);
    expect(runbook.description).toContain('2.0.0');
    expect(runbook.description).toContain('1.9.0');
  });
});
