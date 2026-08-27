/**
 * WebSocket Connection Pool with Message Batching — SubTrackr
 *
 * Manages WebSocket connections with connection pooling,
 * message batching for efficiency, and health monitoring.
 */

export interface WsPoolConfig {
  maxConnections: number;
  maxIdleMs: number;
  batchSize: number;
  batchIntervalMs: number;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
}

export interface WsConnection {
  id: string;
  url: string;
  socket: unknown;
  connectedAt: number;
  lastActivityAt: number;
  messagesSent: number;
  messagesReceived: number;
  healthy: boolean;
  metadata: Record<string, unknown>;
}

export interface WsMessage {
  id: string;
  connectionId: string;
  data: string | Buffer;
  timestamp: number;
  priority: 'high' | 'normal' | 'low';
}

export interface WsPoolMetrics {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  messagesQueued: number;
  messagesSent: number;
  messagesBatched: number;
  averageBatchSize: number;
  connectionErrors: number;
}

const DEFAULT_WS_CONFIG: WsPoolConfig = {
  maxConnections: 50,
  maxIdleMs: 300000,
  batchSize: 10,
  batchIntervalMs: 100,
  heartbeatIntervalMs: 30000,
  heartbeatTimeoutMs: 10000,
};

let wsJobCounter = 0;

export class WsConnectionPool {
  private connections = new Map<string, WsConnection>();
  private messageQueue: WsMessage[] = [];
  private batchTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private config: WsPoolConfig;

  private messagesSent = 0;
  private messagesBatched = 0;
  private batchSizes: number[] = [];
  private connectionErrors = 0;

  private flushCallback: ((messages: WsMessage[]) => Promise<void>) | null = null;

  constructor(config: Partial<WsPoolConfig> = {}) {
    this.config = { ...DEFAULT_WS_CONFIG, ...config };
    this.startBatchTimer();
    this.startHeartbeatTimer();
  }

  setFlushCallback(callback: (messages: WsMessage[]) => Promise<void>): void {
    this.flushCallback = callback;
  }

  addConnection(url: string, socket: unknown, metadata: Record<string, unknown> = {}): WsConnection | null {
    if (this.connections.size >= this.config.maxConnections) {
      this.evictIdlest();
      if (this.connections.size >= this.config.maxConnections) {
        return null;
      }
    }

    const id = `ws_${++wsJobCounter}`;
    const connection: WsConnection = {
      id,
      url,
      socket,
      connectedAt: Date.now(),
      lastActivityAt: Date.now(),
      messagesSent: 0,
      messagesReceived: 0,
      healthy: true,
      metadata,
    };

    this.connections.set(id, connection);
    return connection;
  }

  removeConnection(id: string): boolean {
    return this.connections.delete(id);
  }

  getConnection(id: string): WsConnection | undefined {
    return this.connections.get(id);
  }

  getConnectionsByUrl(url: string): WsConnection[] {
    return Array.from(this.connections.values()).filter((c) => c.url === url && c.healthy);
  }

  queueMessage(
    connectionId: string,
    data: string | Buffer,
    priority: 'high' | 'normal' | 'low' = 'normal',
  ): WsMessage | null {
    const connection = this.connections.get(connectionId);
    if (!connection || !connection.healthy) return null;

    const message: WsMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      connectionId,
      data,
      timestamp: Date.now(),
      priority,
    };

    if (priority === 'high') {
      const firstNormal = this.messageQueue.findIndex((m) => m.priority !== 'high');
      this.messageQueue.splice(firstNormal >= 0 ? firstNormal : 0, 0, message);
    } else {
      this.messageQueue.push(message);
    }

    if (this.messageQueue.length >= this.config.batchSize) {
      this.flushBatch();
    }

    return message;
  }

  private async flushBatch(): Promise<void> {
    if (this.messageQueue.length === 0) return;

    const batch = this.messageQueue.splice(0, this.config.batchSize);
    this.batchSizes.push(batch.length);
    if (this.batchSizes.length > 100) this.batchSizes.shift();

    this.messagesBatched += batch.length;

    if (this.flushCallback) {
      try {
        await this.flushCallback(batch);
        for (const msg of batch) {
          const conn = this.connections.get(msg.connectionId);
          if (conn) {
            conn.messagesSent += 1;
            conn.lastActivityAt = Date.now();
          }
        }
        this.messagesSent += batch.length;
      } catch {
        this.connectionErrors += batch.length;
      }
    }
  }

  private startBatchTimer(): void {
    this.batchTimer = setInterval(() => {
      this.flushBatch();
    }, this.config.batchIntervalMs);
  }

  private startHeartbeatTimer(): void {
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, conn] of this.connections) {
        if (now - conn.lastActivityAt > this.config.maxIdleMs) {
          conn.healthy = false;
        }
      }
    }, this.config.heartbeatIntervalMs);
  }

  private evictIdlest(): void {
    let oldest: WsConnection | null = null;
    for (const conn of this.connections.values()) {
      if (!oldest || conn.lastActivityAt < oldest.lastActivityAt) {
        oldest = conn;
      }
    }
    if (oldest) {
      this.connections.delete(oldest.id);
    }
  }

  recordActivity(connectionId: string): void {
    const conn = this.connections.get(connectionId);
    if (conn) {
      conn.lastActivityAt = Date.now();
      conn.messagesReceived += 1;
    }
  }

  markUnhealthy(connectionId: string): void {
    const conn = this.connections.get(connectionId);
    if (conn) conn.healthy = false;
  }

  getHealthyConnections(): WsConnection[] {
    return Array.from(this.connections.values()).filter((c) => c.healthy);
  }

  getMetrics(): WsPoolMetrics {
    const allConnections = Array.from(this.connections.values());
    const active = allConnections.filter((c) => c.healthy).length;
    const idle = allConnections.filter(
      (c) => !c.healthy || Date.now() - c.lastActivityAt > this.config.maxIdleMs,
    ).length;
    const avgBatch = this.batchSizes.length > 0
      ? this.batchSizes.reduce((a, b) => a + b, 0) / this.batchSizes.length
      : 0;

    return {
      totalConnections: this.connections.size,
      activeConnections: active,
      idleConnections: idle,
      messagesQueued: this.messageQueue.length,
      messagesSent: this.messagesSent,
      messagesBatched: this.messagesBatched,
      averageBatchSize: Math.round(avgBatch * 100) / 100,
      connectionErrors: this.connectionErrors,
    };
  }

  dispose(): void {
    if (this.batchTimer) clearInterval(this.batchTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.connections.clear();
    this.messageQueue.length = 0;
  }
}
