// ---------------------------------------------------------------------------
// Real-time WebSocket client for React Native
// Handles connection, reconnection, event filtering, and multi-subscriber
// fan-out entirely in-process (no native WebSocket dependency needed for tests).
// ---------------------------------------------------------------------------

import {
  SubscriptionEvent,
  SubscriptionEventType,
  EventFilter,
} from '../../backend/services/notification/websocket';

export type EventHandler = (event: SubscriptionEvent) => void;

interface Subscriber {
  id: string;
  filter: EventFilter;
  handler: EventHandler;
}

export interface RealtimeConfig {
  url: string;
  /** Base reconnect delay in ms */
  reconnectDelayMs?: number;
  /** Maximum reconnect attempts (0 = unlimited) */
  maxReconnectAttempts?: number;
}

// ---------------------------------------------------------------------------
// RealtimeService
// ---------------------------------------------------------------------------

export class RealtimeService {
  private ws: WebSocket | null = null;
  private subscribers: Map<string, Subscriber> = new Map();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _connected = false;
  private readonly config: Required<RealtimeConfig>;

  constructor(config: RealtimeConfig) {
    this.config = {
      reconnectDelayMs: 2000,
      maxReconnectAttempts: 10,
      ...config,
    };
  }

  // ── Connection ────────────────────────────────────────────────────────────

  connect(): void {
    if (this._connected) return;
    try {
      this.ws = new WebSocket(this.config.url);
      this.ws.onopen = () => {
        this._connected = true;
        this.reconnectAttempts = 0;
      };
      this.ws.onmessage = (msg: MessageEvent) => {
        try {
          const event: SubscriptionEvent = JSON.parse(msg.data as string);
          this._dispatch(event);
        } catch {
          // malformed message — ignore
        }
      };
      this.ws.onclose = () => {
        this._connected = false;
        this._scheduleReconnect();
      };
      this.ws.onerror = () => {
        this._connected = false;
      };
    } catch {
      this._scheduleReconnect();
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this._connected = false;
    this.reconnectAttempts = 0;
  }

  get connected(): boolean {
    return this._connected;
  }

  // ── Reconnection handling ─────────────────────────────────────────────────

  private _scheduleReconnect(): void {
    const { maxReconnectAttempts, reconnectDelayMs } = this.config;
    if (maxReconnectAttempts > 0 && this.reconnectAttempts >= maxReconnectAttempts) return;
    this.reconnectAttempts++;
    const delay = reconnectDelayMs * Math.min(this.reconnectAttempts, 8); // cap backoff
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  // ── Multi-subscriber fan-out ──────────────────────────────────────────────

  /** Subscribe to events. Returns an unsubscribe function. */
  subscribe(handler: EventHandler, filter: EventFilter = {}): () => void {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.subscribers.set(id, { id, filter, handler });
    return () => this.subscribers.delete(id);
  }

  /** Update the filter for a subscriber by id */
  updateFilter(subscriberId: string, filter: EventFilter): void {
    const sub = this.subscribers.get(subscriberId);
    if (sub) sub.filter = filter;
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  // ── Event filtering + dispatch ────────────────────────────────────────────

  /** Manually inject an event (used by tests and server-side fan-out) */
  _injectEvent(event: SubscriptionEvent): void {
    this._dispatch(event);
  }

  private _dispatch(event: SubscriptionEvent): void {
    for (const sub of this.subscribers.values()) {
      if (this._matches(event, sub.filter)) sub.handler(event);
    }
  }

  private _matches(event: SubscriptionEvent, filter: EventFilter): boolean {
    if (filter.types?.length && !filter.types.includes(event.type)) return false;
    if (filter.subscriptionIds?.length && !filter.subscriptionIds.includes(event.subscriptionId))
      return false;
    if (filter.userId && filter.userId !== event.userId) return false;
    return true;
  }

  // ── Convenience typed subscriptions ──────────────────────────────────────

  onEvent(type: SubscriptionEventType, handler: EventHandler): () => void {
    return this.subscribe(handler, { types: [type] });
  }
}

export const realtimeService = new RealtimeService({ url: '' });
