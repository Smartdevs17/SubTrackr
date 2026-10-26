/**
 * Elasticsearch Connection Pool — SubTrackr
 *
 * Issue #986: Implement database connection pooling with optimization
 *
 * Features:
 *  - Fixed-size pool of logical ES "connections" (HTTP agents / client handles)
 *  - Acquire/release lifecycle with configurable acquire timeout
 *  - Idle-connection timeout with automatic teardown
 *  - Connection leak detection (configurable threshold)
 *  - DNS-level caching with per-entry TTL (avoids re-resolution per request)
 *  - Read/write routing: round-robin across replicas for reads, primary for writes
 *  - Pool exhaustion alerting (callback + log)
 *  - Prometheus metrics export
 *  - Tuning recommendations based on peak utilisation
 */

import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConnectionRole = 'primary' | 'replica';

export interface PooledConnection {
  readonly id: string;
  readonly host: string;
  readonly port: number;
  readonly role: ConnectionRole;
  inUse: boolean;
  acquiredAt?: number;
  lastUsedAt: number;
  createdAt: number;
  useCount: number;
  /** Resolved IP stored after first DNS lookup. */
  resolvedAddress?: string;
  resolvedAt?: number;
}

export interface ConnectionPoolConfig {
  /** Primary ES node host. */
  primaryHost: string;
  primaryPort: number;
  /** Optional replica nodes for read routing. */
  replicas?: { host: string; port: number }[];
  /** Total connections in the pool (primary + replicas share this budget). */
  poolSize: number;
  /** How long (ms) to wait for a free connection before throwing. Default: 5000. */
  acquireTimeoutMs: number;
  /** Idle connections released after this many ms without use. Default: 60_000. */
  idleTimeoutMs: number;
  /** Connections held for longer than this (ms) are flagged as leaked. Default: 30_000. */
  leakThresholdMs: number;
  /** DNS cache entry TTL in ms. Default: 30_000. */
  dnsCacheTtlMs: number;
  /** Interval for idle-sweep & leak-detection (ms). Default: 10_000. */
  maintenanceIntervalMs: number;
}

export interface AcquireResult {
  connection: PooledConnection;
  /** True if this connection was idle-refreshed (DNS re-validated). */
  dnsRefreshed: boolean;
}

export interface PoolMetrics {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  acquireTimeouts: number;
  leaksDetected: number;
  totalAcquires: number;
  totalReleases: number;
  avgAcquireWaitMs: number;
  peakActiveConnections: number;
  dnsLookups: number;
  dnsCacheHits: number;
  /** Utilisation 0–1 based on peak vs pool size. */
  peakUtilisation: number;
}

export type LeakAlertHandler = (conn: PooledConnection, heldMs: number) => void;
export type ExhaustionAlertHandler = (waitingCount: number) => void;

// ---------------------------------------------------------------------------
// DNS Cache
// ---------------------------------------------------------------------------

interface DnsCacheEntry {
  address: string;
  resolvedAt: number;
  ttlMs: number;
}

export class DnsCache {
  private readonly cache = new Map<string, DnsCacheEntry>();
  private lookups = 0;
  private hits = 0;

  /** Simulate DNS resolution (real impl would use dns.resolve4). */
  async resolve(host: string, ttlMs: number): Promise<string> {
    const cached = this.cache.get(host);
    if (cached && Date.now() - cached.resolvedAt < cached.ttlMs) {
      this.hits++;
      return cached.address;
    }
    // In production this would be `dns.promises.resolve4(host)`
    const address = host; // pass-through for non-prod / tests
    this.lookups++;
    this.cache.set(host, { address, resolvedAt: Date.now(), ttlMs });
    return address;
  }

  invalidate(host: string): void {
    this.cache.delete(host);
  }

  clear(): void {
    this.cache.clear();
  }

