/**
 * RPC Timeout & Circuit Breaker Performance Benchmarks — Issue #941
 *
 * Measures:
 *   1. Overhead of withRpcTimeout vs raw Promise.resolve
 *   2. Overhead of wrapWithTimeout vs raw Promise.race
 *   3. AbortController setup/teardown cost
 *   4. Circuit-breaker fast-path (closed circuit) overhead
 *   5. Throughput: concurrent resilient calls
 *
 * Run with:
 *   npx ts-node backend/benchmark/rpcBenchmark.ts
 *
 * Or via Jest for automated budget gating:
 *   npx jest --testPathPattern=rpcBenchmark --testNamePattern=benchmark
 */

import {
  withRpcTimeout,
  wrapWithTimeout,
  defaultTimeoutForChain,
} from '../services/shared/rpcTimeout';
import {
  RpcCircuitBreakerService,
  type RpcProviderConfig,
} from '../services/rpcCircuitBreaker';

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

interface BenchResult {
  name: string;
  iterations: number;
  totalMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  opsPerSec: number;
}

async function bench(
  name: string,
  fn: () => Promise<unknown>,
  iterations = 1_000,
): Promise<BenchResult> {
  // Warm-up: 50 iterations not counted
  for (let i = 0; i < 50; i++) await fn().catch(() => null);

  const times: number[] = [];
  const start = Date.now();

  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    await fn().catch(() => null);
    times.push(performance.now() - t0);
  }

  const totalMs = Date.now() - start;
  times.sort((a, b) => a - b);
  const avgMs = times.reduce((s, t) => s + t, 0) / times.length;
  const p50Ms = times[Math.floor(times.length * 0.5)];
  const p95Ms = times[Math.floor(times.length * 0.95)];
  const p99Ms = times[Math.floor(times.length * 0.99)];
  const opsPerSec = Math.round((iterations / totalMs) * 1_000);

  return { name, iterations, totalMs, avgMs, p50Ms, p95Ms, p99Ms, opsPerSec };
}

function makeProvider(id: string, priority = 0): RpcProviderConfig {
  return { id, label: id, url: `https://${id}.example.com`, priority };
}

