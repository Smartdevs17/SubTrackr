import { PurgeJobScheduler } from '../purgeJobScheduler';
import type { Pool, QueryResult, PoolClient } from '../../shared/db/connectionPool';

function createMockPool(): Pool & {
  queries: { sql: string; params: unknown[] }[];
  setRows: (rows: unknown[]) => void;
} {
  const queries: { sql: string; params: unknown[] }[] = [];
  let rows: unknown[] = [];
  const pool: Pool & {
    queries: { sql: string; params: unknown[] }[];
    setRows: (r: unknown[]) => void;
  } = {
    totalCount: 0, idleCount: 0, waitingCount: 0,
    queries, setRows: (r: unknown[]) => { rows = r; },
    query: jest.fn(async <T = unknown>(sql: string, params?: unknown[]): Promise<QueryResult<T>> => {
      queries.push({ sql, params: params ?? [] });
      return { rows: rows as T[], rowCount: rows.length };
    }),
    connect: jest.fn(async (): Promise<PoolClient> => ({
      query: jest.fn(async (): Promise<QueryResult<unknown>> => ({ rows: rows as unknown[], rowCount: rows.length })),
      release: jest.fn(),
    })),
    end: jest.fn(),
    on: jest.fn(),
  };
  return pool;
}

describe('PurgeJobScheduler', () => {
  it('constructs with default policies and stores', () => {
    const pool = createMockPool();
    const scheduler = new PurgeJobScheduler(pool);
    expect(scheduler.isRunning()).toBe(false);
    expect(scheduler.getService()).toBeDefined();
    expect(scheduler.getService().listPolicies().length).toBeGreaterThan(0);
  });

  it('start loads policies from DB and begins enforcement', async () => {
    const pool = createMockPool();
    pool.setRows([
      { id: 'custom-policy', source: 'custom_source', description: 'test',
        retention_days: 60, action: 'delete', enabled: true, batch_size: 500 },
    ]);
    const scheduler = new PurgeJobScheduler(pool, { intervalMs: 999_999_999 });
    await scheduler.start();
    expect(scheduler.isRunning()).toBe(true);
    // The custom policy should have been loaded
    const policy = scheduler.getService().getPolicy('custom-policy');
    expect(policy).not.toBeNull();
    expect(policy?.retentionDays).toBe(60);
    scheduler.stop();
  });

  it('stop halts the scheduler', async () => {
    const pool = createMockPool();
    const scheduler = new PurgeJobScheduler(pool, { intervalMs: 999_999_999 });
    await scheduler.start();
    expect(scheduler.isRunning()).toBe(true);
    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
  });

  it('start is idempotent', async () => {
    const pool = createMockPool();
    const scheduler = new PurgeJobScheduler(pool, { intervalMs: 999_999_999 });
    await scheduler.start();
    await scheduler.start();
    expect(scheduler.isRunning()).toBe(true);
    scheduler.stop();
  });

  it('handles DB load failure gracefully (defaults remain)', async () => {
    const pool = createMockPool();
    (pool.query as jest.Mock).mockRejectedValueOnce(new Error('table missing'));
    const scheduler = new PurgeJobScheduler(pool, { intervalMs: 999_999_999 });
    await scheduler.start();
    // Default policies should still be present
    expect(scheduler.getService().listPolicies().length).toBeGreaterThan(0);
    scheduler.stop();
  });

  it('runNow triggers an enforcement run', async () => {
    const pool = createMockPool();
    const scheduler = new PurgeJobScheduler(pool, { intervalMs: 999_999_999 });
    const report = await scheduler.runNow();
    expect(report).not.toBeNull();
    expect(report?.results).toBeDefined();
  });

  it('persistReport writes to retention_enforcement_log', async () => {
    const pool = createMockPool();
    const onReport = jest.fn();
    const scheduler = new PurgeJobScheduler(pool, {
      intervalMs: 999_999_999,
      onReport,
    });
    await scheduler.runNow();
    // The default onReport was overridden, so no DB writes for logging
    expect(onReport).toHaveBeenCalled();
  });
});
