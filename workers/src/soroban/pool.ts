/**
 * Soroban RPC connection pool with boot-time pre-warming (Issue #2267).
 *
 * Workers pay a DNS + TLS + RPC round-trip on their first Soroban call unless
 * the transport is warmed while the process is still starting. This module
 * owns that small pool: it establishes idle connections ahead of the first job,
 * reuses them on `acquire()`, and keeps boot alive when a node is down.
 *
 * The connector is injected so tests (and deployments with a custom Stellar
 * client) do not need network access or the Soroban SDK.
 */

export type SorobanNetwork = 'testnet' | 'mainnet';

export interface SorobanRpcEndpoint {
  /** Stable identifier used in logs and metrics. */
  id: string;
  /** JSON-RPC endpoint URL. */
  url: string;
  /** Network label for dashboards. */
  network?: SorobanNetwork;
}

export interface SorobanRpcConnection {
  /** Endpoint that produced this connection. */
  endpointId: string;
  /** Release transport resources (no-op for HTTP keep-alive sockets). */
  close(): void;
}

export type SorobanRpcConnector = (
  endpoint: SorobanRpcEndpoint,
  signal: AbortSignal,
) => Promise<SorobanRpcConnection>;

export interface SorobanRpcPoolMetrics {
  attempts: number;
  warmed: number;
  failed: number;
  reused: number;
  durationMs: number;
  skipped: boolean;
  failedEndpoints: string[];
}

export interface SorobanRpcLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface SorobanRpcPoolConfig {
  endpoints?: SorobanRpcEndpoint[];
  connector?: SorobanRpcConnector;
  /** Idle connections per endpoint created during pre-warm. Default: 1. */
  warmConnections?: number;
  /** Per-connection warmup deadline. Default: 2000 ms. */
  warmupTimeoutMs?: number;
  logger?: SorobanRpcLogger;
  onMetrics?: (metrics: SorobanRpcPoolMetrics) => void;
  now?: () => number;
}

export type SorobanRpcPoolErrorCode = 'CLOSED' | 'INVALID_ENDPOINTS' | 'CONNECT_FAILED';

export class SorobanRpcPoolError extends Error {
  readonly code: SorobanRpcPoolErrorCode;

