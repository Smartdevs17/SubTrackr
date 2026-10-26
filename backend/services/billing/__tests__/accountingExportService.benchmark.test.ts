/**
 * Performance benchmarks for accounting export service.
 *
 * Run:
 *   npx jest --config jest.backend.config.js \
 *     backend/services/billing/__tests__/accountingExportService.benchmark.test.ts \
 *     --no-coverage --verbose
 *
 * Measures:
 *  - CSV export throughput (sync streamExport)
 *  - JSON export throughput
 *  - QuickBooks/Xero format throughput
 *  - PDF export throughput
 *  - Async streaming throughput (streamExportAsync)
 *  - Large dataset chunking efficiency
 */

import {
  streamExport,
  streamExportAsync,
  reconcile,
  createExportSchedule,
  runDueExports,
  getExportAnalytics,
  getExportHistory,
} from '../accountingExportService';
import type { TransactionRecord } from '../accountingExportService';

// ── Helpers ──────────────────────────────────────────────────────────────────

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
  // Warm-up
  for (let i = 0; i < Math.min(2, iterations); i++) fn();
  // Measure
  for (let i = 0; i < iterations; i++) {
    const start = Date.now();
    fn();
    samples.push(Date.now() - start);
  }
  samples.sort((a, b) => a - b);
  const avgMs = samples.reduce((s, v) => s + v, 0) / samples.length;
  const p95Ms = samples[Math.floor(samples.length * 0.95)] ?? samples[samples.length - 1];
  return {
    name,
    iterations,
    avgMs,
    minMs: samples[0],
    maxMs: samples[samples.length - 1],
    p95Ms,
  };
}

let _idCounter = 0;

function makeRecord(overrides: Partial<TransactionRecord> = {}): TransactionRecord {
  return {
    id: `bench_txn_${++_idCounter}`,
    merchantId: 'bench-merchant',
    subscriptionId: `bench_sub_${_idCounter % 10}`,
    subscriptionName: `Service ${_idCounter % 10}`,
    description: `Benchmark record ${_idCounter}`,
    category: 'software',
    transactionType: 'revenue',
    amount: 9.99 + (_idCounter % 100),
    currency: 'USD',
    billingCycle: 'monthly',
    billingDate: Date.now() - (_idCounter % 365) * 86400000,
    deferredRevenue: 0,
    createdAt: Date.now() - (_idCounter % 365) * 86400000,
    ...overrides,
  };
}

function makeRecords(count: number): TransactionRecord[] {
  _idCounter = 0;
  return Array.from({ length: count }, () => makeRecord());
}

// ── Performance budget thresholds ────────────────────────────────────────────

const BUDGETS = {
  csv5k: 1_000,           // 1s for 5k records CSV
  json5k: 1_500,          // 1.5s for 5k records JSON
  quickbooks5k: 1_000,    // 1s for 5k records QuickBooks
  xero5k: 1_000,          // 1s for 5k records Xero
  pdf1k: 2_000,           // 2s for 1k records PDF
  asyncCsv10k: 2_000,     // 2s async streaming 10k records CSV
  reconcile5k: 500,       // 500ms to reconcile 5k records
  scheduleRun1k: 2_000,   // 2s for scheduled export of 1k records
};

// ── Benchmarks ───────────────────────────────────────────────────────────────

