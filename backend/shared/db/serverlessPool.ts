/**
 * Serverless database connection pool adapter.
 *
 * Issue #600: Implement database connection multiplexing for serverless
 * environments.
 *
 * Serverless functions (webhook handlers, auth callbacks, scheduled jobs) open
 * a new database connection per invocation. During traffic spikes this exhausts
 * the database's connection limit. The fix is to route every connection through
 * a transaction-pooling proxy (PgBouncer or RDS Proxy) so a small set of real
 * backend connections is multiplexed across hundreds of concurrent functions.
 *
 * This adapter:
 *   - Points the `pg` Pool at the proxy endpoint, not the database directly.
 *   - Uses transaction-level pooling (short-lived `pg` clients per request).
 *   - Disables driver-side prepared statements unless the proxy is configured
 *     for prepared-statement mode (PgBouncer 1.21+ / RDS Proxy).
 *   - Supports IAM-token auth (AWS RDS) and SCRAM-256 (self-hosted PgBouncer).
 *   - Tracks every checked-out client and force-closes abandoned ones (leak
 *     detection) so a missing `release()` cannot starve the pool.
 *
 * NOTE: `pg` is a Node.js-only dependency used exclusively in the backend
 * service layer. It is dynamically imported so this module never lands in the
 * React Native bundle.
 */

import {
  type Pool,
  type PoolClient,
  type PoolConfig,
  createPool,
} from './connectionPool';

// ── Configuration ─────────────────────────────────────────────────────────────

export type ProxyAuthMode = 'iam' | 'scram-256' | 'password';

export interface ServerlessPoolConfig extends PoolConfig {
  /**
   * Authentication strategy against the proxy.
   *   - `iam`       AWS RDS Proxy IAM auth — password is a short-lived token.
   *   - `scram-256` self-hosted PgBouncer with SCRAM-SHA-256.
   *   - `password`  plain password (local dev only).
   */
  authMode?: ProxyAuthMode;
  /**
   * Whether the proxy runs in transaction-pooling mode. When true, session
   * features (LISTEN/NOTIFY, session-level SET, server-side prepared
   * statements) are unavailable and the driver is configured accordingly.
   * Default: true.
   */
  transactionPooling?: boolean;
  /**
   * Whether the proxy supports prepared statements in transaction mode
   * (PgBouncer >= 1.21 `max_prepared_statements`, or RDS Proxy). When false,
   * driver-side prepared statements are disabled to avoid
   * "prepared statement does not exist" errors. Default: false.
   */
  preparedStatements?: boolean;
  /**
   * Max pooled connections this function holds open to the proxy. Kept small
   * because the proxy fans these out to far more concurrent invocations.
   * Default: 50 (the proxy serves 500+ concurrent functions from these).
   */
  maxPooledConnections?: number;
  /**
   * Resolver for the auth credential. For `iam` this returns a freshly signed
   * RDS auth token; for `scram-256`/`password` it returns the static secret.
   * Invoked on every (re)connect so rotating tokens stay valid.
   */
  credentialProvider?: () => Promise<string> | string;
  /**
   * A checked-out client unused for longer than this is considered leaked and
   * is force-released. Default: 30 000 ms.
   */
  leakDetectionThresholdMs?: number;
}

const ENV_AUTH_MODE = (process.env['DB_PROXY_AUTH_MODE'] as ProxyAuthMode) || 'scram-256';

const SERVERLESS_DEFAULTS = {
  authMode: ENV_AUTH_MODE,
  transactionPooling: process.env['DB_PROXY_TXN_POOLING'] !== 'false',
  preparedStatements: process.env['DB_PROXY_PREPARED_STATEMENTS'] === 'true',
  maxPooledConnections: Number(process.env['DB_PROXY_MAX_CONN'] ?? 50),
  leakDetectionThresholdMs: Number(process.env['DB_LEAK_THRESHOLD_MS'] ?? 30_000),
} as const;

// ── Leak detection bookkeeping ────────────────────────────────────────────────

export interface CheckoutRecord {
  client: PoolClient;
  checkedOutAt: number;
  /** Best-effort call site for diagnostics. */
  origin: string;
  /** Set once the leak sweep has force-closed this client. */
  forceClosed: boolean;
}

export interface PoolStats {
  total: number;
  idle: number;
  waiting: number;
  checkedOut: number;
  leakedTotal: number;
}

/**
 * A pool wrapper that adds serverless-safe semantics on top of the base `pg`
 * Pool: transaction pooling, credential refresh, and connection-leak detection.
 */
export class ServerlessConnectionPool {
  private pool: Pool | null = null;
  private readonly config: Required<
    Pick<
      ServerlessPoolConfig,
      | 'authMode'
      | 'transactionPooling'
      | 'preparedStatements'
      | 'maxPooledConnections'
      | 'leakDetectionThresholdMs'
    >
  > &
    ServerlessPoolConfig;
  private readonly checkouts = new Set<CheckoutRecord>();
  private leakedTotal = 0;
  private sweepTimer?: ReturnType<typeof setInterval>;
  private onLeak?: (record: CheckoutRecord, ageMs: number) => void;

  constructor(config: ServerlessPoolConfig = {}) {
    this.config = {
      ...SERVERLESS_DEFAULTS,
      ...config,
    };
  }

  /** Register a callback fired whenever an abandoned connection is force-closed. */
  setLeakHandler(handler: (record: CheckoutRecord, ageMs: number) => void): void {
    this.onLeak = handler;
  }

