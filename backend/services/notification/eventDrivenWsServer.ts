import { EventEmitter } from 'events';
import { SubscriptionEvent, EventFilter, ClientInfo } from './websocket';
import { AuthUser } from '../shared/authStrategies';

export interface StoredEvent extends SubscriptionEvent {
  sequenceId: number;
}

export interface RedisPubSubAdapter {
  publish(channel: string, message: string): Promise<void>;
  subscribe(channel: string, handler: (channel: string, message: string) => void): Promise<void>;
}

export class MockRedisPubSubAdapter implements RedisPubSubAdapter {
  private handlers: Map<string, ((channel: string, message: string) => void)[]> = new Map();

  async publish(channel: string, message: string): Promise<void> {
    const list = this.handlers.get(channel) || [];
    for (const handler of list) {
      handler(channel, message);
    }
  }

  async subscribe(channel: string, handler: (channel: string, message: string) => void): Promise<void> {
    const list = this.handlers.get(channel) || [];
    list.push(handler);
    this.handlers.set(channel, list);
  }
}

export interface WsConnection {
  clientId: string;
  user: AuthUser;
  lastPing: number;
  isAlive: boolean;
  filter: EventFilter;
  send(event: StoredEvent): void;
  close(code?: number, reason?: string): void;
}

export class EventDrivenWsServer extends EventEmitter {
  private connections: Map<string, WsConnection> = new Map();
  private eventStore: StoredEvent[] = [];
  private sequenceCounter = 0;
  private heartbeatInterval?: NodeJS.Timeout;
  private pubSub: RedisPubSubAdapter;

  constructor(pubSubAdapter?: RedisPubSubAdapter) {
    super();
    this.pubSub = pubSubAdapter || new MockRedisPubSubAdapter();
    this.setupPubSub();
  }

  private async setupPubSub() {
    await this.pubSub.subscribe('subtrackr_ws_events', (_channel, message) => {
      try {
        const event: StoredEvent = JSON.parse(message);
        this.dispatchToLocalConnections(event);
      } catch (e) {
        // Parse error ignore
      }
    });
  }

  startHeartbeat(intervalMs = 30000) {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      for (const [clientId, conn] of this.connections) {
        if (!conn.isAlive) {
          conn.close(4001, 'Heartbeat timeout');
          this.connections.delete(clientId);
          this.emit('presence', { type: 'leave', clientId, userId: conn.user.id });
        } else {
          conn.isAlive = false;
        }
      }
    }, intervalMs);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
  }

  handlePong(clientId: string) {
    const conn = this.connections.get(clientId);
    if (conn) {
      conn.isAlive = true;
      conn.lastPing = Date.now();
    }
  }

  registerConnection(conn: WsConnection): void {
    this.connections.set(conn.clientId, conn);
    this.emit('presence', { type: 'join', clientId: conn.clientId, userId: conn.user.id });
  }

  removeConnection(clientId: string): void {
    const conn = this.connections.get(clientId);
    if (conn) {
      this.connections.delete(clientId);
      this.emit('presence', { type: 'leave', clientId, userId: conn.user.id });
    }
  }

  async publishEvent(rawEvent: SubscriptionEvent): Promise<StoredEvent> {
    this.sequenceCounter++;
    const storedEvent: StoredEvent = {
      ...rawEvent,
      sequenceId: this.sequenceCounter,
    };
    this.eventStore.push(storedEvent);
    if (this.eventStore.length > 10000) {
      this.eventStore.shift(); // Keep buffer bounded
    }

    await this.pubSub.publish('subtrackr_ws_events', JSON.stringify(storedEvent));
    return storedEvent;
  }

  private dispatchToLocalConnections(event: StoredEvent) {
    let delivered = 0;
    for (const [_, conn] of this.connections) {
      if (this.matchesFilter(event, conn.filter, conn.user.id)) {
        conn.send(event);
        delivered++;
      }
    }
    this.emit('delivered', { sequenceId: event.sequenceId, delivered });
  }

  replayEventsSince(clientId: string, lastSequenceId: number): StoredEvent[] {
    const conn = this.connections.get(clientId);
    if (!conn) return [];

    const missedEvents = this.eventStore.filter(
      (e) => e.sequenceId > lastSequenceId && this.matchesFilter(e, conn.filter, conn.user.id)
    );

    for (const event of missedEvents) {
      conn.send(event);
    }

    return missedEvents;
  }

  private matchesFilter(event: SubscriptionEvent, filter: EventFilter, userId: string): boolean {
    if (filter.userId && filter.userId !== userId) return false;
    if (filter.types?.length && !filter.types.includes(event.type)) return false;
    if (filter.subscriptionIds?.length && !filter.subscriptionIds.includes(event.subscriptionId))
      return false;
    return true;
  }

  get activeConnectionsCount(): number {
    return this.connections.size;
  }
}
