/**
 * Tests — Typed Event Bus with Domain Events (Issue #984)
 */

import {
  EventBus,
  InMemoryEventStore,
  SpyEventBus,
  EventCollector,
  buildEvent,
  validateEventPayload,
  EventValidationError,
  eventBusPrometheusMetrics,
  type AnyDomainEvent,
} from '../events';
import {
  SubscriptionEventPublisher,
  BillingEventPublisher,
  AnalyticsEventPublisher,
  ContractEventPublisher,
  DomainEventRouter,
} from '../../eventBusIntegration';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSubCreated(overrides = {}): AnyDomainEvent {
  return buildEvent('subscription', 'created', {
    subscriptionId: 'sub_1',
    userId: 'usr_1',
    planId: 'plan_basic',
    status: 'active',
    billingCycle: 'monthly',
    nextBillingDate: Date.now() + 30 * 86_400_000,
    ...overrides,
  }) as AnyDomainEvent;
}

// ---------------------------------------------------------------------------
// buildEvent
// ---------------------------------------------------------------------------

describe('buildEvent', () => {
  it('creates event with correct shape', () => {
    const event = makeSubCreated();
    expect(event.domain).toBe('subscription');
    expect(event.type).toBe('created');
    expect(event.name).toBe('subscription.created');
    expect(typeof event.id).toBe('string');
    expect(typeof event.occurredAt).toBe('number');
    expect(typeof event.sequence).toBe('number');
    expect(event.schemaVersion).toBe(1);
  });

  it('assigns monotonically increasing sequence numbers', () => {
    const a = buildEvent('subscription', 'created', { subscriptionId: 'a', userId: 'u', planId: 'p', status: 'active', billingCycle: 'monthly', nextBillingDate: 0 });
    const b = buildEvent('subscription', 'cancelled', { subscriptionId: 'b', userId: 'u', cancelledAt: 0, effectiveAt: 0 });
    expect(b.sequence).toBeGreaterThan(a.sequence);
  });

  it('passes through aggregateId and correlationId', () => {
    const event = buildEvent('auth', 'api_key_rotated', {
      keyId: 'k1', merchantId: 'm1', rotatedAt: Date.now(),
    }, { aggregateId: 'agg_1', correlationId: 'corr_1' });
    expect(event.aggregateId).toBe('agg_1');
    expect(event.correlationId).toBe('corr_1');
  });
});

// ---------------------------------------------------------------------------
// validateEventPayload
// ---------------------------------------------------------------------------

