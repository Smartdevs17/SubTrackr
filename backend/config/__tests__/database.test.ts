import {
  DEFAULT_DATABASE_CONFIG,
  loadDatabaseConfig,
  replicaPoolConfig,
} from '../database';

describe('database config', () => {
  it('loads primary defaults when env vars are unset', () => {
    const config = loadDatabaseConfig({});
    expect(config.primary.host).toBe('localhost');
    expect(config.primary.port).toBe(5432);
    expect(config.primary.database).toBe('subtrackr');
    expect(config.primary.user).toBe('postgres');
    expect(config.primary.max).toBe(20);
    expect(config.replicas).toEqual([]);
    expect(config.replicaPoolSize).toBe(DEFAULT_DATABASE_CONFIG.replicaPoolSize);
    expect(config.replicationLagP99AlarmMs).toBe(1_000);
    expect(config.replicationLagFailoverMs).toBe(5_000);
    expect(config.staleReadDefaultSeconds).toBe(30);
  });

  it('parses comma-separated read replica endpoints', () => {
    const config = loadDatabaseConfig({
      DB_READ_REPLICAS: 'replica-a.internal:6432,replica-b.internal:6433',
    });
    expect(config.replicas).toEqual([
      { name: 'replica-1', host: 'replica-a.internal', port: 6432 },
      { name: 'replica-2', host: 'replica-b.internal', port: 6433 },
    ]);
  });

  it('parses replica host without explicit port', () => {
    const config = loadDatabaseConfig({
      DB_READ_REPLICAS: 'replica-only.internal',
    });
    expect(config.replicas).toEqual([
      { name: 'replica-1', host: 'replica-only.internal', port: 5432 },
    ]);
  });

  it('reads custom lag and pool thresholds', () => {
    const config = loadDatabaseConfig({
      DB_REPLICA_POOL_SIZE: '50',
      DB_REPLICATION_LAG_P99_ALARM_MS: '800',
      DB_REPLICATION_LAG_FAILOVER_MS: '4000',
      DB_STALE_READ_DEFAULT_SECONDS: '60',
      DB_LAG_POLL_INTERVAL_MS: '10000',
    });
    expect(config.replicaPoolSize).toBe(50);
    expect(config.replicationLagP99AlarmMs).toBe(800);
    expect(config.replicationLagFailoverMs).toBe(4_000);
    expect(config.staleReadDefaultSeconds).toBe(60);
    expect(config.lagPollIntervalMs).toBe(10_000);
  });

  it('falls back for invalid numeric env values', () => {
    const config = loadDatabaseConfig({
      DB_PORT: 'not-a-number',
      DB_REPLICA_POOL_SIZE: '-1',
    });
    expect(config.primary.port).toBe(5432);
    expect(config.replicaPoolSize).toBe(DEFAULT_DATABASE_CONFIG.replicaPoolSize);
  });

  it('builds replica pool config with PgBouncer pool size', () => {
    const base = loadDatabaseConfig({}).primary;
    const replica = { name: 'replica-1', host: 'pgbouncer-1', port: 6433 };
    const poolConfig = replicaPoolConfig(replica, base, 25);
    expect(poolConfig.host).toBe('pgbouncer-1');
    expect(poolConfig.port).toBe(6433);
    expect(poolConfig.max).toBe(25);
    expect(poolConfig.database).toBe(base.database);
  });
});
