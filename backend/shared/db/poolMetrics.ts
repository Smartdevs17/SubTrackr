/**
 * Connection pool metrics collector (issue #1797).
 *
 * Periodically samples pool health counters (total, idle, waiting) and exposes
 * them as a structured snapshot for monitoring, dashboards and alerts.
 *
 * The collector is transport-agnostic: it produces a `PoolMetricsSnapshot`
 * that can be serialized to JSON for Prometheus export, log shipping, or an
 * internal `/health/db` endpoint.
 */

import type { Pool, ReadWritePool } from './connectionPool';

export interface PoolMetricsSnapshot {
  /** Epoch ms when the sample was taken */
  timestamp: number;
  /** Total connections open (active + idle) */
  totalCount: number;
  /** Idle connections available for reuse */
  idleCount: number;
  /** Requests blocked waiting for a connection */
  waitingCount: number;
  /** Active (checked-out) connections: total - idle */
  activeCount: number;
  /** Configured max connections */
  maxConnections: number;
  /** Utilisation ratio: active / max (0–1) */
  utilization: number;
  /** True when waitingCount > 0 (saturation signal) */
  saturated: boolean;
  /** Read-replica lag states when replica routing is enabled */
  replicas?: ReplicaLagState[];
}

export interface ReplicaLagState {
  name: string;
  lagMs: number | null;
  rerouted: boolean;
}

export interface PoolMetricsOptions {
  /** Sampling interval in ms. Default: 10 000 */
  intervalMs?: number;
  /** Called on every snapshot for log/metrics shipping */
  onSnapshot?: (snapshot: PoolMetricsSnapshot) => void;
  /** Alert when utilization exceeds this threshold (0–1). Default: 0.8 */
  alertThreshold?: number;
  /** Called when utilization crosses the alert threshold */
  onAlert?: (snapshot: PoolMetricsSnapshot) => void;
}

export class PoolMetricsCollector {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs: number;
  private readonly alertThreshold: number;
  private onSnapshot?: (snapshot: PoolMetricsSnapshot) => void;
  private onAlert?: (snapshot: PoolMetricsSnapshot) => void;
  private lastSnapshot: PoolMetricsSnapshot | null = null;
  private wasAlerting = false;
  private readonly maxConnections: number;

  constructor(
    private pool: Pool | ReadWritePool,
    opts: PoolMetricsOptions = {},
  ) {
    this.intervalMs = opts.intervalMs ?? 10_000;
    this.alertThreshold = opts.alertThreshold ?? 0.8;
    this.onSnapshot = opts.onSnapshot;
    this.onAlert = opts.onAlert;
    this.maxConnections = (pool as Pool & { max?: number }).max ?? 20;
  }

  /** Start periodic sampling. Returns this for chaining. */
  start(): this {
    if (this.timer) return this;
    // Sample immediately, then on interval
    void this.sample();
    this.timer = setInterval(() => void this.sample(), this.intervalMs);
    return this;
  }

  /** Stop periodic sampling. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** True when the collector is actively sampling. */
  isRunning(): boolean {
    return this.timer !== null;
  }

  /** Take a single snapshot without starting the interval. */
  sample(): PoolMetricsSnapshot {
    const pool = this.pool as Pool & {
      getLagStates?: () => { name: string; lagMs: number | null; rerouted: boolean }[];
    };

    const totalCount = pool.totalCount ?? 0;
    const idleCount = pool.idleCount ?? 0;
    const waitingCount = pool.waitingCount ?? 0;
    const activeCount = totalCount - idleCount;
    const utilization = this.maxConnections > 0 ? activeCount / this.maxConnections : 0;
    const saturated = waitingCount > 0;

    const snapshot: PoolMetricsSnapshot = {
      timestamp: Date.now(),
      totalCount,
      idleCount,
      waitingCount,
      activeCount,
      maxConnections: this.maxConnections,
      utilization: Math.round(utilization * 1000) / 1000,
      saturated,
    };

    // Attach replica lag states if available
    if (typeof pool.getLagStates === 'function') {
      snapshot.replicas = pool.getLagStates();
    }

    this.lastSnapshot = snapshot;
    this.onSnapshot?.(snapshot);

    // Alert on threshold crossing (edge-triggered)
    const isAlerting = utilization >= this.alertThreshold;
    if (isAlerting && !this.wasAlerting) {
      this.onAlert?.(snapshot);
    }
    this.wasAlerting = isAlerting;

    return snapshot;
  }

  /** Return the most recent snapshot, or null if none has been taken. */
  getLastSnapshot(): PoolMetricsSnapshot | null {
    return this.lastSnapshot;
  }

  /** Return a JSON-safe summary suitable for `/health/db` responses. */
  getHealthSummary(): {
    healthy: boolean;
    utilization: number;
    saturated: boolean;
    snapshot: PoolMetricsSnapshot | null;
  } {
    const snapshot = this.lastSnapshot;
    if (!snapshot) {
      return { healthy: true, utilization: 0, saturated: false, snapshot: null };
    }
    const healthy = !snapshot.saturated && snapshot.utilization < this.alertThreshold;
    return {
      healthy,
      utilization: snapshot.utilization,
      saturated: snapshot.saturated,
      snapshot,
    };
  }
}
