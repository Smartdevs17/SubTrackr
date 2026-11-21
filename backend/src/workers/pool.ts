/**
 * Shared Postgres connection pool manager for backend workers (Issue #2089).
 *
 * Every worker in a process talks to a single lazily created `Pool` instance
 * instead of constructing its own. That caps the total connection count at the
 * pool's `max` regardless of how many jobs are registered, and gives shutdown
 * code one place to drain workers before `pool.end()`.
 *
 * The pool factory is injected so unit tests can run without `pg` installed.
 */

import { EventEmitter } from 'events';
import {
  createPool as createPostgresPool,
  type Pool,
  type PoolClient,
  type PoolConfig,
} from '../../shared/db/connectionPool';

export type WorkerPoolErrorCode = 'CLOSED' | 'POOL_FAILED' | 'WORKER_LIMIT' | 'INVALID_WORKER';

/** Error thrown by the worker pool manager. */
export class WorkerPoolError extends Error {
  readonly code: WorkerPoolErrorCode;

  constructor(code: WorkerPoolErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'WorkerPoolError';
    this.code = code;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

export interface WorkerHandle {
  id: string;
  registeredAt: string;
}

export interface WorkerPoolMetrics {
  registeredWorkers: number;
  peakWorkers: number;
  acquisitions: number;
  releases: number;
  poolTotalConnections: number;
  poolIdleConnections: number;
  poolWaitingClients: number;
  configuredMax: number | null;
  closing: boolean;
}

export interface WorkerPoolLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface WorkerPoolManagerConfig {
  /** Override the pool factory (tests / custom pg configuration). */
  createPool?: () => Promise<Pool>;
  /** Optional pg pool overrides applied by the default factory. */
  poolConfig?: Partial<PoolConfig>;
  /** Maximum concurrent registered workers. Default: 64. */
  maxWorkers?: number;
  /** How long close() waits for workers to unregister. Default: 5000 ms. */
  drainTimeoutMs?: number;
  logger?: WorkerPoolLogger;
  onMetrics?: (metrics: WorkerPoolMetrics) => void;
}

/**
 * Owns exactly one shared `Pool` and tracks the workers that depend on it.
 *
 * Events: `pool:created`, `worker:registered`, `worker:unregistered`,
 * `drain:start`, `closed`, `error`, `metrics`.
 */
export class WorkerPoolManager extends EventEmitter {
  private readonly factory: () => Promise<Pool>;
  private readonly maxWorkers: number;
  private readonly drainTimeoutMs: number;
  private readonly logger: WorkerPoolLogger;
  private readonly onMetrics?: (metrics: WorkerPoolMetrics) => void;

  private poolPromise: Promise<Pool> | null = null;
  private cachedPool: Pool | null = null;
  private closePromise: Promise<void> | null = null;
  private readonly workers = new Map<string, WorkerHandle>();
  private peakWorkers = 0;
  private acquisitions = 0;
  private releases = 0;
  private closing = false;
  private closed = false;

  constructor(config: WorkerPoolManagerConfig = {}) {
    super();
    this.factory =
      config.createPool ??
      (() => createPostgresPool(config.poolConfig ?? {}));
    this.maxWorkers = Math.max(1, config.maxWorkers ?? 64);
    this.drainTimeoutMs = Math.max(0, config.drainTimeoutMs ?? 5000);
    this.onMetrics = config.onMetrics;
    this.logger = config.logger ?? {
      debug: () => undefined,
      info: () => undefined,
      warn: (message, meta) => console.warn(message, meta ?? ''),
      error: (message, meta) => console.error(message, meta ?? ''),
    };
  }

  /** The single shared pool. Concurrent callers receive the same promise. */
  getPool(): Promise<Pool> {
    if (this.closed || this.closing) {
      return Promise.reject(new WorkerPoolError('CLOSED', 'Worker pool manager is closing/closed'));
    }

    if (!this.poolPromise) {
      this.poolPromise = this.factory().then(
        (pool) => {
          this.cachedPool = pool;
          this.logger.info('[WorkerPoolManager] Shared Postgres pool created', {
            max: pool.max ?? null,
          });
          this.emit('pool:created', pool);
          pool.on('error', (error) => {
            this.logger.error('[WorkerPoolManager] Pool error', { error: error.message });
            this.emitError(error);
          });
          this.emitMetrics();
          return pool;
        },
        (error: unknown) => {
          // Allow a later call to retry after a transient startup failure.
          this.poolPromise = null;
          const wrapped = new WorkerPoolError('POOL_FAILED', 'Could not create shared Postgres pool', error);
          this.logger.error('[WorkerPoolManager] Pool creation failed', {
            error: wrapped.message,
          });
          this.emitError(wrapped);
          throw wrapped;
        },
      );
    }

    return this.poolPromise;
  }

  /** Register a worker so shutdown can wait for it to finish. */
  registerWorker(id: string): WorkerHandle {
    this.assertActive();
    if (!id || typeof id !== 'string') {
      throw new WorkerPoolError('INVALID_WORKER', 'Worker id must be a non-empty string');
    }
    if (this.workers.has(id)) return this.workers.get(id) as WorkerHandle;
    if (this.workers.size >= this.maxWorkers) {
      throw new WorkerPoolError(
        'WORKER_LIMIT',
        `Worker limit reached (${this.maxWorkers}); cannot register ${id}`,
      );
    }

    const handle: WorkerHandle = { id, registeredAt: new Date().toISOString() };
    this.workers.set(id, handle);
    this.peakWorkers = Math.max(this.peakWorkers, this.workers.size);
    this.logger.debug('[WorkerPoolManager] Worker registered', {
      id,
      count: this.workers.size,
    });
    this.emit('worker:registered', handle);
    this.emitMetrics();
    return handle;
  }

  /** Unregister a worker. Returns true when a registration was removed. */
  unregisterWorker(id: string): boolean {
    const removed = this.workers.delete(id);
    if (removed) {
      this.logger.debug('[WorkerPoolManager] Worker unregistered', {
        id,
        count: this.workers.size,
      });
      this.emit('worker:unregistered', { id });
      this.emitMetrics();
    }
    return removed;
  }

  /** Borrow a client from the shared pool with a guaranteed release. */
  async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const pool = await this.getPool();
    const client = await pool.connect();
    this.acquisitions += 1;
    this.emitMetrics();
    try {
      return await fn(client);
    } finally {
      client.release();
      this.releases += 1;
      this.emitMetrics();
    }
  }

  /** Drain registered workers, then close the shared pool. Idempotent. */
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closePromise = this.performClose();
    return this.closePromise;
  }

