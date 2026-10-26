// ---------------------------------------------------------------------------
// WebSocket server service — optimized with:
//   • Connection pooling (per-user connection limit)
//   • Message batching with configurable flush interval
//   • Per-client send-queue with backpressure
//   • Connection health monitoring (ping/pong heartbeat)
//   • Message throughput metrics
//   • Graceful degradation (slow/dead clients are evicted)
// ---------------------------------------------------------------------------

import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SubscriptionEventType =
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.cancelled'
  | 'subscription.charged'
  | 'subscription.charge_failed'
  | 'subscription.renewed';

export interface SubscriptionEvent {
  type: SubscriptionEventType;
  subscriptionId: string;
  userId: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

export interface EventFilter {
  types?: SubscriptionEventType[];
  subscriptionIds?: string[];
  userId?: string;
}

export interface ClientInfo {
  id: string;
  userId: string;
  connectedAt: number;
  filter: EventFilter;
  /** Number of events delivered to this client since connection */
  deliveredCount: number;
  /** Number of events dropped (queue full / client too slow) */
  droppedCount: number;
  /** Last heartbeat timestamp */
  lastPingAt: number;
}

/** Aggregated throughput and health metrics */
export interface WebSocketMetrics {
  connectedClients: number;
  totalConnections: number;
  totalDisconnections: number;
  eventsPublished: number;
  eventsDelivered: number;
  eventsDropped: number;
  batchesFlushed: number;
  avgBatchSize: number;
  evictedClients: number;
  /** Events per second (rolling 10-second window) */
  throughputEps: number;
}

export interface WebSocketServerConfig {
  /**
   * Maximum simultaneous connections per userId.
   * Extra connections beyond this limit are rejected on connect().
   * Default: 5.
   */
  maxConnectionsPerUser?: number;
  /**
   * Batch flush interval in milliseconds.
   * Messages accumulate and are sent together at each interval.
   * 0 = disabled (send immediately, legacy behaviour).
   * Default: 0 ms.
   */
  batchIntervalMs?: number;
  /**
   * Maximum number of events to hold in a client's send queue before
   * dropping the oldest events (backpressure / slow-consumer protection).
   * Default: 100.
   */
  maxQueueSize?: number;
  /**
   * Heartbeat interval in ms. The server calls onPing() and expects
   * clientPong() within `pingTimeoutMs`.
   * Default: 30 000 ms.
   */
  heartbeatIntervalMs?: number;
  /**
   * Time after a ping before a non-responsive client is evicted.
   * Default: 10 000 ms.
   */
  pingTimeoutMs?: number;
}

export type SubscriptionEventHandler = (event: SubscriptionEvent) => number;

export interface SubscriptionEventBus {
  publish(event: SubscriptionEvent): number;
  subscribe(handler: SubscriptionEventHandler): () => void;
}

export class InMemorySubscriptionEventBus extends EventEmitter implements SubscriptionEventBus {
  private readonly handlers = new Set<SubscriptionEventHandler>();

  publish(event: SubscriptionEvent): number {
    let matchedClients = 0;
    for (const handler of this.handlers) {
      matchedClients += handler(event);
    }
    this.emit('subscription.event.published', { event, matchedClients });
    return matchedClients;
  }

  subscribe(handler: SubscriptionEventHandler): () => void {
    this.handlers.add(handler);
    this.emit('subscription.handler.registered', { handlerCount: this.handlers.size });
    return () => {
      this.handlers.delete(handler);
      this.emit('subscription.handler.removed', { handlerCount: this.handlers.size });
    };
  }
}

// ---------------------------------------------------------------------------
// Internal state per connected client
// ---------------------------------------------------------------------------

interface ClientState {
  info: ClientInfo;
  /** The transport send callback (provided by caller) */
  send: (event: SubscriptionEvent) => void;
  /** Batched events pending flush */
  queue: SubscriptionEvent[];
  /** True while awaiting a pong response */
  awaitingPong: boolean;
  /** Timer set after sending a ping — evicts client if it fires */
  pongTimeoutTimer?: ReturnType<typeof setTimeout>;
}

// ---------------------------------------------------------------------------
// WebSocketServer
// ---------------------------------------------------------------------------

export class WebSocketServer extends EventEmitter {
  private readonly cfg: Required<WebSocketServerConfig>;
  private readonly eventBus: SubscriptionEventBus;
  private readonly unsubscribeFromEventBus: () => void;

  /** clientId → state */
  private clients: Map<string, ClientState> = new Map();

  /** userId → set of clientIds (for per-user connection limit) */
  private userConnections: Map<string, Set<string>> = new Map();

  /** Batch flush timer */
  private flushTimer?: ReturnType<typeof setInterval>;

