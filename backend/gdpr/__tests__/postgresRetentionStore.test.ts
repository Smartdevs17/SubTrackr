import { PostgresRetentionStore, createDefaultRetentionStores } from '../postgresRetentionStore';
import type { Pool, QueryResult, PoolClient } from '../../shared/db/connectionPool';

/** Mock pool that captures queries and returns canned results. */
function createMockPool(): Pool & {
  queries: { sql: string; params: unknown[] }[];
  setResult: (rows: unknown[]) => void;
} {
  const queries: { sql: string; params: unknown[] }[] = [];
  let nextRows: unknown[] = [];

  const pool: Pool & {
    queries: { sql: string; params: unknown[] }[];
    setResult: (rows: unknown[]) => void;
  } = {
    totalCount: 0,
    idleCount: 0,
    waitingCount: 0,
    queries,
    setResult: (rows: unknown[]) => { nextRows = rows; },
    query: jest.fn(async <T = unknown>(sql: string, params?: unknown[]): Promise<QueryResult<T>> => {
      queries.push({ sql, params: params ?? [] });
      return { rows: nextRows as T[], rowCount: nextRows.length };
    }),
    connect: jest.fn(async (): Promise<PoolClient> => ({
      query: jest.fn(async <T = unknown>(sql: string, params?: unknown[]): Promise<QueryResult<T>> => {
        queries.push({ sql, params: params ?? [] });
        return { rows: nextRows as T[], rowCount: nextRows.length };
      }),
      release: jest.fn(),
    })),
    end: jest.fn(),
    on: jest.fn(),
  };
  return pool;
}

describe('PostgresRetentionStore', () => {
  it('findExpired queries with cutoff and excludes legal holds', async () => {
    const pool = createMockPool();
    pool.setResult([
      { id: 'r1', user_id: 'u1', ts: new Date('2026-01-01') },
      { id: 'r2', user_id: null, ts: new Date('2026-01-02') },
    ]);

    const store = new PostgresRetentionStore(pool, {
      sourceName: 'activity_logs',
      table: 'activity_logs',
    });

    const records = await store.findExpired(Date.UTC(2026, 2, 1), 100);

    expect(records).toHaveLength(2);
    expect(records[0].id).toBe('r1');
    expect(records[0].userId).toBe('u1');
    expect(records[1].userId).toBeUndefined();

    const query = pool.queries[0];
    expect(query.sql).toContain('WHERE created_at <= $1');
    expect(query.sql).toContain('retention_legal_holds');
    expect(query.sql).toContain('ORDER BY created_at ASC');
    expect(query.params[1]).toBe('activity_logs');
    expect(query.params[2]).toBe(100);
  });

  it('deleteRecords returns rowCount', async () => {
    const pool = createMockPool();
    pool.setResult([]);

    const store = new PostgresRetentionStore(pool, {
      sourceName: 'notifications',
      table: 'notifications',
    });

    // Override rowCount
    (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [], rowCount: 5 });

    const count = await store.deleteRecords(['a', 'b', 'c']);
    expect(count).toBe(5);
    expect(pool.queries[0].sql).toContain('DELETE FROM notifications');
    expect(pool.queries[0].sql).toContain('ANY($1::text[])');
  });

  it('deleteRecords returns 0 for empty array', async () => {
    const pool = createMockPool();
    const store = new PostgresRetentionStore(pool, { sourceName: 'x', table: 'x' });
    const count = await store.deleteRecords([]);
    expect(count).toBe(0);
    expect(pool.queries).toHaveLength(0);
  });

  it('anonymizeRecords updates PII columns', async () => {
    const pool = createMockPool();
    (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [], rowCount: 3 });

    const store = new PostgresRetentionStore(pool, {
      sourceName: 'billing_records',
      table: 'billing_records',
    });

    const count = await store.anonymizeRecords(['r1', 'r2', 'r3']);
    expect(count).toBe(3);
    expect(pool.queries[0].sql).toContain('SET email = NULL');
    expect(pool.queries[0].sql).toContain('name = NULL');
  });

  it('anonymizeRecords returns 0 for empty array', async () => {
    const pool = createMockPool();
    const store = new PostgresRetentionStore(pool, { sourceName: 'x', table: 'x' });
    expect(await store.anonymizeRecords([])).toBe(0);
  });

  it('archiveRecords sets archived_at', async () => {
    const pool = createMockPool();
    (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [], rowCount: 2 });

    const store = new PostgresRetentionStore(pool, { sourceName: 'x', table: 'x' });
    const count = await store.archiveRecords(['r1', 'r2']);
    expect(count).toBe(2);
    expect(pool.queries[0].sql).toContain('archived_at = now()');
  });

  it('archiveRecords returns 0 for empty array', async () => {
    const pool = createMockPool();
    const store = new PostgresRetentionStore(pool, { sourceName: 'x', table: 'x' });
    expect(await store.archiveRecords([])).toBe(0);
  });

  it('uses custom column names when provided', async () => {
    const pool = createMockPool();
    pool.setResult([]);

    const store = new PostgresRetentionStore(pool, {
      sourceName: 'audit_logs',
      table: 'audit_events',
      timestampColumn: 'created_at',
      idColumn: 'id',
      userIdColumn: 'actor_id',
    });

    await store.findExpired(Date.now(), 50);
    expect(pool.queries[0].sql).toContain('actor_id AS user_id');
  });
});

describe('createDefaultRetentionStores', () => {
  it('creates stores for all default sources', () => {
    const pool = createMockPool();
    const stores = createDefaultRetentionStores(pool);
    expect(stores.size).toBe(4);
    expect(stores.has('activity_logs')).toBe(true);
    expect(stores.has('notifications')).toBe(true);
    expect(stores.has('billing_records')).toBe(true);
    expect(stores.has('audit_logs')).toBe(true);
  });

  it('each store has the correct sourceName', () => {
    const pool = createMockPool();
    const stores = createDefaultRetentionStores(pool);
    for (const [name, store] of stores) {
      expect(store.sourceName).toBe(name);
    }
  });
});
