/**
 * PostgreSQL connection configuration with read-replica endpoints.
 *
 * Environment variables (primary):
 *   DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, DB_SSL
 *   DATABASE_URL – optional postgres:// URL (overrides discrete DB_* host fields)
 *
 * Read replicas (optional — comma-separated host:port pairs OR URLs):
 *   DB_READ_REPLICAS – e.g. "replica-1.internal:6432,replica-2.internal:6433"
 *   DATABASE_READ_URLS – e.g. "postgres://u:p@r1:5432/db,postgres://u:p@r2:5432/db"
 *   DB_REPLICA_POOL_SIZE – PgBouncer pool size per replica (overrides the preset)
 *   PGBOUNCER_PRESET – worker sizing preset: small | standard | large | batch
 *
 * Replication lag thresholds (milliseconds):
 *   DB_REPLICATION_LAG_P99_ALARM_MS – P99 alarm threshold (default: 1000)
 *   DB_REPLICATION_LAG_FAILOVER_MS – route reads to primary above this (default: 5000)
 *
 * Stale reads:
 *   DB_STALE_READ_DEFAULT_SECONDS – default X-Stale-Accept for analytics (default: 30)
 */

import type { PoolConfig } from '../shared/db/connectionPool';
import {
  ConnectionStringRotator,
  type ParsedConnectionString,
} from '../shared/db/connectionStringRotation';

/**
 * Canonical PgBouncer sizing presets and their resolver live next to the
 * generated ini template in infra/pgbouncer. Importing it here prevents the
 * backend and deployment configuration from drifting apart.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resolvePreset: resolvePgBouncerPreset } = require('../../infra/pgbouncer/render.js') as {
  resolvePreset: (
    options?: { preset?: string; replicaPoolSize?: string | number },
    context?: {
      warn?: (message: string) => void;
      env?: NodeJS.ProcessEnv;
    },
  ) => PgBouncerSizing;
};

/** Worker-aware PgBouncer sizing resolved from infra/pgbouncer/presets.json. */
export interface PgBouncerSizing {
  name: string;
  requestedName: string;
  label: string;
  fallbackUsed: boolean;
  poolSizeOverridden: boolean;
  workerConcurrency: number;
  workerPoolMax: number;
  defaultPoolSize: number;
  minPoolSize: number;
  reservePoolSize: number;
  reservePoolTimeout: number;
  maxClientConn: number;
  maxPreparedStatements: number;
  serverConnectionBudget: number;
  poolMode: 'transaction';
}

export interface PgBouncerSizingEvent {
  code: 'UNKNOWN_PRESET' | 'INVALID_REPLICA_POOL_SIZE';
  requestedPreset: string;
  resolvedPreset: string;
  message: string;
}

/** Optional observability hooks for user-visible sizing fallbacks. */
export interface DatabaseConfigHooks {
  onPgBouncerSizingEvent?: (event: PgBouncerSizingEvent) => void;
  onPgBouncerSizingResolved?: (sizing: PgBouncerSizing) => void;
}

export interface ReplicaEndpoint {
  /** Logical name used in metrics labels (replica-1, replica-2, …). */
  name: string;
  host: string;
  port: number;
}

export interface DatabaseConfig {
  primary: Required<PoolConfig>;
  replicas: ReplicaEndpoint[];
  /** PgBouncer pool size per replica. Default: 25 */
  replicaPoolSize: number;
  /** P99 replication lag alarm threshold in ms. Default: 1000 */
  replicationLagP99AlarmMs: number;
  /** Lag above which reads fail back to primary. Default: 5000 */
  replicationLagFailoverMs: number;
  /** Default stale-read tolerance for analytics endpoints (seconds). Default: 30 */
  staleReadDefaultSeconds: number;
  /** How often to poll replication lag (ms). Default: 5000 */
  lagPollIntervalMs: number;
  /** Extended pool tuning options (issue #1797) */
  poolTuning: PoolTuningOptions;
  /** Worker-aware PgBouncer sizing (issue #2076) */
  pgbouncer: PgBouncerSizing;
}

