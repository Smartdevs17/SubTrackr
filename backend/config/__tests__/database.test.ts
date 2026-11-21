import {
  DEFAULT_DATABASE_CONFIG,
  type DatabaseConfigHooks,
  type PgBouncerSizingEvent,
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

  it('loads primary from DATABASE_URL', () => {
    const config = loadDatabaseConfig({
      DATABASE_URL: 'postgresql://app:secret@db.internal:6543/subtrackr?sslmode=require',
    });
    expect(config.primary.host).toBe('db.internal');
    expect(config.primary.port).toBe(6543);
    expect(config.primary.user).toBe('app');
    expect(config.primary.password).toBe('secret');
    expect(config.primary.ssl).toEqual({ rejectUnauthorized: true });
  });

  it('loads replicas from DATABASE_READ_URLS', () => {
    const config = loadDatabaseConfig({
      DATABASE_READ_URLS:
        'postgresql://app:p@r1.internal:5432/subtrackr,postgresql://app:p@r2.internal:5433/subtrackr',
    });
    expect(config.replicas).toEqual([
      { name: 'replica-1', host: 'r1.internal', port: 5432 },
      { name: 'replica-2', host: 'r2.internal', port: 5433 },
    ]);
  });
});

// ── Pool tuning options (issue #1797) ───────────────────────────────────────

describe('pool tuning configuration (issue #1797)', () => {
  it('loads default pool tuning when env vars are unset', () => {
    const config = loadDatabaseConfig({});
    expect(config.poolTuning.minConnections).toBe(0);
    expect(config.poolTuning.maxClientUses).toBe(0);
    expect(config.poolTuning.queryWaitWarningMs).toBe(5_000);
    expect(config.poolTuning.metricsEnabled).toBe(true);
    expect(config.poolTuning.metricsIntervalMs).toBe(10_000);
    expect(config.poolTuning.metricsAlertThreshold).toBe(0.8);
  });

  it('reads custom pool tuning from env', () => {
    const config = loadDatabaseConfig({
      DB_POOL_MIN: '5',
      DB_POOL_MAX_USES: '100',
      DB_QUERY_WAIT_WARNING_MS: '2000',
      DB_POOL_METRICS_ENABLED: 'false',
      DB_POOL_METRICS_INTERVAL_MS: '5000',
      DB_POOL_METRICS_ALERT_THRESHOLD: '0.9',
    });
    expect(config.poolTuning.minConnections).toBe(5);
    expect(config.poolTuning.maxClientUses).toBe(100);
    expect(config.poolTuning.queryWaitWarningMs).toBe(2_000);
    expect(config.poolTuning.metricsEnabled).toBe(false);
    expect(config.poolTuning.metricsIntervalMs).toBe(5_000);
    expect(config.poolTuning.metricsAlertThreshold).toBe(0.9);
  });

  it('falls back for invalid pool tuning values', () => {
    const config = loadDatabaseConfig({
      DB_POOL_MIN: '-1',
      DB_POOL_MAX_USES: 'not-a-number',
      DB_POOL_METRICS_ALERT_THRESHOLD: '2.0',
      DB_POOL_METRICS_INTERVAL_MS: '-5',
    });
    expect(config.poolTuning.minConnections).toBe(0);
    expect(config.poolTuning.maxClientUses).toBe(0);
    expect(config.poolTuning.metricsAlertThreshold).toBe(0.8);
    expect(config.poolTuning.metricsIntervalMs).toBe(10_000);
  });

  it('DB_POOL_METRICS_ENABLED only disables on "false"', () => {
    expect(loadDatabaseConfig({ DB_POOL_METRICS_ENABLED: 'false' }).poolTuning.metricsEnabled).toBe(false);
    expect(loadDatabaseConfig({ DB_POOL_METRICS_ENABLED: 'true' }).poolTuning.metricsEnabled).toBe(true);
    expect(loadDatabaseConfig({ DB_POOL_METRICS_ENABLED: undefined }).poolTuning.metricsEnabled).toBe(true);
  });
});

// ── PgBouncer worker sizing presets (issue #2076) ───────────────────────────

describe('PgBouncer worker sizing presets (issue #2076)', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('defaults to the standard worker preset', () => {
    const resolved: unknown[] = [];
    const hooks: DatabaseConfigHooks = {
      onPgBouncerSizingResolved: (sizing) => resolved.push(sizing),
    };
    const config = loadDatabaseConfig({}, hooks);

    expect(config.pgbouncer.name).toBe('standard');
    expect(config.pgbouncer.poolMode).toBe('transaction');
    expect(config.pgbouncer.workerConcurrency).toBe(10);
    expect(config.pgbouncer.defaultPoolSize).toBe(25);
    expect(config.primary.max).toBe(20);
    expect(config.replicaPoolSize).toBe(25);
    expect(resolved).toEqual([config.pgbouncer]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('applies a selected preset to both worker and replica pool caps', () => {
    const config = loadDatabaseConfig({ PGBOUNCER_PRESET: 'small' });

    expect(config.pgbouncer.name).toBe('small');
    expect(config.pgbouncer.workerPoolMax).toBe(8);
    expect(config.primary.max).toBe(8);
    expect(config.replicaPoolSize).toBe(10);
    expect(config.pgbouncer.serverConnectionBudget).toBe(12);
  });

  it('lets DB_POOL_MAX and DB_REPLICA_POOL_SIZE override preset defaults', () => {
    const config = loadDatabaseConfig({
      PGBOUNCER_PRESET: 'batch',
      DB_POOL_MAX: '48',
      DB_REPLICA_POOL_SIZE: '72',
    });

    expect(config.pgbouncer.name).toBe('batch');
    expect(config.pgbouncer.poolSizeOverridden).toBe(true);
    expect(config.primary.max).toBe(48);
    expect(config.replicaPoolSize).toBe(72);
    expect(config.pgbouncer.serverConnectionBudget).toBe(87);
  });

  it('warns and falls back for an unknown preset', () => {
    const events: PgBouncerSizingEvent[] = [];
    const config = loadDatabaseConfig(
      { PGBOUNCER_PRESET: 'turbo' },
      { onPgBouncerSizingEvent: (event) => events.push(event) },
    );

    expect(config.pgbouncer.name).toBe('standard');
    expect(config.pgbouncer.fallbackUsed).toBe(true);
    expect(events).toEqual([
      expect.objectContaining({
        code: 'UNKNOWN_PRESET',
        requestedPreset: 'turbo',
        resolvedPreset: 'standard',
      }),
    ]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown PgBouncer preset "turbo"'));
  });

  it('warns and uses the preset pool size for an invalid override', () => {
    const events: PgBouncerSizingEvent[] = [];
    const config = loadDatabaseConfig(
      { PGBOUNCER_PRESET: 'large', DB_REPLICA_POOL_SIZE: '0' },
      { onPgBouncerSizingEvent: (event) => events.push(event) },
    );

    expect(config.pgbouncer.name).toBe('large');
    expect(config.replicaPoolSize).toBe(40);
    expect(events).toEqual([
      expect.objectContaining({
        code: 'INVALID_REPLICA_POOL_SIZE',
        resolvedPreset: 'large',
      }),
    ]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid DB_REPLICA_POOL_SIZE: 0'));
  });
});
