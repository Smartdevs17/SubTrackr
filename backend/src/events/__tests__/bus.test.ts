/**
 * backend/src/events/__tests__/bus.test.ts
 *
 * Unit tests for the typed domain event bus (issue #2258). Every documented
 * behaviour — defaults, validation, dispatch, async handlers, failure
 * isolation, unsubscribe, batches, malformed/unknown events and observability —
 * is pinned here.
 */

import {
  createEventBus,
  validateEventBusConfig,
  EventBusError,
  EventBusErrorCode,
  DomainEventType,
  DOMAIN_EVENT_TYPES,
  DEFAULT_EVENT_BUS_CONFIG,
  noopEventBusMetrics,
  noopEventBusLogger,
  type DomainEvent,
  type EventBusMetrics,
  type EventBusLogger,
} from '../bus';

/** Build a valid invoice.paid event, with optional field overrides. */
function makeEvent(
  type: DomainEventType = DomainEventType.INVOICE_PAID,
  overrides: Partial<DomainEvent> = {}
): DomainEvent {
  const base: DomainEvent = {
    id: 'evt-1',
    type,
    occurredAt: '2026-01-01T00:00:00.000Z',
    aggregateId: 'inv-1',
    payload: {
      invoiceId: 'inv-1',
      subscriptionId: 'sub-1',
      userId: 'user-1',
      amountCents: 1299,
      currency: 'USD',
    },
  };
  return { ...base, ...overrides };
}

/** Build a spy metrics object that records every hook invocation. */
function makeMetrics(): EventBusMetrics & {
  calls: Array<{ method: string; args: unknown[] }>;
} {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const method = (name: string) => (...args: unknown[]) => {
    calls.push({ method: name, args });
  };
  return {
    calls,
    recordPublished: method('recordPublished'),
    recordDelivered: method('recordDelivered'),
    recordHandlerFailed: method('recordHandlerFailed'),
    recordNoHandlers: method('recordNoHandlers'),
    recordRejected: method('recordRejected'),
    recordSubscribed: method('recordSubscribed'),
    recordUnsubscribed: method('recordUnsubscribed'),
    recordBatchPublished: method('recordBatchPublished'),
    recordCleared: method('recordCleared'),
  };
}

/** Build a spy logger that records every level invocation. */
function makeLogger(): EventBusLogger & {
  calls: Array<{ level: string; message: string }>;
} {
  const calls: Array<{ level: string; message: string }> = [];
  const level = (name: string) => (message: string) => {
    calls.push({ level: name, message });
  };
  return {
    calls,
    debug: level('debug'),
    info: level('info'),
    warn: level('warn'),
    error: level('error'),
  };
}

/** Assert that an async function rejects with an EventBusError of a given code. */
async function expectCode(fn: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await fn();
    throw new Error('expected function to reject');
  } catch (error) {
    expect(error instanceof EventBusError).toBe(true);
    expect((error as EventBusError).code).toBe(code);
  }
}

describe('error surface and constants', () => {
  it('exposes stable error codes', () => {
    expect(EventBusErrorCode.INVALID_CONFIG).toBe('INVALID_CONFIG');
    expect(EventBusErrorCode.INVALID_EVENT).toBe('INVALID_EVENT');
    expect(EventBusErrorCode.UNKNOWN_EVENT_TYPE).toBe('UNKNOWN_EVENT_TYPE');
    expect(EventBusErrorCode.INVALID_HANDLER).toBe('INVALID_HANDLER');
    expect(EventBusErrorCode.DUPLICATE_HANDLER).toBe('DUPLICATE_HANDLER');
    expect(EventBusErrorCode.MAX_HANDLERS_EXCEEDED).toBe('MAX_HANDLERS_EXCEEDED');
  });

  it('exposes all lifecycle event types', () => {
    expect(DomainEventType.SUBSCRIPTION_CREATED).toBe('subscription.created');
    expect(DomainEventType.SUBSCRIPTION_CANCELLED).toBe('subscription.cancelled');
    expect(DomainEventType.INVOICE_PAID).toBe('invoice.paid');
    expect(DomainEventType.HOUSEHOLD_INVITE_ACCEPTED).toBe('household.invite.accepted');
    expect(DomainEventType.PAYMENT_FAILED).toBe('payment.failed');
    expect(DOMAIN_EVENT_TYPES).toHaveLength(5);
  });

  it('builds a typed EventBusError with code and details', () => {
    const error = new EventBusError(EventBusErrorCode.INVALID_EVENT, 'bad event', {
      field: 'id',
    });
    expect(error instanceof Error).toBe(true);
    expect(error.name).toBe('EventBusError');
    expect(error.code).toBe('INVALID_EVENT');
    expect(error.message).toBe('bad event');
    expect(error.details).toEqual({ field: 'id' });
  });

  it('provides no-op observability defaults', () => {
    expect(typeof noopEventBusMetrics.recordPublished).toBe('function');
    expect(typeof noopEventBusMetrics.recordHandlerFailed).toBe('function');
    expect(typeof noopEventBusLogger.warn).toBe('function');
    expect(typeof noopEventBusLogger.error).toBe('function');
  });
});