export const DEFAULT_DATABASE_CONFIG: Readonly<{
  replicaPoolSize: number;
  replicationLagP99AlarmMs: number;
  replicationLagFailoverMs: number;
  staleReadDefaultSeconds: number;
  lagPollIntervalMs: number;
}> = {
  replicaPoolSize: 25,
  replicationLagP99AlarmMs: 1_000,
  replicationLagFailoverMs: 5_000,
  staleReadDefaultSeconds: 30,
  lagPollIntervalMs: 5_000,
};

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseReplicaEndpoints(raw: string | undefined): ReplicaEndpoint[] {
  if (!raw?.trim()) return [];

  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, index) => {
      const [host, portStr] = entry.includes(':') ? entry.split(':') : [entry, undefined];
      return {
        name: `replica-${index + 1}`,
        host: host.trim(),
        port: parsePositiveInt(portStr, 5432),
      };
    });
}

function poolDefaults(
  env: NodeJS.ProcessEnv,
  pgbouncer: PgBouncerSizing,
): Pick<Required<PoolConfig>, 'max' | 'idleTimeoutMillis' | 'connectionTimeoutMillis' | 'statementTimeout'> {
  return {
    max: parsePositiveInt(env.DB_POOL_MAX, pgbouncer.workerPoolMax),
    idleTimeoutMillis: parsePositiveInt(env.DB_IDLE_TIMEOUT_MS, 10_000),
    connectionTimeoutMillis: parsePositiveInt(env.DB_CONNECTION_TIMEOUT_MS, 30_000),
    statementTimeout: parsePositiveInt(env.DB_STATEMENT_TIMEOUT_MS, 30_000),
  };
}

/**
 * Extended pool tuning options loaded from environment.
 * All have sensible defaults so the pool works out-of-the-box.
 */
export interface PoolTuningOptions {
  /** Minimum connections to keep open. Default: 0 (pg-pool default) */
  minConnections: number;
  /** Max times a client is reused before being recycled. Default: 0 (unlimited) */
  maxClientUses: number;
  /** Log a warning when a query waits longer than this (ms). Default: 5000 */
  queryWaitWarningMs: number;
  /** Whether to enable pool metrics collection. Default: true */
  metricsEnabled: boolean;
  /** Pool metrics sampling interval in ms. Default: 10000 */
  metricsIntervalMs: number;
  /** Alert threshold for pool utilization (0–1). Default: 0.8 */
  metricsAlertThreshold: number;
}

export const DEFAULT_POOL_TUNING: Readonly<PoolTuningOptions> = {
  minConnections: 0,
  maxClientUses: 0,
  queryWaitWarningMs: 5_000,
  metricsEnabled: true,
  metricsIntervalMs: 10_000,
  metricsAlertThreshold: 0.8,
};

function loadPoolTuning(env: NodeJS.ProcessEnv): PoolTuningOptions {
  return {
    minConnections: parsePositiveInt(env.DB_POOL_MIN, DEFAULT_POOL_TUNING.minConnections),
    maxClientUses: parsePositiveInt(env.DB_POOL_MAX_USES, DEFAULT_POOL_TUNING.maxClientUses),
    queryWaitWarningMs: parsePositiveInt(
      env.DB_QUERY_WAIT_WARNING_MS,
      DEFAULT_POOL_TUNING.queryWaitWarningMs,
    ),
    metricsEnabled: env.DB_POOL_METRICS_ENABLED !== 'false',
    metricsIntervalMs: parsePositiveInt(
      env.DB_POOL_METRICS_INTERVAL_MS,
      DEFAULT_POOL_TUNING.metricsIntervalMs,
    ),
    metricsAlertThreshold: parsePositiveFloat(
      env.DB_POOL_METRICS_ALERT_THRESHOLD,
      DEFAULT_POOL_TUNING.metricsAlertThreshold,
    ),
  };
}