function printResult(r: BenchResult): void {
  console.log(
    `${r.name.padEnd(50)} ` +
    `avg=${r.avgMs.toFixed(3)} ms  ` +
    `p50=${r.p50Ms.toFixed(3)} ms  ` +
    `p95=${r.p95Ms.toFixed(3)} ms  ` +
    `p99=${r.p99Ms.toFixed(3)} ms  ` +
    `ops/s=${r.opsPerSec}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Benchmark suite
// ─────────────────────────────────────────────────────────────────────────────

/** Budget thresholds (ms). Fail if any benchmark exceeds these. */
const BUDGET = {
  timeoutOverheadAvgMs: 1.0,  // withRpcTimeout overhead over raw Promise should be < 1 ms avg
  circuitClosedAvgMs: 1.0,    // closed-circuit call overhead < 1 ms
  p95Ms: 2.0,                 // p95 latency < 2 ms for in-process operations
};

async function runAll(): Promise<BenchResult[]> {
  const results: BenchResult[] = [];

  // ── 1. Raw Promise.resolve baseline ────────────────────────────────────────
  results.push(await bench(
    '1. Raw Promise.resolve (baseline)',
    async () => Promise.resolve('value'),
    2_000,
  ));

  // ── 2. withRpcTimeout overhead ─────────────────────────────────────────────
  results.push(await bench(
    '2. withRpcTimeout (no jitter, instant resolve)',
    () => withRpcTimeout(async () => 'value', { timeoutMs: 5_000 }),
    2_000,
  ));

  // ── 3. wrapWithTimeout overhead ────────────────────────────────────────────
  results.push(await bench(
    '3. wrapWithTimeout (no jitter, instant resolve)',
    () => wrapWithTimeout(Promise.resolve('value'), { timeoutMs: 5_000 }),
    2_000,
  ));

  // ── 4. withRpcTimeout with jitter ──────────────────────────────────────────
  results.push(await bench(
    '4. withRpcTimeout (jitterMs=100, instant resolve)',
    () => withRpcTimeout(async () => 'value', { timeoutMs: 5_000, jitterMs: 100 }),
    1_000,
  ));

  // ── 5. AbortController alloc + teardown ────────────────────────────────────
  results.push(await bench(
    '5. AbortController alloc+abort+cleanup (raw)',
    async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5_000);
      clearTimeout(timer);
      return ctrl.signal.aborted;
    },
    5_000,
  ));

  // ── 6. RpcCircuitBreakerService — closed-circuit fast path ─────────────────
  const svc = new RpcCircuitBreakerService([makeProvider('p1')], {
    defaultTimeoutMs: 5_000,
    failureThreshold: 100,
  });
  results.push(await bench(
    '6. RpcCircuitBreakerService.call (closed circuit, instant fn)',
    () => svc.call(async () => 'ok'),
    2_000,
  ));

  // ── 7. RpcCircuitBreakerService — two providers, primary succeeds ───────────
  const svc2 = new RpcCircuitBreakerService(
    [makeProvider('primary', 0), makeProvider('fallback', 1)],
    { defaultTimeoutMs: 5_000, failureThreshold: 100 },
  );
  results.push(await bench(
    '7. RpcCircuitBreakerService.call (2 providers, primary succeeds)',
    () => svc2.call(async () => 'primary-ok'),
    2_000,
  ));

  // ── 8. Concurrent withRpcTimeout (25 concurrent) ───────────────────────────
  results.push(await bench(
    '8. 25 concurrent withRpcTimeout calls (throughput)',
    async () => {
      await Promise.all(
        Array.from({ length: 25 }, () =>
          withRpcTimeout(async () => 'concurrent', { timeoutMs: 5_000 }),
        ),
      );
    },
    200,
  ));

  // ── 9. defaultTimeoutForChain (pure computation) ───────────────────────────
  results.push(await bench(
    '9. defaultTimeoutForChain (5 chain IDs, pure computation)',
    async () => {
      for (const id of [1, 137, 42161, 10, 8453]) defaultTimeoutForChain(id);
    },
    10_000,
  ));

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Jest-based benchmark tests (automated budget gating)
// ─────────────────────────────────────────────────────────────────────────────

describe('RPC performance benchmarks — Issue #941', () => {
  let results: BenchResult[];

  beforeAll(async () => {
    results = await runAll();
  }, 60_000);

  afterAll(() => {
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  RPC Resilience Performance Results');
    console.log('═══════════════════════════════════════════════════════════════');
    for (const r of results) printResult(r);
    console.log('═══════════════════════════════════════════════════════════════\n');
  });

  it('withRpcTimeout overhead vs baseline is within budget (avg < 1 ms)', () => {
    const baseline = results.find((r) => r.name.includes('baseline'))!;
    const withTimeout = results.find((r) => r.name.includes('withRpcTimeout (no'))!;
    const overhead = withTimeout.avgMs - baseline.avgMs;
    console.log(`  withRpcTimeout overhead: +${overhead.toFixed(3)} ms`);
    expect(overhead).toBeLessThan(BUDGET.timeoutOverheadAvgMs);
  });

  it('wrapWithTimeout overhead vs baseline is within budget (avg < 1 ms)', () => {
    const baseline = results.find((r) => r.name.includes('baseline'))!;
    const wrapped = results.find((r) => r.name.includes('wrapWithTimeout'))!;
    const overhead = wrapped.avgMs - baseline.avgMs;
    console.log(`  wrapWithTimeout overhead: +${overhead.toFixed(3)} ms`);
    expect(overhead).toBeLessThan(BUDGET.timeoutOverheadAvgMs);
  });

  it('RpcCircuitBreakerService closed-circuit call overhead < 1 ms avg', () => {
    const r = results.find((r) => r.name.includes('closed circuit'))!;
    console.log(`  Circuit breaker closed-path avg: ${r.avgMs.toFixed(3)} ms`);
    expect(r.avgMs).toBeLessThan(BUDGET.circuitClosedAvgMs);
  });

  it('p95 latency for all in-process operations is < 2 ms', () => {
    const inProcess = results.filter((r) =>
      r.name.match(/baseline|withRpcTimeout|wrapWithTimeout|AbortController|closed circuit/)
    );
    for (const r of inProcess) {
      console.log(`  p95 ${r.name}: ${r.p95Ms.toFixed(3)} ms`);
      expect(r.p95Ms).toBeLessThan(BUDGET.p95Ms);
    }
  });

  it('defaultTimeoutForChain: > 100_000 ops/s (pure computation, no alloc)', () => {
    const r = results.find((r) => r.name.includes('defaultTimeoutForChain'))!;
    console.log(`  defaultTimeoutForChain throughput: ${r.opsPerSec} ops/s`);
    expect(r.opsPerSec).toBeGreaterThan(100_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CLI runner (npx ts-node backend/benchmark/rpcBenchmark.ts)
// ─────────────────────────────────────────────────────────────────────────────

if (require.main === module) {
  (async () => {
    console.log('Running RPC resilience benchmarks…\n');
    const results = await runAll();
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  RPC Resilience Performance Results');
    console.log('═══════════════════════════════════════════════════════════════');
    for (const r of results) printResult(r);
    console.log('═══════════════════════════════════════════════════════════════');
  })();
}
