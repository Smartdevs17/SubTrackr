export type SubscriptionEventType =
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.canceled'
  | 'subscription.renewed'
  | 'payment.succeeded'
  | 'payment.failed'
  | 'invoice.upcoming';

export type StreamStatus = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'ERROR';

export interface SubscriptionStreamEvent {
  id: string;
  type: SubscriptionEventType;
  timestamp: number;
  customerId: string;
  subscriptionId: string;
  tenantId?: string;
  data: Record<string, any>;
}

export interface StreamFilter {
  eventTypes?: SubscriptionEventType[];
  subscriptionIds?: string[];
  customerIds?: string[];
}

export interface SubscriptionEventStreamClientConfig {
  apiKey: string;
  endpoint: string;
  autoReconnect?: boolean;
  reconnectIntervalMs?: number;
  maxReconnectAttempts?: number;
}

export class SubscriptionEventStreamClient {
  private config: Required<SubscriptionEventStreamClientConfig>;
  private status: StreamStatus = 'DISCONNECTED';
  private eventListeners: Map<string, Set<(event: SubscriptionStreamEvent) => void>> = new Map();
  private errorListeners: Set<(err: Error) => void> = new Set();
  private statusListeners: Set<(status: StreamStatus) => void> = new Set();
  private activeFilters: Set<string> = new Set();
  private reconnectAttempts: number = 0;
  private isExplicitDisconnect: boolean = false;

  constructor(config: SubscriptionEventStreamClientConfig) {
    this.config = {
      apiKey: config.apiKey,
      endpoint: config.endpoint,
      autoReconnect: config.autoReconnect ?? true,
      reconnectIntervalMs: config.reconnectIntervalMs ?? 1000,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 5,
    };
  }

  public getStatus(): StreamStatus {
    return this.status;
  }

  public isConnected(): boolean {
    return this.status === 'CONNECTED';
  }

  public async connect(): Promise<void> {
    if (this.status === 'CONNECTED' || this.status === 'CONNECTING') {
      return;
    }

    this.isExplicitDisconnect = false;
    this.setStatus('CONNECTING');

    try {
      if (!this.config.endpoint || !this.config.apiKey) {
        throw new Error('API key and stream endpoint are required');
      }

      this.setStatus('CONNECTED');
      this.reconnectAttempts = 0;
    } catch (err: any) {
      this.setStatus('ERROR');
      this.notifyError(err instanceof Error ? err : new Error(String(err)));
      if (this.config.autoReconnect) {
        this.scheduleReconnect();
      }
    }
  }

  public disconnect(): void {
    this.isExplicitDisconnect = true;
    this.setStatus('DISCONNECTED');
  }

  public subscribe(filter: string | StreamFilter): void {
    const filterKey = typeof filter === 'string' ? filter : JSON.stringify(filter);
    this.activeFilters.add(filterKey);
  }

  public unsubscribe(filter: string | StreamFilter): void {
    const filterKey = typeof filter === 'string' ? filter : JSON.stringify(filter);
    this.activeFilters.delete(filterKey);
  }

  public on(
    eventType: SubscriptionEventType | '*',
    listener: (event: SubscriptionStreamEvent) => void
  ): () => void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, new Set());
    }
    this.eventListeners.get(eventType)!.add(listener);

    return () => {
      this.eventListeners.get(eventType)?.delete(listener);
    };
  }

  public onError(listener: (err: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }

  public onStatusChange(listener: (status: StreamStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  public emitMockEvent(event: SubscriptionStreamEvent): void {
    if (this.status !== 'CONNECTED') {
      return;
    }

    const typeListeners = this.eventListeners.get(event.type);
    if (typeListeners) {
      typeListeners.forEach((fn) => fn(event));
    }

    const wildcardListeners = this.eventListeners.get('*');
    if (wildcardListeners) {
      wildcardListeners.forEach((fn) => fn(event));
    }
  }

  private setStatus(newStatus: StreamStatus): void {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this.statusListeners.forEach((fn) => fn(newStatus));
    }
  }

  private notifyError(err: Error): void {
    this.errorListeners.forEach((fn) => fn(err));
  }

  private scheduleReconnect(): void {
    if (this.isExplicitDisconnect || this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      return;
    }

    this.reconnectAttempts++;
    this.setStatus('RECONNECTING');

    setTimeout(
      () => {
        if (!this.isExplicitDisconnect) {
          this.connect().catch(() => {});
        }
      },
      this.config.reconnectIntervalMs * Math.pow(1.5, this.reconnectAttempts - 1)
    );
  }
}