  constructor(code: SorobanRpcPoolErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'SorobanRpcPoolError';
    this.code = code;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

/** Endpoints shipped with the backend RPC config when none are configured. */
export const DEFAULT_SOROBAN_ENDPOINTS: SorobanRpcEndpoint[] = [
  { id: 'soroban-mainnet', url: 'https://soroban-rpc.stellar.org', network: 'mainnet' },
  { id: 'soroban-testnet', url: 'https://soroban-testnet.stellar.org', network: 'testnet' },
];

/** Parse the comma-separated SOROBAN_RPC_URLS/SOROBAN_RPC_URL env override. */
export function sorobanEndpointsFromEnvironment(
  env: Record<string, string | undefined> = process.env,
): SorobanRpcEndpoint[] {
  const raw = env.SOROBAN_RPC_URLS ?? env.SOROBAN_RPC_URL;
  if (!raw) return DEFAULT_SOROBAN_ENDPOINTS;
  const urls = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (urls.length === 0) return DEFAULT_SOROBAN_ENDPOINTS;
  return urls.map((url, index) => ({
    id: `soroban-env-${index + 1}`,
    url,
    network: env.STELLAR_NETWORK === 'testnet' ? 'testnet' : 'mainnet',
  }));
}

function assertEndpoints(endpoints: SorobanRpcEndpoint[]): void {
  if (!Array.isArray(endpoints) || endpoints.length === 0) {
    throw new SorobanRpcPoolError('INVALID_ENDPOINTS', 'At least one Soroban RPC endpoint is required');
  }
  const seen = new Set<string>();
  for (const endpoint of endpoints) {
    if (!endpoint || typeof endpoint.id !== 'string' || !endpoint.id || typeof endpoint.url !== 'string') {
      throw new SorobanRpcPoolError('INVALID_ENDPOINTS', 'Soroban endpoints need an id and a url');
    }
    try {
      const parsed = new URL(endpoint.url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('bad protocol');
    } catch {
      throw new SorobanRpcPoolError(
        'INVALID_ENDPOINTS',
        `Invalid Soroban RPC url for ${endpoint.id}`,
      );
    }
    if (seen.has(endpoint.id)) {
      throw new SorobanRpcPoolError('INVALID_ENDPOINTS', `Duplicate Soroban endpoint id: ${endpoint.id}`);
    }
    seen.add(endpoint.id);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Run a connector under a deadline, aborting its signal when time is up. */
function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void,
): Promise<T> {
  if (timeoutMs <= 0) return work;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error(`Soroban RPC connection timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Default connector: a JSON-RPC getHealth probe that opens the keep-alive socket. */
export function createFetchSorobanConnector(): SorobanRpcConnector {
  return async (endpoint, signal) => {
    if (typeof fetch !== 'function') {
      throw new SorobanRpcPoolError('CONNECT_FAILED', 'fetch is unavailable in this runtime');
    }
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
      signal,
    });
    if (!response.ok) {
      throw new SorobanRpcPoolError(
        'CONNECT_FAILED',
        `Soroban RPC ${endpoint.id} responded ${response.status}`,
      );
    }
    return { endpointId: endpoint.id, close: () => undefined };
  };
}

const defaultLogger: SorobanRpcLogger = {
  info: () => undefined,
  warn: (message, meta) => console.warn(message, meta ?? ''),
  error: (message, meta) => console.error(message, meta ?? ''),
};

/**
 * Bounded pool of warm Soroban RPC connections. One instance per process;
 * `prewarmSorobanRpcPoolAtBoot()` wires the boot-time call for workers.
 */
export class SorobanRpcPool {
  private readonly endpoints: SorobanRpcEndpoint[];
  private readonly connector: SorobanRpcConnector;
  private readonly warmConnections: number;
  private readonly warmupTimeoutMs: number;
  private readonly logger: SorobanRpcLogger;
  private readonly onMetrics?: (metrics: SorobanRpcPoolMetrics) => void;
  private readonly now: () => number;
  private readonly idle: SorobanRpcConnection[] = [];
  private readonly inUse = new Set<SorobanRpcConnection>();
  private readonly counters = {
    attempts: 0,
    warmed: 0,
    failed: 0,
    reused: 0,
    failedEndpoints: [] as string[],
  };
  private nextEndpoint = 0;
  private warmupPromise: Promise<SorobanRpcPoolMetrics> | null = null;
  private closed = false;

  constructor(config: SorobanRpcPoolConfig = {}) {
    this.endpoints = config.endpoints ?? sorobanEndpointsFromEnvironment();
    assertEndpoints(this.endpoints);
    this.connector = config.connector ?? createFetchSorobanConnector();
    this.warmConnections = Math.max(1, Math.floor(config.warmConnections ?? 1));
    this.warmupTimeoutMs = Math.max(1, config.warmupTimeoutMs ?? 2_000);
    this.logger = config.logger ?? defaultLogger;
    this.onMetrics = config.onMetrics;
    this.now = config.now ?? Date.now;
  }

  /**
   * Establish idle connections before the first job. Idempotent: concurrent
   * callers share one warmup. A dead endpoint is recorded, never thrown, so a
   * partial outage cannot keep the worker from booting.
   */
  warmup(): Promise<SorobanRpcPoolMetrics> {
    if (this.warmupPromise) return this.warmupPromise;
    const startedAt = this.now();

    if (this.closed) {
      const metrics = this.metrics(startedAt, true);
      this.warmupPromise = Promise.resolve(metrics);
      return this.warmupPromise;
    }

    this.warmupPromise = Promise.all(
      this.endpoints.flatMap((endpoint) =>
        Array.from({ length: this.warmConnections }, () => this.warmOne(endpoint)),
      ),
    ).then(() => {
      const metrics = this.metrics(startedAt, false);
      this.logger.info('[soroban-pool] pre-warm complete', {
        warmed: metrics.warmed,
        failed: metrics.failed,
        durationMs: metrics.durationMs,
        endpoints: this.endpoints.map((endpoint) => endpoint.id),
      });
      this.onMetrics?.(metrics);
      return metrics;
    });
    return this.warmupPromise;
  }

  /** Borrow a warm connection, falling back to a fresh one if the pool is empty. */
  async acquire(): Promise<SorobanRpcConnection> {
    if (this.closed) {
      throw new SorobanRpcPoolError('CLOSED', 'Soroban RPC pool is closed');
    }
    const warm = this.idle.shift();
    if (warm) {
      this.inUse.add(warm);
      this.counters.reused += 1;
      return warm;
    }
    const endpoint = this.endpoints[this.nextEndpoint % this.endpoints.length];
    this.nextEndpoint += 1;
    const controller = new AbortController();
    try {
      const connection = await withTimeout(
        this.connector(endpoint, controller.signal),
        this.warmupTimeoutMs,
        () => controller.abort(),
      );
      this.inUse.add(connection);
      return connection;
    } catch (error) {
      throw new SorobanRpcPoolError(
        'CONNECT_FAILED',
        `Could not connect to Soroban RPC ${endpoint.id}: ${errorMessage(error)}`,
        error,
      );
    }
  }

  /** Return a borrowed connection to the idle set. Unknown handles are ignored. */
  release(connection: SorobanRpcConnection): void {
    if (!this.inUse.delete(connection)) return;
    if (this.closed) {
      connection.close();
      return;
    }
    this.idle.push(connection);
  }

  /** Close every connection. Safe to call more than once. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const connection of [...this.idle, ...this.inUse]) connection.close();
    this.idle.length = 0;
    this.inUse.clear();
    this.logger.info('[soroban-pool] closed');
  }

  /** Current pool health, suitable for a /metrics hook. */
  stats(): SorobanRpcPoolMetrics & { idle: number; inUse: number; closed: boolean } {
    return {
      ...this.metrics(this.now(), false),
      idle: this.idle.length,
      inUse: this.inUse.size,
      closed: this.closed,
    };
  }

  private async warmOne(endpoint: SorobanRpcEndpoint): Promise<void> {
    this.counters.attempts += 1;
    const controller = new AbortController();
    try {
      const connection = await withTimeout(
        this.connector(endpoint, controller.signal),
        this.warmupTimeoutMs,
        () => controller.abort(),
      );
      this.idle.push(connection);
      this.counters.warmed += 1;
    } catch (error) {
      this.counters.failed += 1;
      this.counters.failedEndpoints.push(endpoint.id);
      this.logger.warn('[soroban-pool] pre-warm failed for endpoint', {
        endpoint: endpoint.id,
        error: errorMessage(error),
      });
    }
  }

  private metrics(startedAt: number, skipped: boolean): SorobanRpcPoolMetrics {
    return {
      attempts: this.counters.attempts,
      warmed: this.counters.warmed,
      failed: this.counters.failed,
      reused: this.counters.reused,
      durationMs: Math.max(0, this.now() - startedAt),
      skipped,
      failedEndpoints: [...this.counters.failedEndpoints],
    };
  }
}

let bootPool: SorobanRpcPool | null = null;
let bootWarmup: Promise<SorobanRpcPoolMetrics> | null = null;

/**
 * Call from the worker boot path. Starts pre-warming without blocking startup
 * and returns the shared pool plus the warmup promise for tests/observability.
 */
export function prewarmSorobanRpcPoolAtBoot(
  config: SorobanRpcPoolConfig = {},
): { pool: SorobanRpcPool; warmup: Promise<SorobanRpcPoolMetrics> } {
  if (!bootPool) bootPool = new SorobanRpcPool(config);
  if (!bootWarmup) {
    bootWarmup = bootPool.warmup().catch((error: unknown) => {
      console.error('[soroban-pool] unexpected pre-warm error', errorMessage(error));
      return {
        attempts: 0,
        warmed: 0,
        failed: 0,
        reused: 0,
        durationMs: 0,
        skipped: true,
        failedEndpoints: [],
      };
    });
  }
  return { pool: bootPool, warmup: bootWarmup };
}

/** Test-only reset for the process-wide boot pool. */
export function resetSorobanRpcPoolForTests(): void {
  bootPool?.close();
  bootPool = null;
  bootWarmup = null;
}
