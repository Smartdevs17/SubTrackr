import type { DatabaseConfig } from '../../../config/database';
import type { Pool, QueryResult } from '../../../shared/db/connectionPool';
import { ReadWritePool } from '../../../shared/db/readWriteRouter';
import { ConnectionStringRotator } from '../../../shared/db/connectionStringRotation';
import { DatabaseService } from '../databaseService';

function makeMockPool(label: string, lagMs = 100): Pool {
  return {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('pg_last_xact_replay_timestamp')) {
        return { rows: [{ lag_ms: lagMs }], rowCount: 1 };
      }
      return { rows: [{ source: label }], rowCount: 1 } as QueryResult<{ source: string }>;
    }),
    connect: jest.fn(),
    end: jest.fn(async () => undefined),
    on: jest.fn(),
    totalCount: 5,
    idleCount: 2,
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
      { name: 'replica-1', host: 'r1', port: 6433 },
      { name: 'replica-2', host: 'r2', port: 6434 },
    ],
    replicaPoolSize: 25,
    replicationLagP99AlarmMs: 1_000,
    replicationLagFailoverMs: 5_000,
    staleReadDefaultSeconds: 30,
    lagPollIntervalMs: 60_000,
    ...overrides,
  };
}

describe('DatabaseService', () => {
  it('splits reads to replicas and writes to primary', async () => {
    const primary = makeMockPool('primary');
    const replica1 = makeMockPool('replica-1');
    const config = makeConfig({
      replicas: [{ name: 'replica-1', host: 'r1', port: 6433 }],
    });
    const pool = new ReadWritePool(
      primary,
      new Map([['replica-1', replica1]]),
      config.replicas,
      config,
    );
    await pool.pollReplicationLag();

    const service = new DatabaseService({ config, pool });
    await service.initialize();

    await service.read('SELECT 1');
    expect(replica1.query).toHaveBeenCalled();

    await service.write('INSERT INTO plans (id) VALUES ($1)', ['p1']);
    expect(primary.query).toHaveBeenCalledWith('INSERT INTO plans (id) VALUES ($1)', ['p1']);
  });

  it('fails over reads to primary and recovers', async () => {
    const primary = makeMockPool('primary');
    const replica1 = makeMockPool('replica-1');
    const config = makeConfig({
      replicas: [{ name: 'replica-1', host: 'r1', port: 6433 }],
    });
    const pool = new ReadWritePool(
      primary,
      new Map([['replica-1', replica1]]),
      config.replicas,
      config,
    );
    await pool.pollReplicationLag();

    const service = new DatabaseService({
      config,
      pool,
      rotator: new ConnectionStringRotator({
        primaryUrl: 'postgresql://u:p@primary:5432/subtrackr',
        replicaUrls: 'postgresql://u:p@r1:6433/subtrackr',
      }),
    });

    const before = service.getFailoverStatus();
    expect(before.mode).toBe('replicas-active');

    const failed = await service.failoverToPrimary('replica-lag');
    expect(failed.mode).toBe('failover-primary');
    expect(failed.healthyReplicas).toBe(0);

    await service.read('SELECT 1');
    expect(primary.query).toHaveBeenCalledWith('SELECT 1', undefined);

    const recovered = await service.recoverFromFailover();
    expect(recovered.mode).toBe('replicas-active');
  });

  it('rotates connection strings and bumps generation', async () => {
    const primary = makeMockPool('primary');
    const config = makeConfig({ replicas: [] });
    const pool = new ReadWritePool(primary, new Map(), [], config);
    const rotator = new ConnectionStringRotator({
      primaryUrl: 'postgresql://u:old@primary:5432/subtrackr',
      replicaUrls: 'postgresql://u:old@r1:5432/subtrackr',
    });

    const service = new DatabaseService({ config, pool, rotator });
    await service.initialize();

    // Avoid creating real pg pools during rotation — stub rebuild via empty replicas.
    const result = await service.rotateConnectionStrings({
      primaryUrl: 'postgresql://u:new@primary:5432/subtrackr',
      replicaUrls: [],
    });

    expect(result.generation).toBe(1);
    expect(service.getFailoverStatus().connectionGeneration).toBe(1);
    expect(service.getConnectionSnapshot()[0]?.url).toContain('***');
    expect(service.getConfig().primary.password).toBe('new');
  });

  it('falls back to primary when replica lag exceeds threshold', async () => {
    const primary = makeMockPool('primary');
    const replica1 = makeMockPool('replica-1', 8_000);
    const config = makeConfig({
      replicas: [{ name: 'replica-1', host: 'r1', port: 6433 }],
      replicationLagFailoverMs: 5_000,
    });
    const pool = new ReadWritePool(
      primary,
      new Map([['replica-1', replica1]]),
      config.replicas,
      config,
    );
    await pool.pollReplicationLag();

    const service = new DatabaseService({ config, pool });
    const headers = new Map<string, string>();
    await service.runWithRoutingContext({ responseHeaders: headers }, async () => {
      await service.query('SELECT * FROM subscriptions');
    });

    expect(primary.query).toHaveBeenCalledWith('SELECT * FROM subscriptions', undefined);
    expect(headers.get('X-DB-Route')).toBe('primary');
    expect(headers.get('X-DB-Route-Warning')).toBe('replication-lag-fallback-primary');
  });
});
