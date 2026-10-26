/**
 * Performance benchmarks for the DR system.
 *
 * Measures:
 *  - HealthCheckManager.runAll() throughput
 *  - DrStateManager transition latency
 *  - RunbookEngine step execution overhead
 *  - Full runbook execution time (build-failure, db-restore, rollback)
 *
 * Run: node -r ts-node/register backend/dr/benchmarks/dr.benchmark.ts
 * Or:  npx ts-node backend/dr/benchmarks/dr.benchmark.ts
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
// Benchmark helpers
// ---------------------------------------------------------------------------

interface BenchmarkResult {
  name: string;
  iterations: number;
  totalMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  p95Ms: number;
  p99Ms: number;
  opsPerSec: number;
}

async function benchmark(
  name: string,
  iterations: number,
  fn: () => Promise<void>
): Promise<BenchmarkResult> {
  const samples: number[] = [];

  // Warm up
  for (let i = 0; i < Math.min(3, Math.floor(iterations / 10)); i++) {
    await fn();
  }

  // Measured runs
  const totalStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    samples.push(performance.now() - start);
  }
  const totalMs = performance.now() - totalStart;

  samples.sort((a, b) => a - b);
  const avgMs = samples.reduce((s, v) => s + v, 0) / samples.length;
  const minMs = samples[0];
  const maxMs = samples[samples.length - 1];
  const p95Ms = samples[Math.floor(samples.length * 0.95)] ?? maxMs;
  const p99Ms = samples[Math.floor(samples.length * 0.99)] ?? maxMs;
  const opsPerSec = Math.round(1000 / avgMs);

  return { name, iterations, totalMs, avgMs, minMs, maxMs, p95Ms, p99Ms, opsPerSec };
}

function printResult(r: BenchmarkResult): void {
  console.log(`\n  ${r.name}`);
  console.log(`    iterations: ${r.iterations}`);
  console.log(`    total:      ${r.totalMs.toFixed(1)}ms`);
  console.log(`    avg:        ${r.avgMs.toFixed(3)}ms`);
  console.log(`    min:        ${r.minMs.toFixed(3)}ms`);
  console.log(`    max:        ${r.maxMs.toFixed(3)}ms`);
  console.log(`    p95:        ${r.p95Ms.toFixed(3)}ms`);
  console.log(`    p99:        ${r.p99Ms.toFixed(3)}ms`);
  console.log(`    ops/sec:    ${r.opsPerSec}`);
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
    name: `Noop Runbook (${stepCount} steps)`,
    description: 'Benchmark runbook with no-op steps',
    rtoSeconds: 60,
    steps: Array.from({ length: stepCount }, (_, i) => ({
      id: `step-${i}`,
      name: `Step ${i}`,
      execute: async () => ({ success: true, detail: `step ${i} done` }),
    })),
  };
}

// ---------------------------------------------------------------------------
// Main benchmarks
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  const tmp = makeTempProject();
  const results: BenchmarkResult[] = [];

  console.log('=== SubTrackr DR System — Performance Benchmarks ===');
  console.log(`Node: ${process.version}  Platform: ${os.platform()}  CPUs: ${os.cpus().length}`);
  console.log(`Memory: ${Math.round(os.totalmem() / 1024 / 1024)} MB total`);

  // ── HealthCheckManager.runAll ──────────────────────────────────────────

  console.log('\n─── HealthCheckManager ─────────────────────────────────────────');
  const healthMgr = new HealthCheckManager({ projectRoot: tmp });

  results.push(await benchmark('runAll()', 10, async () => {
    await healthMgr.runAll();
  }));
  printResult(results[results.length - 1]);

  results.push(await benchmark('runCategory(build)', 20, async () => {
    await healthMgr.runCategory('build');
  }));
  printResult(results[results.length - 1]);

  results.push(await benchmark('runById(build:node-version)', 50, async () => {
    await healthMgr.runById('build:node-version');
  }));
  printResult(results[results.length - 1]);

  // ── DrStateManager transitions ─────────────────────────────────────────

  console.log('\n─── DrStateManager ─────────────────────────────────────────────');

  results.push(await benchmark('full lifecycle (idle→detecting→recovering→resolved→idle)', 1000, async () => {
    const sm = new DrStateManager();
    sm.transition('detecting');
    sm.transition('recovering');
    sm.transition('resolved');
    sm.reset();
  }));
  printResult(results[results.length - 1]);

  results.push(await benchmark('getState() snapshot', 10000, async () => {
    const sm = new DrStateManager();
    sm.getState();
  }));
  printResult(results[results.length - 1]);

  // ── RunbookEngine ─────────────────────────────────────────────────────

  console.log('\n─── RunbookEngine ──────────────────────────────────────────────');
  const engine = new RunbookEngine({ defaultRetryDelayMs: 0 });

  for (const stepCount of [1, 5, 10]) {
    const runbook = makeNoopRunbook(`noop-${stepCount}`, stepCount);
    results.push(await benchmark(`execute() noop runbook (${stepCount} steps)`, 100, async () => {
      await engine.execute(runbook);
    }));
    printResult(results[results.length - 1]);
  }

  // ── Database Restore Runbook ───────────────────────────────────────────

  console.log('\n─── Runbooks ────────────────────────────────────────────────────');
  const dbRunbook = createDatabaseRestoreRunbook({
    databaseId: 'bench-db',
    backupId: 'bench-backup',
    targetEnvironment: 'bench',
    verifyAfterRestore: true,
  });

  results.push(await benchmark('DatabaseRestoreRunbook.execute()', 20, async () => {
    await engine.execute(dbRunbook, { environment: 'bench', triggeredBy: 'benchmark' });
  }));
  printResult(results[results.length - 1]);

  // ── Rollback Runbook ──────────────────────────────────────────────────

  const rollbackRunbook = createRollbackRunbook({
    deploymentId: 'bench-deploy',
    version: '2.0.0',
    previousVersion: '1.9.0',
    environment: 'bench',
    deployedAt: Date.now(),
    services: ['api'],
  }, tmp);

  results.push(await benchmark('RollbackRunbook.execute()', 20, async () => {
    await engine.execute(rollbackRunbook, { environment: 'bench', triggeredBy: 'benchmark' });
  }));
  printResult(results[results.length - 1]);

  // ── Summary ──────────────────────────────────────────────────────────

  console.log('\n═══ Performance Budget Checks ═══════════════════════════════════');

  const budgets: Record<string, number> = {
    'runAll()': 5000,                     // < 5s for all health checks
    'runCategory(build)': 2000,           // < 2s for build checks
    'full lifecycle (idle→detecting→recovering→resolved→idle)': 1,  // < 1ms per state cycle
    'execute() noop runbook (5 steps)': 50, // < 50ms for 5 no-op steps
    'DatabaseRestoreRunbook.execute()': 500, // < 500ms
    'RollbackRunbook.execute()': 500,       // < 500ms
  };

  let budgetPassed = true;
  for (const result of results) {
    const budget = budgets[result.name];
    if (budget !== undefined) {
      const passed = result.avgMs <= budget;
      const icon = passed ? '✓' : '✗';
      console.log(`  ${icon}  ${result.name}: avg ${result.avgMs.toFixed(3)}ms (budget: ${budget}ms)`);
      if (!passed) budgetPassed = false;
    }
  }

  // Cleanup
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log('\n═══════════════════════════════════════════════════════════════\n');

  if (!budgetPassed) {
    console.error('⚠  Some benchmarks exceeded their performance budget!');
    process.exit(1);
  }

  console.log('✓  All performance budgets met.');
}

run().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
