// ---------------------------------------------------------------------------
// WebSocket server service
// Runs in a Node/backend context (e.g. a lightweight Express+ws sidecar).
// In the mobile-first architecture this module is the authoritative server
// implementation; the React Native client uses realtimeService.ts.
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
}

// ---------------------------------------------------------------------------
// WebSocketServer
// Pure-logic implementation — decoupled from the transport layer so it can
// be tested without a real WebSocket connection.
// ---------------------------------------------------------------------------

export class WebSocketServer extends EventEmitter {
  /** clientId → ClientInfo */
  private clients: Map<string, ClientInfo> = new Map();
  /** clientId → send callback */
  private senders: Map<string, (event: SubscriptionEvent) => void> = new Map();

  // ── Connection management (presence system) ───────────────────────────────

  connect(
    clientId: string,
    userId: string,
    send: (event: SubscriptionEvent) => void,
    filter: EventFilter = {}
  ): ClientInfo {
    const info: ClientInfo = {
      id: clientId,
      userId,
      connectedAt: Date.now(),
      filter,
    };
    this.clients.set(clientId, info);
    this.senders.set(clientId, send);
    this.emit('presence', { type: 'join', clientId, userId });
    return info;
  }

  disconnect(clientId: string): void {
    const info = this.clients.get(clientId);
    this.clients.delete(clientId);
    this.senders.delete(clientId);
    if (info) this.emit('presence', { type: 'leave', clientId, userId: info.userId });
  }

  /** Returns all currently connected clients (presence list) */
  getPresence(): ClientInfo[] {
    return Array.from(this.clients.values());
  }

  isConnected(clientId: string): boolean {
    return this.clients.has(clientId);
  }

  // ── Event streaming ───────────────────────────────────────────────────────

  /** Broadcast a subscription event to all matching subscribers */
  broadcast(event: SubscriptionEvent): number {
    let delivered = 0;
    for (const [clientId, info] of this.clients) {
      if (this._matchesFilter(event, info.filter)) {
        const send = this.senders.get(clientId);
        if (send) {
          send(event);
          delivered++;
        }
      }
    }
    this.emit('broadcast', { event, delivered });
    return delivered;
  }

  /** Update the event filter for a connected client */
  setFilter(clientId: string, filter: EventFilter): void {
    const info = this.clients.get(clientId);
    if (!info) throw new Error(`Client ${clientId} not connected`);
    info.filter = filter;
  }

  // ── Event filtering ───────────────────────────────────────────────────────

  private _matchesFilter(event: SubscriptionEvent, filter: EventFilter): boolean {
    if (filter.types?.length && !filter.types.includes(event.type)) return false;
    if (filter.subscriptionIds?.length && !filter.subscriptionIds.includes(event.subscriptionId))
      return false;
    if (filter.userId && filter.userId !== event.userId) return false;
    return true;
  }

  get clientCount(): number {
    return this.clients.size;
  }
}

export const webSocketServer = new WebSocketServer();