describe('Accounting Export — Performance Benchmarks', () => {
  beforeEach(() => {
    _idCounter = 0;
  });

  // ── Sync CSV ──────────────────────────────────────────────────────────────

  it(`streams 5k records as CSV in < ${BUDGETS.csv5k}ms (avg)`, () => {
    const records = makeRecords(5_000);
    const result = bench('csv-5k', 10, () => {
      const chunks: string[] = [];
      streamExport(records, { format: 'csv', onChunk: (c) => chunks.push(c) });
    });
    console.log(`  csv-5k: avg=${result.avgMs.toFixed(1)}ms p95=${result.p95Ms.toFixed(1)}ms`);
    expect(result.avgMs).toBeLessThan(BUDGETS.csv5k);
  });

  // ── Sync JSON ─────────────────────────────────────────────────────────────

  it(`streams 5k records as JSON in < ${BUDGETS.json5k}ms (avg)`, () => {
    const records = makeRecords(5_000);
    const result = bench('json-5k', 10, () => {
      const chunks: string[] = [];
      streamExport(records, { format: 'json', onChunk: (c) => chunks.push(c) });
    });
    console.log(`  json-5k: avg=${result.avgMs.toFixed(1)}ms p95=${result.p95Ms.toFixed(1)}ms`);
    expect(result.avgMs).toBeLessThan(BUDGETS.json5k);
  });

  // ── QuickBooks ────────────────────────────────────────────────────────────

  it(`streams 5k records as QuickBooks CSV in < ${BUDGETS.quickbooks5k}ms (avg)`, () => {
    const records = makeRecords(5_000);
    const result = bench('quickbooks-5k', 10, () => {
      const chunks: string[] = [];
      streamExport(records, { format: 'quickbooks', onChunk: (c) => chunks.push(c) });
    });
    console.log(`  quickbooks-5k: avg=${result.avgMs.toFixed(1)}ms p95=${result.p95Ms.toFixed(1)}ms`);
    expect(result.avgMs).toBeLessThan(BUDGETS.quickbooks5k);
  });

  // ── Xero ──────────────────────────────────────────────────────────────────

  it(`streams 5k records as Xero CSV in < ${BUDGETS.xero5k}ms (avg)`, () => {
    const records = makeRecords(5_000);
    const result = bench('xero-5k', 10, () => {
      const chunks: string[] = [];
      streamExport(records, { format: 'xero', onChunk: (c) => chunks.push(c) });
    });
    console.log(`  xero-5k: avg=${result.avgMs.toFixed(1)}ms p95=${result.p95Ms.toFixed(1)}ms`);
    expect(result.avgMs).toBeLessThan(BUDGETS.xero5k);
  });

  // ── PDF ───────────────────────────────────────────────────────────────────

  it(`streams 1k records as PDF in < ${BUDGETS.pdf1k}ms (avg)`, () => {
    const records = makeRecords(1_000);
    const result = bench('pdf-1k', 5, () => {
      const chunks: string[] = [];
      streamExport(records, {
        format: 'pdf',
        filter: { merchantId: 'bench-merchant' },
        onChunk: (c) => chunks.push(c),
      });
    });
    console.log(`  pdf-1k: avg=${result.avgMs.toFixed(1)}ms p95=${result.p95Ms.toFixed(1)}ms`);
    expect(result.avgMs).toBeLessThan(BUDGETS.pdf1k);
  });

  // ── Async streaming ───────────────────────────────────────────────────────

  it(`streams 10k records asynchronously as CSV in < ${BUDGETS.asyncCsv10k}ms (avg)`, async () => {
    const records = makeRecords(10_000);
    const iterations = 5;
    const samples: number[] = [];

    // Warm-up
    for (let i = 0; i < 2; i++) {
      for await (const _chunk of streamExportAsync(records, { format: 'csv', chunkSize: 1000 })) {
        // consume
      }
    }

    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      for await (const _chunk of streamExportAsync(records, { format: 'csv', chunkSize: 1000 })) {
        // consume
      }
      samples.push(Date.now() - start);
    }

    samples.sort((a, b) => a - b);
    const avgMs = samples.reduce((s, v) => s + v, 0) / samples.length;
    const p95Ms = samples[Math.floor(samples.length * 0.95)] ?? samples[samples.length - 1];
    console.log(`  async-csv-10k: avg=${avgMs.toFixed(1)}ms p95=${p95Ms.toFixed(1)}ms`);
    expect(avgMs).toBeLessThan(BUDGETS.asyncCsv10k);
  });

  // ── Reconciliation ────────────────────────────────────────────────────────

  it(`reconciles 5k records in < ${BUDGETS.reconcile5k}ms (avg)`, () => {
    const records = makeRecords(5_000);
    const expected = records.map((r) => ({
      id: r.id,
      amount: r.amount,
      transactionType: r.transactionType,
    }));
    const result = bench('reconcile-5k', 20, () => {
      reconcile(records, expected);
    });
    console.log(`  reconcile-5k: avg=${result.avgMs.toFixed(3)}ms p95=${result.p95Ms.toFixed(3)}ms`);
    expect(result.avgMs).toBeLessThan(BUDGETS.reconcile5k);
  });

  // ── Schedule run ──────────────────────────────────────────────────────────

  it(`runs due export schedule for 1k records in < ${BUDGETS.scheduleRun1k}ms (avg)`, () => {
    const records = makeRecords(1_000);
    // Create a due schedule
    createExportSchedule({
      merchantId: 'bench-merchant',
      format: 'csv',
      frequency: 'monthly',
      enabled: true,
      includeInactive: false,
      nextRunAt: Date.now() - 10_000,
    });

    const result = bench('schedule-run-1k', 10, () => {
      runDueExports(records, Date.now());
    });
    console.log(`  schedule-run-1k: avg=${result.avgMs.toFixed(1)}ms p95=${result.p95Ms.toFixed(1)}ms`);
    expect(result.avgMs).toBeLessThan(BUDGETS.scheduleRun1k);
  });

  // ── Correctness guard ─────────────────────────────────────────────────────

  it('all format exports produce non-empty output', () => {
    const records = makeRecords(10);
    const formats = ['csv', 'json', 'quickbooks', 'xero', 'pdf'] as const;

    for (const format of formats) {
      const chunks: string[] = [];
      const { totalRecords } = streamExport(records, {
        format,
        onChunk: (c) => chunks.push(c),
      });
      expect(totalRecords).toBe(10);
      expect(chunks.join('').length).toBeGreaterThan(0);
    }
  });

  it('reconciliation reports balanced for matching records', () => {
    const records = makeRecords(100);
    const expected = records.map((r) => ({
      id: r.id,
      amount: r.amount,
      transactionType: r.transactionType,
    }));
    const result = reconcile(records, expected);
    expect(result.isBalanced).toBe(true);
    expect(result.mismatches).toHaveLength(0);
    expect(result.totalRecords).toBe(100);
  });

  it('analytics and history are accessible after benchmark runs', () => {
    const analytics = getExportAnalytics();
    expect(typeof analytics.totalExports).toBe('number');
    expect(typeof analytics.formatBreakdown.csv).toBe('number');

    const history = getExportHistory();
    expect(Array.isArray(history)).toBe(true);
  });
});
