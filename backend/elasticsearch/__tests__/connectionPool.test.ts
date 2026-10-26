/**
 * Tests — ElasticsearchConnectionPool (Issue #986)
 */

import {
  ElasticsearchConnectionPool,
  DnsCache,
  resetDefaultPool,
  type ConnectionPoolConfig,
} from '../connectionPool';

const BASE_CONFIG: ConnectionPoolConfig = {
  primaryHost: 'es-primary',
  primaryPort: 9200,
  poolSize: 5,
  acquireTimeoutMs: 200,
  idleTimeoutMs: 500,
  leakThresholdMs: 300,
  dnsCacheTtlMs: 1_000,
  maintenanceIntervalMs: 100,
};

describe('ElasticsearchConnectionPool', () => {
  let pool: ElasticsearchConnectionPool;

  beforeEach(() => {
    jest.useFakeTimers();
    pool = new ElasticsearchConnectionPool(BASE_CONFIG);
  });

  afterEach(() => {
    pool.shutdown();
    resetDefaultPool();
    jest.useRealTimers();
  });

  // ── Pool initialisation ───────────────────────────────────────────────────

  it('initialises pool with correct size', () => {
    expect(pool.size()).toBe(BASE_CONFIG.poolSize);
    expect(pool.idleCount()).toBe(BASE_CONFIG.poolSize);
    expect(pool.activeCount()).toBe(0);
  });

  it('assigns primary role to all connections when no replicas', () => {
    const conns = pool.listConnections();
    expect(conns.every((c) => c.role === 'primary')).toBe(true);
  });

  it('assigns replica roles when replicas configured', () => {
    const p = new ElasticsearchConnectionPool({
      ...BASE_CONFIG,
      replicas: [{ host: 'replica-1', port: 9201 }],
      poolSize: 4,
    });
    const roles = p.listConnections().map((c) => c.role);
    expect(roles).toContain('replica');
    expect(roles).toContain('primary');
    p.shutdown();
  });

  // ── Acquire / Release ─────────────────────────────────────────────────────

  it('acquire returns a connection and marks it in-use', async () => {
    const { connection } = await pool.acquire();
    expect(connection.inUse).toBe(true);
    expect(connection.acquiredAt).toBeDefined();
  });

  it('release frees connection back to pool', async () => {
    const { connection } = await pool.acquire();
    expect(pool.activeCount()).toBe(1);
    pool.release(connection.id);
    expect(pool.activeCount()).toBe(0);
    expect(pool.idleCount()).toBe(BASE_CONFIG.poolSize);
  });

  it('queued acquires are resolved after release', async () => {
    // Exhaust pool
    const acquired: Array<{ connection: { id: string } }> = [];
    for (let i = 0; i < BASE_CONFIG.poolSize; i++) {
      acquired.push(await pool.acquire());
    }
    expect(pool.idleCount()).toBe(0);

    // Queue a waiter
    const waiting = pool.acquire();
    // Release one connection
    pool.release(acquired[0]!.connection.id);

    const resolved = await waiting;
    expect(resolved.connection.inUse).toBe(true);
    // Cleanup
    for (let i = 1; i < acquired.length; i++) pool.release(acquired[i]!.connection.id);
    pool.release(resolved.connection.id);
  });

  it('acquire times out when pool exhausted', async () => {
    // Exhaust all connections
    const acquired: Array<{ connection: { id: string } }> = [];
    for (let i = 0; i < BASE_CONFIG.poolSize; i++) {
      acquired.push(await pool.acquire());
    }

    const p = pool.acquire();
    jest.advanceTimersByTime(BASE_CONFIG.acquireTimeoutMs + 10);
    await expect(p).rejects.toThrow('acquire timed out');

    // Cleanup
    for (const a of acquired) pool.release(a.connection.id);
  });

  it('release is a no-op for unknown connection id', () => {
    expect(() => pool.release('nonexistent')).not.toThrow();
  });

  // ── withConnection ────────────────────────────────────────────────────────

  it('withConnection releases connection even when fn throws', async () => {
    await expect(
      pool.withConnection(async () => {
        throw new Error('query failed');
      }),
    ).rejects.toThrow('query failed');
    expect(pool.idleCount()).toBe(BASE_CONFIG.poolSize);
  });

  it('withConnection passes connection to fn', async () => {
    const result = await pool.withConnection(async (conn) => conn.id);
    expect(typeof result).toBe('string');
  });

  // ── Read routing ──────────────────────────────────────────────────────────

  it('readOnly acquire prefers replica connections', async () => {
    const p = new ElasticsearchConnectionPool({
      ...BASE_CONFIG,
      replicas: [{ host: 'replica-1', port: 9201 }],
      poolSize: 4,
    });
    const { connection } = await p.acquire(true);
    expect(connection.role).toBe('replica');
    p.release(connection.id);
    p.shutdown();
  });

  it('readOnly falls back to primary when replicas exhausted', async () => {
    const p = new ElasticsearchConnectionPool({
      ...BASE_CONFIG,
      replicas: [{ host: 'replica-1', port: 9201 }],
      poolSize: 4,
    });
    const replicas = p.listConnections().filter((c) => c.role === 'replica');
    // Acquire all replicas
    for (const r of replicas) await p.acquire(true);

    // Next read-only acquire should fall back to primary
    const { connection } = await p.acquire(true);
    expect(connection.role).toBe('primary');
    p.shutdown();
  });

  // ── Leak detection ────────────────────────────────────────────────────────

  it('emits leak event for long-held connections', async () => {
    const leaks: string[] = [];
    pool.on('leak', ({ connectionId }) => leaks.push(connectionId));

    const { connection } = await pool.acquire();
    jest.advanceTimersByTime(BASE_CONFIG.leakThresholdMs + BASE_CONFIG.maintenanceIntervalMs + 50);
    await Promise.resolve(); // flush

    expect(leaks).toContain(connection.id);
    expect(pool.getMetrics().leaksDetected).toBeGreaterThanOrEqual(1);
    pool.release(connection.id);
  });

  // ── Idle teardown ─────────────────────────────────────────────────────────

  it('emits idle-teardown for long-idle connections', async () => {
    const teardowns: string[] = [];
    pool.on('idle-teardown', (id) => teardowns.push(id));

    const { connection } = await pool.acquire();
    pool.release(connection.id);
    jest.advanceTimersByTime(BASE_CONFIG.idleTimeoutMs + BASE_CONFIG.maintenanceIntervalMs + 50);
    await Promise.resolve();

    expect(teardowns.length).toBeGreaterThan(0);
  });

  // ── Metrics ───────────────────────────────────────────────────────────────

  it('tracks acquires and releases in metrics', async () => {
    const { connection } = await pool.acquire();
    pool.release(connection.id);
    const m = pool.getMetrics();
    expect(m.totalAcquires).toBe(1);
    expect(m.totalReleases).toBe(1);
    expect(m.peakActiveConnections).toBe(1);
  });

  it('tracks acquire timeouts in metrics', async () => {
    for (let i = 0; i < BASE_CONFIG.poolSize; i++) await pool.acquire();
    const p = pool.acquire();
    jest.advanceTimersByTime(BASE_CONFIG.acquireTimeoutMs + 10);
    await expect(p).rejects.toThrow();
    expect(pool.getMetrics().acquireTimeouts).toBe(1);
  });

  it('prometheusMetrics returns valid format', async () => {
    const prom = pool.prometheusMetrics();
    expect(prom).toContain('subtrackr_es_pool_connections_total');
    expect(prom).toContain('subtrackr_es_pool_acquire_timeouts_total');
  });

  // ── Tuning recommendations ────────────────────────────────────────────────

  it('recommends pool increase at high utilisation', async () => {
    // Acquire all connections to simulate peak
    const acquired = await Promise.all(
      Array.from({ length: BASE_CONFIG.poolSize }, () => pool.acquire()),
    );
    for (const a of acquired) pool.release(a.connection.id);

    const recs = pool.getTuningRecommendations();
    // At 100% peak utilisation should recommend increase
    expect(recs.some((r) => r.includes('poolSize'))).toBe(true);
  });

  it('reports healthy when under-utilised', () => {
    const recs = pool.getTuningRecommendations();
    // Fresh pool with 0 acquires — low utilisation
    expect(recs.length).toBeGreaterThan(0);
  });

  // ── Shutdown ──────────────────────────────────────────────────────────────

  it('shutdown rejects pending waiters', async () => {
    for (let i = 0; i < BASE_CONFIG.poolSize; i++) await pool.acquire();
    const p = pool.acquire();
    pool.shutdown();
    await expect(p).rejects.toThrow('shutdown');
  });
});

// ---------------------------------------------------------------------------
// DnsCache
// ---------------------------------------------------------------------------

describe('DnsCache', () => {
  it('caches resolved addresses', async () => {
    const cache = new DnsCache();
    await cache.resolve('es-primary', 1_000);
    await cache.resolve('es-primary', 1_000);
    expect(cache.stats().hits).toBe(1);
    expect(cache.stats().lookups).toBe(1);
  });

  it('invalidates cache entry', async () => {
    const cache = new DnsCache();
    await cache.resolve('es-primary', 1_000);
    cache.invalidate('es-primary');
    await cache.resolve('es-primary', 1_000);
    expect(cache.stats().lookups).toBe(2);
    expect(cache.stats().hits).toBe(0);
  });

  it('re-resolves after TTL expires', async () => {
    jest.useFakeTimers();
    const cache = new DnsCache();
    await cache.resolve('es-node', 100);
    jest.advanceTimersByTime(200);
    await cache.resolve('es-node', 100);
    expect(cache.stats().lookups).toBe(2);
    jest.useRealTimers();
  });
});