  /** Heartbeat timer */
  private heartbeatTimer?: ReturnType<typeof setInterval>;

  /** Raw metric counters */
  private metrics: Omit<WebSocketMetrics, 'throughputEps'> = {
    connectedClients: 0,
    totalConnections: 0,
    totalDisconnections: 0,
    eventsPublished: 0,
    eventsDelivered: 0,
    eventsDropped: 0,
    batchesFlushed: 0,
    avgBatchSize: 0,
    evictedClients: 0,
  };

  /** Rolling window for throughput calculation (event timestamps, last 10 s) */
  private deliveryTimestamps: number[] = [];
  private totalBatchItems = 0;

  constructor(
    config: WebSocketServerConfig = {},
    eventBus: SubscriptionEventBus = new InMemorySubscriptionEventBus()
  ) {
    super();
    this.cfg = {
      maxConnectionsPerUser: 5,
      batchIntervalMs: 0,
      maxQueueSize: 100,
      heartbeatIntervalMs: 30_000,
      pingTimeoutMs: 10_000,
      ...config,
    };
    this.eventBus = eventBus;
    this.unsubscribeFromEventBus = this.eventBus.subscribe((event) =>
      this._dispatchSubscriptionEvent(event)
    );
    this._startBatchFlush();
    this._startHeartbeat();
  }

  // ── Connection management ─────────────────────────────────────────────────

  /**
   * Register a new client connection.
   *
   * Returns the ClientInfo on success, or throws if the per-user connection
   * limit is exceeded (graceful degradation — caller should close the socket).
   */
  connect(
    clientId: string,
    userId: string,
    send: (event: SubscriptionEvent) => void,
    filter: EventFilter = {}
  ): ClientInfo {
    // Per-user connection limit
    const userConns = this.userConnections.get(userId) ?? new Set<string>();
    if (userConns.size >= this.cfg.maxConnectionsPerUser) {
      throw new Error(
        `Connection limit reached for user ${userId}: max ${this.cfg.maxConnectionsPerUser} connections`
      );
    }

    const info: ClientInfo = {
      id: clientId,
      userId,
      connectedAt: Date.now(),
      filter,
      deliveredCount: 0,
      droppedCount: 0,
      lastPingAt: Date.now(),
    };

    const state: ClientState = {
      info,
      send,
      queue: [],
      awaitingPong: false,
    };

    this.clients.set(clientId, state);
    userConns.add(clientId);
    this.userConnections.set(userId, userConns);

    this.metrics.connectedClients++;
    this.metrics.totalConnections++;

    this.emit('presence', { type: 'join', clientId, userId });
    return info;
  }

  disconnect(clientId: string): void {
    const state = this.clients.get(clientId);
    if (!state) return;

    // Cancel pending pong timeout
    if (state.pongTimeoutTimer) clearTimeout(state.pongTimeoutTimer);

    // Flush any queued events before disconnecting
    if (state.queue.length > 0) {
      this._flushClient(state);
    }

    const { userId } = state.info;
    this.clients.delete(clientId);

    const userConns = this.userConnections.get(userId);
    if (userConns) {
      userConns.delete(clientId);
      if (userConns.size === 0) this.userConnections.delete(userId);
    }

    this.metrics.connectedClients = Math.max(0, this.metrics.connectedClients - 1);
    this.metrics.totalDisconnections++;

    this.emit('presence', { type: 'leave', clientId, userId });
  }

  /**
   * Called by transport layer when a pong frame is received from a client.
   */
  clientPong(clientId: string): void {
    const state = this.clients.get(clientId);
    if (!state) return;
    state.awaitingPong = false;
    state.info.lastPingAt = Date.now();
    if (state.pongTimeoutTimer) {
      clearTimeout(state.pongTimeoutTimer);
      state.pongTimeoutTimer = undefined;
    }
  }

  getPresence(): ClientInfo[] {
    return Array.from(this.clients.values()).map((s) => ({ ...s.info }));
  }

  isConnected(clientId: string): boolean {
    return this.clients.has(clientId);
  }

