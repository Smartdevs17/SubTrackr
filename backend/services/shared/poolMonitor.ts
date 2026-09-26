/**
 * Connection Pool Monitor — SubTrackr
 *
 * Wraps any Pool (PostgreSQL primary, replica, or ES) with:
 *  - Real-time utilisation metrics (total, idle, waiting, checked-out)
 *  - Pool exhaustion alerts (waiting queue > threshold)
 *  - Connection leak detection (checked-out longer than leakThresholdMs)
 *  - Query timeout configuration enforcement
 *  - Prometheus metrics export
 *  - Pool tuning recommendations (based on observed peak utilisation)
 */

import type { Pool, PoolClient, QueryResult } from '../../shared/db/connectionPool';
import { logger } from './logging';

// ─── Configuration ────────────────────────────────────────────────────────────

export interface PoolMonitorConfig {
  /** Name used in metrics labels (e.g. "primary", "replica-1"). */
  name: string;
  /** Poll interval for metric snapshots in ms. Default: 5000 */
  pollIntervalMs?: number;
  /** Waiting connections above this triggers an exhaustion alert. Default: 5 */
  exhaustionThreshold?: number;
  /** A checked-out client older than this is considered leaked (ms). Default: 30 000 */
  leakThresholdMs?: number;
  /** Query timeout injected via SET statement_timeout on each connection (ms). Default: 30 000 */
  queryTimeoutMs?: number;
  /** Maximum pool size — used for utilisation % calculation. */
  maxConnections?: number;
  /** Called when pool exhaustion is detected. */
  onExhaustion?: (stats: PoolStats) => void;
  /** Called when a leaked connection is detected. */
  onLeak?: (leak: LeakRecord) => void;
}

