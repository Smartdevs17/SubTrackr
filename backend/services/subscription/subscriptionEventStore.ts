export type SubscriptionEventType =
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.renewed'
  | 'subscription.cancelled'
  | 'subscription.payment_failed'
  | 'subscription.upgraded'
  | 'subscription.paused'
  | 'subscription.resumed';

export interface SubscriptionEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  subscriptionId: string;
  sequence: number;
  type: SubscriptionEventType;
  payload: TPayload;
  occurredAt: number;
  schemaVersion: number;
  archivedAt?: number;
}

export interface SubscriptionEventQuery {
  subscriptionId?: string;
  type?: SubscriptionEventType;
  from?: number;
  to?: number;
  limit?: number;
  cursor?: number;
  includeArchived?: boolean;
}

export interface SubscriptionEventPage {
  events: SubscriptionEvent[];
  nextCursor?: number;
}

export class SubscriptionEventStore {
  private readonly events: SubscriptionEvent[] = [];
  private readonly sequenceBySubscription = new Map<string, number>();

  append<TPayload extends Record<string, unknown> = Record<string, unknown>>(
    event: Omit<SubscriptionEvent<TPayload>, 'id' | 'sequence' | 'occurredAt' | 'schemaVersion'> &
      Partial<Pick<SubscriptionEvent, 'occurredAt' | 'schemaVersion'>>
  ): SubscriptionEvent<TPayload> {
    const nextSequence = (this.sequenceBySubscription.get(event.subscriptionId) ?? 0) + 1;
    this.sequenceBySubscription.set(event.subscriptionId, nextSequence);

    const record: SubscriptionEvent<TPayload> = {
      ...event,
      id: `sev_${Date.now().toString(36)}_${nextSequence}`,
      sequence: nextSequence,
      occurredAt: event.occurredAt ?? Date.now(),
      schemaVersion: event.schemaVersion ?? 1,
    };
    this.events.push(record);
    return record;
  }

  query(query: SubscriptionEventQuery = {}): SubscriptionEventPage {
    const cursor = query.cursor ?? 0;
    const limit = Math.max(1, query.limit ?? 50);
    const filtered = this.events.filter((event) => {
      if (!query.includeArchived && event.archivedAt) return false;
      if (query.subscriptionId && event.subscriptionId !== query.subscriptionId) return false;
      if (query.type && event.type !== query.type) return false;
      if (query.from && event.occurredAt < query.from) return false;
      if (query.to && event.occurredAt > query.to) return false;
      return true;
    });
    const events = filtered.slice(cursor, cursor + limit);
    const nextCursor = cursor + limit < filtered.length ? cursor + limit : undefined;
    return { events, nextCursor };
  }

  reconstruct(subscriptionId: string): Record<string, unknown> {
    return this.query({ subscriptionId, includeArchived: true, limit: Number.MAX_SAFE_INTEGER })
      .events.sort((a, b) => a.sequence - b.sequence)
      .reduce<Record<string, unknown>>(
        (state, event) => ({
          ...state,
          ...(event.payload as Record<string, unknown>),
          id: subscriptionId,
          lastEventType: event.type,
          updatedAt: event.occurredAt,
        }),
        { id: subscriptionId }
      );
  }

  replay(subscriptionId: string, handler: (event: SubscriptionEvent) => void): void {
    this.query({ subscriptionId, includeArchived: true, limit: Number.MAX_SAFE_INTEGER })
      .events.sort((a, b) => a.sequence - b.sequence)
      .forEach(handler);
  }

  archiveBefore(timestamp: number): number {
    let archived = 0;
    for (const event of this.events) {
      if (!event.archivedAt && event.occurredAt < timestamp) {
        event.archivedAt = Date.now();
        archived += 1;
      }
    }
    return archived;
  }
}

export const subscriptionEventStore = new SubscriptionEventStore();
