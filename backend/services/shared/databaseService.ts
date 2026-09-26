/**
 * Database service — read/write splitting, replica lag monitoring,
 * automatic failover, and connection-string rotation.
 *
 * Wraps the shared ReadWritePool so the service layer can depend on a
 * stable facade without knowing about pool internals.
 */

import {
  type DatabaseConfig,
  type ReplicaEndpoint,
  loadDatabaseConfig,
  replicaPoolConfig,
} from '../../config/database';
import {
  ConnectionStringRotator,
  type ConnectionStringRotationOptions,
  type ParsedConnectionString,
} from '../../shared/db/connectionStringRotation';
import {
  closePool,
  createPool,
  getPool,
  type Pool,
  type QueryResult,
} from '../../shared/db/connectionPool';
import {
  type ReadWritePool,
  type ReplicaLagState,
  createReadWritePool,
  runWithQueryRoutingContext,
} from '../../shared/db/readWriteRouter';
import { isReadQuery } from '../../shared/db/queryClassifier';

export interface DatabaseFailoverStatus {
  mode: 'primary-only' | 'replicas-active' | 'failover-primary';
  healthyReplicas: number;
  totalReplicas: number;
  lagStates: ReplicaLagState[];
  connectionGeneration: number;
}

export interface DatabaseServiceOptions {
  config?: DatabaseConfig;
  rotator?: ConnectionStringRotator;
  /** Injected pool for tests. */
  pool?: Pool | ReadWritePool;
}

export class DatabaseService {
  private config: DatabaseConfig;
  private readonly rotator: ConnectionStringRotator;
  private pool: Pool | ReadWritePool | null;
  private forcedPrimaryFailover = false;
  private initialized = false;

  constructor(options: DatabaseServiceOptions = {}) {
    this.config = options.config ?? loadDatabaseConfig();
    this.rotator =
      options.rotator ??
      new ConnectionStringRotator({
        primaryUrl: process.env.DATABASE_URL,
        replicaUrls: process.env.DATABASE_READ_URLS,
      });
    this.pool = options.pool ?? null;
  }

  /** Initialise the underlying pool (idempotent). */
  async initialize(): Promise<void> {
    if (this.initialized && this.pool) return;
    if (!this.pool) {
      if (this.config.replicas.length > 0) {
        this.pool = await createReadWritePool({ config: this.config });
      } else {
        this.pool = await getPool();
      }
    }
    this.initialized = true;
  }

  /** Route a query: SELECTs to replicas, writes to primary. */
  async query<T = unknown>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    await this.initialize();
    const pool = this.requirePool();

    if (this.forcedPrimaryFailover || !isReadQuery(sql)) {
      return this.queryPrimary(sql, params);
    }