  stats(): { lookups: number; hits: number; hitRate: number; size: number } {
    return {
      lookups: this.lookups,
      hits: this.hits,
      hitRate: this.lookups > 0 ? this.hits / this.lookups : 0,
      size: this.cache.size,
    };
  }
}

// ---------------------------------------------------------------------------
// Connection Pool
// ---------------------------------------------------------------------------

export class ElasticsearchConnectionPool extends EventEmitter {
  private readonly config: ConnectionPoolConfig;
  private readonly pool: PooledConnection[] = [];
  private readonly waitQueue: Array<{
    resolve: (result: AcquireResult) => void;
    reject: (err: Error) => void;
    readonly enqueueAt: number;
    readonly readOnly: boolean;
  }> = [];

  private readonly dnsCache = new DnsCache();
  private maintenanceTimer?: ReturnType<typeof setInterval>;

  // Round-robin index for replicas
  private replicaRoundRobin = 0;

  // Metrics
  private acquireTimeouts = 0;
  private leaksDetected = 0;
  private totalAcquires = 0;
  private totalReleases = 0;
  private totalAcquireWaitMs = 0;
  private peakActiveConnections = 0;

  // Alerts
  public onLeak?: LeakAlertHandler;
  public onExhaustion?: ExhaustionAlertHandler;

  constructor(config: ConnectionPoolConfig) {
    super();
    this.config = {
      ...config,
      acquireTimeoutMs: config.acquireTimeoutMs ?? 5_000,
      idleTimeoutMs: config.idleTimeoutMs ?? 60_000,
      leakThresholdMs: config.leakThresholdMs ?? 30_000,
      dnsCacheTtlMs: config.dnsCacheTtlMs ?? 30_000,
      maintenanceIntervalMs: config.maintenanceIntervalMs ?? 10_000,
    };
    this.initPool();
    this.startMaintenance();
  }

  // ── Initialisation ────────────────────────────────────────────────────────

  private initPool(): void {
    const { poolSize, primaryHost, primaryPort, replicas = [] } = this.config;

    // Distribute pool slots: replicas get floor(poolSize / (replicas+1)) each,
    // remainder goes to primary.
    const nodeCount = 1 + replicas.length;
    const slotsPerNode = Math.max(1, Math.floor(poolSize / nodeCount));
    const primarySlots = poolSize - slotsPerNode * replicas.length;

    for (let i = 0; i < primarySlots; i++) {
      this.pool.push(this.createConnection(primaryHost, primaryPort, 'primary'));
    }
    for (const replica of replicas) {
      for (let i = 0; i < slotsPerNode; i++) {
        this.pool.push(this.createConnection(replica.host, replica.port, 'replica'));
      }
    }
  }

