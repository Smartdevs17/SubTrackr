/**
 * Performance benchmarks for the DR system.
 * Run: npx jest --config jest.backend.config.js "backend/dr/benchmarks" --no-coverage --verbose
 *
 * Measures:
 *  - HealthCheckManager throughput
 *  - DrStateManager transition latency
 *  - RunbookEngine execution overhead
 *  - Full runbook execution times (db-restore, rollback)
 */

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { HealthCheckManager } from '../HealthCheckManager';
import { DrStateManager } from '../DrStateManager';
import { RunbookEngine } from '../RunbookEngine';
import { createDatabaseRestoreRunbook } from '../runbooks/DatabaseRestoreRunbook';
import { createRollbackRunbook } from '../runbooks/RollbackRunbook';
import { RunbookDefinition } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface BenchResult {
  name: string;
  iterations: number;
  avgMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
}

async function bench(name: string, iterations: number, fn: () => Promise<unknown>): Promise<BenchResult> {
  const samples: number[] = [];
  // warm-up
  for (let i = 0; i < Math.min(2, iterations); i++) await fn();
  // measure
  for (let i = 0; i < iterations; i++) {
    const start = Date.now();
    await fn();
    samples.push(Date.now() - start);
  }
  samples.sort((a, b) => a - b);
  const avgMs = samples.reduce((s, v) => s + v, 0) / samples.length;
  const p95Ms = samples[Math.floor(samples.length * 0.95)] ?? samples[samples.length - 1];
  return { name, iterations, avgMs, minMs: samples[0], maxMs: samples[samples.length - 1], p95Ms };
}

