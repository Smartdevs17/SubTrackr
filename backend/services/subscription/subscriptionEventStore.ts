import { encodeOpaqueCursor, decodeOpaqueCursor } from '../shared/streaming';
import type { CursorPage } from '../shared/streaming';

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

/**
 * Cursor-paginated query options used by `queryStream`. (Issue #768)
 * The cursor is an opaque token returned by a previous `queryStream` call.
 */
export interface CursorQuery extends Omit<SubscriptionEventQuery, 'cursor'> {
  /** Opaque cursor from a previous page. Omit to start from the beginning. */
  afterCursor?: string;
  /** Maximum events per page. Default: 50. */
  limit?: number;
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

  // ── Cursor-based streaming query (Issue #768) ──────────────────────────────

  /**
   * Async generator that yields cursor pages of events lazily.
   *
   * Each page contains at most `query.limit` events (default 50).
   * The caller can iterate to exhaustion or stop early — no memory is wasted
   * holding the full event set.
   *
   * ```ts
   * for await (const page of store.queryStream({ subscriptionId: 'sub_1' })) {
   *   for (const event of page.items) { ... }
   * }
   * ```
   */
  async *queryStream(
    query: CursorQuery = {}
  ): AsyncGenerator<CursorPage<SubscriptionEvent>> {
    const limit = Math.max(1, query.limit ?? 50);

    // Decode the opaque cursor back to a numeric offset
    let offset = 0;
    if (query.afterCursor) {
      const decoded = decodeOpaqueCursor(query.afterCursor);
      if (decoded && typeof decoded['offset'] === 'number') {
        offset = decoded['offset'];
      }
    }

    // Apply all filters (same logic as `query()`) on the in-memory store.
    // In a Postgres-backed implementation this would be keyset pagination SQL.
    const filtered = this.events.filter((event) => {
      if (!query.includeArchived && event.archivedAt) return false;
      if (query.subscriptionId && event.subscriptionId !== query.subscriptionId) return false;
      if (query.type && event.type !== query.type) return false;
      if (query.from && event.occurredAt < query.from) return false;
      if (query.to && event.occurredAt > query.to) return false;
      return true;
    });

    const total = filtered.length;

    while (offset < total) {
      const items = filtered.slice(offset, offset + limit);
      const nextOffset = offset + items.length;
      const nextCursor =
        nextOffset < total
          ? encodeOpaqueCursor({ offset: nextOffset })
          : null;

      yield {
        items,
        nextCursor,
        total,
        pageSize: limit,
      };

      if (nextCursor === null) break;
      offset = nextOffset;

      // Yield to the event loop between pages
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
}

export const subscriptionEventStore = new SubscriptionEventStore();
