/**
 * SlowQueryMonitor
 *
 * Transparent wrapper around a pg-style query client that times every query,
 * groups timings by a normalized SQL fingerprint, exposes per-pattern latency
 * percentiles (p50/p95/p99), and fires an alert callback when a query exceeds a
 * configurable slow threshold.
 *
 * It is the runtime counterpart to the offline pg_stat_statements profiling
 * documented in db/QUERY_OPTIMIZATION.md: use `getTopSlow(20)` to surface the
 * 20 slowest query patterns and `onSlowQuery` to wire alerting.
 *
 * Usage:
 *   const monitor = new SlowQueryMonitor(pool, {
 *     slowThresholdMs: 100,
 *     onSlowQuery: (e) => logger.warn('slow query', e),
 *   });
 *   await monitor.query('SELECT ...', [userId]);   // drop-in for pool.query
 *   const worst = monitor.getTopSlow(20);
 */

import { normalizeSql } from '../db/queryClassifier';

export interface QueryClient {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface SlowQueryEvent {
  fingerprint: string;
  sql: string;
  durationMs: number;
  rowCount: number;
  failed: boolean;
  timestamp: number;
}

export interface QueryStat {
  fingerprint: string;
  sample: string;
  count: number;
  slowCount: number;
  totalMs: number;
  maxMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

export interface SlowQueryMonitorOptions {
  /** Queries at or above this duration fire `onSlowQuery`. Default 100ms. */
  slowThresholdMs?: number;
  /** Ring-buffer size of retained durations per fingerprint. Default 1000. */
  maxSamplesPerQuery?: number;
  /** Alerting hook invoked for every slow query. */
  onSlowQuery?: (event: SlowQueryEvent) => void;
  /** Injectable monotonic clock (ms). Defaults to Date.now for production. */
  now?: () => number;
}

interface Bucket {
  sample: string;
  count: number;
  slowCount: number;
  totalMs: number;
  maxMs: number;
  durations: number[];
}

const DEFAULT_SLOW_THRESHOLD_MS = 100;
const DEFAULT_MAX_SAMPLES = 1000;

/**
 * Collapse a SQL string into a stable grouping key: strip comments (via the
 * shared normalizer), collapse all runs of whitespace, and trim. Queries here
 * are parameterized ($1, $2 …) so the residual text is stable per call site.
 */
export function fingerprintSql(sql: string): string {
  return normalizeSql(sql).replace(/\s+/g, ' ').trim();
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sortedAsc.length) - 1;
  const index = Math.min(Math.max(rank, 0), sortedAsc.length - 1);
  return sortedAsc[index];
}

export class SlowQueryMonitor implements QueryClient {
  private readonly client: QueryClient;
  private readonly slowThresholdMs: number;
  private readonly maxSamplesPerQuery: number;
  private readonly onSlowQuery?: (event: SlowQueryEvent) => void;
  private readonly now: () => number;
  private readonly buckets = new Map<string, Bucket>();

  constructor(client: QueryClient, options: SlowQueryMonitorOptions = {}) {
    this.client = client;
    this.slowThresholdMs = options.slowThresholdMs ?? DEFAULT_SLOW_THRESHOLD_MS;
    this.maxSamplesPerQuery = options.maxSamplesPerQuery ?? DEFAULT_MAX_SAMPLES;
    this.onSlowQuery = options.onSlowQuery;
    this.now = options.now ?? Date.now;
  }

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> {
    const start = this.now();
    let rowCount = 0;
    let failed = false;
    try {
      const result = await this.client.query<T>(sql, params);
      rowCount = result.rows.length;
      return result;
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      const durationMs = this.now() - start;
      this.record(sql, durationMs, rowCount, failed);
    }
  }

  private record(sql: string, durationMs: number, rowCount: number, failed: boolean): void {
    const fingerprint = fingerprintSql(sql);
    let bucket = this.buckets.get(fingerprint);
    if (!bucket) {
      bucket = { sample: sql, count: 0, slowCount: 0, totalMs: 0, maxMs: 0, durations: [] };
      this.buckets.set(fingerprint, bucket);
    }

    bucket.count += 1;
    bucket.totalMs += durationMs;
    if (durationMs > bucket.maxMs) bucket.maxMs = durationMs;
    bucket.durations.push(durationMs);
    if (bucket.durations.length > this.maxSamplesPerQuery) {
      bucket.durations.shift();
    }

    if (durationMs >= this.slowThresholdMs) {
      bucket.slowCount += 1;
      this.onSlowQuery?.({
        fingerprint,
        sql,
        durationMs,
        rowCount,
        failed,
        timestamp: this.now(),
      });
    }
  }

  /** Per-pattern latency stats, sorted by p95 descending. */
  getStats(): QueryStat[] {
    const stats: QueryStat[] = [];
    for (const [fingerprint, bucket] of this.buckets) {
      const sorted = [...bucket.durations].sort((a, b) => a - b);
      stats.push({
        fingerprint,
        sample: bucket.sample,
        count: bucket.count,
        slowCount: bucket.slowCount,
        totalMs: bucket.totalMs,
        maxMs: bucket.maxMs,
        p50Ms: percentile(sorted, 50),
        p95Ms: percentile(sorted, 95),
        p99Ms: percentile(sorted, 99),
      });
    }
    return stats.sort((a, b) => b.p95Ms - a.p95Ms);
  }

  /** The `limit` slowest query patterns by p95 (default 20). */
  getTopSlow(limit = 20): QueryStat[] {
    return this.getStats().slice(0, limit);
  }

  reset(): void {
    this.buckets.clear();
  }
}
