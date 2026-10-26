/**
 * Subscription Event Bus — SubTrackr
 *
 * Issue #1283: Implement event bus for subscription changes
 *
 * Wraps the shared `EventBus` with subscription-domain–specific semantics:
 *  - Typed `SubscriptionLifecycleEvent` union that maps to the existing
 *    `SubscriptionEvent` domain events defined in `services/shared/events.ts`
 *  - Persistence via the existing `SubscriptionEventStore` so every lifecycle
 *    event is appended to the append-only store before handlers run
 *  - Replay: re-publish persisted events to a set of handlers for catch-up,
 *    bootstrapping, and audit log replay
 *  - Per-event-type statistics exposed for monitoring
 *  - Dead-letter queue for handler failures so no event is silently dropped
 */

import { randomUUID } from 'crypto';

import {
  EventBus,
  buildEvent,
  type IEventBus,
  type EventHandler,
  type EventSubscription,
  type AnyDomainEvent,
  type SubscriptionCreatedPayload,
  type SubscriptionCancelledPayload,
  type SubscriptionRenewedPayload,
  type SubscriptionUpgradedPayload,
  type SubscriptionPausedPayload,
  type SubscriptionResumedPayload,
  type SubscriptionPaymentFailedPayload,
} from '../shared/events';

import {
  SubscriptionEventStore,
  subscriptionEventStore as defaultEventStore,
  type SubscriptionEvent,
  type SubscriptionEventType,
} from './subscriptionEventStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Typed union of all subscription lifecycle event names. */
export type SubscriptionLifecycleEventName =
  | 'subscription.created'
  | 'subscription.cancelled'
  | 'subscription.renewed'
  | 'subscription.upgraded'
  | 'subscription.paused'
  | 'subscription.resumed'
  | 'subscription.payment_failed';

/** Maps a lifecycle event name to its DomainEvent payload type. */
export type SubscriptionLifecyclePayloadMap = {
  'subscription.created': SubscriptionCreatedPayload;
  'subscription.cancelled': SubscriptionCancelledPayload;
  'subscription.renewed': SubscriptionRenewedPayload;
  'subscription.upgraded': SubscriptionUpgradedPayload;
  'subscription.paused': SubscriptionPausedPayload;
  'subscription.resumed': SubscriptionResumedPayload;
  'subscription.payment_failed': SubscriptionPaymentFailedPayload;
};

export type SubscriptionLifecycleEvent<
  TName extends SubscriptionLifecycleEventName = SubscriptionLifecycleEventName,
> = AnyDomainEvent & {
  name: TName;
  payload: SubscriptionLifecyclePayloadMap[TName];
};

/** Handler for a specific subscription lifecycle event. */
export type SubscriptionEventHandler<
  TName extends SubscriptionLifecycleEventName = SubscriptionLifecycleEventName,
> = EventHandler<SubscriptionLifecycleEvent<TName>>;

/** Options controlling how events are persisted. */
export interface PersistOptions {
  /**
   * Skip persistence for this publish call (e.g. synthetic replay events
   * that should not be stored a second time).
   */
  skipPersist?: boolean;
  /** Override the `occurredAt` timestamp (epoch ms). Defaults to `Date.now()`. */
  occurredAt?: number;
  /** Correlation ID propagated to the domain event. */
  correlationId?: string;
}

export interface DeadLetterEntry {
  event: AnyDomainEvent;
  handlerSubscriptionId: string;
  error: string;
  failedAt: number;
}

export interface SubscriptionEventBusMetrics {
  published: number;
  persisted: number;
  replayed: number;
  deadLetterCount: number;
  handlerErrors: number;
  countByType: Record<SubscriptionLifecycleEventName, number>;
}

// ---------------------------------------------------------------------------
// SubscriptionEventBus
// ---------------------------------------------------------------------------

const LIFECYCLE_EVENTS: SubscriptionLifecycleEventName[] = [
  'subscription.created',
  'subscription.cancelled',
  'subscription.renewed',
  'subscription.upgraded',
  'subscription.paused',
  'subscription.resumed',
  'subscription.payment_failed',
];

/**
 * Map from domain event name to the `SubscriptionEventStore` type constant.
 * The store uses a slightly different naming convention (dots vs. underscores).
 */
const EVENT_TYPE_MAP: Record<SubscriptionLifecycleEventName, SubscriptionEventType> = {
  'subscription.created': 'subscription.created',
  'subscription.cancelled': 'subscription.cancelled',
  'subscription.renewed': 'subscription.renewed',
  'subscription.upgraded': 'subscription.upgraded',
  'subscription.paused': 'subscription.paused',
  'subscription.resumed': 'subscription.resumed',
  'subscription.payment_failed': 'subscription.payment_failed',
};

export class SubscriptionEventBus {
  private readonly bus: IEventBus;
  private readonly store: SubscriptionEventStore;
  private readonly deadLetter: DeadLetterEntry[] = [];

  private published = 0;
  private persisted = 0;
  private replayed = 0;
  private handlerErrors = 0;
  private readonly countByType = Object.fromEntries(
    LIFECYCLE_EVENTS.map((n) => [n, 0]),
  ) as Record<SubscriptionLifecycleEventName, number>;

  constructor(bus?: IEventBus, store?: SubscriptionEventStore) {
    this.bus = bus ?? new EventBus();
    this.store = store ?? defaultEventStore;
  }

  // ── Publish ──────────────────────────────────────────────────────────────

