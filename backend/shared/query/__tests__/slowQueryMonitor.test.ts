import {
  SlowQueryMonitor,
  fingerprintSql,
  SlowQueryEvent,
  QueryClient,
} from '../slowQueryMonitor';

/**
 * Fake client backed by a controllable clock. `t` is the monitor's "now"; each
 * query advances it by the next value in `durations`, so the measured duration
 * is fully deterministic.
 */
function makeHarness(durations: number[], opts?: { rows?: number; throwOn?: number }) {
  let t = 0;
  let call = 0;
  const now = () => t;
  const client: QueryClient = {
    async query<T>(): Promise<{ rows: T[] }> {
      const idx = call;
      call += 1;
      t += durations[idx] ?? 0;
      if (opts?.throwOn === idx) {
        throw new Error('boom');
      }
      const rows = Array.from({ length: opts?.rows ?? 0 }, () => ({})) as T[];
      return { rows };
    },
  };
  return { client, now };
}

describe('fingerprintSql', () => {
  it('groups queries that differ only in whitespace/comments', () => {
    const a = fingerprintSql('SELECT *   FROM usage_alerts\n   WHERE subscription_id = $1');
    const b = fingerprintSql('-- hot path\nSELECT * FROM usage_alerts WHERE subscription_id = $1');
    expect(a).toBe(b);
  });
});

describe('SlowQueryMonitor', () => {
  it('passes rows through unchanged', async () => {
    const { client, now } = makeHarness([5], { rows: 3 });
    const monitor = new SlowQueryMonitor(client, { now });
    const result = await monitor.query('SELECT 1');
    expect(result.rows).toHaveLength(3);
  });

  it('computes p50/p95/p99 per fingerprint', async () => {
    const durations = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const { client, now } = makeHarness(durations);
    const monitor = new SlowQueryMonitor(client, { now, slowThresholdMs: 1000 });

    for (let i = 0; i < durations.length; i += 1) {
      await monitor.query('SELECT * FROM subscriptions WHERE user_id = $1', ['u']);
    }

    const stats = monitor.getStats();
    expect(stats).toHaveLength(1);
    expect(stats[0].count).toBe(10);
    expect(stats[0].maxMs).toBe(100);
    expect(stats[0].p50Ms).toBe(50);
    expect(stats[0].p95Ms).toBe(100);
    expect(stats[0].p99Ms).toBe(100);
    expect(stats[0].slowCount).toBe(0);
  });

  it('fires onSlowQuery only at/above the threshold', async () => {
    const events: SlowQueryEvent[] = [];
    const { client, now } = makeHarness([50, 100, 150]);
    const monitor = new SlowQueryMonitor(client, {
      now,
      slowThresholdMs: 100,
      onSlowQuery: (e) => events.push(e),
    });

    await monitor.query('SELECT 1'); // 50ms — fast
    await monitor.query('SELECT 2'); // 100ms — slow (>= threshold)
    await monitor.query('SELECT 3'); // 150ms — slow

    expect(events).toHaveLength(2);
    expect(events[0].durationMs).toBe(100);
    expect(events[1].durationMs).toBe(150);
    expect(events.every((e) => !e.failed)).toBe(true);
  });

  it('ranks the slowest patterns first via getTopSlow', async () => {
    const { client, now } = makeHarness([10, 500]);
    const monitor = new SlowQueryMonitor(client, { now, slowThresholdMs: 1000 });

    await monitor.query('SELECT * FROM plans');
    await monitor.query('SELECT * FROM transactions WHERE user_id = $1', ['u']);

    const top = monitor.getTopSlow(1);
    expect(top).toHaveLength(1);
    expect(top[0].sample).toContain('transactions');
    expect(top[0].p95Ms).toBe(500);
  });

  it('records timing and rethrows on query failure', async () => {
    const events: SlowQueryEvent[] = [];
    const { client, now } = makeHarness([200], { throwOn: 0 });
    const monitor = new SlowQueryMonitor(client, {
      now,
      slowThresholdMs: 100,
      onSlowQuery: (e) => events.push(e),
    });

    await expect(monitor.query('SELECT * FROM broken')).rejects.toThrow('boom');

    const stats = monitor.getStats();
    expect(stats[0].count).toBe(1);
    expect(stats[0].maxMs).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0].failed).toBe(true);
  });

  it('reset clears collected stats', async () => {
    const { client, now } = makeHarness([10]);
    const monitor = new SlowQueryMonitor(client, { now });
    await monitor.query('SELECT 1');
    expect(monitor.getStats()).toHaveLength(1);
    monitor.reset();
    expect(monitor.getStats()).toHaveLength(0);
  });
});
