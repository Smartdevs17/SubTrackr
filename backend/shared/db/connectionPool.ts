/**
 * PostgreSQL connection pool configuration using pg-pool.
 *
 * Acceptance criteria targets:
 *   - max 20 connections
 *   - idle timeout 10 s
 *   - statement timeout 30 s
 *   - list query for 1000 subscriptions uses <5 connections in <500 ms
 *
 * NOTE: pg and pg-pool are Node.js-only dependencies used exclusively in the
 * backend service layer, not bundled into the React Native app.
 */

// pg-pool type interface (install: npm i pg pg-pool @types/pg)
// Defined inline to avoid a hard runtime dependency in environments
// where pg is not installed (e.g., the mobile bundle).

export interface PoolConfig {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  /** Max number of connections. Default: 20 */
  max?: number;
  /** Idle connection timeout in ms. Default: 10 000 */
  idleTimeoutMillis?: number;
  /** Connection acquisition timeout in ms. Default: 30 000 */
  connectionTimeoutMillis?: number;
  /** Per-statement timeout in ms (set via SET statement_timeout). Default: 30 000 */
  statementTimeout?: number;
  ssl?: boolean | { rejectUnauthorized: boolean };
}

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export interface PoolClient {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  release(): void;
}

export interface Pool {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  connect(): Promise<PoolClient>;
  end(): Promise<void>;
  on(event: 'error', handler: (err: Error) => void): void;
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}

const DEFAULT_CONFIG: Required<PoolConfig> = {
  host: process.env['DB_HOST'] ?? 'localhost',
  port: Number(process.env['DB_PORT'] ?? 5432),
  database: process.env['DB_NAME'] ?? 'subtrackr',
  user: process.env['DB_USER'] ?? 'postgres',
  password: process.env['DB_PASSWORD'] ?? '',
  max: 20,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 30_000,
  statementTimeout: 30_000,
  ssl: process.env['DB_SSL'] === 'true' ? { rejectUnauthorized: true } : false,
};

/**
 * Create a configured pg Pool.
 * Lazily imports `pg` so the import doesn't blow up in RN environments.
 */
export async function createPool(overrides: Partial<PoolConfig> = {}): Promise<Pool> {
  // Dynamic import keeps this out of the mobile bundle
  const { Pool: PgPool } = await import('pg') as { Pool: new (cfg: PoolConfig) => Pool };

  const config: PoolConfig = { ...DEFAULT_CONFIG, ...overrides };

  const pool = new PgPool(config);

  // Apply statement_timeout per new connection
  pool.on('error', (err) => {
    console.error('[DB Pool] Unexpected pool error:', err.message);
  });

  // Verify statement_timeout is honoured on each new client
  const origConnect = pool.connect.bind(pool);
  (pool as Pool & { connect: () => Promise<PoolClient> }).connect = async () => {
    const client = await origConnect();
    try {
      await client.query(`SET statement_timeout = ${config.statementTimeout ?? 30_000}`);
    } catch (err) {
      console.warn('[DB Pool] Could not set statement_timeout:', err);
    }
    return client;
  };

  return pool;
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _pool: Pool | null = null;

export async function getPool(): Promise<Pool> {
  if (!_pool) {
    _pool = await createPool();
  }
  return _pool;
}

export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
