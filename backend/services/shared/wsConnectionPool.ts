/**
 * WebSocket Connection Pool — SubTrackr
 *
 * Manages WebSocket connections with pooling, message batching, and health monitoring.
 */

export interface WsPoolConfig {
  maxConnections: number;
  messageBatchSize: number;
  messageBatchIntervalMs: number;
  heartbeatIntervalMs: number;
  connectionTimeoutMs: number;
}

export interface WsConnection {
  id: string;
  url: string;
  connected: boolean;
  connectedAt?: number;
  lastMessageAt?: number;
  messageCount: number;
  reconnects: number;
}

export interface WsMessage {
  id: string;
  connectionId: string;
  data: string | Buffer;
  timestamp: number;
  sent: boolean;
}

export interface WsPoolMetrics {
  totalConnections: number;
  activeConnections: number;
  messagesSent: number;
  messagesFailed: number;
  batchesSent: number;
  avgBatchSize: number;
}

export class WsConnectionPool {
  private connections = new Map<string, WsConnection>();
  private messageQueue: WsMessage[] = [];
  private batchTimer?: ReturnType<typeof setInterval>;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private config: WsPoolConfig;
  private metrics: WsPoolMetrics = {
    totalConnections: 0,
    activeConnections: 0,
    messagesSent: 0,
    messagesFailed: 0,
    batchesSent: 0,
    avgBatchSize: 0,
  };

  constructor(config: Partial<WsPoolConfig> = {}) {
    this.config = {
      maxConnections: config.maxConnections ?? 50,
      messageBatchSize: config.messageBatchSize ?? 10,
      messageBatchIntervalMs: config.messageBatchIntervalMs ?? 50,
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 30000,
      connectionTimeoutMs: config.connectionTimeoutMs ?? 5000,
    };
  }

  addConnection(url: string): WsConnection | null {
    if (this.connections.size >= this.config.maxConnections) return null;

    const connection: WsConnection = {
      id: `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      url,
      connected: true,
      connectedAt: Date.now(),
      messageCount: 0,
      reconnects: 0,
    };

    this.connections.set(connection.id, connection);
    this.metrics.totalConnections++;
    this.metrics.activeConnections = this.connections.size;
    return connection;
  }

  removeConnection(id: string): boolean {
    const removed = this.connections.delete(id);
    if (removed) {
      this.metrics.activeConnections = this.connections.size;
    }
    return removed;
  }

  queueMessage(connectionId: string, data: string | Buffer): WsMessage | null {
    const conn = this.connections.get(connectionId);
    if (!conn || !conn.connected) return null;

    const message: WsMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      connectionId,
      data,
      timestamp: Date.now(),
      sent: false,
    };

    this.messageQueue.push(message);
    return message;
  }

  async flushBatch(): Promise<WsMessage[]> {
    const batch = this.messageQueue.splice(0, this.config.messageBatchSize);
    if (batch.length === 0) return [];

    const sent: WsMessage[] = [];
    for (const msg of batch) {
      const conn = this.connections.get(msg.connectionId);
      if (conn && conn.connected) {
        msg.sent = true;
        conn.messageCount++;
        conn.lastMessageAt = Date.now();
        this.metrics.messagesSent++;
        sent.push(msg);
      } else {
        this.metrics.messagesFailed++;
      }
    }

    this.metrics.batchesSent++;
    this.metrics.avgBatchSize =
      (this.metrics.avgBatchSize * (this.metrics.batchesSent - 1) + batch.length) /
      this.metrics.batchesSent;

    return sent;
  }

  startBatching(): void {
    if (this.batchTimer) return;
    this.batchTimer = setInterval(() => {
      void this.flushBatch();
    }, this.config.messageBatchIntervalMs);
  }

  stopBatching(): void {
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = undefined;
    }
  }

  startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, conn] of this.connections) {
        if (conn.lastMessageAt && now - conn.lastMessageAt > this.config.heartbeatIntervalMs * 2) {
          conn.connected = false;
          this.connections.delete(id);
          this.metrics.activeConnections = this.connections.size;
        }
      }
    }, this.config.heartbeatIntervalMs);
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  getConnection(id: string): WsConnection | undefined {
    return this.connections.get(id);
  }

  getConnections(): WsConnection[] {
    return Array.from(this.connections.values());
  }

  getMetrics(): WsPoolMetrics {
    return { ...this.metrics };
  }

  getPendingMessageCount(): number {
    return this.messageQueue.filter((m) => !m.sent).length;
  }

  stop(): void {
    this.stopBatching();
    this.stopHeartbeat();
  }
}