function makeTempProject(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-bench-'));
  fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'bench', version: '1.0.0', scripts: {} }));
  fs.writeFileSync(path.join(tmp, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2017' } }));
  fs.mkdirSync(path.join(tmp, 'node_modules'));
  fs.mkdirSync(path.join(tmp, 'node_modules', 'pkg-a'));
  return tmp;
}

function makeNoopRunbook(id: string, stepCount: number): RunbookDefinition {
  return {
    id,
    name: `Noop ${stepCount}`,
    description: 'benchmark',
    rtoSeconds: 60,
    steps: Array.from({ length: stepCount }, (_, i) => ({
      id: `s${i}`,
      name: `Step ${i}`,
      execute: jest.fn().mockResolvedValue({ success: true }),
    })),
  };
}

// ---------------------------------------------------------------------------
// Performance budget thresholds
// ---------------------------------------------------------------------------
const BUDGETS = {
  healthCheckRunAll: 10_000,         // 10s max for full health check suite
  healthCheckBuildCategory: 3_000,   // 3s for build-category checks
  stateMachineLifecycle: 5,          // 5ms per full lifecycle
  runbookNoop1Step: 20,              // 20ms for 1 no-op step
  runbookNoop5Steps: 30,             // 30ms for 5 no-op steps
  databaseRestoreRunbook: 1_000,     // 1s for database restore runbook
  rollbackRunbook: 1_000,            // 1s for rollback runbook
};

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

describe('DR System — Performance Benchmarks', () => {
  let tmp: string;

  beforeAll(() => {
    tmp = makeTempProject();
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  // ── HealthCheckManager ──────────────────────────────────────────────────

  describe('HealthCheckManager', () => {
    it(`runAll() completes within ${BUDGETS.healthCheckRunAll}ms (avg)`, async () => {
      const mgr = new HealthCheckManager({ projectRoot: tmp });
      const result = await bench('runAll', 5, () => mgr.runAll());
      console.log(`  HealthCheckManager.runAll(): avg=${result.avgMs.toFixed(1)}ms p95=${result.p95Ms.toFixed(1)}ms`);
      expect(result.avgMs).toBeLessThan(BUDGETS.healthCheckRunAll);
    }, 120_000);

    it(`runCategory('build') completes within ${BUDGETS.healthCheckBuildCategory}ms (avg)`, async () => {
      const mgr = new HealthCheckManager({ projectRoot: tmp });
      const result = await bench('runCategory(build)', 10, () => mgr.runCategory('build'));
      console.log(`  HealthCheckManager.runCategory(build): avg=${result.avgMs.toFixed(1)}ms p95=${result.p95Ms.toFixed(1)}ms`);
      expect(result.avgMs).toBeLessThan(BUDGETS.healthCheckBuildCategory);
    }, 60_000);
  });

  // ── DrStateManager ──────────────────────────────────────────────────────

  describe('DrStateManager', () => {
    it(`full lifecycle (idle→detecting→recovering→resolved→idle) < ${BUDGETS.stateMachineLifecycle}ms (avg)`, async () => {
      const result = await bench('state lifecycle', 1000, async () => {
        const sm = new DrStateManager();
        sm.transition('detecting');
        sm.transition('recovering');
        sm.transition('resolved');
        sm.reset();
      });
      console.log(`  DrStateManager lifecycle: avg=${result.avgMs.toFixed(3)}ms p95=${result.p95Ms.toFixed(3)}ms`);
      expect(result.avgMs).toBeLessThan(BUDGETS.stateMachineLifecycle);
    }, 30_000);

    it('getState() snapshot is < 1ms per call', async () => {
      const sm = new DrStateManager();
      const result = await bench('getState', 10000, async () => { sm.getState(); });
      console.log(`  DrStateManager.getState(): avg=${result.avgMs.toFixed(4)}ms`);
      expect(result.avgMs).toBeLessThan(1);
    }, 30_000);
  });

  // ── RunbookEngine ───────────────────────────────────────────────────────

  describe('RunbookEngine', () => {
    const engine = new RunbookEngine({ defaultRetryDelayMs: 0 });

    it(`executes 1-step noop runbook in < ${BUDGETS.runbookNoop1Step}ms (avg)`, async () => {
      const runbook = makeNoopRunbook('noop-1', 1);
      const result = await bench('noop-1', 100, () => engine.execute(runbook));
      console.log(`  RunbookEngine 1-step: avg=${result.avgMs.toFixed(3)}ms p95=${result.p95Ms.toFixed(3)}ms`);
      expect(result.avgMs).toBeLessThan(BUDGETS.runbookNoop1Step);
    }, 30_000);

    it(`executes 5-step noop runbook in < ${BUDGETS.runbookNoop5Steps}ms (avg)`, async () => {
      const runbook = makeNoopRunbook('noop-5', 5);
      const result = await bench('noop-5', 100, () => engine.execute(runbook));
      console.log(`  RunbookEngine 5-step: avg=${result.avgMs.toFixed(3)}ms p95=${result.p95Ms.toFixed(3)}ms`);
      expect(result.avgMs).toBeLessThan(BUDGETS.runbookNoop5Steps);
    }, 30_000);
  });

  // ── Runbooks ─────────────────────────────────────────────────────────────

  describe('Runbook execution', () => {
    const engine = new RunbookEngine({ defaultRetryDelayMs: 0 });

    it(`DatabaseRestoreRunbook executes in < ${BUDGETS.databaseRestoreRunbook}ms (avg)`, async () => {
      const runbook = createDatabaseRestoreRunbook({
        databaseId: 'bench-db',
        backupId: 'bench-backup',
        targetEnvironment: 'bench',
        verifyAfterRestore: true,
      });
      const result = await bench('db-restore', 20, () =>
        engine.execute(runbook, { environment: 'bench', triggeredBy: 'benchmark' })
      );
      console.log(`  DatabaseRestoreRunbook: avg=${result.avgMs.toFixed(1)}ms p95=${result.p95Ms.toFixed(1)}ms`);
      expect(result.avgMs).toBeLessThan(BUDGETS.databaseRestoreRunbook);
    }, 60_000);

    it(`RollbackRunbook executes in < ${BUDGETS.rollbackRunbook}ms (avg)`, async () => {
      const runbook = createRollbackRunbook({
        deploymentId: 'bench-deploy',
        version: '2.0.0',
        previousVersion: '1.9.0',
        environment: 'bench',
        deployedAt: Date.now(),
        services: ['api'],
      }, tmp);
      const result = await bench('rollback', 20, () =>
        engine.execute(runbook, { environment: 'bench', triggeredBy: 'benchmark' })
      );
      console.log(`  RollbackRunbook: avg=${result.avgMs.toFixed(1)}ms p95=${result.p95Ms.toFixed(1)}ms`);
      expect(result.avgMs).toBeLessThan(BUDGETS.rollbackRunbook);
    }, 60_000);
  });

  // ── Summary ──────────────────────────────────────────────────────────────

  it('all DR modules import without errors', () => {
    const { healthCheckManager, drStateManager, runbookEngine } = require('../index');
    expect(healthCheckManager).toBeDefined();
    expect(drStateManager).toBeDefined();
    expect(runbookEngine).toBeDefined();
  });
});