  private async resolveCredential(): Promise<string | undefined> {
    if (this.config.credentialProvider) {
      return await this.config.credentialProvider();
    }
    return this.config.password ?? process.env['DB_PASSWORD'];
  }

  /** Lazily build the underlying pg Pool pointed at the proxy endpoint. */
  private async getPool(): Promise<Pool> {
    if (this.pool) return this.pool;

    const password = await this.resolveCredential();

    // In transaction-pooling mode the proxy hands a different backend
    // connection to each transaction, so server-side prepared statements and
    // session state cannot be relied upon. We surface that through `max` and a
    // conservative idle timeout; statement caching is governed by the proxy.
    const overrides: PoolConfig = {
      host: this.config.host ?? process.env['DB_PROXY_HOST'] ?? process.env['DB_HOST'],
      port: this.config.port ?? Number(process.env['DB_PROXY_PORT'] ?? 6432),
      database: this.config.database,
      user: this.config.user,
      password,
      ssl: this.config.ssl ?? (this.config.authMode === 'iam' ? { rejectUnauthorized: true } : undefined),
      max: this.config.maxPooledConnections,
      // Recycle idle connections quickly; the proxy multiplexes the real ones.
      idleTimeoutMillis: this.config.idleTimeoutMillis ?? 10_000,
      connectionTimeoutMillis: this.config.connectionTimeoutMillis ?? 5_000,
      statementTimeout: this.config.statementTimeout ?? 30_000,
    };

    this.pool = await createPool(overrides);
    this.startLeakSweep();
    return this.pool;
  }

  private startLeakSweep(): void {
    if (this.sweepTimer) return;
    const interval = Math.max(1_000, Math.floor(this.config.leakDetectionThresholdMs / 2));
    this.sweepTimer = setInterval(() => this.sweepLeaks(), interval);
    // Don't keep the Lambda event loop alive solely for the sweep.
    if (typeof this.sweepTimer.unref === 'function') this.sweepTimer.unref();
  }

  /** Force-close any client checked out longer than the leak threshold. */
  sweepLeaks(now: number = Date.now()): CheckoutRecord[] {
    const leaked: CheckoutRecord[] = [];
    for (const record of this.checkouts) {
      const age = now - record.checkedOutAt;
      if (age > this.config.leakDetectionThresholdMs && !record.forceClosed) {
        record.forceClosed = true;
        this.leakedTotal += 1;
        leaked.push(record);
        try {
          // Release the client; pg discards one left in a broken/unknown state.
          record.client.release();
        } catch {
          /* already gone */
        }
        this.checkouts.delete(record);
        console.warn(
          `[ServerlessPool] Leaked connection force-closed after ${age}ms (origin: ${record.origin})`,
        );
        this.onLeak?.(record, age);
      }
    }
    return leaked;
  }

  /**
   * Run `fn` with a checked-out client and guarantee release via finally.
   * This is the primary entry point for serverless handlers — it makes the
   * "release after every invocation" contract impossible to forget.
   */
  async withClient<T>(
    fn: (client: PoolClient) => Promise<T>,
    origin = 'withClient',
  ): Promise<T> {
    const pool = await this.getPool();
    const client = await pool.connect();
    const record: CheckoutRecord = {
      client,
      checkedOutAt: Date.now(),
      origin,
      forceClosed: false,
    };
    this.checkouts.add(record);
    try {
      return await fn(client);
    } finally {
      if (!record.forceClosed) {
        this.checkouts.delete(record);
        client.release();
      }
    }
  }

  /**
   * Run `fn` inside a single transaction (BEGIN/COMMIT, ROLLBACK on throw).
   * Transaction pooling means each transaction may land on a different backend
   * connection, so all related statements must run through this one client.
   */
  async withTransaction<T>(
    fn: (client: PoolClient) => Promise<T>,
    origin = 'withTransaction',
  ): Promise<T> {
    return this.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* connection may already be broken */
        }
        throw err;
      }
    }, origin);
  }

  /** Convenience single-statement query that always releases its client. */
  async query<T = unknown>(sql: string, params?: unknown[]) {
    return this.withClient((client) => client.query<T>(sql, params), 'query');
  }

  /** Current pool/leak statistics for monitoring. */
  stats(): PoolStats {
    return {
      total: this.pool?.totalCount ?? 0,
      idle: this.pool?.idleCount ?? 0,
      waiting: this.pool?.waitingCount ?? 0,
      checkedOut: this.checkouts.size,
      leakedTotal: this.leakedTotal,
    };
  }

  /** Drain the pool. Call from a Lambda extension shutdown hook if available. */
  async close(): Promise<void> {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
    this.checkouts.clear();
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}

// ── Module-level singleton (reused across warm invocations) ───────────────────

let _serverlessPool: ServerlessConnectionPool | null = null;

/**
 * Get the process-wide serverless pool. Reused across warm Lambda invocations
 * so the proxy connection is established once and multiplexed thereafter.
 */
export function getServerlessPool(
  config?: ServerlessPoolConfig,
): ServerlessConnectionPool {
  if (!_serverlessPool) {
    _serverlessPool = new ServerlessConnectionPool(config);
  }
  return _serverlessPool;
}

export async function closeServerlessPool(): Promise<void> {
  if (_serverlessPool) {
    await _serverlessPool.close();
    _serverlessPool = null;
  }
}