  /**
   * Publish a typed subscription lifecycle event.
   *
   * Steps:
   *  1. Build a `DomainEvent` using `buildEvent()`.
   *  2. Append to the `SubscriptionEventStore` (unless `skipPersist`).
   *  3. Publish to the `EventBus` so all handlers run.
   */
  async publish<TName extends SubscriptionLifecycleEventName>(
    name: TName,
    payload: SubscriptionLifecyclePayloadMap[TName],
    opts: PersistOptions & { aggregateId?: string } = {},
  ): Promise<void> {
    const [domain, type] = name.split('.') as ['subscription', string];

    const event = buildEvent(domain, type, payload, {
      aggregateId: opts.aggregateId ?? (payload as { subscriptionId?: string }).subscriptionId,
      correlationId: opts.correlationId,
      occurredAt: opts.occurredAt,
    }) as SubscriptionLifecycleEvent<TName>;

    // Persist before broadcasting — guarantee durability before side-effects
    if (!opts.skipPersist) {
      this.store.append({
        subscriptionId: (payload as { subscriptionId: string }).subscriptionId,
        type: EVENT_TYPE_MAP[name],
        payload: payload as Record<string, unknown>,
        occurredAt: event.occurredAt,
        schemaVersion: 1,
      });
      this.persisted++;
    }

    this.published++;
    this.countByType[name] = (this.countByType[name] ?? 0) + 1;

    await this.safePublish(event);
  }

  // ── Subscribe ────────────────────────────────────────────────────────────

  /** Subscribe to a specific subscription lifecycle event. */
  on<TName extends SubscriptionLifecycleEventName>(
    name: TName,
    handler: SubscriptionEventHandler<TName>,
  ): EventSubscription {
    return this.bus.subscribe(name, this.wrapHandler(handler) as EventHandler<AnyDomainEvent>);
  }

  /** Subscribe to all subscription lifecycle events. */
  onAny(handler: SubscriptionEventHandler): EventSubscription {
    return this.bus.subscribe('*', this.wrapHandler(handler) as EventHandler<AnyDomainEvent>);
  }

  // ── Replay ───────────────────────────────────────────────────────────────

  /**
   * Replay persisted events for a subscription to a set of handlers.
   *
   * Events are replayed in sequence order. Handlers receive the original
   * `SubscriptionEvent` record (not a new domain event), so callers can
   * distinguish replay events from live ones when needed.
   *
   * @param subscriptionId - Subscription to replay.
   * @param handler        - Called for each stored event in sequence order.
   */
  async replay(
    subscriptionId: string,
    handler: (event: SubscriptionEvent) => void | Promise<void>,
  ): Promise<void> {
    const { events } = this.store.query({
      subscriptionId,
      limit: Number.MAX_SAFE_INTEGER,
      includeArchived: true,
    });

    const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
    for (const event of sorted) {
      await handler(event);
      this.replayed++;
    }
  }

  /**
   * Re-publish stored events for a subscription back through the EventBus so
   * live handlers re-process them.
   *
   * Publishes with `skipPersist: true` to avoid double-appending.
   */
  async replayToBus(subscriptionId: string): Promise<number> {
    let count = 0;
    const { events } = this.store.query({
      subscriptionId,
      limit: Number.MAX_SAFE_INTEGER,
      includeArchived: false,
    });

    const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
    for (const event of sorted) {
      const name = event.type as SubscriptionLifecycleEventName;
      if (LIFECYCLE_EVENTS.includes(name)) {
        await this.publish(
          name,
          event.payload as SubscriptionLifecyclePayloadMap[typeof name],
          { skipPersist: true, occurredAt: event.occurredAt },
        );
        count++;
      }
    }
    return count;
  }

  // ── Dead-letter ───────────────────────────────────────────────────────────

  /** Retrieve dead-letter entries (events whose handlers threw). */
  getDeadLetterEntries(): DeadLetterEntry[] {
    return [...this.deadLetter];
  }

  /** Flush the dead-letter queue. */
  clearDeadLetter(): void {
    this.deadLetter.length = 0;
  }

  // ── Metrics ───────────────────────────────────────────────────────────────

  getMetrics(): SubscriptionEventBusMetrics {
    return {
      published: this.published,
      persisted: this.persisted,
      replayed: this.replayed,
      deadLetterCount: this.deadLetter.length,
      handlerErrors: this.handlerErrors,
      countByType: { ...this.countByType },
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Wrap a handler so that any error it throws is captured into the
   * dead-letter queue instead of being silently swallowed by the EventBus.
   *
   * The EventBus catches handler errors internally (to prevent one bad handler
   * from blocking others), so we must intercept at the point of registration.
   */
  private wrapHandler<T extends AnyDomainEvent>(
    handler: EventHandler<T>,
  ): EventHandler<T> {
    const dlq = this.deadLetter;
    const bus = this;
    return async (event: T) => {
      try {
        await handler(event);
      } catch (err) {
        bus.handlerErrors++;
        dlq.push({
          event,
          handlerSubscriptionId: randomUUID(),
          error: err instanceof Error ? err.message : String(err),
          failedAt: Date.now(),
        });
      }
    };
  }

  /** Publish to the bus. Errors here (e.g. validation) still surface to the caller. */
  private async safePublish(event: AnyDomainEvent): Promise<void> {
    await this.bus.publish(event);
  }
}

// ---------------------------------------------------------------------------
// Default singleton
// ---------------------------------------------------------------------------

export const subscriptionEventBus = new SubscriptionEventBus();