  private createConnection(host: string, port: number, role: ConnectionRole): PooledConnection {
    return {
      id: `conn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      host,
      port,
      role,
      inUse: false,
      lastUsedAt: Date.now(),
      createdAt: Date.now(),
      useCount: 0,
    };
  }

  // ── Acquire / Release ─────────────────────────────────────────────────────

  /**
   * Acquire a connection from the pool.
   *
   * @param readOnly  If true, prefers replica connections (read routing).
   *                  Falls back to primary when all replicas are busy.
   */
  async acquire(readOnly = false): Promise<AcquireResult> {
    const start = Date.now();
    const conn = this.tryAcquireSync(readOnly);
    if (conn) {
      this.totalAcquires++;
      this.totalAcquireWaitMs += Date.now() - start;
      const active = this.activeCount();
      if (active > this.peakActiveConnections) this.peakActiveConnections = active;
      return this.prepareConnection(conn);
    }

    // Pool exhausted — alert and queue the waiter
    this.onExhaustion?.(this.waitQueue.length + 1);
    this.emit('exhaustion', this.waitQueue.length + 1);

    return new Promise<AcquireResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waitQueue.findIndex((w) => w.resolve === resolve);
        if (idx !== -1) this.waitQueue.splice(idx, 1);
        this.acquireTimeouts++;
        reject(
          new Error(
            `ElasticsearchConnectionPool: acquire timed out after ${this.config.acquireTimeoutMs}ms. ` +
              `Pool size: ${this.config.poolSize}, waiting: ${this.waitQueue.length}`,
          ),
        );
      }, this.config.acquireTimeoutMs);

      this.waitQueue.push({
        resolve: (result) => {
          clearTimeout(timer);
          this.totalAcquires++;
          this.totalAcquireWaitMs += Date.now() - start;
          const active = this.activeCount();
          if (active > this.peakActiveConnections) this.peakActiveConnections = active;
          resolve(result);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
        enqueueAt: Date.now(),
        readOnly,
      });
    });
  }

  /**
   * Release a connection back to the pool.
   * Automatically dispatches to the next waiter if any are queued.
   */
  release(connectionId: string): void {
    const conn = this.pool.find((c) => c.id === connectionId);
    if (!conn) return;

    conn.inUse = false;
    conn.acquiredAt = undefined;
    conn.lastUsedAt = Date.now();
    conn.useCount++;
    this.totalReleases++;

    this.emit('release', conn.id);

    // Drain the wait queue
    if (this.waitQueue.length > 0) {
      const waiter = this.waitQueue.shift()!;
      const next = this.tryAcquireSync(waiter.readOnly);
      if (next) {
        this.prepareConnection(next).then(waiter.resolve).catch(waiter.reject);
      } else {
        // Put back; nothing free yet
        this.waitQueue.unshift(waiter);
      }
    }
  }

  /**
   * Execute a query function with automatic acquire/release lifecycle.
   *
   * @example
   *   const result = await pool.withConnection(
   *     async (conn) => client.search({ index: 'subs', ... }),
   *     true, // readOnly
   *   );
   */
  async withConnection<T>(
    fn: (conn: PooledConnection) => Promise<T>,
    readOnly = false,
  ): Promise<T> {
    const { connection } = await this.acquire(readOnly);
    try {
      return await fn(connection);
    } finally {
      this.release(connection.id);
    }
  }

  // ── Private: sync acquire ─────────────────────────────────────────────────

  private tryAcquireSync(readOnly: boolean): PooledConnection | null {
    if (readOnly) {
      // Prefer least-recently-used replica
      const replicas = this.pool.filter((c) => c.role === 'replica' && !c.inUse);
      if (replicas.length > 0) {
        const idx = this.replicaRoundRobin % replicas.length;
        this.replicaRoundRobin = (this.replicaRoundRobin + 1) % replicas.length;
        const conn = replicas[idx]!;
        conn.inUse = true;
        conn.acquiredAt = Date.now();
        return conn;
      }
      // Fall through to primary
    }

    // Primary or any free connection
    const free = this.pool.find((c) => !c.inUse);
    if (free) {
      free.inUse = true;
      free.acquiredAt = Date.now();
      return free;
    }

    return null;
  }

  private async prepareConnection(conn: PooledConnection): Promise<AcquireResult> {
    let dnsRefreshed = false;
    try {
      const resolved = await this.dnsCache.resolve(conn.host, this.config.dnsCacheTtlMs);
      if (resolved !== conn.resolvedAddress) {
        conn.resolvedAddress = resolved;
        conn.resolvedAt = Date.now();
        dnsRefreshed = true;
      }
    } catch {
      // DNS resolution failure is non-fatal; proceed with stored address
    }
    return { connection: conn, dnsRefreshed };
  }

  // ── Maintenance ───────────────────────────────────────────────────────────

  private startMaintenance(): void {
    this.maintenanceTimer = setInterval(() => {
      this.runIdleSweep();
      this.runLeakDetection();
    }, this.config.maintenanceIntervalMs);

    // Unref so it doesn't prevent Node process exit
    if (typeof this.maintenanceTimer.unref === 'function') {
      this.maintenanceTimer.unref();
    }
  }

  private runIdleSweep(): void {
    const now = Date.now();
    for (const conn of this.pool) {
      if (!conn.inUse && now - conn.lastUsedAt > this.config.idleTimeoutMs) {
        // "Teardown" the logical connection: reset DNS cache entry so next
        // acquire re-validates (simulates closing and re-opening a socket).
        this.dnsCache.invalidate(conn.host);
        conn.resolvedAddress = undefined;
        conn.resolvedAt = undefined;
        this.emit('idle-teardown', conn.id);
      }
    }
  }

  private runLeakDetection(): void {
    const now = Date.now();
    for (const conn of this.pool) {
      if (conn.inUse && conn.acquiredAt && now - conn.acquiredAt > this.config.leakThresholdMs) {
        const heldMs = now - conn.acquiredAt;
        this.leaksDetected++;
        this.onLeak?.(conn, heldMs);
        this.emit('leak', { connectionId: conn.id, heldMs });
      }
    }
  }

  // ── Pool management ───────────────────────────────────────────────────────

  /**
   * Drain: wait for all active connections to be released (graceful shutdown).
   */
  async drain(timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.activeCount() > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    this.shutdown();
  }

  /**
   * Immediate shutdown — stops maintenance timer and rejects all waiters.
   */
  shutdown(): void {
    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
      this.maintenanceTimer = undefined;
    }
    for (const waiter of this.waitQueue) {
      waiter.reject(new Error('ElasticsearchConnectionPool: shutdown'));
    }
    this.waitQueue.length = 0;
    this.dnsCache.clear();
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  activeCount(): number {
    return this.pool.filter((c) => c.inUse).length;
  }

  idleCount(): number {
    return this.pool.filter((c) => !c.inUse).length;
  }

  size(): number {
    return this.pool.length;
  }

  getConnection(id: string): PooledConnection | undefined {
    return this.pool.find((c) => c.id === id);
  }

  listConnections(): PooledConnection[] {
    return [...this.pool];
  }

  // ── Metrics ───────────────────────────────────────────────────────────────

  getMetrics(): PoolMetrics {
    const dns = this.dnsCache.stats();
    const active = this.activeCount();
    const idle = this.idleCount();
    return {
      totalConnections: this.pool.length,
      activeConnections: active,
      idleConnections: idle,
      acquireTimeouts: this.acquireTimeouts,
      leaksDetected: this.leaksDetected,
      totalAcquires: this.totalAcquires,
      totalReleases: this.totalReleases,
      avgAcquireWaitMs:
        this.totalAcquires > 0
          ? Math.round(this.totalAcquireWaitMs / this.totalAcquires)
          : 0,
      peakActiveConnections: this.peakActiveConnections,
      dnsLookups: dns.lookups,
      dnsCacheHits: dns.hits,
      peakUtilisation:
        this.pool.length > 0 ? this.peakActiveConnections / this.pool.length : 0,
    };
  }

  prometheusMetrics(namespace = 'subtrackr_es_pool'): string {
    const m = this.getMetrics();
    return [
      `# HELP ${namespace}_connections_total Total connections in pool`,
      `# TYPE ${namespace}_connections_total gauge`,
      `${namespace}_connections_total ${m.totalConnections}`,
      `# HELP ${namespace}_connections_active Active (in-use) connections`,
      `# TYPE ${namespace}_connections_active gauge`,
      `${namespace}_connections_active ${m.activeConnections}`,
      `# HELP ${namespace}_connections_idle Idle connections`,
      `# TYPE ${namespace}_connections_idle gauge`,
      `${namespace}_connections_idle ${m.idleConnections}`,
      `# HELP ${namespace}_acquire_timeouts_total Acquire timeout count`,
      `# TYPE ${namespace}_acquire_timeouts_total counter`,
      `${namespace}_acquire_timeouts_total ${m.acquireTimeouts}`,
      `# HELP ${namespace}_leaks_total Leak detection triggers`,
      `# TYPE ${namespace}_leaks_total counter`,
      `${namespace}_leaks_total ${m.leaksDetected}`,
      `# HELP ${namespace}_acquires_total Total acquire operations`,
      `# TYPE ${namespace}_acquires_total counter`,
      `${namespace}_acquires_total ${m.totalAcquires}`,
      `# HELP ${namespace}_avg_acquire_wait_ms Average wait time for acquire (ms)`,
      `# TYPE ${namespace}_avg_acquire_wait_ms gauge`,
      `${namespace}_avg_acquire_wait_ms ${m.avgAcquireWaitMs}`,
      `# HELP ${namespace}_peak_utilisation Peak utilisation ratio (0-1)`,
      `# TYPE ${namespace}_peak_utilisation gauge`,
      `${namespace}_peak_utilisation ${m.peakUtilisation.toFixed(4)}`,
      `# HELP ${namespace}_dns_cache_hits_total DNS cache hits`,
      `# TYPE ${namespace}_dns_cache_hits_total counter`,
      `${namespace}_dns_cache_hits_total ${m.dnsCacheHits}`,
    ].join('\n');
  }

