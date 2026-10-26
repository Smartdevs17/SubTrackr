/**
 * HTTP/2 connection pool with keep-alive, metrics, and graceful degradation.
 * Issue #414: Reduce API latency with connection pooling and keep-alive.
 */

import * as https from 'https';
import * as http2 from 'http2';
import * as dns from 'dns';
import { EventEmitter } from 'events';

// ── Types ────────────────────────────────────────────────────────────────────

export interface PoolConfig {
  /** Target host (e.g. "horizon-testnet.stellar.org") */
  host: string;
  port?: number;
  /** Max concurrent HTTP/2 streams per connection */
  maxConcurrentStreams?: number;
  /** Max connections in the pool */
  maxConnections?: number;
  /** Idle timeout in ms before a connection is closed */
  idleTimeoutMs?: number;
  /** Connection acquire timeout in ms */
  acquireTimeoutMs?: number;
  /** DNS TTL cache in ms */
  dnsCacheTtlMs?: number;
  /** TLS session resumption */
  tlsSessionReuse?: boolean;
}

export interface PoolMetrics {
  active: number;
  idle: number;
  waiting: number;
  totalCreated: number;
  totalDestroyed: number;
  totalRequests: number;
  avgLatencyMs: number;
  leakedConnections: number;
}

interface PooledConnection {
  id: string;
  session: http2.ClientHttp2Session;
  activeStreams: number;
  createdAt: number;
  lastUsedAt: number;
  idleTimer?: ReturnType<typeof setTimeout>;
}

interface PendingRequest {
  resolve: (conn: PooledConnection) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ── Connection Pool ──────────────────────────────────────────────────────────

export class ConnectionPool extends EventEmitter {
  private readonly config: Required<PoolConfig>;
  private connections: Map<string, PooledConnection> = new Map();
  private waitQueue: PendingRequest[] = [];
  private dnsCache: { address: string; expiresAt: number } | null = null;
  private tlsSession: Buffer | null = null;
  private metrics: PoolMetrics = {
    active: 0,
    idle: 0,
    waiting: 0,
    totalCreated: 0,
    totalDestroyed: 0,
    totalRequests: 0,
    avgLatencyMs: 0,
    leakedConnections: 0,
  };
  private latencySamples: number[] = [];
  private leakDetectionTimer?: ReturnType<typeof setInterval>;

  constructor(config: PoolConfig) {
    super();
    this.config = {
      port: 443,
      maxConcurrentStreams: 100,
      maxConnections: 10,
      idleTimeoutMs: 30_000,
      acquireTimeoutMs: 5_000,
      dnsCacheTtlMs: 60_000,
      tlsSessionReuse: true,
      ...config,
    };
    this.startLeakDetection();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Acquire a connection from the pool, creating one if needed. */
  async acquire(): Promise<PooledConnection> {
    this.metrics.totalRequests++;
    const conn = this.findIdleConnection();
    if (conn) {
      this.markActive(conn);
      return conn;
    }
    if (this.connections.size < this.config.maxConnections) {
      return this.createConnection();
    }
    return this.enqueue();
  }

  /** Release a connection back to the pool. */
  release(conn: PooledConnection): void {
    if (!this.connections.has(conn.id)) return;
    conn.activeStreams = Math.max(0, conn.activeStreams - 1);
    conn.lastUsedAt = Date.now();

    if (this.waitQueue.length > 0) {
      const pending = this.waitQueue.shift()!;
      clearTimeout(pending.timer);
      this.metrics.waiting = this.waitQueue.length;
      this.markActive(conn);
      pending.resolve(conn);
      return;
    }

    this.metrics.active = Math.max(0, this.metrics.active - 1);
    this.metrics.idle++;
    this.scheduleIdleTimeout(conn);
  }

  /** Execute a request using a pooled connection, measuring latency. */
  async request<T>(
    path: string,
    method: string,
    headers?: Record<string, string>,
    body?: string,
  ): Promise<{ status: number; data: T; latencyMs: number }> {
    const conn = await this.acquire();
    const start = Date.now();
    try {
      const result = await this.sendRequest<T>(conn, path, method, headers, body);
      const latencyMs = Date.now() - start;
      this.recordLatency(latencyMs);
      return { ...result, latencyMs };
    } finally {
      this.release(conn);
    }
  }

  getMetrics(): PoolMetrics {
    return { ...this.metrics };
  }

  /** Gracefully drain the pool: wait for active streams to finish, then close. */
  async drain(): Promise<void> {
    // Reject all waiting requests
    for (const pending of this.waitQueue) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Pool is draining'));
    }
    this.waitQueue = [];

    // Wait for active streams to complete (max 10s)
    const deadline = Date.now() + 10_000;
    while (this.metrics.active > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }

    this.destroy();
  }