describe('validateEventBusConfig', () => {
  it('fills in documented defaults', () => {
    const config = validateEventBusConfig({});
    expect(config.maxHandlersPerEvent).toBe(32);
    expect(config.strict).toBe(true);
    expect(typeof config.clock).toBe('function');
    expect(DEFAULT_EVENT_BUS_CONFIG.maxHandlersPerEvent).toBe(32);
  });

  it('preserves valid overrides including a custom clock', () => {
    const clock = () => 99;
    const config = validateEventBusConfig({
      maxHandlersPerEvent: 3,
      strict: false,
      clock,
    });
    expect(config.maxHandlersPerEvent).toBe(3);
    expect(config.strict).toBe(false);
    expect(config.clock()).toBe(99);
  });

  it('rejects invalid limits, strict flags, clocks and configs', () => {
    expect(() => validateEventBusConfig({ maxHandlersPerEvent: 0 })).toThrow(EventBusError);
    expect(() => validateEventBusConfig({ maxHandlersPerEvent: 1.5 })).toThrow(EventBusError);
    expect(() => validateEventBusConfig({ strict: 'yes' as never })).toThrow(EventBusError);
    expect(() => validateEventBusConfig({ clock: 12 as never })).toThrow(EventBusError);
    expect(() => validateEventBusConfig(null as never)).toThrow(EventBusError);
  });
});

describe('publish', () => {
  it('dispatches to every handler in registration order', async () => {
    const bus = createEventBus();
    const seen: string[] = [];
    bus.subscribe(DomainEventType.INVOICE_PAID, () => {
      seen.push('first');
    });
    bus.subscribe(DomainEventType.INVOICE_PAID, () => {
      seen.push('second');
    });
    const result = await bus.publish(makeEvent());
    expect(result.delivered).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.handlerCount).toBe(2);
    expect(seen).toEqual(['first', 'second']);
    expect(result.event.id).toBe('evt-1');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('only dispatches to handlers for the matching event type', async () => {
    const bus = createEventBus();
    const seen: string[] = [];
    bus.subscribe(DomainEventType.SUBSCRIPTION_CREATED, () => seen.push('created'));
    bus.subscribe(DomainEventType.INVOICE_PAID, () => seen.push('paid'));
    await bus.publish(makeEvent());
    expect(seen).toEqual(['paid']);
  });

  it('awaits asynchronous handlers before resolving', async () => {
    const bus = createEventBus();
    let finished = false;
    bus.subscribe(DomainEventType.INVOICE_PAID, async () => {
      await Promise.resolve();
      await Promise.resolve();
      finished = true;
    });
    const result = await bus.publish(makeEvent());
    expect(finished).toBe(true);
    expect(result.delivered).toBe(1);
    expect(typeof result.durationMs).toBe('number');
  });

  it('isolates a throwing handler from the remaining handlers', async () => {
    const bus = createEventBus();
    const seen: string[] = [];
    bus.subscribe(DomainEventType.PAYMENT_FAILED, () => {
      throw new Error('boom');
    });
    bus.subscribe(DomainEventType.PAYMENT_FAILED, () => {
      seen.push('survivor');
    });
    const result = await bus.publish(makeEvent(DomainEventType.PAYMENT_FAILED));
    expect(result.delivered).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.handlerCount).toBe(2);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.message).toBe('boom');
    expect(seen).toEqual(['survivor']);
  });

  it('isolates a rejecting async handler', async () => {
    const bus = createEventBus();
    const seen: string[] = [];
    bus.subscribe(DomainEventType.PAYMENT_FAILED, async () => {
      await Promise.resolve();
      throw new Error('async boom');
    });
    bus.subscribe(DomainEventType.PAYMENT_FAILED, () => seen.push('survivor'));
    const result = await bus.publish(makeEvent(DomainEventType.PAYMENT_FAILED));
    expect(result.failures[0]?.message).toBe('async boom');
    expect(seen).toEqual(['survivor']);
  });

  it('handles publishing with no registered handlers', async () => {
    const bus = createEventBus();
    const result = await bus.publish(makeEvent());
    expect(result.handlerCount).toBe(0);
    expect(result.delivered).toBe(0);
    expect(result.failures).toHaveLength(0);
  });

  it('uses the injected clock for the duration metric', async () => {
    let tick = 0;
    const bus = createEventBus({ clock: () => (tick += 5) });
    const result = await bus.publish(makeEvent());
    expect(result.durationMs).toBe(5);
  });

  it('does not let a handler that unsubscribes affect the in-flight snapshot', async () => {
    const bus = createEventBus();
    const seen: string[] = [];
    const second = bus.subscribe(DomainEventType.INVOICE_PAID, () => seen.push('second'));
    bus.subscribe(DomainEventType.INVOICE_PAID, () => {
      seen.push('first');
      second.unsubscribe();
    });
    const result = await bus.publish(makeEvent());
    expect(seen).toEqual(['second', 'first']);
    expect(result.handlerCount).toBe(2);
  });
});

