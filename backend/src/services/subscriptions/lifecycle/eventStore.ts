/**
 * Lifecycle Event Store — append-only log of subscription lifecycle events.
 *
 * Wraps the existing `SubscriptionEventStore` from the monolithic
 * `backend/services/subscription/subscriptionEventStore.ts` and types it
 * with the lifecycle module's own `LifecycleEventType` vocabulary.
 *
 * The store is intentionally thin: it delegates all storage to the existing
 * implementation so there is no data migration and both paths remain
 * compatible during the transition period.
 *
 * Production callers that need cursor-based streaming should use
 * `store.queryStream()` from the underlying `SubscriptionEventStore`.
 */

import {
  SubscriptionEventStore,
  subscriptionEventStore as _sharedStore,
} from '../../../../services/subscription/subscriptionEventStore';
import { createPiiSafeLogger } from '../../../utils/logger';
import type { LifecycleEvent, LifecycleEventType } from './types';

const logger = createPiiSafeLogger('subscriptions.lifecycle.eventStore');

export interface LifecycleEventQuery {
  subscriptionId?: string;
  type?: LifecycleEventType;
  from?: number;
  to?: number;
  limit?: number;
  cursor?: number;
  includeArchived?: boolean;
}

export interface LifecycleEventPage {
  events: LifecycleEvent[];
  nextCursor?: number;
}

export class LifecycleEventStore {
  constructor(private readonly inner: SubscriptionEventStore = _sharedStore) {}

  /**
   * Append a lifecycle event to the store.
   */
  append<TPayload extends Record<string, unknown> = Record<string, unknown>>(
    subscriptionId: string,
    type: LifecycleEventType,
    payload: TPayload,
    occurredAt?: number,
  ): LifecycleEvent<TPayload> {
    const record = this.inner.append({
      subscriptionId,
      type: type as Parameters<typeof this.inner.append>[0]['type'],
      payload,
      occurredAt,
    });

    logger.info('lifecycle.event.appended', {
      subscriptionId,
      type,
      sequence: record.sequence,
    });

    return record as unknown as LifecycleEvent<TPayload>;
  }

  /**
   * Query events with optional filters and cursor-based pagination.
   */
  query(query: LifecycleEventQuery = {}): LifecycleEventPage {
    const result = this.inner.query({
      subscriptionId: query.subscriptionId,
      type: query.type as Parameters<typeof this.inner.query>[0]['type'],
      from: query.from,
      to: query.to,
      limit: query.limit,
      cursor: query.cursor,
      includeArchived: query.includeArchived,
    });
    return {
      events: result.events as unknown as LifecycleEvent[],
      nextCursor: result.nextCursor,
    };
  }

  /**
   * Rebuild current state for a subscription by replaying all its events.
   */
  reconstruct(subscriptionId: string): Record<string, unknown> {
    return this.inner.reconstruct(subscriptionId);
  }

  /**
   * Archive events older than the given timestamp.
   */
  archiveBefore(timestamp: number): number {
    return this.inner.archiveBefore(timestamp);
  }
}

export const lifecycleEventStore = new LifecycleEventStore();
