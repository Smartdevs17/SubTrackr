import type { DatabaseConfig } from '../../../config/database';
import type { Pool, QueryResult } from '../connectionPool';
import {
  ReadWritePool,
  attachRoutingHeaderInterceptor,
  computeLagP99,
  createRoutingContextFromRequest,
  parseStaleAcceptHeader,
  runWithQueryRoutingContext,
} from '../readWriteRouter';
import { formatReplicationPrometheus, collectReplicationMetrics } from '../../../monitoring/replicationLagExporter';

function makeMockPool(label: string, fail = false): Pool {
  return {
    query: jest.fn(async (sql: string) => {
      if (fail) throw new Error(`${label} unavailable`);
      if (sql.includes('pg_last_xact_replay_timestamp')) {
        return { rows: [{ lag_ms: label === 'replica-1' ? 500 : 200 }], rowCount: 1 };
      }
      return { rows: [{ source: label }], rowCount: 1 } as QueryResult<{ source: string }>;
    }),
    connect: jest.fn(),
    end: jest.fn(),
    on: jest.fn(),
    totalCount: 10,
    idleCount: 5,
    waitingCount: 0,
  } as unknown as Pool;
}

function makeConfig(overrides: Partial<DatabaseConfig> = {}): DatabaseConfig {
  return {
    primary: {
      host: 'primary',
      port: 5432,
      database: 'subtrackr',
      user: 'postgres',
      password: '',
      max: 20,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 30_000,
      statementTimeout: 30_000,
      ssl: false,
    },
    replicas: [
      { name: 'replica-1', host: 'replica-1', port: 6433 },
      { name: 'replica-2', host: 'replica-2', port: 6434 },
    ],
    replicaPoolSize: 25,
    replicationLagP99AlarmMs: 1_000,
    replicationLagFailoverMs: 5_000,
    staleReadDefaultSeconds: 30,
    lagPollIntervalMs: 60_000,
    ...overrides,
  };
}

