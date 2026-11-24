/**
 * backend/src/events/bus.ts
 *
 * Typed in-process domain event bus for lifecycle changes between services
 * (issue #2258).
 *
 * Backend services publish lifecycle events (subscription created/cancelled,
 * invoice paid, household invite accepted, payment failed, ...); background
 * workers subscribe to the exact same typed contracts and handle them. The bus
 * is deliberately small and dependency-free so it can be used in unit tests,
 * in the API process and in workers without adapters or transport concerns.
 *
 * Design rules:
 *  - Zero dependencies, no I/O, no ambient state. All state lives in the
 *    controller returned by {@link createEventBus}.
 *  - The clock is injectable, so dispatch timing is deterministic in tests.
 *  - Every rejection is a typed `EventBusError` carrying a stable `code`.
 *  - Handlers are isolated: a throwing or rejecting handler is recorded and
 *    reported, but never prevents the remaining handlers from running.
 *  - Subscriber snapshots are taken at publish time, so subscribing or
 *    unsubscribing from inside a handler cannot mutate an in-flight dispatch.
 *  - Metrics and logger hooks are optional; no-op defaults are provided.
 *
 * Usage:
 *   const bus = createEventBus({}, metrics, logger);
 *   const sub = bus.subscribe('invoice.paid', async (event) => reconcile(event));
 *   await bus.publish({ id: 'evt-1', type: 'invoice.paid',
 *     occurredAt: new Date().toISOString(), aggregateId: 'inv-9',
 *     payload: { invoiceId: 'inv-9', subscriptionId: 'sub-1',
 *       userId: 'u-1', amountCents: 1299, currency: 'USD' } });
 *   sub.unsubscribe();
 */

// ---------------------------------------------------------------------------
// Error surface
// ---------------------------------------------------------------------------

/** Stable machine-readable codes emitted by this module. */
export const EventBusErrorCode = {
  INVALID_CONFIG: 'INVALID_CONFIG',
  INVALID_EVENT: 'INVALID_EVENT',
  UNKNOWN_EVENT_TYPE: 'UNKNOWN_EVENT_TYPE',
  INVALID_HANDLER: 'INVALID_HANDLER',
  DUPLICATE_HANDLER: 'DUPLICATE_HANDLER',
  MAX_HANDLERS_EXCEEDED: 'MAX_HANDLERS_EXCEEDED',
} as const;

/** Union of every stable error code emitted by this module. */
export type EventBusErrorCode = (typeof EventBusErrorCode)[keyof typeof EventBusErrorCode];