    return pool.query<T>(sql, params);
  }

  /** Force a write against the primary. */
  async write<T = unknown>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    return this.queryPrimary(sql, params);
  }

  /** Prefer a read replica (falls back to primary on lag / failure). */
  async read<T = unknown>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    await this.initialize();
    if (this.forcedPrimaryFailover) {
      return this.queryPrimary(sql, params);
    }
    return this.requirePool().query<T>(sql, params);
  }

  getLagStates(): ReplicaLagState[] {
    const rw = this.asReadWritePool();
    return rw ? rw.getLagStates() : [];
  }

  getFailoverStatus(): DatabaseFailoverStatus {
    const lagStates = this.getLagStates();
    const healthyReplicas = lagStates.filter((s) => s.available).length;
    const totalReplicas = this.config.replicas.length;

    let mode: DatabaseFailoverStatus['mode'] = 'primary-only';
    if (this.forcedPrimaryFailover) {
      mode = 'failover-primary';
    } else if (totalReplicas > 0 && healthyReplicas > 0) {
      mode = 'replicas-active';
    } else if (totalReplicas > 0) {
      mode = 'failover-primary';
    }

    return {
      mode,
      healthyReplicas,
      totalReplicas,
      lagStates,
      connectionGeneration: this.rotator.getGeneration(),
    };
  }

  /**
   * Force all reads onto the primary (automatic / operator failover).
   * Replicas stay pooled so `recoverFromFailover()` can restore them.
   */
  async failoverToPrimary(reason = 'manual'): Promise<DatabaseFailoverStatus> {
    await this.initialize();
    this.forcedPrimaryFailover = true;
    const rw = this.asReadWritePool();
    if (rw) {
      for (const state of rw.getLagStates()) {
        rw.markReplicaUnavailable(state.name);
        this.rotator.markFailed(state.name);
      }
    }
    console.warn(`[DatabaseService] Failover to primary (${reason})`);
    return this.getFailoverStatus();
  }

  /** Clear forced failover and re-enable healthy replicas. */
  async recoverFromFailover(): Promise<DatabaseFailoverStatus> {
    this.forcedPrimaryFailover = false;
    const rw = this.asReadWritePool();
    if (rw) {
      for (const state of rw.getLagStates()) {
        rw.markReplicaAvailable(state.name);
        this.rotator.markHealthy(state.name);
      }
      await rw.pollReplicationLag();
    }
    return this.getFailoverStatus();
  }

  /**
   * Rotate connection strings (credential / endpoint hot-swap) and rebuild
   * replica pools against the new URLs.
   */
  async rotateConnectionStrings(
    options: ConnectionStringRotationOptions,
  ): Promise<{ generation: number; replicas: ParsedConnectionString[] }> {
    const generation = this.rotator.rotate(options);
    const primary = this.rotator.getPrimary();
    const replicas = this.rotator.getReplicas();

    if (primary) {
      this.config = {
        ...this.config,
        primary: {
          ...this.config.primary,
          host: primary.host,
          port: primary.port,
          database: primary.database,
          user: primary.user,
          password: primary.password,
          ssl: primary.ssl ? { rejectUnauthorized: true } : this.config.primary.ssl,
        },
        replicas: replicas.map((r) => ({ name: r.name, host: r.host, port: r.port })),
      };
    } else {
      this.config = {
        ...this.config,
        replicas: replicas.map((r) => ({ name: r.name, host: r.host, port: r.port })),
      };
    }

    await this.rebuildReplicaPools(this.config.replicas);
    this.forcedPrimaryFailover = false;

    return { generation, replicas };
  }

  getConnectionSnapshot() {
    return this.rotator.toSafeSnapshot();
  }

  getConfig(): DatabaseConfig {
    return this.config;
  }

  getRotator(): ConnectionStringRotator {
    return this.rotator;
  }

  /** Run a callback with routing context (stale-accept / response headers). */
  runWithRoutingContext<T>(
    context: { staleAcceptSeconds?: number; responseHeaders?: Map<string, string> },
    fn: () => T | Promise<T>,
  ): T | Promise<T> {
    return runWithQueryRoutingContext(context, fn);
  }

  async shutdown(): Promise<void> {
    const rw = this.asReadWritePool();
    if (rw) {
      rw.stopLagMonitoring();
      await rw.end();
    } else if (this.pool) {
      await this.pool.end();
    } else {
      await closePool();
    }
    this.pool = null;
    this.initialized = false;
  }

  private async queryPrimary<T>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    await this.initialize();
    const pool = this.requirePool();
    const rw = this.asReadWritePool();
    if (rw) {
      return rw.primary.query<T>(sql, params);
    }
    return pool.query<T>(sql, params);
  }

  private async rebuildReplicaPools(endpoints: ReplicaEndpoint[]): Promise<void> {
    await this.initialize();
    const rw = this.asReadWritePool();

    const nextPools = new Map<string, Pool>();
    for (const endpoint of endpoints) {
      const poolConfig = replicaPoolConfig(endpoint, this.config.primary, this.config.replicaPoolSize);
      nextPools.set(endpoint.name, await createPool(poolConfig));
    }

    if (rw) {
      await rw.replaceReplicaPools(nextPools, endpoints);
      return;
    }

    if (endpoints.length > 0) {
      this.pool = await createReadWritePool({
        config: { ...this.config, replicas: endpoints },
        primaryPool: this.pool ?? undefined,
        replicaPools: nextPools,
      });
    }
  }

  private requirePool(): Pool | ReadWritePool {
    if (!this.pool) {
      throw new Error('DatabaseService is not initialised');
    }
    return this.pool;
  }

  private asReadWritePool(): ReadWritePool | null {
    if (this.pool && 'getLagStates' in this.pool) {
      return this.pool as ReadWritePool;
    }
    return null;
  }
}

let _databaseService: DatabaseService | null = null;

export function getDatabaseService(): DatabaseService {
  if (!_databaseService) {
    _databaseService = new DatabaseService();
  }
  return _databaseService;
}

export function resetDatabaseService(): void {
  _databaseService = null;
}

export { ConnectionStringRotator };
export type { ConnectionStringRotationOptions, ParsedConnectionString };