describe('readWriteRouter', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('parseStaleAcceptHeader', () => {
    it('parses valid header values', () => {
      expect(parseStaleAcceptHeader('30')).toBe(30);
      expect(parseStaleAcceptHeader(['15'])).toBe(15);
    });

    it('returns undefined for missing or invalid values', () => {
      expect(parseStaleAcceptHeader(undefined)).toBeUndefined();
      expect(parseStaleAcceptHeader('')).toBeUndefined();
      expect(parseStaleAcceptHeader('abc')).toBeUndefined();
      expect(parseStaleAcceptHeader('0')).toBeUndefined();
    });
  });

  describe('createRoutingContextFromRequest', () => {
    it('reads X-Stale-Accept header', () => {
      const ctx = createRoutingContextFromRequest({ 'x-stale-accept': '30' });
      expect(ctx.staleAcceptSeconds).toBe(30);
      expect(ctx.responseHeaders).toBeInstanceOf(Map);
    });

    it('defaults stale accept for analytics requests', () => {
      const ctx = createRoutingContextFromRequest({ 'x-analytics-request': 'true' });
      expect(ctx.staleAcceptSeconds).toBe(30);
    });
  });

  describe('ReadWritePool', () => {
    it('routes SELECT to a read replica', async () => {
      const primary = makeMockPool('primary');
      const replica1 = makeMockPool('replica-1');
      const replica2 = makeMockPool('replica-2');
      const replicas = new Map([
        ['replica-1', replica1],
        ['replica-2', replica2],
      ]);

      const pool = new ReadWritePool(primary, replicas, makeConfig().replicas, makeConfig());
      await pool.pollReplicationLag();

      const responseHeaders = new Map<string, string>();
      await runWithQueryRoutingContext({ responseHeaders }, async () => {
        const result = await pool.query('SELECT * FROM plans');
        expect(result.rows[0]).toEqual({ source: expect.stringMatching(/replica/) });
      });

      expect(primary.query).not.toHaveBeenCalled();
      expect(responseHeaders.get('X-DB-Route')).toMatch(/^replica:/);
    });

    it('routes INSERT to primary', async () => {
      const primary = makeMockPool('primary');
      const replica1 = makeMockPool('replica-1');
      const pool = new ReadWritePool(
        primary,
        new Map([['replica-1', replica1]]),
        [{ name: 'replica-1', host: 'r1', port: 6433 }],
        makeConfig({ replicas: [{ name: 'replica-1', host: 'r1', port: 6433 }] }),
      );

      await pool.query('INSERT INTO plans (id) VALUES ($1)', ['p1']);
      expect(primary.query).toHaveBeenCalled();
      expect(replica1.query).not.toHaveBeenCalled();
    });

    it('falls back to primary when replica lag exceeds failover threshold', async () => {
      const primary = makeMockPool('primary');
      const replica1 = makeMockPool('replica-1');
      replica1.query = jest.fn(async (sql: string) => {
        if (sql.includes('pg_last_xact_replay_timestamp')) {
          return { rows: [{ lag_ms: 6_000 }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      });

      const pool = new ReadWritePool(
        primary,
        new Map([['replica-1', replica1]]),
        [{ name: 'replica-1', host: 'r1', port: 6433 }],
        makeConfig({ replicas: [{ name: 'replica-1', host: 'r1', port: 6433 }] }),
      );
      await pool.pollReplicationLag();

      const responseHeaders = new Map<string, string>();
      await runWithQueryRoutingContext({ responseHeaders }, async () => {
        await pool.query('SELECT 1');
      });

      expect(primary.query).toHaveBeenCalledWith('SELECT 1', undefined);
      expect(responseHeaders.get('X-DB-Route')).toBe('primary');
      expect(responseHeaders.get('X-DB-Route-Reason')).toBe('lag-or-unavailable');
      expect(responseHeaders.get('X-DB-Route-Warning')).toBe('replication-lag-fallback-primary');
    });

    it('allows higher lag for analytics with X-Stale-Accept', async () => {
      const primary = makeMockPool('primary');
      const replica1 = makeMockPool('replica-1');
      replica1.query = jest.fn(async (sql: string) => {
        if (sql.includes('pg_last_xact_replay_timestamp')) {
          return { rows: [{ lag_ms: 10_000 }], rowCount: 1 };
        }
        return { rows: [{ source: 'replica-1' }], rowCount: 1 };
      });

      const pool = new ReadWritePool(
        primary,
        new Map([['replica-1', replica1]]),
        [{ name: 'replica-1', host: 'r1', port: 6433 }],
        makeConfig({ replicas: [{ name: 'replica-1', host: 'r1', port: 6433 }] }),
      );
      await pool.pollReplicationLag();

      const responseHeaders = new Map<string, string>();
      await runWithQueryRoutingContext({ staleAcceptSeconds: 30, responseHeaders }, async () => {
        await pool.query('SELECT COUNT(*) FROM transactions');
      });

      expect(primary.query).not.toHaveBeenCalledWith('SELECT COUNT(*) FROM transactions', undefined);
      expect(responseHeaders.get('X-DB-Route')).toBe('replica:replica-1');
    });

    it('falls back to primary when replica query fails', async () => {
      const primary = makeMockPool('primary');
      const replica1 = makeMockPool('replica-1');
      replica1.query = jest.fn(async (sql: string) => {
        if (sql.includes('pg_last_xact_replay_timestamp')) {
          return { rows: [{ lag_ms: 100 }], rowCount: 1 };
        }
        throw new Error('replica-1 unavailable');
      });

      const pool = new ReadWritePool(
        primary,
        new Map([['replica-1', replica1]]),
        [{ name: 'replica-1', host: 'r1', port: 6433 }],
        makeConfig({ replicas: [{ name: 'replica-1', host: 'r1', port: 6433 }] }),
      );
      await pool.pollReplicationLag();

      const responseHeaders = new Map<string, string>();
      await runWithQueryRoutingContext({ responseHeaders }, async () => {
        await pool.query('SELECT 1');
      });

      expect(primary.query).toHaveBeenCalledWith('SELECT 1', undefined);
      expect(responseHeaders.get('X-DB-Route-Warning')).toBe('replica-unavailable-fallback-primary');
    });

    it('connect() always uses primary for transactions', async () => {
      const primary = makeMockPool('primary');
      const client = { query: jest.fn(), release: jest.fn() };
      primary.connect = jest.fn(async () => client);

      const pool = new ReadWritePool(primary, new Map(), [], makeConfig({ replicas: [] }));
      const connected = await pool.connect();
      expect(connected).toBe(client);
      expect(primary.connect).toHaveBeenCalled();
    });

    it('round-robins across healthy replicas', async () => {
      const primary = makeMockPool('primary');
      const replica1 = makeMockPool('replica-1');
      const replica2 = makeMockPool('replica-2');
      const pool = new ReadWritePool(
        primary,
        new Map([
          ['replica-1', replica1],
          ['replica-2', replica2],
        ]),
        makeConfig().replicas,
        makeConfig(),
      );
      await pool.pollReplicationLag();

      const routes: string[] = [];
      for (let i = 0; i < 4; i++) {
        const responseHeaders = new Map<string, string>();
        await runWithQueryRoutingContext({ responseHeaders }, async () => {
          await pool.query('SELECT 1');
          routes.push(responseHeaders.get('X-DB-Route') ?? '');
        });
      }

      expect(routes).toContain('replica:replica-1');
      expect(routes).toContain('replica:replica-2');
      expect(routes[0]).toBe('replica:replica-1');
    });

    it('tracks rolling P99 lag samples', async () => {
      expect(computeLagP99([])).toBe(0);
      expect(computeLagP99([100, 200, 300, 400, 500])).toBe(500);

      const primary = makeMockPool('primary');
      const replica1 = makeMockPool('replica-1');
      let pollCount = 0;
      replica1.query = jest.fn(async (sql: string) => {
        if (sql.includes('pg_last_xact_replay_timestamp')) {
          pollCount += 1;
          return { rows: [{ lag_ms: pollCount * 100 }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      });

      const pool = new ReadWritePool(
        primary,
        new Map([['replica-1', replica1]]),
        [{ name: 'replica-1', host: 'r1', port: 6433 }],
        makeConfig({ replicas: [{ name: 'replica-1', host: 'r1', port: 6433 }] }),
      );

      await pool.pollReplicationLag();
      await pool.pollReplicationLag();
      await pool.pollReplicationLag();

      const [state] = pool.getLagStates();
      expect(state?.lagMs).toBe(300);
      expect(state?.lagP99Ms).toBe(300);
    });
  });

  describe('attachRoutingHeaderInterceptor', () => {
    it('applies routing headers on writeHead', () => {
      const headers: Record<string, string | number> = {};
      const res = {
        headersSent: false,
        setHeader: (name: string, value: string) => {
          headers[name] = value;
        },
        writeHead: jest.fn(function (this: { headersSent: boolean }, ..._args: unknown[]) {
          this.headersSent = true;
          return this;
        }),
        end: jest.fn(),
      };

      const context = createRoutingContextFromRequest({});
      context.responseHeaders?.set('X-DB-Route', 'replica:replica-1');
      attachRoutingHeaderInterceptor(res, context);
      res.writeHead(200, { 'Content-Type': 'application/json' });

      expect(headers['X-DB-Route']).toBe('replica:replica-1');
    });
  });

  describe('replication metrics', () => {
    it('exports Prometheus metrics for lag and pool utilisation', async () => {
      const primary = makeMockPool('primary');
      const replica1 = makeMockPool('replica-1');
      const pool = new ReadWritePool(
        primary,
        new Map([['replica-1', replica1]]),
        [{ name: 'replica-1', host: 'r1', port: 6433 }],
        makeConfig({ replicas: [{ name: 'replica-1', host: 'r1', port: 6433 }] }),
      );
      await pool.pollReplicationLag();

      await runWithQueryRoutingContext({ responseHeaders: new Map() }, async () => {
        await pool.query('SELECT 1');
      });

      const snapshot = collectReplicationMetrics(pool);
      const output = formatReplicationPrometheus(snapshot, pool);

      expect(output).toContain('subtrackr_replication_lag_ms{replica="replica-1"}');
      expect(output).toContain('subtrackr_replication_lag_p99_ms{replica="replica-1"}');
      expect(output).toContain('subtrackr_replication_lag_p99_alarm_ms 1000');
      expect(output).toContain('subtrackr_replica_pool_total{replica="replica-1"} 10');
      expect(output).toContain('subtrackr_replica_query_total{replica="replica-1"}');
    });
  });
});
