/**
 * Read/Write Query Routing Middleware
 *
 * Routes SELECT / WITH queries to read replicas and write operations to the
 * primary.  Monitors replication lag and fails back to primary when lag exceeds
 * configurable thresholds.  Exposes routing metadata via response headers.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import {
  type DatabaseConfig,
  type ReplicaEndpoint,
  loadDatabaseConfig,
  replicaPoolConfig,
} from '../../config/database';
import { type Pool, type PoolClient, type PoolConfig, type QueryResult, createPool } from './connectionPool';
import { isReadQuery } from './queryClassifier';

// ── Request-scoped routing context ────────────────────────────────────────────

export interface QueryRoutingContext {
  /** Max acceptable replication lag in seconds (from X-Stale-Accept header). */
  staleAcceptSeconds?: number;
  /** Mutable map populated with routing headers for the HTTP response. */
  responseHeaders?: Map<string, string>;
}

const routingContextStorage = new AsyncLocalStorage<QueryRoutingContext>();

/** Run `fn` with query-routing context (stale-read tolerance, response headers). */
export function runWithQueryRoutingContext<T>(
  context: QueryRoutingContext,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return routingContextStorage.run(context, fn);
}

export function getQueryRoutingContext(): QueryRoutingContext | undefined {
  return routingContextStorage.getStore();
}

/** Parse X-Stale-Accept header value (seconds). Returns undefined when absent/invalid. */
export function parseStaleAcceptHeader(value: string | string[] | undefined): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw?.trim()) return undefined;
  const seconds = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

// ── Replication lag state ─────────────────────────────────────────────────────

export interface ReplicaLagState {
  name: string;
  lagMs: number;
  /** Rolling P99 lag computed from recent poll samples (ms). */
  lagP99Ms: number;
  available: boolean;
  lastCheckedAt: number;
}

const LAG_SAMPLE_WINDOW = 100;

/** Compute P99 from a sorted sample window. */
export function computeLagP99(samples: number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.ceil(0.99 * sorted.length) - 1;
  return sorted[Math.max(0, index)] ?? 0;
}

export interface ReplicaQueryStats {
  name: string;
  queryCount: number;
  totalLatencyMs: number;
  lastLatencyMs: number;
  errors: number;
}

const LAG_QUERY = `
  SELECT COALESCE(
    EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) * 1000,
    0
  )::float AS lag_ms
`;

// ── Read/Write pool ───────────────────────────────────────────────────────────

export interface ReadWritePoolOptions {
  config?: DatabaseConfig;
  primaryPool?: Pool;
  replicaPools?: Map<string, Pool>;
}