/** Typed error thrown for invalid config, events, handlers and subscriptions. */
export class EventBusError extends Error {
  readonly code: EventBusErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: EventBusErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {}
  ) {
    super(message);
    this.name = 'EventBusError';
    this.code = code;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// Event vocabulary
// ---------------------------------------------------------------------------

/** Lifecycle event types understood by the bus. */
export const DomainEventType = {
  SUBSCRIPTION_CREATED: 'subscription.created',
  SUBSCRIPTION_CANCELLED: 'subscription.cancelled',
  INVOICE_PAID: 'invoice.paid',
  HOUSEHOLD_INVITE_ACCEPTED: 'household.invite.accepted',
  PAYMENT_FAILED: 'payment.failed',
} as const;

/** Union of every supported domain event type. */
export type DomainEventType = (typeof DomainEventType)[keyof typeof DomainEventType];

/** Frozen, ordered list of every supported domain event type. */
export const DOMAIN_EVENT_TYPES: readonly DomainEventType[] = Object.freeze([
  DomainEventType.SUBSCRIPTION_CREATED,
  DomainEventType.SUBSCRIPTION_CANCELLED,
  DomainEventType.INVOICE_PAID,
  DomainEventType.HOUSEHOLD_INVITE_ACCEPTED,
  DomainEventType.PAYMENT_FAILED,
]);

/** Payload published when a subscription is created. */
export interface SubscriptionCreatedPayload {
  readonly subscriptionId: string;
  readonly userId: string;
  readonly planId: string;
  readonly email: string;
  readonly householdId?: string;
}

/** Payload published when a subscription is cancelled. */
export interface SubscriptionCancelledPayload {
  readonly subscriptionId: string;
  readonly userId: string;
  readonly reason?: string;
}

/** Payload published when an invoice is paid. */
export interface InvoicePaidPayload {
  readonly invoiceId: string;
  readonly subscriptionId: string;
  readonly userId: string;
  readonly amountCents: number;
  readonly currency: string;
}

/** Payload published when a household invitation is accepted. */
export interface HouseholdInviteAcceptedPayload {
  readonly householdId: string;
  readonly userId: string;
  readonly invitedByUserId: string;
}

/** Payload published when a payment attempt fails. */
export interface PaymentFailedPayload {
  readonly paymentId: string;
  readonly invoiceId: string;
  readonly userId: string;
  readonly reason: string;
}

/** Mapping from event type to its typed payload. Single source of truth. */
export interface DomainEventPayloadMap {
  readonly 'subscription.created': SubscriptionCreatedPayload;
  readonly 'subscription.cancelled': SubscriptionCancelledPayload;
  readonly 'invoice.paid': InvoicePaidPayload;
  readonly 'household.invite.accepted': HouseholdInviteAcceptedPayload;
  readonly 'payment.failed': PaymentFailedPayload;
}

/**
 * Envelope shared by every lifecycle event. `id` is the event id (not the
 * aggregate id), `occurredAt` is an ISO-8601 timestamp and `aggregateId` is
 * the identifier of the entity whose lifecycle changed.
 */
export interface DomainEvent<T extends DomainEventType = DomainEventType> {
  readonly id: string;
  readonly type: T;
  readonly occurredAt: string;
  readonly aggregateId: string;
  readonly payload: DomainEventPayloadMap[T];
}

/** Event aliases for callers that want a fully typed handler parameter. */
export type SubscriptionCreatedEvent = DomainEvent<'subscription.created'>;
export type SubscriptionCancelledEvent = DomainEvent<'subscription.cancelled'>;
export type InvoicePaidEvent = DomainEvent<'invoice.paid'>;
export type HouseholdInviteAcceptedEvent = DomainEvent<'household.invite.accepted'>;
export type PaymentFailedEvent = DomainEvent<'payment.failed'>;

// ---------------------------------------------------------------------------
// Configuration, observability and public results
// ---------------------------------------------------------------------------

/**
 * Fully resolved bus configuration. Callers pass a `Partial` to
 * {@link createEventBus}; defaults are filled by {@link validateEventBusConfig}.
 */
export interface EventBusConfig {
  /** Maximum number of handlers accepted per event type. Default: 32. */
  readonly maxHandlersPerEvent: number;
  /**
   * When true (default), unknown event types are rejected at publish and at
   * subscribe time. When false they are accepted, logged and dispatched to
   * handlers registered for that raw type (forward-compatible consumers).
   */
  readonly strict: boolean;
  /** Injectable clock used to measure dispatch duration. Defaults to `Date.now`. */
  readonly clock: () => number;
}

/** Default configuration, mirroring the documented behaviour. */
export const DEFAULT_EVENT_BUS_CONFIG: EventBusConfig = Object.freeze({
  maxHandlersPerEvent: 32,
  strict: true,
  clock: Date.now,
});

/** Optional metrics sink. Every method is called on the path it describes. */
export interface EventBusMetrics {
  recordPublished(type: string, handlerCount: number, durationMs: number): void;
  recordDelivered(type: string, handlerId: string, durationMs: number): void;
  recordHandlerFailed(type: string, handlerId: string, message: string): void;
  recordNoHandlers(type: string): void;
  recordRejected(operation: string, code: EventBusErrorCode): void;
  recordSubscribed(type: string, handlerId: string): void;
  recordUnsubscribed(type: string, handlerId: string): void;
  recordBatchPublished(count: number): void;
  recordCleared(count: number): void;
}

/** Optional logging hook. No-op defaults keep tests and development quiet. */
export interface EventBusLogger {
  debug(message: string, details: Record<string, unknown>): void;
  info(message: string, details: Record<string, unknown>): void;
  warn(message: string, details: Record<string, unknown>): void;
  error(message: string, details: Record<string, unknown>): void;
}

/** No-op metrics implementation. */
export const noopEventBusMetrics: EventBusMetrics = Object.freeze({
  recordPublished: () => {},
  recordDelivered: () => {},
  recordHandlerFailed: () => {},
  recordNoHandlers: () => {},
  recordRejected: () => {},
  recordSubscribed: () => {},
  recordUnsubscribed: () => {},
  recordBatchPublished: () => {},
  recordCleared: () => {},
});

/** No-op logger implementation. */
export const noopEventBusLogger: EventBusLogger = Object.freeze({
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
});

/** A handler receives its typed event and may be synchronous or asynchronous. */
export type EventHandler<T extends DomainEvent = DomainEvent> = (
  event: T
) => void | Promise<void>;

/** Immutable view of a registered handler. */
export interface EventHandlerRegistration {
  readonly id: string;
  readonly type: string;
  readonly handler: EventHandler;
}

/** Registration plus a convenience method to remove just this handler. */
export interface EventSubscription extends EventHandlerRegistration {
  unsubscribe(): boolean;
}

/** A single isolated handler failure, preserved for observability and tests. */
export interface HandlerFailure {
  readonly handlerId: string;
  readonly error: unknown;
  readonly message: string;
}

/** Deterministic outcome of one {@link EventBus.publish} call. */
export interface PublishResult {
  readonly event: DomainEvent;
  readonly handlerCount: number;
  readonly delivered: number;
  readonly failed: number;
  readonly failures: readonly HandlerFailure[];
  readonly durationMs: number;
}

/** Stateful façade returned by {@link createEventBus}. */
export interface EventBus {
  /** Publish one event, awaiting every handler and isolating failures. */
  publish(event: DomainEvent): Promise<PublishResult>;
  /** Register a handler for an event type; returns its subscription handle. */
  subscribe<T extends DomainEventType>(
    type: T,
    handler: EventHandler<DomainEvent<T>>
  ): EventSubscription;
  /** Remove a handler by subscription id or by handler reference. */
  unsubscribe(type: DomainEventType, handlerOrId: EventHandler | string): boolean;
  /** Read-only snapshot of registrations, optionally filtered by event type. */
  handlers(type?: DomainEventType): readonly EventHandlerRegistration[];
  /** Publish several events in order; returns one result per event. */
  publishBatch(events: readonly DomainEvent[]): Promise<readonly PublishResult[]>;
  /** Remove all handlers (or only those for one type); returns the count removed. */
  clear(type?: DomainEventType): number;
  /** The fully resolved, frozen configuration. */
  readonly config: EventBusConfig;
}

interface MutableRegistration {
  id: string;
  type: string;
  handler: (event: DomainEvent) => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate and resolve a partial configuration into a complete, frozen
 * `EventBusConfig`. Throws `EventBusError(INVALID_CONFIG)` on bad values.
 */
export function validateEventBusConfig(
  config: Partial<EventBusConfig> = {}
): EventBusConfig {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new EventBusError(EventBusErrorCode.INVALID_CONFIG, 'config must be an object', {
      config,
    });
  }

  const maxHandlersPerEvent =
    config.maxHandlersPerEvent ?? DEFAULT_EVENT_BUS_CONFIG.maxHandlersPerEvent;
  if (
    typeof maxHandlersPerEvent !== 'number' ||
    !Number.isInteger(maxHandlersPerEvent) ||
    maxHandlersPerEvent < 1 ||
    maxHandlersPerEvent > 1024
  ) {
    throw new EventBusError(
      EventBusErrorCode.INVALID_CONFIG,
      'maxHandlersPerEvent must be an integer in 1..1024',
      { maxHandlersPerEvent }
    );
  }

  const strict = config.strict ?? DEFAULT_EVENT_BUS_CONFIG.strict;
  if (typeof strict !== 'boolean') {
    throw new EventBusError(EventBusErrorCode.INVALID_CONFIG, 'strict must be a boolean', {
      strict,
    });
  }

  const clock = config.clock ?? DEFAULT_EVENT_BUS_CONFIG.clock;
  if (typeof clock !== 'function') {
    throw new EventBusError(EventBusErrorCode.INVALID_CONFIG, 'clock must be a function', {
      clock,
    });
  }

  return Object.freeze({ maxHandlersPerEvent, strict, clock });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a domain event bus with optional metrics and logger hooks.
 *
 * `publish` validates the envelope, snapshots the handlers registered for its
 * type, then awaits each handler in registration order. A handler that throws
 * (or returns a rejecting promise) contributes a `HandlerFailure` to the
 * result and emits `recordHandlerFailed` plus an error log; the remaining
 * handlers still run. Validation rejections emit `recordRejected` and a warn
 * log before throwing the original `EventBusError`.
 *
 * @param config Partial configuration; see {@link DEFAULT_EVENT_BUS_CONFIG}.
 * @param metrics Optional metrics sink (partial implementations allowed).
 * @param logger Optional logging sink (partial implementations allowed).
 */
export function createEventBus(
  config: Partial<EventBusConfig> = {},
  metrics: Partial<EventBusMetrics> = {},
  logger: Partial<EventBusLogger> = {}
): EventBus {
  const cfg = validateEventBusConfig(config);
  const m: EventBusMetrics = { ...noopEventBusMetrics, ...metrics };
  const l: EventBusLogger = { ...noopEventBusLogger, ...logger };
  const handlersByType = new Map<string, MutableRegistration[]>();
  let handlerCounter = 0;

  /** Reject with a typed error, emitting the standard rejection observability. */
  function fail(
    operation: string,
    code: EventBusErrorCode,
    message: string,
    details: Record<string, unknown>
  ): never {
    m.recordRejected(operation, code);
    l.warn('domain event bus rejected an operation', {
      operation,
      code,
      message,
      ...details,
    });
    throw new EventBusError(code, message, details);
  }

  /** Validate an event envelope and return a frozen, normalised copy. */
  function assertEvent(input: DomainEvent): DomainEvent {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      return fail('publish', EventBusErrorCode.INVALID_EVENT, 'event must be an object', {
        event: input,
      });
    }
    const candidate = input as Partial<DomainEvent>;
    const missing: string[] = [];
    if (typeof candidate.id !== 'string' || candidate.id.trim().length === 0) {
      missing.push('id');
    }
    if (typeof candidate.type !== 'string' || candidate.type.trim().length === 0) {
      missing.push('type');
    }
    if (
      typeof candidate.occurredAt !== 'string' ||
      candidate.occurredAt.trim().length === 0 ||
      Number.isNaN(Date.parse(candidate.occurredAt))
    ) {
      missing.push('occurredAt');
    }
    if (typeof candidate.aggregateId !== 'string' || candidate.aggregateId.trim().length === 0) {
      missing.push('aggregateId');
    }
    if (
      candidate.payload === null ||
      typeof candidate.payload !== 'object' ||
      Array.isArray(candidate.payload)
    ) {
      missing.push('payload');
    }
    if (missing.length > 0) {
      return fail(
        'publish',
        EventBusErrorCode.INVALID_EVENT,
        `domain event has missing or invalid fields: ${missing.join(', ')}`,
        { missing, event: input }
      );
    }

    const type = candidate.type as DomainEventType;
    if (!DOMAIN_EVENT_TYPES.includes(type)) {
      if (cfg.strict) {
        return fail(
          'publish',
          EventBusErrorCode.UNKNOWN_EVENT_TYPE,
          `unknown domain event type '${type}'`,
          { type }
        );
      }
      l.warn('publishing an unknown event type in non-strict mode', {
        type,
        eventId: candidate.id,
      });
    }

    return Object.freeze({
      id: candidate.id,
      type,
      occurredAt: candidate.occurredAt,
      aggregateId: candidate.aggregateId,
      payload: candidate.payload,
    }) as DomainEvent;
  }

  /** Validate and return the registration list for a type, creating it lazily. */
  function listFor(type: DomainEventType): MutableRegistration[] {
    let list = handlersByType.get(type);
    if (!list) {
      list = [];
      handlersByType.set(type, list);
    }
    return list;
  }

  /** Remove a registration by id or handler reference. */
  function remove(type: DomainEventType, handlerOrId: EventHandler | string): boolean {
    const list = handlersByType.get(type);
    if (!list) return false;
    const index = list.findIndex(
      (registration) =>
        registration.id === handlerOrId || registration.handler === handlerOrId
    );
    if (index === -1) return false;
    const removed = list.splice(index, 1)[0]!;
    if (list.length === 0) handlersByType.delete(type);
    m.recordUnsubscribed(type, removed.id);
    l.debug('domain event handler unsubscribed', { type, handlerId: removed.id });
    return true;
  }

  /** Produce an immutable view of a registration. */
  function snapshot(registration: MutableRegistration): EventHandlerRegistration {
    return Object.freeze({
      id: registration.id,
      type: registration.type,
      handler: registration.handler as EventHandler,
    });
  }

  async function publish(input: DomainEvent): Promise<PublishResult> {
    const event = assertEvent(input);
    const start = cfg.clock();
    const registrations = (handlersByType.get(event.type) ?? []).slice();
    const failures: HandlerFailure[] = [];
    let delivered = 0;

    for (const registration of registrations) {
      try {
        await registration.handler(event);
        delivered += 1;
        m.recordDelivered(
          event.type,
          registration.id,
          Math.max(0, cfg.clock() - start)
        );
        l.debug('domain event handler completed', {
          type: event.type,
          handlerId: registration.id,
          eventId: event.id,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(
          Object.freeze({ handlerId: registration.id, error, message })
        );
        m.recordHandlerFailed(event.type, registration.id, message);
        l.error('domain event handler failed', {
          type: event.type,
          handlerId: registration.id,
          eventId: event.id,
          message,
        });
      }
    }

    const durationMs = Math.max(0, cfg.clock() - start);
    const result: PublishResult = Object.freeze({
      event,
      handlerCount: registrations.length,
      delivered,
      failed: failures.length,
      failures: Object.freeze(failures),
      durationMs,
    });

    if (registrations.length === 0) {
      m.recordNoHandlers(event.type);
      l.info('domain event published with no subscribers', {
        type: event.type,
        eventId: event.id,
      });
    } else {
      l.info('domain event published', {
        type: event.type,
        eventId: event.id,
        delivered,
        failed: failures.length,
      });
    }
    m.recordPublished(event.type, registrations.length, durationMs);
    return result;
  }

  function subscribe<T extends DomainEventType>(
    type: T,
    handler: EventHandler<DomainEvent<T>>
  ): EventSubscription {
    if (typeof type !== 'string' || type.trim().length === 0) {
      return fail(
        'subscribe',
        EventBusErrorCode.INVALID_EVENT,
        'event type must be a non-empty string',
        { type }
      );
    }
    if (typeof handler !== 'function') {
      return fail(
        'subscribe',
        EventBusErrorCode.INVALID_HANDLER,
        'handler must be a function',
        { type, handler }
      );
    }
    if (cfg.strict && !DOMAIN_EVENT_TYPES.includes(type)) {
      return fail(
        'subscribe',
        EventBusErrorCode.UNKNOWN_EVENT_TYPE,
        `unknown domain event type '${type}'`,
        { type }
      );
    }

    const list = listFor(type);
    if (list.some((registration) => registration.handler === handler)) {
      return fail(
        'subscribe',
        EventBusErrorCode.DUPLICATE_HANDLER,
        `handler is already registered for '${type}'`,
        { type }
      );
    }
    if (list.length >= cfg.maxHandlersPerEvent) {
      return fail(
        'subscribe',
        EventBusErrorCode.MAX_HANDLERS_EXCEEDED,
        `event type '${type}' already has ${list.length} handlers`,
        { type, limit: cfg.maxHandlersPerEvent }
      );
    }

    const id = `handler-${++handlerCounter}`;
    const registration: MutableRegistration = {
      id,
      type,
      handler: handler as (event: DomainEvent) => void | Promise<void>,
    };
    list.push(registration);
    m.recordSubscribed(type, id);
    l.debug('domain event handler subscribed', { type, handlerId: id });
    return Object.freeze({
      id,
      type,
      handler: registration.handler as EventHandler,
      unsubscribe: (): boolean => remove(type, id),
    });
  }

  function unsubscribe(type: DomainEventType, handlerOrId: EventHandler | string): boolean {
    return remove(type, handlerOrId);
  }

  function handlers(type?: DomainEventType): readonly EventHandlerRegistration[] {
    if (type !== undefined) {
      return Object.freeze((handlersByType.get(type) ?? []).map(snapshot));
    }
    const all: EventHandlerRegistration[] = [];
    for (const list of handlersByType.values()) {
      for (const registration of list) all.push(snapshot(registration));
    }
    return Object.freeze(all);
  }

  function clear(type?: DomainEventType): number {
    let removed = 0;
    if (type !== undefined) {
      removed = handlersByType.get(type)?.length ?? 0;
      handlersByType.delete(type);
    } else {
      for (const list of handlersByType.values()) removed += list.length;
      handlersByType.clear();
    }
    m.recordCleared(removed);
    l.info('domain event handlers cleared', { type: type ?? null, removed });
    return removed;
  }

  async function publishBatch(
    events: readonly DomainEvent[]
  ): Promise<readonly PublishResult[]> {
    if (!Array.isArray(events)) {
      return fail(
        'publishBatch',
        EventBusErrorCode.INVALID_EVENT,
        'events must be an array',
        { events }
      );
    }
    const results: PublishResult[] = [];
    for (const event of events) results.push(await publish(event));
    m.recordBatchPublished(results.length);
    l.info('domain event batch published', { count: results.length });
    return Object.freeze(results);
  }

  return Object.freeze({
    publish,
    subscribe,
    unsubscribe,
    handlers,
    publishBatch,
    clear,
    config: cfg,
  });
}