  /**
   * Returns tuning recommendations based on observed peak utilisation.
   */
  getTuningRecommendations(): string[] {
    const m = this.getMetrics();
    const recs: string[] = [];

    if (m.peakUtilisation > 0.9) {
      recs.push(
        `Pool is at ${(m.peakUtilisation * 100).toFixed(0)}% peak utilisation. ` +
          `Consider increasing poolSize from ${this.config.poolSize} to ${Math.ceil(this.config.poolSize * 1.5)}.`,
      );
    }
    if (m.acquireTimeouts > 0) {
      recs.push(
        `${m.acquireTimeouts} acquire timeout(s) detected. ` +
          `Increase acquireTimeoutMs (current: ${this.config.acquireTimeoutMs}ms) or pool size.`,
      );
    }
    if (m.leaksDetected > 0) {
      recs.push(
        `${m.leaksDetected} connection leak(s) detected (held > ${this.config.leakThresholdMs}ms). ` +
          `Ensure all code paths call pool.release() or use pool.withConnection().`,
      );
    }
    if (m.avgAcquireWaitMs > 100) {
      recs.push(
        `Average acquire wait is ${m.avgAcquireWaitMs}ms. ` +
          `Consider increasing pool size or optimising query durations.`,
      );
    }
    if (m.peakUtilisation < 0.2 && this.config.poolSize > 5) {
      recs.push(
        `Peak utilisation is only ${(m.peakUtilisation * 100).toFixed(0)}%. ` +
          `Consider reducing poolSize to free resources.`,
      );
    }
    if (m.dnsCacheHits / Math.max(1, m.dnsLookups + m.dnsCacheHits) < 0.5) {
      recs.push(
        `DNS cache hit rate is low. Consider increasing dnsCacheTtlMs ` +
          `(current: ${this.config.dnsCacheTtlMs}ms).`,
      );
    }

    if (recs.length === 0) {
      recs.push('Pool configuration looks healthy. No tuning required at this time.');
    }

    return recs;
  }
}

// ---------------------------------------------------------------------------
// Singleton factory
// ---------------------------------------------------------------------------

let defaultPool: ElasticsearchConnectionPool | undefined;

export function getDefaultPool(config?: ConnectionPoolConfig): ElasticsearchConnectionPool {
  if (!defaultPool) {
    if (!config) {
      throw new Error(
        'ElasticsearchConnectionPool: no default pool initialised. ' +
          'Call getDefaultPool(config) with a valid config first.',
      );
    }
    defaultPool = new ElasticsearchConnectionPool(config);
  }
  return defaultPool;
}

export function resetDefaultPool(): void {
  defaultPool?.shutdown();
  defaultPool = undefined;
}