  destroy(): void {
    if (this.leakDetectionTimer) clearInterval(this.leakDetectionTimer);
    for (const conn of this.connections.values()) {
      this.destroyConnection(conn);
    }
    this.connections.clear();
    this.metrics.active = 0;
    this.metrics.idle = 0;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private findIdleConnection(): PooledConnection | null {
    for (const conn of this.connections.values()) {
      if (
        !conn.session.destroyed &&
        conn.activeStreams < this.config.maxConcurrentStreams
      ) {
        return conn;
      }
    }
    return null;
  }

  private async createConnection(): Promise<PooledConnection> {
    const address = await this.resolveHost();
    const sessionOptions: http2.SecureClientSessionOptions = {
      host: this.config.host,
      servername: this.config.host,
      rejectUnauthorized: true,
    };

    if (this.config.tlsSessionReuse && this.tlsSession) {
      (sessionOptions as Record<string, unknown>).session = this.tlsSession;
    }

    return new Promise((resolve, reject) => {
      const session = http2.connect(
        `https://${address}:${this.config.port}`,
        sessionOptions,
      );

      session.once('connect', () => {
        // Cache TLS session for resumption
        const socket = session.socket as https.Agent & { getSession?: () => Buffer };
        if (this.config.tlsSessionReuse && socket?.getSession) {
          this.tlsSession = socket.getSession() ?? null;
        }

        const conn: PooledConnection = {
          id: `conn-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          session,
          activeStreams: 1,
          createdAt: Date.now(),
          lastUsedAt: Date.now(),
        };
        this.connections.set(conn.id, conn);
        this.metrics.totalCreated++;
        this.metrics.active++;
        resolve(conn);
      });

      session.once('error', (err) => {
        reject(err);
      });

      session.on('close', () => {
        const conn = [...this.connections.values()].find((c) => c.session === session);
        if (conn) this.destroyConnection(conn);
      });

      // Respect server's MAX_CONCURRENT_STREAMS setting
      session.on('remoteSettings', (settings) => {
        if (settings.maxConcurrentStreams) {
          this.config.maxConcurrentStreams = Math.min(
            this.config.maxConcurrentStreams,
            settings.maxConcurrentStreams,
          );
        }
      });
    });
  }

  private enqueue(): Promise<PooledConnection> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waitQueue.findIndex((p) => p.timer === timer);
        if (idx !== -1) this.waitQueue.splice(idx, 1);
        this.metrics.waiting = this.waitQueue.length;
        reject(new Error(`Connection pool exhausted: acquire timeout after ${this.config.acquireTimeoutMs}ms`));
      }, this.config.acquireTimeoutMs);

      this.waitQueue.push({ resolve, reject, timer });
      this.metrics.waiting = this.waitQueue.length;
    });
  }

  private markActive(conn: PooledConnection): void {
    if (conn.idleTimer) {
      clearTimeout(conn.idleTimer);
      conn.idleTimer = undefined;
    }
    conn.activeStreams++;
    conn.lastUsedAt = Date.now();
    this.metrics.idle = Math.max(0, this.metrics.idle - 1);
    this.metrics.active++;
  }

  private scheduleIdleTimeout(conn: PooledConnection): void {
    if (conn.idleTimer) clearTimeout(conn.idleTimer);
    conn.idleTimer = setTimeout(() => {
      if (conn.activeStreams === 0) {
        this.destroyConnection(conn);
      }
    }, this.config.idleTimeoutMs);
  }

  private destroyConnection(conn: PooledConnection): void {
    if (!this.connections.has(conn.id)) return;
    if (conn.idleTimer) clearTimeout(conn.idleTimer);
    if (!conn.session.destroyed) conn.session.destroy();
    this.connections.delete(conn.id);
    this.metrics.totalDestroyed++;
    this.metrics.idle = Math.max(0, this.metrics.idle - 1);
    this.emit('connectionDestroyed', conn.id);
  }

  private async resolveHost(): Promise<string> {
    if (this.dnsCache && Date.now() < this.dnsCache.expiresAt) {
      return this.dnsCache.address;
    }
    return new Promise((resolve, reject) => {
      dns.lookup(this.config.host, { family: 4 }, (err, address) => {
        if (err) return reject(err);
        this.dnsCache = { address, expiresAt: Date.now() + this.config.dnsCacheTtlMs };
        resolve(address);
      });
    });
  }

  private sendRequest<T>(
    conn: PooledConnection,
    path: string,
    method: string,
    headers?: Record<string, string>,
    body?: string,
  ): Promise<{ status: number; data: T }> {
    return new Promise((resolve, reject) => {
      const reqHeaders: http2.OutgoingHttpHeaders = {
        ':method': method,
        ':path': path,
        ':scheme': 'https',
        ':authority': this.config.host,
        'content-type': 'application/json',
        ...headers,
      };
      if (body) reqHeaders['content-length'] = Buffer.byteLength(body).toString();

      const req = conn.session.request(reqHeaders);
      if (body) req.write(body);
      req.end();

      let status = 0;
      const chunks: Buffer[] = [];

      req.on('response', (responseHeaders) => {
        status = Number(responseHeaders[':status'] ?? 0);
      });
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          const data = raw ? (JSON.parse(raw) as T) : ({} as T);
          resolve({ status, data });
        } catch (e) {
          reject(e);
        }
      });
      req.on('error', reject);
    });
  }

  private recordLatency(ms: number): void {
    this.latencySamples.push(ms);
    if (this.latencySamples.length > 100) this.latencySamples.shift();
    this.metrics.avgLatencyMs =
      this.latencySamples.reduce((a, b) => a + b, 0) / this.latencySamples.length;
  }

  /** Detect connections that have been active too long (potential leaks). */
  private startLeakDetection(): void {
    const LEAK_THRESHOLD_MS = 60_000;
    this.leakDetectionTimer = setInterval(() => {
      let leaked = 0;
      for (const conn of this.connections.values()) {
        if (conn.activeStreams > 0 && Date.now() - conn.lastUsedAt > LEAK_THRESHOLD_MS) {
          leaked++;
          this.emit('connectionLeak', conn.id);
        }
      }
      this.metrics.leakedConnections = leaked;
    }, 30_000);
  }
}

// ── Singleton factory ────────────────────────────────────────────────────────

const pools = new Map<string, ConnectionPool>();

export function getPool(config: PoolConfig): ConnectionPool {
  const key = `${config.host}:${config.port ?? 443}`;
  if (!pools.has(key)) {
    pools.set(key, new ConnectionPool(config));
  }
  return pools.get(key)!;
}

/** Pre-configured pool for Stellar Horizon RPC */
export const stellarPool = getPool({
  host: 'horizon-testnet.stellar.org',
  maxConnections: 5,
  maxConcurrentStreams: 50,
  idleTimeoutMs: 30_000,
  dnsCacheTtlMs: 60_000,
  tlsSessionReuse: true,
});
