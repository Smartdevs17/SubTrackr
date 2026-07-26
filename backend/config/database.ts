/**
 * PostgreSQL connection configuration with read-replica endpoints.
 *
 * Environment variables (primary):
 *   DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, DB_SSL
 *
 * Read replicas (optional — comma-separated host:port pairs):
 *   DB_READ_REPLICAS – e.g. "replica-1.internal:6432,replica-2.internal:6433"
 *   DB_REPLICA_POOL_SIZE – PgBouncer pool size per replica (default: 25)
 *
 * Replication lag thresholds (milliseconds):
 *   DB_REPLICATION_LAG_P99_ALARM_MS – P99 alarm threshold (default: 1000)
 *   DB_REPLICATION_LAG_FAILOVER_MS – route reads to primary above this (default: 5000)
 *
 * Stale reads:
 *   DB_STALE_READ_DEFAULT_SECONDS – default X-Stale-Accept for analytics (default: 30)
 */

import type { PoolConfig } from '../shared/db/connectionPool';

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

function buildPrimaryConfig(env: NodeJS.ProcessEnv): Required<PoolConfig> {
  return {
    host: env.DB_HOST?.trim() || 'localhost',
    port: parsePositiveInt(env.DB_PORT, 5432),
    database: env.DB_NAME?.trim() || 'subtrackr',
    user: env.DB_USER?.trim() || 'postgres',
    password: env.DB_PASSWORD ?? '',
    max: parsePositiveInt(env.DB_POOL_MAX, 20),
    idleTimeoutMillis: parsePositiveInt(env.DB_IDLE_TIMEOUT_MS, 10_000),
    connectionTimeoutMillis: parsePositiveInt(env.DB_CONNECTION_TIMEOUT_MS, 30_000),
    statementTimeout: parsePositiveInt(env.DB_STATEMENT_TIMEOUT_MS, 30_000),
    ssl: env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false,
  };
}

/** Load database configuration from environment variables. */
export function loadDatabaseConfig(env: NodeJS.ProcessEnv = process.env): DatabaseConfig {
  return {
    primary: buildPrimaryConfig(env),
    replicas: parseReplicaEndpoints(env.DB_READ_REPLICAS),
    replicaPoolSize: parsePositiveInt(
      env.DB_REPLICA_POOL_SIZE,
      DEFAULT_DATABASE_CONFIG.replicaPoolSize,
    ),
    replicationLagP99AlarmMs: parsePositiveInt(
      env.DB_REPLICATION_LAG_P99_ALARM_MS,
      DEFAULT_DATABASE_CONFIG.replicationLagP99AlarmMs,
    ),
    replicationLagFailoverMs: parsePositiveInt(
      env.DB_REPLICATION_LAG_FAILOVER_MS,
      DEFAULT_DATABASE_CONFIG.replicationLagFailoverMs,
    ),
    staleReadDefaultSeconds: parsePositiveInt(
      env.DB_STALE_READ_DEFAULT_SECONDS,
      DEFAULT_DATABASE_CONFIG.staleReadDefaultSeconds,
    ),
    lagPollIntervalMs: parsePositiveInt(
      env.DB_LAG_POLL_INTERVAL_MS,
      DEFAULT_DATABASE_CONFIG.lagPollIntervalMs,
    ),
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