  private async performClose(): Promise<void> {
    if (this.closed) return;
    if (!this.closing) {
      this.closing = true;
      this.logger.info('[WorkerPoolManager] Draining workers', {
        workers: this.workers.size,
        timeoutMs: this.drainTimeoutMs,
      });
      this.emit('drain:start', { workers: this.workers.size });
      this.emitMetrics();
    }

    const deadline = Date.now() + this.drainTimeoutMs;
    while (this.workers.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(25, this.drainTimeoutMs)));
    }
    if (this.workers.size > 0) {
      this.logger.warn('[WorkerPoolManager] Drain timeout; closing with workers still registered', {
        workers: this.workers.size,
      });
    }

    if (this.poolPromise) {
      try {
        const pool = await this.poolPromise;
        await pool.end();
      } catch (error) {
        this.logger.error('[WorkerPoolManager] Error while closing pool', {
          error: error instanceof Error ? error.message : String(error),
        });
        this.emitError(error);
      }
    }

    this.poolPromise = null;
    this.cachedPool = null;
    this.closing = false;
    this.closed = true;
    this.logger.info('[WorkerPoolManager] Closed');
    this.emit('closed');
    this.emitMetrics();
  }

  /** Current counters, safe to expose to /metrics. */
  stats(): WorkerPoolMetrics {
    return {
      registeredWorkers: this.workers.size,
      peakWorkers: this.peakWorkers,
      acquisitions: this.acquisitions,
      releases: this.releases,
      poolTotalConnections: this.cachedPool?.totalCount ?? 0,
      poolIdleConnections: this.cachedPool?.idleCount ?? 0,
      poolWaitingClients: this.cachedPool?.waitingCount ?? 0,
      configuredMax: this.cachedPool?.max ?? null,
      closing: this.closing || this.closed,
    };
  }

  private assertActive(): void {
    if (this.closed || this.closing) {
      throw new WorkerPoolError('CLOSED', 'Worker pool manager is closing/closed');
    }
  }

  /** Emit `error` only when observed, so an unhandled EventEmitter error cannot crash a worker. */
  private emitError(error: unknown): void {
    if (this.listenerCount('error') > 0) this.emit('error', error);
  }

  private emitMetrics(): void {
    if (this.onMetrics) this.onMetrics(this.stats());
  }
}

/** Process-wide manager used by all workers unless a test injects its own. */
let sharedManager: WorkerPoolManager | null = null;

export function getWorkerPoolManager(config: WorkerPoolManagerConfig = {}): WorkerPoolManager {
  if (!sharedManager) sharedManager = new WorkerPoolManager(config);
  return sharedManager;
}

export async function closeWorkerPoolManager(): Promise<void> {
  const manager = sharedManager;
  if (!manager) return;
  await manager.close();
  if (sharedManager === manager) sharedManager = null;
}