function parsePositiveFloat(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

function primaryFromParsed(
  parsed: ParsedConnectionString,
  env: NodeJS.ProcessEnv,
  pgbouncer: PgBouncerSizing,
): Required<PoolConfig> {
  return {
    ...poolDefaults(env, pgbouncer),
    host: parsed.host,
    port: parsed.port,
    database: parsed.database,
    user: parsed.user,
    password: parsed.password,
    ssl: (parsed.ssl || env.DB_SSL === 'true') ? { rejectUnauthorized: true } : false,
  };
}

function buildPrimaryConfig(env: NodeJS.ProcessEnv, pgbouncer: PgBouncerSizing): Required<PoolConfig> {
  if (env.DATABASE_URL?.trim()) {
    const rotator = new ConnectionStringRotator({ primaryUrl: env.DATABASE_URL });
    const primary = rotator.getPrimary();
    if (primary) {
      return primaryFromParsed(primary, env, pgbouncer);
    }
  }

  return {
    ...poolDefaults(env, pgbouncer),
    host: env.DB_HOST?.trim() || 'localhost',
    port: parsePositiveInt(env.DB_PORT, 5432),
    database: env.DB_NAME?.trim() || 'subtrackr',
    user: env.DB_USER?.trim() || 'postgres',
    password: env.DB_PASSWORD ?? '',
    ssl: env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false,
  };
}

function resolveReplicas(env: NodeJS.ProcessEnv): ReplicaEndpoint[] {
  if (env.DATABASE_READ_URLS?.trim()) {
    const rotator = ConnectionStringRotator.fromEnv(env);
    return rotator.getReplicas().map((r) => ({
      name: r.name,
      host: r.host,
      port: r.port,
    }));
  }
  return parseReplicaEndpoints(env.DB_READ_REPLICAS);
}

/**
 * Resolve worker-aware PgBouncer sizing and surface fallbacks through the
 * optional observability hook as well as a structured console warning.
 */
function resolvePgBouncerSizing(
  env: NodeJS.ProcessEnv,
  hooks: DatabaseConfigHooks,
): PgBouncerSizing {
  const warnings: string[] = [];
  const sizing = resolvePgBouncerPreset(
    { preset: env.PGBOUNCER_PRESET, replicaPoolSize: env.DB_REPLICA_POOL_SIZE },
    { warn: (message) => warnings.push(message), env },
  );

  for (const message of warnings) {
    const event: PgBouncerSizingEvent = {
      code: message.startsWith('Unknown PgBouncer preset')
        ? 'UNKNOWN_PRESET'
        : 'INVALID_REPLICA_POOL_SIZE',
      requestedPreset: (env.PGBOUNCER_PRESET ?? sizing.name).trim().toLowerCase(),
      resolvedPreset: sizing.name,
      message,
    };
    console.warn(`[PgBouncer] ${message}`);
    hooks.onPgBouncerSizingEvent?.(event);
  }

  hooks.onPgBouncerSizingResolved?.(sizing);
  return sizing;
}

/** Load database configuration from environment variables. */
export function loadDatabaseConfig(
  env: NodeJS.ProcessEnv = process.env,
  hooks: DatabaseConfigHooks = {},
): DatabaseConfig {
  const pgbouncer = resolvePgBouncerSizing(env, hooks);
  return {
    primary: buildPrimaryConfig(env, pgbouncer),
    replicas: resolveReplicas(env),
    replicaPoolSize: pgbouncer.defaultPoolSize,
    replicationLagP99AlarmMs: parsePositiveInt(
      env.DB_REPLICATION_LAG_P99_ALARM_MS,
      DEFAULT_DATABASE_CONFIG.replicationLagP99AlarmMs,
    ),
    replicationLagFailoverMs: parsePositiveInt(
      env.DB_REPLICATION_LAG_FAILOVER_MS,
      DEFAULT_DATABASE_CONFIG.replicationLagFailoverMs,
    ),
    staleReadDefaultSeconds: parsePositiveInt(
      env.DB_STALE_READ_SECONDS,
      DEFAULT_DATABASE_CONFIG.staleReadDefaultSeconds,
    ),
    lagPollIntervalMs: parsePositiveInt(
      env.DB_LAG_POLL_INTERVAL_MS,
      DEFAULT_DATABASE_CONFIG.lagPollIntervalMs,
    ),
    poolTuning: loadPoolTuning(env),
    pgbouncer,
  };
}

/** Build a pg PoolConfig for a read replica (via PgBouncer). */
export function replicaPoolConfig(
  replica: ReplicaEndpoint,
  base: Required<PoolConfig>,
  poolSize: number,
): Required<PoolConfig> {
  return {
    ...base,
    host: replica.host,
    port: replica.port,
    max: poolSize,
  };
}
