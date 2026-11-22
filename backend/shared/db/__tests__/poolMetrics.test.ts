import { PoolMetricsCollector, type PoolMetricsSnapshot } from '../poolMetrics';
import type { Pool } from '../connectionPool';

/** Mock pool that simulates pg-pool counters. */
function createMockPool(overrides: Partial<Pool & { max: number }> = {}): Pool & {
  max: number;
  setCounts: (total: number, idle: number, waiting: number) => void;
} {
  let totalCount = 0;
  let idleCount = 0;
  let waitingCount = 0;
  const max = overrides.max ?? 20;

  const pool: Pool & { max: number; setCounts: (t: number, i: number, w: number) => void } = {
    max,
    get totalCount() { return totalCount; },
    get idleCount() { return idleCount; },
    get waitingCount() { return waitingCount; },
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn(),
    on: jest.fn(),
    setCounts: (t: number, i: number, w: number) => {
      totalCount = t;
      idleCount = i;
      waitingCount = w;
    },
  };
  return pool;
}

describe('PoolMetricsCollector', () => {
  it('takes a snapshot with correct derived fields', () => {
    const pool = createMockPool({ max: 20 });
    pool.setCounts(15, 8, 0);

    const collector = new PoolMetricsCollector(pool);
    const snapshot = collector.sample();

    expect(snapshot.totalCount).toBe(15);
    expect(snapshot.idleCount).toBe(8);
    expect(snapshot.waitingCount).toBe(0);
    expect(snapshot.activeCount).toBe(7);
    expect(snapshot.maxConnections).toBe(20);
    expect(snapshot.utilization).toBeCloseTo(0.35, 2);
    expect(snapshot.saturated).toBe(false);
  });

  it('detects saturation when waitingCount > 0', () => {
    const pool = createMockPool({ max: 10 });
    pool.setCounts(10, 0, 3);

    const collector = new PoolMetricsCollector(pool);
    const snapshot = collector.sample();

    expect(snapshot.saturated).toBe(true);
    expect(snapshot.activeCount).toBe(10);
    expect(snapshot.utilization).toBe(1);
  });

  it('calls onSnapshot for each sample', () => {
    const pool = createMockPool({ max: 20 });
    pool.setCounts(5, 3, 0);

    const snapshots: PoolMetricsSnapshot[] = [];
    const collector = new PoolMetricsCollector(pool, {
      onSnapshot: (s) => snapshots.push(s),
    });

    collector.sample();
    pool.setCounts(8, 4, 0);
    collector.sample();

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].activeCount).toBe(2);
    expect(snapshots[1].activeCount).toBe(4);
  });

  it('fires onAlert when utilization crosses the threshold (edge-triggered)', () => {
    const pool = createMockPool({ max: 10 });
    pool.setCounts(7, 3, 0); // 40% utilization

    const alerts: PoolMetricsSnapshot[] = [];
    const collector = new PoolMetricsCollector(pool, {
      alertThreshold: 0.8,
      onAlert: (s) => alerts.push(s),
    });

    collector.sample(); // 40% — no alert
    expect(alerts).toHaveLength(0);

    pool.setCounts(9, 1, 0); // 80% — crosses threshold
    collector.sample();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].utilization).toBeGreaterThanOrEqual(0.8);

    pool.setCounts(10, 0, 0); // 100% — still alerting, no new alert
    collector.sample();
    expect(alerts).toHaveLength(1); // edge-triggered

    pool.setCounts(5, 5, 0); // 0% — clears alerting
    collector.sample();
    expect(alerts).toHaveLength(1);

    pool.setCounts(9, 1, 0); // 80% — re-crosses threshold
    collector.sample();
    expect(alerts).toHaveLength(2); // new alert after recovery
  });

  it('getHealthSummary reports healthy under normal load', () => {
    const pool = createMockPool({ max: 20 });
    pool.setCounts(10, 5, 0);

    const collector = new PoolMetricsCollector(pool, { alertThreshold: 0.8 });
    collector.sample();

    const health = collector.getHealthSummary();
    expect(health.healthy).toBe(true);
    expect(health.saturated).toBe(false);
    expect(health.snapshot).not.toBeNull();
  });

  it('getHealthSummary reports unhealthy when saturated', () => {
    const pool = createMockPool({ max: 10 });
    pool.setCounts(10, 0, 5);

    const collector = new PoolMetricsCollector(pool);
    collector.sample();

    const health = collector.getHealthSummary();
    expect(health.healthy).toBe(false);
    expect(health.saturated).toBe(true);
  });

  it('getHealthSummary returns healthy before any sample is taken', () => {
    const pool = createMockPool();
    const collector = new PoolMetricsCollector(pool);
    const health = collector.getHealthSummary();
    expect(health.healthy).toBe(true);
    expect(health.snapshot).toBeNull();
  });

  it('start and stop control the sampling interval', () => {
    const pool = createMockPool({ max: 20 });
    pool.setCounts(5, 3, 0);

    const collector = new PoolMetricsCollector(pool, { intervalMs: 100 });
    expect(collector.isRunning()).toBe(false);

    collector.start();
    expect(collector.isRunning()).toBe(true);

    collector.stop();
    expect(collector.isRunning()).toBe(false);
  });

  it('start is idempotent', () => {
    const pool = createMockPool();
    const collector = new PoolMetricsCollector(pool, { intervalMs: 100 });
    collector.start();
    collector.start();
    expect(collector.isRunning()).toBe(true);
    collector.stop();
  });

  it('getLastSnapshot returns the most recent sample', () => {
    const pool = createMockPool({ max: 20 });
    pool.setCounts(5, 3, 0);

    const collector = new PoolMetricsCollector(pool);
    expect(collector.getLastSnapshot()).toBeNull();

    collector.sample();
    expect(collector.getLastSnapshot()).not.toBeNull();
    expect(collector.getLastSnapshot()?.activeCount).toBe(2);
  });

  it('handles zero maxConnections gracefully', () => {
    const pool = createMockPool({ max: 0 });
    pool.setCounts(0, 0, 0);

    const collector = new PoolMetricsCollector(pool);
    const snapshot = collector.sample();

    expect(snapshot.utilization).toBe(0);
    expect(snapshot.maxConnections).toBe(0);
  });
});