export class ReadWritePool implements Pool {
  readonly primary: Pool;
  private readonly replicas: Map<string, Pool>;
  private readonly replicaEndpoints: ReplicaEndpoint[];
  private readonly config: DatabaseConfig;
  private readonly lagState: Map<string, ReplicaLagState> = new Map();
  private readonly queryStats: Map<string, ReplicaQueryStats> = new Map();
  private readonly lagSamples: Map<string, number[]> = new Map();
  private roundRobinIndex = 0;
  private lagPollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    primary: Pool,
    replicas: Map<string, Pool>,
    endpoints: ReplicaEndpoint[],
    config: DatabaseConfig,
  ) {
    this.primary = primary;
    this.replicas = replicas;
    this.replicaEndpoints = endpoints;
    this.config = config;

    for (const endpoint of endpoints) {
      this.lagState.set(endpoint.name, {
        name: endpoint.name,
        lagMs: 0,
        lagP99Ms: 0,
        available: true,
        lastCheckedAt: 0,
      });
      this.lagSamples.set(endpoint.name, []);
      this.queryStats.set(endpoint.name, {
        name: endpoint.name,
        queryCount: 0,
        totalLatencyMs: 0,
        lastLatencyMs: 0,
        errors: 0,
      });
    }
  }

  get totalCount(): number {
    let total = this.primary.totalCount;
    for (const pool of this.replicas.values()) {
      total += pool.totalCount;
    }
    return total;
  }

  get idleCount(): number {
    let total = this.primary.idleCount;
    for (const pool of this.replicas.values()) {
      total += pool.idleCount;
    }
    return total;
  }

  get waitingCount(): number {
    let total = this.primary.waitingCount;
    for (const pool of this.replicas.values()) {
      total += pool.waitingCount;
    }
    return total;
  }

  on(event: 'error', handler: (err: Error) => void): void {
    this.primary.on(event, handler);
    for (const pool of this.replicas.values()) {
      pool.on(event, handler);
    }
  }

  /** Start background replication-lag polling. */
  startLagMonitoring(): void {
    if (this.lagPollTimer || this.replicas.size === 0) return;

    void this.pollReplicationLag();
    this.lagPollTimer = setInterval(
      () => void this.pollReplicationLag(),
      this.config.lagPollIntervalMs,
    );
  }

  stopLagMonitoring(): void {
    if (this.lagPollTimer) {
      clearInterval(this.lagPollTimer);
      this.lagPollTimer = null;
    }
  }

  async pollReplicationLag(): Promise<void> {
    for (const [name, pool] of this.replicas) {
      const state = this.lagState.get(name);
      if (!state) continue;

      try {
        const result = await pool.query<{ lag_ms: number }>(LAG_QUERY);
        const lagMs = Number(result.rows[0]?.lag_ms ?? 0);
        const resolvedLag = Number.isFinite(lagMs) ? Math.max(0, lagMs) : 0;
        state.lagMs = resolvedLag;
        const samples = this.lagSamples.get(name) ?? [];
        samples.push(resolvedLag);
        if (samples.length > LAG_SAMPLE_WINDOW) {
          samples.shift();
        }
        this.lagSamples.set(name, samples);
        state.lagP99Ms = computeLagP99(samples);
        state.available = true;
        state.lastCheckedAt = Date.now();
      } catch {
        state.available = false;
        state.lastCheckedAt = Date.now();
      }
    }
  }

  getLagStates(): ReplicaLagState[] {
    return [...this.lagState.values()];
  }

  getQueryStats(): ReplicaQueryStats[] {
    return [...this.queryStats.values()];
  }

  getReplicaPools(): Map<string, Pool> {
    return this.replicas;
  }

  getConfig(): DatabaseConfig {
    return this.config;
  }

  /** Max acceptable lag before routing reads to primary. */
  private maxAcceptableLagMs(context?: QueryRoutingContext): number {
    if (context?.staleAcceptSeconds) {
      return context.staleAcceptSeconds * 1_000;
    }
    return this.config.replicationLagFailoverMs;
  }

  private selectReplica(context?: QueryRoutingContext): { pool: Pool; name: string } | null {
    if (this.replicas.size === 0) return null;

    const maxLag = this.maxAcceptableLagMs(context);
    const candidates: Array<{ pool: Pool; name: string; lagMs: number }> = [];

    for (const endpoint of this.replicaEndpoints) {
      const pool = this.replicas.get(endpoint.name);
      const state = this.lagState.get(endpoint.name);
      if (!pool || !state?.available) continue;
      if (state.lagMs > maxLag) continue;
      candidates.push({ pool, name: endpoint.name, lagMs: state.lagMs });
    }

    if (candidates.length === 0) return null;

    const index = this.roundRobinIndex % candidates.length;
    const selected = candidates[index]!;
    this.roundRobinIndex = (this.roundRobinIndex + 1) % candidates.length;
    return { pool: selected.pool, name: selected.name };
  }

  private setResponseHeader(key: string, value: string): void {
    const ctx = getQueryRoutingContext();
    ctx?.responseHeaders?.set(key, value);
  }

  private recordReplicaQuery(name: string, latencyMs: number, isError: boolean): void {
    const stats = this.queryStats.get(name);
    if (!stats) return;
    stats.queryCount += 1;
    stats.totalLatencyMs += latencyMs;
    stats.lastLatencyMs = latencyMs;
    if (isError) stats.errors += 1;
  }

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    if (!isReadQuery(sql)) {
      return this.primary.query<T>(sql, params);
    }

    const context = getQueryRoutingContext();
    const replica = this.selectReplica(context);

    if (!replica) {
      this.setResponseHeader('X-DB-Route', 'primary');
      const reason = this.replicas.size === 0 ? 'no-replicas' : 'lag-or-unavailable';
      this.setResponseHeader('X-DB-Route-Reason', reason);
      if (reason === 'lag-or-unavailable') {
        this.setResponseHeader('X-DB-Route-Warning', 'replication-lag-fallback-primary');
      }
      return this.primary.query<T>(sql, params);
    }

    const start = Date.now();
    try {
      const result = await replica.pool.query<T>(sql, params);
      const latency = Date.now() - start;
      this.recordReplicaQuery(replica.name, latency, false);

      const state = this.lagState.get(replica.name);
      this.setResponseHeader('X-DB-Route', `replica:${replica.name}`);
      if (state) {
        this.setResponseHeader('X-DB-Replication-Lag-Ms', String(Math.round(state.lagMs)));
      }
      return result;
    } catch (err) {
      const latency = Date.now() - start;
      this.recordReplicaQuery(replica.name, latency, true);

      const state = this.lagState.get(replica.name);
      if (state) state.available = false;

      this.setResponseHeader('X-DB-Route', 'primary');
      this.setResponseHeader('X-DB-Route-Warning', 'replica-unavailable-fallback-primary');

      console.warn(
        `[ReadWritePool] Replica ${replica.name} query failed, falling back to primary:`,
        err instanceof Error ? err.message : err,
      );
      return this.primary.query<T>(sql, params);
    }
  }

  async connect(): Promise<PoolClient> {
    // Transactions must use primary for consistency
    return this.primary.connect();
  }

  async end(): Promise<void> {
    this.stopLagMonitoring();
    await this.primary.end();
    for (const pool of this.replicas.values()) {
      await pool.end();
    }
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export async function createReadWritePool(
  options: ReadWritePoolOptions = {},
): Promise<ReadWritePool> {
  const config = options.config ?? loadDatabaseConfig();
  const primary = options.primaryPool ?? (await createPool(config.primary));

  const replicaPools = options.replicaPools ?? new Map<string, Pool>();

  if (replicaPools.size === 0 && config.replicas.length > 0) {
    for (const endpoint of config.replicas) {
      const poolConfig = replicaPoolConfig(endpoint, config.primary, config.replicaPoolSize);
      const pool = await createPool(poolConfig);
      replicaPools.set(endpoint.name, pool);
    }
  }

  const rwPool = new ReadWritePool(primary, replicaPools, config.replicas, config);
  rwPool.startLagMonitoring();
  return rwPool;
}

/** Apply routing response headers from query context onto an HTTP response. */
export function applyRoutingHeaders(
  context: QueryRoutingContext | undefined,
  setHeader: (name: string, value: string) => void,
): void {
  if (!context?.responseHeaders) return;
  for (const [key, value] of context.responseHeaders) {
    setHeader(key, value);
  }
}

/**
 * Intercept response.writeHead/end so routing headers are attached before the
 * body is sent (covers GraphQL and any handler that writes directly to res).
 */
export function attachRoutingHeaderInterceptor(
  res: {
    headersSent: boolean;
    writeHead: (...args: unknown[]) => unknown;
    end: (...args: unknown[]) => unknown;
    setHeader: (name: string, value: string) => void;
  },
  context: QueryRoutingContext,
): void {
  const apply = () => applyRoutingHeaders(context, (k, v) => res.setHeader(k, v));

  const originalWriteHead = res.writeHead.bind(res);
  res.writeHead = (...args: unknown[]) => {
    apply();
    return originalWriteHead(...args);
  };

  const originalEnd = res.end.bind(res);
  res.end = (...args: unknown[]) => {
    if (!res.headersSent) {
      apply();
    }
    return originalEnd(...args);
  };
}

/** Create routing context from an incoming HTTP request. */
export function createRoutingContextFromRequest(
  headers: Record<string, string | string[] | undefined>,
): QueryRoutingContext {
  const staleAcceptSeconds =
    parseStaleAcceptHeader(headers['x-stale-accept']) ??
    (headers['x-analytics-request'] ? loadDatabaseConfig().staleReadDefaultSeconds : undefined);

  return {
    staleAcceptSeconds,
    responseHeaders: new Map(),
  };
}

export type { PoolConfig };
