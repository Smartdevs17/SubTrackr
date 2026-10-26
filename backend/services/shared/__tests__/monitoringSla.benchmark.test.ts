/**
 * Performance benchmarks for SLA breach detection in the shared MonitoringService.
 *
 * Run:
 *   npx jest --config jest.backend.config.js backend/services/shared/__tests__/monitoringSla.benchmark.test.ts --no-coverage --verbose
 *
 * Measures:
 *  - SLA breach detection throughput over a large transaction batch
 *  - Dashboard snapshot cost with SLA data attached
 *  - Per-subscription status lookup cost at scale
 */

import { MonitoringService } from '../monitoring';
import type { TransactionEvent } from '../types';

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

function bench(name: string, iterations: number, fn: () => void): BenchResult {
  const samples: number[] = [];
  // warm-up
  for (let i = 0; i < Math.min(2, iterations); i++) fn();
  // measure
  for (let i = 0; i < iterations; i++) {
    const start = Date.now();
    fn();
    samples.push(Date.now() - start);
  }
  samples.sort((a, b) => a - b);
  const avgMs = samples.reduce((s, v) => s + v, 0) / samples.length;
  const p95Ms = samples[Math.floor(samples.length * 0.95)] ?? samples[samples.length - 1];
  return { name, iterations, avgMs, minMs: samples[0], maxMs: samples[samples.length - 1], p95Ms };
}

let _txId = 0;
function makeEvent(subscriptionId: string, status: TransactionEvent['status']): TransactionEvent {
  return {
    id: `bench-tx-${++_txId}`,
    subscriptionId,
    amount: 19.99,
    currency: 'USD',
    status,
    timestamp: Date.now(),
    gasUsed: 210_000,
  };
}

/** Build a service with `subscriptionCount` SLA targets and a pre-recorded batch. */
function buildScenario(
  subscriptionCount: number,
  eventsPerSubscription: number,
  breachedSubscriptions: number,
  uptimeTarget = 80
): MonitoringService {
  const svc = new MonitoringService([]); // no default rules — isolate SLA cost
  for (let i = 0; i < subscriptionCount; i++) {
    svc.setSlaTarget(`bench-sub-${i}`, {
      uptimeTarget,
      measurementInterval: 7 * 24 * 60 * 60,
      creditCap: 500,
    });
  }
  for (let i = 0; i < subscriptionCount; i++) {
    const breached = i < breachedSubscriptions;
    const failures = breached ? Math.floor(eventsPerSubscription * 0.8) : Math.floor(eventsPerSubscription * 0.05);
    for (let j = 0; j < eventsPerSubscription; j++) {
      svc.recordTransaction(
        makeEvent(`bench-sub-${i}`, j < failures ? 'failed' : 'success')
      );
    }
  }
  return svc;
}

// ---------------------------------------------------------------------------
// Performance budget thresholds
// ---------------------------------------------------------------------------
const BUDGETS = {
  // The ingestion benchmarks include the pre-existing per-event metrics recompute,
  // so budgets are sized to the full recordTransaction path, not just SLA math.
  batch5k: 3_000, // 3s to ingest + evaluate 5,000 transactions across 100 subscriptions
  batch20k: 20_000, // 20s for the larger 20,000-transaction stress run
  dashboardSnapshot: 500, // 500ms for a full snapshot with SLA data at scale
  perSubscriptionStatus: 10, // 10ms per status lookup
  expectedBreached: 25, // functional guard: exact breach count for the scenario
};

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

describe('SLA breach detection — performance benchmarks', () => {
  it(`ingests 5k transactions with SLA evaluation in < ${BUDGETS.batch5k}ms (avg)`, () => {
    const result = bench('batch-5k', 3, () => buildScenario(100, 50, 25));
    console.log(
      `  batch-5k: avg=${result.avgMs.toFixed(1)}ms p95=${result.p95Ms.toFixed(1)}ms ` +
        `min=${result.minMs}ms max=${result.maxMs}ms`
    );
    expect(result.avgMs).toBeLessThan(BUDGETS.batch5k);
  }, 120_000);

  it(`ingests 20k transactions with SLA evaluation in < ${BUDGETS.batch20k}ms (avg)`, () => {
    const result = bench('batch-20k', 3, () => buildScenario(200, 100, 40));
    console.log(
      `  batch-20k: avg=${result.avgMs.toFixed(1)}ms p95=${result.p95Ms.toFixed(1)}ms ` +
        `min=${result.minMs}ms max=${result.maxMs}ms`
    );
    expect(result.avgMs).toBeLessThan(BUDGETS.batch20k);
  }, 180_000);

  it(`getDashboard() with SLA data completes in < ${BUDGETS.dashboardSnapshot}ms (avg)`, () => {
    const svc = buildScenario(100, 50, 25);
    const result = bench('dashboard-snapshot', 50, () => {
      const dash = svc.getDashboard();
      // Touch the SLA fields so lazily-computed values are included in the cost.
      expect(dash.slaSummary.totalMonitored).toBe(100);
      expect(dash.slaStatuses.length).toBe(100);
      expect(dash.slaBreaches.length).toBeGreaterThan(0);
    });
    console.log(
      `  dashboard-snapshot: avg=${result.avgMs.toFixed(2)}ms p95=${result.p95Ms.toFixed(2)}ms ` +
        `min=${result.minMs}ms max=${result.maxMs}ms`
    );
    expect(result.avgMs).toBeLessThan(BUDGETS.dashboardSnapshot);
  }, 60_000);

  it(`getSlaStatus() is < ${BUDGETS.perSubscriptionStatus}ms per call at scale`, () => {
    const svc = buildScenario(100, 50, 25);
    const result = bench('status-lookup', 1000, () => {
      svc.getSlaStatus('bench-sub-0');
    });
    console.log(`  status-lookup: avg=${result.avgMs.toFixed(4)}ms`);
    expect(result.avgMs).toBeLessThan(BUDGETS.perSubscriptionStatus);
  }, 60_000);

  // ── Correctness guard baked into the benchmark ────────────────────────────

  it('detects exactly the expected breaches and credits under load', () => {
    const svc = buildScenario(100, 50, 25);
    const summary = svc.getSlaSummary();

    expect(summary.totalMonitored).toBe(100);
    // 25 subscriptions with ~80% failures stay below an 80% uptime target.
    expect(summary.breached).toBe(BUDGETS.expectedBreached);
    expect(summary.compliant).toBe(75);
    expect(summary.openBreaches).toBe(25);
    expect(summary.totalCreditsIssued).toBeGreaterThan(0);

    const breached = svc.getSlaStatus('bench-sub-0');
    const compliant = svc.getSlaStatus('bench-sub-25');
    expect(breached!.compliant).toBe(false);
    expect(compliant!.compliant).toBe(true);
  });

  it('exports the monitoring singleton and credit helper', () => {
    const { monitoringService, calculateSlaCreditAmount } = require('../monitoring');
    expect(monitoringService).toBeInstanceOf(MonitoringService);
    expect(typeof calculateSlaCreditAmount).toBe('function');
  });
});