const DEFAULTS: Required<Omit<PoolMonitorConfig, 'name' | 'onExhaustion' | 'onLeak'>> = {
  pollIntervalMs: 5_000,
  exhaustionThreshold: 5,
  leakThresholdMs: 30_000,
  queryTimeoutMs: 30_000,
  maxConnections: 20,
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PoolStats {
  name: string;
  total: number;
  idle: number;
  waiting: number;
  checkedOut: number;
  utilizationPct: number;
  leakedConnections: number;
  peakCheckedOut: number;
  totalQueries: number;
  totalErrors: number;
  avgQueryLatencyMs: number;
  p99QueryLatencyMs: number;
}

export interface LeakRecord {
  poolName: string;
  checkedOutAt: number;
  ageMs: number;
  origin?: string;
}

export interface PoolTuningRecommendation {
  currentMax: number;
  recommendedMax: number;
  reason: string;
}

// ─── Monitored Pool ───────────────────────────────────────────────────────────

interface CheckoutEntry {
  client: PoolClient;
  checkedOutAt: number;
  origin?: string;
}

export class MonitoredPool implements Pool {
  private readonly cfg: Required<Omit<PoolMonitorConfig, 'onExhaustion' | 'onLeak'>> &
    Pick<PoolMonitorConfig, 'onExhaustion' | 'onLeak'>;

  private readonly checkouts = new Map<PoolClient, CheckoutEntry>();
  private leakedConnections = 0;
  private peakCheckedOut = 0;
  private totalQueries = 0;
  private totalErrors = 0;
  private readonly latencies: number[] = [];
  private pollTimer?: ReturnType<typeof setInterval>;
  private readonly snapshots: PoolStats[] = [];

  constructor(
    private readonly inner: Pool,
    config: PoolMonitorConfig,
  ) {
    const { onExhaustion, onLeak, ...rest } = config;
    this.cfg = { ...DEFAULTS, ...rest, onExhaustion, onLeak };
    this.startPolling();
  }

  // ── Pool interface ──────────────────────────────────────────────────────────

  get totalCount(): number { return this.inner.totalCount; }
  get idleCount(): number { return this.inner.idleCount; }
  get waitingCount(): number { return this.inner.waitingCount; }

  on(event: 'error', handler: (err: Error) => void): void {
    this.inner.on(event, handler);
  }

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    const start = Date.now();
    this.totalQueries++;
    try {
      const result = await this.inner.query<T>(sql, params);
      this.recordLatency(Date.now() - start);
      return result;
    } catch (err) {
      this.totalErrors++;
      this.recordLatency(Date.now() - start);
      throw err;
    }
  }

  async connect(): Promise<PoolClient> {
    const client = await this.inner.connect();

    // Inject query timeout on new connections
    try {
      await client.query(`SET statement_timeout = ${this.cfg.queryTimeoutMs}`);
    } catch {
      logger.warn(`[PoolMonitor:${this.cfg.name}] Could not set statement_timeout`);
    }

    const entry: CheckoutEntry = { client, checkedOutAt: Date.now() };
    this.checkouts.set(client, entry);

    const checkedOut = this.checkouts.size;
    if (checkedOut > this.peakCheckedOut) this.peakCheckedOut = checkedOut;

    // Wrap release() to clean up tracking entry
    const originalRelease = client.release.bind(client);
    client.release = () => {
      this.checkouts.delete(client);
      originalRelease();
    };

    return client;
  }

  async end(): Promise<void> {
    this.stopPolling();
    await this.inner.end();
  }

  // ── Stats & Monitoring ──────────────────────────────────────────────────────

  getStats(): PoolStats {
    const total = this.inner.totalCount;
    const max = this.cfg.maxConnections;
    const checkedOut = this.checkouts.size;
    return {
      name: this.cfg.name,
      total,
      idle: this.inner.idleCount,
      waiting: this.inner.waitingCount,
      checkedOut,
      utilizationPct: max > 0 ? Math.round((checkedOut / max) * 100) : 0,
      leakedConnections: this.leakedConnections,
      peakCheckedOut: this.peakCheckedOut,
      totalQueries: this.totalQueries,
      totalErrors: this.totalErrors,
      avgQueryLatencyMs: this.avgLatency(),
      p99QueryLatencyMs: this.p99Latency(),
    };
  }

  /** Snapshot history for dashboard (last 60 polls). */
  getHistory(): PoolStats[] {
    return [...this.snapshots];
  }

  getTuningRecommendation(): PoolTuningRecommendation {
    const current = this.cfg.maxConnections;
    // Recommend 20% headroom above peak observed checked-out count
    const recommended = Math.max(current, Math.ceil(this.peakCheckedOut * 1.2));
    return {
      currentMax: current,
      recommendedMax: recommended,
      reason:
        recommended > current
          ? `Peak concurrent connections was ${this.peakCheckedOut}; adding 20% headroom`
          : 'Current pool size appears sufficient for observed load',
    };
  }

  prometheusMetrics(namespace = 'subtrackr_db_pool'): string {
    const s = this.getStats();
    const label = `pool="${s.name}"`;
    return [
      `# HELP ${namespace}_total_connections Active connections in pool`,
      `# TYPE ${namespace}_total_connections gauge`,
      `${namespace}_total_connections{${label}} ${s.total}`,
      `# HELP ${namespace}_idle_connections Idle connections`,
      `# TYPE ${namespace}_idle_connections gauge`,
      `${namespace}_idle_connections{${label}} ${s.idle}`,
      `# HELP ${namespace}_waiting_connections Requests waiting for a connection`,
      `# TYPE ${namespace}_waiting_connections gauge`,
      `${namespace}_waiting_connections{${label}} ${s.waiting}`,
      `# HELP ${namespace}_checked_out_connections Currently checked-out connections`,
      `# TYPE ${namespace}_checked_out_connections gauge`,
      `${namespace}_checked_out_connections{${label}} ${s.checkedOut}`,
      `# HELP ${namespace}_utilization_pct Pool utilization percentage`,
      `# TYPE ${namespace}_utilization_pct gauge`,
      `${namespace}_utilization_pct{${label}} ${s.utilizationPct}`,
      `# HELP ${namespace}_leaked_connections_total Leaked connections detected and force-closed`,
      `# TYPE ${namespace}_leaked_connections_total counter`,
      `${namespace}_leaked_connections_total{${label}} ${s.leakedConnections}`,
      `# HELP ${namespace}_queries_total Total queries executed`,
      `# TYPE ${namespace}_queries_total counter`,
      `${namespace}_queries_total{${label}} ${s.totalQueries}`,
      `# HELP ${namespace}_errors_total Total query errors`,
      `# TYPE ${namespace}_errors_total counter`,
      `${namespace}_errors_total{${label}} ${s.totalErrors}`,
      `# HELP ${namespace}_avg_latency_ms Average query latency`,
      `# TYPE ${namespace}_avg_latency_ms gauge`,
      `${namespace}_avg_latency_ms{${label}} ${s.avgQueryLatencyMs}`,
      `# HELP ${namespace}_p99_latency_ms P99 query latency`,
      `# TYPE ${namespace}_p99_latency_ms gauge`,
      `${namespace}_p99_latency_ms{${label}} ${s.p99QueryLatencyMs}`,
    ].join('\n');
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private startPolling(): void {
    this.pollTimer = setInterval(() => this.poll(), this.cfg.pollIntervalMs);
    if (typeof this.pollTimer.unref === 'function') this.pollTimer.unref();
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private poll(): void {
    const stats = this.getStats();

    // Snapshot for history (keep last 60)
    this.snapshots.push(stats);
    if (this.snapshots.length > 60) this.snapshots.shift();

    // Exhaustion alert
    if (stats.waiting >= this.cfg.exhaustionThreshold) {
      logger.warn(`[PoolMonitor:${this.cfg.name}] Pool exhaustion detected`, {
        waiting: stats.waiting,
        threshold: this.cfg.exhaustionThreshold,
        checkedOut: stats.checkedOut,
      });
      this.cfg.onExhaustion?.(stats);
    }

    // Leak detection
    const now = Date.now();
    for (const [, entry] of this.checkouts) {
      const age = now - entry.checkedOutAt;
      if (age > this.cfg.leakThresholdMs) {
        this.leakedConnections++;
        const leak: LeakRecord = {
          poolName: this.cfg.name,
          checkedOutAt: entry.checkedOutAt,
          ageMs: age,
          origin: entry.origin,
        };
        logger.warn(`[PoolMonitor:${this.cfg.name}] Leaked connection detected`, leak);
        this.cfg.onLeak?.(leak);
        // Force release
        try { entry.client.release(); } catch { /* already gone */ }
        this.checkouts.delete(entry.client);
      }
    }
  }

  private recordLatency(ms: number): void {
    this.latencies.push(ms);
    if (this.latencies.length > 10_000) this.latencies.shift();
  }

  private avgLatency(): number {
    if (this.latencies.length === 0) return 0;
    return Math.round(this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length);
  }

  private p99Latency(): number {
    if (this.latencies.length === 0) return 0;
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const idx = Math.ceil(0.99 * sorted.length) - 1;
    return sorted[Math.max(0, idx)] ?? 0;
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Wrap an existing Pool with monitoring.
 *
 * @example
 * const pool = await getPool();
 * const monitored = wrapWithMonitor(pool, { name: 'primary', maxConnections: 20 });
 * container.register('IPool', monitored);
 */
export function wrapWithMonitor(pool: Pool, config: PoolMonitorConfig): MonitoredPool {
  return new MonitoredPool(pool, config);
}