describe('malformed and unknown events', () => {
  it('rejects an event with missing fields', async () => {
    const bus = createEventBus();
    await expectCode(
      () => bus.publish({ id: 'evt-1', type: DomainEventType.INVOICE_PAID } as DomainEvent),
      EventBusErrorCode.INVALID_EVENT
    );
  });

  it('rejects a non-object event, a blank id and an invalid timestamp', async () => {
    const bus = createEventBus();
    await expectCode(() => bus.publish(null as never), EventBusErrorCode.INVALID_EVENT);
    await expectCode(
      () => bus.publish(makeEvent(DomainEventType.INVOICE_PAID, { id: '' })),
      EventBusErrorCode.INVALID_EVENT
    );
    await expectCode(
      () => bus.publish(makeEvent(DomainEventType.INVOICE_PAID, { occurredAt: 'not-a-date' })),
      EventBusErrorCode.INVALID_EVENT
    );
  });

  it('rejects an array payload and a blank aggregate id', async () => {
    const bus = createEventBus();
    await expectCode(
      () => bus.publish(makeEvent(DomainEventType.INVOICE_PAID, { payload: [] as never })),
      EventBusErrorCode.INVALID_EVENT
    );
    await expectCode(
      () => bus.publish(makeEvent(DomainEventType.INVOICE_PAID, { aggregateId: '' })),
      EventBusErrorCode.INVALID_EVENT
    );
  });

  it('rejects an unknown event type in strict mode', async () => {
    const bus = createEventBus();
    await expectCode(
      () => bus.publish(makeEvent('mystery.event' as DomainEventType)),
      EventBusErrorCode.UNKNOWN_EVENT_TYPE
    );
  });

  it('accepts and dispatches an unknown type in non-strict mode', async () => {
    const bus = createEventBus({ strict: false });
    let seen = false;
    bus.subscribe('mystery.event' as DomainEventType, () => {
      seen = true;
    });
    const result = await bus.publish(makeEvent('mystery.event' as DomainEventType));
    expect(result.delivered).toBe(1);
    expect(seen).toBe(true);
  });
});

describe('subscribe, unsubscribe, handlers and clear', () => {
  it('registers handlers and exposes read-only snapshots', () => {
    const bus = createEventBus();
    const handler = () => {};
    const sub = bus.subscribe(DomainEventType.SUBSCRIPTION_CREATED, handler);
    expect(sub.id).toBe('handler-1');
    expect(sub.type).toBe('subscription.created');
    expect(bus.handlers(DomainEventType.SUBSCRIPTION_CREATED)).toHaveLength(1);
    expect(bus.handlers()).toHaveLength(1);
    expect(bus.handlers(DomainEventType.PAYMENT_FAILED)).toHaveLength(0);
  });

  it('rejects duplicate handlers and non-function handlers', () => {
    const bus = createEventBus();
    const handler = () => {};
    bus.subscribe(DomainEventType.PAYMENT_FAILED, handler);
    expect(() => bus.subscribe(DomainEventType.PAYMENT_FAILED, handler)).toThrow(EventBusError);
    expect(() => bus.subscribe(DomainEventType.PAYMENT_FAILED, 42 as never)).toThrow(EventBusError);
  });

  it('enforces the maximum handlers per event type', () => {
    const bus = createEventBus({ maxHandlersPerEvent: 1 });
    bus.subscribe(DomainEventType.PAYMENT_FAILED, () => {});
    expect(() => bus.subscribe(DomainEventType.PAYMENT_FAILED, () => {})).toThrow(EventBusError);
    expect(bus.handlers(DomainEventType.PAYMENT_FAILED)).toHaveLength(1);
  });

  it('unsubscribes by id and by handler reference', () => {
    const bus = createEventBus();
    const handler = () => {};
    const sub = bus.subscribe(DomainEventType.PAYMENT_FAILED, handler);
    const other = () => {};
    bus.subscribe(DomainEventType.PAYMENT_FAILED, other);
    expect(bus.unsubscribe(DomainEventType.PAYMENT_FAILED, sub.id)).toBe(true);
    expect(bus.unsubscribe(DomainEventType.PAYMENT_FAILED, other)).toBe(true);
    expect(bus.unsubscribe(DomainEventType.PAYMENT_FAILED, other)).toBe(false);
    expect(bus.handlers(DomainEventType.PAYMENT_FAILED)).toHaveLength(0);
  });

  it('removes just this handler through the subscription handle', () => {
    const bus = createEventBus();
    const sub = bus.subscribe(DomainEventType.INVOICE_PAID, () => {});
    expect(sub.unsubscribe()).toBe(true);
    expect(sub.unsubscribe()).toBe(false);
    expect(bus.handlers()).toHaveLength(0);
  });

  it('clears all handlers or only one event type', () => {
    const bus = createEventBus();
    bus.subscribe(DomainEventType.INVOICE_PAID, () => {});
    bus.subscribe(DomainEventType.PAYMENT_FAILED, () => {});
    expect(bus.clear(DomainEventType.INVOICE_PAID)).toBe(1);
    expect(bus.handlers()).toHaveLength(1);
    expect(bus.clear()).toBe(1);
    expect(bus.handlers()).toHaveLength(0);
    expect(bus.clear()).toBe(0);
  });

  it('rejects unknown event types at subscribe time in strict mode', () => {
    const bus = createEventBus();
    expect(() => bus.subscribe('mystery.event' as DomainEventType, () => {})).toThrow(EventBusError);
  });
});

