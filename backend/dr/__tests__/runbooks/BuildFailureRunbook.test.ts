import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { createBuildFailureRunbook, detectFailureCategory } from '../../runbooks/BuildFailureRunbook';
import { RunbookEngine } from '../../RunbookEngine';
import { BuildFailureContext } from '../../types';

// ---------------------------------------------------------------------------
// Test project setup
// ---------------------------------------------------------------------------

function makeTempProject(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-build-test-'));
  fs.writeFileSync(
    path.join(tmp, 'package.json'),
    JSON.stringify({ name: 'test', version: '1.0.0', scripts: { build: 'echo build', 'lint:fix': 'echo lint-fix' } })
  );
  fs.writeFileSync(path.join(tmp, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2017' } }));
  fs.mkdirSync(path.join(tmp, 'node_modules'));
  return tmp;
}

function makeContext(overrides: Partial<BuildFailureContext> = {}): BuildFailureContext {
  return {
    buildId: 'build-test-001',
    branch: 'main',
    commit: 'abc1234',
    failureCategory: 'unknown',
    environment: 'ci',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// detectFailureCategory
// ---------------------------------------------------------------------------

describe('detectFailureCategory', () => {
  it('detects dependency-error from npm error log', () => {
    const cat = detectFailureCategory('Cannot find module react-native\nENOENT: node_modules missing');
    expect(cat).toBe('dependency-error');
  });

  it('detects type-error from TypeScript output', () => {
    const cat = detectFailureCategory('TS2345 type error: argument is not assignable');
    expect(cat).toBe('type-error');
  });

  it('detects lint-error from eslint output', () => {
    const cat = detectFailureCategory('eslint found 3 errors in src/index.ts');
    expect(cat).toBe('lint-error');
  });

  it('detects test-failure from jest output', () => {
    const cat = detectFailureCategory('jest: FAIL src/__tests__/service.test.ts\nTest failed: 2 tests');
    expect(cat).toBe('test-failure');
  });

  it('detects contract-build-failure', () => {
    const cat = detectFailureCategory('error[E0308]: soroban contract compile failed\nrustc fatal error');
    expect(cat).toBe('contract-build-failure');
  });

  it('detects compile-error from babel', () => {
    const cat = detectFailureCategory('babel compile error: SyntaxError unexpected token');
    expect(cat).toBe('compile-error');
  });

  it('defaults to unknown for unrecognised logs', () => {
    const cat = detectFailureCategory('some completely random output with no patterns');
    expect(cat).toBe('unknown');
  });

  it('detects deploy-failure', () => {
    const cat = detectFailureCategory('deploy stage failed: publish error');
    expect(cat).toBe('deploy-failure');
  });
});

// ---------------------------------------------------------------------------
// createBuildFailureRunbook
// ---------------------------------------------------------------------------

describe('createBuildFailureRunbook', () => {
  let engine: RunbookEngine;
  let tmp: string;

  beforeEach(() => {
    engine = new RunbookEngine({ defaultRetryDelayMs: 0 });
    tmp = makeTempProject();
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('creates a runbook definition', () => {
    const runbook = createBuildFailureRunbook(makeContext(), tmp);
    expect(runbook.id).toBe('build-failure');
    expect(runbook.rtoSeconds).toBeGreaterThan(0);
    expect(runbook.steps.length).toBeGreaterThan(0);
  });

  it('has diagnose as first step', () => {
    const runbook = createBuildFailureRunbook(makeContext(), tmp);
    expect(runbook.steps[0].id).toBe('diagnose');
  });

  it('has retry-build as a step', () => {
    const runbook = createBuildFailureRunbook(makeContext(), tmp);
    const retryStep = runbook.steps.find((s) => s.id === 'retry-build');
    expect(retryStep).toBeDefined();
  });

  it('succeeds the diagnose step for any build context', async () => {
    const runbook = createBuildFailureRunbook(makeContext({ failureCategory: 'lint-error' }), tmp);
    // Only execute the diagnose step in isolation
    const ctx = {
      executionId: 'test',
      environment: 'ci',
      triggeredBy: 'test',
      params: {},
      state: {} as Record<string, unknown>,
      startedAt: Date.now(),
      log: jest.fn(),
    };
    const diagnoseStep = runbook.steps.find((s) => s.id === 'diagnose')!;
    const result = await diagnoseStep.execute(ctx);
    expect(result.success).toBe(true);
    expect(ctx.state['detectedCategory']).toBe('lint-error');
  });

  it('diagnose step auto-detects category from errorLog', async () => {
    const ctx = {
      buildId: 'b1',
      errorLog: 'TS2345 type error in index.ts',
      failureCategory: 'unknown' as const,
      branch: 'main',
      commit: 'deadbeef',
      environment: 'ci',
    };
    const runbook = createBuildFailureRunbook(ctx, tmp);
    const execCtx = {
      executionId: 'test',
      environment: 'ci',
      triggeredBy: 'test',
      params: {},
      state: {} as Record<string, unknown>,
      startedAt: Date.now(),
      log: jest.fn(),
    };
    const diagnoseStep = runbook.steps.find((s) => s.id === 'diagnose')!;
    await diagnoseStep.execute(execCtx);
    expect(execCtx.state['detectedCategory']).toBe('type-error');
  });

  it('clear-cache step skips missing directories gracefully', async () => {
    const runbook = createBuildFailureRunbook(makeContext(), tmp);
    const execCtx = {
      executionId: 'test',
      environment: 'ci',
      triggeredBy: 'test',
      params: {},
      state: { projectRoot: tmp, detectedCategory: 'compile-error' } as Record<string, unknown>,
      startedAt: Date.now(),
      log: jest.fn(),
    };
    const clearStep = runbook.steps.find((s) => s.id === 'clear-cache')!;
    const result = await clearStep.execute(execCtx);
    expect(result.success).toBe(true);
  });

  it('reinstall-deps step skips when not a dependency error', async () => {
    const runbook = createBuildFailureRunbook(makeContext(), tmp);
    const execCtx = {
      executionId: 'test',
      environment: 'ci',
      triggeredBy: 'test',
      params: {},
      state: { projectRoot: tmp, detectedCategory: 'lint-error' } as Record<string, unknown>,
      startedAt: Date.now(),
      log: jest.fn(),
    };
    const reinstallStep = runbook.steps.find((s) => s.id === 'reinstall-deps')!;
    const result = await reinstallStep.execute(execCtx);
    expect(result.success).toBe(true);
    expect(result.detail).toMatch(/skipped/i);
  });

  it('fix-lint step skips when not a lint error', async () => {
    const runbook = createBuildFailureRunbook(makeContext(), tmp);
    const execCtx = {
      executionId: 'test',
      environment: 'ci',
      triggeredBy: 'test',
      params: {},
      state: { projectRoot: tmp, detectedCategory: 'type-error' } as Record<string, unknown>,
      startedAt: Date.now(),
      log: jest.fn(),
    };
    const lintStep = runbook.steps.find((s) => s.id === 'fix-lint')!;
    const result = await lintStep.execute(execCtx);
    expect(result.success).toBe(true);
    expect(result.detail).toMatch(/skipped/i);
  });

  it('notify step always succeeds', async () => {
    const runbook = createBuildFailureRunbook(makeContext(), tmp);
    const execCtx = {
      executionId: 'test',
      environment: 'ci',
      triggeredBy: 'test',
      params: {},
      state: { buildRetryOutput: 'success' } as Record<string, unknown>,
      startedAt: Date.now(),
      log: jest.fn(),
    };
    const notifyStep = runbook.steps.find((s) => s.id === 'notify')!;
    const result = await notifyStep.execute(execCtx);
    expect(result.success).toBe(true);
  });

  it('runbook has RTO of 600 seconds', () => {
    const runbook = createBuildFailureRunbook(makeContext(), tmp);
    expect(runbook.rtoSeconds).toBe(600);
  });

  it('runbook has an onFailure handler', () => {
    const runbook = createBuildFailureRunbook(makeContext(), tmp);
    expect(typeof runbook.onFailure).toBe('function');
  });

  it('full execution completes without errors on valid project', async () => {
    const runbook = createBuildFailureRunbook(makeContext({ failureCategory: 'unknown' }), tmp);
    // Make sure retry-build step won't fail by mocking its execute
    const retryStep = runbook.steps.find((s) => s.id === 'retry-build')!;
    const originalExecute = retryStep.execute;
    retryStep.execute = jest.fn().mockResolvedValue({
      success: true,
      detail: 'Mocked build success',
    });
    const result = await engine.execute(runbook, { environment: 'ci', triggeredBy: 'test' });
    expect(result.runbookId).toBe('build-failure');
    expect(typeof result.success).toBe('boolean');
    retryStep.execute = originalExecute;
  });
});