  setFilter(clientId: string, filter: EventFilter): void {
    const state = this.clients.get(clientId);
    if (!state) throw new Error(`Client ${clientId} not connected`);
    state.info.filter = filter;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  // ── Event broadcasting ────────────────────────────────────────────────────

  /**
   * Enqueue a subscription event for all matching clients.
   *
   * When `batchIntervalMs > 0`, events accumulate until the next flush.
   * When `batchIntervalMs === 0`, events are sent immediately (legacy).
  */
  broadcast(event: SubscriptionEvent): number {
    const queued = this.eventBus.publish(event);

    this.emit('broadcast', { event, queued, delivered: queued });
    return queued;
  }

  private _dispatchSubscriptionEvent(event: SubscriptionEvent): number {
    this.metrics.eventsPublished++;
    let queued = 0;

    for (const state of this.clients.values()) {
      if (!this._matchesFilter(event, state.info.filter)) continue;

      if (this.cfg.batchIntervalMs === 0) {
        // Immediate mode — send directly
        this._sendToClient(state, event);
      } else {
        // Batching mode — enqueue with overflow protection
        if (state.queue.length >= this.cfg.maxQueueSize) {
          // Drop the oldest event to make room (head-drop backpressure)
          state.queue.shift();
          state.info.droppedCount++;
          this.metrics.eventsDropped++;
          this.emit('messageDrop', { clientId: state.info.id, event });
        }
        state.queue.push(event);
      }
      queued++;
    }

    this.emit('eventQueued', { event, queued });
    return queued;
  }

  // ── Metrics ───────────────────────────────────────────────────────────────

  getMetrics(): WebSocketMetrics {
    const now = Date.now();
    // Keep only last 10 seconds for throughput calculation
    const cutoff = now - 10_000;
    this.deliveryTimestamps = this.deliveryTimestamps.filter((t) => t > cutoff);
    const throughputEps = this.deliveryTimestamps.length / 10;

    return {
      ...this.metrics,
      throughputEps,
    };
  }

  // ── Graceful shutdown ─────────────────────────────────────────────────────

  /**
   * Flush all pending batches, stop timers.
   * Call before process shutdown.
   */
  shutdown(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.unsubscribeFromEventBus();
    this._flushAll();
    // Disconnect all clients
    for (const clientId of [...this.clients.keys()]) {
      this.disconnect(clientId);
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private _matchesFilter(event: SubscriptionEvent, filter: EventFilter): boolean {
    if (filter.types?.length && !filter.types.includes(event.type)) return false;
    if (filter.subscriptionIds?.length && !filter.subscriptionIds.includes(event.subscriptionId))
      return false;
    if (filter.userId && filter.userId !== event.userId) return false;
    return true;
  }

  private _sendToClient(state: ClientState, event: SubscriptionEvent): void {
    try {
      state.send(event);
      state.info.deliveredCount++;
      this.metrics.eventsDelivered++;
      this.deliveryTimestamps.push(Date.now());
    } catch {
      // Transport error — evict the client
      this._evictClient(state.info.id, 'send_error');
    }
  }

  private _flushClient(state: ClientState): void {
    if (state.queue.length === 0) return;

    const batch = state.queue.splice(0);
    this.metrics.batchesFlushed++;
    this.totalBatchItems += batch.length;
    this.metrics.avgBatchSize =
      this.metrics.batchesFlushed > 0
        ? this.totalBatchItems / this.metrics.batchesFlushed
        : 0;

    for (const event of batch) {
      try {
        state.send(event);
        state.info.deliveredCount++;
        this.metrics.eventsDelivered++;
        this.deliveryTimestamps.push(Date.now());
      } catch {
        // Transport error mid-batch — evict and stop
        this._evictClient(state.info.id, 'send_error');
        return;
      }
    }
  }

  private _flushAll(): void {
    for (const state of this.clients.values()) {
      this._flushClient(state);
    }
  }

  private _startBatchFlush(): void {
    if (this.cfg.batchIntervalMs <= 0) return;
    this.flushTimer = setInterval(() => this._flushAll(), this.cfg.batchIntervalMs);
  }

  private _startHeartbeat(): void {
    if (this.cfg.heartbeatIntervalMs <= 0) return;
    this.heartbeatTimer = setInterval(() => {
      for (const [clientId, state] of this.clients) {
        if (state.awaitingPong) {
          // Client didn't respond to last ping — evict
          this._evictClient(clientId, 'ping_timeout');
          continue;
        }
        state.awaitingPong = true;
        state.info.lastPingAt = Date.now();
        this.emit('ping', { clientId });

        // Set a timeout — if clientPong() isn't called in time, evict
        state.pongTimeoutTimer = setTimeout(() => {
          if (state.awaitingPong) {
            this._evictClient(clientId, 'ping_timeout');
          }
        }, this.cfg.pingTimeoutMs);
      }
    }, this.cfg.heartbeatIntervalMs);
  }

  private _evictClient(clientId: string, reason: string): void {
    this.metrics.evictedClients++;
    this.emit('eviction', { clientId, reason });
    this.disconnect(clientId);
  }
}

export const webSocketServer = new WebSocketServer(
  process.env.NODE_ENV === 'test' ? { heartbeatIntervalMs: 0 } : {}
);