describe('validateEventPayload', () => {
  it('passes validation for a correct subscription.created payload', () => {
    const result = validateEventPayload('subscription.created', {
      subscriptionId: 'sub_1',
      userId: 'usr_1',
      planId: 'plan_basic',
      status: 'active',
      billingCycle: 'monthly',
      nextBillingDate: Date.now(),
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('catches missing required fields', () => {
    const result = validateEventPayload('subscription.created', {
      userId: 'usr_1',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('subscriptionId'))).toBe(true);
  });

  it('catches wrong field type', () => {
    const result = validateEventPayload('subscription.created', {
      subscriptionId: 'sub_1',
      userId: 'usr_1',
      planId: 'plan_basic',
      status: 'active',
      billingCycle: 'monthly',
      nextBillingDate: 'not-a-number',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('nextBillingDate'))).toBe(true);
  });

  it('returns valid for unknown event names (no schema)', () => {
    const result = validateEventPayload('analytics.churn_risk_updated', {
      anything: 'goes',
    });
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// EventBus — publish / subscribe
// ---------------------------------------------------------------------------

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('calls subscriber when matching event published', async () => {
    const received: AnyDomainEvent[] = [];
    bus.subscribe('subscription.created', (e) => { received.push(e); });
    await bus.publish(makeSubCreated());
    expect(received).toHaveLength(1);
    expect(received[0]!.name).toBe('subscription.created');
  });

  it('wildcard subscriber receives all events', async () => {
    const received: AnyDomainEvent[] = [];
    bus.subscribe('*', (e) => { received.push(e); });
    await bus.publish(makeSubCreated());
    await bus.publish(buildEvent('billing', 'invoice_generated', {
      invoiceId: 'inv_1', subscriptionId: 'sub_1', userId: 'usr_1',
      amount: 100, currency: 'USD', dueDate: Date.now(),
    }) as AnyDomainEvent);
    expect(received).toHaveLength(2);
  });

  it('subscriber with predicate filter only receives matching events', async () => {
    const received: AnyDomainEvent[] = [];
    bus.subscribe(
      'subscription.created',
      (e) => { received.push(e); },
      { filter: (e) => (e.payload as Record<string, unknown>)['planId'] === 'plan_premium' },
    );
    await bus.publish(makeSubCreated({ planId: 'plan_basic' }));
    await bus.publish(makeSubCreated({ planId: 'plan_premium' }));
    expect(received).toHaveLength(1);
    expect((received[0]!.payload as Record<string, unknown>)['planId']).toBe('plan_premium');
  });

  it('non-matching subscriber does not receive event', async () => {
    const received: AnyDomainEvent[] = [];
    bus.subscribe('billing.invoice_generated', (e) => { received.push(e); });
    await bus.publish(makeSubCreated());
    expect(received).toHaveLength(0);
  });

  it('unsubscribe stops handler from receiving events', async () => {
    const received: AnyDomainEvent[] = [];
    const sub = bus.subscribe('subscription.created', (e) => { received.push(e); });
    sub.unsubscribe();
    await bus.publish(makeSubCreated());
    expect(received).toHaveLength(0);
  });

  it('throws EventValidationError on invalid payload', async () => {
    const badEvent = buildEvent('subscription', 'created', {
      subscriptionId: 123 as unknown as string, // wrong type
      userId: 'usr_1',
      planId: 'p',
      status: 's',
      billingCycle: 'monthly',
      nextBillingDate: Date.now(),
    }) as AnyDomainEvent;
    await expect(bus.publish(badEvent)).rejects.toThrow(EventValidationError);
  });

  it('isolates handler errors — does not abort other handlers', async () => {
    const safe: string[] = [];
    bus.subscribe('subscription.created', () => { throw new Error('boom'); });
    bus.subscribe('subscription.created', () => { safe.push('ok'); });
    await bus.publish(makeSubCreated());
    expect(safe).toContain('ok');
    expect(bus.getMetrics().errors).toBe(1);
  });

  it('tracks metrics correctly', async () => {
    await bus.publish(makeSubCreated());
    await bus.publish(makeSubCreated());
    const m = bus.getMetrics();
    expect(m.published).toBe(2);
    expect(m.countByName['subscription.created']).toBe(2);
  });

  it('resetMetrics zeroes all counters', async () => {
    await bus.publish(makeSubCreated());
    bus.resetMetrics();
    expect(bus.getMetrics().published).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// InMemoryEventStore
// ---------------------------------------------------------------------------

describe('InMemoryEventStore', () => {
  let store: InMemoryEventStore;

  beforeEach(() => {
    store = new InMemoryEventStore();
  });

  it('appends and queries events', () => {
    const e1 = makeSubCreated();
    const e2 = buildEvent('subscription', 'cancelled', {
      subscriptionId: 'sub_1', userId: 'usr_1', cancelledAt: Date.now(), effectiveAt: Date.now(),
    }) as AnyDomainEvent;
    store.append(e1);
    store.append(e2);
    expect(store.query().length).toBe(2);
  });

  it('filters by aggregateId', () => {
    const e1 = buildEvent('subscription', 'created', {
      subscriptionId: 'sub_1', userId: 'u', planId: 'p', status: 'active',
      billingCycle: 'monthly', nextBillingDate: 0,
    }, { aggregateId: 'sub_1' }) as AnyDomainEvent;
    const e2 = buildEvent('subscription', 'created', {
      subscriptionId: 'sub_2', userId: 'u', planId: 'p', status: 'active',
      billingCycle: 'monthly', nextBillingDate: 0,
    }, { aggregateId: 'sub_2' }) as AnyDomainEvent;
    store.append(e1);
    store.append(e2);
    expect(store.query({ aggregateId: 'sub_1' }).length).toBe(1);
  });

  it('filters by domain', () => {
    store.append(makeSubCreated());
    store.append(buildEvent('billing', 'invoice_generated', {
      invoiceId: 'inv_1', subscriptionId: 'sub_1', userId: 'u',
      amount: 100, currency: 'USD', dueDate: 0,
    }) as AnyDomainEvent);
    expect(store.query({ domain: 'billing' }).length).toBe(1);
  });

  it('replays events in sequence order', () => {
    const e1 = buildEvent('subscription', 'created', {
      subscriptionId: 'sub_1', userId: 'u', planId: 'p', status: 'active',
      billingCycle: 'monthly', nextBillingDate: 0,
    }, { aggregateId: 'sub_1' }) as AnyDomainEvent;
    const e2 = buildEvent('subscription', 'cancelled', {
      subscriptionId: 'sub_1', userId: 'u', cancelledAt: 0, effectiveAt: 0,
    }, { aggregateId: 'sub_1' }) as AnyDomainEvent;
    store.append(e1);
    store.append(e2);
    const replayed: AnyDomainEvent[] = [];
    store.replay('sub_1', (e) => replayed.push(e));
    expect(replayed[0]!.type).toBe('created');
    expect(replayed[1]!.type).toBe('cancelled');
  });

  it('reconstruct merges all payloads', () => {
    const e1 = buildEvent('subscription', 'created', {
      subscriptionId: 'sub_1', userId: 'u', planId: 'p', status: 'active',
      billingCycle: 'monthly', nextBillingDate: 0,
    }, { aggregateId: 'sub_1' }) as AnyDomainEvent;
    store.append(e1);
    const state = store.reconstruct('sub_1');
    expect(state['userId']).toBe('u');
  });

  it('archiveBefore marks old events archived', () => {
    store.append(makeSubCreated());
    const archived = store.archiveBefore(Date.now() + 1_000);
    expect(archived).toBe(1);
    // Archived events excluded from default query
    expect(store.query().length).toBe(0);
    // But included when asked
    expect(store.query({ includeArchived: true }).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// SpyEventBus & EventCollector
// ---------------------------------------------------------------------------

describe('SpyEventBus', () => {
  it('records published events', async () => {
    const spy = new SpyEventBus();
    await spy.publish(makeSubCreated());
    expect(spy.published).toHaveLength(1);
    spy.assertPublished('subscription.created');
  });

  it('assertEmpty throws when events present', async () => {
    const spy = new SpyEventBus();
    await spy.publish(makeSubCreated());
    expect(() => spy.assertEmpty()).toThrow();
  });

  it('resetMetrics clears published array', async () => {
    const spy = new SpyEventBus();
    await spy.publish(makeSubCreated());
    spy.resetMetrics();
    expect(spy.published).toHaveLength(0);
  });
});

describe('EventCollector', () => {
  it('collects events by name', async () => {
    const bus = new EventBus();
    const collector = new EventCollector(bus, 'subscription.created');
    await bus.publish(makeSubCreated());
    collector.assertCount(1);
    collector.assertLastEventName('subscription.created');
    collector.dispose();
  });

  it('ofName filters collected events', async () => {
    const bus = new EventBus();
    const collector = new EventCollector(bus);
    await bus.publish(makeSubCreated());
    const subs = collector.ofName('subscription.created');
    expect(subs).toHaveLength(1);
    collector.dispose();
  });
});

// ---------------------------------------------------------------------------
// Prometheus metrics
// ---------------------------------------------------------------------------

describe('eventBusPrometheusMetrics', () => {
  it('outputs valid prometheus format', async () => {
    const bus = new EventBus();
    await bus.publish(makeSubCreated());
    const output = eventBusPrometheusMetrics(bus);
    expect(output).toContain('subtrackr_event_bus_published_total 1');
    expect(output).toContain('subtrackr_event_bus_errors_total');
  });
});

// ---------------------------------------------------------------------------
// Domain Event Publishers (eventBusIntegration.ts)
// ---------------------------------------------------------------------------

describe('SubscriptionEventPublisher', () => {
  let spy: SpyEventBus;
  let store: InMemoryEventStore;
  let pub: SubscriptionEventPublisher;

  beforeEach(() => {
    spy = new SpyEventBus();
    store = new InMemoryEventStore();
    pub = new SubscriptionEventPublisher(spy, store);
  });

  it('publishCreated emits subscription.created', async () => {
    await pub.publishCreated({
      subscriptionId: 'sub_1', userId: 'u', planId: 'p',
      status: 'active', billingCycle: 'monthly', nextBillingDate: Date.now(),
    });
    spy.assertPublished('subscription.created');
    expect(store.query({ aggregateId: 'sub_1' })).toHaveLength(1);
  });

  it('publishCancelled emits subscription.cancelled', async () => {
    await pub.publishCancelled({
      subscriptionId: 'sub_1', userId: 'u', cancelledAt: Date.now(), effectiveAt: Date.now(),
    });
    spy.assertPublished('subscription.cancelled');
  });

  it('publishPaymentFailed emits subscription.payment_failed', async () => {
    await pub.publishPaymentFailed({
      subscriptionId: 'sub_1', userId: 'u', attemptNumber: 1, reason: 'card_declined',
    });
    spy.assertPublished('subscription.payment_failed');
  });

  it('replaySubscription reconstructs state from store', async () => {
    await pub.publishCreated({
      subscriptionId: 'sub_r', userId: 'u', planId: 'p',
      status: 'active', billingCycle: 'monthly', nextBillingDate: 0,
    });
    const state = pub.replaySubscription('sub_r');
    expect(state['userId']).toBe('u');
  });
});

describe('BillingEventPublisher', () => {
  let spy: SpyEventBus;
  let pub: BillingEventPublisher;

  beforeEach(() => {
    spy = new SpyEventBus();
    pub = new BillingEventPublisher(spy, new InMemoryEventStore());
  });

  it('publishInvoiceGenerated emits billing.invoice_generated', async () => {
    await pub.publishInvoiceGenerated({
      invoiceId: 'inv_1', subscriptionId: 'sub_1', userId: 'u',
      amount: 99.99, currency: 'USD', dueDate: Date.now(),
    });
    spy.assertPublished('billing.invoice_generated');
  });

  it('publishUsageThresholdReached computes ratio', async () => {
    await pub.publishUsageThresholdReached({
      subscriptionId: 'sub_1', userId: 'u',
      metricType: 'api_calls', usage: 900, limit: 1000, level: 'soft',
    });
    const event = spy.published.find((e) => e.name === 'billing.usage_threshold_reached');
    expect((event!.payload as Record<string, unknown>)['ratio']).toBeCloseTo(0.9);
  });
});

describe('DomainEventRouter', () => {
  it('routes subscription.cancelled to handler', async () => {
    const bus = new EventBus();
    const store = new InMemoryEventStore();
    const cancelled: string[] = [];

    const router = new DomainEventRouter(bus, {
      onSubscriptionCancelled: async (subId) => { cancelled.push(subId); },
    });
    router.register();

    const pub = new SubscriptionEventPublisher(bus, store);
    await pub.publishCancelled({
      subscriptionId: 'sub_X', userId: 'u', cancelledAt: Date.now(), effectiveAt: Date.now(),
    });
    expect(cancelled).toContain('sub_X');
    router.unregister();
  });

  it('routes high churn risk to handler via predicate filter', async () => {
    const bus = new EventBus();
    const highRisk: number[] = [];

    const router = new DomainEventRouter(bus, {
      onChurnRiskHigh: async (_, score) => { highRisk.push(score); },
    });
    router.register();

    const pub = new AnalyticsEventPublisher(bus, new InMemoryEventStore());
    await pub.publishChurnRiskUpdated({
      subscriptionId: 's', userId: 'u', riskScore: 0.5, factors: [],
    });
    await pub.publishChurnRiskUpdated({
      subscriptionId: 's', userId: 'u', riskScore: 0.9, factors: ['payment_decline'],
    });
    expect(highRisk).toHaveLength(1);
    expect(highRisk[0]).toBe(0.9);
    router.unregister();
  });

  it('unregister stops all routing', async () => {
    const bus = new EventBus();
    const calls: string[] = [];
    const router = new DomainEventRouter(bus, {
      onSubscriptionCancelled: async (id) => { calls.push(id); },
    });
    router.register();
    router.unregister();

    const pub = new SubscriptionEventPublisher(bus, new InMemoryEventStore());
    await pub.publishCancelled({
      subscriptionId: 'sub_Y', userId: 'u', cancelledAt: Date.now(), effectiveAt: Date.now(),
    });
    expect(calls).toHaveLength(0);
  });
});