describe('publishBatch', () => {
  it('publishes events in order and returns one result each', async () => {
    const bus = createEventBus();
    const seen: string[] = [];
    bus.subscribe(DomainEventType.INVOICE_PAID, (event) => seen.push(event.payload.invoiceId));
    const results = await bus.publishBatch([
      makeEvent(DomainEventType.INVOICE_PAID),
      makeEvent(DomainEventType.INVOICE_PAID, {
        id: 'evt-2',
        payload: {
          invoiceId: 'inv-2',
          subscriptionId: 'sub-1',
          userId: 'user-1',
          amountCents: 500,
          currency: 'USD',
        },
      }),
    ]);
    expect(results).toHaveLength(2);
    expect(seen).toEqual(['inv-1', 'inv-2']);
    expect(results[1]?.event.id).toBe('evt-2');
  });

  it('rejects a non-array batch', async () => {
    const bus = createEventBus();
    await expectCode(
      () => bus.publishBatch('nope' as never),
      EventBusErrorCode.INVALID_EVENT
    );
  });
});

describe('observability', () => {
  it('emits metrics and logs across the full lifecycle', async () => {
    const metrics = makeMetrics();
    const logger = makeLogger();
    const bus = createEventBus({}, metrics, logger);
    const sub = bus.subscribe(DomainEventType.INVOICE_PAID, () => {});
    bus.subscribe(DomainEventType.PAYMENT_FAILED, () => {
      throw new Error('handler failed');
    });
    await bus.publish(makeEvent());
    await bus.publish(makeEvent(DomainEventType.PAYMENT_FAILED));
    await bus.publish(makeEvent(DomainEventType.SUBSCRIPTION_CREATED));
    await bus.publishBatch([makeEvent()]);
    sub.unsubscribe();
    bus.clear();

    const names = metrics.calls.map((call) => call.method);
    expect(names).toContain('recordSubscribed');
    expect(names).toContain('recordPublished');
    expect(names).toContain('recordDelivered');
    expect(names).toContain('recordHandlerFailed');
    expect(names).toContain('recordNoHandlers');
    expect(names).toContain('recordUnsubscribed');
    expect(names).toContain('recordBatchPublished');
    expect(names).toContain('recordCleared');

    const levels = logger.calls.map((call) => call.level);
    expect(levels).toContain('debug');
    expect(levels).toContain('info');
    expect(levels).toContain('error');
  });

  it('emits a rejection metric and a warning log for a malformed event', async () => {
    const metrics = makeMetrics();
    const logger = makeLogger();
    const bus = createEventBus({}, metrics, logger);
    await expectCode(
      () => bus.publish({ id: 'evt-1' } as DomainEvent),
      EventBusErrorCode.INVALID_EVENT
    );
    expect(metrics.calls.map((call) => call.method)).toContain('recordRejected');
    expect(logger.calls.map((call) => call.level)).toContain('warn');
  });

  it('uses partial metrics and logger implementations safely', async () => {
    const bus = createEventBus({}, { recordPublished: () => {} }, { info: () => {} });
    const result = await bus.publish(makeEvent());
    expect(result.delivered).toBe(0);
    expect(result.failed).toBe(0);
  });
});
